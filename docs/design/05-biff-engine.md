# 05. biff.js — 구형 엑셀(.xls, BIFF8) 읽기/쓰기 엔진

작성일 2026-09-06 · 대상 파일 `/home/user/dfsdd/biff.js` (879줄, 외부 의존성 0) · 테스트 `/home/user/dfsdd/tools/test-biff.js` (`npm run test:biff`)

## 0. 왜 필요한가

수집 프로그램이 주는 원본 소스 파일은 **BIFF8 `.xls`**(엑셀 97-2003 형식)이고, 주문 처리 뒤 송장을 올리려고 내보내는 파일도 같은 36열 양식이어야 합니다. 기존 앱은 `index.html`에서 `biff.js`를 로드하고 `xlsx-compat.js`가 `window.BiffXls`를 부르도록 짜여 있었지만 **파일 자체가 없어서** `.xls`를 읽지도 쓰지도 못했습니다(03-source-adapter-spec.md 에서 확인한 사실). 이 문서는 그 빈자리를 채운 엔진의 API·검증 결과·한계를 정리합니다.

## 1. API (xlsx-lite.js 와 같은 모양)

브라우저에서는 `window.BiffXls`, node 에서는 `require("./biff.js")`. 둘 다 같은 객체입니다.

| 함수 | 설명 |
|---|---|
| `read(data)` | `ArrayBuffer`/`Uint8Array`/node `Buffer` → `{ names, sheet(name), has(name), pick([후보]), pickName([후보]), biff }`. **동기** 함수(xlsx-lite 의 `read` 는 압축 해제 때문에 Promise). `xlsx-compat.js` 는 `Promise.resolve().then(() => BiffXls.read(...))` 로 감싸므로 그대로 호환됩니다. |
| `readAsync(data)` | 같은 결과를 Promise 로. xlsx-lite 와 코드 모양을 맞추고 싶을 때. |
| `sheet(name)` | 2차원 배열. 셀은 **문자열 또는 숫자**. 날짜 서식 셀은 `'YYYY-MM-DD HH:mm'` 문자열(시·분이 0이면 `'YYYY-MM-DD'`) — xlsx-lite 의 `serialToString` 과 같은 규칙, 1900 체계(DATEMODE 1904 파일은 1462일 보정). 빈 셀은 `""`, 각 행은 그 행의 마지막 셀까지만 채움(xlsx-lite 와 동일). BOOL 은 `"TRUE"/"FALSE"`, 오류는 `"#N/A"` 등. |
| `pick([후보])` / `pickName` | 시트 이름을 공백 제거·소문자로 정규화해 정확 일치 → 부분 일치 순으로 찾음(xlsx-lite 와 동일 로직). |
| `buildBytes(sheets)` | `[{ name, rows:[[셀,...],...], cols?:[{w, hidden}], freeze?:{row, col} }]` → `Uint8Array`(.xls 파일 바이트). 셀 = 문자열 \| 숫자 \| `Date` \| boolean \| `{ v, s? }`. `s` 는 xlsx-lite 의 `STYLE_INDEX` 이름(`header/title/subhead`→굵게, `date`, `datetime`, `int/money/money0/…`→`#,##0`, `pct`, `pct2`). `{v, f}` 의 수식 `f` 는 무시하고 값만 씁니다. |
| `write(sheets)` | 위 바이트를 `Blob("application/vnd.ms-excel")` 로. |
| `isCfb(bytes)` | `D0 CF 11 E0 A1 B1 1A E1` 시그니처 확인. |
| `serialToString`, `dateToSerial`, `STYLE_INDEX` | 보조 함수. |

앱에서 실제로 쓰는 경로(확인): `xlsx-compat.readAsync(bytes)` → CFB 시그니처면 `BiffXls.read` → `{SheetNames, Sheets:{"!aoa"}}` / `xlsx-compat.write(wb, {bookType:"xls"})` → `BiffXls.buildBytes`. node 에서 세 파일을 함께 로드해 `.xls` 읽기 → `sheet_to_json` → `write(bookType:"xls")` → 다시 읽기까지 통과했습니다.

## 2. 내부 구조

### 읽기
1. **CFB 컨테이너**: 헤더(섹터 크기·미니섹터 크기·FAT 수·디렉터리 시작·미니스트림 컷오프 4096·MiniFAT·DIFAT) → DIFAT(헤더 109개 + DIFAT 섹터 체인) → FAT 전체 → 디렉터리(128바이트 엔트리, UTF-16LE 이름) → `Workbook` 또는 `Book` 스트림. 스트림이 4096바이트 미만이면 Root Entry 의 미니스트림 + MiniFAT 로 읽습니다. 잘린 파일·순환 체인은 0 채움/횟수 제한으로 방어.
2. **전역(워크북) 레코드**: BOF(BIFF 버전), CODEPAGE, DATEMODE, BOUNDSHEET8(시트 이름·오프셋·종류; 이름은 압축 유니코드/UTF-16LE 둘 다), FORMAT(사용자 서식 문자열), XF(서식 번호만 보관), SST(+CONTINUE), FILEPASS(암호 → 명확한 오류). EOF 에서 종료(깊이 추적).
3. **SST/CONTINUE**: 청크 목록을 하나의 커서로 읽습니다. 문자 배열 중간에서 CONTINUE 로 넘어가면 첫 바이트를 새 압축 플래그로 해석하고, rich-text 런(`cRun×4`)과 확장 데이터(`cbExt`)는 청크 경계를 넘어 건너뜁니다.
4. **시트 레코드**: BOUNDSHEET 오프셋에서 BOF 확인 후 EOF 까지. 시트 안에 포함된 차트 서브스트림(BOF/EOF 중첩)은 무시. LABELSST, LABEL/RSTRING, NUMBER, RK(4종: 정수/실수 × ÷100), MULRK, BOOLERR, FORMULA(숫자 결과 / 캐시된 bool·오류 / 문자열은 뒤따르는 STRING 레코드), BLANK·MULBLANK·DIMENSIONS·ROW 는 무시.
5. **날짜 판정**: XF 의 서식 번호가 내장 14~22, 27~36(동아시아 로캘 날짜 — xlsx-lite 에는 없는 확장), 45~47 이거나, 사용자 서식에서 `[...]`·`"..."`·`\x` 를 뺀 뒤 `y/m/d/h/s` 가 있고 숫자 서식 문자만으로 이뤄지지 않은 경우.
6. **BIFF5(엑셀 95)**: 바이트 문자열을 CODEPAGE(949→euc-kr 등) 로 `TextDecoder` 디코딩하는 최선 시도. 검증 파일은 없음(추정 수준).

### 쓰기
- 전역: BOF(0x0600, dt=5) → CODEPAGE 1200 → WINDOW1 → DATEMODE 1900 → FONT×5(0~3 기본 + 5번 굵게, `맑은 고딕`, charset 129) → FORMAT 164 `yyyy-mm-dd hh:mm`, 165 `yyyy-mm-dd` → XF 0~14 스타일 XF + 15 기본 셀 XF + 16~22 앱 서식 XF → STYLE(Normal) → BOUNDSHEET8×n(오프셋은 시트 본문 길이를 계산한 뒤 채움) → [SST+CONTINUE] → EOF.
- 시트: BOF(dt=0x10) → [COLINFO] → DIMENSIONS → 행마다 ROW + 셀(NUMBER / LABEL 인라인 UTF-16LE grbit=1) → WINDOW2(첫 시트 활성) → [PANE 틀고정] → EOF.
- **문자열 255자 이하는 LABEL 인라인(SST 없음)**. 256자 이상(긴 구매링크·메모 등)만 SST/LABELSST 로 보내고, SST 는 8224바이트 단위로 CONTINUE 분할(문자 중간 분할 시 압축 플래그 바이트 삽입). 32,767자 초과는 잘라냄.
- CFB: 섹터 512, `Workbook` 스트림을 4096바이트 이상으로 패딩해 **항상 일반 섹터**에 두고(미니스트림 안 씀), FAT 109개 초과분은 DIFAT 섹터로. 디렉터리 4엔트리(Root Entry + Workbook + 빈 2개). ROW·WINDOW2·BOF·WINDOW1 바이트는 xlwt 산출물과 같은 배치를 씁니다(확인).
- 값 정규화: `""`/`null`/`undefined`/`NaN`/`Infinity` → 셀 생략, boolean → `"TRUE"/"FALSE"` 문자열, `Date` → 직렬값 + datetime XF, 제어문자(탭·줄바꿈 제외) 제거, 시트명은 `\ / ? * [ ] :` 치환·31자·중복 번호.
- 한계 초과는 **조용히 자르지 않고 오류**: 시트당 65,536행 초과, 256열 초과 → "`.xlsx` 로 내보내 주세요" 메시지.

## 3. 검증 결과 (node v22.22.2, xlrd 2.0.2, xlwt 1.3.0 · `tools/test-biff.js` 54/54 통과)

| # | 항목 | 결과 |
|---|---|---|
| (a) | 수집 프로그램 샘플 `e72cef32-____.xls`(엑셀이 저장한 BIFF8, SST·XFEXT·STYLEEXT 등 최신 레코드 포함) | 시트 `2026-09-07` 1개, 헤더 36열이 상수와 **바이트 단위로 동일**(28번째 열의 전각 공백 U+3000 포함), 데이터 0행, xlrd 와 동일 |
| (b) | 9월 워크북 `2.주문서` 를 xlsx-lite 로 읽어 헤더 행 + 29행 × 앞 36열을 합성(이름·전화·주소·주문번호·계정·카드·송장 등 15개 열을 생성값으로 치환) → `.xls` 쓰기 → **xlrd 로 읽어 30행 × 36열 값 전부 동일** | 통과 (문자열·숫자·`YYYY-MM-DD HH:mm` 문자열 혼합) |
| (c) | 같은 데이터 write → read 왕복 | 값·시트명·타입(숫자는 number, 문자열은 string) 보존 |
| (d) | xlwt 참조 파일: 날짜 XF(`yyyy-mm-dd hh:mm`, `m/d/yy`, `[$-412]yyyy"년"…`), RK 4종 경계값(±2^30), MULRK, BOOL, 수식(숫자·문자열 결과), 300자 문자열, 이모지, 400행 유일 문자열로 SST 가 CONTINUE 에 걸친 둘째 시트 | 두 시트 모두 xlrd 와 동일. 읽은 것을 우리 엔진으로 다시 써도 xlrd 동일 |
| (e) | 쓰기 경계: 256자(LABELSST)·8,500자+(CONTINUE) 문자열, `Date`, 스타일 직렬값, `=1+1`(문자열 그대로 — 수식 인젝션 없음), 줄바꿈·탭, boolean/null, 0·1e21·최대 실수, NaN/Infinity, 제어문자, 금지 시트명, 빈 시트, 틀고정·열 너비 | 자체 왕복 + xlrd 동일 |
| 크기 | 5,000행 × 36열(4.4MB) 왕복 + xlrd 동일 · 40,000행 × 36열(34.9MB, FAT 558개·DIFAT 4개) 자체 왕복 불일치 0 + xlrd 40,001행 읽음 | 통과 |
| 속도 | 1,000행 쓰기 135ms/읽기 21ms · 5,000행 쓰기 869ms/읽기 53ms · 40,000행 쓰기 9.5s/읽기 0.7s (node 기준) | 실사용 규모(월 수백~수천 건)에서 문제 없음 |
| 통합 | `xlsx-lite.js + biff.js + xlsx-compat.js` 를 함께 로드해 `XLSX.readAsync(.xls)` → `sheet_to_json` 24행/36열 → `XLSX.write(bookType:"xls")` → 재읽기 | 통과. `window.BiffXls` 노출 확인(`globalThis.window` 시뮬레이션) |

검증 기준은 **xlrd** 입니다(이 환경에 LibreOffice·엑셀 없음). 엑셀 본체에서 여는 것은 아직 확인하지 못했습니다(아래 한계 참고).

## 4. 한계와 주의

1. **엑셀/수집 프로그램에서 실제로 열어 보는 확인이 남았습니다(추정).** xlrd 는 관대한 파서라 xlrd 통과 = 엑셀 통과가 아닙니다. 위험을 줄이려고 레코드 순서·XF 16개·FONT 5개·ROW/WINDOW2 바이트를 엑셀이 여는 것으로 알려진 xlwt 산출물과 같게 맞췄지만, 사용자에게 **첫 실전 파일은 엑셀에서 한 번 열어 보고 수집 프로그램에 올리라고** 안내해야 합니다. 문제가 생기면 xlwt 로 만든 `sample/소스샘플_36열.xls` 와 바이트 비교로 좁힐 수 있습니다.
2. 읽기는 **값만** 가져옵니다. 서식·색·취소선·메모(NOTE)·병합·숨김·수식 원문은 버립니다(앱은 값만 쓰므로 충분). 9월 워크북처럼 "글씨색 회색 = 역마진" 식 서식 의미는 `.xls` 에서도 읽히지 않습니다.
3. 쓰기는 **최소 구조**입니다: 굵게/날짜/숫자 서식/열 너비/틀고정만. 셀 색·테두리·드롭다운·조건부서식(xlsx-lite 가 지원하는 것들)은 `.xls` 에 안 들어갑니다. 36열 송장 업로드 파일에는 필요 없는 항목입니다.
4. 문자열 셀 255자 이하는 LABEL 인라인, 초과분만 SST — 파일이 xlwt/엑셀보다 조금 클 수 있습니다(문자열 중복 제거 안 함). 40,000행 기준 35MB.
5. 날짜는 읽을 때 문자열로 바뀝니다. 앱이 `.xls` 의 날짜 열을 그대로 다시 내보내면 **문자열 셀**로 나갑니다(xlsx 경로와 동일한 동작). 수집 프로그램이 날짜 열을 날짜형으로 요구하는지는 확인 필요(추정: 원본 열은 원문 그대로 되돌리는 것이라 문제 없을 가능성이 큼).
6. BIFF5(엑셀 95)·BIFF2~4·암호 파일·`.xlsb` 는 지원하지 않습니다(암호는 명확한 오류 메시지). BIFF5 는 코드가 있으나 검증 파일이 없어 **추정** 수준입니다.
7. 시트당 65,536행·256열 한계는 형식 자체의 제한이며 초과 시 오류로 알립니다.
8. 브라우저 검증은 node 에서 `window` 를 흉내 내 확인한 것이고, 실제 Chrome/Safari 실행은 하지 않았습니다. 사용한 API 는 `DataView`/`TextDecoder("utf-16le")`/`Blob` 뿐이라 최신 브라우저에서 문제될 소지는 낮습니다(추정).

## 5. 저장소 상태

- `biff.js` 는 병렬 세션의 커밋 `b2cddad`(17:26) 에 함께 들어갔습니다(이 작업에서는 커밋하지 않음). 그 뒤 DIFAT 지원(7MB 초과 파일)을 추가했으므로 현재 작업 트리의 `biff.js` 가 커밋본보다 최신입니다.
- `package.json` 에 `test:biff` 스크립트 추가. `tools/test-biff.js` 는 업로드 경로가 없으면 해당 절을 건너뛰고, xlrd/xlwt 가 없으면 비교만 생략합니다(환경변수 `BIFF_SAMPLE`, `BIFF_WORKBOOK`, `BIFF_TMP` 로 경로 지정 가능).
- 테스트가 만드는 파일은 모두 합성 데이터이며 임시 폴더에만 씁니다. 저장소에는 개인정보가 담긴 파일이 추가되지 않았습니다.
