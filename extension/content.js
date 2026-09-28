(() => {
  // Injected again on every analysis. Replace the previous copy's listener instead of skipping,
  // so a tab opened before an extension update still gets the new code.
  if (globalThis.__autofolioListener) {
    try { chrome.runtime.onMessage.removeListener(globalThis.__autofolioListener); } catch { /* old context is gone */ }
  }
  let elements = new Map();
  // Shown in the page's DevTools console (F12). Saved profile values are never logged.
  const log = (...args) => console.info("%c[AutoFolio]", "color:#2358d0;font-weight:bold", ...args);

  // The group heading (h2 "추천인", legend "학력"), not the row title beside the input.
  const HEADINGS = ":scope > legend, :scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > .section-title, :scope > header";
  function nearbySection(element) {
    let node = element.parentElement;
    for (let depth = 0; node && depth < 8; depth++, node = node.parentElement) {
      const text = textOf(node.querySelector(HEADINGS)).slice(0, 100);
      if (text) return text;
      if (node.matches("fieldset") && node.getAttribute("aria-label")) return node.getAttribute("aria-label");
    }
    return "";
  }

  // A row title placed before the input's wrapper: <label class="title">계급</label><label class="select"><select>.
  function rowTitle(element) {
    let node = element;
    for (let depth = 0; node && depth < 3; depth++, node = node.parentElement) {
      for (let sibling = node.previousElementSibling; sibling; sibling = sibling.previousElementSibling) {
        if (sibling.matches("th, dt, .title, label") && !sibling.querySelector(CONTROLS)) return textOf(sibling);
        if (sibling.querySelector("input, select, textarea")) break;
      }
    }
    return "";
  }

  // Text of a label without the controls inside it; a label wrapping a <select>
  // would otherwise read as every option's text run together.
  const CONTROLS = "select, option, input, textarea, button, script, style";
  function textOf(node) {
    if (!node) return "";
    const parts = [];
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, {
      // Skip text inside controls, and hidden text such as a result's code kept in a hidden <span>.
      acceptNode: text => {
        const parent = text.parentElement;
        // Only controls inside the node are skipped: a result that is itself a <button> keeps its text.
        const control = parent?.closest(CONTROLS);
        if (!parent || (control && control !== node && node.contains(control)) || parent.closest("[hidden], [aria-hidden='true']")) return NodeFilter.FILTER_REJECT;
        return getComputedStyle(parent).display === "none" ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      }
    });
    while (walker.nextNode()) parts.push(walker.currentNode.nodeValue);
    return parts.join(" ").replace(/\s+/g, " ").trim().slice(0, 120);
  }

  function labelFor(element) {
    const direct = [...(element.labels || [])].map(textOf).filter(Boolean).join(" ");
    if (direct) return direct.slice(0, 120);
    const wrapping = textOf(element.closest("label"));
    if (wrapping) return wrapping;
    const labelledBy = element.getAttribute("aria-labelledby");
    if (labelledBy) return labelledBy.split(/\s+/).map(id => textOf(document.getElementById(id))).filter(Boolean).join(" ").slice(0, 120);
    const container = element.closest("td, dd, li, .form-group, .field, .input-group");
    const heading = container?.previousElementSibling?.matches("th, dt, .title, .label") ? container.previousElementSibling : null;
    return textOf(container?.querySelector("label, th, .label")) || textOf(heading) || rowTitle(element) || element.title.trim();
  }

  // The text of one radio choice ("남"), not the question label that may also point at it.
  function choiceText(radio) {
    return textOf(radio.closest("label")) || labelFor(radio) || radio.value;
  }

  // One field per radio group: its question, not any single choice, is what gets classified.
  // Repeating rows ("자격증 +"): <div class="row loop" data-loop="license">…<button data-button="add">.
  const LOOP_CLASS = /(^|\s)(loop|repeat|repeater)(\s|$)/i;
  function loopRow(element) {
    return element.closest("[data-loop]") || [...ancestors(element)].find(node => LOOP_CLASS.test(node.className || "")) || null;
  }
  function* ancestors(element) {
    for (let node = element.parentElement; node && node !== document.body; node = node.parentElement) yield node;
  }
  function loopKey(row) {
    return row.dataset.loop || String(row.className).trim();
  }
  function loopRows(row) {
    const key = loopKey(row);
    return [...(row.parentElement?.children || [])].filter(node => loopKey(node) === key && node.getClientRects().length);
  }
  function addButton(row) {
    return [...row.querySelectorAll("button, a, [role='button']")].find(button =>
      button.matches("[data-button='add'], .btn-add, .add") || /^\s*(\+|추가)\s*$/.test(button.textContent) ||
      /추가|add/i.test(button.getAttribute("aria-label") || button.title || "")) || null;
  }
  function loopInfo(element) {
    const row = loopRow(element);
    if (!row) return null;
    const rows = loopRows(row);
    return { key: loopKey(row), index: Math.max(0, rows.indexOf(row)), rows: rows.length, canAdd: Boolean(addButton(row)) };
  }

  // Press the last row's add button until there are `times` more rows. Never touches remove/reset.
  async function addRows(key, times) {
    let added = 0;
    for (let i = 0; i < times; i++) {
      const rows = [...document.querySelectorAll("[data-loop], [class]")].filter(node => loopKey(node) === key && node.getClientRects().length);
      const last = rows.at(-1);
      const button = last && addButton(last);
      if (!button) break;
      button.click();
      let now = rows.length;
      for (let waited = 0; waited < 1500 && now <= rows.length; waited += 100) {
        await wait(100);
        now = [...document.querySelectorAll("[data-loop], [class]")].filter(node => loopKey(node) === key && node.getClientRects().length).length;
      }
      if (now <= rows.length) break;
      added++;
    }
    log(`반복 항목 ${key}: ${added}줄 추가`);
    return added;
  }

  function radioGroup(element) {
    if (!element.name) return [element];
    const scope = element.form || document;
    return [...scope.querySelectorAll(`input[type="radio"][name="${CSS.escape(element.name)}"]`)];
  }

  function groupLabel(element) {
    const group = element.closest("[role='radiogroup']");
    const named = group && (group.getAttribute("aria-label") ||
      (group.getAttribute("aria-labelledby") || "").split(/\s+/).map(id => textOf(document.getElementById(id))).join(" ").trim());
    if (named) return named;
    // The question usually sits beside the row holding every choice: <th>성별</th><td>(radios)</td>.
    const radios = radioGroup(element);
    let row = element.parentElement;
    while (row && !radios.every(radio => row.contains(radio))) row = row.parentElement;
    for (let depth = 0; row && depth < 3; depth++, row = row.parentElement) {
      const heading = row.querySelector(":scope > legend, :scope > th, :scope > dt, :scope > .title, :scope > .label") ||
        (row.previousElementSibling?.matches("th, dt, .title, .label, label") ? row.previousElementSibling : null);
      const text = textOf(heading);
      if (text && !radios.some(radio => heading.contains(radio))) return text;
    }
    return nearbySection(element);
  }

  function chooseRadio(element, value) {
    const radios = radioGroup(element);
    const texts = radios.map(choiceText);
    let picked = globalThis.AutoFolioMatch.pickOption(value, texts);
    if (picked.index < 0) picked = globalThis.AutoFolioMatch.pickOption(value, radios.map(radio => radio.value));
    if (picked.index < 0) return { radio: null, detail: `선택지에서 "${value}"를 찾지 못했습니다 (${texts.join(", ")}).` };
    return { radio: radios[picked.index] };
  }

  function visible(element) {
    if (element.getAttribute("aria-hidden") === "true" || element.disabled || element.closest("[hidden], [inert]")) return false;
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || !element.getClientRects().length) return false;
    // Text boxes shrunk or faded out are data stores for widgets (e.g. a zip code set by an address search).
    // Radios and checkboxes are often hidden this way behind styled labels, so they stay.
    if (!(element instanceof HTMLInputElement && ["radio", "checkbox"].includes(element.type))) {
      const rect = element.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2 || Number(style.opacity) === 0 || element.classList.contains("hidden")) return false;
    }
    return true;
  }

  // A search box collapsed behind its visible label ("자격증검색") that opens when clicked.
  // recruiter.co.kr shows only the label; the input is shrunk or hidden until then.
  function collapsedSearch(element) {
    if (!isSearchInput(element) || element.disabled || element.closest("[hidden], [inert]")) return false;
    const holder = element.closest("label") || element.parentElement;
    return Boolean(holder?.getClientRects().length && getComputedStyle(holder).visibility !== "hidden" && textOf(holder));
  }

  function isField(element) {
    const inputType = element instanceof HTMLInputElement ? element.type : element.localName;
    return (visible(element) || collapsedSearch(element)) && !["hidden", "password", "file", "submit", "button", "reset", "image", "color", "range"].includes(inputType);
  }

  // Open a collapsed search box the way a person would: click its label, then focus it.
  async function openSearch(element) {
    if (!visible(element)) {
      (element.closest("label") || element.parentElement)?.click();
      await wait(250);
    }
    element.focus();
  }

  // Fields visible now, counting a radio group once, without replacing the scanned tokens.
  function countFields() {
    const groups = new Set();
    let count = 0;
    for (const element of document.querySelectorAll("input, textarea, select, [contenteditable='true']")) {
      if (!isField(element)) continue;
      if (element.type === "radio" && element.name) {
        if (groups.has(element.name)) continue;
        groups.add(element.name);
      }
      count++;
    }
    return count;
  }

  function scan() {
    elements = new Map();
    const fields = [];
    const candidates = document.querySelectorAll("input, textarea, select, [contenteditable='true']");
    const seenRadios = new Set();
    let index = 0;
    for (const element of candidates) {
      if (seenRadios.has(element) || !isField(element)) continue;
      const inputType = element instanceof HTMLInputElement ? element.type : element.localName;
      const radios = inputType === "radio" ? radioGroup(element) : null;
      radios?.forEach(radio => seenRadios.add(radio));
      const token = `af-${++index}`;
      elements.set(token, element);
      const section = nearbySection(element);
      let options = [];
      if (element instanceof HTMLSelectElement) options = [...element.options].map(o => ({ value: o.value, text: o.text.trim() }));
      if (radios) options = radios.map(radio => ({ value: radio.value, text: choiceText(radio) }));
      fields.push({
        token,
        label: radios ? groupLabel(element) : labelFor(element),
        ariaLabel: element.getAttribute("aria-label") || "",
        placeholder: element.getAttribute("placeholder") || "",
        title: element.getAttribute("title") || "",
        section,
        name: element.getAttribute("name") || "",
        id: element.id || "",
        inputType,
        required: element.required || element.getAttribute("aria-required") === "true" || Boolean(radios?.some(radio => radio.required)),
        options: options.slice(0, 80),
        loop: loopInfo(element)
      });
    }
    return fields;
  }

  function read(element) {
    if (element instanceof HTMLInputElement && element.type === "radio") return radioGroup(element).find(radio => radio.checked)?.value ?? "";
    if (element instanceof HTMLInputElement && element.type === "checkbox") return element.checked ? element.value : "";
    if (element instanceof HTMLSelectElement) return element.value;
    return "value" in element ? element.value : element.textContent;
  }

  function setNativeValue(element, value) {
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    setter.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }

  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const OPTION_SELECTOR = "[role='option'], .ui-menu-item, .autocomplete-suggestion, [class*='autocomplete'] li, [class*='suggest'] li, [class*='search-result'] li";

  function isSearchInput(element) {
    return element instanceof HTMLInputElement && (element.type === "search" || element.getAttribute("role") === "combobox" ||
      element.hasAttribute("aria-autocomplete") || element.hasAttribute("list") || /검색|search/i.test(element.placeholder));
  }

  // Result lists placed next to the box: <div class="search"><input><div class="searchResult">…</div></div>.
  function nearbyResultLists(element) {
    let node = element.parentElement;
    for (let depth = 0; node && depth < 3; depth++, node = node.parentElement) {
      const lists = [...node.querySelectorAll("[class*='result' i], [class*='suggest' i], [class*='autocomplete' i], [role='listbox']")]
        .filter(list => !list.contains(element) && !/name/i.test(list.className));
      // A wrapper inside a result list ("searchResult > resultWrap") is the same list.
      const outer = lists.filter(list => !lists.some(other => other !== list && other.contains(list)));
      if (outer.length) return outer;
    }
    return [];
  }

  // The clickable part of each result: the link or button inside a row, or the row itself.
  function resultItems(list) {
    const usable = item => visible(item) && item.getAttribute("aria-disabled") !== "true" && textOf(item);
    const rows = [...list.querySelectorAll("[role='option'], li, tr")];
    let items = (rows.length ? rows.map(row => row.querySelector("a, button") || row) : [...list.querySelectorAll("a, button")]).filter(usable);
    // recruiter.co.kr nests an <li> inside each result <button>; keep the outer one only.
    items = [...new Set(items)].filter(item => !items.some(other => other !== item && other.contains(item)));
    if (items.length) return items;
    // Results built from styled <div>/<span>: the outermost elements showing a pointer cursor...
    const pointer = element => getComputedStyle(element).cursor === "pointer";
    items = [...list.querySelectorAll("*")].filter(element => pointer(element) && !pointer(element.parentElement)).filter(usable);
    if (items.length) return items;
    // ...or else the repeated children under the list's single wrapper.
    let node = list;
    while (node.children.length === 1) node = node.children[0];
    return [...node.children].filter(usable);
  }

  // For the diagnostic log when no result is found: tag names only, e.g. "div.searchResult 안 요소 4개 (ul > li.item > span)".
  function describeResultLists(element) {
    const tag = node => node.localName + (node.classList.length ? `.${[...node.classList].slice(0, 2).join(".")}` : "");
    const lists = nearbyResultLists(element);
    if (!lists.length) return "옆에 결과 목록이 없음";
    return lists.slice(0, 2).map(list => {
      const inside = [...list.querySelectorAll("*")];
      return `${tag(list)} 안 요소 ${inside.length}개${inside.length ? ` (${inside.slice(0, 4).map(tag).join(" > ")})` : ""}`;
    }).join("; ");
  }

  // Prefer the list the input names, then one beside it; fall back to suggestion lists anywhere on the page.
  function visibleOptions(element) {
    const owned = ["aria-controls", "aria-owns"].flatMap(name => (element.getAttribute(name) || "").split(/\s+/))
      .map(id => id && document.getElementById(id)).filter(Boolean);
    if (owned.length) return owned.flatMap(resultItems);
    const nearby = [...new Set(nearbyResultLists(element).flatMap(resultItems))];
    if (nearby.length) return nearby;
    return [...document.querySelectorAll(OPTION_SELECTOR)]
      .filter(option => option !== element && visible(option) && option.getAttribute("aria-disabled") !== "true" && option.textContent.trim());
  }

  // Results from a previous search (stale) do not count until the list changes.
  async function waitForOptions(element, ms, stale = []) {
    for (let waited = 0; waited < ms; waited += 150) {
      await wait(150);
      const options = visibleOptions(element);
      if (options.length && options.some(option => !stale.includes(option))) return options;
    }
    return [];
  }

  function pressEnter(element) {
    // page-bridge.js presses Enter with a real keyCode from the page's world; without it, send what we can.
    if (document.documentElement.dataset.autofolioBridge) element.dispatchEvent(new Event("autofolio:enter", { bubbles: true }));
    else for (const type of ["keydown", "keypress", "keyup"]) element.dispatchEvent(new KeyboardEvent(type, { key: "Enter", code: "Enter", bubbles: true }));
  }

  // End a pick the way a person's click does: focus leaves the search box (sites often commit the
  // choice on blur), and inputs the pick changed announce it, so linked fields such as a
  // certificate's issuer and date get enabled (recruiter.co.kr links them via data-rel-id).
  async function finishPick(element, option, before) {
    if (option.isConnected && typeof option.focus === "function") option.focus();
    if (document.activeElement === element) element.blur();
    for (const [input, value] of before) {
      if (!input.isConnected || input === element || input.value === value) continue;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
    await wait(300);
  }

  // Fallback when the page did not react to the pick: open the fields the page itself marks as
  // belonging to it (data-rel-target naming the row's data-rel-id), but only when that linked
  // input now holds a value, i.e. the pick really happened. This is what the site does after a
  // person's click; nothing outside those marked fields is touched.
  async function openLinkedFields(row) {
    let opened = 0;
    for (const source of row.querySelectorAll("[data-rel-id]")) {
      const relId = source.dataset.relId;
      if (!relId || !source.value) continue;
      for (const field of document.querySelectorAll(`[data-rel-target="${CSS.escape(relId)}"]`)) {
        if (!field.disabled) continue;
        field.disabled = false;
        opened++;
      }
    }
    if (opened) {
      log(`세부 칸 ${opened}개를 직접 열었음 (사이트가 선택에 반응하지 않음)`);
      await wait(100);
    }
    return opened;
  }

  // After a pick, the text can land outside the box: a hidden input or a "selected" label in the same row.
  function shownNearby(element, text) {
    const { normalize } = globalThis.AutoFolioMatch;
    const wanted = normalize(text);
    if (normalize(read(element)) === wanted) return true;
    const row = element.closest(".row, li, tr, .field, .form-group") || element.parentElement?.parentElement;
    if (!row) return false;
    return [...row.querySelectorAll("input")].some(input => input !== element && normalize(input.value) === wanted) ||
      [...row.querySelectorAll("span, div, strong, em, p")].some(node => !node.children.length && normalize(node.textContent) === wanted);
  }

  function typeInto(element, value) {
    element.focus();
    element.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: value.slice(-1) }));
    setNativeValue(element, value);
    element.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: value.slice(-1) }));
  }

  function choose(option) {
    // Many widgets select on mousedown, before the input blurs and the list closes.
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup"]) {
      const EventType = type.startsWith("pointer") && globalThis.PointerEvent ? PointerEvent : MouseEvent;
      option.dispatchEvent(new EventType(type, { bubbles: true, cancelable: true, view: window }));
    }
    option.click();
  }

  async function fillSearch(item, element, value) {
    const { pickOption, normalize } = globalThis.AutoFolioMatch;
    const datalist = element.list;
    if (datalist) {
      const texts = [...datalist.options].map(option => option.value);
      const picked = pickOption(value, texts);
      if (picked.index < 0) return { token: item.token, status: "review", detail: `검색 목록: ${picked.reason}${picked.candidates.length ? ` (${picked.candidates.join(", ")})` : ""}` };
      setNativeValue(element, texts[picked.index]);
      return { token: item.token, status: read(element) === texts[picked.index] ? "filled" : "failed", detail: `검색 목록에서 선택 · ${picked.reason}`, expected: texts[picked.index] };
    }

    // Search by the saved name; if the site lists nothing like it, search again by its other
    // names ("SQLD" → "SQL개발자"). An ambiguous list stops the search and goes to the user.
    const { searchTerms } = globalThis.AutoFolioMatch;
    await openSearch(element);
    const needsEnter = /enter|엔터/i.test(`${element.placeholder} ${element.title}`);
    let options = [];
    let texts = [];
    let picked = { index: -1, reason: "", candidates: [] };
    const tried = [];
    for (const term of searchTerms(value).slice(0, 3)) {
      const stale = options;
      tried.push(term);
      typeInto(element, term);
      options = await waitForOptions(element, needsEnter ? 300 : 1200, stale);
      if (!options.length) {
        pressEnter(element);
        options = await waitForOptions(element, 5000, stale);
      }
      if (!options.length) continue;
      texts = options.map(option => textOf(option));
      picked = pickOption(value, texts);
      if (picked.index >= 0 || picked.candidates.length) break;
    }
    const searched = tried.length > 1 ? ` (검색어: ${tried.join(", ")})` : "";
    if (!options.length) {
      return { token: item.token, status: "review", detail: `검색 결과를 찾지 못했습니다${searched} [${describeResultLists(element)}]. 직접 선택하세요.` };
    }
    if (picked.index < 0) {
      // Show what the site listed, so a saved name that differs from the site's wording is easy to spot.
      const listed = picked.candidates.length ? picked.candidates : texts.slice(0, 3);
      const shown = listed.length ? ` (${picked.candidates.length ? "" : "결과: "}${listed.join(", ")}${!picked.candidates.length && texts.length > 3 ? " …" : ""})` : "";
      return { token: item.token, status: "review", detail: `검색 결과: ${picked.reason}${shown}${searched}. 직접 선택하세요.` };
    }
    const row = loopRow(element) || element.closest(".row, li, tr, .field, .form-group") || element.parentElement;
    const before = new Map([...row.querySelectorAll("input")].map(input => [input, input.value]));
    choose(options[picked.index]);
    await wait(300);
    await finishPick(element, options[picked.index], before);
    const stillOpen = visibleOptions(element).some(option => options.includes(option));
    if (!stillOpen && (shownNearby(element, texts[picked.index]) || normalize(read(element)) === normalize(value))) {
      // The box itself may be cleared after a pick, so the settle-time recheck is skipped (no expected).
      const check = picked.loose ? " · 비슷한 이름으로 골랐으니 확인하세요" : "";
      const opened = await openLinkedFields(row);
      const lockedNote = opened ? ` · 사이트가 열지 않은 세부 칸 ${opened}개를 직접 열었음` : "";
      return { token: item.token, status: "filled", detail: `검색 결과에서 "${texts[picked.index]}" 선택 · ${picked.reason}${check}${lockedNote}` };
    }
    return { token: item.token, status: "review", detail: `"${texts[picked.index]}"을 선택했지만 화면에서 확인되지 않습니다. 확인하세요.` };
  }

  function formattedValue(element, value) {
    if (!(element instanceof HTMLInputElement)) return value;
    const digits = value.replace(/\D/g, "");
    if (element.type === "date" && digits.length === 8) return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
    if (element.type === "month" && digits.length >= 6) return `${digits.slice(0, 4)}-${digits.slice(4, 6)}`;
    // Text date boxes: follow the format the page hints at (placeholder "YYYY.MM.DD", a date
    // already in the box, recruiter.co.kr's data-dates="birthday:YMD", maxlength 8, ...).
    const looksLikeDate = /^\d{4}\D?\d{2}(\D?\d{2})?\D?$/.test(value.trim());
    if (element.type === "text" && looksLikeDate) {
      const current = element.value.trim().match(/^\d{4}(\D)\d{2}(?:(\D)\d{2})?$/);
      const dates = (element.dataset.dates || "").match(/:(YMD|YM)\b/);
      const hint = [element.placeholder, element.title, element.dataset.format || "",
        current ? `yyyy${current[1]}mm${current[2] ? `${current[2]}dd` : ""}` : "",
        dates ? (dates[1] === "YMD" ? "yyyy.mm.dd" : "yyyy.mm") : ""].join(" ");
      const format = hint.match(/y{4}(\W?)m{2}(?:(\W?)d{2})?/i);
      if (format) {
        const [, first, second = ""] = format;
        return format[0].toLowerCase().includes("dd") && digits.length === 8
          ? `${digits.slice(0, 4)}${first}${digits.slice(4, 6)}${second}${digits.slice(6, 8)}`
          : `${digits.slice(0, 4)}${first}${digits.slice(4, 6)}`;
      }
      if (element.maxLength === digits.length) return digits;
    }
    return value;
  }

  async function fillOne(item) {
    const element = elements.get(item.token);
    if (!element?.isConnected) return { token: item.token, status: "skipped", detail: "필드가 바뀌었습니다. 다시 분석하세요." };
    const value = String(item.value ?? "").trim();
    if (!value) return { token: item.token, status: "skipped", detail: "저장된 값 없음" };
    try {
      if (element.readOnly) {
        return { token: item.token, status: "review", detail: "읽기 전용 칸입니다. 옆의 검색 버튼(예: 우편번호)으로 입력하세요." };
      }
      if (isSearchInput(element)) return await fillSearch(item, element, value);
      let expected = formattedValue(element, value);
      if (element instanceof HTMLSelectElement) {
        const options = [...element.options].filter(option => option.value !== "");
        let match = options.find(option => option.value === value);
        if (!match) {
          const picked = globalThis.AutoFolioMatch.pickOption(value, options.map(option => option.text));
          if (picked.index < 0) {
            const shown = picked.candidates.length ? ` (비슷한 항목: ${picked.candidates.join(", ")})` : "";
            return { token: item.token, status: "review", detail: `선택 목록에서 확실한 항목을 찾지 못했습니다${shown}. 직접 선택하세요.` };
          }
          match = options[picked.index];
        }
        expected = match.value;
        element.value = expected;
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
      } else if (element instanceof HTMLInputElement && element.type === "radio") {
        const { radio, detail } = chooseRadio(element, value);
        if (!radio) return { token: item.token, status: "review", detail };
        if (!radio.checked) radio.click();
        const ok = radio.checked;
        return { token: item.token, status: ok ? "filled" : "failed", detail: ok ? `"${choiceText(radio)}" 선택` : "선택되지 않았습니다.", expected: radio.value };
      } else if (element instanceof HTMLInputElement && element.type === "checkbox") {
        if (element.value !== value && labelFor(element) !== value) return { token: item.token, status: "skipped", detail: "선택 항목과 값이 다릅니다." };
        if (!element.checked) element.click();
        expected = element.value;
      } else if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
        setNativeValue(element, expected);
      } else if (element.isContentEditable) {
        element.textContent = value;
        element.dispatchEvent(new InputEvent("input", { bubbles: true, data: value, inputType: "insertText" }));
      } else return { token: item.token, status: "skipped", detail: "지원하지 않는 입력 방식" };
      const ok = read(element) === expected;
      return { token: item.token, status: ok ? "filled" : "failed", detail: ok ? "입력값 확인" : "화면에서 값이 확인되지 않습니다.", expected };
    } catch (error) {
      return { token: item.token, status: "failed", detail: error.message };
    }
  }

  function onMessage(message, _sender, sendResponse) {
    if (message.action === "scan") {
      const fields = scan();
      log(`입력칸 ${fields.length}개 분석`);
      console.table?.(fields.map(({ token, label, section, name, inputType, required }) => ({ token, label, section, name, inputType, required })));
      sendResponse({ fields, url: location.href });
    }
    if (message.action === "addRows") {
      addRows(message.key, Math.min(message.times, 10)).then(added => sendResponse({ added }));
      return true;
    }
    if (message.action === "fill") {
      (async () => {
        // One at a time: search lists from different fields would otherwise overlap.
        const results = [];
        log(`${message.items.length}개 칸 입력 시작`);
        for (const item of message.items) {
          const result = await fillOne(item);
          const element = elements.get(item.token);
          log(`${result.status.padEnd(7)} ${item.token} ${element ? labelFor(element) || element.name : ""} — ${result.detail}`);
          results.push(result);
        }
        // Controlled inputs can rerender after an event. Verify once more after the page settles.
        await wait(350);
        for (const result of results) {
          if (result.status !== "filled" || result.expected === undefined) continue;
          const element = elements.get(result.token);
          if (!element?.isConnected || read(element) !== result.expected) {
            result.status = "failed";
            result.detail = "입력 후 페이지 상태가 바뀌었습니다.";
            log(`failed  ${result.token} — 재확인에서 값이 바뀜`);
          }
        }
        const invalidFields = [...document.querySelectorAll("input, textarea, select")]
          .filter(element => visible(element) && (element.getAttribute("aria-invalid") === "true" || (element.required && !element.checkValidity())))
          .map(element => (element.type === "radio" ? groupLabel(element) : labelFor(element)) || element.name || "설명 없는 필수 항목")
          .filter((label, index, all) => all.indexOf(label) === index);
        const counts = results.reduce((sum, result) => ({ ...sum, [result.status]: (sum[result.status] || 0) + 1 }), {});
        log("입력 완료", counts, invalidFields.length ? `미완료/오류 칸: ${invalidFields.join(", ")}` : "");
        // Picking a certificate can enable its issuer and date fields, which the first scan skipped.
        const newFields = countFields() - elements.size;
        if (newFields > 0) log(`선택 후 새로 열린 칸 ${newFields}개`);
        sendResponse({ results, invalidFields, newFields: Math.max(0, newFields) });
      })();
      return true;
    }
    return false;
  }
  globalThis.__autofolioListener = onMessage;
  chrome.runtime.onMessage.addListener(onMessage);
})();
