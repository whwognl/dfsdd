/* =====================================================================
 * app.js — 반자동 주문 보조 도구
 * 파싱 · 카테고리 자동분류 · 마진계산 · 주문시트 UI · 상태저장 · 내보내기
 *
 * 원칙: 이 도구는 "정리·계산"만 합니다.
 *   - 외부 서버/API 호출 없음 (모든 처리는 브라우저 안에서)
 *   - 자동 로그인/자동 결제/매크로 없음
 *   - 소싱링크는 새 탭으로 "열기"만, 구매는 사용자가 직접
 * ===================================================================== */
(function () {
  "use strict";

  /* ---------- 저장 키 ---------- */
  var LS = {
    orders: "oh_orders_v1",   // 현재 화면의 주문 목록(새로고침 유지)
    states: "oh_states_v1",   // 주문별 진행상태(재업로드 시 복원)
    rules:  "oh_rules_v1",    // 사용자 수정 규칙
    ui:     "oh_ui_v1",       // 정렬/필터 등 UI 상태
    deleted:"oh_deleted_v1",   // 삭제한 행 복구 스택
    cloud:  "oh_cloud_v1",    // 구글시트 연동 설정(선택)
    ops:    "oh_ops_v1",      // 라인업/매입처/일지/계정/카드 등 엑셀 보조 탭
    sourcingMap: "oh_sourcing_map_v1"  // 소싱 매핑표 (새로고침 유지)
  };

  /* ---------- 헤더(열) 별칭: 이름이 조금 달라도 매핑 ----------
   * 기준 소스 양식 = 주문 수집 프로그램의 36열 파일(수집일 … 송장번호).
   * 쿠팡 발주서(노출상품ID·수취인이름 …) 별칭도 함께 두어 예전 파일도 그대로 올릴 수 있습니다.
   * 별칭은 앞에 있을수록 우선. autoMap 은 "정확일치 → 부분포함" 두 단계이고, 한 번 쓴 헤더는 다른 항목이 못 가져갑니다.
   * ------------------------------------------------------------- */
  var FIELDS = [
    { key:"orderDate",      label:"주문일",         req:false, aliases:["주문일","주문일자","주문일시","주문시각","결제일"] },
    { key:"orderNumber",    label:"주문번호",       req:true,  aliases:["판매사이트 주문번호","판매사이트주문번호","주문번호","주문 번호","묶음배송번호"] },
    { key:"productId",      label:"상품코드",       req:false, aliases:["판매사이트 상품코드","판매사이트상품코드","노출상품ID","노출상품아이디","노출 상품ID","상품ID","옵션ID","등록상품ID","마스터상품코드"] },
    { key:"productName",    label:"상품명",         req:true,  aliases:["상품명","등록상품명","노출상품명","제품명","노출 상품명"] },
    { key:"option",         label:"옵션",           req:false, aliases:["주문선택사항","등록옵션명","옵션명","옵션","구매옵션","업체상품옵션코드"] },
    { key:"quantity",       label:"수량",           req:false, aliases:["주문수량","구매수(수량)","구매수량","구매수","수량"] },
    { key:"paymentAmount",  label:"판매가(결제액)", req:false, aliases:["판매가","결제액","결제금액","총결제금액","주문금액","상품금액"] },
    { key:"recipient",      label:"수령자명",       req:false, aliases:["수령자명","수취인이름","수취인 이름","수취인","수령인","받는분","받는사람"] },
    { key:"phone",          label:"연락처",         req:false, aliases:["수령자휴대폰번호","수취인전화번호","수취인 전화번호","수령자전화번호","전화번호","연락처","휴대폰","전화"] },
    { key:"phone2",         label:"연락처(예비)",   req:false, aliases:["수령자전화번호","전화번호(예비)"] },
    { key:"zipcode",        label:"우편번호",       req:false, aliases:["배송지우편번호","우편번호","우편 번호"] },
    { key:"address",        label:"주소",           req:false, aliases:["배송지주소","수취인 주소","수취인주소","배송지","주소","수령지주소"] },
    /* --- 새 소스 양식에만 있는 열 --- */
    { key:"collectedAt",    label:"수집일",         req:false, aliases:["수집일","수집일시"] },
    { key:"site",           label:"판매사이트",     req:false, aliases:["판매사이트명","판매사이트","판매처","마켓"] },
    { key:"sellerId",       label:"판매자ID",       req:false, aliases:["판매자ID","판매자아이디","판매아이디"] },
    { key:"shipFee",        label:"배송비",         req:false, aliases:["배송비금액","배송비"] },
    { key:"masterCode",     label:"마스터상품코드", req:false, aliases:["마스터상품코드","플토코드"] },
    { key:"sellerCode",     label:"판매자상품코드", req:false, aliases:["판매자상품코드","업체상품코드"] },
    { key:"discount",       label:"에누리",         req:false, aliases:["에누리","할인금액"] },
    { key:"sourcingLink",   label:"구매링크",       req:false, aliases:["구매링크","소싱링크","주문링크"] },
    { key:"sourcingPrice",  label:"구매가(단가)",   req:false, aliases:["구매가","매입가","소싱가"] },
    { key:"buyerName",      label:"구매자명",       req:false, aliases:["구매자명","구매자","주문자"] },
    { key:"deliveryMsg",    label:"배송메세지",     req:false, aliases:["배송메세지","배송메시지","배송요청사항"] },
    { key:"manager",        label:"담당자",         req:false, aliases:["담당자"] },
    { key:"vendor",         label:"구매처",         req:false, aliases:["구매처","매입처"] },
    { key:"account",        label:"계정",           req:false, aliases:["계정","구매계정"] },
    { key:"purchaseAmount", label:"구매금액",       req:false, aliases:["구매금액","매입금액"] },
    { key:"orderId",        label:"주문번호 앞부분",req:false, aliases:["주문번호　앞부분","주문번호 앞부분","주문번호앞부분","구매처 주문번호","주문ID"] },
    { key:"paidAt",         label:"결제일시",       req:false, aliases:["결제일시"] },
    { key:"card",           label:"카드정보",       req:false, aliases:["카드정보","카드"] },
    { key:"point",          label:"포인트",         req:false, aliases:["포인트","적립금"] },
    { key:"orderedYn",      label:"주문여부",       req:false, aliases:["주문여부","발주여부"] },
    { key:"note",           label:"한줄메모",       req:false, aliases:["한줄메모","메모","비고"] },
    { key:"uniqueNo",       label:"주문고유번호",   req:false, aliases:["주문고유번호","고유번호"] },
    { key:"courier",        label:"배송사",         req:false, aliases:["배송사명","택배사","배송사"] },
    { key:"invoiceNumber",  label:"송장번호",       req:false, aliases:["송장번호","운송장번호"] }
  ];

  /* 소스 양식(36열) 헤더 — 내보내기는 이 순서 그대로 나갑니다. '주문번호　앞부분' 은 전각 공백까지 원본과 동일. */
  var SOURCE_HEADERS = ["수집일","주문일","판매사이트 주문번호","판매사이트명","판매자ID","판매가","배송비금액","마스터상품코드","판매사이트 상품코드","상품명","판매자상품코드","주문선택사항","주문수량","에누리","구매링크","구매가","구매자명","수령자명","수령자전화번호","수령자휴대폰번호","배송지우편번호","배송지주소","배송메세지","담당자","구매처","계정","구매금액","주문번호　앞부분","결제일시","카드정보","포인트","주문여부","한줄메모","주문고유번호","배송사명","송장번호"];

  /* 소싱 매핑표 열 별칭 */
  var MAP_FIELDS = {
    productId: ["노출상품ID","노출상품아이디","상품ID","옵션ID","등록상품ID","상품코드"],
    link:      ["소싱링크","소싱 링크","구매링크","구매처","링크","url","URL"],
    category:  ["카테고리","분류","상품분류"],
    price:     ["소싱가","소싱 가격","매입가","원가","사입가","구매가"]
  };

  var COURIERS = ["CJ대한통운","한진택배","롯데택배","로젠택배","우체국택배","업직커머스","천일택배","경동택배","대신택배","일양로지스","GS Postbox","CU편의점택배","직접배송","기타"];
  // 수집 프로그램이 쓰는 배송사 코드 (워크북 상단 메모: 업직=T048, CJ=T025, 롯데=T082, 천일=T069, 로젠=T030, 한진=T081)
  var COURIER_CODES = [
    { code:"T025", name:"CJ대한통운", alias:["CJ","씨제이","대한통운"] },
    { code:"T081", name:"한진택배",   alias:["한진"] },
    { code:"T082", name:"롯데택배",   alias:["롯데","롯데글로벌"] },
    { code:"T030", name:"로젠택배",   alias:["로젠"] },
    { code:"T005", name:"우체국택배", alias:["우체국"] },
    { code:"T048", name:"업직커머스", alias:["업직"] },
    { code:"T069", name:"천일택배",   alias:["천일"] },
    { code:"T060", name:"경동택배",   alias:["경동"] },
    { code:"T044", name:"대신택배",   alias:["대신"] },
    { code:"T042", name:"일양로지스", alias:["일양"] },
    { code:"T098", name:"직접배송",   alias:["직접"] }
  ];
  // 'T025' / 'CJ' / 'CJ대한통운' 무엇이 와도 앱 안에서는 이름으로 통일
  function courierFromAny(v) {
    var t = String(v == null ? "" : v).trim();
    if (!t) return "";
    var up = t.toUpperCase(), n = norm(t);
    for (var i = 0; i < COURIER_CODES.length; i++) {
      var c = COURIER_CODES[i];
      if (c.code === up || norm(c.name) === n) return c.name;
      for (var a = 0; a < c.alias.length; a++) if (n === norm(c.alias[a]) || n.indexOf(norm(c.alias[a])) === 0) return c.name;
    }
    return t;   // 모르는 값은 그대로 보존
  }
  // 내보낼 때는 코드로 (모르는 이름은 그대로)
  function courierToCode(name) {
    var n = norm(name);
    if (!n) return "";
    for (var i = 0; i < COURIER_CODES.length; i++) if (norm(COURIER_CODES[i].name) === n || COURIER_CODES[i].code.toLowerCase() === n) return COURIER_CODES[i].code;
    return String(name || "").trim();
  }
  var CS_TYPES = ["", "출고중지요청", "반품접수", "교환문의", "배송문의", "취소요청", "기타CS"];
  var CS_STATUSES = ["", "접수", "처리중", "처리완료", "보류"];
  var INVOICE_HEADERS = ["번호","묶음배송번호","주문번호","택배사","운송장번호","분리배송 Y/N","분리배송 출고예정일","주문시 출고예정일","출고일(발송일)","주문일","등록상품명","등록옵션명","노출상품명(옵션명)","노출상품ID","옵션ID","최초등록옵션명","업체상품코드","바코드","결제액","배송비구분","배송비","도서산간 추가배송비","구매수(수량)","옵션판매가(판매단가)","구매자","구매자전화번호","수취인이름","수취인전화번호","우편번호","수취인 주소","배송메세지","상품별 추가메시지","주문자 추가메시지","배송완료일","구매확정일자","개인통관번호(PCCC)","통관용구매자전화번호","기타","결제위치"];
  var SHEET_LAYOUT_VERSION = 27;   // 27: 새 소스 양식 열(구매처·계정·구매금액·카드·포인트·메모) 추가

  /* ---------- 전역 상태 ---------- */
  var state = {
    rules: null,
    orders: [],
    deleted: [],
    sourcingMap: {},        // productId -> {link, category, price}
    ops: defaultOps(),
    pending: null,          // 매핑 확인 대기중인 파싱결과
    ui: { q:"", status:"all", sort:"pendingFirst", view:"sheet", tab:"dashboard", group:"none", colWidths:{}, rowHeights:{}, colOrder:[], customCols:[], layoutVersion:SHEET_LAYOUT_VERSION, sourcingOpen:{} },
    cloud: { enabled:false, clientId:"", sheet:"", range:"" }  // 구글시트 연동(선택)
  };

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  function defaultOps() {
    return {
      processNotes: [],
      lineupExtras: {},
      purchaseDb: [],
      calcRows: [],
      journalSide: [],
      journalMain: [],
      accounts: [],
      cards: []
    };
  }
  function normalizeOps() {
    state.ops = Object.assign(defaultOps(), state.ops || {});
    if (!state.ops.lineupExtras || typeof state.ops.lineupExtras !== "object") state.ops.lineupExtras = {};
    ["processNotes","purchaseDb","calcRows","journalSide","journalMain","accounts","cards"].forEach(function (k) {
      if (!Array.isArray(state.ops[k])) state.ops[k] = [];
    });
  }

  /* =====================================================================
   * 유틸
   * ===================================================================== */
  function toNumber(v) {
    if (v === null || v === undefined) return 0;
    if (typeof v === "number") return v;
    var s = String(v).replace(/[^0-9.\-]/g, "");
    var n = parseFloat(s);
    return isNaN(n) ? 0 : n;
  }
  function won(n) {
    if (n === null || n === undefined || isNaN(n)) return "—";
    var neg = n < 0; n = Math.round(Math.abs(n));
    return (neg ? "-₩" : "₩") + n.toLocaleString("ko-KR");
  }
  function comma(n) {
    if (n === null || n === undefined || n === "") return "";
    var num = typeof n === "number" ? n : toNumber(n);
    if (isNaN(num)) return "";
    var neg = num < 0;
    return (neg ? "-" : "") + Math.round(Math.abs(num)).toLocaleString("ko-KR");
  }
  var MONEY_KEYS = { paymentAmount:1, sourcingPrice:1, csCost:1, purchaseAmount:1, point:1, shipFee:1, discount:1 };
  function isMoneyKey(key) { return !!MONEY_KEYS[key]; }
  function moneyInputValue(v) {
    if (v === null || v === undefined || v === "") return "";
    return comma(v);
  }
  function formatMoneyInput(el) {
    if (!el || String(el.value || "").trim() === "") return;
    el.value = comma(el.value);
  }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
      .replace(/"/g,"&quot;").replace(/'/g,"&#39;");
  }
  function norm(s){ return String(s == null ? "" : s).replace(/\s+/g,"").toLowerCase(); }
  function safeUrl(raw) {
    var s = String(raw || "").trim();
    if (!s) return "";
    if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = "https://" + s;
    try {
      var u = new URL(s, location.href);
      if (u.protocol !== "http:" && u.protocol !== "https:") return "";
      return u.href;
    } catch (e) {
      return "";
    }
  }
  function linkHtml(raw, label) {
    var url = safeUrl(raw);
    return url ? '<a class="lnk" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + esc(label || "열기 ↗") + '</a>' : "—";
  }
  function openSafeUrl(raw) {
    var url = safeUrl(raw);
    if (!url) { toast("안전한 http/https 링크만 열 수 있어요"); return; }
    window.open(url, "_blank", "noopener,noreferrer");
  }
  function sanitizeExportCell(v) {
    if (v === null || v === undefined) return "";
    if (typeof v !== "string") return v;
    var s = v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
    return /^[\s]*[=+\-@]/.test(s) ? "'" + s : s;
  }
  function sanitizeExportRows(rows) {
    return rows.map(function (r) {
      var out = {};
      Object.keys(r).forEach(function (k) { out[k] = sanitizeExportCell(r[k]); });
      return out;
    });
  }

  var toastTimer;
  function toast(msg) {
    var t = $("#toast"); t.textContent = msg; t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function(){ t.classList.remove("show"); }, 1900);
  }

  /* 공용 확인/입력 모달 — native confirm()/prompt() 대체 (흐름을 덜 끊고 앱 톤 유지) */
  function showConfirm(opts, onOk) {
    var bg = document.createElement("div");
    bg.className = "modal-bg";
    bg.innerHTML = '<div class="modal" style="max-width:420px" role="dialog" aria-modal="true">' +
      '<div class="mhead"><h2>' + esc(opts.title || "확인") + '</h2></div>' +
      '<div class="mbody" style="white-space:pre-line">' + esc(opts.body || "") +
      (opts.input ? '<input class="full-in mt-12" data-cf-input value="' + esc(opts.value || "") + '" placeholder="' + esc(opts.placeholder || "") + '" />' : '') +
      '</div>' +
      '<div class="mfoot"><button class="btn" data-cf-cancel type="button">취소</button>' +
      '<button class="btn ' + (opts.danger ? "x-del" : "primary") + '" data-cf-ok type="button">' + esc(opts.okLabel || "확인") + '</button></div></div>';
    function close() { bg.remove(); document.removeEventListener("keydown", onKey, true); }
    function ok() {
      var v = opts.input ? (bg.querySelector("[data-cf-input]").value || "").trim() : null;
      if (opts.input && !v) return;   // 입력 모달은 값이 있어야 확정
      close(); if (onOk) onOk(v);
    }
    function onKey(e) {
      if (e.key === "Escape") { e.stopPropagation(); close(); }
      // Enter 확정은 입력칸에 포커스가 있을 때만 — 취소 버튼에 포커스를 두고 Enter 치면 취소가 되어야 함
      else if (e.key === "Enter" && opts.input && e.target && e.target.matches && e.target.matches("[data-cf-input]")) { e.preventDefault(); ok(); }
    }
    // 배경 클릭 닫기는 mousedown도 배경에서 시작했을 때만 — 모달 안 텍스트 드래그가 배경에서 끝나며 닫히는 것 방지
    var downOnBg = false;
    bg.addEventListener("mousedown", function (e) { downOnBg = (e.target === bg); });
    bg.addEventListener("click", function (e) {
      if (e.target === bg) { if (downOnBg) close(); return; }
      if (e.target.closest("[data-cf-cancel]")) { close(); return; }
      if (e.target.closest("[data-cf-ok]")) ok();
    });
    document.addEventListener("keydown", onKey, true);
    document.body.appendChild(bg);
    var focusEl = opts.input ? bg.querySelector("[data-cf-input]") : bg.querySelector("[data-cf-ok]");
    if (focusEl) { focusEl.focus(); if (opts.input && focusEl.select) focusEl.select(); }
  }

  /* file://에서도 동작하도록 clipboard 폴백 */
  function copyText(text, label) {
    label = label || "배송지";
    if (!text) { toast(label + " 값이 없어요"); return; }
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(
        function(){ toast(label + " 복사됨 — 붙여넣기(⌘V)"); },
        function(){ legacyCopy(text, label); }
      );
    } else {
      legacyCopy(text, label);
    }
  }
  function legacyCopy(text, label) {
    label = label || "배송지";
    try {
      var ta = document.createElement("textarea");
      ta.value = text; ta.style.position = "fixed"; ta.style.left = "-9999px";
      document.body.appendChild(ta); ta.focus(); ta.select();
      var ok = document.execCommand("copy");
      document.body.removeChild(ta);
      toast(ok ? label + " 복사됨 — 붙여넣기(⌘V)" : "복사 실패 — 직접 선택해 주세요");
    } catch (e) { toast("복사 실패 — 직접 선택해 주세요"); }
  }

  /* =====================================================================
   * 규칙(rules) 로드/저장
   * ===================================================================== */
  function loadRulesDefaults() {
    // 안전 기본값 보정 (규칙 파일/워크북에 빠진 필드 채우기)
    if (!state.rules.categories) state.rules.categories = [];
    if (state.rules.vatIncluded === undefined) state.rules.vatIncluded = true;
    if (!state.rules.copyFormat) state.rules.copyFormat = "{name} / {phone} / ({zip}) {address}";
    if (!state.rules.defaultCategory) state.rules.defaultCategory = "기타";
    if (state.rules.defaultFeeRate === undefined) state.rules.defaultFeeRate = 10.8;
    if (state.rules.myPhone == null) state.rules.myPhone = "";   // 자동입력용 내 연락처 (기기 설정)
  }
  function loadRules() {
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem(LS.rules)); } catch (e) {}
    state.rules = saved || deepCopy(window.DEFAULT_RULES);
    loadRulesDefaults();
  }
  function saveRules() { safeSetItem(LS.rules, JSON.stringify(state.rules)); }
  function deepCopy(o) { return JSON.parse(JSON.stringify(o)); }

  /* =====================================================================
   * 카테고리 자동분류 + 마진계산
   * ===================================================================== */
  function classify(productName) {
    var name = String(productName || "");
    var best = null, bestLen = 0;
    state.rules.categories.forEach(function (cat) {
      (cat.keywords || []).forEach(function (kw) {
        if (!kw) return;
        if (name.indexOf(kw) !== -1 && kw.length > bestLen) {
          best = cat; bestLen = kw.length;
        }
      });
    });
    if (best) return { category: best.name, feeRate: best.feeRate };
    return { category: state.rules.defaultCategory, feeRate: state.rules.defaultFeeRate };
  }

  function effectiveRate(baseRate) {
    var r = toNumber(baseRate);
    return state.rules.vatIncluded ? r * 1.1 : r;
  }

  function computeMargin(o) {
    normalizeOrder(o);
    var cls = classify(o.productName);
    o.category = cls.category;
    o.feeRate = cls.feeRate;
    var rate = effectiveRate(o.feeRate) / 100;
    o.settlement = Math.round(o.paymentAmount * (1 - rate)); // 수수료 차감 후 정산예상
    var hasUnit = o.sourcingPrice != null && o.sourcingPrice !== "" && !isNaN(o.sourcingPrice);
    var hasTotal = toNumber(o.purchaseAmount) > 0;
    if (hasUnit || hasTotal) {
      // 단가×수량 + 배송비(주문당 1회) — 배송비가 수량배로 빠지지 않게. 단가가 없으면 소스의 구매금액(총액)을 그대로 씀
      var cost = hasUnit ? toNumber(o.sourcingPrice) * (o.quantity || 1) + toNumber(o.sourcingShipping) : toNumber(o.purchaseAmount);
      o.sourcingCost = cost;
      o.margin = Math.round(o.settlement - cost - toNumber(o.csCost));
      o.marginRate = o.paymentAmount ? Math.round(o.margin / o.paymentAmount * 1000) / 10 : null;
    } else {
      o.sourcingCost = null; o.margin = null; o.marginRate = null;
    }
  }

  function recomputeAll() { state.orders.forEach(computeMargin); }

  function normalizeOrder(o) {
    if (!o) return o;
    if (!o.status) o.status = "pending";
    if (o.orderId == null) o.orderId = "";
    if (o.manager == null) o.manager = "";
    if (o.status === "returned") { o.status = "purchased"; o.csType = o.csType || "반품접수"; }
    if (o.status === "stopped") { o.status = "pending"; o.csType = o.csType || "출고중지요청"; }
    if (o.csType == null) o.csType = "";
    if (o.csStatus == null) o.csStatus = "";
    if (o.csCost == null || o.csCost === "") o.csCost = 0;
    if (o.sourcingShipping == null || o.sourcingShipping === "" || isNaN(o.sourcingShipping)) o.sourcingShipping = 0;
    if (!Array.isArray(o.memoLog)) o.memoLog = [];
    if (!o.customValues || typeof o.customValues !== "object") o.customValues = {};
    if (!o.raw || typeof o.raw !== "object") o.raw = {};
    ["collectedAt","site","sellerId","masterCode","sellerCode","buyerName","phone2","deliveryMsg","vendor","account","paidAt","card","orderedYn","note","uniqueNo"]
      .forEach(function (k) { if (o[k] == null) o[k] = ""; });
    ["shipFee","discount","purchaseAmount","point"].forEach(function (k) { if (o[k] == null || o[k] === "" || isNaN(o[k])) o[k] = 0; });
    if (o.courier) o.courier = courierFromAny(o.courier);
    normalizeSourcingLinks(o);
    return o;
  }

  function sourceKey(o) {
    return o.productId || ("name:" + (o.productName || ""));
  }
  function newId(prefix) {
    return (prefix || "id") + Date.now().toString(36) + Math.abs(hash(String(Math.random()))).toString(36);
  }
  function cloneSourcingLinks(list) {
    return (list || []).map(function (c) {
      return {
        id: c.id || newId("sl"),
        source: String(c.source || c.vendor || c.site || "").trim(),
        url: String(c.url || c.link || "").trim(),
        memo: String(c.memo || "").trim(),
        price: (c.price == null || c.price === "") ? null : toNumber(c.price),
        selected: !!c.selected
      };
    });
  }
  function normalizeSourcingLinks(o) {
    var list = cloneSourcingLinks(o.sourcingLinks);
    var cur = String(o.sourcingLink || "").trim();
    var selected = -1;
    if (cur) {
      for (var i = 0; i < list.length; i++) {
        if (String(list[i].url || "").trim() === cur) { selected = i; break; }
      }
      if (selected < 0) {
        list.unshift({ id:newId("sl"), source:"", url:cur, memo:"", price:null, selected:true });
        selected = 0;
      }
    }
    if (selected < 0) {
      for (var j = 0; j < list.length; j++) {
        if (list[j].selected) { selected = j; break; }
      }
    }
    if (selected < 0 && list.length) selected = 0;
    list.forEach(function (c, idx) { c.selected = idx === selected; });
    o.sourcingLinks = list;
    o.sourcingLink = selected >= 0 ? String(list[selected].url || "").trim() : cur;
    return list;
  }
  function selectedSourcingLink(list) {
    for (var i = 0; i < (list || []).length; i++) if (list[i].selected) return list[i].url || "";
    return (list && list[0] && list[0].url) || "";
  }
  function selectedSourcingSource(list) {
    for (var i = 0; i < (list || []).length; i++) if (list[i].selected) return list[i].source || "";
    return (list && list[0] && list[0].source) || "";
  }
  function selectedSourcingPrice(list) {
    for (var i = 0; i < (list || []).length; i++) if (list[i].selected && list[i].price != null && !isNaN(list[i].price) && list[i].price > 0) return list[i].price;
    return null;
  }

  /* =====================================================================
   * 파일 읽기 (SheetJS)
   * ===================================================================== */
  // 파일(.xlsx/.xls/.csv) → { rows: 객체배열, header: 헤더 문자열 배열, sheetName }
  // XLSX.readAsync 는 xlsx-compat.js(또는 진짜 SheetJS)가 제공 — .xlsx 해제가 비동기라 Promise 로 받습니다.
  function readWorkbook(file) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function (e) {
        XLSX.readAsync(new Uint8Array(e.target.result), { type: "array" }).then(function (wb) {
          var ws = wb.Sheets[wb.SheetNames[0]];
          // 헤더는 문자열 배열, 값은 객체배열로
          var rows = XLSX.utils.sheet_to_json(ws, { defval: "", raw: false });
          var header = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" })[0] || [];
          resolve({ rows: rows, header: header.map(function (h) { return String(h).trim(); }), sheetName: wb.SheetNames[0] || "" });
        }).catch(reject);
      };
      fr.onerror = function () { reject(new Error("파일을 읽지 못했습니다")); };
      fr.readAsArrayBuffer(file);
    });
  }

  /* 헤더 자동 매핑
   *  1단계: 모든 항목에 대해 정확/정규화 일치 (별칭 순서 = 우선순위)
   *  2단계: 아직 못 찾은 항목만 부분포함
   *  한 번 쓴 헤더는 다시 쓰지 않음 → '판매사이트 주문번호' 와 '주문번호　앞부분' 이 서로를 뺏지 않습니다. */
  function autoMap(header) {
    var map = {}, used = {};
    var normHeader = header.map(norm);
    FIELDS.forEach(function (f) {
      var found = null;
      for (var a = 0; a < f.aliases.length && !found; a++) {
        var na = norm(f.aliases[a]);
        for (var i = 0; i < header.length; i++) {
          if (used[i]) continue;
          if (header[i] === f.aliases[a] || normHeader[i] === na) { found = header[i]; used[i] = 1; break; }
        }
      }
      map[f.key] = found;
    });
    FIELDS.forEach(function (f) {
      if (map[f.key]) return;
      var found = null;
      for (var b = 0; b < f.aliases.length && !found; b++) {
        var nb = norm(f.aliases[b]);
        if (nb.length < 2) continue;
        for (var j = 0; j < header.length; j++) {
          if (used[j] || !normHeader[j]) continue;
          if (normHeader[j].indexOf(nb) !== -1 || nb.indexOf(normHeader[j]) !== -1) { found = header[j]; used[j] = 1; break; }
        }
      }
      map[f.key] = found;
    });
    return map;
  }

  function autoMapGeneric(header, aliasObj) {
    var map = {}; var normHeader = header.map(norm);
    Object.keys(aliasObj).forEach(function (key) {
      var found = null, aliases = aliasObj[key];
      for (var a = 0; a < aliases.length && !found; a++) {
        var na = norm(aliases[a]);
        for (var i = 0; i < header.length; i++) {
          if (normHeader[i] === na || (normHeader[i] && normHeader[i].indexOf(na) !== -1)) { found = header[i]; break; }
        }
      }
      map[key] = found;
    });
    return map;
  }

  /* =====================================================================
   * 소싱 매핑표 처리
   * ===================================================================== */
  function buildSourcingMap(parsed) {
    var map = {};
    var m = autoMapGeneric(parsed.header, MAP_FIELDS);
    if (!m.productId) { return { map: {}, count: 0, ok: false }; }
    parsed.rows.forEach(function (r) {
      var id = String(r[m.productId] == null ? "" : r[m.productId]).trim();
      if (!id) return;
      map[id] = {
        link: m.link ? String(r[m.link] || "").trim() : "",
        category: m.category ? String(r[m.category] || "").trim() : "",
        price: m.price ? toNumber(r[m.price]) : null
      };
    });
    return { map: map, count: Object.keys(map).length, ok: true };
  }

  /* =====================================================================
   * 주문 빌드
   * ===================================================================== */
  function keyOf(o) {
    if (o.uniqueNo) return "u¶" + String(o.uniqueNo).trim();   // 수집 프로그램의 고유번호가 가장 안정적
    return [o.orderNumber, o.productId, o.option, o.recipient].join("¶");
  }

  function buildOrders(rows, map) {
    var states = loadStates();
    var orders = [];
    rows.forEach(function (r, idx) {
      // 빈 행 무시: 주문번호와 상품명이 모두 비면 스킵
      var on = pick(r, map.orderNumber), pn = pick(r, map.productName);
      if (!String(on).trim() && !String(pn).trim()) return;

      var o = {
        id: "o" + idx + "_" + Math.abs(hash(String(on) + pn + idx)),
        orderDate:     pick(r, map.orderDate),
        orderNumber:   String(on).trim(),
        productId:     String(pick(r, map.productId)).trim(),
        productName:   String(pn).trim(),
        option:        String(pick(r, map.option)).trim(),
        orderId:       "",
        manager:       "",
        quantity:      Math.max(1, Math.round(toNumber(pick(r, map.quantity)) || 1)),
        paymentAmount: toNumber(pick(r, map.paymentAmount)),
        recipient:     String(pick(r, map.recipient)).trim(),
        phone:         String(pick(r, map.phone)).trim(),
        zipcode:       String(pick(r, map.zipcode)).trim(),
        address:       String(pick(r, map.address)).trim(),
        raw:           Object.assign({}, r),
        sourcingLink:  String(pick(r, map.sourcingLink)).trim(),
        sourcingLinks: [],
        sourcingPrice: (function (v) { var n = toNumber(v); return String(v).trim() === "" || n <= 0 ? null : n; })(pick(r, map.sourcingPrice)),
        status: "pending",
        invoiceNumber: String(pick(r, map.invoiceNumber)).replace(/\.0+$/, "").trim(),
        courier: courierFromAny(pick(r, map.courier)),
        csType: "",
        csStatus: "",
        csCost: 0,
        memoLog: [],
        /* 새 소스 양식 필드 */
        collectedAt:   String(pick(r, map.collectedAt)).trim(),
        site:          String(pick(r, map.site)).trim(),
        sellerId:      String(pick(r, map.sellerId)).trim(),
        shipFee:       toNumber(pick(r, map.shipFee)),
        masterCode:    String(pick(r, map.masterCode)).trim(),
        sellerCode:    String(pick(r, map.sellerCode)).trim(),
        discount:      toNumber(pick(r, map.discount)),
        buyerName:     String(pick(r, map.buyerName)).trim(),
        phone2:        String(pick(r, map.phone2)).trim(),
        deliveryMsg:   String(pick(r, map.deliveryMsg)).trim(),
        vendor:        String(pick(r, map.vendor)).trim(),
        account:       String(pick(r, map.account)).trim(),
        purchaseAmount: toNumber(pick(r, map.purchaseAmount)),
        paidAt:        String(pick(r, map.paidAt)).trim(),
        card:          String(pick(r, map.card)).trim(),
        point:         toNumber(pick(r, map.point)),
        orderedYn:     String(pick(r, map.orderedYn)).trim().toUpperCase(),
        note:          String(pick(r, map.note)).trim(),
        uniqueNo:      String(pick(r, map.uniqueNo)).replace(/\.0+$/, "").trim()
      };
      o.manager = String(pick(r, map.manager)).trim();
      o.orderId = String(pick(r, map.orderId)).replace(/\.0+$/, "").trim();
      // 소스 파일에 이미 적힌 진행상태 반영: 주문여부 O = 구매완료, 송장번호 있음 = 송장입력완료
      if (o.orderedYn === "O") o.status = "purchased";
      if (o.invoiceNumber && o.courier) o.status = "invoiced";
      // 전화번호가 휴대폰 열에 없으면 일반전화 열로
      if (!o.phone && o.phone2) o.phone = o.phone2;

      // 소싱 매핑표 연결
      var sm = state.sourcingMap[o.productId];
      if (sm) {
        o.sourcingLink = sm.link || "";
        if (sm.price != null && !isNaN(sm.price) && sm.price > 0) o.sourcingPrice = sm.price;
      }
      var lx = findLineupExtraForOrder(o);
      if (lx) {
        if (!o.productName && lx.name) o.productName = lx.name;
        if (!o.sourcingLink && lx.sourcingLink) o.sourcingLink = lx.sourcingLink;
        if ((o.sourcingPrice == null || o.sourcingPrice === "") && lx.sourcingPrice) o.sourcingPrice = toNumber(lx.sourcingPrice);
      }
      var db = bestPurchaseForKey(sourceKey(o));
      if (db) {
        if (!o.sourcingLink && db.url) o.sourcingLink = db.url;
        if ((o.sourcingPrice == null || o.sourcingPrice === "") && db.price) {
          o.sourcingPrice = toNumber(db.price);            // 단가만 (수량이 곱해지는 값)
          o.sourcingShipping = toNumber(db.shipping) || 0; // 배송비는 주문당 1회
        }
      }

      // 이전 진행상태 복원
      var prev = states[keyOf(o)];
      if (prev) {
        o.status = prev.status || o.status;
        if (prev.orderId != null) o.orderId = prev.orderId;
        if (prev.manager != null) o.manager = prev.manager;
        o.invoiceNumber = prev.invoiceNumber || o.invoiceNumber;
        o.courier = prev.courier || o.courier;
        if (prev.sourcingLink) o.sourcingLink = prev.sourcingLink;
        if (prev.sourcingLinks) o.sourcingLinks = cloneSourcingLinks(prev.sourcingLinks);
        if (prev.sourcingPrice != null) o.sourcingPrice = prev.sourcingPrice;
        if (prev.sourcingShipping != null) o.sourcingShipping = prev.sourcingShipping;
        if (prev.csType != null) o.csType = prev.csType;
        if (prev.csStatus != null) o.csStatus = prev.csStatus;
        if (prev.csCost != null) o.csCost = prev.csCost;
        if (prev.memoLog) o.memoLog = prev.memoLog;
        if (prev.customValues) o.customValues = Object.assign({}, prev.customValues);
        ["vendor","account","purchaseAmount","paidAt","card","point","note"].forEach(function (k) {
          if (prev[k] != null && prev[k] !== "" && (o[k] == null || o[k] === "" || o[k] === 0)) o[k] = prev[k];
        });
      }

      normalizeOrder(o);
      computeMargin(o);
      orders.push(o);
    });
    return orders;
  }

  function pick(row, header) { return header && row[header] !== undefined ? row[header] : ""; }
  function hash(s) { var h = 0; for (var i = 0; i < s.length; i++) { h = (h << 5) - h + s.charCodeAt(i); h |= 0; } return h; }

  /* =====================================================================
   * 상태 저장/복원
   * ===================================================================== */
  function loadStates() {
    try { return JSON.parse(localStorage.getItem(LS.states)) || {}; } catch (e) { return {}; }
  }
  // 저장 공통 관문 — quota 초과 등으로 실패해도 앱이 이벤트 한가운데서 죽지 않게
  function safeSetItem(key, value) {
    try { localStorage.setItem(key, value); return true; }
    catch (e) {
      if (!safeSetItem._warned) {
        safeSetItem._warned = true;
        toast("저장 공간이 부족합니다 — 내보내기로 백업한 뒤 [설정 → 완전 삭제]로 정리하세요");
        setTimeout(function () { safeSetItem._warned = false; }, 8000);
      }
      return false;
    }
  }
  function persist() {
    normalizeOps();
    // 주문 목록 통째로 저장(새로고침 유지)
    safeSetItem(LS.orders, JSON.stringify(state.orders));
    // 진행상태 별도 저장(재업로드 시 복원). '처음으로' 뒤 재업로드 복원을 위해 현재 주문 밖의
    // 키도 남겨두되, 90일 지난 항목은 정리(과거 주문 PII·용량 무한 누적 방지)
    var states = loadStates();
    var now = Date.now(), KEEP_MS = 90 * 24 * 3600 * 1000;
    state.orders.forEach(function (o) {
      states[keyOf(o)] = {
        ts: now,
        status: o.status, orderId: o.orderId || "", manager: o.manager || "", invoiceNumber: o.invoiceNumber, courier: o.courier,
        sourcingLink: o.sourcingLink, sourcingLinks: cloneSourcingLinks(o.sourcingLinks), sourcingPrice: o.sourcingPrice, sourcingShipping: o.sourcingShipping || 0,
        csType: o.csType, csStatus: o.csStatus, csCost: o.csCost, memoLog: o.memoLog, customValues: o.customValues || {},
        vendor: o.vendor || "", account: o.account || "", purchaseAmount: o.purchaseAmount || 0, paidAt: o.paidAt || "",
        card: o.card || "", point: o.point || 0, note: o.note || ""
      };
    });
    Object.keys(states).forEach(function (k) {
      var st = states[k];
      if (!st.ts) { st.ts = now; return; }          // 기존 항목은 지금부터 90일 카운트
      if (now - st.ts > KEEP_MS) delete states[k];
    });
    safeSetItem(LS.states, JSON.stringify(states));
    safeSetItem(LS.ui, JSON.stringify(state.ui));
    safeSetItem(LS.ops, JSON.stringify(state.ops));
    saveSourcingMap();
    saveDeleted();
  }
  function saveUiOnly() { safeSetItem(LS.ui, JSON.stringify(state.ui)); }
  function saveSourcingMap() {
    try { localStorage.setItem(LS.sourcingMap, JSON.stringify(state.sourcingMap || {})); } catch (e) {}
  }
  function saveDeleted() {
    try { localStorage.setItem(LS.deleted, JSON.stringify(state.deleted || [])); } catch (e) {}
  }
  function loadDeleted() {
    try { state.deleted = JSON.parse(localStorage.getItem(LS.deleted)) || []; } catch (e) { state.deleted = []; }
  }
  function restoreSession() {
    try {
      var ui = JSON.parse(localStorage.getItem(LS.ui));
      if (ui) state.ui = Object.assign(state.ui, ui);
    } catch (e) {}
    try {
      var ops = JSON.parse(localStorage.getItem(LS.ops));
      if (ops) state.ops = Object.assign(defaultOps(), ops);
    } catch (e) {}
    normalizeOps();
    if (!state.ui.colWidths) state.ui.colWidths = {};
    if (!state.ui.rowHeights) state.ui.rowHeights = {};
    if (!Array.isArray(state.ui.colOrder)) state.ui.colOrder = [];
    if (!Array.isArray(state.ui.customCols)) state.ui.customCols = [];
    normalizeSheetLayoutForCurrentVersion();
    if (!state.ui.sourcingOpen) state.ui.sourcingOpen = {};
    if (!state.ui.group) state.ui.group = "none";
    loadDeleted();
    // 소싱 매핑표 복원 (주문 유무와 무관하게 — 매핑표 먼저 올린 경우도 유지)
    try {
      var sm = JSON.parse(localStorage.getItem(LS.sourcingMap));
      if (sm && typeof sm === "object") state.sourcingMap = sm;
    } catch (e) {}
    var smCount = Object.keys(state.sourcingMap || {}).length;
    if (smCount) { var mf = $("#map-file"); if (mf) mf.textContent = "매핑 " + smCount + "건 유지 중"; }
    var orders = null;
    try { orders = JSON.parse(localStorage.getItem(LS.orders)); } catch (e) {}
    if (orders && orders.length) {
      state.orders = orders;
      state.orders.forEach(normalizeOrder);
      recomputeAll();      // 규칙이 바뀌었을 수 있으니 재계산
      showDashboard();
      return true;
    }
    return false;
  }

  /* =====================================================================
   * 화면 전환
   * ===================================================================== */
  function show(view) {
    $("#view-upload").classList.toggle("hidden", view !== "upload");
    $("#view-mapping").classList.toggle("hidden", view !== "mapping");
    $("#view-dashboard").classList.toggle("hidden", view !== "dashboard");
    $("#btn-export").disabled = (view !== "dashboard");
    var qi = $("#btn-quick-invoice"); if (qi) qi.disabled = (view !== "dashboard");
  }
  function showDashboard() {
    show("dashboard");
    $("#q").value = state.ui.q || "";
    $("#f-status").value = state.ui.status;
    $("#f-sort").value = state.ui.sort;
    var g = $("#f-group"); if (g) g.value = state.ui.group || "none";
    render();
  }

  /* =====================================================================
   * 열 매핑 화면
   * ===================================================================== */
  function showMapping(parsed) {
    state.pending = parsed;
    var auto = autoMap(parsed.header);
    var tb = $("#map-rows"); tb.innerHTML = "";
    FIELDS.forEach(function (f) {
      var tr = document.createElement("tr");
      var opts = ['<option value="">— 사용 안 함 —</option>'].concat(
        parsed.header.map(function (h) {
          return '<option value="' + esc(h) + '"' + (auto[f.key] === h ? " selected" : "") + ">" + esc(h) + "</option>";
        })
      ).join("");
      tr.innerHTML =
        '<td>' + esc(f.label) + (f.req ? '<span class="req-star">*</span>' : '') + '</td>' +
        '<td><select data-key="' + f.key + '">' + opts + '</select></td>' +
        '<td class="map-state"></td>';
      tb.appendChild(tr);
    });
    updateMapStates();
    show("mapping");
  }
  function currentMapping() {
    var m = {};
    $$("#map-rows select").forEach(function (s) { m[s.getAttribute("data-key")] = s.value || null; });
    return m;
  }
  function updateMapStates() {
    var m = currentMapping();
    $$("#map-rows tr").forEach(function (tr) {
      var sel = tr.querySelector("select"); var key = sel.getAttribute("data-key");
      var f = FIELDS.filter(function (x) { return x.key === key; })[0];
      var cell = tr.querySelector(".map-state");
      if (m[key]) cell.innerHTML = '<span class="map-ok">연결됨</span>';
      else if (f.req) cell.innerHTML = '<span class="map-bad">필수!</span>';
      else cell.innerHTML = '<span class="muted-note">선택</span>';
    });
  }

  /* =====================================================================
   * 렌더링
   * ===================================================================== */
  function statusLabel(s) {
    return s === "purchased" ? "구매완료" : s === "invoiced" ? "송장입력완료" : "미처리";
  }
  function csLabel(o) {
    if (!o || !o.csType) return "정상";
    return o.csType + (o.csStatus ? " · " + o.csStatus : "");
  }

  function renderSummary() {
    var total = state.orders.length;
    var pending = 0, purchased = 0, invoiced = 0, marginSum = 0, hasMargin = false;
    state.orders.forEach(function (o) {
      if (o.status === "pending") pending++;
      else if (o.status === "purchased") purchased++;
      else if (o.status === "invoiced") invoiced++;
      if (o.margin != null) { marginSum += o.margin; hasMargin = true; }
    });
    var s = $("#summary");
    s.innerHTML =
      stat("총 주문", total + "건") +
      stat("미처리", pending + "건", "accent") +
      stat("구매완료", purchased + "건") +
      stat("송장완료", invoiced + "건") +
      stat("예상마진 합계", hasMargin ? won(marginSum) : "매입가 입력 필요", "money");
  }
  function stat(k, v, cls) {
    return '<div class="stat ' + (cls || "") + '"><div class="k">' + esc(k) + '</div><div class="v">' + esc(v) + '</div></div>';
  }

  function renderProcessStrip() {
    var el = $("#process-strip"); if (!el) return;
    var s = overviewStats();
    var dbReady = state.orders.filter(function (o) { return o.sourcingLink || o.sourcingPrice != null; }).length;
    var dbNeed = Math.max(0, s.total - dbReady);
    var invoiced = state.orders.filter(function (o) { return o.invoiceNumber && o.courier; }).length;
    var handled = s.purchased + s.invoiced;
    var next = "발주서를 올리면 주문관리 시트가 열립니다.";
    if (s.total && dbNeed) next = "DB에서 매입가와 주문링크를 채우면 순마진이 바로 계산됩니다.";
    else if (s.total && s.pending) next = "주문관리에서 입력준비 → 결제 → 완료 체크 순서로 처리하세요.";
    else if (s.total && handled > invoiced) next = "택배사와 송장번호를 입력한 뒤 쿠팡 송장 업로드 파일을 만들 수 있습니다.";
    else if (s.total) next = "현재 주문 흐름은 정리됐습니다. CS와 수익분석만 확인하면 됩니다.";
    var steps = [
      { label:"업로드", value:s.total ? s.total + "건" : "대기", on:!!s.total, pct:s.total ? 100 : 0, tab:"dashboard" },
      { label:"라인업", value:dbReady + "/" + s.total, on:!!dbReady, warn:!!dbNeed && !!s.total, pct:s.total ? Math.round(dbReady / s.total * 100) : 0, tab:"lineup" },
      { label:"처리", value:handled + "/" + s.total, on:!!handled, warn:!!s.pending && !!s.total, pct:s.total ? Math.round(handled / s.total * 100) : 0, tab:"orders" },
      { label:"CS", value:s.csCount + "건", on:!!s.csCount, warn:!!s.csCount, pct:s.csCount ? 100 : 0, tab:"cs" },
      { label:"송장", value:invoiced + "/" + s.total, on:!!invoiced, warn:!!(handled > invoiced), pct:s.total ? Math.round(invoiced / s.total * 100) : 0, tab:"orders" }
    ];
    el.innerHTML = '<div class="process-shell"><div class="process-head"><div><b>작업 흐름</b><span>' + esc(next) + '</span></div>' +
      '<div class="process-lock">' + (state.cloud.enabled ? "클라우드 연동 켜짐" : "로컬 모드") + '</div></div>' +
      '<div class="process-inner">' + steps.map(function (x, i) {
      return '<button class="process-step ' + (x.on ? "on " : "") + (x.warn ? "warn " : "") + '" type="button" data-process-tab="' + esc(x.tab || "dashboard") + '">' +
        '<span class="process-dot">' + (i + 1) + '</span><span class="process-label">' + esc(x.label) +
        '</span><b>' + esc(x.value) + '</b><i><em style="width:' + Math.max(0, Math.min(100, x.pct || 0)) + '%"></em></i></button>';
    }).join("") + '</div>' + renderSecurityRail() + '</div>';
  }
  function renderSecurityRail() {
    var cells = [
      state.cloud.enabled ? ["주의", "구글시트 불러오기 때만 외부 연결"] : ["보안", "기본 처리·저장은 이 브라우저 안에서만"],
      ["링크", "http/https 링크만 새 탭으로 열기"],
      ["내보내기", "CSV/엑셀 수식 실행 방지"],
      ["결제", "로그인·구매·결제는 항상 직접 확인"]
    ];
    return '<div class="security-rail">' + cells.map(function (c, i) {
      return '<span class="' + (i === 0 && state.cloud.enabled ? "warn" : "") + '"><b>' + esc(c[0]) + '</b>' + esc(c[1]) + '</span>';
    }).join("") + '</div>';
  }

  /* ---------- 상단 탭 ---------- */
  var TABS = [
    { key:"process",   label:"프로세스" },
    { key:"dashboard", label:"대시보드" },
    { key:"orders",    label:"주문관리" },
    { key:"cs",        label:"CS관리" },
    { key:"lineup",    label:"라인업" },
    { key:"sourcing",  label:"매입처DB" },
    { key:"calc",      label:"마진계산기" },
    { key:"daily",     label:"일별매출" },
    { key:"invoice",   label:"운송장업로드" },
    { key:"loss",      label:"로스관리" },
    { key:"journal",   label:"수행일지" },
    { key:"accounts",  label:"계정관리" },
    { key:"cards",     label:"카드관리" },
    { key:"profit",    label:"수익분석" }
  ];
  var TAB_PANE = {
    process:"process", dashboard:"dashboard", orders:"orders", cs:"cs", lineup:"lineup", sourcing:"sourcing",
    calc:"calc", daily:"daily", invoice:"invoice", loss:"loss", journal:"journal", accounts:"accounts", cards:"cards", profit:"profit"
  };

  function renderTabs() {
    var nav = $("#tabnav"); if (!nav) return;
    var active = state.ui.tab || "dashboard";
    nav.innerHTML = TABS.map(function (t) {
      return '<button class="tab' + (t.key === active ? " on" : "") + (t.soon ? " soon" : "") +
        '" data-tab="' + t.key + '">' + esc(t.label) + '</button>';
    }).join("");
  }
  function setTab(key) {
    if (key === "settings") { openSettings(); return; }   // 설정은 모달 — 탭 전환 안 함
    state.ui.tab = key; persist(); render();
  }

  function render() {
    renderTabs();
    renderProcessStrip();
    var tab = state.ui.tab || "dashboard";
    if (!TAB_PANE[tab]) { tab = "dashboard"; state.ui.tab = tab; }
    var pane = TAB_PANE[tab];
    ["process", "dashboard", "orders", "cs", "lineup", "sourcing", "calc", "daily", "invoice", "loss", "journal", "accounts", "cards", "profit"].forEach(function (p) {
      var el = $("#pane-" + p); if (el) el.classList.toggle("hidden", p !== pane);
    });
    renderSummary();   // #summary(대시보드 패널) 갱신 — 다른 탭이면 숨겨져 있어도 무해
    if (tab === "process") renderProcessPane();
    else if (tab === "dashboard") renderOverview();
    else if (tab === "orders") renderOrdersPane();
    else if (tab === "cs") renderCsPane();
    else if (tab === "lineup") renderLineup();
    else if (tab === "sourcing") renderSourcing();
    else if (tab === "calc") renderMarginCalc();
    else if (tab === "daily") renderDailySales();
    else if (tab === "invoice") renderInvoicePane();
    else if (tab === "loss") renderLossPane();
    else if (tab === "journal") renderJournalPane();
    else if (tab === "accounts") renderSimpleOpsTable("accounts");
    else if (tab === "cards") renderSimpleOpsTable("cards");
    else if (tab === "profit") renderProfit();
  }

  function renderOrdersPane() {
    renderOrdersDashboard();
    renderSheet();
  }
  function isCsOrder(o) { return !!(o && o.csType); }
  function csOrders() {
    return state.orders.filter(isCsOrder).sort(function (a, b) {
      var ar = a.csType === "반품접수" ? 0 : 1;
      var br = b.csType === "반품접수" ? 0 : 1;
      return (ar - br) || ((parseOrderDate(b.orderDate) || 0) - (parseOrderDate(a.orderDate) || 0)) ||
        String(a.orderNumber).localeCompare(String(b.orderNumber), "ko");
    });
  }
  function csMemoPreview(o) {
    var logs = o.memoLog || [];
    if (!logs.length) return '<div class="cs-memo-empty">메모 없음</div>';
    return '<div class="cs-memo-preview">' + logs.slice().reverse().map(function (m) {
      return '<div><b>' + esc(m.at || "") + '</b>' + esc(m.text || "") + '</div>';
    }).join("") + '</div>';
  }
  function csTypeChip(o) {
    var cls = o.csType === "반품접수" ? "return" : "stop";
    return '<span class="cs-chip ' + cls + '">' + esc(o.csType || "CS") + '</span>';
  }
  function renderCsPane() {
    var pane = $("#pane-cs"); if (!pane) return;
    var list = csOrders();
    var stop = list.filter(function (o) { return o.csType === "출고중지요청"; }).length;
    var ret = list.filter(function (o) { return o.csType === "반품접수"; }).length;
    var cost = list.reduce(function (sum, o) { return sum + toNumber(o.csCost); }, 0);
    var head = '<div class="panel-head"><h2>CS관리</h2><div class="spacer"></div>' +
      '<span class="cs-pill">전체 ' + list.length + '건</span><span class="cs-pill stop">출고중지 ' + stop + '건</span><span class="cs-pill ret">반품 ' + ret + '건</span><span class="cs-pill">CS차감 ' + won(cost) + '</span></div>' +
      '<div class="info-banner compact">주문관리에서 <b>출고중지/반품접수</b>를 체크하면 이 탭으로 이동합니다. 왼쪽 체크를 해제하면 일반 주문관리 시트로 돌아갑니다.</div>';
    if (!list.length) {
      pane.innerHTML = head + '<div class="soon"><h3>진행 중인 CS가 없습니다</h3><p>주문관리에서 출고중지 또는 반품접수를 체크하면 여기에 모입니다.</p></div>';
      return;
    }
    var rows = list.map(function (o) {
      normalizeOrder(o);
      var margin = o.margin == null ? "—" : won(o.margin) + (o.marginRate != null ? " (" + o.marginRate + "%)" : "");
      return '<tr data-id="' + esc(o.id) + '">' +
        '<td class="cs-active"><label class="sheet-check"><input type="checkbox" data-cs-active checked /><span></span></label></td>' +
        '<td>' + csTypeChip(o) + '</td>' +
        '<td>' + esc(o.orderDate || "") + '</td>' +
        '<td>' + esc(o.orderNumber || "") + '</td>' +
        '<td class="cs-product">' + esc(o.productName || "") + '</td>' +
        '<td>' + esc(o.option || "") + '</td>' +
        '<td class="num">' + esc(comma(o.paymentAmount)) + '</td>' +
        '<td class="num">' + (o.sourcingPrice != null ? esc(comma(o.sourcingPrice)) : "—") + '</td>' +
        '<td class="num ' + (o.margin != null ? (o.margin >= 0 ? "pos" : "neg") : "") + '">' + esc(margin) + '</td>' +
        '<td class="num"><input data-cs-k="csCost" inputmode="numeric" value="' + esc(moneyInputValue(o.csCost)) + '" placeholder="0" /></td>' +
        '<td><select data-cs-k="csStatus">' + CS_STATUSES.map(function (s) {
          return '<option value="' + esc(s) + '"' + (s === (o.csStatus || "") ? " selected" : "") + '>' + esc(s || "상태") + '</option>';
        }).join("") + '</select></td>' +
        '<td>' + csMemoPreview(o) + '</td>' +
        '<td class="cs-actions"><button class="mini yellow" data-cs-memo type="button">+ 메모</button><button class="mini" data-cs-autofill type="button">입력준비</button><button class="mini red" data-cs-clear type="button">해제</button></td>' +
      '</tr>';
    }).join("");
    pane.innerHTML = head + '<div class="data-scroll cs-scroll"><table class="data cs-table"><thead><tr><th>유지</th><th>유형</th><th>주문일</th><th>주문번호</th><th>상품명</th><th>옵션</th><th class="num">결제액</th><th class="num">매입가</th><th class="num">순마진</th><th class="num">CS차감</th><th>처리상태</th><th>메모</th><th>액션</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  }

  function isSameDay(a, b) {
    return a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }
  function orderKpi(k, v, cls) {
    return '<div class="okpi"><div class="k">' + esc(k) + '</div><div class="v ' + (cls || "") + '">' + esc(v) + '</div></div>';
  }
  function renderOrdersDashboard() {
    var el = $("#orders-dashboard"); if (!el) return;
    var today = new Date();
    var s = { rev:0, margin:0, hasMargin:false, remaining:0, completed:0, cs:0 };
    state.orders.forEach(function (o) {
      var d = parseOrderDate(o.orderDate);
      if (isSameDay(d, today)) {
        s.rev += o.paymentAmount || 0;
        if (o.margin != null) { s.margin += o.margin; s.hasMargin = true; }
      }
      if (o.status === "pending") s.remaining++;
      else s.completed++;
      if (o.csType) s.cs++;
    });
    var rate = s.rev && s.hasMargin ? Math.round(s.margin / s.rev * 1000) / 10 : null;
    el.innerHTML = '<div class="orders-kpi">' +
      orderKpi("오늘의 매출", won(s.rev)) +
      orderKpi("오늘의 순마진", s.hasMargin ? won(s.margin) : "—", s.hasMargin ? (s.margin >= 0 ? "pos" : "neg") : "") +
      orderKpi("오늘의 마진율", fmtPct(rate)) +
      orderKpi("남은 총 주문건", s.remaining + "건") +
      orderKpi("완료된 주문건", s.completed + "건") +
      orderKpi("CS 건", s.cs + "건") +
    '</div>';
  }

  /* ---------- 대시보드 / 수익분석 공통 집계 ---------- */
  function overviewStats() {
    var s = { rev:0, settle:0, cost:0, margin:0, hasMargin:false, total:state.orders.length,
              pending:0, purchased:0, invoiced:0, csCost:0, csCount:0, products:{} };
    state.orders.forEach(function (o) {
      normalizeOrder(o);
      s.rev += o.paymentAmount || 0;
      s.settle += o.settlement || 0;
      if (o.sourcingCost != null) s.cost += o.sourcingCost;
      if (toNumber(o.csCost) > 0) s.csCost += toNumber(o.csCost);
      if (o.csType) s.csCount++;
      if (o.margin != null) { s.margin += o.margin; s.hasMargin = true; }
      if (o.status === "pending") s.pending++;
      else if (o.status === "purchased") s.purchased++;
      else if (o.status === "invoiced") s.invoiced++;
      var pid = o.productId || o.productName; if (pid) s.products[pid] = 1;
    });
    s.rate = s.rev ? Math.round(s.margin / s.rev * 1000) / 10 : 0;
    s.prodCount = Object.keys(s.products).length;
    return s;
  }
  function parseOrderDate(v) {
    if (v instanceof Date && !isNaN(v)) return v;
    var s = String(v == null ? "" : v).trim();
    if (!s) return null;
    var serial = toNumber(s);
    if (/^\d+(\.\d+)?$/.test(s) && serial > 20000) {
      return new Date(Math.round((serial - 25569) * 86400 * 1000));
    }
    var m = s.match(/(\d{4})[.\-\/년\s]+(\d{1,2})[.\-\/월\s]+(\d{1,2})?/);
    if (m) return new Date(+m[1], +m[2] - 1, +(m[3] || 1));
    var d = new Date(s);
    return isNaN(d) ? null : d;
  }
  function monthKey(v) {
    var d = parseOrderDate(v);
    if (!d) return "날짜없음";
    return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2);
  }
  function monthlyStats() {
    var by = {};
    state.orders.forEach(function (o) {
      var k = monthKey(o.orderDate);
      if (!by[k]) by[k] = { month:k, cnt:0, rev:0, margin:0, csCost:0, hasMargin:false };
      var g = by[k];
      g.cnt++;
      g.rev += o.paymentAmount || 0;
      g.csCost += toNumber(o.csCost);
      if (o.margin != null) { g.margin += o.margin; g.hasMargin = true; }
    });
    return Object.keys(by).sort().map(function (k) { return by[k]; });
  }
  function ovCard(k, v, cls) {
    return '<div class="ov-card"><div class="k">' + esc(k) + '</div><div class="v' + (cls ? " " + cls : "") + '">' + esc(v) + '</div></div>';
  }

  function renderOverview() {
    var s = overviewStats();
    var done = s.invoiced, prog = s.total ? Math.round(done / s.total * 100) : 0;
    var box = $("#overview-extra"); if (!box) return;
    box.innerHTML =
      '<div class="ov-grid">' +
        ovCard("총 매출 (결제액 합)", won(s.rev)) +
        ovCard("정산 예상액", won(s.settle)) +
        ovCard("소싱비 합계", s.cost ? won(s.cost) : "—") +
        ovCard("CS 차감액", s.csCost ? won(-s.csCost) : "—", s.csCost ? "neg" : "") +
        ovCard("예상 순수익", s.hasMargin ? won(s.margin) : "매입가 입력 필요", s.hasMargin ? (s.margin >= 0 ? "pos" : "neg") : "") +
        ovCard("평균 마진율", s.hasMargin ? fmtPct(s.rate) : "—") +
        ovCard("품목 수", s.prodCount + "종") +
        ovCard("CS 접수", s.csCount + "건") +
      '</div>' +
      '<div class="ov-prog"><div class="ov-prog-lbl">처리 진행률 (송장입력완료 기준) — <b>' + prog + '%</b> · ' + done + "/" + s.total + '건</div>' +
        '<div class="ov-bar"><span style="width:' + prog + '%"></span></div></div>' +
      renderMonthlyTable();
  }
  function renderMonthlyTable() {
    var rows = monthlyStats();
    if (!rows.length) return "";
    var body = rows.map(function (g) {
      var rate = g.rev ? Math.round(g.margin / g.rev * 1000) / 10 : 0;
      return '<tr><td>' + esc(g.month) + '</td><td class="num">' + g.cnt + '</td><td class="num">' + won(g.rev) + '</td>' +
        '<td class="num ' + (g.hasMargin ? (g.margin >= 0 ? "pos" : "neg") : "") + '">' + (g.hasMargin ? won(g.margin) : "—") + '</td>' +
        '<td class="num">' + (g.hasMargin ? fmtPct(rate) : "—") + '</td><td class="num">' + (g.csCost ? won(-g.csCost) : "—") + '</td></tr>';
    }).join("");
    return '<div class="panel-head monthly-head"><h2>월별 매출·순이익</h2></div>' +
      '<div class="data-scroll monthly-scroll"><table class="data monthly"><thead><tr><th>월</th><th class="num">주문</th><th class="num">월 매출</th><th class="num">월 순이익</th><th class="num">순마진%</th><th class="num">CS 차감</th></tr></thead><tbody>' + body + '</tbody></table></div>';
  }

  /* ---------- DB 탭 ---------- */
  function coupangLinkFor(o) {
    var direct = rawVal(o, ["쿠팡링크","쿠팡 링크","상품링크","상품 링크","노출상품URL","노출상품 URL","상품URL","상품 URL","URL","url"]);
    if (direct) return String(direct).trim();
    var pid = String(o.productId || "").trim();
    if (/^\d+$/.test(pid)) return "https://www.coupang.com/vp/products/" + pid;
    return "";
  }
  function sourcingGroups() {
    var map = {};
    state.orders.forEach(function (o) {
      normalizeOrder(o);
      var key = sourceKey(o);
      if (!map[key]) map[key] = {
        key:key, name:o.productName, productId:o.productId || "", coupangLink:coupangLinkFor(o),
        link:o.sourcingLink || "", links:cloneSourcingLinks(o.sourcingLinks), price:o.sourcingPrice,
        count:0, qty:0, revenue:0, margin:0, hasMargin:false, completed:0, pending:0, csCount:0
      };
      var g = map[key];
      g.count++;
      g.qty += o.quantity || 0;
      g.revenue += o.paymentAmount || 0;
      if (o.margin != null) { g.margin += o.margin; g.hasMargin = true; }
      if (o.status === "pending") g.pending++;
      else g.completed++;
      if (o.csType) g.csCount++;
      if (!g.link && o.sourcingLink) g.link = o.sourcingLink;
      if ((!g.links || !g.links.length) && o.sourcingLinks && o.sourcingLinks.length) g.links = cloneSourcingLinks(o.sourcingLinks);
      if (g.price == null && o.sourcingPrice != null) g.price = o.sourcingPrice;
      if (!g.name && o.productName) g.name = o.productName;
      if (!g.coupangLink) g.coupangLink = coupangLinkFor(o);
    });
    normalizeOps();
    (state.ops.purchaseDb || []).forEach(function (r) {
      var key = purchaseKey(r);
      if (!key) return;
      var total = purchaseTotal(r);
      if (!map[key]) map[key] = {
        key:key, name:r.name || "", productId:r.productId || "", coupangLink:"",
        link:r.url || "", links:[], price:total || null,
        count:0, qty:0, revenue:0, margin:0, hasMargin:false, completed:0, pending:0, csCount:0
      };
      var g = map[key];
      if (!g.name && r.name) g.name = r.name;
      if (!g.productId && r.productId) g.productId = r.productId;
      if (r.url && !g.coupangLink && /coupang/i.test(r.url)) g.coupangLink = r.url;
      var candidate = purchaseRowToLink(r, false);
      if (candidate.url || candidate.source || candidate.price != null) g.links.push(candidate);
      if (total && (g.price == null || total < g.price)) { g.price = total; g.link = r.url || g.link; }
    });
    Object.keys(map).forEach(function (key) {
      if (!map[key].links || !map[key].links.length) return;
      var best = selectedSourcingPrice(map[key].links);
      if (best == null && map[key].price != null) best = map[key].price;
      var selected = -1;
      map[key].links.forEach(function (c, i) {
        if (selected < 0 && ((best != null && c.price === best) || (map[key].link && c.url === map[key].link))) selected = i;
      });
      if (selected < 0) selected = 0;
      map[key].links.forEach(function (c, i) { c.selected = i === selected; });
      if (!map[key].link) map[key].link = selectedSourcingLink(map[key].links);
    });
    return Object.keys(map).map(function (k) { return map[k]; });
  }
  function groupOrders(key) {
    return state.orders.filter(function (o) { return sourceKey(o) === key; });
  }
  function purchaseKey(r) {
    if (!r) return "";
    var id = String(r.productId || "").trim();
    if (id) return id;
    var nm = String(r.name || "").trim();
    return nm ? "name:" + nm : "";
  }
  function purchaseTotal(r) {
    if (!r) return null;
    var total = toNumber(r.totalCost);
    if (total > 0) return total;
    var price = toNumber(r.price), shipping = toNumber(r.shipping);
    total = price + shipping;
    return total > 0 ? total : null;
  }
  function purchaseRowToLink(r, selected) {
    var total = purchaseTotal(r);
    return {
      id:r.id || newId("pdb"),
      source:[r.platform, r.vendor].filter(Boolean).join(" · "),
      url:String(r.url || "").trim(),
      memo:String(r.memo || "").trim(),
      price:total,
      selected:!!selected
    };
  }
  function purchaseLinksForKey(key) {
    normalizeOps();
    return (state.ops.purchaseDb || []).filter(function (r) { return purchaseKey(r) === key; })
      .map(function (r) { return purchaseRowToLink(r, false); });
  }
  function bestPurchaseForKey(key) {
    normalizeOps();
    var raw = (state.ops.purchaseDb || []).filter(function (r) { return purchaseKey(r) === key; })
      .filter(function (r) { return purchaseTotal(r) || String(r.url || "").trim(); });
    if (!raw.length) return null;
    raw.sort(function (a, b) { return (purchaseTotal(a) || Infinity) - (purchaseTotal(b) || Infinity); });
    var b = raw[0];
    var price = toNumber(b.price), shipping = toNumber(b.shipping);
    var total = purchaseTotal(b) || 0;
    if (!(price > 0)) { price = total; shipping = 0; }   // 단가 미입력 행: 총원가를 단가로(배송비 0)
    // price=단가(수량 곱해짐), shipping=주문당 1회 배송비 — 마진에서 배송비가 수량배로 빠지지 않게 분리
    return { url:String(b.url || "").trim(), price:price, shipping:shipping, totalCost:total || null };
  }
  function writePurchaseLinks(key, links) {
    normalizeOps();
    var old = state.ops.purchaseDb || [];
    var kept = old.filter(function (r) { return purchaseKey(r) !== key; });
    var oldSame = old.filter(function (r) { return purchaseKey(r) === key; });
    var ex = (state.ops.lineupExtras || {})[key] || {};
    var productId = key.indexOf("name:") === 0 ? "" : key;
    var name = ex.name || (oldSame[0] && oldSame[0].name) || (key.indexOf("name:") === 0 ? key.slice(5) : "");
    links.forEach(function (c) {
      if (!c.url && !c.source && c.price == null && !c.memo) return;
      kept.push({
        id:c.id || newId("pdb"),
        productId:productId,
        name:name,
        platform:c.source || "",
        vendor:"",
        url:c.url || "",
        price:c.price != null ? toNumber(c.price) : "",
        shipping:0,
        totalCost:c.price != null ? toNumber(c.price) : "",
        best:c.selected ? "Y" : "",
        updated:"",
        memo:c.memo || ""
      });
    });
    state.ops.purchaseDb = kept;
  }
  function groupLinks(key) {
    var os = groupOrders(key);
    for (var i = 0; i < os.length; i++) {
      normalizeOrder(os[i]);
      if (os[i].sourcingLinks && os[i].sourcingLinks.length) return cloneSourcingLinks(os[i].sourcingLinks);
    }
    return cloneSourcingLinks(purchaseLinksForKey(key));
  }
  function applyGroupLinks(key, links) {
    links = cloneSourcingLinks(links);
    var selected = -1;
    links.forEach(function (c, i) { if (c.selected && selected < 0) selected = i; });
    if (selected < 0 && links.length) selected = 0;
    links.forEach(function (c, i) { c.selected = i === selected; });
    var primary = selectedSourcingLink(links);
    var primaryPrice = selectedSourcingPrice(links);
    groupOrders(key).forEach(function (o) {
      o.sourcingLinks = cloneSourcingLinks(links);
      o.sourcingLink = primary;
      if (primaryPrice != null) o.sourcingPrice = primaryPrice;
      computeMargin(o);
    });
    writePurchaseLinks(key, links);
    var x = lineExtra(key);
    if (primary) x.sourcingLink = primary;
    if (primaryPrice != null) x.sourcingPrice = primaryPrice;
  }
  function renderSourcingLinksPanel(g) {
    var links = cloneSourcingLinks(g.links || []);
    var body = links.length ? links.map(function (c, idx) {
      return '<div class="slink-row" data-slink-row="' + idx + '">' +
        '<label class="slink-primary" title="이 후보를 대표 소싱링크로 사용"><input type="radio" name="slink-' + esc(g.key) + '" data-slink-primary="' + idx + '" ' + (c.selected ? "checked" : "") + ' /> 대표</label>' +
        '<input class="slink-source" data-slink-source="' + idx + '" value="' + esc(c.source || "") + '" placeholder="소싱처 예: 에누리/도매처" />' +
        '<input class="slink-price" data-slink-price="' + idx + '" inputmode="numeric" value="' + (c.price != null ? esc(comma(c.price)) : "") + '" placeholder="가격" />' +
        '<input class="slink-memo" data-slink-memo="' + idx + '" value="' + esc(c.memo || "") + '" placeholder="메모 예: 3개 묶음/배송비/옵션 주의" />' +
        '<input class="slink-url" data-slink-url="' + idx + '" value="' + esc(c.url || "") + '" placeholder="링크 https://..." />' +
        (safeUrl(c.url) ? linkHtml(c.url) : '<span class="muted-mini">열기 ↗</span>') +
        '<button class="mini red" data-slink-del="' + idx + '" type="button">삭제</button>' +
      '</div>';
    }).join("") : '<div class="slink-empty">아직 후보 링크가 없습니다. [+ 후보 링크]를 눌러 추가하세요.</div>';
    return '<tr class="slink-detail" data-slinks-for="' + esc(g.key) + '"><td colspan="11">' +
      '<div class="slink-panel">' +
        '<div class="slink-head"><b>후보 소싱링크</b><span>소싱처 · 가격 · 메모 · 링크 기준으로 정리하고, 대표 체크한 후보가 주문관리 주문링크와 매입가로 들어갑니다.</span><button class="mini blue" data-slink-add type="button">+ 후보 링크</button></div>' +
        (links.length ? '<div class="slink-cols"><span>대표</span><span>소싱처</span><span>가격</span><span>메모</span><span>링크</span><span></span><span></span></div>' : '') +
        body +
      '</div></td></tr>';
  }
  function renderSourcing() {
    var pane = $("#pane-sourcing"); if (!pane) return;
    var groups = sourcingGroups();
    var withLink = groups.filter(function (g) { return g.link; }).length;
    var withPrice = groups.filter(function (g) { return g.price != null; }).length;
    var head = '<div class="panel-head"><h2>매입처DB</h2></div>' +
      '<div class="info-banner">품목별 <b>쿠팡링크·후보 소싱링크·매입가·판매량·순마진</b>을 관리합니다. 여기서 고치면 같은 상품의 <b>모든 주문에 반영</b>되고 마진이 자동 재계산돼요.<br>' +
      '<b>곧 추가</b>: 소싱 사이트 상품페이지에서 <b>[매입가·링크 추출]</b> 버튼으로 자동 수집 (지금 보고 있는 페이지에서 가져오는 방식).</div>';
    if (!groups.length) {
      pane.innerHTML = head + '<div class="soon"><h3>아직 상품이 없습니다</h3><p>발주서를 올리면 품목이 자동으로 모입니다.</p></div>';
      return;
    }
    head += '<div class="muted-note" style="margin-bottom:10px">품목 <b>' + groups.length + '</b>종 · 소싱링크 ' + withLink + ' · 매입가 ' + withPrice + '</div>';
    var rows = groups.map(function (g) {
      var open = !!(state.ui.sourcingOpen && state.ui.sourcingOpen[g.key]);
      var linkCount = (g.links || []).length;
      var marginRate = g.revenue && g.hasMargin ? Math.round(g.margin / g.revenue * 1000) / 10 : null;
      var src = selectedSourcingSource(g.links);
      return '<tr data-skey="' + esc(g.key) + '">' +
        '<td>' + esc(g.name || "(상품명 없음)") + '</td>' +
        '<td>' + linkHtml(g.coupangLink, "쿠팡 ↗") + '</td>' +
        '<td><input data-sf="link" value="' + esc(g.link || "") + '" placeholder="대표 소싱링크 https://..." />' +
          '<button class="mini purple slink-toggle" data-slink-toggle type="button">' + (open ? "후보 닫기" : "후보 링크") + ' ' + linkCount + '개</button></td>' +
        '<td>' + esc(src || "—") + '</td>' +
        '<td class="num"><input data-sf="price" inputmode="numeric" class="num-in" value="' + (g.price != null ? esc(comma(g.price)) : "") + '" placeholder="매입가" /></td>' +
        '<td class="num">' + esc(comma(g.qty)) + '</td>' +
        '<td class="num">' + esc(comma(g.count)) + '</td>' +
        '<td class="num">' + esc(won(g.revenue)) + '</td>' +
        '<td class="num ' + (g.hasMargin ? (g.margin >= 0 ? "pos" : "neg") : "") + '">' + (g.hasMargin ? esc(won(g.margin)) : "—") + '</td>' +
        '<td class="num">' + (marginRate == null ? "—" : esc(marginRate + "%")) + '<br><small class="muted-mini">완료 ' + g.completed + ' · 남음 ' + g.pending + ' · CS ' + g.csCount + '</small></td>' +
        '<td>' + linkHtml(g.link) + '</td>' +
      '</tr>' + (open ? renderSourcingLinksPanel(g) : "");
    }).join("");
    pane.innerHTML = head +
      '<div class="data-scroll"><table class="data sourcing-table"><thead><tr><th>상품명</th><th>쿠팡링크</th><th>대표 소싱링크</th><th>대표 소싱처</th><th class="num">매입가</th><th class="num">현재 판매량</th><th class="num">주문건</th><th class="num">현재 매출</th><th class="num">현재 총 순마진</th><th class="num">마진/상태</th><th>링크</th></tr></thead><tbody>' +
      rows + '</tbody></table></div>';
  }
  function onSourcingInput(e) {
    var el = e.target;
    if (el.matches("input[data-slink-source],input[data-slink-price],input[data-slink-url],input[data-slink-memo]")) {
      var detail = el.closest("tr[data-slinks-for]"); if (!detail) return;
      var dkey = detail.getAttribute("data-slinks-for");
      var links = groupLinks(dkey);
      var idx = parseInt(el.getAttribute("data-slink-source") || el.getAttribute("data-slink-price") || el.getAttribute("data-slink-url") || el.getAttribute("data-slink-memo"), 10);
      if (!links[idx]) return;
      if (el.matches("input[data-slink-source]")) links[idx].source = el.value.trim();
      else if (el.matches("input[data-slink-price]")) {
        var pv = toNumber(el.value);
        links[idx].price = (el.value.trim() === "" || pv <= 0) ? null : pv;
      }
      else if (el.matches("input[data-slink-url]")) links[idx].url = el.value.trim();
      else links[idx].memo = el.value.trim();
      applyGroupLinks(dkey, links);
      var main = detail.previousElementSibling && detail.previousElementSibling.querySelector('input[data-sf="link"]');
      if (main) main.value = selectedSourcingLink(links);
      var priceMain = detail.previousElementSibling && detail.previousElementSibling.querySelector('input[data-sf="price"]');
      var sp = selectedSourcingPrice(links);
      if (priceMain && sp != null) priceMain.value = comma(sp);
      schedulePersist();
      return;
    }
    if (!el.matches("input[data-sf]")) return;
    var tr = el.closest("tr[data-skey]"); if (!tr) return;
    var key = tr.getAttribute("data-skey"), field = el.getAttribute("data-sf");
    var linkedOrders = groupOrders(key);
    if (!linkedOrders.length) {
      var x = lineExtra(key);
      if (field === "link") x.sourcingLink = el.value.trim();
      else if (field === "price") x.sourcingPrice = el.value.trim() === "" ? "" : toNumber(el.value);
      var soloLinks = groupLinks(key);
      if (!soloLinks.length && (x.sourcingLink || x.sourcingPrice)) soloLinks.push({ id:newId("sl"), source:"", url:x.sourcingLink || "", memo:"", price:x.sourcingPrice || null, selected:true });
      if (soloLinks.length) {
        soloLinks[0].url = x.sourcingLink || soloLinks[0].url || "";
        if (x.sourcingPrice !== "") soloLinks[0].price = x.sourcingPrice || soloLinks[0].price || null;
        soloLinks[0].selected = true;
        writePurchaseLinks(key, soloLinks);
      }
      schedulePersist();
      return;
    }
    linkedOrders.forEach(function (o) {
      if (field === "link") {
        normalizeOrder(o);
        var links = cloneSourcingLinks(o.sourcingLinks);
        var sel = 0;
        for (var i = 0; i < links.length; i++) if (links[i].selected) { sel = i; break; }
        if (!links.length) links.push({ id:newId("sl"), source:"", url:"", memo:"", price:null, selected:true });
        links[sel].url = el.value.trim();
        links.forEach(function (c, idx) { c.selected = idx === sel; });
        o.sourcingLinks = links;
        o.sourcingLink = el.value.trim();
      }
      else if (field === "price") {
        var n = toNumber(el.value);
        o.sourcingPrice = (el.value.trim() === "" || n <= 0) ? null : n;
        normalizeOrder(o);
        var priceLinks = cloneSourcingLinks(o.sourcingLinks);
        if (priceLinks.length) {
          var selectedIdx = 0;
          for (var p = 0; p < priceLinks.length; p++) if (priceLinks[p].selected) { selectedIdx = p; break; }
          priceLinks[selectedIdx].price = o.sourcingPrice;
          o.sourcingLinks = priceLinks;
        }
        computeMargin(o);
      }
    });
    schedulePersist();
  }
  function onSourcingFocusOut(e) {
    var el = e.target;
    if (el.matches("input[data-slink-price],input[data-sf='price']")) formatMoneyInput(el);
  }
  function onSourcingClick(e) {
    var t = e.target;
    var tr = t.closest("tr[data-skey]");
    if (t.closest("[data-slink-toggle]") && tr) {
      var key = tr.getAttribute("data-skey");
      if (!state.ui.sourcingOpen) state.ui.sourcingOpen = {};
      state.ui.sourcingOpen[key] = !state.ui.sourcingOpen[key];
      persist(); renderSourcing();
      return;
    }
    var detail = t.closest("tr[data-slinks-for]");
    if (!detail) return;
    var dkey = detail.getAttribute("data-slinks-for");
    var links = groupLinks(dkey);
    if (t.closest("[data-slink-add]")) {
      links.push({ id:newId("sl"), source:"", url:"", memo:"", price:null, selected:!links.length });
      applyGroupLinks(dkey, links);
      if (!state.ui.sourcingOpen) state.ui.sourcingOpen = {};
      state.ui.sourcingOpen[dkey] = true;
      persist(); renderSourcing();
      return;
    }
    var del = t.closest("[data-slink-del]");
    if (del) {
      var di = parseInt(del.getAttribute("data-slink-del"), 10);
      var wasSelected = links[di] && links[di].selected;
      links.splice(di, 1);
      if (wasSelected && links.length) links[0].selected = true;
      applyGroupLinks(dkey, links);
      persist(); renderSourcing();
      return;
    }
    var primary = t.closest("[data-slink-primary]");
    if (primary) {
      var pi = parseInt(primary.getAttribute("data-slink-primary"), 10);
      links.forEach(function (c, idx) { c.selected = idx === pi; });
      applyGroupLinks(dkey, links);
      persist(); renderSourcing();
      toast("대표 소싱링크를 바꿨어요");
    }
  }

  /* ---------- 엑셀 보조 탭들: 프로세스 / 라인업 / 계산기 / 일별 / 송장 / 로스 / 일지 / 관리 ---------- */
  function fmtPct(n) {
    return n == null || isNaN(n) ? "—" : (Math.round(n * 10) / 10) + "%";
  }
  function lineExtra(key) {
    normalizeOps();
    if (!state.ops.lineupExtras[key]) state.ops.lineupExtras[key] = {};
    return state.ops.lineupExtras[key];
  }
  function findLineupExtraForOrder(o) {
    normalizeOps();
    var ex = state.ops.lineupExtras || {};
    if (o.productId && ex[o.productId]) return ex[o.productId];
    var nk = o.productName ? "name:" + o.productName : "";
    return nk && ex[nk] ? ex[nk] : null;
  }
  function lineupRows() {
    var map = {};
    sourcingGroups().forEach(function (g) {
      map[g.key] = Object.assign({}, g);
    });
    Object.keys((state.ops && state.ops.lineupExtras) || {}).forEach(function (key) {
      var x = state.ops.lineupExtras[key] || {};
      if (!map[key]) {
        map[key] = {
          key:key, name:x.name || "", productId:x.productId || (key.indexOf("name:") === 0 ? "" : key),
          coupangLink:x.coupangLink || "", link:x.sourcingLink || "", links:[], price:x.sourcingPrice,
          count:0, qty:0, revenue:0, margin:0, hasMargin:false, completed:0, pending:0, csCount:0
        };
      }
      if (x.name && !map[key].name) map[key].name = x.name;
      if (x.productId && !map[key].productId) map[key].productId = x.productId;
      if (x.coupangLink && !map[key].coupangLink) map[key].coupangLink = x.coupangLink;
      if (x.sourcingLink && !map[key].link) map[key].link = x.sourcingLink;
      if (x.sourcingPrice != null && map[key].price == null) map[key].price = x.sourcingPrice;
    });
    return Object.keys(map).map(function (k) { return map[k]; }).sort(function (a, b) {
      return String(a.name || a.productId).localeCompare(String(b.name || b.productId), "ko");
    });
  }
  function lineupCalc(g) {
    var x = lineExtra(g.key);
    var sale = toNumber(x.salePrice) || (g.qty ? Math.round(g.revenue / g.qty) : 0);
    var cost = toNumber(x.sourcingPrice != null ? x.sourcingPrice : g.price);
    var cls = classify(g.name || x.name || "");
    var fee = x.feeRate != null && x.feeRate !== "" ? rate100(x.feeRate) : effectiveRate(cls.feeRate);
    var rate = fee / 100;
    var margin = sale && cost ? Math.round(sale * (1 - rate) - cost) : null;
    var marginRate = sale && margin != null ? (margin / sale * 100) : null;
    function target(t) {
      if (!cost || (1 - rate - t) <= 0) return null;
      return Math.round(cost / (1 - rate - t));
    }
    var views = toNumber(x.views);
    var daily = views ? Math.round(views * 0.05 / 30 * 10) / 10 : null;
    var monthly = daily != null && margin != null ? Math.round(daily * 30 * margin) : null;
    var targetQty = toNumber(x.targetQty) || 0;
    return { sale:sale, cost:cost, fee:fee, margin:margin, marginRate:marginRate, breakEven:target(0), p5:target(.05), p10:target(.10), p15:target(.15), views:views, daily:daily, monthly:monthly, targetQty:targetQty, remaining:targetQty ? Math.max(0, targetQty - g.count) : null };
  }
  function renderProcessPane() {
    var pane = $("#pane-process"); if (!pane) return;
    var s = overviewStats();
    var notes = (state.ops && state.ops.processNotes || []).slice(0, 10);
    pane.innerHTML =
      '<div class="ops-head"><div><h2>프로세스</h2><p>발주서 업로드부터 송장파일까지 한 흐름으로 연결됩니다.</p></div></div>' +
      '<div class="ops-split">' +
        '<div class="ops-card"><h3>오늘 할 일</h3><div class="metric">' +
          '<span>주문 확인<em>' + s.total + '건</em></span>' +
          '<span>라인업 보완<em>' + lineupRows().filter(function (g) { return !g.price || !g.link; }).length + '개</em></span>' +
          '<span>CS 확인<em>' + s.csCount + '건</em></span>' +
        '</div></div>' +
        '<div class="ops-card"><h3>데이터 흐름</h3><p class="ops-note m-0">주문관리에서 상품이 들어오면 라인업과 매입처DB가 같은 상품ID를 기준으로 묶입니다. 라인업의 판매가·매입가를 바꾸면 순마진, 일별매출, 로스관리, 수익분석이 같이 바뀝니다.</p></div>' +
      '</div>' +
      '<div class="data-scroll mt-12"><table class="data"><thead><tr><th>단계</th><th>사용 탭</th><th>연동되는 값</th><th>다음 액션</th></tr></thead><tbody>' +
        '<tr><td>1</td><td>주문관리</td><td>쿠팡 발주서 주문 데이터</td><td>입력준비 후 구매 진행</td></tr>' +
        '<tr><td>2</td><td>라인업</td><td>판매가, 매입가, 목표가, 주문수</td><td>매입가/링크 보완</td></tr>' +
        '<tr><td>3</td><td>매입처DB</td><td>소싱처, 링크, 가격, 메모</td><td>대표 후보 선택</td></tr>' +
        '<tr><td>4</td><td>CS관리/로스관리</td><td>반품, 출고중지, CS차감</td><td>손익 반영</td></tr>' +
        '<tr><td>5</td><td>운송장업로드</td><td>택배사, 송장번호</td><td>쿠팡 업로드 파일 생성</td></tr>' +
      '</tbody></table></div>' +
      (notes.length ? '<div class="ops-card mt-12"><h3>원본 프로세스 메모</h3><div class="ops-note">' +
        notes.map(function (n) { return '<div>' + esc(n) + '</div>'; }).join("") + '</div></div>' : "");
  }
  function renderLineup() {
    var pane = $("#pane-lineup"); if (!pane) return;
    var rows = lineupRows();
    var body = rows.map(function (g) {
      var x = lineExtra(g.key), c = lineupCalc(g);
      return '<tr data-lineup-key="' + esc(g.key) + '">' +
        '<td><input data-lineup-field="name" value="' + esc(x.name || g.name || "") + '" placeholder="상품명" /></td>' +
        '<td><input data-lineup-field="productId" value="' + esc(x.productId || g.productId || "") + '" placeholder="상품ID" /></td>' +
        '<td class="num"><input data-lineup-field="views" inputmode="numeric" value="' + (c.views ? esc(comma(c.views)) : "") + '" /></td>' +
        '<td class="num"><input data-lineup-field="salePrice" inputmode="numeric" value="' + (c.sale ? esc(comma(c.sale)) : "") + '" /></td>' +
        '<td class="num"><input data-lineup-field="sourcingPrice" inputmode="numeric" value="' + (c.cost ? esc(comma(c.cost)) : "") + '" /></td>' +
        '<td class="num">' + fmtPct(c.fee) + '</td>' +
        '<td class="num ' + (c.margin != null ? (c.margin >= 0 ? "pos" : "neg") : "") + '">' + (c.margin == null ? "—" : won(c.margin)) + '</td>' +
        '<td class="num">' + fmtPct(c.marginRate) + '</td>' +
        '<td class="num">' + (c.breakEven ? esc(comma(c.breakEven)) : "—") + '</td>' +
        '<td class="num">' + (c.p5 ? esc(comma(c.p5)) : "—") + '</td>' +
        '<td class="num">' + (c.p10 ? esc(comma(c.p10)) : "—") + '</td>' +
        '<td class="num">' + (c.p15 ? esc(comma(c.p15)) : "—") + '</td>' +
        '<td class="num">' + (c.daily == null ? "—" : esc(c.daily)) + '</td>' +
        '<td class="num">' + (c.monthly == null ? "—" : won(c.monthly)) + '</td>' +
        '<td class="num"><input data-lineup-field="targetQty" inputmode="numeric" value="' + (c.targetQty ? esc(comma(c.targetQty)) : "") + '" /></td>' +
        '<td class="num">' + esc(comma(g.count)) + '</td>' +
        '<td class="num">' + (c.remaining == null ? "—" : c.remaining) + '</td>' +
        '<td><input data-lineup-field="coupangLink" value="' + esc(x.coupangLink || g.coupangLink || "") + '" placeholder="쿠팡링크" /></td>' +
        '<td><input data-lineup-field="sourcingLink" value="' + esc(x.sourcingLink || g.link || "") + '" placeholder="소싱링크" /></td>' +
      '</tr>';
    }).join("");
    pane.innerHTML =
      '<div class="ops-head"><div><h2>라인업</h2><p>소싱 라인업 · 마진계산 · 주문수 연동</p></div><div class="spacer"></div><button class="btn sm primary" data-lineup-add type="button">상품 추가</button></div>' +
      '<div class="ops-note">상품ID가 같으면 주문관리, 매입처DB, 수익분석이 같은 상품으로 묶입니다. 매입가를 바꾸면 주문관리의 순마진도 같이 바뀝니다.</div>' +
      (rows.length ? '<div class="data-scroll"><table class="data"><thead><tr><th>상품명</th><th>상품ID</th><th class="num">조회수</th><th class="num">판매가</th><th class="num">소싱가</th><th class="num">수수료</th><th class="num">마진</th><th class="num">마진율</th><th class="num">손익분기</th><th class="num">5%</th><th class="num">10%</th><th class="num">15%</th><th class="num">일예상</th><th class="num">월예상순익</th><th class="num">목표수량</th><th class="num">주문수</th><th class="num">남은</th><th>쿠팡링크</th><th>소싱링크</th></tr></thead><tbody>' + body + '</tbody></table></div>' : '<div class="soon"><h3>아직 상품이 없습니다</h3><p>발주서를 올리거나 상품 추가를 누르면 라인업이 시작됩니다.</p></div>');
  }
  function applyLineupToOrders(key) {
    var x = lineExtra(key);
    groupOrders(key).forEach(function (o) {
      if (x.name) o.productName = x.name;
      if (x.productId) o.productId = x.productId;
      if (x.sourcingLink) o.sourcingLink = x.sourcingLink;
      if (x.sourcingPrice != null && x.sourcingPrice !== "") o.sourcingPrice = toNumber(x.sourcingPrice);
      computeMargin(o);
    });
  }
  function onLineupInput(e) {
    var el = e.target;
    if (!el.matches("[data-lineup-field]")) return;
    var tr = el.closest("[data-lineup-key]"); if (!tr) return;
    var key = tr.getAttribute("data-lineup-key");
    var field = el.getAttribute("data-lineup-field");
    var x = lineExtra(key);
    if (["views","salePrice","sourcingPrice","targetQty"].indexOf(field) !== -1) x[field] = el.value.trim() === "" ? "" : toNumber(el.value);
    else x[field] = el.value.trim();
    applyLineupToOrders(key);
    renderSummary(); renderOrdersDashboard(); schedulePersist();
  }
  // 행의 계산 셀만 제자리 갱신 — focusout마다 전체 재렌더하면 Tab 이동 시 포커스가 유실됨
  function refreshLineupRow(tr) {
    var key = tr.getAttribute("data-lineup-key");
    var g = lineupRows().filter(function (r) { return r.key === key; })[0];
    if (!g) return;
    var c = lineupCalc(g), tds = tr.children;
    function setNum(i, text, signCls) {
      if (!tds[i]) return;
      tds[i].textContent = text;
      if (signCls !== undefined) tds[i].className = "num" + (signCls ? " " + signCls : "");
    }
    setNum(5, fmtPct(c.fee));
    setNum(6, c.margin == null ? "—" : won(c.margin), c.margin != null ? (c.margin >= 0 ? "pos" : "neg") : "");
    setNum(7, fmtPct(c.marginRate));
    setNum(8, c.breakEven ? comma(c.breakEven) : "—");
    setNum(9, c.p5 ? comma(c.p5) : "—");
    setNum(10, c.p10 ? comma(c.p10) : "—");
    setNum(11, c.p15 ? comma(c.p15) : "—");
    setNum(12, c.daily == null ? "—" : String(c.daily));
    setNum(13, c.monthly == null ? "—" : won(c.monthly));
    setNum(16, c.remaining == null ? "—" : String(c.remaining));
  }
  function onLineupFocusOut(e) {
    if (!e.target.matches("[data-lineup-field]")) return;
    if (e.target.matches("[data-lineup-field='views'],[data-lineup-field='salePrice'],[data-lineup-field='sourcingPrice'],[data-lineup-field='targetQty']")) formatMoneyInput(e.target);
    schedulePersist();
    var tr = e.target.closest("[data-lineup-key]");
    if (!tr) return;
    var field = e.target.getAttribute("data-lineup-field");
    // 상품명·상품ID는 그룹 키를 바꿔 행 병합/분리가 일어날 수 있음 → 같은 행 안에서 이동 중이면
    // 부분 갱신으로 포커스를 지키고, 행을 떠나는 순간 전체 재렌더로 재그룹
    if (field === "name" || field === "productId") {
      var next = e.relatedTarget;
      if (next && tr.contains(next)) { refreshLineupRow(tr); return; }
      persist();
      renderLineup();
      return;
    }
    refreshLineupRow(tr);
  }
  function onLineupClick(e) {
    if (!e.target.closest("[data-lineup-add]")) return;
    normalizeOps();
    var key = "name:" + newId("line");
    state.ops.lineupExtras[key] = { name:"", productId:"", views:"", salePrice:"", sourcingPrice:"", targetQty:"", coupangLink:"", sourcingLink:"" };
    persist(); renderLineup();
  }
  function renderMarginCalc() {
    var pane = $("#pane-calc"); if (!pane) return;
    normalizeOps();
    if (!state.ops.calcRows.length) state.ops.calcRows.push({ id:newId("calc"), name:"", cost:120000, sale:149000, fee:10.6 });
    var rows = state.ops.calcRows.map(function (r, i) {
      var cost = toNumber(r.cost), sale = toNumber(r.sale), fee = effectiveRate(rate100(r.fee)), rate = fee / 100;   // 주문관리와 동일하게 VAT 설정 존중
      var margin = sale ? Math.round(sale * (1 - rate) - cost) : null;
      var breakEven = cost && (1 - rate) > 0 ? Math.round(cost / (1 - rate)) : null;
      function t(p){ return cost && (1 - rate - p) > 0 ? Math.round(cost / (1 - rate - p)) : null; }
      return '<tr data-calc-idx="' + i + '"><td><input data-calc-field="name" value="' + esc(r.name || "") + '" placeholder="제품명" /></td>' +
        '<td class="num"><input data-calc-field="cost" inputmode="numeric" value="' + esc(comma(cost)) + '" /></td>' +
        '<td class="num"><input data-calc-field="sale" inputmode="numeric" value="' + esc(comma(sale)) + '" /></td>' +
        '<td class="num"><input data-calc-field="fee" inputmode="decimal" value="' + esc(r.fee || "") + '" /></td>' +
        '<td class="num">' + esc(comma(breakEven)) + '</td><td class="num ' + (margin >= 0 ? "pos" : "neg") + '">' + won(margin) + '</td>' +
        '<td class="num">' + fmtPct(sale ? margin / sale * 100 : null) + '</td><td class="num">' + esc(comma(t(.05))) + '</td><td class="num">' + esc(comma(t(.10))) + '</td><td class="num">' + esc(comma(t(.15))) + '</td>' +
        '<td><button class="mini red" data-calc-del type="button">삭제</button></td></tr>';
    }).join("");
    pane.innerHTML = '<div class="ops-head"><div><h2>마진계산기</h2><p>소싱가·판매가·수수료로 손익분기와 목표가를 빠르게 봅니다.</p></div><div class="spacer"></div><button class="btn sm primary" data-calc-add type="button">행 추가</button></div>' +
      '<div class="data-scroll"><table class="data"><thead><tr><th>제품명</th><th class="num">소싱가격</th><th class="num">판매가격</th><th class="num">수수료%</th><th class="num">0지점</th><th class="num">순마진</th><th class="num">마진율</th><th class="num">5% 지점</th><th class="num">10% 지점</th><th class="num">15% 지점</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  }
  function onCalcInput(e) {
    var el = e.target; if (!el.matches("[data-calc-field]")) return;
    var tr = el.closest("[data-calc-idx]"), idx = tr ? parseInt(tr.getAttribute("data-calc-idx"), 10) : -1;
    if (!state.ops.calcRows[idx]) return;
    var f = el.getAttribute("data-calc-field");
    state.ops.calcRows[idx][f] = f === "name" ? el.value : toNumber(el.value);
    schedulePersist();
  }
  // 계산 셀만 제자리 갱신 (Tab 연속 입력 시 포커스 보존)
  function refreshCalcRow(tr) {
    var i = parseInt(tr.getAttribute("data-calc-idx"), 10);
    var r = state.ops.calcRows[i]; if (!r) return;
    var cost = toNumber(r.cost), sale = toNumber(r.sale), fee = effectiveRate(rate100(r.fee)), rate = fee / 100;
    var margin = sale ? Math.round(sale * (1 - rate) - cost) : null;
    var breakEven = cost && (1 - rate) > 0 ? Math.round(cost / (1 - rate)) : null;
    function t(p) { return cost && (1 - rate - p) > 0 ? Math.round(cost / (1 - rate - p)) : null; }
    var tds = tr.children;
    if (tds[4]) tds[4].textContent = comma(breakEven);
    if (tds[5]) { tds[5].textContent = won(margin); tds[5].className = "num " + (margin >= 0 ? "pos" : "neg"); }
    if (tds[6]) tds[6].textContent = fmtPct(sale ? margin / sale * 100 : null);
    if (tds[7]) tds[7].textContent = comma(t(.05));
    if (tds[8]) tds[8].textContent = comma(t(.10));
    if (tds[9]) tds[9].textContent = comma(t(.15));
  }
  function onCalcFocusOut(e) {
    var el = e.target;
    if (!el.matches("[data-calc-field]")) return;
    if (el.matches("[data-calc-field='cost'],[data-calc-field='sale']")) formatMoneyInput(el);
    schedulePersist();
    var tr = el.closest("[data-calc-idx]");
    if (tr) refreshCalcRow(tr);
  }
  function onCalcClick(e) {
    normalizeOps();
    if (e.target.closest("[data-calc-add]")) { state.ops.calcRows.push({ id:newId("calc"), name:"", cost:0, sale:0, fee:10.6 }); persist(); renderMarginCalc(); return; }
    var del = e.target.closest("[data-calc-del]");
    if (del) { var tr = del.closest("[data-calc-idx]"); state.ops.calcRows.splice(parseInt(tr.getAttribute("data-calc-idx"), 10), 1); persist(); renderMarginCalc(); }
  }
  function dailySalesRows() {
    var by = {};
    state.orders.forEach(function (o) {
      var d = parseOrderDate(o.orderDate);
      var k = d ? d.getFullYear() + "-" + ("0" + (d.getMonth()+1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2) : "날짜없음";
      if (!by[k]) by[k] = { date:k, cnt:0, rev:0, margin:0, hasM:false };
      by[k].cnt++; by[k].rev += o.paymentAmount || 0;
      if (o.margin != null) { by[k].margin += o.margin; by[k].hasM = true; }
    });
    return Object.keys(by).sort().map(function (k) { return by[k]; });
  }
  function renderDailySales() {
    var pane = $("#pane-daily"); if (!pane) return;
    var rows = dailySalesRows();
    var body = rows.map(function (g) {
      var rate = g.rev && g.hasM ? g.margin / g.rev * 100 : null;
      return '<tr><td>' + esc(g.date) + '</td><td class="num">' + g.cnt + '</td><td class="num">' + won(g.rev) + '</td><td class="num ' + (g.hasM ? (g.margin >= 0 ? "pos" : "neg") : "") + '">' + (g.hasM ? won(g.margin) : "—") + '</td><td class="num">' + fmtPct(rate) + '</td></tr>';
    }).join("");
    pane.innerHTML = '<div class="ops-head"><div><h2>일별매출</h2><p>주문관리 주문일 기준 자동 집계</p></div></div>' +
      (rows.length ? '<div class="data-scroll"><table class="data"><thead><tr><th>날짜</th><th class="num">주문건수</th><th class="num">매출</th><th class="num">순마진</th><th class="num">수익률</th></tr></thead><tbody>' + body + '</tbody></table></div>' : '<div class="soon"><h3>집계할 주문이 없습니다</h3><p>발주서를 올리면 날짜별 매출이 자동으로 쌓입니다.</p></div>');
  }
  function renderInvoicePane() {
    var pane = $("#pane-invoice"); if (!pane) return;
    var rows = state.orders.map(function (o, i) {
      var badge;
      if (o.courier && o.invoiceNumber && invoiceExcluded(o)) badge = '<span class="thin-badge excluded">' + esc(o.csType) + ' — 제외</span>';
      else if (o.courier && o.invoiceNumber) badge = '<span class="thin-badge best-badge">업로드 가능</span>';
      else badge = '<span class="thin-badge">대기</span>';
      return '<tr><td>' + (i + 1) + '</td><td>' + esc(o.orderNumber || "") + '</td><td>' + esc(o.productName || "") + '</td><td>' + esc(o.courier || "") + '</td><td>' + esc(o.invoiceNumber || "") + '</td><td>' + badge + '</td></tr>';
    }).join("");
    pane.innerHTML = '<div class="ops-head"><div><h2>운송장업로드</h2><p>택배사·송장번호를 채운 뒤 <b>소스 양식(36열)</b> 파일로 내보내 수집 프로그램에 올립니다. 출고중지·반품 건은 송장 칸이 비워져 나갑니다.</p></div><div class="spacer"></div><button class="btn sm primary" data-invoice-export type="button">송장 파일 만들기 (36열)</button><button class="btn sm" data-invoice-export-coupang type="button">쿠팡 39열</button></div>' +
      '<div class="data-scroll"><table class="data"><thead><tr><th>#</th><th>주문번호</th><th>상품명</th><th>택배사</th><th>송장번호</th><th>상태</th></tr></thead><tbody>' + (rows || '<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:28px">내보낼 송장이 없습니다 — 주문관리에서 택배사·송장번호를 입력하면 여기에 표시됩니다</td></tr>') + '</tbody></table></div>';
  }
  function renderLossPane() {
    var pane = $("#pane-loss"); if (!pane) return;
    var list = state.orders.filter(function (o) { return (o.margin != null && o.margin < 0) || o.csType || toNumber(o.csCost) > 0; });
    var body = list.map(function (o) {
      return '<tr><td>' + esc(o.orderDate || "") + '</td><td>' + esc(o.orderNumber || "") + '</td><td>' + esc(o.productName || "") + '</td><td class="num">' + won(o.paymentAmount) + '</td><td class="num">' + (o.sourcingPrice != null ? won(o.sourcingPrice) : "—") + '</td><td class="num neg">' + (o.margin != null ? won(o.margin) : "—") + '</td><td>' + esc(csLabel(o)) + '</td><td class="num">' + (toNumber(o.csCost) ? won(-o.csCost) : "—") + '</td></tr>';
    }).join("");
    pane.innerHTML = '<div class="ops-head"><div><h2>로스관리</h2><p>마이너스 마진, 반품, 출고중지, CS차감 주문을 자동으로 모읍니다.</p></div></div>' +
      (list.length ? '<div class="data-scroll"><table class="data"><thead><tr><th>주문일</th><th>주문번호</th><th>상품명</th><th class="num">매출</th><th class="num">매입가</th><th class="num">순마진</th><th>CS</th><th class="num">차감</th></tr></thead><tbody>' + body + '</tbody></table></div>' : '<div class="soon"><h3>로스 항목이 없습니다</h3><p>반품/출고중지 또는 마이너스 마진 주문이 생기면 자동으로 표시됩니다.</p></div>');
  }
  function journalRows(kind) {
    normalizeOps();
    var arr = kind === "main" ? state.ops.journalMain : state.ops.journalSide;
    var daily = dailySalesRows();
    var mutated = false;
    if (!arr.length) {
      for (var i = 0; i < 31; i++) arr.push({ day:i + 1, date:"", uploads:"", sales:"", cert:"", note:"" });
      mutated = true;
    }
    arr.forEach(function (r) {
      var hit = daily.filter(function (d) { return d.date === r.date; })[0];
      if (hit && !r.sales) { r.sales = Math.round(hit.rev / 10000); mutated = true; }
    });
    if (mutated) schedulePersist();   // 렌더 중 생긴 변형이 새로고침에 유실되지 않게
    return arr;
  }
  function renderJournalTable(kind, title, target) {
    var rows = journalRows(kind).map(function (r, i) {
      return '<tr data-journal-kind="' + kind + '" data-journal-idx="' + i + '"><td class="num">' + (i + 1) + '</td><td><input data-journal-field="date" value="' + esc(r.date || "") + '" placeholder="YYYY-MM-DD" /></td><td class="num"><input data-journal-field="uploads" inputmode="numeric" value="' + esc(r.uploads || "") + '" /></td><td class="num"><input data-journal-field="sales" inputmode="numeric" value="' + esc(r.sales || "") + '" /></td><td><input data-journal-field="cert" value="' + esc(r.cert || "") + '" /></td><td><input data-journal-field="note" value="' + esc(r.note || "") + '" /></td></tr>';
    }).join("");
    return '<div class="ops-card"><h3>' + esc(title) + '</h3><p class="ops-note">목표: 매일 ' + target + '개 업로드. 매출은 주문 데이터와 날짜가 맞으면 자동 참고됩니다.</p><div class="data-scroll"><table class="data"><thead><tr><th class="num">일차</th><th>날짜</th><th class="num">업로드</th><th class="num">매출(만원)</th><th>인증</th><th>막힌 점</th></tr></thead><tbody>' + rows + '</tbody></table></div></div>';
  }
  function renderJournalPane() {
    var pane = $("#pane-journal"); if (!pane) return;
    pane.innerHTML = '<div class="ops-head"><div><h2>수행일지</h2><p>부업/본업 업로드 목표와 매출 기록을 한 화면에서 관리합니다.</p></div></div><div class="ops-split">' +
      renderJournalTable("side", "수행일지·부업", 5) + renderJournalTable("main", "수행일지·본업", 15) + '</div>';
  }
  function onJournalInput(e) {
    var el = e.target; if (!el.matches("[data-journal-field]")) return;
    var tr = el.closest("[data-journal-kind]"); if (!tr) return;
    var arr = tr.getAttribute("data-journal-kind") === "main" ? state.ops.journalMain : state.ops.journalSide;
    var idx = parseInt(tr.getAttribute("data-journal-idx"), 10);
    arr[idx][el.getAttribute("data-journal-field")] = el.value;
    schedulePersist();
  }
  var SIMPLE_OPS = {
    accounts:{ pane:"pane-accounts", title:"계정관리", desc:"판매 계정 백업 정보를 로컬에만 저장합니다.", store:"accounts", fields:["platform","id","password","owner","memo"], labels:["플랫폼","아이디","비밀번호","명의","메모"] },
    cards:{ pane:"pane-cards", title:"카드관리", desc:"결제 카드 한도와 결제일을 로컬에만 저장합니다.", store:"cards", fields:["name","limit","payDate","use","memo"], labels:["카드명","한도","결제일","사용처","메모"] }
  };
  function renderSimpleOpsTable(type) {
    var cfg = SIMPLE_OPS[type], pane = cfg && $("#" + cfg.pane); if (!pane) return;
    normalizeOps();
    var arr = state.ops[cfg.store];
    var hasSensitive = cfg.fields.indexOf("password") !== -1;
    var body = arr.map(function (r, i) {
      return '<tr data-simple-type="' + type + '" data-simple-idx="' + i + '">' + cfg.fields.map(function (f, fi) {
        // 비밀번호는 HTML 문자열에 값을 넣지 않음(소스/DOM 검사 평문 노출 방지) — 렌더 후 property로 주입
        var inputType = f === "password" ? ' type="password" autocomplete="off"' : "";
        var val = f === "password" ? "" : ' value="' + esc(r[f] || "") + '"';
        return '<td><input data-simple-field="' + f + '"' + inputType + val + ' placeholder="' + esc(cfg.labels[fi]) + '" /></td>';
      }).join("") + '<td><button class="mini red" data-simple-del type="button">삭제</button></td></tr>';
    }).join("");
    pane.innerHTML = '<div class="ops-head"><div><h2>' + esc(cfg.title) + '</h2><p>' + esc(cfg.desc) + '</p></div><div class="spacer"></div><button class="btn sm primary" data-simple-add="' + type + '" type="button">행 추가</button></div>' +
      '<div class="ops-note">이 탭의 값은 이 브라우저 로컬 저장소에만 저장됩니다. 내보내기를 누르기 전까지 파일로 나가지 않습니다.' +
      (hasSensitive ? ' 비밀번호는 암호화 없이 저장되므로 공용 PC에서는 저장하지 않는 것을 권장합니다.' : '') + '</div>' +
      '<div class="data-scroll"><table class="data"><thead><tr>' + cfg.labels.map(function (l) { return '<th>' + esc(l) + '</th>'; }).join("") + '<th></th></tr></thead><tbody>' + (body || '<tr><td colspan="' + (cfg.labels.length + 1) + '" style="text-align:center;color:var(--muted);padding:28px">저장된 항목이 없습니다 — [행 추가]로 시작하세요</td></tr>') + '</tbody></table></div>';
    // 비밀번호 값은 DOM property로만 주입
    if (hasSensitive) {
      $$('input[data-simple-field="password"]', pane).forEach(function (input) {
        var tr = input.closest("[data-simple-idx]");
        var row = arr[parseInt(tr.getAttribute("data-simple-idx"), 10)];
        if (row) input.value = row.password || "";
      });
    }
  }
  function onSimpleOpsInput(e) {
    var el = e.target; if (!el.matches("[data-simple-field]")) return;
    var tr = el.closest("[data-simple-type]"); if (!tr) return;
    var cfg = SIMPLE_OPS[tr.getAttribute("data-simple-type")], idx = parseInt(tr.getAttribute("data-simple-idx"), 10);
    if (!cfg || !state.ops[cfg.store][idx]) return;
    state.ops[cfg.store][idx][el.getAttribute("data-simple-field")] = el.value;
    schedulePersist();
  }
  function onSimpleOpsClick(e) {
    var add = e.target.closest("[data-simple-add]");
    if (add) {
      var type = add.getAttribute("data-simple-add"), cfg = SIMPLE_OPS[type], row = {};
      cfg.fields.forEach(function (f) { row[f] = ""; });
      state.ops[cfg.store].push(row);
      persist(); renderSimpleOpsTable(type); return;
    }
    var del = e.target.closest("[data-simple-del]");
    if (del) {
      var tr = del.closest("[data-simple-type]"), type2 = tr.getAttribute("data-simple-type"), cfg2 = SIMPLE_OPS[type2];
      state.ops[cfg2.store].splice(parseInt(tr.getAttribute("data-simple-idx"), 10), 1);
      persist(); renderSimpleOpsTable(type2);
    }
  }

  /* ---------- 수익분석 탭 ---------- */
  function renderProfit() {
    var pane = $("#pane-profit"); if (!pane) return;
    var s = overviewStats();
    var byCat = {};
    state.orders.forEach(function (o) {
      var c = o.category || "기타";
      if (!byCat[c]) byCat[c] = { cat:c, cnt:0, rev:0, margin:0, hasM:false };
      var g = byCat[c]; g.cnt++; g.rev += o.paymentAmount || 0;
      if (o.margin != null) { g.margin += o.margin; g.hasM = true; }
    });
    var cats = Object.keys(byCat).map(function (k) { return byCat[k]; }).sort(function (a, b) { return b.rev - a.rev; });
    var head = '<div class="panel-head"><h2>수익분석</h2></div>' +
      '<div class="ov-grid">' +
        ovCard("총 매출", won(s.rev)) +
        ovCard("예상 순수익", s.hasMargin ? won(s.margin) : "매입가 입력 필요", s.hasMargin ? (s.margin >= 0 ? "pos" : "neg") : "") +
        ovCard("평균 마진율", s.hasMargin ? fmtPct(s.rate) : "—") +
        ovCard("CS 차감액", s.csCost ? won(-s.csCost) : "—", s.csCost ? "neg" : "") +
        ovCard("주문 건수", s.total + "건") +
        ovCard("품목(업로드) 수", s.prodCount + "종") +
        ovCard("송장완료", s.invoiced + "건") +
      '</div>' +
      '<div class="info-banner">"업로드 수"는 현재 <b>품목(노출상품ID) 수</b>로 추정 표시합니다. 실제 업로드 현황은 업로드 보조도구 연동 시 정확히 집계됩니다.</div>';
    var rows = cats.map(function (g) {
      var rate = g.rev ? Math.round(g.margin / g.rev * 1000) / 10 : 0;
      return '<tr><td>' + esc(g.cat) + '</td><td class="num">' + g.cnt + '</td><td class="num">' + won(g.rev) + '</td>' +
        '<td class="num ' + (g.hasM ? (g.margin >= 0 ? "pos" : "neg") : "") + '">' + (g.hasM ? won(g.margin) : "—") + '</td>' +
        '<td class="num">' + (g.hasM ? fmtPct(rate) : "—") + '</td></tr>';
    }).join("");
    var foot = '<tfoot><tr><td>합계</td><td class="num">' + s.total + '</td><td class="num">' + won(s.rev) + '</td>' +
      '<td class="num">' + (s.hasMargin ? won(s.margin) : "—") + '</td><td class="num">' + (s.hasMargin ? fmtPct(s.rate) : "—") + '</td></tr></tfoot>';
    var table = cats.length
      ? '<div class="data-scroll"><table class="data"><thead><tr><th>카테고리</th><th class="num">건수</th><th class="num">매출</th><th class="num">예상순수익</th><th class="num">마진율</th></tr></thead><tbody>' + rows + '</tbody>' + foot + '</table></div>'
      : '<div class="soon"><h3>분석할 주문이 없습니다</h3><p>발주서를 올리면 매출·순수익이 집계됩니다.</p></div>';
    pane.innerHTML = head + table;
  }

  /* =====================================================================
   * 공용 헬퍼 (시트·CS·메모에서 사용)
   * ===================================================================== */
  function findOrder(id) { for (var i = 0; i < state.orders.length; i++) if (state.orders[i].id === id) return state.orders[i]; return null; }

  function formatAddress(o) {
    var fmt = state.rules.copyFormat || "{name} / {phone} / ({zip}) {address}";
    return fmt
      .replace(/\{name\}/g, o.recipient || "")
      .replace(/\{phone\}/g, o.phone || "")
      .replace(/\{zip\}/g, o.zipcode || "")
      .replace(/\{address\}/g, o.address || "")
      .replace(/\(\)\s*/g, "")   // 우편번호 없을 때 빈 괄호 제거
      .replace(/\s+\/\s+\//g, " /").trim();
  }

  /* =====================================================================
   * 📊 앱 내장 시트 (엑셀 없이 — 이 표가 곧 시트, 고치면 자동 저장)
   *  - state.orders 를 그대로 편집하는 그리드. 화면에서 고친 값은 즉시
   *    저장되고 새로고침해도 유지됩니다(자동 시트 연동).
   *  - 계산열(카테고리·수수료·마진)은 입력값을 바꾸면 그 자리에서 자동 재계산.
   *  - 엑셀/구글시트에서 복사한 '블록'을 칸에 그대로 붙여넣기 가능.
   * ===================================================================== */
  var SHEET_COLS = [
    { key:"done",          label:"완료",       type:"done",    w:58  },
    { key:"rowActions",    label:"입력",       type:"actions", w:68  },
    { key:"orderId",       label:"주문번호(구매처)", type:"text", w:124 },
    { key:"manager",       label:"담당자",     type:"text",    w:76  },
    { key:"vendor",        label:"구매처",     type:"text",    w:88  },
    { key:"account",       label:"계정",       type:"text",    w:110 },
    { key:"sourcingLink",  label:"구매링크",   type:"text",    w:220 },
    { key:"sourcingPrice", label:"구매가",     type:"num",     w:88  },
    { key:"purchaseAmount",label:"구매금액",   type:"num",     w:92  },
    { key:"card",          label:"카드",       type:"text",    w:66  },
    { key:"point",         label:"포인트",     type:"num",     w:70  },
    { key:"margin",        label:"순마진",     type:"calc",    w:126 },
    { key:"orderDate",     label:"주문일",     type:"text",    w:112 },
    { key:"orderNumber",   label:"주문번호",   type:"text",    w:142 },
    { key:"productName",   label:"상품명",     type:"text",    w:260 },
    { key:"option",        label:"옵션",       type:"text",    w:150 },
    { key:"quantity",      label:"수량",       type:"num",     w:58  },
    { key:"paymentAmount", label:"결제액",     type:"num",     w:96  },
    { key:"csCost",        label:"CS차감",     type:"num",     w:88  },
    { key:"recipient",     label:"수취인",     type:"text",    w:88  },
    { key:"phone",         label:"전화",       type:"text",    w:126 },
    { key:"zipcode",       label:"우편번호",   type:"text",    w:82  },
    { key:"address",       label:"주소",       type:"text",    w:310 },
    { key:"deliveryMsg",   label:"배송메세지", type:"text",    w:120 },
    { key:"note",          label:"한줄메모",   type:"text",    w:140 },
    { key:"courier",       label:"택배사",     type:"courier", w:118 },
    { key:"invoiceNumber", label:"송장번호",   type:"text",    w:132 },
    { key:"status",        label:"상태",       type:"calc",    w:100 },
    { key:"stopCheck",     label:"출고중지",   type:"stop",    w:76  },
    { key:"returnCheck",   label:"반품접수",   type:"return",  w:76  }
  ];
  function customSheetCols() {
    return (state.ui.customCols || []).map(function (c) {
      return {
        key: c.key,
        label: c.label || "사용자열",
        type: "custom",
        w: c.w || 140,
        custom: true
      };
    });
  }
  function baseColByKey(key) {
    for (var i = 0; i < SHEET_COLS.length; i++) if (SHEET_COLS[i].key === key) return SHEET_COLS[i];
    var customs = customSheetCols();
    for (var j = 0; j < customs.length; j++) if (customs[j].key === key) return customs[j];
    return null;
  }
  function orderedSheetCols() {
    var seen = {}, out = [];
    (state.ui.colOrder || []).forEach(function (key) {
      var c = baseColByKey(key);
      if (c && !seen[key]) { out.push(c); seen[key] = true; }
    });
    SHEET_COLS.forEach(function (c) {
      if (!seen[c.key]) out.push(c);
    });
    customSheetCols().forEach(function (c) {
      if (!seen[c.key]) out.push(c);
    });
    return out;
  }
  function defaultSheetColOrder() {
    return SHEET_COLS.map(function (c) { return c.key; }).concat(
      customSheetCols().map(function (c) { return c.key; })
    );
  }
  function normalizeSheetLayoutForCurrentVersion() {
    if (!state.ui) return;
    if (state.ui.layoutVersion !== SHEET_LAYOUT_VERSION) {
      state.ui.colOrder = defaultSheetColOrder();
      state.ui.rowHeights = {};
      state.ui.layoutVersion = SHEET_LAYOUT_VERSION;
      return;
    }
    var seen = {};
    state.ui.colOrder = (state.ui.colOrder || []).filter(function (key) {
      if (seen[key] || !baseColByKey(key)) return false;
      seen[key] = true;
      return true;
    });
  }
  // 편집 가능한 열만(블록 붙여넣기·키보드 상하이동의 열 인덱스 기준)
  function sheetEditCols() {
    return orderedSheetCols().filter(function (c) {
      return ["calc", "actions", "memo", "done", "stop", "return"].indexOf(c.type) === -1;
    });
  }
  function colIndex(key) {
    var cols = sheetEditCols();
    for (var i = 0; i < cols.length; i++) if (cols[i].key === key) return i;
    return -1;
  }

  // 시트에 보일 행: 검색어·상태 필터는 적용하되 순서는 원본 유지(편집·붙여넣기 예측 가능)
  function sheetFiltered() {
    var q = norm(state.ui.q);
    var list = state.orders.filter(function (o) {
      if (isCsOrder(o)) return false;
      if (state.ui.status !== "all" && o.status !== state.ui.status) return false;
      if (q) {
        var hay = norm(o.productName + o.recipient + o.orderNumber + o.option + o.address + csLabel(o) +
          (o.uniqueNo || "") + (o.orderId || "") + (o.vendor || "") + (o.account || "") + (o.note || "") + (o.invoiceNumber || ""));
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
    var sorters = {
      pendingFirst: function (a, b) { return (statusRank(a) - statusRank(b)) || String(a.orderNumber).localeCompare(String(b.orderNumber), "ko"); },
      marginDesc: function (a, b) { return (b.margin || -Infinity) - (a.margin || -Infinity); },
      marginAsc:  function (a, b) { return (a.margin || Infinity) - (b.margin || Infinity); },
      name:       function (a, b) { return String(a.productName).localeCompare(String(b.productName), "ko"); },
      order:      function (a, b) { return String(a.orderNumber).localeCompare(String(b.orderNumber), "ko"); },
      dateDesc:   function (a, b) { return (parseOrderDate(b.orderDate) || 0) - (parseOrderDate(a.orderDate) || 0); },
      status:     function (a, b) { return (statusRank(a) - statusRank(b)) || String(a.orderNumber).localeCompare(String(b.orderNumber), "ko"); },
      product:    function (a, b) { return String(a.productName).localeCompare(String(b.productName), "ko") || String(a.orderNumber).localeCompare(String(b.orderNumber), "ko"); }
    };
    list.sort(sorters[state.ui.sort] || sorters.pendingFirst);
    return list;
  }
  function statusRank(o) { return ({ pending:0, purchased:1, invoiced:2 })[o.status] || 0; }
  function groupKeyFor(o) {
    var g = state.ui.group || "none";
    if (g === "product") return o.productName || "(상품명 없음)";
    if (g === "date") return monthKey(o.orderDate);
    if (g === "status") return statusLabel(o.status);
    return "";
  }
  function displayRows() {
    var list = sheetFiltered(), group = state.ui.group || "none";
    if (group === "none") return list.map(function (o) { return { type:"order", order:o }; });
    list.sort(function (a, b) {
      return groupKeyFor(a).localeCompare(groupKeyFor(b), "ko") || String(a.orderNumber).localeCompare(String(b.orderNumber), "ko");
    });
    var out = [], last = null, bucket = [];
    function flush() {
      if (last == null) return;
      var rev = 0, margin = 0, hasM = false;
      bucket.forEach(function (o) { rev += o.paymentAmount || 0; if (o.margin != null) { margin += o.margin; hasM = true; } });
      out.push({ type:"group", label:last, count:bucket.length, rev:rev, margin:margin, hasMargin:hasM });
      bucket.forEach(function (o) { out.push({ type:"order", order:o }); });
    }
    list.forEach(function (o) {
      var k = groupKeyFor(o) || "(없음)";
      if (last !== null && k !== last) { flush(); bucket = []; }
      last = k; bucket.push(o);
    });
    flush();
    return out;
  }



  function statusSelectHtml(o) {
    var opts = [["pending","미처리"],["purchased","구매완료"],["invoiced","송장입력완료"]];
    return '<select data-k="status" data-col="' + colIndex("status") + '" class="s-' + o.status + '">' +
      opts.map(function (p) { return '<option value="' + p[0] + '"' + (o.status === p[0] ? " selected" : "") + '>' + p[1] + '</option>'; }).join("") +
      '</select>';
  }
  function courierSelectHtml(o) {
    var cur = o.courier || "";
    return '<select data-k="courier" data-col="' + colIndex("courier") + '"><option value="">(택배사)</option>' +
      COURIERS.map(function (c) { return '<option' + (c === cur ? " selected" : "") + '>' + esc(c) + '</option>'; }).join("") +
      '</select>';
  }
  function optionSelectHtml(list, cur, key) {
    return '<select data-k="' + key + '" data-col="' + colIndex(key) + '">' +
      list.map(function (c) { return '<option value="' + esc(c) + '"' + (c === cur ? " selected" : "") + '>' + esc(c || "-") + '</option>'; }).join("") +
      '</select>';
  }
  function doneCellHtml(o) {
    var checked = o.status === "purchased" || o.status === "invoiced";
    if (checked) {
      return '<td class="done-cell done-complete"><button class="done-pill" data-act="done" data-done-pill type="button" title="클릭하면 미처리로 되돌림">구매완료</button></td>';
    }
    return '<td class="done-cell"><label class="sheet-check done-check"><input type="checkbox" data-act="done" /><span></span></label></td>';
  }
  function actionCellHtml(o) {
    return '<td class="sheet-actions single"><button class="sheet-ready-btn" data-act="autofill" type="button" title="이 주문 배송정보를 자동입력용으로 준비">입력준비</button></td>';
  }
  function stopCellHtml(o) {
    return '<td class="check-cell stop"><label class="sheet-check"><input type="checkbox" data-act="stop" ' + (o.csType === "출고중지요청" ? "checked" : "") + ' /><span></span></label></td>';
  }
  function returnCellHtml(o) {
    return '<td class="check-cell ret"><label class="sheet-check"><input type="checkbox" data-act="return" ' + (o.csType === "반품접수" ? "checked" : "") + ' /><span></span></label></td>';
  }
  function memoCellHtml(o) {
    var logs = (o.memoLog || []);
    if (!logs.length) {
      return '<td class="memo-cell empty-memo"><button class="mini yellow memo-add-mini" data-act="memo">+ 메모</button></td>';
    }
    var body = logs.length ? logs.slice().reverse().map(function (m) {
      return '<div class="sheet-memo-line"><span class="sheet-memo-time">' + esc(m.at || "") + '</span>' + esc(m.text || "") + '</div>';
    }).join("") : "";
    return '<td class="memo-cell"><div class="sheet-memo-box">' + body +
      '</div><button class="mini yellow memo-add-mini" data-act="memo">+ 메모</button></td>';
  }
  function calcCellHtml(o, c) {
    var cls = "calc", inner;
    if (c.key === "category") inner = esc(o.category || "—");
    else if (c.key === "feeRate") inner = (o.feeRate != null ? esc(o.feeRate) + "%" : "—");
    else if (c.key === "margin") {
      if (o.margin == null) { inner = '<span class="muted-note">매입가 필요</span>'; }
      else { cls += (o.margin >= 0 ? " pos" : " neg"); inner = esc(won(o.margin)) + (o.marginRate != null ? ' <small>(' + o.marginRate + '%)</small>' : ''); }
    } else if (c.key === "marginRate") inner = o.marginRate != null ? esc(o.marginRate) + "%" : "—";
    else if (c.key === "status") inner = '<span class="state-chip st-' + esc(o.status) + '">' + esc(statusLabel(o.status)) + '</span>' + (o.csType ? '<br><small class="cs-line">' + esc(csLabel(o)) + '</small>' : '');
    else inner = "";
    return '<td class="' + cls + '" data-k="' + c.key + '">' + inner + '</td>';
  }
  function editCellHtml(o, c) {
    if (c.type === "done")    return doneCellHtml(o);
    if (c.type === "actions") return actionCellHtml(o);
    if (c.type === "stop")    return stopCellHtml(o);
    if (c.type === "return")  return returnCellHtml(o);
    if (c.type === "memo")    return memoCellHtml(o);
    if (c.type === "status")  return '<td>' + statusSelectHtml(o) + '</td>';
    if (c.type === "courier") return '<td>' + courierSelectHtml(o) + '</td>';
    if (c.type === "csType")  return '<td>' + optionSelectHtml(CS_TYPES, o.csType || "", "csType") + '</td>';
    if (c.type === "csStatus")return '<td>' + optionSelectHtml(CS_STATUSES, o.csStatus || "", "csStatus") + '</td>';
    if (c.type === "custom") {
      var cv = (o.customValues || {})[c.key] || "";
      return '<td><input data-k="' + c.key + '" data-col="' + colIndex(c.key) + '" value="' + esc(cv) + '" /></td>';
    }
    var v = o[c.key]; v = (v == null ? "" : v);
    if (isMoneyKey(c.key)) v = moneyInputValue(v);
    var isCopyCell = c.key === "recipient" || c.key === "address";
    var copyAttr = isCopyCell ? ' data-copy-cell="' + c.key + '"' : "";
    var readonlyAttr = isCopyCell ? ' readonly title="클릭하면 바로 복사됩니다"' : "";
    return '<td' + copyAttr + '><input data-k="' + c.key + '" data-col="' + colIndex(c.key) + '" value="' + esc(v) + '"' +
      readonlyAttr + (c.type === "num" ? ' inputmode="numeric" class="num-in"' : '') + ' /></td>';
  }
  function sheetRowHtml(o, idx) {
    var h = rowHeight(o);
    var tds = '<td class="rownum" title="위아래로 드래그해서 행 높이 조절">' + (idx + 1) + '<span class="row-resizer" data-row-resize></span></td>';
    orderedSheetCols().forEach(function (c) { tds += (c.type === "calc") ? calcCellHtml(o, c) : editCellHtml(o, c); });
    tds += '<td class="del"><button data-srowdel title="이 행 삭제">✕</button></td>';
    return '<tr class="' + sheetRowClass(o) + '" data-id="' + esc(o.id) + '"' + (h ? ' style="height:' + h + 'px"' : '') + '>' + tds + '</tr>';
  }
  function sheetRowClass(o) {
    var cls = "row-" + (o.status || "pending");
    if (o.csType === "출고중지요청") cls += " row-stop";
    if (o.csType === "반품접수") cls += " row-return";
    return cls;
  }
  function colWidth(c) {
    return Math.max(44, toNumber((state.ui.colWidths || {})[c.key]) || c.w || 90);
  }
  function rowHeight(o) {
    var h = toNumber((state.ui.rowHeights || {})[o.id]);
    return h ? Math.max(24, h) : 0;
  }
  function groupRowHtml(g) {
    return '<tr class="group-row"><td colspan="' + (orderedSheetCols().length + 2) + '">' +
      '<b>' + esc(g.label) + '</b><span>' + g.count + '건</span><span>매출 ' + esc(won(g.rev)) + '</span><span>순마진 ' + esc(g.hasMargin ? won(g.margin) : "—") + '</span></td></tr>';
  }

  function renderSheet() {
    var tbl = $("#sheet-table"); if (!tbl) return;
    var rows = displayRows();
    var cols = orderedSheetCols();
    var head = '<colgroup><col style="width:46px">' +
      cols.map(function (c) { return '<col data-col-key="' + esc(c.key) + '" style="width:' + colWidth(c) + 'px">'; }).join("") +
      '<col style="width:42px"></colgroup>';
    head += '<thead><tr><th class="rownum">#</th>' +
      cols.map(function (c) {
        return '<th data-k="' + esc(c.key) + '" draggable="true" title="드래그해서 열 위치 이동">' + esc(c.label) +
          (c.custom ? ' <button class="custom-col-del" data-custom-col-del="' + esc(c.key) + '" title="이 사용자 열 삭제" type="button">×</button>' : '') +
          (c.type === "calc" ? ' <span class="auto">자동</span>' : '') +
          '<span class="col-resizer" data-col-resize="' + c.key + '"></span></th>';
      }).join("") + '<th class="del"></th></tr></thead>';
    var body = "<tbody>";
    if (!rows.length) {
      body += '<tr><td class="sheet-empty" colspan="' + (cols.length + 2) + '">' +
        (state.orders.length ? "조건에 맞는 행이 없어요 (검색·상태 필터 확인)." : "행이 없습니다. [행 추가]를 누르거나 발주서를 올리세요.") +
        '</td></tr>';
    } else {
      var n = 0;
      body += rows.map(function (r) {
        if (r.type === "group") return groupRowHtml(r);
        return sheetRowHtml(r.order, n++);
      }).join("");
    }
    body += "</tbody>";
    tbl.innerHTML = head + body;
    var cnt = $("#sheet-count");
    if (cnt) {
      var csn = csOrders().length;
      cnt.textContent = sheetFiltered().length + "행" + (csn ? " · CS " + csn + "건은 CS관리" : "");
    }
    renderOrdersDashboard();
    updateUndoButton();
  }

  // 한 행의 입력값 → 주문 객체에 반영(타입별 변환)
  function setSheetField(o, key, value) {
    if (key === "quantity") o.quantity = Math.max(1, Math.round(toNumber(value) || 1));
    else if (key === "paymentAmount") o.paymentAmount = toNumber(value);
    else if (key === "csCost") o.csCost = toNumber(value);
    else if (key === "purchaseAmount" || key === "point" || key === "shipFee" || key === "discount") o[key] = toNumber(value);
    else if (key === "sourcingPrice") {
      var n = toNumber(value);
      o.sourcingPrice = (String(value).trim() === "" || n <= 0) ? null : n;
    } else if (key === "sourcingLink") {
      o.sourcingLink = String(value).trim();
      var links = cloneSourcingLinks(o.sourcingLinks);
      if (links.length || o.sourcingLink) {
        var sel = 0;
        for (var i = 0; i < links.length; i++) if (links[i].selected) { sel = i; break; }
        if (!links.length) links.push({ id:newId("sl"), source:"", url:"", memo:"", price:null, selected:true });
        links[sel].url = o.sourcingLink;
        links.forEach(function (c, idx) { c.selected = idx === sel; });
        o.sourcingLinks = links;
      }
    } else if (key === "status") {
      o.status = (value === "purchased" || value === "invoiced") ? value : "pending";
    } else if (key === "csType" || key === "csStatus") {
      o[key] = String(value);
    } else if (baseColByKey(key) && baseColByKey(key).custom) {
      if (!o.customValues || typeof o.customValues !== "object") o.customValues = {};
      o.customValues[key] = String(value);
    } else o[key] = String(value);
  }
  // 계산열만 그 자리에서 갱신(편집 중 포커스 유지)
  function refreshRowCalc(o, tr) {
    computeMargin(o);
    tr.className = sheetRowClass(o);
    orderedSheetCols().forEach(function (c) {
      if (c.type !== "calc") return;
      var td = tr.querySelector('td.calc[data-k="' + c.key + '"]');
      if (td) td.outerHTML = calcCellHtml(o, c);
    });
  }

  function onSheetInput(e) {
    var el = e.target; if (!el.matches('input[data-k]')) return;
    var tr = el.closest('tr[data-id]'); if (!tr) return;
    var o = findOrder(tr.getAttribute("data-id")); if (!o) return;
    setSheetField(o, el.getAttribute("data-k"), el.value);
    refreshRowCalc(o, tr);
    renderSummary();
    renderOrdersDashboard();
    schedulePersist();
  }
  function onSheetFocusOut(e) {
    var el = e.target;
    if (!el.matches('input[data-k]')) return;
    if (isMoneyKey(el.getAttribute("data-k"))) formatMoneyInput(el);
  }
  function onSheetChange(e) {
    var el = e.target; if (!el.matches('select[data-k]')) return;
    var tr = el.closest('tr[data-id]'); if (!tr) return;
    var o = findOrder(tr.getAttribute("data-id")); if (!o) return;
    setSheetField(o, el.getAttribute("data-k"), el.value);
    if (el.getAttribute("data-k") === "status") el.className = "s-" + o.status;
    refreshRowCalc(o, tr);
    renderSummary();
    renderOrdersDashboard();
    persist();
  }
  function onSheetClick(e) {
    var customDel = e.target.closest("[data-custom-col-del]");
    if (customDel) {
      deleteCustomColumn(customDel.getAttribute("data-custom-col-del"));
      return;
    }
    var copyCell = e.target.closest("td[data-copy-cell]");
    if (copyCell) {
      var copyTr = copyCell.closest('tr[data-id]');
      var copyOrder = copyTr ? findOrder(copyTr.getAttribute("data-id")) : null;
      var copyKey = copyCell.getAttribute("data-copy-cell");
      if (copyOrder) copyText(copyOrder[copyKey], copyKey === "recipient" ? "수취인" : "주소");
      return;
    }
    var actEl = e.target.closest("[data-act]");
    if (actEl) {
      var atr = actEl.closest('tr[data-id]'); if (!atr) return;
      var ao = findOrder(atr.getAttribute("data-id")); if (!ao) return;
      var act = actEl.getAttribute("data-act");
      if (act === "autofill") copyAutofill(ao);
      else if (act === "done") {
        var nextDone = !actEl.hasAttribute("data-done-pill") && !!actEl.checked;
        ao.status = nextDone ? "purchased" : "pending";
        if (!nextDone) { ao.invoiceNumber = ao.invoiceNumber || ""; }
        computeMargin(ao); persist(); render();
      } else if (act === "stop") {
        if (actEl.checked) {
          ao.csType = "출고중지요청"; ao.csStatus = ao.csStatus || "접수";
        } else if (ao.csType === "출고중지요청") {
          ao.csType = ""; ao.csStatus = "";
        }
        computeMargin(ao); persist(); render();
        toast(actEl.checked ? "CS관리로 이동했어요 (출고중지)" : "출고중지요청을 취소했어요");
      } else if (act === "return") {
        if (actEl.checked) {
          ao.csType = "반품접수"; ao.csStatus = ao.csStatus || "접수";
        } else if (ao.csType === "반품접수") {
          ao.csType = ""; ao.csStatus = "";
        }
        computeMargin(ao); persist(); render();
        toast(actEl.checked ? "CS관리로 이동했어요 (반품접수)" : "반품접수를 취소했어요");
      } else if (act === "memo") {
        openMemo(ao.id);
      }
      return;
    }
    var d = e.target.closest("[data-srowdel]"); if (!d) return;
    var tr = d.closest('tr[data-id]'); if (!tr) return;
    var id = tr.getAttribute("data-id");
    var i = -1;
    for (var k = 0; k < state.orders.length; k++) if (state.orders[k].id === id) { i = k; break; }
    if (i < 0) return;
    state.deleted = state.deleted || [];
    state.deleted.push({ order: state.orders[i], index: i, at: Date.now() });
    if (state.deleted.length > 50) state.deleted.shift();
    state.orders.splice(i, 1);
    persist(); render();
    toast("행을 삭제했어요 — [삭제 복구]로 되돌릴 수 있어요");
  }
  // 엔터/위아래 화살표로 같은 열 상·하 이동(스프레드시트 느낌)
  function onSheetKey(e) {
    var el = e.target; if (!el.matches('input[data-k],select[data-k]')) return;
    var key = e.key;
    if (key !== "Enter" && key !== "ArrowDown" && key !== "ArrowUp") return;
    if (el.tagName === "SELECT" && key !== "Enter") return;   // select는 화살표로 값 바꾸게 둠
    e.preventDefault();
    var tr = el.closest('tr[data-id]'); var col = el.getAttribute("data-col");
    var target = (key === "ArrowUp") ? tr.previousElementSibling : tr.nextElementSibling;
    if (!target || !target.getAttribute || !target.getAttribute("data-id")) return;
    var next = target.querySelector('[data-col="' + col + '"]');
    if (next) { next.focus(); if (next.select) next.select(); }
  }

  // 엑셀/구글시트에서 복사한 블록을 칸에 붙여넣기 → 해당 칸부터 오른쪽·아래로 채움(없으면 행 생성)
  function onSheetPaste(e) {
    var el = e.target; if (!el.matches('input[data-k],select[data-k]')) return;
    var cd = e.clipboardData || window.clipboardData;
    var text = cd ? cd.getData("text") : "";
    if (!text) return;
    if (text.indexOf("\t") === -1 && text.indexOf("\n") === -1) return;  // 단일 칸은 기본 붙여넣기
    e.preventDefault();
    var startCol = parseInt(el.getAttribute("data-col"), 10) || 0;
    var tr = el.closest('tr[data-id]');
    var visibleOrders = displayRows().filter(function (r) { return r.type === "order"; }).map(function (r) { return r.order; });
    var startRow = 0;
    if (tr) {
      var id = tr.getAttribute("data-id");
      for (var k = 0; k < visibleOrders.length; k++) if (visibleOrders[k].id === id) { startRow = k; break; }
    }
    // 따옴표로 감싼 셀(줄바꿈 주소 등)을 보존하도록 인용 인식 파서 사용 — 행 밀림 방지
    var matrix = dsvToMatrix(String(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n+$/, ""), "\t")
      .filter(function (cells) { return cells.some(function (c) { return String(c).trim() !== ""; }); });
    matrix.forEach(function (cells, r) {
      var o = visibleOrders[startRow + r];
      if (!o) { o = blankOrder(); state.orders.push(o); }
      cells.forEach(function (val, c) {
        var ci = startCol + c;
        var editCols = sheetEditCols();
        if (ci >= editCols.length) return;
        setSheetField(o, editCols[ci].key, val);
      });
      computeMargin(o);
    });
    persist(); render();
    toast(matrix.length + "행을 붙여넣었어요 (자동 저장)");
  }

  function csRowOrder(el) {
    var tr = el && el.closest && el.closest("tr[data-id]");
    return tr ? findOrder(tr.getAttribute("data-id")) : null;
  }
  function clearCsOrder(o) {
    if (!o) return;
    o.csType = "";
    o.csStatus = "";
    computeMargin(o);
    persist();
    render();
    toast("CS 해제 — 주문관리로 돌아갔어요");
  }
  function onCsClick(e) {
    var btn = e.target.closest("[data-cs-clear],[data-cs-memo],[data-cs-autofill]");
    if (!btn) return;
    var o = csRowOrder(btn); if (!o) return;
    if (btn.matches("[data-cs-clear]")) clearCsOrder(o);
    else if (btn.matches("[data-cs-memo]")) openMemo(o.id);
    else if (btn.matches("[data-cs-autofill]")) copyAutofill(o);
  }
  function onCsChange(e) {
    var el = e.target;
    var o = csRowOrder(el); if (!o) return;
    if (el.matches("[data-cs-active]")) {
      if (!el.checked) clearCsOrder(o);
      return;
    }
    if (el.matches("select[data-cs-k]")) {
      o[el.getAttribute("data-cs-k")] = el.value;
      computeMargin(o);
      persist();
      renderCsPane();
      renderSummary();
    }
  }
  function onCsInput(e) {
    var el = e.target;
    if (!el.matches("input[data-cs-k]")) return;
    var o = csRowOrder(el); if (!o) return;
    var key = el.getAttribute("data-cs-k");
    if (key === "csCost") o.csCost = toNumber(el.value);
    else o[key] = el.value;
    computeMargin(o);
    renderSummary();
    renderOrdersDashboard();
    schedulePersist();
  }
  function onCsFocusOut(e) {
    var el = e.target;
    if (el.matches('input[data-cs-k="csCost"]')) formatMoneyInput(el);
  }

  function addCustomColumn() {
    showConfirm({ title: "열 추가", body: "추가할 열 이름을 입력하세요.", input: true, value: "새 열", okLabel: "추가" }, function (label) {
      if (!state.ui.customCols) state.ui.customCols = [];
      var key = "custom_" + Date.now().toString(36) + "_" + Math.abs(hash(label)).toString(36);
      state.ui.customCols.push({ key:key, label:label, w:140 });
      state.ui.colOrder = orderedSheetCols().map(function (c) { return c.key; });
      persist();
      renderSheet();
      toast("사용자 열을 추가했습니다");
    });
  }
  function deleteCustomColumn(key) {
    if (!key) return;
    var col = (state.ui.customCols || []).filter(function (c) { return c.key === key; })[0];
    if (!col) return;
    showConfirm({ title: "열 삭제", body: "'" + col.label + "' 열과 입력된 값이 삭제됩니다.", okLabel: "삭제", danger: true }, function () {
      state.ui.customCols = (state.ui.customCols || []).filter(function (c) { return c.key !== key; });
      state.ui.colOrder = (state.ui.colOrder || []).filter(function (k) { return k !== key; });
      delete state.ui.colWidths[key];
      state.orders.forEach(function (o) {
        if (o.customValues) delete o.customValues[key];
      });
      persist();
      renderSheet();
      toast("사용자 열을 삭제했습니다");
    });
  }

  function blankOrder() {
    var o = {
      id: newId("n"),
      orderDate: "", orderNumber: "", orderId: "", manager: "", productId: "", productName: "", option: "",
      quantity: 1, paymentAmount: 0, recipient: "", phone: "", zipcode: "", address: "",
      sourcingLink: "", sourcingLinks: [], sourcingPrice: null, status: "pending", invoiceNumber: "", courier: "",
      csType: "", csStatus: "", csCost: 0, memoLog: [], customValues: {}, raw: {},
      collectedAt: "", site: "", sellerId: "", shipFee: 0, masterCode: "", sellerCode: "", discount: 0, buyerName: "", phone2: "",
      deliveryMsg: "", vendor: "", account: "", purchaseAmount: 0, paidAt: "", card: "", point: 0, orderedYn: "", note: "", uniqueNo: ""
    };
    computeMargin(o);
    return o;
  }
  function sheetAddRow() {
    var o = blankOrder();
    state.orders.push(o);
    persist();
    if (state.ui.view !== "sheet") { state.ui.view = "sheet"; }
    render();
    var rows = $$('#sheet-table tr[data-id]');
    var last = rows[rows.length - 1];
    if (last) { var inp = last.querySelector('input,select'); if (inp) { inp.focus(); if (inp.scrollIntoView) inp.scrollIntoView({block:"nearest"}); } }
  }
  function undoDeletedRow() {
    state.deleted = state.deleted || [];
    var item = state.deleted.pop();
    if (!item || !item.order) { updateUndoButton(); toast("복구할 삭제 행이 없어요"); return; }
    normalizeOrder(item.order);
    var idx = Math.max(0, Math.min(item.index == null ? state.orders.length : item.index, state.orders.length));
    state.orders.splice(idx, 0, item.order);
    saveDeleted();
    persist();
    render();
    toast("삭제한 행을 복구했어요");
  }
  function updateUndoButton() {
    var b = $("#sheet-undo");
    if (!b) return;
    var n = (state.deleted || []).length;
    b.disabled = !n;
    b.textContent = n ? "삭제 복구 (" + n + ")" : "삭제 복구";
  }

  var sheetResize = null;
  var sheetDragKey = "";
  function startSheetResize(e) {
    var col = e.target.closest("[data-col-resize]");
    if (col) {
      var key = col.getAttribute("data-col-resize");
      var c = baseColByKey(key);
      sheetResize = { type:"col", key:key, start:e.clientX, size:colWidth(c) };
      document.body.classList.add("resizing-sheet", "resizing-sheet-col");
      e.preventDefault();
      return;
    }
    var row = e.target.closest("[data-row-resize]");
    if (!row && e.target.closest && e.target.closest("td.rownum")) row = e.target.closest("td.rownum").querySelector("[data-row-resize]");
    if (row) {
      var tr = row.closest("tr[data-id]");
      if (!tr) return;
      sheetResize = { type:"row", id:tr.getAttribute("data-id"), row:tr, start:e.clientY, size:tr.getBoundingClientRect().height };
      document.body.classList.add("resizing-sheet", "resizing-sheet-row");
      e.preventDefault();
    }
  }
  function moveSheetResize(e) {
    if (!sheetResize) return;
    if (sheetResize.type === "col") {
      var w = Math.max(44, Math.round(sheetResize.size + e.clientX - sheetResize.start));
      var col = $('#sheet-table col[data-col-key="' + sheetResize.key + '"]');
      if (col) col.style.width = w + "px";
    } else {
      var h = Math.max(24, Math.round(sheetResize.size + e.clientY - sheetResize.start));
      if (sheetResize.row) sheetResize.row.style.height = h + "px";
    }
  }
  function stopSheetResize(e) {
    if (!sheetResize) return;
    if (sheetResize.type === "col") {
      var c = baseColByKey(sheetResize.key);
      state.ui.colWidths[sheetResize.key] = Math.max(44, Math.round(sheetResize.size + e.clientX - sheetResize.start));
    } else {
      state.ui.rowHeights[sheetResize.id] = Math.max(24, Math.round(sheetResize.size + e.clientY - sheetResize.start));
    }
    document.body.classList.remove("resizing-sheet", "resizing-sheet-col", "resizing-sheet-row");
    sheetResize = null;
    persist();
  }
  function clearColDropMarks() {
    $$("#sheet-table th.col-drop,#sheet-table th.drop-after").forEach(function (th) {
      th.classList.remove("col-drop", "drop-after");
    });
  }
  function onSheetDragStart(e) {
    var th = e.target.closest('th[data-k]');
    if (!th || e.target.closest("[data-col-resize]")) return;
    sheetDragKey = th.getAttribute("data-k");
    th.classList.add("dragging-col");
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", sheetDragKey);
    }
  }
  function onSheetDragOver(e) {
    var th = e.target.closest('th[data-k]');
    if (!sheetDragKey || !th || th.getAttribute("data-k") === sheetDragKey) return;
    e.preventDefault();
    clearColDropMarks();
    var r = th.getBoundingClientRect();
    th.classList.add("col-drop");
    if (e.clientX > r.left + r.width / 2) th.classList.add("drop-after");
  }
  function onSheetDrop(e) {
    var th = e.target.closest('th[data-k]');
    if (!sheetDragKey || !th) return;
    e.preventDefault();
    var target = th.getAttribute("data-k");
    if (target && target !== sheetDragKey) {
      var keys = orderedSheetCols().map(function (c) { return c.key; });
      var from = keys.indexOf(sheetDragKey), to = keys.indexOf(target);
      if (from >= 0 && to >= 0) {
        var moved = keys.splice(from, 1)[0];
        if (from < to) to--;
        var r = th.getBoundingClientRect();
        if (e.clientX > r.left + r.width / 2) to++;
        keys.splice(Math.max(0, Math.min(to, keys.length)), 0, moved);
        state.ui.colOrder = keys;
        persist();
        renderSheet();
        toast("열 위치를 저장했어요");
      }
    }
    sheetDragKey = "";
    clearColDropMarks();
  }
  function onSheetDragEnd() {
    sheetDragKey = "";
    clearColDropMarks();
    $$("#sheet-table th.dragging-col").forEach(function (th) { th.classList.remove("dragging-col"); });
  }
  function resetSheetLayout() {
    state.ui.colWidths = {};
    state.ui.rowHeights = {};
    state.ui.colOrder = defaultSheetColOrder();
    state.ui.layoutVersion = SHEET_LAYOUT_VERSION;
    persist();
    renderSheet();
    toast("시트 레이아웃을 기본값으로 돌렸어요");
  }

  var memoOrderId = "";
  function openMemo(id) {
    memoOrderId = id;
    renderMemoModal();
    var bg = $("#modal-memo");
    if (bg) bg.classList.remove("hidden");
  }
  function closeMemo() {
    memoOrderId = "";
    var bg = $("#modal-memo");
    if (bg) bg.classList.add("hidden");
  }
  function renderMemoModal() {
    var o = findOrder(memoOrderId);
    if (!o) return;
    normalizeOrder(o);
    var title = $("#memo-title"), list = $("#memo-list"), text = $("#memo-text");
    if (title) title.textContent = (o.orderNumber || "새 주문") + " · " + (o.recipient || "수취인 없음");
    if (text) text.value = "";
    if (list) {
      if (!o.memoLog.length) list.innerHTML = '<div class="memo-empty">아직 메모가 없습니다. 반품/CS 진행 내용을 아래에 남겨두세요.</div>';
      else list.innerHTML = o.memoLog.slice().reverse().map(function (m, idx) {
        var realIdx = o.memoLog.length - 1 - idx;
        return '<div class="memo-item"><div class="memo-time">' + esc(m.at || "") +
          '<button class="memo-del" data-memo-del="' + realIdx + '">삭제</button></div><div class="memo-body">' + esc(m.text || "") + '</div></div>';
      }).join("");
    }
  }
  function addMemo() {
    var o = findOrder(memoOrderId), text = $("#memo-text");
    if (!o || !text) return;
    var v = text.value.trim();
    if (!v) { toast("메모 내용을 입력해 주세요"); return; }
    normalizeOrder(o);
    o.memoLog.push({ at: dateStampHuman(), text: v });
    persist(); renderMemoModal(); render();
  }
  function deleteMemo(idx) {
    var o = findOrder(memoOrderId);
    if (!o) return;
    normalizeOrder(o);
    o.memoLog.splice(idx, 1);
    persist(); renderMemoModal(); render();
  }
  function dateStampHuman() {
    var d = new Date();
    function p(n){ return ("0" + n).slice(-2); }
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
  }

  // persist 디바운스(키 입력마다 저장 부담 줄임)
  var persistTimer = null;
  function schedulePersist() {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(function () { persistTimer = null; persist(); }, 250);
  }

  /* =====================================================================
   * 결제창 자동입력 (북마클릿 방식)
   *  - 시트의 [입력준비]가 그 주문의 이름·전화·우편·주소를 클립보드에 담고,
   *  - 구매 사이트(네이버페이 등)에서 북마클릿을 누르면 그 칸들에 자동으로 채워짐.
   *  - 로그인·결제는 사용자가 직접. (자동 로그인/결제/스크래핑은 만들지 않음)
   *  ※ 사이트 폼이 바뀌면 칸 인식이 빗나갈 수 있어 결제 전 확인 필요.
   * ===================================================================== */
  function copyAutofill(o) {
    var myPhone = (state.rules.myPhone || "").trim();   // 항상 '내 번호'만 — 고객 번호는 절대 안 들어감
    if (!myPhone) {
      // 고객 번호가 구매처(도매몰)에 노출되는 사고 방지: 설정 전에는 자동입력 준비 자체를 막음
      toast("설정에서 '자동입력용 내 연락처'를 먼저 입력하세요 (고객 번호 노출 방지)");
      openSettings();
      setTimeout(function () { var f = $("#set-myphone"); if (f) f.focus(); }, 150);
      return;
    }
    var payload = JSON.stringify({
      __oh: true,
      name: o.recipient || "",
      phone: myPhone,
      zip: o.zipcode || "",
      addr: o.address || ""
    });
    copyText(payload, "자동입력 데이터");
    setTimeout(function () { toast("준비됨 (전화=내번호) — 사이트에서 주문 자동입력 클릭"); }, 50);
  }

  // 구매 사이트에서 실행되는 북마클릿 (클립보드의 주문데이터를 폼 칸에 채움)
  var BOOKMARKLET = "javascript:(async()=>{try{var t=await navigator.clipboard.readText();var d=JSON.parse(t);if(!d||!d.__oh)throw 0;" +
    "var sv=function(i,v){if(!i||v==null||v==='')return false;var p=i.tagName==='TEXTAREA'?window.HTMLTextAreaElement.prototype:window.HTMLInputElement.prototype;" +
    "var s=Object.getOwnPropertyDescriptor(p,'value').set;s.call(i,v);['input','change','blur'].forEach(function(e){i.dispatchEvent(new Event(e,{bubbles:true}))});return true};" +
    "var fd=function(ks){var ns=[].slice.call(document.querySelectorAll('input,textarea'));for(var j=0;j<ns.length;j++){var i=ns[j];if(i.type==='hidden'||i.disabled||i.readOnly)continue;" +
    "var c=((i.placeholder||'')+' '+(i.name||'')+' '+(i.id||'')+' '+(i.getAttribute('aria-label')||''));var l=(i.labels&&i.labels[0])?i.labels[0].innerText:'';" +
    "var b=i.closest('div,li,tr,label,fieldset');var nr=b?b.innerText.slice(0,40):'';var h=(c+' '+l+' '+nr).toLowerCase();for(var k=0;k<ks.length;k++){if(h.indexOf(ks[k])!==-1)return i}}return null};" +
    "var r=[];if(sv(fd(['받는','수령','수취','성명','이름','recipient','name']),d.name))r.push('이름');" +
    "if(sv(fd(['연락처','휴대폰','휴대전화','전화','핸드폰','phone','mobile']),d.phone))r.push('전화');" +
    "if(sv(fd(['우편','zip','postal']),d.zip))r.push('우편');" +
    "if(sv(fd(['주소','address','addr','도로명','지번']),d.addr))r.push('주소');" +
    "alert('자동입력 완료: '+(r.join(', ')||'(맞는 칸 못 찾음)')+'\\n결제 전에 꼭 확인하세요!')}" +
    "catch(e){alert('주문 데이터를 못 읽었어요.\\n앱 시트에서 [입력준비]를 먼저 누른 뒤 이 페이지에서 다시 클릭하세요.')}})()";

  /* =====================================================================
   * 설정 화면
   * ===================================================================== */
  function openSettings() {
    $("#set-vat").checked = !!state.rules.vatIncluded;
    $("#set-copyfmt").value = state.rules.copyFormat;
    $("#set-defcat").value = state.rules.defaultCategory;
    $("#set-defrate").value = state.rules.defaultFeeRate;
    updateCopyPreview();
    renderFeeRows(state.rules.categories);
    var rc = $("#rules-cat-count"); if (rc) rc.textContent = (state.rules.categories.length || 0) + "개";
    var mp = $("#set-myphone"); if (mp) mp.value = state.rules.myPhone || "";
    // 클라우드(구글시트) 연동 필드
    $("#set-cloud-enabled").checked = !!state.cloud.enabled;
    $("#set-cloud-clientid").value = state.cloud.clientId || "";
    $("#set-cloud-sheet").value = state.cloud.sheet || "";
    $("#set-cloud-range").value = state.cloud.range || "";
    $("#cloud-origin").textContent = location.origin;
    toggleCloudFields();
    $("#modal-settings").classList.remove("hidden");
  }
  function toggleCloudFields() {
    $("#cloud-fields").style.opacity = $("#set-cloud-enabled").checked ? "1" : "0.45";
    $("#cloud-fields").style.pointerEvents = $("#set-cloud-enabled").checked ? "auto" : "none";
  }
  function closeSettings() { $("#modal-settings").classList.add("hidden"); }

  function renderFeeRows(cats) {
    var tb = $("#fee-rows"); tb.innerHTML = "";
    cats.forEach(function (c, i) {
      var tr = document.createElement("tr");
      tr.innerHTML =
        '<td><input data-f="name" value="' + esc(c.name) + '" /></td>' +
        '<td class="rate"><input data-f="rate" type="number" step="0.1" value="' + esc(c.feeRate) + '" /></td>' +
        '<td><textarea data-f="kw">' + esc((c.keywords || []).join(", ")) + '</textarea></td>' +
        '<td><button class="btn sm x-del" data-del="' + i + '">✕</button></td>';
      tb.appendChild(tr);
    });
  }
  function readFeeRows() {
    var cats = [];
    $$("#fee-rows tr").forEach(function (tr) {
      var name = tr.querySelector('[data-f="name"]').value.trim();
      if (!name) return;
      var rate = toNumber(tr.querySelector('[data-f="rate"]').value);
      var kw = tr.querySelector('[data-f="kw"]').value.split(",")
        .map(function (s) { return s.trim(); }).filter(Boolean);
      cats.push({ name: name, feeRate: rate, keywords: kw });
    });
    return cats;
  }
  function updateCopyPreview() {
    var sample = { recipient:"홍길동", phone:"010-1234-5678", zipcode:"48087", address:"부산광역시 해운대구 ○○로 12, 301호" };
    var fmt = $("#set-copyfmt").value;
    var old = state.rules.copyFormat; state.rules.copyFormat = fmt;
    $("#copyfmt-preview").textContent = formatAddress(sample);
    state.rules.copyFormat = old;
  }

  function saveSettings() {
    state.rules.vatIncluded = $("#set-vat").checked;
    state.rules.copyFormat = $("#set-copyfmt").value || "{name} / {phone} / ({zip}) {address}";
    state.rules.defaultCategory = $("#set-defcat").value.trim() || "기타";
    state.rules.defaultFeeRate = toNumber($("#set-defrate").value);
    var mp = $("#set-myphone"); if (mp) state.rules.myPhone = mp.value.trim();
    state.rules.categories = readFeeRows();
    saveRules();
    // 클라우드 연동 설정 저장
    state.cloud.enabled = $("#set-cloud-enabled").checked;
    state.cloud.clientId = $("#set-cloud-clientid").value.trim();
    state.cloud.sheet = $("#set-cloud-sheet").value.trim();
    state.cloud.range = $("#set-cloud-range").value.trim();
    saveCloud();
    updatePrivacyUI();
    recomputeAll();
    persist();
    if (!$("#view-dashboard").classList.contains("hidden")) render();
    closeSettings();
    toast("설정을 저장하고 다시 계산했어요");
  }

  /* =====================================================================
   * 내보내기
   * ===================================================================== */
  function exportFull(type) {
    if (!state.orders.length) { toast("내보낼 주문이 없어요"); return; }
    var rows = state.orders.map(function (o) {
      return {
        "주문일": o.orderDate, "주문번호": o.orderNumber, "주문고유번호": o.uniqueNo || "", "판매사이트": o.site || "",
        "구매처 주문번호": o.orderId || "", "담당자": o.manager || "", "구매처": o.vendor || "", "계정": o.account || "",
        "구매금액": toNumber(o.purchaseAmount) || "", "결제일시": o.paidAt || "", "카드": o.card || "", "포인트": toNumber(o.point) || "",
        "한줄메모": o.note || "", "배송메세지": o.deliveryMsg || "", "상품코드": o.productId,
        "상품명": o.productName, "옵션": o.option, "수량": o.quantity, "결제액": o.paymentAmount,
        "카테고리": o.category, "수수료율(%)": o.feeRate,
        "VAT포함": state.rules.vatIncluded ? "Y" : "N",
        "매입가": o.sourcingPrice != null ? o.sourcingPrice : "",
        "매입가합계": o.sourcingCost != null ? o.sourcingCost : "",
        "정산예상액": o.settlement,
        "예상마진": o.margin != null ? o.margin : "",
        "마진율(%)": o.marginRate != null ? o.marginRate : "",
        "CS유형": o.csType || "", "CS상태": o.csStatus || "", "CS차감액": toNumber(o.csCost) || "",
        "CS메모": (o.memoLog || []).map(function (m) { return "[" + (m.at || "") + "] " + (m.text || ""); }).join("\n"),
        "수취인": o.recipient, "전화": o.phone, "우편번호": o.zipcode, "주소": o.address,
        "주문링크": o.sourcingLink,
        "후보소싱링크": (o.sourcingLinks || []).map(function (c) {
          return (c.selected ? "[대표] " : "") +
            (c.source ? c.source + " · " : "") +
            (c.price != null ? won(c.price) + " · " : "") +
            (c.url || "") +
            (c.memo ? " (" + c.memo + ")" : "");
        }).join("\n"),
        "상태": statusLabel(o.status), "택배사": o.courier, "송장번호": o.invoiceNumber
      };
    });
    writeSheet(rows, "처리결과", "주문처리결과", type);
  }

  function invoiceExcluded(o) {
    // 출고중지·반품 주문은 송장 업로드에서 제외 — 올리면 발송처리되어 취소가 막히는 사고 방지
    return o.csType === "출고중지요청" || o.csType === "반품접수" || o.csType === "취소요청";
  }
  function exportInvoice(type) {
    var ready = state.orders.filter(function (o) { return o.invoiceNumber && o.courier; });
    var excluded = ready.filter(invoiceExcluded);
    var rows = ready
      .filter(function (o) { return !invoiceExcluded(o); })
      .map(function (o, idx) { return invoiceRow(o, idx); });
    if (!rows.length) { toast(excluded.length ? "출고중지·반품 주문만 있어 업로드할 건이 없어요" : "송장입력완료된 주문이 없어요"); return; }
    if (excluded.length) toast("출고중지·반품 " + excluded.length + "건은 업로드 파일에서 뺐습니다");
    rows = sanitizeExportRows(rows);
    if (type === "csv") {
      var wsCsv = XLSX.utils.json_to_sheet(rows, { header: INVOICE_HEADERS });
      downloadBlob("﻿" + XLSX.utils.sheet_to_csv(wsCsv), "쿠팡송장업로드_" + dateStamp() + ".csv", "text/csv;charset=utf-8");
      toast("쿠팡 송장 업로드 CSV를 만들었어요");
      $("#modal-export").classList.add("hidden");
      return;
    }
    var aoa = [INVOICE_HEADERS].concat(rows.map(function (r) { return INVOICE_HEADERS.map(function (h) { return r[h] == null ? "" : r[h]; }); }));
    var ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = INVOICE_HEADERS.map(function (h) { return { wch: Math.min(Math.max(String(h).length + 2, 9), 24) }; });
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "form");
    XLSX.writeFile(wb, "쿠팡송장업로드_" + dateStamp() + ".xlsx");
    toast("쿠팡 송장파일을 만들었습니다");
    $("#modal-export").classList.add("hidden");
  }

  /* ---- 소스 양식(36열) 내보내기: 올린 파일과 같은 열 순서로, 앱에서 채운 값만 덮어써서 나갑니다 ---- */
  function todayKey() {
    var d = new Date(); function p(n){ return ("0" + n).slice(-2); }
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }
  function firstFilled() {
    for (var i = 0; i < arguments.length; i++) {
      var v = arguments[i];
      if (v !== undefined && v !== null && String(v).trim() !== "" && !(typeof v === "number" && v === 0)) return v;
    }
    return "";
  }
  function sourceRow(o) {
    var r = {};
    SOURCE_HEADERS.forEach(function (h) { r[h] = rawVal(o, h); });   // 원본 값 보존 (다른 양식에서 온 주문은 빈칸)
    var excluded = invoiceExcluded(o);
    var done = o.status === "purchased" || o.status === "invoiced";
    // 수집값(비어 있을 때만 앱 값으로)
    r["수집일"]            = firstFilled(r["수집일"], o.collectedAt);
    r["주문일"]            = firstFilled(r["주문일"], o.orderDate);
    r["판매사이트 주문번호"] = firstFilled(r["판매사이트 주문번호"], o.orderNumber);
    r["판매사이트명"]      = firstFilled(r["판매사이트명"], o.site);
    r["판매자ID"]          = firstFilled(r["판매자ID"], o.sellerId);
    r["판매가"]            = firstFilled(r["판매가"], o.paymentAmount);
    r["배송비금액"]        = firstFilled(r["배송비금액"], o.shipFee);
    r["마스터상품코드"]    = firstFilled(r["마스터상품코드"], o.masterCode);
    r["판매사이트 상품코드"] = firstFilled(r["판매사이트 상품코드"], o.productId);
    r["상품명"]            = firstFilled(r["상품명"], o.productName);
    r["판매자상품코드"]    = firstFilled(r["판매자상품코드"], o.sellerCode);
    r["주문선택사항"]      = firstFilled(r["주문선택사항"], o.option);
    r["주문수량"]          = firstFilled(r["주문수량"], o.quantity);
    r["에누리"]            = firstFilled(r["에누리"], o.discount);
    r["구매자명"]          = firstFilled(r["구매자명"], o.buyerName);
    r["수령자명"]          = firstFilled(r["수령자명"], o.recipient);
    r["수령자전화번호"]    = firstFilled(r["수령자전화번호"], o.phone2, o.phone);
    r["수령자휴대폰번호"]  = firstFilled(r["수령자휴대폰번호"], o.phone);
    r["배송지우편번호"]    = firstFilled(r["배송지우편번호"], o.zipcode);
    r["배송지주소"]        = firstFilled(r["배송지주소"], o.address);
    r["배송메세지"]        = firstFilled(r["배송메세지"], o.deliveryMsg);
    r["주문고유번호"]      = firstFilled(r["주문고유번호"], o.uniqueNo);
    // 앱에서 채우는 값(앱 값이 있으면 덮어씀)
    r["구매링크"]          = firstFilled(o.sourcingLink, r["구매링크"]);
    r["구매가"]            = firstFilled(o.sourcingPrice, r["구매가"]);
    r["담당자"]            = firstFilled(o.manager, r["담당자"]);
    r["구매처"]            = firstFilled(o.vendor, r["구매처"]);
    r["계정"]              = firstFilled(o.account, r["계정"]);
    r["구매금액"]          = firstFilled(o.purchaseAmount, o.sourcingCost, r["구매금액"]);
    r["주문번호　앞부분"]  = firstFilled(o.orderId, r["주문번호　앞부분"]);
    r["결제일시"]          = firstFilled(o.paidAt, r["결제일시"]);
    r["카드정보"]          = firstFilled(o.card, r["카드정보"]);
    r["포인트"]            = firstFilled(o.point, r["포인트"]);
    r["주문여부"]          = done ? "O" : (String(r["주문여부"] || o.orderedYn || "").toUpperCase() === "X" ? "X" : "");
    r["한줄메모"]          = firstFilled(o.note, r["한줄메모"]);
    if (excluded) {
      // 출고중지·반품·취소 건은 송장이 나가면 발송처리돼 버리므로 송장 칸을 비우고 메모로 표시
      r["배송사명"] = ""; r["송장번호"] = "";
      r["한줄메모"] = ("[" + o.csType + "] " + (r["한줄메모"] || "")).trim();
    } else {
      r["배송사명"] = firstFilled(courierToCode(o.courier), r["배송사명"]);
      r["송장번호"] = firstFilled(stripInvoiceNo(o.invoiceNumber), r["송장번호"]);
    }
    return r;
  }
  function exportSource(type) {
    if (!state.orders.length) { toast("내보낼 주문이 없어요"); return; }
    var onlyInvoiced = !!($("#exp-src-only-invoiced") && $("#exp-src-only-invoiced").checked);
    var list = state.orders.filter(function (o) { return !onlyInvoiced || (o.invoiceNumber && o.courier && !invoiceExcluded(o)); });
    if (!list.length) { toast("송장번호와 택배사가 입력된 주문이 없어요"); return; }
    var excludedN = list.filter(invoiceExcluded).length;
    var rows = sanitizeExportRows(list.map(sourceRow));
    var aoa = [SOURCE_HEADERS.slice()].concat(rows.map(function (r) { return SOURCE_HEADERS.map(function (h) { return r[h] == null ? "" : r[h]; }); }));
    var stamp = dateStamp();
    if (type === "csv") {
      var ws = XLSX.utils.aoa_to_sheet(aoa);
      downloadBlob("\ufeff" + XLSX.utils.sheet_to_csv(ws), "주문서_송장_" + stamp + ".csv", "text/csv;charset=utf-8");
    } else {
      if (type === "xls" && !window.BiffXls && !(window.XLSX && !window.XLSX.__compat)) {
        toast(".xls 엔진이 없어 .xlsx 로 내보냅니다"); type = "xlsx";
      }
      var wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), todayKey());
      XLSX.writeFile(wb, "주문서_송장_" + stamp + "." + type);
    }
    toast("소스 양식(36열) " + list.length + "건 내보냈어요" + (excludedN ? " · 출고중지/반품 " + excludedN + "건은 송장 칸을 비웠습니다" : ""));
    $("#modal-export").classList.add("hidden");
  }

  function rawVal(o, names) {
    names = Array.isArray(names) ? names : [names];
    var raw = o.raw || {};
    for (var i = 0; i < names.length; i++) {
      if (raw[names[i]] !== undefined && raw[names[i]] !== null && raw[names[i]] !== "") return raw[names[i]];
    }
    return "";
  }
  function stripInvoiceNo(v) { return String(v || "").replace(/[-\s]/g, ""); }
  function invoiceRow(o, idx) {
    var r = {};
    INVOICE_HEADERS.forEach(function (h) { r[h] = rawVal(o, h); });
    r["번호"] = r["번호"] || (idx + 1);
    r["묶음배송번호"] = r["묶음배송번호"] || rawVal(o, ["묶음배송번호","묶음 배송번호"]) || o.orderNumber;
    r["주문번호"] = r["주문번호"] || o.orderNumber;
    r["택배사"] = o.courier || r["택배사"];
    r["운송장번호"] = stripInvoiceNo(o.invoiceNumber);
    r["주문일"] = r["주문일"] || o.orderDate;
    r["등록상품명"] = r["등록상품명"] || o.productName;
    r["등록옵션명"] = r["등록옵션명"] || o.option;
    r["노출상품명(옵션명)"] = r["노출상품명(옵션명)"] || [o.productName, o.option].filter(Boolean).join(" / ");
    r["노출상품ID"] = r["노출상품ID"] || o.productId;
    r["결제액"] = r["결제액"] || o.paymentAmount;
    r["구매수(수량)"] = r["구매수(수량)"] || o.quantity;
    r["수취인이름"] = r["수취인이름"] || o.recipient;
    r["수취인전화번호"] = r["수취인전화번호"] || o.phone;
    r["우편번호"] = r["우편번호"] || o.zipcode;
    r["수취인 주소"] = r["수취인 주소"] || o.address;
    return r;
  }

  function writeSheet(rows, sheetName, fileBase, type) {
    rows = sanitizeExportRows(rows);
    var ws = XLSX.utils.json_to_sheet(rows);
    var stamp = dateStamp();
    if (type === "csv") {
      var csv = XLSX.utils.sheet_to_csv(ws);
      // 엑셀 한글 깨짐 방지: BOM 추가
      downloadBlob("﻿" + csv, fileBase + "_" + stamp + ".csv", "text/csv;charset=utf-8");
    } else {
      var wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
      XLSX.writeFile(wb, fileBase + "_" + stamp + ".xlsx");
    }
    toast("파일을 내보냈어요");
    $("#modal-export").classList.add("hidden");
  }

  function dateStamp() {
    var d = new Date();
    function p(n){ return ("0" + n).slice(-2); }
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "_" + p(d.getHours()) + p(d.getMinutes());
  }
  function downloadBlob(content, filename, mime) {
    var blob = new Blob([content], { type: mime });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = filename; document.body.appendChild(a); a.click();
    document.body.removeChild(a); setTimeout(function(){ URL.revokeObjectURL(url); }, 1000);
  }

  /* =====================================================================
   * 규칙 import/export
   * ===================================================================== */
  function exportRules() {
    downloadBlob(JSON.stringify(state.rules, null, 2), "rules.json", "application/json");
    toast("규칙을 rules.json 으로 내보냈어요");
  }
  function importRules(file) {
    var fr = new FileReader();
    fr.onload = function (e) {
      try {
        var r = JSON.parse(e.target.result);
        if (!r.categories) throw new Error("형식 오류");
        // 파일에 없는 기기 설정(내 연락처)은 유지 — 규칙 파일이 지우지 않게
        r.myPhone = r.myPhone || (state.rules && state.rules.myPhone) || "";
        state.rules = r; loadRulesDefaults(); saveRules();
        openSettings();
        toast("규칙을 불러왔어요");
      } catch (err) { toast("규칙 파일을 읽지 못했어요"); }
    };
    fr.readAsText(file);
  }

  /* =====================================================================
   * 우루루 올인원 워크북(.xlsx)에서 규칙·소싱 직접 가져오기 (단일 기준화)
   *  - 수수료표 / 분류규칙 / 소싱 라인업 시트를 읽어 앱 규칙으로 변환.
   *  - 워크북이 VAT포함값으로 마진을 계산하므로 vatIncluded=true, feeRate=기본율(%).
   *  - "수수료율·키워드를 워크북 한 곳에서만 관리" → 앱은 그걸 읽기만 (이중관리 제거).
   * ===================================================================== */
  function wbSheetMatrix(wb, names) {
    for (var i = 0; i < names.length; i++) {
      var ws = wb.Sheets[names[i]];
      if (ws) return XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
    }
    return null;
  }
  function findHeaderRow(matrix, firstColLabel) {
    for (var r = 0; r < matrix.length; r++) {
      if (String(matrix[r][0]).trim() === firstColLabel) return r;
    }
    return -1;
  }
  function rate100(v) {
    var n = toNumber(v);
    var pct = n > 1 ? n : n * 100;                     // 0.058 → 5.8 / 5.8 → 5.8
    return Math.round(pct * 100) / 100;               // 소수점 2자리 (12.86 유지)
  }

  function buildRulesFromWorkbook(feeM, clsM) {
    var rules = {
      vatIncluded: true,
      copyFormat: state.rules ? state.rules.copyFormat : "{name} / {phone} / ({zip}) {address}",
      myPhone: state.rules ? (state.rules.myPhone || "") : "",   // 기기 설정은 워크북 가져오기에도 유지
      defaultCategory: "기타(미지정)", defaultFeeRate: 12.86, categories: []
    };
    var byName = {};
    // 1) 수수료표 → 카테고리 + 기본수수료율
    if (feeM) {
      var hr = findHeaderRow(feeM, "카테고리");
      for (var r = (hr >= 0 ? hr + 1 : 0); r < feeM.length; r++) {
        var nm = String(feeM[r][0]).trim();
        if (!nm || nm.charAt(0) === "※") continue;      // 안내/주석 행 제외
        if (toNumber(feeM[r][1]) <= 0) continue;        // 수수료율 없는 행(주석 등) 제외
        var rt = rate100(feeM[r][1]);
        if (nm.indexOf("기타") !== -1) { rules.defaultCategory = nm; rules.defaultFeeRate = rt || 12.86; }
        if (!byName[nm]) { byName[nm] = { name: nm, feeRate: rt, keywords: [] }; rules.categories.push(byName[nm]); }
        else byName[nm].feeRate = rt;
      }
    }
    // 2) 분류규칙 → 키워드 → 카테고리
    if (clsM) {
      var hk = findHeaderRow(clsM, "키워드");
      for (var k = (hk >= 0 ? hk + 1 : 0); k < clsM.length; k++) {
        var kw = String(clsM[k][0]).trim(), cat = String(clsM[k][1]).trim();
        if (!kw || !cat) continue;
        if (!byName[cat]) { byName[cat] = { name: cat, feeRate: rules.defaultFeeRate, keywords: [] }; rules.categories.push(byName[cat]); }
        if (byName[cat].keywords.indexOf(kw) === -1) byName[cat].keywords.push(kw);
      }
    }
    return rules;
  }

  function loadSourcingFromWorkbook(srcM) {
    if (!srcM) return 0;
    // 소싱 라인업 헤더: A업로드 B상품명 C노출상품ID … I소싱가 … U쿠팡링크 V소싱링크
    var hr = findHeaderRow(srcM, "업로드");
    if (hr < 0) hr = findHeaderRow(srcM, "상품명") - 1;
    var idCol = 2, priceCol = 8, linkCol = 21, catCol = 3;  // 0-based: C,I,V,D
    // 헤더에서 실제 위치 보정
    if (hr >= 0 && srcM[hr]) {
      srcM[hr].forEach(function (h, i) {
        var s = String(h).trim();
        if (s.indexOf("노출상품ID") !== -1) idCol = i;
        else if (s === "소싱가") priceCol = i;
        else if (s === "소싱링크") linkCol = i;
        else if (s.indexOf("카테고리") !== -1) catCol = i;
      });
    }
    var n = 0;
    for (var r = (hr >= 0 ? hr + 1 : 0); r < srcM.length; r++) {
      var id = String(srcM[r][idCol] == null ? "" : srcM[r][idCol]).trim();
      if (!id) continue;
      var price = toNumber(srcM[r][priceCol]);
      state.sourcingMap[id] = {
        link: String(srcM[r][linkCol] || "").trim(),
        category: String(srcM[r][catCol] || "").trim(),
        price: price > 0 ? price : null
      };
      n++;
    }
    return n;
  }

  function findHeaderRowWith(matrix, labels) {
    if (!matrix) return -1;
    labels = labels || [];
    for (var r = 0; r < matrix.length; r++) {
      var row = matrix[r] || [];
      var hit = 0;
      labels.forEach(function (label) {
        var nl = norm(label);
        for (var c = 0; c < row.length; c++) {
          var cell = norm(row[c]);
          if (cell && (cell === nl || cell.indexOf(nl) !== -1 || nl.indexOf(cell) !== -1)) { hit++; break; }
        }
      });
      if (hit >= Math.min(labels.length, 2)) return r;
    }
    return -1;
  }
  function pickByHeader(row, header, aliases) {
    aliases = Array.isArray(aliases) ? aliases : [aliases];
    for (var a = 0; a < aliases.length; a++) {
      var na = norm(aliases[a]);
      for (var i = 0; i < header.length; i++) {
        var nh = norm(header[i]);
        if (nh && (nh === na || nh.indexOf(na) !== -1 || na.indexOf(nh) !== -1)) return row[i];
      }
    }
    return "";
  }
  function rowHasValue(row) {
    return (row || []).some(function (v) { return String(v == null ? "" : v).trim() !== ""; });
  }
  function loadProcessFromWorkbook(procM) {
    if (!procM) return 0;
    normalizeOps();
    state.ops.processNotes = procM.map(function (row) {
      return String(row && (row[1] || row[0]) || "").trim();
    }).filter(function (s) { return s && s.indexOf("None") === -1; }).slice(0, 40);
    return state.ops.processNotes.length;
  }
  function loadLineupOpsFromWorkbook(srcM) {
    if (!srcM) return 0;
    normalizeOps();
    var hr = findHeaderRowWith(srcM, ["상품명", "노출상품ID"]);
    if (hr < 0) return 0;
    var header = srcM[hr] || [];
    var n = 0;
    for (var r = hr + 1; r < srcM.length; r++) {
      var row = srcM[r] || [];
      var name = String(pickByHeader(row, header, ["상품명", "등록상품명"])).trim();
      var productId = String(pickByHeader(row, header, ["노출상품ID", "상품ID"])).trim();
      if (!name && !productId) continue;
      var key = productId || ("name:" + name);
      var x = lineExtra(key);
      x.name = name || x.name || "";
      x.productId = productId || x.productId || "";
      x.views = toNumber(pickByHeader(row, header, ["조회수"])) || x.views || "";
      x.salePrice = toNumber(pickByHeader(row, header, ["판매가"])) || x.salePrice || "";
      x.sourcingPrice = toNumber(pickByHeader(row, header, ["소싱가", "매입가"])) || x.sourcingPrice || "";
      x.feeRate = pickByHeader(row, header, ["적용수수료율", "수수료율"]) || x.feeRate || "";
      x.targetQty = toNumber(pickByHeader(row, header, ["목표수량"])) || x.targetQty || "";
      x.coupangLink = String(pickByHeader(row, header, ["쿠팡링크", "쿠팡 링크"])).trim() || x.coupangLink || "";
      x.sourcingLink = String(pickByHeader(row, header, ["소싱링크", "구매링크", "링크"])).trim() || x.sourcingLink || "";
      if (productId) {
        state.sourcingMap[productId] = state.sourcingMap[productId] || {};
        if (x.sourcingLink) state.sourcingMap[productId].link = x.sourcingLink;
        if (x.sourcingPrice) state.sourcingMap[productId].price = toNumber(x.sourcingPrice);
      }
      n++;
    }
    return n;
  }
  function loadPurchaseDbFromWorkbook(pdbM) {
    if (!pdbM) return 0;
    normalizeOps();
    var hr = findHeaderRowWith(pdbM, ["상품ID", "링크", "매입가"]);
    if (hr < 0) return 0;
    var header = pdbM[hr] || [];
    var rows = [];
    for (var r = hr + 1; r < pdbM.length; r++) {
      var row = pdbM[r] || [];
      if (!rowHasValue(row)) continue;
      var productId = String(pickByHeader(row, header, ["상품ID", "노출상품ID"])).trim();
      var name = String(pickByHeader(row, header, ["상품명", "상품명(자동)"])).trim();
      var url = String(pickByHeader(row, header, ["링크", "소싱링크", "구매링크"])).trim();
      var platform = String(pickByHeader(row, header, ["플랫폼", "소싱처"])).trim();
      var vendor = String(pickByHeader(row, header, ["매입처", "판매자", "매입처/판매자"])).trim();
      var price = toNumber(pickByHeader(row, header, ["매입가", "소싱가"]));
      var shipping = toNumber(pickByHeader(row, header, ["배송비"]));
      var total = toNumber(pickByHeader(row, header, ["총원가", "총 원가"]));
      var memo = String(pickByHeader(row, header, ["메모", "비고"])).trim();
      if (!productId && !name && !url && !platform && !vendor && !price && !shipping && !memo) continue;
      rows.push({
        id:newId("pdb"),
        productId:productId,
        name:name,
        platform:platform,
        vendor:vendor,
        url:url,
        price:price || "",
        shipping:shipping || "",
        totalCost:total || (price || shipping ? price + shipping : ""),
        best:String(pickByHeader(row, header, ["최저가"])).trim(),
        updated:String(pickByHeader(row, header, ["갱신일", "수정일"])).trim(),
        memo:memo
      });
    }
    state.ops.purchaseDb = rows;
    var bestByKey = {};
    rows.forEach(function (r) {
      var key = purchaseKey(r), total = purchaseTotal(r);
      if (!key || !total) return;
      if (!bestByKey[key] || total < bestByKey[key].total) bestByKey[key] = { row:r, total:total };
    });
    Object.keys(bestByKey).forEach(function (key) {
      var row = bestByKey[key].row;
      var x = lineExtra(key);
      // 소싱가에는 '단가'만 (배송비 포함 총원가를 단가로 쓰면 수량 곱에서 배송비가 중복됨)
      var unit = toNumber(row.price) > 0 ? toNumber(row.price) : bestByKey[key].total;
      if (row.name && !x.name) x.name = row.name;
      if (row.productId && !x.productId) x.productId = row.productId;
      if (row.url && !x.sourcingLink) x.sourcingLink = row.url;
      if (unit && !x.sourcingPrice) x.sourcingPrice = unit;
      if (row.productId) state.sourcingMap[row.productId] = { link:row.url || "", category:"", price:unit };
    });
    return rows.length;
  }
  function loadJournalFromWorkbook(mat, store) {
    if (!mat) return 0;
    normalizeOps();
    var hr = findHeaderRowWith(mat, ["일차", "날짜", "업로드"]);
    if (hr < 0) return 0;
    var header = mat[hr] || [];
    var rows = [];
    for (var r = hr + 1; r < mat.length && rows.length < 31; r++) {
      var row = mat[r] || [];
      if (!rowHasValue(row)) continue;
      rows.push({
        day:toNumber(pickByHeader(row, header, ["일차"])) || rows.length + 1,
        date:String(pickByHeader(row, header, ["날짜"])).trim(),
        uploads:String(pickByHeader(row, header, ["업로드 수", "업로드"])).trim(),
        sales:String(pickByHeader(row, header, ["매출(만원)", "매출"])).trim(),
        cert:String(pickByHeader(row, header, ["개인톡 인증", "인증"])).trim(),
        note:String(pickByHeader(row, header, ["막힌 점 한 줄", "막힌 점", "메모"])).trim()
      });
    }
    if (rows.length) state.ops[store] = rows;
    return rows.length;
  }
  function loadSimpleOpsFromWorkbook(mat, type) {
    if (!mat) return 0;
    var cfg = SIMPLE_OPS[type];
    if (!cfg) return 0;
    normalizeOps();
    var hr = findHeaderRowWith(mat, cfg.labels.slice(0, 3));
    if (hr < 0) return 0;
    var header = mat[hr] || [];
    var rows = [];
    for (var r = hr + 1; r < mat.length; r++) {
      var row = mat[r] || [];
      if (!rowHasValue(row)) continue;
      var obj = {};
      cfg.fields.forEach(function (f, i) {
        obj[f] = String(pickByHeader(row, header, cfg.labels[i])).trim();
      });
      if (Object.keys(obj).some(function (k) { return obj[k]; })) rows.push(obj);
    }
    state.ops[cfg.store] = rows;
    return rows.length;
  }

  function importWorkbook(file) {
    var fr = new FileReader();
    fr.onload = function (e) {
      XLSX.readAsync(new Uint8Array(e.target.result), { type: "array" }).then(function (wb) {
      try {
        normalizeOps();
        var procM = wbSheetMatrix(wb, ["📋 프로세스", "프로세스"]);
        var feeM = wbSheetMatrix(wb, ["수수료표"]);
        var clsM = wbSheetMatrix(wb, ["분류규칙"]);
        var srcM = wbSheetMatrix(wb, ["소싱 라인업", "소싱라인업"]);
        var pdbM = wbSheetMatrix(wb, ["📒 매입처DB", "매입처DB", "매입처 DB"]);
        var sideM = wbSheetMatrix(wb, ["수행일지·부업", "수행일지-부업"]);
        var mainM = wbSheetMatrix(wb, ["수행일지·본업", "수행일지-본업"]);
        var accM = wbSheetMatrix(wb, ["계정관리", "계정 관리"]);
        var cardM = wbSheetMatrix(wb, ["카드관리", "카드 관리"]);
        if (feeM || clsM) {
          state.rules = buildRulesFromWorkbook(feeM, clsM);
          saveRules();
        }
        var procN = loadProcessFromWorkbook(procM);
        var lineN = loadLineupOpsFromWorkbook(srcM);
        var n = loadSourcingFromWorkbook(srcM);
        var dbN = loadPurchaseDbFromWorkbook(pdbM);
        var sideN = loadJournalFromWorkbook(sideM, "journalSide");
        var mainN = loadJournalFromWorkbook(mainM, "journalMain");
        var accN = loadSimpleOpsFromWorkbook(accM, "accounts");
        var cardN = loadSimpleOpsFromWorkbook(cardM, "cards");
        var importedN = (feeM || clsM ? 1 : 0) + procN + lineN + n + dbN + sideN + mainN + accN + cardN;
        if (!importedN) { toast("워크북에서 가져올 수 있는 탭을 찾지 못했어요"); return; }
        recomputeAll(); persist();
        openSettings();
        if (!$("#view-dashboard").classList.contains("hidden")) render();
        toast("워크북 가져오기 완료: 카테고리 " + state.rules.categories.length + "개 · 라인업 " + lineN + "건 · DB " + dbN + "건");
      } catch (err) { toast("워크북을 읽지 못했어요: " + (err.message || "")); }
      }).catch(function (err) { toast("워크북을 읽지 못했어요: " + (err.message || "")); });
    };
    fr.readAsArrayBuffer(file);
  }

  /* =====================================================================
   * 파일 업로드 흐름
   * ===================================================================== */
  function handleOrderFile(file) {
    $("#order-file").textContent = "📑 " + file.name + " 읽는 중...";
    readWorkbook(file).then(function (parsed) {
      $("#order-file").textContent = "📑 " + file.name;
      processOrderParsed(parsed);
    }).catch(function (err) {
      $("#order-file").textContent = "";
      toast("파일을 읽지 못했어요: " + (err.message || ""));
    });
  }

  // 발주서 파일/붙여넣기 공통 후처리: 자동매핑 → (실패시)매핑화면 / (성공시)정리
  function processOrderParsed(parsed) {
    if (!parsed.rows.length) { toast("데이터가 비어 있어요"); return; }
    var auto = autoMap(parsed.header);
    var missingReq = FIELDS.filter(function (f) { return f.req && !auto[f.key]; });
    if (missingReq.length) showMapping(parsed);   // 필수 자동인식 실패 → 매핑 화면
    else finalizeOrders(parsed, auto);
  }

  /* ---- 구글시트/엑셀 복사 → 붙여넣기 (TSV/CSV 텍스트 파싱) ---- */
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
      // 따옴표는 '셀 시작'에서만 인용 시작으로 취급 — 상품명 속 인치표기(27")가 파싱을 깨지 않게
      if (ch === '"' && cur === "") { inQ = true; i++; continue; }
      if (ch === delim) { row.push(cur); cur = ""; i++; continue; }
      if (ch === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; i++; continue; }
      cur += ch; i++;
    }
    if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
    return rows;
  }

  // 2차원 배열(matrix) → {rows, header} (붙여넣기·구글시트 공통)
  function matrixToParsed(matrix) {
    var clean = (matrix || []).filter(function (r) {
      return r && r.some(function (c) { return String(c).trim() !== ""; });   // 빈 줄 제거
    });
    if (!clean.length) return { rows: [], header: [] };
    var header = clean.shift().map(function (h) { return String(h).trim(); });
    var rows = clean.map(function (r) {
      var o = {}; header.forEach(function (h, idx) { o[h] = r[idx] !== undefined ? r[idx] : ""; }); return o;
    });
    return { rows: rows, header: header };
  }

  function parsePasted(text) {
    text = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n+$/, "");
    if (!text.trim()) return { rows: [], header: [] };
    var delim = text.indexOf("\t") !== -1 ? "\t" : ",";   // 구글시트 복사 = 탭 구분
    return matrixToParsed(dsvToMatrix(text, delim));
  }

  /* =====================================================================
   * 구글시트 실시간 연동 (선택/클라우드 모드)
   *  - 기본은 100% 로컬. 이 기능을 "사용자가 직접 켜고 불러올 때만"
   *    구글 스크립트를 로드하고 외부 호출을 합니다.
   *  - file:// 에서는 불가(구글 OAuth가 막음) → localhost 서버에서만 동작.
   * ===================================================================== */
  function loadCloud() {
    try {
      var c = JSON.parse(localStorage.getItem(LS.cloud));
      if (c) state.cloud = Object.assign(state.cloud, c);
    } catch (e) {}
  }
  function saveCloud() { safeSetItem(LS.cloud, JSON.stringify(state.cloud)); }

  function extractSheetId(s) {
    s = String(s || "").trim();
    var m = s.match(/\/d\/([a-zA-Z0-9-_]+)/);
    if (m) return m[1];
    if (/^[a-zA-Z0-9-_]{20,}$/.test(s)) return s;   // 이미 ID만 입력한 경우
    return "";
  }

  var gisPromise = null;
  function ensureGis() {
    if (window.google && google.accounts && google.accounts.oauth2) return Promise.resolve();
    if (gisPromise) return gisPromise;
    gisPromise = new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = "https://accounts.google.com/gsi/client";
      s.async = true; s.defer = true;
      s.onload = function () { resolve(); };
      s.onerror = function () { gisPromise = null; reject(new Error("구글 스크립트 로드 실패 — 인터넷 연결을 확인하세요")); };
      document.head.appendChild(s);
    });
    return gisPromise;
  }

  function getAccessToken(clientId) {
    return new Promise(function (resolve, reject) {
      var tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
        callback: function (resp) {
          if (resp && resp.access_token) resolve(resp.access_token);
          else reject(new Error("인증 토큰을 받지 못했습니다"));
        },
        error_callback: function (err) {
          reject(new Error("구글 인증이 취소되었거나 실패했습니다" + (err && err.type ? " (" + err.type + ")" : "")));
        }
      });
      tokenClient.requestAccessToken({ prompt: "" });
    });
  }

  function apiGet(url, token) {
    return fetch(url, { headers: { Authorization: "Bearer " + token } }).then(function (r) {
      return r.json().then(function (j) {
        if (j && j.error) throw new Error(j.error.message || ("구글 API 오류 " + r.status));
        if (!r.ok) throw new Error("구글 API 오류 " + r.status);
        return j;
      });
    });
  }

  function fetchSheetValues(token, sheetId, range) {
    var base = "https://sheets.googleapis.com/v4/spreadsheets/" + sheetId;
    var rangeP = Promise.resolve(range);
    if (!range) {
      // 범위 미지정 → 첫 번째 시트 제목을 알아내 그 시트 전체를 가져옴
      rangeP = apiGet(base + "?fields=sheets.properties.title", token).then(function (meta) {
        if (!meta.sheets || !meta.sheets.length) throw new Error("시트를 찾을 수 없습니다");
        return meta.sheets[0].properties.title;
      });
    }
    return rangeP.then(function (rng) {
      return apiGet(base + "/values/" + encodeURIComponent(rng), token).then(function (data) {
        return data.values || [];
      });
    });
  }

  function cloudLoad() {
    if (location.protocol === "file:") {
      toast("이 기능은 localhost 서버에서만 됩니다 (README의 로컬 서버 실행법 참고)");
      return;
    }
    var clientId = (state.cloud.clientId || "").trim();
    var sheetId = extractSheetId(state.cloud.sheet);
    if (!clientId) { toast("설정에서 OAuth Client ID를 입력하세요"); openSettings(); return; }
    if (!sheetId) { toast("설정에서 구글시트 주소(또는 ID)를 입력하세요"); openSettings(); return; }
    if (!confirm("구글시트에서 주문 데이터를 불러오면 고객 정보가 구글 계정/네트워크를 경유합니다.\n계속 불러올까요?")) return;

    var status = $("#cloud-status");
    status.textContent = "구글 인증 중...";
    ensureGis()
      .then(function () { return getAccessToken(clientId); })
      .then(function (token) { status.textContent = "시트 불러오는 중..."; return fetchSheetValues(token, sheetId, (state.cloud.range || "").trim()); })
      .then(function (values) {
        status.textContent = "";
        var parsed = matrixToParsed(values);
        if (!parsed.header.length) { toast("시트에서 데이터를 찾지 못했어요"); return; }
        $("#order-file").textContent = "구글시트 (" + parsed.rows.length + "행)";
        processOrderParsed(parsed);
      })
      .catch(function (err) {
        status.textContent = "";
        toast("불러오기 실패: " + (err.message || err));
      });
  }

  function updatePrivacyUI() {
    var on = !!state.cloud.enabled;
    var pill = $("#privacy-pill");
    pill.classList.toggle("cloud", on);
    pill.textContent = on ? "구글 연동 모드" : "로컬 처리";
    pill.title = on ? "구글시트 연동이 켜져 있습니다 (불러올 때 데이터가 구글을 경유)" : "모든 처리는 사용자 PC 안에서만 이뤄집니다";
    $("#privacy-banner").classList.toggle("hidden", on);
    $("#cloud-warn").classList.toggle("hidden", !on);
    // 업로드 화면의 클라우드 불러오기 패널 표시 여부
    $("#cloud-load-panel").classList.toggle("hidden", !on);
  }

  function handlePaste() {
    var text = $("#paste-area").value;
    if (!text.trim()) { toast("붙여넣은 내용이 없어요"); return; }
    var parsed = parsePasted(text);
    if (!parsed.header.length) { toast("표 형식을 인식하지 못했어요"); return; }
    $("#order-file").textContent = "붙여넣기 (" + parsed.rows.length + "행)";
    processOrderParsed(parsed);
  }

  function finalizeOrders(parsed, map) {
    state.orders = buildOrders(parsed.rows, map);
    if (!state.orders.length) { toast("유효한 주문 행이 없어요"); return; }
    persist();
    showDashboard();
    toast(state.orders.length + "건의 주문을 정리했어요");
  }

  function handleMapFile(file) {
    $("#map-file").textContent = file.name + " 읽는 중…";
    readWorkbook(file).then(function (parsed) {
      var res = buildSourcingMap(parsed);
      if (!res.ok) { $("#map-file").textContent = ""; toast("매핑표에서 '노출상품ID' 열을 찾지 못했어요"); return; }
      state.sourcingMap = res.map;
      saveSourcingMap();   // 주문이 없어도 즉시 저장 — 새로고침해도 유지
      $("#map-file").textContent = file.name + " (" + res.count + "건 매핑)";
      // 이미 주문이 있으면 즉시 반영
      if (state.orders.length) {
        state.orders.forEach(function (o) {
          var sm = state.sourcingMap[o.productId];
          if (sm) {
            if (!o.sourcingLink && sm.link) o.sourcingLink = sm.link;
            if ((o.sourcingPrice == null) && sm.price) o.sourcingPrice = sm.price;
          }
        });
        recomputeAll(); persist(); render();
      }
      toast("소싱 매핑표 " + res.count + "건을 불러왔어요");
    }).catch(function () { $("#map-file").textContent = ""; toast("매핑표를 읽지 못했어요"); });
  }

  /* =====================================================================
   * 드래그앤드롭 + 입력 바인딩
   * ===================================================================== */
  function bindDrop(zoneId, inputId, handler) {
    var zone = $(zoneId), input = $(inputId);
    zone.addEventListener("click", function (e) { if (e.target.tagName !== "INPUT") input.click(); });
    input.addEventListener("change", function () {
      var f = input.files[0];
      input.value = "";           // 같은 파일을 다시 선택해도 change가 다시 발생하도록
      if (f) handler(f);
    });
    ["dragenter","dragover"].forEach(function (ev) {
      zone.addEventListener(ev, function (e) { e.preventDefault(); zone.classList.add("drag"); });
    });
    ["dragleave","drop"].forEach(function (ev) {
      zone.addEventListener(ev, function (e) { e.preventDefault(); zone.classList.remove("drag"); });
    });
    zone.addEventListener("drop", function (e) {
      var f = e.dataTransfer.files[0]; if (f) handler(f);
    });
  }

  /* =====================================================================
   * 초기화 / 이벤트 연결
   * ===================================================================== */
  function performReset(hard) {
    state.orders = []; state.sourcingMap = {}; state.deleted = [];
    if (hard) state.ops = defaultOps();
    state.ui.sourcingOpen = {}; state.ui.colOrder = defaultSheetColOrder(); state.ui.colWidths = {}; state.ui.rowHeights = {}; state.ui.layoutVersion = SHEET_LAYOUT_VERSION;
    localStorage.removeItem(LS.orders);
    localStorage.removeItem(LS.sourcingMap);
    if (hard) localStorage.removeItem(LS.deleted);   // 휴지통은 hard일 때만 비움(복구 경로 유지)
    if (hard) localStorage.removeItem(LS.states);
    if (hard) localStorage.removeItem(LS.ops);
    $("#order-file").textContent = ""; $("#map-file").textContent = "";
    $("#in-order").value = ""; $("#in-map").value = "";
    show("upload");
  }
  function reset(hard, onDone) {
    // 데이터가 지워지므로 반드시 확인 — 직접 추가한 행은 복구 불가
    if (!hard && !state.orders.length) { performReset(false); if (onDone) onDone(); return; }
    var opts = hard
      ? { title: "완전 삭제", body: "현재 주문 목록과 진행상태를 모두 지웁니다.\n설정·수수료 규칙은 유지됩니다.", okLabel: "모두 삭제", danger: true }
      : { title: "처음으로", body: "현재 주문 " + state.orders.length + "건을 지우고 업로드 화면으로 갑니다.\n발주서를 다시 올리면 진행상태는 복원되지만, 직접 추가한 행은 사라집니다.", okLabel: "업로드 화면으로", danger: true };
    showConfirm(opts, function () { performReset(hard); if (onDone) onDone(); });
  }

  function init() {
    loadRules();
    loadCloud();

    // 열 매핑 표 — 1회 바인딩 (showMapping 안에서 등록하면 업로드마다 누적됨)
    var mapRows = $("#map-rows");
    if (mapRows) mapRows.addEventListener("change", updateMapStates);

    // 업로드 드롭존
    bindDrop("#dz-order", "#in-order", handleOrderFile);
    bindDrop("#dz-map", "#in-map", handleMapFile);

    // 구글시트 붙여넣기
    $("#btn-paste-go").addEventListener("click", handlePaste);
    $("#btn-paste-clear").addEventListener("click", function () {
      $("#paste-area").value = ""; $("#paste-hint").textContent = "";
    });
    $("#paste-area").addEventListener("input", function () {
      var t = this.value.trim();
      if (!t) { $("#paste-hint").textContent = ""; return; }
      var lines = t.split(/\n/).filter(function (l) { return l.trim(); });
      var cols = (t.indexOf("\t") !== -1 ? t.split(/\n/)[0].split("\t") : t.split(/\n/)[0].split(",")).length;
      $("#paste-hint").textContent = "약 " + Math.max(0, lines.length - 1) + "행 · " + cols + "열 감지 (첫 줄=머리글)";
    });

    // 구글시트 실시간 연동(클라우드)
    $("#btn-cloud-load").addEventListener("click", cloudLoad);
    $("#btn-cloud-settings").addEventListener("click", openSettings);
    $("#set-cloud-enabled").addEventListener("change", toggleCloudFields);

    // 매핑 화면
    $("#btn-map-confirm").addEventListener("click", function () {
      var m = currentMapping();
      var missing = FIELDS.filter(function (f) { return f.req && !m[f.key]; });
      if (missing.length) { toast("필수 항목(" + missing.map(function(x){return x.label;}).join(", ") + ")을 연결해 주세요"); return; }
      finalizeOrders(state.pending, m);
    });
    $("#btn-map-cancel").addEventListener("click", function () { show("upload"); });

    // 대시보드 툴바
    // 검색은 디바운스(타이핑마다 전체 재렌더 방지), 저장은 UI 상태만
    var qTimer = null;
    $("#q").addEventListener("input", function () {
      state.ui.q = this.value;
      clearTimeout(qTimer);
      qTimer = setTimeout(function () { saveUiOnly(); render(); }, 180);
    });
    $("#f-status").addEventListener("change", function () { state.ui.status = this.value; saveUiOnly(); render(); });
    $("#f-sort").addEventListener("change", function () { state.ui.sort = this.value; saveUiOnly(); render(); });
    var fg = $("#f-group"); if (fg) fg.addEventListener("change", function () { state.ui.group = this.value; saveUiOnly(); render(); });

    // 상단 탭 전환
    var tabnav = $("#tabnav");
    if (tabnav) tabnav.addEventListener("click", function (e) {
      var b = e.target.closest("[data-tab]"); if (b) setTab(b.getAttribute("data-tab"));
    });
    var processStrip = $("#process-strip");
    if (processStrip) processStrip.addEventListener("click", function (e) {
      var b = e.target.closest("[data-process-tab]");
      if (b) setTab(b.getAttribute("data-process-tab"));
    });
    // DB 탭: 후보 소싱링크·매입가 인라인 편집
    var ps = $("#pane-sourcing"); if (ps) ps.addEventListener("input", onSourcingInput);
    if (ps) ps.addEventListener("click", onSourcingClick);
    if (ps) ps.addEventListener("focusout", onSourcingFocusOut);
    var pl = $("#pane-lineup");
    if (pl) {
      pl.addEventListener("input", onLineupInput);
      pl.addEventListener("click", onLineupClick);
      pl.addEventListener("focusout", onLineupFocusOut);
    }
    var pc = $("#pane-calc");
    if (pc) {
      pc.addEventListener("input", onCalcInput);
      pc.addEventListener("click", onCalcClick);
      pc.addEventListener("focusout", onCalcFocusOut);
    }
    var pi = $("#pane-invoice");
    if (pi) pi.addEventListener("click", function (e) {
      if (e.target.closest("[data-invoice-export-coupang]")) exportInvoice("xlsx");
      else if (e.target.closest("[data-invoice-export]")) exportSource("xlsx");
    });
    var pj = $("#pane-journal");
    if (pj) pj.addEventListener("input", onJournalInput);
    ["accounts", "cards"].forEach(function (type) {
      var pane = $("#pane-" + type);
      if (!pane) return;
      pane.addEventListener("input", onSimpleOpsInput);
      pane.addEventListener("click", onSimpleOpsClick);
    });

    // 📊 시트(그리드) — 자동 저장 편집
    var st = $("#sheet-table");
    if (st) {
      st.addEventListener("input", onSheetInput);
      st.addEventListener("change", onSheetChange);
      st.addEventListener("focusout", onSheetFocusOut);
      st.addEventListener("click", onSheetClick);
      st.addEventListener("mousedown", startSheetResize);
      st.addEventListener("dragstart", onSheetDragStart);
      st.addEventListener("dragover", onSheetDragOver);
      st.addEventListener("drop", onSheetDrop);
      st.addEventListener("dragend", onSheetDragEnd);
      st.addEventListener("keydown", onSheetKey);
      st.addEventListener("paste", onSheetPaste);
    }
    var csPane = $("#pane-cs");
    if (csPane) {
      csPane.addEventListener("click", onCsClick);
      csPane.addEventListener("change", onCsChange);
      csPane.addEventListener("input", onCsInput);
      csPane.addEventListener("focusout", onCsFocusOut);
    }
    document.addEventListener("mousemove", moveSheetResize);
    document.addEventListener("mouseup", stopSheetResize);
    var sa = $("#sheet-add"); if (sa) sa.addEventListener("click", sheetAddRow);
    var sca = $("#sheet-col-add"); if (sca) sca.addEventListener("click", addCustomColumn);
    var slr = $("#sheet-layout-reset"); if (slr) slr.addEventListener("click", resetSheetLayout);
    var su = $("#sheet-undo"); if (su) su.addEventListener("click", undoDeletedRow);

    // 상단 버튼
    $("#btn-settings").addEventListener("click", openSettings);
    $("#btn-reset").addEventListener("click", function () { reset(false); });
    $("#btn-export").addEventListener("click", function () { $("#modal-export").classList.remove("hidden"); });
    var qi = $("#btn-quick-invoice"); if (qi) qi.addEventListener("click", function () { exportSource("xlsx"); });

    // 메모 모달
    var memoClose = $("#btn-memo-close"); if (memoClose) memoClose.addEventListener("click", closeMemo);
    var memoCancel = $("#btn-memo-cancel"); if (memoCancel) memoCancel.addEventListener("click", closeMemo);
    var memoAdd = $("#btn-memo-add"); if (memoAdd) memoAdd.addEventListener("click", addMemo);
    var memoList = $("#memo-list");
    if (memoList) memoList.addEventListener("click", function (e) {
      var b = e.target.closest("[data-memo-del]"); if (!b) return;
      deleteMemo(parseInt(b.getAttribute("data-memo-del"), 10));
    });

    // 설정 모달
    $("#btn-set-close").addEventListener("click", closeSettings);
    $("#btn-set-cancel").addEventListener("click", closeSettings);
    $("#btn-set-save").addEventListener("click", saveSettings);
    $("#set-copyfmt").addEventListener("input", updateCopyPreview);
    $("#fee-rows").addEventListener("click", function (e) {
      var d = e.target.closest("[data-del]"); if (!d) return;
      var cats = readFeeRows(); cats.splice(parseInt(d.getAttribute("data-del"), 10), 1);
      renderFeeRows(cats);
    });
    $("#btn-add-cat").addEventListener("click", function () {
      var cats = readFeeRows(); cats.push({ name: "새 카테고리", feeRate: 10.8, keywords: [] });
      renderFeeRows(cats);
    });
    $("#btn-rules-export").addEventListener("click", exportRules);
    $("#btn-rules-import").addEventListener("click", function () { $("#in-rules").click(); });
    $("#in-rules").addEventListener("change", function () { if (this.files[0]) importRules(this.files[0]); this.value = ""; });
    var secClear = $("#btn-security-clear");
    if (secClear) secClear.addEventListener("click", function () { reset(true, closeSettings); });
    $("#btn-import-workbook").addEventListener("click", function () { $("#in-workbook").click(); });
    $("#in-workbook").addEventListener("change", function () { if (this.files[0]) importWorkbook(this.files[0]); this.value = ""; });

    // 결제창 자동입력 북마클릿
    var bm = $("#oh-bookmarklet");
    if (bm) {
      bm.setAttribute("href", BOOKMARKLET);
      bm.addEventListener("click", function (e) { e.preventDefault(); toast("이 버튼을 북마크바로 '드래그'하세요 (클릭 아님)"); });
    }
    var cbm = $("#btn-copy-bookmarklet");
    if (cbm) cbm.addEventListener("click", function () { copyText(BOOKMARKLET, "북마클릿 코드"); });
    $("#btn-rules-default").addEventListener("click", function () {
      showConfirm({ title: "기본값으로 초기화", body: "수수료율·분류 키워드를 기본값으로 되돌립니다.", okLabel: "되돌리기", danger: true }, function () {
        state.rules = deepCopy(window.DEFAULT_RULES); saveRules(); openSettings(); toast("기본값으로 초기화했습니다");
      });
    });

    // 내보내기 모달
    $("#btn-exp-close").addEventListener("click", function () { $("#modal-export").classList.add("hidden"); });
    $("#btn-exp-xlsx").addEventListener("click", function () { exportFull("xlsx"); });
    $("#btn-exp-csv").addEventListener("click", function () { exportFull("csv"); });
    $("#btn-exp-src-xlsx").addEventListener("click", function () { exportSource("xlsx"); });
    $("#btn-exp-src-xls").addEventListener("click", function () { exportSource("xls"); });
    $("#btn-exp-src-csv").addEventListener("click", function () { exportSource("csv"); });
    $("#btn-exp-invoice-xlsx").addEventListener("click", function () { exportInvoice("xlsx"); });
    $("#btn-exp-invoice-csv").addEventListener("click", function () { exportInvoice("csv"); });

    // 모달 배경 클릭으로 닫기
    $$(".modal-bg").forEach(function (bg) {
      bg.addEventListener("click", function (e) { if (e.target === bg) bg.classList.add("hidden"); });
    });

    // 개인정보 배지/배너 + 클라우드 패널 상태 반영
    updatePrivacyUI();

    // 이전 세션 복원
    if (!restoreSession()) show("upload");
  }

  document.addEventListener("DOMContentLoaded", init);
})();
