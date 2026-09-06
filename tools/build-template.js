#!/usr/bin/env node
/* =====================================================================
 * tools/build-template.js — 통합 주문관리 엑셀 양식 파일 만들기
 *
 *   node tools/build-template.js [원본워크북.xlsx] [출력.xlsx] [--blank]
 *
 *   - 원본 워크북을 주면 그 데이터(주문/블랙리스트/수수료/CS/사입/계정)를
 *     그대로 담은 "업그레이드 버전"을 만듭니다.
 *   - --blank 를 주면 데이터 없이 빈 양식만 만듭니다.
 *   - 원본을 안 주면 기본 수수료표만 들어간 빈 양식이 나옵니다.
 *
 * 이 스크립트는 앱의 [엑셀 양식 내려받기] 버튼과 같은 코드를 씁니다.
 * ===================================================================== */
"use strict";

var fs = require("fs");
var path = require("path");

require(path.join(__dirname, "..", "core.js"));
require(path.join(__dirname, "..", "xlsx-lite.js"));
require(path.join(__dirname, "..", "import.js"));
require(path.join(__dirname, "..", "template.js"));

var Xlsx = globalThis.XlsxLite;
var Importer = globalThis.OrderImport;
var Template = globalThis.OrderTemplate;

var args = process.argv.slice(2).filter(function (a) { return a !== "--blank"; });
var blank = process.argv.indexOf("--blank") !== -1;
var src = args[0];
var out = args[1] || path.join(process.cwd(), "우루루_통합_주문관리_양식.xlsx");

function write(data) {
  var bytes = Template.buildBytes(data);
  fs.writeFileSync(out, Buffer.from(bytes));
  console.log("생성 완료:", out, "(" + (bytes.length / 1024).toFixed(0) + " KB)");
  console.log("시트:", Template.buildWorkbook(data).sheets.map(function (s) { return s.name; }).join(" · "));
}

if (!src) {
  write({ year: new Date().getFullYear() });
} else {
  var buf = fs.readFileSync(src);
  var ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  Xlsx.read(ab).then(function (wb) {
    console.log("원본 시트:", wb.names.join(" · "));
    var data = Importer.fromWorkbook(wb);
    console.log("읽어온 것:", data.found.join(", ") || "없음");
    console.log("주문", data.orders.length, "건 · 블랙리스트", data.blacklist.length,
      "건 · 수수료", data.fees.length, "행 · CS", data.cs.length, "건 · 사입", data.stock.length, "건");
    if (blank) {
      write({ year: new Date().getFullYear(), fees: data.fees });
      return;
    }
    data.orders.forEach(function (o) { globalThis.OrderCore.computeOrder(o, { fees: data.fees }); });
    var year = new Date().getFullYear();
    for (var i = 0; i < data.orders.length; i++) {
      var d = globalThis.OrderCore.dateOnly(data.orders[i].orderedAt);
      if (d) { year = parseInt(d.slice(0, 4), 10); break; }
    }
    data.year = year;
    write(data);
  }).catch(function (e) {
    console.error("읽기 실패:", e.message);
    process.exit(1);
  });
}
