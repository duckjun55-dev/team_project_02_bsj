// GET /api/flight?flight=KE123&date=2026-11-20
// 인천국제공항공사_여객편 주간 운항 현황(출발) — 오늘부터 6일 뒤까지만 제공.
// 이 API 는 편명으로 거르지 못해 출발편 전체를 받아 10분간 기억해 두고 찾는다(하루 500회 한도 보호).
import { callDataGo, daysFromToday } from './_lib/datago.js';

const URL = 'https://apis.data.go.kr/B551177/StatusOfPassengerFlightsDSOdp/getPassengerDeparturesDSOdp';
const TERMINAL = { P01: 'T1', P02: 'T1', P03: 'T2' }; // P02 = 탑승동(제1터미널 쪽에서 수속)
let cache = { at: 0, items: null };

async function allDepartures() {
  if (cache.items && Date.now() - cache.at < 10 * 60 * 1000) return { ok: true, items: cache.items, cached: true };
  const r = await callDataGo(URL, { numOfRows: '10000', pageNo: '1' }, 20000);
  if (!r.ok) return r;
  const items = [].concat(r.body?.items || []);
  cache = { at: Date.now(), items };
  return { ok: true, items, cached: false };
}

const hhmm = (s) => (s ? `${s.slice(8, 10)}:${s.slice(10, 12)}` : null);
const ymd = (s) => (s ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null);

export default async function handler(req, res) {
  const q = req.query || {};
  const flight = String(q.flight || '').toUpperCase().replace(/\s+/g, '');
  const date = String(q.date || '');
  const demo = { flightId: flight, date, time: q.time || null, terminal: q.terminal || null, remark: '시연 값' };

  if (!/^[A-Z0-9]{2}\d{1,4}[A-Z]?$/.test(flight) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(200).json({ ok: false, source: '시연 값', reason: '편명·날짜 형식 확인 필요', demo });
  }
  const d = daysFromToday(date);
  if (d < 0 || d > 6) {
    return res.status(200).json({ ok: false, source: '확인 필요', reason: '운항 정보는 오늘부터 6일 뒤까지만 확인할 수 있어요', demo });
  }

  const r = await allDepartures();
  if (!r.ok) return res.status(200).json({ ok: false, source: '시연 값', reason: r.reason, tried: r.tried, demo });

  const key = date.replaceAll('-', '');
  const hits = r.items.filter((it) => (it.flightId || '').toUpperCase() === flight && (it.scheduleDateTime || '').startsWith(key));
  if (!hits.length) {
    return res.status(200).json({ ok: false, source: '시연 값', reason: '그 날짜 출발편 목록에 이 편명이 없어요', demo });
  }
  const it = hits[0];
  return res.status(200).json({
    ok: true, source: '실시간', cached: r.cached,
    flight: {
      flightId: it.flightId, airline: it.airline, destination: it.airport,
      date: ymd(it.scheduleDateTime), time: hhmm(it.scheduleDateTime),
      estimatedTime: hhmm(it.estimatedDateTime), estimatedDate: ymd(it.estimatedDateTime),
      terminal: TERMINAL[it.terminalid] || null, terminalCode: it.terminalid,
      checkin: it.chkinrange || null, gate: it.gatenumber || null,
      remark: it.remark || null,
      codeshare: it.codeshare === 'Slave' ? it.masterflightid : null,
    },
  });
}
