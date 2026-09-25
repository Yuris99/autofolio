// 페이지 안에서 실행되는 입력 도우미 (브라우저 자동화 라이브러리와 무관한 순수 JS).
// 사용: frame.evaluate(`(${WIDGETS}).fnName(${JSON.stringify(args)})`)
({
  // 자동 입력 중 폼 제출을 막는다 (Enter 검색 등으로 인한 의도치 않은 제출 방지).
  guardSubmit(on) {
    const KEY = "__autofolioSubmitGuard";
    if (on && !window[KEY]) {
      window[KEY] = (e) => {
        e.preventDefault();
        e.stopImmediatePropagation();
        console.warn("[AutoFolio] 자동 입력 중 폼 제출을 차단했습니다.");
      };
      document.addEventListener("submit", window[KEY], true);
    } else if (!on && window[KEY]) {
      document.removeEventListener("submit", window[KEY], true);
      delete window[KEY];
    }
    return true;
  },

  // 검색 입력칸 주변에서 보이는 결과 항목을 찾는다. 입력칸의 조상을 최대 4단계 올라가며
  // 처음으로 보이는 목록 항목(li, [role=option])이 나오는 범위를 결과 영역으로 본다.
  _results(selector) {
    const input = document.querySelector(selector);
    if (!input) return [];
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none";
    };
    let node = input.parentElement;
    for (let depth = 0; node && depth < 4; depth++, node = node.parentElement) {
      const items = [...node.querySelectorAll("li, [role=option]")].filter((li) => visible(li) && !li.contains(input));
      if (items.length) {
        return items.map((li) => {
          const el = li.querySelector("button, a, [role=option]") ?? li;
          return { el, text: (el.getAttribute("title") || el.textContent || "").replace(/\s+/g, " ").trim() };
        });
      }
    }
    return [];
  },

  searchResults(selector) {
    return this._results(selector).map((r) => r.text);
  },

  clickResult({ selector, text }) {
    const hit = this._results(selector).find((r) => r.text === text);
    if (!hit) return false;
    hit.el.click();
    return true;
  },

  // 필드 현재 상태 읽기 (검증용, 메모리에서만 사용)
  readState(selector) {
    const el = document.querySelector(selector);
    if (!el) return { exists: false };
    const state = { exists: true, disabled: el.disabled === true, invalid: el.getAttribute("aria-invalid") === "true" };
    if (el.tagName === "SELECT") state.selectedText = el.options[el.selectedIndex]?.text.trim() ?? "";
    else if (el.type === "radio" || el.type === "checkbox") state.checked = el.checked;
    else state.value = el.value;
    return state;
  },
})
