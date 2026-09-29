// Runs in the page's own JavaScript world (injected with world: "MAIN").
// Key events built by the content script reach page handlers with keyCode 0, because the
// content script lives in an isolated world and cannot set keyCode on the page's view of the
// event. Search boxes like recruiter.co.kr's check `e.keyCode === 13`, so Enter is pressed here.
(() => {
  if (window.__autofolioBridge) return;
  window.__autofolioBridge = true;
  document.documentElement.dataset.autofolioBridge = "1";
  // Record when the page opens a window (e.g. a YBM login for TOEIC score lookup), so the
  // content script can hand that step to the user, and whether it is still open, so it can
  // carry on once the user has logged in and the window closed.
  const open = window.open;
  const opened = new Set();
  const root = document.documentElement;
  window.open = function (...args) {
    root.dataset.autofolioPopupAt = String(Date.now());
    const win = open.apply(this, args);
    if (win) {
      opened.add(win);
      root.dataset.autofolioPopupOpen = "1";
    }
    return win;
  };
  setInterval(() => {
    if (!opened.size) return;
    for (const win of opened) if (win.closed) opened.delete(win);
    if (!opened.size) delete root.dataset.autofolioPopupOpen;
  }, 300);
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
