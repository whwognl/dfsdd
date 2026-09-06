/* =====================================================================
 * biff.js — 의존성 없는 구형 엑셀(.xls, BIFF8) 읽기/쓰기 엔진
 *
 * SheetJS 같은 외부 라이브러리 없이 브라우저 표준(DataView/TextDecoder)만으로
 * 동작합니다. xlsx-lite.js(.xlsx)와 같은 모양의 API 를 제공해서
 * xlsx-compat.js 가 두 엔진을 같은 방식으로 다룰 수 있습니다.
 *
 *   읽기 : CFB(Compound File Binary) 컨테이너 → 'Workbook'/'Book' 스트림
 *          → BIFF8 레코드(BOF/BOUNDSHEET/SST/LABELSST/LABEL/NUMBER/RK/MULRK/
 *            BOOLERR/FORMULA+STRING/XF/FORMAT/CONTINUE …)
 *          → 시트별 2차원 배열(문자열/숫자). 날짜 서식 셀은
 *            'YYYY-MM-DD HH:mm' 문자열(xlsx-lite 와 같은 규칙, 1900 체계)
 *   쓰기 : 최소 BIFF8 구조(BOF·CODEPAGE·WINDOW1·FONT·FORMAT·XF·STYLE·
 *          BOUNDSHEET·[SST]·EOF + 시트마다 BOF·DIMENSIONS·ROW·LABEL/NUMBER·
 *          WINDOW2·EOF) 를 CFB 컨테이너에 담아 Uint8Array/Blob 으로 돌려줌
 *
 * 외부 네트워크 호출 0건. 브라우저(window.BiffXls)와 node(module.exports)
 * 양쪽에서 씁니다. BIFF5(엑셀 95)는 최선을 다해 읽기만 시도합니다.
 * ===================================================================== */
(function (global) {
  "use strict";

  /* ---------------- 공통 유틸 ---------------- */
  var utf16 = new TextDecoder("utf-16le");

  function toBytes(data) {
    if (data instanceof Uint8Array) return data;
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (data && data.buffer instanceof ArrayBuffer) return new Uint8Array(data.buffer, data.byteOffset || 0, data.byteLength);
    throw new Error("읽을 수 있는 바이트 데이터가 아닙니다");
  }
  function dvOf(bytes) { return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); }

  function isCfb(data) {
    var b;
    try { b = toBytes(data); } catch (e) { return false; }
    return b.length > 8 && b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0 &&
      b[4] === 0xa1 && b[5] === 0xb1 && b[6] === 0x1a && b[7] === 0xe1;
  }

  /* ---------------- 엑셀 날짜 직렬값 (xlsx-lite 와 동일 규칙) ---------------- */
  function pad(n) { return n < 10 ? "0" + n : String(n); }
  function serialToDate(serial) {
    var days = Math.floor(serial);
    var ms = Math.round((serial - days) * 86400 * 1000);
    return new Date(Date.UTC(1899, 11, 30) + days * 86400000 + ms);
  }
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

  /* 날짜 서식 판정: 내장 14~22, 27~36(동아시아 로캘 날짜), 45~47 + 사용자 서식에 y/m/d/h/s */
  function isDateFormat(ifmt, formats) {
    if ((ifmt >= 14 && ifmt <= 22) || (ifmt >= 27 && ifmt <= 36) || (ifmt >= 45 && ifmt <= 47)) return true;
    var code = formats[ifmt];
    if (!code) return false;
    code = code.replace(/\[[^\]]*\]/g, "").replace(/"[^"]*"/g, "").replace(/\\./g, "");
    return /[ymdhs]/i.test(code) && !/^[#0.,%\s-]*$/.test(code) && !/^general$/i.test(code);
  }

  /* =====================================================================
   * 1. CFB(Compound File Binary) 읽기
   * ===================================================================== */
  var ENDOFCHAIN = 0xfffffffe, FREESECT = 0xffffffff, FATSECT = 0xfffffffd, DIFSECT = 0xfffffffc;

  function cfbOpen(bytes) {
    var dv = dvOf(bytes);
    if (!isCfb(bytes)) throw new Error("구형 엑셀(.xls) 파일 형식이 아닙니다");
    var sectorShift = dv.getUint16(30, true), miniShift = dv.getUint16(32, true);
    var ss = 1 << sectorShift, ms = 1 << miniShift;
    if (ss < 128 || ss > 65536) throw new Error("손상된 .xls 파일입니다 (섹터 크기)");
    var numFat = dv.getUint32(44, true);
    var dirStart = dv.getUint32(48, true);
    var miniCutoff = dv.getUint32(56, true) || 4096;
    var miniFatStart = dv.getUint32(60, true);
    var difatStart = dv.getUint32(68, true);
    var numDifat = dv.getUint32(72, true);
    var perSector = ss / 4;

    function sectorOffset(idx) { return (idx + 1) * ss; }
    function sectorBytes(idx) {
      var off = sectorOffset(idx);
      if (off >= bytes.length) return new Uint8Array(ss);           // 잘린 파일: 0으로 채움
      return bytes.subarray(off, Math.min(off + ss, bytes.length));
    }

    /* DIFAT → FAT 섹터 목록 */
    var fatSectors = [], i;
    for (i = 0; i < 109 && fatSectors.length < numFat; i++) {
      var s = dv.getUint32(76 + i * 4, true);
      if (s === FREESECT || s === ENDOFCHAIN) break;
      fatSectors.push(s);
    }
    var dsec = difatStart, guard = 0;
    while (dsec !== ENDOFCHAIN && dsec !== FREESECT && guard++ < numDifat + 1) {
      var off = sectorOffset(dsec);
      if (off + ss > bytes.length) break;
      for (i = 0; i < perSector - 1 && fatSectors.length < numFat; i++) {
        var s2 = dv.getUint32(off + i * 4, true);
        if (s2 === FREESECT || s2 === ENDOFCHAIN) break;
        fatSectors.push(s2);
      }
      dsec = dv.getUint32(off + (perSector - 1) * 4, true);
    }

    /* FAT 전체를 하나의 배열로 */
    var fat = new Uint32Array(fatSectors.length * perSector);
    for (i = 0; i < fatSectors.length; i++) {
      var fo = sectorOffset(fatSectors[i]);
      for (var k = 0; k < perSector; k++) {
        fat[i * perSector + k] = fo + k * 4 + 4 <= bytes.length ? dv.getUint32(fo + k * 4, true) : FREESECT;
      }
    }

    function chain(start, table) {
      var out = [], cur = start, seen = 0;
      while (cur !== ENDOFCHAIN && cur !== FREESECT && cur < table.length && seen++ < table.length + 1) {
        out.push(cur); cur = table[cur];
      }
      return out;
    }
    function readChain(start, size) {
      var secs = chain(start, fat), out = new Uint8Array(secs.length * ss), p = 0;
      for (var j = 0; j < secs.length; j++) { var sb = sectorBytes(secs[j]); out.set(sb, p); p += ss; }
      return size === undefined ? out : out.subarray(0, Math.min(size, out.length));
    }

    /* 디렉터리 */
    var dirBytes = readChain(dirStart), entries = [];
    var ddv = dvOf(dirBytes);
    for (var e = 0; e + 128 <= dirBytes.length; e += 128) {
      var nameLen = ddv.getUint16(e + 64, true), type = dirBytes[e + 66];
      if (type === 0) { entries.push(null); continue; }
      var nl = Math.max(0, Math.min(nameLen, 64) - 2);
      var name = utf16.decode(dirBytes.subarray(e, e + nl)).replace(/\0+$/, "");
      entries.push({
        name: name, type: type,
        start: ddv.getUint32(e + 116, true),
        size: ddv.getUint32(e + 120, true)
      });
    }
    var root = entries[0];

    /* 미니스트림(4096바이트 미만 스트림) */
    var miniFat = null, miniStream = null;
    function loadMini() {
      if (miniFat) return;
      var mfBytes = readChain(miniFatStart);
      miniFat = new Uint32Array(mfBytes.buffer, mfBytes.byteOffset, Math.floor(mfBytes.length / 4));
      miniStream = root ? readChain(root.start, root.size) : new Uint8Array(0);
    }
    function readMini(start, size) {
      loadMini();
      var secs = chain(start, miniFat), out = new Uint8Array(secs.length * ms);
      for (var j = 0; j < secs.length; j++) {
        var off = secs[j] * ms;
        if (off < miniStream.length) out.set(miniStream.subarray(off, Math.min(off + ms, miniStream.length)), j * ms);
      }
      return out.subarray(0, Math.min(size, out.length));
    }

    return {
      entries: entries,
      stream: function (name) {
        var key = String(name).toLowerCase();
        for (var j = 0; j < entries.length; j++) {
          var en = entries[j];
          if (!en || en.type !== 2 || en.name.toLowerCase() !== key) continue;
          if (en.size < miniCutoff && j !== 0) return readMini(en.start, en.size);
          return readChain(en.start, en.size);
        }
        return null;
      }
    };
  }

  /* =====================================================================
   * 2. BIFF8 읽기
   * ===================================================================== */
  var CODEPAGES = {
    949: "euc-kr", 1361: "euc-kr", 932: "shift_jis", 936: "gbk", 950: "big5",
    1250: "windows-1250", 1251: "windows-1251", 1252: "windows-1252", 1253: "windows-1253",
    1254: "windows-1254", 1255: "windows-1255", 1256: "windows-1256", 1257: "windows-1257",
    1258: "windows-1258", 874: "windows-874", 10000: "macintosh", 32769: "windows-1252"
  };
  function latin1(bytes) {
    var s = "";
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return s;
  }

  /* RK 값 4종: 정수/실수 × (÷100 여부) */
  function rkToNumber(rk) {
    var v;
    if (rk & 0x02) v = rk >> 2;                        // 부호 있는 30비트 정수
    else {
      var b = new ArrayBuffer(8), d = new DataView(b);
      d.setUint32(4, rk & 0xfffffffc, true);           // 상위 30비트가 IEEE754 상위 비트
      d.setUint32(0, 0, true);
      v = d.getFloat64(0, true);
    }
    return (rk & 0x01) ? v / 100 : v;
  }

  var ERRORS = { 0: "#NULL!", 7: "#DIV/0!", 15: "#VALUE!", 23: "#REF!", 29: "#NAME?", 36: "#NUM!", 42: "#N/A", 43: "#GETTING_DATA" };

  function parseWorkbook(wb) {
    var dv = dvOf(wb);
    var biff = 8, codepage = 1200, date1904 = false;
    var byteDecoder = null;
    function decodeBytes(bytes) {
      if (biff >= 8) return latin1(bytes);             // BIFF8 압축 유니코드 = Latin-1
      if (byteDecoder === null) {
        try { byteDecoder = new TextDecoder(CODEPAGES[codepage] || "windows-1252"); } catch (e) { byteDecoder = false; }
      }
      if (!byteDecoder) return latin1(bytes);
      try { return byteDecoder.decode(bytes); } catch (e2) { return latin1(bytes); }
    }

    /* 유니코드 문자열(단일 레코드 안). lenBytes: 길이 필드 크기(1 또는 2) */
    function readUniStr(p, lenBytes, end) {
      if (p + lenBytes > end) return { s: "", next: end };
      var cch = lenBytes === 1 ? wb[p] : dv.getUint16(p, true);
      p += lenBytes;
      if (biff < 8) {                                  // BIFF5: 바이트 문자열
        var q = Math.min(p + cch, end);
        return { s: decodeBytes(wb.subarray(p, q)), next: q };
      }
      var grbit = wb[p++];
      var cRun = 0, cbExt = 0;
      if (grbit & 0x08) { cRun = dv.getUint16(p, true); p += 2; }
      if (grbit & 0x04) { cbExt = dv.getUint32(p, true); p += 4; }
      var s;
      if (grbit & 0x01) { var q2 = Math.min(p + cch * 2, end); s = utf16.decode(wb.subarray(p, q2)); p = q2; }
      else { var q3 = Math.min(p + cch, end); s = latin1(wb.subarray(p, q3)); p = q3; }
      return { s: s, next: Math.min(p + cRun * 4 + cbExt, end) };
    }

    /* SST: CONTINUE 레코드에 걸친 문자열 읽기 */
    function parseSst(chunks) {
      var out = [], ci = 0, p = 0;
      var first = chunks[0];
      if (!first || first.length < 8) return out;
      var unique = dvOf(first).getUint32(4, true);
      p = 8;
      function avail() { return ci < chunks.length ? chunks[ci].length - p : 0; }
      function nextChunk() { ci++; p = 0; }
      function u8() { var v = chunks[ci][p]; p += 1; return v; }
      function u16() { var v = chunks[ci][p] | (chunks[ci][p + 1] << 8); p += 2; return v; }
      function u32() { var v = dvOf(chunks[ci]).getUint32(p, true); p += 4; return v; }
      for (var n = 0; n < unique; n++) {
        while (ci < chunks.length && avail() <= 0) nextChunk();
        if (ci >= chunks.length) break;
        if (avail() < 3) { nextChunk(); if (ci >= chunks.length) break; }
        var cch = u16(), grbit = u8(), cRun = 0, cbExt = 0;
        if (grbit & 0x08) { if (avail() < 2) nextChunk(); cRun = u16(); }
        if (grbit & 0x04) { if (avail() < 4) nextChunk(); cbExt = u32(); }
        var compressed = !(grbit & 0x01), remaining = cch, s = "";
        while (remaining > 0) {
          if (avail() <= 0) {
            nextChunk();
            if (ci >= chunks.length) break;
            compressed = !(u8() & 0x01);               // CONTINUE 첫 바이트 = 새 압축 플래그
            continue;
          }
          var take = compressed ? Math.min(remaining, avail()) : Math.min(remaining, Math.floor(avail() / 2));
          if (take <= 0) { p = chunks[ci].length; continue; }
          var seg = chunks[ci].subarray(p, p + (compressed ? take : take * 2));
          s += compressed ? latin1(seg) : utf16.decode(seg);
          p += seg.length; remaining -= take;
        }
        var skip = cRun * 4 + cbExt;                   // rich text 런/확장 데이터 건너뛰기
        while (skip > 0 && ci < chunks.length) {
          if (avail() <= 0) { nextChunk(); continue; }
          var k = Math.min(skip, avail()); p += k; skip -= k;
        }
        out.push(s);
      }
      return out;
    }

    /* ---- 전역(워크북) 부분 ---- */
    var sst = [], xfFormats = [], formats = {}, sheets = [];
    var p = 0, depth = 0, len = wb.length;
    var pendingSst = null;
    if (len < 4 || dv.getUint16(0, true) !== 0x0809) throw new Error("엑셀 워크북 정보를 찾지 못했습니다 (BOF 없음)");

    function flushSst() { if (pendingSst) { sst = parseSst(pendingSst); pendingSst = null; } }

    while (p + 4 <= len) {
      var type = dv.getUint16(p, true), rlen = dv.getUint16(p + 2, true);
      var body = p + 4, end = Math.min(body + rlen, len);
      if (type !== 0x3c) flushSst();
      if (type === 0x0809) {                            // BOF
        depth++;
        if (depth === 1 && rlen >= 4) {
          var vers = dv.getUint16(body, true);
          biff = vers >= 0x0600 ? 8 : (vers === 0x0500 ? 5 : 8);
        }
      } else if (type === 0x000a) {                     // EOF
        depth--;
        if (depth <= 0) { p = end; break; }
      } else if (type === 0x002f) {                     // FILEPASS
        throw new Error("암호가 걸린 엑셀 파일은 열 수 없습니다. 엑셀에서 암호를 풀고 다시 저장해 주세요");
      } else if (type === 0x0042) {                     // CODEPAGE
        if (rlen >= 2) codepage = dv.getUint16(body, true);
      } else if (type === 0x0022) {                     // DATEMODE
        if (rlen >= 2) date1904 = dv.getUint16(body, true) === 1;
      } else if (type === 0x0085) {                     // BOUNDSHEET8
        if (rlen >= 6) {
          var off = dv.getUint32(body, true), st = wb[body + 5];
          var nm = readUniStr(body + 6, 1, end).s;
          sheets.push({ name: nm, offset: off, type: st });
        }
      } else if (type === 0x00fc) {                     // SST
        pendingSst = [wb.subarray(body, end)];
      } else if (type === 0x003c) {                     // CONTINUE
        if (pendingSst) pendingSst.push(wb.subarray(body, end));
      } else if (type === 0x041e || type === 0x001e) {  // FORMAT
        if (rlen >= 3) {
          var ifmt = dv.getUint16(body, true);
          formats[ifmt] = type === 0x041e ? readUniStr(body + 2, 2, end).s : decodeBytes(wb.subarray(body + 3, body + 3 + wb[body + 2]));
        }
      } else if (type === 0x00e0) {                     // XF
        if (rlen >= 4) xfFormats.push(dv.getUint16(body + 2, true));
      } else if (type === 0x0043) {                     // XF (BIFF2~4)
        xfFormats.push(rlen >= 3 ? wb[body + 2] & 0x3f : 0);
      }
      p = end;
    }
    flushSst();

    var globalsEnd = p;
    var dateXf = xfFormats.map(function (ifmt) { return isDateFormat(ifmt, formats); });

    /* BOUNDSHEET 가 없는 파일(드묾): BOF 를 순서대로 훑어 시트를 찾음 */
    if (!sheets.length) {
      var q = globalsEnd, idx = 1;
      while (q + 4 <= len) {
        var t2 = dv.getUint16(q, true), l2 = dv.getUint16(q + 2, true);
        if (t2 === 0x0809) { sheets.push({ name: "Sheet" + (idx++), offset: q, type: 0 }); q = skipSubstream(q); }
        else q += 4 + l2;
      }
    }
    function skipSubstream(start) {
      var q = start, d = 0;
      while (q + 4 <= len) {
        var t = dv.getUint16(q, true), l = dv.getUint16(q + 2, true);
        if (t === 0x0809) d++;
        else if (t === 0x000a) { d--; if (d <= 0) return q + 4; }
        q += 4 + l;
      }
      return len;
    }

    /* ---- 시트 부분 ---- */
    function toDate(num, xf) {
      if (xf >= 0 && dateXf[xf]) return serialToString(num + (date1904 ? 1462 : 0), true);
      return num;
    }
    function parseSheet(offset) {
      var rows = [];
      function put(r, c, v) {
        var row = rows[r] || (rows[r] = []);
        row[c] = v;
      }
      var q = offset, d = 0, formulaCell = null;
      if (q + 4 > len || dv.getUint16(q, true) !== 0x0809) return rows;
      while (q + 4 <= len) {
        var t = dv.getUint16(q, true), l = dv.getUint16(q + 2, true);
        var b = q + 4, e = Math.min(b + l, len);
        if (t === 0x0809) { d++; q = e; continue; }
        if (t === 0x000a) { d--; if (d <= 0) break; q = e; continue; }
        if (d !== 1) { q = e; continue; }               // 시트 안의 차트 서브스트림 등은 무시
        if (t !== 0x0207 && t !== 0x003c) formulaCell = null;
        var r, c, xf, n;
        switch (t) {
          case 0x00fd:                                  // LABELSST
            if (l >= 10) { r = dv.getUint16(b, true); c = dv.getUint16(b + 2, true); n = dv.getUint32(b + 6, true); put(r, c, sst[n] !== undefined ? sst[n] : ""); }
            break;
          case 0x0204:                                  // LABEL
          case 0x00d6:                                  // RSTRING
            if (l >= 8) { r = dv.getUint16(b, true); c = dv.getUint16(b + 2, true); put(r, c, readUniStr(b + 6, 2, e).s); }
            break;
          case 0x0203:                                  // NUMBER
            if (l >= 14) { r = dv.getUint16(b, true); c = dv.getUint16(b + 2, true); xf = dv.getUint16(b + 4, true); put(r, c, toDate(dv.getFloat64(b + 6, true), xf)); }
            break;
          case 0x027e:                                  // RK
            if (l >= 10) { r = dv.getUint16(b, true); c = dv.getUint16(b + 2, true); xf = dv.getUint16(b + 4, true); put(r, c, toDate(rkToNumber(dv.getInt32(b + 6, true)), xf)); }
            break;
          case 0x00bd:                                  // MULRK
            if (l >= 12) {
              r = dv.getUint16(b, true); c = dv.getUint16(b + 2, true);
              for (var k = b + 4; k + 6 <= e - 2; k += 6, c++) put(r, c, toDate(rkToNumber(dv.getInt32(k + 2, true)), dv.getUint16(k, true)));
            }
            break;
          case 0x0205:                                  // BOOLERR
            if (l >= 8) {
              r = dv.getUint16(b, true); c = dv.getUint16(b + 2, true);
              put(r, c, wb[b + 7] ? (ERRORS[wb[b + 6]] || "#ERR") : (wb[b + 6] ? "TRUE" : "FALSE"));
            }
            break;
          case 0x0006:                                  // FORMULA
          case 0x0406:
            if (l >= 14) {
              r = dv.getUint16(b, true); c = dv.getUint16(b + 2, true); xf = dv.getUint16(b + 4, true);
              if (dv.getUint16(b + 12, true) === 0xffff) {
                var kind = wb[b + 6];
                if (kind === 0) { formulaCell = { r: r, c: c }; put(r, c, ""); }        // 문자열 → 뒤따르는 STRING
                else if (kind === 1) put(r, c, wb[b + 8] ? "TRUE" : "FALSE");
                else if (kind === 2) put(r, c, ERRORS[wb[b + 8]] || "#ERR");
                else put(r, c, "");
              } else put(r, c, toDate(dv.getFloat64(b + 6, true), xf));
            }
            break;
          case 0x0207:                                  // STRING (수식 문자열 결과)
            if (formulaCell) { put(formulaCell.r, formulaCell.c, readUniStr(b, 2, e).s); formulaCell = null; }
            break;
          case 0x0201: case 0x00be: case 0x0200: case 0x0208:  // BLANK/MULBLANK/DIMENSIONS/ROW: 무시
          default:
            break;
        }
        q = e;
      }
      for (var ri = 0; ri < rows.length; ri++) {
        var row = rows[ri];
        if (!row) { rows[ri] = []; continue; }
        for (var ci = 0; ci < row.length; ci++) if (row[ci] === undefined) row[ci] = "";
      }
      return rows;
    }

    /* 워크시트만(차트·매크로 시트 제외). 이름 중복은 뒤에 번호 */
    var names = [], byName = {}, seenName = {};
    sheets.forEach(function (s) {
      if (s.type !== 0 && s.type !== undefined) return;
      var nm = s.name || ("Sheet" + (names.length + 1));
      if (seenName[nm]) nm = nm + "_" + (++seenName[nm]);
      else seenName[nm] = 1;
      names.push(nm); byName[nm] = s;
    });

    var cache = {};
    function sheet(n) {
      if (cache[n]) return cache[n];
      var s = byName[n];
      if (!s) return null;
      cache[n] = parseSheet(s.offset);
      return cache[n];
    }
    function key(s) { return String(s).replace(/\s+/g, "").toLowerCase(); }
    function findName(candidates) {
      var a, b;
      for (a = 0; a < candidates.length; a++) {
        for (b = 0; b < names.length; b++) if (key(names[b]) === key(candidates[a])) return names[b];
      }
      for (a = 0; a < candidates.length; a++) {
        for (b = 0; b < names.length; b++) if (key(names[b]).indexOf(key(candidates[a])) !== -1) return names[b];
      }
      return "";
    }
    return {
      names: names,
      biff: biff,
      sheet: sheet,
      has: function (n) { return byName[n] !== undefined; },
      pick: function (candidates) { var nm = findName(candidates); return nm ? sheet(nm) : null; },
      pickName: findName
    };
  }

  /* read(arrayBuffer|Uint8Array) → { names, sheet(name), has, pick, pickName } (동기) */
  function read(data) {
    var bytes = toBytes(data);
    var cfb = cfbOpen(bytes);
    var wb = cfb.stream("Workbook") || cfb.stream("Book");
    if (!wb) throw new Error("이 파일에는 엑셀 워크북이 들어 있지 않습니다 (Workbook 스트림 없음)");
    return parseWorkbook(wb);
  }
  /* xlsx-lite.read 처럼 Promise 로 받고 싶을 때 */
  function readAsync(data) {
    return new Promise(function (resolve, reject) {
      try { resolve(read(data)); } catch (e) { reject(e); }
    });
  }

  /* =====================================================================
   * 3. BIFF8 쓰기
   * ===================================================================== */
  function Buf() { this.parts = []; this.length = 0; }
  Buf.prototype.push = function (u8) { this.parts.push(u8); this.length += u8.length; return this; };
  Buf.prototype.bytes = function () {
    var out = new Uint8Array(this.length), p = 0;
    for (var i = 0; i < this.parts.length; i++) { out.set(this.parts[i], p); p += this.parts[i].length; }
    return out;
  };

  function mk(size) { var b = new Uint8Array(size); return { b: b, dv: dvOf(b) }; }
  function rec(type, body) {
    var out = new Uint8Array(4 + body.length), dv = dvOf(out);
    dv.setUint16(0, type, true); dv.setUint16(2, body.length, true);
    out.set(body, 4);
    return out;
  }
  function utf16Bytes(str) {
    var out = new Uint8Array(str.length * 2), dv = dvOf(out);
    for (var i = 0; i < str.length; i++) dv.setUint16(i * 2, str.charCodeAt(i), true);
    return out;
  }
  /* 짧은 유니코드 문자열(길이 1바이트, grbit=1) — FONT 이름, 시트 이름 */
  function shortUniStr(str) {
    var chars = utf16Bytes(str), out = new Uint8Array(2 + chars.length);
    out[0] = str.length; out[1] = 1; out.set(chars, 2);
    return out;
  }
  /* 긴 유니코드 문자열(길이 2바이트, grbit=1) — LABEL, FORMAT */
  function longUniStr(str) {
    var chars = utf16Bytes(str), out = new Uint8Array(3 + chars.length), dv = dvOf(out);
    dv.setUint16(0, str.length, true); out[2] = 1; out.set(chars, 3);
    return out;
  }

  var CTRL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;
  var MAX_LABEL = 255;          // LABEL 레코드 인라인 문자열 한계(MS-XLS)
  var MAX_TEXT = 32767;         // 셀 문자열 최대 길이
  var MAX_REC = 8224;           // 레코드 본문 최대 크기(BIFF8)

  /* XF 표: 0~14 스타일 XF, 15 기본 셀 XF, 16~ 앱 서식 */
  var CELL_XF = { base: 15, datetime: 16, date: 17, int: 18, pct: 19, bold: 20, pct2: 21, money2: 22 };
  var STYLE_MAP = {
    header: "bold", title: "bold", subhead: "bold",
    date: "date", datetime: "datetime",
    int: "int", intInput: "int", money: "int", money0: "int", moneyInput: "int",
    pct: "pct", pct2: "pct2"
  };
  var STYLE_INDEX = {};
  Object.keys(STYLE_MAP).forEach(function (k) { STYLE_INDEX[k] = CELL_XF[STYLE_MAP[k]]; });

  function xfRecord(ifnt, ifmt, style) {
    var m = mk(20);
    m.dv.setUint16(0, ifnt, true);
    m.dv.setUint16(2, ifmt, true);
    m.dv.setUint16(4, style ? 0xfff5 : 0x0001, true);   // fLocked | fStyle | ixfParent
    m.b[6] = 0x20;                                       // 세로 정렬: 아래
    m.b[7] = 0x00;
    m.b[8] = 0x00;
    m.b[9] = style ? 0xf4 : (ifmt ? 0x04 : 0x00) | (ifnt ? 0x08 : 0x00);  // 사용 속성 플래그
    m.dv.setUint32(10, 0, true);
    m.dv.setUint32(14, 0, true);
    m.dv.setUint16(18, 0x20c0, true);                    // 채움색 기본(64/65)
    return rec(0x00e0, m.b);
  }
  function fontRecord(bold) {
    var m = mk(14);
    m.dv.setUint16(0, 200, true);                        // 10pt
    m.dv.setUint16(2, 0, true);
    m.dv.setUint16(4, 0x7fff, true);                     // 자동 색
    m.dv.setUint16(6, bold ? 700 : 400, true);
    m.dv.setUint16(8, 0, true);
    m.b[10] = 0; m.b[11] = 0; m.b[12] = 129; m.b[13] = 0; // Hangul charset
    var head = m.b, name = shortUniStr("맑은 고딕");
    var body = new Uint8Array(head.length + name.length);
    body.set(head, 0); body.set(name, head.length);
    return rec(0x0031, body);
  }
  function formatRecord(ifmt, code) {
    var s = longUniStr(code), body = new Uint8Array(2 + s.length);
    dvOf(body).setUint16(0, ifmt, true); body.set(s, 2);
    return rec(0x041e, body);
  }

  function cleanSheetName(name, i, used) {
    var nm = String(name === undefined || name === null ? "" : name).replace(/[\\/?*\[\]:]/g, " ").replace(CTRL, "").trim().slice(0, 31);
    if (!nm) nm = "Sheet" + (i + 1);
    var base = nm, n = 1;
    while (used[nm.toLowerCase()]) nm = base.slice(0, 28) + "_" + (n++);
    used[nm.toLowerCase()] = true;
    return nm;
  }

  /* 셀 값 정규화 → { t: 's'|'n'|'', v, xf } */
  function normCell(v) {
    var xf = CELL_XF.base, val = v;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      var st = STYLE_MAP[v.s];
      if (st) xf = CELL_XF[st];
      val = v.v;
    }
    if (val === null || val === undefined || val === "") return { t: "", v: "", xf: xf };
    if (val instanceof Date) {
      var ser = dateToSerial(val);
      if (ser === null) return { t: "", v: "", xf: xf };
      return { t: "n", v: ser, xf: xf === CELL_XF.base ? CELL_XF.datetime : xf };
    }
    if (typeof val === "number") return isFinite(val) ? { t: "n", v: val, xf: xf } : { t: "", v: "", xf: xf };
    if (typeof val === "boolean") return { t: "s", v: val ? "TRUE" : "FALSE", xf: xf };
    var s = String(val).replace(CTRL, "");
    if (s.length > MAX_TEXT) s = s.slice(0, MAX_TEXT);
    return { t: "s", v: s, xf: xf };
  }

  /* SST(공유 문자열) 레코드 + CONTINUE 분할 */
  function sstRecords(strings, total) {
    var chunks = [], cur = new Buf(), h = mk(8);
    h.dv.setUint32(0, total, true); h.dv.setUint32(4, strings.length, true);
    cur.push(h.b);
    function flush() { chunks.push(cur.bytes()); cur = new Buf(); }
    for (var i = 0; i < strings.length; i++) {
      var s = strings[i], chars = utf16Bytes(s);
      if (cur.length + 3 + Math.min(2, chars.length) > MAX_REC) flush();
      var hd = mk(3); hd.dv.setUint16(0, s.length, true); hd.b[2] = 1;
      cur.push(hd.b);
      var p = 0;
      while (p < chars.length) {
        var room = Math.floor((MAX_REC - cur.length) / 2) * 2;
        if (room <= 0) { flush(); cur.push(new Uint8Array([1])); room = Math.floor((MAX_REC - 1) / 2) * 2; }
        var take = Math.min(room, chars.length - p);
        cur.push(chars.subarray(p, p + take)); p += take;
      }
    }
    flush();
    return chunks.map(function (c, i) { return rec(i === 0 ? 0x00fc : 0x003c, c); });
  }

  function buildWorkbookStream(sheets) {
    if (!Array.isArray(sheets) || !sheets.length) sheets = [{ name: "Sheet1", rows: [] }];
    var used = {}, names = sheets.map(function (s, i) { return cleanSheetName(s && s.name, i, used); });

    /* 시트 본문 먼저 만들기(길이를 알아야 BOUNDSHEET 오프셋을 채울 수 있음) */
    var sstList = [], sstIndex = {}, sstTotal = 0;
    var sheetBufs = sheets.map(function (s, si) {
      var rows = (s && s.rows) || [];
      if (rows.length > 65536) throw new Error("구형 엑셀(.xls)은 시트당 65,536행까지만 담을 수 있습니다 (" + rows.length + "행). .xlsx 로 내보내 주세요");
      var out = new Buf();
      var bof = mk(16);
      bof.dv.setUint16(0, 0x0600, true); bof.dv.setUint16(2, 0x0010, true);
      bof.dv.setUint16(4, 0x0dbb, true); bof.dv.setUint16(6, 0x07cc, true);
      bof.dv.setUint32(8, 0, true); bof.dv.setUint32(12, 0x0006, true);
      out.push(rec(0x0809, bof.b));

      /* 열 너비(선택) */
      if (s.cols && s.cols.length) {
        s.cols.forEach(function (c, ci) {
          if (!c || ci > 255) return;
          var m = mk(12);
          m.dv.setUint16(0, ci, true); m.dv.setUint16(2, ci, true);
          m.dv.setUint16(4, Math.round((c.w || 12) * 256), true);
          m.dv.setUint16(6, CELL_XF.base, true);
          m.dv.setUint16(8, c.hidden ? 1 : 0, true);
          m.dv.setUint16(10, 0, true);
          out.push(rec(0x007d, m.b));
        });
      }

      var maxCol = 0, cellRows = [];
      rows.forEach(function (row, ri) {
        if (!row || !row.length) return;
        if (row.length > 256) throw new Error("구형 엑셀(.xls)은 256열까지만 담을 수 있습니다 (" + names[si] + " 시트 " + row.length + "열). .xlsx 로 내보내 주세요");
        var cells = [];
        for (var ci = 0; ci < row.length; ci++) {
          var nc = normCell(row[ci]);
          if (!nc.t) continue;
          cells.push({ c: ci, cell: nc });
          if (ci + 1 > maxCol) maxCol = ci + 1;
        }
        if (cells.length) cellRows.push({ r: ri, cells: cells });
      });

      var dim = mk(14);
      dim.dv.setUint32(0, 0, true); dim.dv.setUint32(4, rows.length, true);
      dim.dv.setUint16(8, 0, true); dim.dv.setUint16(10, maxCol, true); dim.dv.setUint16(12, 0, true);
      out.push(rec(0x0200, dim.b));

      cellRows.forEach(function (cr) {
        var first = cr.cells[0].c, last = cr.cells[cr.cells.length - 1].c + 1;
        var rw = mk(16);
        rw.dv.setUint16(0, cr.r, true); rw.dv.setUint16(2, first, true); rw.dv.setUint16(4, last, true);
        rw.dv.setUint16(6, 0x00ff, true); rw.dv.setUint16(8, 0, true); rw.dv.setUint16(10, 0, true);
        rw.dv.setUint16(12, 0x0100, true); rw.dv.setUint16(14, 0x000f, true);
        out.push(rec(0x0208, rw.b));
        cr.cells.forEach(function (ce) {
          var cell = ce.cell, m;
          if (cell.t === "n") {
            m = mk(14);
            m.dv.setUint16(0, cr.r, true); m.dv.setUint16(2, ce.c, true); m.dv.setUint16(4, cell.xf, true);
            m.dv.setFloat64(6, cell.v, true);
            out.push(rec(0x0203, m.b));
          } else if (cell.v.length <= MAX_LABEL) {
            var str = longUniStr(cell.v);
            m = mk(6 + str.length);
            m.dv.setUint16(0, cr.r, true); m.dv.setUint16(2, ce.c, true); m.dv.setUint16(4, cell.xf, true);
            m.b.set(str, 6);
            out.push(rec(0x0204, m.b));
          } else {                                       // 긴 문자열은 SST + LABELSST
            var idx = sstIndex[cell.v];
            if (idx === undefined) { idx = sstList.length; sstIndex[cell.v] = idx; sstList.push(cell.v); }
            sstTotal++;
            m = mk(10);
            m.dv.setUint16(0, cr.r, true); m.dv.setUint16(2, ce.c, true); m.dv.setUint16(4, cell.xf, true);
            m.dv.setUint32(6, idx, true);
            out.push(rec(0x00fd, m.b));
          }
        });
      });

      /* WINDOW2 (+ 틀고정 PANE) */
      var fz = s.freeze && (s.freeze.row || s.freeze.col) ? s.freeze : null;
      var w2 = mk(18), grbit = 0x02b6 | (si === 0 ? 0x0400 : 0) | (fz ? 0x0108 : 0);
      w2.dv.setUint16(0, grbit, true); w2.dv.setUint16(2, 0, true); w2.dv.setUint16(4, 0, true);
      w2.dv.setUint32(6, 0x40, true); w2.dv.setUint16(10, 0, true); w2.dv.setUint16(12, 0, true); w2.dv.setUint32(14, 0, true);
      out.push(rec(0x023e, w2.b));
      if (fz) {
        var pn = mk(10), x = fz.col || 0, y = fz.row || 0;
        pn.dv.setUint16(0, x, true); pn.dv.setUint16(2, y, true); pn.dv.setUint16(4, y, true); pn.dv.setUint16(6, x, true);
        pn.dv.setUint16(8, x && y ? 0 : (y ? 2 : 1), true);
        out.push(rec(0x0041, pn.b));
      }
      out.push(rec(0x000a, new Uint8Array(0)));
      return out.bytes();
    });

    /* 전역 부분 */
    var g = new Buf();
    var bof = mk(16);
    bof.dv.setUint16(0, 0x0600, true); bof.dv.setUint16(2, 0x0005, true);
    bof.dv.setUint16(4, 0x0dbb, true); bof.dv.setUint16(6, 0x07cc, true);
    bof.dv.setUint32(8, 0, true); bof.dv.setUint32(12, 0x0006, true);
    g.push(rec(0x0809, bof.b));
    g.push(rec(0x0042, new Uint8Array([0xb0, 0x04])));                      // CODEPAGE 1200
    var w1 = mk(18);
    w1.dv.setUint16(0, 0x01e0, true); w1.dv.setUint16(2, 0x005a, true);
    w1.dv.setUint16(4, 0x3fcf, true); w1.dv.setUint16(6, 0x2a4e, true);
    w1.dv.setUint16(8, 0x0038, true); w1.dv.setUint16(10, 0, true); w1.dv.setUint16(12, 0, true);
    w1.dv.setUint16(14, 1, true); w1.dv.setUint16(16, 0x0258, true);
    g.push(rec(0x003d, w1.b));                                               // WINDOW1
    g.push(rec(0x0022, new Uint8Array([0, 0])));                             // DATEMODE 1900
    for (var f = 0; f < 4; f++) g.push(fontRecord(false));                   // FONT 0~3 (4는 건너뜀)
    g.push(fontRecord(true));                                                // FONT 5: 굵게
    g.push(formatRecord(164, "yyyy-mm-dd hh:mm"));
    g.push(formatRecord(165, "yyyy-mm-dd"));
    for (var x = 0; x < 15; x++) g.push(xfRecord(0, 0, true));               // XF 0~14 스타일
    g.push(xfRecord(0, 0, false));                                           // XF 15 기본 셀
    g.push(xfRecord(0, 164, false));                                         // 16 datetime
    g.push(xfRecord(0, 165, false));                                         // 17 date
    g.push(xfRecord(0, 3, false));                                           // 18 #,##0
    g.push(xfRecord(0, 9, false));                                           // 19 0%
    g.push(xfRecord(5, 0, false));                                           // 20 bold
    g.push(xfRecord(0, 10, false));                                          // 21 0.00%
    g.push(xfRecord(0, 4, false));                                           // 22 #,##0.00
    g.push(rec(0x0293, new Uint8Array([0x00, 0x80, 0x00, 0xff])));           // STYLE: Normal

    var bsRecs = names.map(function (nm) {
      var str = shortUniStr(nm), m = mk(6 + str.length);
      m.dv.setUint32(0, 0, true); m.b[4] = 0; m.b[5] = 0; m.b.set(str, 6);
      return rec(0x0085, m.b);
    });
    bsRecs.forEach(function (r) { g.push(r); });
    if (sstList.length) sstRecords(sstList, sstTotal).forEach(function (r) { g.push(r); });
    g.push(rec(0x000a, new Uint8Array(0)));

    var globals = g.bytes();
    /* BOUNDSHEET 오프셋 채우기 */
    var pos = 0;
    for (var i = 0; i < globals.length;) {
      var t = globals[i] | (globals[i + 1] << 8), l = globals[i + 2] | (globals[i + 3] << 8);
      if (t === 0x0085) {
        var so = globals.length;
        for (var j = 0; j < pos; j++) so += sheetBufs[j].length;
        dvOf(globals).setUint32(i + 4, so, true);
        pos++;
      }
      i += 4 + l;
    }
    var all = new Buf();
    all.push(globals);
    sheetBufs.forEach(function (b) { all.push(b); });
    return all.bytes();
  }

  /* =====================================================================
   * 4. CFB 컨테이너 쓰기 (섹터 512, 'Workbook' 스트림 하나)
   * ===================================================================== */
  function cfbWrap(stream) {
    var SS = 512;
    var padded = Math.max(4096, Math.ceil(stream.length / SS) * SS);   // 항상 일반 섹터(미니스트림 안 씀)
    var dataSectors = padded / SS;
    var fatSectors = 1;
    while (fatSectors * (SS / 4) < dataSectors + fatSectors + 1) fatSectors++;
    if (fatSectors > 109) throw new Error("파일이 너무 커서 .xls 로 만들 수 없습니다. .xlsx 로 내보내 주세요");
    var dirSector = dataSectors + fatSectors;
    var totalSectors = dirSector + 1;

    var out = new Uint8Array((totalSectors + 1) * SS), dv = dvOf(out);
    /* 헤더 */
    out.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], 0);
    dv.setUint16(24, 0x003e, true);            // minor
    dv.setUint16(26, 0x0003, true);            // major 3
    dv.setUint16(28, 0xfffe, true);            // byte order
    dv.setUint16(30, 9, true);                 // 512
    dv.setUint16(32, 6, true);                 // 64
    dv.setUint32(44, fatSectors, true);
    dv.setUint32(48, dirSector, true);
    dv.setUint32(56, 4096, true);
    dv.setUint32(60, ENDOFCHAIN, true);
    dv.setUint32(64, 0, true);
    dv.setUint32(68, ENDOFCHAIN, true);
    dv.setUint32(72, 0, true);
    for (var i = 0; i < 109; i++) dv.setUint32(76 + i * 4, i < fatSectors ? dataSectors + i : FREESECT, true);

    /* 데이터 */
    out.set(stream, SS);

    /* FAT */
    var fatBase = (dataSectors + 1) * SS, fatCount = fatSectors * (SS / 4);
    for (var s = 0; s < fatCount; s++) {
      var v;
      if (s < dataSectors - 1) v = s + 1;
      else if (s === dataSectors - 1) v = ENDOFCHAIN;
      else if (s < dirSector) v = FATSECT;
      else if (s === dirSector) v = ENDOFCHAIN;
      else v = FREESECT;
      dv.setUint32(fatBase + s * 4, v, true);
    }

    /* 디렉터리(4 엔트리) */
    var dirBase = (dirSector + 1) * SS;
    function entry(idx, name, type, left, right, child, start, size, clsid) {
      var o = dirBase + idx * 128;
      if (name) {
        var nb = utf16Bytes(name); out.set(nb, o);
        dv.setUint16(o + 64, nb.length + 2, true);
      }
      out[o + 66] = type; out[o + 67] = 1;     // 검정
      dv.setInt32(o + 68, left, true); dv.setInt32(o + 72, right, true); dv.setInt32(o + 76, child, true);
      if (clsid) out.set(clsid, o + 80);
      dv.setUint32(o + 116, start, true); dv.setUint32(o + 120, size, true);
    }
    entry(0, "Root Entry", 5, -1, -1, 1, ENDOFCHAIN, 0,
      [0x20, 0x08, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0xc0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x46]);
    entry(1, "Workbook", 2, -1, -1, -1, 0, stream.length, null);
    entry(2, "", 0, -1, -1, -1, 0, 0, null);
    entry(3, "", 0, -1, -1, -1, 0, 0, null);
    return out;
  }

  /* buildBytes(sheets) → Uint8Array. sheets = [{ name, rows:[[셀,...],...], cols?, freeze? }] */
  function buildBytes(sheets) {
    return cfbWrap(buildWorkbookStream(sheets));
  }
  function write(sheets) {
    return new Blob([buildBytes(sheets)], { type: "application/vnd.ms-excel" });
  }

  var api = {
    read: read,
    readAsync: readAsync,
    write: write,
    buildBytes: buildBytes,
    isCfb: isCfb,
    serialToString: serialToString,
    dateToSerial: dateToSerial,
    STYLE_INDEX: STYLE_INDEX
  };

  global.BiffXls = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
