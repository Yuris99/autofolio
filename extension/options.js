import { cleanProfile, LONG_FIELDS, PROFILE_SCHEMA } from "./matcher.js";
import { addExamples, defaultLearned, readLearnedFile } from "./learn.js";

const form = document.getElementById("profileForm");
const saved = document.getElementById("saved");

function input(label, key, value = "", hint = "") {
  const wrapper = document.createElement("label");
  wrapper.textContent = label;
  const element = document.createElement(LONG_FIELDS.has(key) ? "textarea" : "input");
  element.name = key;
  element.value = value;
  if (hint) element.placeholder = `예: ${hint}`;
  element.autocomplete = "off";
  if (LONG_FIELDS.has(key)) { element.rows = 3; wrapper.className = "wide"; }
  wrapper.append(element);
  return wrapper;
}

function entry(list, fields, data = {}) {
  const wrapper = document.createElement("div");
  wrapper.className = "entry";
  const grid = document.createElement("div");
  grid.className = "grid";
  for (const [key, label] of Object.entries(fields)) grid.append(input(label, key, data[key] || ""));
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "secondary";
  remove.textContent = "삭제";
  remove.addEventListener("click", () => { wrapper.remove(); autosave(); });
  wrapper.append(grid, remove);
  list.append(wrapper);
}

function readGrid(root) {
  return Object.fromEntries([...root.querySelectorAll("input, textarea")].map(element => [element.name, element.value.trim()]));
}

function render(profile) {
  form.replaceChildren();
  for (const { group, label, single, fields, hints = {} } of PROFILE_SCHEMA) {
    const section = document.createElement("section");
    const heading = document.createElement("h2");
    heading.textContent = label;
    const list = document.createElement("div");
    list.dataset.group = group;
    section.append(heading, list);
    if (single) {
      list.className = "grid";
      for (const [key, fieldLabel] of Object.entries(fields)) list.append(input(fieldLabel, key, profile[group]?.[key] || "", hints[key]));
    } else {
      for (const data of profile[group] || []) entry(list, fields, data);
      const add = document.createElement("button");
      add.type = "button";
      add.className = "secondary";
      add.textContent = `+ ${label} 추가`;
      add.addEventListener("click", () => entry(list, fields));
      section.append(add);
    }
    form.append(section);
  }
}

function readForm() {
  const profile = {};
  for (const { group, single } of PROFILE_SCHEMA) {
    const list = form.querySelector(`[data-group="${group}"]`);
    profile[group] = single ? readGrid(list) : [...list.querySelectorAll(":scope > .entry")].map(readGrid);
  }
  return cleanProfile(profile);
}

// Typing saves on its own; the button is there for reassurance and saves immediately.
let saveTimer;
function autosave() {
  saved.textContent = "저장 중…";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    await chrome.storage.local.set({ profile: readForm() });
    saved.textContent = `자동 저장됨 ${new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}`;
  }, 600);
}
form.addEventListener("input", autosave);

form.addEventListener("submit", async event => {
  event.preventDefault();
  clearTimeout(saveTimer);
  const profile = readForm();
  await chrome.storage.local.set({ profile });
  render(profile);
  saved.textContent = "저장했습니다.";
});

document.getElementById("export").addEventListener("click", () => {
  const backup = { app: "autofolio", version: 1, exportedAt: new Date().toISOString(), profile: readForm() };
  const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `autofolio-이력-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

const importFile = document.getElementById("importFile");
document.getElementById("import").addEventListener("click", () => importFile.click());
importFile.addEventListener("change", async () => {
  const [file] = importFile.files;
  importFile.value = "";
  if (!file) return;
  try {
    const profile = cleanProfile(JSON.parse(await file.text()));
    if (!confirm("지금 화면의 이력을 불러온 파일 내용으로 바꿉니다. 계속할까요?")) return;
    await chrome.storage.local.set({ profile });
    render(profile);
    saved.textContent = "파일에서 불러와 저장했습니다.";
  } catch (error) {
    saved.textContent = `불러오기 실패: ${error instanceof SyntaxError ? "JSON 파일이 아닙니다." : error.message}`;
  }
});

// Learned answers: import merges into the user's own answers (the file wins for the same field).
const learnedCount = document.getElementById("learnedCount");
async function showLearned(message = "") {
  const { learned = [] } = await chrome.storage.local.get("learned");
  const defaults = await defaultLearned();
  learnedCount.textContent = `내 답 ${learned.length}건 · 기본 ${defaults.length}건${message ? ` · ${message}` : ""}`;
}
document.getElementById("exportLearned").addEventListener("click", async () => {
  const { learned = [] } = await chrome.storage.local.get("learned");
  const data = { app: "autofolio", kind: "learned-answers", version: 1, exportedAt: new Date().toISOString(), examples: learned };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `autofolio-학습-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
const learnedFile = document.getElementById("learnedFile");
document.getElementById("importLearned").addEventListener("click", () => learnedFile.click());
learnedFile.addEventListener("change", async () => {
  const [file] = learnedFile.files;
  learnedFile.value = "";
  if (!file) return;
  try {
    const imported = readLearnedFile(JSON.parse(await file.text()));
    const { learned = [] } = await chrome.storage.local.get("learned");
    await chrome.storage.local.set({ learned: addExamples(learned, imported) });
    await showLearned(`${imported.length}건 불러옴`);
  } catch (error) {
    await showLearned(`불러오기 실패: ${error instanceof SyntaxError ? "JSON 파일이 아닙니다." : error.message}`);
  }
});
document.getElementById("clearLearned").addEventListener("click", async () => {
  if (!confirm("내가 가르친 답을 모두 지울까요? 기본으로 들어 있는 답은 남습니다.")) return;
  await chrome.storage.local.set({ learned: [] });
  await showLearned("지웠습니다");
});

const { profile = {} } = await chrome.storage.local.get("profile");
render(profile);
await showLearned();
const version = chrome.runtime?.getManifest?.().version;
if (version) document.getElementById("version").textContent = `v${version}`;
