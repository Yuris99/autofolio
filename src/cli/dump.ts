// 실행 중인 AutoFolio 크롬에 붙어 열린 탭들의 지원서 필드 구조를 JSON으로 저장한다.
// 읽기 전용: 페이지에 입력/클릭하지 않는다.
//   pnpm dump            → 열린 모든 탭
//   pnpm dump hd.com     → URL에 "hd.com"이 포함된 탭만
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { collectPage } from "../analyzer/analyze.js";
import { connect, webPages } from "../browser/connect.js";
import { DUMP_DIR } from "../config.js";

const filter = process.argv[2];

const browser = await connect().catch((e: Error) => {
  console.error(e.message);
  process.exit(1);
});

const pages = webPages(browser, filter);
if (!pages.length) {
  console.error("덤프할 탭이 없습니다.");
  process.exit(1);
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-");

for (const page of pages) {
  const frames = await collectPage(page);

  const host = new URL(page.url()).host;
  const dir = path.join(DUMP_DIR, host);
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${stamp}.json`);
  const dump = { dumpedAt: new Date().toISOString(), url: page.url(), title: await page.title(), frames };
  writeFileSync(file, JSON.stringify(dump, null, 2));

  const total = frames.reduce((n, f) => n + (f.fieldCount ?? 0), 0);
  const visible = frames.reduce((n, f) => n + (f.fields?.filter((x) => x.visible).length ?? 0), 0);
  console.log(`${page.url()}`);
  console.log(`  프레임 ${frames.length}개, 필드 ${total}개 (보이는 필드 ${visible}개)`);
  console.log(`  → ${path.relative(process.cwd(), file)}`);
}

// connectOverCDP 연결만 끊고 사용자의 크롬 창은 그대로 둔다.
process.exit(0);
