import { chromium, type Browser, type Page } from "playwright-core";
import { CDP_URL } from "../config.js";

type Target = { type: string; url: string };

// 실행 중인 AutoFolio 크롬에 연결한다. 실패 원인별로 안내 메시지를 낸다.
export async function connect(): Promise<Browser> {
  let targets: Target[];
  try {
    targets = (await (await fetch(`${CDP_URL}/json/list`)).json()) as Target[];
  } catch {
    throw new Error(`AutoFolio 크롬이 실행 중이 아닙니다. 먼저 'pnpm browser'를 실행하세요.`);
  }
  // 창을 모두 닫으면(macOS) 크롬 프로세스는 남아 있지만 탭이 없어 CDP 연결이 실패한다.
  if (!targets.some((t) => t.type === "page")) {
    throw new Error(
      `AutoFolio 크롬에 열린 탭이 없습니다. Dock의 크롬 아이콘을 눌러 새 창을 열거나, 크롬을 종료한 뒤 'pnpm browser'를 다시 실행하세요.`,
    );
  }
  return chromium.connectOverCDP(CDP_URL);
}

export function webPages(browser: Browser, urlFilter?: string): Page[] {
  return browser
    .contexts()
    .flatMap((c) => c.pages())
    .filter((p) => /^(https?|file):/.test(p.url())) // file: 은 테스트 fixture용
    .filter((p) => !urlFilter || p.url().includes(urlFilter));
}
