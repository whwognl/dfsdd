#!/usr/bin/env node
/* 단일 파일 빌드 — index.html + 스크립트 5개를 하나의 .html 로 합칩니다.
 *   node tools/build-single.js [출력경로]
 * 결과 파일은 더블클릭만 하면 열리고, 서버도 인터넷도 필요 없습니다.
 */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const out = process.argv[2] || path.join(ROOT, "dist", "우루루_통합_주문관리.html");

let html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

html = html.replace(/<script src="([^"?]+)(\?[^"]*)?"><\/script>\s*/g, (m, file) => {
  const p = path.join(ROOT, file);
  if (!fs.existsSync(p)) throw new Error("없는 파일: " + file);
  const code = fs.readFileSync(p, "utf8").replace(/<\/script>/gi, "<\\/script>");
  return `<script>\n/* ===== ${file} ===== */\n${code}\n</script>\n`;
});

// --artifact: 아티팩트로 게시할 때는 <!doctype>/<html>/<head>/<body> 껍데기를 벗깁니다
if (process.argv.includes("--artifact")) {
  const head = html.match(/<head>([\s\S]*?)<\/head>/i);
  const body = html.match(/<body>([\s\S]*?)<\/body>/i);
  if (!head || !body) throw new Error("head/body 를 찾지 못했습니다");
  const inner = head[1]
    .replace(/<meta[^>]*>\s*/gi, "")
    .trim();
  html = inner + "\n" + body[1].trim() + "\n";
}

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html, "utf8");
console.log("생성 완료:", out, "(" + (Buffer.byteLength(html) / 1024).toFixed(0) + " KB)");
