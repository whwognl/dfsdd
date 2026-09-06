/* =====================================================================
 * blacklist.js — 블랙리스트 판정 (이름 · 주소 · 연락처)
 *
 * 주문의 수령자명/배송지/연락처가 등록된 블랙리스트와 겹치면
 *   danger(위험) : 이름+주소 일치, 연락처 일치, 또는 주소 없이 등록된 이름과 정확일치
 *   warn(주의)   : 이름만 또는 주소만 일치
 * "경기도 용인시 기흥구" 처럼 행정구역만 겹치는 것은 일치로 보지 않습니다.
 * 마스킹 이름(김성*)은 한 글자 와일드카드로 보되, 주소까지 맞아야 경고합니다.
 *
 * 순수 함수만 있어 브라우저(window.Blacklist)와 node(require) 양쪽에서 씁니다.
 * ===================================================================== */
(function (global) {
  "use strict";

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
      if (t === token || t.indexOf(token) !== -1 || token.indexOf(t) !== -1) return true;
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
      if (b.indexOf("*") !== -1) { if (wildRe(b).test(a)) return true; }
      else if (a === b) return true;
    }
    return false;
  }

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
      var need = plain.length >= 3 ? plain.length - 1 : plain.length;   // 지명도 대부분 맞아야
      return plainHits >= need;
    }
    return plain.length >= 3 && plainHits === plain.length;   // 숫자 없는 등록은 토큰 3개 이상 전부
  }

  function digitsOf(v) { return String(v || "").replace(/[^0-9]/g, ""); }

  /* 주문 o = { recipient, buyerName, address, phone, phone2 }
   * list = [{ name, address, phone, memo, addedAt }]
   * 반환 { level: "danger"|"warn"|"", reasons: [..], hits: [{entry, level, why}] } */
  function check(o, list) {
    var out = { level: "", reasons: [], hits: [] };
    if (!o || !list || !list.length) return out;
    var name = o.recipient || o.buyerName || "";
    var addr = o.address || "";
    var phones = [digitsOf(o.phone), digitsOf(o.phone2)].filter(function (p) { return p.length >= 8; });
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      if (!b) continue;
      var nHit = b.name ? nameMatches(name, b.name) : false;
      var aHit = b.address ? addrMatches(addr, b.address) : false;
      var masked = String(b.name || "").indexOf("*") !== -1;
      if (nHit && masked && b.address && !aHit) nHit = false;   // 마스킹 이름은 주소까지 맞아야
      var pHit = false;
      var bp = digitsOf(b.phone);
      if (bp.length >= 8) {
        for (var p = 0; p < phones.length; p++) if (phones[p].slice(-8) === bp.slice(-8)) { pHit = true; break; }
      }
      if (!nHit && !aHit && !pHit) continue;
      var level = "warn";
      if ((nHit && aHit) || pHit) level = "danger";
      else if (nHit && !b.address && !masked) level = "danger";
      var why = [];
      if (nHit) why.push("수령자명 일치");
      if (aHit) why.push("배송지 일치");
      if (pHit) why.push("연락처 일치");
      out.hits.push({ entry: b, level: level, why: why.join(" · ") });
      out.reasons.push((b.name || "(이름없음)") + " — " + why.join(" · "));
      if (level === "danger") out.level = "danger";
      else if (!out.level) out.level = "warn";
    }
    return out;
  }

  /* 워크북 '블랙리스트' 시트(2차원 배열) → 목록. A=이름 B=주소 C=연락처 D=사유 E=등록일. 헤더 행은 있어도 없어도 됨 */
  function fromMatrix(rows) {
    var out = [], seen = {};
    (rows || []).forEach(function (r, i) {
      if (!r) return;
      var name = String(r[0] == null ? "" : r[0]).trim();
      var addr = String(r[1] == null ? "" : r[1]).trim();
      if (i === 0 && /^(이름|성명|수령자|name)$/i.test(name)) return;
      if (!name && !addr) return;
      var key = normName(name) + "|" + normAddr(addr);
      if (seen[key]) return;
      seen[key] = 1;
      out.push({
        name: name, address: addr,
        phone: String(r[2] == null ? "" : r[2]).trim(),
        memo: String(r[3] == null ? "" : r[3]).trim(),
        addedAt: String(r[4] == null ? "" : r[4]).trim()
      });
    });
    return out;
  }

  /* 붙여넣기 텍스트(탭/쉼표 구분, 한 줄에 한 명) → 목록 */
  function parseText(text) {
    var lines = String(text || "").replace(/\r/g, "").split("\n");
    var rows = lines.map(function (l) {
      var delim = l.indexOf("\t") !== -1 ? "\t" : ",";
      return l.split(delim).map(function (c) { return c.trim(); });
    });
    return fromMatrix(rows);
  }

  /* 기존 목록에 새 항목 합치기(이름+주소 같으면 건너뜀). 반환: 추가된 개수 */
  function merge(cur, incoming, addedAt) {
    var seen = {};
    cur.forEach(function (b) { seen[normName(b.name) + "|" + normAddr(b.address)] = 1; });
    var n = 0;
    (incoming || []).forEach(function (b) {
      var k = normName(b.name) + "|" + normAddr(b.address);
      if (!b.name && !b.address) return;
      if (seen[k]) return;
      seen[k] = 1;
      if (!b.addedAt && addedAt) b.addedAt = addedAt;
      cur.push(b);
      n++;
    });
    return n;
  }

  var api = { check: check, nameMatches: nameMatches, addrMatches: addrMatches, fromMatrix: fromMatrix, parseText: parseText, merge: merge };
  global.Blacklist = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
