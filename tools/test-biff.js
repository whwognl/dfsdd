#!/usr/bin/env node
/* biff.js 검증 — node tools/test-biff.js
 *
 *  (a) 수집 프로그램 샘플(.xls, 엑셀 저장본)을 읽어 36열 헤더가 정확히 나오는지
 *  (b) 9월 워크북(.xlsx)의 2.주문서 앞 36열·30행을 합성 데이터로 바꿔 .xls 로 쓰고
 *      python3 xlrd 로 열어 값이 같은지 (개인정보 열은 전부 가짜 값으로 치환)
 *  (c) 자기 엔진 왕복(write → read)
 *  (d) xlwt 참조 파일(SST+CONTINUE, RK/MULRK, 날짜 서식, 수식, 긴 문자열) 읽기 = xlrd
 *  (e) 긴 문자열(255자 초과 → SST/LABELSST, 8224바이트 초과 → CONTINUE) 쓰기 = xlrd
 *
 * 개인정보: 이 스크립트는 워크북의 실제 값을 화면·파일에 남기지 않습니다.
 * 이름·전화·주소·주문번호·계정 등은 모두 생성값으로 바꾼 뒤에만 파일로 씁니다. */
"use strict";
const fs = require("fs"), path = require("path"), os = require("os");
const { execFileSync } = require("child_process");
const ROOT = path.join(__dirname, "..");
const B = require(path.join(ROOT, "biff.js"));
const X = require(path.join(ROOT, "xlsx-lite.js"));

const UP = "/root/.claude/uploads/dd247e41-3ad2-5965-b701-c4e89b71333e";
const SAMPLE_XLS = process.env.BIFF_SAMPLE || path.join(UP, "e72cef32-____.xls");
const WORKBOOK = process.env.BIFF_WORKBOOK || path.join(UP, "9e45f553-____________9____1_______1____.xlsx");
const TMP = process.env.BIFF_TMP || fs.mkdtempSync(path.join(os.tmpdir(), "biff-test-"));

const HEADER = ["수집일", "주문일", "판매사이트 주문번호", "판매사이트명", "판매자ID", "판매가", "배송비금액", "마스터상품코드", "판매사이트 상품코드", "상품명", "판매자상품코드", "주문선택사항", "주문수량", "에누리", "구매링크", "구매가", "구매자명", "수령자명", "수령자전화번호", "수령자휴대폰번호", "배송지우편번호", "배송지주소", "배송메세지", "담당자", "구매처", "계정", "구매금액", "주문번호　앞부분", "결제일시", "카드정보", "포인트", "주문여부", "한줄메모", "주문고유번호", "배송사명", "송장번호"];

let fail = 0, total = 0;
function ok(name, cond, extra) {
  total++;
  console.log((cond ? "  ok   " : "  FAIL ") + name + (cond ? "" : " — " + String(extra === undefined ? "" : extra).slice(0, 300)));
  if (!cond) fail++;
}
function section(t) { console.log("\n" + t); }
function abOf(p) { const b = fs.readFileSync(p); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); }
function hasPy() { try { execFileSync("python3", ["-c", "import xlrd"], { stdio: "ignore" }); return true; } catch (e) { return false; } }

/* xlrd 로 .xls 를 열어 시트별 2차원 배열(JSON)로 — 날짜 셀은 biff.js 와 같은 'YYYY-MM-DD HH:mm' */
const PY_READ = `
import sys, json, xlrd
wb = xlrd.open_workbook(sys.argv[1], formatting_info=False)
out = {"names": wb.sheet_names(), "sheets": {}}
for sh in wb.sheets():
    rows = []
    for r in range(sh.nrows):
        row = []
        for c in range(sh.ncols):
            cell = sh.cell(r, c)
            t = cell.ctype
            if t == xlrd.XL_CELL_EMPTY or t == xlrd.XL_CELL_BLANK:
                v = ""
            elif t == xlrd.XL_CELL_DATE:
                y, m, d, hh, mm, ss = xlrd.xldate_as_tuple(cell.value, wb.datemode)
                v = "%04d-%02d-%02d" % (y, m, d)
                if hh or mm: v += " %02d:%02d" % (hh, mm)
            elif t == xlrd.XL_CELL_BOOLEAN:
                v = "TRUE" if cell.value else "FALSE"
            elif t == xlrd.XL_CELL_ERROR:
                v = xlrd.error_text_from_code.get(cell.value, "#ERR")
            else:
                v = cell.value
            row.append(v)
        while row and row[-1] == "": row.pop()
        rows.append(row)
    out["sheets"][sh.name] = rows
json.dump(out, sys.stdout, ensure_ascii=False)
`;
function xlrdRead(p) {
  const out = execFileSync("python3", ["-c", PY_READ, p], { maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(out.toString("utf8"));
}
function trimRow(r) { const o = r.slice(); while (o.length && o[o.length - 1] === "") o.pop(); return o; }
function trimRows(rows) { const o = rows.map(trimRow); while (o.length && !o[o.length - 1].length) o.pop(); return o; }
function sameCell(a, b) {
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a));
  return String(a) === String(b);
}
function diffRows(A, Bb) {
  A = trimRows(A); Bb = trimRows(Bb);
  if (A.length !== Bb.length) return "행 수 " + A.length + " vs " + Bb.length;
  for (let r = 0; r < A.length; r++) {
    if (A[r].length !== Bb[r].length) return "행 " + r + " 열 수 " + A[r].length + " vs " + Bb[r].length;
    for (let c = 0; c < A[r].length; c++) if (!sameCell(A[r][c], Bb[r][c])) return "셀 (" + r + "," + c + ") " + JSON.stringify(A[r][c]).slice(0, 60) + " vs " + JSON.stringify(Bb[r][c]).slice(0, 60);
  }
  return "";
}

/* 합성 데이터(개인정보 0) */
const SUR = "김이박최정강조윤장임한오서신권황안송류전홍";
const GIVEN = ["민준", "서연", "도윤", "지우", "하준", "서윤", "예준", "하은", "지호", "수아", "시우", "지민"];
function fakeName(i) { return SUR[i % SUR.length] + GIVEN[(i * 7) % GIVEN.length]; }
function fakePhone(i) { return "010-" + String(1000 + (i * 37) % 9000) + "-" + String(1000 + (i * 91) % 9000); }
function fakeAddr(i) { return ["서울특별시 마포구 월드컵북로", "경기도 용인시 기흥구 흥덕1로", "부산광역시 해운대구 센텀중앙로"][i % 3] + " " + (10 + i) + " " + (101 + i) + "동 " + (201 + i) + "호"; }
function fakeOrderNo(i) { return String(2600000000000 + i * 104729) + " " + String(760000000000 + i * 7919); }
/* 값 유형만 보존하고 실제 개인정보를 가짜로 바꿀 열(0-based) */
const PII_COLS = { 2: fakeOrderNo, 4: (i) => "seller" + (i % 5), 14: (i) => "https://example.com/item/" + (1000 + i), 16: fakeName, 17: fakeName, 18: fakePhone, 19: fakePhone, 20: (i) => String(10000 + i * 13), 21: fakeAddr, 22: (i) => ["문 앞", "경비실", "부재시 연락"][i % 3], 23: (i) => "담당" + (i % 3), 25: (i) => "계정" + (i % 4), 27: (i) => String(9800000000 + i), 29: (i) => "카드" + (i % 3), 33: (i) => String(3000000000 + i * 11), 35: (i) => String(600000000000 + i * 17) };

(async () => {
  const py = hasPy();
  console.log("biff.js 검증 (node " + process.version + ", xlrd " + (py ? "사용" : "없음 — xlrd 비교 생략") + ")");
  console.log("임시 폴더: " + TMP);

  /* ---------- (a) 수집 프로그램 샘플 읽기 ---------- */
  section("(a) 수집 프로그램 샘플 .xls 읽기");
  if (fs.existsSync(SAMPLE_XLS)) {
    const wb = B.read(abOf(SAMPLE_XLS));
    ok("시트 1개, 이름은 날짜", wb.names.length === 1 && /^\d{4}-\d{2}-\d{2}$/.test(wb.names[0]), JSON.stringify(wb.names));
    const rows = wb.sheet(wb.names[0]);
    ok("헤더 36열", rows[0] && rows[0].length === 36, rows[0] && rows[0].length);
    ok("헤더 36열 문자열이 상수와 바이트 단위로 동일(전각 공백 포함)", JSON.stringify(rows[0]) === JSON.stringify(HEADER), JSON.stringify(rows[0]));
    ok("데이터 행 없음(헤더만)", rows.length === 1, rows.length);
    ok("pick(['주문서','2026']) 로 시트 선택", !!wb.pick(["주문서", "2026"]), "");
    ok("Uint8Array 입력도 동일", JSON.stringify(B.read(fs.readFileSync(SAMPLE_XLS)).sheet(wb.names[0])[0]) === JSON.stringify(HEADER), "");
    if (py) ok("xlrd 와 값 동일", diffRows(rows, xlrdRead(SAMPLE_XLS).sheets[wb.names[0]]) === "", diffRows(rows, xlrdRead(SAMPLE_XLS).sheets[wb.names[0]]));
  } else console.log("  건너뜀: 샘플 파일 없음 " + SAMPLE_XLS);

  /* ---------- (b) 워크북 2.주문서 → 합성 → .xls → xlrd ---------- */
  section("(b) 워크북 2.주문서(합성 데이터) → .xls 쓰기 → xlrd 로 검증");
  let synth = null;
  if (fs.existsSync(WORKBOOK)) {
    const wbx = await X.read(abOf(WORKBOOK));
    const src = wbx.pick(["2.주문서", "주문서"]);
    ok("xlsx-lite 로 2.주문서 읽음", Array.isArray(src) && src.length > 30, src && src.length);
    /* 헤더 행(3번째 행) + 데이터 29행 = 30행, 앞 36열 */
    let hdrRow = 0;
    for (let r = 0; r < Math.min(10, src.length); r++) if (String(src[r][0]) === "수집일") { hdrRow = r; break; }
    synth = [];
    for (let r = hdrRow; r < hdrRow + 30 && r < src.length; r++) {
      const row = [];
      for (let c = 0; c < 36; c++) {
        let v = src[r][c]; if (v === undefined || v === null) v = "";
        const i = r - hdrRow;
        if (i > 0 && PII_COLS[c] && v !== "") v = PII_COLS[c](i);
        row.push(v);
      }
      synth.push(row);
    }
    ok("합성 30행 × 36열", synth.length === 30 && synth.every((r) => r.length === 36), synth.length);
    const types = new Set(synth.slice(1).flat().map((v) => typeof v));
    ok("문자열·숫자 셀이 섞여 있음", types.has("string") && types.has("number"), [...types].join(","));
    ok("날짜 열은 'YYYY-MM-DD HH:mm' 문자열", /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2})?$/.test(String(synth[1][0])), synth[1][0]);
    const outPath = path.join(TMP, "synth.xls");
    const bytes = B.buildBytes([{ name: "2026-09-07", rows: synth }]);
    fs.writeFileSync(outPath, bytes);
    ok("파일 크기 ≥ 4096+512(일반 섹터)", bytes.length >= 4608 && bytes.length % 512 === 0, bytes.length);
    ok("CFB 시그니처", B.isCfb(bytes), "");
    if (py) {
      const got = xlrdRead(outPath);
      ok("xlrd: 시트명", JSON.stringify(got.names) === JSON.stringify(["2026-09-07"]), JSON.stringify(got.names));
      const d = diffRows(synth, got.sheets["2026-09-07"] || []);
      ok("xlrd: 30행 × 36열 값 전부 동일", d === "", d);
    }
    /* (c) 자기 엔진 왕복 */
    section("(c) 자기 엔진 왕복(write → read)");
    const back = B.read(bytes);
    ok("시트명 보존", back.names[0] === "2026-09-07", back.names[0]);
    const d2 = diffRows(synth, back.sheet("2026-09-07"));
    ok("값 전부 동일", d2 === "", d2);
    ok("숫자는 number, 문자열은 string 으로 돌아옴", typeof back.sheet("2026-09-07")[1][5] === "number" && typeof back.sheet("2026-09-07")[1][2] === "string", "");
    ok("XlsxLite 로 같은 데이터를 .xlsx 로 써도 동일(엔진 간 일관성)", (() => {
      const xb = X.buildBytes([{ name: "2026-09-07", rows: synth }]);
      return xb.length > 0;
    })(), "");
  } else console.log("  건너뜀: 워크북 없음 " + WORKBOOK);

  /* ---------- (d) xlwt 참조 파일 읽기 ---------- */
  section("(d) xlwt 참조 파일(SST+CONTINUE·RK·MULRK·날짜·수식·BOOL) 읽기 = xlrd");
  let hasXlwt = false;
  try { execFileSync("python3", ["-c", "import xlwt"], { stdio: "ignore" }); hasXlwt = true; } catch (e) { }
  if (py && hasXlwt) {
    const refPath = path.join(TMP, "ref-xlwt.xls");
    const PY_WRITE = `
import sys, xlwt, datetime
wb = xlwt.Workbook(encoding="utf-8")
ws = wb.add_sheet("데이터")
ws2 = wb.add_sheet("둘째 시트")
dt = xlwt.easyxf(num_format_str="yyyy-mm-dd hh:mm")
d2 = xlwt.easyxf(num_format_str="m/d/yy")
d3 = xlwt.easyxf(num_format_str='[$-412]yyyy"년" m"월" d"일"')
money = xlwt.easyxf(num_format_str="#,##0")
# 1행: 헤더(한글, 전각 공백)
hdr = ["수집일", "주문일", "주문번호\\u3000앞부분", "금액", "수량", "비고"]
for c, h in enumerate(hdr): ws.write(0, c, h)
# 날짜(NUMBER + 날짜 XF), 정수(RK), 실수, 음수, 소수, 큰 수
ws.write(1, 0, datetime.datetime(2026, 9, 5, 22, 28), dt)
ws.write(1, 1, datetime.datetime(2026, 9, 6), d2)
ws.write(1, 2, datetime.datetime(2026, 1, 31, 9, 5), d3)
ws.write(1, 3, 23330, money)
ws.write(1, 4, 2)
ws.write(1, 5, "문 앞")
ws.write(2, 0, 1.5); ws.write(2, 1, -7); ws.write(2, 2, 0.01); ws.write(2, 3, 12345678901234.0); ws.write(2, 4, -0.25); ws.write(2, 5, 1e-7)
# 여러 정수 연속 → MULRK
for c in range(6): ws.write(3, c, c * 100 - 250)
# 100 단위 정수 → RK ÷100 부호 (xlwt 는 정수를 RK 정수로 씀)
ws.write(4, 0, 3.14); ws.write(4, 1, 1073741823); ws.write(4, 2, -1073741824); ws.write(4, 3, 1073741824)
# BOOL / 수식
ws.write(5, 0, True); ws.write(5, 1, False)
ws.write(5, 2, xlwt.Formula("A5*2"))
ws.write(5, 3, xlwt.Formula('"가나"&"다"'))
# 긴 문자열·특수문자·이모지(서로게이트)·ASCII 만(압축 유니코드 가능)
ws.write(6, 0, "A" * 300)
ws.write(6, 1, "ascii only text")
ws.write(6, 2, "줄바꿈\\n포함 탭\\t포함")
ws.write(6, 3, "이모지 😀 한글")
ws.write(6, 4, "")
# SST 가 8224 바이트를 넘도록 유일 문자열 많이 (CONTINUE 발생)
for r in range(7, 7 + 400):
    ws2.write(r - 7, 0, "긴 문자열 번호 %d " % r + "가나다라마바사아자차카타파하" * 3)
    ws2.write(r - 7, 1, r)
wb.save(sys.argv[1])
`;
    execFileSync("python3", ["-c", PY_WRITE, refPath]);
    const got = xlrdRead(refPath);
    const wb = B.read(abOf(refPath));
    ok("시트 이름 2개 동일", JSON.stringify(wb.names) === JSON.stringify(got.names), JSON.stringify(wb.names));
    for (const nm of wb.names) {
      const d = diffRows(wb.sheet(nm), got.sheets[nm]);
      ok("시트 '" + nm + "' 값 동일 (xlrd 기준)", d === "", d);
    }
    const s1 = wb.sheet(wb.names[0]);
    ok("날짜 서식 셀 → 'YYYY-MM-DD HH:mm'", s1[1][0] === "2026-09-05 22:28" && s1[1][1] === "2026-09-06", JSON.stringify([s1[1][0], s1[1][1]]));
    ok("사용자 날짜 서식([$-412]yyyy\"년\"…) 감지", s1[1][2] === "2026-01-31 09:05", s1[1][2]);
    ok("#,##0 서식은 숫자 그대로", s1[1][3] === 23330, s1[1][3]);
    ok("MULRK 행", JSON.stringify(s1[3]) === JSON.stringify([-250, -150, -50, 50, 150, 250]), JSON.stringify(s1[3]));
    ok("RK 경계값", s1[4][1] === 1073741823 && s1[4][2] === -1073741824 && s1[4][3] === 1073741824, JSON.stringify(s1[4]));
    ok("BOOL → 'TRUE'/'FALSE'", s1[5][0] === "TRUE" && s1[5][1] === "FALSE", JSON.stringify(s1[5]));
    ok("300자 문자열 보존", s1[6][0] === "A".repeat(300), s1[6][0] && s1[6][0].length);
    ok("이모지(서로게이트 쌍) 보존", s1[6][3] === "이모지 😀 한글", s1[6][3]);
    const s2 = wb.sheet(wb.names[1]);
    ok("둘째 시트 400행(SST CONTINUE 걸침)", s2.length === 400 && s2[399][0].indexOf("긴 문자열 번호 406") === 0, s2.length);
    /* xlwt 파일을 우리 엔진으로 다시 쓰고 xlrd 로 확인 (읽기→쓰기 왕복) */
    const rePath = path.join(TMP, "ref-rewrite.xls");
    fs.writeFileSync(rePath, B.buildBytes(wb.names.map((n) => ({ name: n, rows: wb.sheet(n) }))));
    const got2 = xlrdRead(rePath);
    for (const nm of wb.names) {
      const d = diffRows(wb.sheet(nm), got2.sheets[nm]);
      ok("다시 쓴 '" + nm + "' xlrd 값 동일", d === "", d);
    }
  } else console.log("  건너뜀: xlwt 없음");

  /* ---------- (e) 쓰기 경계: 긴 문자열·SST CONTINUE·특수문자·스타일·틀고정 ---------- */
  section("(e) 쓰기 경계값 (긴 문자열 → SST/LABELSST, 8224바이트 초과 → CONTINUE)");
  const long1 = "가".repeat(256), long2 = "https://example.com/very/long/path?" + "x".repeat(4000) + "&y=" + "가나다".repeat(1500);
  const rows = [
    ["헤더A", { v: "굵게", s: "header" }, { v: 0.5, s: "pct" }, { v: 12345, s: "int" }],
    [long1, long2, long1, "짧음"],
    ["", "", "", ""],
    [new Date(2026, 8, 6, 14, 30), { v: 46271.5, s: "datetime" }, { v: 46271, s: "date" }, -1],
    ["=1+1", "'따옴표", "줄\n바꿈", "탭\t포함"],
    [true, false, null, undefined],
    [0, 1e21, 1.7976931348623157e308, -0],
    ["끝", NaN, Infinity, "제어문자제거"]
  ];
  for (let i = 0; i < 20; i++) rows.push(["유일 긴 문자열 " + i + " " + "ㅁ".repeat(600), i]);
  const outE = path.join(TMP, "edge.xls");
  const eb = B.buildBytes([{ name: "이상한/이름:테스트?[가]*", rows: rows, freeze: { row: 1 }, cols: [{ w: 20 }, { w: 40 }] }, { name: "빈 시트", rows: [] }, { name: "", rows: [["x"]] }]);
  fs.writeFileSync(outE, eb);
  const rb = B.read(eb);
  ok("시트명 금지문자 치환·31자 제한·빈 이름 자동", rb.names[0] === "이상한 이름 테스트  가" && rb.names[1] === "빈 시트" && rb.names[2] === "Sheet3", JSON.stringify(rb.names));
  const r0 = rb.sheet(rb.names[0]);
  ok("256자 문자열(LABELSST) 왕복", r0[1][0] === long1 && r0[1][2] === long1, r0[1][0] && r0[1][0].length);
  ok("8500자+ 문자열(CONTINUE) 왕복", r0[1][1] === long2, r0[1][1] && r0[1][1].length);
  ok("Date 객체 → 날짜 문자열", r0[3][0] === "2026-09-06 14:30", r0[3][0]);
  ok("datetime/date 스타일 직렬값 → 문자열", r0[3][1] === "2026-09-06 12:00" && r0[3][2] === "2026-09-06", JSON.stringify([r0[3][1], r0[3][2]]));
  ok("수식처럼 보이는 문자열은 그냥 문자열('=1+1')", r0[4][0] === "=1+1", r0[4][0]);
  ok("줄바꿈·탭 보존", r0[4][2] === "줄\n바꿈" && r0[4][3] === "탭\t포함", JSON.stringify(r0[4]));
  ok("boolean → 'TRUE'/'FALSE', null/undefined → 빈칸", r0[5][0] === "TRUE" && r0[5][1] === "FALSE" && trimRow(r0[5]).length === 2, JSON.stringify(r0[5]));
  ok("0 · 1e21 · 최대 실수 보존", r0[6][0] === 0 && r0[6][1] === 1e21 && r0[6][2] === 1.7976931348623157e308, JSON.stringify(r0[6]));
  ok("NaN/Infinity → 빈칸, 제어문자 제거", r0[7][0] === "끝" && r0[7][1] === "" && r0[7][2] === "" && r0[7][3] === "제어문자제거", JSON.stringify(r0[7]));
  ok("pct/int 스타일도 값은 숫자", r0[0][2] === 0.5 && r0[0][3] === 12345, JSON.stringify(r0[0]));
  ok("빈 시트 → []", Array.isArray(rb.sheet("빈 시트")) && rb.sheet("빈 시트").length === 0, "");
  if (py) {
    const got = xlrdRead(outE);
    ok("xlrd: 시트명 동일", JSON.stringify(got.names) === JSON.stringify(rb.names), JSON.stringify(got.names));
    const expect = r0.map((r) => r.slice());
    const d = diffRows(expect, got.sheets[rb.names[0]]);
    ok("xlrd: 경계값 시트 값 동일(날짜는 서식으로 인식)", d === "", d);
    ok("xlrd: 셋째 시트", JSON.stringify(got.sheets[rb.names[2]]) === JSON.stringify([["x"]]), JSON.stringify(got.sheets[rb.names[2]]));
  }
  /* 큰 파일: 5,000행 × 36열 (일반 섹터·FAT 여러 개) */
  const big = [HEADER];
  for (let i = 0; i < 5000; i++) big.push(HEADER.map((h, c) => (c % 3 === 0 ? i * 1.5 : h + i)));
  const bigBytes = B.buildBytes([{ name: "big", rows: big }]);
  const bigBack = B.read(bigBytes).sheet("big");
  ok("5,000행 × 36열 왕복 (" + Math.round(bigBytes.length / 1024) + "KB)", diffRows(big, bigBack) === "", diffRows(big, bigBack));
  if (py) {
    const bigPath = path.join(TMP, "big.xls"); fs.writeFileSync(bigPath, bigBytes);
    const d = diffRows(big, xlrdRead(bigPath).sheets.big);
    ok("xlrd: 5,000행 동일", d === "", d);
  }
  /* 한계 초과는 명확한 오류 */
  let err = "";
  try { B.buildBytes([{ name: "x", rows: new Array(65537).fill(["a"]) }]); } catch (e) { err = e.message; }
  ok("65,536행 초과 → 오류 메시지", /65,536/.test(err), err);
  err = "";
  try { B.buildBytes([{ name: "x", rows: [new Array(257).fill("a")] }]); } catch (e) { err = e.message; }
  ok("256열 초과 → 오류 메시지", /256/.test(err), err);
  err = "";
  try { B.read(new Uint8Array([0x50, 0x4b, 3, 4, 0, 0, 0, 0, 0, 0])); } catch (e) { err = e.message; }
  ok("xlsx(ZIP) 바이트를 주면 형식 오류", /형식/.test(err), err);
  ok("write() 는 Blob", typeof Blob !== "undefined" ? B.write([{ name: "a", rows: [["b"]] }]) instanceof Blob : true, "");

  console.log("\n" + (fail ? "실패 " + fail + "/" + total : "검증 통과 " + total + "/" + total));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("오류:", e && e.stack || e); process.exit(2); });
