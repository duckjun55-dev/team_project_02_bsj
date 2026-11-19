// 예약 저장 — 브라우저 localStorage (같은 브라우저에서 챗봇 → 관리자 화면으로 넘어간다)
// 처음 열면 지어낸 데모 예약을 넣어 둔다. 실제 개인정보가 아니다.
import { fee, regionOf, districtOf, todayKST } from './rules.js';

const KEY = 'homedrop.reservations.v1';
let memory = null; // 저장소를 못 쓰는 브라우저(사생활 보호 모드 등)에서는 메모리에만 둔다

function shift(n) {
  return new Date(Date.parse(todayKST() + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
}

function seed() {
  const rows = [
    ['HD-DEMO-0001', '김하늘', '010-0000-0001', '서울 강남구 테헤란로 1', 'KE901', 1, '18:30', 'T2', 3, 1, 1, '08:30', '접수'],
    ['HD-DEMO-0002', '이바다', '010-0000-0002', '서울 송파구 올림픽로 2', 'OZ102', 1, '19:10', 'T1', 2, 0, 1, '09:20', '배차 완료'],
    ['HD-DEMO-0003', '박구름', '010-0000-0003', '서울 서초구 반포대로 3', '7C1101', 1, '20:00', 'T1', 4, 2, 1, '09:50', '접수'],
    ['HD-DEMO-0004', '최별', '010-0000-0004', '서울 강동구 천호대로 4', 'KE703', 1, '21:00', 'T2', 5, 1, 1, '09:40', '접수'],
    ['HD-DEMO-0005', '정솔', '010-0000-0005', '서울 마포구 월드컵로 5', 'LJ201', 1, '17:00', 'T1', 2, 0, 1, '08:10', '배차 완료'],
    ['HD-DEMO-0006', '한결', '010-0000-0006', '경기 성남시 분당구 정자로 6', 'TW281', 2, '15:00', 'T1', 3, 1, 2, '06:30', '접수'],
    ['HD-DEMO-0007', '윤슬', '010-0000-0007', '인천 연수구 송도대로 7', 'KE017', 2, '22:00', 'T2', 2, 0, 2, '13:00', '수거 완료'],
    ['HD-DEMO-0008', '서아라', '010-0000-0008', '서울 노원구 동일로 8', 'OZ541', 0, '23:30', 'T1', 1, 0, 0, '09:00', '공항 인도'],
  ];
  return rows.map(([tag, name, phone, address, flight, dd, departTime, terminal, bags, large, pd, pickupTime, status]) => ({
    tag, name, phone, address, district: districtOf(address), region: regionOf(address),
    flight, departDate: shift(dd), departTime, terminal, bags, large,
    pickupDate: shift(pd), pickupTime, fee: fee(bags, large), status, demo: true, createdAt: new Date().toISOString(),
    demoDay: { depart: dd, pickup: pd }, // 오늘에서 며칠 뒤인지 — 열 때마다 날짜를 다시 계산하는 데 쓴다
  }));
}

/**
 * 데모 예약 날짜를 「오늘 기준」으로 다시 맞춘다 — 며칠 지나도 지난 예약으로 남지 않게.
 * 예전 판(demoDay 없음)으로 저장된 데모 예약은 새 데모 예약으로 바꾼다. 챗봇에서 받은 예약은 건드리지 않는다.
 */
function refreshDemo(list) {
  let out = list;
  if (out.some((r) => r.demo && !r.demoDay)) {
    const kept = out.filter((r) => !r.demo);
    out = [...kept, ...seed()];
  }
  let changed = out !== list;
  for (const r of out) {
    if (!r.demo || !r.demoDay) continue;
    const dep = shift(r.demoDay.depart);
    const pick = shift(r.demoDay.pickup);
    if (r.departDate !== dep || r.pickupDate !== pick) { r.departDate = dep; r.pickupDate = pick; changed = true; }
  }
  return { list: out, changed };
}

export function load() {
  if (memory) return memory;
  let list = null;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) list = JSON.parse(raw);
  } catch { /* 저장소를 못 씀 */ }
  if (!Array.isArray(list)) { memory = seed(); save(memory); return memory; }
  const fresh = refreshDemo(list);
  memory = fresh.list;
  if (fresh.changed) save(memory);
  return memory;
}

export function save(list) {
  memory = list;
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* 메모리에만 */ }
}

export function add(r) {
  const list = load();
  list.unshift(r);
  save(list);
}

export function find(tag) {
  return load().find((r) => r.tag.toUpperCase() === tag.toUpperCase()) || null;
}

export function update(tag, patch) {
  const list = load().map((r) => (r.tag === tag ? { ...r, ...patch } : r));
  save(list);
  return list;
}

export function reset() {
  memory = null;
  try { localStorage.removeItem(KEY); } catch { /* 무시 */ }
  return load();
}

// 다른 탭(챗봇)에서 예약이 생기면 관리자 화면이 바로 알 수 있게
export function onChange(cb) {
  window.addEventListener('storage', (e) => {
    if (e.key === KEY) { memory = null; cb(load()); }
  });
}
