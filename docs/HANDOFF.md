# 인수인계 (HANDOFF) — order-helper

작성 기준: 2026-09-23. 사람이 아닌 다음 작업자(사람·AI 모두)가 그대로 이어갈 수 있게 씁니다.

## 0. 한 줄 요약

구버전 앱(`app.js` 3,555줄 시절)의 구조를 유지한 채 ① 새 주문 수집 파일(36열 `.xls`) 입출력, ② 블랙리스트 자동 경고, ③ 한 줄 복사 툴바, ④ CS관리 확장, ⑤ 대시보드 개선, ⑥ **자동화 관제 데모(오토파일럿)** 를 얹었습니다. 저장소에 개인정보는 없습니다.

## 1. 사용자 요구의 역사 (중요)

1. 처음엔 9월 워크북(53열)을 기준으로 앱을 새로 짰다가 **거부**됐습니다("구버전 앱 구조를 바꾸지 마라"). 그 산출물은 `archive/v2-rebuild/` 에만 남겨 두고 쓰지 않습니다.
2. 확정된 방향: **구버전 앱이 기준**. 바뀐 것은 원본 소스(수집 파일) 양식뿐 → 36열 `.xls` 를 읽고, 송장 파일도 같은 36열로 내보낸다. 그 위에 작은 개선.
3. 그 다음 요청: "내부가 실제로 동작할 필요는 없다. 모든 게 자동으로 돌아가는 모습으로 비주얼 쇼크를 달라. 연매출 80억 페이스." → `demo.js` 자동화 관제. 데이터는 사용자가 준 운영 워크북에서 **패턴만**(개인정보 제외) 추출.

## 2. 파일 지도

| 파일 | 내용 | 손댈 때 주의 |
|---|---|---|
| `index.html` | 화면·전체 CSS(디자인 토큰은 `:root`). 스크립트 순서: `xlsx-lite → biff → xlsx-compat → copy-helpers → blacklist → rules → app → demo-data → demo` | 캐시 무효화 `?v=39` 를 같이 올릴 것 |
| `app.js` | 앱 본체(IIFE). 상태 `state`, localStorage 키 `oh_*_v1` | 렌더 함수는 pane 통째 innerHTML, 이벤트는 `init()` 에서 pane 단위 위임 1회 |
| `xlsx-compat.js` | SheetJS 모양의 API(`XLSX.readAsync`, `utils.*`, `writeFile`). ZIP 이면 xlsx-lite, CFB(D0CF11E0)면 biff.js, 그 외 텍스트 CSV | `bookType:"xls"` 는 `BiffXls.buildBytes` |
| `biff.js` | 의존성 0 의 `.xls`(BIFF8) 읽기/쓰기. 테스트 `tools/test-biff.js`(54항목, xlrd 대조) | 65,536행·256열 제한 |
| `blacklist.js` | 이름(마스킹 와일드카드)·주소(숫자 토큰 정확일치)·전화(뒤 8자리) 판정 | 행정구역만 겹치는 건 일치 아님 |
| `copy-helpers.js` | 주소 분리(도로명/지번/추정), 전화 형식(자릿수), 자동입력 페이로드 v2 | 전화는 항상 '내 번호' |
| `demo.js` | 관제 데모 엔진+화면. `window.Demo` | 아래 4절 |
| `demo-data.js` | `tools/make-demo-data.py` 산출. 상품·가격·구매처·택배사·지역·시간대·CS 비율 | 개인정보 넣지 말 것. 구매처 상호까지 가리려면 `--anon-vendors` 옵션 |
| `tools/` | `smoke.js`(Playwright 전체 흐름) · `demo-smoke.js` · `verify-export.js` · `test-biff.js` · `test-copy.js` | 모두 `node tools/<파일>` |
| `docs/design/` | 01 구앱 지도 · 02 CS 사례 분석 · 03 소스 어댑터 스펙 · 04 원클릭 복사 스펙 · 05 BIFF 엔진 · `mock/` 관제 화면 목업(HTML) | 보고서에 개인정보 없음 |

## 3. app.js 에서 이번에 추가·변경된 곳 (검색어)

- **36열 입력**: `FIELDS`(별칭 36개), `SOURCE_HEADERS`, `autoMap`(위치 감지 → 정확일치 → 부분일치+거부어), `buildOrders`, `keyOf`(주문고유번호 우선, 옛 조합키 폴백), `mergeOrders`/`finalizeOrders`(#opt-merge 체크 시 합치기).
- **36열 출력**: `sourceRow`, `exportSource(type)`, `SOURCE_NUMERIC`(금액·수량은 숫자형), `courierToCode`, `invoiceExcluded`.
- **마진식**: `computeMargin` — 워크북식 `(판매가+배송비)×(1−율×1.1) − 매입 − 에누리 − CS ÷ 1.1`.
- **블랙리스트**: `computeRisk`, `riskOrders`, `showRiskModal`, `renderBlacklistPane`, `addToBlacklist`, 탭 `blacklist`.
- **복사 툴바**: `renderCopyBar`, `copyPiece`, `SEQ_PRESETS`, `getAutofillPhone`(내 번호 없으면 차단).
- **CS 확장**: `CS_TYPES/CS_STEPS/CS_WAIT/CS_LEDGER_KINDS/CS_TEMPLATES_DEFAULT`, 주문의 `o.cs{steps, waitingOn, ledger, pickup, supplierClaim, nextAction…}`, `csOpen/csSync/csBucket/renderCsPane/csDetailHtml`.
- **대시보드**: `renderTodoPanel`(오늘 할 일, `data-dash-go`), `periodStats`, `renderPeriodTable`, `renderRecentDailyTable`, `dashGo`.
- **데모 연결점**: `demoOn()`, `persist/saveUiOnly/saveSourcingMap` 의 데모 차단, `nowDate()`(데모 시계), `dailySalesRows/monthlyStats/overviewStats/renderSummary/renderOrdersDashboard/periodStats` 의 오버레이, `renderTabs` 의 `autopilot` 탭, `render()` 의 `Demo.renderPane()`, 끝부분 `window.OH`(내부 API).

## 4. 데모 엔진(demo.js) 구조

- `Demo.start()`: 실제 `state`(orders/ops/sourcingMap/blacklist/ui/deleted)를 JSON 스냅샷으로 보관 → 빈 상태 + 합성 블랙리스트 3건 → 420일 과거 집계 생성(`buildHistory`, 최근 4주 평균 × 1.012 ≈ 81억 페이스 — 딱 100.0% 로 보이지 않게) → 오늘 지난 시간만큼 채움(`prefillToday`: 최근 140건은 실제 주문 객체, 나머지는 집계 기준선) → 1초 타이머.
- 매 초 `simulate(speed초)`: 시간대 가중 포아송으로 주문 생성(`makeOrder`) → 각 주문 `_d.stage` 전진(`advanceOrder`: collected→checked→ordered→invoiced→shipped→delivered, 블랙리스트면 held) → CS(`openCs/advanceCs`: 앱의 `CS_STEPS` 를 그대로 체크, 장부·회수송장 기록, 6% 는 담당자 개입) → DB 작업(`DB_JOBS`) → 예약 이벤트(`runDeferred`) → 시트 창 300건 유지(`evict`: 송장 이후 단계는 예약 이벤트로 집계만 이어감).
- 앱 오버레이용 API: `dailyRows(최근 60일)`, `monthlyRows`, `overview`, `periodRows`, `kpis`, `now()`.
- 화면: `buildPane` 1회 골격 → `renderPane` 매초 값만 갱신(카운트업은 rAF `tweenTo`), 피드는 새 항목만 prepend(42개 유지), 차트는 3초마다 SVG 재생성. 발표 모드 `setPresent`.
- 종료 `Demo.stop()`: 스냅샷 복원, 저장 차단 해제. `?demo=1&speed=60` 또는 새로고침(sessionStorage) 시 자동 시작.

## 5. 검증 방법

```bash
npm install
node tools/test-copy.js && npm run test:biff && npm test
node tools/smoke.js sample/소스샘플_36열.xls      # 24건 업로드 → 복사 툴바 → CS 흐름 → 내보내기 7종
node tools/verify-export.js /tmp/smoke-btn-exp-src-xls.xls sample/소스샘플_36열.xlsx
SHOTS=1 node tools/demo-smoke.js 25 600           # 데모: 80억 페이스·탭 렌더·DOM 안정·종료 복원 (/tmp/shots/demo-*.png)
```

## 6. 관제 화면의 디자인 결정

- 목업 3안(`docs/design/mock/`: 관제탑 다크 / 애플 클린 / 스토리 피드)을 심사 3인이 채점한 결과 평균은 애플 클린 7.4 · 스토리 피드 7.3 · 관제탑 6.6 이었지만, 사용자의 1순위가 "비주얼 쇼크"라서 **어두운 관제실 기조(관제탑)** 를 바탕으로 스토리 피드의 서사형 피드·자동 묶음 줄·종결 소요 시간, 애플 클린의 히어로 숫자·진행 바·링을 접목했습니다. 밝은 테마 변형이 필요하면 `.ap` 의 `--ap-*` 토큰만 바꾸면 됩니다.
- 시각·코드·회귀 검수(워크플로 `autopilot-demo-qa`)에서 나온 결함은 모두 반영했습니다: 시작 피드 채움, CS 유입, 자정 이월(깔때기 단조), 월 마감 집계, 데모 중 삭제·설정 저장 차단, 편집 중 재렌더 금지, 발표 모드 화면 맞춤, 글자 크기 11px 이상 등.

## 7. 아직 안 한 것 / 알려진 한계

- GitHub 푸시가 403(Claude GitHub App 미설치)이라 커밋은 로컬 브랜치 `claude/order-management-system-upgrade-oxv1kf` 에만 있습니다. 앱 설치 후 `git push -u origin <브랜치>` 하고 PR 을 만들면 됩니다.
- 택배사 T코드 중 우체국 T005·경동 T060·대신 T044·일양 T042·직접배송 T098 은 출처 미확인.
- 데모의 마진율(약 14%)은 앱의 기본 수수료율(10.8%)로 계산된 값이라 워크북 실적(약 11%)보다 조금 높습니다. 설정의 카테고리 수수료율을 바꾸면 같이 바뀝니다.
- 시트 열 구성이 바뀌면 `SHEET_LAYOUT_VERSION` 과 `?v=` 를 같이 올려야 사용자 브라우저에 반영됩니다.
