import { allValues, classify, describeType, FIELD_TYPES, PROFILE_SCHEMA } from "./matcher.js";
import { addFill, createRun, saveRun, summarize } from "./run-log.js";
import { defaultChoice, fieldId, followUpItems, rowsToAdd } from "./plan.js";

const fieldsRoot = document.getElementById("fields");
const status = document.getElementById("status");
const report = document.getElementById("report");
const fillButton = document.getElementById("fill");
const stepButton = document.getElementById("step");
const undoButton = document.getElementById("undo");
const layaToggle = document.getElementById("useLaya");
let tabId;
let fields = [];
let choices = [];
let pageUrl = "";
let currentRun = null;
// Which entry of each group was filled last ({ certificate: 1 }), so fields that open up after a
// pick (issuer, date) default to the same certificate. Kept for the browser session only.
let lastEntries = {};
const sessionStore = chrome.storage.session || chrome.storage.local;
const logSummary = document.getElementById("logSummary");

async function recordRun(run) {
  const { runLog = [] } = await chrome.storage.local.get("runLog");
  const updated = saveRun(runLog, run);
  await chrome.storage.local.set({ runLog: updated });
  showLogSummary(updated);
}

function showLogSummary(runLog) {
  const { runs, filled, review, failed } = summarize(runLog);
  logSummary.textContent = runs ? `진단 기록 ${runs}회 · 입력 ${filled} · 확인 필요 ${review} · 실패 ${failed}` : "진단 기록 없음";
}

function fieldKey(field) {
  return [new URL(pageUrl).origin, field.section, field.label, field.name, field.inputType]
    .map(part => String(part || "").trim().toLowerCase()).join("|");
}

function setStatus(message) { status.textContent = message; }

async function send(action, payload = {}) {
  return chrome.tabs.sendMessage(tabId, { action, ...payload });
}

function valueSelect(values, selected) {
  const select = document.createElement("select");
  const empty = document.createElement("option");
  empty.value = "";
  empty.textContent = "채우지 않음 / 직접 선택";
  select.append(empty);
  for (const item of values) {
    const option = document.createElement("option");
    option.value = item.key;
    const text = `${describeType(item.type)} — ${item.label}`;
    option.textContent = text.length > 80 ? `${text.slice(0, 79)}…` : text;
    select.append(option);
  }
  select.value = selected || "";
  return select;
}

async function layaClassify(field) {
  const criteria = Object.fromEntries(FIELD_TYPES.map(type => [type, `지원자 ${describeType(type)}`]));
  criteria.unknown = "어느 이력 항목인지 알 수 없음";
  const response = await fetch("http://127.0.0.1:8000/v1/systemone", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      state: { section: field.section, label: field.label, placeholder: field.placeholder, name: field.name, inputType: field.inputType },
      questions: { field: { type: "choice", instructions: "이 채용 지원서 입력칸에 해당하는 이력 항목은?", criteria } }
    })
  });
  if (!response.ok) throw new Error(`Laya 응답 ${response.status}`);
  const data = await response.json();
  const type = data.answers?.field?.choice;
  return FIELD_TYPES.includes(type) ? type : null;
}

function render(values, suggestions) {
  fieldsRoot.replaceChildren();
  choices = [];
  for (const field of fields) {
    // Boxes after the first of a split value (010 | 1234 | 5678) are filled with the first.
    if (field.part?.index > 0) continue;
    const wrapper = document.createElement("div");
    wrapper.className = "field";
    const label = document.createElement("label");
    label.textContent = field.label || field.ariaLabel || field.placeholder || field.name || "설명 없는 입력칸";
    if (field.loop?.rows > 1) label.textContent += ` (${field.loop.index + 1}번째)`;
    if (field.part) label.textContent += ` (칸 ${field.part.count}개로 나뉨)`;
    const note = document.createElement("small");
    const suggestion = suggestions.get(field.token);
    note.textContent = [field.section, field.inputType, suggestion?.reason].filter(Boolean).join(" · ");
    const candidates = values.filter(item => item.type === suggestion?.type);
    const chosen = defaultChoice(field, suggestion?.type, candidates, lastEntries);
    const select = valueSelect(values, chosen);
    wrapper.append(label, note, select);
    fieldsRoot.append(wrapper);
    choices.push({ token: field.token, select, wrapper });
  }
  fillButton.disabled = stepButton.disabled = !fields.length || !values.length;
}

// Scan the page and suggest a profile item per field: a mapping confirmed on this site before, else the rules.
async function analysePage(siteMappings) {
  const scanResult = await send("scan");
  fields = scanResult.fields;
  pageUrl = scanResult.url;
  return new Map(fields.map(field => [field.token,
    FIELD_TYPES.includes(siteMappings[fieldKey(field)])
      ? { type: siteMappings[fieldKey(field)], reason: "이전에 확인한 매핑" }
      : classify(field)
  ]));
}

function reportRows(entries) {
  for (const { label, result } of entries) {
    const row = document.createElement("p");
    row.textContent = `${result.status === "filled" ? "✓" : result.status === "review" ? "?" : "!"} ${label}: ${result.detail}`;
    report.append(row);
  }
}

document.getElementById("profile").addEventListener("click", () => chrome.runtime.openOptionsPage());
layaToggle.addEventListener("change", () => chrome.storage.local.set({ useLaya: layaToggle.checked }));

document.getElementById("scan").addEventListener("click", async () => {
  report.replaceChildren();
  fieldsRoot.replaceChildren();
  fillButton.disabled = true;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !/^https?:\/\//.test(tab.url || "")) throw new Error("지원서 웹 페이지에서 실행하세요.");
    tabId = tab.id;
    // The bridge presses Enter in search boxes from the page's own world; see page-bridge.js.
    await chrome.scripting.executeScript({ target: { tabId }, files: ["page-bridge.js"], world: "MAIN" }).catch(() => {});
    await chrome.scripting.executeScript({ target: { tabId }, files: ["option-match.js", "value-format.js", "content.js"] });
    ({ lastEntries = {} } = await sessionStore.get("lastEntries"));
    const { profile = {}, siteMappings = {} } = await chrome.storage.local.get(["profile", "siteMappings"]);
    const values = allValues(profile);
    const analyse = () => analysePage(siteMappings);
    let suggestions = await analyse();
    // One row per saved entry: press the page's "+" where a repeating block has fewer rows.
    const addedRows = [];
    for (const plan of rowsToAdd(fields, field => suggestions.get(field.token)?.type, profile)) {
      const { added } = await send("addRows", { key: plan.key, times: plan.times });
      if (added) addedRows.push(`${PROFILE_SCHEMA.find(group => group.group === plan.group).label} ${added}줄`);
    }
    if (addedRows.length) suggestions = await analyse();
    let modelCount = 0;
    let layaError = "";
    if (layaToggle.checked) {
      setStatus(`입력칸 ${fields.length}개를 찾았습니다. 로컬 Laya가 모르는 칸을 분석 중입니다.`);
      try {
        for (const field of fields.filter(field => !suggestions.get(field.token).type)) {
          const type = await layaClassify(field);
          if (type) { suggestions.set(field.token, { type, reason: "Laya 제안 · 확인 필요" }); modelCount++; }
        }
      } catch (error) {
        layaError = `Laya 연결 실패: ${error.message}`;
      }
    }
    render(values, suggestions);
    currentRun = createRun(pageUrl, fields, suggestions);
    currentRun.version = chrome.runtime.getManifest().version;
    if (layaError) currentRun.notes.push(layaError);
    await recordRun(currentRun);
    if (layaError) { setStatus(`${layaError}. 규칙 결과를 표시합니다.`); return; }
    const rowsNote = addedRows.length ? ` · + 버튼으로 ${addedRows.join(", ")} 추가` : "";
    setStatus(`입력칸 ${fields.length}개 · 저장된 값 ${values.length}개 · Laya 제안 ${modelCount}개${rowsNote}. 아래 매핑을 확인하세요.`);
  } catch (error) { setStatus(error.message); }
});

async function chosenItems() {
  const { profile = {} } = await chrome.storage.local.get("profile");
  const values = new Map(allValues(profile).map(item => [item.key, item.value]));
  const labelOf = token => { const field = fields.find(field => field.token === token); return field?.label || field?.name || "입력칸"; };
  return { profile, items: choices.filter(choice => choice.select.value && values.has(choice.select.value))
    .map(choice => ({ token: choice.token, value: values.get(choice.select.value), label: labelOf(choice.token) })) };
}

// Like an editor's "replace one by one": the page bar and this panel walk through the chosen
// fields together, and the list below scrolls to the current one.
const stepPanel = document.getElementById("stepPanel");
function showStep(step) {
  for (const choice of choices) {
    choice.wrapper.classList.toggle("current", !step.closed && choice.token === step.token);
    const state = step.done?.[choice.token];
    let mark = choice.wrapper.querySelector(".step-mark");
    if (!state) { mark?.remove(); continue; }
    if (!mark) {
      mark = document.createElement("span");
      mark.className = "step-mark";
      choice.wrapper.prepend(mark);
    }
    mark.textContent = state === "filled" ? "✓" : "?";
    mark.style.color = state === "filled" ? "#1d6b43" : "#b45309";
  }
  stepPanel.hidden = Boolean(step.closed);
  if (step.closed) return;
  document.getElementById("stepText").textContent = step.finished
    ? `끝 · 채움 ${Object.values(step.done).filter(state => state === "filled").length}개`
    : `${step.cursor + 1} / ${step.total} · ${step.label} → ${step.preview}`;
  document.getElementById("stepNote").textContent = step.note;
  for (const button of stepPanel.querySelectorAll("button")) {
    const name = button.dataset.step;
    button.disabled = step.busy || (["fill", "all", "next"].includes(name) && step.finished) ||
      (name === "prev" && step.cursor === 0) || (name === "undo" && !step.undoable);
  }
  choices.find(choice => choice.token === step.token)?.wrapper.scrollIntoView({ block: "center", behavior: "smooth" });
}

stepButton.addEventListener("click", async () => {
  const { items } = await chosenItems();
  if (!items.length) { setStatus("채울 항목을 먼저 선택하세요."); return; }
  showStep(await send("step", { items }));
  undoButton.disabled = false;
  setStatus(`${items.length}칸을 하나씩 채웁니다. 위 버튼이나 지원서 페이지 오른쪽 아래 바를 쓰세요. 페이지를 누르면 이 창은 닫히지만 바는 남습니다.`);
});

stepPanel.addEventListener("click", async event => {
  const name = event.target.closest("button")?.dataset.step;
  if (!name) return;
  // A search pick can take seconds; show it as busy until the page answers.
  for (const button of stepPanel.querySelectorAll("button")) button.disabled = true;
  try { showStep(await send("stepAct", { name })); } catch (error) { setStatus(`하나씩 채우기 실패: ${error.message}`); }
});

// Clicks on the page bar also move this list, while the popup is open.
chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.event === "stepState" && sender.tab?.id === tabId) showStep(message.step);
});

undoButton.addEventListener("click", async () => {
  try {
    const { undone, left } = await send("undo");
    setStatus(undone ? `되돌림: ${undone.label} (${undone.changed}곳)${left ? ` · 더 되돌릴 입력 ${left}건` : ""}` : "되돌릴 입력이 없습니다.");
    undoButton.disabled = !left;
  } catch (error) { setStatus(`되돌리기 실패: ${error.message}`); }
});

fillButton.addEventListener("click", async () => {
  const { profile, items } = await chosenItems();
  if (!items.length) { setStatus("채울 항목을 먼저 선택하세요."); return; }
  fillButton.disabled = true;
  try {
    const { siteMappings = {} } = await chrome.storage.local.get("siteMappings");
    for (const choice of choices) {
      const selected = choice.select.value;
      if (!selected) continue;
      const field = fields.find(field => field.token === choice.token);
      if (field) siteMappings[fieldKey(field)] = selected.slice(0, selected.lastIndexOf(":"));
    }
    await chrome.storage.local.set({ siteMappings });
    const labelOf = token => { const field = fields.find(field => field.token === token); return field?.label || field?.name || token; };
    let { results, invalidFields = [], newFields = 0 } = await send("fill", { items });
    undoButton.disabled = false;
    const entries = results.map(result => ({ label: labelOf(result.token), result }));
    if (currentRun) {
      const chosen = new Map(choices.filter(choice => choice.select.value)
        .map(choice => [choice.token, choice.select.value.slice(0, choice.select.value.lastIndexOf(":"))]));
      await recordRun(addFill(currentRun, chosen, results, invalidFields));
    }
    for (const choice of choices) {
      const [type, index] = choice.select.value.split(":");
      if (type && index !== undefined) lastEntries[type.split(".")[0]] = Number(index);
    }
    await sessionStore.set({ lastEntries });

    // Picks can open more fields (issuer, date, score). Fill those now instead of asking for a
    // re-analysis: at most two more rounds, only fields with a clear default value.
    const valueList = allValues(profile);
    let followed = 0;
    for (let round = 0; round < 2 && newFields > 0; round++) {
      const seen = new Set(fields.map(fieldId));
      const suggestions = await analysePage(siteMappings);
      const more = followUpItems(seen, fields, field => suggestions.get(field.token)?.type, valueList, lastEntries);
      render(valueList, suggestions);
      if (!more.length) break;
      const next = await send("fill", { items: more.map(({ token, value }) => ({ token, value })) });
      entries.push(...next.results.map(result => ({ label: `${labelOf(result.token)} (이어서)`, result })));
      results = [...results, ...next.results];
      invalidFields = next.invalidFields || [];
      newFields = next.newFields || 0;
      followed += next.results.filter(result => result.status === "filled").length;
      currentRun = createRun(pageUrl, fields, suggestions);
      currentRun.version = chrome.runtime.getManifest().version;
      currentRun.notes.push(`자동 이어서 입력 ${round + 1}회차`);
      await recordRun(addFill(currentRun, new Map(more.map(item => [item.token, item.type])), next.results, invalidFields));
    }

    report.replaceChildren();
    reportRows(entries);
    if (invalidFields.length) {
      const row = document.createElement("p");
      row.textContent = `미완료/검증 오류: ${invalidFields.join(", ")}`;
      report.append(row);
    }
    const reviewCount = results.filter(result => result.status === "review").length;
    const filledCount = results.filter(result => result.status === "filled").length;
    const followNote = followed ? ` (새로 열린 칸 ${followed}개 포함)` : "";
    const opened = newFields ? ` · 아직 새로 열린 칸 ${newFields}개: 다시 분석하세요` : "";
    setStatus(`${filledCount}/${results.length}개 입력 확인${followNote}${reviewCount ? ` · ${reviewCount}개 직접 선택 필요(?)` : ""}${opened}. 내용을 확인한 뒤 직접 제출하세요.`);
  } catch (error) {
    setStatus(`입력 실패: ${error.message}`);
    if (currentRun) { currentRun.notes.push(`입력 실패: ${error.message}`); await recordRun(currentRun); }
  }
  fillButton.disabled = false;
});

document.getElementById("exportLog").addEventListener("click", async () => {
  const { runLog = [] } = await chrome.storage.local.get("runLog");
  const data = { app: "autofolio", kind: "diagnostic-log", version: 1, exportedAt: new Date().toISOString(), runs: runLog };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `autofolio-진단기록-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

document.getElementById("clearLog").addEventListener("click", async () => {
  if (!confirm("진단 기록을 모두 지울까요?")) return;
  await chrome.storage.local.set({ runLog: [] });
  showLogSummary([]);
});

const { useLaya = false, runLog = [] } = await chrome.storage.local.get(["useLaya", "runLog"]);
layaToggle.checked = useLaya;
showLogSummary(runLog);
document.getElementById("version").textContent = `v${chrome.runtime.getManifest().version}`;
