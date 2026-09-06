#!/usr/bin/env node
/* 내보낸 소스 양식 파일 검증 — node tools/verify-export.js <내보낸.xlsx> [원본샘플.xlsx]
 * 36열 헤더가 원본과 같은 순서인지, 행 수가 맞는지, 앱이 채운 열이 들어갔는지 확인합니다. */
"use strict";
const fs = require("fs"), path = require("path");
require(path.join(__dirname, "..", "xlsx-lite.js"));
const X = globalThis.XlsxLite;
const HEADER = ["수집일","주문일","판매사이트 주문번호","판매사이트명","판매자ID","판매가","배송비금액","마스터상품코드","판매사이트 상품코드","상품명","판매자상품코드","주문선택사항","주문수량","에누리","구매링크","구매가","구매자명","수령자명","수령자전화번호","수령자휴대폰번호","배송지우편번호","배송지주소","배송메세지","담당자","구매처","계정","구매금액","주문번호　앞부분","결제일시","카드정보","포인트","주문여부","한줄메모","주문고유번호","배송사명","송장번호"];
function ab(p) { const b = fs.readFileSync(p); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); }
let fail = 0;
function ok(name, cond, extra) { console.log((cond ? "  ok  " : "  FAIL ") + name + (cond ? "" : " — " + extra)); if (!cond) fail++; }
(async () => {
  const out = process.argv[2], src = process.argv[3];
  const wb = await X.read(ab(out));
  const rows = wb.sheet(wb.names[0]);
  ok("시트명이 날짜(YYYY-MM-DD)", /^\d{4}-\d{2}-\d{2}$/.test(wb.names[0]), wb.names[0]);
  ok("헤더 36열 순서 동일", JSON.stringify(rows[0]) === JSON.stringify(HEADER), JSON.stringify(rows[0]).slice(0, 200));
  const body = rows.slice(1).filter((r) => r.some((v) => v !== ""));
  console.log("  행 수:", body.length);
  if (src) {
    const sw = await X.read(ab(src)); const srows = sw.sheet(sw.names[0]).slice(1).filter((r) => r.some((v) => v !== ""));
    ok("행 수 = 원본 행 수", body.length === srows.length, body.length + " vs " + srows.length);
    const H = (n) => HEADER.indexOf(n);
    let same = 0, filled = 0, codeOk = 0, codeN = 0;
    body.forEach((r, i) => {
      const s = srows[i] || [];
      if (String(r[H("상품명")]) === String(s[H("상품명")]) && String(r[H("수령자명")]) === String(s[H("수령자명")])) same++;
      if (String(r[H("주문여부")]) === "O") { filled++; if (r[H("배송사명")]) { codeN++; if (/^T\d{3}$/.test(String(r[H("배송사명")]))) codeOk++; } }
    });
    ok("상품명·수령자명 원본과 동일(순서 보존)", same === body.length, same + "/" + body.length);
    ok("주문여부 O 건이 있음", filled > 0, filled);
    ok("배송사명은 T코드", codeN > 0 && codeOk === codeN, codeOk + "/" + codeN);
    const dateCell = body[0][H("주문일")];
    ok("주문일 값 보존", String(dateCell).length >= 10, JSON.stringify(dateCell));
    ok("송장번호 지수표기 아님", body.every((r) => !/e\+/i.test(String(r[H("송장번호")]))), "");
  }
  console.log(fail ? "\n실패 " + fail + "건" : "\n검증 통과");
  process.exit(fail ? 1 : 0);
})();
