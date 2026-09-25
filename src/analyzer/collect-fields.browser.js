// 페이지(프레임) 안에서 실행되는 필드 수집 스크립트.
// 브라우저 자동화 라이브러리(Playwright/Stagehand)와 무관하게 문자열로 주입해 평가한다.
// 읽기 전용: 값 입력·클릭·포커스 등 페이지 상태를 바꾸는 동작을 하지 않는다.
// 개인정보 보호: 텍스트 입력값 자체는 저장하지 않고 입력 여부/길이만 기록한다.
(() => {
  const MAX_TEXT = 120;
  const MAX_OPTIONS = 60;

  const clean = (s) => (s ?? "").replace(/\s+/g, " ").trim();
  const cut = (s, n = MAX_TEXT) => {
    const t = clean(s);
    return t.length > n ? t.slice(0, n) + "…" : t;
  };

  // 요소 안의 입력 필드·선택지 텍스트를 제외한 순수 텍스트 (label에 select 옵션이 섞이는 것 방지)
  const ownText = (node) => {
    if (!node) return "";
    const copy = node.cloneNode(true);
    copy.querySelectorAll("select, option, input, textarea, script, style").forEach((n) => n.remove());
    return copy.textContent ?? "";
  };

  const isVisible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== "hidden" && cs.display !== "none";
  };

  const cssPath = (el) => {
    if (el.id) return `#${CSS.escape(el.id)}`;
    const parts = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && parts.length < 8) {
      let part = cur.tagName.toLowerCase();
      if (cur.id) {
        parts.unshift(`#${CSS.escape(cur.id)}`);
        break;
      }
      const parent = cur.parentElement;
      if (parent) {
        const same = [...parent.children].filter((c) => c.tagName === cur.tagName);
        if (same.length > 1) part += `:nth-of-type(${same.indexOf(cur) + 1})`;
      }
      parts.unshift(part);
      cur = parent;
    }
    return parts.join(" > ");
  };

  const textById = (ids) =>
    clean(
      (ids ?? "")
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent ?? "")
        .join(" "),
    );

  // 필드에 연결된 label 텍스트
  const labelText = (el) => {
    const texts = [];
    if (el.labels) for (const l of el.labels) texts.push(ownText(l));
    const wrap = el.closest("label");
    if (wrap && !texts.length) texts.push(ownText(wrap));
    return cut(texts.join(" "));
  };

  // 표 레이아웃(th/td)에서 같은 행의 헤더 텍스트
  const rowHeader = (el) => {
    const cell = el.closest("td, dd");
    if (!cell) return "";
    if (cell.tagName === "DD") {
      let prev = cell.previousElementSibling;
      while (prev && prev.tagName !== "DT") prev = prev.previousElementSibling;
      return cut(prev?.textContent);
    }
    const row = cell.parentElement;
    const th = row?.querySelector("th");
    if (th) return cut(th.textContent);
    // 헤더가 윗줄 thead에 있는 경우: 같은 열 인덱스의 th
    const table = cell.closest("table");
    const idx = [...row.children].indexOf(cell);
    const headRow = table?.querySelector("thead tr");
    return cut(headRow?.children[idx]?.textContent);
  };

  // 필드 바로 앞의 텍스트 (라벨이 형제 요소로 붙은 경우)
  const precedingText = (el) => {
    let node = el;
    for (let depth = 0; depth < 3 && node; depth++) {
      let prev = node.previousElementSibling;
      while (prev) {
        if (!prev.matches("input, select, textarea, button")) {
          const t = clean(ownText(prev));
          if (t) return cut(t);
        }
        prev = prev.previousElementSibling;
      }
      node = node.parentElement;
    }
    return "";
  };

  const HEADING = "h1, h2, h3, h4, h5, h6, legend, caption, [role=heading]";

  // 필드가 속한 섹션 제목 계층 (가까운 것부터): 조상을 올라가며 앞쪽 형제/자식 중 제목 요소를 모은다.
  // 예) ["재학기간", "학교관련", "대학교"] — 작은 제목만으로는 고등학교/대학교 구분이 안 되므로 계층이 필요하다.
  const sectionTrail = (el, max = 4) => {
    const trail = [];
    const push = (t) => {
      const c = cut(t);
      if (c && !trail.includes(c)) trail.push(c);
    };
    let node = el;
    while (node && node !== document.body && trail.length < max) {
      const legend = node.tagName === "FIELDSET" ? node.querySelector(":scope > legend") : null;
      if (legend) push(legend.textContent);
      if (node.tagName === "TABLE") {
        const cap = node.querySelector(":scope > caption");
        if (cap) push(cap.textContent);
      }
      // 앞쪽 형제 중 가장 가까운 제목. 형제 안에 중첩된 제목은 그 형제가 입력 필드를 포함하지 않을 때만
      // (= 제목 래퍼일 때만) 인정한다. 필드가 있는 형제는 옆 행/옆 섹션이므로 그 소제목을 가져오면 안 된다.
      let prev = node.previousElementSibling;
      while (prev) {
        if (prev.matches(HEADING)) {
          push(prev.textContent);
          break;
        }
        const inner = prev.querySelectorAll(HEADING);
        if (inner.length && !prev.querySelector("input, select, textarea")) {
          push(inner[inner.length - 1].textContent);
          break;
        }
        prev = prev.previousElementSibling;
      }
      node = node.parentElement;
    }
    return trail;
  };
  const sectionTitle = (el) => sectionTrail(el, 1)[0] ?? "";

  // 필드를 다시 찾기 위한 locator: name이 있으면 name 기반(라디오는 value까지), 없으면 CSS 경로
  const locatorOf = (el) => {
    const name = el.getAttribute("name");
    if (name) {
      const esc = CSS.escape(name);
      if (el.type === "radio" || el.type === "checkbox") return `[name="${esc}"][value="${CSS.escape(el.value)}"]`;
      if (document.querySelectorAll(`[name="${esc}"]`).length === 1) return `[name="${esc}"]`;
    }
    return cssPath(el);
  };

  const FIELD_SELECTOR = [
    "input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=image]):not([type=reset])",
    "select",
    "textarea",
    "[contenteditable=''], [contenteditable=true]",
    "[role=textbox], [role=combobox], [role=listbox], [role=radio], [role=checkbox], [role=spinbutton]",
  ].join(", ");

  // 지원서 항목이 아닌 필드 (봇 방지 토큰 등)
  const IGNORE_SELECTOR = "[name^='g-recaptcha'], [name^='h-captcha'], [name='cf-turnstile-response']";

  const fields = [...document.querySelectorAll(FIELD_SELECTOR)]
    .filter((el) => !el.matches(IGNORE_SELECTOR))
    .map((el, index) => {
    const tag = el.tagName.toLowerCase();
    const type = tag === "input" ? (el.getAttribute("type") ?? "text").toLowerCase() : tag;
    const f = {
      index,
      tag,
      type,
      role: el.getAttribute("role") ?? "",
      name: el.getAttribute("name") ?? "",
      id: el.id ?? "",
      selector: locatorOf(el),
      visible: isVisible(el),
      required: el.required === true || el.getAttribute("aria-required") === "true",
      disabled: el.disabled === true,
      readonly: el.readOnly === true,
      context: {
        label: labelText(el),
        ariaLabel: cut(el.getAttribute("aria-label")),
        ariaLabelledBy: cut(textById(el.getAttribute("aria-labelledby"))),
        placeholder: cut(el.getAttribute("placeholder")),
        title: cut(el.getAttribute("title")),
        rowHeader: rowHeader(el),
        preceding: precedingText(el),
        section: sectionTitle(el),
        sections: sectionTrail(el),
      },
      attrs: {
        maxLength: el.maxLength > 0 ? el.maxLength : null,
        pattern: el.getAttribute("pattern") ?? "",
        autocomplete: el.getAttribute("autocomplete") ?? "",
        inputmode: el.getAttribute("inputmode") ?? "",
        className: cut(el.className?.toString?.() ?? "", 80),
        onclick: cut(el.getAttribute("onclick"), 80),
        dataType: el.getAttribute("data-type") ?? "",
        relTarget: el.getAttribute("data-rel-target") ?? "",
        dateHint: el.getAttribute("data-dates") ?? el.getAttribute("data-date-format") ?? "",
      },
    };

    if (tag === "select") {
      f.options = [...el.options].slice(0, MAX_OPTIONS).map((o) => ({
        value: o.value,
        text: cut(o.text, 60),
        selected: o.selected,
      }));
      f.optionCount = el.options.length;
    } else if (type === "radio" || type === "checkbox") {
      f.checked = el.checked;
      f.value = el.value;
    } else if (type !== "password" && type !== "file") {
      const v = el.value ?? el.textContent ?? "";
      f.hasValue = v.length > 0;
      f.valueLength = v.length;
      // 형식 추정용 모양만 기록 (예: "2019.03" → "9999.99"). 실제 값은 저장하지 않는다.
      if (/date/i.test(el.className) && v) f.valueShape = v.slice(0, 20).replace(/\d/g, "9").replace(/[^\d9.\-/ ]/g, "x");
    }
    return f;
  });

  // 행 추가/검색 등 필드 조작에 필요한 버튼 (클릭하지 않고 목록만)
  const buttons = [
    ...document.querySelectorAll(
      "button, input[type=button], input[type=submit], [role=button], a[onclick], a[href^='javascript']",
    ),
  ]
    .map((el) => ({
      text: cut(el.textContent || el.value || el.getAttribute("aria-label") || el.getAttribute("title"), 60),
      selector: cssPath(el),
      visible: isVisible(el),
      section: sectionTitle(el),
    }))
    .filter((b) => b.text);

  const headings = [...document.querySelectorAll(HEADING)]
    .map((h) => cut(h.textContent))
    .filter(Boolean);

  return {
    url: location.href,
    title: document.title,
    headings,
    fieldCount: fields.length,
    fields,
    buttons,
  };
})()
