import test from "node:test";
import assert from "node:assert/strict";
import { rank } from "../extension/matcher.js";
import { addExamples, applyLearned, buildModel, exampleOf, learnedVotes, NONE, tokensOf } from "../extension/learn.js";

test("a field is read as label words and name words, split and joined", () => {
  assert.deepEqual(tokensOf({ label: "* 근무기간 (시작일~종료일)", name: "NcsCareerEDate" }).sort(),
    ["l:근무기간", "l:시작일", "l:종료일", "n:career", "n:careeredate", "n:edate", "n:ncs", "n:ncscareer"].sort());
});

test("an answer given on one site corrects the same kind of field on another", () => {
  // Taught on site A: the region list is not a profile field, the department list is the major.
  const examples = addExamples([], [
    exampleOf({ label: "소재지", name: "HighschoolLocation", inputType: "select" }, NONE, "a"),
    exampleOf({ label: "학과", name: "UniversityDepart", inputType: "select" }, "education.major", "a")
  ]);
  const model = buildModel(examples);
  const top = field => applyLearned(rank(field), learnedVotes(model, field))[0]?.type ?? null;
  // Site B words it a little differently.
  assert.equal(top({ label: "소재지", name: "SchoolLocation", inputType: "select" }), NONE);
  assert.equal(top({ label: "학과", name: "CollegeDepart", inputType: "select" }), "education.major");
  // Sharing one word is not enough: the school's name box is still the school.
  assert.equal(top({ label: "학교명", name: "HighschoolName" }), "education.school");
  // Nothing learned about it: the rules decide as before.
  assert.equal(top({ label: "휴대폰", name: "mobile" }), "personal.phone");
});

test("a clear lesson beats the rules' own decision", () => {
  const field = { label: "전공", name: "MgraduateGrade", inputType: "select" };
  assert.equal(rank(field)[0].type, "education.major");
  const model = buildModel([exampleOf(field, NONE, "a")]);
  assert.equal(applyLearned(rank(field), learnedVotes(model, field))[0].type, NONE);
});

test("statements to tick stay excluded whatever was learned", () => {
  const field = { label: "본인은 병역의무를 필한자임을 확인함", name: "subcheck_box2", inputType: "checkbox" };
  const model = buildModel([exampleOf(field, "military.status", "a")]);
  const ranked = applyLearned(rank(field), learnedVotes(model, field));
  assert.equal(ranked.length, 0);
  assert.ok(ranked.excluded);
});

test("a new answer for the same field replaces the old one; unknown items are dropped", () => {
  const field = { label: "소재지", name: "Loc", section: "학력" };
  let examples = addExamples([], [exampleOf(field, "education.school", "a")]);
  examples = addExamples(examples, [exampleOf(field, NONE, "a"), exampleOf(field, "not.an.item", "b")]);
  assert.deepEqual(examples.map(example => example.type), [NONE]);
  assert.equal(addExamples(examples, [exampleOf({ label: "x", name: "y" }, NONE, "c")], 1).length, 1);
});

import { readFileSync } from "node:fs";
import { mergeLearned, readLearnedFile } from "../extension/learn.js";

test("learned files are read cleanly and the user's answer beats the bundled one", () => {
  assert.throws(() => readLearnedFile({ nothing: true }), /학습 파일/);
  const read = readLearnedFile({ examples: [{ label: "전공", name: "MgraduateGrade", type: "none", extra: "x" }, { name: "x", type: "bad.type" }, null] });
  assert.deepEqual(read.map(example => [example.name, example.type, "extra" in example]), [["MgraduateGrade", "none", false]]);
  const bundled = readLearnedFile(JSON.parse(readFileSync(new URL("../extension/learned-default.json", import.meta.url), "utf8")));
  assert.ok(bundled.length >= 2);
  const own = [{ ...bundled[0], type: "education.major" }];
  const merged = mergeLearned(bundled, own);
  assert.equal(merged.length, bundled.length);
  assert.equal(merged.find(example => example.name === bundled[0].name).type, "education.major");
});
