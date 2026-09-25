// Profile Matcher: 분류된 필드와 사용자 이력을 연결해 입력 계획을 만든다.
// 원칙 (README 13장): 이력에 없는 값은 만들지 않는다 / 모호하면 사용자에게 묻는다 / 이미 입력된 값은 덮어쓰지 않는다.
import type { Field } from "../analyzer/types.js";
import { isCodeHolder, norm, type Classification, type Classified } from "../classifier/rules.js";
import type { Certificate, Education, Profile } from "../profile/schema.js";

export type Action = "fill" | "ask" | "skip" | "already";

export type PlanStep = {
  field: Field;
  group?: Field[]; // 라디오 그룹
  cls: Classification;
  action: Action;
  value?: string; // 입력할 값 (search는 검색어이자 정확 일치 대상)
  target?: string; // radio: 선택할 라디오 selector / select: 선택할 옵션 텍스트
  candidates?: string[]; // ask일 때 선택지
  note: string;
};

export type PlanOptions = {
  overwrite?: boolean;
  // 사이트 슬롯보다 이력이 많을 때 사용할 항목 (README 6.4). 예: { certificates: ["정보처리기사"] }
  pick?: { certificates?: string[] };
  dateFormat?: string;
};

const DEFAULT_DATE_FORMAT = "YYYY.MM.DD";

export function formatDate(iso: string, fmt: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?$/);
  if (!m) return iso;
  return fmt.replace("YYYY", m[1]).replace("MM", m[2]).replace("DD", m[3] ?? "01");
}

// 날짜 형식 결정 순서:
//  1) placeholder에 형식이 적혀 있으면 따른다 (예: "YYYY-MM-DD")
//  2) 필드의 형식 힌트 속성이 연·월만(YM)이면 일(DD)을 뺀다
//  3) 구분자는 페이지에 이미 채워진 날짜 칸의 모양(예: "9999.99")에서 추정
function dateFormatOf(f: Field, all: Field[], fallback: string): string {
  const ph = f.context.placeholder.toUpperCase().match(/YYYY([.\-/]?)MM(?:\1DD)?/);
  if (ph) return ph[0];
  const shape = all.find((x) => x.valueShape)?.valueShape;
  const sep = shape?.match(/^9{4}([.\-/])/)?.[1] ?? fallback.match(/^YYYY([.\-/]?)/)?.[1] ?? ".";
  const ymOnly = /:YM$/i.test(f.attrs.dateHint);
  return ymOnly ? `YYYY${sep}MM` : `YYYY${sep}MM${sep}DD`;
}

const SYNONYMS: Record<string, string[]> = {
  남: ["남", "남자", "남성", "M", "Male"],
  여: ["여", "여자", "여성", "F", "Female"],
};

const same = (a: string, b: string) => norm(a).replace(/\s/g, "") === norm(b).replace(/\s/g, "");

function radioLabel(f: Field): string {
  // 첫 라디오의 label에는 질문 텍스트가 섞일 수 있어("성별 남") 마지막 토큰을 옵션명으로 본다
  const l = norm(f.context.label);
  return l.split(" ").at(-1) ?? l;
}

function isFilled(step: { field: Field; group?: Field[] }, all: Field[], cls: Classification): boolean {
  const f = step.field;
  if (step.group) return step.group.some((r) => r.checked);
  if (f.tag === "select") return (f.options ?? []).some((o, i) => o.selected && i > 0 && o.value !== "");
  if (cls.widget === "search") {
    // 검색형은 검색칸이 아니라 같은 그룹의 코드 저장 필드가 채워졌는지로 판단
    const holder = all.find((x) => isCodeHolder(x) && (x.attrs.relTarget || x.name).startsWith(cls.groupKey));
    return holder?.hasValue === true;
  }
  return f.hasValue === true;
}

// 페이지에서 같은 종류(엔티티+학력단계)의 그룹 키를 DOM 순서대로 나열 → 이력 목록의 몇 번째 항목인지 결정
function groupOrder(classified: Classified[]): Map<string, string[]> {
  const order = new Map<string, string[]>();
  for (const { result } of classified) {
    if (!result) continue;
    const kind = result.slot.split(".")[0] + (result.level ?? "");
    if (!order.has(kind)) order.set(kind, []);
    const list = order.get(kind)!;
    if (!list.includes(result.groupKey)) list.push(result.groupKey);
  }
  return order;
}

function lookup(profile: Profile, slot: string, item: Education | Certificate | undefined): unknown {
  const [entity, ...rest] = slot.split(".");
  let cur: unknown = entity === "personal" ? profile.personal : item;
  for (const k of rest) cur = (cur as Record<string, unknown> | undefined)?.[k];
  return cur;
}

export function buildPlan(classified: Classified[], allFields: Field[], profile: Profile, opts: PlanOptions = {}): PlanStep[] {
  const order = groupOrder(classified);
  const certs = opts.pick?.certificates
    ? opts.pick.certificates.map((n) => (profile.certificates ?? []).find((c) => same(c.name, n))).filter((c): c is Certificate => !!c)
    : (profile.certificates ?? []);
  const certGroups = order.get("certificates")?.length ?? 0;
  const certNeedsPick = !opts.pick?.certificates && certs.length > certGroups;

  const steps: PlanStep[] = [];
  for (const { field, group, result: cls } of classified) {
    if (!cls) continue;
    const kind = cls.slot.split(".")[0] + (cls.level ?? "");
    const idx = order.get(kind)?.indexOf(cls.groupKey) ?? 0;

    let item: Education | Certificate | undefined;
    if (cls.slot.startsWith("education.")) item = (profile.education ?? []).filter((e) => e.level === cls.level)[idx];
    if (cls.slot.startsWith("certificates.")) item = certs[idx];

    const base = { field, group, cls };

    if (!opts.overwrite && isFilled(base, allFields, cls)) {
      steps.push({ ...base, action: "already", note: "이미 입력됨 (덮어쓰지 않음)" });
      continue;
    }

    // 사이트 칸보다 자격증이 많으면 어떤 걸 넣을지 사용자에게 묻는다
    if (certNeedsPick && cls.slot.startsWith("certificates.")) {
      if (cls.slot === "certificates.name") {
        steps.push({
          ...base,
          action: "ask",
          candidates: certs.map((c) => c.name),
          note: `입력칸 ${certGroups}개, 보유 자격증 ${certs.length}개 → 입력할 자격증 선택 필요 (--pick)`,
        });
      } else {
        // 어떤 자격증인지 정해지기 전에는 같은 그룹의 나머지 칸도 채우지 않는다
        steps.push({ ...base, action: "ask", note: "자격증 선택 후 입력" });
      }
      continue;
    }

    const raw = lookup(profile, cls.slot, item);
    if (raw === undefined || raw === null || raw === "") {
      steps.push({ ...base, action: "skip", note: item || cls.slot.startsWith("personal.") ? "이력에 값 없음" : "이력에 해당 항목 없음" });
      continue;
    }
    let value = String(raw);

    if (cls.widget === "date") {
      value = formatDate(value, opts.dateFormat ?? dateFormatOf(field, allFields, DEFAULT_DATE_FORMAT));
      steps.push({ ...base, action: "fill", value, note: "" });
    } else if (cls.widget === "radio") {
      const wanted = SYNONYMS[value] ?? [value];
      const hit = group?.find((r) => wanted.some((w) => same(radioLabel(r), w)));
      if (hit) steps.push({ ...base, action: "fill", value, target: hit.selector, note: `"${radioLabel(hit)}" 선택` });
      else steps.push({ ...base, action: "ask", value, candidates: group?.map(radioLabel), note: `"${value}"와 일치하는 선택지 없음` });
    } else if (cls.widget === "select") {
      const opts2 = (field.options ?? []).filter((o, i) => i > 0 || o.value !== "");
      const hit = opts2.find((o) => same(o.text, value) || (Number(o.text) === Number(value) && !Number.isNaN(Number(value))));
      if (hit) steps.push({ ...base, action: "fill", value, target: hit.text, note: "" });
      else steps.push({ ...base, action: "ask", value, candidates: opts2.map((o) => o.text).slice(0, 10), note: `"${value}"와 일치하는 옵션 없음` });
    } else if (cls.widget === "search") {
      steps.push({ ...base, action: "fill", value, note: "검색 후 이름이 정확히 일치하는 결과만 선택" });
    } else {
      steps.push({ ...base, action: "fill", value, note: "" });
    }
  }

  // 검색형(자격증명·학교명)을 먼저: 선택해야 같은 그룹의 나머지 칸이 활성화되는 사이트가 있다
  const rank = (s: PlanStep) => (s.cls.widget === "search" ? 0 : 1);
  return steps.sort((a, b) => rank(a) - rank(b) || a.field.index - b.field.index);
}
