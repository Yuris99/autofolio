import test from "node:test";
import assert from "node:assert/strict";
import { classify, allValues } from "../extension/matcher.js";

test("section context separates school and certificate fields", () => {
  assert.equal(classify({ label: "학교명", section: "대학교" }).type, "education.school");
  assert.equal(classify({ label: "취득일", section: "자격사항" }).type, "certificate.obtainedDate");
  assert.equal(classify({ label: "명칭", section: "자격증" }).type, "certificate.name");
});

test("unknown field remains unclassified", () => {
  assert.equal(classify({ label: "지원 분야", section: "기본정보" }).type, null);
});

test("only saved nonempty profile values become candidates", () => {
  const values = allValues({
    personal: { name: "홍길동", email: "" },
    education: [{ school: "한국대학교", major: "" }],
    certificate: [{ name: "정보처리기사" }, { name: "SQLD" }]
  });
  assert.deepEqual(values.map(item => item.value), ["홍길동", "한국대학교", "정보처리기사", "SQLD"]);
});
