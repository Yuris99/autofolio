import test from "node:test";
import assert from "node:assert/strict";
import { classify } from "../extension/matcher.js";

// Fields from a real scan of an incruit.com application form (fsec.incruit.com/apply/form_apply.asp,
// log of 2026-09-29, v0.9.0). Rows share one label ("기간", "현주소", "* 성명") and the meaning is in
// the internal name. No applicant data. null: not a profile value, or decided later by its neighbours.
const section = "금융보안원 입사지원서";
for (const [field, type] of [
  // Statements to tick yourself are never ticked from the profile.
  [{ label: "ㅇ 본인은 병역의무를 필한자 또는 면제된 자임을 확인함(입사일 이전 전역", name: "subcheck_box2", inputType: "checkbox", section }, null],
  [{ label: "* 성명", name: "Name", section }, "personal.name"],
  [{ label: "* 성명", name: "Name_en_first", section }, "personal.englishName"],
  [{ label: "* 성명", name: "Name_en_last", section }, "personal.englishName"],
  [{ label: "* 생년월일", name: "BirthdateY", section }, "personal.birthDate"],
  [{ label: "* 현주소", name: "Zipcode2", section }, "personal.zipCode"],
  [{ label: "* 현주소", name: "Address21", section }, "personal.address"],
  [{ label: "* 휴대폰", name: "mNumber1", inputType: "select", section }, "personal.phone"],
  [{ label: "* 비상연락처", name: "pNumber1", inputType: "select", section }, null],
  [{ label: "* E-mail", name: "Email", section }, "personal.email"],
  [{ label: "학교명", name: "HighschoolName" }, "education.school"],
  [{ label: "소재지", name: "HighschoolLocation", inputType: "select" }, null],
  [{ label: "본/분", name: "HighschoolCampus", inputType: "radio" }, null],
  [{ label: "기간", name: "HighschoolStartType", inputType: "select" }, null],
  [{ label: "주/야", name: "HighschoolType", inputType: "radio" }, null],
  [{ label: "전공", name: "CollegeMajor" }, "education.major"],
  [{ label: "전공", name: "UniversityMinor" }, null],
  [{ label: "전공", name: "UniversityMinorType", inputType: "select" }, null],
  [{ label: "군필여부", name: "Military", inputType: "select", section }, "military.status"],
  [{ label: "군별", name: "MilitaryType", inputType: "select", section }, "military.branch"],
  [{ label: "계급", name: "MilitaryLevel", inputType: "select", section }, "military.rank"],
  [{ label: "전역사유", name: "MilitaryEnd", inputType: "select", section }, "military.discharge"],
  [{ label: "기간", name: "MilitaryS", section }, "military.startDate"],
  [{ label: "병과", name: "MilitaryWork", inputType: "select", section }, null],
  [{ label: "", name: "License", section }, "certificate.name"],
  [{ label: "", name: "LicenseNumber", section }, "certificate.number"],
  [{ label: "", name: "LicenseComplete", inputType: "select", section }, null],
  [{ label: "", name: "LicenseOrg", section }, "certificate.issuer"],
  [{ label: "", name: "LicenseDate", section }, "certificate.obtainedDate"],
  [{ label: "", name: "NcsJobSchool", inputType: "select" }, null],
  // One row per exam: the label is the exam, the name says which detail.
  [{ label: "TOEIC", name: "Ftest1Hscore", section }, "language.score"],
  [{ label: "언어 시험명 점수 등록번호 시험일 삭제", name: "Ftest1Number", section }, "language.number"],
  [{ label: "언어 시험명 점수 등록번호 시험일 삭제", name: "Ftest1Date", section }, "language.obtainedDate"],
  [{ label: "TOEIC-Speaking", name: "Ftest2Hscore", inputType: "select", section }, "language.score"],
  [{ label: "회사명", name: "NcsCareerCom" }, "career.company"],
  [{ label: "근무부서", name: "NcsCareerDep" }, "career.department"],
  [{ label: "직위", name: "NcsCareerPos" }, "career.position"],
  [{ label: "재직", name: "NcsCareerIng", inputType: "checkbox" }, null],
  [{ label: "근무기간 (시작일~종료일)", name: "NcsCareerSDate" }, "career.startDate"],
  [{ label: "근무기간 (시작일~종료일)", name: "NcsCareerEDate" }, "career.endDate"],
  [{ label: "수행기간 (시작일~종료일)", name: "CareerCntcount" }, null]
]) {
  test(`incruit ${field.name} → ${type}`, () => assert.equal(classify(field).type, type));
}

// The same page in order, through ranking and the neighbour rules the popup applies.
import { rank } from "../extension/matcher.js";
import { defaultChoice, refineRanks } from "../extension/plan.js";

const page = [
  ["* 현주소", "Zipcode2"], ["* 현주소", "Address21"], ["* 현주소", "Address22"],
  ["학교명", "HighschoolName"], ["소재지", "HighschoolLocation", "select"], ["본/분", "HighschoolCampus", "radio"],
  ["기간", "cHstartdateY", "text", { index: 0, count: 2 }], ["기간", "cHstartdateM", "text", { index: 1, count: 2 }],
  ["기간", "HighschoolStartType", "select"],
  ["기간", "cHenddateY", "text", { index: 0, count: 2 }], ["기간", "cHenddateM", "text", { index: 1, count: 2 }],
  ["학교명", "UniversityName"], ["전공", "UniversityMajor"],
  ["기간", "UstartdateY", "text", { index: 0, count: 2 }], ["기간", "UstartdateM", "text", { index: 1, count: 2 }],
  ["기간", "UenddateY", "text", { index: 0, count: 2 }], ["기간", "UenddateM", "text", { index: 1, count: 2 }],
  ["학교명", "InUniversityName"],
  ["기간", "MilitaryS"], ["기간", "MilitaryD"],
  ["New TEPS", "Ftest4Hscore"], ["", "Ftest4Number"], ["", "Ftest4Date"]
].map(([label, name, inputType = "text", part = null], index) => ({ token: `f${index}`, label, name, inputType, part, section }));
const { ranks, levels } = refineRanks(page, new Map(page.map(field => [field.token, rank(field)])));
const topOf = name => ranks.get(page.find(field => field.name === name).token)[0]?.type ?? null;

for (const [name, type] of [
  ["Zipcode2", "personal.zipCode"], ["Address21", "personal.address"], ["Address22", "personal.addressDetail"],
  ["HighschoolLocation", null], ["cHstartdateY", "education.startDate"], ["HighschoolStartType", null],
  ["cHenddateY", "education.graduationDate"], ["UstartdateY", "education.startDate"], ["UenddateY", "education.graduationDate"],
  ["MilitaryS", "military.startDate"], ["MilitaryD", "military.endDate"],
  ["Ftest4Hscore", "language.score"], ["Ftest4Number", "language.number"], ["Ftest4Date", "language.obtainedDate"]
]) {
  test(`incruit page: ${name} → ${type}`, () => assert.equal(topOf(name), type));
}

test("incruit page: every block takes the saved school of its level", () => {
  const schools = [{ key: "education.school:0", label: "예시고등학교 · 예시고등학교" }, { key: "education.school:1", label: "예시대학교 · 예시대학교" }];
  const dates = [{ key: "education.startDate:0", label: "예시고등학교 · 2014.03" }, { key: "education.startDate:1", label: "예시대학교 · 2017.03" }];
  const field = name => { const found = page.find(item => item.name === name); return { ...found, level: levels.get(found.token) }; };
  assert.equal(defaultChoice(field("HighschoolName"), "education.school", schools), "education.school:0");
  assert.equal(defaultChoice(field("UniversityName"), "education.school", schools), "education.school:1");
  assert.equal(defaultChoice(field("cHstartdateY"), "education.startDate", dates), "education.startDate:0");
  assert.equal(defaultChoice(field("UstartdateY"), "education.startDate", dates), "education.startDate:1");
  assert.equal(defaultChoice(field("InUniversityName"), "education.school", schools), "");
});
