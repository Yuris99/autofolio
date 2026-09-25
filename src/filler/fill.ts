// Form Filler: 입력 계획 중 action=fill 인 단계만 실제 페이지에 적용한다.
// 제출/임시저장/다음 버튼은 절대 누르지 않는다. 자동 입력 동안 폼 제출을 차단한다.
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Frame } from "playwright-core";
import type { PlanStep } from "../matcher/plan.js";

export const WIDGETS = readFileSync(path.join(import.meta.dirname, "widgets.browser.js"), "utf8");

export const call = <T>(frame: Frame, fn: string, arg: unknown) =>
  frame.evaluate<T>(`(${WIDGETS}).${fn}(${JSON.stringify(arg)})`);

export type FillResult = { step: PlanStep; ok: boolean; detail: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitEnabled(frame: Frame, selector: string, ms = 5000): Promise<boolean> {
  for (let t = 0; t < ms; t += 200) {
    const s = await call<{ exists: boolean; disabled: boolean }>(frame, "readState", selector);
    if (s.exists && !s.disabled) return true;
    await sleep(200);
  }
  return false;
}

async function fillSearch(frame: Frame, step: PlanStep): Promise<FillResult> {
  const sel = step.field.selector;
  const keyword = step.value!;
  const input = frame.locator(sel);
  await input.fill(keyword);

  // Enter로 검색하는 칸이라고 명시된 경우에만 Enter (그 외에는 자동완성 목록을 기다린다)
  if (/enter|엔터/i.test(step.field.context.placeholder)) await input.press("Enter");

  let results: string[] = [];
  for (let t = 0; t < 5000 && !results.length; t += 250) {
    await sleep(250);
    results = await call<string[]>(frame, "searchResults", sel);
  }
  if (!results.length) return { step, ok: false, detail: "검색 결과를 찾지 못함" };

  // 정확히 일치하는 결과만 자동 선택 (부분 일치·첫 번째 결과 선택 금지: 정보처리기능사 ≠ 정보처리기사)
  const exact = results.filter((r) => r === keyword);
  if (exact.length !== 1) {
    return {
      step,
      ok: false,
      detail: `정확히 일치하는 결과 ${exact.length}개 → 사용자 확인 필요. 결과: ${results.slice(0, 8).join(", ")}`,
    };
  }
  const clicked = await call<boolean>(frame, "clickResult", { selector: sel, text: keyword });
  return { step, ok: clicked, detail: clicked ? `"${keyword}" 선택` : "결과 클릭 실패" };
}

async function fillRadio(frame: Frame, step: PlanStep): Promise<FillResult> {
  const radio = frame.locator(step.target!);
  try {
    await radio.check({ timeout: 2000 });
  } catch {
    // 커스텀 디자인으로 input이 숨겨진 경우: 연결된 label 클릭
    await radio.evaluate((el: HTMLInputElement) => (el.labels?.[0] ?? el).click());
  }
  return { step, ok: true, detail: step.note };
}

async function fillOne(frame: Frame, step: PlanStep): Promise<FillResult> {
  const sel = step.field.selector;
  if (step.cls.widget !== "radio" && !(await waitEnabled(frame, sel))) {
    return { step, ok: false, detail: "필드가 비활성 상태 (선행 입력 필요)" };
  }
  switch (step.cls.widget) {
    case "search":
      return fillSearch(frame, step);
    case "radio":
      return fillRadio(frame, step);
    case "select":
      await frame.locator(sel).selectOption({ label: step.target! });
      return { step, ok: true, detail: "" };
    default: {
      const loc = frame.locator(sel);
      await loc.fill(step.value!);
      await loc.dispatchEvent("change");
      await loc.evaluate((el: HTMLElement) => el.blur());
      return { step, ok: true, detail: "" };
    }
  }
}

export async function applyPlan(frame: Frame, steps: PlanStep[]): Promise<FillResult[]> {
  const results: FillResult[] = [];
  await call(frame, "guardSubmit", true);
  try {
    for (const step of steps.filter((s) => s.action === "fill")) {
      try {
        results.push(await fillOne(frame, step));
      } catch (e) {
        results.push({ step, ok: false, detail: `오류: ${(e as Error).message.split("\n")[0]}` });
      }
      await sleep(150); // 사이트 스크립트(연쇄 select, 필드 활성화 등)가 반응할 시간
    }
  } finally {
    await call(frame, "guardSubmit", false);
  }
  return results;
}
