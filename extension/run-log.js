// Diagnostic record of each analyze/fill run, for checking AutoFolio against real sites.
// It holds page structure and outcomes only: never the saved profile values.
export const RUN_LIMIT = 20;

// Query strings and fragments can carry session tokens or applicant ids.
export function pageOf(url) {
  try {
    const { origin, pathname } = new URL(url);
    return origin + pathname;
  } catch {
    return "";
  }
}

export function createRun(url, fields, suggestions, now = new Date()) {
  return {
    id: `${now.getTime()}-${Math.random().toString(36).slice(2, 7)}`,
    at: now.toISOString(),
    page: pageOf(url),
    fields: fields.map(field => {
      const suggestion = suggestions.get(field.token) || {};
      return {
        token: field.token, label: field.label || field.ariaLabel || field.placeholder || "", section: field.section,
        name: field.name, inputType: field.inputType, required: field.required,
        optionCount: field.options?.length || 0, suggested: suggestion.type || null, reason: suggestion.reason || "",
        loop: field.loop || null
      };
    }),
    notes: [],
    fills: []
  };
}

// chosen: token -> field type the user confirmed. results come from content.js.
export function addFill(run, chosen, results, invalidFields, now = new Date()) {
  const byToken = new Map(run.fields.map(field => [field.token, field]));
  const counts = { filled: 0, review: 0, failed: 0, skipped: 0 };
  for (const result of results) counts[result.status] = (counts[result.status] || 0) + 1;
  run.fills.push({
    at: now.toISOString(),
    counts,
    results: results.map(result => {
      const field = byToken.get(result.token) || {};
      const type = chosen.get(result.token) || null;
      return {
        token: result.token, label: field.label || "", section: field.section || "", inputType: field.inputType || "",
        suggested: field.suggested ?? null, chosen: type, corrected: Boolean(type && field.suggested !== type),
        status: result.status, detail: result.detail
      };
    }),
    invalidFields
  });
  return run;
}

export function saveRun(log, run, limit = RUN_LIMIT) {
  return [...log.filter(item => item.id !== run.id), run].slice(-limit);
}

export function summarize(log) {
  const fills = log.flatMap(run => run.fills);
  const total = key => fills.reduce((sum, fill) => sum + (fill.counts[key] || 0), 0);
  return { runs: log.length, filled: total("filled"), review: total("review"), failed: total("failed"), skipped: total("skipped") };
}
