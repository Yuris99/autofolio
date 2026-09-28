import { cleanProfile, LONG_FIELDS, PROFILE_SCHEMA } from "./matcher.js";

const form = document.getElementById("profileForm");
const saved = document.getElementById("saved");

function input(label, key, value = "") {
  const wrapper = document.createElement("label");
  wrapper.textContent = label;
  const element = document.createElement(LONG_FIELDS.has(key) ? "textarea" : "input");
  element.name = key;
  element.value = value;
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
  remove.addEventListener("click", () => { wrapper.remove(); saved.textContent = "저장하지 않은 변경이 있습니다."; });
  wrapper.append(grid, remove);
  list.append(wrapper);
}

function readGrid(root) {
  return Object.fromEntries([...root.querySelectorAll("input, textarea")].map(element => [element.name, element.value.trim()]));
}

function render(profile) {
  form.replaceChildren();
  for (const { group, label, single, fields } of PROFILE_SCHEMA) {
    const section = document.createElement("section");
    const heading = document.createElement("h2");
    heading.textContent = label;
    const list = document.createElement("div");
    list.dataset.group = group;
    section.append(heading, list);
    if (single) {
      list.className = "grid";
      for (const [key, fieldLabel] of Object.entries(fields)) list.append(input(fieldLabel, key, profile[group]?.[key] || ""));
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

form.addEventListener("input", () => { saved.textContent = "저장하지 않은 변경이 있습니다."; });

form.addEventListener("submit", async event => {
  event.preventDefault();
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

const { profile = {} } = await chrome.storage.local.get("profile");
render(profile);
