// GET /api/congestion?date=2026-11-20&terminal=T1
// 인천국제공항공사_승객예고-출·입국장별 — 오늘·내일 데이터만 제공, 실측이 아니라 「예상」 승객 수.
import { callDataGo, daysFromToday } from './_lib/datago.js';

const URL = 'https://apis.data.go.kr/B551177/passgrAnncmt/getPassgrAnncmt';

// 시연 값: 이른 아침과 저녁에 붐비는 일반적인 모양으로 만든 가상 숫자
const DEMO = [300, 150, 80, 60, 200, 1400, 2600, 2900, 2500, 2100, 1900, 1800,
  1700, 1600, 1500, 1600, 1800, 2000, 2200, 2100, 1700, 1200, 800, 500];

function summarize(hours) {
  const top = [...hours].sort((a, b) => b.count - a.count).slice(0, 3).sort((a, b) => a.hour - b.hour);
  const quiet = [...hours].filter((h) => h.hour >= 5 && h.hour <= 22).sort((a, b) => a.count - b.count).slice(0, 2)
    .sort((a, b) => a.hour - b.hour);
  return { top, quiet };
}

export default async function handler(req, res) {
  const q = req.query || {};
  const date = String(q.date || '');
  const terminal = q.terminal === 'T2' ? 'T2' : 'T1';
  const demoHours = DEMO.map((count, hour) => ({ hour, count }));
  const demo = { date, terminal, hours: demoHours, ...summarize(demoHours) };

  const d = /^\d{4}-\d{2}-\d{2}$/.test(date) ? daysFromToday(date) : NaN;
  if (!(d === 0 || d === 1)) {
    return res.status(200).json({ ok: false, source: '시연 값', reason: '승객예고는 오늘·내일 것만 제공돼요', demo });
  }

  const r = await callDataGo(URL, { selectdate: String(d), numOfRows: '30', pageNo: '1' });
  if (!r.ok) return res.status(200).json({ ok: false, source: '시연 값', reason: r.reason, tried: r.tried, demo });

  const field = terminal === 'T1' ? 't1dgsum1' : 't2dgsum2'; // 출국장 합계
  const hours = [].concat(r.body?.items || [])
    .filter((it) => /^\d{2}_\d{2}$/.test(it.atime || ''))
    .map((it) => ({ hour: Number(it.atime.slice(0, 2)), count: Math.round(Number(it[field]) || 0) }));
  if (!hours.length) return res.status(200).json({ ok: false, source: '시연 값', reason: '결과 없음', demo });

  return res.status(200).json({ ok: true, source: '실시간', date, terminal, hours, ...summarize(hours) });
}
