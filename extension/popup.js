import { allValues, classify, FIELD_TYPES } from "./matcher.js";

const fieldsRoot = document.getElementById("fields");
const status = document.getElementById("status");
const report = document.getElementById("report");
const fillButton = document.getElementById("fill");
const layaToggle = document.getElementById("useLaya");
let tabId;
let fields = [];
let choices = [];
let pageUrl = "";

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
    option.textContent = `${item.type} — ${item.label}`;
    select.append(option);
  }
  select.value = selected || "";
  return select;
}

async function layaClassify(field) {
  const descriptions = {
    "personal.name": "지원자 본인 이름", "personal.email": "지원자 이메일 주소",
    "personal.phone": "지원자 휴대전화 번호", "personal.address": "지원자 거주지 주소",
    "education.school": "학력의 학교명", "education.major": "학력의 전공 또는 학과",
    "education.startDate": "학교 입학 날짜", "education.graduationDate": "학교 졸업 날짜",
    "education.gpa": "학교 성적 또는 학점", "certificate.name": "자격증 이름 또는 종목",
    "certificate.obtainedDate": "자격증 취득 날짜", "certificate.issuer": "자격증 발급 기관"
  };
  const criteria = Object.fromEntries(FIELD_TYPES.map(type => [type, descriptions[type]]));
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
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
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
    if (layaToggle.checked) {
      setStatus(`입력칸 ${fields.length}개를 찾았습니다. 로컬 Laya가 모르는 칸을 분석 중입니다.`);
      try {
        for (const field of fields.filter(field => !suggestions.get(field.token).type)) {
          const type = await layaClassify(field);
          if (type) { suggestions.set(field.token, { type, reason: "Laya 제안 · 확인 필요" }); modelCount++; }
        }
      } catch (error) {
        setStatus(`Laya 연결 실패: ${error.message}. 규칙 결과를 표시합니다.`);
      }
    }
    render(values, suggestions);
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
      row.textContent = `${result.status === "filled" ? "✓" : "!"} ${field?.label || field?.name || result.token}: ${result.detail}`;
      report.append(row);
    }
    if (invalidFields.length) {
      const row = document.createElement("p");
      row.textContent = `미완료/검증 오류: ${invalidFields.join(", ")}`;
      report.append(row);
    }
    setStatus(`${results.filter(result => result.status === "filled").length}/${items.length}개 입력 확인. 내용을 확인한 뒤 직접 제출하세요.`);
  } catch (error) { setStatus(`입력 실패: ${error.message}`); }
  fillButton.disabled = false;
});

const { useLaya = false } = await chrome.storage.local.get("useLaya");
layaToggle.checked = useLaya;
