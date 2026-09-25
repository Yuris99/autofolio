// Page Analyzer: 페이지의 모든 프레임에서 필드 구조를 수집한다 (읽기 전용).
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Frame, Page } from "playwright-core";
import type { Field, FrameDump } from "./types.js";

const COLLECT_SCRIPT = readFileSync(path.join(import.meta.dirname, "collect-fields.browser.js"), "utf8");

export async function collectFrame(frame: Frame): Promise<FrameDump> {
  try {
    return await frame.evaluate<FrameDump>(COLLECT_SCRIPT);
  } catch (e) {
    return { url: frame.url(), error: String(e) };
  }
}

export async function collectPage(page: Page): Promise<FrameDump[]> {
  const frames: FrameDump[] = [];
  for (const frame of page.frames()) frames.push(await collectFrame(frame));
  return frames;
}

// 필드가 가장 많은 프레임 = 지원서 본문 프레임
export async function analyzeForm(page: Page): Promise<{ frame: Frame; fields: Field[] }> {
  let best: { frame: Frame; fields: Field[] } = { frame: page.mainFrame(), fields: [] };
  for (const frame of page.frames()) {
    const dump = await collectFrame(frame);
    if ((dump.fields?.length ?? 0) > best.fields.length) best = { frame, fields: dump.fields ?? [] };
  }
  return best;
}
