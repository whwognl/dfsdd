# 01. 구버전 앱(order-helper) 구조 지도

작성일: 2026-09-06
대상 파일: `/home/user/dfsdd/app.js` (3,555줄, IIFE 하나) · `/home/user/dfsdd/index.html` (796줄)
참고 문서: `5eb801ed-CLAUDE_HANDOFF.md`, `eb208d00-GPT_HANDOFF.md` (업로드 폴더)

> 표기 규칙
> - **[확인]** = 코드를 직접 읽고 확인한 사실
> - **[추정]** = 코드에서 직접 보이지 않아 추정한 내용
> - 줄번호는 `app.js` 기준. 이 문서에는 고객 개인정보를 옮기지 않았다(유형·패턴만 기술).

---

## 0. 한눈에 보기

| 항목 | 내용 |
|---|---|
| 실행 방식 | 빌드 없음. `index.html` → `vendor/xlsx.full.min.js` → `rules.js?v=36` → `app.js?v=37` 순서로 로드 **[확인]** |
| 저장소 | `localStorage` 8개 키(`oh_*_v1`) **[확인]** |
| 화면 | 3개 뷰(`view-upload` / `view-mapping` / `view-dashboard`) + 대시보드 안 14개 탭 패널 + 모달 3개(설정/메모/내보내기) + 동적 `showConfirm` 모달 **[확인]** |
| 외부 라이브러리 | SheetJS `XLSX` 전역 하나(읽기·쓰기 모두). 저장소에는 `vendor/` 폴더와 `rules.js`가 **없음** — 즉 현재 저장소 상태로는 그대로 열면 `XLSX`·`window.DEFAULT_RULES` 참조 오류 **[확인: `find / -name rules.js` 결과 없음]** |
| 파일 동일성 | 저장소 `app.js`/`index.html` = 업로드된 `15a81349-app.js`/`13a26dbe-index.html`과 바이트 동일 **[확인: diff]** |

### 실제로 재사용 가능한 것 (요약)
- 앱 골격 전체(탭·시트 엔진·CS·메모·매입처DB·설정·내보내기 골격)는 그대로 유지 가능.
- 바꿔야 할 곳은 **"원본 행 → 주문 객체" 경계(FIELDS/buildOrders)**와 **"주문 객체 → 원본 행" 경계(invoiceRow/INVOICE_HEADERS)**, 그리고 **SheetJS 의존 12곳**이다. 자세한 수정 지점은 §8.

---

## 1. 전역 state 모델

### 1.1 localStorage 키 (`LS`, 14–23행)

| 키 | 내용 | 쓰는 함수 | 읽는 함수 |
|---|---|---|---|
| `oh_orders_v1` | `state.orders` 통째(원본 `raw` 포함) | `persist` 565 | `restoreSession` 625 |
| `oh_states_v1` | `keyOf(o)` → 진행상태 스냅샷(+`ts`) | `persist` 568–583 | `buildOrders` 459(`loadStates` 547) |
| `oh_rules_v1` | 수수료·카테고리·copyFormat·myPhone·VAT | `saveRules` 248 | `loadRules` 242 |
| `oh_ui_v1` | 탭·정렬·필터·열 순서/너비·행 높이·사용자열 | `persist` 584, `saveUiOnly` 589 | `restoreSession` 601 |
| `oh_deleted_v1` | 삭제 행 복구 스택(최대 50) | `saveDeleted` 593 | `loadDeleted` 596 |
| `oh_ops_v1` | 라인업 extras·매입처DB·계산기·일지·계정·카드 | `persist` 585 | `restoreSession` 605 |
| `oh_sourcing_map_v1` | 노출상품ID → {link, category, price} | `saveSourcingMap` 590 | `restoreSession` 619 |
| `oh_cloud_v1` | 구글시트 연동 설정 | `saveCloud` 3167 | `loadCloud` 3161 |

모든 쓰기는 `safeSetItem`(551)을 거친다(quota 초과 시 toast). 예외: `saveSourcingMap`/`saveDeleted`는 자체 try/catch로 직접 `localStorage.setItem` **[확인]**.

### 1.2 `state` 루트 (55–64행)

```
state = {
  rules: null,          // loadRules()에서 채움
  orders: [],           // 주문 객체 배열 (아래 1.3)
  deleted: [],          // [{order, index, at}]
  sourcingMap: {},      // productId -> {link, category, price}
  ops: defaultOps(),    // 아래 1.5
  pending: null,        // 매핑 화면 대기 중인 {rows, header}
  ui: {...},            // 아래 1.4
  cloud: {enabled, clientId, sheet, range}
}
```

### 1.3 주문 객체 `o` — 필드 전부 **[확인]**

생성 지점: `buildOrders`(466–492), `blankOrder`(2318–2328). 보정: `normalizeOrder`(294–310). 계산: `computeMargin`(274–290).

| 필드 | 타입 | 출처 | 어디서 쓰이나 |
|---|---|---|---|
| `id` | string | `"o"+idx+"_"+hash` / `newId("n")` | DOM `tr[data-id]`, `findOrder` 1759, `rowHeights[o.id]` |
| `orderDate` | string(원본 그대로) | FIELDS `orderDate` | `parseOrderDate` 940(일/월 집계), 시트 열, 정렬 `dateDesc`, CS·로스 표, `invoiceRow` |
| `orderNumber` | string | FIELDS `orderNumber`(**필수**) | `keyOf`, 시트 열, 검색 hay, 정렬, `invoiceRow`(주문번호/묶음배송번호 대체) |
| `productId` | string | FIELDS `productId` | `keyOf`, `sourceKey` 312(매입처DB/라인업 그룹키), `sourcingMap` 조회, `coupangLinkFor` 1008, `invoiceRow` |
| `productName` | string | FIELDS `productName`(**필수**) | `classify` 254(카테고리), 시트, 검색, 그룹, `invoiceRow` |
| `option` | string | FIELDS `option` | `keyOf`, 시트, 검색, `invoiceRow` |
| `orderId` | string | 사용자 입력(시트 "주문ID") | states 복원, `exportFull` "주문ID" |
| `manager` | string | 사용자 입력(시트 "담당자") | states 복원, `exportFull` "담당자" |
| `quantity` | number(≥1) | FIELDS `quantity` | `computeMargin`(단가×수량), 매입처DB `qty`, `invoiceRow` |
| `paymentAmount` | number | FIELDS `paymentAmount` | `computeMargin`(정산액), 모든 매출 집계, `invoiceRow` "결제액" |
| `recipient` | string | FIELDS `recipient` | `keyOf`, 클릭복사 셀, `copyAutofill`, `formatAddress`, `invoiceRow` |
| `phone` | string | FIELDS `phone` | 시트 열, `formatAddress`, `invoiceRow` — **`copyAutofill`에는 절대 안 들어감**(2531) |
| `zipcode` | string | FIELDS `zipcode` | 시트, `copyAutofill`, `formatAddress`, `invoiceRow` |
| `address` | string | FIELDS `address` | 시트 클릭복사, `copyAutofill`, 검색, `invoiceRow` |
| `raw` | object | `Object.assign({}, r)` — **원본 행 전체(원본 헤더명 키)** | `rawVal` 2708 → `invoiceRow`(39열 채우기), `coupangLinkFor`. `oh_orders_v1`에 함께 저장, `oh_states_v1`에는 저장 안 됨 |
| `sourcingLink` | string | sourcingMap/lineupExtras/purchaseDb/states | 시트 "주문링크", 매입처DB 대표링크, `exportFull` |
| `sourcingLinks` | `[{id,source,url,memo,price,selected}]` | `normalizeSourcingLinks` 330 | 매입처DB 후보 패널, `applyGroupLinks`, states 복원 |
| `sourcingPrice` | number/null | sourcingMap/lineupExtras/purchaseDb/states/시트 입력 | `computeMargin`(단가), 시트 "매입가" |
| `sourcingShipping` | number | `bestPurchaseForKey` 1105 | `computeMargin`(주문당 1회 배송비) |
| `sourcingCost` | number/null(계산) | `computeMargin` | `overviewStats`, `exportFull` "매입가합계" |
| `status` | `"pending"｜"purchased"｜"invoiced"` | 완료 체크/상태 select/states | 필터·정렬·KPI·행 색·`statusLabel`. 구버전 `"returned"/"stopped"`는 `normalizeOrder`가 csType으로 이관(299–300) |
| `invoiceNumber` | string | 시트 입력/states | `exportInvoice` 대상 조건(`courier && invoiceNumber`), `stripInvoiceNo` |
| `courier` | string(COURIERS 중 하나) | 시트 select/states | `exportInvoice` "택배사" |
| `csType` | `""｜CS_TYPES` | 출고중지/반품 체크, states | `isCsOrder` 831(주문관리 시트에서 제외·CS탭으로), `invoiceExcluded` 2678, 행 색 |
| `csStatus` | `""｜CS_STATUSES` | CS탭 select | CS탭 표시, `csLabel` |
| `csCost` | number | CS탭 입력/시트 "CS차감" | `computeMargin`(차감), CS 합계, 로스탭 |
| `memoLog` | `[{at, text}]` | 메모 모달 | 시트 memo 셀(현재 SHEET_COLS에 없음), CS탭 미리보기, `exportFull` "CS메모" |
| `customValues` | `{customKey: string}` | 사용자 열 입력 | `editCellHtml` custom 분기, states 복원 |
| `category`, `feeRate` | 계산 | `computeMargin`→`classify` | 수익분석 카테고리 집계, `exportFull` |
| `settlement`, `margin`, `marginRate` | 계산 | `computeMargin` | 시트 "순마진" 셀, 모든 KPI |

**마진식 (274–290) [확인]**
```
rate       = feeRate × (vatIncluded ? 1.1 : 1) / 100
settlement = round(paymentAmount × (1 − rate))
cost       = sourcingPrice × quantity + sourcingShipping     (배송비는 주문당 1회)
margin     = round(settlement − cost − csCost)
marginRate = round(margin / paymentAmount × 1000) / 10        (%)
sourcingPrice 없으면 sourcingCost/margin/marginRate = null
```

### 1.4 `state.ui` (62행)

| 필드 | 기본값 | 용도 |
|---|---|---|
| `q` | `""` | 시트 검색어(`#q`) |
| `status` | `"all"` | 상태 필터(`#f-status`) |
| `sort` | `"pendingFirst"` | 정렬(`#f-sort`, 8종 1879–1888) |
| `view` | `"sheet"` | 카드/시트 호환 잔재. `sheetAddRow`에서만 참조 **[확인: 실질 미사용]** |
| `tab` | `"dashboard"` | 현재 탭(`TABS` 767) |
| `group` | `"none"` | 묶어보기(`product/date/status`) |
| `colWidths` | `{}` | `{colKey: px}` |
| `rowHeights` | `{}` | `{orderId: px}` — **주문 id 기준**이라 재업로드 시 무의미해짐 |
| `colOrder` | `[]` | 열 키 순서. `normalizeSheetLayoutForCurrentVersion` 1840이 버전 불일치 시 리셋 |
| `customCols` | `[]` | `[{key:"custom_…", label, w}]` |
| `layoutVersion` | `SHEET_LAYOUT_VERSION`(26) | 열 구성 변경 시 캐시 리셋 트리거 |
| `sourcingOpen` | `{}` | 매입처DB 후보 패널 펼침 상태 |

### 1.5 `state.ops` (`defaultOps` 69–80)

| 필드 | 형태 | 쓰는 탭 |
|---|---|---|
| `processNotes` | `string[]` | 프로세스 탭(워크북 import 전용) |
| `lineupExtras` | `{key: {name, productId, views, salePrice, sourcingPrice, feeRate, targetQty, coupangLink, sourcingLink}}` (key = productId 또는 `"name:"+상품명`) | 라인업, `buildOrders` 500, `applyGroupLinks` |
| `purchaseDb` | `[{id, productId, name, platform, vendor, url, price, shipping, totalCost, best, updated, memo}]` | 매입처DB(`bestPurchaseForKey`, `writePurchaseLinks`) |
| `calcRows` | `[{id, name, cost, sale, fee}]` | 마진계산기 |
| `journalSide` / `journalMain` | `[{day, date, uploads, sales, cert, note}]`×31 | 수행일지 |
| `accounts` | `[{platform, id, password, owner, memo}]` | 계정관리 — **내보내기 경로 없음 [확인]** |
| `cards` | `[{name, limit, payDate, use, memo}]` | 카드관리 — **내보내기 경로 없음 [확인]** |

### 1.6 `state.rules` (기대 구조) — §7 참조
### 1.7 `state.sourcingMap` — `{productId: {link, category, price}}`; `category`는 저장만 되고 **어디서도 읽지 않음** **[확인: grep]**
### 1.8 `state.deleted` — `[{order, index, at}]`, 50개 초과 시 앞에서 제거(2184)
### 1.9 `state.cloud` — `{enabled:false, clientId, sheet, range}`; `updatePrivacyUI` 3265가 배너/필 표시 토글

---

## 2. 함수 인벤토리 (영역별, 줄번호)

### 2.1 유틸 (92–228)
`toNumber` 92 · `won` 99 · `comma` 104 · `MONEY_KEYS/isMoneyKey/moneyInputValue/formatMoneyInput` 111–120 · `esc` 121 · `norm` 126 · `safeUrl` 127 · `linkHtml` 139 · `openSafeUrl` 143 · `sanitizeExportCell` 148 · `sanitizeExportRows` 154 · `toast` 163 · `showConfirm` 170 · `copyText` 206 · `legacyCopy` 218 · `fmtPct` 1347 · `dateStamp` 2756 · `dateStampHuman` 2510 · `downloadBlob` 2761 · `newId` 315 · `hash` 542 · `deepCopy` 249

### 2.2 규칙·분류·마진 (233–365)
| 함수 | 줄 | 역할 | 호출 |
|---|---|---|---|
| `loadRulesDefaults` | 233 | 빠진 규칙 필드 기본값 채움 | `loadRules`, `importRules` |
| `loadRules` | 242 | `oh_rules_v1` 또는 `window.DEFAULT_RULES` | `init` |
| `saveRules` | 248 | | `saveSettings`, `importWorkbook`, `importRules` |
| `classify` | 254 | 상품명 키워드 최장일치 → {category, feeRate} | `computeMargin`, `lineupCalc` |
| `effectiveRate` | 269 | VAT ×1.1 | `computeMargin`, `lineupCalc`, `renderMarginCalc` |
| `computeMargin` | 274 | §1.3 마진식 | 거의 모든 편집 핸들러 |
| `recomputeAll` | 292 | | `restoreSession`, `saveSettings`, `handleMapFile`, `importWorkbook` |
| `normalizeOrder` | 294 | 필드 보정 + 구status 이관 + `normalizeSourcingLinks` | 렌더/편집 곳곳 |
| `sourceKey` | 312 | `productId ｜ "name:"+productName` | 매입처DB·라인업 그룹키 |
| `cloneSourcingLinks` / `normalizeSourcingLinks` / `selectedSourcing{Link,Source,Price}` | 318–365 | 후보 링크 정규화 | 매입처DB, states |

### 2.3 파싱·매핑 (370–449, 3093–3153)
| 함수 | 줄 | 역할 |
|---|---|---|
| `readWorkbook(file)` | 370 | FileReader → `XLSX.read` → **첫 시트만** → `{rows:[obj], header:[string]}` |
| `autoMap(header)` | 389 | FIELDS 별칭: 정확일치 → 정규화일치 → **양방향 부분포함** |
| `autoMapGeneric(header, aliasObj)` | 417 | MAP_FIELDS용 단순판(단방향 포함) |
| `buildSourcingMap(parsed)` | 435 | 매핑표 → `sourcingMap` |
| `handleOrderFile` | 3093 | 드롭존 → `readWorkbook` → `processOrderParsed` |
| `processOrderParsed` | 3105 | `autoMap` → 필수 누락이면 `showMapping`, 아니면 `finalizeOrders` |
| `dsvToMatrix` | 3114 | 인용 인식 TSV/CSV 파서(셀 시작 `"`만 인용) |
| `matrixToParsed` | 3136 | 2차원 배열 → `{rows, header}` (첫 비어있지 않은 행 = 헤더) |
| `parsePasted` | 3148 | 탭 있으면 TSV, 없으면 CSV |
| `handlePaste` | 3277 | `#paste-area` → `processOrderParsed` |
| `handleMapFile` | 3294 | 매핑표 파일 → `sourcingMap` → 기존 주문에 즉시 반영 |
| `finalizeOrders(parsed, map)` | 3286 | `buildOrders` → `persist` → `showDashboard` |

### 2.4 주문 빌드·상태 저장 (454–634)
`keyOf` 454 · `buildOrders` 458 · `pick` 541 · `loadStates` 547 · `safeSetItem` 551 · `persist` 562 · `saveUiOnly` 589 · `saveSourcingMap` 590 · `saveDeleted` 593 · `loadDeleted` 596 · `restoreSession` 599 · `schedulePersist` 2518(250ms 디바운스)

### 2.5 화면 전환·매핑 화면 (639–693)
`show(view)` 639 · `showDashboard` 646 · `showMapping(parsed)` 658 · `currentMapping` 678 · `updateMapStates` 683

### 2.6 렌더 — 공통·탭 라우팅 (698–825)
| 함수 | 줄 | 대상 DOM |
|---|---|---|
| `statusLabel` / `csLabel` | 698/701 | |
| `renderSummary` / `stat` | 706/723 | `#summary`(대시보드 KPI 5개) |
| `renderProcessStrip` / `renderSecurityRail` | 727/754 | `#process-strip`(5단계 진행 버튼 + 보안 레일) |
| `TABS` / `TAB_PANE` / `renderTabs` / `setTab` | 767–799 | `#tabnav`; `setTab("settings")`는 모달 |
| `render()` | 801 | 탭 → 해당 `render*` 디스패치 (14개) |
| `renderOrdersPane` | 827 | `renderOrdersDashboard` + `renderSheet` |

### 2.7 렌더 — 탭별
| 탭 | 렌더 | 이벤트 핸들러(위임) | 줄 |
|---|---|---|---|
| 대시보드 | `renderOverview` 975, `renderMonthlyTable` 994, `overviewStats` 920, `monthlyStats` 958, `ovCard` 971 | 없음 | |
| 주문관리 | `renderOrdersDashboard` 894(`orderKpi` 891, 오늘 매출/순마진/마진율/남은/완료/CS), `renderSheet` 2028 | §2.8 | |
| CS관리 | `renderCsPane` 851, `csOrders` 832, `csMemoPreview` 840, `csTypeChip` 847 | `onCsClick` 2250, `onCsChange` 2258, `onCsInput` 2273, `onCsFocusOut` 2285, `clearCsOrder` 2241, `csRowOrder` 2237 | |
| 라인업 | `renderLineup` 1429, `lineupRows` 1362, `lineupCalc` 1386, `lineExtra` 1350, `findLineupExtraForOrder` 1355 | `onLineupInput` 1471, `onLineupFocusOut` 1505(부분갱신 `refreshLineupRow` 1484 / 전체재렌더 분기), `onLineupClick` 1523, `applyLineupToOrders` 1461 | |
| 매입처DB | `renderSourcing` 1192, `renderSourcingLinksPanel` 1172, `sourcingGroups` 1015, `coupangLinkFor` 1008, `groupOrders` 1071, `purchaseKey/Total/RowToLink/LinksForKey` 1074–1104, `bestPurchaseForKey` 1105, `writePurchaseLinks` 1118, `groupLinks` 1145, `applyGroupLinks` 1153 | `onSourcingInput` 1229, `onSourcingFocusOut` 1300, `onSourcingClick` 1304 | |
| 마진계산기 | `renderMarginCalc` 1530 | `onCalcInput` 1550, `refreshCalcRow` 1559, `onCalcFocusOut` 1574, `onCalcClick` 1582 | |
| 일별매출 | `renderDailySales` 1599, `dailySalesRows` 1588 | 없음 | |
| 운송장업로드 | `renderInvoicePane` 1609 | `init` 3442(`[data-invoice-export]` → `exportInvoice("xlsx")`) | |
| 로스관리 | `renderLossPane` 1621 | 없음 | |
| 수행일지 | `renderJournalPane` 1652, `renderJournalTable` 1646, `journalRows` 1630(렌더 중 변형 → `schedulePersist`) | `onJournalInput` 1657 | |
| 계정/카드 | `renderSimpleOpsTable(type)` 1669, `SIMPLE_OPS` 1665(비밀번호는 property로만 주입 1686–1693) | `onSimpleOpsInput` 1695, `onSimpleOpsClick` 1703 | |
| 수익분석 | `renderProfit` 1720(카테고리별 집계) | 없음 | |
| 프로세스 | `renderProcessPane` 1405 | 없음 | |

### 2.8 시트 엔진 (1779–2464)
| 그룹 | 함수 | 줄 |
|---|---|---|
| 열 정의 | `SHEET_COLS`(23열) 1779, `customSheetCols` 1804, `baseColByKey` 1815, `orderedSheetCols` 1821, `defaultSheetColOrder` 1835, `normalizeSheetLayoutForCurrentVersion` 1840, `sheetEditCols` 1856, `colIndex` 1861 | |
| 행 선정 | `sheetFiltered` 1868(CS 주문 제외 + 검색 + 상태 + 정렬), `statusRank` 1892, `groupKeyFor` 1893, `displayRows` 1900 | |
| 셀 HTML | `statusSelectHtml` 1925, `courierSelectHtml` 1931, `optionSelectHtml` 1937, `doneCellHtml` 1942, `actionCellHtml` 1949, `stopCellHtml` 1952, `returnCellHtml` 1955, `memoCellHtml` 1958, `calcCellHtml` 1969, `editCellHtml` 1981, `sheetRowHtml` 2003, `sheetRowClass` 2010, `colWidth` 2016, `rowHeight` 2019, `groupRowHtml` 2023 | |
| 렌더 | `renderSheet` 2028 → `#sheet-table` innerHTML 통째 + `#sheet-count` + `renderOrdersDashboard` + `updateUndoButton` | |
| 편집 | `setSheetField` 2066(키별 타입 변환), `refreshRowCalc` 2094(calc 셀만 제자리 갱신), `onSheetInput` 2104, `onSheetFocusOut` 2114, `onSheetChange` 2119, `onSheetClick` 2130(사용자열 삭제/클릭복사/`data-act`: autofill·done·stop·return·memo/행 삭제), `onSheetKey` 2190(Enter·↑↓ 같은 열 이동), `onSheetPaste` 2204(블록 붙여넣기; `sheetEditCols` 인덱스 기준, 부족하면 `blankOrder` 생성) | |
| 행·열 조작 | `addCustomColumn` 2290, `deleteCustomColumn` 2301, `blankOrder` 2318, `sheetAddRow` 2329, `undoDeletedRow` 2339, `updateUndoButton` 2351 | |
| 리사이즈/드래그 | `startSheetResize` 2361, `moveSheetResize` 2381, `stopSheetResize` 2392, `clearColDropMarks` 2404, `onSheetDragStart` 2409, `onSheetDragOver` 2419, `onSheetDrop` 2428, `onSheetDragEnd` 2451, `resetSheetLayout` 2456 | |

주의 **[확인]**: `editCellHtml`에는 `memo`/`status`/`csType`/`csStatus` 타입 분기가 있지만 현재 `SHEET_COLS`에 그 타입의 열이 없다(status는 `calc`). 죽은 분기지만 열을 되살릴 때 바로 쓸 수 있다.

### 2.9 메모 (2466–2514)
`openMemo` 2467 · `closeMemo` 2473 · `renderMemoModal` 2478 · `addMemo` 2494 · `deleteMemo` 2503 — 모달 `#modal-memo`, 모듈 변수 `memoOrderId`.

### 2.10 자동입력·북마클릿 (2530–2562)
`copyAutofill(o)` 2530: `myPhone` 없으면 차단 + 설정 열기. 클립보드 payload `{__oh, name, phone(=myPhone), zip, addr}` — 고객 전화 미포함. `BOOKMARKLET` 2551 문자열(설정 모달 `#oh-bookmarklet` href, `#btn-copy-bookmarklet`).

### 2.11 설정 (2567–2643)
`openSettings` 2567 · `toggleCloudFields` 2585 · `closeSettings` 2589 · `renderFeeRows` 2591 · `readFeeRows` 2603 · `updateCopyPreview` 2615 · `saveSettings` 2623 · `exportRules` 2772 · `importRules` 2776

### 2.12 내보내기 (2648–2767) — §4
### 2.13 워크북 import (2798–3088)
`wbSheetMatrix` 2798 · `findHeaderRow` 2805 · `rate100` 2811 · `buildRulesFromWorkbook` 2817 · `loadSourcingFromWorkbook` 2851 · `findHeaderRowWith` 2882 · `pickByHeader` 2899 · `rowHasValue` 2910 · `loadProcessFromWorkbook` 2913 · `loadLineupOpsFromWorkbook` 2921 · `loadPurchaseDbFromWorkbook` 2953 · `loadJournalFromWorkbook` 3008 · `loadSimpleOpsFromWorkbook` 3030 · `importWorkbook` 3052 — **v9 워크북 시트명 하드코딩**(`📋 프로세스`, `수수료표`, `분류규칙`, `소싱 라인업`, `📒 매입처DB`, `수행일지·부업/본업`, `계정관리`, `카드관리`). 9월 워크북(설명/블랙리스트/DAY/MON/2.주문서/…)과는 하나도 맞지 않는다 **[확인]**.

### 2.14 클라우드 (3161–3275)
`loadCloud` · `saveCloud` · `extractSheetId` · `ensureGis`(외부 스크립트 로드) · `getAccessToken` · `apiGet` · `fetchSheetValues` · `cloudLoad`(native `confirm` 의도적) · `updatePrivacyUI`

### 2.15 초기화 (3320–3554)
`bindDrop` 3320 · `performReset` 3342 · `reset` 3355 · `init` 3364 · `DOMContentLoaded` 3554

---

## 3. 업로드 → 시트까지의 흐름

```
[파일 드롭/선택]  #dz-order / #in-order  ──bindDrop──▶ handleOrderFile(file) 3093
        │                                                  │ readWorkbook 370
        │                                                  │   XLSX.read(array) → 첫 시트
        │                                                  │   rows = sheet_to_json({defval:"", raw:false})   ← 값이 전부 "표시 문자열"
        │                                                  │   header = sheet_to_json({header:1})[0]
[붙여넣기] #paste-area ──handlePaste 3277──▶ parsePasted 3148 ─┐
[구글시트] cloudLoad 3236 ──matrixToParsed 3136────────────────┤
                                                              ▼
                                               processOrderParsed(parsed) 3105
                                                              │ auto = autoMap(header) 389
                                                              │ 필수(req) 누락?
                                              ┌── 예 ─────────┴──────── 아니오 ──┐
                                              ▼                                ▼
                                     showMapping(parsed) 658          finalizeOrders(parsed, auto) 3286
                                       state.pending = parsed                     │
                                       #map-rows에 FIELDS별 select                │
                                       #btn-map-confirm → currentMapping()        │
                                       → 필수 검사 → finalizeOrders(pending, m)   │
                                                                                  ▼
                                                              buildOrders(rows, map) 458
                                                                │ states = loadStates()
                                                                │ 행마다: 주문번호·상품명 둘 다 비면 skip
                                                                │   o = {…FIELDS 값…, raw: 원본행}
                                                                │   sourcingMap[productId] → link/price
                                                                │   findLineupExtraForOrder → name/link/price 보충
                                                                │   bestPurchaseForKey(sourceKey) → url/price/shipping 보충
                                                                │   states[keyOf(o)] 있으면 진행상태 복원
                                                                │   normalizeOrder → computeMargin
                                                                ▼
                                                     state.orders = […] → persist() 562 → showDashboard() 646
                                                                                            │ show("dashboard") + 툴바 값 복원
                                                                                            ▼
                                                                                        render() 801 → (tab=orders) renderSheet() 2028
```

### 3.1 `FIELDS` 별칭 목록 (26–38행) **[확인]**

| key | label | req | aliases |
|---|---|---|---|
| `orderDate` | 주문일 | | 주문일, 주문일자, 주문시각, 결제일 |
| `orderNumber` | 주문번호 | **필수** | 주문번호, 주문 번호, 묶음배송번호 |
| `productId` | 노출상품ID | | 노출상품ID, 노출상품아이디, 노출 상품ID, 상품ID, 옵션ID, 등록상품ID |
| `productName` | 상품명 | **필수** | 등록상품명, 노출상품명, 상품명, 제품명, 노출 상품명 |
| `option` | 옵션 | | 등록옵션명, 옵션명, 옵션, 구매옵션, 업체상품옵션코드 |
| `quantity` | 수량 | | 구매수(수량), 구매수량, 구매수, 수량, 주문수량 |
| `paymentAmount` | 결제액 | | 결제액, 결제금액, 총결제금액, 주문금액, 상품금액 |
| `recipient` | 수취인 | | 수취인이름, 수취인 이름, 수취인, 수령인, 받는분, 받는사람 |
| `phone` | 전화 | | 수취인전화번호, 수취인 전화번호, 전화번호, 연락처, 휴대폰, 전화 |
| `zipcode` | 우편번호 | | 우편번호, 우편 번호 |
| `address` | 주소 | | 수취인 주소, 수취인주소, 배송지, 주소, 수령지주소 |

### 3.2 새 36열 헤더를 지금의 `autoMap`에 넣으면 어떻게 되나 **[확인: 알고리즘 추적]**

| FIELDS key | 36열에서 잡히는 열 | 판정 |
|---|---|---|
| `orderDate` | `주문일` (정확일치) | OK |
| `orderNumber` | 1차 실패(`norm`은 전각공백 U+3000도 지우므로 `"주문번호앞부분"`이 되지만 정확일치는 아님) → 2차 부분포함: `"주문번호"`가 `"판매사이트주문번호"`, `"주문번호앞부분"`, `"주문고유번호"`에 포함. **헤더 순서상 `판매사이트 주문번호`(3열)가 먼저 잡힘** | 우연히 맞음. 하지만 취약(별칭 순서/헤더 순서 의존) |
| `productId` | 부분포함 `"상품id"` ⊂ `"판매사이트상품코드"`? 아니오(`상품코드`≠`상품id`). `"옵션id"`, `"등록상품id"`도 없음 → **null** | 미매핑. `sourceKey`가 `"name:"+상품명`으로 떨어져 매입처DB 그룹키가 상품명 기준이 됨 |
| `productName` | `상품명` 정확일치 | OK |
| `option` | `"옵션"` ⊂ `"주문선택사항"`? 아니오 → **null** | 미매핑 |
| `quantity` | `주문수량` 정확일치 | OK |
| `paymentAmount` | `"결제액"`… 정확 없음; 부분포함 `"결제액"`⊂? 없음, `"결제금액"` 없음, `"총결제금액"` 없음, `"주문금액"` 없음, `"상품금액"` 없음 → **null** | **미매핑 → 매출 0** (판매가·배송비금액·구매금액과 의미가 다름) |
| `recipient` | `"수취인"`… 없음; 부분포함 `"수령인"`⊂`"수령자명"`? `수령인`≠`수령자` → 없음 → **null** | 미매핑 |
| `phone` | 부분포함 `"전화번호"` ⊂ `"수령자전화번호"` | OK(단 `수령자휴대폰번호`와 어느 쪽을 쓸지 정책 필요) |
| `zipcode` | 부분포함 `"우편번호"` ⊂ `"배송지우편번호"` | OK |
| `address` | 별칭 순서가 `수취인 주소 → 수취인주소 → 배송지 → 주소`. 2차 부분포함에서 **`"배송지"`가 21열 `배송지우편번호`에 먼저 걸린다**(22열 `배송지주소`보다 앞) → 주소 칸에 **우편번호**가 들어감 | **오매핑(버그)**. 별칭 `"배송지"` 제거 또는 정확일치 별칭 `배송지주소` 추가 필요 |

→ 필수 2개는 통과하므로 **매핑 화면 없이 바로 시트로 들어가지만** 결제액·수취인·옵션·상품ID가 비어 있고, 주소 칸에는 우편번호가 들어간 채로 시트가 열린다. 별칭 확장(§8)이 필수.

---

## 4. 내보내기 경로 전부

| 경로 | 트리거 | 함수 | 대상 행 | 출력 |
|---|---|---|---|---|
| 처리결과 전체 | `#btn-exp-xlsx` / `#btn-exp-csv` | `exportFull(type)` 2648 → `writeSheet` 2739 | `state.orders` 전부 | 앱 필드 30여 개(주문·마진·CS메모·후보링크·상태·송장). **계정/카드 없음** |
| 쿠팡 송장 업로드 | `#btn-exp-invoice-xlsx`/`-csv`, `#btn-quick-invoice`(상단), `[data-invoice-export]`(운송장 탭) | `exportInvoice(type)` 2682 | `courier && invoiceNumber` 이고 `!invoiceExcluded` | `INVOICE_HEADERS` 39열 그대로. xlsx는 시트명 `"form"` |
| 규칙 | `#btn-rules-export` | `exportRules` 2772 | `state.rules` | `rules.json` (myPhone 포함 — 로컬 설정 파일) |

### 4.1 `invoiceRow(o, idx)` 2717 — 원본 복원 방식 **[확인]**
```
r[h] = rawVal(o, h)  for h in INVOICE_HEADERS     ← 원본 행(o.raw)에서 같은 헤더명 값 그대로
r["번호"]         ||= idx+1
r["묶음배송번호"] ||= raw["묶음배송번호"|"묶음 배송번호"] || o.orderNumber
r["주문번호"]     ||= o.orderNumber
r["택배사"]        = o.courier || r["택배사"]              ← 앱 값 우선
r["운송장번호"]    = stripInvoiceNo(o.invoiceNumber)        ← 앱 값(하이픈·공백 제거)
r["주문일"] ||= o.orderDate, r["등록상품명"] ||= o.productName, r["등록옵션명"] ||= o.option,
r["노출상품명(옵션명)"] ||= name+" / "+option, r["노출상품ID"] ||= o.productId, r["결제액"] ||= o.paymentAmount,
r["구매수(수량)"] ||= o.quantity, r["수취인이름"] ||= o.recipient, r["수취인전화번호"] ||= o.phone,
r["우편번호"] ||= o.zipcode, r["수취인 주소"] ||= o.address
```
- **`o.raw`의 역할**: 앱이 매핑하지 않은 원본 열(분리배송, 배송메세지, PCCC 등)을 잃지 않고 송장 파일에 되돌려 넣는 "왕복 버퍼". 이 구조가 그대로 36열 왕복에 재사용된다.
- `rawVal` 2708: 헤더명 배열 중 첫 번째로 값이 있는 것을 반환. `o.raw`는 `readWorkbook`의 `raw:false` 결과이므로 **값이 전부 문자열**(숫자도 `"49800"`).

### 4.2 `sanitizeExportRows/Cell` 적용 지점
- `exportInvoice` 2690 (CSV·xlsx 공통, aoa 만들기 전)
- `writeSheet` 2740 (exportFull)
- 규칙: 제어문자 제거 + `^\s*[=+\-@]` 시작 셀에 `'` 접두. **[주의]** 재업로드 파일(수집 프로그램이 다시 읽음)에 `'`가 붙으면 값이 바뀐다. 36열 중 문자열이면서 `-`로 시작할 수 있는 값(예: 배송메세지, 한줄메모)이 있으면 수집 프로그램 쪽에서 `'-…`로 보이게 된다. **[추정]** 36열 왕복 파일은 "원본 값 그대로"가 우선이므로, 사용자 입력 열(한줄메모 등)만 방어하거나 방어 방식을 바꿔야 한다.

### 4.3 CSV 세부
- BOM(`﻿`) 접두 + `text/csv;charset=utf-8`, `downloadBlob`로 저장.
- 파일명: `쿠팡송장업로드_YYYYMMDD_HHMM.csv` / `주문처리결과_….xlsx`.

---

## 5. SheetJS(`XLSX.*`) 사용 지점 전부 **[확인: grep 12곳]**

| 줄 | 호출 | 옵션 | 사용처 |
|---|---|---|---|
| 375 | `XLSX.read(new Uint8Array(buf), {type:"array"})` | | `readWorkbook` — **.xlsx / .xls(BIFF) / .csv 모두 이 한 줄로 읽음**(input accept `.xlsx,.xls,.csv`) |
| 378 | `XLSX.utils.sheet_to_json(ws, {defval:"", raw:false})` | 첫 행 = 키, 값은 **서식 적용 문자열** | `readWorkbook` rows |
| 379 | `XLSX.utils.sheet_to_json(ws, {header:1, defval:""})[0]` | 2차원 배열(raw 값) | `readWorkbook` header |
| 2692 | `XLSX.utils.json_to_sheet(rows, {header: INVOICE_HEADERS})` | 열 순서 고정 | `exportInvoice` CSV |
| 2693 | `XLSX.utils.sheet_to_csv(ws)` | | `exportInvoice` CSV |
| 2699 | `XLSX.utils.aoa_to_sheet(aoa)` | | `exportInvoice` xlsx |
| 2700 | `ws["!cols"] = [{wch}]` | 열 너비 | `exportInvoice` xlsx |
| 2701–2703 | `book_new()` / `book_append_sheet(wb, ws, "form")` / `XLSX.writeFile(wb, name)` | 브라우저 다운로드까지 수행 | `exportInvoice` xlsx |
| 2741 | `XLSX.utils.json_to_sheet(rows)` | 키 순서 = 객체 키 순서 | `writeSheet` |
| 2744 | `XLSX.utils.sheet_to_csv(ws)` | | `writeSheet` CSV |
| 2748–2750 | `book_new` / `book_append_sheet(wb, ws, sheetName)` / `writeFile` | | `writeSheet` xlsx |
| 2801 | `XLSX.utils.sheet_to_json(ws, {header:1, defval:""})` | | `wbSheetMatrix`(워크북 import) |
| 3056 | `XLSX.read(...)` + `wb.Sheets[name]` / `wb.SheetNames` | | `importWorkbook` |

### 5.1 `vendor/xlsx.full.min.js` 없이 돌리려면 흉내낼 API 표면

최소 shim(전역 `XLSX`) 또는 호출부 교체가 필요한 표면은 다음 7개다.

| 필요 표면 | 현재 `xlsx-lite.js`(`window.XlsxLite`)로 대체 가능? |
|---|---|
| `XLSX.read(u8, {type:"array"})` → `{SheetNames:[], Sheets:{name: ws}}` | `XlsxLite.read(arrayBuffer)` → **Promise**`{names, sheet(n)→rows[][], has, pick, pickName}`. 동기→비동기 차이. `readWorkbook`은 이미 Promise라 OK, `importWorkbook`은 콜백 안에서 동기 사용이라 수정 필요 |
| `sheet_to_json(ws, {defval:"", raw:false})` (객체 배열, 문자열 값) | `sheet(n)` 결과(2차원 배열)에 `matrixToParsed` 3136을 적용하면 동일 형태. 단 값이 **숫자는 number, 날짜는 `"YYYY-MM-DD HH:mm"` 문자열**로 온다(`raw:false`의 "표시 문자열"과 다름) → `o.raw`에 number가 섞임. `rawVal`/`sanitizeExportCell`은 number를 그대로 통과시키므로 왕복은 문제 없음 |
| `sheet_to_json(ws, {header:1, defval:""})` | `sheet(n)` 그대로 |
| `json_to_sheet` / `aoa_to_sheet` / `book_new` / `book_append_sheet` / `!cols` | `XlsxLite.write([{name, rows:[[…]], cols?, freeze?, …}])` → **Blob**. aoa 하나만 만들면 됨 |
| `writeFile(wb, name)` | `downloadBlob(blob, name)` 2761 재사용(현재는 문자열만 받으므로 Blob 분기 추가) |
| `sheet_to_csv(ws)` | **없음** → 간단한 CSV 직렬화 함수(따옴표 이스케이프) 직접 작성 필요 |
| **`.xls`(BIFF8, OLE 컨테이너) 읽기** | **없음.** `XlsxLite.read`는 ZIP 서명만 처리 |

> **가장 큰 함정 [확인]**: 새 소스 샘플 `e72cef32-____.xls`는 파일 서명이 `D0 CF 11 E0`(OLE2/BIFF8)이다. SheetJS는 이걸 읽지만 `xlsx-lite.js`는 못 읽는다. 선택지는 (a) BIFF8 파서를 추가로 작성(공유문자열 SST·LABELSST·NUMBER·RK·MULRK·BOUNDSHEET·BOF 정도의 최소 구현), (b) SheetJS 벤더 파일을 다시 동봉, (c) 수집 프로그램이 `.xlsx`/CSV로도 내보낼 수 있는지 사용자에게 확인. 내보내기 쪽도 같은 문제: 수집 프로그램이 `.xls`만 받는지, `.xlsx`도 받는지 **[미확인 — 사용자 확인 필요]**.

---

## 6. `index.html` 뷰·모달·DOM id와 `init()` 바인딩

### 6.1 구조
```
header.topbar   #privacy-pill  #btn-settings  #btn-quick-invoice  #btn-export  #btn-reset
main
  #privacy-banner / #cloud-warn(hidden)
  section#view-upload
     .drop-grid: #dz-order(#order-file, #in-order[accept=.xlsx,.xls,.csv]) · #dz-map(#map-file, #in-map)
     #cloud-load-panel(hidden): #btn-cloud-load #btn-cloud-settings #cloud-status
     .paste-zone: #paste-area #btn-paste-go #btn-paste-clear #paste-hint
     .help-card
  section#view-mapping(hidden): table.map #map-rows · #btn-map-confirm · #btn-map-cancel
  section#view-dashboard(hidden)
     #process-strip · nav#tabnav
     #pane-dashboard: #summary · #overview-extra
     #pane-orders: #orders-dashboard · .toolbar(#q #f-status #f-sort #f-group #sheet-add #sheet-col-add #sheet-layout-reset #sheet-undo)
                   · #sheet-view(.sheet-bar #sheet-count · .sheet-scroll table#sheet-table)
     #pane-cs #pane-lineup #pane-sourcing #pane-calc #pane-daily #pane-invoice #pane-loss #pane-journal #pane-accounts #pane-cards #pane-profit #pane-process  (모두 innerHTML 통째 렌더)
#modal-settings  (§7)
#modal-memo      #btn-memo-close #memo-title #memo-list #memo-text #btn-memo-cancel #btn-memo-add
#modal-export    #btn-exp-close #btn-exp-xlsx #btn-exp-csv #btn-exp-invoice-xlsx #btn-exp-invoice-csv
#toast
<script vendor/xlsx.full.min.js> <script rules.js?v=36> <script app.js?v=37>
```

### 6.2 `init()` (3364–3552) 바인딩 목록 **[확인]**

| 대상 | 이벤트 | 핸들러 |
|---|---|---|
| `#map-rows` | change | `updateMapStates` |
| `#dz-order`/`#in-order`, `#dz-map`/`#in-map` | click/change/drag*/drop | `bindDrop` → `handleOrderFile` / `handleMapFile` |
| `#btn-paste-go`, `#btn-paste-clear`, `#paste-area`(input) | | `handlePaste`, 지우기, 행·열 감지 힌트 |
| `#btn-cloud-load`, `#btn-cloud-settings`, `#set-cloud-enabled`(change) | | `cloudLoad`, `openSettings`, `toggleCloudFields` |
| `#btn-map-confirm`, `#btn-map-cancel` | click | 필수 검사 → `finalizeOrders(state.pending, m)` / `show("upload")` |
| `#q`(input, 180ms 디바운스), `#f-status`, `#f-sort`, `#f-group`(change) | | `state.ui.*` → `saveUiOnly` → `render` |
| `#tabnav` | click(위임 `[data-tab]`) | `setTab` |
| `#process-strip` | click(위임 `[data-process-tab]`) | `setTab` |
| `#pane-sourcing` | input / click / focusout | `onSourcing*` |
| `#pane-lineup` | input / click / focusout | `onLineup*` |
| `#pane-calc` | input / click / focusout | `onCalc*` |
| `#pane-invoice` | click(`[data-invoice-export]`) | `exportInvoice("xlsx")` |
| `#pane-journal` | input | `onJournalInput` |
| `#pane-accounts`, `#pane-cards` | input / click | `onSimpleOps*` |
| `#sheet-table` | input / change / focusout / click / mousedown / dragstart / dragover / drop / dragend / keydown / paste | `onSheet*`, `startSheetResize`, `onSheetDrag*` |
| `#pane-cs` | click / change / input / focusout | `onCs*` |
| `document` | mousemove / mouseup | `moveSheetResize` / `stopSheetResize` |
| `#sheet-add`, `#sheet-col-add`, `#sheet-layout-reset`, `#sheet-undo` | click | `sheetAddRow`, `addCustomColumn`, `resetSheetLayout`, `undoDeletedRow` |
| `#btn-settings`, `#btn-reset`, `#btn-export`, `#btn-quick-invoice` | click | `openSettings`, `reset(false)`, 내보내기 모달 열기, `exportInvoice("xlsx")` |
| `#btn-memo-close/-cancel/-add`, `#memo-list`(위임 `[data-memo-del]`) | click | 메모 |
| `#btn-set-close/-cancel/-save`, `#set-copyfmt`(input), `#fee-rows`(위임 `[data-del]`), `#btn-add-cat`, `#btn-rules-export/-import`, `#in-rules`, `#btn-security-clear`, `#btn-import-workbook`, `#in-workbook`, `#oh-bookmarklet`, `#btn-copy-bookmarklet`, `#btn-rules-default` | | 설정 |
| `#btn-exp-close/-xlsx/-csv/-invoice-xlsx/-invoice-csv` | click | 내보내기 |
| `.modal-bg` 전부 | click(배경) | `hidden` 추가 |
| 마지막 | | `updatePrivacyUI()` → `restoreSession()` 실패 시 `show("upload")` |

### 6.3 유지해야 할 관례 **[확인 + 인수인계 문서]**
1. **렌더 함수 안에서 `addEventListener` 금지.** 모든 동적 영역은 `init()`에서 pane 단위 위임 1회. (예외: `showConfirm`은 자기 DOM을 만들고 지우므로 자체 바인딩 OK.)
2. DOM id를 지우면 `init()`의 `$("#…").addEventListener`가 null 참조로 **init 전체가 죽는다**(옵셔널 체크가 있는 것과 없는 것이 섞여 있음: `#btn-paste-go`, `#btn-cloud-load`, `#set-cloud-enabled`, `#btn-map-confirm`, `#q`, `#f-status`, `#f-sort`, `#btn-settings`, `#btn-reset`, `#btn-export`, `#btn-set-*`, `#set-copyfmt`, `#fee-rows`, `#btn-add-cat`, `#btn-rules-*`, `#in-rules`, `#btn-import-workbook`, `#in-workbook`, `#btn-exp-*`는 **널 체크 없음**).
3. innerHTML에 넣는 모든 사용자 값은 `esc()`, 링크는 `safeUrl()`/`linkHtml()`.
4. native `confirm/prompt` 대신 `showConfirm({title, body, okLabel, danger, input})`. (`cloudLoad`의 `confirm` 1곳은 의도적.)
5. 저장은 `persist()`(전체) / `schedulePersist()`(입력 중) / `saveUiOnly()`(UI만). 새 저장 코드는 `safeSetItem` 경유.
6. 편집 중 포커스 보존: input 이벤트에서는 `refreshRowCalc`/`refreshLineupRow`/`refreshCalcRow`로 계산 셀만 갱신, change/click에서만 전체 `render()`.
7. 디자인 토큰만 사용(`:root` 변수, 굵기 400/510/590/650, 화면당 `.btn.primary` 1개, 이모지 금지). 상세는 `index.html` 11–38행.
8. `.tabs`는 `overflow-x:auto` — 탭에 음수 margin 금지.
9. 시트 열 구성을 바꾸면 `SHEET_LAYOUT_VERSION`을 올린다.

---

## 7. 설정 모달 항목과 `rules.js` 기대 구조

### 7.1 설정 모달(`#modal-settings`, index.html 640–746) **[확인]**

| 섹션 | DOM | `state` 필드 | 비고 |
|---|---|---|---|
| 수수료 계산 | `#set-vat` | `rules.vatIncluded` | 켜면 `effectiveRate` ×1.1 |
| 배송지 복사 형식 | `#set-copyfmt`, `#copyfmt-preview` | `rules.copyFormat` | `{name} {phone} {zip} {address}` 치환(`formatAddress` 1761). **현재 이 형식은 어디서도 실제 복사에 쓰이지 않음** — 클릭복사는 셀 값 단일, 입력준비는 JSON **[확인]** |
| 카테고리·수수료율·키워드 | `#fee-rows`(name/rate/kw), `#btn-add-cat`, `#set-defcat`, `#set-defrate`, `#rules-cat-count` | `rules.categories[]`, `rules.defaultCategory`, `rules.defaultFeeRate` | |
| 규칙 파일 백업 | `#btn-rules-export/-import/-default`, `#in-rules` | | `rules.json` |
| 보안·개인정보 | `#btn-security-clear` | | `reset(true)` = orders/states/deleted/ops/sourcingMap 삭제, rules·ui 유지 |
| 워크북에서 규칙 가져오기 | `#btn-import-workbook`, `#in-workbook` | rules/ops/sourcingMap | v9 시트명 기준(§2.13) |
| 결제창 자동입력 | `#set-myphone`, `#oh-bookmarklet`, `#btn-copy-bookmarklet` | `rules.myPhone` | 크롬 확장 설치 안내 텍스트 포함 |
| 구글시트 연동 | `#set-cloud-enabled`, `#set-cloud-clientid`, `#set-cloud-sheet`, `#set-cloud-range`, `#cloud-fields`, `#cloud-origin` | `cloud.*` | |

### 7.2 `rules.js`가 제공해야 하는 `window.DEFAULT_RULES` **[확인: 참조 필드로 역추적]**
```js
window.DEFAULT_RULES = {
  vatIncluded: true,                 // loadRulesDefaults 236
  copyFormat: "{name} / {phone} / ({zip}) {address}",
  defaultCategory: "기타",
  defaultFeeRate: 10.8,              // % 단위 (VAT 미포함 기본율)
  myPhone: "",                       // 기기 설정 — importRules/importWorkbook 시 보존
  categories: [
    { name: "카테고리명", feeRate: 10.8, keywords: ["키워드", ...] },   // classify: 최장 키워드 일치
    ...
  ]
};
```
`loadRulesDefaults`가 빠진 필드를 채우므로 최소 `{categories:[]}`만 있어도 기동은 된다. 저장소에 `rules.js`가 없으므로 **새로 만들어야 하며**, 9월 워크북 `수수료` 시트의 (플랫폼 × 카테고리) 표는 지금 구조(카테고리 → 단일 수수료율)에 바로 안 맞는다 **[확인: 수수료 시트 헤더는 플랫폼별 결제/검색/쿠폰/부가세/총수수료 다열 구조]**. 판매사이트별 수수료가 필요하면 `rules.categories`에 `site` 차원을 추가하거나 `feeRate`를 `{site: rate}`로 확장해야 한다 **[추정: 설계 결정 필요]**.

---

## 8. "새 소스 36열"을 이 모델에 흡수하려면 — 수정 지점

### 8.1 36열 ↔ 기존 필드 대응 **[확인: 헤더 비교]**

| # | 36열 헤더 | 기존 `o.*` | 처리 |
|---|---|---|---|
| 1 | 수집일 | (없음) | `raw` 보존 |
| 2 | 주문일 | `orderDate` | 별칭 있음 |
| 3 | 판매사이트 주문번호 | `orderNumber` | **별칭 추가**(현재는 부분포함 우연) |
| 4 | 판매사이트명 | (없음) → **신규 `siteName`** | 수수료율/집계 축으로 필요 |
| 5 | 판매자ID | (없음) → **신규 `sellerId`**(또는 raw만) | 계정 구분용 |
| 6 | 판매가 | **`paymentAmount`로 매핑**(별칭 추가) | 마진식의 "결제액" 자리. 워크북 식은 판매가 기준 |
| 7 | 배송비금액 | (없음) → **신규 `shippingFee`** | 워크북 마진식은 배송비도 수수료 차감 후 합산 |
| 8 | 마스터상품코드 | `productId` 후보 | 비어 있을 수 있음 **[추정]** |
| 9 | 판매사이트 상품코드 | **`productId`**(별칭 추가) | `sourceKey`/`coupangLinkFor`가 이 값을 씀 |
| 10 | 상품명 | `productName` | 별칭 있음 |
| 11 | 판매자상품코드 | raw | |
| 12 | 주문선택사항 | **`option`**(별칭 추가) | `keyOf` 구성요소 |
| 13 | 주문수량 | `quantity` | 별칭 있음 |
| 14 | 에누리 | (없음) → **신규 `discount`** | 마진식 차감항 |
| 15 | 구매링크 | **`sourcingLink`** — 지금은 FIELDS에 없음(매핑표/DB에서만 옴) → **FIELDS에 추가** | 소스가 직접 링크를 주므로 매핑표 의존이 사라짐 |
| 16 | 구매가 | **`sourcingPrice`** → FIELDS 추가 | |
| 17 | 구매자명 | (없음) → `buyerName`(raw만도 가능) | 블랙리스트 보조 |
| 18 | 수령자명 | **`recipient`**(별칭 추가) | |
| 19 | 수령자전화번호 | `phone` | 별칭 부분포함 OK, 명시 추가 권장 |
| 20 | 수령자휴대폰번호 | (없음) → `mobile` 또는 phone 폴백 | 블랙리스트 뒷 8자리 비교 소스 |
| 21 | 배송지우편번호 | `zipcode` | 부분포함 OK |
| 22 | 배송지주소 | `address` | **별칭 추가 필수** — 현재는 `"배송지"` 별칭이 `배송지우편번호`에 먼저 걸려 오매핑(§3.2) |
| 23 | 배송메세지 | (없음) → `deliveryMemo` | 입력준비 복사에 포함 여부는 정책 |
| 24 | 담당자 | **`manager`** → FIELDS 추가(양방향) | 기존 시트 열 이름과 동일 |
| 25 | 구매처 | (없음) → **신규 `vendor`** | 워크북에서 사용자 입력열. `sourcingLinks[].source`와 겹침 |
| 26 | 계정 | (없음) → **신규 `account`** | **민감: 화면 표시만, 클라우드/백업 제외 정책 필요** |
| 27 | 구매금액 | **`sourcingCost`에 해당하는 사용자 입력** → 신규 `purchaseAmount` | 기존은 단가×수량 계산값. 소스는 실결제총액을 사용자가 입력 |
| 28 | 주문번호　앞부분(전각 공백) | (없음) → `purchaseOrderNo`/`orderId`에 대응 **[추정]** | 워크북 실데이터에서는 구매처 주문 URL이 들어감. 기존 시트 "주문ID"와 같은 용도 |
| 29 | 결제일시 | (없음) → `paidAt` | "딸깍 주문처리" 시 자동 기록 대상 |
| 30 | 카드정보 | (없음) → `card` | **민감** |
| 31 | 포인트 | (없음) → `points` | |
| 32 | 주문여부 | **`status`와 매핑**(`"O"` ↔ purchased) | 왕복 시 역변환 |
| 33 | 한줄메모 | `memoLog` 요약 또는 신규 `note` | 왕복은 한 줄 문자열이어야 함 |
| 34 | 주문고유번호 | (없음) → **신규 `uid`** — **`keyOf`의 새 기본키로 최적** | 송장업로드리스트 대조키(워크북 4번 시트) |
| 35 | 배송사명 | **`courier`** — 값이 **T코드**(T025 등) | 시트 select는 한글명 → 내보낼 때 코드로 |
| 36 | 송장번호 | **`invoiceNumber`** | |

배송사 코드(워크북 메모 기준) **[확인]**: 업직 T048 · CJ T025 · 롯데 T082 · 천일택배 T069 · 로젠 T030 · 한진 T081. 아카이브 `core.js` 116–128에 우체국 T005·경동 T060·대신 T044·일양 T042·직접배송 T098이 추가돼 있는데 이 5개는 **출처 미확인 [추정]**.

### 8.2 파일·함수 단위 수정 지점

**`app.js`**

| 영역 | 함수/상수 | 줄 | 할 일 |
|---|---|---|---|
| 상수 | `FIELDS` | 26–38 | 별칭 추가(판매사이트 주문번호·판매가·판매사이트 상품코드·주문선택사항·수령자명·수령자전화번호·배송지우편번호·배송지주소) + **신규 key**(siteName, shippingFee, discount, sourcingLink, sourcingPrice, manager, vendor, account, purchaseAmount, orderId, paidAt, card, points, orderedFlag, note, uid, courier, invoiceNumber, mobile, deliveryMemo, buyerName). `req`는 그대로 2개 |
| 상수 | `COURIERS` | 48 | `[{code, name, short}]`로 바꾸고 `courierSelectHtml` 1931·`invoiceRow`·`buildOrders`에서 코드↔이름 변환 |
| 상수 | `INVOICE_HEADERS` | 51 | **36열 헤더 배열로 교체**(전각공백 포함 그대로) |
| 상수 | `SHEET_LAYOUT_VERSION` | 52 | 올리기 |
| 빌드 | `buildOrders` | 466–492 | 신규 필드 생성 + `courier` T코드→이름, `status`는 주문여부 `"O"`면 `purchased`, 송장번호 있으면 `invoiced` |
| 빌드 | `keyOf` | 454 | `uid`가 있으면 `uid` 단독, 없으면 기존 조합 **(states 복원 호환 위해 폴백 유지)** |
| 빌드 | `blankOrder` | 2318 | 신규 필드 기본값 |
| 보정 | `normalizeOrder` | 294 | 신규 필드 기본값 |
| 저장 | `persist` states 스냅샷 | 571–576 | 신규 사용자 입력 필드(vendor, account, purchaseAmount, paidAt, card, points, note …) 추가. **account/card는 `oh_states_v1`에 넣을지 별도 키로 뺄지 결정** |
| 마진 | `computeMargin` | 274 | 워크북 식으로 교체: `((판매가 + 배송비) × (1 − rate×1.1) − 구매금액 − 에누리) ÷ 1.1`(README/HANDOFF·아카이브 `core.js` 280–332에서 검증됨) 또는 기존 식 유지 중 택일. `csCost` 차감은 유지 |
| 분류 | `classify` | 254 | 판매사이트명 축 추가 여부(§7.2) |
| 시트 | `SHEET_COLS` | 1779–1803 | 열 추가: 판매사이트명·구매처·계정(마스킹)·구매금액·주문번호앞부분·결제일시·포인트·한줄메모·배송메세지·블랙리스트 경고. `MONEY_KEYS` 111에 금액 키 추가 |
| 시트 | `setSheetField` | 2066 | 신규 숫자 키 변환 분기 |
| 시트 | `sheetFiltered` 검색 hay | 1874 | uid·구매처 포함 |
| 시트 | `courierSelectHtml` | 1931 | 코드 기반 |
| 시트 | `sheetRowClass` | 2010 | 블랙리스트 `row-danger`(빨강) 추가 |
| 내보내기 | `invoiceRow` | 2717 | 36열 기준 재작성: `raw` 복원 + 앱 편집값 덮어쓰기(담당자·구매처·계정·구매금액·주문번호앞부분·결제일시·카드정보·포인트·주문여부·한줄메모·배송사명(코드)·송장번호) |
| 내보내기 | `exportInvoice` | 2682 | 대상 조건 재정의(송장 있는 행만? 전체?) + 시트명 + `.xls` 여부(§5.1) |
| 내보내기 | `sanitizeExportRows` | 154 | 왕복 파일에서의 적용 범위 조정(§4.2) |
| 내보내기 | `exportFull` | 2648 | 신규 필드 반영, **계정·카드정보 열 절대 제외** |
| 읽기 | `readWorkbook` | 370 | `.xls` BIFF 대응(§5.1) |
| 자동입력 | `copyAutofill` | 2530 | 변경 없음(phone=myPhone 불변식 유지). 배송메세지 포함 여부만 결정 |
| import | `importWorkbook` 계열 | 2798–3088 | 9월 워크북 시트명으로 갱신하거나(블랙리스트·수수료만) 제거 |
| 렌더 | `renderInvoicePane` | 1609 | "39열" 문구 → 36열, 상태 배지 기준 |
| 렌더 | `renderCsPane` | 851 | 워크북 CS 시트 열(방식·구분·진행상태·세부단계·조치내용)을 참고해 CS_TYPES/CS_STATUSES 확장 **[추정: 설계 결정]** |
| 신규 | 블랙리스트 | — | `state.blacklist`(신규 LS 키) + 판정 함수(아카이브 `core.js` 341–478 `checkBlacklist` 이식) + 설정/별도 탭 UI + `buildOrders`·`refreshRowCalc`에서 `o.blacklist = {level, reasons}` 계산 |

**`index.html`**
- `#modal-export` 문구("formV4.xlsx 39열")와 `#in-order` accept, 도움말 문구 갱신.
- 시트 열 추가 시 CSS 신규 클래스(`row-danger` 등)는 토큰(`--bad-row`)만 사용.
- `<script src="app.js?v=37">` → v 올리기, `vendor/xlsx.full.min.js` 라인 처리(제거 또는 동봉).

**신규/복원 파일**
- `rules.js`(없음) — §7.2 구조로 신규 작성.
- `vendor/xlsx.full.min.js`(없음) — 동봉하거나 §5.1 대체.

---

## 9. 이 앱을 유지한 채 개선할 때 위험한 지점

| # | 지점 | 왜 위험한가 | 대응 |
|---|---|---|---|
| 1 | **전역 바인딩**: `XLSX`, `window.DEFAULT_RULES`, `window.google` | 셋 다 스크립트 로드 순서에 의존하는 암묵 전역. 현재 저장소에는 `vendor/`도 `rules.js`도 없어 **바로 열면 `loadRules` 245에서 TypeError** | 전역 존재 확인 + 폴백(`DEFAULT_RULES || {categories:[]}`), XLSX는 어댑터 함수 하나로 감싸기 |
| 2 | **`SHEET_LAYOUT_VERSION`(26)** | 열 키 추가/삭제 후 안 올리면 기존 사용자의 `colOrder`에 새 열이 뒤에만 붙고, 삭제된 키는 `normalizeSheetLayoutForCurrentVersion`이 걸러주긴 함. 올리면 사용자의 열 순서·행 높이가 초기화됨 | 올리되 릴리스 노트로 고지 |
| 3 | **`keyOf` 변경** | `oh_states_v1`의 키가 `주문번호¶상품ID¶옵션¶수취인`으로 이미 저장돼 있음. 키 규칙을 바꾸면 "처음으로 → 재업로드" 복원이 전부 끊김 | 새 키(uid) 우선 + 옛 조합 키 폴백으로 1회 마이그레이션. `states`는 현재 주문 밖 키도 90일 보존해야 함(의도적 설계) |
| 4 | **`o.raw`가 `oh_orders_v1`에 통째 저장** | 36열 × 수백 행이면 localStorage 5MB 근접 가능. `raw:false` 문자열이라 크기 큼 | 필요 열만 남기거나 `safeSetItem` 경고 확인. `states`에는 raw 없음 |
| 5 | **캐시버스팅 `?v=`** | `app.js`·`rules.js` 수정 후 `index.html`의 v를 안 올리면 브라우저가 옛 파일을 씀. 두 문서 모두 "사용자가 매번 겪음"이라고 기록 | 수정 때마다 v 증가를 체크리스트에 |
| 6 | `readWorkbook`이 **첫 시트만** 읽음 + `raw:false` | 9월 워크북 `2.주문서`는 헤더가 3행째, 앞 2행은 메모(배송사 코드 등). 워크북을 그대로 올리면 `설명` 시트가 먼저 읽힘 | 소스 파일(36열, 헤더 1행)은 문제 없음. 워크북 import는 별도 경로로 |
| 7 | `autoMap` 2단계 **양방향 부분포함** | `"주문번호"`가 `판매사이트 주문번호`/`주문고유번호`/`주문번호　앞부분` 셋에 걸림 → 헤더 순서가 바뀌면 다른 열을 잡음 | 36열 헤더는 **정확일치 별칭**을 먼저 두고, 부분포함은 최후 폴백으로만 |
| 8 | `sanitizeExportCell`의 `'` 접두 | 재업로드 파일 값 변형 가능(§4.2) | 왕복 파일은 원본 문자열 그대로, 사용자 입력 열만 방어 |
| 9 | `rowHeights`가 `o.id` 기준, `o.id`는 업로드 순번+hash | 재업로드마다 id가 바뀌어 행 높이 캐시가 쌓임 | uid 기준으로 바꾸거나 무시 |
| 10 | 렌더 함수 안 `addEventListener` 금지 / DOM id 삭제 시 `init()` 널 참조 | §6.3 | 새 id 추가 시 `init()`에 옵셔널 가드 |
| 11 | `paymentAmount` 의미 변경 | 기존 "결제액(수수료 전 매출)"에 "판매가"를 넣으면 KPI 라벨("오늘의 매출")은 맞지만 배송비 처리·마진식이 달라짐. 옛 데이터(`oh_orders_v1`)와 섞이면 집계가 어긋남 | 마진식 교체와 함께 `LS` 버전(`_v2`) 올려 옛 데이터와 분리 **[추정: 권장]** |
| 12 | 계정/카드 정보 | 36열에 `계정`·`카드정보` 열이 있어 **`o.raw`에 실려 `oh_orders_v1`·`exportFull`·states로 흘러갈 수 있음** | `buildOrders`에서 raw 저장 전 해당 열 분리 → 별도 키/마스킹, `exportFull`에서 제외. 왕복 파일에는 원래 값이어야 하므로 별도 저장소에서 복원 |
| 13 | `.xls` BIFF | §5.1 | 사용자에게 `.xlsx` 내보내기 가능 여부 확인이 가장 저렴 |
| 14 | `cloudLoad`의 `ensureGis`가 외부 스크립트 로드 | 100% 로컬 원칙의 유일한 예외(opt-in). 건드리지 말 것(문서 명시) | 유지 |
| 15 | `importWorkbook` 계열 900줄 | v9 시트명 하드코딩이라 9월 워크북에서는 전부 0건 → "가져올 수 있는 탭을 찾지 못했어요" | 블랙리스트·수수료만 새 로더로 교체, 나머지는 제거 대상 |

---

## 부록 A. 아카이브(`archive/v2-rebuild`)에서 가져올 만한 것 **[확인]**
- `core.js` 341–478: `normName/splitNames/normAddr/addrTokens/wildRe/exactHit/looseHit/nameMatches/addrMatches/checkBlacklist(o, blacklist)` → `{level:"danger"|"warn"|"", reasons, hits}`. 입력은 `o.recipient/buyerName/address/recvPhone/recvTel`.
- `core.js` 116–160: `COURIERS[{code,name,short}]`, `courierByCode`, `courierByName`, `normalizeCourier`.
- `core.js` 280–332: `computeOrder` 워크북 마진식(실측 검증됨).
- `xlsx-lite.js`(이미 루트로 승격): `read(arrayBuffer)`(xlsx만), `write(sheets)`→Blob, `serialToString`, `dateToSerial`.
- **가져오면 안 되는 것**: `ORDER_COLUMNS` 53열(워크북 시트 구조 이식), `views.js`/`template.js`/`import.js`의 시트 구조.

## 부록 B. 9월 워크북에서 참고할 실데이터(구조만)
- `2.주문서`: 1–2행 메모(배송사 코드, 색 규칙: 역마진/품절 회색, 취소 취소선, 직접입력 빨강), 3행 헤더 = 36열 소스 열 + 계산 열(운송장업로드, 카테고리, 결제기준가, 배송비-배송비수수료, 매출일자, 매출금액, 순마진금액, 마진률, 수수료율, 수수료율(VAT), 수수료, 부가세, 올라수수료) + 맨 끝 `블랙리스트`.
- `4.송장업로드리스트`: `주문고유번호`·`상태` 2열 — EMP 출고 목록과 대조하는 용도. `uid`를 키로 쓰는 근거.
- `수수료`: 플랫폼 × 카테고리 다열 표(결제/검색/쿠폰/부가세/총수수료) + 우측에 `플랫폼·카테고리·수수료율·수수료율(vat포함)` 정규화 표.
- `CS`: 일자·주문번호(링크)·고객명·구매 플랫폼·제품명·연락처·방식·구분·진행상태·세부단계·조치내용 + 상단 CS 멘트/매뉴얼 텍스트.
- `블랙리스트`: 이름 1열(주소·연락처 열 유무는 미확인 **[추정]**).
