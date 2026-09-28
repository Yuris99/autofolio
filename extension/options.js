const PERSONAL = { name: "이름", email: "이메일", phone: "휴대전화", address: "주소" };
const EDUCATION = { school: "학교명", major: "전공", startDate: "입학일", graduationDate: "졸업일", gpa: "학점" };
const CERTIFICATE = { name: "자격증명", obtainedDate: "취득일", issuer: "발급기관" };
const form = document.getElementById("profileForm");

function input(label, key, value = "") {
  const wrapper = document.createElement("label");
  wrapper.textContent = label;
  const element = document.createElement("input");
  element.name = key;
  element.value = value;
  element.autocomplete = "off";
  wrapper.append(element);
  return wrapper;
}

function entry(group, fields, data = {}) {
  const wrapper = document.createElement("div");
  wrapper.className = "entry";
  const grid = document.createElement("div");
  grid.className = "grid";
  for (const [key, label] of Object.entries(fields)) grid.append(input(label, key, data[key] || ""));
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "secondary";
  remove.textContent = "삭제";
  remove.addEventListener("click", () => wrapper.remove());
  wrapper.append(grid, remove);
  document.getElementById(group).append(wrapper);
}

function readGrid(root) {
  return Object.fromEntries([...root.querySelectorAll("input")].map(input => [input.name, input.value.trim()]));
}

document.getElementById("addEducation").addEventListener("click", () => entry("education", EDUCATION));
document.getElementById("addCertificate").addEventListener("click", () => entry("certificate", CERTIFICATE));

form.addEventListener("submit", async event => {
  event.preventDefault();
  const profile = {
    personal: readGrid(document.getElementById("personal")),
    education: [...document.querySelectorAll("#education .entry")].map(readGrid),
    certificate: [...document.querySelectorAll("#certificate .entry")].map(readGrid)
  };
  await chrome.storage.local.set({ profile });
  document.getElementById("saved").textContent = "저장했습니다.";
});

const { profile = {} } = await chrome.storage.local.get("profile");
for (const [key, label] of Object.entries(PERSONAL)) document.getElementById("personal").append(input(label, key, profile.personal?.[key] || ""));
for (const data of profile.education || []) entry("education", EDUCATION, data);
for (const data of profile.certificate || []) entry("certificate", CERTIFICATE, data);
