/* =====================================================================
 * xlsx-compat.js — SheetJS(XLSX) 호환 얇은 층
 *
 * 앱(app.js)은 SheetJS 의 API(XLSX.read / utils.sheet_to_json / writeFile …)를
 * 쓰도록 작성돼 있습니다. vendor/xlsx.full.min.js 가 없을 때 이 파일이
 * 같은 이름의 API 를 xlsx-lite.js(.xlsx) + biff.js(.xls) 위에 흉내냅니다.
 *
 *   - 진짜 SheetJS 가 먼저 로드돼 있으면 아무것도 덮어쓰지 않고
 *     XLSX.readAsync 만 보태 줍니다(앱은 항상 readAsync 를 씁니다).
 *   - .xlsx 읽기는 DecompressionStream 때문에 비동기라서 read() 는 동기로
 *     제공할 수 없습니다 → readAsync(data, opts) 를 쓰세요.
 *   - 워크시트 내부 표현: { "!aoa": [[셀,...],...] } (2차원 배열).
 * ===================================================================== */
(function (global) {
  "use strict";

  var td8 = new TextDecoder("utf-8");

  /* ---------- 진짜 SheetJS 가 있으면 readAsync 만 보강 ---------- */
  if (global.XLSX && typeof global.XLSX.read === "function" && !global.XLSX.__compat) {
    if (!global.XLSX.readAsync) {
      global.XLSX.readAsync = function (data, opts) {
        return new Promise(function (resolve, reject) {
          try { resolve(global.XLSX.read(data, opts)); } catch (e) { reject(e); }
        });
      };
    }
    return;
  }

  function toBytes(data) {
    if (data instanceof Uint8Array) return data;
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    if (typeof data === "string") return new TextEncoder().encode(data);
    throw new Error("지원하지 않는 데이터 형식입니다");
  }
  function bufOf(bytes) {
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  }

  /* ---------- CSV/TSV 텍스트 → 2차원 배열 ---------- */
  function decodeText(bytes) {
    // UTF-8 BOM → UTF-8, 아니면 UTF-8 시도 후 깨지면 EUC-KR(CP949)
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      return td8.decode(bytes.subarray(3));
    }
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch (e) {
      try { return new TextDecoder("euc-kr").decode(bytes); } catch (e2) { return td8.decode(bytes); }
    }
  }
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
  function textToAoa(text) {
    text = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n+$/, "");
    var delim = text.indexOf("\t") !== -1 ? "\t" : ",";
    return dsvToMatrix(text, delim).map(function (r) {
      return r.map(function (v) {
        // 숫자처럼 보이면 숫자로 (SheetJS 의 CSV 파서와 같은 동작)
        var s = String(v).trim();
        if (/^-?\d+(\.\d+)?$/.test(s) && s.length < 16) return parseFloat(s);
        return v;
      });
    });
  }

  /* ---------- 워크북 객체 ---------- */
  function wbFromLite(lite) {
    var wb = { SheetNames: lite.names.slice(), Sheets: {} };
    lite.names.forEach(function (n) {
      wb.Sheets[n] = { "!aoa": lite.sheet(n) || [] };
    });
    return wb;
  }
  function isCfb(b) { return b.length > 8 && b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0; }
  function isZip(b) { return b.length > 4 && b[0] === 0x50 && b[1] === 0x4b; }

  function readAsync(data) {
    var bytes;
    try { bytes = toBytes(data); } catch (e) { return Promise.reject(e); }
    if (isZip(bytes)) {
      if (!global.XlsxLite) return Promise.reject(new Error("xlsx-lite.js 가 로드되지 않았습니다"));
      return global.XlsxLite.read(bufOf(bytes)).then(wbFromLite);
    }
    if (isCfb(bytes)) {
      if (!global.BiffXls) return Promise.reject(new Error(".xls(구형 엑셀) 읽기 엔진(biff.js)이 로드되지 않았습니다"));
      return Promise.resolve().then(function () { return global.BiffXls.read(bufOf(bytes)); }).then(wbFromLite);
    }
    // 텍스트(CSV/TSV)
    var aoa = textToAoa(decodeText(bytes));
    return Promise.resolve({ SheetNames: ["Sheet1"], Sheets: { Sheet1: { "!aoa": aoa } } });
  }
  function readSync() {
    throw new Error("XLSX.read 는 이 환경에서 동기로 쓸 수 없습니다. XLSX.readAsync(data).then(...) 를 쓰세요.");
  }

  /* ---------- utils ---------- */
  function aoaOf(ws) { return (ws && ws["!aoa"]) || []; }
  function isEmptyRow(r) { return !r || !r.some(function (v) { return v !== "" && v !== null && v !== undefined; }); }
  function fmt(v, raw) {
    if (v === null || v === undefined) return "";
    if (raw === false && typeof v === "number") return String(v);
    return v;
  }

  // SheetJS 규칙: 빈 헤더 → __EMPTY, __EMPTY_1 … / 중복 헤더 → 이름_1, 이름_2 …
  function headerKeys(headerRow) {
    var keys = [], seen = {}, emptyN = 0;
    (headerRow || []).forEach(function (h) {
      var k = String(h === null || h === undefined ? "" : h).trim();
      if (!k) { k = emptyN ? "__EMPTY_" + emptyN : "__EMPTY"; emptyN++; }
      if (seen[k] !== undefined) { seen[k]++; k = k + "_" + seen[k]; }
      else seen[k] = 0;
      keys.push(k);
    });
    return keys;
  }

  function sheet_to_json(ws, opts) {
    opts = opts || {};
    var aoa = aoaOf(ws);
    var width = 0;
    aoa.forEach(function (r) { if (r && r.length > width) width = r.length; });
    var defval = opts.defval;
    if (opts.header === 1) {
      return aoa.map(function (r) {
        var out = [];
        for (var i = 0; i < width; i++) {
          var v = r ? r[i] : undefined;
          out.push(v === undefined || v === null || v === "" ? (defval === undefined ? "" : defval) : fmt(v, opts.raw));
        }
        return out;
      });
    }
    if (!aoa.length) return [];
    var keys = headerKeys(aoa[0]);
    var rows = [];
    for (var r = 1; r < aoa.length; r++) {
      var row = aoa[r];
      if (isEmptyRow(row) && !opts.blankrows) continue;
      var o = {};
      for (var c = 0; c < keys.length; c++) {
        var v = row ? row[c] : undefined;
        if (v === undefined || v === null || v === "") {
          if (defval !== undefined) o[keys[c]] = defval;
        } else o[keys[c]] = fmt(v, opts.raw);
      }
      rows.push(o);
    }
    return rows;
  }

  function json_to_sheet(rows, opts) {
    opts = opts || {};
    rows = rows || [];
    var header = opts.header ? opts.header.slice() : [];
    rows.forEach(function (r) {
      Object.keys(r || {}).forEach(function (k) { if (header.indexOf(k) === -1) header.push(k); });
    });
    var aoa = [header.slice()];
    rows.forEach(function (r) {
      aoa.push(header.map(function (k) { var v = r ? r[k] : ""; return v === undefined || v === null ? "" : v; }));
    });
    return { "!aoa": aoa };
  }
  function aoa_to_sheet(aoa) {
    return { "!aoa": (aoa || []).map(function (r) { return (r || []).slice(); }) };
  }
  function csvCell(v) {
    if (v === null || v === undefined) return "";
    var s = String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function sheet_to_csv(ws) {
    return aoaOf(ws).map(function (r) { return (r || []).map(csvCell).join(","); }).join("\n");
  }
  function book_new() { return { SheetNames: [], Sheets: {} }; }
  function book_append_sheet(wb, ws, name) {
    var nm = String(name || ("Sheet" + (wb.SheetNames.length + 1))).replace(/[\\/?*\[\]:]/g, " ").slice(0, 31);
    var base = nm, n = 1;
    while (wb.SheetNames.indexOf(nm) !== -1) nm = base.slice(0, 28) + "_" + (n++);
    wb.SheetNames.push(nm);
    wb.Sheets[nm] = ws;
  }

  /* ---------- 쓰기 ---------- */
  function liteSheets(wb) {
    return wb.SheetNames.map(function (n) {
      return { name: n, rows: aoaOf(wb.Sheets[n]) };
    });
  }
  function write(wb, opts) {
    opts = opts || {};
    var type = String(opts.bookType || "xlsx").toLowerCase();
    if (type === "xls") {
      if (!global.BiffXls) throw new Error(".xls 쓰기 엔진(biff.js)이 로드되지 않았습니다");
      return global.BiffXls.buildBytes(liteSheets(wb));
    }
    if (type === "csv") return new TextEncoder().encode("﻿" + sheet_to_csv(wb.Sheets[wb.SheetNames[0]]));
    if (!global.XlsxLite) throw new Error("xlsx-lite.js 가 로드되지 않았습니다");
    return global.XlsxLite.buildBytes(liteSheets(wb));
  }
  function saveBytes(bytes, filename, mime) {
    var blob = new Blob([bytes], { type: mime });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 800);
  }
  function writeFile(wb, filename, opts) {
    var ext = (String(filename).match(/\.([a-z0-9]+)$/i) || [, "xlsx"])[1].toLowerCase();
    var bookType = (opts && opts.bookType) || (ext === "xls" || ext === "csv" ? ext : "xlsx");
    var bytes = write(wb, { bookType: bookType });
    var mime = bookType === "xls" ? "application/vnd.ms-excel"
      : bookType === "csv" ? "text/csv;charset=utf-8"
      : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    saveBytes(bytes, filename, mime);
  }

  global.XLSX = {
    __compat: true,
    version: "compat-1.0 (xlsx-lite" + (global.BiffXls ? "+biff" : "") + ")",
    read: readSync,
    readAsync: readAsync,
    write: write,
    writeFile: writeFile,
    utils: {
      sheet_to_json: sheet_to_json,
      json_to_sheet: json_to_sheet,
      aoa_to_sheet: aoa_to_sheet,
      sheet_to_csv: sheet_to_csv,
      book_new: book_new,
      book_append_sheet: book_append_sheet,
      textToAoa: textToAoa
    }
  };
  if (typeof module !== "undefined" && module.exports) module.exports = global.XLSX;
})(typeof window !== "undefined" ? window : globalThis);
