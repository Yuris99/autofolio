import { allValues, classify, describeType, FIELD_TYPES } from "./matcher.js";
import { addFill, createRun, saveRun, summarize } from "./run-log.js";

const fieldsRoot = document.getElementById("fields");
const status = document.getElementById("status");
const report = document.getElementById("report");
const fillButton = document.getElementById("fill");
const layaToggle = document.getElementById("useLaya");
let tabId;
let fields = [];
let choices = [];
let pageUrl = "";
let currentRun = null;
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
    const wrapper = document.createElement("div");
    wrapper.className = "field";
    const label = document.createElement("label");
    label.textContent = field.label || field.ariaLabel || field.placeholder || field.name || "설명 없는 입력칸";
    const note = document.createElement("small");
    const suggestion = suggestions.get(field.token);
    note.textContent = [field.section, field.inputType, suggestion?.reason].filter(Boolean).join(" · ");
    const candidates = values.filter(item => item.type === suggestion?.type);
    const chosen = candidates.length === 1 ? candidates[0].key : "";
    const select = valueSelect(values, chosen);
    wrapper.append(label, note, select);
    fieldsRoot.append(wrapper);
    choices.push({ token: field.token, select });
  }
  fillButton.disabled = !fields.length || !values.length;
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
    await chrome.scripting.executeScript({ target: { tabId }, files: ["option-match.js", "content.js"] });
    const scanResult = await send("scan");
    fields = scanResult.fields;
    pageUrl = scanResult.url;
    const { profile = {}, siteMappings = {} } = await chrome.storage.local.get(["profile", "siteMappings"]);
    const values = allValues(profile);
    const suggestions = new Map(fields.map(field => [field.token,
      FIELD_TYPES.includes(siteMappings[fieldKey(field)])
        ? { type: siteMappings[fieldKey(field)], reason: "이전에 확인한 매핑" }
        : classify(field)
    ]));
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
    if (layaError) currentRun.notes.push(layaError);
    await recordRun(currentRun);
    if (layaError) { setStatus(`${layaError}. 규칙 결과를 표시합니다.`); return; }
    setStatus(`입력칸 ${fields.length}개 · 저장된 값 ${values.length}개 · Laya 제안 ${modelCount}개. 아래 매핑을 확인하세요.`);
  } catch (error) { setStatus(error.message); }
});

fillButton.addEventListener("click", async () => {
  const { profile = {} } = await chrome.storage.local.get("profile");
  const values = new Map(allValues(profile).map(item => [item.key, item.value]));
  const items = choices.filter(choice => choice.select.value && values.has(choice.select.value))
    .map(choice => ({ token: choice.token, value: values.get(choice.select.value) }));
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
    const { results, invalidFields = [] } = await send("fill", { items });
    report.replaceChildren();
    for (const result of results) {
      const field = fields.find(field => field.token === result.token);
      const row = document.createElement("p");
      row.textContent = `${result.status === "filled" ? "✓" : result.status === "review" ? "?" : "!"} ${field?.label || field?.name || result.token}: ${result.detail}`;
      report.append(row);
    }
    if (invalidFields.length) {
      const row = document.createElement("p");
      row.textContent = `미완료/검증 오류: ${invalidFields.join(", ")}`;
      report.append(row);
    }
    if (currentRun) {
      const chosen = new Map(choices.filter(choice => choice.select.value)
        .map(choice => [choice.token, choice.select.value.slice(0, choice.select.value.lastIndexOf(":"))]));
      await recordRun(addFill(currentRun, chosen, results, invalidFields));
    }
    const reviewCount = results.filter(result => result.status === "review").length;
    setStatus(`${results.filter(result => result.status === "filled").length}/${items.length}개 입력 확인${reviewCount ? ` · ${reviewCount}개 직접 선택 필요(?)` : ""}. 내용을 확인한 뒤 직접 제출하세요.`);
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
