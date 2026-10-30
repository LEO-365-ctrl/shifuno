/* 日本の祝日・休日を「国民の祝日に関する法律」の決まりから計算する（通信なし）。
   ・日付が決まっている祝日、第◯月曜日の祝日、春分・秋分（天文計算の近似式）、振替休日、国民の休日。
   ・春分・秋分の近似式は1980〜2099年で国立天文台の暦と一致する範囲。
   ・法律で特別に決まる臨時の祝日（即位の日など）は計算できないので、EXTRA に手で足す。 */
(() => {
'use strict';
const EXTRA = {};   // 例：'2019-05-01': '天皇の即位の日'
const pad = n => String(n).padStart(2, '0');
const nthMonday = (y, m, n) => { const first = new Date(y, m - 1, 1).getDay(); return 1 + ((8 - first) % 7) + (n - 1) * 7; };
const equinox = (y, base) => Math.floor(base + .242194 * (y - 1980) - Math.floor((y - 1980) / 4));
const cache = new Map();
function holidaysOf(y) {
  if (cache.has(y)) return cache.get(y);
  const days = new Map(), add = (m, d, name) => days.set(`${y}-${pad(m)}-${pad(d)}`, name);
  add(1, 1, '元日'); add(1, nthMonday(y, 1, 2), '成人の日');
  add(2, 11, '建国記念の日'); add(2, 23, '天皇誕生日');
  add(3, equinox(y, 20.8431), '春分の日'); add(4, 29, '昭和の日');
  add(5, 3, '憲法記念日'); add(5, 4, 'みどりの日'); add(5, 5, 'こどもの日');
  add(7, nthMonday(y, 7, 3), '海の日'); add(8, 11, '山の日');
  add(9, nthMonday(y, 9, 3), '敬老の日'); add(9, equinox(y, 23.2488), '秋分の日');
  add(10, nthMonday(y, 10, 2), 'スポーツの日');
  add(11, 3, '文化の日'); add(11, 23, '勤労感謝の日');
  for (const [k, v] of Object.entries(EXTRA)) if (k.startsWith(`${y}-`)) days.set(k, v);
  const keyOf = dt => `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
  const base = [...days.keys()].sort();
  // 国民の休日：前日と翌日がどちらも祝日で、その日自身は祝日でも日曜でもない日。
  for (const k of base) {
    const [, m, d] = k.split('-').map(Number), mid = new Date(y, m - 1, d + 1), next = new Date(y, m - 1, d + 2);
    if (mid.getDay() !== 0 && !days.has(keyOf(mid)) && days.has(keyOf(next))) days.set(keyOf(mid), '国民の休日');
  }
  // 振替休日：祝日が日曜なら、その後の最初の祝日でない日。
  for (const k of base) {
    const [, m, d] = k.split('-').map(Number), dt = new Date(y, m - 1, d);
    if (dt.getDay() !== 0) continue;
    const sub = new Date(dt); do sub.setDate(sub.getDate() + 1); while (days.has(keyOf(sub)));
    if (sub.getFullYear() === y) days.set(keyOf(sub), '振替休日');
  }
  const out = Object.fromEntries([...days.entries()].sort());
  cache.set(y, out);
  return out;
}
const api = { holidaysOf };
if (typeof module !== 'undefined') module.exports = api;
if (typeof window !== 'undefined') window.JpHolidays = api;
})();
