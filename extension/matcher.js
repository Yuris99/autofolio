export const FIELD_TYPES = [
  "personal.name", "personal.email", "personal.phone", "personal.address",
  "education.school", "education.major", "education.startDate", "education.graduationDate", "education.gpa",
  "certificate.name", "certificate.obtainedDate", "certificate.issuer"
];

const RULES = [
  ["personal.email", /이메일|전자우편|e-?mail/i],
  ["personal.phone", /휴대.?전화|휴대폰|핸드폰|연락처|전화번호|mobile|cell.?phone/i],
  ["education.school", /학교명|대학명|대학교명|졸업학교|최종학교|school|university/i],
  ["education.major", /전공|학과|학부|major|department/i],
  ["education.gpa", /학점|평점|gpa|grade.?point/i],
  ["education.startDate", /입학.?일|입학.?연월|입학.?년|입학.?시기/i],
  ["education.graduationDate", /졸업.?일|졸업.?연월|졸업.?년|졸업.?예정.?일|graduation/i],
  ["certificate.obtainedDate", /취득.?일|취득.?연월|발급.?일|자격.?취득/i],
  ["certificate.issuer", /발급.?기관|시행.?기관|자격.?기관/i],
  ["certificate.name", /자격증.?명|자격.?명칭|자격.?종목|면허.?명|certificate|license/i],
  ["personal.address", /주소|거주지|address/i],
  ["personal.name", /^(성명|이름|한글.?이름|name|full.?name)$/i]
];

export function classify(field) {
  const label = [field.label, field.placeholder, field.ariaLabel].filter(Boolean).join(" ").trim();
  const context = [field.section, field.name, field.id].filter(Boolean).join(" ");
  if (!label && !context) return { type: null, reason: "필드 설명 없음" };

  // A section qualifies ambiguous words like "명칭" or "취득일".
  if (/자격|면허|certificate|license/i.test(context)) {
    if (/취득|발급.?일/i.test(label)) return { type: "certificate.obtainedDate", reason: "자격 섹션" };
    if (/발급.?기관|시행.?기관/i.test(label)) return { type: "certificate.issuer", reason: "자격 섹션" };
    if (/명칭|종목|이름|자격/i.test(label)) return { type: "certificate.name", reason: "자격 섹션" };
  }
  if (/학력|대학교|대학|school|education/i.test(context)) {
    if (/입학|시작.?일/i.test(label)) return { type: "education.startDate", reason: "학력 섹션" };
    if (/졸업|종료.?일/i.test(label)) return { type: "education.graduationDate", reason: "학력 섹션" };
    if (/학교|기관.?명/i.test(label)) return { type: "education.school", reason: "학력 섹션" };
    if (/전공|학과|학부/i.test(label)) return { type: "education.major", reason: "학력 섹션" };
  }
  for (const [type, pattern] of RULES) {
    if (pattern.test(label)) return { type, reason: "라벨 규칙" };
  }
  // Internal names are useful only when the page provides no visible description.
  if (!label) {
    const internal = [field.name, field.id].filter(Boolean).join(" ");
    for (const [type, pattern] of RULES) {
      if (pattern.test(internal)) return { type, reason: "필드 속성" };
    }
  }
  return { type: null, reason: "확인 필요" };
}

export function valuesFor(profile, type) {
  if (!type || !FIELD_TYPES.includes(type)) return [];
  const [group, property] = type.split(".");
  const entries = group === "personal" ? [profile.personal || {}] : profile[group] || [];
  return entries.map((entry, index) => ({
    key: `${type}:${index}`,
    label: group === "personal" ? entry[property] : `${entry.school || entry.name || index + 1} · ${entry[property] || ""}`,
    value: entry[property]
  })).filter(item => item.value !== undefined && String(item.value).trim() !== "");
}

export function allValues(profile) {
  return FIELD_TYPES.flatMap(type => valuesFor(profile, type).map(item => ({ ...item, type })));
}
