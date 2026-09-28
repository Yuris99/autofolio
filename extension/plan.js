import { PROFILE_SCHEMA } from "./matcher.js";

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

// Which saved value a field starts with. In a repeating row, row N takes entry N (and nothing
// if there is no entry N). Elsewhere a single candidate is used, or the entry picked last time.
export function defaultChoice(field, type, candidates, lastEntries = {}) {
  if (!type) return "";
  const group = type.split(".")[0];
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
