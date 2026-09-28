// Chooses a search result for a saved value. Loaded as a classic content script before
// content.js and imported by the Node tests, so it only assigns to globalThis.
(() => {
  function normalize(text) {
    return String(text ?? "").normalize("NFKC").toLowerCase().replace(/[\s·.,\-_/]+/g, "");
  }

  // Parenthesized notes such as "(본교)" or "(서울)" do not change which item it is.
  function withoutNotes(text) {
    return normalize(String(text ?? "").replace(/\([^)]*\)|\[[^\]]*\]/g, ""));
  }

  // Returns { index, reason } when one option clearly matches, otherwise
  // { index: -1, reason, candidates } so the user decides.
  function pickOption(value, optionTexts) {
    const query = normalize(value);
    const bare = withoutNotes(value);
    if (!query) return { index: -1, reason: "값 없음", candidates: [] };
    const options = optionTexts.map((text, index) => ({ index, text: String(text ?? "").trim(), full: normalize(text), bare: withoutNotes(text) }))
      .filter(option => option.full);

    const exact = options.filter(option => option.full === query);
    if (exact.length === 1) return { index: exact[0].index, reason: "일치" };
    if (exact.length > 1) return { index: -1, reason: "같은 이름의 결과가 여러 개", candidates: exact.map(option => option.text) };

    const noted = options.filter(option => option.bare === bare);
    if (noted.length === 1) return { index: noted[0].index, reason: "괄호 설명만 다름" };
    if (noted.length > 1) return { index: -1, reason: "캠퍼스·구분이 다른 결과가 여러 개", candidates: noted.map(option => option.text) };

    const partial = options.filter(option => option.full.includes(query) || (option.full.length >= 2 && query.includes(option.full)));
    if (partial.length === 1) return { index: -1, reason: "비슷한 결과 1개 · 확인 필요", candidates: [partial[0].text] };
    return { index: -1, reason: partial.length ? "비슷한 결과가 여러 개" : "일치하는 결과 없음", candidates: partial.slice(0, 5).map(option => option.text) };
  }

  globalThis.AutoFolioMatch = { normalize, pickOption };
})();
