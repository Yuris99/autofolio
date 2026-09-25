import path from "node:path";

export const ROOT = path.resolve(import.meta.dirname, "..");

// AutoFolio 전용 크롬 프로필 (로그인 유지). 평소 쓰는 크롬 프로필과 분리한다.
export const CHROME_PROFILE_DIR = path.join(ROOT, ".autofolio", "chrome-profile");
export const CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
// 테스트 시 별도 크롬을 쓰기 위해 환경변수로 바꿀 수 있다
export const CDP_PORT = Number(process.env.AUTOFOLIO_CDP_PORT ?? 9222);
export const CDP_URL = `http://127.0.0.1:${CDP_PORT}`;

// 필드 덤프 저장 위치 (gitignore 대상)
export const DUMP_DIR = path.join(ROOT, "data", "dumps");
