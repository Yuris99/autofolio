// Field Classifier (규칙 기반).
// 사이트별 name/id가 아니라 사람이 보는 텍스트(label, placeholder, 섹션 제목 등)로 의미를 판단한다.
// → 특정 채용 솔루션에 묶이지 않도록 하기 위함. 규칙으로 판단 못 한 필드는 null (추후 캐시/Laya 단계).
import type { Field } from "../analyzer/types.js";
import type { EducationLevel, SlotKey } from "../profile/schema.js";

export type Widget = "text" | "date" | "number" | "select" | "radio" | "search";

export type Classification = {
  slot: SlotKey;
  widget: Widget;
  level?: EducationLevel; // education 슬롯일 때
  groupKey: string; // 같은 이력 항목(예: 자격증 1개)에 속한 필드 묶음 키
  reason: string;
};

// "자격증명*" "(필수) 이름 :" 같은 표기를 비교 가능한 형태로
export const norm = (s: string) =>
  s
    .replace(/\(필수\)|\*|:|：/g, "")
    .replace(/\s+/g, " ")
    .trim();

// select의 안내용 첫 옵션 ("만점기준", "학교소재지" 등 — 값이 비어 있는 옵션)
function selectPrompt(f: Field): string {
  const first = f.options?.[0];
  return f.tag === "select" && first && first.value === "" ? first.text : "";
}

// 필드 자체를 설명하는 텍스트 (섹션 제목 제외).
// 라벨이 label 요소 없이 바로 앞 텍스트로만 붙어 있는 사이트가 많아 preceding도 포함한다.
function ownParts(f: Field, withPreceding = true): string[] {
  const c = f.context;
  return [c.label, c.ariaLabel, c.ariaLabelledBy, c.placeholder, c.title, c.rowHeader, selectPrompt(f), withPreceding ? c.preceding : ""]
    .map(norm)
    .filter(Boolean);
}
// 필드에 직접 붙은 강한 단서 (앞쪽 텍스트 제외)
function strongText(f: Field): string {
  return ownParts(f, false).join(" | ");
}
function ownText(f: Field): string {
  return ownParts(f).join(" | ");
}

// ^…$ 로 전체 일치를 요구하는 규칙은 조각 단위로, 나머지는 이어 붙인 텍스트로 검사한다
const testText = (re: RegExp, text: string) => re.test(text) || text.split(" | ").some((part) => re.test(part));

// 섹션 계층 텍스트 (가까운 제목부터)
function sectionText(f: Field): string {
  return norm(f.context.sections.join(" | "));
}

function isSearchWidget(f: Field): boolean {
  return f.type === "search" || /검색/.test(f.context.placeholder + f.context.label);
}

// 반복 그룹 키: 배열 표기 name의 첫 인덱스까지(college[0].x → college[0]) 또는 data-rel-target.
// 둘 다 없으면 섹션 제목으로 묶는다.
function groupKeyOf(f: Field): string {
  if (f.attrs.relTarget) return f.attrs.relTarget;
  const m = f.name.match(/^[^[]*\[\d+\]/);
  if (m) return m[0];
  return `section:${f.context.sections.at(-1) ?? ""}`;
}

// 사이트가 내부적으로 쓰는 코드 저장용 필드 (검색 선택 결과가 들어감). 입력 대상이 아니다.
export function isCodeHolder(f: Field): boolean {
  return /코드/.test(ownText(f)) && /hidden/.test(f.attrs.className);
}

function educationLevel(sections: string): EducationLevel | undefined {
  if (/대학원/.test(sections)) return "대학원";
  if (/대학교|대학 |대학$|학사/.test(sections)) return "대학교";
  if (/고등학교|고교/.test(sections)) return "고등학교";
  return undefined;
}

// near: section 조건을 가장 가까운 섹션 제목에만 적용 (예: "졸업구분" 라디오 그룹)
type Rule = { slot: SlotKey; own?: RegExp; section?: RegExp; near?: boolean; not?: RegExp; widget?: Widget[] };

// 순서가 우선순위. 먼저 맞는 규칙이 이긴다.
const RULES: Rule[] = [
  // 자격증
  { slot: "certificates.name", own: /자격증?\s*(명|검색)|자격\s*종목|면허\s*(명|검색)/, widget: ["search", "text"] },
  { slot: "certificates.registrationNumber", own: /등록\s*번호|자격\s*번호|자격증\s*번호|발급\s*번호|관리\s*번호/, section: /자격|면허/ },
  { slot: "certificates.issuer", own: /발급\s*기관|발행\s*(처|기관)|시행\s*기관|주관\s*기관/, section: /자격|면허/ },
  { slot: "certificates.acquiredDate", own: /취득\s*(일|일자|날짜|년월)|합격\s*일|발급\s*일/, section: /자격|면허/ },

  // 학력
  { slot: "education.school", own: /학교\s*(명|검색)|출신\s*학교|최종\s*학교|^학교$/, widget: ["search", "text"] },
  { slot: "education.major", own: /전공\s*(명|검색)|학과\s*(명|검색)|^전공$|^학과$/, not: /계열/, widget: ["search", "text"] },
  { slot: "education.entranceDate", own: /입학\s*(일|일자|년월)/ },
  { slot: "education.graduationDate", own: /졸업\s*(\(예정\)\s*)?(예정\s*)?(일|일자|년월)/ },
  { slot: "education.gpaScale", own: /만점|기준\s*학점/ },
  { slot: "education.gpa", own: /평점|학점|평균\s*평점/, not: /만점|기준/, widget: ["number", "text"] },
  { slot: "education.degree", section: /학위\s*구분|^학위/, near: true, widget: ["radio", "select"] },
  { slot: "education.entranceType", section: /입학\s*구분/, near: true, widget: ["radio", "select"] },
  { slot: "education.status", section: /졸업\s*구분|학적\s*상태|재학\s*상태/, near: true, widget: ["radio", "select"] },

  // 인적사항
  { slot: "personal.name", own: /^(이름|성명|한글\s*(이름|성명))$/ },
  { slot: "personal.birthday", own: /생년월일|생일/ },
  { slot: "personal.gender", own: /성별/, widget: ["radio", "select"] },
  { slot: "personal.email", own: /이메일|e-?mail/i },
  { slot: "personal.phone", own: /휴대\s*(전화|폰|번호)|핸드폰|연락처/ },
  { slot: "personal.address.zipCode", own: /우편\s*번호/ },
  { slot: "personal.address.detail", own: /상세\s*주소/ },
  { slot: "personal.address.address", own: /^주소$|기본\s*주소|도로명\s*주소/ },
];

function widgetOf(f: Field, slot: SlotKey): Widget {
  if (f.type === "radio") return "radio";
  if (f.tag === "select") return "select";
  if (isSearchWidget(f)) return "search";
  if (f.type === "number") return "number";
  if (/date/i.test(f.attrs.className) || /Date$|birthday/.test(slot)) return "date";
  return "text";
}

// 라디오는 개별 옵션이 아니라 그룹 단위로 질문 텍스트를 만든다 (옵션 라벨 "남"/"여"만으로는 의미를 알 수 없음)
function radioQuestion(group: Field[]): string {
  const first = group[0];
  return norm([first.context.label, first.context.preceding, first.context.rowHeader].join(" | "));
}

function matchRule(own: string, sections: string[], widget: Widget, isRadio: boolean): Rule | undefined {
  const section = sections.join(" | ");
  return RULES.find((r) => {
    if (r.widget && !r.widget.includes(widget)) return false;
    if (r.not && testText(r.not, own)) return false;
    // 라디오 그룹은 질문이 섹션 제목에 있는 경우가 많다 (예: "졸업구분" 아래 졸업/졸업예정/…).
    // 단, 가장 가까운 섹션만 본다 — 상위 제목("연락처" 등)까지 보면 엉뚱한 그룹이 걸린다.
    const target = isRadio ? `${own} | ${sections[0] ?? ""}` : own;
    if (r.own && !testText(r.own, target)) return false;
    if (r.section && !testText(r.section, r.near || isRadio ? (sections[0] ?? "") : section)) return false;
    return Boolean(r.own || r.section);
  });
}

export type Classified = { field: Field; group?: Field[]; result: Classification | null };

// 페이지의 필드 목록 전체를 분류한다. 라디오는 name 단위 그룹으로 묶어 대표 1개로 반환한다.
export function classifyAll(fields: Field[]): Classified[] {
  const out: Classified[] = [];
  const radioGroups = new Map<string, Field[]>();

  for (const f of fields) {
    if (f.type === "radio") {
      const key = f.name || f.selector;
      if (!radioGroups.has(key)) radioGroups.set(key, []);
      radioGroups.get(key)!.push(f);
      continue;
    }
    if (f.type === "file" || isCodeHolder(f)) {
      out.push({ field: f, result: null });
      continue;
    }
    out.push({ field: f, result: classifyOne(f, ownText(f), false) });
  }

  for (const group of radioGroups.values()) {
    out.push({ field: group[0], group, result: classifyOne(group[0], radioQuestion(group), true) });
  }

  return out.sort((a, b) => a.field.index - b.field.index);
}

function classifyOne(f: Field, own: string, isRadio: boolean): Classification | null {
  const section = sectionText(f);
  const sections = f.context.sections.map(norm);
  const widgetGuess: Widget = isRadio ? "radio" : f.tag === "select" ? "select" : isSearchWidget(f) ? "search" : f.type === "number" ? "number" : "text";
  // 강한 단서로 먼저 판단하고, 안 되면 앞쪽 텍스트까지 포함해 판단
  const rule = (isRadio ? undefined : matchRule(strongText(f), sections, widgetGuess, false)) ?? matchRule(own, sections, widgetGuess, isRadio);
  if (!rule) return null;

  const slot = rule.slot;
  const c: Classification = {
    slot,
    widget: widgetOf(f, slot),
    groupKey: groupKeyOf(f),
    reason: `규칙: "${(isRadio ? own + " | " + section.split(" | ")[0] : own).slice(0, 40)}"`,
  };
  if (slot.startsWith("education.")) {
    c.level = educationLevel(section) ?? educationLevel(own);
    if (!c.level) return null; // 어느 학력인지 모르면 자동 매핑하지 않는다
  }
  return c;
}
