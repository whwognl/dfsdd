/* =====================================================================
 * core.js — 주문 데이터 표준 모델 (앱 · 엑셀 양식 공용)
 *
 * 기준 양식: 2026-09 최신 워크북의 "2.주문서" 시트 (헤더 3행 / 53열).
 * 이 파일이 열 이름·순서·계산식의 단일 기준입니다.
 * 앱(app.js)과 엑셀 양식 생성기(template.js)가 같은 정의를 씁니다.
 * ===================================================================== */
(function (global) {
  "use strict";

  /* ---------------------------------------------------------------
   * 1. 주문서 열 정의 — 워크북 순서 그대로 (1~53열)
   *    kind: input(직접입력) / auto(수집·자동) / calc(수식)
   * --------------------------------------------------------------- */
  var ORDER_COLUMNS = [
    { key: "collectedAt",       label: "수집일",              type: "datetime", kind: "auto",  w: 15 },
    { key: "orderedAt",         label: "주문일",              type: "datetime", kind: "auto",  w: 15 },
    { key: "siteOrderNo",       label: "판매사이트 주문번호", type: "text",     kind: "auto",  w: 24 },
    { key: "siteName",          label: "판매사이트명",        type: "text",     kind: "auto",  w: 11 },
    { key: "siteAccount",       label: "아이디",              type: "text",     kind: "auto",  w: 13 },
    { key: "salePrice",         label: "판매가",              type: "money",    kind: "auto",  w: 11 },
    { key: "shipFee",           label: "배송비",              type: "money",    kind: "auto",  w: 9 },
    { key: "pltCode",           label: "플토코드",            type: "text",     kind: "auto",  w: 11 },
    { key: "siteProductCode",   label: "판매사이트 상품코드", type: "text",     kind: "auto",  w: 15 },
    { key: "productName",       label: "상품명",              type: "text",     kind: "auto",  w: 38 },
    { key: "sellerProductCode", label: "판매자상품코드",      type: "text",     kind: "auto",  w: 14 },
    { key: "optionText",        label: "주문선택사항",        type: "text",     kind: "auto",  w: 22 },
    { key: "qty",               label: "주문수량",            type: "int",      kind: "auto",  w: 9 },
    { key: "discount",          label: "에누리",              type: "money",    kind: "input", w: 9 },
    { key: "buyLink",           label: "구매링크",            type: "link",     kind: "input", w: 26 },
    { key: "buyUnitPrice",      label: "구매가",              type: "money",    kind: "input", w: 11 },
    { key: "buyerName",         label: "구매자명",            type: "text",     kind: "auto",  w: 11 },
    { key: "recipient",         label: "수령자명",            type: "text",     kind: "auto",  w: 11 },
    { key: "recvTel",           label: "수령자전화번호",      type: "text",     kind: "auto",  w: 15 },
    { key: "recvPhone",         label: "수령자휴대폰번호",    type: "text",     kind: "auto",  w: 15 },
    { key: "zipcode",           label: "우편번호",            type: "text",     kind: "auto",  w: 10 },
    { key: "address",           label: "배송지주소",          type: "text",     kind: "auto",  w: 46 },
    { key: "deliveryMemo",      label: "배송메세지",          type: "text",     kind: "auto",  w: 18 },
    { key: "manager",           label: "담당자",              type: "text",     kind: "input", w: 10 },
    { key: "vendor",            label: "구매처",              type: "text",     kind: "input", w: 12 },
    { key: "vendorAccount",     label: "계정",                type: "text",     kind: "input", w: 15 },
    { key: "buyAmount",         label: "구매금액",            type: "money",    kind: "input", w: 12 },
    { key: "buyOrderNo",        label: "주문번호",            type: "text",     kind: "input", w: 22 },
    { key: "paidAt",            label: "결제일시",            type: "datetime", kind: "input", w: 15 },
    { key: "cardName",          label: "카드정보",            type: "text",     kind: "input", w: 10 },
    { key: "point",             label: "포인트",              type: "money",    kind: "input", w: 10 },
    { key: "orderedYn",         label: "주문여부",            type: "yn",       kind: "input", w: 9 },
    { key: "memo",              label: "메모",                type: "text",     kind: "input", w: 24 },
    { key: "uniqueNo",          label: "주문고유번호",        type: "text",     kind: "auto",  w: 16 },
    { key: "courierCode",       label: "배송사명",            type: "courier",  kind: "input", w: 11 },
    { key: "invoiceNo",         label: "송장번호",            type: "text",     kind: "input", w: 17 },
    { key: "invoiceUploaded",   label: "운송장업로드",        type: "text",     kind: "calc",  w: 12 },
    { key: "settleSite",        label: "판매사이트명",        type: "text",     kind: "calc",  w: 11 },
    { key: "category",          label: "카테고리",            type: "text",     kind: "input", w: 16 },
    { key: "settleBase",        label: "결제기준가",          type: "money",    kind: "calc",  w: 12 },
    { key: "shipNet",           label: "배송비-배송비수수료", type: "money",    kind: "calc",  w: 13 },
    { key: "settleOrderNo",     label: "주문번호",            type: "text",     kind: "calc",  w: 20 },
    { key: "saleDate",          label: "매출일자",            type: "date",     kind: "calc",  w: 12 },
    { key: "revenue",           label: "매출금액",            type: "money",    kind: "calc",  w: 12 },
    { key: "netMargin",         label: "순마진금액",          type: "money",    kind: "calc",  w: 12 },
    { key: "pointOut",          label: "포인트",              type: "money",    kind: "calc",  w: 10 },
    { key: "marginRate",        label: "마진률",              type: "pct",      kind: "calc",  w: 10 },
    { key: "feeRate",           label: "수수료율",            type: "pct",      kind: "calc",  w: 10 },
    { key: "feeRateVat",        label: "수수료율(VAT)",       type: "pct",      kind: "calc",  w: 12 },
    { key: "fee",               label: "수수료",              type: "money",    kind: "calc",  w: 11 },
    { key: "vat",               label: "부가세",              type: "money",    kind: "calc",  w: 11 },
    { key: "ollaFee",           label: "올라수수료",          type: "money",    kind: "calc",  w: 11 },
    { key: "memo2",             label: "메모",                type: "text",     kind: "input", w: 20 }
  ];

  /* 헤더 자동인식용 별칭 — 쿠팡 발주서 등 다른 양식도 이 모델로 흡수 */
  var COLUMN_ALIASES = {
    collectedAt:       ["수집일", "수집일시", "수집시각"],
    orderedAt:         ["주문일", "주문일시", "주문시각", "결제일", "주문날짜"],
    siteOrderNo:       ["판매사이트 주문번호", "판매사이트주문번호", "주문번호", "묶음배송번호", "주문 번호"],
    siteName:          ["판매사이트명", "판매사이트", "판매처", "마켓", "쇼핑몰"],
    siteAccount:       ["아이디", "판매아이디", "스토어아이디", "계정아이디"],
    salePrice:         ["판매가", "결제액", "결제금액", "총결제금액", "상품금액", "주문금액", "매출금액"],
    shipFee:           ["배송비", "배송비합계", "배송비금액"],
    pltCode:           ["플토코드", "플토", "플랫폼코드"],
    siteProductCode:   ["판매사이트 상품코드", "노출상품ID", "노출상품아이디", "상품ID", "옵션ID", "등록상품ID"],
    productName:       ["상품명", "등록상품명", "노출상품명", "제품명", "노출 상품명"],
    sellerProductCode: ["판매자상품코드", "업체상품코드", "판매자 상품코드", "자체상품코드"],
    optionText:        ["주문선택사항", "등록옵션명", "옵션명", "옵션", "구매옵션", "노출상품명(옵션명)"],
    qty:               ["주문수량", "구매수(수량)", "구매수량", "구매수", "수량"],
    discount:          ["에누리", "할인", "할인금액"],
    buyLink:           ["구매링크", "소싱링크", "매입링크", "발주링크"],
    buyUnitPrice:      ["구매가", "매입가", "소싱가", "원가", "사입가"],
    buyerName:         ["구매자명", "구매자", "주문자", "주문자명"],
    recipient:         ["수령자명", "수취인이름", "수취인", "수령인", "받는분", "받는사람", "수취인 이름"],
    recvTel:           ["수령자전화번호", "수취인전화번호", "전화번호", "연락처", "수취인 전화번호"],
    recvPhone:         ["수령자휴대폰번호", "휴대폰", "휴대폰번호", "핸드폰", "통관용구매자전화번호"],
    zipcode:           ["우편번호", "우편 번호"],
    address:           ["배송지주소", "수취인 주소", "수취인주소", "주소", "배송지", "수령지주소"],
    deliveryMemo:      ["배송메세지", "배송메시지", "배송요청사항", "주문시 요청사항", "배송 메세지"],
    manager:           ["담당자", "처리자", "작업자"],
    vendor:            ["구매처", "매입처", "소싱처"],
    vendorAccount:     ["계정", "구매계정", "매입계정"],
    buyAmount:         ["구매금액", "매입금액", "총매입가"],
    buyOrderNo:        ["주문번호", "구매주문번호", "매입주문번호"],
    paidAt:            ["결제일시", "결제일", "구매일시"],
    cardName:          ["카드정보", "카드", "결제카드"],
    point:             ["포인트", "적립", "적립금"],
    orderedYn:         ["주문여부", "발주여부", "구매여부"],
    memo:              ["메모", "비고", "특이사항"],
    uniqueNo:          ["주문고유번호", "고유번호", "주문 고유번호"],
    courierCode:       ["배송사명", "택배사", "배송사", "택배사코드"],
    invoiceNo:         ["송장번호", "운송장번호", "운송장"],
    invoiceUploaded:   ["운송장업로드", "송장업로드", "업로드상태"],
    category:          ["카테고리", "분류", "상품분류"]
  };

  /* ---------------------------------------------------------------
   * 2. 택배사 코드 (워크북 상단 메모 기준)
   * --------------------------------------------------------------- */
  var COURIERS = [
    { code: "T025", name: "CJ대한통운",  short: "CJ" },
    { code: "T081", name: "한진택배",    short: "한진" },
    { code: "T082", name: "롯데택배",    short: "롯데" },
    { code: "T030", name: "로젠택배",    short: "로젠" },
    { code: "T048", name: "업직커머스",  short: "업직" },
    { code: "T069", name: "천일택배",    short: "천일택배" },
    { code: "T005", name: "우체국택배",  short: "우체국" },
    { code: "T060", name: "경동택배",    short: "경동" },
    { code: "T044", name: "대신택배",    short: "대신" },
    { code: "T042", name: "일양로지스",  short: "일양" },
    { code: "T098", name: "직접배송",    short: "직접" }
  ];
  function courierByCode(code) {
    var c = String(code || "").trim().toUpperCase();
    for (var i = 0; i < COURIERS.length; i++) if (COURIERS[i].code === c) return COURIERS[i];
    return null;
  }
  function courierByName(name) {
    var n = String(name || "").replace(/\s+/g, "");
    if (!n) return null;
    for (var i = 0; i < COURIERS.length; i++) {
      if (COURIERS[i].name === n || COURIERS[i].short === n) return COURIERS[i];
    }
    for (var j = 0; j < COURIERS.length; j++) {
      if (n.indexOf(COURIERS[j].short) !== -1) return COURIERS[j];
    }
    return null;
  }
  // 'T025' / 'CJ' / 'CJ대한통운' 무엇이 들어와도 코드로 정규화
  function normalizeCourier(v) {
    var c = courierByCode(v);
    if (c) return c.code;
    var n = courierByName(v);
    return n ? n.code : String(v || "").trim();
  }

  /* ---------------------------------------------------------------
   * 3. 기본 수수료표 — 워크북 "수수료" 시트(주문서용 블록) 기준
   *    앱에서 워크북을 올리면 이 값이 덮어써집니다.
   * --------------------------------------------------------------- */
  var DEFAULT_FEES = [
    ["쿠팡(신)", "가공식품", 0.106], ["쿠팡(신)", "패션의류/패션잡화", 0.105],
    ["쿠팡(신)", "쌀", 0.058], ["쿠팡(신)", "욕실/세탁(세제샴푸등)", 0.078],
    ["쿠팡(신)", "화장품", 0.096], ["쿠팡(신)", "출산/유아동식품", 0.078],
    ["쿠팡(신)", "건강식품/다이어트", 0.106], ["쿠팡(신)", "뷰티기기(네일)", 0.096],
    ["쿠팡(신)", "계절가전", 0.078], ["쿠팡(신)", "쌀/냉난방가전/생활가전", 0.058],
    ["쿠팡(신)", "유아물티슈", 0.082], ["쿠팡(신)", "기저귀크림/파우더", 0.098],
    ["쿠팡(신)", "스포츠의류/스포츠신발", 0.105], ["쿠팡(신)", "광학용품", 0.088],
    ["쿠팡(신)", "공구/철물/조명/배선/전기코드류", 0.108], ["쿠팡(신)", "방향/탈취/살충제", 0.1],
    ["쿠팡(신)", "차량가전용품", 0.068], ["쿠팡(신)", "기저귀/분유", 0.064],
    ["쿠팡(신)", "주방용품", 0.108], ["쿠팡(신)", "물티슈", 0.078],
    ["쿠팡(신)", "치약", 0.078], ["쿠팡(신)", "펫/가구/홈인테리어/문구/사무용품", 0.108],
    ["롯데ON", "롯데온가공식품", 0.169545454545454], ["롯데ON", "롯데온생필품", 0.1235],
    ["G마켓", "지마켓가공식품", 0.1695], ["G마켓", "지마켓침구류", 0.1695],
    ["G마켓", "지마켓생필품", 0.1235], ["G마켓", "지마켓세제", 0.1465],
    ["옥션", "옥션가공식품", 0.1465], ["옥션", "옥션침구류", 0.1695],
    ["11번가", "11번가주방용품", 0.1695], ["올웨이즈", "올웨이즈", 0.05],
    ["카카오 톡스토어", "카카오 톡스토어", 0.06], ["쇼핑멸치(공급가)", "멸치쇼핑", 0.06],
    ["스마트스토어", "스마트스토어", 0.0563]
  ].map(function (r) { return { site: r[0], category: r[1], rate: r[2], rateVat: Math.round(r[2] * 1.1 * 1e6) / 1e6 }; });

  /* 상품명 → 카테고리 자동 추정 키워드 (수수료율 자동 적용용) */
  var CATEGORY_KEYWORDS = [
    ["쌀", ["쌀", "백미", "현미", "찹쌀", "잡곡", "골든퀸", "수향미"]],
    ["가공식품", ["과자", "라면", "음료", "커피", "즉석", "통조림", "간식", "칩", "젤리", "초콜", "김치", "소스", "오리온", "농심"]],
    ["주방용품", ["냄비", "프라이팬", "물병", "텀블러", "컵", "그릇", "수저", "도마", "주방", "밀폐용기", "스테인리스"]],
    ["물티슈", ["물티슈"]],
    ["유아물티슈", ["아기물티슈", "유아물티슈"]],
    ["기저귀/분유", ["기저귀", "분유"]],
    ["욕실/세탁(세제샴푸등)", ["세제", "샴푸", "린스", "바디워시", "섬유유연제", "비누", "치약칫솔", "세탁"]],
    ["치약", ["치약"]],
    ["화장품", ["스킨", "로션", "크림", "에센스", "마스크팩", "선크림", "쿠션", "립"]],
    ["패션의류/패션잡화", ["티셔츠", "셔츠", "바지", "원피스", "자켓", "코트", "속옷", "양말", "가방", "신발", "모자"]],
    ["건강식품/다이어트", ["유산균", "비타민", "홍삼", "오메가", "콜라겐", "다이어트", "영양제"]],
    ["계절가전", ["선풍기", "히터", "가습기", "제습기", "온풍기", "에어컨"]],
    ["펫/가구/홈인테리어/문구/사무용품", ["강아지", "고양이", "반려", "의자", "책상", "선반", "수납", "문구", "볼펜", "노트"]],
    ["공구/철물/조명/배선/전기코드류", ["공구", "드라이버", "전선", "멀티탭", "조명", "전구", "테이프"]],
    ["방향/탈취/살충제", ["방향제", "탈취", "살충", "모기", "디퓨저"]],
    ["차량가전용품", ["차량용", "자동차", "카매트", "블랙박스"]]
  ];

  /* ---------------------------------------------------------------
   * 4. 숫자·문자 유틸
   * --------------------------------------------------------------- */
  function toNumber(v) {
    if (typeof v === "number") return isFinite(v) ? v : 0;
    if (v === null || v === undefined) return 0;
    var s = String(v).replace(/[^0-9.\-]/g, "");
    var n = parseFloat(s);
    return isNaN(n) ? 0 : n;
  }
  function hasValue(v) { return v !== null && v !== undefined && String(v).trim() !== ""; }
  function round2(n) { return Math.round(n * 100) / 100; }
  function norm(s) { return String(s == null ? "" : s).replace(/\s+/g, "").toLowerCase(); }

  /* 날짜 문자열/직렬값 → 'YYYY-MM-DD' */
  function dateOnly(v) {
    if (v === null || v === undefined || v === "") return "";
    if (typeof v === "number") {
      var d = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000);
      return d.toISOString().slice(0, 10);
    }
    var s = String(v).trim();
    var m = s.match(/(\d{4})[-./년\s]*(\d{1,2})[-./월\s]*(\d{1,2})/);
    if (m) return m[1] + "-" + ("0" + m[2]).slice(-2) + "-" + ("0" + m[3]).slice(-2);
    m = s.match(/^(\d{2})[-./](\d{1,2})[-./](\d{1,2})/);
    if (m) return "20" + m[1] + "-" + ("0" + m[2]).slice(-2) + "-" + ("0" + m[3]).slice(-2);
    return "";
  }
  function monthOf(v) { var d = dateOnly(v); return d ? d.slice(0, 7) : ""; }

  /* 'YYYY-MM-DD HH:mm' / Date / 직렬값 → 엑셀 직렬값(숫자). 실패하면 null */
  function toSerial(v) {
    if (v === null || v === undefined || v === "") return null;
    if (typeof v === "number") return isFinite(v) ? v : null;
    var s = String(v).trim();
    var m = s.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (!m) {
      var d2 = dateOnly(s);
      if (!d2) return null;
      m = d2.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!m) return null;
    }
    var utc = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
    return (utc - Date.UTC(1899, 11, 30)) / 86400000;
  }

  /* ---------------------------------------------------------------
   * 5. 수수료율 조회
   * --------------------------------------------------------------- */
  function guessCategory(productName) {
    var n = String(productName || "");
    for (var i = 0; i < CATEGORY_KEYWORDS.length; i++) {
      var kws = CATEGORY_KEYWORDS[i][1];
      for (var k = 0; k < kws.length; k++) if (n.indexOf(kws[k]) !== -1) return CATEGORY_KEYWORDS[i][0];
    }
    return "";
  }
  // fees: [{site, category, rate, rateVat}]
  function lookupFee(fees, site, category) {
    var list = fees && fees.length ? fees : DEFAULT_FEES;
    var s = norm(site), c = norm(category);
    var i;
    if (c) {
      for (i = 0; i < list.length; i++) {
        if (norm(list[i].category) === c && (!s || norm(list[i].site) === s)) return list[i];
      }
      for (i = 0; i < list.length; i++) if (norm(list[i].category) === c) return list[i];
    }
    if (s) for (i = 0; i < list.length; i++) if (norm(list[i].site) === s && !list[i].category) return list[i];
    return null;
  }

  /* ---------------------------------------------------------------
   * 6. 마진 계산 — 워크북 수식과 동일
   *    결제기준가 = 판매가 x (1 - 수수료율VAT)
   *    순마진     = (결제기준가 + 배송비순액 - 구매금액 - 에누리) / 1.1
   *    부가세     = 순마진 x 10%
   *    마진률     = 순마진 / 판매가
   *    올라수수료 = 판매가 x 0.96%
   * --------------------------------------------------------------- */
  var OLLA_RATE = 0.0096;

  function computeOrder(o, ctx) {
    ctx = ctx || {};
    var fees = ctx.fees || DEFAULT_FEES;
    var ollaRate = ctx.ollaRate == null ? OLLA_RATE : ctx.ollaRate;

    o.qty = Math.max(1, Math.round(toNumber(o.qty) || 1));
    o.settleSite = o.settleSite || o.siteName || "";
    if (!hasValue(o.category)) o.category = guessCategory(o.productName);

    var manualRate = ctx.manualRates && ctx.manualRates[o.id];
    var fee = lookupFee(fees, o.settleSite || o.siteName, o.category);
    var rate = manualRate != null ? manualRate : (fee ? fee.rate : null);
    var rateVat = rate == null ? null : Math.round(rate * 1.1 * 1e6) / 1e6;

    o.feeRate = rate;
    o.feeRateVat = rateVat;

    var salePrice = toNumber(o.salePrice);
    var shipFee = toNumber(o.shipFee);
    var discount = toNumber(o.discount);
    var buyAmount = hasValue(o.buyAmount) ? toNumber(o.buyAmount)
      : toNumber(o.buyUnitPrice) * o.qty;

    o.revenue = salePrice;
    o.saleDate = dateOnly(o.saleDate) || dateOnly(o.orderedAt) || dateOnly(o.collectedAt);
    o.settleOrderNo = String(o.siteOrderNo || "").trim().split(/\s+/)[0] || "";
    o.pointOut = toNumber(o.point);

    if (rateVat == null) {
      o.settleBase = null; o.fee = null; o.shipNet = null;
      o.netMargin = null; o.vat = null; o.marginRate = null;
      o.ollaFee = round2(salePrice * ollaRate);
      o.netProfit = null;
      o.marginReady = false;
      return o;
    }

    o.settleBase = round2(salePrice * (1 - rateVat));
    o.fee = round2(salePrice * rateVat);
    o.shipNet = round2(shipFee * (1 - rateVat));
    o.ollaFee = round2(salePrice * ollaRate);

    if (!buyAmount) {
      o.netMargin = null; o.vat = null; o.marginRate = null; o.netProfit = null;
      o.marginReady = false;
      return o;
    }
    var gross = o.settleBase + o.shipNet - buyAmount - discount;
    o.netMargin = round2(gross / 1.1);
    o.vat = round2(o.netMargin * 0.1);
    o.marginRate = salePrice ? o.netMargin / salePrice : null;
    o.netProfit = round2(o.netMargin + o.pointOut);
    o.marginReady = true;
    return o;
  }

  /* ---------------------------------------------------------------
   * 7. 블랙리스트 판정
   *    - 이름 완전일치(마스킹 '*' 는 한 글자 와일드카드)
   *    - 주소는 공백·기호 제거 후 포함관계 또는 핵심 토큰 2개 이상 일치
   * --------------------------------------------------------------- */
  function normName(s) {
    return String(s || "").replace(/[\s()[\]{}]/g, "").replace(/[·.,]/g, "");
  }
  function splitNames(s) {
    return normName(s).split(/[\/|]/).filter(Boolean);
  }
  function normAddr(s) {
    return String(s || "")
      .replace(/\(.*?\)/g, " ")
      .replace(/[^0-9A-Za-z가-힣]/g, "")
      .replace(/특별자치시|특별자치도|특별시|광역시/g, "")
      .toLowerCase();
  }
  function addrTokens(s) {
    return String(s || "")
      .replace(/\(.*?\)/g, " ")
      .replace(/[^0-9A-Za-z가-힣*\-]/g, " ")
      .split(/\s+/)
      .map(function (x) { return x.toLowerCase(); })
      .filter(function (x) { return x.length >= 2; });
  }
  function wildRe(token) {
    return new RegExp("^" + token.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".") + "$");
  }
  // 번지·동·호수처럼 숫자가 든 토큰: 정확히(마스킹은 와일드카드로) 같아야 인정
  function exactHit(token, list) {
    if (token.indexOf("*") !== -1) {
      var re = wildRe(token);
      for (var i = 0; i < list.length; i++) if (re.test(list[i])) return true;
      return false;
    }
    return list.indexOf(token) !== -1;
  }
  // 지명·건물명 토큰: 포함 관계까지 인정 (인천 ⊂ 인천광역시)
  function looseHit(token, list) {
    if (token.indexOf("*") !== -1) {
      var re2 = wildRe(token);
      for (var k = 0; k < list.length; k++) if (re2.test(list[k])) return true;
      return false;
    }
    for (var j = 0; j < list.length; j++) {
      var t = list[j];
      if (t === token) return true;
      if (t.indexOf(token) !== -1 || token.indexOf(t) !== -1) return true;
    }
    return false;
  }

  function nameMatches(orderName, blName) {
    var a = normName(orderName);
    if (!a) return false;
    var candidates = splitNames(blName);
    for (var i = 0; i < candidates.length; i++) {
      var b = candidates[i];
      if (!b) continue;
      if (b.indexOf("*") !== -1) {
        var re = new RegExp("^" + b.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".") + "$");
        if (re.test(a)) return true;
      } else if (a === b) return true;
    }
    return false;
  }

  /* 주소 일치 판정
   * "경기도 용인시 기흥구" 처럼 행정구역만 겹치는 것은 일치로 보지 않습니다.
   *   - 번지·동·호수처럼 숫자가 들어간 토큰은 전부 맞아야 함
   *   - 숫자 토큰이 없는 등록(예: "인천 계양구 하나아파트")은 모든 토큰이 맞아야 함
   */
  function addrMatches(orderAddr, blAddr) {
    var a = normAddr(orderAddr), b = normAddr(blAddr);
    if (!a || !b || b.length < 6) return false;
    if (a.indexOf(b) !== -1 || b.indexOf(a) !== -1) return true;

    var ta = addrTokens(orderAddr), tb = addrTokens(blAddr);
    if (!ta.length || tb.length < 2) return false;

    var digits = [], plain = [];
    tb.forEach(function (t) { (/[0-9]/.test(t) ? digits : plain).push(t); });

    var plainHits = 0;
    plain.forEach(function (t) { if (looseHit(t, ta)) plainHits++; });

    if (digits.length) {
      for (var i = 0; i < digits.length; i++) if (!exactHit(digits[i], ta)) return false;
      // 지명도 대부분 맞아야 함 — 번지 숫자만 우연히 겹치는 오탐 방지
      var need = plain.length >= 3 ? plain.length - 1 : plain.length;
      return plainHits >= need;
    }
    // 숫자 없는 등록은 토큰이 3개 이상이고 전부 맞을 때만 ("인천 연수구" 같은 광역 표현 제외)
    return plain.length >= 3 && plainHits === plain.length;
  }

  // blacklist: [{name, address, phone, memo}]
  // 반환: { level:"danger"|"warn"|"", reasons:[..], hits:[{...}] }
  function checkBlacklist(o, blacklist) {
    var out = { level: "", reasons: [], hits: [] };
    if (!blacklist || !blacklist.length) return out;
    var name = o.recipient || o.buyerName || "";
    var addr = o.address || "";
    var phone = String(o.recvPhone || o.recvTel || "").replace(/[^0-9]/g, "");
    for (var i = 0; i < blacklist.length; i++) {
      var b = blacklist[i];
      if (!b) continue;
      var nHit = b.name ? nameMatches(name, b.name) : false;
      var aHit = b.address ? addrMatches(addr, b.address) : false;
      // 마스킹 이름(김성*)은 추정이라, 주소가 등록돼 있으면 주소까지 맞아야 경고합니다
      if (nHit && String(b.name).indexOf("*") !== -1 && b.address && !aHit) nHit = false;
      var pHit = false;
      if (b.phone) {
        var bp = String(b.phone).replace(/[^0-9]/g, "");
        pHit = bp.length >= 8 && phone.length >= 8 && phone.slice(-8) === bp.slice(-8);
      }
      if (!nHit && !aHit && !pHit) continue;
      var level = "warn";
      var masked = String(b.name || "").indexOf("*") !== -1;
      if ((nHit && aHit) || pHit) level = "danger";
      // 주소가 없는 등록은 이름 자체가 블랙 — 다만 마스킹 이름(김성*)은 추정이라 '주의'까지만
      else if (nHit && !b.address && !masked) level = "danger";
      var why = [];
      if (nHit) why.push("수령자명 '" + name + "'");
      if (aHit) why.push("배송지 일치");
      if (pHit) why.push("연락처 일치");
      out.hits.push({ entry: b, level: level, why: why.join(" · ") });
      out.reasons.push((b.name || "(이름없음)") + " — " + why.join(" · "));
      if (level === "danger" || !out.level) out.level = level === "danger" ? "danger" : (out.level || "warn");
    }
    return out;
  }

  /* ---------------------------------------------------------------
   * 8. 진행 상태 판정 (딸깍 처리용 단계)
   * --------------------------------------------------------------- */
  var STEPS = [
    { key: "new",      label: "신규" },
    { key: "ordered",  label: "발주완료" },
    { key: "invoiced", label: "송장입력" },
    { key: "uploaded", label: "업로드완료" }
  ];
  function stepOf(o) {
    if (norm(o.invoiceUploaded) === "완료") return "uploaded";
    if (hasValue(o.invoiceNo)) return "invoiced";
    if (String(o.orderedYn || "").toUpperCase() === "O") return "ordered";
    return "new";
  }
  function stepLabel(k) {
    for (var i = 0; i < STEPS.length; i++) if (STEPS[i].key === k) return STEPS[i].label;
    return "신규";
  }

  /* ---------------------------------------------------------------
   * 9. 공용 export
   * --------------------------------------------------------------- */
  var api = {
    ORDER_COLUMNS: ORDER_COLUMNS,
    COLUMN_ALIASES: COLUMN_ALIASES,
    COURIERS: COURIERS,
    DEFAULT_FEES: DEFAULT_FEES,
    CATEGORY_KEYWORDS: CATEGORY_KEYWORDS,
    OLLA_RATE: OLLA_RATE,
    STEPS: STEPS,
    courierByCode: courierByCode,
    courierByName: courierByName,
    normalizeCourier: normalizeCourier,
    toNumber: toNumber,
    hasValue: hasValue,
    round2: round2,
    norm: norm,
    dateOnly: dateOnly,
    monthOf: monthOf,
    toSerial: toSerial,
    guessCategory: guessCategory,
    lookupFee: lookupFee,
    computeOrder: computeOrder,
    checkBlacklist: checkBlacklist,
    nameMatches: nameMatches,
    addrMatches: addrMatches,
    stepOf: stepOf,
    stepLabel: stepLabel,
    colByKey: function (key) {
      for (var i = 0; i < ORDER_COLUMNS.length; i++) if (ORDER_COLUMNS[i].key === key) return ORDER_COLUMNS[i];
      return null;
    },
    labelOf: function (key) { var c = api.colByKey(key); return c ? c.label : key; }
  };

  global.OrderCore = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
