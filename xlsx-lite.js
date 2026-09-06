/* =====================================================================
 * xlsx-lite.js — 의존성 없는 엑셀(.xlsx) 읽기/쓰기 엔진
 *
 * SheetJS 같은 외부 라이브러리 없이 브라우저 표준만으로 동작합니다.
 *   읽기 : ZIP 파싱 + DecompressionStream('deflate-raw')
 *   쓰기 : ZIP(무압축 저장) + 서식/수식/드롭다운/조건부서식/틀고정까지 지원
 *   날짜 : numFmt 감지 → 'YYYY-MM-DD HH:mm' 문자열로 변환
 *
 * 외부 네트워크 호출 0건. 모든 처리는 브라우저(또는 node) 안에서 끝납니다.
 * 브라우저와 node 양쪽에서 쓰입니다(node에서는 엑셀 양식 파일 생성에 사용).
 * ===================================================================== */
(function (global) {
  "use strict";

  var td = new TextDecoder("utf-8");
  var te = new TextEncoder();

  function u16(dv, p) { return dv.getUint16(p, true); }
  function u32(dv, p) { return dv.getUint32(p, true); }

  var CTRL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;

  function unescapeXml(s) {
    if (s.indexOf("&") === -1) return s;
    return s.replace(/&(#x?[0-9A-Fa-f]+|amp|lt|gt|quot|apos);/g, function (m, g) {
      if (g === "amp") return "&";
      if (g === "lt") return "<";
      if (g === "gt") return ">";
      if (g === "quot") return '"';
      if (g === "apos") return "'";
      if (g.charAt(0) === "#") {
        var code = g.charAt(1) === "x" ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10);
        return isNaN(code) ? m : String.fromCodePoint(code);
      }
      return m;
    });
  }
  function escapeXml(s) {
    return String(s).replace(CTRL, "").replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c];
    });
  }

  function colIndex(ref) {
    var n = 0;
    for (var i = 0; i < ref.length; i++) {
      var c = ref.charCodeAt(i);
      if (c < 65 || c > 90) break;
      n = n * 26 + (c - 64);
    }
    return n - 1;
  }
  function colName(idx) {
    var s = "", n = idx + 1;
    while (n > 0) { var r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
    return s;
  }

  /* ---------------- 엑셀 날짜 직렬값 ---------------- */
  function serialToDate(serial) {
    var days = Math.floor(serial);
    var ms = Math.round((serial - days) * 86400 * 1000);
    return new Date(Date.UTC(1899, 11, 30) + days * 86400000 + ms);
  }
  function pad(n) { return n < 10 ? "0" + n : String(n); }
  function serialToString(serial, withTime) {
    if (!isFinite(serial) || serial <= 0) return "";
    var d = serialToDate(serial);
    var s = d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate());
    if (withTime) {
      var h = d.getUTCHours(), mi = d.getUTCMinutes();
      if (h || mi) s += " " + pad(h) + ":" + pad(mi);
    }
    return s;
  }
  function dateToSerial(d) {
    if (!(d instanceof Date) || isNaN(d.getTime())) return null;
    var utc = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds());
    return (utc - Date.UTC(1899, 11, 30)) / 86400000;
  }

  /* ---------------- ZIP 읽기 ---------------- */
  function findEocd(dv, len) {
    var max = Math.min(len, 66000);
    for (var i = len - 22; i >= len - max && i >= 0; i--) if (u32(dv, i) === 0x06054b50) return i;
    return -1;
  }
  function inflateRaw(bytes) {
    if (typeof DecompressionStream === "undefined") {
      return Promise.reject(new Error("이 브라우저는 압축 해제를 지원하지 않습니다 (Chrome 또는 Safari 최신 버전을 사용하세요)"));
    }
    var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Response(stream).arrayBuffer().then(function (buf) { return new Uint8Array(buf); });
  }

  function unzip(arrayBuffer, wanted) {
    var bytes = new Uint8Array(arrayBuffer);
    var dv = new DataView(arrayBuffer);
    var eocd = findEocd(dv, bytes.length);
    if (eocd < 0) throw new Error("엑셀 파일 형식이 아닙니다 (ZIP 헤더를 찾지 못했습니다)");
    var count = u16(dv, eocd + 10);
    var cdOffset = u32(dv, eocd + 16);
    if (cdOffset === 0xffffffff || count === 0xffff) {
      for (var z = eocd - 20; z >= 0; z--) {
        if (u32(dv, z) === 0x07064b50) {
          var z64 = u32(dv, z + 8);
          if (u32(dv, z64) === 0x06064b50) {
            count = Number(dv.getBigUint64(z64 + 32, true));
            cdOffset = Number(dv.getBigUint64(z64 + 48, true));
          }
          break;
        }
      }
    }
    var entries = [], p = cdOffset;
    for (var i = 0; i < count && p + 46 <= bytes.length; i++) {
      if (u32(dv, p) !== 0x02014b50) break;
      var method = u16(dv, p + 10);
      var csize = u32(dv, p + 20), usize = u32(dv, p + 24);
      var nameLen = u16(dv, p + 28), extraLen = u16(dv, p + 30), cmtLen = u16(dv, p + 32);
      var lho = u32(dv, p + 42);
      var name = td.decode(bytes.subarray(p + 46, p + 46 + nameLen));
      if (csize === 0xffffffff || usize === 0xffffffff || lho === 0xffffffff) {
        var ep = p + 46 + nameLen, eEnd = ep + extraLen;
        while (ep + 4 <= eEnd) {
          var hid = u16(dv, ep), hsz = u16(dv, ep + 2), q = ep + 4;
          if (hid === 0x0001) {
            if (usize === 0xffffffff) { usize = Number(dv.getBigUint64(q, true)); q += 8; }
            if (csize === 0xffffffff) { csize = Number(dv.getBigUint64(q, true)); q += 8; }
            if (lho === 0xffffffff) { lho = Number(dv.getBigUint64(q, true)); q += 8; }
          }
          ep += 4 + hsz;
        }
      }
      entries.push({ name: name, method: method, csize: csize, lho: lho });
      p += 46 + nameLen + extraLen + cmtLen;
    }

    var out = {};
    var jobs = entries.filter(function (e) { return !wanted || wanted(e.name); }).map(function (e) {
      var lnameLen = u16(dv, e.lho + 26), lextraLen = u16(dv, e.lho + 28);
      var start = e.lho + 30 + lnameLen + lextraLen;
      var raw = bytes.subarray(start, start + e.csize);
      if (e.method === 0) { out[e.name] = raw; return Promise.resolve(); }
      if (e.method !== 8) return Promise.reject(new Error("지원하지 않는 압축 방식입니다: " + e.name));
      return inflateRaw(raw).then(function (u) { out[e.name] = u; });
    });
    return Promise.all(jobs).then(function () { return out; });
  }

  /* ---------------- xlsx 파싱 ---------------- */
  function textOf(u8) { return u8 ? td.decode(u8) : ""; }

  function parseSharedStrings(xml) {
    var out = [];
    if (!xml) return out;
    var re = /<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g, m;
    var tre = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
    while ((m = re.exec(xml))) {
      var inner = m[1] || "", s = "", t;
      tre.lastIndex = 0;
      while ((t = tre.exec(inner))) s += unescapeXml(t[1] || "");
      out.push(s);
    }
    return out;
  }

  function parseDateStyles(xml) {
    var isDate = [];
    if (!xml) return isDate;
    var custom = {}, m;
    var nfRe = /<numFmt\b[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g;
    while ((m = nfRe.exec(xml))) custom[m[1]] = unescapeXml(m[2]);
    var block = xml.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/);
    if (!block) return isDate;
    var xfRe = /<xf\b[^>]*>/g, x;
    while ((x = xfRe.exec(block[1]))) {
      var idm = x[0].match(/numFmtId="(\d+)"/);
      var id = idm ? parseInt(idm[1], 10) : 0;
      var d = (id >= 14 && id <= 22) || (id >= 45 && id <= 47);
      if (!d && custom[id]) {
        var code = custom[id].replace(/\[[^\]]*\]/g, "").replace(/"[^"]*"/g, "");
        d = /[ymdhs]/i.test(code) && !/^[#0.,%\s-]*$/.test(code);
      }
      isDate.push(d);
    }
    return isDate;
  }

  function parseSheet(xml, sst, dateStyles) {
    var rows = [];
    var rowRe = /<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g, rm;
    var cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    while ((rm = rowRe.exec(xml))) {
      var attrs = rm[1] || "", inner = rm[2] || "";
      var rIdx = attrs.match(/\br="(\d+)"/);
      var rowNum = rIdx ? parseInt(rIdx[1], 10) - 1 : rows.length;
      var cells = [], cm;
      cellRe.lastIndex = 0;
      while ((cm = cellRe.exec(inner))) {
        var cAttr = cm[1] || "", cInner = cm[2] || "";
        var refM = cAttr.match(/\br="([A-Z]+)\d+"/);
        var ci = refM ? colIndex(refM[1]) : cells.length;
        var tM = cAttr.match(/\bt="([^"]+)"/);
        var t = tM ? tM[1] : "n";
        var sM = cAttr.match(/\bs="(\d+)"/);
        var style = sM ? parseInt(sM[1], 10) : -1;
        var val = "";
        if (t === "inlineStr") {
          var s2 = "", tre2 = /<t\b[^>]*>([\s\S]*?)<\/t>/g, tt;
          while ((tt = tre2.exec(cInner))) s2 += unescapeXml(tt[1] || "");
          val = s2;
        } else {
          var vM = cInner.match(/<v\b[^>]*>([\s\S]*?)<\/v>/);
          var raw = vM ? unescapeXml(vM[1]) : "";
          if (raw === "") val = "";
          else if (t === "s") val = sst[parseInt(raw, 10)] || "";
          else if (t === "str" || t === "e") val = raw;
          else if (t === "b") val = raw === "1" ? "TRUE" : "FALSE";
          else {
            var num = parseFloat(raw);
            if (isNaN(num)) val = raw;
            else if (style >= 0 && dateStyles[style]) val = serialToString(num, true);
            else val = num;
          }
        }
        cells[ci] = val;
      }
      for (var k = 0; k < cells.length; k++) if (cells[k] === undefined) cells[k] = "";
      rows[rowNum] = cells;
    }
    for (var r = 0; r < rows.length; r++) if (!rows[r]) rows[r] = [];
    return rows;
  }

  function attrOf(tag, name) {
    var m = tag.match(new RegExp("\\b" + name.replace(":", "\\:") + '="([^"]*)"'));
    return m ? unescapeXml(m[1]) : "";
  }

  function read(arrayBuffer) {
    return unzip(arrayBuffer, function (name) {
      return /^xl\/(workbook\.xml|sharedStrings\.xml|styles\.xml|_rels\/workbook\.xml\.rels|worksheets\/[^/]+\.xml)$/.test(name);
    }).then(function (files) {
      var wbXml = textOf(files["xl/workbook.xml"]);
      if (!wbXml) throw new Error("엑셀 워크북 정보를 찾지 못했습니다");
      var relsXml = textOf(files["xl/_rels/workbook.xml.rels"]);
      var rels = {}, relRe = /<Relationship\b[^>]*>/g, rm2;
      while ((rm2 = relRe.exec(relsXml))) {
        var id = attrOf(rm2[0], "Id"), target = attrOf(rm2[0], "Target");
        if (target.charAt(0) === "/") target = target.slice(1);
        else if (target.indexOf("xl/") !== 0) target = "xl/" + target.replace(/^\.\//, "");
        rels[id] = target;
      }
      var sst = parseSharedStrings(textOf(files["xl/sharedStrings.xml"]));
      var dateStyles = parseDateStyles(textOf(files["xl/styles.xml"]));

      var names = [], paths = {}, shRe = /<sheet\b[^>]*\/?>/g, sm, i = 0;
      while ((sm = shRe.exec(wbXml))) {
        var nm = attrOf(sm[0], "name");
        if (!nm) continue;
        var rid = attrOf(sm[0], "r:id") || attrOf(sm[0], "id");
        paths[nm] = rels[rid] || ("xl/worksheets/sheet" + (i + 1) + ".xml");
        names.push(nm); i++;
      }

      var cache = {};
      function sheet(n) {
        if (cache[n]) return cache[n];
        var p = paths[n];
        if (!p || !files[p]) return null;
        cache[n] = parseSheet(textOf(files[p]), sst, dateStyles);
        return cache[n];
      }
      function key(s) { return String(s).replace(/\s+/g, "").toLowerCase(); }
      return {
        names: names,
        sheet: sheet,
        has: function (n) { return paths[n] !== undefined; },
        pick: function (candidates) {
          var a, b;
          for (a = 0; a < candidates.length; a++) {
            for (b = 0; b < names.length; b++) if (key(names[b]) === key(candidates[a])) return sheet(names[b]);
          }
          for (a = 0; a < candidates.length; a++) {
            for (b = 0; b < names.length; b++) if (key(names[b]).indexOf(key(candidates[a])) !== -1) return sheet(names[b]);
          }
          return null;
        },
        pickName: function (candidates) {
          var a, b;
          for (a = 0; a < candidates.length; a++) {
            for (b = 0; b < names.length; b++) if (key(names[b]) === key(candidates[a])) return names[b];
          }
          for (a = 0; a < candidates.length; a++) {
            for (b = 0; b < names.length; b++) if (key(names[b]).indexOf(key(candidates[a])) !== -1) return names[b];
          }
          return "";
        }
      };
    });
  }

  /* ---------------- ZIP 쓰기(무압축) ---------------- */
  var crcTable = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    var c = 0xffffffff;
    for (var i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  function dosTime(d) { return ((d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2)) & 0xffff; }
  function dosDate(d) { return (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff; }

  function zipBytes(files) {
    var now = new Date(), parts = [], central = [], offset = 0, total = 0;
    files.forEach(function (f) {
      var nameBytes = te.encode(f.name), data = f.data, crc = crc32(data);
      var lh = new Uint8Array(30 + nameBytes.length), dv = new DataView(lh.buffer);
      dv.setUint32(0, 0x04034b50, true);
      dv.setUint16(4, 20, true);
      dv.setUint16(6, 0x0800, true);   // UTF-8 파일명 플래그
      dv.setUint16(8, 0, true);
      dv.setUint16(10, dosTime(now), true); dv.setUint16(12, dosDate(now), true);
      dv.setUint32(14, crc, true); dv.setUint32(18, data.length, true); dv.setUint32(22, data.length, true);
      dv.setUint16(26, nameBytes.length, true); dv.setUint16(28, 0, true);
      lh.set(nameBytes, 30);
      parts.push(lh, data);

      var ch = new Uint8Array(46 + nameBytes.length), cdv = new DataView(ch.buffer);
      cdv.setUint32(0, 0x02014b50, true);
      cdv.setUint16(4, 20, true); cdv.setUint16(6, 20, true);
      cdv.setUint16(8, 0x0800, true); cdv.setUint16(10, 0, true);
      cdv.setUint16(12, dosTime(now), true); cdv.setUint16(14, dosDate(now), true);
      cdv.setUint32(16, crc, true); cdv.setUint32(20, data.length, true); cdv.setUint32(24, data.length, true);
      cdv.setUint16(28, nameBytes.length, true);
      cdv.setUint32(42, offset, true);
      ch.set(nameBytes, 46);
      central.push(ch);
      offset += lh.length + data.length;
    });
    var cdSize = 0;
    central.forEach(function (c) { cdSize += c.length; });
    var eocd = new Uint8Array(22), edv = new DataView(eocd.buffer);
    edv.setUint32(0, 0x06054b50, true);
    edv.setUint16(8, files.length, true); edv.setUint16(10, files.length, true);
    edv.setUint32(12, cdSize, true); edv.setUint32(16, offset, true);

    var all = parts.concat(central, [eocd]);
    all.forEach(function (p) { total += p.length; });
    var out = new Uint8Array(total), pos = 0;
    all.forEach(function (p) { out.set(p, pos); pos += p.length; });
    return out;
  }

  /* ---------------- 스타일 팔레트 ----------------
   * 셀에서 s:"money" 처럼 이름으로 지정합니다.
   * 색과 굵기는 앱 디자인과 같은 톤(과한 볼드 금지)으로 맞췄습니다.
   * ------------------------------------------------ */
  var NUMFMT = {
    int:    { id: 170, code: "#,##0" },
    money:  { id: 171, code: '#,##0"원"' },
    money0: { id: 172, code: "#,##0;[Red]-#,##0" },
    pct:    { id: 173, code: "0.0%" },
    pct2:   { id: 174, code: "0.00%" },
    date:   { id: 175, code: "yyyy-mm-dd" },
    datetime: { id: 176, code: "yyyy-mm-dd hh:mm" }
  };
  // [numFmt키, fontIdx, fillIdx, 정렬, 줄바꿈]
  var STYLES = [
    ["", 0, 0, "", false],            // 0 base
    ["", 1, 2, "center", false],      // 1 header
    ["int", 0, 0, "", false],         // 2 int
    ["money", 0, 0, "", false],       // 3 money
    ["pct", 0, 0, "", false],         // 4 pct
    ["date", 0, 0, "center", false],  // 5 date
    ["datetime", 0, 0, "center", false], // 6 datetime
    ["", 2, 0, "left", false],        // 7 title
    ["", 3, 0, "left", true],         // 8 note (작은 회색, 줄바꿈)
    ["", 0, 3, "center", false],      // 9 input (연한 파랑 = 직접입력)
    ["", 4, 4, "center", false],      // 10 danger
    ["", 5, 5, "center", false],      // 11 ok
    ["", 0, 0, "center", false],      // 12 center
    ["money0", 0, 0, "", false],      // 13 money0
    ["pct2", 0, 0, "", false],        // 14 pct2
    ["", 1, 6, "center", false],      // 15 subhead
    ["", 0, 0, "left", true],         // 16 wrap
    ["int", 0, 3, "", false],         // 17 int input
    ["money", 0, 3, "", false]        // 18 money input
  ];
  var STYLE_INDEX = {
    base: 0, header: 1, int: 2, money: 3, pct: 4, date: 5, datetime: 6, title: 7,
    note: 8, input: 9, danger: 10, ok: 11, center: 12, money0: 13, pct2: 14,
    subhead: 15, wrap: 16, intInput: 17, moneyInput: 18
  };

  function stylesXml() {
    var fmts = Object.keys(NUMFMT).map(function (k) {
      return '<numFmt numFmtId="' + NUMFMT[k].id + '" formatCode="' + escapeXml(NUMFMT[k].code) + '"/>';
    }).join("");
    var fonts =
      '<font><sz val="10"/><color rgb="FF1D1D1F"/><name val="맑은 고딕"/></font>' +                   // 0
      '<font><b/><sz val="10"/><color rgb="FF1D1D1F"/><name val="맑은 고딕"/></font>' +                // 1
      '<font><b/><sz val="14"/><color rgb="FF1D1D1F"/><name val="맑은 고딕"/></font>' +                // 2
      '<font><sz val="9"/><color rgb="FF6E6E73"/><name val="맑은 고딕"/></font>' +                     // 3
      '<font><b/><sz val="10"/><color rgb="FFB3000F"/><name val="맑은 고딕"/></font>' +                // 4
      '<font><sz val="10"/><color rgb="FF1B6B32"/><name val="맑은 고딕"/></font>';                     // 5
    var fills =
      '<fill><patternFill patternType="none"/></fill>' +
      '<fill><patternFill patternType="gray125"/></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FFEFEFF4"/><bgColor indexed="64"/></patternFill></fill>' +   // 2 header
      '<fill><patternFill patternType="solid"><fgColor rgb="FFF0F7FF"/><bgColor indexed="64"/></patternFill></fill>' +   // 3 input
      '<fill><patternFill patternType="solid"><fgColor rgb="FFFFE9EC"/><bgColor indexed="64"/></patternFill></fill>' +   // 4 danger
      '<fill><patternFill patternType="solid"><fgColor rgb="FFE8F7ED"/><bgColor indexed="64"/></patternFill></fill>' +   // 5 ok
      '<fill><patternFill patternType="solid"><fgColor rgb="FFF7F7FA"/><bgColor indexed="64"/></patternFill></fill>';    // 6 subhead
    var xfs = STYLES.map(function (s) {
      var nf = s[0] ? NUMFMT[s[0]].id : 0;
      var align = "";
      if (s[3] || s[4]) {
        align = '<alignment' + (s[3] ? ' horizontal="' + s[3] + '"' : "") + ' vertical="center"' + (s[4] ? ' wrapText="1"' : "") + "/>";
      } else {
        align = '<alignment vertical="center"/>';
      }
      return '<xf numFmtId="' + nf + '" fontId="' + s[1] + '" fillId="' + s[2] + '" borderId="1" xfId="0"' +
        (nf ? ' applyNumberFormat="1"' : "") + ' applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">' + align + "</xf>";
    }).join("");
    // 조건부서식용 dxf: 0=위험(빨강), 1=주의(노랑), 2=완료(초록), 3=회색(역마진/품절)
    var dxfs =
      '<dxf><font><color rgb="FFB3000F"/><b/></font><fill><patternFill><bgColor rgb="FFFFDDE2"/></patternFill></fill></dxf>' +
      '<dxf><font><color rgb="FF8A5A00"/></font><fill><patternFill><bgColor rgb="FFFFF3D6"/></patternFill></fill></dxf>' +
      '<dxf><font><color rgb="FF1B6B32"/></font><fill><patternFill><bgColor rgb="FFE4F6EA"/></patternFill></fill></dxf>' +
      '<dxf><font><color rgb="FF9A9AA0"/><strike/></font></dxf>';
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<numFmts count="' + Object.keys(NUMFMT).length + '">' + fmts + "</numFmts>" +
      '<fonts count="6">' + fonts + "</fonts>" +
      '<fills count="7">' + fills + "</fills>" +
      '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>' +
      '<border><left style="thin"><color rgb="FFE3E3E8"/></left><right style="thin"><color rgb="FFE3E3E8"/></right>' +
      '<top style="thin"><color rgb="FFE3E3E8"/></top><bottom style="thin"><color rgb="FFE3E3E8"/></bottom><diagonal/></border></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="' + STYLES.length + '">' + xfs + "</cellXfs>" +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
      '<dxfs count="4">' + dxfs + "</dxfs></styleSheet>";
  }

  /* ---------------- 시트 XML 생성 ----------------
   * sheet = {
   *   name, rows:[[cell,...]],
   *   cols:[{w:12},...], freeze:{row,col}, autoFilter:"A3:BA9999",
   *   validations:[{sqref, values:[..]} | {sqref, formula:"목록명"}],
   *   condFormats:[{sqref, rules:[{formula, dxf, priority}]}],
   *   merges:["A1:D1"], rowHeights:{1:24}, headerRow:1
   * }
   * cell = 문자열 | 숫자 | {v, s:"스타일명", f:"수식(=제외)", t:"n"|"s"}
   * ------------------------------------------------ */
  function sheetXml(s) {
    var rows = s.rows || [];
    var views = '<sheetViews><sheetView workbookViewId="0"' + (s.tabSelected ? ' tabSelected="1"' : "") + '>';
    if (s.freeze && (s.freeze.row || s.freeze.col)) {
      var xSplit = s.freeze.col || 0, ySplit = s.freeze.row || 0;
      var topLeft = colName(xSplit) + (ySplit + 1);
      views += '<pane xSplit="' + xSplit + '" ySplit="' + ySplit + '" topLeftCell="' + topLeft + '" activePane="bottomRight" state="frozen"/>';
    }
    views += "</sheetView></sheetViews>";

    var cols = "";
    if (s.cols && s.cols.length) {
      cols = "<cols>" + s.cols.map(function (c, i) {
        if (!c) return "";
        return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + (c.w || 12) + '" customWidth="1"' +
          (c.hidden ? ' hidden="1"' : "") + "/>";
      }).join("") + "</cols>";
    }

    var body = rows.map(function (row, ri) {
      var cells = (row || []).map(function (v, ci) {
        if (v === null || v === undefined || v === "") return "";
        var ref = colName(ci) + (ri + 1);
        var style = 0, val = v, formula = "";
        if (typeof v === "object") {
          style = STYLE_INDEX[v.s] !== undefined ? STYLE_INDEX[v.s] : 0;
          formula = v.f || "";
          val = v.v;
        }
        var sAttr = style ? ' s="' + style + '"' : "";
        if (formula) {
          return '<c r="' + ref + '"' + sAttr + "><f>" + escapeXml(formula) + "</f></c>";
        }
        if (val === null || val === undefined || val === "") return '<c r="' + ref + '"' + sAttr + "/>";
        if (typeof val === "number" && isFinite(val)) return '<c r="' + ref + '"' + sAttr + "><v>" + val + "</v></c>";
        return '<c r="' + ref + '" t="inlineStr"' + sAttr + '><is><t xml:space="preserve">' + escapeXml(val) + "</t></is></c>";
      }).join("");
      var h = s.rowHeights && s.rowHeights[ri + 1];
      return '<row r="' + (ri + 1) + '"' + (h ? ' ht="' + h + '" customHeight="1"' : "") + ">" + cells + "</row>";
    }).join("");

    var merges = "";
    if (s.merges && s.merges.length) {
      merges = '<mergeCells count="' + s.merges.length + '">' +
        s.merges.map(function (r) { return '<mergeCell ref="' + r + '"/>'; }).join("") + "</mergeCells>";
    }
    var af = s.autoFilter ? '<autoFilter ref="' + s.autoFilter + '"/>' : "";

    var cf = "";
    (s.condFormats || []).forEach(function (c, idx) {
      cf += '<conditionalFormatting sqref="' + c.sqref + '">' + (c.rules || []).map(function (r, ri2) {
        return '<cfRule type="expression" dxfId="' + (r.dxf || 0) + '" priority="' + (r.priority || (idx * 10 + ri2 + 1)) +
          '"><formula>' + escapeXml(r.formula) + "</formula></cfRule>";
      }).join("") + "</conditionalFormatting>";
    });

    var dv = "";
    if (s.validations && s.validations.length) {
      dv = '<dataValidations count="' + s.validations.length + '">' + s.validations.map(function (v) {
        var f1 = v.formula ? v.formula : '"' + (v.values || []).join(",") + '"';
        return '<dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="0" sqref="' + v.sqref + '">' +
          "<formula1>" + escapeXml(f1) + "</formula1></dataValidation>";
      }).join("") + "</dataValidations>";
    }

    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      views + '<sheetFormatPr defaultRowHeight="17"/>' + cols +
      "<sheetData>" + body + "</sheetData>" +
      af + merges + cf + dv + "</worksheet>";
  }

  function buildBytes(sheets, definedNames) {
    sheets = (sheets || []).filter(Boolean);
    if (!sheets.length) sheets = [{ name: "Sheet1", rows: [] }];
    var files = [];
    function add(name, text) { files.push({ name: name, data: te.encode(text) }); }

    add("[Content_Types].xml",
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      sheets.map(function (s, i) {
        return '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
      }).join("") + "</Types>");

    add("_rels/.rels",
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      "</Relationships>");

    var dn = "";
    if (definedNames && Object.keys(definedNames).length) {
      dn = "<definedNames>" + Object.keys(definedNames).map(function (k) {
        return '<definedName name="' + escapeXml(k) + '">' + escapeXml(definedNames[k]) + "</definedName>";
      }).join("") + "</definedNames>";
    }
    add("xl/workbook.xml",
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
      sheets.map(function (s, i) {
        var nm = String(s.name || "Sheet" + (i + 1)).replace(/[\\/?*\[\]:]/g, " ").slice(0, 31);
        return '<sheet name="' + escapeXml(nm) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>';
      }).join("") + "</sheets>" + dn + "<calcPr fullCalcOnLoad=\"1\"/></workbook>");

    add("xl/_rels/workbook.xml.rels",
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      sheets.map(function (s, i) {
        return '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>';
      }).join("") +
      '<Relationship Id="rId' + (sheets.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      "</Relationships>");

    add("xl/styles.xml", stylesXml());
    sheets.forEach(function (s, i) { add("xl/worksheets/sheet" + (i + 1) + ".xml", sheetXml(s)); });
    return zipBytes(files);
  }

  function write(sheets, definedNames) {
    var bytes = buildBytes(sheets, definedNames);
    return new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  }

  var api = {
    read: read,
    write: write,
    buildBytes: buildBytes,
    serialToString: serialToString,
    dateToSerial: dateToSerial,
    colName: colName,
    colIndex: colIndex,
    STYLE_INDEX: STYLE_INDEX
  };

  global.XlsxLite = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
