/* =====================================================================
 * template.js — "수기로도 쓸 수 있는" 통합 주문관리 엑셀 양식 생성기
 *
 * 2026-09 최신 워크북의 열 이름·순서를 그대로 유지하되,
 * 손으로 계산하던 부분을 전부 수식/드롭다운/조건부서식으로 바꿉니다.
 *
 *   - 수수료율·결제기준가·순마진·마진률·부가세·올라수수료 → 자동 수식
 *   - 담당자/구매처/카드/주문여부/배송사/카테고리        → 드롭다운
 *   - 블랙리스트 이름·주소 일치                          → 빨간색 "위험" 자동 표시
 *   - 송장 업로드 완료 여부                              → 자동 대조
 *   - 대시보드 / DAY / MON                               → 수식 기반 자동 집계
 *
 * 브라우저(app.js)와 node(tools/build-template.js) 양쪽에서 씁니다.
 * ===================================================================== */
(function (global) {
  "use strict";

  var Core = global.OrderCore || (typeof require !== "undefined" ? require("./core.js") : null);
  var Xlsx = global.XlsxLite || (typeof require !== "undefined" ? require("./xlsx-lite.js") : null);
  var L = Xlsx.colName;

  var COLS = Core.ORDER_COLUMNS;
  var HEADER_ROW = 3;          // 헤더 = 3행 (원본 워크북과 동일)
  var FIRST_DATA_ROW = 4;
  var FILL_ROWS = 400;         // 빈 행에도 수식을 미리 깔아둘 개수
  var BL_ROWS = 600;           // 블랙리스트 참조 범위
  var FEE_ROWS = 200;

  /* 열 인덱스 → 엑셀 문자 (주문서 기준) */
  var IDX = {};
  COLS.forEach(function (c, i) { IDX[c.key] = i; });
  function C(key) { return L(IDX[key]); }           // 예: C("salePrice") -> "F"
  var EXTRA_RISK = COLS.length;                     // 경고 열
  var EXTRA_STEP = COLS.length + 1;                 // 진행상태 열
  var RISK = L(EXTRA_RISK), STEP = L(EXTRA_STEP);
  var LAST_COL = L(EXTRA_STEP);

  function styleFor(col) {
    if (col.type === "money") return col.kind === "input" ? "moneyInput" : "money";
    if (col.type === "int") return col.kind === "input" ? "intInput" : "int";
    if (col.type === "pct") return "pct2";
    if (col.type === "date") return "date";
    if (col.type === "datetime") return "datetime";
    if (col.kind === "input") return "input";
    return "base";
  }

  /* ---------------------------------------------------------------
   * 주문서 시트
   * --------------------------------------------------------------- */
  function orderSheet(data) {
    var orders = data.orders || [];
    var rows = [];

    rows[0] = [{ v: "주문서 — 통합 주문관리", s: "title" }];
    rows[0][IDX.manager] = { v: "파란 칸 = 직접 입력 / 흰 칸 = 자동 수집·자동 계산", s: "note" };
    rows[1] = [{ v: "빨간 '위험' 표시는 블랙리스트 이름·주소와 일치한다는 뜻입니다. 발송 전 반드시 확인하세요.", s: "note" }];

    // 헤더(3행)
    var head = COLS.map(function (c) { return { v: c.label, s: "header" }; });
    head[EXTRA_RISK] = { v: "블랙리스트", s: "header" };
    head[EXTRA_STEP] = { v: "진행상태", s: "header" };
    rows[HEADER_ROW - 1] = head;

    var total = Math.max(orders.length + FILL_ROWS, FILL_ROWS);
    for (var i = 0; i < total; i++) {
      var r = FIRST_DATA_ROW + i;           // 실제 엑셀 행번호
      var o = orders[i] || null;
      rows[r - 1] = dataRow(o, r);
    }

    var cols = COLS.map(function (c) { return { w: c.w }; });
    cols[EXTRA_RISK] = { w: 12 };
    cols[EXTRA_STEP] = { w: 11 };

    var lastRow = FIRST_DATA_ROW + total - 1;
    var body = "$A$" + FIRST_DATA_ROW + ":$" + LAST_COL + "$" + lastRow;

    return {
      name: "주문서",
      tabSelected: true,
      rows: rows,
      cols: cols,
      freeze: { row: HEADER_ROW, col: 4 },
      autoFilter: "A" + HEADER_ROW + ":" + LAST_COL + lastRow,
      rowHeights: { 1: 26, 2: 18, 3: 30 },
      validations: [
        { sqref: C("manager") + FIRST_DATA_ROW + ":" + C("manager") + lastRow, formula: "담당자목록" },
        { sqref: C("vendor") + FIRST_DATA_ROW + ":" + C("vendor") + lastRow, formula: "구매처목록" },
        { sqref: C("cardName") + FIRST_DATA_ROW + ":" + C("cardName") + lastRow, formula: "카드목록" },
        { sqref: C("orderedYn") + FIRST_DATA_ROW + ":" + C("orderedYn") + lastRow, values: ["O", "X"] },
        { sqref: C("courierCode") + FIRST_DATA_ROW + ":" + C("courierCode") + lastRow, formula: "택배사목록" },
        { sqref: C("category") + FIRST_DATA_ROW + ":" + C("category") + lastRow, formula: "카테고리목록" }
      ],
      condFormats: [{
        sqref: body.replace(/\$/g, ""),
        rules: [
          { formula: "$" + RISK + FIRST_DATA_ROW + '="위험"', dxf: 0, priority: 1 },
          { formula: "$" + RISK + FIRST_DATA_ROW + '="주소확인"', dxf: 1, priority: 2 },
          { formula: "$" + STEP + FIRST_DATA_ROW + '="업로드완료"', dxf: 2, priority: 4 },
          { formula: "N($" + C("netMargin") + FIRST_DATA_ROW + ")<0", dxf: 3, priority: 3 }
        ]
      }]
    };
  }

  function dataRow(o, r) {
    var row = [];
    var sale = "$" + C("salePrice") + r;
    var guard = "IF(" + sale + '="","",';

    COLS.forEach(function (col, ci) {
      var style = styleFor(col);
      if (col.kind === "calc") {
        row[ci] = { s: style, f: calcFormula(col.key, r) };
        return;
      }
      if (!o) { row[ci] = { v: "", s: style }; return; }
      var v = o[col.key];
      if (v === null || v === undefined || v === "") { row[ci] = { v: "", s: style }; return; }
      if (col.type === "money" || col.type === "int") row[ci] = { v: Core.toNumber(v), s: style };
      else if (col.type === "date" || col.type === "datetime") {
        var serial = Core.toSerial(v);
        row[ci] = serial == null ? { v: String(v), s: style } : { v: serial, s: style };
      } else row[ci] = { v: String(v), s: style };
    });

    // 블랙리스트 경고 — COUNTIF의 '*' 와일드카드가 마스킹 이름(김성*)까지 잡아줍니다.
    row[EXTRA_RISK] = {
      s: "center",
      f: "IF($" + C("recipient") + r + '="","",' +
        "IF(COUNTIF(블랙리스트!$A$2:$A$" + BL_ROWS + ",$" + C("recipient") + r + ')>0,"위험",' +
        "IF(SUMPRODUCT((블랙리스트!$B$2:$B$" + BL_ROWS + '<>"")*ISNUMBER(SEARCH(블랙리스트!$B$2:$B$' + BL_ROWS +
        '&"",$' + C("address") + r + '&"")))>0,"주소확인","")))'
    };
    row[EXTRA_STEP] = {
      s: "center",
      f: "IF($" + C("productName") + r + '="","",' +
        "IF($" + C("invoiceUploaded") + r + '="완료","업로드완료",' +
        "IF($" + C("invoiceNo") + r + '<>"","송장입력",' +
        "IF(UPPER($" + C("orderedYn") + r + ')="O","발주완료","신규"))))'
    };
    return row;
  }

  /* 계산 열 수식 — core.js의 computeOrder()와 같은 식 */
  function calcFormula(key, r) {
    var sale = "$" + C("salePrice") + r;
    var g = 'IF(' + sale + '="","",';
    switch (key) {
      case "settleSite":
        return "IF($" + C("siteName") + r + '="","",$' + C("siteName") + r + ")";
      case "settleOrderNo":
        return "IF($" + C("siteOrderNo") + r + '="","",IFERROR(LEFT($' + C("siteOrderNo") + r +
          ',FIND(" ",$' + C("siteOrderNo") + r + '&" ")-1),$' + C("siteOrderNo") + r + "))";
      case "saleDate":
        return "IF($" + C("orderedAt") + r + '="","",INT($' + C("orderedAt") + r + "))";
      case "revenue":
        return g + sale + ")";
      case "feeRate":
        return "IF($" + C("category") + r + '="","",IFERROR(VLOOKUP($' + C("category") + r +
          ",수수료!$A$2:$D$" + FEE_ROWS + ',3,FALSE),""))';
      case "feeRateVat":
        return "IF($" + C("feeRate") + r + '="","",ROUND($' + C("feeRate") + r + "*1.1,6))";
      case "settleBase":
        return "IF(OR(" + sale + '="",$' + C("feeRateVat") + r + '=""),"",ROUND(' + sale +
          "*(1-$" + C("feeRateVat") + r + "),2))";
      case "shipNet":
        return "IF($" + C("feeRateVat") + r + '="","",ROUND(N($' + C("shipFee") + r +
          ")*(1-$" + C("feeRateVat") + r + "),2))";
      case "fee":
        return "IF(OR(" + sale + '="",$' + C("feeRateVat") + r + '=""),"",ROUND(' + sale +
          "*$" + C("feeRateVat") + r + ",2))";
      case "netMargin":
        return "IF(OR($" + C("settleBase") + r + '="",N($' + C("buyAmount") + r + ')=0),"",' +
          "ROUND(($" + C("settleBase") + r + "+N($" + C("shipNet") + r + ")-N($" + C("buyAmount") + r +
          ")-N($" + C("discount") + r + "))/1.1,0))";
      case "vat":
        return "IF($" + C("netMargin") + r + '="","",ROUND($' + C("netMargin") + r + "*0.1,0))";
      case "marginRate":
        return "IF(OR($" + C("netMargin") + r + '="",N(' + sale + ')=0),"",$' + C("netMargin") + r + "/" + sale + ")";
      case "pointOut":
        return "N($" + C("point") + r + ")";
      case "ollaFee":
        return g + "ROUND(" + sale + "*0.0096,0))";
      case "invoiceUploaded":
        return "IF($" + C("uniqueNo") + r + '="","",IF(COUNTIF(송장업로드!$A$2:$A$5000,$' +
          C("uniqueNo") + r + ')>0,"완료","대기"))';
      default:
        return "";
    }
  }

  /* ---------------------------------------------------------------
   * 대시보드 — 전부 수식. 주문서에 입력하면 즉시 반영됩니다.
   * --------------------------------------------------------------- */
  function dashboardSheet(year) {
    var R = "주문서!$" + C("saleDate") + "$4:$" + C("saleDate") + "$5000";     // 매출일자
    var REV = "주문서!$" + C("revenue") + "$4:$" + C("revenue") + "$5000";      // 매출금액
    var MAR = "주문서!$" + C("netMargin") + "$4:$" + C("netMargin") + "$5000";  // 순마진
    var PNT = "주문서!$" + C("pointOut") + "$4:$" + C("pointOut") + "$5000";
    var NAME = "주문서!$" + C("productName") + "$4:$" + C("productName") + "$5000";
    var YN = "주문서!$" + C("orderedYn") + "$4:$" + C("orderedYn") + "$5000";
    var INV = "주문서!$" + C("invoiceNo") + "$4:$" + C("invoiceNo") + "$5000";
    var RISKR = "주문서!$" + RISK + "$4:$" + RISK + "$5000";
    var VEND = "주문서!$" + C("vendor") + "$4:$" + C("vendor") + "$5000";
    var MGR = "주문서!$" + C("manager") + "$4:$" + C("manager") + "$5000";
    var CAT = "주문서!$" + C("category") + "$4:$" + C("category") + "$5000";

    var rows = [];
    rows.push([{ v: "대시보드", s: "title" }, "", "", "", { v: "숫자는 모두 주문서 시트에서 자동 계산됩니다. 직접 고치지 마세요.", s: "note" }]);
    rows.push([]);

    // --- 오늘 / 이번달 KPI
    rows.push([{ v: "오늘", s: "subhead" }, { v: "이번달", s: "subhead" }, "", { v: "누적", s: "subhead" }]);
    rows.push([
      { v: "매출", s: "base" }, { s: "money", f: 'SUMIFS(' + REV + "," + R + ",TODAY())" },
      { v: "매출", s: "base" }, { s: "money", f: "SUMIFS(" + REV + "," + R + ',">="&EOMONTH(TODAY(),-1)+1,' + R + ',"<="&EOMONTH(TODAY(),0))' },
      { v: "총 매출", s: "base" }, { s: "money", f: "SUM(" + REV + ")" }
    ]);
    rows.push([
      { v: "순마진", s: "base" }, { s: "money", f: "SUMIFS(" + MAR + "," + R + ",TODAY())" },
      { v: "순마진", s: "base" }, { s: "money", f: "SUMIFS(" + MAR + "," + R + ',">="&EOMONTH(TODAY(),-1)+1,' + R + ',"<="&EOMONTH(TODAY(),0))' },
      { v: "총 순마진", s: "base" }, { s: "money", f: "SUM(" + MAR + ")" }
    ]);
    rows.push([
      { v: "마진률", s: "base" }, { s: "pct2", f: 'IF(B4=0,"",B5/B4)' },
      { v: "마진률", s: "base" }, { s: "pct2", f: 'IF(D4=0,"",D5/D4)' },
      { v: "총 마진률", s: "base" }, { s: "pct2", f: 'IF(F4=0,"",F5/F4)' }
    ]);
    rows.push([
      { v: "주문건수", s: "base" }, { s: "int", f: "COUNTIFS(" + R + ",TODAY())" },
      { v: "주문건수", s: "base" }, { s: "int", f: "COUNTIFS(" + R + ',">="&EOMONTH(TODAY(),-1)+1,' + R + ',"<="&EOMONTH(TODAY(),0))' },
      { v: "총 주문건수", s: "base" }, { s: "int", f: 'COUNTIF(' + NAME + ',"<>")' }
    ]);
    rows.push([
      { v: "포인트", s: "base" }, { s: "money", f: "SUMIFS(" + PNT + "," + R + ",TODAY())" },
      { v: "포인트", s: "base" }, { s: "money", f: "SUMIFS(" + PNT + "," + R + ',">="&EOMONTH(TODAY(),-1)+1,' + R + ',"<="&EOMONTH(TODAY(),0))' },
      { v: "총 포인트", s: "base" }, { s: "money", f: "SUM(" + PNT + ")" }
    ]);
    rows.push([]);

    // --- 처리 현황
    rows.push([{ v: "처리 현황", s: "subhead" }]);
    rows.push([{ v: "미발주(주문여부 X 또는 공백)", s: "base" },
      { s: "int", f: 'COUNTIFS(' + NAME + ',"<>",' + YN + ',"<>O")' },
      { v: "발주완료", s: "base" }, { s: "int", f: "COUNTIF(" + YN + ',"O")' },
      { v: "송장 미입력", s: "base" }, { s: "int", f: 'COUNTIFS(' + YN + ',"O",' + INV + ',"")' }]);
    rows.push([{ v: "블랙리스트 위험", s: "danger" }, { s: "int", f: "COUNTIF(" + RISKR + ',"위험")' },
      { v: "주소 확인 필요", s: "base" }, { s: "int", f: "COUNTIF(" + RISKR + ',"주소확인")' },
      { v: "역마진 건", s: "base" }, { s: "int", f: "COUNTIF(" + MAR + ',"<0")' }]);
    rows.push([]);

    // --- 월별
    rows.push([{ v: year + "년 월별", s: "subhead" }, "", "", "", "", ""]);
    rows.push([{ v: "월", s: "header" }, { v: "주문건수", s: "header" }, { v: "매출액", s: "header" },
      { v: "순마진", s: "header" }, { v: "포인트", s: "header" }, { v: "마진률", s: "header" }]);
    var monthStart = rows.length + 1;
    for (var m = 1; m <= 12; m++) {
      var r = monthStart + m - 1;
      var from = 'DATE(' + year + "," + m + ",1)";
      var to = "EOMONTH(" + from + ",0)";
      rows.push([
        { v: year + "-" + ("0" + m).slice(-2), s: "center" },
        { s: "int", f: "COUNTIFS(" + R + ',">="&' + from + "," + R + ',"<="&' + to + ")" },
        { s: "money", f: "SUMIFS(" + REV + "," + R + ',">="&' + from + "," + R + ',"<="&' + to + ")" },
        { s: "money", f: "SUMIFS(" + MAR + "," + R + ',">="&' + from + "," + R + ',"<="&' + to + ")" },
        { s: "money", f: "SUMIFS(" + PNT + "," + R + ',">="&' + from + "," + R + ',"<="&' + to + ")" },
        { s: "pct2", f: 'IF(C' + r + '=0,"",D' + r + "/C" + r + ")" }
      ]);
    }
    rows.push([{ v: "합계", s: "header" },
      { s: "int", f: "SUM(B" + monthStart + ":B" + (monthStart + 11) + ")" },
      { s: "money", f: "SUM(C" + monthStart + ":C" + (monthStart + 11) + ")" },
      { s: "money", f: "SUM(D" + monthStart + ":D" + (monthStart + 11) + ")" },
      { s: "money", f: "SUM(E" + monthStart + ":E" + (monthStart + 11) + ")" },
      { s: "pct2", f: 'IF(C' + (monthStart + 12) + '=0,"",D' + (monthStart + 12) + "/C" + (monthStart + 12) + ")" }]);
    rows.push([]);

    // --- 최근 30일
    rows.push([{ v: "최근 30일", s: "subhead" }]);
    rows.push([{ v: "날짜", s: "header" }, { v: "주문건수", s: "header" }, { v: "매출액", s: "header" },
      { v: "순마진", s: "header" }, { v: "마진률", s: "header" }]);
    var dayStart = rows.length + 1;
    for (var d = 29; d >= 0; d--) {
      var rr = dayStart + (29 - d);
      rows.push([
        { s: "date", f: "TODAY()-" + d },
        { s: "int", f: "COUNTIFS(" + R + ",$A" + rr + ")" },
        { s: "money", f: "SUMIFS(" + REV + "," + R + ",$A" + rr + ")" },
        { s: "money", f: "SUMIFS(" + MAR + "," + R + ",$A" + rr + ")" },
        { s: "pct2", f: 'IF(C' + rr + '=0,"",D' + rr + "/C" + rr + ")" }
      ]);
    }
    rows.push([]);

    // --- 구매처 / 담당자 / 카테고리별
    rows.push([{ v: "구매처별", s: "subhead" }, "", "", { v: "담당자별", s: "subhead" }, "", "",
      { v: "카테고리별", s: "subhead" }]);
    rows.push([{ v: "구매처", s: "header" }, { v: "건수", s: "header" }, { v: "순마진", s: "header" },
      { v: "담당자", s: "header" }, { v: "건수", s: "header" }, { v: "순마진", s: "header" },
      { v: "카테고리", s: "header" }, { v: "건수", s: "header" }, { v: "순마진", s: "header" }]);
    var brkStart = rows.length + 1;
    var vendors = ["11번가", "지마켓", "옥션", "롯데온", "롯데홈쇼핑", "신라쇼", "하프클럽", "쿠팡", "네이버"];
    var managers = ["명진", "본인"];
    var cats = ["쌀", "가공식품", "주방용품", "물티슈", "패션의류/패션잡화"];
    var maxLen = Math.max(vendors.length, managers.length, cats.length);
    for (var k = 0; k < maxLen; k++) {
      var rw = brkStart + k, line = [];
      if (vendors[k]) {
        line[0] = { v: vendors[k], s: "base" };
        line[1] = { s: "int", f: "COUNTIF(" + VEND + ",$A" + rw + ")" };
        line[2] = { s: "money", f: "SUMIF(" + VEND + ",$A" + rw + "," + MAR + ")" };
      }
      if (managers[k]) {
        line[3] = { v: managers[k], s: "base" };
        line[4] = { s: "int", f: "COUNTIF(" + MGR + ",$D" + rw + ")" };
        line[5] = { s: "money", f: "SUMIF(" + MGR + ",$D" + rw + "," + MAR + ")" };
      }
      if (cats[k]) {
        line[6] = { v: cats[k], s: "base" };
        line[7] = { s: "int", f: "COUNTIF(" + CAT + ",$G" + rw + ")" };
        line[8] = { s: "money", f: "SUMIF(" + CAT + ",$G" + rw + "," + MAR + ")" };
      }
      rows.push(line);
    }

    return {
      name: "대시보드",
      rows: rows,
      cols: [{ w: 24 }, { w: 15 }, { w: 20 }, { w: 15 }, { w: 20 }, { w: 15 }, { w: 22 }, { w: 12 }, { w: 15 }],
      freeze: { row: 1, col: 0 },
      rowHeights: { 1: 26 }
    };
  }

  /* ---------------------------------------------------------------
   * DAY / MON — 원본 워크북과 같은 자리, 다만 수식으로 자동 채움
   * --------------------------------------------------------------- */
  function dayMonSheets(year) {
    var R = "주문서!$" + C("saleDate") + "$4:$" + C("saleDate") + "$5000";
    var REV = "주문서!$" + C("revenue") + "$4:$" + C("revenue") + "$5000";
    var MAR = "주문서!$" + C("netMargin") + "$4:$" + C("netMargin") + "$5000";
    var PNT = "주문서!$" + C("pointOut") + "$4:$" + C("pointOut") + "$5000";

    var dayRows = [["연도", "월", "날짜", "요일", "주문건수", "매출액", "순마진", "포인트", "수익률"]
      .map(function (h) { return { v: h, s: "header" }; })];
    var start = new Date(Date.UTC(year, 0, 1)), end = new Date(Date.UTC(year, 11, 31));
    var r = 2;
    for (var d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      var serial = Xlsx.dateToSerial(new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
      dayRows.push([
        { v: d.getUTCFullYear(), s: "center" },
        { v: d.getUTCMonth() + 1, s: "center" },
        { v: serial, s: "date" },
        { s: "center", f: 'TEXT($C' + r + ',"aaa")' },
        { s: "int", f: "COUNTIFS(" + R + ",$C" + r + ")" },
        { s: "money", f: "SUMIFS(" + REV + "," + R + ",$C" + r + ")" },
        { s: "money", f: "SUMIFS(" + MAR + "," + R + ",$C" + r + ")" },
        { s: "money", f: "SUMIFS(" + PNT + "," + R + ",$C" + r + ")" },
        { s: "pct2", f: 'IF(F' + r + '=0,"",G' + r + "/F" + r + ")" }
      ]);
      r++;
    }

    var monRows = [["년", "월", "주문건수", "매출액", "순마진", "포인트", "수익률"]
      .map(function (h) { return { v: h, s: "header" }; })];
    for (var m = 1; m <= 12; m++) {
      var rr = m + 1;
      var from = "DATE(" + year + "," + m + ",1)", to = "EOMONTH(" + from + ",0)";
      monRows.push([
        { v: year, s: "center" }, { v: m, s: "center" },
        { s: "int", f: "COUNTIFS(" + R + ',">="&' + from + "," + R + ',"<="&' + to + ")" },
        { s: "money", f: "SUMIFS(" + REV + "," + R + ',">="&' + from + "," + R + ',"<="&' + to + ")" },
        { s: "money", f: "SUMIFS(" + MAR + "," + R + ',">="&' + from + "," + R + ',"<="&' + to + ")" },
        { s: "money", f: "SUMIFS(" + PNT + "," + R + ',">="&' + from + "," + R + ',"<="&' + to + ")" },
        { s: "pct2", f: 'IF(D' + rr + '=0,"",E' + rr + "/D" + rr + ")" }
      ]);
    }
    monRows.push([{ v: "합계", s: "header" }, "",
      { s: "int", f: "SUM(C2:C13)" }, { s: "money", f: "SUM(D2:D13)" },
      { s: "money", f: "SUM(E2:E13)" }, { s: "money", f: "SUM(F2:F13)" },
      { s: "pct2", f: 'IF(D14=0,"",E14/D14)' }]);

    return [
      { name: "DAY", rows: dayRows, freeze: { row: 1, col: 0 }, autoFilter: "A1:I1",
        cols: [{ w: 8 }, { w: 7 }, { w: 13 }, { w: 7 }, { w: 11 }, { w: 15 }, { w: 15 }, { w: 12 }, { w: 10 }] },
      { name: "MON", rows: monRows, freeze: { row: 1, col: 0 },
        cols: [{ w: 8 }, { w: 7 }, { w: 11 }, { w: 16 }, { w: 16 }, { w: 12 }, { w: 10 }] }
    ];
  }

  /* ---------------------------------------------------------------
   * 보조 시트들
   * --------------------------------------------------------------- */
  function blacklistSheet(list) {
    var rows = [["이름", "주소", "연락처", "사유", "등록일"].map(function (h) { return { v: h, s: "header" }; })];
    (list || []).forEach(function (b) {
      rows.push([
        { v: b.name || "", s: "base" }, { v: b.address || "", s: "wrap" },
        { v: b.phone || "", s: "base" }, { v: b.memo || "", s: "base" },
        { v: b.addedAt || "", s: "center" }
      ]);
    });
    while (rows.length < 60) rows.push(["", "", "", "", ""]);
    return {
      name: "블랙리스트", rows: rows, freeze: { row: 1, col: 0 }, autoFilter: "A1:E1",
      cols: [{ w: 16 }, { w: 60 }, { w: 16 }, { w: 24 }, { w: 12 }]
    };
  }

  function feeSheet(fees) {
    var rows = [["카테고리", "플랫폼", "수수료율", "수수료율(VAT)"].map(function (h) { return { v: h, s: "header" }; })];
    (fees && fees.length ? fees : Core.DEFAULT_FEES).forEach(function (f) {
      rows.push([
        { v: f.category || "", s: "base" }, { v: f.site || "", s: "base" },
        { v: f.rate, s: "pct2" }, { s: "pct2", f: "ROUND(C" + (rows.length + 1) + "*1.1,6)" }
      ]);
    });
    while (rows.length < 60) rows.push(["", "", "", ""]);
    return {
      name: "수수료", rows: rows, freeze: { row: 1, col: 0 }, autoFilter: "A1:D1",
      cols: [{ w: 34 }, { w: 18 }, { w: 12 }, { w: 14 }]
    };
  }

  function csSheet(list) {
    var head = ["일자", "주문번호", "고객명", "구매 플랫폼", "제품명", "연락처", "방식", "구분", "진행상태", "세부단계", "조치내용"];
    var rows = [head.map(function (h) { return { v: h, s: "header" }; })];
    (list || []).forEach(function (c) {
      rows.push([
        { v: c.date || "", s: "center" }, { v: c.orderNo || "", s: "base" }, { v: c.customer || "", s: "base" },
        { v: c.platform || "", s: "base" }, { v: c.product || "", s: "wrap" }, { v: c.phone || "", s: "base" },
        { v: c.channel || "", s: "base" }, { v: c.type || "", s: "base" }, { v: c.status || "", s: "center" },
        { v: c.stage || "", s: "center" }, { v: c.action || "", s: "wrap" }
      ]);
    });
    while (rows.length < 80) rows.push([]);
    var last = rows.length;
    return {
      name: "CS", rows: rows, freeze: { row: 1, col: 0 }, autoFilter: "A1:K1",
      cols: [{ w: 12 }, { w: 22 }, { w: 11 }, { w: 16 }, { w: 40 }, { w: 16 }, { w: 12 }, { w: 14 }, { w: 11 }, { w: 11 }, { w: 60 }],
      validations: [
        { sqref: "H2:H" + last, values: ["출고 전 취소", "출고 후 반품", "교환", "배송문의", "파손/오배송", "기타"] },
        { sqref: "I2:I" + last, values: ["접수", "진행중", "완료", "보류"] },
        { sqref: "J2:J" + last, values: ["확인중", "구매처 연락", "회수요청", "환불완료", "조치완료"] }
      ],
      condFormats: [{
        sqref: "A2:K" + last,
        rules: [{ formula: '$I2="완료"', dxf: 2, priority: 1 }, { formula: '$I2="진행중"', dxf: 1, priority: 2 }]
      }]
    };
  }

  function invoiceSheet(list) {
    var rows = [["주문고유번호", "배송사코드", "송장번호", "상태", "확인"].map(function (h) { return { v: h, s: "header" }; })];
    (list || []).forEach(function (v, i) {
      var r = i + 2;
      rows.push([
        { v: String(v.uniqueNo || ""), s: "base" },
        { v: String(v.courierCode || ""), s: "center" },
        { v: String(v.invoiceNo || ""), s: "base" },
        { v: v.status || "완료", s: "center" },
        { s: "center", f: "IF($A" + r + '="","",IF(COUNTIF(주문서!$' + C("uniqueNo") + "$4:$" + C("uniqueNo") + "$5000,$A" + r + ')>0,"주문서 확인됨","주문서에 없음"))' }
      ]);
    });
    for (var k = rows.length; k < 200; k++) {
      var rr = k + 1;
      rows.push(["", "", "", "",
        { s: "center", f: "IF($A" + rr + '="","",IF(COUNTIF(주문서!$' + C("uniqueNo") + "$4:$" + C("uniqueNo") + "$5000,$A" + rr + ')>0,"주문서 확인됨","주문서에 없음"))' }]);
    }
    return {
      name: "송장업로드", rows: rows, freeze: { row: 1, col: 0 },
      cols: [{ w: 20 }, { w: 12 }, { w: 20 }, { w: 10 }, { w: 18 }]
    };
  }

  function stockSheet(list) {
    var head = ["상품명", "담당자", "구매처", "계정", "구매금액", "주문번호", "결제일시", "카드정보", "포인트", "주문여부", "판매현황"];
    var rows = [head.map(function (h) { return { v: h, s: "header" }; })];
    (list || []).forEach(function (s) {
      rows.push([
        { v: s.productName || "", s: "wrap" }, { v: s.manager || "", s: "base" }, { v: s.vendor || "", s: "base" },
        { v: s.account || "", s: "base" }, { v: Core.toNumber(s.amount), s: "money" }, { v: s.orderNo || "", s: "base" },
        { v: s.paidAt || "", s: "center" }, { v: s.card || "", s: "base" }, { v: Core.toNumber(s.point), s: "money" },
        { v: s.orderedYn || "", s: "center" }, { v: s.saleStatus || "", s: "base" }
      ]);
    });
    while (rows.length < 60) rows.push([]);
    return {
      name: "사입", rows: rows, freeze: { row: 1, col: 0 }, autoFilter: "A1:K1",
      cols: [{ w: 42 }, { w: 10 }, { w: 12 }, { w: 16 }, { w: 13 }, { w: 20 }, { w: 16 }, { w: 10 }, { w: 10 }, { w: 10 }, { w: 20 }]
    };
  }

  function accountSheet(accounts, cards) {
    var rows = [];
    rows.push([{ v: "계정 · 카드 정보", s: "title" }, "", "", "",
      { v: "이 시트는 절대 공유하지 마세요. 파일에 암호를 걸어두는 것을 권장합니다.", s: "note" }]);
    rows.push([]);
    rows.push(["플랫폼", "계정주인", "아이디", "비밀번호", "멤버십", "상태", "이메일/쿠폰"]
      .map(function (h) { return { v: h, s: "header" }; }));
    (accounts || []).forEach(function (a) {
      rows.push([
        { v: a.platform || "", s: "base" }, { v: a.owner || "", s: "base" }, { v: a.id || "", s: "base" },
        { v: a.pw || "", s: "base" }, { v: a.membership || "", s: "base" }, { v: a.status || "", s: "center" },
        { v: a.memo || "", s: "base" }
      ]);
    });
    while (rows.length < 40) rows.push([]);
    rows.push([]);
    rows.push([{ v: "카드", s: "subhead" }]);
    rows.push(["카드명", "카드번호", "유효기간", "CVC", "카드비밀번호", "생년월일", "메모"]
      .map(function (h) { return { v: h, s: "header" }; }));
    (cards || []).forEach(function (c) {
      rows.push([
        { v: c.name || "", s: "base" }, { v: c.number || "", s: "base" }, { v: c.expire || "", s: "center" },
        { v: c.cvc || "", s: "center" }, { v: c.pin || "", s: "center" }, { v: c.birth || "", s: "center" },
        { v: c.memo || "", s: "base" }
      ]);
    });
    while (rows.length < 70) rows.push([]);
    return {
      name: "계정카드정보", rows: rows,
      cols: [{ w: 16 }, { w: 14 }, { w: 20 }, { w: 18 }, { w: 12 }, { w: 10 }, { w: 30 }]
    };
  }

  function listsSheet(data) {
    var managers = uniq((data.orders || []).map(function (o) { return o.manager; }).concat(["명진", "본인"]));
    var vendors = uniq((data.orders || []).map(function (o) { return o.vendor; })
      .concat(["11번가", "지마켓", "옥션", "롯데온", "롯데홈쇼핑", "쿠팡", "네이버", "티몬", "위메프", "하프클럽", "신라쇼"]));
    var cards = uniq((data.orders || []).map(function (o) { return o.cardName; }).concat(["롯데", "삼성", "하나", "현대", "신한", "국민", "우리", "비씨"]));
    var couriers = Core.COURIERS.map(function (c) { return c.code + " " + c.short; });
    var cats = uniq((data.fees && data.fees.length ? data.fees : Core.DEFAULT_FEES).map(function (f) { return f.category; }));

    var maxLen = Math.max(managers.length, vendors.length, cards.length, couriers.length, cats.length);
    var rows = [["담당자", "구매처", "카드", "택배사", "카테고리"].map(function (h) { return { v: h, s: "header" }; })];
    for (var i = 0; i < maxLen; i++) {
      rows.push([
        managers[i] || "", vendors[i] || "", cards[i] || "",
        couriers[i] ? Core.COURIERS[i].code : "", cats[i] || ""
      ]);
    }
    return {
      name: "목록", rows: rows, cols: [{ w: 14 }, { w: 16 }, { w: 12 }, { w: 12 }, { w: 34 }],
      counts: { managers: managers.length, vendors: vendors.length, cards: cards.length, couriers: Core.COURIERS.length, cats: cats.length }
    };
  }

  function guideSheet() {
    var lines = [
      ["1", "주문서 시트에 발주 데이터를 붙여넣습니다", "쿠팡/판매사이트에서 받은 주문을 3행 아래(4행부터)에 붙여넣으세요. 열 순서는 기존 양식과 같습니다."],
      ["2", "파란 칸만 입력하면 됩니다", "담당자 · 구매처 · 계정 · 구매링크 · 구매가 · 구매금액 · 주문번호 · 결제일시 · 카드 · 포인트 · 주문여부. 나머지는 자동입니다."],
      ["3", "카테고리를 고르면 수수료가 자동", "카테고리 드롭다운에서 고르면 수수료율·결제기준가·순마진·마진률·부가세가 전부 자동 계산됩니다."],
      ["4", "블랙리스트 자동 경고", "수령자명이 블랙리스트와 같으면 행 전체가 빨간색 '위험', 주소만 겹치면 '주소확인'으로 표시됩니다. 발송 전에 반드시 확인하세요."],
      ["5", "송장 업로드 대조", "EMP에서 받은 출고 목록을 송장업로드 시트 A열에 붙여넣으면 주문서의 운송장업로드 열이 자동으로 '완료'로 바뀝니다."],
      ["6", "대시보드 확인", "대시보드 시트에서 오늘/이번달/월별/최근 30일 매출·순마진·마진률·건수를 바로 볼 수 있습니다. 직접 고치지 마세요."],
      ["7", "CS는 CS 시트에서", "출고 전 취소·반품 등은 CS 시트에 기록합니다. 진행상태가 '완료'면 초록색, '진행중'이면 노란색으로 표시됩니다."],
      ["8", "계정카드정보는 공유 금지", "민감정보입니다. 파일 공유 시 이 시트를 지우거나 파일에 암호를 거세요."]
    ];
    var rows = [
      [{ v: "사용법", s: "title" }],
      [{ v: "이 파일은 기존 수기 양식(2026-09 기준)의 열 이름·순서를 그대로 유지하면서 계산과 확인만 자동화한 버전입니다.", s: "note" }],
      [],
      [{ v: "순서", s: "header" }, { v: "할 일", s: "header" }, { v: "설명", s: "header" }]
    ];
    lines.forEach(function (l) {
      rows.push([{ v: l[0], s: "center" }, { v: l[1], s: "base" }, { v: l[2], s: "wrap" }]);
    });
    rows.push([]);
    rows.push([{ v: "색 규칙", s: "subhead" }]);
    rows.push([{ v: "", s: "input" }, { v: "직접 입력하는 칸", s: "base" }]);
    rows.push([{ v: "", s: "danger" }, { v: "블랙리스트 위험 — 발송 전 확인", s: "base" }]);
    rows.push([{ v: "", s: "ok" }, { v: "업로드까지 끝난 주문", s: "base" }]);
    return {
      name: "사용법", rows: rows, cols: [{ w: 8 }, { w: 34 }, { w: 90 }],
      rowHeights: { 1: 26 }
    };
  }

  function uniq(arr) {
    var seen = {}, out = [];
    (arr || []).forEach(function (v) {
      var s = String(v == null ? "" : v).trim();
      if (!s || seen[s]) return;
      seen[s] = 1; out.push(s);
    });
    return out;
  }

  /* ---------------------------------------------------------------
   * 워크북 조립
   * --------------------------------------------------------------- */
  function buildWorkbook(data) {
    data = data || {};
    var year = data.year || new Date().getFullYear();
    var lists = listsSheet(data);
    var dm = dayMonSheets(year);

    var sheets = [
      guideSheet(),
      dashboardSheet(year),
      orderSheet(data),
      csSheet(data.cs),
      blacklistSheet(data.blacklist),
      invoiceSheet(data.invoiceList),
      stockSheet(data.stock),
      feeSheet(data.fees),
      dm[0], dm[1],
      accountSheet(data.accounts, data.cards),
      lists
    ];

    var n = lists.counts;
    var definedNames = {
      "담당자목록": "목록!$A$2:$A$" + (n.managers + 1),
      "구매처목록": "목록!$B$2:$B$" + (n.vendors + 1),
      "카드목록": "목록!$C$2:$C$" + (n.cards + 1),
      "택배사목록": "목록!$D$2:$D$" + (n.couriers + 1),
      "카테고리목록": "목록!$E$2:$E$" + (n.cats + 1)
    };
    return { sheets: sheets, definedNames: definedNames };
  }

  function buildBytes(data) {
    var wb = buildWorkbook(data);
    return Xlsx.buildBytes(wb.sheets, wb.definedNames);
  }
  function buildBlob(data) {
    var wb = buildWorkbook(data);
    return Xlsx.write(wb.sheets, wb.definedNames);
  }

  var api = { buildWorkbook: buildWorkbook, buildBytes: buildBytes, buildBlob: buildBlob };
  global.OrderTemplate = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
