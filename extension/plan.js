import { DATED_GROUPS, matchGroup, onlyTitle, PROFILE_SCHEMA, splitName, variants } from "./matcher.js";

// Decisions the popup makes between analysing and filling, kept free of DOM so tests can use them.
const LIST_GROUPS = new Set(PROFILE_SCHEMA.filter(group => !group.single).map(group => group.group));
export const MAX_ROWS = 10;

// Repeating rows to add so every saved entry gets one: profile has 3 certificates, page shows
// 1 row with a "+" → add 2. A loop is used only when its fields point at a single list group.
export function rowsToAdd(fields, typeOf, profile) {
  const loops = new Map();
  for (const field of fields) {
    if (!field.loop) continue;
    const loop = loops.get(field.loop.key) || { key: field.loop.key, rows: field.loop.rows, canAdd: field.loop.canAdd, groups: new Set() };
    const group = typeOf(field)?.split(".")[0];
    if (LIST_GROUPS.has(group)) loop.groups.add(group);
    loops.set(field.loop.key, loop);
  }
  return [...loops.values()]
    .filter(loop => loop.canAdd && loop.groups.size === 1)
    .map(loop => {
      const group = [...loop.groups][0];
      const wanted = Math.min((profile[group] || []).length, MAX_ROWS);
      return { key: loop.key, group, times: wanted - loop.rows };
    })
    .filter(plan => plan.times > 0);
}

// School level a field asks for, from its own words: blocks for 고등학교, 대학교, 석사 … share
// their labels ("학교명", "기간") and differ only in internal names (HighschoolName, MgraduateName).
export function levelOf(text) {
  const value = String(text || "");
  if (/inuniversity|편입/i.test(value)) return "transfer";
  if (/mgraduate|석사|master/i.test(value)) return "master";
  if (/dgraduate|박사|doctor|ph\.?d/i.test(value)) return "doctor";
  if (/graduate|대학원/i.test(value)) return "graduate";
  if (/high.?school|고등학교|고교/i.test(value)) return "high";
  if (/college|전문대/i.test(value)) return "college";
  if (/university|대학교|학사/i.test(value)) return "university";
  return null;
}

// Levels a saved school fits, from its name: "OO대학교 대학원" is graduate, "OO대학" either kind.
function schoolLevels(name) {
  const value = String(name || "");
  if (/대학원|graduate/i.test(value)) return ["master", "doctor", "graduate"];
  if (/고등학교|고교|high.?school/i.test(value)) return ["high"];
  if (/전문대|college/i.test(value)) return ["college"];
  if (/대학교|university/i.test(value)) return ["university"];
  if (/대학$/.test(value.trim())) return ["college", "university"];
  return [];
}

// Which saved value a field starts with. In a repeating row, row N takes entry N (and nothing
// if there is no entry N). Elsewhere a single candidate is used, or the entry picked last time.
// Education fields only take a school of their level (field.level, else their own words).
export function defaultChoice(field, type, candidates, lastEntries = {}) {
  if (!type) return "";
  const group = type.split(".")[0];
  if (group === "education") {
    const level = field.level ?? levelOf([field.name, field.label, field.section].join(" "));
    if (level === "transfer") return "";
    if (level) candidates = candidates.filter(item => schoolLevels(String(item.label).split(" · ")[0]).includes(level));
  }
  if (field.loop && LIST_GROUPS.has(group)) return candidates.find(item => item.key === `${type}:${field.loop.index}`)?.key || "";
  if (candidates.length === 1) return candidates[0].key;
  return candidates.find(item => item.key === `${type}:${lastEntries[group]}`)?.key || "";
}

// Identity of a field across scans (tokens are renumbered on every scan).
export function fieldId(field) {
  return [field.name, field.label, field.section, field.inputType, field.loop ? `${field.loop.key}#${field.loop.index}` : ""].join("|");
}

// After a fill, picks can open more fields (a certificate's issuer and date, an exam's score).
// Returns what to fill in those fields right away: only fields not seen before, and only when a
// saved value is the clear default for them (the same rule the popup uses to preselect).
export function followUpItems(seenIds, fields, typeOf, values, lastEntries = {}) {
  return fields.filter(field => !seenIds.has(fieldId(field))).flatMap(field => {
    const type = typeOf(field);
    const key = defaultChoice(field, type, values.filter(item => item.type === type), lastEntries);
    const value = values.find(item => item.key === key)?.value;
    return value ? [{ token: field.token, value, field, type, key }] : [];
  });
}

const endType = group => (group === "education" ? "education.graduationDate" : `${group}.endDate`);
const textLike = field => ["text", "date", "month", "tel", "number", "", undefined].includes(field.inputType);
function sharedStart(a, b) {
  let length = 0;
  while (length < a.length && a[length] === b[length]) length++;
  return length;
}

// Candidates that come from a field's neighbours, on top of each field's own clues (matcher.rank).
// ranks: Map token → [{ type, score, reasons }], best first. Returns new ranks and each education
// field's school level (its own words, else the block it sits in).
//  - A field named like the one before it (Ftest11Hscore → Ftest11Number) is in the same group.
//  - An unlabelled period box (cHstartdateY, "기간") belongs to the dated group just above it.
//  - Two boxes under one label with the same start date (복무기간 시작 | 종료) are start and end;
//    two address boxes under one label are the address and its detail.
export function refineRanks(fields, ranks) {
  const out = new Map([...ranks].map(([token, list]) =>
    [token, Object.assign(list.map(entry => ({ ...entry, reasons: [...entry.reasons] })), { excluded: list.excluded })]));
  // Year and month boxes of one date (cHstartdateY | cHstartdateM) are not a start and an end.
  const dateStem = field => String(field.name || "").replace(/(?:[_-]?(?:[Yy]ear|[Mm]onth|[Dd]ay)|[_-]?[YMD])$/, "");
  const shown = fields.filter(field => !(field.part?.index > 0));
  const top = field => out.get(field.token)?.[0];
  const add = (field, type, score, reason) => {
    const list = out.get(field.token) || [];
    const entry = list.find(item => item.type === type);
    if (entry) { entry.score = Math.max(entry.score, score); entry.reasons.push(reason); }
    else list.push({ type, score, reasons: [reason] });
    list.sort((a, b) => b.score - a.score);
    out.set(field.token, list);
  };
  shown.forEach((field, index) => {
    if (top(field) || out.get(field.token)?.excluded) return;
    const leaf = splitName(String(field.name || "").split(".").pop());
    for (const previous of shown.slice(Math.max(0, index - 3), index).reverse()) {
      if (!top(previous) || !field.name || !previous.name || sharedStart(field.name, previous.name) < 5) continue;
      const type = matchGroup(top(previous).type.split(".")[0], variants(leaf));
      if (type && onlyTitle(type, leaf)) { add(field, type, 5, "이웃 칸"); return; }
    }
    if (!textLike(field) || !/기간|period/i.test(field.label || "") && !/start|end|date/i.test(leaf)) return;
    for (const previous of shown.slice(Math.max(0, index - 8), index).reverse()) {
      const group = top(previous)?.type.split(".")[0];
      if (!DATED_GROUPS.includes(group)) continue;
      add(field, /end|종료|졸업|e ?date/i.test(leaf) ? endType(group) : `${group}.startDate`, 5, "기간 칸");
      return;
    }
  });
  shown.forEach((field, index) => {
    const before = shown[index - 1];
    const type = top(field)?.type;
    if (!before || !type || type !== top(before)?.type || !field.label || field.label !== before.label) return;
    if (field.name && dateStem(field) !== field.name && dateStem(field) === dateStem(before)) return;
    if (type.endsWith(".startDate")) add(field, endType(type.split(".")[0]), top(field).score + 1, "기간의 두 번째 칸");
    if (type === "personal.address") add(field, "personal.addressDetail", top(field).score + 1, "주소의 두 번째 칸");
  });
  const levels = new Map();
  let block = null;
  let since = 0;
  shown.forEach(field => {
    const own = levelOf([field.name, field.label, field.section].join(" "));
    since++;
    if (own) { block = own; since = 0; }
    if (since > 10) block = null;
    if (top(field)?.type.startsWith("education.")) levels.set(field.token, own || block);
  });
  return { ranks: out, levels };
}

// Rules' ranking mixed with Laya's probabilities (type → 0..1): each side is a share of 1, and
// `weight` is how much Laya counts. Without probabilities the rules' order stays as it is.
export function combineRanks(list, probabilities, weight = 0.5) {
  if (!probabilities) return list;
  const total = list.reduce((sum, entry) => sum + entry.score, 0) || 1;
  const merged = new Map(list.map(entry => [entry.type, { ...entry, score: (1 - weight) * entry.score / total }]));
  for (const [type, probability] of Object.entries(probabilities)) {
    if (type === "unknown" || probability < 0.05) continue;
    const entry = merged.get(type) || { type, score: 0, reasons: [] };
    entry.score += weight * probability;
    entry.reasons = [...entry.reasons, `Laya ${Math.round(probability * 100)}%`];
    merged.set(type, entry);
  }
  return [...merged.values()].sort((a, b) => b.score - a.score);
}
