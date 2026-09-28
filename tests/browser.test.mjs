import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

// Runs tests/form-fixture.html in headless Chrome and reads the result it writes to <body>.
const chrome = [process.env.CHROME_PATH, "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"]
  .find(path => path && existsSync(path));
const fixture = pathToFileURL(fileURLToPath(new URL("./form-fixture.html", import.meta.url))).href;

test("fixture form is filled and search boxes are resolved in a browser", { skip: !chrome && "Chrome를 찾지 못함 (CHROME_PATH 지정)" }, () => {
  const dom = execFileSync(chrome, [
    "--headless", "--no-sandbox", "--disable-gpu", "--allow-file-access-from-files",
    "--virtual-time-budget=15000", "--dump-dom", fixture
  ], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 60000 });
  const details = dom.match(/data-test-details="([^"]*)"/)?.[1]?.replaceAll("&quot;", '"') || "";
  assert.match(dom, /data-test-result="PASS"/, details);
});
