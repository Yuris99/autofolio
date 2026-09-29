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
  const HEADINGS = ":scope > legend, :scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > .section-title, :scope > header, " +
    ":scope > :not(label)[class*='title' i], :scope > :not(label)[class*='heading' i]";
  function nearbySection(element) {
    let node = element.parentElement;
    for (let depth = 0; node && depth < 8; depth++, node = node.parentElement) {
      const text = textOf(node.querySelector(HEADINGS)).slice(0, 100);
      if (text) return text;
      if (node.matches("fieldset") && node.getAttribute("aria-label")) return node.getAttribute("aria-label");
    }
    return "";
  }

  // A row title placed before the input or its wrapper: <label class="title">계급</label><label class="select"><select>,
  // or in newer forms any short text element: <div class="label">이름</div><div><input></div>.
  function rowTitle(element) {
    let node = element;
    for (let depth = 0; node && depth < 3; depth++, node = node.parentElement) {
      for (let sibling = node.previousElementSibling; sibling; sibling = sibling.previousElementSibling) {
        if (sibling.matches("input, select, textarea") || sibling.querySelector("input, select, textarea")) break;
        const text = sibling.querySelector(CONTROLS) ? "" : textOf(sibling);
        if (text && text.length <= 30) return text;
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
    const next = radio.nextElementSibling;
    const nextText = next && !next.matches(CONTROLS) && !next.querySelector("input") ? textOf(next) : "";
    const own = [...(radio.labels || [])].map(textOf).filter(Boolean).join(" ");
    return textOf(radio.closest("label")) || own || nextText || (radio.value && radio.value !== "on" ? radio.value : "") || radio.name;
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
    const scope = element.form || document;
    const named = element.name ? [...scope.querySelectorAll(`input[type="radio"][name="${CSS.escape(element.name)}"]`)] : [element];
    if (named.length > 1) return named;
    // Some forms give each choice its own name (name="남", name="여"): radios side by side whose
    // names are all unique are one question.
    for (let node = element.parentElement, depth = 0; node && depth < 3; node = node.parentElement, depth++) {
      const radios = [...node.querySelectorAll("input[type='radio']")];
      if (radios.length < 2) continue;
      const lonely = radios.every(radio => !radio.name || radios.filter(other => other.name === radio.name).length === 1);
      return lonely ? radios : named;
    }
    return named;
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
    // Newer forms: <div class="form-label">성별</div><div>(radios)</div>.
    let common = element.parentElement;
    while (common && !radios.every(radio => common.contains(radio))) common = common.parentElement;
    return (common && rowTitle(common)) || nearbySection(element);
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
    // Click into the box like a person, so the page knows which row is being worked on.
    const target = visible(element) ? element : element.closest("label") || element.parentElement;
    target.scrollIntoView?.({ block: "center" });
    pointerSequence(target, ["pointerover", "mouseover", "pointermove", "mousemove", "pointerdown", "mousedown"]);
    element.focus();
    if (document.activeElement !== element) {
      element.dispatchEvent(new FocusEvent("focus"));
      element.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    }
    pointerSequence(target, ["pointerup", "mouseup"]);
    if (target === element) element.click();
    await wait(100);
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

  // Boxes that together hold one value: 010 - 1234 - 5678, id @ domain [domain list], 1999 년 03 월.
  // Consecutive boxes in one cell, with only a separator (or nothing) between them, where either a
  // separator is shown or every box is too short for a whole value. "~" (a range) never joins.
  let partOf = new Map();
  const PART_TEXT = /^[\s\-–@.\/()년월일]*$/;
  function partKind(element) {
    if (element instanceof HTMLSelectElement) return "select";
    return element instanceof HTMLInputElement && ["text", "tel", "email", "number"].includes(element.type) && !isSearchInput(element) ? "text" : null;
  }
  function betweenText(a, b) {
    const range = document.createRange();
    range.setStartAfter(a);
    range.setEndBefore(b);
    return range.toString().replace(/\s+/g, " ").trim();
  }
  // Names ending in a part (BirthdateY/M/D, cHstartdateY/M, Name_en_first/last) join by name alone;
  // named boxes whose names differ otherwise (cHstartdateM, HighschoolStartType) never join.
  const PART_SUFFIX = /(?:[_-]?(?:[Yy]ear|[Mm]onth|[Dd]ay|[Ff]irst|[Ll]ast|[Gg]iven|[Ff]amily)|[_-]?[YMD]|_[ymd])$/;
  function stemOf(element) {
    const name = element.getAttribute("name") || "";
    const suffix = name.match(PART_SUFFIX);
    return suffix ? { stem: name.slice(0, suffix.index), strong: true } : { stem: name.replace(/\d+$/, ""), strong: false };
  }
  function joins(a, b) {
    if (!partKind(a) || !partKind(b)) return false;
    const box = a.closest("td, dd, li, .input-group, .form-group, .field") || a.parentElement?.parentElement;
    if (!box?.contains(b)) return false;
    if (a.getAttribute("name") && b.getAttribute("name")) {
      const [first, second] = [stemOf(a), stemOf(b)];
      if (first.stem !== second.stem) return false;
      if (first.strong && second.strong) return true;
    }
    const own = element => [...(element.labels || [])].map(textOf).join(" ").replace(/[\s년월일]/g, "");
    if (own(b) && own(b) !== own(a)) return false;
    const between = betweenText(a, b);
    return between.length <= 3 && PART_TEXT.test(between);
  }
  function findParts(list) {
    const groups = new Map();
    let run = [];
    const flush = () => {
      const separated = run.slice(1).some((element, i) => betweenText(run[i], element));
      const short = run.every(element => element instanceof HTMLSelectElement || (element.maxLength > 0 && element.maxLength <= 4));
      const named = run.every(element => stemOf(element).strong && stemOf(element).stem === stemOf(run[0]).stem);
      if (run.length >= 2 && run.length <= 4 && (separated || short || named)) run.forEach((element, index) => groups.set(element, { members: run, index }));
      run = [];
    };
    for (const element of list) {
      if (!run.length || joins(run.at(-1), element)) run.push(element);
      else { flush(); run.push(element); }
    }
    flush();
    return groups;
  }

  function scan() {
    elements = new Map();
    const fields = [];
    const candidates = [...document.querySelectorAll("input, textarea, select, [contenteditable='true']")].filter(isField);
    partOf = findParts(candidates.filter(element => element.type !== "radio" && element.type !== "checkbox"));
    const seenRadios = new Set();
    let index = 0;
    for (const element of candidates) {
      if (seenRadios.has(element)) continue;
      const inputType = element instanceof HTMLInputElement ? element.type : element.localName;
      const radios = inputType === "radio" ? radioGroup(element) : null;
      radios?.forEach(radio => seenRadios.add(radio));
      const token = `af-${++index}`;
      elements.set(token, element);
      const section = nearbySection(element);
      let options = [];
      if (element instanceof HTMLSelectElement) options = [...element.options].map(o => ({ value: o.value, text: o.text.trim() }));
      if (radios) options = radios.map(radio => ({ value: radio.value, text: choiceText(radio) }));
      const part = partOf.get(element);
      let label = radios ? groupLabel(element) : labelFor(element);
      // A box labelled only by its unit ("년") is named by its row.
      if (part && label.replace(/[\s년월일@\-]/g, "").length === 0) label = rowTitle(part.members[0]) || label;
      fields.push({
        token,
        label,
        part: part ? { index: part.index, count: part.members.length } : null,
        readOnly: Boolean(element.readOnly),
        searchButton: (() => { const button = radios ? null : searchButtonFor(element); return button ? buttonText(button).replace(/\s+/g, " ").trim().slice(0, 40) : ""; })(),
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

  // A pick that asks for a login: the page opened a window (seen by page-bridge.js), or a password
  // field or a frame (a login layer) appeared that was not there before.
  function loginSignals() {
    return new Set([...document.querySelectorAll("input[type='password'], iframe")].filter(node => node.getClientRects().length));
  }
  function loginOpened(before, since) {
    if (Number(document.documentElement.dataset.autofolioPopupAt || 0) >= since) return true;
    return [...loginSignals()].some(node => !before.has(node));
  }
  // Logged in (or given up): every window the page opened is closed and the login layer is gone.
  function loginClosed(before) {
    if (document.documentElement.dataset.autofolioPopupOpen) return false;
    return ![...loginSignals()].some(node => !before.has(node));
  }

  // A notice on the page itself: the extension popup closes as soon as the user clicks elsewhere,
  // e.g. into the login window, so it cannot be where the user is told what is going on.
  function showNotice(text, buttons = []) {
    document.querySelector("[data-autofolio-notice]")?.remove();
    const box = document.createElement("div");
    box.dataset.autofolioNotice = "";
    box.setAttribute("role", "alert");
    Object.assign(box.style, {
      position: "fixed", top: "16px", left: "50%", transform: "translateX(-50%)", zIndex: "2147483647",
      maxWidth: "min(480px, calc(100vw - 32px))", padding: "14px 18px", borderRadius: "10px",
      background: "#1f2937", color: "#fff", font: "14px/1.5 system-ui, sans-serif", boxShadow: "0 6px 24px rgba(0,0,0,.3)"
    });
    const message = document.createElement("div");
    message.textContent = `AutoFolio · ${text}`;
    box.append(message);
    const choice = new Promise(resolve => {
      if (!buttons.length) return;
      const bar = document.createElement("div");
      Object.assign(bar.style, { display: "flex", gap: "8px", marginTop: "10px", justifyContent: "flex-end" });
      for (const [value, label] of buttons) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = label;
        Object.assign(button.style, { padding: "5px 12px", border: "0", borderRadius: "6px", cursor: "pointer", font: "inherit",
          background: value === buttons[0][0] ? "#3b82f6" : "#4b5563", color: "#fff" });
        button.addEventListener("click", () => resolve(value));
        bar.append(button);
      }
      box.append(bar);
    });
    document.body.append(box);
    return { choice, close: () => box.remove() };
  }

  const LOGIN_WAIT_MS = 10 * 60 * 1000;
  let loginWaited = false;

  // Tell the user to log in and wait until the login window or layer closes. The user can also
  // say it is done (a layer that stays after login) or skip the row. AutoFolio never types into it.
  async function waitForLogin(name, before) {
    const notice = showNotice(`"${name}"을 고르자 로그인 창이 열렸습니다. 로그인하면 이어서 채웁니다. 로그인 정보는 AutoFolio가 입력하지 않습니다.`,
      [["done", "로그인 완료"], ["skip", "이 줄 건너뛰기"]]);
    let answer = null;
    notice.choice.then(value => { answer = value; });
    const until = Date.now() + LOGIN_WAIT_MS;
    while (!answer && Date.now() < until) {
      await wait(500);
      if (!answer && loginClosed(before)) answer = "closed";
    }
    notice.close();
    return answer || "timeout";
  }

  function linkedFields(row) {
    return [...row.querySelectorAll("[data-rel-id]")].flatMap(source => source.dataset.relId
      ? [...document.querySelectorAll(`[data-rel-target="${CSS.escape(source.dataset.relId)}"]`)] : []);
  }

  // True once every field linked to the row is enabled (or the row has none).
  async function waitForLinkedFields(row, ms) {
    for (let waited = 0; ; waited += 150) {
      const fields = linkedFields(row);
      if (!fields.some(field => field.disabled)) {
        if (fields.length) await wait(200);
        return true;
      }
      if (waited >= ms) return false;
      await wait(150);
    }
  }

  // Fallback when the page did not react to a pick it shows: open the fields the page itself marks
  // as belonging to it (data-rel-target naming the row's data-rel-id). On recruiter.co.kr only the
  // newest "+" row reacts to picks, so rows added earlier stay locked after a successful pick.
  // Called only after the pick is confirmed on screen; nothing outside those marked fields is touched.
  async function openLinkedFields(row) {
    let opened = 0;
    for (const source of row.querySelectorAll("[data-rel-id]")) {
      const relId = source.dataset.relId;
      if (!relId) continue;
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

  // The mouse events a person's click produces, in order. Widgets often track the hovered item or
  // the row being worked on from these, not from the click alone.
  function pointerSequence(target, types) {
    const rect = target.getBoundingClientRect();
    const at = { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
    for (const type of types) {
      const EventType = type.startsWith("pointer") && globalThis.PointerEvent ? PointerEvent : MouseEvent;
      const bubbles = !["mouseenter", "mouseleave", "pointerenter", "pointerleave"].includes(type);
      target.dispatchEvent(new EventType(type, { bubbles, cancelable: true, view: window, button: 0, buttons: /down/.test(type) ? 1 : 0, ...at }));
    }
  }

  function choose(option) {
    option.scrollIntoView?.({ block: "nearest" });
    pointerSequence(option, ["pointerover", "pointerenter", "mouseover", "mouseenter", "pointermove", "mousemove"]);
    // Many widgets select on mousedown, before the input blurs and the list closes.
    pointerSequence(option, ["pointerdown", "mousedown"]);
    if (typeof option.focus === "function") option.focus();
    pointerSequence(option, ["pointerup", "mouseup"]);
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
    const loginBefore = loginSignals();
    const pickedAt = Date.now();
    choose(options[picked.index]);
    await wait(300);
    let loginNote = "";
    if (loginOpened(loginBefore, pickedAt)) {
      log(`로그인 창이 열려 대기: ${texts[picked.index]}`);
      loginWaited = true;
      const answer = await waitForLogin(texts[picked.index], loginBefore);
      log(`로그인 대기 끝 (${answer}): ${texts[picked.index]}`);
      if (answer === "skip" || answer === "timeout") {
        const why = answer === "skip" ? "건너뛰기를 눌러" : "10분 동안 로그인이 끝나지 않아";
        return { token: item.token, status: "review", detail: `"${texts[picked.index]}"을 고르자 로그인 창이 열렸고(예: YBM 성적 조회), ${why} 이 줄은 채우지 않았습니다. AutoFolio는 로그인 정보를 입력하지 않습니다.` };
      }
      loginNote = " · 로그인 후 이어서 진행";
    }
    await finishPick(element, options[picked.index], before);
    const stillOpen = visibleOptions(element).some(option => options.includes(option));
    if (!stillOpen && (shownNearby(element, texts[picked.index]) || normalize(read(element)) === normalize(value))) {
      // The box itself may be cleared after a pick, so the settle-time recheck is skipped (no expected).
      const check = picked.loose ? " · 비슷한 이름으로 골랐으니 확인하세요" : "";
      // Let the page finish its reaction (often a server round trip) before the next search starts;
      // moving on too early made it open the wrong row, or none, depending on network speed.
      const settled = await waitForLinkedFields(row, 4000);
      const opened = settled ? 0 : await openLinkedFields(row);
      const lockedNote = opened ? ` · 사이트가 열지 않은 세부 칸 ${opened}개를 직접 열었음` : "";
      return { token: item.token, status: "filled", detail: `검색 결과에서 "${texts[picked.index]}" 선택 · ${picked.reason}${check}${loginNote}${lockedNote}` };
    }
    return { token: item.token, status: "review", detail: `"${texts[picked.index]}"을 선택했지만 화면에서 확인되지 않습니다${loginNote}. 확인하세요.` };
  }

  // Help text next to a box often carries the example ("예) 010-1234-5678").
  function helpText(element) {
    const described = (element.getAttribute("aria-describedby") || "").split(/\s+/)
      .map(id => id && document.getElementById(id)?.textContent).filter(Boolean);
    const next = element.nextElementSibling;
    const beside = next && !next.matches("input, select, textarea, button") && next.textContent.trim().length <= 40 ? [next.textContent] : [];
    return [...described, ...beside].join(" ");
  }

  function formattedValue(element, value) {
    if (!(element instanceof HTMLInputElement)) return value;
    const dates = (element.dataset.dates || "").match(/:(YMD|YM)\b/);
    const text = [element.placeholder, element.title, element.dataset.format || "", helpText(element),
      dates ? (dates[1] === "YMD" ? "yyyy.mm.dd" : "yyyy.mm") : ""].join(" ");
    return globalThis.AutoFolioFormat.formatValue(value, { type: element.type, text, current: element.value, maxLength: element.maxLength });
  }

  function setSelect(select, value) {
    select.value = value;
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // One piece in a split box. Lists match "3" to "03", and a domain not listed picks "직접입력".
  function setPart(element, piece) {
    if (!(element instanceof HTMLSelectElement)) {
      setNativeValue(element, piece);
      return read(element) === piece;
    }
    const options = [...element.options].filter(option => option.value !== "");
    const numeric = /^\d+$/.test(piece);
    const same = option => [option.value, option.text.trim()].some(text =>
      text === piece || (numeric && /^\d+$/.test(text) && Number(text) === Number(piece)) ||
      globalThis.AutoFolioMatch.normalize(text) === globalThis.AutoFolioMatch.normalize(piece));
    const match = options.find(same) || options.find(option => /직접\s*입력|direct/i.test(option.text));
    if (!match) return false;
    setSelect(element, match.value);
    return element.value === match.value;
  }

  // English names over a family-name box and a given-name box: saved as "HONG GILDONG" (family first).
  function nameParts(members, value) {
    const names = members.map(element => element.getAttribute("name") || "");
    const family = names.findIndex(name => /last|family|sur/i.test(name));
    const given = names.findIndex(name => /first|given/i.test(name));
    const words = value.split(/\s+/).filter(Boolean);
    if (members.length !== 2 || family < 0 || given < 0 || words.length < 2 || /[^A-Za-z\s,'-]/.test(value)) return null;
    const pieces = [];
    pieces[family] = words[0].replace(/,$/, "");
    pieces[given] = words.slice(1).join(" ");
    return pieces.map((piece, index) => formattedValue(members[index], piece));
  }

  async function fillParts(item, members, value) {
    const pieces = nameParts(members, value) ||
      globalThis.AutoFolioFormat.splitValue(value, members.map(element => ({ kind: partKind(element), maxLength: element.maxLength })));
    if (!pieces) return { token: item.token, status: "review", detail: `칸 ${members.length}개로 나뉜 항목인데 값을 나누는 방법을 모르겠습니다. 직접 입력하세요.` };
    const failed = members.filter((element, index) => !setPart(element, pieces[index]));
    if (failed.length) return { token: item.token, status: "review", detail: `칸 ${members.length}개로 나눠 넣었지만 ${failed.length}개가 들어가지 않았습니다(목록에 없는 값). 확인하세요.` };
    return { token: item.token, status: "filled", detail: `칸 ${members.length}개에 나눠 입력` };
  }

  // Undo: what a fill may change, recorded before it runs. A search pick also changes hidden inputs,
  // the shown name and the detail fields it unlocks in its row.
  const fillHistory = [];
  function touched(element) {
    if (element.type === "radio") return radioGroup(element);
    const part = partOf.get(element);
    if (part) return part.members;
    if (!isSearchInput(element)) return [element];
    const row = loopRow(element) || element.closest(".row, li, tr, .field, .form-group") || element.parentElement;
    return [...row.querySelectorAll("input, select, textarea"), ...linkedFields(row),
      ...[...row.querySelectorAll("span, strong, em, p, div")].filter(node => !node.children.length)];
  }
  function snapshot(nodes) {
    return [...new Set(nodes)].map(node => ({ node, value: node.value, checked: node.checked, disabled: node.disabled,
      text: node.matches("input, select, textarea") ? undefined : node.textContent }));
  }
  function restore(snaps) {
    let changed = 0;
    for (const { node, value, checked, disabled, text } of [...snaps].reverse()) {
      if (!node.isConnected) continue;
      if (text !== undefined) {
        if (node.textContent !== text) { node.textContent = text; changed++; }
        continue;
      }
      if (node.disabled !== disabled) node.disabled = disabled;
      if (node.type === "radio" || node.type === "checkbox") {
        if (node.checked === checked) continue;
        node.checked = checked;
        node.dispatchEvent(new Event("change", { bubbles: true }));
      } else if (node.value !== value) {
        if (node instanceof HTMLSelectElement) setSelect(node, value);
        else if (node.isContentEditable) node.textContent = value;
        else setNativeValue(node, value);
      } else continue;
      changed++;
    }
    return changed;
  }
  function undoLast() {
    const entry = fillHistory.pop();
    if (!entry) return null;
    const changed = restore(entry.snaps);
    log(`되돌리기: ${entry.label} (${changed}곳)`);
    return { ...entry, changed };
  }

  // Fill one item and record how to undo it.
  async function fillRecorded(item, snaps) {
    const element = elements.get(item.token);
    if (element?.isConnected) snaps.push(...snapshot(touched(element)));
    const result = await fillOne(item);
    log(`${result.status.padEnd(7)} ${item.token} ${element ? labelFor(element) || element.name : ""} — ${result.detail}`);
    return result;
  }

  function undoNotice(text) {
    if (!fillHistory.length) {
      const notice = showNotice(text, [["close", "닫기"]]);
      notice.choice.then(notice.close);
      return;
    }
    const notice = showNotice(`${text} 되돌릴 수 있는 입력 ${fillHistory.length}건.`, [["undo", "되돌리기"], ["close", "닫기"]]);
    notice.choice.then(answer => {
      notice.close();
      if (answer !== "undo") return;
      const undone = undoLast();
      undoNotice(`"${undone.label}"을 되돌렸습니다(${undone.changed}곳). 사이트가 서버에 보낸 내용(시험 성적 조회 등)은 되돌리지 못할 수 있습니다.`);
    });
  }

  // Step through fields one at a time, like an editor's find-and-replace: fill, skip, go back,
  // fill the rest, undo. Lives on the page because the extension popup closes on any page click.
  let stepBar = null;
  function outline(element, on) {
    const target = visible(element) ? element : element.closest("label") || element.parentElement;
    if (!target) return;
    if (on) {
      target.dataset.autofolioOutline = target.style.outline;
      target.style.outline = "3px solid #3b82f6";
      target.scrollIntoView?.({ block: "center", behavior: "smooth" });
    } else if ("autofolioOutline" in target.dataset) {
      target.style.outline = target.dataset.autofolioOutline;
      delete target.dataset.autofolioOutline;
    }
  }
  function preview(item) {
    const element = elements.get(item.token);
    const part = element && partOf.get(element);
    if (part) {
      const pieces = nameParts(part.members, String(item.value)) ||
        globalThis.AutoFolioFormat.splitValue(item.value, part.members.map(member => ({ kind: partKind(member), maxLength: member.maxLength })));
      return pieces ? pieces.join(" | ") : item.value;
    }
    return element && !isSearchInput(element) ? formattedValue(element, String(item.value)) : String(item.value);
  }

  // Tell an open extension popup where the step bar is. Nothing listens when the popup is closed.
  function announce(step) {
    try { chrome.runtime.sendMessage?.({ event: "stepState", step })?.catch?.(() => {}); } catch { /* popup closed or extension reloaded */ }
  }

  function startSteps(items) {
    stepBar?.close();
    let cursor = 0;
    let busy = false;
    let note = "";
    const done = new Map();
    const box = document.createElement("div");
    box.dataset.autofolioBar = "";
    Object.assign(box.style, {
      position: "fixed", right: "16px", bottom: "16px", zIndex: "2147483647", width: "min(380px, calc(100vw - 32px))",
      padding: "12px 14px", borderRadius: "10px", background: "#1f2937", color: "#fff",
      font: "13px/1.5 system-ui, sans-serif", boxShadow: "0 6px 24px rgba(0,0,0,.3)"
    });
    const head = document.createElement("div");
    const body = document.createElement("div");
    const status = document.createElement("div");
    Object.assign(head.style, { fontWeight: "600", marginBottom: "6px" });
    Object.assign(body.style, { wordBreak: "break-all" });
    Object.assign(status.style, { marginTop: "6px", color: "#cbd5e1", fontSize: "12px" });
    const bar = document.createElement("div");
    Object.assign(bar.style, { display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "10px" });
    const buttons = {};
    for (const [name, text, primary] of [["fill", "채우기", true], ["prev", "◀ 이전"], ["next", "건너뛰기 ▶"], ["all", "남은 칸 모두 채우기"], ["undo", "되돌리기"], ["close", "닫기"]]) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = text;
      Object.assign(button.style, { padding: "4px 10px", border: "0", borderRadius: "6px", cursor: "pointer", font: "inherit",
        background: primary ? "#3b82f6" : "#4b5563", color: "#fff" });
      button.addEventListener("click", () => act(name));
      buttons[name] = button;
      bar.append(button);
    }
    box.append(head, body, status, bar);
    document.body.append(box);

    const current = () => items[cursor];
    function show() {
      items.forEach(item => { const element = elements.get(item.token); if (element) outline(element, false); });
      const item = current();
      if (item) {
        const element = elements.get(item.token);
        if (element?.isConnected) outline(element, true);
        const state = done.get(item.token);
        head.textContent = `AutoFolio 하나씩 채우기 · ${cursor + 1} / ${items.length}`;
        body.textContent = `${item.label || "입력칸"} → ${preview(item)}${state ? `  (${state === "filled" ? "채움" : "확인 필요"})` : ""}`;
      } else {
        head.textContent = `AutoFolio 하나씩 채우기 · 끝`;
        body.textContent = `채움 ${[...done.values()].filter(state => state === "filled").length}개 · 확인 필요 ${[...done.values()].filter(state => state !== "filled").length}개. 새로 열린 칸은 확장을 다시 열어 분석하세요. 제출 전에 확인하세요.`;
      }
      status.textContent = note;
      buttons.fill.disabled = buttons.all.disabled = busy || !item;
      buttons.prev.disabled = busy || cursor === 0;
      buttons.next.disabled = busy || !item;
      buttons.undo.disabled = busy || !fillHistory.length;
      for (const button of Object.values(buttons)) button.style.opacity = button.disabled ? ".5" : "1";
      announce(state());
    }
    // What the extension popup shows beside its own list, so it can follow along.
    function state() {
      const item = current();
      return { total: items.length, cursor, busy, note, finished: !item, undoable: fillHistory.length > 0,
        token: item?.token || null, label: item?.label || "", preview: item ? preview(item) : "", done: Object.fromEntries(done) };
    }
    async function fillAt(indexes, label) {
      const snaps = [];
      const results = [];
      for (const index of indexes) {
        const result = await fillRecorded(items[index], snaps);
        done.set(items[index].token, result.status);
        results.push(result);
      }
      fillHistory.push({ label, snaps, cursor: indexes[0] });
      return results;
    }
    async function act(name) {
      if (busy) return state();
      if (name === "close") { close(); return { closed: true }; }
      if (name === "prev") cursor = Math.max(0, cursor - 1);
      if (name === "next") cursor = Math.min(items.length, cursor + 1);
      if (name === "fill" || name === "all") {
        busy = true;
        show();
        const indexes = name === "fill" ? [cursor] : items.map((_, index) => index).slice(cursor);
        const results = await fillAt(indexes, name === "fill" ? current().label || "입력칸" : `남은 칸 ${indexes.length}개`);
        note = name === "fill" ? results[0].detail : `${results.filter(result => result.status === "filled").length}/${results.length}개 채움`;
        cursor = Math.min(items.length, indexes.at(-1) + 1);
        busy = false;
      }
      if (name === "undo") {
        const undone = undoLast();
        if (undone) {
          note = `되돌림: ${undone.label} (${undone.changed}곳)`;
          if (undone.cursor !== undefined) {
            cursor = undone.cursor;
            for (const item of items.slice(cursor)) done.delete(item.token);
          }
        }
      }
      show();
      return state();
    }
    function close() {
      items.forEach(item => { const element = elements.get(item.token); if (element) outline(element, false); });
      box.remove();
      stepBar = null;
      announce({ closed: true });
    }
    stepBar = { close, act, state };
    show();
  }

  // ── Search buttons ─────────────────────────────────────────────────────────────────────────────
  // Fields a site fills through its own search: type, then press [검색]; or press [검색]/[우편번호 찾기]
  // first and pick in what opens. What opens is found, not assumed: a list beside the box, a layer
  // (or a same-origin frame in it), Kakao's postcode search (postcode-frame.js answers from inside
  // it), or a new window, which is left to the user. If nothing works the saved value goes in
  // directly and the field is marked for checking.
  const SEARCH_BUTTON = /검색|찾기|조회|search|find|우편\s*번호|주소/i;
  const NOT_SEARCH = /삭제|취소|초기화|닫기|close|reset|remove|delete|clear/i;
  const SEARCH_TYPES = /^(education\.school|certificate\.name|language\.test|personal\.(zipCode|address))$/;
  const ADDRESS_TYPES = /^personal\.(zipCode|address)$/;
  const CLICKABLE = "button, a, input[type='button'], input[type='image'], input[type='submit'], [role='button']";
  let fillValues = {};

  function buttonText(button) {
    return [button.textContent, button.value, button.title, button.getAttribute("aria-label"), button.getAttribute("alt"),
      button.querySelector?.("img")?.alt, typeof button.className === "string" ? button.className : ""].filter(Boolean).join(" ");
  }
  const isSearchButton = button => SEARCH_BUTTON.test(buttonText(button)) && !NOT_SEARCH.test(buttonText(button));

  function searchButtonFor(element) {
    let node = element.parentElement;
    for (let depth = 0; node && node !== document.body && depth < 3; depth++, node = node.parentElement) {
      const found = [...node.querySelectorAll(CLICKABLE)].find(button => button !== element && visible(button) && isSearchButton(button));
      if (found) return found;
    }
    return null;
  }

  // Kakao's postcode frames say "ready" when they load or when pinged; results come back by id.
  const postcode = { source: null, readyAt: 0, results: new Map() };
  if (globalThis.__autofolioMessages) window.removeEventListener("message", globalThis.__autofolioMessages);
  globalThis.__autofolioMessages = event => {
    const data = event.data;
    if (data?.autofolio !== "postcode") return;
    if (data.type === "ready") { postcode.source = event.source; postcode.readyAt = Date.now(); }
    if (data.type === "result") postcode.results.set(data.id, data);
  };
  window.addEventListener("message", globalThis.__autofolioMessages);
  function pingFrames(win = window) {
    for (let index = 0; index < win.frames.length; index++) {
      try { win.frames[index].postMessage({ autofolio: "postcode-ping" }, "*"); pingFrames(win.frames[index]); } catch { /* gone */ }
    }
  }

  async function postcodeSearch(query, zip) {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    postcode.source.postMessage({ autofolio: "postcode-search", id, query, zip }, "*");
    // The frame reloads to search, then answers.
    for (let waited = 0; waited < 15000; waited += 200) {
      await wait(200);
      if (postcode.results.has(id)) return postcode.results.get(id);
    }
    return { status: "review", detail: "우편번호 검색이 응답하지 않습니다. 직접 검색하세요." };
  }

  // Layers that can hold a search: dialog-like containers, and anything around a text box that was
  // not on screen before the button was pressed.
  const DIALOG = "[role='dialog'], dialog[open], .modal, [class*='layer' i], [class*='popup' i], [class*='pop_' i], [id*='layer' i], [id*='popup' i], [id*='modal' i]";
  const ours = node => node.closest("[data-autofolio-notice], [data-autofolio-bar]");
  function textBoxes(root) {
    return [...root.querySelectorAll("input:not([type]), input[type='text'], input[type='search']")].filter(input => visible(input) && !ours(input));
  }
  function openLayers() {
    const found = [...document.querySelectorAll(DIALOG)].filter(node => !ours(node) && visible(node) && node.querySelector("input, iframe, li, tr"));
    return found.filter(node => !found.some(other => other !== node && other.contains(node)));
  }
  // The document to work in: a same-origin frame inside the layer, else the layer itself.
  function layerRoot(layer) {
    for (const frame of layer.querySelectorAll("iframe")) {
      try { if (frame.contentDocument?.body) return frame.contentDocument.body; } catch { /* another domain: Kakao answers by message */ }
    }
    return layer;
  }

  // Result rows in a layer: table rows, list items, options. Page numbers and headers are not results.
  function rowsIn(root) {
    const rows = [...root.querySelectorAll("tbody tr, li, [role='option']")].filter(row => visible(row) && !row.closest("thead") &&
      !row.querySelector("input[type='text'], input[type='search']") && textOf(row) && !/^(\d+|이전|다음|처음|마지막|prev|next|[<>«»]+)$/i.test(textOf(row)));
    return rows.filter(row => !rows.some(other => other !== row && other.contains(row)));
  }
  // What a row is called: its link or first cell, not the whole row ("숭실대학교 | 서울 동작구 | 선택").
  function rowName(row) {
    const named = row.querySelector("a, strong, th, td, .name, [class*='name' i]");
    const text = named && !/^\s*선택\s*$/.test(textOf(named)) ? textOf(named) : "";
    return text || textOf(row);
  }
  function rowTarget(row) {
    const buttons = [...row.querySelectorAll(CLICKABLE)].filter(visible);
    return buttons.find(button => /선택|select|choose/i.test(buttonText(button))) || buttons[0] || row;
  }

  function pickRow(value, rows) {
    const { pickOption } = globalThis.AutoFolioMatch;
    let picked = pickOption(value, rows.map(rowName));
    if (picked.index < 0 && !picked.candidates.length) picked = pickOption(value, rows.map(textOf));
    return picked;
  }

  // Search inside a layer: type the value in its box if it has one, press its search button (or
  // Enter), wait for rows, pick the one that matches, and wait for the layer to hand the pick back.
  async function driveLayer(layer, element, value, before) {
    let root = layerRoot(layer);
    for (let waited = 0; waited < 2000 && !textBoxes(root).length && !rowsIn(root).length; waited += 150) {
      await wait(150);
      root = layerRoot(layer);
    }
    const box = textBoxes(root).find(input => input !== element);
    let rows = rowsIn(root);
    if (box) {
      const stale = new Set(rows);
      if (box.value.trim() !== value) typeInto(box, value);
      const button = [...root.querySelectorAll(CLICKABLE)].find(item => visible(item) && isSearchButton(item));
      if (button) choose(button);
      else pressEnter(box);
      rows = [];
      for (let waited = 0; waited < 5000; waited += 150) {
        await wait(150);
        root = layerRoot(layer);
        const now = rowsIn(root);
        if (now.length && (!stale.size || now.some(row => !stale.has(row)))) { rows = now; break; }
      }
    }
    if (!rows.length) return { status: "review", detail: "검색창을 열었지만 결과를 찾지 못했습니다. 직접 선택하세요." };
    const picked = pickRow(value, rows);
    if (picked.index < 0) {
      const listed = (picked.candidates.length ? picked.candidates : rows.slice(0, 3).map(rowName)).join(", ");
      return { status: "review", detail: `검색 결과: ${picked.reason} (${listed}). 직접 선택하세요.` };
    }
    const name = rowName(rows[picked.index]);
    choose(rowTarget(rows[picked.index]));
    for (let waited = 0; waited < 3000; waited += 150) {
      await wait(150);
      if (read(element) !== before || !layer.isConnected || !visible(layer)) break;
    }
    const check = picked.loose ? " · 비슷한 이름으로 골랐으니 확인하세요" : "";
    // The box changed, or (when it already held the typed name) the layer closed on the pick.
    const closed = !layer.isConnected || !visible(layer);
    if (read(element) !== before || (closed && read(element).trim())) return { status: "filled", detail: `검색창에서 "${name}" 선택 · ${picked.reason}${check}` };
    return { status: "review", detail: `검색창에서 "${name}"을 골랐지만 칸에 값이 보이지 않습니다. 확인하세요.` };
  }

  // No search worked: put the saved value in directly and say so.
  function fillDirectly(item, element, value, why) {
    const zip = /zipCode$/.test(item.type || "");
    const text = zip ? value : formattedValue(element, value);
    setNativeValue(element, text);
    const shown = read(element) === text;
    if (!SEARCH_TYPES.test(item.type || "")) {
      return { token: item.token, status: shown ? "filled" : "failed", detail: shown ? "읽기 전용 칸에 직접 입력" : "읽기 전용 칸에 넣지 못했습니다.", expected: text };
    }
    return { token: item.token, status: shown ? "review" : "failed", detail: shown
      ? `${why} 저장된 값을 검색 없이 넣었습니다. 사이트가 검색 결과로만 받는 칸이면 직접 검색하세요.` : `${why} 직접 검색하세요.` };
  }

  async function fillViaButton(item, element, value) {
    const address = ADDRESS_TYPES.test(item.type || "");
    // Kakao may already have filled this box while handling the zip code (or the other way round).
    const squashed = text => String(text || "").replace(/\s+/g, "");
    const now = squashed(read(element));
    if (address && element.readOnly && now && (now === squashed(value) || squashed(value).startsWith(now) || now.startsWith(squashed(value).slice(0, 8)))) {
      return { token: item.token, status: "filled", detail: "주소 검색으로 채워짐" };
    }
    const button = searchButtonFor(element);
    if (!button) return fillDirectly(item, element, value, "옆에 검색 버튼이 없어");
    const query = address ? fillValues["personal.address"] || value : value;
    // Type first when the box takes typing: "입력 후 [검색]" sites search for what is in it.
    if (!element.readOnly && !element.disabled && !address) typeInto(element, value);
    const before = read(element);
    const layersBefore = new Set(openLayers());
    const optionsBefore = visibleOptions(element);
    const pressedAt = Date.now();
    postcode.readyAt = 0;
    choose(button);
    for (let waited = 0; waited < 6000; waited += 200) {
      await wait(200);
      if (waited % 1000 === 0) pingFrames();
      if (postcode.readyAt >= pressedAt && postcode.source) {
        if (!address) break;
        const answer = await postcodeSearch(query, fillValues["personal.zipCode"] || "");
        for (let settle = 0; settle < 2000 && read(element) === before; settle += 150) await wait(150);
        if (answer.status === "filled" && read(element) !== before) return { token: item.token, status: "filled", detail: answer.detail };
        return { token: item.token, status: "review", detail: answer.detail || "주소 검색 결과가 칸에 들어가지 않았습니다. 확인하세요." };
      }
      // Some sites fill a read-only box straight away (a single match).
      if (element.readOnly && read(element) !== before && read(element).trim()) {
        return { token: item.token, status: "filled", detail: "검색 버튼으로 채워짐" };
      }
      const options = visibleOptions(element).filter(option => !optionsBefore.includes(option));
      if (options.length) return await pickListed(item, element, value, options);
      const layer = openLayers().find(node => !layersBefore.has(node));
      if (layer) return { token: item.token, ...(await driveLayer(layer, element, value, before)) };
      if (Number(document.documentElement.dataset.autofolioPopupAt || 0) >= pressedAt) return await waitForUserWindow(item, element, before);
    }
    return fillDirectly(item, element, value, "검색 버튼을 눌렀지만 검색창을 찾지 못해");
  }

  // A list that appeared beside the box: the same picking as type-ahead boxes.
  async function pickListed(item, element, value, options) {
    const texts = options.map(option => textOf(option));
    const picked = globalThis.AutoFolioMatch.pickOption(value, texts);
    if (picked.index < 0) {
      const listed = (picked.candidates.length ? picked.candidates : texts.slice(0, 3)).join(", ");
      return { token: item.token, status: "review", detail: `검색 결과: ${picked.reason} (${listed}). 직접 선택하세요.` };
    }
    const before = read(element);
    choose(options[picked.index]);
    await wait(400);
    const shown = read(element) !== before || shownNearby(element, texts[picked.index]);
    return { token: item.token, status: shown ? "filled" : "review",
      detail: shown ? `검색 결과에서 "${texts[picked.index]}" 선택 · ${picked.reason}` : `"${texts[picked.index]}"을 골랐지만 화면에서 확인되지 않습니다.` };
  }

  // The site opened its own window (another page AutoFolio is not in): the user picks there.
  async function waitForUserWindow(item, element, before) {
    const notice = showNotice("검색 창이 새로 열렸습니다. 그 창에서 직접 골라 주세요. 창이 닫히면 이어서 채웁니다.", [["done", "골랐음"], ["skip", "건너뛰기"]]);
    let answer = null;
    notice.choice.then(value => { answer = value; });
    for (let waited = 0; !answer && waited < 5 * 60 * 1000; waited += 500) {
      await wait(500);
      if (!document.documentElement.dataset.autofolioPopupOpen) answer = "closed";
    }
    notice.close();
    if (read(element) !== before && read(element).trim()) return { token: item.token, status: "filled", detail: "새 창에서 사용자가 선택" };
    return { token: item.token, status: "review", detail: "검색 창이 새로 열려 직접 고르도록 넘겼습니다. 확인하세요." };
  }

  async function fillOne(item) {
    const element = elements.get(item.token);
    if (!element?.isConnected) return { token: item.token, status: "skipped", detail: "필드가 바뀌었습니다. 다시 분석하세요." };
    const value = String(item.value ?? "").trim();
    if (!value) return { token: item.token, status: "skipped", detail: "저장된 값 없음" };
    const part = partOf.get(element);
    if (part) {
      if (part.index > 0) return { token: item.token, status: "skipped", detail: "앞 칸과 함께 입력" };
      return await fillParts(item, part.members, value);
    }
    try {
      // Read-only boxes (주소, 학교명) and search-type items with a [검색] button beside them go
      // through the site's own search; see fillViaButton.
      if (element.readOnly || (SEARCH_TYPES.test(item.type || "") && !isSearchInput(element) && searchButtonFor(element))) {
        return await fillViaButton(item, element, value);
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
      stepBar?.close(); // its fields' tokens are about to change
      const fields = scan();
      log(`입력칸 ${fields.length}개 분석`);
      console.table?.(fields.map(({ token, label, section, name, inputType, required }) => ({ token, label, section, name, inputType, required })));
      sendResponse({ fields, url: location.href });
    }
    if (message.action === "addRows") {
      addRows(message.key, Math.min(message.times, 10)).then(added => sendResponse({ added }));
      return true;
    }
    if (message.action === "step") {
      fillValues = Object.fromEntries(message.items.filter(item => item.type).map(item => [item.type, item.value]));
      startSteps(message.items);
      sendResponse(stepBar.state());
    }
    if (message.action === "stepAct") {
      if (!stepBar) sendResponse({ closed: true });
      else stepBar.act(message.name).then(sendResponse);
      return true;
    }
    if (message.action === "undo") {
      const undone = undoLast();
      if (undone) undoNotice(`"${undone.label}"을 되돌렸습니다(${undone.changed}곳).`);
      sendResponse({ undone: undone ? { label: undone.label, changed: undone.changed } : null, left: fillHistory.length });
    }
    if (message.action === "fill") {
      (async () => {
        // One at a time: search lists from different fields would otherwise overlap.
        const results = [];
        loginWaited = false;
        log(`${message.items.length}개 칸 입력 시작`);
        const snaps = [];
        fillValues = Object.fromEntries(message.items.filter(item => item.type).map(item => [item.type, item.value]));
        for (const item of message.items) results.push(await fillRecorded(item, snaps));
        fillHistory.push({ label: `${message.label || "모두 채우기"} ${results.length}칸`, snaps });
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
        // Logging in closed the extension popup, so its report and follow-up fill are gone; say it here.
        // The notice also offers undo, like an editor after "replace all".
        const opened = loginWaited && newFields > 0 ? ` 새로 열린 칸 ${newFields}개는 확장을 다시 열어 분석하면 채울 수 있습니다.` : "";
        undoNotice(`입력을 마쳤습니다. 입력 ${counts.filled || 0}개, 직접 확인 ${counts.review || 0}개.${opened} 제출 전에 확인하세요.`);
        sendResponse({ results, invalidFields, newFields: Math.max(0, newFields) });
      })();
      return true;
    }
    return false;
  }
  globalThis.__autofolioListener = onMessage;
  chrome.runtime.onMessage.addListener(onMessage);
})();
