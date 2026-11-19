// 공공데이터포털(apis.data.go.kr) 호출 공통
// - 키는 INCHEON 을 먼저 쓰고, 실패하면 Passenger 로 다시 시도한다.
// - Encoding 키(%2B 같은 글자가 든 것)와 Decoding 키 둘 다 동작:
//   '%' 가 있으면 먼저 풀고(decode) → 주소에 넣을 때 한 번만 인코딩한다. 두 번 인코딩되는 오류를 막는다.
const KEY_NAMES = ['INCHEON', 'Passenger'];

function normalizeKey(raw) {
  const k = (raw || '').trim();
  if (!k.includes('%')) return k;
  try { return decodeURIComponent(k); } catch { return k; }
}

function classify(status, text) {
  if (/SERVICE_KEY_IS_NOT_REGISTERED|SERVICE ACCESS DENIED|Unauthorized|NOT_REGISTERED|LIMITED_NUMBER_OF_SERVICE_REQUESTS/i.test(text)
    || status === 401 || status === 403) {
    if (/LIMITED_NUMBER/i.test(text)) return '하루 호출 한도 초과';
    return '승인 안 됨(키 미등록 또는 활용신청 전)';
  }
  return `오류(HTTP ${status})`;
}

/** @returns {Promise<{ok:true, body:any, keyName:string} | {ok:false, reason:string, tried:object[]}>} */
export async function callDataGo(baseUrl, params, timeoutMs = 12000) {
  const tried = [];
  for (const name of KEY_NAMES) {
    const key = normalizeKey(process.env[name]);
    if (!key) { tried.push({ key: name, reason: '키 비어 있음' }); continue; }
    const qs = new URLSearchParams({ type: 'json', ...params }).toString();
    const url = `${baseUrl}?${qs}&serviceKey=${encodeURIComponent(key)}`;
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      const text = await r.text();
      let j = null;
      try { j = JSON.parse(text); } catch { /* XML 오류 응답일 수 있음 */ }
      const code = j?.response?.header?.resultCode;
      if (r.ok && code === '00') return { ok: true, body: j.response.body, keyName: name };
      tried.push({ key: name, reason: j ? `결과코드 ${code}: ${j?.response?.header?.resultMsg || ''}` : classify(r.status, text) });
    } catch (e) {
      tried.push({ key: name, reason: e?.name === 'TimeoutError' ? '시간 초과' : '연결 오류' });
    }
  }
  // 대표 사유: 가장 「해결 방향이 분명한」 것을 앞세운다
  const order = ['승인 안 됨', '하루 호출 한도', '시간 초과', '키 비어 있음'];
  const reason = order.map((o) => tried.find((t) => t.reason.startsWith(o))?.reason).find(Boolean) || tried[0]?.reason || '알 수 없음';
  return { ok: false, reason, tried };
}

/** 한국 시간 기준 오늘(YYYY-MM-DD)과, 그 날짜까지 며칠 남았는지 */
export function kstToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
}
export function daysFromToday(dateStr) {
  const a = Date.parse(kstToday() + 'T00:00:00Z');
  const b = Date.parse(dateStr + 'T00:00:00Z');
  return Math.round((b - a) / 86400000);
}
