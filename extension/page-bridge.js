// Runs in the page's own JavaScript world (injected with world: "MAIN").
// Key events built by the content script reach page handlers with keyCode 0, because the
// content script lives in an isolated world and cannot set keyCode on the page's view of the
// event. Search boxes like recruiter.co.kr's check `e.keyCode === 13`, so Enter is pressed here.
(() => {
  if (window.__autofolioBridge) return;
  window.__autofolioBridge = true;
  document.documentElement.dataset.autofolioBridge = "1";
  document.addEventListener("autofolio:enter", event => {
    const target = event.target;
    for (const type of ["keydown", "keypress", "keyup"]) {
      const key = new KeyboardEvent(type, { key: "Enter", code: "Enter", bubbles: true, cancelable: true });
      for (const property of ["keyCode", "which"]) Object.defineProperty(key, property, { get: () => 13 });
      Object.defineProperty(key, "charCode", { get: () => (type === "keypress" ? 13 : 0) });
      target.dispatchEvent(key);
    }
  }, true);
})();
