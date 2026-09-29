// Merges learned-answers files exported from the popup into extension/learned-default.json,
// the answers every install starts with. Later files win for the same field.
//   node tools/merge-learned.mjs autofolio-학습-2026-09-29.json [more files…]
import { readFileSync, writeFileSync } from "node:fs";
import { mergeLearned, readLearnedFile } from "../extension/learn.js";

const target = new URL("../extension/learned-default.json", import.meta.url);
const current = JSON.parse(readFileSync(target, "utf8"));
let examples = readLearnedFile(current);
const before = examples.length;
for (const file of process.argv.slice(2)) examples = mergeLearned(examples, readLearnedFile(JSON.parse(readFileSync(file, "utf8"))));
writeFileSync(target, `${JSON.stringify({ ...current, examples }, null, 2)}\n`);
console.log(`기본 학습 ${before}건 → ${examples.length}건 (${target.pathname})`);
