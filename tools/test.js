#!/usr/bin/env node
/* 회귀 테스트 —  node tools/test.js [워크북.xlsx]
 * 워크북 경로를 주면 실제 파일로 읽기/집계까지 검사합니다.
 */
"use strict";
const path = require("path");
const fs = require("fs");
require(path.join(__dirname, "..", "core.js"));
require(path.join(__dirname, "..", "xlsx-lite.js"));
require(path.join(__dirname, "..", "import.js"));
require(path.join(__dirname, "..", "template.js"));
const Core = globalThis.OrderCore, Xlsx = globalThis.XlsxLite,
  Importer = globalThis.OrderImport, Template = globalThis.OrderTemplate;

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  ok  " + name); }
  else { fail++; console.log("  FAIL " + name + (extra ? " — " + extra : "")); }
}
function near(a, b, tol) { return a != null && Math.abs(a - b) <= (tol == null ? 1 : tol); }

console.log("\n[1] 마진 계산 — 워크북 실제 값과 대조");
[
  { in: { salePrice: 49800, shipFee: 0, buyAmount: 42100, qty: 1, category: "쌀", siteName: "쿠팡(신)" },
    want: { settleBase: 46622.76, netMargin: 4111.6, fee: 3177.24, vat: 411.16, olla: 478.08, rate: 0.0825 } },
  { in: { salePrice: 53150, shipFee: 0, buyAmount: 42100, qty: 1, category: "쌀", siteName: "쿠팡(신)" },
    want: { settleBase: 49759.03, netMargin: 6962.75, fee: 3390.97, vat: 696.28, olla: 510.24, rate: 0.131 } },
  { in: { salePrice: 20560, shipFee: 0, buyAmount: 15960, qty: 1, category: "주방용품", siteName: "쿠팡(신)" },
    want: { settleBase: 18117.47, netMargin: 1961.34, fee: 2442.53, vat: 196.13, olla: 197.38, rate: 0.0954 } }
].forEach((t, i) => {
  const o = Core.computeOrder(Object.assign({}, t.in), {});
  ok(`행${i + 1} 결제기준가`, near(o.settleBase, t.want.settleBase, 0.02), o.settleBase);
  ok(`행${i + 1} 순마진`, near(o.netMargin, t.want.netMargin, 0.6), o.netMargin);
  ok(`행${i + 1} 수수료`, near(o.fee, t.want.fee, 0.02), o.fee);
  ok(`행${i + 1} 부가세`, near(o.vat, t.want.vat, 0.6), o.vat);
  ok(`행${i + 1} 올라수수료`, near(o.ollaFee, t.want.olla, 0.02), o.ollaFee);
  ok(`행${i + 1} 마진률`, near(o.marginRate, t.want.rate, 0.001), o.marginRate);
});

console.log("\n[2] 마진 계산 — 입력이 모자란 경우");
{
  const o = Core.computeOrder({ salePrice: 10000, qty: 1, category: "쌀", siteName: "쿠팡(신)" }, {});
  ok("구매금액 없으면 순마진은 null", o.netMargin === null);
  const o2 = Core.computeOrder({ salePrice: 10000, qty: 1, buyAmount: 9000, category: "없는분류" }, {});
  ok("수수료율 못 찾으면 순마진 null", o2.netMargin === null);
  const o3 = Core.computeOrder({ salePrice: 10000, qty: 2, buyUnitPrice: 4000, category: "쌀", siteName: "쿠팡(신)" }, {});
  ok("구매금액 비면 구매가x수량 사용", o3.netMargin != null && o3.netMargin < 2000, o3.netMargin);
}

console.log("\n[3] 블랙리스트 판정");
{
  const bl = [
    { name: "김성일", address: "인천광역시 계양구 효성동 623-3 하나아파트 4동 702호" },
    { name: "봉성현", address: "" },
    { name: "김성*", address: "" }
  ];
  const hit = Core.checkBlacklist({ recipient: "김성일", address: "인천광역시 계양구 효성동 623-3 하나아파트 4동 702호" }, bl);
  ok("이름+주소 모두 맞으면 danger", hit.level === "danger", hit.level);
  const nameOnly = Core.checkBlacklist({ recipient: "봉성현", address: "서울시 어딘가 123" }, bl);
  ok("주소 없는 등록은 이름만 맞아도 danger", nameOnly.level === "danger", nameOnly.level);
  const other = Core.checkBlacklist({ recipient: "김성일", address: "부산광역시 해운대구 우동 1" }, bl);
  ok("이름만 맞고 주소 다르면 warn", other.level === "warn", other.level);
  const none = Core.checkBlacklist({ recipient: "홍길동", address: "서울시 종로구 1" }, bl);
  ok("무관한 주문은 통과", none.level === "", none.level);
  ok("마스킹 이름(김성*) 인식", Core.nameMatches("김성일", "김성*"));
  ok("슬래시 별칭(김성일/신선근) 인식", Core.nameMatches("신선근", "김성일/신선근"));
  ok("다른 사람은 오탐 안 함", !Core.nameMatches("김성수", "김성일"));
}

console.log("\n[4] 택배사 코드");
ok("T025 → CJ대한통운", Core.courierByCode("T025").name === "CJ대한통운");
ok("이름으로도 코드 변환", Core.normalizeCourier("CJ") === "T025");
ok("한진 → T081", Core.normalizeCourier("한진택배") === "T081");

console.log("\n[5] 날짜 변환");
ok("직렬값 → 문자열", Xlsx.serialToString(46266.428, true).indexOf("2026-09-01") === 0, Xlsx.serialToString(46266.428, true));
ok("문자열 → 직렬값 왕복", Math.abs(Core.toSerial("2026-09-01") - 46266) < 0.001);
ok("dateOnly", Core.dateOnly("2026-09-01 10:16") === "2026-09-01");

console.log("\n[6] 붙여넣기 파싱");
{
  const text = "주문일\t판매사이트 주문번호\t상품명\t주문수량\t판매가\n2026-09-01\t123456\t테스트상품\t2\t10000";
  const list = Importer.fromPaste(text);
  ok("헤더 이름으로 매핑", list.length === 1 && list[0].productName === "테스트상품", JSON.stringify(list[0] || {}));
  ok("수량/금액 숫자 변환", list[0] && list[0].qty === 2 && list[0].salePrice === 10000);
}

console.log("\n[7] 엑셀 쓰기/읽기 왕복");
{
  const bytes = Xlsx.buildBytes([{
    name: "T", rows: [[{ v: "이름", s: "header" }, { v: "값", s: "header" }], ["가", { v: 1234, s: "money" }],
      [{ v: "", s: "base" }, { s: "money", f: "B2*2" }]],
    freeze: { row: 1 }, autoFilter: "A1:B3",
    validations: [{ sqref: "A2:A9", values: ["가", "나"] }],
    condFormats: [{ sqref: "A2:B9", rules: [{ formula: "$B2>1000", dxf: 0 }] }]
  }]);
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const done = Xlsx.read(ab).then((wb) => {
    const rows = wb.sheet("T");
    ok("왕복 시트명", wb.names[0] === "T");
    ok("왕복 값", rows[1][0] === "가" && rows[1][1] === 1234, JSON.stringify(rows));
  });
  module.exports = done;
}

const SRC = process.argv[2];
if (SRC && fs.existsSync(SRC)) {
  const buf = fs.readFileSync(SRC);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  Xlsx.read(ab).then((wb) => {
    console.log("\n[8] 실제 워크북 읽기");
    const rows = wb.pick(["2.주문서"]);
    ok("주문서 시트 찾음", !!rows);
    ok("헤더 3행 위치", rows[2][0] === "수집일" && rows[2][32] === "메모", rows[2][32]);
    ok("자기닫힘 셀 뒤 값이 밀리지 않음",
      rows[3][31] === "O" && rows[3][33] === "100012771465",
      JSON.stringify(rows[3].slice(29, 35)));

    const data = Importer.fromWorkbook(wb);
    ok("주문 266건", data.orders.length === 266, data.orders.length);
    ok("블랙리스트 읽음", data.blacklist.length > 100, data.blacklist.length);
    ok("수수료 읽음", data.fees.length > 30, data.fees.length);
    ok("CS 읽음", data.cs.length > 50, data.cs.length);
    const yn = {};
    data.orders.forEach((o) => { yn[o.orderedYn] = (yn[o.orderedYn] || 0) + 1; });
    ok("주문여부 분포 O=99 X=4", yn.O === 99 && yn.X === 4, JSON.stringify(yn));

    data.orders.forEach((o) => Core.computeOrder(o, { fees: data.fees }));
    const ready = data.orders.filter((o) => o.netMargin != null);
    ok("순마진 계산된 건 있음", ready.length > 90, ready.length);

    let risk = 0;
    data.orders.forEach((o) => { if (Core.checkBlacklist(o, data.blacklist).level) risk++; });
    ok("블랙리스트 일치 주문 탐지", risk > 0 && risk < data.orders.length, risk + "건");

    console.log("\n[9] 엑셀 양식 생성");
    const out = Template.buildBytes(data);
    ok("양식 생성됨", out.length > 100000, (out.length / 1024).toFixed(0) + "KB");
    const ab2 = out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
    return Xlsx.read(ab2).then((wb2) => {
      ok("시트 12개", wb2.names.length === 12, wb2.names.join(","));
      const o = wb2.sheet("주문서");
      ok("헤더 3행 동일", o[2][0] === "수집일" && o[2][53] === "블랙리스트", o[2][53]);
      ok("첫 데이터 4행", String(o[3][9] || "").length > 0, o[3][9]);
      finish();
    });
  }).catch((e) => { console.error(e); process.exit(1); });
} else {
  setTimeout(finish, 300);
}

function finish() {
  console.log("\n결과: " + pass + " 통과 / " + fail + " 실패");
  process.exit(fail ? 1 : 0);
}
