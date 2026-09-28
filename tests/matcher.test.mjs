import test from "node:test";
import assert from "node:assert/strict";
import { classify, allValues, cleanProfile, describeType } from "../extension/matcher.js";

test("section context separates school and certificate fields", () => {
  assert.equal(classify({ label: "학교명", section: "대학교" }).type, "education.school");
  assert.equal(classify({ label: "취득일", section: "자격사항" }).type, "certificate.obtainedDate");
  assert.equal(classify({ label: "명칭", section: "자격증" }).type, "certificate.name");
});

test("generic labels follow the section they are in", () => {
  assert.equal(classify({ label: "취득일", section: "어학성적" }).type, "language.obtainedDate");
  assert.equal(classify({ label: "점수", section: "어학" }).type, "language.score");
  assert.equal(classify({ label: "수여기관", section: "수상경력" }).type, "award.issuer");
  assert.equal(classify({ label: "시작일", section: "프로젝트 경험" }).type, "project.startDate");
  assert.equal(classify({ label: "활동 내용", section: "대외활동" }).type, "activity.description");
  assert.equal(classify({ label: "담당업무", section: "경력사항" }).type, "career.description");
  assert.equal(classify({ label: "취득일" }).type, "certificate.obtainedDate");
});

test("specific labels win over a combined section", () => {
  assert.equal(classify({ label: "자격증명", section: "자격증 및 어학" }).type, "certificate.name");
  assert.equal(classify({ label: "시험명", section: "자격증 및 어학" }).type, "language.test");
  assert.equal(classify({ label: "생년월일", section: "인적사항" }).type, "personal.birthDate");
});

test("unknown field remains unclassified", () => {
  assert.equal(classify({ label: "지원 분야", section: "기본정보" }).type, null);
});

test("only saved nonempty profile values become candidates", () => {
  const values = allValues({
    personal: { name: "홍길동", email: "" },
    education: [{ school: "한국대학교", major: "" }],
    certificate: [{ name: "정보처리기사" }, { name: "SQLD" }],
    language: [{ test: "TOEIC", score: "900" }]
  });
  assert.deepEqual(values.map(item => item.value), ["홍길동", "한국대학교", "정보처리기사", "SQLD", "TOEIC", "900"]);
  assert.equal(values.at(-1).label, "TOEIC · 900");
  assert.equal(describeType("language.score"), "어학의 점수·등급");
});

test("backup files are reduced to known fields", () => {
  const profile = cleanProfile({
    app: "autofolio",
    profile: {
      personal: { name: " 홍길동 ", password: "x" },
      award: [{ title: "우수상", date: 20240101 }, { title: "" }],
      unknown: [{ name: "?" }]
    }
  });
  assert.equal(profile.personal.name, "홍길동");
  assert.equal("password" in profile.personal, false);
  assert.deepEqual(profile.award, [{ title: "우수상", issuer: "", date: "20240101" }]);
  assert.deepEqual(profile.education, []);
  assert.equal("unknown" in profile, false);
  assert.throws(() => cleanProfile("nope"));
});
