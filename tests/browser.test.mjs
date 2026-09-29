import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

// Runs fixture pages in headless Chrome and reads the result each writes to <body>.
// Pages are served over http because Chrome blocks ES module imports from file://.
const chrome = [process.env.CHROME_PATH, "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/usr/bin/google-chrome", "/usr/bin/chromium",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"]
  .find(path => path && existsSync(path));
const skip = !chrome && "Chrome를 찾지 못함 (CHROME_PATH 지정)";
const root = fileURLToPath(new URL("..", import.meta.url));
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css" };

let server;
let origin;

test.before(async () => {
  if (skip) return;
  server = createServer(async (request, response) => {
    const path = normalize(root + decodeURIComponent(new URL(request.url, "http://x").pathname));
    try {
      if (!path.startsWith(root) || path.includes(`${sep}node_modules${sep}`)) throw new Error("outside");
      const body = await readFile(path);
      response.writeHead(200, { "Content-Type": types[extname(path)] || "application/octet-stream" });
      response.end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => server?.close());

async function runFixture(name) {
  const { stdout: dom } = await promisify(execFile)(chrome, [
    "--headless", "--no-sandbox", "--disable-gpu", "--no-proxy-server",
    "--virtual-time-budget=15000", "--dump-dom", `${origin}/tests/${name}`
  ], { encoding: "utf8", timeout: 60000 });
  const details = dom.match(/data-test-details="([^"]*)"/)?.[1]?.replaceAll("&quot;", '"') || "결과 없음";
  assert.match(dom, /data-test-result="PASS"/, details);
}

test("fixture form is filled and search boxes are resolved in a browser", { skip }, () => runFixture("form-fixture.html"));
test("profile page renders, adds, removes and saves entries", { skip }, () => runFixture("options-fixture.html"));
test("recruiter.co.kr-shaped form is classified and filled end to end", { skip }, () => runFixture("recruiter-fixture.html"));
test("a pick that opens a login window is handed to the user", { skip }, () => runFixture("login-fixture.html"));
test("newer forms: div labels, sample placeholders, one name per radio", { skip }, () => runFixture("v1-fixture.html"));
