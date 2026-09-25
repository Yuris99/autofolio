// AutoFolio 전용 크롬을 원격 디버깅 포트와 함께 띄운다.
// 이 창에서 사용자가 직접 로그인/이동하고, dump 등 다른 명령이 CDP로 붙는다.
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { CDP_PORT, CDP_URL, CHROME_PATH, CHROME_PROFILE_DIR } from "../config.js";

async function isRunning(): Promise<boolean> {
  try {
    const res = await fetch(`${CDP_URL}/json/version`);
    return res.ok;
  } catch {
    return false;
  }
}

const startUrl = process.argv[2] ?? "about:blank";

if (await isRunning()) {
  console.log(`이미 실행 중입니다 (${CDP_URL}).`);
  process.exit(0);
}

mkdirSync(CHROME_PROFILE_DIR, { recursive: true });

const child = spawn(
  CHROME_PATH,
  [
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${CHROME_PROFILE_DIR}`,
    "--no-first-run",
    "--no-default-browser-check",
    startUrl,
  ],
  { detached: true, stdio: "ignore" },
);
child.unref();

for (let i = 0; i < 50; i++) {
  if (await isRunning()) {
    console.log(`AutoFolio 크롬 실행됨 (${CDP_URL})`);
    console.log("이 창에서 로그인 후 지원서 페이지로 이동하세요.");
    process.exit(0);
  }
  await new Promise((r) => setTimeout(r, 200));
}

console.error("크롬 원격 디버깅 포트에 연결하지 못했습니다.");
process.exit(1);
