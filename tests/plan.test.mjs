import test from "node:test";
import assert from "node:assert/strict";
import { defaultChoice, rowsToAdd } from "../extension/plan.js";

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
