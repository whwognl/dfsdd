/* =====================================================================
 * copy-helpers.js — 배송지 조각 복사용 순수 함수
 *
 *   splitAddress(raw)  주소를 기본주소(팝업 검색어) / 상세주소 / 참고항목으로 분리
 *   phoneForms(phone)  내 번호를 하이픈 · 숫자만 · 3분할 로
 *   normZip(v)         우편번호 5자리 보정
 *   buildPayload(o, myPhone)  자동입력용 클립보드 JSON (v2). myPhone 이 비면 null
 *
 * 브라우저(window.CopyHelpers)와 node(require) 양쪽에서 씁니다. 개인정보를 저장하지 않습니다.
 * ===================================================================== */
(function (global) {
  "use strict";

  var ROAD = /^(.*?[가-힣A-Za-z0-9·.]+(?:대로|로|길)(?:\s?\d+(?:번|안|가)*길)?)\s*((?:지하\s*)?\d+(?:-\d+)?)(?![\d-])/;
  var JIBUN = /^(.*?[가-힣]+(?:읍|면|동|리|가)\s*(?:산\s*)?\d+(?:-\d+)?(?:번지)?)(?![\d-])/;
  var DETAIL_START = /(\d+동\s*\d+호|\d+호|\d+층|[가-힣A-Za-z0-9]+(?:아파트|APT|빌라|오피스텔|타워|빌딩)(?=\s|$))/;

  function normalize(raw) {
    return String(raw || "")
      .replace(/[（]/g, "(").replace(/[）]/g, ")")
      .replace(/[　 ]/g, " ")
      .replace(/[\r\n\t]+/g, " ")
      .replace(/\(\s+/g, "(").replace(/\s+\)/g, ")")
      .replace(/\s+/g, " ")
      .trim();
  }

  // 맨 끝의 "(동명, 건물명)" 참고항목 떼기
  function takeRef(s) {
    if (!s || s.charAt(s.length - 1) !== ")") return { body: s, ref: "" };
    var depth = 0;
    for (var i = s.length - 1; i >= 0; i--) {
      var ch = s.charAt(i);
      if (ch === ")") depth++;
      else if (ch === "(") { depth--; if (depth === 0) {
        return { body: s.slice(0, i).trim().replace(/[,\s]+$/, ""), ref: s.slice(i + 1, s.length - 1).trim() };
      } }
    }
    return { body: s, ref: "" };
  }
  function cleanDetail(d) { return String(d || "").replace(/^[\s,·]+/, "").trim(); }

  function splitAddress(raw) {
    var full = normalize(raw);
    var out = { base: full, detail: "", ref: "", full: full, method: "none", confidence: "low" };
    if (!full) return out;
    var t = takeRef(full);
    var body = t.body; out.ref = t.ref;

    var m = body.match(ROAD);
    if (m) {
      out.base = (m[1] + " " + m[2]).replace(/\s+/g, " ").trim();
      out.detail = cleanDetail(body.slice(m[0].length));
      out.method = "road"; out.confidence = "high";
    } else {
      var j = body.match(JIBUN);
      if (j) {
        out.base = j[1].trim();
        out.detail = cleanDetail(body.slice(j[0].length));
        out.method = "jibun"; out.confidence = "mid";
      } else {
        var g = body.match(DETAIL_START);
        if (g && g.index > 0) {
          out.base = body.slice(0, g.index).trim().replace(/[,\s]+$/, "");
          out.detail = cleanDetail(body.slice(g.index));
          out.method = "guess"; out.confidence = "low";
        } else {
          out.base = body; out.detail = "";
          return out;
        }
      }
    }
    // 검증: 상세에 도로명+번호가 또 나오면 분리 실패로 강등
    if (out.detail && ROAD.test(out.detail)) {
      out.base = body; out.detail = ""; out.method = "none"; out.confidence = "low";
      return out;
    }
    if (out.base.length < 6 || out.detail.length > 60) out.confidence = "low";
    return out;
  }

  // 자릿수로 확정: 11자리 010-1234-5678 · 12자리 0502-1234-5678(안심번호) · 10자리 031-123-4567 / 02-1234-5678 · 9자리 02-123-4567
  function phoneForms(phone) {
    var d = String(phone || "").replace(/\D/g, "");
    var parts;
    if (d.length === 11) parts = [d.slice(0, 3), d.slice(3, 7), d.slice(7)];
    else if (d.length === 12) parts = [d.slice(0, 4), d.slice(4, 8), d.slice(8)];
    else if (d.length === 10) parts = d.indexOf("02") === 0 ? [d.slice(0, 2), d.slice(2, 6), d.slice(6)] : [d.slice(0, 3), d.slice(3, 6), d.slice(6)];
    else if (d.length === 9) parts = [d.slice(0, 2), d.slice(2, 5), d.slice(5)];
    else parts = d ? [d] : [];
    return { digits: d, parts: parts, hyphen: parts.join("-"), plain: d, valid: d.length >= 9 && d.length <= 12 && d.charAt(0) === "0" };
  }

  function normZip(v) {
    var s = String(v == null ? "" : v).trim().replace(/\.0+$/, "");
    if (/^\d+(\.\d+)?[eE]\+?\d+$/.test(s)) s = String(Number(s));
    if (/^\d{4}$/.test(s)) return "0" + s;
    return s;
  }

  // 자동입력용 클립보드 JSON — 전화는 항상 '내 번호'. myPhone 이 비면 null 을 돌려주고 호출측은 중단해야 함
  function buildPayload(o, myPhone) {
    var pf = phoneForms(myPhone);
    if (!pf.valid) return null;
    var sp = splitAddress(o.address);
    return {
      __oh: 2,
      name: String(o.recipient || "").trim(),
      phone: pf.hyphen, phoneDigits: pf.plain, phoneParts: pf.parts,
      zip: normZip(o.zipcode),
      base: sp.base, detail: sp.detail, ref: sp.ref, addr: sp.full, split: sp.method,
      memo: String(o.deliveryMsg || "").replace(/\s+/g, " ").trim(),
      ts: Date.now()
    };
  }

  // 사람이 읽는 줄 단위 텍스트 (빈 줄은 제거)
  function shippingText(o, myPhone, opts) {
    opts = opts || {};
    var sp = splitAddress(o.address);
    var pf = phoneForms(myPhone);
    var lines = [
      ["받는분", String(o.recipient || "").trim()],
      ["연락처", pf.valid ? pf.hyphen : ""],
      ["우편번호", normZip(o.zipcode)],
      ["주소", opts.wholeAddress ? sp.full : sp.base],
      ["상세", opts.wholeAddress ? "" : sp.detail],
      ["요청사항", String(o.deliveryMsg || "").replace(/\s+/g, " ").trim()]
    ];
    return lines.filter(function (l) { return l[1]; }).map(function (l) { return l[0] + ": " + l[1]; }).join("\n");
  }

  var api = { splitAddress: splitAddress, phoneForms: phoneForms, normZip: normZip, buildPayload: buildPayload, shippingText: shippingText };
  global.CopyHelpers = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
