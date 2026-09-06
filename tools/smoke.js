#!/usr/bin/env node
/* 브라우저 스모크 테스트 — 실제 워크북을 올려 모든 탭이 오류 없이 뜨는지 확인합니다.
 *   node tools/smoke.js [워크북.xlsx]
 */
"use strict";
const path = require("path");
const http = require("http");
const fs = require("fs");
const { chromium } = require("playwright");

const ROOT = path.join(__dirname, "..");
const SRC = process.argv[2];
const PORT = 8787;

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };

const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, "") || "index.html";
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end("nope"); return;
  }
  res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});

(async () => {
  await new Promise((r) => server.listen(PORT, r));
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));

  await page.goto(`http://localhost:${PORT}/index.html`);
  await page.waitForTimeout(400);
  console.log("초기 화면:", (await page.textContent("#pane")).slice(0, 60).replace(/\s+/g, " "));

  if (SRC) {
    await page.setInputFiles("#file-input", SRC);
    await page.waitForTimeout(2500);
    const toast = await page.textContent("#toast");
    console.log("가져오기 토스트:", toast);
    // 경고 모달 닫기
    if (await page.locator(".modal-bg").count()) {
      console.log("위험 모달:", (await page.textContent(".modal-bg .banner")).replace(/\s+/g, " ").slice(0, 80));
      await page.click(".modal-bg .mhead [data-close]");
    }
  }

  const tabs = await page.$$eval("#tabnav .tab", (els) => els.map((e) => e.getAttribute("data-tab")));
  for (const t of tabs) {
    await page.click(`#tabnav [data-tab="${t}"]`);
    await page.waitForTimeout(350);
    const txt = (await page.textContent("#pane")).replace(/\s+/g, " ").trim();
    console.log(`[${t}] ${txt.length}자 · ${txt.slice(0, 70)}`);
    if (!txt.length) errors.push(`탭 ${t} 이 비었습니다`);
    if (process.env.SHOTS) await page.screenshot({ path: `/tmp/shots/${t}.png`, fullPage: false });
  }

  // 주문관리 상호작용
  await page.click('#tabnav [data-tab="orders"]');
  await page.waitForTimeout(300);
  const rows = await page.locator("#sheet tbody tr[data-id]").count();
  console.log("시트 행:", rows);
  if (rows) {
    const before = await page.locator("#sheet tbody tr[data-id]").first().getAttribute("class");
    await page.locator('#sheet tbody tr[data-id] [data-act="toggle-order"]').first().click();
    await page.waitForTimeout(250);
    const after = await page.locator("#sheet tbody tr[data-id]").first().getAttribute("class");
    console.log("발주 토글:", before, "->", after);

    // 구매금액 입력 → 순마진 계산 확인
    const cell = page.locator('#sheet tbody tr[data-id]').first().locator('input[data-k="buyAmount"]');
    if (await cell.count()) {
      await cell.fill("40000");
      await page.waitForTimeout(250);
      const margin = await page.locator('#sheet tbody tr[data-id]').first().locator('td.calc[data-k="netMargin"]').textContent();
      console.log("순마진 재계산:", margin);
    }
    await page.locator('#sheet tbody tr[data-id] input[data-act="sel-row"]').first().check();
    await page.waitForTimeout(250);
    console.log("선택 배너:", (await page.locator(".banner.info").first().textContent()).replace(/\s+/g, " ").slice(0, 40));
  }

  // 엑셀 양식 내려받기
  const dl = page.waitForEvent("download", { timeout: 15000 }).catch(() => null);
  await page.click("#btn-excel");
  const file = await dl;
  console.log("엑셀 내려받기:", file ? await file.suggestedFilename() : "실패");
  if (file) {
    const p = path.join("/tmp", "smoke-" + (await file.suggestedFilename()));
    await file.saveAs(p);
    console.log("  크기:", (fs.statSync(p).size / 1024).toFixed(0), "KB");
  }

  await browser.close();
  server.close();
  if (errors.length) {
    console.log("\n오류 " + errors.length + "건:");
    errors.forEach((e) => console.log(" -", e));
    process.exit(1);
  }
  console.log("\n오류 없음");
})();
