#!/usr/bin/env node
/* 내보낸 소스 양식 파일 검증 — node tools/verify-export.js <내보낸.xlsx> [원본샘플.xlsx]
 * 36열 헤더가 원본과 같은 순서인지, 행 수가 맞는지, 앱이 채운 열이 들어갔는지 확인합니다. */
"use strict";
const fs = require("fs"), path = require("path");
require(path.join(__dirname, "..", "xlsx-lite.js"));
const B = require(path.join(__dirname, "..", "biff.js"));
const XL = globalThis.XlsxLite;
// .xls(CFB) 는 biff.js, 그 외(.xlsx) 는 xlsx-lite 로 읽음
const X = { read: (buf) => B.isCfb(new Uint8Array(buf)) ? Promise.resolve(B.read(buf)) : XL.read(buf) };
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
    const H = (n) => HEADER.indexOf(n);
    const key = (r) => String(r[H("주문고유번호")] || "").replace(/\.0+$/, "");
    const srcByKey = {}; srows.forEach((r) => { srcByKey[key(r)] = r; });
    // 기본 내보내기는 '송장 있는 건만' 이므로 행 수는 원본 이하. 각 행이 원본과 같은 주문인지 키로 대조
    let matched = 0, same = 0, invoiced = 0, codeOk = 0, codeN = 0;
    body.forEach((r) => {
      const s = srcByKey[key(r)];
      if (!s) return;
      matched++;
      if (String(r[H("상품명")]) === String(s[H("상품명")]) && String(r[H("수령자명")]) === String(s[H("수령자명")])) same++;
      if (String(r[H("송장번호")])) invoiced++;
      if (r[H("배송사명")]) { codeN++; if (/^T\d{3}$/.test(String(r[H("배송사명")]))) codeOk++; }
    });
    ok("모든 행이 원본 주문과 키로 연결됨", matched === body.length, matched + "/" + body.length);
    ok("상품명·수령자명 원본과 동일", same === body.length, same + "/" + body.length);
    ok("행 수 ≤ 원본 (송장 있는 건만 또는 전체)", body.length <= srows.length, body.length + " vs " + srows.length);
    if (body.length < srows.length) ok("부분 내보내기면 전부 송장 있는 건", invoiced === body.length, invoiced + "/" + body.length);
    ok("배송사명은 T코드", codeN > 0 && codeOk === codeN, codeOk + "/" + codeN);
    const dateCell = body[0][H("주문일")];
    ok("주문일 값 보존", String(dateCell).length >= 10, JSON.stringify(dateCell));
    ok("송장번호 지수표기 아님", body.every((r) => !/e\+/i.test(String(r[H("송장번호")]))), "");
    ok("우편번호 5자리", body.every((r) => /^\d{5}$/.test(String(r[H("배송지우편번호")]))), body.map((r) => r[H("배송지우편번호")]).slice(0, 5).join(","));
  }
  console.log(fail ? "\n실패 " + fail + "건" : "\n검증 통과");
  process.exit(fail ? 1 : 0);
})();
