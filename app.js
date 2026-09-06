/* =====================================================================
 * app.js — 우루루 통합 주문관리 (웹 앱)
 *
 * 원칙
 *   - 100% 로컬 처리. 외부 서버/API 호출 없음.
 *   - 자동 로그인·자동 결제·매크로 없음. 링크 열기와 입력 보조까지만.
 *   - 계정/카드 정보는 이 브라우저에만 저장하고 어떤 내보내기에도 넣지 않음.
 *
 * 기준 양식: 2026-09 워크북 "2.주문서" (core.js의 ORDER_COLUMNS)
 * ===================================================================== */
(function (global) {
  "use strict";

  var Core = global.OrderCore;
  var Xlsx = global.XlsxLite;
  var Importer = global.OrderImport;
  var Template = global.OrderTemplate;

  var LS = {
    orders: "uru_orders_v2",
    aux: "uru_aux_v2",          // 블랙리스트/수수료/CS/사입/송장/이력
    secrets: "uru_secrets_v2",  // 계정·카드 (별도 키 — 내보내기 대상 아님)
    settings: "uru_settings_v2",
    ui: "uru_ui_v2",
    trash: "uru_trash_v2"
  };

  var App = {
    LS: LS,
    state: {
      orders: [],
      blacklist: [],
      fees: [],
      cs: [],
      stock: [],
      accounts: [],
      cards: [],
      invoiceList: [],
      history: { daily: {}, monthly: {} },
      trash: [],
      settings: {
        myPhone: "",
        defaults: { manager: "", vendor: "", vendorAccount: "", cardName: "" },
        ollaRate: Core.OLLA_RATE,
        autoCategory: true,
        showSecrets: false
      },
      ui: {
        tab: "dashboard",
        q: "",
        filter: "all",
        group: "none",
        preset: "work",
        colOrder: [],
        colWidths: {},
        hidden: {},
        sel: {},
        limit: 300,
        dashRange: "30"
      }
    }
  };
  global.App = App;

  /* =====================================================================
   * 유틸
   * ===================================================================== */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  App.$ = $; App.$$ = $$;

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function toNum(v) { return Core.toNumber(v); }
  function comma(n) {
    var num = typeof n === "number" ? n : toNum(n);
    if (!isFinite(num)) return "";
    var neg = num < 0;
    var s = Math.round(Math.abs(num)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return (neg ? "-" : "") + s;
  }
  function won(n) { return n == null || n === "" ? "—" : "₩" + comma(n); }
  function pct(n, digits) {
    if (n == null || !isFinite(n)) return "—";
    return (n * 100).toFixed(digits == null ? 1 : digits) + "%";
  }
  function safeUrl(raw) {
    var s = String(raw || "").trim();
    if (!s) return "";
    if (!/^https?:\/\//i.test(s)) s = "https://" + s.replace(/^\/+/, "");
    try {
      var u = new URL(s);
      return (u.protocol === "http:" || u.protocol === "https:") ? u.href : "";
    } catch (e) { return ""; }
  }
  function openUrl(raw) {
    var u = safeUrl(raw);
    if (!u) { toast("열 수 있는 링크가 아닙니다"); return; }
    window.open(u, "_blank", "noopener,noreferrer");
  }
  function todayStr() {
    var d = new Date();
    return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2);
  }
  function nowStr() {
    var d = new Date();
    return todayStr() + " " + ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2);
  }
  function uid(p) { return (p || "x") + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  App.esc = esc; App.toNum = toNum; App.comma = comma; App.won = won; App.pct = pct;
  App.safeUrl = safeUrl; App.openUrl = openUrl; App.todayStr = todayStr; App.nowStr = nowStr; App.uid = uid;

  var toastTimer;
  function toast(msg) {
    var t = $("#toast");
    if (!t) return;
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("show"); }, 2600);
  }
  App.toast = toast;

  function copyText(text, label) {
    var s = String(text == null ? "" : text);
    if (!s.trim()) { toast("복사할 내용이 없습니다"); return; }
    function done() { toast((label || "내용") + " 복사됨"); }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(s).then(done, function () { legacyCopy(s, done); });
    } else legacyCopy(s, done);
  }
  function legacyCopy(s, done) {
    try {
      var ta = document.createElement("textarea");
      ta.value = s; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      done();
    } catch (e) { toast("복사에 실패했습니다"); }
  }
  App.copyText = copyText;

  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 400);
  }
  App.downloadBlob = downloadBlob;

  /* ---------- 모달 ---------- */
  function openModal(opts) {
    var root = $("#modal-root");
    var bg = document.createElement("div");
    bg.className = "modal-bg";
    bg.innerHTML =
      '<div class="modal' + (opts.wide ? " wide" : "") + '">' +
      '<div class="mhead"><h2>' + esc(opts.title || "") + '</h2><div class="spacer"></div>' +
      '<button class="btn ghost" data-close>닫기</button></div>' +
      '<div class="mbody">' + (opts.body || "") + "</div>" +
      (opts.foot === false ? "" : '<div class="mfoot">' + (opts.foot ||
        '<button class="btn" data-close>취소</button><button class="btn primary" data-ok>확인</button>') + "</div>") +
      "</div>";
    root.appendChild(bg);
    function close() { bg.remove(); document.removeEventListener("keydown", onKey, true); }
    function onKey(e) { if (e.key === "Escape") { e.preventDefault(); close(); } }
    document.addEventListener("keydown", onKey, true);
    bg.addEventListener("click", function (e) {
      if (e.target === bg) { close(); return; }
      if (e.target.closest("[data-close]")) { close(); return; }
      if (e.target.closest("[data-ok]")) {
        if (!opts.onOk || opts.onOk(bg) !== false) close();
      }
    });
    if (opts.onOpen) opts.onOpen(bg, close);
    var focusEl = bg.querySelector("input,textarea,select");
    if (focusEl) setTimeout(function () { focusEl.focus(); }, 30);
    return { el: bg, close: close };
  }
  App.openModal = openModal;

  function confirmBox(opts, onOk) {
    openModal({
      title: opts.title || "확인",
      body: '<p style="margin:0;line-height:1.6">' + esc(opts.body || "") + "</p>" +
        (opts.input ? '<div class="field mt-14"><input type="text" data-cf-input value="' + esc(opts.value || "") + '"></div>' : ""),
      foot: '<button class="btn" data-close>취소</button><button class="btn ' +
        (opts.danger ? "danger" : "primary") + '" data-ok>' + esc(opts.okLabel || "확인") + "</button>",
      onOk: function (bg) {
        var inp = bg.querySelector("[data-cf-input]");
        onOk(inp ? inp.value.trim() : true);
      }
    });
  }
  App.confirmBox = confirmBox;

  /* =====================================================================
   * 저장 / 복원
   * ===================================================================== */
  function safeSet(key, value) {
    try { localStorage.setItem(key, value); return true; }
    catch (e) { toast("브라우저 저장 공간이 가득 찼습니다. 백업 후 정리하세요."); return false; }
  }
  var persistTimer;
  function persist() {
    var s = App.state;
    safeSet(LS.orders, JSON.stringify(s.orders));
    safeSet(LS.aux, JSON.stringify({
      blacklist: s.blacklist, fees: s.fees, cs: s.cs, stock: s.stock,
      invoiceList: s.invoiceList, history: s.history
    }));
    safeSet(LS.secrets, JSON.stringify({ accounts: s.accounts, cards: s.cards }));
    safeSet(LS.settings, JSON.stringify(s.settings));
    safeSet(LS.ui, JSON.stringify(s.ui));
    safeSet(LS.trash, JSON.stringify(s.trash.slice(-50)));
  }
  function schedulePersist() {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(persist, 300);
  }
  App.persist = persist; App.schedulePersist = schedulePersist;

  function restore() {
    var s = App.state;
    try {
      var o = JSON.parse(localStorage.getItem(LS.orders));
      if (Array.isArray(o)) s.orders = o;
    } catch (e) {}
    try {
      var aux = JSON.parse(localStorage.getItem(LS.aux));
      if (aux) {
        s.blacklist = aux.blacklist || [];
        s.fees = aux.fees || [];
        s.cs = aux.cs || [];
        s.stock = aux.stock || [];
        s.invoiceList = aux.invoiceList || [];
        s.history = aux.history || { daily: {}, monthly: {} };
      }
    } catch (e) {}
    try {
      var sec = JSON.parse(localStorage.getItem(LS.secrets));
      if (sec) { s.accounts = sec.accounts || []; s.cards = sec.cards || []; }
    } catch (e) {}
    try {
      var st = JSON.parse(localStorage.getItem(LS.settings));
      if (st) {
        s.settings = Object.assign(s.settings, st);
        s.settings.defaults = Object.assign({ manager: "", vendor: "", vendorAccount: "", cardName: "" }, st.defaults || {});
      }
    } catch (e) {}
    try {
      var ui = JSON.parse(localStorage.getItem(LS.ui));
      if (ui) s.ui = Object.assign(s.ui, ui);
    } catch (e) {}
    try {
      var tr = JSON.parse(localStorage.getItem(LS.trash));
      if (Array.isArray(tr)) s.trash = tr;
    } catch (e) {}
    s.ui.sel = {};
    s.settings.showSecrets = false;
    if (!s.fees.length) s.fees = Core.DEFAULT_FEES.slice();
  }

  /* =====================================================================
   * 계산 · 판정
   * ===================================================================== */
  function ctx() {
    return { fees: App.state.fees, ollaRate: App.state.settings.ollaRate };
  }
  function recompute(o) {
    Core.computeOrder(o, ctx());
    o._risk = Core.checkBlacklist(o, App.state.blacklist);
    o._step = Core.stepOf(o);
    return o;
  }
  function recomputeAll() {
    App.state.orders.forEach(recompute);
  }
  App.recompute = recompute; App.recomputeAll = recomputeAll;

  function riskOrders() {
    return App.state.orders.filter(function (o) { return o._risk && o._risk.level; });
  }
  App.riskOrders = riskOrders;

  function blankOrder() {
    var o = { id: uid("o"), memoLog: [] };
    Core.ORDER_COLUMNS.forEach(function (c) {
      o[c.key] = (c.type === "money" || c.type === "int") ? "" : "";
    });
    o.qty = 1;
    o.siteName = "쿠팡(신)";
    o.collectedAt = nowStr();
    var d = App.state.settings.defaults;
    o.manager = d.manager; o.vendor = d.vendor; o.vendorAccount = d.vendorAccount; o.cardName = d.cardName;
    return recompute(o);
  }
  App.blankOrder = blankOrder;

  /* ---------- 집계 ---------- */
  function statsFor(list) {
    var out = { count: 0, revenue: 0, margin: 0, point: 0, cost: 0, ready: 0 };
    list.forEach(function (o) {
      out.count++;
      out.revenue += toNum(o.revenue || o.salePrice);
      out.cost += toNum(o.buyAmount);
      out.point += toNum(o.point);
      if (o.netMargin != null) { out.margin += o.netMargin; out.ready++; }
    });
    out.rate = out.revenue ? out.margin / out.revenue : null;
    return out;
  }
  App.statsFor = statsFor;

  function dateKey(o) { return Core.dateOnly(o.saleDate || o.orderedAt || o.collectedAt); }
  App.dateKey = dateKey;

  function dailySeries(days) {
    var map = {};
    App.state.orders.forEach(function (o) {
      var d = dateKey(o);
      if (!d) return;
      if (!map[d]) map[d] = { count: 0, revenue: 0, margin: 0, point: 0 };
      map[d].count++;
      map[d].revenue += toNum(o.revenue || o.salePrice);
      map[d].margin += toNum(o.netMargin);
      map[d].point += toNum(o.point);
    });
    // 워크북 DAY 시트의 과거 실적은 주문 데이터가 없는 날짜만 보존
    Object.keys(App.state.history.daily || {}).forEach(function (d) {
      if (!map[d]) map[d] = App.state.history.daily[d];
    });
    var out = [], base = new Date();
    for (var i = days - 1; i >= 0; i--) {
      var dt = new Date(base.getFullYear(), base.getMonth(), base.getDate() - i);
      var key = dt.getFullYear() + "-" + ("0" + (dt.getMonth() + 1)).slice(-2) + "-" + ("0" + dt.getDate()).slice(-2);
      out.push(Object.assign({ date: key, count: 0, revenue: 0, margin: 0, point: 0 }, map[key] || {}));
    }
    return out;
  }
  App.dailySeries = dailySeries;

  function monthlySeries() {
    var map = {};
    App.state.orders.forEach(function (o) {
      var d = dateKey(o);
      if (!d) return;
      var m = d.slice(0, 7);
      if (!map[m]) map[m] = { count: 0, revenue: 0, margin: 0, point: 0, cost: 0 };
      map[m].count++;
      map[m].revenue += toNum(o.revenue || o.salePrice);
      map[m].margin += toNum(o.netMargin);
      map[m].point += toNum(o.point);
      map[m].cost += toNum(o.buyAmount);
    });
    Object.keys(App.state.history.monthly || {}).forEach(function (m) {
      if (!map[m]) map[m] = App.state.history.monthly[m];
    });
    return Object.keys(map).sort().map(function (m) {
      return Object.assign({ month: m }, map[m]);
    });
  }
  App.monthlySeries = monthlySeries;

  function groupBy(list, key) {
    var map = {};
    list.forEach(function (o) {
      var k = String(o[key] == null ? "" : o[key]).trim() || "(미지정)";
      if (!map[k]) map[k] = [];
      map[k].push(o);
    });
    return Object.keys(map).map(function (k) {
      var st = statsFor(map[k]);
      st.key = k;
      return st;
    }).sort(function (a, b) { return b.margin - a.margin; });
  }
  App.groupBy = groupBy;

  /* =====================================================================
   * 탭
   * ===================================================================== */
  var TABS = [
    { key: "dashboard", label: "대시보드" },
    { key: "orders", label: "주문관리" },
    { key: "cs", label: "CS" },
    { key: "invoice", label: "송장" },
    { key: "blacklist", label: "블랙리스트" },
    { key: "stock", label: "사입" },
    { key: "fees", label: "수수료" },
    { key: "secrets", label: "계정·카드" }
  ];
  App.TABS = TABS;

  function tabBadge(key) {
    var s = App.state;
    if (key === "orders") {
      var pending = s.orders.filter(function (o) { return o._step === "new"; }).length;
      return pending ? { text: pending, alert: false } : null;
    }
    if (key === "blacklist") {
      var risk = riskOrders().length;
      return risk ? { text: risk, alert: true } : null;
    }
    if (key === "cs") {
      var open = s.cs.filter(function (c) { return c.status && c.status !== "완료"; }).length;
      return open ? { text: open, alert: false } : null;
    }
    if (key === "invoice") {
      var wait = s.orders.filter(function (o) { return o._step === "ordered"; }).length;
      return wait ? { text: wait, alert: false } : null;
    }
    return null;
  }

  function renderTabs() {
    var nav = $("#tabnav");
    var active = App.state.ui.tab;
    nav.innerHTML = TABS.map(function (t) {
      var b = tabBadge(t.key);
      return '<button class="tab' + (t.key === active ? " on" : "") + (b && b.alert ? " alert" : "") +
        '" data-tab="' + t.key + '">' + esc(t.label) +
        (b ? "<b>" + esc(b.text) + "</b>" : "") + "</button>";
    }).join("");
  }

  App.views = App.views || {};

  function render() {
    renderTabs();
    updateTopbar();
    var tab = App.state.ui.tab;
    var pane = $("#pane");
    var fn = App.views[tab];
    pane.innerHTML = fn ? fn() : '<div class="empty"><h3>준비 중</h3><p>이 탭은 아직 없습니다.</p></div>';
    if (App.afterRender && App.afterRender[tab]) App.afterRender[tab]();
  }
  App.render = render;

  function updateTopbar() {
    var risk = riskOrders().length;
    var pill = $("#risk-pill");
    pill.textContent = risk ? "위험 " + risk + "건" : "위험 0";
    pill.className = "pill" + (risk ? " danger" : "");
    $("#local-pill").textContent = App.state.orders.length ? "주문 " + App.state.orders.length + "건 · 로컬 저장" : "로컬 저장";
  }

  /* =====================================================================
   * 대시보드
   * ===================================================================== */
  function kpi(k, v, cls, d) {
    return '<div class="kpi"><div class="k">' + esc(k) + '</div><div class="v ' + (cls || "") + '">' +
      v + "</div>" + (d ? '<div class="d">' + esc(d) + "</div>" : "") + "</div>";
  }
  function kpiLink(k, v, cls, d, tab, filter) {
    return '<div class="kpi clickable' + (cls === "alert" ? " alert" : "") + '" data-go-tab="' + tab +
      '" data-go-filter="' + (filter || "") + '"><div class="k">' + esc(k) + '</div><div class="v ' +
      (cls === "alert" ? "" : cls || "") + '">' + v + "</div>" +
      (d ? '<div class="d">' + esc(d) + "</div>" : "") + "</div>";
  }
  App.kpi = kpi;

  function barChart(series, valueKey, title, caption) {
    var max = 0;
    series.forEach(function (d) { max = Math.max(max, Math.abs(d[valueKey] || 0)); });
    var bars = series.map(function (d) {
      var h = max ? Math.max(2, Math.round(Math.abs(d[valueKey] || 0) / max * 100)) : 2;
      var label = d.date ? d.date.slice(5) : d.month;
      return '<div class="bar" title="' + esc(label) + " · " + comma(d[valueKey]) + '">' +
        '<em style="height:' + h + '%"></em></div>';
    }).join("");
    var first = series[0] ? (series[0].date || series[0].month) : "";
    var last = series[series.length - 1] ? (series[series.length - 1].date || series[series.length - 1].month) : "";
    return '<div class="chart-wrap"><h3>' + esc(title) + "</h3><p class=\"cap\">" + esc(caption || "") + "</p>" +
      '<div class="bars">' + bars + "</div>" +
      '<div class="chart-axis"><span>' + esc(first) + "</span><span>최대 " + comma(max) + "</span><span>" + esc(last) + "</span></div></div>";
  }

  App.views.dashboard = function () { return renderDashboard(); };

  function renderDashboard() {
    var s = App.state;
    if (!s.orders.length) {
      return '<div class="empty"><h3>아직 주문 데이터가 없습니다</h3>' +
        "<p>쓰던 엑셀 워크북을 그대로 올리면 주문서 · 블랙리스트 · 수수료 · CS · 사입 · 계정까지 한 번에 들어옵니다.</p>" +
        '<button class="btn primary" id="empty-import">파일 불러오기</button></div>';
    }
    var today = todayStr();
    var month = today.slice(0, 7);
    var todayList = s.orders.filter(function (o) { return dateKey(o) === today; });
    var monthList = s.orders.filter(function (o) { return (dateKey(o) || "").slice(0, 7) === month; });
    var all = statsFor(s.orders), td = statsFor(todayList), mo = statsFor(monthList);

    var pendingN = s.orders.filter(function (o) { return o._step === "new"; }).length;
    var invoiceWait = s.orders.filter(function (o) { return o._step === "ordered"; }).length;
    var uploadWait = s.orders.filter(function (o) { return o._step === "invoiced"; }).length;
    var riskN = riskOrders().length;
    var lossN = s.orders.filter(function (o) { return o.netMargin != null && o.netMargin < 0; }).length;
    var noMargin = s.orders.filter(function (o) { return o.netMargin == null; }).length;
    var csOpen = s.cs.filter(function (c) { return c.status && c.status !== "완료"; }).length;

    var html = "";

    if (riskN) {
      html += '<div class="banner risk"><span class="tag">주문 처리 위험</span>' +
        "<b>블랙리스트와 일치하는 주문이 " + riskN + "건 있습니다.</b> 발송 전에 반드시 확인하세요." +
        '<div class="spacer"></div><button class="btn danger sm" data-go-tab="orders" data-go-filter="risk">확인하러 가기</button></div>';
    }
    if (noMargin) {
      html += '<div class="banner warn"><span class="tag">계산 대기</span>' +
        "구매금액 또는 카테고리가 비어 순마진을 못 구한 주문이 " + noMargin + "건 있습니다." +
        '<div class="spacer"></div><button class="btn sm" data-go-tab="orders" data-go-filter="nomargin">채우러 가기</button></div>';
    }

    html += '<div class="kpi-grid">' +
      kpi("오늘 매출", won(td.revenue), "", td.count + "건") +
      kpi("오늘 순마진", won(td.margin), td.margin >= 0 ? "pos" : "neg", "마진률 " + pct(td.rate)) +
      kpi("이번달 매출", won(mo.revenue), "", mo.count + "건") +
      kpi("이번달 순마진", won(mo.margin), mo.margin >= 0 ? "pos" : "neg", "마진률 " + pct(mo.rate)) +
      kpi("누적 순마진", won(all.margin), all.margin >= 0 ? "pos" : "neg", "마진률 " + pct(all.rate)) +
      kpi("이번달 포인트", won(mo.point), "brand", "카드 적립 포함") +
      "</div>";

    html += '<div class="kpi-grid">' +
      kpiLink("발주 대기", pendingN + "건", pendingN ? "brand" : "", "주문여부 미표시", "orders", "new") +
      kpiLink("송장 대기", invoiceWait + "건", "", "발주는 끝난 건", "orders", "ordered") +
      kpiLink("업로드 대기", uploadWait + "건", "", "송장은 입력됨", "invoice", "") +
      kpiLink("블랙리스트 위험", riskN + "건", riskN ? "alert" : "", "이름·주소 일치", "orders", "risk") +
      kpiLink("역마진", lossN + "건", lossN ? "alert" : "", "순마진 0원 미만", "orders", "loss") +
      kpiLink("CS 진행중", csOpen + "건", csOpen ? "brand" : "", "미완료 건", "cs", "") +
      "</div>";

    var days = parseInt(s.ui.dashRange, 10) || 30;
    var series = dailySeries(days);
    html += '<div class="split-2">' +
      barChart(series, "revenue", "일별 매출", "최근 " + days + "일") +
      barChart(series, "margin", "일별 순마진", "최근 " + days + "일") +
      "</div>";

    // 일별 표
    var recent = series.slice().reverse().filter(function (d) { return d.count || d.revenue; }).slice(0, 14);
    var monthly = monthlySeries().slice(-14).reverse();

    html += '<div class="split-2">';
    html += '<div class="panel"><div class="panel-head"><h2>일별</h2><div class="spacer"></div>' +
      '<div class="seg" data-dash-range><button data-range="14"' + (days === 14 ? ' class="on"' : "") + ">14일</button>" +
      '<button data-range="30"' + (days === 30 ? ' class="on"' : "") + ">30일</button>" +
      '<button data-range="90"' + (days === 90 ? ' class="on"' : "") + ">90일</button></div></div>" +
      '<div class="data-scroll" style="max-height:320px"><table class="data"><thead><tr>' +
      "<th>날짜</th><th class=\"num\">건수</th><th class=\"num\">매출</th><th class=\"num\">순마진</th><th class=\"num\">마진률</th></tr></thead><tbody>" +
      (recent.length ? recent.map(function (d) {
        var r = d.revenue ? d.margin / d.revenue : null;
        return "<tr><td>" + esc(d.date) + '</td><td class="num">' + comma(d.count) +
          '</td><td class="num">' + comma(d.revenue) + '</td><td class="num ' + (d.margin < 0 ? "neg" : "pos") + '">' +
          comma(d.margin) + '</td><td class="num">' + pct(r) + "</td></tr>";
      }).join("") : '<tr><td colspan="5" class="muted">기간 내 매출이 없습니다.</td></tr>') +
      "</tbody></table></div></div>";

    html += '<div class="panel"><div class="panel-head"><h2>월별</h2></div>' +
      '<div class="data-scroll" style="max-height:320px"><table class="data"><thead><tr>' +
      "<th>월</th><th class=\"num\">건수</th><th class=\"num\">매출</th><th class=\"num\">순마진</th>" +
      "<th class=\"num\">포인트</th><th class=\"num\">마진률</th></tr></thead><tbody>" +
      (monthly.length ? monthly.map(function (d) {
        var r = d.revenue ? d.margin / d.revenue : null;
        return "<tr><td>" + esc(d.month) + '</td><td class="num">' + comma(d.count) +
          '</td><td class="num">' + comma(d.revenue) + '</td><td class="num ' + (d.margin < 0 ? "neg" : "pos") + '">' +
          comma(d.margin) + '</td><td class="num">' + comma(d.point) + '</td><td class="num">' + pct(r) + "</td></tr>";
      }).join("") : '<tr><td colspan="6" class="muted">월별 데이터가 없습니다.</td></tr>') +
      "</tbody></table></div></div>";
    html += "</div>";

    // 구매처 / 담당자 / 카테고리
    html += '<div class="split-3">' +
      breakdownPanel("구매처별", groupBy(s.orders, "vendor")) +
      breakdownPanel("담당자별", groupBy(s.orders, "manager")) +
      breakdownPanel("카테고리별", groupBy(s.orders, "category")) +
      "</div>";

    return html;
  }

  function breakdownPanel(title, rows) {
    return '<div class="panel"><div class="panel-head"><h2>' + esc(title) + "</h2></div>" +
      '<div class="data-scroll" style="max-height:280px"><table class="data"><thead><tr><th>구분</th>' +
      '<th class="num">건수</th><th class="num">매출</th><th class="num">순마진</th><th class="num">마진률</th></tr></thead><tbody>' +
      (rows.length ? rows.slice(0, 12).map(function (r) {
        return "<tr><td>" + esc(r.key) + '</td><td class="num">' + comma(r.count) +
          '</td><td class="num">' + comma(r.revenue) + '</td><td class="num ' + (r.margin < 0 ? "neg" : "pos") + '">' +
          comma(r.margin) + '</td><td class="num">' + pct(r.rate) + "</td></tr>";
      }).join("") : '<tr><td colspan="5" class="muted">데이터 없음</td></tr>') +
      "</tbody></table></div></div>";
  }

  /* =====================================================================
   * 파일 불러오기
   * ===================================================================== */
  function handleFile(file) {
    if (!file) return;
    var name = String(file.name || "");
    toast(name + " 읽는 중...");
    if (/\.csv$/i.test(name)) {
      var fr = new FileReader();
      fr.onload = function (e) { mergeOrders(Importer.fromPaste(String(e.target.result)), "CSV"); };
      fr.readAsText(file, "utf-8");
      return;
    }
    var fr2 = new FileReader();
    fr2.onload = function (e) {
      Xlsx.read(e.target.result).then(function (wb) {
        var data = Importer.fromWorkbook(wb);
        if (!data.found.length) { toast("가져올 수 있는 시트를 찾지 못했습니다"); return; }
        applyImport(data);
      }).catch(function (err) {
        toast("파일을 읽지 못했습니다: " + (err.message || ""));
      });
    };
    fr2.readAsArrayBuffer(file);
  }
  App.handleFile = handleFile;

  function applyImport(data) {
    var s = App.state;
    var lines = [];
    if (data.fees && data.fees.length) { s.fees = data.fees; lines.push("수수료 " + data.fees.length + "행"); }
    if (data.blacklist && data.blacklist.length) {
      s.blacklist = mergeBlacklist(s.blacklist, data.blacklist);
      lines.push("블랙리스트 " + data.blacklist.length + "건");
    }
    if (data.cs && data.cs.length) { s.cs = data.cs; lines.push("CS " + data.cs.length + "건"); }
    if (data.stock && data.stock.length) { s.stock = data.stock; lines.push("사입 " + data.stock.length + "건"); }
    if (data.invoiceList && data.invoiceList.length) {
      s.invoiceList = data.invoiceList;
      lines.push("송장목록 " + data.invoiceList.length + "건");
    }
    if (data.accounts && data.accounts.length) { s.accounts = data.accounts; lines.push("계정 " + data.accounts.length + "건"); }
    if (data.cards && data.cards.length) { s.cards = data.cards; }
    if (data.history) s.history = data.history;
    if (data.orders && data.orders.length) {
      mergeOrders(data.orders, null, true);
      lines.push("주문 " + data.orders.length + "건");
    }
    applyInvoiceList();
    recomputeAll();
    persist();
    render();
    toast("가져오기 완료 — " + lines.join(" · "));
    var risk = riskOrders().length;
    if (risk) showRiskModal();
  }
  App.applyImport = applyImport;

  function mergeBlacklist(cur, incoming) {
    var out = cur.slice(), seen = {};
    out.forEach(function (b) { seen[Core.norm(b.name) + "|" + Core.norm(b.address)] = 1; });
    incoming.forEach(function (b) {
      var k = Core.norm(b.name) + "|" + Core.norm(b.address);
      if (seen[k]) return;
      seen[k] = 1;
      out.push(b);
    });
    return out;
  }

  // 같은 주문(판매사이트 주문번호 + 상품명)은 덮어쓰지 않고 비어있는 칸만 채웁니다.
  function orderKey(o) {
    return Core.norm(o.siteOrderNo || o.uniqueNo) + "|" + Core.norm(o.productName) + "|" + Core.norm(o.optionText);
  }
  function mergeOrders(list, label, silent) {
    if (!list || !list.length) { if (!silent) toast("가져올 주문이 없습니다"); return; }
    var s = App.state, index = {};
    s.orders.forEach(function (o) { index[orderKey(o)] = o; });
    var added = 0, updated = 0;
    list.forEach(function (n) {
      var k = orderKey(n);
      var cur = index[k];
      if (!cur) {
        n.id = n.id || uid("o");
        n.memoLog = n.memoLog || [];
        s.orders.push(n);
        index[k] = n;
        added++;
        return;
      }
      var touched = false;
      Core.ORDER_COLUMNS.forEach(function (c) {
        if (c.kind === "calc") return;
        var v = n[c.key];
        if (v === "" || v === null || v === undefined) return;
        if (cur[c.key] === "" || cur[c.key] === null || cur[c.key] === undefined) { cur[c.key] = v; touched = true; }
      });
      if (touched) updated++;
    });
    recomputeAll();
    if (!silent) {
      persist(); render();
      toast((label ? label + " — " : "") + "새 주문 " + added + "건" + (updated ? " · 보완 " + updated + "건" : ""));
    }
  }
  App.mergeOrders = mergeOrders;

  // 송장업로드 목록 ↔ 주문 대조
  function applyInvoiceList() {
    var s = App.state;
    if (!s.invoiceList.length) return 0;
    var map = {};
    s.invoiceList.forEach(function (v) {
      var k = String(v.uniqueNo || "").replace(/\s/g, "");
      if (k) map[k] = v;
    });
    var n = 0;
    s.orders.forEach(function (o) {
      var k = String(o.uniqueNo || "").replace(/\s/g, "");
      if (!k || !map[k]) return;
      var v = map[k];
      if (v.invoiceNo && !o.invoiceNo) o.invoiceNo = v.invoiceNo;
      if (v.courierCode && !o.courierCode) o.courierCode = v.courierCode;
      if (o.invoiceUploaded !== "완료") { o.invoiceUploaded = "완료"; n++; }
    });
    return n;
  }
  App.applyInvoiceList = applyInvoiceList;

  function showRiskModal() {
    var list = riskOrders();
    if (!list.length) { toast("블랙리스트에 걸린 주문이 없습니다"); return; }
    var body = '<div class="banner risk" style="margin-bottom:14px"><span class="tag">주문 처리 위험</span>' +
      "<b>" + list.length + "건</b>이 블랙리스트와 일치합니다. 발송 전에 확인하세요.</div>" +
      '<div class="data-scroll"><table class="data"><thead><tr><th>수령자</th><th>주소</th><th>상품</th><th>사유</th></tr></thead><tbody>' +
      list.slice(0, 60).map(function (o) {
        return '<tr class="risk-row"><td>' + esc(o.recipient) + "</td><td class=\"wrap\">" + esc(o.address) +
          '</td><td class="wrap">' + esc(o.productName) + "</td><td>" +
          '<span class="chip ' + (o._risk.level === "danger" ? "bad" : "warn") + '">' +
          (o._risk.level === "danger" ? "위험" : "주의") + "</span> " + esc(o._risk.reasons.join(" / ")) + "</td></tr>";
      }).join("") + "</tbody></table></div>";
    openModal({
      title: "블랙리스트 경고", body: body, wide: true,
      foot: '<button class="btn" data-close>닫기</button>' +
        '<button class="btn primary" data-go-tab="orders" data-go-filter="risk" data-close>주문관리에서 보기</button>'
    });
  }
  App.showRiskModal = showRiskModal;

  /* =====================================================================
   * 내보내기
   * ===================================================================== */
  function exportTemplate() {
    var s = App.state;
    var year = new Date().getFullYear();
    for (var i = 0; i < s.orders.length; i++) {
      var d = dateKey(s.orders[i]);
      if (d) { year = parseInt(d.slice(0, 4), 10); break; }
    }
    try {
      var blob = Template.buildBlob({
        year: year, orders: s.orders, blacklist: s.blacklist, fees: s.fees,
        cs: s.cs, stock: s.stock, invoiceList: s.invoiceList,
        accounts: s.accounts, cards: s.cards
      });
      downloadBlob(blob, "우루루_통합_주문관리_" + todayStr().replace(/-/g, "") + ".xlsx");
      toast("엑셀 양식을 내려받았습니다 (수식·드롭다운·경고 포함)");
    } catch (e) {
      toast("엑셀 생성 실패: " + (e.message || ""));
    }
  }
  App.exportTemplate = exportTemplate;

  // 쿠팡 Wing 송장 업로드 양식(39열)
  var INVOICE_HEADERS = ["번호", "묶음배송번호", "주문번호", "택배사", "운송장번호", "분리배송 Y/N", "분리배송 출고예정일",
    "주문시 출고예정일", "출고일(발송일)", "주문일", "등록상품명", "등록옵션명", "노출상품명(옵션명)", "노출상품ID",
    "옵션ID", "최초등록옵션명", "업체상품코드", "바코드", "결제액", "배송비구분", "배송비", "도서산간 추가배송비",
    "구매수(수량)", "옵션판매가(판매단가)", "구매자", "구매자전화번호", "수취인이름", "수취인전화번호", "우편번호",
    "수취인 주소", "배송메세지", "상품별 추가메시지", "주문자 추가메시지", "배송완료일", "구매확정일자",
    "개인통관번호(PCCC)", "통관용구매자전화번호", "기타", "결제위치"];

  function sanitizeCell(v) {
    if (typeof v !== "string") return v;
    var s = v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
    return /^[=+\-@]/.test(s) ? "'" + s : s;
  }

  function exportCoupangInvoice() {
    var list = App.state.orders.filter(function (o) {
      return o.invoiceNo && o.courierCode && o._step !== "uploaded";
    });
    if (!list.length) {
      list = App.state.orders.filter(function (o) { return o.invoiceNo && o.courierCode; });
    }
    if (!list.length) { toast("송장번호가 입력된 주문이 없습니다"); return; }
    var rows = [INVOICE_HEADERS.slice()];
    list.forEach(function (o, i) {
      var cour = Core.courierByCode(o.courierCode);
      var r = new Array(INVOICE_HEADERS.length).fill("");
      r[0] = i + 1;
      r[1] = o.uniqueNo || "";
      r[2] = o.settleOrderNo || o.siteOrderNo || "";
      r[3] = cour ? cour.name : (o.courierCode || "");
      r[4] = o.invoiceNo || "";
      r[9] = Core.dateOnly(o.orderedAt) || "";
      r[10] = o.productName || "";
      r[11] = o.optionText || "";
      r[13] = o.siteProductCode || "";
      r[16] = o.sellerProductCode || "";
      r[18] = toNum(o.salePrice);
      r[22] = o.qty || 1;
      r[24] = o.buyerName || "";
      r[26] = o.recipient || "";
      r[27] = o.recvPhone || o.recvTel || "";
      r[28] = o.zipcode || "";
      r[29] = o.address || "";
      r[30] = o.deliveryMemo || "";
      rows.push(r.map(sanitizeCell));
    });
    downloadBlob(Xlsx.write([{ name: "송장업로드", rows: rows }]),
      "쿠팡_송장업로드_" + todayStr().replace(/-/g, "") + ".xlsx");
    toast(list.length + "건의 송장 업로드 파일을 만들었습니다");
  }
  App.exportCoupangInvoice = exportCoupangInvoice;

  function exportBackup() {
    var s = App.state;
    var data = {
      version: 2, savedAt: new Date().toISOString(),
      orders: s.orders, blacklist: s.blacklist, fees: s.fees, cs: s.cs,
      stock: s.stock, invoiceList: s.invoiceList, history: s.history, settings: s.settings
      // 계정·카드는 백업에 포함하지 않습니다(민감정보).
    };
    downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
      "우루루_백업_" + todayStr().replace(/-/g, "") + ".json");
    toast("백업 파일을 내려받았습니다 (계정·카드 제외)");
  }
  App.exportBackup = exportBackup;

  function importBackup(file) {
    var fr = new FileReader();
    fr.onload = function (e) {
      try {
        var d = JSON.parse(String(e.target.result));
        var s = App.state;
        if (d.orders) s.orders = d.orders;
        if (d.blacklist) s.blacklist = d.blacklist;
        if (d.fees) s.fees = d.fees;
        if (d.cs) s.cs = d.cs;
        if (d.stock) s.stock = d.stock;
        if (d.invoiceList) s.invoiceList = d.invoiceList;
        if (d.history) s.history = d.history;
        if (d.settings) s.settings = Object.assign(s.settings, d.settings);
        recomputeAll(); persist(); render();
        toast("백업을 복원했습니다");
      } catch (err) { toast("백업 파일을 읽지 못했습니다"); }
    };
    fr.readAsText(file, "utf-8");
  }
  App.importBackup = importBackup;

  /* =====================================================================
   * 설정
   * ===================================================================== */
  function openSettings() {
    var s = App.state.settings;
    var body =
      '<div class="set-sec"><h3>자동입력 기본값</h3>' +
      '<p class="d">주문관리에서 [발주완료]를 누를 때 자동으로 채워지는 값입니다. 매번 같은 값을 치지 않아도 됩니다.</p>' +
      '<div class="grid-2">' +
      field("담당자", "set-manager", s.defaults.manager) +
      field("구매처", "set-vendor", s.defaults.vendor) +
      field("계정", "set-account", s.defaults.vendorAccount) +
      field("카드", "set-card", s.defaults.cardName) +
      "</div></div>" +

      '<div class="set-sec"><h3>배송지 복사에 쓸 내 번호</h3>' +
      '<p class="d">구매처에 고객 번호가 그대로 넘어가지 않도록, 배송지 복사에는 이 번호가 들어갑니다. ' +
      "비워두면 고객 번호가 그대로 복사되니 반드시 넣어두세요.</p>" +
      field("내 전화번호", "set-phone", s.myPhone, "010-0000-0000") + "</div>" +

      '<div class="set-sec"><h3>계산 기준</h3>' +
      '<p class="d">순마진 = (판매가×(1−수수료율VAT) + 배송비순액 − 구매금액 − 에누리) ÷ 1.1 — 워크북과 같은 식입니다.</p>' +
      '<div class="grid-2">' +
      field("올라수수료율 (%)", "set-olla", (s.ollaRate * 100).toFixed(2)) +
      '<div class="field"><label>카테고리 자동 추정</label><select id="set-autocat">' +
      '<option value="1"' + (s.autoCategory ? " selected" : "") + ">상품명으로 자동 추정</option>" +
      '<option value="0"' + (!s.autoCategory ? " selected" : "") + ">직접 입력만</option></select>" +
      '<div class="hint">추정된 카테고리로 수수료율이 자동 적용됩니다.</div></div>' +
      "</div></div>" +

      '<div class="set-sec"><h3>데이터</h3>' +
      '<p class="d">모든 데이터는 이 브라우저에만 저장됩니다. 컴퓨터를 바꾸거나 캐시를 지우기 전에 백업하세요.</p>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
      '<button class="btn" id="set-backup">백업 내려받기</button>' +
      '<button class="btn" id="set-restore">백업 복원</button>' +
      '<button class="btn" id="set-excel">엑셀 양식 내려받기</button>' +
      '<button class="btn danger" id="set-reset">전체 삭제</button>' +
      "</div>" +
      '<p class="d mt-14">계정·카드 정보는 백업 파일에 들어가지 않습니다. 필요하면 계정·카드 탭에서 따로 관리하세요.</p></div>';

    openModal({
      title: "설정", body: body,
      foot: '<button class="btn" data-close>닫기</button><button class="btn primary" data-ok>저장</button>',
      onOpen: function (bg, close) {
        bg.querySelector("#set-backup").onclick = exportBackup;
        bg.querySelector("#set-excel").onclick = exportTemplate;
        bg.querySelector("#set-restore").onclick = function () {
          var inp = document.createElement("input");
          inp.type = "file"; inp.accept = ".json";
          inp.onchange = function () { if (inp.files[0]) { importBackup(inp.files[0]); close(); } };
          inp.click();
        };
        bg.querySelector("#set-reset").onclick = function () {
          confirmBox({
            title: "전체 삭제", danger: true, okLabel: "삭제",
            body: "주문·블랙리스트·CS·계정 등 이 브라우저에 저장된 모든 데이터를 지웁니다. 되돌릴 수 없습니다."
          }, function () {
            Object.keys(LS).forEach(function (k) { localStorage.removeItem(LS[k]); });
            location.reload();
          });
        };
      },
      onOk: function (bg) {
        var st = App.state.settings;
        st.defaults.manager = bg.querySelector("#set-manager").value.trim();
        st.defaults.vendor = bg.querySelector("#set-vendor").value.trim();
        st.defaults.vendorAccount = bg.querySelector("#set-account").value.trim();
        st.defaults.cardName = bg.querySelector("#set-card").value.trim();
        st.myPhone = bg.querySelector("#set-phone").value.trim();
        var olla = parseFloat(bg.querySelector("#set-olla").value);
        st.ollaRate = isFinite(olla) ? olla / 100 : Core.OLLA_RATE;
        st.autoCategory = bg.querySelector("#set-autocat").value === "1";
        recomputeAll(); persist(); render();
        toast("설정을 저장했습니다");
      }
    });
  }
  App.openSettings = openSettings;

  function field(label, id, value, ph) {
    return '<div class="field"><label>' + esc(label) + '</label><input type="text" id="' + id +
      '" value="' + esc(value || "") + '" placeholder="' + esc(ph || "") + '"></div>';
  }
  App.field = field;

  /* =====================================================================
   * 초기화
   * ===================================================================== */
  function init() {
    restore();
    recomputeAll();
    render();

    $("#btn-settings").onclick = openSettings;
    $("#btn-excel").onclick = exportTemplate;
    $("#btn-import").onclick = function () { $("#file-input").click(); };
    $("#file-input").onchange = function (e) {
      if (e.target.files && e.target.files[0]) handleFile(e.target.files[0]);
      e.target.value = "";
    };
    $("#risk-pill").onclick = showRiskModal;

    $("#tabnav").addEventListener("click", function (e) {
      var b = e.target.closest("[data-tab]");
      if (!b) return;
      App.state.ui.tab = b.getAttribute("data-tab");
      App.state.ui.sel = {};
      persist(); render();
    });

    // 화면 어디서든 통하는 이동 버튼
    document.addEventListener("click", function (e) {
      var go = e.target.closest("[data-go-tab]");
      if (go) {
        App.state.ui.tab = go.getAttribute("data-go-tab");
        var f = go.getAttribute("data-go-filter");
        if (f) App.state.ui.filter = f;
        persist(); render();
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
      if (e.target.id === "empty-import") $("#file-input").click();
      var range = e.target.closest("[data-dash-range] [data-range]");
      if (range) {
        App.state.ui.dashRange = range.getAttribute("data-range");
        persist(); render();
      }
    });

    // 파일 끌어놓기
    ["dragover", "drop"].forEach(function (ev) {
      document.addEventListener(ev, function (e) {
        e.preventDefault();
        if (ev === "drop" && e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
          handleFile(e.dataTransfer.files[0]);
        }
      });
    });

    if (App.initViews) App.initViews();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})(window);
