import test from "node:test";
import assert from "node:assert/strict";
import "../extension/option-match.js";

const { pickOption } = globalThis.AutoFolioMatch;

test("exact result is chosen regardless of spacing", () => {
  assert.equal(pickOption("숭실대학교", ["숭실사이버대학교", "숭실 대학교"]).index, 1);
});

test("a single result that differs only by a note is chosen", () => {
  const picked = pickOption("정보처리기사", ["정보처리산업기사", "정보처리기사(국가기술)"]);
  assert.equal(picked.index, 1);
});

test("several campuses are left to the user", () => {
  const picked = pickOption("연세대학교", ["연세대학교(신촌)", "연세대학교(미래)"]);
  assert.equal(picked.index, -1);
  assert.deepEqual(picked.candidates, ["연세대학교(신촌)", "연세대학교(미래)"]);
});

test("partial matches are suggested, never chosen", () => {
  const picked = pickOption("SQLD", ["SQLD 자격검정", "SQLP"]);
  assert.equal(picked.index, -1);
  assert.deepEqual(picked.candidates, ["SQLD 자격검정"]);
  assert.equal(pickOption("한국대학교", ["서울대학교"]).reason, "일치하는 결과 없음");
});
