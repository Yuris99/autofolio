import test from "node:test";
import assert from "node:assert/strict";
import "../extension/value-format.js";

const { formatValue } = globalThis.AutoFolioFormat;

test("phone numbers follow the example's separators", () => {
  assert.equal(formatValue("01012345678", { text: "010-1234-5678" }), "010-1234-5678");
  assert.equal(formatValue("010-1234-5678", { text: "예) 01012345678" }), "01012345678");
  assert.equal(formatValue("010-1234-5678", { text: "010.0000.0000" }), "010.1234.5678");
  assert.equal(formatValue("0212345678", { text: "02-123-4567" }), "02-1234-5678");
});

test("phone numbers without an example drop hyphens only when the box is too short", () => {
  assert.equal(formatValue("010-1234-5678", { text: "휴대폰 번호" }), "010-1234-5678");
  assert.equal(formatValue("010-1234-5678", { maxLength: 11 }), "01012345678");
});

test("dates follow a named format or an example date", () => {
  assert.equal(formatValue("1999-03-02", { text: "YYYY.MM.DD" }), "1999.03.02");
  assert.equal(formatValue("1999-03-02", { text: "YYMMDD" }), "990302");
  assert.equal(formatValue("1999-03-02", { text: "예: 1990/01/01" }), "1999/03/02");
  assert.equal(formatValue("2024-03", { text: "2020.01" }), "2024.03");
  assert.equal(formatValue("1999-03-02", { maxLength: 8 }), "19990302");
  assert.equal(formatValue("1999-03-02", { current: "2000.01.01" }), "1999.03.02");
  assert.equal(formatValue("1999-03-02", { type: "date" }), "1999-03-02");
});

test("English names follow the example's letter case", () => {
  assert.equal(formatValue("Hong Gildong", { text: "HONG GILDONG" }), "HONG GILDONG");
  assert.equal(formatValue("HONG GIL-DONG", { text: "Hong Gildong" }), "Hong Gil-dong");
  assert.equal(formatValue("Hong Gildong", { text: "영문 이름" }), "Hong Gildong");
});

test("values unlike the example are left alone", () => {
  assert.equal(formatValue("홍길동", { text: "010-1234-5678" }), "홍길동");
  assert.equal(formatValue("abc@example.com", { text: "abc@xxx.com" }), "abc@example.com");
  assert.equal(formatValue("서울특별시 강남구", { text: "YYYY.MM.DD" }), "서울특별시 강남구");
});

const { splitValue } = globalThis.AutoFolioFormat;
const text = maxLength => ({ kind: "text", maxLength });

test("a value is split over boxes that divide it", () => {
  assert.deepEqual(splitValue("010-1234-5678", [text(3), text(4), text(4)]), ["010", "1234", "5678"]);
  assert.deepEqual(splitValue("01012345678", [{ kind: "select" }, text(4), text(4)]), ["010", "1234", "5678"]);
  assert.deepEqual(splitValue("0212345678", [text(3), text(4), text(4)]), ["02", "1234", "5678"]);
  assert.deepEqual(splitValue("010-1234-5678", [text(3), text(8)]), ["010", "12345678"]);
  assert.deepEqual(splitValue("me@example.com", [text(-1), text(-1)]), ["me", "example.com"]);
  assert.deepEqual(splitValue("me@example.com", [text(-1), text(-1), { kind: "select" }]), ["me", "example.com", "example.com"]);
  assert.deepEqual(splitValue("1999-03-02", [{ kind: "select" }, { kind: "select" }, { kind: "select" }]), ["1999", "03", "02"]);
  assert.deepEqual(splitValue("2024.03", [text(4), text(2)]), ["2024", "03"]);
  assert.deepEqual(splitValue("123456", [text(3), text(3)]), ["123", "456"]);
});

test("a value that does not divide cleanly is not split", () => {
  assert.equal(splitValue("서울특별시 강남구 테헤란로", [text(-1), text(-1)]), null);
  assert.equal(splitValue("me@example.com", [text(-1), text(-1), text(-1), text(-1)]), null);
});
