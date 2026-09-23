#!/usr/bin/env node
/* 자동화 관제 데모 검증 — node tools/demo-smoke.js [초=25] [배속=600]
 *   ?demo=1 로 열어 콘솔 오류·KPI(연매출 페이스 ≈ 80억)·탭별 렌더·DOM 안정성·종료 후 복원을 확인합니다.
 *   SHOTS=1 → /tmp/shots/demo-*.png */
"use strict";
const path = require("path"), fs = require("fs"), http = require("http");
const { chromium } = require("playwright");
const ROOT = path.join(__dirname, "..");
const SECS = parseInt(process.argv[2] || "25", 10), SPEED = parseInt(process.argv[3] || "600", 10);
const PORT = parseInt(process.env.PORT || "8791", 10);
const MIME = { ".html":"text/html; charset=utf-8", ".js":"text/javascript; charset=utf-8", ".css":"text/css", ".xlsx":"application/octet-stream", ".xls":"application/octet-stream", ".csv":"text/csv", ".png":"image/png" };
(async () => {
  const server = http.createServer((req, res) => {
    const p = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]));
    if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "Content-Type": MIME[path.extname(p)] || "application/octet-stream" }); fs.createReadStream(p).pipe(res);
  });
  await new Promise((r) => server.listen(PORT, r));
  if (process.env.SHOTS) fs.mkdirSync("/tmp/shots", { recursive: true });
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, timezoneId: "Asia/Seoul", locale: "ko-KR" });
  const page = await ctx.newPage();
  const errors = [], consoleErr = [];
  page.on("pageerror", (e) => consoleErr.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") consoleErr.push(m.text()); });
  const t0 = Date.now();
  await page.goto(`http://localhost:${PORT}/index.html?demo=1&speed=${SPEED}`);
  await page.waitForTimeout(1500);
  const on = await page.evaluate(() => !!(window.Demo && Demo.active));
  console.log("데모 활성:", on, "| 배속:", await page.evaluate(() => Demo.speed));
  if (!on) errors.push("데모가 켜지지 않음");
  const grab = async () => page.evaluate(() => {
    const k = Demo.kpis(); const s = OH.state;
    return { pace: k.pace, today: k.today.rev, cnt: k.today.cnt, month: k.month.rev, ytd: k.ytd.rev, human: k.human, orders: s.orders.length, cs: s.orders.filter((o) => o.csType).length, feed: Demo.state.feed.length, stages: k.stages, auto: k.autoRate, csAuto: k.csAutoRate, dom: document.getElementsByTagName("*").length, clock: new Date(Demo.now()).toISOString() };
  });
  const a = await grab();
  console.log("시작:", JSON.stringify(a));
  if (Math.abs(a.pace / 8e9 - 1) > 0.08) errors.push("연매출 페이스가 80억 ±8% 밖: " + a.pace);
  if (process.env.SHOTS) await page.screenshot({ path: "/tmp/shots/demo-autopilot-0.png", fullPage: false });
  // 다른 탭들 렌더
  for (const tab of ["process", "dashboard", "orders", "cs", "daily", "profit", "lineup", "sourcing", "invoice", "blacklist", "loss", "journal", "calc"]) {
    await page.click(`#tabnav [data-tab="${tab}"]`); await page.waitForTimeout(700);
    const txt = (await page.locator(`#pane-${tab}`).innerText()).replace(/\s+/g, " ").trim();
    console.log(`  [${tab}] ${txt.length}자 · ${txt.slice(0, 110)}`);
    if (txt.length < 40) errors.push(`${tab} 탭이 비어 보임`);
    if (process.env.SHOTS) await page.screenshot({ path: `/tmp/shots/demo-${tab}.png`, fullPage: false });
  }
  await page.click('#tabnav [data-tab="autopilot"]'); await page.waitForTimeout(1200);
  const mid = await grab();
  const wait = Math.max(0, SECS * 1000 - (Date.now() - t0));
  await page.waitForTimeout(wait);
  const b = await grab();
  console.log("종료 직전:", JSON.stringify(b));
  if (b.today <= a.today && SPEED >= 60) errors.push("오늘 매출이 늘지 않음");
  if (b.orders > 340) errors.push("주문 창이 320 이상으로 커짐: " + b.orders);
  if (b.dom > mid.dom + 600) errors.push("관제 탭 DOM 노드가 계속 늘어남: " + mid.dom + " → " + b.dom);
  const st = b.stages; if (st.ordered > st.collected || st.checked > st.collected) errors.push("단계 건수 모순(발주/검수 > 수집): " + JSON.stringify(st));
  const feedTop = await page.locator("#pane-autopilot .ap-ev").first().innerText().catch(() => "");
  console.log("피드 최신:", feedTop.replace(/\s+/g, " ").slice(0, 100));
  const csCards = await page.locator("#pane-autopilot .ap-csi").count();
  console.log("CS 카드:", csCards, "| KPI:", (await page.locator("#pane-autopilot .ap-kpis").innerText()).replace(/\s+/g, " ").slice(0, 160));
  if (process.env.SHOTS) await page.screenshot({ path: "/tmp/shots/demo-autopilot-1.png", fullPage: false });
  if (process.env.SHOTS) await page.screenshot({ path: "/tmp/shots/demo-autopilot-full.png", fullPage: true });
  // 종료 → 실제 데이터 복원(빈 상태 → 업로드 화면)
  await page.click("#btn-demo"); await page.waitForTimeout(500);
  const after = await page.evaluate(() => ({ active: Demo.active, orders: OH.state.orders.length, upload: !document.getElementById("view-upload").classList.contains("hidden"), ls: localStorage.getItem("oh_orders_v1") }));
  console.log("종료 후:", JSON.stringify(after));
  if (after.active || after.orders !== 0 || !after.upload) errors.push("데모 종료 후 복원 실패: " + JSON.stringify(after));
  if (after.ls && after.ls.length > 5) errors.push("데모 데이터가 localStorage 에 저장됨");
  const realErr = consoleErr.filter((e) => !/favicon/.test(e));
  if (realErr.length) errors.push("콘솔 오류 " + realErr.length + "건: " + realErr.slice(0, 3).join(" | "));
  await browser.close(); server.close();
  if (errors.length) { console.log("\n오류 " + errors.length + "건:"); errors.forEach((e) => console.log(" -", e)); process.exit(1); }
  console.log("\n오류 없음");
})();
