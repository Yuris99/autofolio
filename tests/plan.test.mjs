import test from "node:test";
import assert from "node:assert/strict";
import { defaultChoice, fieldId, followUpItems, rowsToAdd } from "../extension/plan.js";

const loop = (key, index, rows, canAdd = true) => ({ key, index, rows, canAdd });
const types = { a: "certificate.name", b: "language.test", c: "personal.name", d: null };
const typeOf = field => types[field.token];

test("rows are added until every saved entry has one", () => {
  const fields = [{ token: "a", loop: loop("license", 0, 1) }, { token: "b", loop: loop("languageExam", 0, 1) }, { token: "c" }];
  const profile = { certificate: [{}, {}, {}], language: [{}] };
  assert.deepEqual(rowsToAdd(fields, typeOf, profile), [{ key: "license", group: "certificate", times: 2 }]);
});

test("no rows without a + button, for unknown fields, or beyond the limit", () => {
  assert.deepEqual(rowsToAdd([{ token: "a", loop: loop("license", 0, 1, false) }], typeOf, { certificate: [{}, {}] }), []);
  assert.deepEqual(rowsToAdd([{ token: "d", loop: loop("x", 0, 1) }], typeOf, { certificate: [{}, {}] }), []);
  const many = { certificate: Array.from({ length: 30 }, () => ({})) };
  assert.equal(rowsToAdd([{ token: "a", loop: loop("license", 0, 1) }], typeOf, many)[0].times, 9);
});

test("row N of a repeating block starts with entry N, and nothing past the saved entries", () => {
  const candidates = [{ key: "certificate.issuer:0" }, { key: "certificate.issuer:1" }];
  assert.equal(defaultChoice({ loop: loop("license", 1, 2) }, "certificate.issuer", candidates), "certificate.issuer:1");
  assert.equal(defaultChoice({ loop: loop("license", 2, 3) }, "certificate.issuer", candidates), "");
  assert.equal(defaultChoice({ loop: loop("license", 1, 2) }, "certificate.issuer", candidates.slice(0, 1)), "");
});

test("outside repeating rows: a single candidate, else the entry picked last", () => {
  assert.equal(defaultChoice({}, "personal.name", [{ key: "personal.name:0" }]), "personal.name:0");
  const two = [{ key: "certificate.name:0" }, { key: "certificate.name:1" }];
  assert.equal(defaultChoice({}, "certificate.name", two), "");
  assert.equal(defaultChoice({}, "certificate.name", two, { certificate: 1 }), "certificate.name:1");
  assert.equal(defaultChoice({}, null, two), "");
});

test("follow-up fills only newly opened fields that have a clear value", () => {
  const seen = new Set([fieldId({ name: "", label: "자격증검색", section: "자격증", inputType: "search", loop: { key: "license", index: 0 } })]);
  const fields = [
    { token: "af-1", name: "", label: "자격증검색", section: "자격증", inputType: "search", loop: { key: "license", index: 0, rows: 2 } },
    { token: "af-2", name: "license[0].organization", label: "발급기관", section: "자격증", inputType: "text", loop: { key: "license", index: 0, rows: 2 } },
    { token: "af-3", name: "license[1].organization", label: "발급기관", section: "자격증", inputType: "text", loop: { key: "license", index: 1, rows: 2 } },
    { token: "af-4", name: "memo", label: "비고", section: "자격증", inputType: "text" }
  ];
  const types = { "af-1": "certificate.name", "af-2": "certificate.issuer", "af-3": "certificate.issuer", "af-4": null };
  const values = [
    { key: "certificate.name:0", type: "certificate.name", value: "정보처리기사" },
    { key: "certificate.issuer:0", type: "certificate.issuer", value: "한국산업인력공단" },
    { key: "certificate.issuer:1", type: "certificate.issuer", value: "한국데이터산업진흥원" }
  ];
  const items = followUpItems(seen, fields, field => types[field.token], values);
  assert.deepEqual(items.map(item => [item.token, item.value]), [["af-2", "한국산업인력공단"], ["af-3", "한국데이터산업진흥원"]]);
});
