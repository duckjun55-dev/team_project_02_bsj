// 고객용 챗봇 — 기획서 7단계: 말 걸기 → 고객 정보 → 항공편 → 짐 → 수거 시각 → 요금·금지 물품 → 예약 완료
// 예약 규칙(요금·개수·시각)은 rules.js 가 계산하고, AI 는 「문장에서 항목 뽑기」와 「문서 근거 답변」만 맡는다.
// AI 가 모두 실패하거나 「규칙 모드」를 고르면 같은 흐름을 규칙(정규식)으로 진행한다.
import * as R from './rules.js';
import * as store from './store.js';

const STEPS = [
  { id: 'start', label: '말 걸기' },
  { id: 'customer', label: '고객 정보' },
  { id: 'flight', label: '항공편' },
  { id: 'bags', label: '짐' },
  { id: 'pickup', label: '수거 시각' },
  { id: 'confirm', label: '요금·금지 물품' },
  { id: 'done', label: '예약 완료' },
];
const NEED = {
  customer: ['name', 'phone', 'address'],
  flight: ['flight', 'departDate', 'departTime', 'terminal'],
  bags: ['bags', 'large'],
  pickup: ['pickupDate', 'pickupTime'],
};
const LABEL = {
  name: '성함', phone: '휴대폰 번호', address: '수거 주소(구 이름 포함)', flight: '항공편 번호', departDate: '출발 날짜',
  departTime: '출발 시각', terminal: '터미널(T1/T2)', bags: '캐리어 개수', large: '28인치 이상 대형 개수',
  pickupDate: '수거 희망 날짜', pickupTime: '수거 희망 시각',
};

const $ = (s) => document.querySelector(s);
const log = $('#log');
const quickBox = $('#quick');
const input = $('#input');

let state = fresh();
function fresh() { return { step: 'start', r: {}, busy: false, flightKey: null, flightInfo: null }; }
// 대화 번호 — 「처음부터」를 누를 때마다 1씩 올라간다. 늦게 도착한 옛 대화의 답은 번호가 달라 버린다
let conv = 0;
let mode = 'ai';
try { mode = localStorage.getItem('homedrop.mode') || 'ai'; } catch { /* 무시 */ }

// ---------- 화면 조각 ----------
function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v; else n.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) n.append(k.nodeType ? k : document.createTextNode(String(k)));
  return n;
}
const badge = (text, kind) => el('span', { class: `badge ${kind || ''}`, text });
const sourceBadge = (src) => badge(src, src === '실시간' ? 'live' : src === '확인 필요' ? 'check' : 'sample');

function scroll() { log.scrollTop = log.scrollHeight; }
function addUser(text) { log.append(el('div', { class: 'msg user', text })); scroll(); }

// 「누가 알아들었는지」 표시는 따로 말풍선을 만들지 않고, 바로 다음 챗봇 말풍선 밑에 붙인다
let pendingMeta = null;

// 받침에 맞춘 조사: josa('출발 날짜', '을', '를') → '출발 날짜를'
function josa(word, withBatchim, without) {
  const c = String(word).trim().slice(-1).charCodeAt(0);
  const has = c >= 0xac00 && c <= 0xd7a3 ? (c - 0xac00) % 28 !== 0 : /[0-9LMNR]$/i.test(word) && !/[2459]$/.test(word);
  return word + (has ? withBatchim : without);
}
const listOf = (keys) => keys.map((k) => LABEL[k]).join(', ');

/** 챗봇 말풍선. extras: { meta, sources, note, cards:[Node] } */
function addBot(text, extras = {}) {
  if (!extras.meta && pendingMeta) { extras = { ...extras, meta: pendingMeta }; pendingMeta = null; }
  const wrap = el('div', { class: 'msg bot' });
  if (text) wrap.append(el('div', { class: 'bubble', text }));
  for (const c of extras.cards || []) wrap.append(c);
  if (extras.sources?.length) wrap.append(el('div', { class: 'sources' }, el('b', { text: '근거 문서 ' }), extras.sources.join(' · ')));
  if (extras.note) wrap.append(el('div', { class: 'note', text: '※ ' + extras.note }));
  if (extras.meta) wrap.append(el('div', { class: 'meta' }, extras.meta));
  log.append(wrap); scroll();
  return wrap;
}
function typing() {
  const t = el('div', { class: 'msg bot typing' }, el('div', { class: 'bubble', text: '확인하는 중' }));
  log.append(t); scroll();
  return () => t.remove();
}
function quick(list) {
  quickBox.replaceChildren(...list.map((q) => el('button', { type: 'button', text: q })));
}

/** 누가 답했는지 표시 */
function metaOf(res, kind) {
  const parts = [];
  const failed = (res?.tried || []).filter((t) => t.provider !== '-').map((t) => `${t.provider} ${t.reason}`);
  if (res?.provider) parts.push(`${kind} AI · ${res.provider}${res.model ? ` (${res.model})` : ''}`);
  else if (res?.mode === 'rule' || res?.via === 'rule') parts.push(`${kind} · 규칙 모드`);
  else if (res?.via === 'quick') parts.push(`${kind} · 규칙(바로 인식)`);
  else if (res?.mode === 'none') parts.push('문서에서 찾지 못함');
  const out = [el('span', { text: parts.join('') })];
  if (failed.length) out.push(el('span', { text: `· 앞선 시도: ${failed.join(', ')}` }));
  return out;
}

// ---------- 서버 ----------
async function api(path, body) {
  try {
    const opt = body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {};
    const r = await fetch(path, { ...opt, signal: AbortSignal.timeout(60000) });
    return await r.json();
  } catch { return null; }
}

// ---------- 단계 표시 · 요약 ----------
function renderSteps() {
  const idx = STEPS.findIndex((s) => s.id === state.step);
  $('#steps').replaceChildren(...STEPS.map((s, i) =>
    el('li', { class: i < idx ? 'done' : i === idx ? 'now' : '', 'aria-current': i === idx ? 'step' : null, text: s.label })));
}
function renderSummary() {
  const r = state.r;
  const sch = r.pickupDate && r.pickupTime && r.address ? R.schedule(r) : null;
  const rows = [
    ['성함', r.name], ['휴대폰', r.phone], ['수거지', r.address && `${r.address} · ${R.regionOf(r.address)}`],
    ['항공편', r.flight && `${r.flight}${r.terminal ? ' · ' + r.terminal : ''}`],
    ['출발', r.departDate && R.fmtDT(r.departDate, r.departTime)],
    ['짐', r.bags != null && `캐리어 ${r.bags}개${r.large != null ? ` (대형 ${r.large})` : ''}`],
    ['수거', r.pickupDate && R.fmtDT(r.pickupDate, r.pickupTime)],
    ['기사 연락', sch?.call && R.fmtDT(sch.call.date, sch.call.time)],
    ['공항 도착', sch?.arrive && `${R.fmtDT(sch.arrive.date, sch.arrive.time)} 예정`],
  ];
  $('#summary').replaceChildren(...rows.map(([k, v]) =>
    el('div', { class: 'row' }, el('dt', { text: k }), el('dd', { class: v ? '' : 'empty', text: v || '—' }))));
  const f = R.fee(r.bags, r.large || 0);
  $('#fee').textContent = R.won(f);
  const filled = rows.filter(([, v]) => v).length;
  $('#sumMini').textContent = filled ? `${filled}개 항목 · ${f ? R.won(f) : '요금 계산 전'}` : '아직 없음';
  $('#feeRule').textContent = f ? R.feeText(r.bags, r.large || 0) : '기본 20,000원 · 추가 1개당 10,000원 · 대형 1개당 5,000원';
}
function render() { renderSteps(); renderSummary(); }

// ---------- 항목 뽑기 ----------
function clean(fields = {}) {
  const out = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v == null || v === '' || (typeof v === 'number' && Number.isNaN(v))) continue;
    if (['bags', 'large'].includes(k)) { const n = parseInt(v, 10); if (!Number.isNaN(n)) out[k] = n; continue; }
    if (['confirm', 'isQuestion'].includes(k)) { out[k] = v === true || v === 'true'; continue; }
    if (k === 'flight') { out[k] = String(v).toUpperCase().replace(/\s/g, ''); continue; }
    if (k === 'terminal') { const m = String(v).match(/[12]/); if (m) out[k] = 'T' + m[0]; continue; }
    if (/Date$/.test(k) && !/^\d{4}-\d{2}-\d{2}$/.test(v)) continue;
    if (/Time$/.test(k) && !/^\d{2}:\d{2}$/.test(v)) continue;
    out[k] = typeof v === 'string' ? v.trim() : v;
  }
  return out;
}

function missingOf(step, r = state.r) {
  return (NEED[step] || []).filter((k) => r[k] == null || r[k] === '' || (k === 'address' && !R.districtOf(r[k])));
}

async function extract(text) {
  const rule = clean(R.parseRule(text, state.step, state.r));
  if (mode === 'rule') return { fields: rule, via: 'rule' };
  // 규칙으로 이 단계에 필요한 것을 다 알아냈으면 AI 를 부르지 않는다(빠르고 한도도 아낀다)
  const after = { ...state.r, ...rule };
  const short = text.trim().length <= 6 && Object.keys(rule).length > 0;
  if ((NEED[state.step] && missingOf(state.step, after).length === 0) || short) return { fields: rule, via: 'quick' };
  const res = await api('/api/chat', { mode: 'extract', text, today: R.todayKST(), step: state.step });
  if (res?.ok) {
    const ai = clean(res.fields);
    // 캐리어 수를 이미 받았는데 「대형 1개」처럼 대형만 말했으면, AI 가 뽑은 캐리어 수는 버린다
    if (state.r.bags != null && !/(캐리어|가방|짐|수하물|전체|모두|총)/.test(text)) delete ai.bags;
    return { fields: { ...rule, ...ai }, ...res, via: 'ai' };
  }
  return { fields: rule, via: 'rule', tried: res?.tried || [{ provider: '서버', reason: '연결 실패' }] };
}

// ---------- 질문 답하기 ----------
async function answer(text) {
  const done = typing();
  const res = await api('/api/chat', { mode: 'answer', question: text, rule: mode === 'rule' });
  done();
  if (!res?.ok) {
    addBot('지금은 답을 찾지 못했어요. 이지드랍 고객센터 02-6010-1220 또는 인천국제공항 고객센터 1577-2600 으로 문의해 주세요.',
      { meta: [el('span', { text: '서버 연결 실패' })] });
    return;
  }
  addBot(res.answer, { sources: res.sources, note: res.note, meta: metaOf(res, '답한') });
}

// ---------- 단계별 질문 ----------
function ask() {
  const r = state.r;
  const miss = missingOf(state.step);
  if (state.step === 'customer') {
    if (miss.length === 3) {
      addBot('좋아요, 홈드랍 예약을 도와드릴게요.\n먼저 예약자 성함, 휴대폰 번호, 수거 주소(구 이름 포함)를 알려 주세요. 한 번에 적어도 돼요.\n예) 홍길동, 010-1234-5678, 서울 마포구 월드컵로 00\n\n※ 데모라서 실제 개인정보는 입력하지 마세요.');
    } else addBot(`${listOf(miss)}도 알려 주세요.` + (miss.includes('address') && r.address ? '\n주소에 「○○구」나 「○○시」를 넣어 주세요.' : ''));
    quick([]);
  } else if (state.step === 'flight') {
    if (miss.length === 4) addBot('항공편 번호와 출발 날짜·시각, 터미널(T1/T2)을 알려 주세요.\n예) KE123, 11월 21일 오전 9시 25분, T2');
    else addBot(`${josa(listOf(miss), '을', '를')} 알려 주세요.`);
    quick(miss.includes('terminal') && miss.length === 1 ? ['T1', 'T2'] : []);
  } else if (state.step === 'bags') {
    if (miss.includes('bags')) { addBot(`캐리어는 모두 몇 개이고, 그중 28인치 이상 대형은 몇 개인가요? (한 번에 ${R.RULES.maxBags}개까지)`); quick(['캐리어 1개', '캐리어 2개', '캐리어 3개']); }
    else { addBot(`캐리어 ${r.bags}개 중 28인치 이상 대형은 몇 개인가요?`); quick(['대형 없음', '대형 1개', '대형 2개']); }
  } else if (state.step === 'pickup') {
    const last = R.addMin(r.departDate, r.departTime, -R.RULES.cutoffHours * 60);
    addBot(`수거를 원하는 날짜와 시각을 알려 주세요.\n출발 ${R.RULES.cutoffHours}시간 전인 ${R.fmtDT(last.date, last.time)}까지 가능해요(데모 규칙).`);
    quick([]);
  } else if (state.step === 'confirm') {
    showConfirm();
  }
}

function nextStep() {
  for (const s of ['customer', 'flight', 'bags', 'pickup']) if (missingOf(s).length) return s;
  return 'confirm';
}

function showConfirm() {
  const r = state.r;
  const sch = R.schedule(r);
  const f = R.fee(r.bags, r.large || 0);
  const card = el('div', { class: 'info-card' },
    el('div', { class: 'head' }, el('span', { text: '예약 내용 확인' }), badge('데모 요금', 'demo')),
    el('dl', {},
      el('dt', { text: '요금' }), el('dd', {}, el('b', { text: R.won(f) }), ` (${R.feeText(r.bags, r.large || 0)})`),
      el('dt', { text: '수거' }), el('dd', { text: `${R.fmtDT(r.pickupDate, r.pickupTime)} · ${sch.region}` }),
      el('dt', { text: '기사 연락' }), el('dd', { text: `${R.fmtDT(sch.call.date, sch.call.time)} (수거 30분 전)` }),
      el('dt', { text: '공항 도착' }), el('dd', { text: `${R.fmtDT(sch.arrive.date, sch.arrive.time)} 예정 (이동 약 ${sch.travel}분, 데모 값)` }),
      el('dt', { text: '항공편' }), el('dd', { text: `${r.flight} · ${R.fmtDT(r.departDate, r.departTime)} 출발 · ${r.terminal}` })),
  );
  const ban = el('div', { class: 'info-card' },
    el('div', { class: 'head' }, el('span', { text: '맡길 수 없는 물건' }), badge('데모 규칙', 'demo')),
    el('dl', {}, ...R.PROHIBITED.flatMap((p) => [el('dt', { text: p.group }), el('dd', { text: p.items })])));
  addBot('요금과 맡길 수 없는 물건을 확인해 주세요. 이대로 예약할까요?', { cards: [card, ban] });
  quick(['예약하기', '고칠게요']);
}

// ---------- 항공편 조회 (운항 현황 API — 실패해도 예약은 계속) ----------
async function lookupFlight() {
  const r = state.r;
  if (!r.flight || !r.departDate) return;
  const key = `${r.flight}|${r.departDate}`;
  if (state.flightKey === key) return;
  state.flightKey = key;
  const done = typing();
  const q = new URLSearchParams({ flight: r.flight, date: r.departDate, time: r.departTime || '', terminal: r.terminal || '' });
  const res = await api('/api/flight?' + q);
  done();
  if (res?.ok) {
    const f = res.flight;
    const notes = [];
    if (!r.departTime) r.departTime = f.time;
    else if (r.departTime !== f.time) notes.push(`입력하신 시각(${r.departTime})과 운항 정보(${f.time})가 달라요 — 운항 정보 시각으로 바꿨어요.`), (r.departTime = f.time);
    if (f.terminal && r.terminal && r.terminal !== f.terminal) notes.push(`입력하신 ${r.terminal}가 아니라, 운항 정보 기준 ${f.terminal}에서 출발해요.`);
    if (f.terminal) r.terminal = f.terminal;
    state.flightInfo = { source: '실시간', ...f };
    const card = el('div', { class: 'info-card' },
      el('div', { class: 'head' }, el('span', { text: `${f.flightId} · ${f.airline}` }), sourceBadge('실시간')),
      el('dl', {},
        el('dt', { text: '목적지' }), el('dd', { text: f.destination || '—' }),
        el('dt', { text: '출발 예정' }), el('dd', { text: R.fmtDT(f.date, f.time) + (f.estimatedTime && f.estimatedTime !== f.time ? ` → 변경 ${f.estimatedTime}` : '') }),
        el('dt', { text: '터미널' }), el('dd', { text: `${f.terminal || '—'}${f.checkin ? ` · 체크인 ${f.checkin}` : ''}` }),
        el('dt', { text: '운항 상태' }), el('dd', { text: f.remark || '예정' }),
        f.codeshare ? [el('dt', { text: '공동운항' }), el('dd', { text: `실제 운항편 ${f.codeshare}` })] : null));
    const warn = /결항/.test(f.remark || '') ? '이 항공편은 결항으로 나와요. 항공사에 먼저 확인해 주세요.' : null;
    addBot('항공편을 찾았어요.' + (notes.length ? '\n' + notes.join('\n') : ''), { cards: [card], note: warn, meta: [el('span', { text: '인천국제공항공사 여객편 주간 운항 현황' })] });
  } else {
    const src = res?.source || '시연 값';
    state.flightInfo = { source: src };
    const why = res?.reason || '서버 연결 실패';
    addBot(src === '확인 필요'
      ? `${R.fmtDate(r.departDate)} 항공편 정보는 확인 필요예요. ${why}. 입력하신 값으로 예약을 이어 갈게요.`
      : `운항 정보를 확인하지 못했어요(${why}). 입력하신 값(시연 값)으로 예약을 이어 갈게요.`,
    { meta: [sourceBadge(src), el('span', { text: '여객편 주간 운항 현황' })] });
  }
}

// ---------- 예약 완료 ----------
function bagtag(rec) {
  const sch = R.schedule(rec);
  return el('div', { class: 'bagtag', role: 'group', 'aria-label': '수하물 태그' },
    el('div', { class: 'band' }, el('span', { class: 'hole', 'aria-hidden': 'true' }),
      el('div', { class: 'code' }, 'ICN', el('small', { text: rec.terminal })),
      el('div', { class: 'flightline', text: `${rec.flight} · ${R.fmtDT(rec.departDate, rec.departTime)} 출발` })),
    el('div', { class: 'body' },
      el('div', { class: 'caption muted', text: '태그 번호' }),
      el('div', { class: 'num', text: rec.tag }),
      el('div', { class: 'stripe', 'aria-hidden': 'true' }),
      el('ol', {},
        el('li', {}, el('time', { text: sch.call.time }), `기사님 연락 · ${R.fmtDate(sch.call.date)}`),
        el('li', {}, el('time', { text: rec.pickupTime }), `집에서 수거 · ${sch.region}`),
        el('li', {}, el('time', { text: sch.arrive.time }), `인천공항 ${rec.terminal} 도착 예정`)),
      el('div', { class: 'foot', text: `캐리어 ${rec.bags}개(대형 ${rec.large || 0}) · ${R.won(rec.fee)} · 시각은 데모 값` })));
}

async function congestion(rec) {
  const myConv = conv;
  const res = await api(`/api/congestion?date=${rec.departDate}&terminal=${rec.terminal}`);
  if (!res || myConv !== conv) return; // 그사이 새 대화를 시작했으면 보이지 않는다
  const data = res.ok ? res : res.demo;
  const src = res.ok ? '실시간' : '시연 값';
  const max = Math.max(...data.hours.map((h) => h.count), 1);
  const hot = new Set(data.top.map((h) => h.hour));
  const hh = (h) => `${String(h.hour).padStart(2, '0')}시`;
  const card = el('div', { class: 'info-card' },
    el('div', { class: 'head' }, el('span', { text: `${R.fmtDate(rec.departDate)} ${rec.terminal} 출국장 예상 승객` }), sourceBadge(src)),
    el('div', { class: 'bars', 'aria-hidden': 'true' }, data.hours.map((h) =>
      el('span', { class: hot.has(h.hour) ? 'hot' : '', style: `height:${Math.max(4, (h.count / max) * 100)}%`, title: `${h.hour}시 ${h.count}명` }))),
    el('div', { class: 'bars-axis', 'aria-hidden': 'true' }, el('span', { text: '0시' }), el('span', { text: '12시' }), el('span', { text: '23시' })),
    el('dl', { style: 'margin-top:8px' },
      el('dt', { text: '붐비는 때' }), el('dd', { text: data.top.map(hh).join(' · ') }),
      el('dt', { text: '한산한 때' }), el('dd', { text: data.quiet.map(hh).join(' · ') })));
  const why = res.ok ? '실측이 아니라 예상치예요.' : `실시간 정보를 쓰지 못해 시연 값을 보여 드려요(${res.reason}).`;
  addBot(`출국장 혼잡 예상도 알려 드려요. ${why}`, { cards: [card], meta: [el('span', { text: '인천국제공항공사 승객예고-출·입국장별' })] });
}

function finalize() {
  const r = state.r;
  const rec = {
    tag: R.makeTag(r.departDate), name: r.name, phone: r.phone, address: r.address,
    district: R.districtOf(r.address), region: R.regionOf(r.address),
    flight: r.flight, departDate: r.departDate, departTime: r.departTime, terminal: r.terminal,
    bags: r.bags, large: r.large || 0, pickupDate: r.pickupDate, pickupTime: r.pickupTime,
    fee: R.fee(r.bags, r.large || 0), status: '접수', flightSource: state.flightInfo?.source || '시연 값',
    createdAt: new Date().toISOString(),
  };
  store.add(rec);
  state.step = 'done';
  render();
  const sch = R.schedule(rec);
  addBot(`예약을 마쳤어요. 태그 번호는 ${rec.tag}입니다.\n수거 30분 전(${sch.call.time})에 기사님이 연락드려요(데모 규칙). 캐리어에 태그 번호를 적어 두시면 좋아요.`,
    { cards: [bagtag(rec)] });
  quick(['관리자 화면에서 보기', '새 예약', `예약 확인 ${rec.tag}`]);
  congestion(rec);
}

// ---------- 예약 확인 ----------
function showReservation(tag) {
  const rec = store.find(tag);
  if (!rec) { addBot(`${tag} 예약을 이 브라우저에서 찾지 못했어요. 예약은 예약한 브라우저에만 저장돼요(데모).`); return; }
  const sch = R.schedule(rec);
  const steps = R.STATUSES.map((s) => (s === rec.status ? `[${s}]` : s)).join(' → ');
  addBot(`${rec.tag} 예약 상태예요.\n${steps}\n\n수거 ${R.fmtDT(rec.pickupDate, rec.pickupTime)} · 기사 연락 ${sch.call.time}\n공항 도착 예정 ${R.fmtDT(sch.arrive.date, sch.arrive.time)} (데모 값)`);
}

// ---------- 대화 처리 ----------
const BOOK = /맡기|맡길래|예약하|예약할|수거|신청|보내고|부치/;
const TAG = /HD-[0-9A-Z]{4}-[0-9A-Z]{4}/i;

async function handle(text) {
  if (state.busy || !text.trim()) return;
  state.busy = true;
  addUser(text);
  quick([]);
  try {
    if (/^(처음부터|새 예약)$/.test(text.trim())) { restart(text.trim() === '새 예약'); return; }
    if (text.trim() === '관리자 화면에서 보기') { location.href = '/admin.html'; return; }
    const tag = text.match(TAG);
    if (tag) { showReservation(tag[0].toUpperCase()); return; }
    if (/예약\s*(확인|조회)/.test(text)) { addBot('태그 번호를 알려 주세요. 예) HD-1121-AB12'); return; }

    if (state.step === 'start' || state.step === 'done') {
      if (BOOK.test(text) && !/[?？]|얼마|되나요|돼요|있나요/.test(text)) {
        state = { ...fresh(), busy: true, step: 'customer' };
        render();
        // 첫 문장에 이미 정보가 있으면 함께 채운다(예: 「10월 20일 9시 25분 비행기, 캐리어 2개」)
        const ex = await withTyping(() => extract(text));
        delete ex.fields.name; // 첫 문장(「짐 맡기고 싶어요」)에서는 이름을 뽑지 않는다
        apply(ex.fields);
        await afterApply();
        return;
      }
      await answer(text);
      if (state.step === 'start') quick(['짐 맡기고 싶어요', '요금이 얼마예요?', '맡길 수 없는 물건은?']);
      return;
    }

    if (state.step === 'confirm') {
      const said = text.trim();
      const map = { '고객 정보': 'customer', 항공편: 'flight', 짐: 'bags', '수거 시각': 'pickup' };
      if (map[said]) {
        for (const k of NEED[map[said]]) delete state.r[k];
        if (map[said] === 'flight') state.flightKey = null;
        state.step = map[said]; render(); ask(); return;
      }
      const ex = await withTyping(() => extract(text));
      const f = ex.fields;
      // 1) 바뀐 값이 있으면 먼저 반영하고, 무엇이 바뀌었는지 알린다
      const changed = Object.keys(LABEL).filter((k) => f[k] != null && f[k] !== state.r[k]);
      if (changed.length) { apply(f, ex); await afterApply({ changed }); return; }
      // 2) 「바꾸고 싶어요」 → 동의로 보지 않는다
      const wantsChange = said === '고칠게요' || f.confirm === false || R.CHANGE_RE.test(said);
      if (!wantsChange && (f.confirm === true || said === '예약하기')) { finalize(); return; }
      if (wantsChange) {
        addBot('어느 부분을 고칠까요? 바뀐 내용을 바로 적어 주셔도 돼요.\n예) 수거 시각 내일 오전 8시로', { meta: metaOf(ex, '인식') });
        quick(['고객 정보', '항공편', '짐', '수거 시각']);
        return;
      }
      if (f.isQuestion) { await answer(text); showConfirm(); return; }
      addBot('바뀐 내용을 찾지 못했어요. 이대로 예약하려면 「예약하기」를, 고치려면 바뀐 내용을 적어 주세요.\n예) 수거 시각 내일 오전 8시로', { meta: metaOf(ex, '인식') });
      quick(['예약하기', '고칠게요']);
      return;
    }

    const ex = await withTyping(() => extract(text));
    const f = ex.fields;
    const bookingKeys = Object.keys(f).filter((k) => !['isQuestion', 'confirm'].includes(k));
    if (f.isQuestion && bookingKeys.length === 0) {
      await answer(text);
      ask();
      return;
    }
    if (bookingKeys.length === 0) {
      addBot(`잘 알아듣지 못했어요. ${josa(listOf(missingOf(state.step)), '을', '를')} 알려 주세요.`, { meta: metaOf(ex, '인식') });
      return;
    }
    apply(f, ex);
    await afterApply();
  } finally {
    state.busy = false;
    input.focus();
  }
}

async function withTyping(fn) {
  const done = typing();
  try { return await fn(); } finally { done(); }
}

function apply(f, ex) {
  const r = state.r;
  for (const k of Object.keys(LABEL)) if (f[k] != null) r[k] = f[k];
  pendingMeta = ex ? metaOf(ex, '인식') : null;
}

function showValue(k, v) {
  if (/Date$/.test(k)) return R.fmtDate(v);
  if (k === 'bags' || k === 'large') return `${v}개`;
  return v;
}

async function afterApply({ changed = [] } = {}) {
  const r = state.r;
  const myConv = conv;
  // 항공편 번호와 날짜가 모이면 운항 정보를 조회한다
  if (r.flight && r.departDate) await lookupFlight();
  if (myConv !== conv) return; // 기다리는 사이 「처음부터」를 눌렀으면 옛 대화의 결과는 버린다
  // 출발까지 8시간이 안 남았거나 이미 지났으면 → 수거 시각을 물어도 맞출 수 없으니 항공편부터 다시 받는다
  const depErr = R.checkDeparture(r);
  if (depErr) { for (const k of NEED.flight) delete r[k]; state.flightKey = null; state.flightInfo = null; }
  const bagErr = R.checkBags(r);
  if (bagErr) { delete r.bags; delete r.large; }
  const pickErr = R.checkPickup(r);
  if (pickErr) { delete r.pickupDate; delete r.pickupTime; }
  if (r.departDate && !r.departTime && R.daysFromToday(r.departDate) < 0) {
    addBot('출발 날짜가 이미 지났어요. 다시 알려 주세요.'); delete r.departDate;
  }
  state.step = nextStep();
  render();
  // 확인 단계에서 고친 경우: 실제로 바뀐 것을 한 줄로 알린다
  const done = changed.filter((k) => r[k] != null);
  if (done.length) addBot(`바꿨어요: ${done.map((k) => `${LABEL[k]} ${showValue(k, r[k])}`).join(', ')}`);
  if (depErr) addBot(depErr);
  if (bagErr) addBot(bagErr);
  if (pickErr) addBot(pickErr);
  ask();
}

function restart(book = false) {
  conv += 1;
  state = fresh();
  pendingMeta = null;
  log.replaceChildren();
  render();
  if (book) { state.step = 'customer'; render(); ask(); return; }
  greet();
}

function greet() {
  addBot('안녕하세요. 집에서 캐리어를 수거해 인천국제공항까지 옮겨 드리는 홈드랍 예약 챗봇이에요(데모).\n「짐 맡기고 싶어요」라고 말하면 예약을 시작해요. 요금이나 맡길 수 없는 물건도 물어보세요.');
  quick(['짐 맡기고 싶어요', '요금이 얼마예요?', '맡길 수 없는 물건은?', '예약 확인']);
}

// ---------- 시작 ----------
function setMode(m) {
  mode = m;
  try { localStorage.setItem('homedrop.mode', m); } catch { /* 무시 */ }
  document.querySelectorAll('.mode button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === m)));
}
document.querySelectorAll('.mode button').forEach((b) => b.addEventListener('click', () => {
  setMode(b.dataset.mode);
  addBot(b.dataset.mode === 'ai'
    ? 'AI 모드로 바꿨어요. 문장 이해와 질문 답변에 AI(Claude → Groq → Gemini 순서)를 써요.'
    : '규칙 모드로 바꿨어요. AI 없이 정해진 규칙으로 같은 예약 흐름을 진행하고, 질문에는 문서 원문을 보여 드려요.');
}));
$('#restart').addEventListener('click', () => restart());
$('#startChat').addEventListener('click', (e) => {
  e.preventDefault();
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  $('#chat').scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  input.focus({ preventScroll: true });
});
$('#sumToggle').addEventListener('click', (e) => {
  const open = e.currentTarget.getAttribute('aria-expanded') !== 'true';
  e.currentTarget.setAttribute('aria-expanded', String(open));
  $('.summary').classList.toggle('open', open);
});
// 답을 기다리는 중에는 보내기를 막고, 적은 글은 지우지 않는다(조용히 버려지지 않게)
const sendBtn = $('#form button[type="submit"]');
// 기다리는 동안에는 「처음부터」와 모드 버튼도 잠근다 — 진행 중인 답이 새 대화에 섞이지 않게
function setBusy(b) {
  sendBtn.disabled = b; sendBtn.textContent = b ? '답 기다리는 중' : '보내기'; quickBox.inert = b;
  $('#restart').disabled = b;
  document.querySelectorAll('.mode button').forEach((m) => { m.disabled = b; });
}
$('#form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (state.busy || !input.value.trim()) return;
  const t = input.value; input.value = '';
  setBusy(true); await handle(t); setBusy(false);
});
quickBox.addEventListener('click', async (e) => {
  const b = e.target.closest('button');
  if (!b || state.busy) return;
  setBusy(true); await handle(b.textContent); setBusy(false);
});
$('#prohibited').replaceChildren(...R.PROHIBITED.map((p) => el('div', {}, el('h3', { text: p.group }), el('p', { text: p.items }))));

setMode(mode);
store.load();
render();
greet();
