// Every profile value AutoFolio can fill. The options page, the matcher and the Laya
// descriptions all read this list, so a new item only needs to be added here.
export const PROFILE_SCHEMA = [
  { group: "personal", label: "인적사항", single: true,
    fields: { name: "이름", birthDate: "생년월일", email: "이메일", phone: "휴대전화", address: "주소" } },
  { group: "education", label: "학력", title: "school",
    fields: { school: "학교명", major: "전공", startDate: "입학일", graduationDate: "졸업일", gpa: "학점" } },
  { group: "career", label: "경력", title: "company",
    fields: { company: "회사명", department: "부서", position: "직급·직무", startDate: "입사일", endDate: "퇴사일", description: "담당 업무" } },
  { group: "certificate", label: "자격증", title: "name",
    fields: { name: "자격증명", obtainedDate: "취득일", issuer: "발급기관" } },
  { group: "language", label: "어학", title: "test",
    fields: { test: "시험명", score: "점수·등급", obtainedDate: "취득일" } },
  { group: "award", label: "수상", title: "title",
    fields: { title: "수상명", issuer: "수여기관", date: "수상일" } },
  { group: "activity", label: "활동·경험", title: "name",
    fields: { name: "활동명", organization: "기관·단체", startDate: "시작일", endDate: "종료일", description: "내용" } },
  { group: "project", label: "프로젝트", title: "name",
    fields: { name: "프로젝트명", startDate: "시작일", endDate: "종료일", skills: "사용 기술", description: "설명" } }
];

export const LONG_FIELDS = new Set(["description"]);

export const FIELD_TYPES = PROFILE_SCHEMA.flatMap(({ group, fields }) => Object.keys(fields).map(key => `${group}.${key}`));

export function describeType(type) {
  const [group, key] = type.split(".");
  const entry = PROFILE_SCHEMA.find(item => item.group === group);
  return entry ? `${entry.label}의 ${entry.fields[key]}` : type;
}

// Labels specific enough to decide the item on their own, whatever the section says.
const RULES = [
  ["personal.email", /이메일|전자우편|e-?mail/i],
  ["personal.phone", /휴대.?전화|휴대폰|핸드폰|연락처|전화번호|mobile|cell.?phone/i],
  ["personal.birthDate", /생년월일|생일|birth/i],
  ["education.school", /학교명|대학명|대학교명|졸업학교|최종학교|school|university/i],
  ["education.major", /전공|학과|학부|major|department/i],
  ["education.gpa", /학점|평점|gpa|grade.?point/i],
  ["education.startDate", /입학.?일|입학.?연월|입학.?년|입학.?시기/i],
  ["education.graduationDate", /졸업.?일|졸업.?연월|졸업.?년|졸업.?예정.?일|graduation/i],
  ["career.company", /회사.?명|직장.?명|근무처|company/i],
  ["career.position", /직급|직위|직책|position/i],
  ["career.startDate", /입사.?일|입사.?연월/i],
  ["career.endDate", /퇴사.?일|퇴사.?연월/i],
  ["certificate.name", /자격증.?명|자격.?명칭|자격.?종목|면허.?명|certificate|license/i],
  ["certificate.issuer", /발급.?기관|시행.?기관|자격.?기관/i],
  ["language.test", /어학.?시험|시험.?명|시험.?종류|toeic|toefl|opic|teps|토익|토플|오픽|텝스|jlpt|hsk/i],
  ["language.score", /어학.?점수|어학.?성적|어학.?등급/i],
  ["award.title", /수상.?명|수상.?내역|수상.?경력/i],
  ["project.name", /프로젝트.?명/i],
  ["activity.name", /활동.?명/i],
  ["personal.address", /주소|거주지|address/i],
  ["personal.name", /^(성명|이름|한글.?이름|name|full.?name)$/i]
];

// Generic labels like "명칭", "취득일" or "내용" mean different things per section.
// Checked in order, so a section that names two groups ("자격증 및 어학") goes to the first.
// Career comes after award and activity because "수상경력" and "활동경력" also contain 경력.
const SECTION_RULES = [
  [/어학|외국어|language/i, [
    ["language.obtainedDate", /취득|응시|일자|날짜/], ["language.score", /점수|등급|성적|급수/], ["language.test", /시험|종류|어학|명/]]],
  [/수상|award/i, [
    ["award.date", /일자|날짜|수상.?일|연월/], ["award.issuer", /기관|수여|주최/], ["award.title", /수상|명|내역|제목/]]],
  [/프로젝트|project/i, [
    ["project.startDate", /시작/], ["project.endDate", /종료/], ["project.skills", /기술|스킬|도구|언어/],
    ["project.description", /내용|설명|역할/], ["project.name", /명|이름|제목/]]],
  [/활동|경험|동아리|봉사|activit/i, [
    ["activity.startDate", /시작/], ["activity.endDate", /종료/], ["activity.organization", /기관|단체|소속/],
    ["activity.description", /내용|설명|역할/], ["activity.name", /활동|명|이름|제목/]]],
  [/경력|재직|근무|career|employment/i, [
    ["career.company", /회사|직장|근무처|기관/], ["career.department", /부서/], ["career.position", /직급|직위|직책|직무/],
    ["career.startDate", /입사|시작/], ["career.endDate", /퇴사|종료/], ["career.description", /업무|내용|설명/]]],
  [/자격|면허|certificate|license/i, [
    ["certificate.obtainedDate", /취득|발급.?일/], ["certificate.issuer", /발급.?기관|시행.?기관/], ["certificate.name", /명칭|종목|이름|자격/]]],
  [/학력|대학교|대학|school|education/i, [
    ["education.startDate", /입학|시작.?일/], ["education.graduationDate", /졸업|종료.?일/],
    ["education.school", /학교|기관.?명/], ["education.major", /전공|학과|학부/]]]
];

// Used only when the page gives no section to go on.
const FALLBACK_RULES = [
  ["certificate.obtainedDate", /취득.?일|취득.?연월|발급.?일|자격.?취득/i]
];

export function classify(field) {
  const label = [field.label, field.placeholder, field.ariaLabel].filter(Boolean).join(" ").trim();
  const context = [field.section, field.name, field.id].filter(Boolean).join(" ");
  if (!label && !context) return { type: null, reason: "필드 설명 없음" };

  for (const [type, pattern] of RULES) {
    if (pattern.test(label)) return { type, reason: "라벨 규칙" };
  }
  if (label) {
    for (const [section, rules] of SECTION_RULES) {
      if (!section.test(context)) continue;
      const match = rules.find(([, pattern]) => pattern.test(label));
      if (match) return { type: match[0], reason: "섹션 규칙" };
    }
  }
  for (const [type, pattern] of FALLBACK_RULES) {
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
  const schema = PROFILE_SCHEMA.find(item => item.group === group);
  const entries = schema.single ? [profile[group] || {}] : profile[group] || [];
  return entries.map((entry, index) => ({
    key: `${type}:${index}`,
    label: schema.single ? entry[property] : `${entry[schema.title] || index + 1} · ${entry[property] || ""}`,
    value: entry[property]
  })).filter(item => item.value !== undefined && String(item.value).trim() !== "");
}

export function allValues(profile) {
  return FIELD_TYPES.flatMap(type => valuesFor(profile, type).map(item => ({ ...item, type })));
}

// Accepts a backup file's contents and keeps only known groups and fields as strings.
export function cleanProfile(data) {
  const source = data?.profile ?? data;
  if (!source || typeof source !== "object") throw new Error("이력 파일 형식이 아닙니다.");
  const pick = (entry, fields) => Object.fromEntries(Object.keys(fields)
    .map(key => [key, entry?.[key] == null ? "" : String(entry[key]).trim()]));
  const profile = {};
  for (const { group, single, fields } of PROFILE_SCHEMA) {
    if (single) profile[group] = pick(source[group], fields);
    else profile[group] = (Array.isArray(source[group]) ? source[group] : [])
      .map(entry => pick(entry, fields)).filter(entry => Object.values(entry).some(Boolean));
  }
  return profile;
}
