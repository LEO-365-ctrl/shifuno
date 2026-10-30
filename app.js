(() => {
'use strict';
const DATA = window.SHIFT_DATA;
const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
// 祝日・休日は holidays.js が法律の決まりから計算する（勤務上の「お休み」とは独立）。
// 表示するのは今年と来年まで。年が明けると、その翌年の分が自動で加わる（2026年が終われば2028年）。
// 2022年より前は東京五輪の特例などがあるので出さない。
const holidayOf = (key, d) => {
  const y = Number(key.slice(0, 4));
  if (y < 2022 || y > Number(today.key.slice(0, 4)) + 1) return '';
  return window.JpHolidays.holidaysOf(y)[`${key}-${String(d).padStart(2, '0')}`] ?? '';
};
const AXIS = { start: 9, end: 21 }, SPAN = AXIS.end - AXIS.start, SLOTS = SPAN * 2;
const EASE = 'cubic-bezier(.22,1,.36,1)';
const app = document.getElementById('app');
const $ = s => app.querySelector(s);
const calendarView = $('.calendar-view'), cal = $('.calendar'), sheet = $('.sheet'), shade = $('.shade');
const strip = $('.strip'), loadEl = $('.load');
const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
const reduced = () => motionPreference.matches;
// 取り込んだCSVの名前なども画面に出すので、HTMLに入れる文字は必ずエスケープする。
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---- 共通データ ----
const monthKey = (y, m) => `${y}-${String(m).padStart(2, '0')}`;
const parseKey = key => key.split('-').map(Number);
const people = DATA.people;
let owner = people.find(p => p.id === DATA.self);   // データ上の本人（この端末の持ち主）
// 表示中の人。メンバー一覧で切り替えられる（端末ごとの表示設定なので localStorage に覚える）。
let self = owner;
try { self = people.find(p => p.id === localStorage.getItem('shift-focus')) ?? owner; } catch {}
// 取り込みで月や人が増えたら indexData() で作り直す。
let monthKeys = [], parsed = {}, allDays = [];
function indexData() {
  monthKeys = Object.keys(DATA.months).sort();
  parsed = {};
  for (const key of monthKeys) {
    const shifts = DATA.months[key].shifts;
    parsed[key] = Object.fromEntries(Object.entries(shifts).map(([id, codes]) => [id, codes.trim().split(/\s+/)]));
  }
}
function indexVisibleDays(key) {
  const keys = [-1,0,1].map(offset => adjacentMonth(key,offset)).filter(Boolean);
  allDays = keys.flatMap(key => { const [y,m] = parseKey(key); return Array.from({length:daysIn(key)},(_,i)=>({key,y,m,d:i+1})); });
}
function adjacentMonth(key, offset) {
  const [y,m] = parseKey(key), date = new Date(y,m-1+offset,1);
  return date.getFullYear()<2000 || date.getFullYear()>2100 ? null : monthKey(date.getFullYear(),date.getMonth()+1);
}
const toHour = t => { const [h, m] = t.split(':').map(Number); return h + m / 60; };
const fmtHour = h => `${Math.floor(h)}:${h % 1 ? '30' : '00'}`;
function cellOf(key, id, d) {
  const raw = parsed[key]?.[id]?.[d - 1];
  if (raw == null) return null;
  const code = DATA.codes[raw];
  // 未定義の記号・読めないセルには時間を付けない。
  if (!code) return { raw, kind: 'unknown', label: '未確認' };
  if (code.kind === 'work') return { raw, kind: 'work', start: code.start, end: code.end, label: `${code.start}–${code.end}` };
  // 休みは基本「お休み」と表記し、育休のように表記を指定した記号はその表記で出す。
  return { raw, kind: code.kind, label: code.label ?? (code.kind === 'off' ? 'お休み' : raw) };
}
// 30分ごとの出勤人数。
function loadOf(key, d) {
  const counts = Array(SLOTS).fill(0);
  for (const p of people) {
    const c = cellOf(key, p.id, d);
    if (c?.kind !== 'work') continue;
    const s = toHour(c.start), e = toHour(c.end);
    for (let i = 0; i < SLOTS; i++) { const t = AXIS.start + i / 2 + .25; if (t > s && t < e) counts[i]++; }
  }
  return counts;
}
function daysIn(key) { const [y, m] = parseKey(key); return new Date(y, m, 0).getDate(); }
const dayIndex = (key, d) => allDays.findIndex(x => x.key === key && x.d === d);
indexData();

// ---- 状態 ----
const params = new URLSearchParams(location.search);
const now = params.get('today') ? new Date(`${params.get('today')}T00:00:00`) : new Date();
const today = { key: monthKey(now.getFullYear(), now.getMonth() + 1), d: now.getDate() };
const state = { view: today.key, selected: null, shownCount: 0 };
if (state.view === today.key) state.selected = today.d;

// ---- テーマ（端末ごとの表示設定なので localStorage で十分）。切り替えはクロスフェード ----
const THEMES = ['auto', 'dark', 'light'], THEME_LABEL = { auto: '表示 自動', dark: '表示 ダーク', light: '表示 ライト' };
let theme = 'auto';
try { theme = THEMES.includes(localStorage.getItem('shift-theme')) ? localStorage.getItem('shift-theme') : 'auto'; } catch {}
function applyTheme() {
  if (theme === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.dataset.theme = theme;
  $('.theme').textContent = THEME_LABEL[theme];
  // ホーム画面から開いたときの上端（ステータスバー）の色も、選んだテーマに合わせる。
  const paper = getComputedStyle(app).backgroundColor;
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
    meta.dataset.auto ??= meta.content;
    meta.content = theme === 'auto' ? meta.dataset.auto : paper;
  }
}
$('.theme').addEventListener('click', () => {
  theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
  try { localStorage.setItem('shift-theme', theme); } catch {}
  if (document.startViewTransition && !reduced()) document.startViewTransition(applyTheme);
  else applyTheme();
});
applyTheme();

// ---- カレンダー ----
function renderMonth() {
  const key = state.view, [y, m] = parseKey(key);
  const first = new Date(y, m - 1, 1).getDay(), days = daysIn(key);
  const cells = Math.ceil((first + days) / 7) * 7;
  $('.year').textContent = y;
  $('.month').innerHTML = `${m}<small>月</small>`;
  $('.owner-name').textContent = `${self.name}さんのカレンダー`;
  $('.owner .scope').textContent = !parsed[key]?.[self.id] ? 'この月は未登録' : DATA.months[key].scope === 'self' ? 'みんなの勤務は未登録' : '';
  let html = '';
  for (let i = 0; i < cells; i++) {
    const d = i - first + 1;
    if (d < 1 || d > days) { html += '<div class="empty"></div>'; continue; }
    const c = cellOf(key, self.id, d), dow = i % 7, holiday = holidayOf(key, d);
    const time = c?.kind === 'work' ? `<span>${c.start}</span><span>${c.end}</span>` : c ? c.label : '';
    const cls = ['day', c && c.kind !== 'work' ? c.kind : '', holiday ? 'holiday' : '', dow === 0 ? 'sun' : dow === 6 ? 'sat' : '',
      key === today.key && d === today.d ? 'today' : '', d === state.selected ? 'selected' : ''].filter(Boolean).join(' ');
    html += `<button type="button" class="${cls}" data-day="${d}"${holiday ? ` title="${holiday}"` : ''} aria-label="${m}月${d}日 ${WEEK[dow]}曜日 ${holiday ? `${holiday} ` : ''}${c ? c.label : '予定なし'}、勤務表を開く"${key === today.key && d === today.d ? ' aria-current="date"' : ''}><span class="date">${d}</span><span class="time">${time}</span></button>`;
  }
  cal.innerHTML = html;
  $('.prev').disabled = !adjacentMonth(key,-1);
  $('.next').disabled = !adjacentMonth(key,1);
  renderFoot();
}
// 下部のカード：表示中の人の今日のシフト。タップで今日の勤務表を開く。
function renderFoot() {
  const card = $('.today-card'), [y, m] = parseKey(today.key);
  const known = !!parsed[today.key]?.[self.id], c = known ? cellOf(today.key, self.id, today.d) : null;
  $('.tc-date').textContent = `${m}/${today.d}（${WEEK[new Date(y, m - 1, today.d).getDay()]}）${self === owner ? '' : ` · ${self.name}さん`}`;
  $('.tc-value').textContent = !known ? 'まだ登録されていません' : c ? c.label : '予定なし';
  $('.tc-go').hidden = false;
  card.disabled = false;
  card.setAttribute('aria-label', `今日のシフト ${m}月${today.d}日 ${$('.tc-value').textContent}${known ? '、みんなの勤務を見る' : ''}`);
}
function select(d) {
  state.selected = d;
  cal.querySelectorAll('.day').forEach(el => el.classList.toggle('selected', Number(el.dataset.day) === d));
}

// 月の切り替え：表示と状態を同時に更新し、新しい日付を行ごとに入れる。
// クリックを受ける親グリッドをアニメーションさせながら中身を交換しない。
let monthAnimations = [];
function enterCalendar(dir) {
  // dir 0 は初回表示：下からふわっと立ち上げる。
  const from = dir ? `translateX(${dir * 16}px)` : 'translateY(10px)';
  const enter = [$('.ym'), $('.owner .scope')].map(el => el.animate(
    [{ transform: dir ? `translateX(${dir * 22}px)` : 'translateY(8px)', opacity: 0 }, { transform: 'none', opacity: 1 }],
    { duration: 380, easing: EASE, fill: 'backwards' }));
  [...cal.children].forEach((el, i) => enter.push(el.animate(
    [{ transform: from, opacity: 0 }, { transform: 'none', opacity: 1 }],
    { duration: dir ? 400 : 460, delay: Math.floor(i / 7) * (dir ? 26 : 40) + (dir >= 0 ? i % 7 : 6 - i % 7) * (dir ? 6 : 12) + (dir ? 0 : 80), easing: EASE, fill: 'backwards' })));
  monthAnimations = enter;
}
function changeMonth(key, dir) {
  if (!key || key === state.view || app.classList.contains('open')) return;
  monthAnimations.forEach(a => a.cancel()); monthAnimations = [];
  cal.style.removeProperty('transform'); cal.style.removeProperty('opacity');
  state.view = key;
  state.selected = key === today.key ? today.d : null;
  renderMonth();
  if (!reduced()) enterCalendar(dir);
}
const step = dir => adjacentMonth(state.view, dir);
$('.prev').addEventListener('click', () => changeMonth(step(-1), -1));
$('.next').addEventListener('click', () => changeMonth(step(1), 1));
$('.today-card').addEventListener('click', () => {
  // 別の月を見ているときは、カレンダーを今日の月へ送りながら勤務表を開く。
  if (state.view !== today.key) changeMonth(today.key, today.key > state.view ? 1 : -1);
  show(today.d);
});

// カレンダーを左右になぞって月を移動。指に追従し、端の月では抵抗を強くする。
let swipe = null, suppressClick = false;
cal.addEventListener('pointerdown', e => {
  if (e.button !== 0 || app.classList.contains('open')) return;
  swipe = { id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, locked: null, lastX: e.clientX, lastTime: performance.now(), velocity: 0 };
});
// マウスのボタンが離れているのに動きだけ届いたら、どこかで離したとみなして終える。
const released = e => e.pointerType === 'mouse' && e.buttons === 0;
cal.addEventListener('pointermove', e => {
  if (!swipe || swipe.id !== e.pointerId) return;
  if (released(e)) { endSwipe(e, true); return; }
  const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y;
  if (swipe.locked == null && Math.hypot(dx, dy) > 8) {
    swipe.locked = Math.abs(dx) > Math.abs(dy) * 1.2 ? 'x' : 'y';
    if (swipe.locked === 'x') { monthAnimations.forEach(a => a.cancel()); monthAnimations = []; cal.setPointerCapture(e.pointerId); }
  }
  if (swipe.locked !== 'x') return;
  const t = performance.now();
  swipe.velocity = (e.clientX - swipe.lastX) / Math.max(1, t - swipe.lastTime); swipe.lastX = e.clientX; swipe.lastTime = t;
  swipe.dx = step(dx < 0 ? 1 : -1) ? dx * .45 : dx * .12;
  cal.style.transform = `translateX(${swipe.dx}px)`;
  cal.style.opacity = String(1 - Math.min(.5, Math.abs(swipe.dx) / 500));
});
function endSwipe(e, cancelled) {
  if (!swipe || swipe.id !== e.pointerId) return;
  const s = swipe; swipe = null;
  if (s.locked !== 'x') return;
  suppressClick = true; setTimeout(() => { suppressClick = false; }, 0);
  const dir = s.dx < 0 ? 1 : -1, target = step(dir);
  const velocity = performance.now() - s.lastTime < 100 ? s.velocity : 0;
  if (!cancelled && target && (Math.abs(s.dx) > 40 || (Math.abs(s.dx) > 12 && Math.abs(velocity) > .5))) changeMonth(target, dir);
  else {
    cal.style.removeProperty('transform'); cal.style.removeProperty('opacity');
    if (!reduced()) monthAnimations = [cal.animate([{ transform: `translateX(${s.dx}px)` }, { transform: 'none' }], { duration: 320, easing: EASE })];
  }
}
// 離した場所がカレンダーの外でも終わらせる（でないとマウスに付いてきてしまう）。
window.addEventListener('pointerup', e => endSwipe(e, false));
window.addEventListener('pointercancel', e => endSwipe(e, true));
cal.addEventListener('click', e => {
  if (suppressClick) return;
  const b = e.target.closest('[data-day]');
  if (b) show(Number(b.dataset.day));
});

// ---- 日付ストリップ（勤務表の中で日付を切り替える） ----
// 月が増えたときや表示する人を変えたときに作り直す（点は表示中の人の勤務日）。
let indicator = null, indicatorX = null, indicatorAnimation = null;
function buildStrip() {
  indexVisibleDays(state.view);
  strip.innerHTML = allDays.map(({ key, y, m, d }) => {
    const dow = new Date(y, m - 1, d).getDay(), c = cellOf(key, self.id, d), holiday = holidayOf(key, d);
    const cls = ['chip', holiday ? 'holiday' : '', dow === 0 ? 'sun' : dow === 6 ? 'sat' : '', d === 1 ? 'first' : '', key === today.key && d === today.d ? 'is-today' : ''].filter(Boolean).join(' ');
    return `<button type="button" class="${cls}" data-key="${key}" data-day="${d}" tabindex="-1" aria-pressed="false" aria-label="${m}月${d}日 ${WEEK[dow]}曜日 ${holiday ? `${holiday} ` : ''}${esc(self.name)}さん ${c ? c.label : '予定なし'}"><span class="cw">${key === today.key && d === today.d ? '今日' : d === 1 ? `${m}月` : WEEK[dow]}</span><span class="cn">${d}</span><i class="cd ${c?.kind ?? ''}"></i></button>`;
  }).join('') + '<span class="strip-indicator" aria-hidden="true"></span>';
  indicator = strip.querySelector('.strip-indicator');
  indicatorX = null;
}
buildStrip();
const chipOf = (key, d) => strip.querySelector(`.chip[data-key="${key}"][data-day="${d}"]`);
function updateStrip(animate) {
  const chip = chipOf(state.view, state.selected);
  if (!chip) return;
  strip.querySelectorAll('.chip.selected').forEach(el => { el.classList.remove('selected'); el.tabIndex = -1; el.setAttribute('aria-pressed', 'false'); });
  chip.classList.add('selected'); chip.tabIndex = 0; chip.setAttribute('aria-pressed', 'true');
  const cn = chip.querySelector('.cn');
  const x = cn.offsetLeft, from = indicatorX;
  indicator.style.top = `${cn.offsetTop}px`;
  indicator.style.translate = `${x}px 0`;
  indicatorX = x;
  indicatorAnimation?.cancel(); indicatorAnimation = null;
  if (animate && from != null && from !== x && !reduced()) {
    // 選択の丸が隣の日付へ「伸びて」移る。
    indicatorAnimation = indicator.animate([
      { translate: `${from}px 0`, scale: '1 1' },
      { translate: `${from + (x - from) * .55}px 0`, scale: `${Math.min(1.6, 1 + Math.abs(x - from) / 140)} .92`, offset: .45 },
      { translate: `${x}px 0`, scale: '1 1' }
    ], { duration: 460, easing: EASE });
  }
  strip.scrollTo({ left: chip.offsetLeft - (strip.clientWidth - chip.offsetWidth) / 2, behavior: animate && !reduced() ? 'smooth' : 'instant' });
}
function goToDay(key, d) {
  if (!app.classList.contains('open')) return;
  const from = dayIndex(state.view, state.selected), to = dayIndex(key, d);
  if (to < 0 || from === to) return;
  const dir = to > from ? 1 : -1;
  if (key !== state.view) {
    // 月をまたぐとストリップを前後の月ごと作り直す（並ぶ日付が1か月ずれる）。いま選んでいる日付を目印に
    // スクロール位置と選択の丸の位置を引き継ぎ、同じ月の中と同じ動きで目的の日へ送る。
    const prev = { key: state.view, d: state.selected }, anchor = chipOf(prev.key, prev.d), offset = anchor && anchor.offsetLeft - strip.scrollLeft;
    state.view = key; state.selected = d; renderMonth(); buildStrip();
    const same = anchor && chipOf(prev.key, prev.d);
    if (same) { strip.scrollTo({ left: same.offsetLeft - offset, behavior: 'instant' }); indicatorX = same.querySelector('.cn').offsetLeft; }
  } else select(d);
  renderSheet('switch', dir);
}
let suppressChip = false;
strip.addEventListener('click', e => {
  if (suppressChip) return;
  const b = e.target.closest('.chip'); if (b) goToDay(b.dataset.key, Number(b.dataset.day));
});
// 好きな位置までスライドできるようにする。指（タッチ）はブラウザー標準のスクロール、
// マウスはドラッグ＋慣性、ホイールは連続で送り、止まったところで一番近い日付にそろえる。
let snapTimer = 0, momentum = 0, stripDrag = null;
function freeScroll() { clearTimeout(snapTimer); cancelAnimationFrame(momentum); strip.style.scrollSnapType = 'none'; }
function settleSnap(delay) {
  clearTimeout(snapTimer);
  snapTimer = setTimeout(() => {
    const w = strip.clientWidth / 7;
    strip.scrollTo({ left: Math.round(strip.scrollLeft / w) * w, behavior: reduced() ? 'instant' : 'smooth' });
    snapTimer = setTimeout(() => strip.style.removeProperty('scroll-snap-type'), 400);
  }, delay);
}
strip.addEventListener('wheel', e => {
  const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
  if (!delta) return;
  e.preventDefault(); freeScroll();
  strip.scrollLeft += delta * (e.deltaMode === 1 ? 16 : 1);
  settleSnap(140);
}, { passive: false });
strip.addEventListener('pointerdown', e => {
  if (e.pointerType !== 'mouse' || e.button !== 0) return;
  cancelAnimationFrame(momentum);
  stripDrag = { id: e.pointerId, x: e.clientX, left: strip.scrollLeft, moved: false, v: 0, lastX: e.clientX, lastT: performance.now() };
});
strip.addEventListener('pointermove', e => {
  if (!stripDrag || stripDrag.id !== e.pointerId) return;
  if (released(e)) { endStripDrag(e); return; }
  const dx = e.clientX - stripDrag.x;
  if (!stripDrag.moved) {
    if (Math.abs(dx) < 5) return;
    stripDrag.moved = true; strip.setPointerCapture(e.pointerId); strip.classList.add('grabbing'); freeScroll();
  }
  const t = performance.now();
  stripDrag.v = (e.clientX - stripDrag.lastX) / Math.max(1, t - stripDrag.lastT); stripDrag.lastX = e.clientX; stripDrag.lastT = t;
  strip.scrollLeft = stripDrag.left - dx;
});
function endStripDrag(e) {
  if (!stripDrag || stripDrag.id !== e.pointerId) return;
  const s = stripDrag; stripDrag = null; strip.classList.remove('grabbing');
  if (!s.moved) return;
  suppressChip = true; setTimeout(() => { suppressChip = false; }, 0);
  let v = performance.now() - s.lastT < 80 ? -s.v * 16 : 0;
  if (reduced() || Math.abs(v) < 1) { settleSnap(0); return; }
  const tick = () => {
    strip.scrollLeft += v; v *= .92;
    if (Math.abs(v) > .6) momentum = requestAnimationFrame(tick); else settleSnap(0);
  };
  momentum = requestAnimationFrame(tick);
}
window.addEventListener('pointerup', endStripDrag);
window.addEventListener('pointercancel', endStripDrag);

// ---- 勤務表（ボトムシート） ----
let sheetAnimation = null, contentAnimations = [], animationId = 0, drag = null;
const push = a => { contentAnimations.push(a); return a; };
function stopContent() { contentAnimations.forEach(a => a.cancel()); contentAnimations = []; }
function countUp(el, from, to) {
  if (reduced() || from === to) { el.textContent = to; return; }
  const t0 = performance.now();
  const tick = t => {
    const p = Math.min(1, (t - t0) / 420);
    el.textContent = Math.round(from + (to - from) * (1 - (1 - p) ** 3));
    if (p < 1 && el.isConnected) requestAnimationFrame(tick);
  };
  el.textContent = from; requestAnimationFrame(tick);
}
// 日付切り替えの直前に、表示中の行と人数区間を退場用に控えておく。
function snapshot() {
  return {
    lanes: [...app.querySelectorAll('.lanes > .lane:not(.ghost):not(.filtered), .lanes > .nolane')].map(el => ({ el, top: el.offsetTop })),
    runs: [...app.querySelectorAll('.load-track > .run:not(.old)')]
  };
}
function renderSheet(mode, dir = 0) {
  const key = state.view, d = state.selected, [y, m] = parseKey(key), month = DATA.months[key] ?? {};
  const switching = mode === 'switch' && !reduced();
  closeCellMenu(false);
  stopContent();
  const before = switching ? snapshot() : null;
  const dow = new Date(y, m - 1, d).getDay();
  $('.sheetdate').innerHTML = `${m}月${d}日<small>${WEEK[dow]}曜日</small>${key === today.key && d === today.d ? '<span class="badge">今日</span>' : ''}`;

  $('.mine-name').textContent = `${self.name}さん`;
  const mine = cellOf(key, self.id, d), mineEl = $('.mine strong');
  if (!mine) mineEl.textContent = '未登録';
  else if (mine.kind === 'work') mineEl.textContent = mine.label;
  else if (mine.kind === 'off') mineEl.innerHTML = mine.label === mine.raw ? esc(mine.label) : `${mine.label}<small>${esc(mine.raw)}</small>`;
  else if (mine.kind === 'out') mineEl.textContent = '外出';
  else mineEl.innerHTML = `未確認<small>元の記号：${esc(mine.raw)}</small>`;

  const entries = people.map(p => ({ p, c: cellOf(key, p.id, d) })).filter(x => x.c);
  const workers = entries.filter(x => x.c.kind === 'work')
    .sort((a, b) => (b.p === self) - (a.p === self) || toHour(a.c.start) - toHour(b.c.start) || toHour(a.c.end) - toHour(b.c.end));
  if (month.scope === 'all') {
    $('.sheetmeta').innerHTML = 'みんなの勤務 · 出勤 <span class="count"></span>人';
    countUp($('.sheetmeta .count'), mode === 'open' ? 0 : state.shownCount, workers.length);
  } else $('.sheetmeta').textContent = month.scope === 'self' ? `この月は${owner.name}さんの勤務のみ登録` : 'この月のシフトは未登録です';
  state.shownCount = workers.length;

  // 時間帯ごとの人数。棒の高さはその日の最多人数を基準にする。
  state.filter = null;
  $('.filter-chip').hidden = true; $('.timeline-title small').hidden = false; loadEl.classList.remove('filtering');
  if (month.scope === 'all') {
    const counts = loadOf(key, d), top = Math.max(...counts), max = Math.max(1, top);
    // 人数が変わるまでを1区間にまとめる。
    const runs = [];
    counts.forEach((c, i) => { const last = runs[runs.length - 1]; if (last?.c === c) last.end = i + 1; else runs.push({ c, start: i, end: i + 1 }); });
    loadEl.hidden = false;
    // 棒が十分高ければ数字は棒の中、低ければ棒の上に置く。タップでその時間帯に出勤中の人へ絞り込む。
    $('.load-track').innerHTML = runs.filter(r => r.c > 0).map(r => {
      const h = Math.max(3, Math.round(r.c / max * 44)), inside = h >= 18;
      const a = AXIS.start + r.start / 2, b = AXIS.start + r.end / 2, label = `${fmtHour(a)}–${fmtHour(b)}`;
      return `<button type="button" class="run${r.c === top ? ' peak' : ''}" data-a="${a}" data-b="${b}" data-label="${label}" style="left:${r.start / SLOTS * 100}%;width:${(r.end - r.start) / SLOTS * 100}%" aria-label="${label} ${r.c}人、この時間帯に出勤中の人に絞り込む"><i style="height:${h}px"></i><b class="${inside ? 'in' : ''}" style="bottom:${inside ? h - 15 : h + 2}px">${r.c}</b></button>`;
    }).join('');
    const first = counts.indexOf(top);
    let last = first; while (counts[last + 1] === top) last++;
    $('.timeline-title small').innerHTML = top ? `最多 <b>${top}</b>人 · ${fmtHour(AXIS.start + first / 2)}–${fmtHour(AXIS.start + (last + 1) / 2)}` : '';
  } else {
    loadEl.hidden = true;
    $('.timeline-title small').textContent = `${self.name}さんを色で強調`;
  }

  const lanesEl = $('.lanes');
  lanesEl.innerHTML = (workers.length ? workers.map(({ p, c }) => {
    const s = toHour(c.start), e = toHour(c.end);
    // 帯をタップすると、その人のこの日の記号をプルダウンで直せる。
    return `<div class="lane${p === self ? ' me' : ''}" data-id="${p.id}" data-s="${s}" data-e="${e}"><span>${esc(p.name)}</span><div class="track"><button type="button" class="bar" data-edit="${p.id}" aria-haspopup="listbox" aria-label="${esc(p.name)}さん ${c.label}。タップで変更" style="left:${(s - AXIS.start) / SPAN * 100}%;width:${(e - s) / SPAN * 100}%"><em>${c.label}</em></button></div></div>`;
  }).join('') : '<div class="nolane">この日の出勤者は登録されていません</div>') + nowLine(key, d);

  // お休み・外出・未確認の人は帯がないので、名前をタップして直す。
  const group = kind => entries.filter(x => x.c.kind === kind).map(x => `<button type="button" class="rest-name" data-edit="${x.p.id}" aria-haspopup="listbox" aria-label="${esc(x.p.name)}さん ${esc(x.c.label)}。タップで変更">${esc(x.p.name)}${kind === 'off' && x.c.label !== 'お休み' ? `<small>${esc(x.c.label)}</small>` : ''}</button>`).join('');
  const rows = [];
  if (group('off')) rows.push(`<div class="rest"><span>お休み</span><b>${group('off')}</b></div>`);
  if (group('out')) rows.push(`<div class="rest"><span>外出</span><b>${group('out')}</b></div>`);
  if (group('unknown')) rows.push(`<div class="rest"><span>未確認</span><b>${group('unknown')}</b></div>`);
  if (month.scope === 'self') rows.push(`<div class="rest"><span>メモ</span><b>${m}月のみんなの勤務表はまだ登録されていません</b></div>`);
  $('.rests').innerHTML = rows.join('');
  if (mode === 'open') $('.sheet-scroll').scrollTop = 0;

  updateStrip(mode === 'switch');
  if (mode === 'open') revealContent();
  else if (switching) switchContent(before, dir);
}
// 今日を開いたときだけ、現在時刻の線を引く。
function nowLine(key, d) {
  if (key !== today.key || d !== today.d) return '';
  const t = new Date(), h = t.getHours() + t.getMinutes() / 60;
  if (h < AXIS.start || h > AXIS.end) return '';
  return `<div class="nowline" style="left:calc(var(--label) + (100% - var(--label)) * ${(h - AXIS.start) / SPAN})"><span>いま</span></div>`;
}
// 演出のテンポ。日付を何度も行き来しても待たされないよう、動きの形は保ったまま短めにする。
const T = { stagger: 32, name: 260, draw: 560, label: 360, run: 30 };
// 勤務の帯：始業時刻に点がポンと出て、終業時刻まで線が伸び、最後に時間の文字が乗る。
const DOT = 'inset(0 calc(100% - 28px) 0 0 round 14px)';
function drawBar(bar, delay, me) {
  push(bar.animate([
    { clipPath: DOT, transform: 'scale(0)', opacity: 0, easing: 'cubic-bezier(.34,1.56,.64,1)' },
    { clipPath: DOT, transform: 'scale(1)', opacity: 1, offset: .22, easing: 'cubic-bezier(.65,0,.35,1)' },
    { clipPath: 'inset(0 0px 0 0 round 8px)', transform: 'scale(1)', opacity: 1 }
  ], { duration: T.draw, delay, fill: 'backwards' }));
  push(bar.querySelector('em').animate([{ opacity: 0, transform: 'translateX(-6px)' }, { opacity: 1, transform: 'none' }],
    { duration: 220, delay: delay + T.label, easing: EASE, fill: 'backwards' }));
  // 本人の帯は描き終わりに一度だけ光の輪を広げて目を引く。
  if (me) ringBar(bar, delay + T.draw);
}
function ringBar(bar, delay) {
  const rgb = getComputedStyle(bar).backgroundColor.match(/\d+(\.\d+)?/g)?.slice(0, 3).join(' ');
  if (rgb) push(bar.animate([{ boxShadow: `0 0 0 0 rgb(${rgb} / .55)` }, { boxShadow: `0 0 0 8px rgb(${rgb} / 0)` }],
    { duration: 600, delay, easing: 'cubic-bezier(.2,.6,.3,1)' }));
}
// 行を上から順に出す。名前が先に入り、少し遅れて帯を描く。開くときも日付を変えたときも同じ出し方。
function enterLanes(base) {
  const lanes = [...app.querySelectorAll('.lanes > .lane:not(.ghost):not(.filtered), .lanes > .nolane')];
  lanes.forEach((lane, i) => {
    const d = base + Math.min(i, 12) * T.stagger;
    push((lane.querySelector(':scope > span') ?? lane).animate([{ opacity: 0, transform: 'translateX(-10px)' }, { opacity: 1, transform: 'none' }],
      { duration: T.name, delay: d, easing: EASE, fill: 'backwards' }));
    const bar = lane.querySelector('.bar');
    if (bar) drawBar(bar, d + 40, lane.classList.contains('me'));
  });
  return base + Math.min(lanes.length, 12) * T.stagger;
}
// 人数の区間：棒が左から順に弾むように立ち上がり、数字が後から乗る。
function enterRuns(base) {
  app.querySelectorAll('.load-track > .run:not(.old)').forEach((run, i) => {
    const d = base + i * T.run;
    push(run.querySelector('i').animate([{ transform: 'scaleY(0)' }, { transform: 'scaleY(1)' }],
      { duration: 440, delay: d, easing: 'cubic-bezier(.34,1.35,.64,1)', fill: 'backwards' }));
    push(run.querySelector('b').animate([{ opacity: 0, transform: 'translateY(6px) scale(.7)' }, { opacity: 1, transform: 'none' }],
      { duration: 280, delay: d + 150, easing: EASE, fill: 'backwards' }));
  });
}

// ---- 人数の棒をタップして、その時間帯に出勤中の人に絞り込む ----
function applyFilter(f, quiet = false) {
  state.filter = f;
  const lanesEl = $('.lanes'), animate = !reduced() && !quiet;
  const lanes = [...lanesEl.querySelectorAll(':scope > .lane:not(.ghost)')];
  const beforeTop = new Map(lanes.map(l => [l, l.offsetTop]));
  const wasHidden = new Map(lanes.map(l => [l, l.classList.contains('filtered')]));
  lanes.forEach(l => l.classList.toggle('filtered', !!f && !(Number(l.dataset.s) < f.b && Number(l.dataset.e) > f.a)));
  app.querySelectorAll('.load-track > .run').forEach(r => {
    const on = !!f && Number(r.dataset.a) === f.a && Number(r.dataset.b) === f.b;
    r.classList.toggle('active', on); r.setAttribute('aria-pressed', String(on));
  });
  loadEl.classList.toggle('filtering', !!f);
  const chip = $('.filter-chip'), small = $('.timeline-title small');
  chip.hidden = !f; small.hidden = !!f;
  if (f) chip.innerHTML = `${f.label} に出勤中 ${lanes.filter(l => !l.classList.contains('filtered')).length}人<span aria-hidden="true">×</span>`;
  lanesEl.querySelector('.focus-band')?.remove();
  if (f) lanesEl.insertAdjacentHTML('afterbegin', `<div class="focus-band" style="left:calc(var(--label) + (100% - var(--label)) * ${(f.a - AXIS.start) / SPAN});width:calc((100% - var(--label)) * ${(f.b - f.a) / SPAN})"></div>`);
  if (!animate) return;
  lanes.forEach(l => {
    const hidden = l.classList.contains('filtered');
    if (hidden && !wasHidden.get(l)) {
      // 外れる人は元の位置で薄くなって消える。
      const g = l.cloneNode(true);
      g.classList.remove('filtered'); g.classList.add('ghost'); g.style.top = `${beforeTop.get(l)}px`; lanesEl.appendChild(g);
      const a = g.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.97)' }], { duration: 170, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' });
      a.finished.then(() => g.remove(), () => g.remove());
      push(a);
    } else if (!hidden && wasHidden.get(l)) {
      push(l.animate([{ opacity: 0, transform: 'translateY(-6px)' }, { opacity: 1, transform: 'none' }], { duration: 260, delay: 90, easing: EASE, fill: 'backwards' }));
    } else if (!hidden) {
      // 残る人は新しい位置へ詰めて滑る。
      const dy = beforeTop.get(l) - l.offsetTop;
      if (dy) push(l.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 340, easing: EASE }));
    }
  });
  const band = lanesEl.querySelector('.focus-band');
  if (band) push(band.animate([{ opacity: 0, transform: 'scaleX(.4)' }, { opacity: 1, transform: 'none' }], { duration: 320, easing: EASE }));
  if (f) push(chip.animate([{ opacity: 0, transform: 'scale(.85)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: 'cubic-bezier(.34,1.56,.64,1)' }));
}

// ---- 勤務表から1人・1日の記号を直す：帯（帯のない人は名前）をタップ → プルダウン ----
// 画像を見ながらの入力とは別に、登録済みの任意の日をその場で直せる。保存はこの端末の中（local-store.js）の1セル更新。
const codeName = raw => { const c = DATA.codes[raw]; return !c ? '未確認' : c.kind === 'work' ? `${raw}（${c.start}–${c.end}）` : raw; };
const cellMenu = $('.cell-menu'), cellScrim = $('.cell-scrim'), cellToast = app.querySelector('.cell-toast');
const CM_CHECK = '<svg class="cm-check" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7"/></svg>';
const POP = 'cubic-bezier(.34,1.56,.64,1)', SETTLE = 'cubic-bezier(.34,1.3,.64,1)';
let menuTarget = null, menuAnim = null;
function openCellMenu(anchor) {
  const id = anchor.dataset.edit, p = people.find(x => x.id === id), key = state.view, d = state.selected, c = cellOf(key, id, d);
  if (!p || !c) return;
  closeCellMenu(false);
  const [y, m] = parseKey(key), dow = new Date(y, m - 1, d).getDay(), codes = Object.entries(DATA.codes);
  const work = codes.filter(([, v]) => v.kind === 'work').sort((a, b) => toHour(a[1].start) - toHour(b[1].start));
  const opt = (raw, inner, cls) => `<button type="button" role="option" class="cm-opt ${cls}" data-code="${esc(raw)}" aria-selected="${raw === c.raw}">${inner}${CM_CHECK}</button>`;
  // 勤務は始業の早い順。小さな時間軸に帯を描いて、選ぶ前に時間の違いが目で分かるようにする。
  cellMenu.innerHTML = `<div class="cm-head"><b>${esc(p.name)}さん</b><small>${m}月${d}日（${WEEK[dow]}）${c.kind === 'unknown' ? ` · いまは未確認` : ''}</small></div>
    <div class="cm-label">勤務</div><div class="cm-work">${work.map(([raw, v]) => { const s = toHour(v.start), e = toHour(v.end);
      return opt(raw, `<span class="cm-code">${esc(raw)}</span><span class="cm-time">${v.start}–${v.end}</span><span class="cm-mini"><i style="left:${(s - AXIS.start) / SPAN * 100}%;width:${(e - s) / SPAN * 100}%"></i></span>`, 'w'); }).join('')}</div>
    <div class="cm-label">お休み・その他</div><div class="cm-rest">${codes.filter(([, v]) => v.kind !== 'work').map(([raw]) => opt(raw, `<span>${esc(raw)}</span>`, '')).join('')}</div>`;
  cellMenu.setAttribute('aria-label', `${p.name}さんの${m}月${d}日の勤務を選ぶ`);
  cellMenu.hidden = false; cellScrim.hidden = false;
  // タップした帯のすぐ下（入らなければ上）に出し、帯の位置から膨らむように開く。
  const sr = sheet.getBoundingClientRect(), ar = anchor.getBoundingClientRect(), w = Math.min(300, sr.width - 24);
  cellMenu.style.width = `${w}px`;
  const h = cellMenu.offsetHeight, below = ar.bottom - sr.top + 8, above = ar.top - sr.top - 8 - h;
  const top = below + h <= sr.height - 12 ? below : above >= 12 ? above : Math.max(12, sr.height - 12 - h);
  const left = Math.min(Math.max(12, ar.left + ar.width / 2 - sr.left - w / 2), sr.width - w - 12);
  Object.assign(cellMenu.style, { left: `${left}px`, top: `${top}px`, transformOrigin: `${ar.left + ar.width / 2 - sr.left - left}px ${top === below ? -8 : h + 8}px` });
  menuTarget = { id, key, d, anchor, raw: c.raw };
  anchor.classList.add('editing'); app.classList.add('cell-editing');
  if (!reduced()) {
    menuAnim?.cancel();
    menuAnim = cellMenu.animate([{ opacity: 0, transform: 'scale(.5)' }, { opacity: 1, transform: 'none' }], { duration: 380, easing: SETTLE });
    cellMenu.querySelectorAll('.cm-label,.cm-opt').forEach((el, i) => el.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 240, delay: 50 + i * 16, easing: EASE, fill: 'backwards' }));
    cellMenu.querySelectorAll('.cm-mini i').forEach((el, i) => el.animate([{ transform: 'scaleX(0)' }, { transform: 'none' }], { duration: 420, delay: 120 + i * 30, easing: EASE, fill: 'backwards' }));
    cellMenu.querySelector('[aria-selected="true"] .cm-check')?.animate([{ transform: 'scale(0)' }, { transform: 'none' }], { duration: 320, delay: 300, easing: POP, fill: 'backwards' });
  }
  (cellMenu.querySelector('[aria-selected="true"]') ?? cellMenu.querySelector('.cm-opt')).focus({ preventScroll: true });
}
function closeCellMenu(restoreFocus = true) {
  if (!menuTarget) return;
  const { anchor } = menuTarget; menuTarget = null;
  anchor.classList.remove('editing'); app.classList.remove('cell-editing'); cellScrim.hidden = true;
  menuAnim?.cancel(); menuAnim = null;
  if (reduced()) cellMenu.hidden = true;
  else {
    menuAnim = cellMenu.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.7)' }], { duration: 170, easing: 'cubic-bezier(.4,0,1,1)' });
    menuAnim.finished.then(() => { if (!menuTarget) cellMenu.hidden = true; }, () => {});
  }
  if (restoreFocus && anchor.isConnected) anchor.focus({ preventScroll: true });
}
// 終わった月のシフトは閲覧のみ（誤って変えないため）。今月と来月以降はこれまでどおり直せる。
const pastNote = () => showToast({ text: '終わった月のシフトは閲覧のみです<br><small>今月と来月以降は、帯をタップして直せます。</small>', warn: true });
$('.lanes').addEventListener('click', e => { const b = e.target.closest('.bar[data-edit]'); if (b && !b.closest('.ghost')) LocalShift.isPast(state.view) ? pastNote() : openCellMenu(b); });
$('.rests').addEventListener('click', e => { const b = e.target.closest('[data-edit]'); if (b) LocalShift.isPast(state.view) ? pastNote() : openCellMenu(b); });
cellScrim.addEventListener('click', () => closeCellMenu());
cellMenu.addEventListener('click', e => {
  const o = e.target.closest('.cm-opt'), t = menuTarget;
  if (!o || !t || t.chosen) return;
  const code = o.dataset.code;
  if (code === t.raw) { closeCellMenu(); return; }
  // チェックを選んだ行へ移し、一拍おいてから閉じて帯を組み替える。
  t.chosen = true;
  cellMenu.querySelectorAll('.cm-opt').forEach(b => b.setAttribute('aria-selected', String(b === o)));
  if (!reduced()) o.querySelector('.cm-check').animate([{ transform: 'scale(0)' }, { transform: 'none' }], { duration: 220, easing: POP });
  setTimeout(() => { if (menuTarget === t) closeCellMenu(false); editCell(t.key, t.d, t.id, code); }, reduced() ? 0 : 150);
});
cellMenu.addEventListener('keydown', e => {
  e.stopPropagation();
  const opts = [...cellMenu.querySelectorAll('.cm-opt')], i = opts.indexOf(document.activeElement);
  const move = n => { e.preventDefault(); opts[(i + n + opts.length) % opts.length].focus(); };
  if (e.key === 'Escape') { e.preventDefault(); closeCellMenu(); }
  else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') move(1);
  else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') move(-1);
  else if (e.key === 'Tab') move(e.shiftKey ? -1 : 1);
});

// 選んだらすぐ画面に反映し（待たせない）、裏で保存する。失敗したら元の記号へ戻して知らせる。
// 連続で直しても版がずれないよう、保存は1件ずつ順番に送る。
let saveChain = Promise.resolve(), pendingEdits = [];
function writeCell(key, d, id, code) {
  const cells = DATA.months[key].shifts[id].trim().split(/\s+/);
  cells[d - 1] = code; DATA.months[key].shifts[id] = cells.join(' ');
}
function setLocal(key, d, id, code) {
  const apply = () => { writeCell(key, d, id, code); indexData(); };
  if (app.classList.contains('open') && state.view === key && state.selected === d) morphSheet(id, apply);
  else apply();
  renderMonth();
  const chip = chipOf(key, d), c = cellOf(key, self.id, d);
  if (chip) { chip.querySelector('.cd').className = `cd ${c?.kind ?? ''}`; chip.setAttribute('aria-label', chip.getAttribute('aria-label').replace(/\S+$/, c ? c.label : '予定なし')); }
}
// 保存結果を受け取る。画面は組み替えず、まだ保存待ちの修正は上に重ねておく。
function adoptSaved(next) {
  const focusId = self.id;
  people.splice(0, people.length, ...next.people);
  Object.assign(DATA, next, { people });
  owner = people.find(p => p.id === DATA.self);
  self = people.find(p => p.id === focusId) ?? owner;
  pendingEdits.forEach(p => writeCell(p.key, p.d, p.id, p.code));
  indexData();
}
function editCell(key, d, id, code, undo = false) {
  const before = parsed[key]?.[id]?.[d - 1], p = people.find(x => x.id === id);
  if (before == null || before === code || !p) return;
  if (job?.saving) { showToast({ text: 'シフトの登録を保存しています。終わってから直してください。', warn: true }); return; }
  const edit = { key, d, id, code };
  pendingEdits.push(edit);
  setLocal(key, d, id, code);
  const toast = showToast({ text: `${esc(p.name)}さん ${parseKey(key)[1]}月${d}日<br><b>${esc(DATA.codes[before] ? before : '未確認')} → ${esc(codeName(code))}</b>`, saving: true });
  saveChain = saveChain.then(async () => {
    try {
      const result = await api('/api/cell', { key, day: d, id, code, revision: DATA.revision });
      pendingEdits = pendingEdits.filter(x => x !== edit);
      adoptSaved(result.data);
      if (toast === currentToast) toastSaved(undo ? null : () => editCell(key, d, id, before, true));
    } catch (err) {
      pendingEdits = pendingEdits.filter(x => x !== edit);
      setLocal(key, d, id, before);
      const conflict = /別の画面/.test(err.message);
      if (conflict) { try { acceptData(await api('/api/data')); pendingEdits.forEach(x => writeCell(x.key, x.d, x.id, x.code)); indexData(); } catch {} }
      showToast({ warn: true, text: conflict ? 'ほかの端末で先に更新されていました<br><small>最新の内容を表示しています。もう一度選んでください。</small>'
        : `保存できなかったので元に戻しました<br><small>${esc(err.message)}</small>` });
    }
  });
}
// 組み替え前の位置を控え、描き直してから差分だけを動かす（FLIP）。
// 残る人は新しい時刻へ帯が伸び縮みし、帯がなくなる人は点に縮んで消え、新しく出勤する人は点から描かれる。
function morphSheet(id, mutate) {
  const key = state.view, d = state.selected, lanesEl = $('.lanes'), restsEl = $('.rests');
  const prev = new Map([...lanesEl.querySelectorAll(':scope > .lane:not(.ghost)')].map(el => {
    const bar = el.querySelector('.bar');
    return [el.dataset.id, { el, top: el.offsetTop, hidden: el.classList.contains('filtered'), left: bar.style.left, width: bar.style.width }];
  }));
  const restsBefore = restsEl.childElementCount ? restsEl.offsetTop : null, oldCounts = loadOf(key, d), oldMax = Math.max(1, ...oldCounts);
  const oldRuns = [...app.querySelectorAll('.load-track > .run:not(.old)')], mineBefore = $('.mine strong').textContent, filter = state.filter;
  mutate();
  renderSheet('edit');
  if (filter) applyFilter(filter, true);
  const target = app.querySelector(`.lanes > .lane:not(.ghost) [data-edit="${CSS.escape(id)}"], .rests [data-edit="${CSS.escape(id)}"]`);
  target?.focus({ preventScroll: true });
  if (reduced()) return;
  lanesEl.querySelectorAll(':scope > .lane').forEach(el => {
    const was = prev.get(el.dataset.id), bar = el.querySelector('.bar');
    prev.delete(el.dataset.id);
    if (!was || was.hidden) {
      push(el.querySelector(':scope > span').animate([{ opacity: 0, transform: 'translateX(-10px)' }, { opacity: 1, transform: 'none' }], { duration: T.name, delay: 90, easing: EASE, fill: 'backwards' }));
      drawBar(bar, 130, el.classList.contains('me'));
      if (el.dataset.id === id && !el.classList.contains('me')) ringBar(bar, 130 + T.draw);
      return;
    }
    const dy = was.top - el.offsetTop;
    if (dy) push(el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 440, easing: EASE }));
    if (was.left !== bar.style.left || was.width !== bar.style.width) {
      push(bar.animate([{ left: was.left, width: was.width }, { left: bar.style.left, width: bar.style.width }], { duration: 560, easing: SETTLE }));
      push(bar.querySelector('em').animate([{ opacity: 0, transform: 'translateY(5px)' }, { opacity: 1, transform: 'none' }], { duration: 260, delay: 220, easing: EASE, fill: 'backwards' }));
      ringBar(bar, 500);
    }
  });
  prev.forEach(({ el, top, hidden }) => {
    if (hidden) return;
    el.classList.add('ghost'); el.style.top = `${top}px`; lanesEl.appendChild(el);
    const a = el.querySelector('.bar').animate([{ clipPath: 'inset(0 0px 0 0 round 8px)', transform: 'none', opacity: 1 },
      { clipPath: DOT, transform: 'none', opacity: 1, offset: .6 }, { clipPath: DOT, transform: 'scale(.2)', opacity: 0 }], { duration: 440, easing: 'cubic-bezier(.65,0,.35,1)', fill: 'forwards' });
    push(el.querySelector(':scope > span').animate([{ opacity: 1 }, { opacity: 0 }], { duration: 260, delay: 140, fill: 'forwards' }));
    a.finished.then(() => el.remove(), () => el.remove()); push(a);
  });
  if (restsEl.childElementCount) {
    if (restsBefore == null) push(restsEl.animate(fadeUp, { duration: 300, delay: 120, easing: EASE }));
    else if (restsBefore !== restsEl.offsetTop) push(restsEl.animate([{ transform: `translateY(${restsBefore - restsEl.offsetTop}px)` }, { transform: 'none' }], { duration: 440, easing: EASE }));
    const added = restsEl.querySelector(`[data-edit="${CSS.escape(id)}"]`);
    if (added) push(added.animate([{ opacity: 0, transform: 'scale(.4)' }, { opacity: 1, transform: 'scale(1.1)', offset: .6 }, { opacity: 1, transform: 'none' }], { duration: 460, delay: 240, easing: EASE, fill: 'backwards' }));
  }
  // 人数の棒は、前の高さから新しい高さへ伸び縮みする。
  const counts = loadOf(key, d), max = Math.max(1, ...counts), hOf = (c, top) => c > 0 ? Math.max(3, Math.round(c / top * 44)) : 0;
  const slotOf = run => Math.round((Number(run.dataset.a) - AXIS.start) * 2);
  app.querySelectorAll('.load-track > .run:not(.old)').forEach(run => {
    const s = slotOf(run), i = run.querySelector('i'), from = hOf(oldCounts[s], oldMax), to = hOf(counts[s], max);
    if (from !== to) push(i.animate([{ height: `${from}px` }, { height: `${to}px` }], { duration: 500, easing: SETTLE }));
    if (oldCounts[s] !== counts[s]) push(run.querySelector('b').animate([{ opacity: 0, transform: 'translateY(6px) scale(.7)' }, { opacity: 1, transform: 'none' }], { duration: 300, delay: 180, easing: EASE, fill: 'backwards' }));
  });
  const track = $('.load-track');
  oldRuns.forEach(run => {
    if (counts[slotOf(run)] > 0) return;
    run.classList.add('old'); track.appendChild(run);
    const i = run.querySelector('i'), a = i.animate([{ height: i.style.height }, { height: '0px' }], { duration: 320, easing: EASE, fill: 'forwards' });
    push(run.querySelector('b').animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: 'forwards' }));
    a.finished.then(() => run.remove(), () => run.remove()); push(a);
  });
  const mineEl = $('.mine strong');
  if (mineEl.textContent !== mineBefore) push(mineEl.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 320, easing: EASE }));
}

// 下のお知らせ：保存中 → 保存済み（元に戻す）。残り時間を細い線で見せる。
let currentToast = null, toastTimer = 0, toastAnim = null;
function showToast({ text, saving = false, warn = false }) {
  clearTimeout(toastTimer);
  const t = currentToast = {}, wasHidden = cellToast.hidden;
  cellToast.className = `cell-toast${warn ? ' warn' : ''}`;
  cellToast.innerHTML = `<div class="ct-text">${text}</div>${saving ? '<span class="ct-status"><i></i>保存中</span>' : ''}<button type="button" class="ct-undo" hidden>元に戻す</button><span class="ct-timer"></span>`;
  cellToast.hidden = false;
  if (!reduced()) {
    toastAnim?.cancel();
    toastAnim = cellToast.animate(wasHidden ? [{ opacity: 0, transform: 'translateY(24px) scale(.96)' }, { opacity: 1, transform: 'none' }] : [{ transform: 'scale(.97)' }, { transform: 'none' }], { duration: 380, easing: SETTLE });
  }
  if (warn) hideToastLater(t, 6000);
  return t;
}
function toastSaved(undo) {
  const t = currentToast, st = cellToast.querySelector('.ct-status');
  if (st) { st.innerHTML = `${CM_CHECK}保存済み`; if (!reduced()) st.querySelector('svg').animate([{ transform: 'scale(0) rotate(-30deg)' }, { transform: 'none' }], { duration: 360, easing: POP }); }
  if (undo) {
    const b = cellToast.querySelector('.ct-undo');
    b.hidden = false; b.onclick = () => { hideToast(); undo(); };
    if (!reduced()) b.animate([{ opacity: 0, transform: 'translateX(8px)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: EASE });
  }
  hideToastLater(t, 5000);
}
function hideToastLater(t, ms) {
  if (!reduced()) cellToast.querySelector('.ct-timer').animate([{ transform: 'scaleX(1)' }, { transform: 'scaleX(0)' }], { duration: ms, fill: 'forwards' });
  toastTimer = setTimeout(() => { if (currentToast === t) hideToast(); }, ms);
}
function hideToast() {
  clearTimeout(toastTimer); currentToast = null;
  if (reduced()) { cellToast.hidden = true; return; }
  toastAnim?.cancel();
  toastAnim = cellToast.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(20px)' }], { duration: 200, easing: 'cubic-bezier(.4,0,1,1)' });
  toastAnim.finished.then(() => { if (!currentToast) cellToast.hidden = true; }, () => {});
}
loadEl.addEventListener('click', e => {
  const r = e.target.closest('.run:not(.old)');
  if (!r) return;
  const a = Number(r.dataset.a), b = Number(r.dataset.b);
  applyFilter(state.filter?.a === a && state.filter?.b === b ? null : { a, b, label: r.dataset.label });
});
$('.filter-chip').addEventListener('click', () => applyFilter(null));
const fadeUp = [{ opacity: 0, transform: 'translateY(9px)' }, { opacity: 1, transform: 'none' }];
function enterNowLine(delay) {
  const nl = $('.nowline');
  if (nl) push(nl.animate([{ transform: 'scaleY(0)', opacity: 0 }, { transform: 'scaleY(1)', opacity: 1 }], { duration: 520, delay, easing: EASE, fill: 'backwards' }));
}
function revealContent() {
  if (reduced()) return;
  const parts = [$('.sheethead'), strip, $('.mine'), $('.timeline-title'), $('.axis'), ...(loadEl.hidden ? [] : [loadEl])];
  parts.forEach((el, i) => push(el.animate(fadeUp, { duration: 320, delay: 80 + i * 30, easing: EASE, fill: 'backwards' })));
  push(indicator.animate([{ scale: '.3', opacity: 0 }, { scale: '1', opacity: 1 }],
    { duration: 420, delay: 200, easing: 'cubic-bezier(.34,1.56,.64,1)', fill: 'backwards' }));
  const base = 80 + parts.length * 30;
  if (!loadEl.hidden) enterRuns(base);
  const end = enterLanes(base + 70);
  push($('.rests').animate(fadeUp, { duration: 300, delay: end + 100, easing: EASE, fill: 'backwards' }));
  enterNowLine(end + 380);
}
// 日付を切り替えたとき：表示中の全員をいったん退場させ、新しい日の全員を開いたときと同じ順番で出す。
function switchContent(before, dir) {
  [$('.sheetdate'), $('.mine strong'), $('.timeline-title small')].forEach(el =>
    push(el.animate([{ opacity: 0, transform: `translateX(${dir * 14}px)` }, { opacity: 1, transform: 'none' }], { duration: 300, easing: EASE })));
  const lanesEl = $('.lanes');
  before.lanes.forEach(({ el, top }, i) => {
    el.classList.add('ghost'); el.style.top = `${top}px`; lanesEl.appendChild(el);
    const a = el.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: `translateX(${-dir * 12}px)` }],
      { duration: 130, delay: Math.min(i, 8) * 6, easing: 'cubic-bezier(.4,0,1,1)', fill: 'both' });
    a.finished.then(() => el.remove(), () => el.remove());
    push(a);
  });
  const track = $('.load-track');
  before.runs.forEach(run => {
    run.classList.add('old'); track.appendChild(run);
    const a = run.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, fill: 'forwards' });
    a.finished.then(() => run.remove(), () => run.remove());
    push(a);
  });
  if (!loadEl.hidden) enterRuns(70);
  const end = enterLanes(100);
  push($('.rests').animate(fadeUp, { duration: 300, delay: end + 100, easing: EASE, fill: 'backwards' }));
  enterNowLine(end + 380);
}

// 開閉の動き：強めの減衰を持つスプリングで開き、閉じるときは短く下へ退く。途中の操作は現在位置から継続する。
const motion = { duration: 520 };
const currentY = () => { const v = getComputedStyle(sheet).transform; return v === 'none' ? 0 : new DOMMatrixReadOnly(v).m42; };
const hiddenY = () => sheet.offsetHeight * 1.05;
function animateSheet(from, to, opening, animate = true) {
  const id = ++animationId; sheetAnimation?.cancel(); sheetAnimation = null; sheet.style.removeProperty('transform');
  if (!animate || reduced()) { app.classList.remove('leaving'); return; }
  let frames;
  if (opening) {
    frames = Array.from({ length: 49 }, (_, i) => {
      const t = i / 48, progress = i === 48 ? 1 : 1 - Math.exp(-9 * t) * (Math.cos(4.5 * t) + 2 * Math.sin(4.5 * t));
      return { transform: `translateY(${from + (to - from) * progress}px)`, offset: t };
    });
  } else frames = [{ transform: `translateY(${from}px)` }, { transform: `translateY(${to}px)` }];
  sheetAnimation = sheet.animate(frames, { duration: opening ? motion.duration : 260, easing: opening ? 'linear' : 'cubic-bezier(.4,0,.8,.4)' });
  sheetAnimation.finished.then(() => { if (id === animationId) { app.classList.remove('leaving'); sheetAnimation = null; } }).catch(() => {});
}
function show(d) {
  const wasMoving = app.classList.contains('open') || app.classList.contains('leaving');
  const from = wasMoving ? currentY() : null;
  app.classList.remove('leaving', 'dragging'); shade.style.removeProperty('opacity'); drag = null;
  select(d);
  buildStrip();
  indicatorX = null;
  renderSheet('open');
  app.classList.add('open'); sheet.setAttribute('aria-hidden', 'false'); sheet.inert = false; calendarView.inert = true;
  animateSheet(from ?? hiddenY(), 0, true);
  $('.close').focus({ preventScroll: true });
}
function close() {
  if (!app.classList.contains('open')) return;
  const from = currentY(); drag = null; app.classList.remove('dragging'); shade.style.removeProperty('opacity');
  closeCellMenu(false); stopContent(); app.classList.add('leaving'); app.classList.remove('open'); calendarView.inert = false;
  cal.querySelector(`[data-day="${state.selected}"]`)?.focus({ preventScroll: true });
  sheet.setAttribute('aria-hidden', 'true'); sheet.inert = true;
  animateSheet(from, hiddenY(), false);
}
$('.close').addEventListener('click', close);
shade.addEventListener('click', close);
document.addEventListener('keydown', e => {
  if (!app.classList.contains('open')) return;
  if (e.key === 'Escape') close();
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    const next = allDays[dayIndex(state.view, state.selected) + (e.key === 'ArrowRight' ? 1 : -1)];
    if (next) { e.preventDefault(); goToDay(next.key, next.d); if (strip.contains(document.activeElement)) chipOf(next.key, next.d)?.focus({ preventScroll: true }); }
  } else if (e.key === 'Tab') {
    // フォーカスは勤務表の中で循環させる（閉じる → 選択中の日付 → 絞り込み解除 → 人数の区間）。
    e.preventDefault();
    const filterChip = $('.filter-chip');
    const stops = [$('.close'), chipOf(state.view, state.selected), filterChip.hidden ? null : filterChip,
      ...(loadEl.hidden ? [] : app.querySelectorAll('.load-track > .run:not(.old)')),
      ...app.querySelectorAll('.lanes > .lane:not(.ghost):not(.filtered) .bar, .rests [data-edit]')].filter(Boolean);
    const i = stops.indexOf(document.activeElement);
    stops[(i + (e.shiftKey ? stops.length - 1 : 1)) % stops.length].focus({ preventScroll: true });
  }
});
window.addEventListener('resize', () => { if (app.classList.contains('open')) { indicatorX = null; updateStrip(false); } });

// つまみ・見出し・本人欄を下へ引くと追従。小さな移動は戻し、高さの約24%以上か速い下向きのフリックで閉じる。
sheet.addEventListener('pointerdown', e => {
  if (e.button !== 0 || !app.classList.contains('open') || e.target.closest('button') || !e.target.closest('.grab,.sheethead,.mine')) return;
  const y = currentY(); sheetAnimation?.cancel(); sheetAnimation = null; ++animationId;
  sheet.style.transform = `translateY(${y}px)`;
  drag = { pointer: e.pointerId, start: e.clientY, origin: y, height: sheet.offsetHeight, y, velocity: 0, lastY: e.clientY, lastTime: performance.now() };
  sheet.setPointerCapture(e.pointerId); app.classList.add('dragging');
});
sheet.addEventListener('pointermove', e => {
  if (!drag || drag.pointer !== e.pointerId) return;
  const t = performance.now(), raw = drag.origin + e.clientY - drag.start;
  drag.y = raw < 0 ? Math.max(-12, raw * .13) : raw;
  drag.velocity = (e.clientY - drag.lastY) / Math.max(1, t - drag.lastTime); drag.lastY = e.clientY; drag.lastTime = t;
  sheet.style.transform = `translateY(${drag.y}px)`;
  shade.style.opacity = String(Math.max(0, 1 - Math.max(0, drag.y) / drag.height));
});
function releaseDrag(e, cancelled = false) {
  if (!drag || drag.pointer !== e.pointerId) return;
  const s = drag; drag = null; app.classList.remove('dragging');
  if (sheet.hasPointerCapture(e.pointerId)) sheet.releasePointerCapture(e.pointerId);
  shade.style.removeProperty('opacity');
  const velocity = performance.now() - s.lastTime < 100 ? s.velocity : 0;
  if (!cancelled && (s.y > s.height * .24 || (s.y > 24 && velocity > .65))) close();
  else animateSheet(s.y, 0, true);
}
sheet.addEventListener('pointerup', e => releaseDrag(e));
sheet.addEventListener('pointercancel', e => releaseDrag(e, true));
sheet.addEventListener('lostpointercapture', e => releaseDrag(e, true));
sheet.inert = true;
motionPreference.addEventListener('change', () => {
  if (!reduced()) return;
  ++animationId; sheetAnimation?.cancel(); sheetAnimation = null; stopContent();
  indicatorAnimation?.cancel(); monthAnimations.forEach(a => a.cancel()); monthAnimations = []; app.classList.remove('leaving');
});

// =====================================================================
// シフトの登録（左上「＋シフトを登録」→ 画像／CSV → 登録作業中の画面）
// =====================================================================
const regBtn = $('.reg-btn'), regMenu = $('.reg-menu'), importer = $('.importer');
const menuOpen = () => regBtn.getAttribute('aria-expanded') === 'true';
let menuAnimation = null;
function openRegMenu() {
  if (job && !job.done) { expandImporter(); return; }
  if (menuOpen()) return;
  menuAnimation?.cancel();
  regMenu.hidden = false; regBtn.setAttribute('aria-expanded', 'true');
  if (!reduced()) {
    menuAnimation = regMenu.animate([{ opacity: 0, transform: 'translateY(-8px) scale(.9)' }, { opacity: 1, transform: 'none' }],
      { duration: 320, easing: 'cubic-bezier(.34,1.4,.64,1)' });
    regMenu.querySelectorAll('.reg-item').forEach((el, i) => {
      el.animate([{ opacity: 0, transform: 'translateX(-10px)' }, { opacity: 1, transform: 'none' }], { duration: 280, delay: 60 + i * 60, easing: EASE, fill: 'backwards' });
      el.querySelector('.ri-icon').animate([{ transform: 'scale(.3) rotate(-14deg)' }, { transform: 'none' }],
        { duration: 460, delay: 90 + i * 60, easing: 'cubic-bezier(.34,1.56,.64,1)', fill: 'backwards' });
    });
  }
  regMenu.querySelector('.reg-item').focus({ preventScroll: true });
}
function closeRegMenu(focusBack = false) {
  if (!menuOpen()) return;
  regBtn.setAttribute('aria-expanded', 'false');
  menuAnimation?.cancel();
  if (reduced()) regMenu.hidden = true;
  else {
    menuAnimation = regMenu.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-4px) scale(.95)' }], { duration: 150, easing: 'cubic-bezier(.4,0,1,1)' });
    menuAnimation.finished.then(() => { regMenu.hidden = true; }, () => {});
  }
  if (focusBack) regBtn.focus({ preventScroll: true });
}
regBtn.addEventListener('click', () => (menuOpen() ? closeRegMenu() : openRegMenu()));
document.addEventListener('pointerdown', e => { if (menuOpen() && !regMenu.contains(e.target) && !regBtn.contains(e.target)) closeRegMenu(); });
const pickFile = kind => app.querySelector(`.file-input[data-kind="${kind}"]`).click();
regMenu.addEventListener('click', e => {
  const item = e.target.closest('.reg-item');
  if (!item) return;
  if (job && !job.done) { closeRegMenu(); expandImporter(); return; }
  if (item.dataset.kind === 'history') { openHistory(); return; }
  pickFile(item.dataset.kind);   // ファイル選択はタップの直後に開く必要がある
  closeRegMenu();
});
app.querySelectorAll('.file-input').forEach(input => input.addEventListener('change', () => {
  // 複数のファイルをまとめて選べる。すべて終わるまで登録中の画面のまま進める。
  const files = [...(input.files ?? [])];
  input.value = '';
  if (files.length) runImport(input.dataset.kind, files);
}));

const fmtSize = n => n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
const fmtMonth = key => { const [y, m] = parseKey(key); return `${y}年${m}月`; };
const sleep = ms => new Promise(r => setTimeout(r, reduced() ? 0 : ms));
const CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
const MARKS = { ok: 'M24 39.5 33.5 49 52 29', warn: 'M29 29l18 18M47 29 29 47', info: 'M38 35v16M38 26v.5' };

let importRun = 0, importResultKey = null, previewUrl = null, litTimer = 0, pctShown = 0, importActions = [];
// 登録作業の状態。minimized のときは右下の小さな進捗表示だけを出し、裏で続ける。
let job = null;
const pill = $('.imp-pill');
function openImporter(kind, files) {
  if (app.classList.contains('open')) close();
  if (app.classList.contains('drawer-open')) closeDrawer();
  closeRegMenu();
  importer.hidden = false; calendarView.inert = true;
  importResultKey = null;
  $('.imp-preview').hidden = false;
  $('.imp-editor').hidden = true;
  $('.imp-tag').hidden = kind !== 'image';
  $('#imp-title').textContent = 'シフトを登録中';
  $('.imp-min').hidden = false;
  $('.imp-result').hidden = true; $('.imp-steps').hidden = false; $('.imp-progress').hidden = false;
  $('.imp-bar i').style.transform = 'scaleX(0)'; $('.imp-pct').textContent = '0%';
  pctShown = 0;
  setFile(0, false);
  $('.imp-file').hidden = kind === 'history';
  processingActions(true);
  $('.imp-min').focus({ preventScroll: true });
  if (!reduced()) {
    importer.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240, easing: 'ease' });
    [...$('.imp-body').children].forEach((el, i) => el.animate([{ opacity: 0, transform: 'translateY(16px)' }, { opacity: 1, transform: 'none' }],
      { duration: 460, delay: 60 + i * 55, easing: EASE, fill: 'backwards' }));
  }
}
// 何件目のファイルを処理中かを見出しとプレビューに出す（画面そのものは切り替えない）。
function setFile(i, animate = true) {
  const file = job.files[i], n = job.files.length;
  $('.imp-file').innerHTML = n > 1 ? `<b class="imp-count">${n}件</b>まとめて確認 · ${fmtSize(job.files.reduce((sum, f) => sum + f.size, 0))}` : `${esc(file.name)}${file.size ? ` · ${fmtSize(file.size)}` : ''}`;
  const preview = $('.imp-preview');
  preview.classList.remove('done');
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = job.kind === 'image' ? URL.createObjectURL(file) : null;
  preview.innerHTML = (job.kind === 'image'
    ? `<img alt="" src="${previewUrl}">`
    : '<span class="ri-icon csv big" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M3 9.5h18M3 14.5h18M9 4v16M15 4v16"/></svg></span>')
    + '<div class="grid"></div><div class="scan"></div>';
  if (animate && !reduced()) {
    preview.animate([{ opacity: .3, transform: 'scale(.97)' }, { opacity: 1, transform: 'none' }], { duration: 320, easing: EASE });
    $('.imp-count')?.animate([{ transform: 'scale(1.3)' }, { transform: 'none' }], { duration: 300, easing: 'cubic-bezier(.34,1.56,.64,1)' });
  }
}
function processingActions(allowCancel) {
  setActions([['バックグラウンドで続ける', 'secondary', minimizeImporter], ...(allowCancel ? [['キャンセル', 'ghost', () => closeImporter(), true]] : [])]);
}
function setActions(list) {
  importActions = list;
  $('.imp-actions').innerHTML = list.map(([label, cls], i) => `<button type="button" class="${cls}" data-i="${i}">${label}</button>`).join('');
}
$('.imp-actions').addEventListener('click', e => { const b = e.target.closest('button'); if (b) importActions[Number(b.dataset.i)]?.[2](); });
function renderSteps(labels) {
  $('.imp-steps').innerHTML = labels.map(l => `<li><span class="st">${CHECK}</span><span>${l}</span><small></small></li>`).join('');
}
// 全ファイルを一括処理し、完了した工程数で進捗を表示する。
function progress(fileP) {
  const p = fileP;
  const bar = $('.imp-bar i'), pct = $('.imp-pct'), from = pctShown;
  if (p < from) return;
  pctShown = p;
  updatePill();
  bar.style.transform = `scaleX(${p})`;
  if (reduced()) { pct.textContent = `${Math.round(p * 100)}%`; return; }
  bar.animate([{ transform: `scaleX(${from})` }, { transform: `scaleX(${p})` }], { duration: 520, easing: EASE });
  const t0 = performance.now();
  const tick = t => {
    const k = Math.min(1, (t - t0) / 460);
    pct.textContent = `${Math.round((from + (p - from) * (1 - (1 - k) ** 3)) * 100)}%`;
    if (k < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
// i 番目の工程を進行中にする。直前の工程にはチェックがポンと付く。
function setStep(i) {
  const items = [...importer.querySelectorAll('.imp-steps li')];
  items.forEach((li, j) => {
    const wasDone = li.classList.contains('done');
    li.classList.toggle('done', j < i); li.classList.toggle('active', j === i);
    if (j < i && !wasDone && !reduced()) li.querySelector('.st').animate([{ transform: 'scale(.4)' }, { transform: 'scale(1.18)', offset: .6 }, { transform: 'none' }], { duration: 420, easing: EASE });
  });
  if (items[i] && !reduced()) items[i].animate([{ transform: 'translateX(-4px)', opacity: .6 }, { transform: 'none', opacity: 1 }], { duration: 300, easing: EASE });
  progress(Math.min(1, i / items.length));
}
function stepNote(i, text) {
  const small = importer.querySelectorAll('.imp-steps li small')[i];
  if (!small) return;
  small.textContent = text;
  if (!reduced()) small.animate([{ opacity: 0, transform: 'translateX(6px)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: EASE });
}
function stopLit() { clearInterval(litTimer); litTimer = 0; }
// CSVの先頭を小さな表で見せ、読み取っているセルを順に光らせる。
function showMiniTable(rows) {
  const preview = $('.imp-preview');
  preview.innerHTML = `<table class="mini">${rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</table><div class="scan"></div>`;
  if (!reduced()) preview.querySelector('.mini').animate([{ opacity: 0, transform: 'scale(.94)' }, { opacity: 1, transform: 'none' }], { duration: 360, easing: EASE });
  const tds = [...preview.querySelectorAll('tr:not(:first-child) td:not(:first-child)')];
  let i = 0;
  stopLit();
  if (tds.length && !reduced()) litTimer = setInterval(() => { tds[(i + tds.length - 2) % tds.length].classList.remove('lit'); tds[i % tds.length].classList.add('lit'); i++; }, 90);
}
function showResult({ mark = 'ok', head, title, text = '', stats = [], notes = [], actions }) {
  $('.imp-editor').hidden = true;
  stopLit();
  $('.imp-preview').classList.add('done');
  importer.querySelectorAll('.imp-preview td.lit').forEach(td => td.classList.remove('lit'));
  $('#imp-title').textContent = head;
  $('.imp-min').hidden = true;
  $('.imp-steps').hidden = true; $('.imp-progress').hidden = true;
  const res = $('.imp-result');
  res.className = `imp-result ${mark}`; res.hidden = false;
  res.innerHTML = `<div class="res-mark"><svg viewBox="0 0 76 76"><circle class="ring" cx="38" cy="38" r="34"/><path class="tick" d="${MARKS[mark]}"/></svg></div>`
    + `<h3 class="res-title">${title}</h3>${text ? `<p class="res-text">${text}</p>` : ''}`
    + (stats.length ? `<div class="res-stats">${stats.map(([n, l]) => `<div><b>${n}</b><small>${l}</small></div>`).join('')}</div>` : '')
    + `<ul class="res-notes">${notes.map(n => `<li>${n}</li>`).join('')}</ul>`;
  setActions(actions);
  if (!job?.minimized) $('.imp-actions button')?.focus({ preventScroll: true });
  if (reduced()) return;
  // 丸を描いてから印を描き、文字と数字を順に出す。
  res.querySelector('.ring').animate([{ strokeDasharray: 214, strokeDashoffset: 214 }, { strokeDasharray: 214, strokeDashoffset: 0 }], { duration: 520, easing: EASE });
  res.querySelector('.tick').animate([{ strokeDasharray: 40, strokeDashoffset: 40 }, { strokeDasharray: 40, strokeDashoffset: 0 }], { duration: 320, delay: 380, easing: EASE, fill: 'backwards' });
  res.querySelector('.res-mark').animate([{ transform: 'scale(.6)' }, { transform: 'none' }], { duration: 520, easing: 'cubic-bezier(.34,1.56,.64,1)' });
  [...res.children].slice(1).forEach((el, i) => el.animate([{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }],
    { duration: 380, delay: 300 + i * 70, easing: EASE, fill: 'backwards' }));
  res.querySelectorAll('.res-stats b').forEach((b, i) => setTimeout(() => countUp(b, 0, Number(b.textContent)), 420 + i * 80));
  [...$('.imp-actions').children].forEach((el, i) => el.animate([{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }],
    { duration: 360, delay: 520 + i * 60, easing: EASE, fill: 'backwards' }));
}
function closeImporter(goTo = false, fromTransform = 'none', swipeDuration = 360) {
  const closingRun = ++importRun; stopLit();
  const target = goTo ? importResultKey : null;
  job = null; hidePill();
  const done = () => { if (closingRun !== importRun) return; importer.hidden = true; importer.style.removeProperty('transform'); calendarView.inert = app.classList.contains('open') || app.classList.contains('drawer-open'); if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; } };
  if (reduced() || importer.hidden) done();
  else {
    const swiped = fromTransform !== 'none';
    // Keep a dismissed sheet full-size and opaque until it clears the bottom edge.
    importer.animate([
      { opacity: 1, transform: fromTransform },
      { opacity: swiped ? 1 : 0, transform: swiped ? 'translateY(100%)' : 'translateY(14px)' }
    ], { duration: swiped ? swipeDuration : 220, easing: swiped ? 'cubic-bezier(.22,.72,.18,1)' : 'cubic-bezier(.4,0,1,1)' }).finished.then(done, done);
  }
  if (target && target !== state.view) changeMonth(target, target > state.view ? 1 : -1);
  else { renderMonth(); if (target && !reduced()) enterCalendar(0); }
  regBtn.focus({ preventScroll: true });
}
// 以前サーバーへ送っていた要求は、同じ形のまま端末の中の保存（local-store.js）が受け持つ。外部へは送らない。
async function api(url, body) {
  return window.LocalShift.api(url, body === undefined ? undefined : structuredClone(body));
}
function acceptData(next) {
  const focusId = self.id;
  people.splice(0, people.length, ...next.people);
  Object.assign(DATA, next, { people });
  owner = people.find(p => p.id === DATA.self);
  self = people.find(p => p.id === focusId) ?? owner;
  indexData();
  buildStrip(); renderPeople(); renderMonth();
  if (app.classList.contains('open')) renderSheet('refresh');
}
function finishJob(opts) {
  job.done = true; job.result = opts;
  if (job.minimized) { renderMonth(); pillDone(); }
  else { showResult(opts); job.resultShown = true; }
}
const closeAction = () => ['閉じる', 'ghost', () => closeImporter(), true];
function importFailure(err, kind) {
  if (job?.entry) {
    job.saving = false; job.review = true;
    showResult({mark:'warn',head:'シフトの登録',title:'登録を完了できませんでした',text:esc(err.message),
      actions:[['入力内容を確認する','primary',showImageEditor],['下書きを保存して閉じる','ghost',closeImageEntry,true]]});
    return;
  }
  finishJob({ mark: 'warn', head: 'シフトの登録', title: '保存できませんでした', text: esc(err.message),
    actions: [['ファイルを選び直す', 'primary', () => { closeImporter(); pickFile(kind); }], closeAction()] });
}
async function runImport(kind, files) {
  if (job && !job.done) { expandImporter(); return; }
  const run = ++importRun, alive = () => run === importRun;
  hidePill();
  job = { kind, files, index: 0, minimized: false, done: false, result: null };
  openImporter(kind, files);
  renderSteps(kind === 'image' ? ['画像を保存', '表を読み取り', '記号と氏名を照合', 'カレンダーへ反映'] : ['CSVを読み込み', '日付・氏名・記号を照合', '内容を確認', '保存']);
  setStep(0);
  try {
    if (kind === 'image') { await importImages(files, alive); return; }
    if (files.length > 12 || files.some(f => f.size > 1024 * 1024)) throw new Error('CSVは1回12件まで、1件1MB以内で選んでください。');
    const payload = [];
    for (const file of files) { const text = decodeText(await file.arrayBuffer()); if (!alive()) return; payload.push({ name: file.name, text }); }
    setStep(1);
    const plan = await api('/api/prepare', { files: payload });
    if (!alive()) return;
    if (plan.issues.length) {
      finishJob({ mark: 'warn', head: 'まとめて確認してください', title: `${plan.issues.length}件の確認が必要です`, text: 'まだ保存していません。下記を修正してから選び直してください。未定義の記号や空欄には、時間を割り当てません。', notes: plan.issues.map(esc),
        actions: [['ファイルを選び直す', 'primary', () => { closeImporter(); pickFile('csv'); }], closeAction()] }); return;
    }
    if (!plan.changes.length) {
      finishJob({ mark: 'info', head: '照合が終わりました', title: 'すべて登録済みの内容です', text: `${plan.same}件を照合しました。重複や変更はありません。`, actions: [closeAction()] }); return;
    }
    if (job.minimized) expandImporter();
    job.review = true; job.pending = { payload, plan };
    showResult({ mark: 'info', head: '登録内容の確認', title: `${plan.changes.length}件を反映します`, text: `${plan.months.map(fmtMonth).join('・')}。記載のない日付と過去の月はそのまま保持します。`,
      stats: [[plan.changes.filter(w => w.before === '?').length, '新規'], [plan.changes.filter(w => w.before !== '?').length, '更新'], [plan.same, '変更なし']],
      notes: [...plan.newPeople.map(p => `新しいメンバー：${esc(p.name)}（別名の場合は登録せずCSVの氏名を修正してください）`), ...plan.changes.map(w => `${esc(w.key)}-${String(w.d).padStart(2, '0')} ${esc(w.name)}：${esc(w.before)} → ${esc(w.code)}`)],
      actions: [['この内容で保存', 'primary', savePending], ['キャンセル', 'ghost', () => closeImporter(), true]] });
  } catch (err) { if (alive()) importFailure(err, kind); }
}
// ---- 画像から自動で登録（AI・外部APIなし。image-reader.js が端末の中で読み取る） ----
// 全マス・氏名・年月を自信をもって読め、下の集計とも合えばそのままカレンダーへ反映する。
// 読めない所があるときだけ、読めた分を下書きに入れて「画像を見ながら入力」を開き、確認が必要な所を示す。
const readCache = new Map();   // 画像ID → 読み取り結果（確認後に見本を学ぶため、この画面を開いている間だけ持つ）
const fileBase64 = file => new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result.split(',')[1]); r.onerror = () => reject(new Error('画像を開けませんでした。')); r.readAsDataURL(file); });
async function imageDataOf(file) {
  const bmp = await createImageBitmap(file);
  // 大きな画面のスクリーンショットは、見本を作った画像と同じくらいの幅にそろえてから読む。
  const k = bmp.width > 1000 ? 869 / bmp.width : 1, c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(bmp, 0, 0, c.width, c.height); bmp.close?.();
  return x.getImageData(0, 0, c.width, c.height);
}
const hanCount = name => [...name].filter(ch => /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(ch)).length || [...name].length;
function personByLabel(label) {
  const n = String(label).normalize('NFKC').replace(/\s+/g, '');
  return people.find(p => [p.name, ...(p.aliases ?? [])].some(a => a.normalize('NFKC').replace(/\s+/g, '') === n));
}
// 読み取り結果 → 下書き。読めなかった所は空のまま（未確認）にして、理由を issues に、画面で示す場所を hints に入れる。
function draftFromRead(read) {
  const issues = [], hints = { cells: {}, people: {}, columnOf: {} }, names = [], cells = {};
  if (!read.month) issues.push('年月を決められませんでした（日数・曜日・左上の月が合う月がありません）。');
  read.columns.forEach((col, k) => {
    const p = people.find(x => x.id === col.person), name = p ? p.name : col.ocrName && !names.includes(col.ocrName) ? col.ocrName : `？${k + 1}列目`;
    names.push(name); cells[name] = {}; hints.columnOf[name] = k;
    if (!p) { issues.push(`${k + 1}列目の氏名`); hints.people[name] = name === col.ocrName ? `氏名を文字認識で「${name}」と読みました。似た字と取り違えることがあります。画像の氏名と同じか確かめて、違えば氏名の欄でこの行を書き換えてください。` : '氏名を読み取れませんでした。画像を見て、氏名の欄でこの行を書き換えてください。'; }
    const unknown = [];
    col.cells.forEach((c, i) => { if (c.code) cells[name][i + 1] = c.code; else unknown.push(i + 1); });
    if (unknown.length) { hints.cells[name] = unknown; issues.push(`${name}さん ${unknown.join('・')}日`); }
    const s = col.summary ?? {}, rare = col.cells.some(c => c.code === '有休' || c.code === '育休');
    if (col.check === 'mismatch' || (rare && col.check !== 'ok')) {
      issues.push(`${name}さんの集計`);
      hints.people[name] = col.check === 'mismatch'
        ? `画像下の集計（公休数 ${s.off ?? '?'}・有休 ${s.paid ?? '?'}）と、読み取った記号の数（公休 ${s.counted?.off}・有休 ${s.counted?.paid}）が合いません。この人の記号を確認してください。`
        : '有休・育休を含むのに、画像下の集計で確かめられませんでした。この人の記号を確認してください。';
    }
  });
  return { draft: { month: read.month ?? '', names, cells }, issues, hints, warnings: read.cut ? ['画像の右端で切れている列がありました（読み取っていません）。そこに別の人の勤務があれば、端まで写した画像で登録し直してください。'] : [] };
}
function csvOfDraft(draft) {
  const [y, m] = draft.month.split('-').map(Number), days = new Date(y, m, 0).getDate(), quote = s => `"${String(s).replace(/"/g, '""')}"`;
  const rows = [[draft.month, ...draft.names], ...Array.from({ length: days }, (_, i) => [String(i + 1), ...draft.names.map(n => draft.cells[n][i + 1])])];
  return [{ name: `画像読み取り-${draft.month}.csv`, text: rows.map(r => r.map(quote).join(',')).join('\n') }];
}
// 確認が必要なマスを、元画像から切り抜いて拡大した小さな画像にする（入力欄の横に出す）。
async function cropCells(imageData, read, hints) {
  const src = document.createElement('canvas'); src.width = imageData.width; src.height = imageData.height;
  src.getContext('2d').putImageData(imageData, 0, 0);
  const crops = {};
  let left = 40;
  for (const [name, days] of Object.entries(hints.cells)) {
    const col = read.columns[hints.columnOf[name]]; if (!col) continue;
    for (const day of days) {
      if (left-- <= 0) break;
      const b = col.cells[day - 1]?.box; if (!b) continue;
      const pad = 2, w = b.x1 - b.x0 + pad * 2, h = b.y1 - b.y0 + pad * 2, c = document.createElement('canvas');
      c.width = w * 3; c.height = h * 3;
      const x = c.getContext('2d'); x.imageSmoothingEnabled = true; x.drawImage(src, b.x0 - pad, b.y0 - pad, w, h, 0, 0, c.width, c.height);
      const blob = await new Promise(r => c.toBlob(r, 'image/png'));
      if (blob) (crops[name] ??= {})[day] = URL.createObjectURL(blob);
    }
  }
  return crops;
}
async function saveImageDraft(item, draft) {
  const saved = await api(`/api/image-draft?id=${item.id}`);
  return api('/api/image-draft', { id: item.id, draft, version: saved.version });
}
// 確定した内容で、記号と氏名の見本を少しずつ育てる（次の画像ほど読みやすくなる）。失敗しても登録には影響しない。
function learnFromRead(read, draft) {
  if (!read || draft.names.length !== read.columns.length) return;
  const codes = [], names = [], order = [];
  read.columns.forEach((col, k) => {
    const label = draft.names[k], p = personByLabel(label);
    order.push(p?.id ?? null);
    if (p && col.nameSample) names.push({ id: p.id, v: col.nameSample.v, width: Math.min(col.nameSample.width, Math.round(16 * hanCount(p.name) * 1.05)) });
    col.cells.forEach((c, i) => { const code = draft.cells[label]?.[i + 1]; if (c.sample && code && Object.hasOwn(DATA.codes, code)) codes.push({ code, ...c.sample }); });
  });
  api('/api/reader-learn', { codes, names, order }).then(r => { if (!job || job.done) acceptData(r.data); else Object.assign(DATA, { reader: r.data.reader, revision: r.data.revision }); }).catch(() => {});
}
// 読み取った結果をマス目の図で見せる：列ごとに順に立ち上がり、読めなかったマスだけが点滅する。
function showReadMap(read) {
  const preview = $('.imp-preview'), total = read.columns.length * read.days;
  const ok = read.columns.reduce((n, c) => n + c.cells.filter(x => x.code).length, 0);
  preview.classList.add('done', 'mapped');
  preview.innerHTML = `<div class="readmap" style="--rows:${read.days}">${read.columns.map(col => `<div class="rm-col${col.person ? '' : ' rm-noname'}${col.check === 'mismatch' ? ' rm-bad' : ''}">${col.cells.map(c => `<i class="${c.code ? `k-${DATA.codes[c.code]?.kind ?? 'work'}` : 'k-unknown'}"></i>`).join('')}</div>`).join('')}</div>
    <div class="rm-count"><b>${reduced() ? ok : 0}</b><span>/ ${total}マスを読み取り</span></div>`;
  if (reduced()) return Promise.resolve();
  const cols = [...preview.querySelectorAll('.rm-col')];
  cols.forEach((col, k) => col.animate([{ opacity: 0, transform: 'translateY(8px) scaleY(.5)' }, { opacity: 1, transform: 'none' }], { duration: 380, delay: k * 45, easing: EASE, fill: 'backwards' }));
  preview.querySelector('.rm-count').animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 300, delay: 120, easing: EASE, fill: 'backwards' });
  countUp(preview.querySelector('.rm-count b'), 0, ok);
  return new Promise(r => setTimeout(r, Math.min(1300, cols.length * 45 + 650)));
}
async function importImages(files, alive) {
  if (files.length > 5 || files.some(f => f.size > 8 * 1024 * 1024)) throw new Error('画像は1回5枚まで、1枚8MB以内で選んでください。');
  processingActions(false);
  const outcomes = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    job.index = i; if (i) setFile(i);
    setStep(0);
    const base64 = await fileBase64(file); if (!alive()) return;
    const [item] = (await api('/api/images', { files: [{ name: file.name, base64 }] })).results; if (!alive()) return;
    if (item.status === 'complete') { outcomes.push({ file, item, state: 'already' }); continue; }
    setStep(1);
    let read = null, failure = null;
    let pixels = null;
    try { pixels = await imageDataOf(file); read = window.ShiftReader.read(pixels, DATA.reader ?? {}, { today: now }); }
    catch (e) { failure = e.reader ? e.message : 'この画像からシフト表を見つけられませんでした。'; }
    if (!alive()) return;
    if (read) await showReadMap(read);
    if (!alive()) return;
    setStep(2);
    // 見本と照合できなかった氏名は、端末の中の文字認識で読んでみる（読めた名前も確認画面で確かめてもらう）。
    if (read && read.columns.some(c => !c.person)) { await window.NameOCR?.fill(pixels, read).catch(() => 0); if (!alive()) return; }
    const plan = read ? draftFromRead(read) : { draft: { month: '', names: [], cells: {} }, issues: [failure], hints: null, warnings: [] };
    if (!plan.issues.length) {
      const payload = csvOfDraft(plan.draft), prepared = await api('/api/prepare', { files: payload }); if (!alive()) return;
      if (prepared.issues.length) plan.issues.push(...prepared.issues);
      else if (prepared.newPeople.length) plan.issues.push(...prepared.newPeople.map(p => `新しい氏名「${p.name}」`));
      else {
        // 登録済みの月を書き換えるときだけは、これまでどおり上書きの確認をとる。
        if (prepared.existingMonths.length && prepared.changes.length) {
          if (job.minimized) expandImporter();
          job.confirming = true; const yes = await confirmOverwrite(prepared.existingMonths); job.confirming = false;
          if (!alive()) return;
          if (!yes) { await saveImageDraft(item, plan.draft); outcomes.push({ file, item, state: 'declined', month: read.month }); continue; }
        }
        setStep(3);
        const result = await api('/api/commit', { files: payload, revision: prepared.revision, imageIds: [item.id] }); if (!alive()) return;
        acceptData(result.data); importResultKey = prepared.months[0];
        learnFromRead(read, plan.draft);
        outcomes.push({ file, item, state: 'auto', month: read.month, changes: result.plan.changes.length, same: result.plan.same, warnings: plan.warnings, read });
        continue;
      }
    }
    // 読めない所があった：読めた分を下書きに入れておき、確認の画面で続ける。
    await saveImageDraft(item, plan.draft); if (!alive()) return;
    if (plan.hints && pixels) plan.hints.crops = await cropCells(pixels, read, plan.hints).catch(() => ({}));
    readCache.set(item.id, { read, hints: plan.hints, issues: plan.issues });
    outcomes.push({ file, item, state: 'review', month: read?.month, issues: plan.issues, read, warnings: plan.warnings });
  }
  const auto = outcomes.filter(o => o.state === 'auto'), review = outcomes.filter(o => o.state === 'review');
  const cellsOf = o => o.read ? `${o.read.columns.reduce((n, c) => n + c.cells.filter(x => x.code).length, 0)} / ${o.read.columns.length * o.read.days}マス` : '';
  const notes = outcomes.map(o => `${esc(o.file.name)}：${{
    auto: () => `${fmtMonth(o.month)}を自動で反映しました（${cellsOf(o)}を読み取り · ${o.changes}件反映）`,
    already: () => '反映済みの画像です',
    declined: () => `${fmtMonth(o.month)}は上書きしませんでした（下書きに保存）`,
    review: () => `${o.month ? fmtMonth(o.month) + ' · ' : ''}${cellsOf(o)}を読み取り · 確認が必要：${o.issues.map(esc).join('、')}`
  }[o.state]()}`).concat(outcomes.flatMap(o => o.warnings ?? []).map(esc));
  if (review.length) {
    const first = review[0];
    finishJob({ mark: 'info', head: '画像を読み取りました', title: auto.length ? `${auto.length}枚は反映、${review.length}枚は確認が必要です` : '一部だけ確認が必要です',
      text: '読めた所は下書きに入れてあります。確認が必要な所だけ、画像を見ながら直して保存してください。', notes,
      actions: [['確認して登録する', 'primary', () => openImageEditor(first.item)], ['あとで（登録履歴に残します）', 'ghost', () => closeImporter(), true]] });
  } else if (auto.length) {
    finishJob({ head: '画像を読み取りました', title: 'カレンダーに反映しました', text: auto.map(o => fmtMonth(o.month)).join('・'),
      stats: [[auto.reduce((n, o) => n + o.changes, 0), '反映'], [auto.reduce((n, o) => n + o.same, 0), '変更なし']],
      notes: [...notes, 'この端末に保存しました。ほかの端末には送られません。'],
      actions: [['カレンダーで見る', 'primary', () => closeImporter(true)], closeAction()] });
  } else {
    finishJob({ mark: 'info', head: '画像を確認しました', title: '新しく反映する画像はありません', text: '', notes, actions: [['登録履歴を見る', 'secondary', openHistory], closeAction()] });
  }
}

// The dialog owns the final decision; dismissal never starts a save.
const overwriteModal = $('.overwrite-modal');
let overwriteDecision = null, overwriteClosing = false;
function confirmOverwrite(months) {
  return new Promise(resolve => {
    overwriteDecision = resolve; overwriteClosing = false;
    overwriteModal.classList.remove('is-closing');
    overwriteModal.querySelectorAll('button').forEach(b => { b.disabled = false; });
    $('.overwrite-months').innerHTML = months.map(key => `<span>${esc(fmtMonth(key))}</span>`).join('');
    overwriteModal.showModal();
    $('.overwrite-no').focus({ preventScroll: true });
    if (reduced()) return;
    overwriteModal.animate([{ opacity: 0, transform: 'translateY(22px) scale(.96)' }, { opacity: 1, transform: 'none' }],
      { duration: 380, easing: 'cubic-bezier(.22,1,.36,1)' });
    $('.overwrite-emblem').animate([{ transform: 'rotate(-24deg) scale(.75)' }, { transform: 'none' }],
      { duration: 520, easing: 'cubic-bezier(.34,1.3,.64,1)' });
    overwriteModal.querySelectorAll('h2,.overwrite-months,.overwrite-description,.overwrite-buttons').forEach((el, i) => {
      el.animate([{ opacity: 0, transform: 'translateY(7px)' }, { opacity: 1, transform: 'none' }],
        { duration: 300, delay: 60 + i * 35, easing: EASE, fill: 'backwards' });
    });
  });
}
async function dismissOverwrite(confirmed = false) {
  if (!overwriteDecision || overwriteClosing) return;
  overwriteClosing = true;
  overwriteModal.querySelectorAll('button').forEach(b => { b.disabled = true; });
  overwriteModal.classList.add('is-closing');
  if (!reduced()) await overwriteModal.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(10px) scale(.98)' }],
    { duration: 180, easing: 'cubic-bezier(.4,0,1,1)' }).finished.catch(() => {});
  overwriteModal.close();
  const resolve = overwriteDecision; overwriteDecision = null; overwriteClosing = false;
  resolve(confirmed);
}
$('.overwrite-no').addEventListener('click', () => dismissOverwrite(false));
$('.overwrite-close').addEventListener('click', () => dismissOverwrite(false));
$('.overwrite-yes').addEventListener('click', () => dismissOverwrite(true));
overwriteModal.addEventListener('cancel', e => { e.preventDefault(); dismissOverwrite(false); });
// Keep Escape/Tab inside this native modal instead of the importer underneath it.
overwriteModal.addEventListener('keydown', e => { e.stopPropagation(); });

async function savePending() {
  if (!job?.pending || job.saving || job.confirming) return;
  const { payload, plan } = job.pending, run = importRun;
  const pendingJob = job;
  const existingMonths = plan.existingMonths;
  if (!Array.isArray(existingMonths)) {
    importFailure(new Error('確認情報を読み直す必要があります。画面を再読み込みして、ファイルを選び直してください。'), 'csv');
    return;
  }
  if (existingMonths.length) {
    job.confirming = true;
    const confirmed = await confirmOverwrite(existingMonths);
    pendingJob.confirming = false;
    if (job !== pendingJob || run !== importRun || !confirmed) return;
  }
  job.saving = true; job.review = false;
  $('.imp-result').hidden = true; $('.imp-steps').hidden = false; $('.imp-progress').hidden = false; $('.imp-min').hidden = false;
  $('#imp-title').textContent = 'シフトを保存中'; setStep(3); processingActions(false);
  try {
    const result = await api('/api/commit', { files: payload, revision: plan.revision, imageIds: job.pending.imageIds, draftVersions: job.pending.draftVersions });
    if (run !== importRun) return;
    acceptData(result.data); importResultKey = plan.months[0]; setStep(4);
    // 画像から読み取った下書きを確認して保存したときは、直した所も含めて見本に学ばせる。
    const entry = pendingJob.entry, cached = entry && readCache.get(entry.item.id);
    if (cached?.read) { learnFromRead(cached.read, entry.snapshot()); readCache.delete(entry.item.id); }
    finishJob({ head: '保存が完了しました', title: result.unchanged ? 'すでに反映済みです' : 'シフトを登録しました', text: plan.months.map(fmtMonth).join('・'),
      stats: [[result.plan.changes.length, '反映'], [result.plan.same, '変更なし']], notes: ['この端末に保存しました。ほかの端末には送られません。'],
      actions: [['カレンダーで見る', 'primary', () => closeImporter(true)], closeAction()] });
  } catch (err) { if (run === importRun) importFailure(err, 'csv'); }
}
async function openHistory() {
  const run = ++importRun;
  hidePill(); closeRegMenu();
  job = { kind: 'history', files: [{ name: '保存済みの内容', size: 0 }], index: 0, minimized: false, done: false };
  openImporter('history', job.files);
  $('.imp-preview').hidden = true;
  renderSteps(['保存内容を読み込み']); setStep(0);
  try {
    const result = await api('/api/history');
    if (run !== importRun) return;
    job.inbox = result.inbox;
    const notes = [ ...result.inbox.slice().reverse().map(r => `<button type="button" class="history-image" data-image="${r.id}" aria-label="${esc(r.name)}を開く"><img src="${LocalShift.imageSrc(r.id)}" alt=""><span>${esc(r.name)}<br><b>${r.status === 'complete' ? '反映済み' : r.draftVersion ? '入力途中・タップで再開' : '未入力・タップで入力'}</b></span></button>`),
      ...result.history.slice().reverse().map(r => `${new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo' }).format(new Date(r.at))} · ${r.files.map(f => esc(f.file)).join('・')}<br>${r.kind === 'edit' && r.edit
        ? `${parseKey(r.months[0])[1]}月${r.edit.day}日 ${esc(r.edit.name)}さん ${esc(codeName(r.edit.before))} → ${esc(codeName(r.edit.after))}`
        : `${r.months.map(fmtMonth).join('・')} · ${r.changes}件反映`}`) ];
    finishJob({ mark: 'info', head: '登録履歴', title: notes.length ? '保存した内容' : '追加の登録はまだありません',
      text: '保存した画像をタップすると、入力の再開や反映済みの画像を確認できます。', notes, actions: [closeAction()] });
  } catch (err) { if (run === importRun) finishJob({ mark: 'warn', head: '登録履歴', title: '履歴を開けませんでした', text: esc(err.message), actions: [['再試行', 'primary', openHistory], closeAction()] }); }
}
$('.imp-result').addEventListener('click', e => {
  const id = e.target.closest('[data-image]')?.dataset.image;
  const item = job?.inbox?.find(i => i.id === id);
  if (!item) return;
  if (item.status !== 'complete') { openImageEditor(item); return; }
  showResult({ mark: 'info', head: '保存した画像', title: esc(item.name), text: 'シフトへ反映済み',
    notes: [`<img class="history-full" src="${LocalShift.imageSrc(item.id)}" alt="${esc(item.name)}">`], actions: [['履歴に戻る', 'primary', openHistory], closeAction()] });
});

// Images can be entered, reviewed and committed without an agent or a local CSV file.
async function openImageEditor(item) {
  const run = ++importRun;
  hidePill();
  job = { kind: 'entry', files: [{ name:item.name, size:0 }], index:0, minimized:false, done:false, review:true };
  openImporter('entry', job.files);
  $('.imp-preview').hidden = true;
  renderSteps(['下書きを読み込み']); setStep(0);
  try {
    const saved = await api(`/api/image-draft?id=${item.id}`);
    if (run !== importRun) return;
    if (saved.status === 'complete') { await openHistory(); return; }
    job.entry = new window.ImageEntry($('.imp-editor'), item, saved, DATA.codes, api, () => openImageEditor(item), readCache.get(item.id)?.hints);
    showImageEditor();
    // 開く動きが落ち着いてから、確認が必要な最初の日へ寄せる。
    setTimeout(() => job?.entry?.focusNeed(reduced()), reduced() ? 0 : 520);
  } catch (e) { if (run === importRun) finishJob({mark:'warn',head:'画像から入力',title:'下書きを開けませんでした',text:esc(e.message),actions:[['履歴に戻る','primary',openHistory],closeAction()]}); }
}
function showImageEditor() {
  job.review = true; job.done = false; job.pending = null;
  $('.imp-result').hidden = true; $('.imp-preview').hidden = true; $('.imp-steps').hidden = true; $('.imp-progress').hidden = true;
  $('.imp-editor').hidden = false; $('.imp-min').hidden = false;
  $('#imp-title').textContent = '画像を見ながら入力';
  setActions([['登録内容を確認', 'primary', reviewImageEntry], ['下書き保存を再試行', 'secondary', async () => {
    const entry = job.entry;
    try { await entry.retry(); } catch (e) { entry.status(`未保存：${e.message}`); }
  }], ['下書きを保存して閉じる', 'ghost', closeImageEntry, true]]);
}
async function closeImageEntry() {
  const current = job, entry = job?.entry;
  try { await entry.flush(); if (job === current) closeImporter(); }
  catch (e) { if (job === current) { showImageEditor(); entry.status(`閉じずに入力を保持しています：${e.message}`); } }
}
async function reviewImageEntry() {
  if (!job?.entry || job.checking) return;
  const current = job, run = importRun, entry = job.entry;
  job.checking = true;
  // Freeze input while taking the versioned review snapshot.
  try {
    const payload = await entry.files();
    $('.imp-editor').inert = true;
    const plan = await api('/api/prepare', {files:payload});
    if (job !== current || run !== importRun) return;
    if (plan.issues.length) throw Error(plan.issues.join('\n'));
    job.pending = { payload, plan, imageIds:[entry.item.id], draftVersions:{[entry.item.id]:entry.version} };
    renderSteps(['画像から入力', '日付・氏名・記号を照合', '内容を確認', '保存']);
    showResult({mark:'info',head:'登録内容の確認',title:`${plan.changes.length}件を反映します`,
      text:`${plan.months.map(fmtMonth).join('・')}。元画像と全員の入力内容を確認してから保存してください。`,
      stats:[[plan.changes.length,'変更'],[plan.same,'変更なし']],
      notes:[...plan.newPeople.map(p=>`新しいメンバー：${esc(p.name)}（別名でないか確認してください）`),...plan.changes.map(w=>`${w.key}-${String(w.d).padStart(2,'0')} ${esc(w.name)}：${esc(w.before)} → ${esc(w.code)}`)],
      actions:[['この内容で保存','primary',savePending],['入力に戻る','secondary',showImageEditor],['下書きを保存して閉じる','ghost',closeImageEntry,true]]});
  } catch (e) { if (job === current) entry.status(e.message); }
  finally { current.checking=false; $('.imp-editor').inert=false; }
}
$('.image-viewer-close').addEventListener('click', () => $('.image-viewer').close());
$('.image-viewer').addEventListener('keydown', e => e.stopPropagation());
window.addEventListener('beforeunload', e => { if (job?.entry?.dirty) { e.preventDefault(); e.returnValue=''; } });


// ---- バックグラウンドで続ける（右下の進捗表示） ----
const RING = 2 * Math.PI * 15;
function updatePill() {
  if (!job) return;
  pill.querySelector('.fg').style.strokeDashoffset = String(RING * (1 - (job.done ? 1 : pctShown)));
  pill.querySelector('.pill-text small').textContent = job.done ? 'タップで結果を見る' : job.review ? 'タップで登録内容を見る' : `${Math.round(pctShown * 100)}%${job.files.length > 1 ? ` · ${job.files.length}件` : ''}`;
}
function showPill() {
  pill.classList.toggle('done', !!job?.done);
  pill.querySelector('.pill-text b').textContent = job?.done ? '結果を見る' : job?.review ? '確認待ち' : '保存中';
  updatePill();
  pill.hidden = false;
  if (!reduced()) pill.animate([{ opacity: 0, transform: 'translateY(16px) scale(.6)' }, { opacity: 1, transform: 'none' }], { duration: 420, delay: 160, easing: 'cubic-bezier(.34,1.56,.64,1)', fill: 'backwards' });
}
function hidePill() {
  if (pill.hidden) return;
  if (reduced()) { pill.hidden = true; return; }
  pill.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.7)' }], { duration: 160, easing: 'cubic-bezier(.4,0,1,1)' }).finished.then(() => { pill.hidden = true; }, () => {});
}
function pillDone() {
  pill.classList.add('done');
  pill.querySelector('.pill-text b').textContent = '結果を見る';
  updatePill();
  navigator.vibrate?.([12, 60, 12]);
  if (reduced()) return;
  pill.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.12)', offset: .4 }, { transform: 'none' }], { duration: 480, easing: EASE });
  pill.querySelector('.pill-check').animate([{ transform: 'scale(0) rotate(-30deg)' }, { transform: 'scale(1.2)', offset: .6 }, { transform: 'none' }], { duration: 460, easing: EASE });
  pill.querySelector('.pill-ring').animate([{ boxShadow: '0 0 0 0 rgb(201 166 231 / .6)' }, { boxShadow: '0 0 0 12px rgb(201 166 231 / 0)' }], { duration: 800, easing: 'ease-out' });
}
// 登録中の画面を右下へ縮めてしまう。作業はそのまま続く。
function minimizeImporter(fromY = 0) {
  if (!job || job.minimized || job.done) return;
  job.minimized = true;
  calendarView.inert = app.classList.contains('open') || app.classList.contains('drawer-open');
  showPill();
  const hide = () => { if (job?.minimized) { importer.hidden = true; importer.style.removeProperty('transform'); } };
  if (reduced()) hide();
  else importer.animate([{ transform: `translateY(${fromY}px)`, opacity: 1, borderRadius: '0px' }, { transform: 'scale(.1)', opacity: 0, borderRadius: '60px' }],
    { duration: 360, easing: 'cubic-bezier(.4,0,.2,1)' }).finished.then(hide, hide);
  regBtn.focus({ preventScroll: true });
}
function expandImporter() {
  if (!job || !job.minimized) return;
  if (app.classList.contains('open')) close();
  if (app.classList.contains('drawer-open')) closeDrawer();
  job.minimized = false;
  hidePill();
  importer.hidden = false; calendarView.inert = true;
  if (!reduced()) importer.animate([{ transform: 'scale(.1)', opacity: 0, borderRadius: '60px' }, { transform: 'none', opacity: 1, borderRadius: '0px' }], { duration: 420, easing: EASE });
  if (job.done && !job.resultShown) { showResult(job.result); job.resultShown = true; }
  else $('.imp-actions button')?.focus({ preventScroll: true });
}
let pillDrag = null, pillSuppress = false;
pill.addEventListener('click', () => { if (!pillSuppress) expandImporter(); });
// 右（画面の外）へ払うと、結果を見ずに完了できる。登録の途中はゴムのように戻るだけ。
pill.addEventListener('pointerdown', e => {
  if (e.button !== 0) return;
  pillDrag = { id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, locked: null, lastX: e.clientX, lastT: performance.now(), v: 0 };
});
pill.addEventListener('pointermove', e => {
  const s = pillDrag;
  if (!s || s.id !== e.pointerId) return;
  if (released(e)) { endPillDrag(e, true); return; }
  const dx = e.clientX - s.x, dy = e.clientY - s.y;
  if (s.locked == null && Math.hypot(dx, dy) > 6) {
    s.locked = Math.abs(dx) > Math.abs(dy) ? 'x' : 'n';
    if (s.locked === 'x') try { pill.setPointerCapture(e.pointerId); } catch {}
  }
  if (s.locked !== 'x') return;
  const t = performance.now();
  s.v = (e.clientX - s.lastX) / Math.max(1, t - s.lastT); s.lastX = e.clientX; s.lastT = t;
  const canDismiss = job?.done;
  s.dx = dx > 0 ? (canDismiss ? dx : dx * .2) : dx * .15;
  pill.style.transform = `translateX(${s.dx}px) rotate(${s.dx / 40}deg)`;
  pill.style.opacity = canDismiss ? String(Math.max(.2, 1 - Math.max(0, s.dx) / 160)) : '';
});
function endPillDrag(e, cancelled) {
  const s = pillDrag;
  if (!s || s.id !== e.pointerId) return;
  pillDrag = null;
  if (s.locked !== 'x') return;
  pillSuppress = true; setTimeout(() => { pillSuppress = false; }, 0);
  const v = performance.now() - s.lastT < 100 ? s.v : 0, from = pill.style.transform, fromOpacity = pill.style.opacity || '1';
  pill.style.removeProperty('transform'); pill.style.removeProperty('opacity');
  if (!cancelled && job?.done && (s.dx > 60 || (s.dx > 16 && v > .5))) dismissPill(from, fromOpacity);
  else if (!reduced()) pill.animate([{ transform: from, opacity: fromOpacity }, { transform: 'none', opacity: 1 }], { duration: 380, easing: 'cubic-bezier(.34,1.5,.64,1)' });
}
window.addEventListener('pointerup', e => endPillDrag(e, false));
window.addEventListener('pointercancel', e => endPillDrag(e, true));
// 結果を見ずに完了：右へ飛んで消え、登録作業の後片付けをする（データは反映済み）。
function dismissPill(from = 'none', fromOpacity = '1') {
  importRun++; job = null; stopLit();
  if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
  importer.hidden = true;
  const hide = () => { pill.hidden = true; };
  if (reduced()) { hide(); return; }
  pill.animate([{ transform: from, opacity: fromOpacity }, { transform: 'translateX(140%) rotate(8deg)', opacity: 0 }], { duration: 260, easing: 'cubic-bezier(.4,0,1,1)' }).finished.then(hide, hide);
}
$('.imp-min').addEventListener('click', () => minimizeImporter());
// 登録中は進捗表示へ戻し、履歴・結果は閉じる。スクロール途中では閉じない。
let impDrag = null;
function startImpDrag(e) {
  if (!job || job.minimized || importer.hidden || e.target.closest('button, input, select, textarea, a, .entry-source')) return;
  for (let el = e.target; el && importer.contains(el); el = el.parentElement) {
    if (el.scrollTop > 0) return;
  }
  impDrag = { id: e.pointerId, y: e.clientY, x: e.clientX, dy: 0, locked: null, lastY: e.clientY, lastT: performance.now(), v: 0 };
}
function moveImpDrag(e) {
  const s = impDrag;
  if (!s || s.id !== e.pointerId) return;
  const dy = e.clientY - s.y, dx = e.clientX - s.x;
  if (s.locked == null && Math.hypot(dx, dy) > 8) {
    s.locked = dy > 0 && dy > Math.abs(dx) ? 'y' : 'n';
    if (s.locked === 'y' && e.pointerId >= 0) try { importer.setPointerCapture(e.pointerId); } catch {}
  }
  if (s.locked !== 'y') return;
  e.preventDefault();
  const t = performance.now();
  s.v = (e.clientY - s.lastY) / Math.max(1, t - s.lastT); s.lastY = e.clientY; s.lastT = t;
  s.dy = Math.max(0, dy);
  // Follow the finger vertically without scaling around the progress pill's origin.
  importer.style.transform = `translateY(${s.dy}px)`;
}
importer.addEventListener('pointerdown', e => { if (e.pointerType !== 'touch' && e.button === 0) startImpDrag(e); });
importer.addEventListener('pointermove', e => {
  if (e.pointerType === 'touch') return;
  if (released(e)) endImpDrag(e, true); else moveImpDrag(e);
});
// Touch Events let native upward/list scrolling continue, while a downward pull
// from the top is owned by the dismiss gesture (pan-y would cancel Pointer Events).
const impTouchPoint = (e, t) => ({ pointerId: -1, target: e.target, clientX: t.clientX, clientY: t.clientY, preventDefault: () => e.preventDefault() });
importer.addEventListener('touchstart', e => {
  if (e.touches.length !== 1) { endImpDrag({ pointerId: -1 }, true); return; }
  startImpDrag(impTouchPoint(e, e.touches[0]));
}, { passive: true });
importer.addEventListener('touchmove', e => {
  if (e.touches.length === 1) moveImpDrag(impTouchPoint(e, e.touches[0]));
}, { passive: false });
importer.addEventListener('touchend', e => { if (!e.touches.length) endImpDrag({ pointerId: -1 }, false); });
importer.addEventListener('touchcancel', () => endImpDrag({ pointerId: -1 }, true));
function endImpDrag(e, cancelled) {
  const s = impDrag;
  if (!s || s.id !== e.pointerId) return;
  impDrag = null;
  if (s.locked !== 'y') return;
  const v = performance.now() - s.lastT < 100 ? s.v : 0, from = importer.style.transform;
  importer.style.removeProperty('transform');
  if (!cancelled && (s.dy > 110 || (s.dy > 30 && v > .6))) {
    if (job?.kind === 'history' || job?.done) {
      const remaining = Math.max(0, importer.clientHeight - s.dy);
      const duration = Math.max(240, Math.min(440, remaining / (Math.max(0, v) + 1.2)));
      closeImporter(false, from, duration);
    }
    else minimizeImporter(s.dy);
  }
  else if (!reduced()) importer.animate([{ transform: from }, { transform: 'none' }], { duration: 360, easing: 'cubic-bezier(.34,1.3,.64,1)' });
}
window.addEventListener('pointerup', e => endImpDrag(e, false));
window.addEventListener('pointercancel', e => endImpDrag(e, true));

// ---- CSV：実際に読み込み、日付＋人物で上書き（同じファイルは重複登録しない） ----
// 形式：1行目「2026-12,佐々木,鈴木,…」（先頭は対象月）、2行目以降「1,D,B,…」（先頭は日）。
//       先頭列を「2026-12-01」のような日付にした形式も可。Shift_JIS（Excelの既定）も読める。
function decodeText(buf) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
  catch { try { return new TextDecoder('shift_jis', { fatal: true }).decode(buf); } catch { throw new Error('CSVの文字コードを読み取れません。UTF-8かShift_JISで保存してください。'); } }
}

// =====================================================================
// メンバー一覧（右上のハンバーガーメニュー）：表示する人の切り替えとお気に入り
// =====================================================================
const drawer = $('.drawer'), drawerShade = $('.drawer-shade'), menuBtn = $('.menu-btn'), peopleEl = $('.people');
const STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3.6 2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"/></svg>';
let favorites = new Set();
try { favorites = new Set(JSON.parse(localStorage.getItem('shift-favorites') ?? '[]')); } catch {}
// 名前の下に、今日のシフト（なければ表示中の月の出勤日数）を小さく出す。
function personStatus(p) {
  const c = monthKeys.includes(today.key) ? cellOf(today.key, p.id, today.d) : null;
  if (c) return `今日 <em>${esc(c.label)}</em>`;
  const arr = parsed[state.view]?.[p.id], [, m] = parseKey(state.view);
  if (!arr) return `${m}月は未登録`;
  return `${m}月 出勤 ${arr.filter(code => DATA.codes[code]?.kind === 'work').length}日`;
}
const GRIP = '<span class="grip" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg></span>';
const PERSON = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.6"/><path d="M5 20c.8-3.6 3.6-5.6 7-5.6s6.2 2 7 5.6"/></svg>';
const ARROW = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
// 自分：この端末を使っている人。お気に入りや表示中の人が変わっても、変えない限り一番上に固定。
let meId = null;
try { meId = localStorage.getItem('shift-me'); } catch {}
if (!people.some(p => p.id === meId)) meId = null;
const visibleFavs = () => [...favorites].filter(id => id !== meId).map(id => people.find(p => p.id === id)).filter(Boolean);
function renderPeople() {
  openRow = null;   // 描き直すと開いていたスワイプは閉じた状態に戻る
  // 自分 → お気に入り（登録した順・並べ替えた順）→ それ以外（元の列順）。
  const me = people.find(p => p.id === meId), favs = visibleFavs();
  const rest = people.filter(p => !favorites.has(p.id) && p.id !== meId);
  const item = (p, i, section) => {
    const fav = favorites.has(p.id), isMe = section === 'me', inFav = section === 'fav';
    return `<li class="person${p === self ? ' current' : ''}${inFav ? ' is-fav' : ''}${isMe ? ' is-me' : ''}" data-id="${esc(p.id)}">`
      // 右へスワイプで現れる「自分」アクション。途中で止めればタップでも実行できる。
      + `<div class="swipe-bg"><button type="button" class="sa sa-me" tabindex="-1" aria-label="${esc(p.name)}さんを${isMe ? '自分から外す' : '自分に設定'}"><span class="sa-ic">${PERSON}</span><span class="sa-lb">${isMe ? '自分を外す' : '自分'}</span></button></div>`
      + `<div class="row"><button type="button" class="pick" aria-pressed="${p === self}"><span class="avatar" aria-hidden="true">${esc([...p.name][0])}<span class="check">${CHECK}</span>${inFav ? `<i class="rank">${i + 1}</i>` : ''}</span>`
      + `<span class="pn"><b>${esc(p.name)}${isMe ? '<span class="me-tag">自分</span>' : ''}</b><small>${personStatus(p)}</small></span></button>`
      + `<button type="button" class="fav" aria-pressed="${fav}" aria-label="${esc(p.name)}さんをお気に入り${fav ? 'から外す' : 'に登録'}">${STAR}${inFav ? GRIP : ''}</button></div></li>`;
  };
  peopleEl.innerHTML = `<li class="sec" data-sec="me">${PERSON}自分</li>`
    + (me ? item(me, 0, 'me') : `<li class="me-empty"><span class="hint">${ARROW}</span>名前を右へスワイプすると「自分」に登録できます</li>`)
    + (favs.length ? `<li class="sec" data-sec="fav">${STAR}お気に入り${favs.length > 1 ? '<small>長押しで並べ替え</small>' : ''}</li>${favs.map((p, i) => item(p, i, 'fav')).join('')}` : '')
    + `<li class="sec" data-sec="all">メンバー</li>${rest.map((p, i) => item(p, i, 'all')).join('')}`;
}
// 並びが変わる操作は、変わる前の位置から新しい位置へ各行を滑らせる。
function flipRender(mutate) {
  const key = li => li.dataset.id ?? li.dataset.sec ?? li.className;
  const before = new Map([...peopleEl.children].map(li => [key(li), li.getBoundingClientRect().top]));
  mutate();
  renderPeople();
  if (reduced()) return;
  [...peopleEl.children].forEach(li => {
    const top = before.get(key(li)), now = li.getBoundingClientRect().top;
    if (top == null) li.animate([{ opacity: 0, transform: 'scale(.96)' }, { opacity: 1, transform: 'none' }], { duration: 300, easing: EASE });
    else if (Math.abs(top - now) > .5) li.animate([{ transform: `translateY(${top - now}px)` }, { transform: 'none' }], { duration: 460, easing: EASE });
  });
}
function openDrawer() {
  if (app.classList.contains('drawer-open')) return;
  closeRegMenu();
  renderPeople();
  app.classList.add('drawer-open'); drawer.setAttribute('aria-hidden', 'false'); drawer.inert = false; calendarView.inert = true;
  menuBtn.setAttribute('aria-expanded', 'true');
  if (!reduced()) peopleEl.querySelectorAll('li').forEach((li, i) => li.animate([{ opacity: 0, transform: 'translateX(28px)' }, { opacity: 1, transform: 'none' }],
    { duration: 440, delay: 110 + Math.min(i, 14) * 26, easing: EASE, fill: 'backwards' }));
  // 表示中の人が見える位置へ一覧だけをスクロール（scrollIntoView は外側までずらしてカクつくので使わない）。
  const current = peopleEl.querySelector('.person.current');
  peopleEl.scrollTop = current && current.offsetTop + current.offsetHeight > peopleEl.clientHeight ? current.offsetTop - peopleEl.clientHeight / 2 : 0;
  (peopleEl.querySelector('.person.current .pick') ?? $('.drawer-close')).focus({ preventScroll: true });
}
function closeDrawer() {
  if (!app.classList.contains('drawer-open')) return;
  app.classList.remove('drawer-open', 'drawer-dragging'); drawer.setAttribute('aria-hidden', 'true'); drawer.inert = true; calendarView.inert = false;
  drawer.style.removeProperty('transform'); drawerShade.style.removeProperty('opacity');
  menuBtn.setAttribute('aria-expanded', 'false'); menuBtn.focus({ preventScroll: true });
}
menuBtn.addEventListener('click', openDrawer);
$('.drawer-close').addEventListener('click', closeDrawer);
drawerShade.addEventListener('click', closeDrawer);
drawer.inert = true;

// お気に入りを切り替えると、その人が上（または元の位置）へ滑って移動する。
function toggleFavorite(p) {
  flipRender(() => {
    if (favorites.has(p.id)) favorites.delete(p.id); else favorites.add(p.id);
    saveFavorites();
  });
  const row = peopleEl.querySelector(`.person[data-id="${CSS.escape(p.id)}"]`);
  row.querySelector('.fav').focus({ preventScroll: true });
  if (reduced()) return;
  const star = row.querySelector('.fav svg');
  if (favorites.has(p.id)) star.animate([{ transform: 'scale(.5) rotate(-35deg)' }, { transform: 'scale(1.4) rotate(10deg)', offset: .55 }, { transform: 'none' }], { duration: 560, easing: EASE });
  else star.animate([{ transform: 'scale(.75)' }, { transform: 'none' }], { duration: 260, easing: EASE });
}
// 自分を登録（または外す）。新しい自分の行は右から入って一番上に収まり、輪が広がって知らせる。
function setMe(id) {
  // 新しい端末では、仮の「自分」が本人の欄にいる。本人を選んだら、その人を本人にして仮の人を外す（データだけ。見た目はそのまま）。
  if (id && id !== 'me' && DATA.self === 'me') setTimeout(() => LocalShift.adoptSelf(id).then(next => { if (next) acceptData(next); }).catch(() => {}), reduced() ? 0 : 900);
  flipRender(() => {
    meId = id;
    try { if (id) localStorage.setItem('shift-me', id); else localStorage.removeItem('shift-me'); } catch {}
  });
  navigator.vibrate?.(id ? [10, 40, 16] : 8);
  if (reduced() || !id) return;
  const row = peopleEl.querySelector('.person.is-me');
  row.getAnimations().forEach(a => a.cancel());
  row.animate([{ opacity: 0, transform: 'translateX(60px) scale(.96)' }, { opacity: 1, transform: 'translateX(-4px) scale(1.02)', offset: .65 }, { opacity: 1, transform: 'none' }],
    { duration: 520, easing: EASE });
  row.querySelector('.avatar').animate([{ boxShadow: '0 0 0 2px var(--paper),0 0 0 3.5px var(--accent)' }, { boxShadow: '0 0 0 2px var(--paper),0 0 0 12px transparent' }],
    { duration: 700, delay: 380, easing: 'ease-out' });
  row.querySelector('.me-tag').animate([{ transform: 'scale(0)' }, { transform: 'scale(1.25)', offset: .6 }, { transform: 'none' }],
    { duration: 420, delay: 300, easing: EASE, fill: 'backwards' });
  peopleEl.querySelector('.sec[data-sec="me"]').animate([{ transform: 'scale(1)' }, { transform: 'scale(1.12)', offset: .4 }, { transform: 'none' }], { duration: 420, easing: EASE });
}
// 名前をタップ：チェックを移し、少し見せてから閉じて、カレンダーをその人のシフトに入れ替える。
function choosePerson(p) {
  if (p === self) { closeDrawer(); return; }
  self = p;
  try { localStorage.setItem('shift-focus', p.id); } catch {}
  peopleEl.querySelectorAll('.person').forEach(li => {
    const on = li.dataset.id === p.id;
    li.classList.toggle('current', on); li.querySelector('.pick').setAttribute('aria-pressed', String(on));
  });
  buildStrip();
  setTimeout(() => { closeDrawer(); swapCalendar(); }, reduced() ? 0 : 280);
}
function swapCalendar() {
  monthAnimations.forEach(a => a.cancel()); monthAnimations = [];
  cal.style.removeProperty('transform'); cal.style.removeProperty('opacity');
  renderMonth();
  if (!reduced()) enterCalendar(0);
}
let drawerDrag = null, drawerSuppress = false;
peopleEl.addEventListener('click', e => {
  if (drawerSuppress) return;
  const li = e.target.closest('.person');
  if (!li) return;
  const p = people.find(x => x.id === li.dataset.id);
  // 開いたままのアクションボタンをタップ → 行を閉じてから実行。開いている行のほかの場所をタップ → 閉じるだけ。
  if (e.target.closest('.sa') && li === openRow) { runRowAction(li); return; }
  if (openRow) { closeOpenRow(); return; }
  if (e.target.closest('.fav')) toggleFavorite(p);
  else if (e.target.closest('.pick')) choosePerson(p);
});
// ---- お気に入りの並べ替え：長押しで持ち上げ、上下に動かして離す ----
// 押している間は少し沈み、持ち上がると影と枠が付いて指に追従する。行き先には点線の枠が出て、
// 周りの行がよけて隙間を空け、各行の順位バッジが「離したらこの順番」を示す。
let reorder = null;
const saveFavorites = () => { try { localStorage.setItem('shift-favorites', JSON.stringify([...favorites])); } catch {} };
peopleEl.addEventListener('pointerdown', e => {
  if (e.button !== 0 || reorder) return;
  const li = e.target.closest('.person.is-fav');
  if (!li || e.target.closest('.fav') || peopleEl.querySelectorAll('.person.is-fav').length < 2) return;
  reorder = { li, id: li.dataset.id, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, lifted: false };
  reorder.pressTimer = setTimeout(() => li.classList.add('pressing'), 120);
  reorder.timer = setTimeout(liftRow, 450);
});
function liftRow() {
  const r = reorder;
  if (!r) return;
  clearTimeout(r.pressTimer);
  const rows = [...peopleEl.querySelectorAll('.person.is-fav')];
  r.rows = rows.map(li => ({ li, top: li.offsetTop, h: li.offsetHeight }));
  r.from = r.to = rows.indexOf(r.li);
  r.step = r.rows.length > 1 ? r.rows[1].top - r.rows[0].top : r.rows[0].h;
  r.lifted = true;
  try { peopleEl.setPointerCapture(r.pointerId); } catch {}
  peopleEl.classList.add('reordering');
  r.li.classList.remove('pressing'); r.li.classList.add('lifted');
  r.li.style.transform = 'scale(1.04)';
  r.ph = Object.assign(document.createElement('li'), { className: 'drop-slot', textContent: 'ここに移動' });
  r.ph.setAttribute('aria-hidden', 'true');
  r.ph.style.top = `${r.rows[r.from].top}px`; r.ph.style.height = `${r.rows[r.from].h}px`;
  peopleEl.appendChild(r.ph);
  navigator.vibrate?.(12);
  if (!reduced()) {
    r.li.animate([{ transform: 'scale(.97)' }, { transform: 'scale(1.06)', offset: .6 }, { transform: 'scale(1.04)' }], { duration: 320, easing: EASE });
    r.ph.animate([{ opacity: 0, transform: 'scale(.9)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: EASE });
  }
}
function updateRanks() {
  const r = reorder;
  r.rows.forEach((row, i) => {
    let at = i;
    if (i === r.from) at = r.to;
    else if (r.from < r.to && i > r.from && i <= r.to) at = i - 1;
    else if (r.from > r.to && i < r.from && i >= r.to) at = i + 1;
    const rank = row.li.querySelector('.rank');
    if (rank.textContent !== String(at + 1)) {
      rank.textContent = at + 1;
      if (!reduced()) rank.animate([{ transform: 'scale(1.5)' }, { transform: 'scale(1)' }], { duration: 300, easing: 'cubic-bezier(.34,1.56,.64,1)' });
    }
    if (i !== r.from) row.li.style.transform = at === i ? '' : `translateY(${(at - i) * r.step}px)`;
  });
  r.ph.style.top = `${r.rows[r.to].top}px`;
}
peopleEl.addEventListener('pointermove', e => {
  const r = reorder;
  if (!r || r.pointerId !== e.pointerId) return;
  if (released(e)) { endReorder(e, false); return; }
  if (!r.lifted) {
    // 長押しの前に指が動いたらスクロールとみなしてやめる。
    if (Math.hypot(e.clientX - r.startX, e.clientY - r.startY) > 8) cancelPress();
    return;
  }
  const base = r.rows[r.from].top;
  const dy = Math.max(r.rows[0].top - base - 12, Math.min(r.rows[r.rows.length - 1].top - base + 12, e.clientY - r.startY));
  r.li.style.transform = `translateY(${dy}px) scale(1.04)`;
  const to = Math.max(0, Math.min(r.rows.length - 1, Math.round((base + dy - r.rows[0].top) / r.step)));
  if (to !== r.to) {
    r.to = to; updateRanks();
    navigator.vibrate?.(6);
    if (!reduced()) r.ph.animate([{ transform: 'scale(.94)' }, { transform: 'none' }], { duration: 240, easing: EASE });
  }
});
function cancelPress() {
  const r = reorder;
  if (!r) return;
  clearTimeout(r.timer); clearTimeout(r.pressTimer);
  r.li.classList.remove('pressing');
  reorder = null;
}
function endReorder(e, cancelled) {
  const r = reorder;
  if (!r || r.pointerId !== e.pointerId) return;
  if (!r.lifted) { cancelPress(); return; }
  reorder = null;
  drawerSuppress = true; setTimeout(() => { drawerSuppress = false; }, 0);
  const to = cancelled ? r.from : r.to, finalY = r.rows[to].top - r.rows[r.from].top;
  const from = r.li.style.transform;
  if (cancelled) { r.to = r.from; r.rows.forEach(row => { if (row.li !== r.li) row.li.style.transform = ''; }); r.ph.style.top = `${r.rows[r.from].top}px`; }
  r.li.style.transform = `translateY(${finalY}px)`;
  const commit = () => {
    // 並べ替えたのは「自分」を除いたお気に入りの並び。自分がお気に入りでもあれば後ろに残しておく。
    const ids = visibleFavs().map(p => p.id), [moved] = ids.splice(r.from, 1);
    ids.splice(to, 0, moved);
    favorites = new Set([...ids, ...[...favorites].filter(id => !ids.includes(id))]); saveFavorites();
    peopleEl.classList.remove('reordering');
    renderPeople();
    const row = peopleEl.querySelector(`.person[data-id="${CSS.escape(r.id)}"]`);
    if (row && !reduced()) row.animate([{ boxShadow: '0 0 0 1.5px var(--accent)' }, { boxShadow: '0 0 0 0 transparent' }], { duration: 600, easing: 'ease-out' });
  };
  if (reduced()) { commit(); return; }
  // 置き場所へ吸い付くように収まり、点線の枠は縮んで消える。
  r.ph.animate([{ opacity: 1 }, { opacity: 0, transform: 'scale(.96)' }], { duration: 200, fill: 'forwards' });
  r.li.animate([{ transform: from }, { transform: `translateY(${finalY}px) scale(.99)`, offset: .7 }, { transform: `translateY(${finalY}px)` }],
    { duration: 300, easing: 'cubic-bezier(.34,1.3,.64,1)' }).finished.then(commit, commit);
}
window.addEventListener('pointerup', e => endReorder(e, false));
window.addEventListener('pointercancel', e => endReorder(e, true));
// 持ち上げ中は画面をスクロールさせず、長押しのメニューも出さない。
peopleEl.addEventListener('touchmove', e => { if (reorder?.lifted) e.preventDefault(); }, { passive: false });
peopleEl.addEventListener('contextmenu', e => { if (e.target.closest('.person.is-fav')) e.preventDefault(); });

// ---- 右へスワイプのアクション（iPhoneのメールと同じ3段階） ----
// ① 少し引いて離す → 元に戻る。
// ② ボタン1つ分（約60px）まで引いて離す → 左に「自分」ボタンが出たまま止まり、タップで実行できる。
// ③ 名前の丸アイコンの中心が、開始時刻の「00」付近に来たら離して実行。
const SA_OPEN = 60, SA_OPEN_AT = 32;
function rowActionThreshold(li) {
  const avatar = li.querySelector('.avatar').getBoundingClientRect();
  const time = li.querySelector('.pn small em');
  const text = time?.firstChild;
  const match = text?.textContent.match(/^\d{1,2}:(\d{2})/);
  if (match && text.nodeType === Node.TEXT_NODE) {
    const range = document.createRange();
    const start = match[0].length - 2;
    range.setStart(text, start); range.setEnd(text, start + 2);
    const minutes = range.getBoundingClientRect();
    return Math.max(SA_OPEN + 12, minutes.left + minutes.width / 2 - (avatar.left + avatar.width / 2));
  }
  // 休日の行も、勤務時刻のある行と同程度の距離で操作できる。
  return SA_OPEN + 24;
}
let swipeRow = null, openRow = null;
const rowOffset = li => li?._x ?? 0;
// 行の位置に合わせて、ボタンの幅・丸の大きさ・ラベルの濃さを描く。
function paintRow(li, x) {
  li._x = x;
  li.querySelector('.row').style.transform = x ? `translateX(${x}px)` : '';
  const k = Math.max(0, Math.min(1, x / SA_OPEN));
  li.querySelector('.sa-me').style.width = `${Math.max(0, x)}px`;
  li.querySelector('.sa-ic').style.transform = `scale(${.4 + .6 * k})`;
  li.querySelector('.sa-lb').style.opacity = String(k);
}
function settleRow(li, from, to, done) {
  if (reduced()) { paintRow(li, to); done?.(); return; }
  const t0 = performance.now(), dur = to > from ? 340 : 300;
  // 開くときは少しだけ行き過ぎて戻る、閉じるときはすっと収まる。
  const ease = to > from ? (k => 1 + 2.2 * (k - 1) ** 3 + 1.2 * (k - 1) ** 2) : (k => 1 - (1 - k) ** 3);
  const tick = t => {
    const k = Math.min(1, (t - t0) / dur);
    paintRow(li, from + (to - from) * ease(k));
    if (k < 1 && li.isConnected) requestAnimationFrame(tick); else { paintRow(li, to); done?.(); }
  };
  requestAnimationFrame(tick);
}
function openRowAt(li) {
  if (openRow && openRow !== li) closeOpenRow();
  openRow = li; li.classList.add('opened');
  li.querySelectorAll('.sa').forEach(b => { b.tabIndex = 0; });
}
function closeOpenRow() {
  const li = openRow;
  if (!li) return;
  openRow = null; li.classList.remove('opened');
  li.querySelectorAll('.sa').forEach(b => { b.tabIndex = -1; });
  settleRow(li, rowOffset(li), 0);
}
function runRowAction(li) {
  const id = li.dataset.id;
  const go = () => setMe(id === meId ? null : id);
  if (!reduced()) li.querySelector('.sa-ic').animate([{ scale: '1' }, { scale: '.85' }, { scale: '1.1' }, { scale: '1' }], { duration: 300, easing: EASE });
  openRow = null; li.classList.remove('opened');
  settleRow(li, rowOffset(li), 0, go);
}
peopleEl.addEventListener('pointerdown', e => {
  if (e.button !== 0 || e.target.closest('.sa')) return;
  const li = e.target.closest('.person');
  if (li) swipeRow = { li, id: li.dataset.id, pointerId: e.pointerId, x: e.clientX, y: e.clientY, origin: rowOffset(li), dx: rowOffset(li), locked: null, full: false, lastX: e.clientX, lastT: performance.now(), v: 0 };
});
peopleEl.addEventListener('pointermove', e => {
  const s = swipeRow;
  if (!s || s.pointerId !== e.pointerId) return;
  if (released(e)) { endRowSwipe(e, true); return; }
  if (reorder?.lifted) { swipeRow = null; return; }
  const dx = e.clientX - s.x, dy = e.clientY - s.y;
  if (s.locked == null && Math.hypot(dx, dy) > 8) {
    // 閉じている行は右へ、開いている行は左右どちらへも動かせる。
    s.locked = Math.abs(dx) > Math.abs(dy) * 1.2 && (dx > 0 || s.origin > 0) ? 'x' : 'n';
    if (s.locked === 'x') {
      cancelPress();
      if (openRow && openRow !== s.li) closeOpenRow();
      try { peopleEl.setPointerCapture(e.pointerId); } catch {}
      s.width = s.li.offsetWidth; s.FULL = rowActionThreshold(s.li);
      s.li.classList.add('swiping');
    }
  }
  if (s.locked !== 'x') return;
  const t = performance.now();
  s.v = (e.clientX - s.lastX) / Math.max(1, t - s.lastT); s.lastX = e.clientX; s.lastT = t;
  const raw = s.origin + dx;
  s.dx = raw < 0 ? raw * .1 : raw > s.width * .9 ? s.width * .9 + (raw - s.width * .9) * .2 : raw;
  const full = raw >= s.FULL;
  if (full !== s.full) {
    // 一発で実行できる位置に入った／出たとき：ボタンの伸び縮みをなめらかにし、振動で知らせる。
    s.full = full; s.li.classList.toggle('full', full);
    navigator.vibrate?.(full ? 12 : 6);
    if (full && !reduced()) s.li.querySelector('.sa-me .sa-ic').animate([{ scale: '1' }, { scale: '1.25' }, { scale: '1' }], { duration: 300, easing: EASE });
  }
  paintRow(s.li, s.dx);
});
function endRowSwipe(e, cancelled) {
  const s = swipeRow;
  if (!s || s.pointerId !== e.pointerId) return;
  swipeRow = null;
  if (s.locked !== 'x') return;
  drawerSuppress = true; setTimeout(() => { drawerSuppress = false; }, 0);
  s.li.classList.remove('swiping', 'full');
  const v = performance.now() - s.lastT < 100 ? s.v : 0, x = s.dx;
  if (!cancelled && s.full) { runRowAction(s.li); return; }
  // 右へ払う勢いがあれば開く、左へ払えば閉じる。どちらでもなければ位置で決める。
  const open = !cancelled && (v > .5 ? x > 24 : v < -.5 ? false : x >= SA_OPEN_AT);
  if (open) { openRowAt(s.li); settleRow(s.li, x, SA_OPEN); }
  else { if (openRow === s.li) { openRow = null; s.li.classList.remove('opened'); } settleRow(s.li, x, 0); }
}
window.addEventListener('pointerup', e => endRowSwipe(e, false));
window.addEventListener('pointercancel', e => endRowSwipe(e, true));

// 右へなぞると閉じる（指に追従し、少しだけなら元へ戻る）。名前の行の上では「自分」登録のスワイプを優先する。
drawer.addEventListener('pointerdown', e => {
  if (e.button !== 0 || !app.classList.contains('drawer-open') || e.target.closest('.person')) return;
  drawerDrag = { id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, locked: null, lastX: e.clientX, lastT: performance.now(), v: 0 };
});
drawer.addEventListener('pointermove', e => {
  const s = drawerDrag;
  if (!s || s.id !== e.pointerId) return;
  if (released(e)) { endDrawerDrag(e); return; }
  if (reorder?.lifted) { drawerDrag = null; return; }   // 並べ替え中は閉じる操作にしない
  const dx = e.clientX - s.x, dy = e.clientY - s.y;
  if (s.locked == null && Math.hypot(dx, dy) > 8) {
    s.locked = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    if (s.locked === 'x') { drawer.setPointerCapture(e.pointerId); app.classList.add('drawer-dragging'); }
  }
  if (s.locked !== 'x') return;
  const t = performance.now();
  s.v = (e.clientX - s.lastX) / Math.max(1, t - s.lastT); s.lastX = e.clientX; s.lastT = t;
  s.dx = dx > 0 ? dx : dx * .15;
  drawer.style.transform = `translateX(${s.dx}px)`;
  drawerShade.style.opacity = String(Math.max(0, 1 - s.dx / drawer.offsetWidth));
});
function endDrawerDrag(e) {
  const s = drawerDrag;
  if (!s || s.id !== e.pointerId) return;
  drawerDrag = null;
  if (s.locked !== 'x') return;
  drawerSuppress = true; setTimeout(() => { drawerSuppress = false; }, 0);
  app.classList.remove('drawer-dragging');
  const v = performance.now() - s.lastT < 100 ? s.v : 0;
  if (s.dx > drawer.offsetWidth * .3 || (s.dx > 20 && v > .5)) closeDrawer();
  else { drawer.style.removeProperty('transform'); drawerShade.style.removeProperty('opacity'); }
}
window.addEventListener('pointerup', endDrawerDrag);
window.addEventListener('pointercancel', endDrawerDrag);

document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (!importer.hidden) importActions.find(a => a[3])?.[2]();
  else if (app.classList.contains('drawer-open')) closeDrawer();
  else if (menuOpen()) closeRegMenu(true);
});

peopleEl.addEventListener('keydown', e => {
  const li = e.target.closest('.person');
  if (li && e.key === 'ArrowRight') { e.preventDefault(); openRowAt(li); settleRow(li, 0, SA_OPEN); li.querySelector('.sa').tabIndex = 0; li.querySelector('.sa').focus(); }
  else if (li && e.key === 'ArrowLeft') { e.preventDefault(); closeOpenRow(); li.querySelector('.pick').focus(); }
  if (li?.classList.contains('is-fav') && e.altKey && ['ArrowUp', 'ArrowDown'].includes(e.key)) {
    e.preventDefault(); const ids = [...favorites], i = ids.indexOf(li.dataset.id), j = i + (e.key === 'ArrowUp' ? -1 : 1);
    if (j >= 0 && j < ids.length) { [ids[i], ids[j]] = [ids[j], ids[i]]; flipRender(() => { favorites = new Set(ids); saveFavorites(); }); peopleEl.querySelector('[data-id="' + CSS.escape(li.dataset.id) + '"] .fav')?.focus(); }
  }
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Tab') return;
  const modal = !importer.hidden ? importer : app.classList.contains('drawer-open') ? drawer : null;
  if (!modal) return;
  const buttons = [...modal.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href]')].filter(el => el.tabIndex >= 0 && el.getClientRects().length);
  if (!buttons.length) return;
  const i = buttons.indexOf(document.activeElement);
  if (i === -1 || (e.shiftKey && i === 0) || (!e.shiftKey && i === buttons.length - 1)) { e.preventDefault(); buttons[e.shiftKey ? buttons.length - 1 : 0].focus(); }
});
// Reload a shared update when returning to the page; never replace a pending review.
async function refreshSavedData() {
  if (job && !job.done) return;
  try { const next = await api('/api/data'); if ((!job || job.done) && next.revision > DATA.revision) acceptData(next); } catch { /* Existing saved view stays usable. Saving reports connection failures. */ }
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) { refreshSavedData(); refreshToday(); } });
window.addEventListener('focus', refreshSavedData);
function refreshToday() {
  if (params.has('today')) return;
  const n = new Date(), key = monthKey(n.getFullYear(), n.getMonth() + 1), d = n.getDate();
  if (today.key !== key || today.d !== d) { Object.assign(today, { key, d }); renderMonth(); if (app.classList.contains('drawer-open')) renderPeople(); if (app.classList.contains('open')) renderSheet('refresh'); }
  else if (app.classList.contains('open')) { $('.nowline')?.remove(); $('.lanes').insertAdjacentHTML('beforeend', nowLine(state.view, state.selected)); }
}
setInterval(() => { if (!document.hidden) refreshToday(); }, 60000);

// ---- ホーム画面アプリ（PWA）----
// アプリの更新：新しい版を裏で受け取り、作業中でないときに画面へ戻ったら入れ替える。シフトは端末の保存先にあるので消えない。
let updated = false;
if ('serviceWorker' in navigator && isSecureContext) {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {});
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController) updated = true; });
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  if (updated && (!job || job.done) && !pendingEdits.length && importer.hidden && cellMenu.hidden) location.reload();
  else navigator.serviceWorker?.getRegistration().then(r => r?.update()).catch(() => {});
  LocalShift.tidy().then(r => { if (r.changed) refreshSavedData(); }).catch(() => {});
});
// 保存できない環境や、iPhone の Safari で開いているときの注意（いつものお知らせ表示を使う）。
if (LocalShift.warning) setTimeout(() => showToast({ text: LocalShift.warning, warn: true }), reduced() ? 0 : 900);

renderMonth();
if (!reduced()) enterCalendar(0);
})();
