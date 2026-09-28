// AutoFolio 진단 스니펫: 지원서 페이지의 개발자 도구 Console에 붙여 넣어 실행합니다.
// 이 사이트의 스크립트 파일(공개 정적 파일)에서 검색 결과 선택·연결 칸(data-rel) 처리 부분만
// 모아 클립보드에 복사합니다. 입력한 개인정보는 읽지 않습니다.
(async () => {
  const keys = ["searchResult", "data-rel", "relTarget", "rel-target", "linkedForm", "ellipsis"];
  const parts = [];
  const seen = new Set();
  for (const script of document.scripts) {
    if (!script.src || new URL(script.src).origin !== location.origin) continue;
    let text;
    try { text = await (await fetch(script.src)).text(); } catch { continue; }
    const name = new URL(script.src).pathname.split("/").pop();
    for (const key of keys) {
      for (let i = text.indexOf(key), n = 0; i >= 0 && n < 4; i = text.indexOf(key, i + 900), n++) {
        const start = Math.max(0, i - 400);
        const id = `${name}:${Math.floor(start / 900)}`;
        if (seen.has(id)) continue;
        seen.add(id);
        parts.push(`--- ${name} [${key}] @${i}\n${text.slice(start, i + 900)}`);
      }
    }
  }
  const out = parts.join("\n\n").slice(0, 80000);
  copy(out);
  console.log(`AutoFolio: 스크립트 조각 ${parts.length}개(${out.length}자)를 복사했습니다. 채팅에 붙여 넣어 주세요.`);
})();
