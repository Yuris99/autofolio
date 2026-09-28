import test from "node:test";
import assert from "node:assert/strict";
import { classify } from "../extension/matcher.js";

// Fields from a real scan of a recruiter.co.kr application form (resume page, 2026-09-28),
// with labels as the fixed scanner now reads them. No applicant data.
const expected = [
  [{ label: "영문이름", section: "영문이름", name: "englishName" }, "personal.englishName"],
  [{ label: "한문이름", section: "영문이름", name: "chineseName" }, "personal.chineseName"],
  [{ label: "성별", section: "성별", name: "genderFlag", inputType: "radio" }, "personal.gender"],
  [{ label: "생년월일", section: "성별", name: "birthday" }, "personal.birthDate"],
  [{ label: "", section: "국적", name: "nationality", inputType: "select" }, "personal.nationality"],
  [{ label: "", section: "현주소", name: "currentAddress.zipCode" }, "personal.zipCode"],
  [{ label: "", section: "현주소", name: "currentAddress.address" }, "personal.address"],
  [{ label: "", section: "현주소", name: "currentAddress.detailAddress" }, "personal.addressDetail"],
  [{ label: "병역구분", section: "병역구분", name: "military.militaryTypeCode", inputType: "radio" }, "military.status"],
  [{ label: "", section: "계급", name: "military.militaryPositionCode", inputType: "select" }, "military.rank"],
  [{ label: "", section: "계급", name: "military.militaryStartDate" }, "military.startDate"],
  [{ label: "", section: "계급", name: "military.militaryEndDate" }, "military.endDate"],
  [{ label: "", section: "제대구분", name: "military.militaryDischargeCode", inputType: "select" }, "military.discharge"],
  // Another person's field and per-application answers are never filled from the profile.
  [{ label: "성명", section: "성명", name: "recommender.name" }, null],
  [{ label: "", section: "지원분야", name: "applySector[0].depth1", inputType: "select" }, null],
  [{ label: "희망연봉", section: "희망연봉", name: "hopeSalary" }, null],
  [{ label: "직전연봉", section: "희망연봉", name: "latestSalary" }, null],
  [{ label: "입사가능일자", section: "입사가능일자", name: "joinPossibleDate" }, null],
  [{ label: "", section: "지원경로", name: "applyChannel.applyChannelCodeSn", inputType: "select" }, null],
  [{ label: "", section: "지원서 사진등록", name: "pictureFile" }, null]
];

for (const [field, type] of expected) {
  test(`recruiter.co.kr ${field.label || field.name} → ${type}`, () => {
    assert.equal(classify(field).type, type);
  });
}
