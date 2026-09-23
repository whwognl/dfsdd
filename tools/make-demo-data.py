#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
데모(자동화 관제) 데이터 추출 — 실제 워크북에서 '패턴'만 뽑고 개인정보는 한 글자도 담지 않습니다.
  python3 tools/make-demo-data.py <워크북.xlsx>  →  demo-data.js (window.DemoData)
담는 것: 상품·옵션·판매가·매입가·구매처·택배사(빈도), 주문 시간대/요일/수량 분포, 지역(시·도 + 시·군·구까지만),
        일별 매출의 '흔들림'(7일 평균 대비 비율), CS 유형 비율.  담지 않는 것: 이름·전화·주소 상세·계정·계좌·카드·주문번호.
"""
import sys, re, json, datetime, statistics, warnings, collections
warnings.filterwarnings("ignore")
import openpyxl

SRC = sys.argv[1]
OUT = sys.argv[2] if len(sys.argv) > 2 else "demo-data.js"
wb = openpyxl.load_workbook(SRC, read_only=True, data_only=True)

def rows_of(name):
    ws = wb[name]
    it = ws.iter_rows(values_only=True)
    header = [str(v).replace("\n", " ").strip() if v is not None else "" for v in next(it)]
    return header, it

def num(v):
    try:
        if v is None or v == "": return None
        return float(v)
    except Exception: return None

def clean_name(s):
    s = str(s or "")
    s = re.sub(r"\[[^\]]*[\]\}]", " ", s)                                   # [#15] · [특허농법] 같은 대괄호 태그 제거
    s = re.sub(r"재구매폭주|초고당도\s*brix|초고당도|프리미엄|제주직송|전국최저특가|전국최저마진|국내산|산지직송|당일수확|무료배송", " ", s, flags=re.I)
    s = s.replace("_", "")
    s = re.sub(r"\s+", " ", s).strip(" -·/")
    return s[:24]

# ---------- 주문 이력 (운송장 전송후) ----------
H, it = rows_of("운송장 전송후")
ix = {h: i for i, h in enumerate(H)}
prod = collections.defaultdict(lambda: {"n": 0, "price": [], "cost": [], "margin": [], "vendor": collections.Counter(), "courier": collections.Counter(), "qty": collections.Counter()})
hours = [0] * 24; wdays = [0] * 7; qtys = collections.Counter(); regions = collections.Counter()
couriers = collections.Counter(); vendors = collections.Counter(); discounts = collections.Counter()
n_rows = 0
for r in it:
    if r is None or len(r) < 20: continue
    name = r[ix["상품명"]]; opt = r[ix["옵션"]]
    if not name: continue
    n_rows += 1
    key = (clean_name(name), re.sub(r"\s+", " ", str(opt or "")).strip()[:24])
    p = prod[key]; p["n"] += 1
    sp = num(r[ix["(실)판매가"]]) or num(r[ix["판매가"]]); cp = num(r[ix["매입가"]]); mg = num(r[ix["순마진"]])
    if str(r[ix["거래처"]] or "").strip() == "리뷰" or (sp and cp and cp > sp): p["n"] -= 1; continue
    if sp and sp > 0: p["price"].append(sp)
    if cp and cp > 0: p["cost"].append(cp)
    if mg is not None: p["margin"].append(mg)
    v = str(r[ix["거래처"]] or "").strip(); c = str(r[ix["택배사"]] or "").strip()
    if v: p["vendor"][v] += 1; vendors[v] += 1
    if c: p["courier"][c] += 1; couriers[c] += 1
    q = int(num(r[ix["주문수량"]]) or 1); p["qty"][q] += 1; qtys[q] += 1
    d = r[ix["주문일"]]
    if isinstance(d, datetime.datetime): hours[d.hour] += 1; wdays[d.weekday()] += 1
    dc = num(r[ix["할인금액"]]);
    if dc is not None: discounts[int(dc)] += 1
    addr = str(r[ix["주소"]] or "").split()
    if len(addr) >= 2 and re.search(r"(시|군|구)$", addr[1]): regions[addr[0] + " " + addr[1]] += 1
    elif len(addr) >= 1 and addr[0]: regions[addr[0]] += 1

products = []
for (name, opt), p in prod.items():
    if p["n"] < 5 or not p["price"]: continue
    price = statistics.median(p["price"]); cost = statistics.median(p["cost"]) if p["cost"] else round(price * 0.72, -1)
    products.append({
        "name": name, "opt": opt, "n": p["n"], "price": int(round(price, -1)), "cost": int(round(cost, -1)),
        "vendor": (p["vendor"].most_common(1) or [("", 0)])[0][0], "courier": (p["courier"].most_common(1) or [("", 0)])[0][0],
        "qty": {str(k): v for k, v in p["qty"].most_common(4)}
    })
products.sort(key=lambda x: -x["n"]); products = products[:80]

# ---------- 일별 매출 흔들림 (매출요약) ----------
H2, it2 = rows_of("매출요약")
series = []
for r in it2:
    d = r[0]
    if isinstance(d, datetime.datetime) and num(r[3]): series.append((d.date(), float(r[3]), float(r[2] or 0)))
series.sort()
noise = []
for i, (d, rev, cnt) in enumerate(series):
    win = [x[1] for x in series[max(0, i - 3): i + 4]]
    m = sum(win) / len(win)
    if m > 0: noise.append(round(max(0.55, min(1.7, rev / m)), 3))
noise = noise[-120:]

# ---------- CS 유형 비율 (텍스트는 담지 않고 개수만) ----------
H3, it3 = rows_of("CS ")
cs = collections.Counter(); cs_n = 0
KW = [("반품접수", r"반품|회수|반송"), ("차액협의", r"차액|보상|부분환불|환급|입금"), ("출고중지요청", r"취소|출고중지|출고 중지"),
      ("택배미수령", r"미수령|분실|못 받|안 왔|안왔"), ("품절취소", r"품절"), ("과배송", r"과배송|오배송|잘못"), ("교환문의", r"교환"), ("배송문의", r"지연|언제|배송문의")]
for r in it3:
    if not r or len(r) < 8: continue
    txt = " ".join(str(x) for x in r[:8] if x)
    if not txt.strip() or not r[0]: continue
    cs_n += 1
    for k, pat in KW:
        if re.search(pat, txt): cs[k] += 1; break
    else: cs["기타CS"] += 1

data = {
    "source": "실제 운영 워크북 패턴(개인정보 제외) · 생성 " + datetime.date.today().isoformat(),
    "orders": n_rows,
    "products": products,
    "hours": hours, "weekdays": wdays,
    "qty": {str(k): v for k, v in qtys.most_common(6)},
    "regions": [[k, v] for k, v in regions.most_common(70)],
    "couriers": [[k, v] for k, v in couriers.most_common(8)],
    "vendors": [[k, v] for k, v in vendors.most_common(20)],
    "discounts": [[k, v] for k, v in discounts.most_common(5)],
    "noise": noise,
    "cs": {"total": cs_n, "mix": dict(cs.most_common())},
}
js = "/* demo-data.js — 자동화 관제 데모용 패턴 데이터. tools/make-demo-data.py 가 생성. 개인정보 없음(상품·가격·구매처·택배사·지역·시간대·CS 비율만) */\nwindow.DemoData = " + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n"
open(OUT, "w", encoding="utf-8").write(js)
print("rows", n_rows, "products", len(products), "regions", len(regions), "couriers", couriers.most_common(5), "vendors", vendors.most_common(6))
print("hours", hours); print("weekdays", wdays); print("qty", qtys.most_common(5)); print("discounts", discounts.most_common(5))
print("cs", cs_n, cs.most_common()); print("noise n", len(noise), noise[:10])
print("AOV", sum(p["price"] * p["n"] for p in products) / max(1, sum(p["n"] for p in products)))
for p in products[:25]: print("  ", p["n"], p["name"], "|", p["opt"], p["price"], p["cost"], p["vendor"], p["courier"])
