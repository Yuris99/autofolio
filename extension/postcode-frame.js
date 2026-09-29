// Runs inside Kakao's postcode search (postcode.map.kakao.com / postcode.map.daum.net), which most
// Korean application forms open for addresses, as a frame in a layer or as its own window.
// The form's page cannot reach in here (another domain), so AutoFolio on that page asks by message:
//   page → here   { autofolio: "postcode-search", id, query, zip }     search and pick
//   page → here   { autofolio: "postcode-ping" }                      are you there?
//   here → page   { autofolio: "postcode", type: "ready" | "result", id, status, detail, zonecode, address }
// A search reloads this frame, so the request is kept in sessionStorage until it is answered.
// Picking a result is a click on it, the same as a person's, so the form gets Kakao's usual data.
(() => {
  if (window.__autofolioPostcode) return;
  window.__autofolioPostcode = true;
  const KEY = "autofolio-postcode";
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const page = () => (window.opener && !window.opener.closed ? window.opener : window.top);
  const say = message => { try { page().postMessage({ autofolio: "postcode", ...message }, "*"); } catch { /* page gone */ } };
  // Kakao writes 시·도 short ("서울 강남구"); saved addresses often have them long ("서울특별시 강남구").
  const REGIONS = [["서울특별시", "서울"], ["부산광역시", "부산"], ["대구광역시", "대구"], ["인천광역시", "인천"], ["광주광역시", "광주"],
    ["대전광역시", "대전"], ["울산광역시", "울산"], ["세종특별자치시", "세종"], ["경기도", "경기"], ["강원특별자치도", "강원"], ["강원도", "강원"],
    ["충청북도", "충북"], ["충청남도", "충남"], ["전북특별자치도", "전북"], ["전라북도", "전북"], ["전라남도", "전남"], ["경상북도", "경북"],
    ["경상남도", "경남"], ["제주특별자치도", "제주"]];
  function canonical(text) {
    let value = String(text || "").replace(/\([^)]*\)/g, " ").trim();
    for (const [long, short] of REGIONS) if (value.startsWith(long)) value = short + value.slice(long.length);
    return value.replace(/[\s,·]+/g, "");
  }
  // The search words: the address up to its road or lot number, without building names or floors.
  function queryOf(address) {
    const plain = String(address || "").replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
    return plain.match(/^.*?(로|길|동|리|가)\s*(지하\s*)?\d+(-\d+)?/)?.[0] || plain;
  }

  const results = () => [...document.querySelectorAll("li.list_post_item")];
  const noResults = () => /검색결과가 없습니다/.test(document.body?.innerText || "");

  // One address starts with the other and the number does not go on ("테헤란로 15" is not "테헤란로 152").
  function sameAddress(saved, found) {
    const a = canonical(queryOf(saved));
    const b = canonical(found);
    const prefix = (long, short) => long.startsWith(short) && !/[\d-]/.test(long[short.length] || "");
    return Boolean(a && b) && (prefix(a, b) || prefix(b, a));
  }

  function pick(request) {
    const rows = results().map(row => {
      const road = row.querySelector(".main_road button.link_post, .main_address button.link_post");
      const jibun = row.querySelector(".related_address button.link_post");
      return {
        zip: row.dataset.zonecode,
        road, jibun,
        roadText: row.dataset.addr || road?.closest("[data-addr]")?.dataset.addr || "",
        jibunText: jibun?.closest("[data-addr]")?.dataset.addr || ""
      };
    });
    // The saved address decides; the saved zip code only narrows when the address fits several.
    let matches = rows.filter(row => sameAddress(request.query, row.roadText) || sameAddress(request.query, row.jibunText));
    const sameZip = matches.filter(row => row.zip === request.zip);
    if (matches.length > 1 && sameZip.length) matches = sameZip;
    if (!matches.length && request.zip) matches = rows.filter(row => row.zip === request.zip);
    const unique = [...new Map(matches.map(row => [`${row.zip}|${row.roadText}`, row])).values()];
    if (unique.length !== 1) {
      const shown = (unique.length ? unique : rows).slice(0, 3).map(row => `${row.zip} ${row.roadText}`).join(", ");
      return { status: "review", detail: unique.length ? `주소 검색 결과가 여러 개입니다 (${shown}). 직접 고르세요.` : `저장한 주소와 맞는 검색 결과가 없습니다 (결과: ${shown || "없음"}). 직접 고르세요.` };
    }
    const [row] = unique;
    const useJibun = !sameAddress(request.query, row.roadText) && sameAddress(request.query, row.jibunText);
    const target = (useJibun ? row.jibun : row.road) || row.road || row.jibun;
    if (!target) return { status: "review", detail: "주소 결과를 누를 수 없습니다. 직접 고르세요." };
    // Clicking hands the pick to the site, which usually closes this frame at once; answer first
    // (finish() sends this before calling click), or the answer would be lost with the frame.
    return { status: "filled", detail: `주소 검색에서 "${row.zip} ${useJibun ? row.jibunText : row.roadText}" 선택`, zonecode: row.zip,
      address: useJibun ? row.jibunText : row.roadText, click: () => target.click() };
  }

  // After a search reloads the frame: wait for results (or "no results") and answer the request.
  async function finish(request) {
    for (let waited = 0; waited < 6000 && !results().length && !noResults(); waited += 200) await wait(200);
    sessionStorage.removeItem(KEY);
    const { click, ...answer } = results().length ? pick(request)
      : { status: "review", detail: `주소 검색 결과가 없습니다 ("${request.query}"). 직접 검색하세요.` };
    say({ type: "result", id: request.id, ...answer });
    click?.();
  }

  function search(request) {
    const box = document.getElementById("region_name") || document.querySelector("input[type='text']");
    if (!box) { say({ type: "result", id: request.id, status: "review", detail: "우편번호 검색창을 찾지 못했습니다." }); return; }
    sessionStorage.setItem(KEY, JSON.stringify({ ...request, at: Date.now() }));
    box.value = queryOf(request.query);
    box.dispatchEvent(new Event("input", { bubbles: true }));
    const button = document.querySelector(".btn_search") || [...document.querySelectorAll("button")].find(item => /검색/.test(item.textContent));
    if (button) button.click();
    else box.form?.requestSubmit();
    // Kakao may show results without a reload; answer here too if it does.
    setTimeout(() => {
      const kept = sessionStorage.getItem(KEY);
      if (kept && (results().length || noResults())) finish(JSON.parse(kept));
    }, 1500);
  }

  window.addEventListener("message", event => {
    const data = event.data;
    if (data?.autofolio === "postcode-ping") say({ type: "ready" });
    if (data?.autofolio === "postcode-search" && typeof data.query === "string") search({ id: data.id, query: data.query, zip: String(data.zip || "") });
  });

  const pending = JSON.parse(sessionStorage.getItem(KEY) || "null");
  if (pending && Date.now() - pending.at < 30000) finish(pending);
  else say({ type: "ready" });
})();
