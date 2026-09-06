/* =====================================================================
 * views.js — 탭별 화면 (주문관리 시트 · CS · 블랙리스트 · 송장 · 사입 · 수수료 · 계정)
 *
 * 주문관리 시트는 "딸깍"으로 끝내는 것이 목표입니다.
 *   [준비]  배송지·수령자 정보를 내 번호로 바꿔 복사하고 구매링크를 엽니다
 *   [발주]  주문여부 O · 결제일시 · 담당자/구매처/계정/카드를 한 번에 기록합니다
 *   선택 후 [일괄 입력] 으로 여러 건을 한 번에 채웁니다
 * ===================================================================== */
(function (global) {
  "use strict";

  var App = global.App;
  var Core = global.OrderCore;
  var Importer = global.OrderImport;
  var esc = App.esc, comma = App.comma, won = App.won, pct = App.pct, toNum = App.toNum, toast = App.toast;
  var $ = App.$, $$ = App.$$;

  App.views = App.views || {};
  App.afterRender = App.afterRender || {};

  /* =====================================================================
   * 시트 열 구성
   * ===================================================================== */
  var SPECIAL = [
    { key: "_sel", label: "", w: 34, type: "sel" },
    { key: "_risk", label: "위험", w: 56, type: "risk" },
    { key: "_go", label: "처리", w: 96, type: "go" },
    { key: "_step", label: "상태", w: 84, type: "step" }
  ];
  var WORK_ORDER = ["_sel", "_risk", "_go", "_step",
    "manager", "vendor", "vendorAccount", "buyLink", "buyUnitPrice", "buyAmount",
    "netMargin", "marginRate", "orderedYn", "cardName", "point", "buyOrderNo", "paidAt",
    "orderedAt", "siteOrderNo", "productName", "optionText", "qty", "salePrice", "category",
    "recipient", "recvPhone", "zipcode", "address", "deliveryMemo",
    "uniqueNo", "courierCode", "invoiceNo", "invoiceUploaded", "memo"];
  var COPY_KEYS = { recipient: "수령자명", address: "주소", recvPhone: "연락처", zipcode: "우편번호", uniqueNo: "주문고유번호" };

  function allCols() {
    return SPECIAL.concat(Core.ORDER_COLUMNS.map(function (c) {
      return { key: c.key, label: c.label, w: Math.max(64, Math.round(c.w * 7.6)), type: c.type, kind: c.kind };
    }));
  }
  function colByKey(key) {
    var list = allCols();
    for (var i = 0; i < list.length; i++) if (list[i].key === key) return list[i];
    return null;
  }
  function presetOrder() {
    if (App.state.ui.preset === "raw") {
      return ["_sel", "_risk", "_go", "_step"].concat(Core.ORDER_COLUMNS.map(function (c) { return c.key; }));
    }
    return WORK_ORDER.slice();
  }
  function visibleCols() {
    var ui = App.state.ui;
    var order = (ui.colOrder && ui.colOrder.length && ui.presetOf === ui.preset) ? ui.colOrder : presetOrder();
    var seen = {}, out = [];
    order.forEach(function (k) {
      if (seen[k]) return;
      seen[k] = 1;
      if (ui.hidden[k]) return;
      var c = colByKey(k);
      if (c) out.push(c);
    });
    return out;
  }
  function colWidth(c) {
    var w = App.state.ui.colWidths[c.key];
    return w || c.w || 120;
  }

  /* =====================================================================
   * 필터 / 정렬
   * ===================================================================== */
  var FILTERS = [
    { key: "all", label: "전체" },
    { key: "new", label: "발주 대기" },
    { key: "ordered", label: "송장 대기" },
    { key: "invoiced", label: "업로드 대기" },
    { key: "uploaded", label: "완료" },
    { key: "risk", label: "위험" },
    { key: "loss", label: "역마진" },
    { key: "nomargin", label: "계산 대기" }
  ];

  function filtered() {
    var ui = App.state.ui;
    var q = (ui.q || "").trim().toLowerCase();
    return App.state.orders.filter(function (o) {
      switch (ui.filter) {
        case "new": if (o._step !== "new") return false; break;
        case "ordered": if (o._step !== "ordered") return false; break;
        case "invoiced": if (o._step !== "invoiced") return false; break;
        case "uploaded": if (o._step !== "uploaded") return false; break;
        case "risk": if (!(o._risk && o._risk.level)) return false; break;
        case "loss": if (!(o.netMargin != null && o.netMargin < 0)) return false; break;
        case "nomargin": if (o.netMargin != null) return false; break;
      }
      if (!q) return true;
      return [o.productName, o.recipient, o.siteOrderNo, o.buyOrderNo, o.uniqueNo, o.address,
        o.optionText, o.vendor, o.manager, o.invoiceNo, o.memo]
        .some(function (v) { return String(v || "").toLowerCase().indexOf(q) !== -1; });
    });
  }

  function displayRows() {
    var list = filtered();
    var group = App.state.ui.group;
    if (group === "none") return list.map(function (o) { return { type: "order", order: o }; });
    var map = {};
    list.forEach(function (o) {
      var k;
      if (group === "date") k = App.dateKey(o) || "(날짜없음)";
      else k = String(o[group] == null ? "" : o[group]).trim() || "(미지정)";
      if (!map[k]) map[k] = [];
      map[k].push(o);
    });
    var out = [];
    Object.keys(map).sort().forEach(function (k) {
      var st = App.statsFor(map[k]);
      out.push({ type: "group", key: k, stats: st });
      map[k].forEach(function (o) { out.push({ type: "order", order: o }); });
    });
    return out;
  }

  /* =====================================================================
   * 주문관리 화면
   * ===================================================================== */
  App.views.orders = function () {
    var s = App.state, ui = s.ui;
    if (!s.orders.length) {
      return '<div class="empty"><h3>주문이 없습니다</h3>' +
        "<p>워크북(.xlsx)을 올리거나 발주서를 붙여넣으면 시트가 채워집니다.</p>" +
        '<button class="btn primary" id="empty-import">파일 불러오기</button> ' +
        '<button class="btn" data-act="paste-orders">붙여넣기</button></div>';
    }

    var list = filtered();
    var st = App.statsFor(list);
    var riskN = list.filter(function (o) { return o._risk && o._risk.level; }).length;
    var newN = list.filter(function (o) { return o._step === "new"; }).length;
    var selN = Object.keys(ui.sel).filter(function (k) { return ui.sel[k]; }).length;

    var html = "";
    if (riskN) {
      html += '<div class="banner risk"><span class="tag">주문 처리 위험</span>' +
        "<b>" + riskN + "건</b>이 블랙리스트와 일치합니다. 행이 빨간색으로 표시됩니다." +
        '<div class="spacer"></div><button class="btn danger sm" data-act="show-risk">목록 보기</button></div>';
    }

    html += '<div class="kpi-grid">' +
      App.kpi("표시 중", comma(list.length) + "건", "", "전체 " + comma(s.orders.length) + "건") +
      App.kpi("매출", won(st.revenue), "") +
      App.kpi("순마진", won(st.margin), st.margin >= 0 ? "pos" : "neg", "마진률 " + pct(st.rate)) +
      App.kpi("발주 대기", comma(newN) + "건", newN ? "brand" : "") +
      App.kpi("위험", comma(riskN) + "건", riskN ? "neg" : "") +
      App.kpi("선택", comma(selN) + "건", selN ? "brand" : "", selN ? "아래 일괄 작업 사용" : "행 앞 체크박스") +
      "</div>";

    // 툴바
    html += '<div class="toolbar">' +
      '<input type="search" id="q" placeholder="상품명 · 수령자 · 주문번호 · 주소 검색" value="' + esc(ui.q) + '">' +
      '<div class="grp"><label>상태</label><select id="f-filter">' +
      FILTERS.map(function (f) {
        return '<option value="' + f.key + '"' + (ui.filter === f.key ? " selected" : "") + ">" + esc(f.label) + "</option>";
      }).join("") + "</select></div>" +
      '<div class="grp"><label>묶어보기</label><select id="f-group">' +
      [["none", "없음"], ["productName", "상품"], ["vendor", "구매처"], ["manager", "담당자"], ["date", "날짜"], ["category", "카테고리"]]
        .map(function (g) {
          return '<option value="' + g[0] + '"' + (ui.group === g[0] ? " selected" : "") + ">" + esc(g[1]) + "</option>";
        }).join("") + "</select></div>" +
      '<div class="seg" id="preset-seg">' +
      '<button data-preset="work"' + (ui.preset === "work" ? ' class="on"' : "") + ">작업 순서</button>" +
      '<button data-preset="raw"' + (ui.preset === "raw" ? ' class="on"' : "") + ">원본 순서</button></div>" +
      '<div class="spacer"></div>' +
      '<button class="btn sm" data-act="col-pick">열 선택</button>' +
      '<button class="btn sm" data-act="paste-orders">붙여넣기</button>' +
      '<button class="btn sm" data-act="add-row">행 추가</button>' +
      '<button class="btn sm" data-act="undo-del"' + (s.trash.length ? "" : " disabled") + ">삭제 복구" +
      (s.trash.length ? " (" + s.trash.length + ")" : "") + "</button>" +
      '<button class="btn sm" data-act="reset-layout">열 초기화</button>' +
      "</div>";

    // 선택 시 일괄 작업
    if (selN) {
      html += '<div class="banner info"><b>' + selN + "건 선택됨</b>" +
        '<div class="spacer"></div>' +
        '<button class="btn sm" data-act="bulk-fill">일괄 입력</button> ' +
        '<button class="btn sm" data-act="bulk-order">발주완료 표시</button> ' +
        '<button class="btn sm" data-act="bulk-cs">CS로 보내기</button> ' +
        '<button class="btn sm" data-act="bulk-blacklist">블랙리스트 등록</button> ' +
        '<button class="btn sm danger" data-act="bulk-del">삭제</button> ' +
        '<button class="btn sm ghost" data-act="sel-none">선택 해제</button></div>';
    }

    html += sheetHtml();
    return html;
  };

  function sheetHtml() {
    var cols = visibleCols();
    var rows = displayRows();
    var limit = App.state.ui.limit;
    var orderRows = rows.filter(function (r) { return r.type === "order"; });
    var truncated = orderRows.length > limit;
    var shown = 0;

    var head = '<colgroup><col style="width:44px">' +
      cols.map(function (c) { return '<col data-ck="' + esc(c.key) + '" style="width:' + colWidth(c) + 'px">'; }).join("") +
      '<col style="width:38px"></colgroup>';
    head += '<thead><tr><th class="rownum">#</th>' +
      cols.map(function (c) {
        var isCalc = c.kind === "calc";
        return '<th class="resizable" data-k="' + esc(c.key) + '" draggable="true">' +
          (c.key === "_sel" ? '<input type="checkbox" data-act="sel-all">' : esc(c.label)) +
          (isCalc ? ' <span class="auto">자동</span>' : "") +
          '<span class="col-resizer" data-col-resize="' + esc(c.key) + '"></span></th>';
      }).join("") + '<th class="del"></th></tr></thead>';

    var body = "<tbody>";
    if (!rows.length) {
      body += '<tr><td class="empty" colspan="' + (cols.length + 2) + '">조건에 맞는 행이 없습니다. 검색어나 상태 필터를 확인하세요.</td></tr>';
    } else {
      rows.forEach(function (r) {
        if (r.type === "group") {
          body += '<tr class="group-row"><td colspan="' + (cols.length + 2) + '">' + esc(r.key) +
            "<span>" + comma(r.stats.count) + "건 · 매출 " + comma(r.stats.revenue) +
            " · 순마진 " + comma(r.stats.margin) + " · " + pct(r.stats.rate) + "</span></td></tr>";
          return;
        }
        if (shown >= limit) return;
        body += rowHtml(r.order, cols, ++shown);
      });
    }
    body += "</tbody>";

    var more = truncated
      ? '<div class="banner info"><b>' + comma(limit) + "행만 표시 중</b> — 전체 " + comma(orderRows.length) + "행" +
        '<div class="spacer"></div><button class="btn sm" data-act="more-rows">500행 더 보기</button></div>'
      : "";

    return '<div class="sheet-scroll" id="sheet-scroll"><table class="sheet" id="sheet">' + head + body + "</table></div>" + more;
  }

  function rowClass(o) {
    var cls = [];
    if (o._risk && o._risk.level === "danger") cls.push("r-risk");
    else if (o._risk && o._risk.level) cls.push("r-cs");
    else if (o._step === "uploaded") cls.push("r-uploaded");
    else if (o._step === "invoiced") cls.push("r-invoiced");
    else if (o._step === "ordered") cls.push("r-ordered");
    if (o.netMargin != null && o.netMargin < 0) cls.push("r-loss");
    if (App.state.ui.sel[o.id]) cls.push("sel");
    return cls.join(" ");
  }

  function rowHtml(o, cols, n) {
    return '<tr data-id="' + esc(o.id) + '" class="' + rowClass(o) + '">' +
      '<td class="rownum" data-row-resize>' + n + "</td>" +
      cols.map(function (c, ci) { return cellHtml(o, c, ci); }).join("") +
      '<td class="del"><button data-act="del-row" title="행 삭제">✕</button></td></tr>';
  }

  function cellHtml(o, c, ci) {
    var k = c.key;
    if (k === "_sel") {
      return '<td class="act"><span class="sheet-check"><input type="checkbox" data-act="sel-row"' +
        (App.state.ui.sel[o.id] ? " checked" : "") + "></span></td>";
    }
    if (k === "_risk") {
      if (!o._risk || !o._risk.level) return '<td class="act"></td>';
      var danger = o._risk.level === "danger";
      return '<td class="act" title="' + esc(o._risk.reasons.join(" / ")) + '">' +
        '<span class="risk-dot' + (danger ? "" : " warn") + '" data-act="risk-info">' +
        (danger ? "위험" : "주의") + "</span></td>";
    }
    if (k === "_go") {
      var ordered = String(o.orderedYn).toUpperCase() === "O";
      return '<td class="act"><div class="go-pair">' +
        '<button class="go-btn" data-act="prep" title="배송지 정보 복사 + 구매링크 열기">준비 ↗</button>' +
        '<button class="go-btn' + (ordered ? " done" : "") + '" data-act="toggle-order" title="' +
        (ordered ? "발주 표시를 지웁니다" : "주문여부 O · 결제일시 · 담당자/구매처/계정/카드를 한 번에 기록합니다") + '">' +
        (ordered ? "취소" : "발주") + "</button></div></td>";
    }
    if (k === "_step") {
      return '<td class="act"><span class="step-chip step-' + o._step + '">' +
        esc(Core.stepLabel(o._step)) + "</span></td>";
    }

    var col = Core.colByKey(k);
    var v = o[k];

    if (col && col.kind === "calc") {
      var text = "", cls = "";
      if (col.type === "money") { text = v == null || v === "" ? "—" : comma(v); cls = toNum(v) < 0 ? "neg" : (toNum(v) > 0 ? "pos" : ""); }
      else if (col.type === "pct") text = v == null ? "—" : pct(v);
      else text = v == null ? "" : String(v);
      return '<td class="calc ' + cls + '" data-k="' + esc(k) + '">' + esc(text) + "</td>";
    }

    var copyAttr = COPY_KEYS[k] ? ' class="copy-cell" data-copy="' + esc(k) + '"' : "";
    if (col && col.type === "yn") {
      return "<td" + copyAttr + '><select data-k="' + esc(k) + '" data-col="' + ci + '">' +
        ["", "O", "X"].map(function (x) {
          return '<option value="' + x + '"' + (String(v || "") === x ? " selected" : "") + ">" + (x || "—") + "</option>";
        }).join("") + "</select></td>";
    }
    if (col && col.type === "courier") {
      return "<td><select data-k=\"" + esc(k) + '" data-col="' + ci + '"><option value="">—</option>' +
        Core.COURIERS.map(function (cc) {
          return '<option value="' + cc.code + '"' + (v === cc.code ? " selected" : "") + ">" + esc(cc.short) + "</option>";
        }).join("") + "</select></td>";
    }
    var numeric = col && (col.type === "money" || col.type === "int");
    var display = numeric ? (v === "" || v == null ? "" : comma(v)) : (v == null ? "" : String(v));
    return "<td" + copyAttr + '><input type="text" data-k="' + esc(k) + '" data-col="' + ci + '"' +
      (numeric ? ' class="num-in"' : "") + ' value="' + esc(display) + '"></td>';
  }

  /* ---------- 셀 값 반영 ---------- */
  function setField(o, key, value) {
    var col = Core.colByKey(key);
    if (!col || col.kind === "calc") return;
    if (col.type === "money" || col.type === "int") {
      var t = String(value).trim();
      o[key] = t === "" ? "" : toNum(t);
    } else if (col.type === "yn") {
      o[key] = String(value).toUpperCase() === "O" ? "O" : (String(value).toUpperCase() === "X" ? "X" : "");
    } else if (col.type === "courier") {
      o[key] = Core.normalizeCourier(value);
    } else {
      o[key] = String(value);
    }
  }

  function refreshRow(o) {
    App.recompute(o);
    var tr = $('#sheet tr[data-id="' + o.id + '"]');
    if (!tr) return;
    tr.className = rowClass(o);
    var cols = visibleCols();
    cols.forEach(function (c, ci) {
      var col = Core.colByKey(c.key);
      if (c.key === "_step") {
        var td = tr.children[ci + 1];
        if (td) td.innerHTML = '<span class="step-chip step-' + o._step + '">' + esc(Core.stepLabel(o._step)) + "</span>";
        return;
      }
      if (c.key === "_risk") {
        var td2 = tr.children[ci + 1];
        if (td2) {
          if (!o._risk || !o._risk.level) td2.innerHTML = "";
          else td2.innerHTML = '<span class="risk-dot' + (o._risk.level === "danger" ? "" : " warn") +
            '">' + (o._risk.level === "danger" ? "위험" : "주의") + "</span>";
          td2.title = o._risk && o._risk.reasons ? o._risk.reasons.join(" / ") : "";
        }
        return;
      }
      if (!col || col.kind !== "calc") return;
      var cell = tr.querySelector('td.calc[data-k="' + c.key + '"]');
      if (!cell) return;
      var v = o[c.key], text, cls = "calc";
      if (col.type === "money") { text = v == null || v === "" ? "—" : comma(v); cls += toNum(v) < 0 ? " neg" : (toNum(v) > 0 ? " pos" : ""); }
      else if (col.type === "pct") text = v == null ? "—" : pct(v);
      else text = v == null ? "" : String(v);
      cell.className = cls;
      cell.textContent = text;
    });
  }

  function findOrder(id) {
    var list = App.state.orders;
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  /* ---------- 딸깍 동작 ---------- */
  function shippingText(o) {
    var phone = App.state.settings.myPhone || o.recvPhone || o.recvTel || "";
    return [
      "받는분: " + (o.recipient || ""),
      "연락처: " + phone,
      "우편번호: " + (o.zipcode || ""),
      "주소: " + (o.address || ""),
      "요청사항: " + (o.deliveryMemo || "")
    ].join("\n");
  }
  function prepOrder(o) {
    if (!App.state.settings.myPhone) {
      toast("설정에서 '내 전화번호'를 먼저 넣어주세요 — 고객 번호가 구매처로 넘어가지 않게 합니다");
    }
    App.copyText(shippingText(o), "배송지 정보");
    if (o.buyLink) App.openUrl(o.buyLink);
  }
  function toggleOrdered(o) {
    var ordered = String(o.orderedYn).toUpperCase() === "O";
    if (ordered) {
      o.orderedYn = "";
    } else {
      var d = App.state.settings.defaults;
      o.orderedYn = "O";
      if (!o.paidAt) o.paidAt = App.nowStr();
      if (!o.manager && d.manager) o.manager = d.manager;
      if (!o.vendor && d.vendor) o.vendor = d.vendor;
      if (!o.vendorAccount && d.vendorAccount) o.vendorAccount = d.vendorAccount;
      if (!o.cardName && d.cardName) o.cardName = d.cardName;
      if (!o.buyAmount && o.buyUnitPrice) o.buyAmount = toNum(o.buyUnitPrice) * (o.qty || 1);
    }
    App.recompute(o);
  }

  function selectedOrders() {
    var sel = App.state.ui.sel;
    return App.state.orders.filter(function (o) { return sel[o.id]; });
  }

  /* ---------- 일괄 입력 ---------- */
  function bulkFill() {
    var list = selectedOrders();
    if (!list.length) return;
    var d = App.state.settings.defaults;
    var body = '<p class="muted" style="margin:0 0 14px">비워둔 칸은 건드리지 않습니다. ' +
      list.length + "건에 한 번에 적용됩니다.</p><div class=\"grid-2\">" +
      App.field("담당자", "bf-manager", d.manager) +
      App.field("구매처", "bf-vendor", d.vendor) +
      App.field("계정", "bf-account", d.vendorAccount) +
      App.field("카드", "bf-card", d.cardName) +
      App.field("구매가(단가)", "bf-unit", "") +
      App.field("구매금액(총액)", "bf-amount", "") +
      App.field("카테고리", "bf-category", "") +
      App.field("배송사코드", "bf-courier", "") +
      "</div>" +
      '<div class="field"><label><input type="checkbox" id="bf-ordered" style="width:auto;margin-right:6px">' +
      "발주완료(주문여부 O)로 표시하고 결제일시를 지금으로 기록</label></div>";
    App.openModal({
      title: "일괄 입력", body: body,
      onOk: function (bg) {
        function val(id) { return bg.querySelector("#" + id).value.trim(); }
        var m = val("bf-manager"), v = val("bf-vendor"), a = val("bf-account"), c = val("bf-card");
        var unit = val("bf-unit"), amount = val("bf-amount"), cat = val("bf-category"), cour = val("bf-courier");
        var mark = bg.querySelector("#bf-ordered").checked;
        list.forEach(function (o) {
          if (m) o.manager = m;
          if (v) o.vendor = v;
          if (a) o.vendorAccount = a;
          if (c) o.cardName = c;
          if (unit) { o.buyUnitPrice = toNum(unit); if (!amount) o.buyAmount = toNum(unit) * (o.qty || 1); }
          if (amount) o.buyAmount = toNum(amount);
          if (cat) o.category = cat;
          if (cour) o.courierCode = Core.normalizeCourier(cour);
          if (mark) {
            o.orderedYn = "O";
            if (!o.paidAt) o.paidAt = App.nowStr();
          }
          App.recompute(o);
        });
        App.persist(); App.render();
        toast(list.length + "건에 일괄 적용했습니다");
      }
    });
  }

  function bulkBlacklist() {
    var list = selectedOrders();
    if (!list.length) return;
    App.confirmBox({
      title: "블랙리스트 등록",
      body: list.length + "건의 수령자명·주소를 블랙리스트에 등록합니다.",
      okLabel: "등록"
    }, function () {
      var added = 0;
      list.forEach(function (o) {
        if (!o.recipient) return;
        var dup = App.state.blacklist.some(function (b) {
          return Core.norm(b.name) === Core.norm(o.recipient) && Core.norm(b.address) === Core.norm(o.address);
        });
        if (dup) return;
        App.state.blacklist.push({
          name: o.recipient, address: o.address, phone: o.recvPhone || o.recvTel,
          memo: "주문관리에서 등록", addedAt: App.todayStr()
        });
        added++;
      });
      App.recomputeAll(); App.persist(); App.render();
      toast(added + "건을 블랙리스트에 등록했습니다");
    });
  }

  function bulkCs() {
    var list = selectedOrders();
    if (!list.length) return;
    list.forEach(function (o) {
      App.state.cs.push({
        id: App.uid("cs"), orderId: o.id,
        date: App.todayStr(), orderNo: o.siteOrderNo || o.uniqueNo, customer: o.recipient,
        platform: o.siteName, product: o.productName, phone: o.recvPhone || o.recvTel,
        channel: "판매자센터", type: "출고 전 취소", status: "접수", stage: "확인중", action: ""
      });
    });
    App.state.ui.sel = {};
    App.persist();
    App.state.ui.tab = "cs";
    App.render();
    toast(list.length + "건을 CS로 보냈습니다");
  }

  function pasteOrders() {
    App.openModal({
      title: "발주서 붙여넣기",
      body: '<p class="muted" style="margin:0 0 12px">엑셀·구글시트에서 <b>헤더 줄까지 포함해</b> 복사한 뒤 붙여넣으세요. ' +
        "열 이름이 달라도 자동으로 맞춥니다.</p>" +
        '<div class="field"><textarea id="paste-box" placeholder="수집일<TAB>주문일<TAB>판매사이트 주문번호 ..."></textarea></div>',
      onOk: function (bg) {
        var text = bg.querySelector("#paste-box").value;
        var list = Importer.fromPaste(text);
        if (!list.length) { toast("읽을 수 있는 주문이 없습니다"); return false; }
        App.mergeOrders(list, "붙여넣기");
        App.persist(); App.render();
      }
    });
  }

  function colPicker() {
    var cols = allCols().filter(function (c) { return c.key.charAt(0) !== "_"; });
    var hidden = App.state.ui.hidden;
    var body = '<p class="muted" style="margin:0 0 12px">시트에 표시할 열을 고르세요. 순서는 표 머리글을 끌어서 바꿀 수 있습니다.</p>' +
      '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px">' +
      cols.map(function (c) {
        return '<label style="display:flex;gap:6px;align-items:center;font-size:12px">' +
          '<input type="checkbox" data-col-toggle="' + esc(c.key) + '"' + (hidden[c.key] ? "" : " checked") + ">" +
          esc(c.label) + "</label>";
      }).join("") + "</div>";
    App.openModal({
      title: "열 선택", body: body, wide: true,
      onOk: function (bg) {
        var h = {};
        $$("[data-col-toggle]", bg).forEach(function (inp) {
          if (!inp.checked) h[inp.getAttribute("data-col-toggle")] = 1;
        });
        App.state.ui.hidden = h;
        App.persist(); App.render();
      }
    });
  }

  /* =====================================================================
   * 시트 이벤트 (한 번만 바인딩 — 위임)
   * ===================================================================== */
  function bindSheet() {
    var pane = $("#pane");

    pane.addEventListener("input", function (e) {
      var el = e.target;
      if (el.matches("#q")) {
        App.state.ui.q = el.value;
        App.schedulePersist();
        redrawSheet();
        return;
      }
      if (!el.matches("input[data-k]")) return;
      var tr = el.closest("tr[data-id]");
      if (!tr) return;
      var o = findOrder(tr.getAttribute("data-id"));
      if (!o) return;
      setField(o, el.getAttribute("data-k"), el.value);
      refreshRow(o);
      App.schedulePersist();
    });

    pane.addEventListener("change", function (e) {
      var el = e.target;
      if (el.matches("#f-filter")) { App.state.ui.filter = el.value; App.persist(); App.render(); return; }
      if (el.matches("#f-group")) { App.state.ui.group = el.value; App.persist(); App.render(); return; }
      if (el.matches("select[data-k]")) {
        var tr = el.closest("tr[data-id]");
        var o = tr && findOrder(tr.getAttribute("data-id"));
        if (!o) return;
        setField(o, el.getAttribute("data-k"), el.value);
        refreshRow(o);
        App.schedulePersist();
      }
    });

    pane.addEventListener("blur", function (e) {
      var el = e.target;
      if (!el.matches || !el.matches("input.num-in")) return;
      var tr = el.closest("tr[data-id]");
      var o = tr && findOrder(tr.getAttribute("data-id"));
      if (!o) return;
      var k = el.getAttribute("data-k");
      el.value = o[k] === "" || o[k] == null ? "" : comma(o[k]);
    }, true);

    pane.addEventListener("click", function (e) {
      var t = e.target;

      var presetBtn = t.closest("#preset-seg [data-preset]");
      if (presetBtn) {
        App.state.ui.preset = presetBtn.getAttribute("data-preset");
        App.state.ui.colOrder = [];
        App.persist(); App.render();
        return;
      }

      var act = t.closest("[data-act]");
      if (act) {
        var name = act.getAttribute("data-act");
        var tr = act.closest("tr[data-id]");
        var o = tr ? findOrder(tr.getAttribute("data-id")) : null;
        handleAction(name, o, act, e);
        return;
      }

      var copyCell = t.closest("td[data-copy]");
      if (copyCell) {
        var tr2 = copyCell.closest("tr[data-id]");
        var o2 = tr2 && findOrder(tr2.getAttribute("data-id"));
        if (!o2) return;
        var key = copyCell.getAttribute("data-copy");
        var value = key === "recvPhone" && App.state.settings.myPhone ? App.state.settings.myPhone : o2[key];
        App.copyText(value, COPY_KEYS[key]);
      }
    });

    // 셀 이동 (엔터/위아래)
    pane.addEventListener("keydown", function (e) {
      var el = e.target;
      if (!el.matches || !el.matches("input[data-k],select[data-k]")) return;
      if (e.key !== "Enter" && e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      if (el.tagName === "SELECT" && e.key !== "Enter") return;
      e.preventDefault();
      var tr = el.closest("tr[data-id]");
      var col = el.getAttribute("data-col");
      var target = e.key === "ArrowUp" ? tr.previousElementSibling : tr.nextElementSibling;
      while (target && !target.getAttribute("data-id")) {
        target = e.key === "ArrowUp" ? target.previousElementSibling : target.nextElementSibling;
      }
      if (!target) return;
      var next = target.querySelector('[data-col="' + col + '"]');
      if (next) { next.focus(); if (next.select) next.select(); }
    });

    // 블록 붙여넣기
    pane.addEventListener("paste", function (e) {
      var el = e.target;
      if (!el.matches || !el.matches("input[data-k]")) return;
      var text = (e.clipboardData || window.clipboardData).getData("text");
      if (!text || (text.indexOf("\t") === -1 && text.indexOf("\n") === -1)) return;
      e.preventDefault();
      var cols = visibleCols();
      var startCol = parseInt(el.getAttribute("data-col"), 10) || 0;
      var tr = el.closest("tr[data-id]");
      var visible = displayRows().filter(function (r) { return r.type === "order"; }).map(function (r) { return r.order; });
      var startRow = 0;
      if (tr) {
        var id = tr.getAttribute("data-id");
        for (var i = 0; i < visible.length; i++) if (visible[i].id === id) { startRow = i; break; }
      }
      var matrix = Importer.dsvToMatrix(text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n+$/, ""), "\t");
      matrix.forEach(function (cells, r) {
        var o = visible[startRow + r];
        if (!o) { o = App.blankOrder(); App.state.orders.push(o); visible.push(o); }
        cells.forEach(function (val, c) {
          var col = cols[startCol + c];
          if (!col || col.key.charAt(0) === "_") return;
          setField(o, col.key, val);
        });
        App.recompute(o);
      });
      App.persist(); App.render();
      toast(matrix.length + "행을 붙여넣었습니다");
    });

    bindResizeAndDrag(pane);
  }

  function handleAction(name, o, el, e) {
    var s = App.state;
    switch (name) {
      case "prep": if (o) prepOrder(o); return;
      case "toggle-order":
        if (!o) return;
        toggleOrdered(o);
        App.persist(); App.render();
        return;
      case "risk-info":
        if (o) App.openModal({
          title: "블랙리스트 일치", foot: '<button class="btn" data-close>닫기</button>',
          body: "<p><b>" + esc(o.recipient) + "</b> · " + esc(o.address) + "</p>" +
            "<ul>" + o._risk.reasons.map(function (r) { return "<li>" + esc(r) + "</li>"; }).join("") + "</ul>" +
            '<p class="muted">발송 전에 구매처 주문을 취소하거나 고객에게 확인하세요.</p>'
        });
        return;
      case "show-risk": App.showRiskModal(); return;
      case "sel-row":
        if (!o) return;
        s.ui.sel[o.id] = el.checked;
        App.render();
        return;
      case "sel-all":
        var on = el.checked;
        filtered().forEach(function (x) { s.ui.sel[x.id] = on; });
        App.render();
        return;
      case "sel-none": s.ui.sel = {}; App.render(); return;
      case "del-row":
        if (!o) return;
        removeOrders([o]);
        return;
      case "bulk-del":
        removeOrders(selectedOrders());
        return;
      case "undo-del":
        var item = s.trash.pop();
        if (!item) { toast("복구할 행이 없습니다"); return; }
        s.orders.splice(Math.min(item.index, s.orders.length), 0, item.order);
        App.recomputeAll(); App.persist(); App.render();
        toast("삭제한 행을 복구했습니다");
        return;
      case "add-row":
        var n = App.blankOrder();
        s.orders.push(n);
        App.persist(); App.render();
        return;
      case "bulk-fill": bulkFill(); return;
      case "bulk-order":
        selectedOrders().forEach(function (x) {
          if (String(x.orderedYn).toUpperCase() !== "O") toggleOrdered(x);
        });
        App.persist(); App.render();
        return;
      case "bulk-blacklist": bulkBlacklist(); return;
      case "bulk-cs": bulkCs(); return;
      case "paste-orders": pasteOrders(); return;
      case "col-pick": colPicker(); return;
      case "reset-layout":
        s.ui.colOrder = []; s.ui.colWidths = {}; s.ui.hidden = {};
        App.persist(); App.render();
        toast("열 배치를 기본값으로 되돌렸습니다");
        return;
      case "more-rows":
        s.ui.limit += 500;
        App.render();
        return;
      default:
        if (App.handleViewAction) App.handleViewAction(name, el, e);
    }
  }

  function removeOrders(list) {
    if (!list || !list.length) return;
    App.confirmBox({
      title: "행 삭제", danger: true, okLabel: "삭제",
      body: list.length + "건을 삭제합니다. [삭제 복구]로 되돌릴 수 있습니다."
    }, function () {
      list.forEach(function (o) {
        var i = App.state.orders.indexOf(o);
        if (i < 0) return;
        App.state.trash.push({ order: o, index: i });
        App.state.orders.splice(i, 1);
        delete App.state.ui.sel[o.id];
      });
      if (App.state.trash.length > 50) App.state.trash.splice(0, App.state.trash.length - 50);
      App.persist(); App.render();
      toast(list.length + "건을 삭제했습니다");
    });
  }

  function redrawSheet() {
    var wrap = $("#sheet-scroll");
    if (!wrap) { App.render(); return; }
    var scroll = wrap.scrollTop;
    var holder = document.createElement("div");
    holder.innerHTML = sheetHtml();
    wrap.parentNode.replaceChild(holder.firstChild, wrap);
    var again = $("#sheet-scroll");
    if (again) again.scrollTop = scroll;
  }

  /* ---------- 열 너비 / 순서 ---------- */
  var resizing = null, dragKey = "";
  function bindResizeAndDrag(pane) {
    pane.addEventListener("mousedown", function (e) {
      var handle = e.target.closest("[data-col-resize]");
      if (!handle) return;
      var key = handle.getAttribute("data-col-resize");
      var col = colByKey(key);
      resizing = { key: key, startX: e.clientX, startW: colWidth(col) };
      document.body.classList.add("resizing");
      e.preventDefault();
    });
    document.addEventListener("mousemove", function (e) {
      if (!resizing) return;
      var w = Math.max(40, resizing.startW + e.clientX - resizing.startX);
      var col = $('#sheet col[data-ck="' + resizing.key + '"]');
      if (col) col.style.width = w + "px";
    });
    document.addEventListener("mouseup", function (e) {
      if (!resizing) return;
      App.state.ui.colWidths[resizing.key] = Math.max(40, resizing.startW + e.clientX - resizing.startX);
      document.body.classList.remove("resizing");
      resizing = null;
      App.schedulePersist();
    });

    pane.addEventListener("dragstart", function (e) {
      var th = e.target.closest("th[data-k]");
      if (!th) return;
      dragKey = th.getAttribute("data-k");
      th.classList.add("dragging-col");
    });
    pane.addEventListener("dragover", function (e) {
      var th = e.target.closest("th[data-k]");
      if (!dragKey || !th || th.getAttribute("data-k") === dragKey) return;
      e.preventDefault();
      $$("#sheet th.col-drop").forEach(function (x) { x.classList.remove("col-drop", "drop-after"); });
      th.classList.add("col-drop");
      var r = th.getBoundingClientRect();
      if (e.clientX > r.left + r.width / 2) th.classList.add("drop-after");
    });
    pane.addEventListener("drop", function (e) {
      var th = e.target.closest("th[data-k]");
      if (!dragKey || !th) return;
      e.preventDefault();
      var target = th.getAttribute("data-k");
      var keys = visibleCols().map(function (c) { return c.key; });
      var from = keys.indexOf(dragKey), to = keys.indexOf(target);
      if (from >= 0 && to >= 0 && from !== to) {
        var moved = keys.splice(from, 1)[0];
        if (from < to) to--;
        var r = th.getBoundingClientRect();
        if (e.clientX > r.left + r.width / 2) to++;
        keys.splice(Math.max(0, Math.min(to, keys.length)), 0, moved);
        // 숨긴 열도 뒤에 보존
        var hidden = presetOrder().filter(function (k) { return keys.indexOf(k) === -1; });
        App.state.ui.colOrder = keys.concat(hidden);
        App.state.ui.presetOf = App.state.ui.preset;
        App.persist(); App.render();
      }
      dragKey = "";
    });
    pane.addEventListener("dragend", function () {
      dragKey = "";
      $$("#sheet th").forEach(function (x) { x.classList.remove("col-drop", "drop-after", "dragging-col"); });
    });
  }

  /* =====================================================================
   * 공통 편집 표
   * ===================================================================== */
  function editTable(listKey, cols, opts) {
    opts = opts || {};
    var list = App.state[listKey] || [];
    var rows = opts.rows || list;
    var head = "<thead><tr>" + cols.map(function (c) {
      return '<th' + (c.num ? ' class="num"' : "") + (c.w ? ' style="min-width:' + c.w + 'px"' : "") + ">" + esc(c.label) + "</th>";
    }).join("") + "<th></th></tr></thead>";
    var body = "<tbody>" + (rows.length ? rows.map(function (item, i) {
      var idx = list.indexOf(item);
      return '<tr data-list="' + listKey + '" data-idx="' + idx + '"' + (opts.rowClass ? ' class="' + opts.rowClass(item) + '"' : "") + ">" +
        cols.map(function (c) {
          if (c.render) return "<td" + (c.num ? ' class="num"' : "") + ">" + c.render(item, idx) + "</td>";
          if (c.select) {
            // 원본 값이 목록에 없으면 그대로 살려둡니다 (가져온 데이터가 지워지지 않게)
            var opts = c.select.slice();
            var curVal = String(item[c.key] || "");
            if (curVal && opts.indexOf(curVal) === -1) opts.push(curVal);
            return "<td><select data-field=\"" + c.key + '">' + opts.map(function (op) {
              return '<option value="' + esc(op) + '"' + (curVal === op ? " selected" : "") + ">" + esc(op || "—") + "</option>";
            }).join("") + "</select></td>";
          }
          var v = item[c.key];
          var display = c.num ? (v === "" || v == null ? "" : comma(v)) : (v == null ? "" : v);
          return "<td" + (c.num ? ' class="num"' : (c.wrap ? ' class="wrap"' : "")) + '><input type="text" data-field="' +
            c.key + '"' + (c.num ? ' class="num-in"' : "") + ' value="' + esc(display) + '"></td>';
        }).join("") +
        '<td><button class="mini red" data-row-del>삭제</button></td></tr>';
    }).join("") : '<tr><td colspan="' + (cols.length + 1) + '" class="muted">' + esc(opts.empty || "데이터가 없습니다.") + "</td></tr>") + "</tbody>";
    return '<div class="data-scroll"><table class="data">' + head + body + "</table></div>";
  }

  function bindEditTables() {
    var pane = $("#pane");
    pane.addEventListener("input", function (e) {
      var el = e.target;
      if (!el.matches("[data-field]")) return;
      var tr = el.closest("tr[data-list]");
      if (!tr) return;
      applyField(tr, el);
    });
    pane.addEventListener("change", function (e) {
      var el = e.target;
      if (!el.matches("select[data-field]")) return;
      var tr = el.closest("tr[data-list]");
      if (!tr) return;
      applyField(tr, el);
      App.render();
    });
    pane.addEventListener("click", function (e) {
      var del = e.target.closest("[data-row-del]");
      if (!del) return;
      var tr = del.closest("tr[data-list]");
      var listKey = tr.getAttribute("data-list");
      var idx = parseInt(tr.getAttribute("data-idx"), 10);
      App.state[listKey].splice(idx, 1);
      if (listKey === "blacklist") App.recomputeAll();
      App.persist(); App.render();
      toast("삭제했습니다");
    });
  }
  function applyField(tr, el) {
    var listKey = tr.getAttribute("data-list");
    var idx = parseInt(tr.getAttribute("data-idx"), 10);
    var item = App.state[listKey][idx];
    if (!item) return;
    var field = el.getAttribute("data-field");
    if (listKey === "fees" && field === "rate") {
      var r = parseFloat(String(el.value).replace(/[^0-9.]/g, ""));
      item.rate = isFinite(r) ? (r > 1 ? r / 100 : r) : 0;   // 10.6 으로 넣어도 0.106 으로 받습니다
      item.rateVat = Math.round(item.rate * 1.1 * 1e6) / 1e6;
    } else {
      item[field] = el.classList.contains("num-in") ? toNum(el.value) : el.value;
    }
    if (listKey === "blacklist" || listKey === "fees") App.recomputeAll();
    App.schedulePersist();
  }

  /* =====================================================================
   * CS
   * ===================================================================== */
  App.views.cs = function () {
    var list = App.state.cs;
    var open = list.filter(function (c) { return c.status && c.status !== "완료"; }).length;
    var html = '<div class="kpi-grid">' +
      App.kpi("전체 CS", comma(list.length) + "건") +
      App.kpi("진행중", comma(open) + "건", open ? "brand" : "") +
      App.kpi("완료", comma(list.length - open) + "건", "pos") +
      "</div>";
    html += '<div class="toolbar"><b>CS 관리</b>' +
      '<span class="muted">주문관리에서 선택 → [CS로 보내기] 하면 자동으로 등록됩니다.</span>' +
      '<div class="spacer"></div><button class="btn sm" data-act="cs-add">CS 추가</button></div>';
    html += editTable("cs", [
      { key: "date", label: "일자", w: 100 },
      { key: "customer", label: "고객명", w: 80 },
      { key: "orderNo", label: "주문번호", w: 150 },
      { key: "platform", label: "플랫폼", w: 100 },
      { key: "product", label: "제품명", w: 220, wrap: true },
      { key: "phone", label: "연락처", w: 120 },
      { key: "channel", label: "방식", w: 90, select: ["", "판매자센터", "전화", "문자", "카톡", "이메일"] },
      { key: "type", label: "구분", w: 110, select: ["", "출고 전 취소", "출고 후 반품", "교환", "배송문의", "파손/오배송", "기타"] },
      { key: "status", label: "진행상태", w: 90, select: ["", "접수", "진행중", "완료", "보류"] },
      { key: "stage", label: "세부단계", w: 100, select: ["", "확인중", "구매처 연락", "회수요청", "환불완료", "조치완료"] },
      { key: "action", label: "조치내용", w: 260, wrap: true }
    ], {
      empty: "CS 건이 없습니다. 주문관리에서 [CS로 보내기]로 등록할 수 있습니다.",
      rowClass: function (c) { return c.status === "완료" ? "" : (c.status === "보류" ? "risk-row" : ""); }
    });
    return html;
  };

  /* =====================================================================
   * 블랙리스트
   * ===================================================================== */
  App.views.blacklist = function () {
    var list = App.state.blacklist;
    var risk = App.riskOrders();
    var html = '<div class="banner ' + (risk.length ? "risk" : "ok") + '">' +
      '<span class="tag">' + (risk.length ? "주문 처리 위험" : "이상 없음") + "</span>" +
      (risk.length
        ? "<b>" + risk.length + "건</b>의 주문이 블랙리스트와 일치합니다."
        : "현재 주문 중 블랙리스트와 일치하는 건은 없습니다.") +
      '<div class="spacer"></div>' +
      (risk.length ? '<button class="btn danger sm" data-go-tab="orders" data-go-filter="risk">주문 보기</button>' : "") +
      "</div>";

    html += '<div class="kpi-grid">' +
      App.kpi("등록 인원", comma(list.length) + "명") +
      App.kpi("주소까지 등록", comma(list.filter(function (b) { return b.address; }).length) + "명") +
      App.kpi("일치 주문", comma(risk.length) + "건", risk.length ? "neg" : "pos") +
      "</div>";

    html += '<div class="toolbar"><b>블랙리스트</b>' +
      '<span class="muted">이름은 완전일치, 주소는 핵심 단어가 겹치면 경고합니다. 마스킹 이름(김성*)도 인식합니다.</span>' +
      '<div class="spacer"></div>' +
      '<button class="btn sm" data-act="bl-add">직접 추가</button>' +
      '<button class="btn sm" data-act="bl-paste">붙여넣기</button>' +
      '<button class="btn sm" data-act="bl-recheck">주문 재검사</button></div>';

    if (risk.length) {
      html += '<div class="panel"><div class="panel-head"><h2>일치한 주문</h2></div>' +
        '<div class="data-scroll" style="max-height:260px"><table class="data"><thead><tr>' +
        "<th>수령자</th><th>주소</th><th>상품</th><th>금액</th><th>사유</th></tr></thead><tbody>" +
        risk.map(function (o) {
          return '<tr class="risk-row"><td>' + esc(o.recipient) + '</td><td class="wrap">' + esc(o.address) +
            '</td><td class="wrap">' + esc(o.productName) + '</td><td class="num">' + comma(o.salePrice) +
            "</td><td>" + esc(o._risk.reasons.join(" / ")) + "</td></tr>";
        }).join("") + "</tbody></table></div></div>";
    }

    html += editTable("blacklist", [
      { key: "name", label: "이름", w: 110 },
      { key: "address", label: "주소", w: 340, wrap: true },
      { key: "phone", label: "연락처", w: 130 },
      { key: "memo", label: "사유", w: 180 },
      { key: "addedAt", label: "등록일", w: 100 }
    ], { empty: "블랙리스트가 비어 있습니다. 워크북을 올리거나 직접 추가하세요." });
    return html;
  };

  /* =====================================================================
   * 송장
   * ===================================================================== */
  App.views.invoice = function () {
    var s = App.state;
    var needInvoice = s.orders.filter(function (o) { return o._step === "ordered"; });
    var needUpload = s.orders.filter(function (o) { return o._step === "invoiced"; });
    var done = s.orders.filter(function (o) { return o._step === "uploaded"; });

    var html = '<div class="kpi-grid">' +
      App.kpi("송장 입력 대기", comma(needInvoice.length) + "건", needInvoice.length ? "brand" : "") +
      App.kpi("업로드 대기", comma(needUpload.length) + "건", needUpload.length ? "brand" : "") +
      App.kpi("업로드 완료", comma(done.length) + "건", "pos") +
      App.kpi("송장목록 보유", comma(s.invoiceList.length) + "건", "", "EMP 출고 목록") +
      "</div>";

    html += '<div class="toolbar"><b>송장 처리</b>' +
      '<div class="spacer"></div>' +
      '<button class="btn sm" data-act="inv-paste">송장 붙여넣기</button>' +
      '<button class="btn sm" data-act="inv-emp">EMP 출고목록 대조</button>' +
      '<button class="btn primary sm" data-act="inv-export">쿠팡 송장 업로드 파일</button></div>';

    html += '<div class="panel"><div class="panel-head"><h2>송장 입력 대기</h2>' +
      '<span class="muted">발주는 끝났는데 송장번호가 없는 주문입니다. 여기서 바로 입력하세요.</span></div>' +
      '<div class="data-scroll" style="max-height:420px"><table class="data"><thead><tr>' +
      "<th>수령자</th><th>상품</th><th>구매처</th><th>주문고유번호</th><th>배송사</th><th>송장번호</th></tr></thead><tbody>" +
      (needInvoice.length ? needInvoice.slice(0, 300).map(function (o) {
        return '<tr data-inv-id="' + esc(o.id) + '"><td>' + esc(o.recipient) + '</td><td class="wrap">' + esc(o.productName) +
          "</td><td>" + esc(o.vendor) + "</td><td>" + esc(o.uniqueNo) + "</td>" +
          '<td><select data-inv-field="courierCode"><option value="">—</option>' +
          Core.COURIERS.map(function (c) {
            return '<option value="' + c.code + '"' + (o.courierCode === c.code ? " selected" : "") + ">" + esc(c.short) + "</option>";
          }).join("") + "</select></td>" +
          '<td><input type="text" data-inv-field="invoiceNo" value="' + esc(o.invoiceNo || "") + '"></td></tr>';
      }).join("") : '<tr><td colspan="6" class="muted">대기 중인 건이 없습니다.</td></tr>') +
      "</tbody></table></div></div>";

    return html;
  };

  /* =====================================================================
   * 사입 / 수수료 / 계정·카드
   * ===================================================================== */
  App.views.stock = function () {
    var list = App.state.stock;
    var total = list.reduce(function (a, b) { return a + toNum(b.amount); }, 0);
    return '<div class="kpi-grid">' +
      App.kpi("사입 건수", comma(list.length) + "건") +
      App.kpi("사입 금액", won(total)) +
      App.kpi("포인트", won(list.reduce(function (a, b) { return a + toNum(b.point); }, 0)), "brand") +
      "</div>" +
      '<div class="toolbar"><b>사입 관리</b><span class="muted">미리 사둔 재고의 매입 내역입니다.</span>' +
      '<div class="spacer"></div><button class="btn sm" data-act="stock-add">행 추가</button></div>' +
      editTable("stock", [
        { key: "productName", label: "상품명", w: 260, wrap: true },
        { key: "manager", label: "담당자", w: 80 },
        { key: "vendor", label: "구매처", w: 100 },
        { key: "account", label: "계정", w: 130 },
        { key: "amount", label: "구매금액", w: 100, num: true },
        { key: "orderNo", label: "주문번호", w: 150 },
        { key: "paidAt", label: "결제일시", w: 130 },
        { key: "card", label: "카드", w: 80 },
        { key: "point", label: "포인트", w: 80, num: true },
        { key: "orderedYn", label: "주문여부", w: 80, select: ["", "O", "X"] },
        { key: "saleStatus", label: "판매현황", w: 150 }
      ], { empty: "사입 내역이 없습니다." });
  };

  App.views.fees = function () {
    var list = App.state.fees;
    return '<div class="banner info"><span class="tag">계산 기준</span>' +
      "순마진 = (판매가 × (1 − 수수료율VAT) + 배송비순액 − 구매금액 − 에누리) ÷ 1.1 · 부가세 = 순마진 × 10%" +
      "</div>" +
      '<div class="toolbar"><b>수수료표</b>' +
      '<span class="muted">카테고리를 기준으로 주문에 자동 적용됩니다. 수수료율은 소수(0.106 = 10.6%)로 입력하세요.</span>' +
      '<div class="spacer"></div><button class="btn sm" data-act="fee-add">행 추가</button>' +
      '<button class="btn sm" data-act="fee-reset">기본값 복원</button></div>' +
      editTable("fees", [
        { key: "category", label: "카테고리", w: 220 },
        { key: "site", label: "플랫폼", w: 130 },
        { key: "rate", label: "수수료율", w: 100, num: false },
        {
          key: "rateVat", label: "수수료율(VAT)", w: 110,
          render: function (f) { return pct(toNum(f.rate) * 1.1, 2); }
        },
        {
          key: "count", label: "적용 주문", w: 90,
          render: function (f) {
            var n = App.state.orders.filter(function (o) { return Core.norm(o.category) === Core.norm(f.category); }).length;
            return n ? comma(n) + "건" : "—";
          }
        }
      ], { empty: "수수료표가 비어 있습니다." });
  };

  App.views.secrets = function () {
    var s = App.state;
    var show = s.settings.showSecrets;
    var html = '<div class="banner warn"><span class="tag">민감정보</span>' +
      "<b>계정·카드 정보는 이 브라우저에만 저장됩니다.</b> 백업 파일과 엑셀 내보내기에는 들어가지 않습니다. 화면 공유 중에는 열지 마세요." +
      '<div class="spacer"></div><button class="btn sm" data-act="toggle-secrets">' +
      (show ? "가리기" : "잠깐 보기") + "</button></div>";

    function mask(v) {
      var t = String(v || "");
      if (!t) return "";
      if (show) return t;
      return t.length <= 2 ? "••" : t.slice(0, 2) + new Array(Math.min(t.length - 1, 10)).join("•");
    }

    html += '<div class="toolbar"><b>계정</b><div class="spacer"></div>' +
      '<button class="btn sm" data-act="acc-add">계정 추가</button></div>' +
      editTable("accounts", [
        { key: "platform", label: "플랫폼", w: 110 },
        { key: "owner", label: "계정주인", w: 90 },
        { key: "id", label: "아이디", w: 150 },
        {
          key: "pw", label: "비밀번호", w: 150,
          render: function (a, i) {
            return '<span class="mask">' + esc(mask(a.pw)) + '</span> <button class="mini" data-copy-secret="accounts:' +
              i + ':pw">복사</button>';
          }
        },
        { key: "membership", label: "멤버십", w: 90 },
        { key: "status", label: "상태", w: 70, select: ["", "O", "X"] },
        { key: "memo", label: "메모", w: 200 }
      ], { empty: "등록된 계정이 없습니다." });

    html += '<div class="toolbar mt-14"><b>카드</b><div class="spacer"></div>' +
      '<button class="btn sm" data-act="card-add">카드 추가</button></div>' +
      editTable("cards", [
        { key: "name", label: "카드명", w: 90 },
        {
          key: "number", label: "카드번호", w: 180,
          render: function (c, i) {
            return '<span class="mask">' + esc(mask(c.number)) + '</span> <button class="mini" data-copy-secret="cards:' +
              i + ':number">복사</button>';
          }
        },
        { key: "expire", label: "유효기간", w: 90 },
        {
          key: "cvc", label: "CVC", w: 80,
          render: function (c) { return '<span class="mask">' + esc(mask(c.cvc)) + "</span>"; }
        },
        {
          key: "pin", label: "카드비번", w: 80,
          render: function (c) { return '<span class="mask">' + esc(mask(c.pin)) + "</span>"; }
        },
        { key: "birth", label: "생년월일", w: 100 },
        { key: "memo", label: "메모", w: 180 }
      ], { empty: "등록된 카드가 없습니다." });

    return html;
  };

  /* =====================================================================
   * 탭별 부가 동작
   * ===================================================================== */
  App.handleViewAction = function (name, el) {
    var s = App.state;
    switch (name) {
      case "cs-add":
        s.cs.unshift({ id: App.uid("cs"), date: App.todayStr(), status: "접수", channel: "판매자센터" });
        App.persist(); App.render();
        return;
      case "bl-add":
        s.blacklist.unshift({ name: "", address: "", phone: "", memo: "", addedAt: App.todayStr() });
        App.persist(); App.render();
        return;
      case "bl-recheck":
        App.recomputeAll(); App.persist(); App.render();
        toast("주문 " + s.orders.length + "건을 다시 검사했습니다");
        return;
      case "bl-paste":
        App.openModal({
          title: "블랙리스트 붙여넣기",
          body: '<p class="muted" style="margin:0 0 12px">한 줄에 한 명. <b>이름[탭]주소[탭]연락처</b> 순서입니다.</p>' +
            '<div class="field"><textarea id="bl-box" placeholder="홍길동&#9;서울시 ...&#9;010-0000-0000"></textarea></div>',
          onOk: function (bg) {
            var text = bg.querySelector("#bl-box").value;
            var rows = Importer.dsvToMatrix(text.replace(/\r/g, ""), text.indexOf("\t") !== -1 ? "\t" : ",");
            var added = 0;
            rows.forEach(function (r) {
              var name = String(r[0] || "").trim();
              if (!name || name === "이름") return;
              s.blacklist.push({
                name: name, address: String(r[1] || "").trim(), phone: String(r[2] || "").trim(),
                memo: String(r[3] || "").trim(), addedAt: App.todayStr()
              });
              added++;
            });
            App.recomputeAll(); App.persist(); App.render();
            toast(added + "명을 등록했습니다");
          }
        });
        return;
      case "stock-add":
        s.stock.unshift({ id: App.uid("st"), productName: "", orderedYn: "O" });
        App.persist(); App.render();
        return;
      case "fee-add":
        s.fees.unshift({ category: "", site: "", rate: 0, rateVat: 0 });
        App.persist(); App.render();
        return;
      case "fee-reset":
        App.confirmBox({ title: "수수료표 복원", body: "기본 수수료표로 되돌립니다. 직접 고친 값은 사라집니다.", okLabel: "복원" }, function () {
          s.fees = Core.DEFAULT_FEES.slice();
          App.recomputeAll(); App.persist(); App.render();
          toast("기본 수수료표로 되돌렸습니다");
        });
        return;
      case "acc-add":
        s.accounts.unshift({ platform: "", owner: "", id: "", pw: "", status: "O" });
        App.persist(); App.render();
        return;
      case "card-add":
        s.cards.unshift({ name: "", number: "" });
        App.persist(); App.render();
        return;
      case "toggle-secrets":
        s.settings.showSecrets = !s.settings.showSecrets;
        App.render();
        return;
      case "inv-export":
        App.exportCoupangInvoice();
        return;
      case "inv-paste":
        App.openModal({
          title: "송장 붙여넣기",
          body: '<p class="muted" style="margin:0 0 12px">한 줄에 한 건. <b>주문고유번호[탭]배송사[탭]송장번호</b> 순서입니다. ' +
            "배송사는 T코드(T025)나 이름(CJ) 아무거나 됩니다.</p>" +
            '<div class="field"><textarea id="inv-box" placeholder="100012771465&#9;CJ&#9;463188683845"></textarea></div>',
          onOk: function (bg) {
            var text = bg.querySelector("#inv-box").value;
            var rows = Importer.dsvToMatrix(text.replace(/\r/g, ""), text.indexOf("\t") !== -1 ? "\t" : ",");
            var index = {};
            s.orders.forEach(function (o) {
              if (o.uniqueNo) index[String(o.uniqueNo).replace(/\s/g, "")] = o;
              if (o.siteOrderNo) index[String(o.siteOrderNo).trim().split(/\s+/)[0]] = o;
            });
            var hit = 0, miss = 0;
            rows.forEach(function (r) {
              var key = String(r[0] || "").replace(/\s/g, "");
              if (!key) return;
              var o = index[key];
              if (!o) { miss++; return; }
              var cour = String(r[1] || "").trim();
              var inv = String(r[2] || "").trim();
              if (cour) o.courierCode = Core.normalizeCourier(cour);
              if (inv) o.invoiceNo = inv;
              App.recompute(o);
              hit++;
            });
            App.persist(); App.render();
            toast("송장 " + hit + "건 반영" + (miss ? " · 못 찾은 건 " + miss : ""));
          }
        });
        return;
      case "inv-emp":
        App.openModal({
          title: "EMP 출고목록 대조",
          body: '<p class="muted" style="margin:0 0 12px">EMP에서 받은 출고 목록의 <b>주문고유번호</b>를 붙여넣으세요. ' +
            "일치하는 주문이 '업로드 완료'로 바뀝니다.</p>" +
            '<div class="field"><textarea id="emp-box" placeholder="100012771465&#10;100469205058"></textarea></div>',
          onOk: function (bg) {
            var text = bg.querySelector("#emp-box").value;
            var rows = Importer.dsvToMatrix(text.replace(/\r/g, ""), text.indexOf("\t") !== -1 ? "\t" : ",");
            var list = rows.map(function (r) {
              return { uniqueNo: String(r[0] || "").replace(/\s/g, ""), status: "완료" };
            }).filter(function (v) { return v.uniqueNo && !/[가-힣]/.test(v.uniqueNo); });
            if (!list.length) { toast("읽을 번호가 없습니다"); return false; }
            s.invoiceList = list;
            var n = App.applyInvoiceList();
            App.recomputeAll(); App.persist(); App.render();
            toast(n + "건을 업로드 완료로 표시했습니다");
          }
        });
        return;
    }
  };

  /* ---------- 송장 탭 인라인 입력 ---------- */
  function bindInvoiceTable() {
    var pane = $("#pane");
    function apply(el) {
      var tr = el.closest("tr[data-inv-id]");
      if (!tr) return;
      var o = findOrder(tr.getAttribute("data-inv-id"));
      if (!o) return;
      var f = el.getAttribute("data-inv-field");
      o[f] = f === "courierCode" ? Core.normalizeCourier(el.value) : el.value.trim();
      App.recompute(o);
      App.schedulePersist();
    }
    pane.addEventListener("input", function (e) {
      if (e.target.matches("input[data-inv-field]")) apply(e.target);
    });
    pane.addEventListener("change", function (e) {
      if (e.target.matches("select[data-inv-field]")) apply(e.target);
    });
    pane.addEventListener("click", function (e) {
      var b = e.target.closest("[data-copy-secret]");
      if (!b) return;
      var parts = b.getAttribute("data-copy-secret").split(":");
      var item = App.state[parts[0]][parseInt(parts[1], 10)];
      if (item) App.copyText(item[parts[2]], "정보");
    });
  }

  App.initViews = function () {
    bindSheet();
    bindEditTables();
    bindInvoiceTable();
  };
})(window);
