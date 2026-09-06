#!/usr/bin/env node
/* 브라우저 스모크 테스트 (order-helper 구앱 기준)
 *   node tools/smoke.js [소스파일 …]     기본: sample/소스샘플_36열.xlsx
 *   SHOTS=1  → /tmp/shots/*.png 스크린샷
 *
 * 확인하는 것: 콘솔/페이지 에러 0건, 파일 업로드 후 시트 행 수, 모든 탭 렌더,
 * 내보내기 모달의 각 버튼이 실제 다운로드를 만드는지.
 */
"use strict";
const path = require("path");
const http = require("http");
const fs = require("fs");
const { chromium } = require("playwright");

const ROOT = path.join(__dirname, "..");
const PORT = 8790;
const files = process.argv.slice(2);
if (!files.length) files.push(path.join(ROOT, "sample", "소스샘플_36열.xlsx"));

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css", ".json": "application/json" };
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, "") || "index.html";
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});

(async () => {
  await new Promise((r) => server.listen(PORT, r));
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, colorScheme: process.env.DARK ? "dark" : "light" });
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("response", (r) => { if (r.status() >= 400) console.log("  [http " + r.status() + "] " + r.url()); });
  if (process.env.SHOTS) fs.mkdirSync("/tmp/shots", { recursive: true });

  for (const src of files) {
    await page.goto(`http://localhost:${PORT}/index.html`);
    await page.evaluate(() => localStorage.clear());
    await page.goto(`http://localhost:${PORT}/index.html`);
    await page.waitForTimeout(300);
    console.log(`\n▶ ${path.basename(src)}`);
    // setInputFiles 가 이 환경의 숨김 input 에는 파일을 못 넣는다 → File 을 직접 만들어 change 발생
    await page.evaluate(({ name, b64 }) => {
      const bin = atob(b64), u = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      const dt = new DataTransfer(); dt.items.add(new File([u], name));
      const inp = document.getElementById("in-order"); inp.files = dt.files;
      inp.dispatchEvent(new Event("change", { bubbles: true }));
    }, { name: path.basename(src), b64: fs.readFileSync(src).toString("base64") });
    await page.waitForTimeout(1800);
    const mapping = !(await page.locator("#view-mapping").getAttribute("class") || "").includes("hidden");
    if (mapping) {
      console.log("  매핑 화면이 떴습니다 — 자동인식 실패 항목:",
        (await page.locator("#map-rows .map-bad").allTextContents()).join(","));
      await page.click("#btn-map-confirm");
      await page.waitForTimeout(800);
    }
    const dash = !(await page.locator("#view-dashboard").getAttribute("class") || "").includes("hidden");
    console.log("  대시보드 진입:", dash, "| 토스트:", (await page.textContent("#toast")).trim());
    if (!dash) { errors.push(`${path.basename(src)}: 대시보드로 넘어가지 못함`); continue; }

    const tabs = await page.$$eval("#tabnav .tab", (els) => els.map((e) => e.getAttribute("data-tab")));
    for (const t of tabs) {
      await page.click(`#tabnav [data-tab="${t}"]`);
      await page.waitForTimeout(200);
      const paneId = await page.evaluate(() => {
        const vis = Array.from(document.querySelectorAll('[id^="pane-"]')).find((p) => !p.classList.contains("hidden"));
        return vis ? vis.id : "";
      });
      const txt = paneId ? (await page.textContent("#" + paneId)).replace(/\s+/g, " ").trim() : "";
      console.log(`  [${t}] ${paneId} ${txt.length}자 · ${txt.slice(0, 60)}`);
      if (process.env.SHOTS) await page.screenshot({ path: `/tmp/shots/${t}.png` });
    }
    await page.click('#tabnav [data-tab="orders"]');
    await page.waitForTimeout(250);
    const rows = await page.locator("#sheet-table tbody tr[data-id]").count();
    const heads = await page.$$eval("#sheet-table thead th[data-k]", (els) => els.map((e) => e.getAttribute("data-k")));
    console.log("  시트 행:", rows, "| 열:", heads.join(","));

    // 내보내기 — 모달의 모든 버튼
    await page.click("#btn-export");
    await page.waitForTimeout(200);
    const btns = await page.$$eval("#modal-export button[id^='btn-exp-']", (els) => els.map((e) => e.id).filter((id) => id !== "btn-exp-close"));
    for (const id of btns) {
      const dl = page.waitForEvent("download", { timeout: 6000 }).catch(() => null);
      await page.click("#" + id);
      const f = await dl;
      let size = 0;
      if (f) {
        const sug = await f.suggestedFilename();
        const ext = (sug.match(/\.(xlsx|xls|csv)$/i) || [, id.replace(/^btn-exp-(src-|invoice-)?/, "")])[1];
        const p = path.join("/tmp", "smoke-" + id + "." + ext);
        await f.saveAs(p); size = fs.statSync(p).size;
      }
      console.log(`  내보내기 ${id}:`, f ? `${await f.suggestedFilename()} (${(size / 1024).toFixed(1)} KB)` : "다운로드 없음");
      if (!f) errors.push(`${id} 다운로드 없음`);
      if (!(await page.locator("#modal-export").getAttribute("class") || "").includes("hidden")) continue;
      await page.click("#btn-export");
      await page.waitForTimeout(150);
    }
  }

  await browser.close();
  server.close();
  if (errors.length) { console.log("\n오류 " + errors.length + "건:"); errors.forEach((e) => console.log(" -", e)); process.exit(1); }
  console.log("\n오류 없음");
})();
