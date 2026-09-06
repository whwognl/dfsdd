/* =====================================================================
 * import.js — 워크북/붙여넣기 → 표준 모델 변환
 *
 * 2026-09 최신 워크북(설명·블랙리스트·DAY·MON·2.주문서·3.계정카드정보·
 * 수수료·CS·4.송장업로드리스트·사입)을 통째로 읽어 앱 상태로 바꿉니다.
 * 쿠팡 발주서처럼 열 이름이 다른 파일은 별칭 매핑으로 흡수합니다.
 * ===================================================================== */
(function (global) {
  "use strict";

  var Core = global.OrderCore || (typeof require !== "undefined" ? require("./core.js") : null);
  var COLS = Core.ORDER_COLUMNS;

  function norm(s) { return String(s == null ? "" : s).replace(/\s+/g, "").toLowerCase(); }
  function cell(row, i) {
    if (!row || i == null || i < 0) return "";
    var v = row[i];
    return v === undefined || v === null ? "" : v;
  }
  function str(v) { return String(v === undefined || v === null ? "" : v).trim(); }
  function nonEmpty(row) { return (row || []).some(function (c) { return str(c) !== ""; }); }

  /* ---------- 헤더 행 찾기 ---------- */
  function findHeaderRow(rows, labels, limit) {
    var want = labels.map(norm);
    var best = -1, bestScore = 1;
    for (var r = 0; r < Math.min(rows.length, limit || 12); r++) {
      var score = 0, seen = {};
      (rows[r] || []).forEach(function (c) {
        var n = norm(c);
        if (!n || seen[n]) return;
        if (want.indexOf(n) !== -1) { score++; seen[n] = 1; }
      });
      if (score > bestScore) { bestScore = score; best = r; }
    }
    return best;
  }

  /* ---------- 주문서 열 매핑 ---------- */
  function mapOrderColumns(header) {
    var map = {}, used = {};
    // 1) 위치 그대로 맞는지 확인 (최신 워크북 = 53열 순서 동일)
    var hits = 0;
    for (var i = 0; i < COLS.length && i < header.length; i++) {
      if (norm(header[i]) === norm(COLS[i].label)) hits++;
    }
    if (hits >= 18) {
      COLS.forEach(function (c, idx) { if (idx < header.length) map[c.key] = idx; });
      map.__positional = true;
      return map;
    }
    // 2) 이름(별칭) 매핑 — 먼저 나온 열이 우선
    var aliases = Core.COLUMN_ALIASES;
    Object.keys(aliases).forEach(function (key) {
      var list = aliases[key];
      for (var a = 0; a < list.length; a++) {
        var target = norm(list[a]);
        for (var h = 0; h < header.length; h++) {
          if (used[h]) continue;
          if (norm(header[h]) === target) { map[key] = h; used[h] = 1; return; }
        }
      }
    });
    return map;
  }

  var newIdSeq = 0;
  function newId() {
    newIdSeq++;
    return "o" + Date.now().toString(36) + "_" + newIdSeq.toString(36);
  }

  function buildOrder(row, map) {
    var o = { id: newId(), raw: {} };
    COLS.forEach(function (c) {
      var idx = map[c.key];
      if (idx === undefined) return;
      var v = cell(row, idx);
      if (c.type === "money" || c.type === "int") o[c.key] = v === "" ? "" : Core.toNumber(v);
      else o[c.key] = str(v);
    });
    o.courierCode = o.courierCode ? Core.normalizeCourier(o.courierCode) : "";
    o.orderedYn = String(o.orderedYn || "").toUpperCase() === "O" ? "O"
      : (String(o.orderedYn || "").toUpperCase() === "X" ? "X" : "");
    o.qty = Math.max(1, Math.round(Core.toNumber(o.qty) || 1));
    o.memoLog = [];
    return o;
  }

  /* ---------- 2.주문서 ---------- */
  function readOrders(rows) {
    if (!rows || !rows.length) return [];
    var labels = COLS.map(function (c) { return c.label; });
    var hr = findHeaderRow(rows, labels, 12);
    if (hr < 0) hr = 0;
    var map = mapOrderColumns(rows[hr] || []);
    if (map.productName === undefined && map.siteOrderNo === undefined) return [];
    var out = [];
    for (var r = hr + 1; r < rows.length; r++) {
      var row = rows[r];
      if (!nonEmpty(row)) continue;
      var name = str(cell(row, map.productName));
      var no = str(cell(row, map.siteOrderNo));
      if (!name && !no) continue;
      out.push(buildOrder(row, map));
    }
    return out;
  }

  /* ---------- 블랙리스트 ---------- */
  function readBlacklist(rows) {
    if (!rows || !rows.length) return [];
    var start = 0;
    var h = findHeaderRow(rows, ["이름", "주소", "연락처", "사유"], 3);
    if (h >= 0) start = h + 1;
    var seen = {}, out = [];
    for (var r = start; r < rows.length; r++) {
      var row = rows[r] || [];
      var name = str(cell(row, 0));
      var addr = str(cell(row, 1));
      var phone = str(cell(row, 2));
      if (!name && !addr) continue;
      var key = norm(name) + "|" + norm(addr);
      if (seen[key]) continue;
      seen[key] = 1;
      out.push({ name: name, address: addr, phone: phone, memo: str(cell(row, 3)), addedAt: str(cell(row, 4)) });
    }
    return out;
  }

  /* ---------- 수수료 ---------- */
  function readFees(rows) {
    if (!rows || !rows.length) return [];
    var rateCol = -1, headRow = -1;
    for (var r = 0; r < Math.min(rows.length, 12) && rateCol < 0; r++) {
      var row = rows[r] || [];
      for (var c = 0; c < row.length; c++) {
        if (norm(row[c]) === "수수료율" && norm(cell(row, c + 1)).indexOf("vat") !== -1) {
          rateCol = c; headRow = r; break;
        }
      }
    }
    if (rateCol < 0) return [];
    var catCol = rateCol - 1, siteCol = rateCol - 2;
    if (norm(cell(rows[headRow], catCol)) !== "카테고리") return [];
    var out = [], seen = {};
    for (var i = headRow + 1; i < rows.length; i++) {
      var row2 = rows[i] || [];
      var cat = str(cell(row2, catCol));
      var rate = Core.toNumber(cell(row2, rateCol));
      if (!cat || !rate) continue;
      var key = norm(cat);
      if (seen[key]) continue;
      seen[key] = 1;
      out.push({
        site: siteCol >= 0 ? str(cell(row2, siteCol)) : "",
        category: cat,
        rate: rate,
        rateVat: Math.round(rate * 1.1 * 1e6) / 1e6
      });
    }
    return out;
  }

  /* ---------- CS ---------- */
  function readCs(rows) {
    if (!rows || !rows.length) return [];
    var h = findHeaderRow(rows, ["일자", "주문번호", "고객명", "구매 플랫폼", "제품명", "연락처", "방식", "구분", "진행상태"], 6);
    if (h < 0) return [];
    var head = rows[h] || [];
    function col(names) {
      for (var n = 0; n < names.length; n++) {
        for (var i = 0; i < head.length; i++) if (norm(head[i]) === norm(names[n])) return i;
      }
      return -1;
    }
    var ci = {
      date: col(["일자", "날짜"]), orderNo: col(["주문번호", "주문번호(링크)"]), customer: col(["고객명"]),
      platform: col(["구매 플랫폼", "구매플랫폼", "플랫폼"]), product: col(["제품명", "상품명"]),
      phone: col(["연락처", "전화번호"]), channel: col(["방식"]), type: col(["구분"]),
      status: col(["진행상태"]), stage: col(["세부단계"]), action: col(["조치내용"])
    };
    var out = [];
    for (var r = h + 1; r < rows.length; r++) {
      var row = rows[r] || [];
      if (!nonEmpty(row.slice(0, 12))) continue;
      var item = { id: newId() };
      Object.keys(ci).forEach(function (k) { item[k] = str(cell(row, ci[k])); });
      if (!item.customer && !item.orderNo && !item.product) continue;
      item.date = Core.dateOnly(cell(row, ci.date)) || item.date;
      out.push(item);
    }
    return out;
  }

  /* ---------- 4.송장업로드리스트 ---------- */
  function readInvoiceList(rows) {
    if (!rows || !rows.length) return [];
    var h = findHeaderRow(rows, ["주문고유번호", "상태", "송장번호", "배송사코드"], 6);
    var head = h >= 0 ? rows[h] : [];
    var noCol = 0, stCol = -1, courCol = -1, invCol = -1;
    for (var i = 0; i < head.length; i++) {
      var n = norm(head[i]);
      if (n === "주문고유번호") noCol = i;
      else if (n === "상태") stCol = i;
      else if (n.indexOf("배송사") !== -1) courCol = i;
      else if (n.indexOf("송장") !== -1) invCol = i;
    }
    var out = [], start = h >= 0 ? h + 1 : 0;
    for (var r = start; r < rows.length; r++) {
      var row = rows[r] || [];
      var no = str(cell(row, noCol));
      if (!no) continue;
      out.push({
        uniqueNo: no.replace(/\.0+$/, ""),
        status: stCol >= 0 ? str(cell(row, stCol)) : "완료",
        courierCode: courCol >= 0 ? Core.normalizeCourier(cell(row, courCol)) : "",
        invoiceNo: invCol >= 0 ? str(cell(row, invCol)) : ""
      });
    }
    return out;
  }

  /* ---------- 사입 ---------- */
  function readStock(rows) {
    if (!rows || !rows.length) return [];
    var h = findHeaderRow(rows, ["상품명", "담당자", "구매처", "계정", "구매금액", "주문번호"], 6);
    if (h < 0) return [];
    var head = rows[h];
    function col(name) {
      for (var i = 0; i < head.length; i++) if (norm(head[i]) === norm(name)) return i;
      return -1;
    }
    var ci = {
      productName: col("상품명"), manager: col("담당자"), vendor: col("구매처"), account: col("계정"),
      amount: col("구매금액"), orderNo: col("주문번호"), paidAt: col("결제일시"), card: col("카드정보"),
      point: col("포인트"), orderedYn: col("주문여부"), saleStatus: col("판매현황")
    };
    var out = [];
    for (var r = h + 1; r < rows.length; r++) {
      var row = rows[r] || [];
      var pn = str(cell(row, ci.productName));
      if (!pn) continue;
      out.push({
        id: newId(),
        productName: pn, manager: str(cell(row, ci.manager)), vendor: str(cell(row, ci.vendor)),
        account: str(cell(row, ci.account)), amount: Core.toNumber(cell(row, ci.amount)),
        orderNo: str(cell(row, ci.orderNo)), paidAt: str(cell(row, ci.paidAt)),
        card: str(cell(row, ci.card)), point: Core.toNumber(cell(row, ci.point)),
        orderedYn: str(cell(row, ci.orderedYn)), saleStatus: str(cell(row, ci.saleStatus))
      });
    }
    return out;
  }

  /* ---------- 3.계정카드정보 ---------- */
  function readAccounts(rows) {
    var accounts = [], cards = [];
    if (!rows || !rows.length) return { accounts: accounts, cards: cards };
    var h = findHeaderRow(rows, ["플랫폼", "계정주인", "아이디", "비밀번호", "멤버십", "상태"], 8);
    if (h >= 0) {
      var head = rows[h];
      var base = -1;
      for (var i = 0; i < head.length; i++) if (norm(head[i]) === "아이디") { base = i; break; }
      if (base >= 0) {
        var pf = base - 2, ow = base - 1;
        var lastPlatform = "";
        for (var r = h + 1; r < rows.length; r++) {
          var row = rows[r] || [];
          var id = str(cell(row, base));
          var platform = pf >= 0 ? str(cell(row, pf)) : "";
          if (platform && !id) { lastPlatform = platform; continue; }
          if (!id) continue;
          if (platform) lastPlatform = platform;
          accounts.push({
            id2: newId(),
            platform: lastPlatform,
            owner: ow >= 0 ? str(cell(row, ow)) : "",
            id: id,
            pw: str(cell(row, base + 1)),
            membership: str(cell(row, base + 2)),
            status: str(cell(row, base + 3)),
            memo: str(cell(row, base + 4))
          });
        }
      }
    }
    // 카드 블록
    var ch = -1, cbase = -1;
    for (var rr = 0; rr < Math.min(rows.length, 12); rr++) {
      var row2 = rows[rr] || [];
      for (var c = 0; c < row2.length; c++) {
        if (norm(row2[c]) === "카드명" || norm(row2[c]) === "카드번호") { ch = rr; cbase = norm(row2[c]) === "카드명" ? c : c - 1; break; }
      }
      if (ch >= 0) break;
    }
    if (ch >= 0 && cbase >= 0) {
      for (var r2 = ch + 1; r2 < rows.length; r2++) {
        var row3 = rows[r2] || [];
        var nm = str(cell(row3, cbase)), num = str(cell(row3, cbase + 1));
        if (!nm && !num) continue;
        cards.push({
          id2: newId(), name: nm, number: num,
          expire: str(cell(row3, cbase + 2)), cvc: str(cell(row3, cbase + 3)),
          pin: str(cell(row3, cbase + 4)), birth: str(cell(row3, cbase + 5)),
          memo: str(cell(row3, cbase + 6))
        });
      }
    }
    return { accounts: accounts, cards: cards };
  }

  /* ---------- DAY / MON (과거 실적 보존용) ---------- */
  function readHistory(dayRows, monRows) {
    var daily = {}, monthly = {};
    if (dayRows && dayRows.length) {
      for (var r = 1; r < dayRows.length; r++) {
        var row = dayRows[r] || [];
        var d = Core.dateOnly(row[2]);
        if (!d) continue;
        var cnt = Core.toNumber(row[4]), rev = Core.toNumber(row[5]), mar = Core.toNumber(row[6]), pt = Core.toNumber(row[7]);
        if (!cnt && !rev && !mar) continue;
        daily[d] = { count: cnt, revenue: rev, margin: mar, point: pt };
      }
    }
    if (monRows && monRows.length) {
      for (var m = 1; m < monRows.length; m++) {
        var row2 = monRows[m] || [];
        var y = Math.round(Core.toNumber(row2[0])), mm = Math.round(Core.toNumber(row2[1]));
        if (!y || !mm) continue;
        var cnt2 = Core.toNumber(row2[2]), rev2 = Core.toNumber(row2[3]), mar2 = Core.toNumber(row2[4]), pt2 = Core.toNumber(row2[5]);
        if (!cnt2 && !rev2 && !mar2) continue;
        monthly[y + "-" + ("0" + mm).slice(-2)] = { count: cnt2, revenue: rev2, margin: mar2, point: pt2 };
      }
    }
    return { daily: daily, monthly: monthly };
  }

  /* ---------------------------------------------------------------
   * 워크북 한 방에 읽기
   * --------------------------------------------------------------- */
  function fromWorkbook(wb) {
    var out = {
      orders: [], blacklist: [], fees: [], cs: [], stock: [],
      accounts: [], cards: [], invoiceList: [], history: { daily: {}, monthly: {} },
      found: []
    };
    function take(names, fn, label) {
      var rows = wb.pick(names);
      if (!rows || !rows.length) return null;
      var res = fn(rows);
      if (res && (res.length || Object.keys(res).length)) out.found.push(label);
      return res;
    }

    out.orders = take(["2.주문서", "주문서", "주문관리"], readOrders, "주문서") || [];
    out.blacklist = take(["블랙리스트", "blacklist"], readBlacklist, "블랙리스트") || [];
    out.fees = take(["수수료", "수수료표"], readFees, "수수료") || [];
    out.cs = take(["CS", "CS관리"], readCs, "CS") || [];
    out.invoiceList = take(["4.송장업로드리스트", "송장업로드리스트", "송장업로드", "운송장업로드"], readInvoiceList, "송장업로드") || [];
    out.stock = take(["사입"], readStock, "사입") || [];

    var accRows = wb.pick(["3.계정카드정보", "계정카드정보", "계정관리"]);
    if (accRows) {
      var acc = readAccounts(accRows);
      out.accounts = acc.accounts; out.cards = acc.cards;
      if (acc.accounts.length || acc.cards.length) out.found.push("계정·카드");
    }
    var dayRows = wb.pick(["DAY", "일별매출"]);
    var monRows = wb.pick(["MON", "월별매출"]);
    if (dayRows || monRows) {
      out.history = readHistory(dayRows, monRows);
      if (Object.keys(out.history.daily).length || Object.keys(out.history.monthly).length) out.found.push("DAY/MON");
    }
    return out;
  }

  /* ---------------------------------------------------------------
   * 붙여넣기(TSV/CSV) → 주문
   * --------------------------------------------------------------- */
  function dsvToMatrix(text, delim) {
    var rows = [], row = [], cur = "", i = 0, inQ = false;
    while (i < text.length) {
      var ch = text[i];
      if (inQ) {
        if (ch === '"') {
          if (text[i + 1] === '"') { cur += '"'; i += 2; continue; }
          inQ = false; i++; continue;
        }
        cur += ch; i++; continue;
      }
      if (ch === '"' && cur === "") { inQ = true; i++; continue; }
      if (ch === delim) { row.push(cur); cur = ""; i++; continue; }
      if (ch === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; i++; continue; }
      cur += ch; i++;
    }
    if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
    return rows;
  }
  function fromPaste(text) {
    text = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n+$/, "");
    if (!text.trim()) return [];
    var delim = text.indexOf("\t") !== -1 ? "\t" : ",";
    var matrix = dsvToMatrix(text, delim).filter(nonEmpty);
    return readOrders(matrix);
  }

  var api = {
    fromWorkbook: fromWorkbook,
    fromPaste: fromPaste,
    readOrders: readOrders,
    readBlacklist: readBlacklist,
    readFees: readFees,
    readCs: readCs,
    readStock: readStock,
    readAccounts: readAccounts,
    readInvoiceList: readInvoiceList,
    readHistory: readHistory,
    dsvToMatrix: dsvToMatrix,
    mapOrderColumns: mapOrderColumns,
    findHeaderRow: findHeaderRow
  };
  global.OrderImport = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
