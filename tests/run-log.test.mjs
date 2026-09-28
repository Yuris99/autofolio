import test from "node:test";
import assert from "node:assert/strict";
import { addFill, createRun, pageOf, saveRun, summarize } from "../extension/run-log.js";

const fields = [
  { token: "af-1", label: "성명", section: "인적사항", name: "nm", inputType: "text", required: true, options: [] },
  { token: "af-2", label: "명칭", section: "자격증", name: "cert", inputType: "text", required: false, options: [] }
];
const suggestions = new Map([["af-1", { type: "personal.name", reason: "라벨 규칙" }], ["af-2", { type: null, reason: "확인 필요" }]]);

test("page address drops query strings and fragments", () => {
  assert.equal(pageOf("https://jobs.example.com/apply/form?session=abc#step2"), "https://jobs.example.com/apply/form");
  assert.equal(pageOf("not a url"), "");
});

test("a run records structure, choices and outcomes but no saved values", () => {
  const run = createRun("https://jobs.example.com/apply?id=7", fields, suggestions, new Date("2026-09-28T00:00:00Z"));
  assert.equal(run.page, "https://jobs.example.com/apply");
  assert.equal(run.fields[1].suggested, null);

  const results = [
    { token: "af-1", status: "filled", detail: "입력값 확인", expected: "홍길동" },
    { token: "af-2", status: "review", detail: "검색 결과가 나타나지 않았습니다." }
  ];
  addFill(run, new Map([["af-1", "personal.name"], ["af-2", "certificate.name"]]), results, ["명칭"]);
  const [fill] = run.fills;
  assert.deepEqual(fill.counts, { filled: 1, review: 1, failed: 0, skipped: 0 });
  assert.equal(fill.results[0].corrected, false);
  assert.equal(fill.results[1].corrected, true, "user chose a type the matcher did not suggest");
  assert.equal(JSON.stringify(run).includes("홍길동"), false);
});

test("the log keeps the latest runs and replaces a run by id", () => {
  let log = [];
  for (let i = 0; i < 25; i++) log = saveRun(log, { id: String(i), fills: [] });
  assert.equal(log.length, 20);
  assert.equal(log[0].id, "5");
  log = saveRun(log, { id: "24", fills: [{ counts: { filled: 3, failed: 1 } }] });
  assert.equal(log.length, 20);
  assert.deepEqual(summarize(log), { runs: 20, filled: 3, review: 0, failed: 1, skipped: 0 });
});
