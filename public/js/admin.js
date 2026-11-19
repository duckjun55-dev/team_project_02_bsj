// 관리자 화면 — 예약 표(상태 4단계)와 배차 추천 보드
import * as R from './rules.js';
import * as store from './store.js';

const $ = (s) => document.querySelector(s);
function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v; else n.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) n.append(k.nodeType ? k : document.createTextNode(String(k)));
  return n;
}

function sortKey(r) { return `${r.pickupDate} ${r.pickupTime}`; }

function render(list = store.load()) {
  // 상태별 개수
  $('#pipeline').replaceChildren(...R.STATUSES.map((s) =>
    el('li', {}, el('div', { class: 'n', text: list.filter((r) => r.status === s).length }), el('div', { class: 'l', text: s }))));
  $('#count').textContent = `예약 ${list.length}건 · 캐리어 ${list.reduce((a, r) => a + r.bags, 0)}개`;

  // 예약 표 — 수거 시각 순서
  const rows = [...list].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  const fresh = Date.now() - 10 * 60 * 1000;
  $('#rows').replaceChildren(...rows.map((r) => {
    const i = R.STATUSES.indexOf(r.status);
    const next = R.STATUSES[i + 1];
    const sch = R.schedule(r);
    const actions = el('div', { class: 'cell-actions' },
      next ? el('button', { type: 'button', class: 'btn btn-pearl', 'data-tag': r.tag, 'data-to': next, text: `${next}로` }) : null,
      i > 0 ? el('button', { type: 'button', class: 'btn btn-pearl', 'data-tag': r.tag, 'data-to': R.STATUSES[i - 1], text: '되돌리기', 'aria-label': `${r.tag} 이전 상태로 되돌리기` }) : null);
    return el('tr', { class: !r.demo && Date.parse(r.createdAt) > fresh ? 'new' : '' },
      el('td', { class: 'mono', text: r.tag }),
      el('td', {}, r.name, el('div', { class: 'caption muted', text: r.phone })),
      el('td', {}, r.address, el('div', { class: 'caption muted', text: sch.region })),
      el('td', {}, R.fmtDT(r.pickupDate, r.pickupTime), el('div', { class: 'caption muted', text: `기사 연락 ${sch.call.time} · 도착 ${sch.arrive.time} 예정` })),
      el('td', {}, `${r.flight} · ${r.terminal}`, el('div', { class: 'caption muted', text: `${R.fmtDT(r.departDate, r.departTime)} 출발` })),
      el('td', { text: `${r.bags}개${r.large ? ` (대형 ${r.large})` : ''}` }),
      el('td', { text: R.won(r.fee) }),
      el('td', {}, el('span', { class: `status s${i}`, text: r.status }), actions));
  }));

  // 배차 보드 — 날짜별로 차량 카드
  const vehicles = R.dispatch(list);
  if (!vehicles.length) {
    $('#board').replaceChildren(el('div', { class: 'empty-state', text: '배차할 예약이 없어요. 챗봇에서 예약을 받으면 여기에 차량 묶음이 생겨요.' }));
    return;
  }
  const days = [...new Set(vehicles.map((v) => v.date))];
  $('#board').replaceChildren(...days.map((d) => {
    const vs = vehicles.filter((v) => v.date === d);
    return el('div', { class: 'day' },
      el('h3', { text: `${R.fmtDate(d)} · 차량 ${vs.length}대` }),
      el('div', { class: 'slots' }, vs.map((v) => {
        const cells = [];
        for (const r of v.items) for (let k = 0; k < r.bags; k++) cells.push(k < (r.large || 0) ? 'on large' : 'on');
        while (cells.length < R.RULES.vehicleCapacity) cells.push('');
        return el('article', { class: 'vehicle', 'aria-label': `차량 ${v.no}` },
          el('div', { class: 'top' }, el('span', { class: 'slot', text: `차량 ${v.no} · ${v.slot}` }), el('span', { class: 'region', text: v.region })),
          el('div', { class: 'cap', role: 'img', 'aria-label': `캐리어 ${v.load}개 / ${R.RULES.vehicleCapacity}개` }, cells.map((c) => el('i', { class: c }))),
          el('div', { class: 'capnum', text: `${v.load} / ${R.RULES.vehicleCapacity}개 · 대형 ${v.large}개 · 남은 자리 ${R.RULES.vehicleCapacity - v.load}` }),
          el('ul', {}, v.items.map((r) => el('li', {},
            el('span', {}, `${r.pickupTime} ${r.name}`, el('span', { class: 'muted', text: ` · ${R.districtOf(r.address)}` })),
            el('span', { class: 'muted', text: `${r.bags}개 · ${r.status}` })))));
      })));
  }));
}

$('#rows').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-tag]');
  if (b) render(store.update(b.dataset.tag, { status: b.dataset.to }));
});
$('#reset').addEventListener('click', () => {
  if (confirm('저장된 예약을 지우고 데모 예약만 다시 넣을까요? 챗봇에서 받은 예약도 지워집니다.')) render(store.reset());
});
store.onChange(render);
render();
