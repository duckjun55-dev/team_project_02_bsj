// 홈드랍 데모 규칙을 코드로 옮긴 것 (근거: docs/답변참고문서 「홈드랍_데모규칙_2026」, 기획서 7장)
// 실제 서비스 값이 아니라 시연용 값이다. 화면에도 「데모」로 표시한다.

export const RULES = {
  baseFee: 20000,      // 캐리어 1개
  addFee: 10000,       // 1개 추가마다
  largeFee: 5000,      // 28인치 이상 1개당
  maxBags: 8,          // 한 번에 예약할 수 있는 개수
  cutoffHours: 8,      // 수거는 출발 8시간 전까지
  callBeforeMin: 30,   // 수거 30분 전 기사 연락
  flightRangeDays: 6,  // 항공편 정보는 오늘부터 6일 뒤까지
  vehicleCapacity: 12, // 차량당 캐리어
  slotHours: 2,        // 배차 시간대 단위
};

export const PROHIBITED = [
  { group: '직접 휴대', items: '보조배터리 · 전자담배 · 라이터' },
  { group: '귀중품', items: '현금 · 귀금속 · 노트북 등' },
  { group: '위험물', items: '가스 · 인화성 물질' },
];

export const STATUSES = ['접수', '배차 완료', '수거 완료', '공항 인도'];

// ---------- 생활권역 (데모 규칙: 서울시 생활권계획 5권역 + 경기북부·경기남부·인천) ----------
const SEOUL = {
  도심: ['종로구', '중구', '용산구'],
  동북: ['성동구', '광진구', '동대문구', '중랑구', '성북구', '강북구', '도봉구', '노원구'],
  서북: ['은평구', '서대문구', '마포구'],
  서남: ['양천구', '강서구', '구로구', '금천구', '영등포구', '동작구', '관악구'],
  동남: ['서초구', '강남구', '송파구', '강동구'],
};
const GG_NORTH = ['고양', '남양주', '파주', '의정부', '양주', '구리', '포천', '동두천', '가평', '연천'];
const GG_SOUTH = ['수원', '성남', '용인', '부천', '화성', '안산', '안양', '평택', '시흥', '김포', '광주', '광명', '군포', '하남', '오산', '이천', '안성', '의왕', '양평', '여주', '과천'];
const INCHEON_GU = ['미추홀구', '연수구', '남동구', '부평구', '계양구', '강화군', '옹진군'];

// 권역별 「수거 → 공항 도착」 이동시간 (데모 값, 분)
export const TRAVEL_MIN = { '서울 도심': 70, '서울 서북': 60, '서울 서남': 60, '서울 동북': 90, '서울 동남': 90, 경기북부: 100, 경기남부: 100, 인천: 50, 기타: 120 };

export function districtOf(address = '') {
  const gu = address.match(/([가-힣]{1,4}[구군])(?=\s|$|,|\d)/);
  if (gu) return gu[1];
  const si = address.match(/([가-힣]{2,4})시/);
  return si ? si[1] + '시' : '';
}

// 여러 도시에 같은 이름이 있는 구 — 「서울」이 주소에 있을 때만 서울로 본다
const SHARED_GU = ['중구', '동구', '서구', '남구', '북구', '강서구'];
// 서울·경기·인천이 아닌 광역시·도
const OTHER_CITY = /(부산|대구|광주광역|광주시\s*[동서남북광]|대전|울산|세종|강원|충북|충남|충청|전북|전남|전라|경북|경남|경상|제주)/;

export function regionOf(address = '') {
  const a = address.replace(/\s+/g, ' ');
  const seoul = /서울/.test(a);
  if (!seoul && OTHER_CITY.test(a)) return '기타';
  if (/인천/.test(a) || INCHEON_GU.some((g) => a.includes(g))) return '인천';
  if (!seoul) {
    if (GG_NORTH.some((c) => a.includes(c))) return '경기북부';
    // 「광주」는 경기 광주시만(광주광역시는 위에서 「기타」)
    if (GG_SOUTH.filter((c) => c !== '광주').some((c) => a.includes(c)) || /(경기\s*)?광주시/.test(a)) return '경기남부';
  }
  for (const [name, list] of Object.entries(SEOUL)) {
    const hit = list.find((g) => a.includes(g));
    if (hit && (seoul || !SHARED_GU.includes(hit))) return '서울 ' + name;
  }
  return '기타';
}

// ---------- 요금 · 시간 ----------
export function fee(bags, large = 0) {
  if (!bags || bags < 1) return null;
  return RULES.baseFee + (bags - 1) * RULES.addFee + (large || 0) * RULES.largeFee;
}
export const won = (n) => (n == null ? '—' : n.toLocaleString('ko-KR') + '원');
export const feeText = (bags, large) =>
  `기본 ${won(RULES.baseFee)}` + (bags > 1 ? ` + 추가 ${bags - 1}개 × ${won(RULES.addFee)}` : '') +
  (large ? ` + 대형 ${large}개 × ${won(RULES.largeFee)}` : '');

export function todayKST() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
}
// 날짜·시각을 「한국 시간」 기준 Date 로
export const at = (date, time) => (date && time ? new Date(`${date}T${time}:00+09:00`) : null);
export function addMin(date, time, min) {
  const d = at(date, time);
  if (!d) return null;
  const k = new Date(d.getTime() + min * 60000 + 9 * 3600000); // KST 로 옮겨 읽기
  return { date: k.toISOString().slice(0, 10), time: k.toISOString().slice(11, 16) };
}
export function daysFromToday(date) {
  return Math.round((Date.parse(date + 'T00:00:00Z') - Date.parse(todayKST() + 'T00:00:00Z')) / 86400000);
}
export function fmtDate(date) {
  if (!date) return '—';
  const [, m, d] = date.split('-').map(Number);
  const w = '일월화수목금토'[new Date(date + 'T00:00:00Z').getUTCDay()];
  return `${m}월 ${d}일(${w})`;
}
export const fmtDT = (date, time) => (date ? `${fmtDate(date)} ${time || ''}`.trim() : '—');

export function inFlightRange(date) {
  const d = daysFromToday(date);
  return d >= 0 && d <= RULES.flightRangeDays;
}

/** 수거 시각 검사 — 문제가 있으면 안내 문장, 없으면 null */
export function checkPickup(r) {
  const p = at(r.pickupDate, r.pickupTime);
  const dep = at(r.departDate, r.departTime);
  if (!p) return null;
  if (p.getTime() < Date.now()) return '수거 희망 시각이 이미 지났어요. 앞으로의 날짜·시각을 알려 주세요.';
  if (dep && dep.getTime() - p.getTime() < RULES.cutoffHours * 3600000) {
    const last = addMin(r.departDate, r.departTime, -RULES.cutoffHours * 60);
    return `수거는 출발 ${RULES.cutoffHours}시간 전까지만 가능해요(데모 규칙). ${fmtDT(last.date, last.time)}까지의 시각으로 알려 주세요.`;
  }
  return null;
}

/**
 * 출발까지 시간이 모자라 수거를 받을 수 없는지 — 「출발 8시간 전」이 이미 지났으면 어떤 수거 시각도 규칙을 못 지킨다.
 * 문제가 있으면 안내 문장, 없으면 null
 */
export function checkDeparture(r) {
  const dep = at(r.departDate, r.departTime);
  if (!dep) return null;
  if (dep.getTime() < Date.now()) return `입력하신 출발 시각(${fmtDT(r.departDate, r.departTime)})이 이미 지났어요. 항공편을 다시 알려 주세요.`;
  if (dep.getTime() - RULES.cutoffHours * 3600000 < Date.now()) {
    return `이 항공편은 출발(${fmtDT(r.departDate, r.departTime)})까지 ${RULES.cutoffHours}시간이 남지 않아 수거 예약을 받을 수 없어요(수거는 출발 ${RULES.cutoffHours}시간 전까지, 데모 규칙). 더 늦게 출발하는 항공편을 알려 주세요.`;
  }
  return null;
}

export function checkBags(r) {
  if (r.bags != null && (r.bags < 1 || r.bags > RULES.maxBags)) return `캐리어는 한 번에 1~${RULES.maxBags}개까지 예약할 수 있어요(데모 규칙).`;
  if (r.bags != null && r.large != null && r.large > r.bags) return '대형 캐리어 개수가 전체 개수보다 많아요. 다시 알려 주세요.';
  return null;
}

export function schedule(r) {
  const region = regionOf(r.address);
  const call = addMin(r.pickupDate, r.pickupTime, -RULES.callBeforeMin);
  const arrive = addMin(r.pickupDate, r.pickupTime, TRAVEL_MIN[region]);
  return { region, call, arrive, travel: TRAVEL_MIN[region] };
}

export function makeTag(departDate) {
  const mmdd = (departDate || todayKST()).slice(5).replace('-', '');
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 4; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return `HD-${mmdd}-${s}`;
}

// ---------- 배차 추천 (같은 수거일 × 2시간 시간대 × 같은 권역 → 차량당 12개까지) ----------
export function dispatch(list) {
  const active = list.filter((r) => r.status !== '공항 인도');
  const groups = new Map();
  for (const r of active) {
    const h = Number((r.pickupTime || '00:00').slice(0, 2));
    const s = Math.floor(h / RULES.slotHours) * RULES.slotHours;
    const slot = `${String(s).padStart(2, '0')}:00–${String(s + RULES.slotHours).padStart(2, '0')}:00`;
    const region = regionOf(r.address);
    const key = `${r.pickupDate}|${slot}|${region}`;
    if (!groups.has(key)) groups.set(key, { date: r.pickupDate, slot, region, items: [] });
    groups.get(key).items.push(r);
  }
  const vehicles = [];
  for (const g of groups.values()) {
    g.items.sort((a, b) => a.pickupTime.localeCompare(b.pickupTime));
    let cur = null;
    for (const r of g.items) {
      if (!cur || cur.load + r.bags > RULES.vehicleCapacity) {
        cur = { date: g.date, slot: g.slot, region: g.region, load: 0, large: 0, items: [] };
        vehicles.push(cur);
      }
      cur.items.push(r); cur.load += r.bags; cur.large += r.large || 0;
    }
  }
  vehicles.sort((a, b) => (a.date + a.slot + a.region).localeCompare(b.date + b.slot + b.region));
  vehicles.forEach((v, i) => { v.no = i + 1; });
  return vehicles;
}

// ---------- 규칙 모드: 문장에서 항목 뽑기 (AI 가 안 될 때도 같은 흐름) ----------
function nearestDate(month, day) {
  const today = todayKST();
  const y = Number(today.slice(0, 4));
  let d = `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  if (d < today) d = `${y + 1}${d.slice(4)}`;
  return d;
}
function shiftDays(n) {
  const t = Date.parse(todayKST() + 'T00:00:00Z') + n * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}
function parseDate(t) {
  let m = t.match(/(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = t.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  if (m) return nearestDate(+m[1], +m[2]);
  // 「11/21」 뒤에 쉼표·조사가 붙어도 읽는다(「11/21,」 「11/21에」)
  m = t.match(/(?:^|[^\d/])(\d{1,2})\/(\d{1,2})(?![\d/])/);
  if (m) return nearestDate(+m[1], +m[2]);
  if (/모레/.test(t)) return shiftDays(2);
  if (/내일/.test(t)) return shiftDays(1);
  if (/오늘/.test(t)) return shiftDays(0);
  return null;
}
function addDay(date, n) {
  return new Date(Date.parse(date + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
}
/** @returns {{time:string, nextDay:boolean} | null} — 「밤 12시」「자정」은 다음 날 00:00 */
function parseTime(t) {
  let m = t.match(/(\d{1,2}):(\d{2})/);
  let h, min = 0, nextDay = false;
  if (m) { h = +m[1]; min = +m[2]; }
  else {
    m = t.match(/(\d{1,2})\s*시\s*(?:(\d{1,2})\s*분|(반))?/);
    if (m) { h = +m[1]; min = m[2] ? +m[2] : (m[3] ? 30 : 0); }
    else if (/자정/.test(t)) { h = 12; }
    else return null;
  }
  if (/(밤|자정)/.test(t) && h === 12) { h = 0; nextDay = true; }
  else if (/(오후|저녁|밤)/.test(t) && h < 12) h += 12;
  else if (/(오전|새벽|아침)/.test(t) && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return { time: `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`, nextDay };
}

// 이름 후보에서 뺄 말
const NOT_NAME = /(서울|경기|인천|성함|이름|번호|주소|휴대폰|전화|예약|캐리어|가방|수하물|안녕|감사|부탁)/;
// 「대형 1개」 「1개는 대형」 「28인치 2개」 — 대형 개수를 말하는 부분
const LARGE_RE = /대형\s*(\d{1,2})\s*개?|(\d{1,2})\s*개?\s*(?:는|은|가|이)?\s*대형|2[89]\s*인치[^\d]{0,6}(\d{1,2})\s*개|3\d\s*인치[^\d]{0,6}(\d{1,2})\s*개/;
// 확인 단계에서 「바꾸고 싶다」는 뜻
export const CHANGE_RE = /(바꾸|바꿔|바꿀|고치|고쳐|고칠|변경|수정|취소|아니|다시)/;

/**
 * 규칙으로 항목 뽑기
 * @param {string} text 사용자 문장
 * @param {string} step 지금 묻는 단계
 * @param {object} known 이미 받은 예약 항목(짐 단계에서 「1개」가 대형인지 판단하는 데 쓴다)
 */
export function parseRule(text, step, known = {}) {
  const t = text.trim();
  const f = {};
  const phone = t.match(/01[016789][-\s.]?\d{3,4}[-\s.]?\d{4}/);
  if (phone) {
    const d = phone[0].replace(/\D/g, '');
    f.phone = d.length === 11 ? `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}` : `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  }
  const flight = t.toUpperCase().match(/(?:^|[^A-Z0-9])((?:[A-Z]{2}|[A-Z]\d|\d[A-Z])\s?\d{2,4})(?![0-9])/);
  if (flight && !/^T[12]$/.test(flight[1])) f.flight = flight[1].replace(/\s/g, '');
  const term = t.match(/T\s?([12])(?!\d)|제\s?([12])\s?(?:여객)?터미널|([12])\s?터미널/i);
  if (term) f.terminal = 'T' + (term[1] || term[2] || term[3]);

  // 짐: 「대형 N개」 부분을 먼저 떼어 낸 뒤 남은 「N개」만 캐리어 수로 본다
  const large = t.match(LARGE_RE);
  if (large) f.large = +(large[1] || large[2] || large[3] || large[4]);
  if (/대형\s*(없|0)|대형은\s*없|모두\s*작|다\s*작/.test(t)) f.large = 0;
  const noLarge = t.replace(new RegExp(LARGE_RE.source, 'g'), ' ');
  const named = t.match(/(?:캐리어|가방|짐|수하물)\s*(\d{1,2})\s*개/);
  if (named) f.bags = +named[1];
  else if (step === 'bags' || step === 'confirm') {
    const n = noLarge.match(/(\d{1,2})\s*개/) || noLarge.match(/^\s*(\d{1,2})\s*$/);
    // 캐리어 수를 이미 받았고 지금은 대형 개수를 묻는 중이면, 숫자만 말한 것은 대형 개수다
    if (n && step === 'bags' && known.bags != null && known.large == null && f.large == null) f.large = +n[1];
    else if (n && step === 'bags' && known.bags == null) f.bags = +n[1];
  }
  if (step === 'bags' && known.bags != null && f.large == null && /^(없|아니|0)/.test(t)) f.large = 0;

  // 날짜·시각: 지금 단계(확인 단계에서는 「수거」 「출발」이라는 말)로 수거인지 출발인지 가른다
  let date = parseDate(t);
  const tm = parseTime(t.replace(/01[016789][-\s.]?\d{3,4}[-\s.]?\d{4}/, '').replace(/\d{1,2}\/\d{1,2}/, ''));
  if (tm?.nextDay && date) date = addDay(date, 1);
  const time = tm?.time || null;
  const pickupCtx = step === 'pickup' || (step === 'confirm' && /수거/.test(t));
  const departCtx = !pickupCtx && (step === 'flight' || f.flight || (step === 'confirm' && /(출발|비행|항공)/.test(t)));
  if (pickupCtx) { if (date) f.pickupDate = date; if (time) f.pickupTime = time; }
  else if (departCtx) { if (date) f.departDate = date; if (time) f.departTime = time; }

  if (step === 'customer' || f.phone) {
    const addr = t.match(/((?:서울|경기|인천|부산|대구|대전|광주|울산|세종|강원|충북|충남|전북|전남|경북|경남|제주)[^,\n]*|[가-힣]+[시구]\s[^,\n]*[로길동]\s?[\d-]*[^,\n]*)/);
    if (addr) f.address = addr[1].replace(/01[016789][-\s.]?\d{3,4}[-\s.]?\d{4}/, '').trim();
    // 이름: 「이름은 ○○」, 아니면 쉼표로 나뉜 조각이나 전화번호 바로 앞 낱말 가운데 2~4글자 한글 하나
    const said = t.match(/(?:이름은|성함은|저는|제 이름은)\s*([가-힣]{2,4}?)(?:입니다|이에요|예요|이고|고|요|,|\s|$)/);
    const clean = (w) => w.trim().replace(/(입니다|이에요|예요|이고|요)$/, '');
    const isName = (w) => /^[가-힣]{2,4}$/.test(w) && !NOT_NAME.test(w) && !/[시구군]$/.test(w);
    if (said) f.name = said[1];
    else {
      const cands = t.split(/[,\n/]+/).map(clean);
      if (phone) cands.push(clean(t.slice(0, phone.index).trim().split(/\s+/).pop() || ''));
      const hit = cands.find(isName);
      if (hit) f.name = hit;
    }
  }
  // 확인: 「바꾸고 싶어요」 같은 말이 있으면 동의가 아니다. 「예약…」은 「예」로 보지 않는다
  if (CHANGE_RE.test(t)) f.confirm = false;
  else if (/^(네|예|응|넵|좋아요?|좋습니다|확인|동의|맞아요?|맞습니다|진행|예약(?:해|할게|하기|합니다))(?=$|[\s.,!~요]|해|주)/.test(t)) f.confirm = true;
  const asks = /[?？]|얼마|되나요|돼요|될까요|뭐|무엇|어떻게|알려|가능한가|있나요|인가요|궁금/.test(t);
  const filled = Object.keys(f).filter((k) => k !== 'confirm').length;
  if (asks && filled === 0) f.isQuestion = true;
  return f;
}
