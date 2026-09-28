(() => {
  if (globalThis.__autofolioReady) return;
  globalThis.__autofolioReady = true;
  let elements = new Map();
  // Shown in the page's DevTools console (F12). Saved profile values are never logged.
  const log = (...args) => console.info("%c[AutoFolio]", "color:#2358d0;font-weight:bold", ...args);

  function nearbySection(element) {
    let node = element.parentElement;
    for (let depth = 0; node && depth < 5; depth++, node = node.parentElement) {
      const heading = node.querySelector(":scope > legend, :scope > h2, :scope > h3, :scope > h4, :scope > .title, :scope > .section-title");
      const text = textOf(heading).slice(0, 100);
      if (text) return text;
      if (node.matches("fieldset") && node.getAttribute("aria-label")) return node.getAttribute("aria-label");
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
      acceptNode: text => text.parentElement?.closest(CONTROLS) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
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
    return textOf(container?.querySelector("label, th, .label")) || textOf(heading);
  }

  // One field per radio group: its question, not any single choice, is what gets classified.
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
    const texts = radios.map(radio => labelFor(radio) || radio.value);
    let picked = globalThis.AutoFolioMatch.pickOption(value, texts);
    if (picked.index < 0) picked = globalThis.AutoFolioMatch.pickOption(value, radios.map(radio => radio.value));
    if (picked.index < 0) return { radio: null, detail: `선택지에서 "${value}"를 찾지 못했습니다 (${texts.join(", ")}).` };
    return { radio: radios[picked.index] };
  }

  function visible(element) {
    if (element.getAttribute("aria-hidden") === "true" || element.disabled || element.closest("[hidden], [inert]")) return false;
    const style = getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
  }

  function scan() {
    elements = new Map();
    const fields = [];
    const candidates = document.querySelectorAll("input, textarea, select, [contenteditable='true']");
    const seenRadios = new Set();
    let index = 0;
    for (const element of candidates) {
      if (!visible(element) || seenRadios.has(element)) continue;
      const inputType = element instanceof HTMLInputElement ? element.type : element.localName;
      if (["hidden", "password", "file", "submit", "button", "reset", "image", "color", "range"].includes(inputType)) continue;
      const radios = inputType === "radio" ? radioGroup(element) : null;
      radios?.forEach(radio => seenRadios.add(radio));
      const token = `af-${++index}`;
      elements.set(token, element);
      const section = nearbySection(element);
      let options = [];
      if (element instanceof HTMLSelectElement) options = [...element.options].map(o => ({ value: o.value, text: o.text.trim() }));
      if (radios) options = radios.map(radio => ({ value: radio.value, text: labelFor(radio) }));
      fields.push({
        token,
        label: radios ? groupLabel(element) : labelFor(element),
        ariaLabel: element.getAttribute("aria-label") || "",
        placeholder: element.getAttribute("placeholder") || "",
        section,
        name: element.getAttribute("name") || "",
        id: element.id || "",
        inputType,
        required: element.required || element.getAttribute("aria-required") === "true" || Boolean(radios?.some(radio => radio.required)),
        options: options.slice(0, 80)
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
    return element instanceof HTMLInputElement && (element.getAttribute("role") === "combobox" || element.hasAttribute("aria-autocomplete") || element.hasAttribute("list"));
  }

  // Prefer the list the input names; fall back to suggestion lists visible anywhere on the page.
  function visibleOptions(element) {
    const owned = ["aria-controls", "aria-owns"].flatMap(name => (element.getAttribute(name) || "").split(/\s+/))
      .map(id => id && document.getElementById(id)).filter(Boolean);
    const roots = owned.length ? owned : [document];
    return roots.flatMap(root => [...root.querySelectorAll(OPTION_SELECTOR)])
      .filter(option => option !== element && visible(option) && option.getAttribute("aria-disabled") !== "true" && option.textContent.trim());
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

    typeInto(element, value);
    let options = [];
    for (let waited = 0; waited < 2500 && !options.length; waited += 150) {
      await wait(150);
      options = visibleOptions(element);
    }
    if (!options.length) return { token: item.token, status: "review", detail: "검색 결과가 나타나지 않았습니다. 직접 검색해 선택하세요." };

    const texts = options.map(option => option.textContent.trim());
    const picked = pickOption(value, texts);
    if (picked.index < 0) {
      const shown = picked.candidates.length ? ` (${picked.candidates.join(", ")})` : "";
      return { token: item.token, status: "review", detail: `검색 결과: ${picked.reason}${shown}. 직접 선택하세요.` };
    }
    choose(options[picked.index]);
    await wait(250);
    const current = normalize(read(element));
    const stillOpen = visibleOptions(element).length > 0;
    if (current && (current === normalize(texts[picked.index]) || current === normalize(value)) && !stillOpen) {
      return { token: item.token, status: "filled", detail: `검색 결과에서 선택 · ${picked.reason}`, expected: read(element) };
    }
    return { token: item.token, status: "review", detail: `"${texts[picked.index]}"을 선택했지만 화면에서 확인되지 않습니다. 확인하세요.` };
  }

  function formattedValue(element, value) {
    if (!(element instanceof HTMLInputElement)) return value;
    const digits = value.replace(/\D/g, "");
    if (element.type === "date" && digits.length === 8) return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
    if (element.type === "month" && digits.length >= 6) return `${digits.slice(0, 4)}-${digits.slice(4, 6)}`;
    // Text date boxes: follow the format the page hints at (placeholder "YYYY.MM.DD", maxlength 8, ...).
    const looksLikeDate = /^\d{4}\D?\d{2}(\D?\d{2})?\D?$/.test(value.trim());
    if (element.type === "text" && looksLikeDate) {
      const hint = `${element.placeholder} ${element.title} ${element.dataset.format || ""}`;
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
        return { token: item.token, status: ok ? "filled" : "failed", detail: ok ? `"${labelFor(radio) || radio.value}" 선택` : "선택되지 않았습니다.", expected: radio.value };
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

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.action === "scan") {
      const fields = scan();
      log(`입력칸 ${fields.length}개 분석`);
      console.table?.(fields.map(({ token, label, section, name, inputType, required }) => ({ token, label, section, name, inputType, required })));
      sendResponse({ fields, url: location.href });
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
          if (result.status !== "filled") continue;
          const element = elements.get(result.token);
          if (!element?.isConnected || read(element) !== result.expected) {
            result.status = "failed";
            result.detail = "입력 후 페이지 상태가 바뀌었습니다.";
            log(`failed  ${result.token} — 재확인에서 값이 바뀜`);
          }
        }
        const invalidFields = [...document.querySelectorAll("input, textarea, select")]
          .filter(element => visible(element) && (element.getAttribute("aria-invalid") === "true" || (element.required && !element.checkValidity())))
          .map(element => labelFor(element) || element.name || "설명 없는 필수 항목");
        const counts = results.reduce((sum, result) => ({ ...sum, [result.status]: (sum[result.status] || 0) + 1 }), {});
        log("입력 완료", counts, invalidFields.length ? `미완료/오류 칸: ${invalidFields.join(", ")}` : "");
        sendResponse({ results, invalidFields });
      })();
      return true;
    }
    return false;
  });
})();
