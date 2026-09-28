(() => {
  if (globalThis.__autofolioReady) return;
  globalThis.__autofolioReady = true;
  let elements = new Map();

  function nearbySection(element) {
    let node = element.parentElement;
    for (let depth = 0; node && depth < 5; depth++, node = node.parentElement) {
      const heading = node.querySelector(":scope > legend, :scope > h2, :scope > h3, :scope > h4, :scope > .title, :scope > .section-title");
      if (heading?.textContent.trim()) return heading.textContent.trim().slice(0, 100);
      if (node.matches("fieldset") && node.getAttribute("aria-label")) return node.getAttribute("aria-label");
    }
    return "";
  }

  function labelFor(element) {
    const direct = [...(element.labels || [])].map(label => label.textContent.trim()).filter(Boolean).join(" ");
    if (direct) return direct.slice(0, 120);
    const wrapping = element.closest("label");
    if (wrapping) return wrapping.textContent.trim().slice(0, 120);
    const labelledBy = element.getAttribute("aria-labelledby");
    if (labelledBy) return labelledBy.split(/\s+/).map(id => document.getElementById(id)?.textContent.trim()).filter(Boolean).join(" ").slice(0, 120);
    const container = element.closest("td, li, .form-group, .field, .input-group");
    const sibling = container?.querySelector("label, th, .label");
    return sibling?.textContent.trim().slice(0, 120) || "";
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
    let index = 0;
    for (const element of candidates) {
      if (!visible(element)) continue;
      const inputType = element instanceof HTMLInputElement ? element.type : element.localName;
      if (["hidden", "password", "file", "submit", "button", "reset", "image", "color", "range"].includes(inputType)) continue;
      const token = `af-${++index}`;
      elements.set(token, element);
      fields.push({
        token,
        label: labelFor(element),
        ariaLabel: element.getAttribute("aria-label") || "",
        placeholder: element.getAttribute("placeholder") || "",
        section: nearbySection(element),
        name: element.getAttribute("name") || "",
        id: element.id || "",
        inputType,
        required: element.required || element.getAttribute("aria-required") === "true",
        options: element instanceof HTMLSelectElement ? [...element.options].map(o => ({ value: o.value, text: o.text.trim() })).slice(0, 80) : []
      });
    }
    return fields;
  }

  function read(element) {
    if (element instanceof HTMLInputElement && ["checkbox", "radio"].includes(element.type)) return element.checked ? element.value : "";
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

  function formattedValue(element, value) {
    if (!(element instanceof HTMLInputElement)) return value;
    const digits = value.replace(/\D/g, "");
    if (element.type === "date" && digits.length === 8) return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
    if (element.type === "month" && digits.length >= 6) return `${digits.slice(0, 4)}-${digits.slice(4, 6)}`;
    return value;
  }

  function fillOne(item) {
    const element = elements.get(item.token);
    if (!element?.isConnected) return { token: item.token, status: "skipped", detail: "필드가 바뀌었습니다. 다시 분석하세요." };
    const value = String(item.value ?? "").trim();
    if (!value) return { token: item.token, status: "skipped", detail: "저장된 값 없음" };
    try {
      let expected = formattedValue(element, value);
      if (element instanceof HTMLSelectElement) {
        const match = [...element.options].find(option => option.value === value || option.text.trim() === value);
        if (!match) return { token: item.token, status: "skipped", detail: "선택 목록에 값이 없습니다." };
        expected = match.value;
        element.value = expected;
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
      } else if (element instanceof HTMLInputElement && ["checkbox", "radio"].includes(element.type)) {
        if (element.value !== value && labelFor(element) !== value) return { token: item.token, status: "skipped", detail: "선택 항목과 값이 다릅니다." };
        if (!element.checked) element.click();
        expected = element.value;
      } else if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
        setNativeValue(element, expected);
        if (element.getAttribute("role") === "combobox" || element.hasAttribute("aria-autocomplete") || element.hasAttribute("list")) {
          return { token: item.token, status: "review", detail: "검색형 입력입니다. 표시된 결과를 직접 선택하고 확인하세요." };
        }
      } else if (element.isContentEditable) {
        element.textContent = value;
        element.dispatchEvent(new InputEvent("input", { bubbles: true, data: value, inputType: "insertText" }));
      } else return { token: item.token, status: "skipped", detail: "지원하지 않는 입력 방식" };
      return { token: item.token, status: read(element) === expected ? "filled" : "failed", detail: read(element) === expected ? "입력값 확인" : "화면에서 값이 확인되지 않습니다." };
    } catch (error) {
      return { token: item.token, status: "failed", detail: error.message };
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.action === "scan") sendResponse({ fields: scan(), url: location.href });
    if (message.action === "fill") {
      const results = message.items.map(fillOne);
      // Controlled inputs can rerender after an event. Verify once more after the page settles.
      setTimeout(() => {
        for (const result of results) {
          if (result.status !== "filled") continue;
          const element = elements.get(result.token);
          const expected = formattedValue(element, String(message.items.find(item => item.token === result.token).value));
          if (!element?.isConnected || (element instanceof HTMLSelectElement ? element.options[element.selectedIndex]?.text.trim() !== expected && element.value !== expected : read(element) !== expected)) {
            result.status = "failed";
            result.detail = "입력 후 페이지 상태가 바뀌었습니다.";
          }
        }
        const invalidFields = [...document.querySelectorAll("input, textarea, select")]
          .filter(element => visible(element) && (element.getAttribute("aria-invalid") === "true" || (element.required && !element.checkValidity())))
          .map(element => labelFor(element) || element.name || "설명 없는 필수 항목");
        sendResponse({ results, invalidFields });
      }, 350);
      return true;
    }
    return false;
  });
})();
