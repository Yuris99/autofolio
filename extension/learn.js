import { FIELD_TYPES, splitName, variants } from "./matcher.js";

// Learning from the user's answers. Each answer is a field's description and the item the user
// said it takes ("none": not a profile field). A field whose words are much like an answered one
// takes that answer as one more clue when ranking, on any site.
// Examples keep the description, not the page's values, so they can be exported as training data.
export const LEARN_LIMIT = 3000;
// An exact lesson outweighs the rules' own decision and label (10 + 3 + 2).
export const LEARNED_WEIGHT = 20;
export const NONE = "none";

const MARKERS = /^[\s*※ㅇ•·-]+/;

// Words of the visible text ("l:") and of the internal name ("n:"), split and joined like the rules read them.
export function tokensOf(field) {
  const text = [field.label, field.placeholder, field.title, field.ariaLabel].filter(Boolean)
    .map(part => String(part).replace(MARKERS, "")).join(" ").toLowerCase();
  const words = text.split(/[^0-9a-z가-힣]+/).filter(word => word.length >= 2 && !/^\d+$/.test(word)).map(word => `l:${word}`);
  const leaf = splitName(String(field.name || field.id || "").split(".").pop());
  const names = variants(leaf).toLowerCase().split(/\s+/).filter(word => word.length >= 2).map(word => `n:${word}`);
  return [...new Set([...words, ...names])];
}

export function exampleOf(field, type, site, now = new Date()) {
  const pick = key => String(field[key] || "").slice(0, 120);
  return { label: pick("label"), placeholder: pick("placeholder"), title: pick("title"), name: pick("name"), section: pick("section"),
    inputType: field.inputType || "", type, site, at: now.toISOString() };
}

// A new answer for the same field of the same site replaces the old one.
export function addExamples(examples, added, limit = LEARN_LIMIT) {
  const same = (a, b) => a.site === b.site && a.name === b.name && a.label === b.label && a.section === b.section;
  const kept = examples.filter(example => !added.some(item => same(item, example)));
  return [...kept, ...added].filter(example => example.type === NONE || FIELD_TYPES.includes(example.type)).slice(-limit);
}

// The answers with their words, ready for comparing.
export function buildModel(examples) {
  return examples.map(example => ({ type: example.type, tokens: new Set(tokensOf(example)) }));
}

// Share of words two fields have in common (Jaccard): "HighschoolLocation" and "SchoolLocation"
// under "소재지" share 2 of 6, "HighschoolLocation" and "HighschoolName" only 1 of 7.
// One shared word is not enough unless the fields are the same ("License" vs "LicenseComplete").
function similarity(a, b) {
  let shared = 0;
  for (const token of a) if (b.has(token)) shared++;
  const score = shared / (a.size + b.size - shared || 1);
  return shared >= 2 || score === 1 ? score : 0;
}
export const MIN_SIMILARITY = 0.3;

// Votes from the most similar answer per item. A field taught exactly (similarity 1) gets the full
// weight and beats the rules; a field only somewhat like a taught one gets a smaller vote.
export function learnedVotes(model, field) {
  const tokens = new Set(tokensOf(field));
  if (!tokens.size) return [];
  const best = new Map();
  for (const example of model) {
    const score = similarity(tokens, example.tokens);
    if (score < MIN_SIMILARITY) continue;
    const entry = best.get(example.type) || { score: 0, count: 0 };
    entry.score = Math.max(entry.score, score);
    entry.count++;
    best.set(example.type, entry);
  }
  return [...best].map(([type, { score, count }]) => ({ type, score: LEARNED_WEIGHT * score, reasons: [`학습 ${count}건 (${Math.round(score * 100)}% 일치)`] }))
    .sort((a, b) => b.score - a.score);
}

// The rules' candidates with the learned votes added. Fields the rules exclude (statements to tick,
// another person's details) stay excluded.
export function applyLearned(list, votes) {
  if (list.excluded || !votes.length) return list;
  const merged = new Map(list.map(entry => [entry.type, { ...entry, reasons: [...entry.reasons] }]));
  for (const vote of votes) {
    const entry = merged.get(vote.type) || { type: vote.type, score: 0, reasons: [] };
    entry.score += vote.score;
    entry.reasons.push(...vote.reasons);
    merged.set(vote.type, entry);
  }
  return [...merged.values()].sort((a, b) => b.score - a.score);
}

// A learned-answers file (exported from the popup, or the bundled default) → clean examples.
// Only known items and plain strings are kept; anything else in the file is ignored.
export function readLearnedFile(data) {
  const list = Array.isArray(data?.examples) ? data.examples : Array.isArray(data) ? data : null;
  if (!list) throw new Error("학습 파일 형식이 아닙니다.");
  const text = value => String(value ?? "").slice(0, 120);
  return addExamples([], list.filter(example => example && typeof example === "object").map(example => ({
    label: text(example.label), placeholder: text(example.placeholder), title: text(example.title), name: text(example.name),
    section: text(example.section), inputType: text(example.inputType), type: text(example.type), site: text(example.site),
    at: text(example.at)
  })), Infinity);
}

// The answers bundled with the extension (learned-default.json). Empty when it cannot be read.
export async function defaultLearned() {
  try {
    const response = await fetch(chrome.runtime.getURL("learned-default.json"));
    return readLearnedFile(await response.json());
  } catch {
    return [];
  }
}

// The answers ranking uses: the bundled defaults, with the user's own answers replacing any default
// for the same field.
export function mergeLearned(defaults, own) {
  return addExamples(defaults, own, Infinity);
}
