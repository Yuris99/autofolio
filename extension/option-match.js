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

  function notesOf(text) {
    return [...String(text ?? "").matchAll(/\(([^)]*)\)|\[([^\]]*)\]/g)].map(match => normalize(match[1] ?? match[2])).filter(Boolean);
  }

  // Names people write differently from how sites list them. Each row is one thing.
  const ALIAS_NAMES = [
    ["TOEIC", "토익"], ["TOEIC Speaking", "토익스피킹", "토스"], ["TOEFL", "토플"], ["TEPS", "텝스"],
    ["OPIc", "오픽"], ["JLPT", "일본어능력시험"], ["JPT", "일본어능력평가"], ["HSK", "한어수평고시", "신HSK"],
    ["정보처리기사", "정처기"], ["정보처리산업기사", "정처산기"], ["SQLD", "SQL개발자"], ["SQLP", "SQL전문가"],
    ["ADsP", "데이터분석준전문가"], ["ADP", "데이터분석전문가"], ["컴퓨터활용능력1급", "컴활1급"], ["컴퓨터활용능력2급", "컴활2급"],
    ["한국사능력검정시험", "한국사", "한능검"], ["리눅스마스터", "리마"], ["네트워크관리사", "네관사"],
    ["빅데이터분석기사", "빅분기"], ["전기기사", "전기기사자격"], ["운전면허", "자동차운전면허"]
  ];
  const ALIASES = ALIAS_NAMES.map(row => row.map(normalize));

  function namesFor(value) {
    const names = new Set([normalize(value), withoutNotes(value)].filter(Boolean));
    for (const row of ALIASES) if (row.some(name => names.has(name))) row.forEach(name => names.add(name));
    return names;
  }

  // What to type into a site's search box: the saved name, then its other names as written.
  function searchTerms(value) {
    const own = String(value ?? "").trim();
    const row = ALIAS_NAMES[ALIASES.findIndex(names => names.includes(normalize(own)) || names.includes(withoutNotes(own)))] || [];
    return [own, ...row.filter(name => normalize(name) !== normalize(own))].filter(Boolean);
  }

  // Returns { index, reason } when one option clearly matches, otherwise
  // { index: -1, reason, candidates } so the user decides. loose marks a pick by a similar name.
  function pickOption(value, optionTexts) {
    const names = namesFor(value);
    if (!names.size) return { index: -1, reason: "값 없음", candidates: [] };
    const options = optionTexts.map((text, index) => ({
      index, text: String(text ?? "").trim(), full: normalize(text), bare: withoutNotes(text), notes: notesOf(text)
    })).filter(option => option.full);
    const one = (matches, reason, ambiguous, loose = false) => {
      if (matches.length === 1) return { index: matches[0].index, reason, loose };
      if (matches.length > 1) return { index: -1, reason: ambiguous, candidates: matches.slice(0, 5).map(option => option.text) };
      return null;
    };

    return one(options.filter(option => names.has(option.full)), "일치", "같은 이름의 결과가 여러 개") ||
      one(options.filter(option => names.has(option.bare)), "괄호 설명만 다름", "괄호 구분(캠퍼스·필기/실기 등)만 다른 결과가 여러 개") ||
      // "SQLD" → "SQL개발자(SQLD)": the saved name is the site's note.
      one(options.filter(option => option.notes.some(note => names.has(note))), "괄호 안 이름 일치", "괄호 안 이름이 같은 결과가 여러 개") ||
      // The only result containing the name ("SQLD" → "SQLD 자격검정"), or contained in it.
      one(options.filter(option => [...names].some(name =>
        option.full.includes(name) || (option.full.length >= 3 && option.full.length * 2 >= name.length && name.includes(option.full)))),
      "비슷한 이름 1개", "비슷한 결과가 여러 개", true) ||
      { index: -1, reason: "일치하는 결과 없음", candidates: [] };
  }

  globalThis.AutoFolioMatch = { normalize, pickOption, searchTerms };
})();
