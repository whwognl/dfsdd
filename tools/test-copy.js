#!/usr/bin/env node
/* 배송지 분리·전화·우편번호·페이로드 테스트 — node tools/test-copy.js (전부 지어낸 주소) */
"use strict";
const path = require("path");
const C = require(path.join(__dirname, "..", "copy-helpers.js"));
let pass = 0, fail = 0;
function ok(name, cond, extra) { if (cond) { pass++; console.log("  ok  " + name); } else { fail++; console.log("  FAIL " + name + " — " + extra); } }

const CASES = [
  ["부산광역시 해운대구 해운대로 123 456동 789호 ( 우동, 해운대아파트 )", "부산광역시 해운대구 해운대로 123", "456동 789호", "우동, 해운대아파트", "road"],
  ["서울 강남구 테헤란로12길 34, 5층 (역삼동)", "서울 강남구 테헤란로12길 34", "5층", "역삼동", "road"],
  ["경기도 용인시 기흥구 동백중앙로 16-4 101동 1001호", "경기도 용인시 기흥구 동백중앙로 16-4", "101동 1001호", "", "road"],
  ["강원도 홍천군 서면 반곡리 산 12-3", "강원도 홍천군 서면 반곡리 산 12-3", "", "", "jibun"],
  ["인천 계양구 계산동 123-4 하나빌라 B동 201호", "인천 계양구 계산동 123-4", "하나빌라 B동 201호", "", "jibun"],
  ["제주특별자치도 제주시 애월읍 하귀로 5", "제주특별자치도 제주시 애월읍 하귀로 5", "", "", "road"],
  ["대전 유성구 봉명동 행복아파트 102동 303호", "대전 유성구 봉명동", "행복아파트 102동 303호", "", "guess"],
  ["서울 종로구 종로 1 그랑서울 3층 (종로1가)", "서울 종로구 종로 1", "그랑서울 3층", "종로1가", "road"],
  ["서울 구로구 디지털로 300 1층", "서울 구로구 디지털로 300", "1층", "", "road"],
  ["주소불명 텍스트만", "주소불명 텍스트만", "", "", "none"],
  ["서울 마포구 월드컵로 10 (성산동) 삼성아파트 101동 202호", "서울 마포구 월드컵로 10", "(성산동) 삼성아파트 101동 202호", "", "road"],
  ["경기 성남시 분당구 판교역로 166,  카카오 2층", "경기 성남시 분당구 판교역로 166", "카카오 2층", "", "road"],
  ["서울특별시 강서구 공항대로 지하 200", "서울특별시 강서구 공항대로 지하 200", "", "", "road"],
  ["서울 중구 을지로 100 을지로타워 20층", "서울 중구 을지로 100", "을지로타워 20층", "", "road"],
  ["경기 수원시 팔달구 매산로1번길 11 2층", "경기 수원시 팔달구 매산로1번길 11", "2층", "", "road"],
  ["경기도 화성시 동탄구 송동 693 동탄2신도시 하우스디 더 레이크 263동 1004호", "경기도 화성시 동탄구 송동 693", "동탄2신도시 하우스디 더 레이크 263동 1004호", "", "jibun"],
  ["강원특별자치도 원주시 문막읍 건등로 41 신한아파트 105동 502호 ( 건등리 )", "강원특별자치도 원주시 문막읍 건등로 41", "신한아파트 105동 502호", "건등리", "road"]
];
console.log("[1] 주소 분리");
CASES.forEach((c, i) => {
  const r = C.splitAddress(c[0]);
  const good = r.base === c[1] && r.detail === c[2] && r.ref === c[3] && r.method === c[4];
  ok(`#${i + 1} ${c[0].slice(0, 26)}`, good, JSON.stringify({ base: r.base, detail: r.detail, ref: r.ref, method: r.method }));
});

console.log("[2] 전화");
ok("010 하이픈", C.phoneForms("01012345678").hyphen === "010-1234-5678");
ok("하이픈 입력도 정리", C.phoneForms("010-1234-5678").plain === "01012345678");
ok("안심번호 4-4-4", C.phoneForms("0502-1234-5678").parts.join("/") === "0502/1234/5678");
ok("짧은 번호 무효", !C.phoneForms("1234").valid);

console.log("[3] 우편번호");
ok("4자리 → 0 채움", C.normZip(1234) === "01234");
ok("5자리 유지", C.normZip("48087") === "48087");
ok(".0 제거", C.normZip("18488.0") === "18488");

console.log("[4] 페이로드");
const o = { recipient: "홍길동", phone: "0502-9999-9999", zipcode: 1234, address: "부산광역시 해운대구 해운대로 123 456동 789호 (우동)", deliveryMsg: "문 앞\n놓아주세요" };
ok("내 번호 없으면 null", C.buildPayload(o, "") === null);
const p = C.buildPayload(o, "010-1111-2222");
ok("고객 번호는 어디에도 없음", p && JSON.stringify(p).indexOf("9999") === -1);
ok("내 번호만 들어감", p && p.phone === "010-1111-2222" && p.phoneParts[2] === "2222");
ok("기본/상세/참고 분리", p && p.base === "부산광역시 해운대구 해운대로 123" && p.detail === "456동 789호" && p.ref === "우동");
ok("허용된 키만", p && Object.keys(p).sort().join(",") === "__oh,addr,base,detail,memo,name,phone,phoneDigits,phoneParts,ref,split,ts,zip");
ok("배송메시지 줄바꿈 정리", p && p.memo === "문 앞 놓아주세요");
const txt = C.shippingText(o, "010-1111-2222");
ok("전체 텍스트 줄 형식", /^받는분: 홍길동\n연락처: 010-1111-2222\n우편번호: 01234\n주소: /.test(txt), txt);

console.log("\n결과: " + pass + " 통과 / " + fail + " 실패");
process.exit(fail ? 1 : 0);
