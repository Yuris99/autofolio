import test from "node:test";
import assert from "node:assert/strict";
import "../extension/option-match.js";

const { pickOption, searchTerms } = globalThis.AutoFolioMatch;

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

test("a single result containing the name is chosen, marked as loose", () => {
  const picked = pickOption("SQLD", ["SQLD 자격검정", "SQLP"]);
  assert.equal(picked.index, 0);
  assert.equal(picked.loose, true);
  assert.equal(pickOption("한국대학교", ["서울대학교"]).reason, "일치하는 결과 없음");
});

test("several similar results are left to the user", () => {
  assert.equal(pickOption("TOEIC", ["TOEIC Speaking", "TOEIC Bridge"]).index, -1);
  assert.equal(pickOption("정보처리기사", ["정보처리기사(필기)", "정보처리기사(실기)"]).index, -1);
  // A longer name that merely starts the same is a different certificate.
  assert.equal(pickOption("정보처리기사", ["정보처리산업기사", "정보처리기능사"]).index, -1);
});

test("other names of the same certificate or exam match", () => {
  assert.equal(pickOption("토익", ["TOEIC Speaking", "TOEIC"]).index, 1);
  assert.equal(pickOption("정처기", ["정보처리산업기사", "정보처리기사"]).index, 1);
  assert.equal(pickOption("SQLD", ["SQL전문가(SQLP)", "SQL개발자(SQLD)"]).index, 1);
  assert.equal(pickOption("컴활1급", ["컴퓨터활용능력2급", "컴퓨터활용능력1급"]).index, 1);
});

test("the name in parentheses matches", () => {
  const picked = pickOption("ADsP", ["데이터분석 준전문가 (ADsP)", "데이터분석 전문가 (ADP)"]);
  assert.equal(picked.index, 0);
  assert.equal(pickOption("OCJP", ["자바 프로그래머 (OCJP)", "OCJP 기출"]).index, 0);
});

test("search terms are the saved name, then its other names as written", () => {
  assert.deepEqual(searchTerms("SQLD"), ["SQLD", "SQL개발자"]);
  assert.deepEqual(searchTerms("토익"), ["토익", "TOEIC"]);
  assert.deepEqual(searchTerms("무슨자격"), ["무슨자격"]);
});

// Result lists seen on recruiter.co.kr (diagnostic logs, 2026-09-28).
test("the plain entry wins over its noted variants", () => {
  const picked = pickOption("토익스피킹", ["Toeic Speaking test", "Toeic Speaking test(2년이상 직접등록)", "Toeic Speaking test(해외)"]);
  assert.equal(picked.index, 0);
  assert.equal(picked.loose, true);
});

test("a listed entry wins over the site's 'register this name' entry", () => {
  assert.equal(pickOption("TOPCIT 수준4", ["TOPCIT (ICT역량지수평가) 수준3", "TOPCIT (ICT역량지수평가) 수준4", "TOPCIT 수준4 (으)로 등록하기"]).index, 1);
  assert.equal(pickOption("SQLD", ["SQLD (SQL개발자) (으)로 등록하기", "SQLD (SQL개발자)"]).index, 1);
});

test("the register entry is used only when the list has no match", () => {
  const picked = pickOption("COS PRO 1급(C++)", ["COS PRO 1급(C++) (으)로 등록하기"]);
  assert.equal(picked.index, 0);
  assert.equal(picked.loose, true);
  assert.match(picked.reason, /직접 등록/);
});
