/* =====================================================================
 * demo.js — 자동화 관제(오토파일럿) 데모 엔진 + 화면
 *
 *  "내부가 실제로 동작할 필요는 없다. 모든 것이 자동으로 돌아가는 모습을 보여 달라."
 *  - 실제 계정·구매처·택배사·쿠팡 어디에도 연결하지 않는 100% 로컬 시뮬레이션입니다.
 *  - 데이터 패턴(상품·가격·구매처·택배사·지역·시간대·CS 비율)은 demo-data.js(실 운영 워크북에서
 *    개인정보를 제외하고 추출)에서 가져오고, 매출 규모는 연매출 80억 원 페이스로 맞춥니다.
 *  - 이름·전화·주소는 전부 합성·마스킹("김○수", "010-****-1234", "경기 용인시 ○○로 12").
 *  - 켜는 동안 실제 데이터는 스냅샷으로 보관하고 저장(persist)을 막습니다. 끄면 원래대로 돌아옵니다.
 *
 *  app.js 는 window.OH(내부 API)와 몇 군데의 집계 오버레이(Demo.active 일 때)로만 이 파일과 만납니다.
 * ===================================================================== */
(function (global) {
  "use strict";

  var YEAR_TARGET = 8e9;                     // 연매출 목표 80억
  var DAY_TARGET = YEAR_TARGET / 365;        // ≈ 21,917,808 원/일
  var MIN = 60000, HOUR = 3600000, DAY = 86400000;

  /* ---------- 결정적 난수 ---------- */
  var seed = 20260923;
  function rnd() { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; }
  function ri(a, b) { return a + Math.floor(rnd() * (b - a + 1)); }
  function pick(arr) { return arr[Math.floor(rnd() * arr.length)]; }
  function gauss() { var u = 1 - rnd(), v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
  function poisson(lambda) {
    if (lambda <= 0) return 0;
    if (lambda > 30) return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * gauss()));
    var L = Math.exp(-lambda), k = 0, p = 1;
    do { k++; p *= rnd(); } while (p > L);
    return k - 1;
  }
  function pickW(items, w) {
    var total = 0, i;
    for (i = 0; i < items.length; i++) total += w(items[i]);
    var r = rnd() * total;
    for (i = 0; i < items.length; i++) { r -= w(items[i]); if (r <= 0) return items[i]; }
    return items[items.length - 1];
  }
  function pad(n) { return ("0" + n).slice(-2); }
  function digits(n) { var s = ""; while (s.length < n) s += Math.floor(rnd() * 10); return s; }

  /* ---------- 패턴 데이터 ---------- */
  var DD = global.DemoData || {};
  var FALLBACK_PRODUCTS = [
    { name:"시금치", opt:"1kg", n:100, price:9990, cost:6500, vendor:"성공푸드", courier:"롯데택배" },
    { name:"꿀고구마", opt:"3kg", n:80, price:9990, cost:7600, vendor:"덤덤몰", courier:"CJ대한통운" },
    { name:"나주배", opt:"5kg", n:70, price:16990, cost:12100, vendor:"월억도전", courier:"CJ대한통운" },
    { name:"제주 감귤", opt:"5kg", n:60, price:14990, cost:9700, vendor:"산지이음", courier:"CJ대한통운" }
  ];
  function mapProducts(src) {
    return src.filter(function (p) { return p && p.name && p.price > 0 && p.cost >= 0; }).map(function (p, i) {
      var mo = new Date().getMonth() + 1, w = (p.n || 1) * (p.season ? (p.season[mo] || 0.35) : 1);
      return { id:"DEMO" + (1001 + i), name:p.name, opt:p.opt || "", n:w, price:p.price, cost:p.cost, vendor:p.vendor || "구매처", courier:p.courier || "CJ대한통운", qty:p.qty || { "1":9, "2":1 } };
    });
  }
  var PRODUCTS = mapProducts(DD.products && DD.products.length ? DD.products : FALLBACK_PRODUCTS);
  if (!PRODUCTS.length) PRODUCTS = mapProducts(FALLBACK_PRODUCTS);
  var BASE_COST = PRODUCTS.map(function (p) { return p.cost; });
  var W_SUM = PRODUCTS.reduce(function (s, p) { return s + p.n; }, 0);
  var VENDOR_N = (function () { var m = {}; PRODUCTS.forEach(function (p) { m[p.vendor] = 1; }); return Object.keys(m).length; })();
  var AOV = PRODUCTS.reduce(function (s, p) { return s + p.price * p.n; }, 0) / W_SUM;
  var ORDERS_PER_DAY = DAY_TARGET / AOV;
  function normalizeTo(arr, len) {
    var a = (arr && arr.length === len) ? arr.slice() : []; if (!a.length) for (var i = 0; i < len; i++) a.push(1);
    var s = a.reduce(function (x, y) { return x + y; }, 0) || 1;
    return a.map(function (v) { return v / s * len; });
  }
  var HOUR_W = normalizeTo(DD.hours, 24);
  var WDAY_W = normalizeTo(DD.weekdays, 7);       // 0=월 … 6=일 (python weekday)
  var NOISE = ((DD.noise && DD.noise.length) ? DD.noise : [1]).map(function (v) { return Math.max(0.72, Math.min(1.32, v)); });
  var REGIONS = (DD.regions && DD.regions.length) ? DD.regions : [["경기도 용인시", 10], ["서울특별시 강남구", 8], ["부산광역시 해운대구", 5]];
  var COURIERS = (DD.couriers && DD.couriers.length) ? DD.couriers : [["CJ대한통운", 6], ["롯데택배", 3], ["한진택배", 1]];
  var SEASON = { 1:1.15, 2:1.10, 3:0.95, 4:0.90, 5:0.90, 6:0.92, 7:0.95, 8:0.98, 9:1.0, 10:0.97, 11:0.98, 12:1.05 };
  var SURNAMES = [["김", 21], ["이", 15], ["박", 8], ["최", 5], ["정", 4], ["강", 2], ["조", 2], ["윤", 2], ["장", 2], ["임", 2], ["한", 1], ["오", 1], ["서", 1], ["신", 1], ["권", 1], ["황", 1], ["안", 1], ["송", 1], ["전", 1], ["홍", 1]];
  var GIVEN = ["서준", "지호", "하준", "도윤", "시우", "예준", "민준", "지우", "서연", "하은", "지민", "수아", "지아", "채원", "다은", "은서", "지윤", "유진", "수빈", "현우", "준서", "지훈", "승현", "유나", "민서", "예은", "소율", "현서", "지원", "은우", "시윤", "하린", "윤서", "서현", "정우", "성민", "재원", "혜진", "미영", "영수", "정숙", "미경", "순자", "정희", "명숙", "은정", "미선", "경희", "선영", "지영", "수진", "민수", "영호", "성호", "상훈", "진우", "동현", "재호", "종수", "병철", "상민", "경수", "태호", "혜원", "보람", "슬기", "나영", "유경", "가은", "세훈"];
  var ROADS = ["중앙로", "번영로", "동탄대로", "행복로", "새터로", "은행나무길", "산업로", "호수공원로", "정자일로", "백현로", "경수대로", "미사강변대로", "송파대로", "테헤란로", "양재대로", "올림픽로", "서초대로", "해운대해변로", "센텀중앙로", "달구벌대로", "유성대로", "둔산로", "첨단과학로", "상무대로", "삼산로", "봉명로", "불당대로", "탕정로", "원주로", "춘천로", "경명대로", "공단로", "덕산로", "장안로", "부일로", "소사로", "탄천로", "매화로", "운정로", "김포한강로"];
  var APTS = ["힐스테이트", "래미안", "자이", "푸르지오", "e편한세상", "롯데캐슬", "더샵", "아이파크", "호반베르디움", "우미린", "한신더휴", "센트럴파크", "리버파크", "현대아파트", "주공아파트", "LH천년나무", "코오롱하늘채", "중흥S-클래스"];
  var MSGS = ["문 앞에 놓아주세요", "경비실에 맡겨주세요", "부재 시 문 앞에 두세요", "배송 전 연락 부탁드려요", "택배함에 넣어주세요", "공동현관 비밀번호 1234#", "벨 누르지 말고 문 앞에 두세요", "낮에는 집에 없어요, 문 앞 부탁드려요", "깨지기 쉬워요 조심히 부탁드립니다", "경비실 부재 시 문 앞", "", "", "", "", "", ""];
  var CS_MIX = [["반품접수", 30], ["차액협의", 22], ["출고중지요청", 18], ["배송문의", 12], ["택배미수령", 6], ["품절취소", 6], ["과배송", 3], ["교환문의", 3]];
  var CS_RATE = 0.036;
  var CS_REASON = { "반품접수":["단순변심", "등급차이", "파손"], "차액협의":["등급차이", "파손"], "출고중지요청":["단순변심", "오주문"], "배송문의":["배송지연"], "택배미수령":["미수령"], "품절취소":["품절"], "과배송":["기타"], "교환문의":["오주문", "파손"] };
  // 단계별 AI 응대 멘트(유형 → 단계 인덱스 → 문장). 실제 발송되는 건 없음
  // "※" 로 시작하는 줄은 고객에게 보내는 말이 아니라 내부 처리 기록. 결제·송금은 사람이 하고 봇은 확인·기록만 합니다.
  var CS_LINES = {
    "반품접수": ["불편을 드려 죄송합니다. 반품 접수를 도와드리겠습니다. 회수 택배가 방문할 수 있는 연락처를 확인해 주세요.", "※쿠팡 반품 접수 확인", "※구매처 반품 신청 완료 · 반품비 6,000원 장부 기록", "회수 송장이 등록되었습니다. 택배 기사님이 1~2일 내 방문합니다.", "회수가 확인되었습니다. 환불은 영업일 기준 2~3일 내 처리됩니다.", "※구매처 환불 확인 · 정산 반영", "처리가 모두 끝났습니다. 이용해 주셔서 감사합니다."],
    "차액협의": ["불편을 드려 죄송합니다. 반품 대신 3,000원을 차액으로 보내드리는 방법은 어떠실까요? 괜찮으시면 입금 계좌를 회신해 주세요.", "※고객 수락 · 담당자에게 입금 요청 등록(계좌는 저장하지 않음)", "차액 3,000원 입금이 완료되었습니다. 확인 부탁드립니다.", "처리가 끝났습니다. 감사합니다."],
    "출고중지요청": ["취소 요청을 확인했습니다. 출고 전이라 바로 처리해 드리겠습니다.", "※구매처 취소 요청 전송", "취소가 확인되어 환불이 진행됩니다.", "처리가 끝났습니다."],
    "택배미수령": ["미수령 신고를 확인했습니다. 택배사에 배송 위치를 조회 요청했습니다.", "※쿠팡 처리 상태 확인", "※구매처 반품/취소 접수 완료", "환불이 확인되었습니다.", "처리가 끝났습니다."],
    "품절취소": ["※구매처 품절 확인", "※쿠팡 취소·환불 처리 확인", "주문하신 상품이 공급사 품절로 부득이 취소·환불되었습니다. 진심으로 죄송합니다.", "처리가 끝났습니다."],
    "과배송": ["※중복 발송 확인 · 구매처에 회수 요청", "회수가 완료되었습니다.", "처리가 끝났습니다."],
    "_default": ["문의 감사합니다. 확인 후 바로 답변드리겠습니다.", "※조치 완료", "처리가 끝났습니다."]
  };
  function csLine(o, text) {
    if (!text) return;
    if (text.charAt(0) === "※") OH.csAutoMemo(o, "자동 처리: " + text.slice(1), "step");
    else OH.csAutoMemo(o, "AI 응대 발송: " + text, "note");
  }
  var DEMO_BLACKLIST = [
    { name:"박정훈", address:"경기도 광주시 경안로 77 그린빌 302호", phone:"", memo:"반품 후 재주문 반복 · 반품비 미납", addedAt:"2026-06-12" },
    { name:"최미라", address:"부산광역시 사상구 사상로 12 현대아파트 104동 901호", phone:"", memo:"수취 거부 3회", addedAt:"2026-07-03" },
    { name:"정승민", address:"인천광역시 남동구 인주대로 5-3 2층", phone:"", memo:"악성 CS · 허위 파손 주장", addedAt:"2026-08-21" }
  ];

  /* ---------- 상태 ---------- */
  var OH = null;               // app.js 내부 API (window.OH)
  var D = {
    active:false, paused:false, speed:60, now:0, tick:0, timer:null,
    days:{}, today:null, dayKey:"", hourly:[], yHourly:[],
    feed:[], bots:{}, db:{}, stages:{}, cs:{ opened:0, closed:0, auto:0, human:0, open:0 },
    human:0, seq:0, snapshot:null, tween:{}
  };
  function nowDate() { return new Date(D.now); }
  function dayKeyOf(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function monthKeyOf(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1); }
  function fmtDT(d) { return dayKeyOf(d) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes()); }
  function fmtT(d) { return pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds()); }
  function wdayIdx(d) { return (d.getDay() + 6) % 7; }   // JS 0=일 → 파이썬식 0=월
  function freshDay() { return { cnt:0, rev:0, margin:0, cost:0, cs:0, csCost:0, held:0, issues:0, issuesDone:0 }; }

  /* ---------- 매출 수준(과거·오늘) ---------- */
  function level(d, todayD) {
    var monthsAgo = (todayD - d) / (DAY * 30.4);
    var growth = Math.pow(1.045, -monthsAgo);                    // 매달 4.5% 성장해 지금 80억 페이스
    var season = SEASON[d.getMonth() + 1] / SEASON[todayD.getMonth() + 1];
    return growth * season * WDAY_W[wdayIdx(d)];
  }
  function marginRate(d) { return 0.115 + Math.sin(d.getTime() / DAY / 9) * 0.012 + (rnd() - 0.5) * 0.02; }
  function buildHistory(todayD) {
    var raw = [], i, d, k;
    for (i = 420; i >= 1; i--) {
      d = new Date(todayD.getTime() - i * DAY);
      raw.push({ d:d, base:level(d, todayD) * NOISE[(i * 7) % NOISE.length] });
    }
    var last28 = raw.slice(-28).reduce(function (s, r) { return s + r.base; }, 0);
    var scale = DAY_TARGET * 28 / last28 * 1.012;                // 최근 4주(요일 균형) 평균 ≈ 80억/365 (약 81억 페이스 · 살짝 초과 달성)
    D.days = {};
    raw.forEach(function (r) {
      k = dayKeyOf(r.d);
      var rev = Math.round(r.base * scale / 10) * 10;
      var cnt = Math.max(1, Math.round(rev / AOV * (1 + (rnd() - 0.5) * 0.06)));
      var rate = marginRate(r.d);
      var cs = Math.round(cnt * CS_RATE * (0.7 + rnd() * 0.6));
      D.days[k] = { cnt:cnt, rev:rev, margin:Math.round(rev * rate), cost:Math.round(rev * (1 - rate - 0.118)), cs:cs, csCost:cs * 4200, held:Math.round(cnt / 400) };
    });
  }
  function ratePerMs(t) {
    // 시각별 주문 발생률(건/ms)
    var h = t.getHours();
    var perDay = ORDERS_PER_DAY * WDAY_W[wdayIdx(t)] * (D.todayNoise || 1);
    return perDay / DAY * HOUR_W[h];
  }

  /* ---------- 합성 주문 ---------- */
  function maskedName() { var s = pickW(SURNAMES, function (x) { return x[1]; })[0]; return s + pick(GIVEN); }
  function region() { return pickW(REGIONS, function (x) { return x[1]; })[0]; }
  function address() {
    var r = region(), road = pick(ROADS), num = ri(3, 420), k = rnd();
    if (k < 0.5) return r + " " + road + " " + num + " " + pick(APTS) + " " + ri(101, 130) + "동 " + ri(101, 2504) + "호";
    if (k < 0.7) return r + " " + road + " " + num + "-" + ri(1, 28) + " " + ri(2, 5) + "층";
    if (k < 0.85) return r + " " + road + " " + num + " " + pick(["○○빌라", "삼성빌라", "그린빌", "한양빌라", "우성빌라"]).replace("○○", pick(["대성", "현대", "미래", "행복", "청솔"])) + " " + pick(["B", ""]) + ri(101, 402) + "호";
    return r + " " + road + " " + num;
  }
  function phoneNo() { return "010-" + String(ri(2000, 9999)) + "-" + digits(4); }
  function makeOrder(t) {
    var p = pickW(PRODUCTS, function (x) { return x.n; });
    var qk = Object.keys(p.qty || { "1":1 }), qty = parseInt(pickW(qk, function (k) { return p.qty[k]; }), 10) || 1;
    var st = OH.state;
    var o = OH.blankOrder();
    D.seq++;
    var head = String(ri(1, 32)) + "1002" + digits(9), tail = "40" + digits(14);
    o.orderDate = fmtDT(t); o.collectedAt = fmtDT(new Date(t.getTime() + ri(1, 9) * MIN));
    o.orderNumber = head + " " + tail; o.uniqueNo = "1" + digits(11); o.orderId = head;
    o.site = "쿠팡"; o.sellerId = "루루농장"; o.manager = "자동";
    o.productId = p.id; o.productName = p.name; o.option = p.opt; o.quantity = qty;
    o.paymentAmount = p.price * qty; o.shipFee = 0; o.discount = 0;
    o.recipient = maskedName(); o.buyerName = rnd() < 0.85 ? o.recipient : maskedName(); o.phone = phoneNo(); o.phone2 = rnd() < 0.15 ? phoneNo() : "";
    o.zipcode = String(ri(10000, 63999)); o.address = address(); o.deliveryMsg = pick(MSGS);
    o.vendor = p.vendor; o.sourcingPrice = p.cost; o.purchaseAmount = p.cost * qty; o.sourcingLink = "";
    o.status = "pending"; o.orderedYn = ""; o.courier = ""; o.invoiceNumber = ""; o.note = "";
    // 블랙리스트 일치(합성) — 약 1/220 건
    if (rnd() < 1 / 220) { var b = pick(DEMO_BLACKLIST); o.recipient = b.name; o.buyerName = o.recipient; o.address = b.address; }
    o._d = { p:p, stage:"collected", at:t.getTime(), stageAt:t.getTime(), next:t.getTime() + ri(8, 40) * 1000, cs:null };
    OH.computeMargin(o);
    st.orders.unshift(o);
    var td = D.today; td.cnt++; td.rev += o.paymentAmount; td.margin += (o.margin || 0); td.cost += o.purchaseAmount;
    D.hourly[t.getHours()] += o.paymentAmount;
    D.stages.collected++; bump("collected");
    if (o.risk && o.risk.level) {
      o._d.stage = "held"; o._d.next = t.getTime() + ri(6, 25) * MIN; D.stages.held++; D.human++; td.held++;
      bot("security", "블랙리스트 일치 → 자동 보류: " + o.recipient);
      feed(t, "보류", "danger", o.recipient + " · " + o.productName + " " + o.option + " — 블랙리스트 일치(" + (o.risk.reasons[0] || "") + ") → 자동 보류, 담당자 확인 대기");
      OH.csAutoMemo(o, "자동 보류: 블랙리스트 일치 — " + o.risk.reasons.join(", "), "step");
      o._d.issue = newIssue("블랙리스트 보류", "블랙리스트 일치 주문 확인", o.recipient + " · " + o.productName + " " + o.option, "boss", { orderId:o.id, priority:"high", linked:true, feed:false }).id;
    } else if (sample(0.45)) {
      feed(t, "수집", "info", o.productName + " " + o.option + " ×" + qty + " · " + o.recipient + " · " + regionOf(o) + " · " + OH.won(o.paymentAmount));
    }
    if (o.margin != null && o.margin < 0 && o._d.stage !== "held" && rnd() < 0.5) newIssue("역마진 주문 확인", "역마진 주문 확인", o.productName + " " + o.option + " · 마진 " + signed(o.margin), "boss", { orderId:o.id, priority:"high" });
    return o;
  }
  function short(v, n) { v = String(v || ""); return v.length > n ? v.slice(0, n - 1) + "…" : v; }
  function regionOf(o) { return String(o.address || "").split(" ").slice(0, 2).join(" "); }
  function sample(p) { return rnd() < p * Math.min(1, 60 / D.speed); }

  /* ---------- 주문 생애주기 ---------- */
  function shipTime(t) {
    var d = new Date(t);
    if (d.getHours() < 15) return t + ri(60, 300) * MIN;
    var n = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 9, 0);
    return n.getTime() + ri(0, 200) * MIN;
  }
  var LEAD = { checked:[], ordered:[], invoiced:[], shipped:[], delivered:[] };
  function lead(kind, ms) { var a = LEAD[kind]; if (!a) return; a.push(ms); if (a.length > 60) a.shift(); }
  function leadAvg(kind) { var a = LEAD[kind]; if (!a || !a.length) return 0; return a.reduce(function (x, y) { return x + y; }, 0) / a.length; }
  function fmtDur(ms) {
    if (!ms) return "—"; var sec = Math.round(ms / 1000);
    if (sec < 60) return sec + "초"; var min = Math.round(sec / 60); if (min < 60) return min + "분";
    var h = Math.floor(min / 60), mm = min % 60; if (h < 24) return h + "시간" + (mm ? " " + mm + "분" : "");
    var d = Math.floor(h / 24); return d + "일 " + (h % 24) + "시간";
  }
  function advanceOrder(o, tms) {
    var m = o._d, t = new Date(tms);
    if (m.next && tms >= m.next && m.stageAt) { var nk = { collected:"checked", checked:"ordered", ordered:"invoiced", invoiced:"shipped", shipped:"delivered" }[m.stage]; if (nk) lead(nk, m.next - m.stageAt); }
    if (m.next && tms >= m.next) m.stageAt = m.next;
    if (m.cs) { advanceCs(o, tms); }
    if (!m.next || tms < m.next) return;
    if (m.stage === "collected") {
      m.stage = "checked"; D.stages.checked++; bump("checked"); m.next = tms + ri(2, 9) * MIN;
      bot("security", "검수 통과: " + o.recipient + " · 개인정보 마스킹 완료");
    } else if (m.stage === "checked") {
      m.stage = "ordered"; o.status = "purchased"; o.orderedYn = "O"; o.paidAt = fmtDT(t);
      OH.computeMargin(o); D.stages.ordered++; bump("ordered"); D.bots.order.count++;
      bot("order", o._d.p.vendor + " 발주: " + o.productName + " " + o.option + " ×" + o.quantity);
      if (sample(0.55)) feed(t, "발주", "ok", o.productName + " " + o.option + " ×" + o.quantity + " · " + o.recipient + " · " + o._d.p.vendor + " 발주 완료 · 마진 " + signed(o.margin));
      m.next = shipTime(tms);
    } else if (m.stage === "ordered") {
      m.stage = "invoiced"; o.status = "invoiced"; o.courier = o._d.p.courier; o.invoiceNumber = invoiceNo(o.courier);
      OH.computeMargin(o); D.stages.invoiced++; bump("invoiced"); D.bots.invoice.count++;
      bot("invoice", o.courier + " 송장 등록 · " + short(o.productName, 12));
      if (sample(m.batched ? 0.06 : 0.35)) feed(t, "송장", "ok", o.courier + " " + o.invoiceNumber + " · " + o.productName + " " + o.option + " · " + o.recipient);
      m.next = tms + ri(30, 90) * MIN;
    } else if (m.stage === "invoiced") {
      m.stage = "shipped"; D.stages.shipped++; bump("shipped");
      if (sample(0.2)) feed(t, "발송", "info", o.productName + " " + o.option + " · " + o.recipient + " · " + o.courier + " 집하 완료");
      m.next = tms + ri(18, 30) * HOUR;
    } else if (m.stage === "shipped") {
      m.stage = "delivered"; D.stages.delivered++; bump("delivered"); m.next = 0;
      if (sample(0.12)) feed(t, "배송완료", "info", o.productName + " " + o.option + " · " + o.recipient + " · " + regionOf(o));
      if (!m.cs && rnd() < CS_RATE) openCs(o, tms);
    } else if (m.stage === "held") {
      D.human = Math.max(0, D.human - 1);
      var hi = m.issue ? findIssue(m.issue) : null;
      if (rnd() < 0.7) {
        if (hi) closeIssue(hi, "대표 확인 · 주문 취소");
        m.stage = "cancelled"; m.next = 0; o.csType = "출고중지요청"; OH.csOpen(o, "출고중지요청", { stay:true });
        o.cs.steps.stopped = true; o.cs.steps.supplier_cancel = true; o.cs.steps.cancelled = true; o.cs.steps.closed = true; o.cs.reason = "기타"; OH.csSync(o);
        OH.csAutoMemo(o, "담당자 확인 → 취소 처리(블랙리스트)", "step");
        feed(t, "보류 해제", "warn", o.recipient + " · 담당자 확인 완료 → 주문 취소 처리");
      } else {
        if (hi) closeIssue(hi, "대표 확인 · 정상 처리");
        m.stage = "checked"; m.next = tms + ri(2, 6) * MIN; o.risk = null;
        OH.csAutoMemo(o, "담당자 확인 → 정상 주문으로 판단, 처리 재개", "step");
        feed(t, "보류 해제", "warn", o.recipient + " · 담당자 확인 완료 → 정상 처리 재개");
      }
    }
  }
  function invoiceNo(courier) {
    if (/CJ/.test(courier)) return "6" + digits(11);
    if (/롯데/.test(courier)) return "4" + digits(11);
    if (/한진/.test(courier)) return "5" + digits(11);
    return "9" + digits(12);
  }
  function signed(n) { n = n || 0; return (n >= 0 ? "+" : "−") + OH.comma(Math.abs(n)); }

  /* ---------- CS 자동화 ---------- */
  function openCs(o, tms) {
    var type = pickW(CS_MIX, function (x) { return x[1]; })[0];
    var t = new Date(tms);
    OH.csOpen(o, type, { stay:true });
    o.cs.reason = pick(CS_REASON[type] || ["기타"]); o.cs.channel = rnd() < 0.7 ? "판매자센터" : "문자";
    o._d.cs = { idx:0, next:tms + ri(1, 6) * MIN, human:rnd() < 0.06, humanAt:-1, done:false, openedAt:tms };
    D.cs.opened++; D.cs.open++; D.today.cs++; D.bots.cs.count++;
    csLine(o, (CS_LINES[type] || CS_LINES._default)[0]);
    bot("cs", type + " 접수 · AI 1차 응대 발송 (" + o.recipient + ")");
    feed(t, "CS", "warn", type + " · " + o.productName + " " + o.option + " · " + o.recipient + " · AI 1차 응대 발송");
  }
  function advanceCs(o, tms) {
    var c = o._d.cs; if (!c || c.done || tms < c.next) return;
    var steps = OH.csStepsFor(o), t = new Date(tms);
    if (c.idx >= steps.length) { c.done = true; return; }
    // 사람 개입 케이스: 중간 단계에서 한 번 멈춤
    if (c.human && c.humanAt < 0 && c.idx === Math.min(1, steps.length - 2)) {
      c.humanAt = tms; c.next = tms + ri(12, 40) * MIN; D.human++; D.cs.human++;
      o.cs.waitingOn = "me"; o.cs.nextAction = "담당자 확인 필요 — 고객 요구가 기준을 넘음"; OH.csSync(o);
      c.issue = newIssue("CS 대표 판단", "CS 판단 필요 · " + o.csType, o.recipient + " · " + o.productName + " · 고객 요구가 자동 처리 한도 초과", "boss", { orderId:o.id, priority:"high", linked:true, feed:false }).id;
      OH.csAutoMemo(o, "자동 처리 한도 초과 → 담당자 확인 요청", "step");
      feed(t, "CS", "danger", o.csType + " · " + o.recipient + " · 자동 한도 초과 → 담당자 확인 대기");
      return;
    }
    if (c.human && c.humanAt >= 0 && o.cs.nextAction) { o.cs.nextAction = ""; D.human = Math.max(0, D.human - 1); OH.csAutoMemo(o, "담당자 확인 완료 → 자동 처리 재개", "step"); if (c.issue) closeIssue(findIssue(c.issue), "대표 판단 · 처리 지시"); }
    var st = steps[c.idx]; var key = st[0];
    if (c.albaIssue) { closeIssue(findIssue(c.albaIssue), ALBA_STEPS[key] ? ALBA_STEPS[key] + " 완료" : "처리 완료"); c.albaIssue = 0; }
    o.cs.steps[key] = true; o.cs.waitingOn = st[2] || "me";
    if (key === "supplier_claim" && o.csType === "반품접수") o.cs.ledger.push({ kind:"supplier_return_fee", amount:-6000, at:fmtDT(t), memo:"자동 기록" });
    if (key === "paid" && o.csType === "차액협의") o.cs.ledger.push({ kind:"customer_compensation", amount:-3000, at:fmtDT(t), memo:"자동 기록" });
    if (key === "pickup_tracking") { o.cs.pickup.courier = pick(["CJ대한통운", "롯데택배"]); o.cs.pickup.trackingNo = invoiceNo(o.cs.pickup.courier); }
    OH.csSync(o);
    var lines = CS_LINES[o.csType] || CS_LINES._default;
    csLine(o, lines[c.idx + 1]);
    OH.csAutoMemo(o, "단계 완료(자동): " + st[1], "step");
    c.idx++;
    if (key === "closed") {
      c.done = true; D.cs.closed++; D.cs.open = Math.max(0, D.cs.open - 1); if (!c.human) D.cs.auto++;
      D.today.csCost += Math.abs(o.csCost || 0);
      bot("cs", o.csType + " 종결 (" + o.recipient + ")");
      var took = c.openedAt ? Math.round((tms - c.openedAt) / MIN) : 0, tookTxt = took >= 60 ? Math.floor(took / 60) + "시간 " + (took % 60) + "분" : took + "분";
      feed(t, "CS 종결", "ok", o.csType + " · " + o.productName + " · " + o.recipient + (o.csCost ? " · 차감 " + OH.won(-Math.abs(o.csCost)) : "") + " · " + tookTxt + " 만에 " + (c.human ? "종결(담당자 1회 개입)" : "자동 종결"));
      return;
    }
    var who = st[2] || "me";
    var delay = who === "me" ? ri(2, 6) : who === "customer" ? ri(8, 30) : who === "courier" ? ri(40, 150) : ri(8, 35);
    var nx = steps[c.idx];
    if (nx && ALBA_STEPS[nx[0]]) {
      var wait = !inShift("alba", tms); if (wait) delay = Math.max(delay, (nextShiftStart("alba", tms) - tms) / MIN + ri(5, 30));
      c.albaIssue = newIssue(ALBA_STEPS[nx[0]], ALBA_STEPS[nx[0]], o.csType + " · " + o.recipient + " · " + o.productName, "alba", { orderId:o.id, linked:true }).id;
    }
    c.next = tms + delay * MIN;
  }

  /* ---------- 이슈(사람 손이 필요한 일) · 업무 배분 ----------
   *  owner: bot(자동) · alba(아르바이트, 09~19시 2교대) · boss(대표 판단)
   *  status: new → working → done, 근무 외 시간엔 waiting */
  var STAFF = { alba:[{ name:"김하늘", from:9, to:14 }, { name:"이준서", from:14, to:19 }], boss:{ name:"대표", from:8, to:22 } };
  var OWNER_LABEL = { bot:"자동", alba:"알바", boss:"대표" };
  var ALBA_STEPS = { supplier_claim:"구매처 반품 신청", pickup_tracking:"회수 송장 등록", paid:"차액 입금 처리", supplier_cancel:"구매처 취소 요청", supplier_pickup:"구매처 회수 요청", reported:"미수령 접수 · 택배사 문의", coupang_return:"쿠팡 반품접수 확인" };
  function personFor(owner, tms) {
    var h = new Date(tms).getHours();
    if (owner === "boss") return STAFF.boss.name;
    for (var i = 0; i < STAFF.alba.length; i++) if (h >= STAFF.alba[i].from && h < STAFF.alba[i].to) return STAFF.alba[i].name;
    return STAFF.alba[0].name + " (다음 근무)";
  }
  function inShift(owner, tms) {
    var h = new Date(tms).getHours();
    if (owner === "boss") return h >= STAFF.boss.from && h < STAFF.boss.to;
    return h >= 9 && h < 19;
  }
  function nextShiftStart(owner, tms) {
    var d = new Date(tms), h = d.getHours(), startH = owner === "boss" ? 8 : 9;
    var n = new Date(d.getFullYear(), d.getMonth(), d.getDate() + (h >= startH ? 1 : 0), startH, ri(0, 25));
    return n.getTime();
  }
  function newIssue(type, title, detail, owner, opts) {
    opts = opts || {};
    var t = D.now, wait = !inShift(owner, t);
    var it = { id:++D.issueSeq, type:type, title:title, detail:detail || "", owner:owner, person:personFor(owner, t), status:wait ? "waiting" : "new",
      at:t, startedAt:0, doneAt:0, dueAt:0, orderId:opts.orderId || "", priority:opts.priority || "normal", result:"", linked:!!opts.linked, day:D.dayKey };
    if (!it.linked) {
      var base = wait ? nextShiftStart(owner, t) : t;
      it.dueAt = base + (owner === "boss" ? ri(20, 120) : ri(10, 50)) * MIN + ri(2, 8) * MIN;
    }
    D.issues.unshift(it); if (D.issues.length > 400) D.issues.length = 400;
    D.today.issues++;
    if (opts.feed !== false) feed(new Date(t), owner === "boss" ? "대표" : "알바", owner === "boss" ? "danger" : "warn", title + (detail ? " · " + detail : "") + " → " + it.person + (wait ? " (근무 시작 후 처리)" : ""));
    return it;
  }
  function closeIssue(it, result) {
    if (!it || it.status === "done") return;
    it.status = "done"; it.doneAt = D.now; it.result = result || "처리 완료"; if (!it.startedAt) it.startedAt = it.at;
    D.today.issuesDone++;
    feed(new Date(D.now), "완료", "ok", it.title + " · " + it.person + " · " + fmtDur(it.doneAt - it.at) + " 만에 " + it.result);
  }
  function findIssue(id) { for (var i = 0; i < D.issues.length; i++) if (D.issues[i].id === id) return D.issues[i]; return null; }
  var ISSUE_RESULTS = {
    "품절 확인":["구매처 재고 확인 · 정상 출고", "대체 구매처로 발주 변경", "품절 → 취소 안내 완료"],
    "리뷰 답변":["답변 등록 완료", "사과 답변 + 재발송 제안", "답변 등록 · 대표 보고"],
    "출고 지연 확인":["구매처 확인 · 오늘 출고", "송장 수동 등록", "내일 출고 확정 · 고객 안내"],
    "매입가 상승 검토":["판매가 500원 인상", "가격 유지 · 마진 감수", "구매처 변경 지시"],
    "역마진 주문 확인":["구매처 협의 · 단가 인하", "정상 발주(리뷰 목적)", "취소 처리"],
    "정산 대조":["쿠팡 정산 내역 일치", "차액 12,400원 문의 등록"],
    "대체 소싱 결정":["팜허브로 변경", "당분간 판매 중지"]
  };
  function runIssues(tms) {
    for (var i = 0; i < D.issues.length; i++) {
      var it = D.issues[i]; if (it.status === "done" || it.linked) continue;
      if (it.status === "waiting" && inShift(it.owner, tms)) { it.status = "new"; it.person = personFor(it.owner, tms); }
      if (it.status === "new" && it.dueAt && tms >= it.at + ri(2, 8) * MIN && inShift(it.owner, tms)) { it.status = "working"; it.startedAt = tms; }
      if ((it.status === "working" || it.status === "new") && it.dueAt && tms >= it.dueAt) {
        var rs = ISSUE_RESULTS[it.type]; closeIssue(it, rs ? pick(rs) : "처리 완료");
        if (it.type === "품절 확인" && rnd() < 0.3) newIssue("대체 소싱 결정", "대체 소싱 결정 · " + it.detail, "알바 확인 결과 장기 품절", "boss", { priority:"high" });
      }
    }
  }
  function issueStats() {
    var st = { bot:{ done:D.autoDone || 0, open:0 }, alba:{ done:0, open:0, ms:0, n:0 }, boss:{ done:0, open:0, ms:0, n:0 }, types:{}, created:0, done:0, open:0, waiting:0 };
    D.issues.forEach(function (it) {
      if (it.day !== D.dayKey && it.status === "done") return;
      var o = st[it.owner] || st.alba, ty = st.types[it.type] || (st.types[it.type] = { type:it.type, owner:it.owner, created:0, done:0, open:0, ms:0 });
      st.created++; ty.created++;
      if (it.status === "done") { st.done++; ty.done++; o.done++; o.ms += it.doneAt - it.at; o.n++; ty.ms += it.doneAt - it.at; }
      else { st.open++; ty.open++; o.open++; if (it.status === "waiting") st.waiting++; }
    });
    return st;
  }

  /* ---------- DB · 봇 · 피드 ---------- */
  function bot(key, task) { var b = D.bots[key]; if (!b) return; b.task = task; b.at = D.now; b.pulse = D.tick; }
  function bump(kind) { D.batch[kind] = (D.batch[kind] || 0) + 1; D.batchN++; D.autoDone = (D.autoDone || 0) + 1; }
  // 피드에 안 실린 처리까지 묶어서 한 줄로 — "자동 처리 14건 · 수집 3 · 발주 2 …"
  function flushBatch(t) {
    if (!D.batchN) return;
    var order = [["collected", "수집"], ["checked", "검수"], ["ordered", "발주"], ["invoiced", "송장"], ["shipped", "발송"], ["delivered", "배송완료"]];
    var parts = order.filter(function (x) { return D.batch[x[0]]; }).map(function (x) { return x[1] + " " + D.batch[x[0]]; });
    var from = D.batchFrom ? fmtT(new Date(D.batchFrom)).slice(0, 5) : "", to = fmtT(t).slice(0, 5);
    feed(t, "묶음", "info", (from && from !== to ? from + "~" + to + " " : "") + "자동 처리 " + D.batchN + "건 · " + parts.join(" · "));
    D.batch = {}; D.batchN = 0; D.batchFrom = D.now;
  }
  function feed(t, kind, tone, text) {
    D.feed.unshift({ id:++D.feedSeq, t:fmtT(t), kind:kind, tone:tone, text:text });
    if (D.feed.length > 160) D.feed.length = 160;
  }
  var DB_JOBS = [
    { key:"sourcing", label:"매입처DB 가격 점검", every:[4, 9], run:function (t) {
      var p = pick(PRODUCTS); var delta = ri(-5, 5) * 100; if (!delta) delta = 100;
      var old = p.cost; p.cost = Math.max(1000, p.cost + delta);
      D.db.sourcing.changes++; D.db.sourcing.at = t.getTime();
      if (delta >= 400) newIssue("매입가 상승 검토", "매입가 상승 검토", p.vendor + " · " + short(p.name, 14) + " " + short(p.opt, 10) + " +" + delta + "원 (" + Math.round(delta / old * 100) + "%)", "boss");
      var map = OH.state.sourcingMap; map[p.id] = Object.assign(map[p.id] || {}, { price:p.cost, link:"", category:"" });
      bot("db", p.vendor + " · " + short(p.name, 10) + " 매입가 " + OH.comma(old) + " → " + OH.comma(p.cost));
      feed(t, "DB", "info", "매입처DB 자동 갱신 — " + p.vendor + " " + short(p.name, 14) + " " + short(p.opt, 10) + " 매입가 " + OH.comma(old) + " → " + OH.comma(p.cost) + " (" + (delta > 0 ? "+" : "") + delta + ")");
    } },
    { key:"lineup", label:"라인업 판매량 반영", every:[18, 40], run:function (t) {
      var p = pick(PRODUCTS); D.db.lineup.changes++; D.db.lineup.at = t.getTime();
      bot("db", "라인업 갱신: " + short(p.name, 12) + " 판매량·마진 반영");
      feed(t, "DB", "info", "라인업 자동 갱신 — " + short(p.name, 14) + " " + short(p.opt, 10) + " 오늘 " + ri(20, 140) + "건 · 순위 " + (rnd() < 0.5 ? "↑" : "유지"));
    } },
    { key:"fees", label:"수수료표 동기화", every:[45, 90], run:function (t) {
      D.db.fees.at = t.getTime(); D.db.fees.changes += 0;
      feed(t, "DB", "info", "수수료표 동기화 — 변경 없음(카테고리 13종)");
    } },
    { key:"blacklist", label:"블랙리스트 점검", every:[60, 140], run:function (t) {
      D.db.blacklist.at = t.getTime(); var add = rnd() < 0.3 ? 1 : 0; D.db.blacklist.rows += add; D.db.blacklist.changes += add;
      feed(t, "DB", add ? "warn" : "info", "블랙리스트 자동 점검 — 등록 " + D.db.blacklist.rows + "건" + (add ? " · 신규 1건(반품 악성 패턴 감지)" : " · 신규 없음"));
    } },
    { key:"backup", label:"로컬 백업", every:[60, 60], run:function (t) {
      D.db.backup.changes++; D.db.backup.at = t.getTime();
      feed(t, "백업", "info", "로컬 백업 스냅샷 #" + D.db.backup.changes + " 저장 (" + (1240 + ri(0, 400)) + " KB · 이 PC 안에만)");
    } },
    { key:"soldout", label:"품절 확인", every:[50, 140], run:function (t) {
      var p = pick(PRODUCTS); newIssue("품절 확인", "구매처 품절 확인", p.vendor + " · " + p.name + " " + p.opt + " 재고 회신 없음", "alba");
    } },
    { key:"review", label:"리뷰 답변", every:[30, 70], run:function (t) {
      var p = pick(PRODUCTS); newIssue("리뷰 답변", "낮은 평점 리뷰 답변", p.name + " " + p.opt + " · " + pick(["별 2개 '상태가 별로'", "별 1개 '배송 늦음'", "별 3개 '양이 적어요'", "별 2개 '멍든 게 섞임'"]), "alba");
    } },
    { key:"shipDelay", label:"출고 지연 확인", every:[40, 90], run:function (t) {
      var cands = OH.state.orders.filter(function (o) { return o._d && o._d.stage === "ordered" && D.now - o._d.stageAt > 5 * HOUR; });
      if (cands.length) { var o = pick(cands); newIssue("출고 지연 확인", "구매처 출고 지연 확인", o._d.p.vendor + " · " + o.productName + " · 발주 후 " + fmtDur(D.now - o._d.stageAt) + " 미출고", "alba", { orderId:o.id }); }
    } },
    { key:"settle", label:"정산 대조", every:[700, 900], run:function (t) {
      newIssue("정산 대조", "쿠팡 정산 내역 대조", "지급 예정 " + OH.won(Math.round(D.today.rev * 0.88 / 1000) * 1000) + " · 수수료·배송비 확인", "boss");
    } },
    { key:"csInbound", label:"CS 유입", every:[10, 30], run:function (t) {
      var host = pickLiveOrderForCs(); if (host) openCs(host, t.getTime());
    } },
    { key:"invoiceBatch", label:"송장 일괄 등록", every:[25, 55], run:function (t) {
      var n = 0; OH.state.orders.forEach(function (o) { if (o._d && o._d.stage === "ordered" && o._d.next > D.now && o._d.next - D.now < 4 * HOUR && n < 40) { o._d.next = D.now + ri(5, 90) * 1000; o._d.batched = true; n++; } });
      if (n) { bot("invoice", "택배사 송장 " + n + "건 일괄 등록"); feed(t, "송장", "ok", "택배사 송장 " + n + "건 일괄 등록 · 발송 처리 예약"); }
    } }
  ];
  function scheduleJobs(fromMs) { DB_JOBS.forEach(function (j) { j.next = fromMs + ri(j.every[0], j.every[1]) * MIN * (0.2 + rnd() * 0.8); }); }
  function runJobs(tms) {
    DB_JOBS.forEach(function (j) { if (tms >= j.next) { j.run(new Date(tms)); j.next = tms + ri(j.every[0], j.every[1]) * MIN; } });
  }
  var IDLE_LINES = [
    ["security", "신규 주문 개인정보 마스킹 점검 완료 — 이상 없음"], ["db", "매입처 가격 변동 감시 중"], ["order", "구매처 발주 큐 확인 중"],
    ["invoice", "택배사 송장 조회 정상 — 미등록 건 없음"], ["cs", "판매자센터 문의함 확인 — 새 문의 없음"], ["security", "블랙리스트·수취거부 패턴 대조 중"]
  ];

  /* ---------- 하루 마감 ---------- */
  function rollDay(tms) {
    var t = new Date(tms), k = dayKeyOf(t);
    if (k === D.dayKey) return;
    if (D.dayKey && D.today) {
      var td = D.today, closedDay = D.dayKey, closedMonth = closedDay.slice(0, 7);
      D.days[closedDay] = { cnt:td.cnt, rev:td.rev, margin:td.margin, cost:td.cost, cs:td.cs, csCost:td.csCost, held:td.held };
      D.today = null;
      feed(t, "마감", "ok", "일별매출 자동 마감 " + closedDay + " — 매출 " + OH.won(td.rev) + " · 순마진 " + OH.won(td.margin) + " · " + td.cnt + "건");
      if (t.getDate() === 1) {
        var mRev = 0, mCnt = 0; Object.keys(D.days).forEach(function (dk) { if (dk.slice(0, 7) === closedMonth) { mRev += D.days[dk].rev; mCnt += D.days[dk].cnt; } });
        feed(t, "마감", "ok", "월 마감 완료 — " + closedMonth + " 매출 " + OH.won(mRev) + " · " + OH.comma(mCnt) + "건 · 수익분석 자동 갱신");
      }
      D.yHourly = D.hourly.slice();
      D.feedDayStart = D.feedSeq; Object.keys(D.bots).forEach(function (bk) { D.bots[bk].count = 0; });
    }
    D.dayKey = k; D.today = freshDay(); D.hourly = []; for (var i = 0; i < 24; i++) D.hourly.push(0);
    // 오늘 수준은 어제 실적에 붙여서(±) — "어제 같은 시각 대비" 가 자연스럽게 한 자리 %로
    var yk2 = dayKeyOf(new Date(tms - DAY)), yd = D.days[yk2];
    var yBase = yd ? yd.rev / (DAY_TARGET * WDAY_W[wdayIdx(new Date(tms - DAY))]) : 1;
    D.todayNoise = Math.max(0.85, Math.min(1.15, yBase)) * (0.99 + rnd() * 0.08);
    // 진행 중인 주문(창 안 + 예약 이벤트)을 새 날 깔때기에 이월 → 검수·발주가 수집보다 커지지 않음
    var carry = { collected:0, checked:0, held:0, ordered:0, invoiced:0, shipped:0, delivered:0 };
    if (OH && OH.state) OH.state.orders.forEach(function (o) {
      var st = o._d && o._d.stage; if (!st || st === "delivered" || st === "cancelled") return;
      carry.collected++;
      if (st === "held") { carry.held++; return; }
      if (st !== "collected") carry.checked++;
      if (st === "ordered" || st === "invoiced" || st === "shipped") carry.ordered++;
      if (st === "invoiced" || st === "shipped") carry.invoiced++;
      if (st === "shipped") carry.shipped++;
    });
    var nInv = 0, nShp = 0, nDlv = 0;
    (D.deferred || []).forEach(function (ev) { if (ev.kind === "invoiced") nInv++; else if (ev.kind === "shipped") nShp++; else if (ev.kind === "delivered") nDlv++; });
    carry.collected += nDlv; carry.checked += nDlv; carry.ordered += nDlv; carry.invoiced += Math.max(0, nDlv - nInv); carry.shipped += Math.max(0, nDlv - nShp);
    D.stages = carry; D.autoDone = 0;
    if (D.cs) { D.cs.opened = 0; D.cs.closed = 0; D.cs.auto = 0; D.cs.human = 0; }
  }
  // 시작 시 오늘 이미 지난 시간만큼 채우기(주문 객체는 최근 것만 만들고 나머지는 집계로)
  function prefillToday(tms) {
    var t = new Date(tms), h, i;
    var day0 = new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime();
    var elapsedMs = tms - day0;
    var expected = ORDERS_PER_DAY * WDAY_W[wdayIdx(t)] * D.todayNoise;
    var cntSoFar = 0, revSoFar = 0;
    for (h = 0; h < 24; h++) {
      var hStart = day0 + h * HOUR; if (hStart >= tms) break;
      var frac = Math.min(1, (tms - hStart) / HOUR);
      var c = Math.round(expected * HOUR_W[h] / 24 * frac * (0.9 + rnd() * 0.2));
      var r = Math.round(c * AOV * (0.95 + rnd() * 0.1) / 10) * 10;
      D.hourly[h] += r; cntSoFar += c; revSoFar += r;
    }
    var rate = marginRate(t);
    // 오늘 주문 중 최근 n건만 실제 객체로 만들고, 나머지(기준선)는 집계로만 둠 — 이중 계산 없음
    var n = Math.min(140, cntSoFar), base = cntSoFar - n, share = cntSoFar ? base / cntSoFar : 0;
    var baseRev = Math.round(revSoFar * share);
    for (h = 0; h < 24; h++) D.hourly[h] = Math.round(D.hourly[h] * share);
    D.today.cnt = base; D.today.rev = baseRev; D.today.margin = Math.round(baseRev * rate); D.today.cost = Math.round(baseRev * (1 - rate - 0.118));
    D.today.cs = Math.round(base * CS_RATE); D.today.csCost = D.today.cs * 4200; D.today.held = Math.round(base / 400);
    D.stages.collected = base; D.stages.checked = base; D.stages.held = D.today.held;
    D.stages.ordered = base; D.stages.invoiced = Math.round(base * (t.getHours() >= 15 ? 0.85 : 0.6));
    D.stages.shipped = Math.round(D.stages.invoiced * 0.92);
    var yk = dayKeyOf(new Date(tms - DAY)); D.stages.delivered = Math.round((D.days[yk] ? D.days[yk].cnt : 0) * Math.min(1, elapsedMs / DAY + 0.15));
    // 어제 시간대별
    var yrev = D.days[yk] ? D.days[yk].rev : DAY_TARGET; D.yHourly = [];
    for (i = 0; i < 24; i++) D.yHourly.push(Math.round(yrev * HOUR_W[i] / 24 * (0.9 + rnd() * 0.2)));
    // 최근 주문 객체 n건을 과거 시각으로 만들고(집계는 makeOrder 가 더함) 시간이 지난 만큼 단계 전진
    var made = [];
    for (i = 0; i < n; i++) {
      var back = Math.round(Math.pow(rnd(), 1.6) * Math.min(elapsedMs, 7 * HOUR));
      made.push(makeOrder(new Date(tms - back)));
    }
    made.sort(function (a, b) { return a._d.at - b._d.at; });
    made.forEach(function (o) {
      var guard = 0;
      while (o._d.next && o._d.next <= tms && guard++ < 6) { var before = o._d.stage; advanceOrder(o, o._d.next); if (o._d.stage === before) break; }
    });
    // 진행 중 CS 8건 시드(어제·오늘 배송된 주문)
    var pool = OH.state.orders.slice(); var seeded = 0;
    for (i = 0; i < pool.length && seeded < 8; i++) {
      var so = pool[i]; if (so._d.cs || so._d.stage === "held") continue;
      if (so._d.stage === "ordered" || so._d.stage === "invoiced" || so._d.stage === "shipped") {
        openCs(so, tms - ri(20, 240) * MIN); seeded++;
        var steps = OH.csStepsFor(so), adv = ri(0, Math.max(0, steps.length - 3));
        for (var s = 0; s < adv; s++) { so._d.cs.next = tms - 1; advanceCs(so, tms - ri(1, 200) * MIN); }
        so._d.cs.next = tms + ri(1, 8) * MIN;
      }
    }
    D.bots.order.count = D.stages.ordered; D.bots.invoice.count = D.stages.invoiced; D.bots.cs.count = D.today.cs; D.bots.security.count = D.stages.checked; D.bots.db.count = ri(30, 60);
    D.cs.opened = D.today.cs; D.cs.open = seeded; D.cs.closed = Math.max(0, Math.round((D.today.cs - seeded) * 0.9));
    D.cs.human = Math.round(D.cs.closed * 0.06); D.cs.auto = D.cs.closed - D.cs.human; D.human = Math.max(0, D.human);
    // 어제 주문의 남은 배송완료를 오늘 안에 예약(마지막 단계도 계속 움직이게)
    var yCnt = D.days[yk] ? D.days[yk].cnt : 0, left = Math.max(0, yCnt - D.stages.delivered);
    for (i = 0; i < left; i++) D.deferred.push({ at:tms + rnd() * Math.max(HOUR, (DAY - elapsedMs) * 0.8), kind:"delivered" });
    // 시작 화면이 비지 않게: 지금까지 만든 이벤트를 시각순으로 40개만 남김
    D.feed.sort(function (a, b) { return a.t < b.t ? 1 : a.t > b.t ? -1 : b.id - a.id; });
    if (D.feed.length > 40) D.feed.length = 40;
    seedIssues(tms);
    D.batch = {}; D.batchN = 0; D.batchFrom = tms;
    feed(t, "시작", "ok", "자동 운영 재개 — 오늘 " + OH.comma(D.today.cnt) + "건 · " + OH.won(D.today.rev) + " 처리 중 · 봇 5종 정상");
  }

  function seedIssues(tms) {
    var day0 = new Date(new Date(tms).getFullYear(), new Date(tms).getMonth(), new Date(tms).getDate(), 9).getTime();
    var span = Math.max(0, tms - day0), n = Math.round(span / HOUR * 3.2), saveNow = D.now, i;
    var kinds = [["품절 확인", "alba", "구매처 품절 확인"], ["리뷰 답변", "alba", "낮은 평점 리뷰 답변"], ["출고 지연 확인", "alba", "구매처 출고 지연 확인"], ["회수 송장 등록", "alba", "회수 송장 등록"], ["구매처 반품 신청", "alba", "구매처 반품 신청"], ["매입가 상승 검토", "boss", "매입가 상승 검토"], ["정산 대조", "boss", "쿠팡 정산 내역 대조"], ["CS 대표 판단", "boss", "CS 판단 필요 · 차액협의"]];
    for (i = 0; i < n; i++) {
      var k = pick(kinds), p = pick(PRODUCTS); D.now = day0 + rnd() * span;
      var it = newIssue(k[0], k[2], p.vendor + " · " + p.name + " " + p.opt, k[1], { feed:false });
      if (rnd() < 0.85 || it.at < tms - 3 * HOUR) { it.startedAt = it.at + ri(2, 8) * MIN; it.doneAt = Math.min(tms - ri(1, 30) * MIN, it.startedAt + (k[1] === "boss" ? ri(20, 120) : ri(10, 50)) * MIN); if (it.doneAt > it.startedAt) { it.status = "done"; var rs = ISSUE_RESULTS[it.type]; it.result = rs ? pick(rs) : "처리 완료"; D.today.issuesDone++; } }
      else if (it.status === "new" && rnd() < 0.5) { it.status = "working"; it.startedAt = it.at + ri(2, 8) * MIN; }
    }
    D.now = saveNow;
    D.issues.sort(function (a, b) { return b.at - a.at; });
  }

  /* ---------- 집계(앱 오버레이용) ---------- */
  function dayRows() {
    var keys = Object.keys(D.days).sort(), out = [];
    keys.forEach(function (k) { var g = D.days[k]; out.push({ date:k, cnt:g.cnt, rev:g.rev, margin:g.margin, hasM:true, cs:g.cs, csCost:g.csCost }); });
    if (D.today) out.push({ date:D.dayKey, cnt:D.today.cnt, rev:D.today.rev, margin:D.today.margin, hasM:true, cs:D.today.cs, csCost:D.today.csCost });
    return out;
  }
  function monthRows() {
    var by = {};
    dayRows().forEach(function (r) {
      var m = r.date.slice(0, 7); if (!by[m]) by[m] = { month:m, cnt:0, rev:0, margin:0, csCost:0, hasMargin:true, days:0 };
      by[m].cnt += r.cnt; by[m].rev += r.rev; by[m].margin += r.margin; by[m].csCost += r.csCost; by[m].days++;
    });
    return Object.keys(by).sort().map(function (k) { return by[k]; });
  }
  function sumRange(fromKey, toKey) {
    var s = { cnt:0, rev:0, margin:0, cs:0, csCost:0 };
    dayRows().forEach(function (r) { if (r.date >= fromKey && r.date <= toKey) { s.cnt += r.cnt; s.rev += r.rev; s.margin += r.margin; s.cs += r.cs; s.csCost += r.csCost; } });
    return s;
  }
  function kpis() {
    var t = nowDate(), tk = D.dayKey;
    var yk = dayKeyOf(new Date(t.getTime() - DAY));
    var mk = monthKeyOf(t), lm = monthKeyOf(new Date(t.getFullYear(), t.getMonth() - 1, 1));
    var y = t.getFullYear() + "-01-01";
    var month = sumRange(mk + "-01", tk), lastMonth = sumRange(lm + "-01", lm + "-31"), ytd = sumRange(y, tk);
    // 연매출 페이스 = 최근 4주(요일 균형) 실적의 하루 평균 × 365. 자정마다 4주 전 같은 요일과 교체되므로 요일 효과 없이 완만하게 움직임
    var last28 = sumRange(dayKeyOf(new Date(t.getTime() - 28 * DAY)), yk);
    var pace = Math.round(last28.rev / 28 * 365);
    var processed = D.stages.ordered + D.stages.invoiced + D.stages.shipped;
    var d0 = new Date(t.getFullYear(), t.getMonth(), t.getDate());
    var expDay = Math.round(ORDERS_PER_DAY * WDAY_W[wdayIdx(t)] * (D.todayNoise || 1) * AOV);
    var frac = (t.getTime() - d0.getTime()) / DAY, h = t.getHours(), hf = (t.getTime() - d0.getTime() - h * HOUR) / HOUR;
    var ySame = 0; for (var i = 0; i < h; i++) ySame += D.yHourly[i] || 0; ySame += (D.yHourly[h] || 0) * hf;
    var yTot = (D.days[dayKeyOf(new Date(t.getTime() - DAY))] || {}).rev || DAY_TARGET;
    var vsY = (D.today.rev - ySame) / Math.max(ySame, yTot * 0.06) * 100;
    var autoRate = D.stages.collected ? Math.max(90, 100 - (D.stages.held + D.cs.human) / Math.max(1, D.stages.collected) * 100) : 99.2;
    return {
      today:D.today, yesterday:D.days[yk] || freshDay(), month:month, lastMonth:lastMonth, ytd:ytd, pace:pace, paceRatio:pace / YEAR_TARGET,
      autoRate:Math.round(autoRate * 10) / 10, human:D.human, stages:D.stages, cs:D.cs, processed:processed,
      csAutoRate:D.cs.closed ? Math.round(D.cs.auto / D.cs.closed * 1000) / 10 : 94.0, aov:AOV, perDay:Math.round(ORDERS_PER_DAY),
      expDay:expDay, todayPct:Math.min(100, Math.round(D.today.rev / expDay * 100)), vsY:vsY, frac:frac, vendors:VENDOR_N, leadTime:1.6
    };
  }
  // app.js 에서 부르는 오버레이
  function overview(live) {
    var k = kpis(), td = D.today, live2 = live || {};
    return {
      rev:td.rev, settle:Math.round(td.rev * 0.882), cost:td.cost, margin:td.margin, hasMargin:true, rate:td.rev ? Math.round(td.margin / td.rev * 1000) / 10 : 0,
      total:td.cnt, pending:Math.max(0, td.cnt - D.stages.ordered), purchased:Math.max(0, D.stages.ordered - Math.min(D.stages.invoiced, D.stages.ordered)), invoiced:Math.min(D.stages.invoiced, D.stages.ordered),
      csCost:td.csCost, csCount:td.cs, prodCount:PRODUCTS.length, remaining:Math.max(0, td.cnt - D.stages.ordered), completed:Math.min(D.stages.ordered, td.cnt), cs:td.cs, held:D.stages.held
    };
  }
  function periodRows() {
    var t = nowDate(), tk = D.dayKey, yk = dayKeyOf(new Date(t.getTime() - DAY));
    var mk = monthKeyOf(t), lm = monthKeyOf(new Date(t.getFullYear(), t.getMonth() - 1, 1)), y = t.getFullYear() + "-01-01";
    function row(label, s, go) { return { label:label, go:go, cnt:s.cnt, rev:s.rev, margin:s.margin, hasMargin:true, cs:s.cs, rate:s.rev ? Math.round(s.margin / s.rev * 1000) / 10 : null }; }
    return [row("오늘", sumRange(tk, tk), "daily"), row("어제", sumRange(yk, yk), "daily"), row("이번 달", sumRange(mk + "-01", tk), "profit"), row("지난 달", sumRange(lm + "-01", lm + "-31"), "profit"), row("올해", sumRange(y, tk), "orders:all")];
  }

  /* ---------- 시작 · 정지 · 틱 ---------- */
  function start(opts) {
    opts = opts || {};
    OH = global.OH; if (!OH) { console.warn("demo: window.OH 없음"); return; }
    if (D.active) return;
    var st = OH.state;
    D.snapshot = JSON.stringify({ orders:st.orders, ops:st.ops, sourcingMap:st.sourcingMap, blacklist:st.blacklist, ui:st.ui, deleted:st.deleted });
    st.orders = []; st.deleted = []; st.sourcingMap = {}; st.blacklist = DEMO_BLACKLIST.map(function (b) { return Object.assign({}, b); });
    st.ops = Object.assign(OH.defaultOps(), { lineupExtras:{} });
    st.ui = Object.assign({}, st.ui, { tab:"autopilot", q:"", status:"all", sort:"dateDesc", group:"none", showCs:false, csShowDone:false });
    seed = 20260923 + (opts.seed || 0);
    D.speed = opts.speed || D.speed || 60; D.paused = false; D.tick = 0; D.feed = []; D.feedSeq = 0; D.human = 0; D.seq = 0; D.tween = {};
    D.bots = { order:{ name:"주문봇", role:"수집·검수·발주", task:"대기", count:0 }, invoice:{ name:"송장봇", role:"송장 등록·발송", task:"대기", count:0 }, cs:{ name:"CS봇", role:"응대·접수·회수", task:"대기", count:0 }, db:{ name:"DB봇", role:"가격·라인업·백업", task:"대기", count:0 }, security:{ name:"보안봇", role:"블랙리스트·마스킹", task:"대기", count:0 } };
    D.db = { sourcing:{ label:"매입처DB", rows:PRODUCTS.length, changes:0, at:0 }, lineup:{ label:"라인업", rows:PRODUCTS.length, changes:0, at:0 }, blacklist:{ label:"블랙리스트", rows:DEMO_BLACKLIST.length + 116, changes:0, at:0 }, fees:{ label:"수수료표", rows:13, changes:0, at:0 }, daily:{ label:"일별매출", rows:0, changes:0, at:0 }, backup:{ label:"로컬 백업", rows:0, changes:0, at:0 } };
    D.cs = { opened:0, closed:0, auto:0, human:0, open:0 }; D.deferred = []; D.batch = {}; D.batchN = 0; D.batchFrom = 0; D.lastReal = 0; D.feedDayStart = 0;
    D.issues = []; D.issueSeq = 0; D.autoDone = 0; D.issueFilter = "open";
    PRODUCTS.forEach(function (p, i) { p.cost = BASE_COST[i]; });
    if ($pane) { $pane.innerHTML = ""; $pane.classList.remove("paused"); $pane = null; }
    Object.keys(LEAD).forEach(function (k) { LEAD[k] = []; });
    for (var li = 0; li < 12; li++) LEAD.delivered.push(ri(18, 30) * HOUR + ri(0, 59) * MIN);   // 배송완료는 하루 뒤라 시작값을 채워 둠
    D.now = Date.now(); D.dayKey = ""; D.today = null;
    var todayD = new Date(D.now); var day0 = new Date(todayD.getFullYear(), todayD.getMonth(), todayD.getDate());
    buildHistory(day0);
    D.db.daily.rows = Object.keys(D.days).length;
    rollDay(D.now);
    PRODUCTS.forEach(function (p) { st.sourcingMap[p.id] = { price:p.cost, link:"", category:"" }; });
    D.active = true;
    D.db.sourcing.at = D.db.lineup.at = D.db.fees.at = D.db.blacklist.at = D.db.backup.at = D.now - ri(1, 30) * MIN; D.db.daily.at = day0.getTime();
    prefillToday(D.now);
    scheduleJobs(D.now);
    try { sessionStorage.setItem("oh_demo", "1"); sessionStorage.setItem("oh_demo_speed", String(D.speed)); } catch (e) {}
    OH.show("dashboard"); OH.showDashboard();
    var b = document.getElementById("btn-demo"); if (b) { b.textContent = "자동 운영 끄기"; b.classList.add("on"); }
    document.body.classList.add("demo-on");
    D.timer = setInterval(tickReal, 1000);
    OH.toast("자동 운영을 시작했어요 — 기존 데이터는 잠시 보관됩니다");
  }
  function stop() {
    if (!D.active) return;
    clearInterval(D.timer); D.timer = null; D.active = false;
    try { sessionStorage.removeItem("oh_demo"); } catch (e) {}
    var st = OH.state, snap = null;
    try { snap = JSON.parse(D.snapshot); } catch (e) {}
    if (!snap) { OH.toast("보관한 데이터를 읽지 못해 화면을 새로고침합니다"); setTimeout(function () { location.reload(); }, 600); return; }
    st.orders = snap.orders || []; st.ops = snap.ops; st.sourcingMap = snap.sourcingMap || {}; st.blacklist = snap.blacklist || []; st.ui = snap.ui || st.ui; st.deleted = snap.deleted || [];
    st.orders.forEach(function (o) { OH.computeMargin(o); });
    D.snapshot = null; D.tween = {}; if (D.raf) { cancelAnimationFrame(D.raf); D.raf = null; }
    if ($pane) { $pane.innerHTML = ""; $pane.classList.remove("paused"); $pane = null; }
    try { sessionStorage.removeItem("oh_demo_speed"); } catch (e) {}
    if (OH.reloadSettings) OH.reloadSettings();   // 데모 중 만진 규칙·연동 설정은 저장되지 않았으므로 저장본으로 되돌림
    if (OH.persist) OH.persist();   // 복원된 실제 데이터를 다시 저장해 메모리와 localStorage 를 맞춤
    if (st.ui.tab === "autopilot") st.ui.tab = "dashboard";
    var b = document.getElementById("btn-demo"); if (b) { b.textContent = "자동 운영"; b.classList.remove("on"); }
    document.body.classList.remove("demo-on"); document.body.classList.remove("ap-tab"); setPresent(false);
    if (st.orders.length) OH.showDashboard(); else { OH.show("upload"); OH.render(); }
    OH.toast("자동 운영을 끄고 기존 데이터로 돌아왔어요");
  }
  function toggle() { if (D.active) stop(); else start(); }
  function setSpeed(s) { D.speed = s; try { sessionStorage.setItem("oh_demo_speed", String(s)); } catch (e) {} }

  function userIsEditing() {
    var ae = document.activeElement;
    return !!(ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName) && ae.id !== "q") || !!document.querySelector(".modal-bg");
  }
  function tickReal() {
    if (!D.active) return;
    D.tick++;
    var real = Date.now(), elapsed = D.lastReal ? Math.min(Math.max(real - D.lastReal, 250), 5000) : 1000; D.lastReal = real;
    if (!D.paused) {
      var step = D.speed * elapsed, sub = Math.max(1, Math.ceil(step / (10 * MIN)));   // 10분 단위로 쪼개 순서 보존
      for (var i = 0; i < sub; i++) simulate(step / sub);
    }
    if (D.tick % 6 === 0 && !D.paused) flushBatch(new Date(D.now));
    if (D.tick % 9 === 0) { var il = pick(IDLE_LINES); bot(il[0], il[1]); }
    if (document.hidden) return;                       // 숨은 탭에서는 그리지 않음(시뮬레이션만 계속)
    var tab = OH.state.ui.tab;
    if (tab === "autopilot") renderPane();
    else if (tab === "issues") { document.body.classList.remove("ap-tab"); if (D.tick % 2 === 0) renderIssuesPane(); }
    else { document.body.classList.remove("ap-tab"); if (D.tick % 3 === 0 && !userIsEditing()) OH.render(); }
    if (D.tick % 5 === 0) renderTabsOnly();
  }
  function simulate(dtMs) {
    var from = D.now, f = new Date(from), mid = new Date(f.getFullYear(), f.getMonth(), f.getDate() + 1).getTime();
    if (mid > from && mid < from + dtMs) { simulate(mid - from); simulate(from + dtMs - mid); return; }
    D.now += dtMs; rollDay(D.now);
    var lam = ratePerMs(new Date(from)) * dtMs, n = Math.min(80, poisson(lam)), i, ts = [];
    for (i = 0; i < n; i++) ts.push(from + rnd() * dtMs);
    ts.sort(function (a, b) { return a - b; });
    for (i = 0; i < n; i++) makeOrder(new Date(ts[i]));
    var orders = OH.state.orders;
    for (i = 0; i < orders.length; i++) if (orders[i]._d) advanceOrder(orders[i], D.now);
    runJobs(D.now); runDeferred(D.now); runIssues(D.now);
    if (orders.length > 320) evict(orders);
  }
  // 시트 창(최근 300건) 밖으로 나가는 주문은 '자동 보관' — 남은 단계(발송·배송완료)는 예약 이벤트로 집계만 이어감
  function evict(orders) {
    for (var i = orders.length - 1; i >= 0 && orders.length > 300; i--) {
      var o = orders[i]; if (!o._d) continue;
      var m = o._d, st = m.stage;
      if (m.cs && !m.cs.done) continue;                    // 진행 중 CS 는 남김
      if (st === "delivered" || st === "cancelled") { orders.splice(i, 1); continue; }
      if (st === "ordered" || st === "invoiced" || st === "shipped") {
        var inv = st === "ordered" ? m.next : 0, shp = st === "ordered" ? inv + ri(30, 90) * MIN : (st === "invoiced" ? m.next : 0), dlv = (shp || m.next) + ri(18, 30) * HOUR;
        if (inv) D.deferred.push({ at:inv, kind:"invoiced" });
        if (shp) D.deferred.push({ at:shp, kind:"shipped" });
        D.deferred.push({ at:dlv, kind:"delivered" });
        orders.splice(i, 1);
      }
    }
  }
  function runDeferred(tms) {
    if (!D.deferred.length) return;
    var keep = [];
    for (var i = 0; i < D.deferred.length; i++) {
      var ev = D.deferred[i];
      if (ev.at > tms) { keep.push(ev); continue; }
      D.stages[ev.kind]++; bump(ev.kind);
      if (ev.kind === "invoiced") D.bots.invoice.count++;
    }
    D.deferred = keep;
  }
  function pickLiveOrderForCs() {
    var os = OH.state.orders, cands = [];
    for (var i = 0; i < os.length && cands.length < 40; i++) { var o = os[i]; if (o._d && !o._d.cs && o._d.stage !== "held" && o._d.stage !== "collected" && o._d.stage !== "checked") cands.push(o); }
    return cands.length ? pick(cands) : null;
  }
  function renderTabsOnly() { if (OH && OH.renderTabs) OH.renderTabs(); }

  /* =====================================================================
   * 화면(관제 패널)
   * ===================================================================== */
  var $pane = null;
  function el(sel) { return $pane ? $pane.querySelector(sel) : null; }
  function esc(s) { return OH.esc(s); }
  function wonShort(n) {
    n = Math.round(n || 0); var a = Math.abs(n), s = n < 0 ? "−" : "";
    if (a >= 1e8) return s + "₩" + (a / 1e8).toFixed(a >= 1e9 ? 1 : 2) + "억";
    if (a >= 1e4) return s + "₩" + OH.comma(Math.round(a / 1e4)) + "만";
    return s + "₩" + OH.comma(a);
  }
  var TONE_LABEL = { ok:"완료", info:"진행", warn:"확인", danger:"주의" };
  function buildPane() {
    $pane = document.getElementById("pane-autopilot"); if (!$pane) return;
    $pane.innerHTML =
      '<div class="ap">' +
        '<div class="ap-head">' +
          '<div class="ap-title"><span class="ap-live"><i></i>LIVE</span><div><h2>오토파일럿 관제</h2><small>루루농장 · 쿠팡 위탁판매 자동 운영 · 주문 · CS · 매출 · DB</small></div>' +
            '<span class="ap-botdots">' + ["주문봇", "송장봇", "CS봇", "DB봇", "보안봇"].map(function (n) { return '<b><i></i>' + n + '</b>'; }).join("") + '</span></div>' +
          '<div class="ap-clock"><b data-k="clock">--:--:--</b><span data-k="date"></span></div>' +
          '<div class="ap-ctl">' +
            '<span class="ap-speed">' + [1, 60, 600].map(function (s) { return '<button type="button" data-speed="' + s + '" class="' + (s === D.speed ? "on" : "") + '">' + s + '×</button>'; }).join("") + '</span>' +
            '<button type="button" class="btn sm" data-pause>일시정지</button>' +
            '<button type="button" class="btn sm" data-present title="상단 메뉴를 숨기고 관제 화면만 크게 (Esc 로 해제)">발표 모드</button>' +
          '</div>' +
        '</div>' +
        '<div class="ap-kpis">' +
          kpi("today", "오늘 매출", "hero", "어제 같은 시각 대비 <b data-k=\"vsY\">—</b> · 시간당 <b data-k=\"perHour\">0</b>건 · 오늘 <b data-k=\"todayCnt\">0</b>건<div class=\"bar\"><span data-k=\"todayBar\"></span></div><div class=\"bar-l\">오늘 예상 <b data-k=\"todayExp\">—</b> · <b data-k=\"todayPct\">0</b>% 진행</div>") +
          kpi("pace", "연매출 페이스", "ring", "목표 80억 대비 <b data-k=\"paceRatio\">100</b>% · 올해 <b data-k=\"ytdPct\">0</b>% 달성") +
          kpi("month", "이번 달 매출", "", "지난 달 <b data-k=\"lastMonth\">—</b>") +
          kpi("ytd", "올해 누적", "", "<b data-k=\"ytdCnt\">0</b>건") +
          kpi("margin", "오늘 순마진", "", "마진율 <b data-k=\"rate\">0</b>% · CS 차감 <b data-k=\"csCost\">0</b>") +
          kpi("auto", "자동 처리율", "", "사람 개입 대기 <b data-k=\"human\" class=\"ap-human\">0</b>건") +
        '</div>' +
        '<div class="ap-pipe" data-k="pipe"></div>' +
        '<div class="ap-grid">' +
          '<section class="ap-card ap-feed"><header><h3>실시간 활동</h3><span data-k="feedN"></span></header><ol data-k="feed"></ol></section>' +
          '<section class="ap-card ap-cs"><header><h3>CS 자동화</h3><span>진행 <b data-k="csOpen">0</b> · 오늘 종결 <b data-k="csClosed">0</b> · 자동 해결 <b data-k="csAuto">0</b>%</span></header><div data-k="cs"></div></section>' +
          '<div class="ap-col">' +
            '<section class="ap-card ap-bots"><header><h3>봇 상태</h3><span>5/5 가동</span></header><div data-k="bots"></div></section>' +
            '<section class="ap-card ap-db"><header><h3>DB 자동 관리</h3><span data-k="dbSum"></span></header><div data-k="db"></div></section>' +
          '</div>' +
        '</div>' +
        '<div class="ap-work" data-k="work"></div>' +
        '<div class="ap-charts">' +
          '<section class="ap-card"><header><h3>최근 30일 매출</h3><span data-k="c30"></span></header><div class="ap-chart" data-k="chart30"></div></section>' +
          '<section class="ap-card"><header><h3>오늘 시간대별</h3><span data-k="cH">어제 대비</span></header><div class="ap-chart" data-k="chartH"></div></section>' +
          '<section class="ap-card"><header><h3>12개월 매출</h3><span data-k="c12"></span></header><div class="ap-chart" data-k="chart12"></div></section>' +
        '</div>' +
      '</div>';
    $pane.addEventListener("click", onPaneClick);
  }
  function kpi(key, label, cls, sub) {
    return '<div class="ap-kpi ' + cls + '" data-kpi="' + key + '">' + (cls === "ring" ? '<div class="ap-ring"><svg viewBox="0 0 36 36"><circle cx="18" cy="18" r="15.9"/><circle cx="18" cy="18" r="15.9" data-k="ringArc" stroke-dasharray="0 100"/></svg></div>' : "") +
      '<div class="k">' + label + '</div><div class="v" data-k="' + key + '">—</div><div class="s">' + sub + '</div></div>';
  }
  function onPaneClick(e) {
    var sp = e.target.closest("[data-speed]");
    if (sp) { setSpeed(parseInt(sp.getAttribute("data-speed"), 10)); Array.prototype.forEach.call($pane.querySelectorAll("[data-speed]"), function (b) { b.classList.toggle("on", b === sp); }); return; }
    if (e.target.closest("[data-present]")) { setPresent(!document.body.classList.contains("ap-present")); return; }
    if (e.target.closest("[data-pause]")) {
      D.paused = !D.paused; e.target.closest("[data-pause]").textContent = D.paused ? "재개" : "일시정지";
      var apEl = el(".ap"); if (apEl) apEl.classList.toggle("paused", D.paused);
      var lv = el(".ap-live"); if (lv) lv.lastChild.textContent = D.paused ? "PAUSED" : "LIVE";
      return;
    }
    var go = e.target.closest("[data-ap-go]"); if (go) { OH.setTab(go.getAttribute("data-ap-go")); }
  }
  // 숫자 카운트업
  function tweenTo(key, target, fmt) {
    var t = D.tween[key] || (D.tween[key] = { cur:target, from:target, to:target, t0:0 });
    if (t.to !== target) { t.from = t.cur; t.to = target; t.t0 = performance.now(); }
    t.fmt = fmt; t.el = el('[data-k="' + key + '"]');
    if (!D.raf) D.raf = requestAnimationFrame(tweenFrame);
  }
  function tweenFrame(now) {
    var live = false;
    Object.keys(D.tween).forEach(function (k) {
      var t = D.tween[k]; if (!t.el) return;
      var p = t.t0 ? Math.min(1, (now - t.t0) / 850) : 1; var e = 1 - Math.pow(1 - p, 3);
      t.cur = t.from + (t.to - t.from) * e;
      t.el.textContent = t.fmt(t.cur);
      if (p < 1) live = true;
    });
    D.raf = live ? requestAnimationFrame(tweenFrame) : null;
  }
  function fitPresent() {
    var ap = el(".ap"); if (!ap) return;
    ap.style.zoom = "";
    if (!document.body.classList.contains("ap-present")) return;
    var sc = Math.min(1, (window.innerHeight - 4) / ap.scrollHeight, window.innerWidth / ap.scrollWidth);
    if (sc < 0.999) ap.style.zoom = sc.toFixed(3);
  }
  window.addEventListener("resize", function () { if (document.body.classList.contains("ap-present")) setTimeout(fitPresent, 50); });
  document.addEventListener("fullscreenchange", function () { if (!document.fullscreenElement && document.body.classList.contains("ap-present")) setPresent(false); });
  function setPresent(on) {
    document.body.classList.toggle("ap-present", on);
    var b = el("[data-present]"); if (b) b.textContent = on ? "발표 모드 해제" : "발표 모드";
    setTimeout(fitPresent, 30); setTimeout(fitPresent, 400);
    try { if (on && document.documentElement.requestFullscreen && !document.fullscreenElement) document.documentElement.requestFullscreen().catch(function () {}); else if (!on && document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(function () {}); } catch (e) {}
  }
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && document.body.classList.contains("ap-present")) setPresent(false); });
  document.addEventListener("click", function (e) {
    if (e.target.closest("[data-demo-stop]")) { stop(); return; }
    if (e.target.closest("[data-demo-go]") && D.active) { OH.setTab("autopilot"); }
  });
  function setText(key, v) { var e = el('[data-k="' + key + '"]'); if (e && e.textContent !== String(v)) e.textContent = v; }
  function renderPane() {
    document.body.classList.add("ap-tab");
    if (!$pane || !document.getElementById("pane-autopilot") || $pane !== document.getElementById("pane-autopilot") || !$pane.firstChild) buildPane();
    if (!$pane) return;
    var k = kpis(), t = nowDate();
    setText("clock", fmtT(t)); setText("date", dayKeyOf(t) + " " + ["일", "월", "화", "수", "목", "금", "토"][t.getDay()] + "요일 · " + D.speed + "배속");
    tweenTo("today", k.today.rev, function (v) { return OH.won(Math.round(v)); });
    tweenTo("pace", k.pace, function (v) { return "₩" + (v / 1e8).toFixed(1) + "억"; });
    tweenTo("month", k.month.rev, function (v) { return wonShort(v); });
    tweenTo("ytd", k.ytd.rev, function (v) { return wonShort(v); });
    tweenTo("margin", k.today.margin, function (v) { return OH.won(Math.round(v)); });
    tweenTo("auto", k.autoRate, function (v) { return v.toFixed(1) + "%"; });
    setText("todayCnt", OH.comma(k.today.cnt)); setText("perHour", Math.round(k.perDay * HOUR_W[t.getHours()] / 24));
    setText("vsY", (k.vsY >= 0 ? "+" : "") + k.vsY.toFixed(1) + "%"); var vy = el('[data-k="vsY"]'); if (vy) vy.classList.toggle("neg", k.vsY < 0);
    setText("todayExp", wonShort(k.expDay)); setText("todayPct", k.todayPct); var tb = el('[data-k="todayBar"]'); if (tb) tb.style.width = k.todayPct + "%";
    setText("paceRatio", (k.paceRatio * 100).toFixed(1)); setText("lastMonth", wonShort(k.lastMonth.rev)); setText("ytdCnt", OH.comma(k.ytd.cnt));
    setText("rate", k.today.rev ? (k.today.margin / k.today.rev * 100).toFixed(1) : "0"); setText("csCost", OH.won(k.today.csCost));
    setText("human", k.human); var hEl = el('[data-k="human"]'); if (hEl) hEl.classList.toggle("hot", k.human > 0);
    var arc = el('[data-k="ringArc"]'); if (arc) arc.setAttribute("stroke-dasharray", Math.min(100, k.ytd.rev / YEAR_TARGET * 100).toFixed(1) + " 100");
    setText("ytdPct", (k.ytd.rev / YEAR_TARGET * 100).toFixed(1)); setText("cH", "어제 같은 시각 대비 " + (k.vsY >= 0 ? "+" : "") + k.vsY.toFixed(1) + "%");
    renderPipe(k); renderFeed(); renderCs(); renderBots(); renderDb(); renderWork();
    if (D.tick % 3 === 0 || !el('[data-k="chart30"] svg')) renderCharts(k);
  }
  var ICON = {
    inbox:'<svg viewBox="0 0 24 24"><path d="M3 13h5l2 3h4l2-3h5"/><path d="M5 5h14l2 8v6H3v-6z"/></svg>',
    shield:'<svg viewBox="0 0 24 24"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/></svg>',
    cart:'<svg viewBox="0 0 24 24"><path d="M3 4h2l2.5 11h11L21 7H6"/><circle cx="9" cy="19" r="1.5"/><circle cx="17" cy="19" r="1.5"/></svg>',
    tag:'<svg viewBox="0 0 24 24"><path d="M3 12V4h8l9 9-8 8z"/><circle cx="7.5" cy="8.5" r="1.5"/></svg>',
    truck:'<svg viewBox="0 0 24 24"><path d="M2 6h12v10H2z"/><path d="M14 10h4l3 3v3h-7z"/><circle cx="6" cy="18" r="1.8"/><circle cx="17" cy="18" r="1.8"/></svg>',
    check:'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/></svg>'
  };
  function renderPipe(k) {
    var s = k.stages, box = el('[data-k="pipe"]'); if (!box) return;
    var steps = [["수집", s.collected, "orders:all", "쿠팡 수집 · 5분 주기", ICON.inbox], ["검수", s.checked, "blacklist", "블랙리스트 · 마스킹", ICON.shield], ["발주", s.ordered, "orders:purchased", "구매처 " + k.vendors + "곳 자동", ICON.cart],
      ["송장", s.invoiced, "invoice", "자동 등록", ICON.tag], ["발송", s.shipped, "invoice", "CJ · 롯데 · 한진", ICON.truck], ["배송완료", s.delivered, "daily", "어제 주문 · 자동 확인", ICON.check]];
    if (!box.firstChild) {
      box.innerHTML = '<div class="ap-pipe-row">' + steps.map(function (x, i) {
        return (i ? '<div class="ap-flow"><i></i><i></i><i></i></div>' : "") +
          '<button type="button" class="ap-stage" data-ap-go="' + x[2] + '"><span class="ic">' + x[4] + '</span><span class="n" data-k="st' + i + '">' + OH.comma(x[1]) + '</span><span class="l">' + x[0] + '</span><span class="sl">' + x[3] + '</span></button>';
      }).join("") + '</div>' +
      '<div class="ap-lead"><span>평균 소요</span>' + ["checked", "ordered", "invoiced", "shipped", "delivered"].map(function (kk, i) { return '<em data-k="lead' + i + '">—</em>'; }).join("") + '</div>' +
      '<div class="ap-pipe-foot"><span>구매처 <b>' + k.vendors + '</b>곳 자동 발주</span><span>송장 자동 업로드 <b data-k="pfInv">0</b>건</span><span>평균 리드타임 <b>' + k.leadTime + '</b>일</span><span class="note">단계 건수는 처리 중인 전일 주문 포함</span><span class="ap-held" data-k="pfHeld"><i></i>블랙리스트 일치 → 자동 보류 <b>0</b>건</span><span class="sp"></span><span>처리 중 <b data-k="pfFlow">0</b>건</span></div>';
    }
    steps.forEach(function (x, i) { setText("st" + i, OH.comma(x[1])); });
    ["checked", "ordered", "invoiced", "shipped", "delivered"].forEach(function (kk, i) { setText("lead" + i, fmtDur(leadAvg(kk))); });
    setText("pfInv", OH.comma(s.invoiced)); setText("pfFlow", OH.comma(Math.max(0, s.collected - s.shipped)));
    var hb = el('[data-k="pfHeld"]');
    if (hb) { var open = k.human; hb.classList.toggle("on", open > 0); hb.innerHTML = '<i></i>블랙리스트 일치 → 자동 보류 <b>' + s.held + '</b>건' + (open ? ' · 담당자 확인 대기 <b>' + open + '</b>건' : (s.held ? ' · 확인 완료' : '')); }
  }
  function renderFeed() {
    var ol = el('[data-k="feed"]'); if (!ol) return;
    var first = ol.firstChild, topId = first ? parseInt(first.getAttribute("data-id"), 10) : 0;
    var fresh = D.feed.filter(function (f) { return f.id > topId; }).reverse();
    fresh.forEach(function (f) {
      var li = document.createElement("li"); li.className = "ap-ev " + f.tone; li.setAttribute("data-id", f.id);
      li.innerHTML = '<time>' + f.t + '</time><span class="tag">' + esc(f.kind) + '</span><span class="tx">' + esc(f.text) + '</span>';
      ol.insertBefore(li, ol.firstChild);
    });
    while (ol.children.length > 42) ol.removeChild(ol.lastChild);
    setText("feedN", "오늘 " + OH.comma(D.feedSeq - (D.feedDayStart || 0)) + "건 기록");
  }
  function renderCs() {
    var box = el('[data-k="cs"]'); if (!box) return;
    var list = OH.state.orders.filter(function (o) { return o._d && o._d.cs && !o._d.cs.done; }).slice(0, 7);
    setText("csOpen", D.cs.open); setText("csClosed", D.cs.closed); setText("csAuto", kpis().csAutoRate);
    if (!list.length) { box.innerHTML = '<div class="ap-empty">진행 중인 CS가 없습니다 — 새 문의는 자동으로 접수됩니다</div>'; return; }
    box.innerHTML = list.map(function (o) {
      var steps = OH.csStepsFor(o), done = 0; steps.forEach(function (s) { if (o.cs.steps[s[0]]) done++; });
      var last = (o.memoLog || []).slice().reverse().filter(function (m) { return m.kind === "note"; })[0];
      var waiting = o.cs.nextAction ? "담당자 확인" : ({ me:"봇 처리 중", customer:"고객 회신 대기", supplier:"구매처 대기", courier:"회수 대기", coupang:"쿠팡 대기" })[o.cs.waitingOn] || "진행";
      var cid = "#CS-" + (4100 + (parseInt(String(o.uniqueNo || "0").slice(-3), 10) || 0));
      return '<div class="ap-csi' + (o.cs.nextAction ? " hot" : "") + '" data-ap-go="cs">' +
        '<div class="r1"><span class="type">' + esc(o.csType) + '</span><span class="who">' + esc(o.productName) + ' ' + esc(o.option) + ' · ' + esc(o.recipient) + '</span><span class="cid">' + cid + '</span><span class="wait">' + esc(waiting) + '</span></div>' +
        '<div class="steps"><span class="line"></span>' + steps.map(function (s, i) { return '<i class="' + (o.cs.steps[s[0]] ? "on" : (i === done ? "cur" : "")) + '" title="' + esc(s[1]) + '"></i>'; }).join("") + '<span class="cnt">' + done + '/' + steps.length + '</span></div>' +
        (last ? '<div class="bubble"><span class="ai">AI</span>' + esc(String(last.text).replace(/^AI 응대 발송: /, "")) + '</div>' : "") +
      '</div>';
    }).join("");
  }
  function renderBots() {
    var box = el('[data-k="bots"]'); if (!box) return;
    box.innerHTML = Object.keys(D.bots).map(function (k) {
      var b = D.bots[k], hot = D.tick - (b.pulse || -99) < 3;
      var up = (99.93 + (k.charCodeAt(0) % 5) / 100).toFixed(2);
      return '<div class="ap-bot' + (hot ? " hot" : "") + '"><i></i><div><b>' + esc(b.name) + '</b><span>' + esc(b.role) + '</span></div><div class="task">' + esc(b.task) + '</div><div class="cnt"><b>' + (b.count ? OH.comma(b.count) + "건" : "—") + '</b><span>가동 ' + up + '%</span></div></div>';
    }).join("");
  }
  function renderDb() {
    var box = el('[data-k="db"]'); if (!box) return;
    var keys = ["sourcing", "lineup", "blacklist", "fees", "daily", "backup"], changes = 0;
    box.innerHTML = keys.map(function (k) {
      var d = D.db[k]; changes += d.changes;
      var ago = d.at ? Math.max(0, Math.round((D.now - d.at) / MIN)) : null;
      var agoTxt = ago == null ? "" : ago < 1 ? "방금" : ago < 60 ? ago + "분 전" : Math.round(ago / 60) + "시간 전";
      var spin = k === "daily" || (d.at && D.now - d.at < 2 * MIN);
      var stTxt = k === "daily" ? "오늘분 집계 중" : k === "backup" ? (d.changes ? "스냅샷 " + d.changes + "개" : "대기") : (d.changes ? "오늘 갱신 " + d.changes : "변경 없음");
      if (k === "daily") agoTxt = "실시간";
      return '<div class="ap-dbi' + (spin ? " spin" : "") + '"><i></i><b>' + esc(d.label) + '</b><span>' + (d.rows ? OH.comma(d.rows) + "건" : "") + '</span><em>' + stTxt + '</em><time>' + agoTxt + '</time></div>';
    }).join("");
    setText("dbSum", "오늘 자동 갱신 " + changes + "건");
  }
  function statusLabel(it) { return it.status === "done" ? "완료" : it.status === "working" ? "처리 중" : it.status === "waiting" ? "근무 대기" : "접수"; }
  function openIssues(owner) { return D.issues.filter(function (it) { return it.status !== "done" && (!owner || it.owner === owner); }); }
  function renderWork() {
    var box = el('[data-k="work"]'); if (!box) return;
    var st = issueStats(), t = D.now;
    function col(owner, title, who, sub, items, done, open) {
      return '<section class="ap-card ap-wcol ' + owner + '"><header><h3>' + title + '</h3><span>' + esc(who) + '</span></header>' +
        '<div class="ap-wnum"><b>' + OH.comma(done) + '</b><span>오늘 처리</span><b class="' + (open ? "hot" : "") + '">' + open + '</b><span>대기</span></div>' +
        '<div class="ap-wsub">' + sub + '</div>' +
        '<ul>' + (items.length ? items.map(function (it) { return '<li class="' + it.status + '"><i></i><div><span>' + esc(it.title) + '</span><em>' + esc(it.person) + ' · ' + statusLabel(it) + ' · ' + fmtDur(t - it.at) + '</em></div></li>'; }).join("") : '<li class="none">대기 중인 일이 없습니다</li>') + '</ul></section>';
    }
    var botItems = [D.bots.order, D.bots.cs, D.bots.db].map(function (b) { return { title:b.task, person:b.name, status:"working", at:t - 30000 }; });
    var albaNow = personFor("alba", t), bossNow = STAFF.boss.name;
    box.innerHTML = '<div class="ap-work-head"><h3>업무 배분 · 대응 현황</h3><span>봇이 못 하는 일은 알바와 대표에게 자동 배정됩니다</span><span class="sp"></span><button type="button" class="btn sm" data-ap-go="issues">이슈 대응 전체 보기</button></div><div class="ap-work-grid">' +
      col("bot", "자동 처리 (봇)", "봇 5종", "수집·검수·발주·송장·CS 응대·DB 갱신", botItems, st.bot.done, 0) +
      col("alba", "알바 업무", (inShift("alba", t) ? "근무 중 · " + albaNow : "근무 외 · 09시 시작"), "회수 송장 · 구매처 반품/취소 · 차액 입금 · 품절 확인 · 리뷰 답변 · 출고 확인", openIssues("alba").slice(0, 4), st.alba.done, st.alba.open) +
      col("boss", "대표 판단", (inShift("boss", t) ? "확인 가능 · " + bossNow : "근무 외"), "블랙리스트 보류 · CS 한도 초과 · 매입가 급등 · 역마진 · 정산 대조", openIssues("boss").slice(0, 4), st.boss.done, st.boss.open) +
    '</div>';
  }
  // 이슈 대응 탭(밝은 테마, 앱 표 스타일)
  function renderIssuesPane() {
    var pane = document.getElementById("pane-issues"); if (!pane || !D.active) return;
    var st = issueStats(), t = D.now, f = D.issueFilter || "open";
    var list = D.issues.filter(function (it) {
      if (f === "open") return it.status !== "done";
      if (f === "done") return it.status === "done" && it.day === D.dayKey;
      if (f === "alba" || f === "boss") return it.owner === f && it.status !== "done";
      return true;
    }).slice(0, 80);
    function avg(o) { return o.n ? fmtDur(o.ms / o.n) : "—"; }
    var types = Object.keys(st.types).map(function (k) { return st.types[k]; }).sort(function (a, b) { return b.created - a.created; });
    var chip = function (key, label, n) { return '<button type="button" class="pill' + (f === key ? " on" : "") + '" data-issue-filter="' + key + '">' + label + (n != null ? ' <b>' + n + '</b>' : "") + '</button>'; };
    pane.innerHTML =
      '<div class="ops-head"><div><h2>이슈 대응</h2><p>자동 처리에서 벗어난 일(사람 손이 필요한 일)이 알바·대표에게 배정되고, 처리 현황이 여기에 모입니다.</p></div><div class="spacer"></div><button class="btn sm" type="button" data-ap-go="autopilot">관제 화면</button></div>' +
      '<div class="ov-grid issues-kpi">' +
        ovCardL("오늘 발생", st.created + "건") + ovCardL("처리 완료", st.done + "건", "pos") + ovCardL("대기·진행", st.open + "건", st.open ? "neg" : "") +
        ovCardL("알바 처리", st.alba.done + "건 · 평균 " + avg(st.alba)) + ovCardL("대표 판단", st.boss.done + "건 · 평균 " + avg(st.boss)) + ovCardL("자동 처리", OH.comma(st.bot.done) + "건") +
      '</div>' +
      '<div class="issues-filters">' + chip("open", "대기·진행", st.open) + chip("alba", "알바", st.alba.open) + chip("boss", "대표", st.boss.open) + chip("done", "오늘 완료", st.done) + chip("all", "전체") + '</div>' +
      '<div class="data-scroll"><table class="data issues"><thead><tr><th>시각</th><th>구분</th><th>내용</th><th>담당</th><th>상태</th><th class="num">경과</th><th>결과</th></tr></thead><tbody>' +
        (list.length ? list.map(function (it) {
          var when = new Date(it.at), tm = pad(when.getHours()) + ":" + pad(when.getMinutes()) + (it.day !== D.dayKey ? " (" + it.day.slice(5) + ")" : "");
          return '<tr class="st-' + it.status + (it.priority === "high" ? " pri" : "") + '"><td>' + tm + '</td><td><span class="owner-chip ' + it.owner + '">' + OWNER_LABEL[it.owner] + '</span> ' + esc(it.type) + '</td><td style="white-space:normal;min-width:260px">' + esc(it.title) + (it.detail ? '<div class="muted-note">' + esc(it.detail) + '</div>' : "") + '</td><td>' + esc(it.person) + '</td><td><span class="status-chip ' + it.status + '">' + statusLabel(it) + '</span></td><td class="num">' + fmtDur((it.status === "done" ? it.doneAt : t) - it.at) + '</td><td style="white-space:normal">' + esc(it.result || (it.status === "waiting" ? "근무 시작 후 처리" : "")) + '</td></tr>';
        }).join("") : '<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:24px">해당하는 이슈가 없습니다</td></tr>') +
      '</tbody></table></div>' +
      '<div class="panel-head monthly-head"><h2>유형별 대응 현황 (오늘)</h2><span class="muted-note">평균 대응 = 발생부터 완료까지</span></div>' +
      '<div class="data-scroll monthly-scroll"><table class="data"><thead><tr><th>유형</th><th>담당</th><th class="num">발생</th><th class="num">완료</th><th class="num">대기</th><th class="num">평균 대응</th></tr></thead><tbody>' +
        (types.length ? types.map(function (ty) { return '<tr><td>' + esc(ty.type) + '</td><td>' + OWNER_LABEL[ty.owner] + '</td><td class="num">' + ty.created + '</td><td class="num">' + ty.done + '</td><td class="num">' + ty.open + '</td><td class="num">' + (ty.done ? fmtDur(ty.ms / ty.done) : "—") + '</td></tr>'; }).join("") : '<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:20px">아직 발생한 이슈가 없습니다</td></tr>') +
      '</tbody></table></div>' +
      '<div class="panel-head monthly-head"><h2>담당별 근무·배정</h2></div>' +
      '<div class="ov-grid staff-grid">' +
        ovCardL("봇 (24시간)", "수집·검수·발주·송장·CS 1차 응대·DB 갱신·백업") +
        ovCardL("알바 오전 · " + STAFF.alba[0].name, "09~14시 · 회수 송장 · 구매처 반품/취소 · 차액 입금 · 리뷰 답변") +
        ovCardL("알바 오후 · " + STAFF.alba[1].name, "14~19시 · 품절 확인 · 출고 지연 확인 · 미수령 접수") +
        ovCardL("대표", "08~22시 · 블랙리스트 보류 · CS 한도 초과 · 매입가 급등 · 역마진 · 정산") +
      '</div>';
  }
  function ovCardL(k, v, cls) { return '<div class="ov-card"><div class="k">' + esc(k) + '</div><div class="v' + (cls ? " " + cls : "") + '">' + esc(v) + '</div></div>'; }
  document.addEventListener("click", function (e) {
    var f = e.target.closest("[data-issue-filter]"); if (f) { D.issueFilter = f.getAttribute("data-issue-filter"); renderIssuesPane(); return; }
    var g = e.target.closest("#pane-issues [data-ap-go]"); if (g) OH.setTab(g.getAttribute("data-ap-go"));
  });
  function renderCharts(k) {
    var rows = dayRows(), last30 = rows.slice(-30), max = Math.max.apply(null, last30.map(function (r) { return r.rev; })) || 1;
    var W = 600, H = 150, gap = 4, bw = (W - gap * 29) / 30;
    var b30 = el('[data-k="chart30"]'); if (b30) {
      b30.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none">' + last30.map(function (r, i) {
        var h = Math.max(2, r.rev / max * (H - 6)); var today = i === last30.length - 1;
        return '<rect x="' + (i * (bw + gap)).toFixed(1) + '" y="' + (H - h).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="2" class="' + (today ? "today" : "") + '"/>';
      }).join("") + '</svg>';
      b30.innerHTML += '<div class="ap-xl">' + [0, 10, 20].map(function (i) { return '<span style="left:' + (i / 29 * 100).toFixed(1) + '%">' + last30[i].date.slice(5).replace("-", "/") + '</span>'; }).join("") + '<span class="hl" style="left:100%">오늘</span></div>';
      setText("c30", "일평균 " + wonShort(last30.reduce(function (s, r) { return s + r.rev; }, 0) / last30.length) + " · 최고 " + wonShort(max));
    }
    var bh = el('[data-k="chartH"]'); if (bh) {
      var cum = [], cy = [], a = 0, b = 0, i;
      for (i = 0; i < 24; i++) { a += D.hourly[i] || 0; b += D.yHourly[i] || 0; cum.push(a); cy.push(b); }
      var h = nowDate().getHours(), proj = [], acc = cum[h], rest = 0, j;
      for (j = h + 1; j < 24; j++) rest += HOUR_W[j];
      var remain = Math.max(0, k.expDay - cum[h]);
      for (j = 0; j < 24; j++) { if (j <= h) proj.push(cum[j]); else { acc += rest ? remain * HOUR_W[j] / rest : 0; proj.push(acc); } }
      var hmax = Math.max(cum[23], cy[23], proj[23]) || 1;
      function path(arr, from, upto) { var s = ""; for (var q = from; q <= upto; q++) s += (q === from ? "M" : "L") + (q / 23 * W).toFixed(1) + "," + (H - 4 - arr[q] / hmax * (H - 10)).toFixed(1); return s; }
      bh.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none"><path class="y" d="' + path(cy, 0, 23) + '"/><path class="p" d="' + path(proj, h, 23) + '"/><path class="t" d="' + path(cum, 0, h) + '"/><circle class="dot" cx="' + (h / 23 * W).toFixed(1) + '" cy="' + (H - 4 - cum[h] / hmax * (H - 10)).toFixed(1) + '" r="4"/></svg>' +
        '<div class="ap-xl">' + [0, 6, 12, 18, 23].map(function (hh) { return '<span style="left:' + (hh / 23 * 100).toFixed(1) + '%">' + (hh === 23 ? "24" : hh) + '시</span>'; }).join("") + '</div><div class="ap-lg"><i class="t"></i>오늘 누적 <i class="p"></i>예상 <i class="y"></i>어제</div>';
    }
    var b12 = el('[data-k="chart12"]'); if (b12) {
      var ms = monthRows().slice(-12), mmax = Math.max.apply(null, ms.map(function (m) { return m.rev; })) || 1, bw2 = (W - 8 * 11) / 12;
      b12.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none">' + ms.map(function (m, i) {
        var hh = Math.max(2, m.rev / mmax * (H - 6)); return '<rect x="' + (i * (bw2 + 8)).toFixed(1) + '" y="' + (H - hh).toFixed(1) + '" width="' + bw2.toFixed(1) + '" height="' + hh.toFixed(1) + '" rx="3" class="' + (i === ms.length - 1 ? "today" : "") + '"/>';
      }).join("") + '</svg><div class="ap-xl months">' + ms.map(function (m) { return '<span>' + parseInt(m.month.slice(5), 10) + '월</span>'; }).join("") + '</div>';
      setText("c12", "올해 " + wonShort(k.ytd.rev) + " · 연 목표 ₩80억");
    }
  }

  /* ---------- 공개 API ---------- */
  var api = {
    get active() { return D.active; },
    get speed() { return D.speed; },
    start:start, stop:stop, toggle:toggle, setSpeed:setSpeed,
    now:function () { return D.active ? D.now : Date.now(); },
    dailyRows:function () { return dayRows().slice(-60); }, monthlyRows:monthRows, overview:overview, periodRows:periodRows, kpis:kpis,
    renderPane:renderPane, renderIssuesPane:renderIssuesPane, state:D
  };
  global.Demo = api;

  // ?demo=1 또는 새로고침 전 켜져 있었으면 자동 시작
  function autoStart() {
    var q = (location.search || ""), on = /[?&]demo=1/.test(q), sp = (q.match(/[?&]speed=(\d+)/) || [])[1];
    var was = false; try { was = sessionStorage.getItem("oh_demo") === "1"; if (!sp) sp = sessionStorage.getItem("oh_demo_speed"); } catch (e) {}
    if (on || was) setTimeout(function () { start({ speed:parseInt(sp || "60", 10) || 60 }); }, 80);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", autoStart); else autoStart();
})(typeof window !== "undefined" ? window : globalThis);
