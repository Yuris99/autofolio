// Validator: 입력 후 실제 페이지 상태를 다시 읽어 계획대로 들어갔는지 확인한다 (README 6.6).
import type { Frame } from "playwright-core";
import { analyzeForm } from "../analyzer/analyze.js";
import { isCodeHolder } from "../classifier/rules.js";
import { call, type FillResult } from "../filler/fill.js";

export type Verdict = { result: FillResult; verified: boolean; detail: string };

type State = { exists: boolean; disabled?: boolean; invalid?: boolean; value?: string; selectedText?: string; checked?: boolean };

const digits = (s: string) => s.replace(/\D/g, "");

export async function verify(frame: Frame, results: FillResult[]): Promise<Verdict[]> {
  const { fields } = await analyzeForm(frame.page());
  const verdicts: Verdict[] = [];

  for (const r of results) {
    if (!r.ok) {
      verdicts.push({ result: r, verified: false, detail: r.detail });
      continue;
    }
    const { step } = r;
    const sel = step.cls.widget === "radio" ? step.target! : step.field.selector;
    const s = await call<State>(frame, "readState", sel);
    let ok = false;
    let detail = "";

    switch (step.cls.widget) {
      case "search": {
        // 검색칸 텍스트는 키워드 그대로 남으므로, 같은 그룹의 코드 저장 필드가 채워졌는지로 확인
        const holder = fields.find((f) => isCodeHolder(f) && (f.attrs.relTarget || f.name).startsWith(step.cls.groupKey));
        ok = holder ? holder.hasValue === true : true;
        detail = holder ? (ok ? "코드 필드 채워짐" : "코드 필드 비어 있음 — 선택이 반영되지 않음") : "코드 필드 없음 (검색칸만 확인)";
        break;
      }
      case "radio":
        ok = s.checked === true;
        detail = ok ? "선택됨" : "선택되지 않음";
        break;
      case "select":
        ok = s.selectedText === step.target;
        detail = ok ? "" : `선택된 값: "${s.selectedText}"`;
        break;
      case "date":
        // 사이트가 형식을 바꿔 저장할 수 있으므로 숫자만 비교
        ok = digits(s.value ?? "") === digits(step.value!);
        detail = ok ? (s.value !== step.value ? `사이트 형식으로 변환됨: ${s.value}` : "") : `실제 값: "${s.value}"`;
        break;
      default:
        ok = (s.value ?? "") === step.value;
        detail = ok ? "" : `실제 값: "${s.value}"`;
    }
    if (s.invalid) {
      ok = false;
      detail = `${detail} (사이트가 오류로 표시)`.trim();
    }
    verdicts.push({ result: r, verified: ok, detail });
  }
  return verdicts;
}
