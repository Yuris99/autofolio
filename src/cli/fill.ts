// 현재 열린 지원서 단계를 분석해 입력 계획을 보여주고, --apply 시 입력 후 검증한다.
//   pnpm fill                                   → 입력 계획만 표시 (dry-run, 페이지 변경 없음)
//   pnpm fill --apply                           → 입력 + 검증
//   pnpm fill --pick certificates=정보처리기사,SQLD → 입력할 자격증 지정 (README 6.4)
//   pnpm fill --overwrite                       → 이미 입력된 칸도 덮어쓰기
//   pnpm fill --date-format YYYY-MM-DD          → 날짜 형식 지정 (기본 YYYY.MM.DD)
//   pnpm fill recruiter.co.kr                   → URL에 포함된 문자열로 탭 선택
// 제출·임시저장·다음 버튼은 누르지 않는다. 최종 확인과 제출은 사용자가 한다.
import { parseArgs } from "node:util";
import { analyzeForm } from "../analyzer/analyze.js";
import { connect, webPages } from "../browser/connect.js";
import { classifyAll } from "../classifier/rules.js";
import { applyPlan } from "../filler/fill.js";
import { buildPlan, type PlanOptions, type PlanStep } from "../matcher/plan.js";
import { loadProfile } from "../profile/load.js";
import { verify } from "../validator/verify.js";

const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    apply: { type: "boolean", default: false },
    overwrite: { type: "boolean", default: false },
    pick: { type: "string", multiple: true },
    "date-format": { type: "string" },
    profile: { type: "string" },
  },
});

const fail = (msg: string) => {
  console.error(msg);
  process.exit(1);
};

const profile = (() => {
  try {
    return loadProfile(args.profile);
  } catch (e) {
    return fail((e as Error).message);
  }
})();

const opts: PlanOptions = { overwrite: args.overwrite, dateFormat: args["date-format"], pick: {} };
for (const p of args.pick ?? []) {
  const [key, list] = p.split("=");
  if (key === "certificates") opts.pick!.certificates = list.split(",").map((s) => s.trim());
}

const browser = await connect().catch((e: Error) => fail(e.message));
const pages = webPages(browser, positionals[0]);
if (!pages.length) fail("대상 탭이 없습니다.");
// 여러 탭이면 필드가 가장 많은 탭 = 작성 중인 지원서
let target = { page: pages[0], ...(await analyzeForm(pages[0])) };
for (const page of pages.slice(1)) {
  const a = await analyzeForm(page);
  if (a.fields.length > target.fields.length) target = { page, ...a };
}
const { page, frame, fields } = target;

const classified = classifyAll(fields);
const plan = buildPlan(classified, fields, profile, opts);

// ── 출력 ──────────────────────────────────────────────
const SLOT_LABEL: Record<string, string> = {
  "personal.name": "이름", "personal.gender": "성별", "personal.birthday": "생년월일",
  "personal.phone": "휴대전화", "personal.email": "이메일",
  "personal.address.zipCode": "우편번호", "personal.address.address": "주소", "personal.address.detail": "상세주소",
  "education.school": "학교", "education.major": "전공", "education.degree": "학위",
  "education.entranceDate": "입학일", "education.graduationDate": "졸업일", "education.entranceType": "입학구분",
  "education.status": "졸업구분", "education.gpa": "평점", "education.gpaScale": "만점",
  "certificates.name": "자격증명", "certificates.issuer": "발급기관",
  "certificates.registrationNumber": "등록번호", "certificates.acquiredDate": "취득일",
};
const ICON = { fill: "✅ 입력", ask: "❓ 확인", skip: "⏭  없음", already: "☑  완료" } as const;

const groupNo = new Map<string, number>();
const itemLabel = (s: PlanStep) => {
  const kind = s.cls.slot.split(".")[0] + (s.cls.level ?? "");
  if (kind === "personal") return "인적사항";
  const key = `${kind}|${s.cls.groupKey}`;
  if (!groupNo.has(key)) groupNo.set(key, [...groupNo.keys()].filter((k) => k.startsWith(kind + "|")).length + 1);
  const name = s.cls.level ?? "자격증";
  return `${name} ${groupNo.get(key)}`;
};
const pad = (s: string, n: number) => s + " ".repeat(Math.max(0, n - [...s].reduce((w, ch) => w + (ch.charCodeAt(0) > 0x2e80 ? 2 : 1), 0)));

console.log(`\n📄 ${await page.title()}`);
console.log(`   ${page.url()}\n`);
console.log("입력 계획");
for (const s of plan) {
  const val = s.action === "ask" && s.candidates ? `후보: ${s.candidates.join(" / ")}` : (s.value ?? "");
  console.log(`  ${ICON[s.action]}  ${pad(itemLabel(s), 10)} ${pad(SLOT_LABEL[s.cls.slot] ?? s.cls.slot, 9)} ${pad(val, 26)} ${s.note}`);
}

const unknown = classified.filter((c) => !c.result && c.field.visible && c.field.type !== "file");
if (unknown.length) {
  const names = unknown.map((c) => c.field.context.label || c.field.context.title || c.field.context.placeholder || c.field.context.preceding).filter(Boolean);
  console.log(`\n규칙으로 분류하지 못한 필드 ${unknown.length}개 (MVP 범위 밖이거나 규칙 추가 필요)`);
  console.log(`  ${[...new Set(names)].slice(0, 12).join(" · ")}${names.length > 12 ? " …" : ""}`);
}

const count = (a: string) => plan.filter((s) => s.action === a).length;
console.log(`\n요약: 입력 ${count("fill")} · 확인 필요 ${count("ask")} · 이력 없음 ${count("skip")} · 이미 입력 ${count("already")}`);

if (!args.apply) {
  console.log("\n(미리보기입니다. 실제로 입력하려면 --apply)");
  process.exit(0);
}

// ── 입력 + 검증 ────────────────────────────────────────
console.log("\n입력 중…");
const results = await applyPlan(frame, plan);
const verdicts = await verify(frame, results);

console.log("\n검증 결과");
for (const v of verdicts) {
  const s = v.result.step;
  console.log(`  ${v.verified ? "✅" : "❌"}  ${pad(itemLabel(s), 10)} ${pad(SLOT_LABEL[s.cls.slot] ?? s.cls.slot, 9)} ${pad(s.value ?? "", 26)} ${v.detail}`);
}
const bad = verdicts.filter((v) => !v.verified).length;
console.log(`\n${verdicts.length - bad}/${verdicts.length}개 확인됨${bad ? ` · ${bad}개 문제 — 브라우저에서 직접 확인해주세요` : ""}`);
console.log("⚠️  제출·임시저장은 AutoFolio가 누르지 않습니다. 화면에서 직접 확인한 뒤 진행하세요.");
process.exit(0);
