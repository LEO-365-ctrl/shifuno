/* シフト表画像の読み取り。AI・外部APIは使わず、端末の中で罫線とマス目を探し、記号の見本と形を照らし合わせる。
   ・記号／曜日／氏名は、正しく登録できた画像から作った見本（templates）との一致度で判定する。
   ・一致度が低い・紛らわしいマスは推測せず未確認（null）として返す。
   ・数字の見本は、その画像自身の日付列（1日〜月末が上から順に並ぶ）から作り、下の「公休数」で検算する。 */
(() => {
'use strict';
const CODE = { h: 16, w: 32 }, DIGIT = { h: 16, w: 12 }, NAME = { h: 16, w: 72 };
const LIMIT = { code: .72, codeGap: .06, tie: .2, week: .6, name: .72, nameSpot: .6, nameGap: .04, digit: .6 };
const median = a => { const s = Float32Array.from(a).sort(); return s[s.length >> 1] ?? 0; };
const lumOf = (r, g, b) => .299 * r + .587 * g + .114 * b;

// ---- 見本の保存形式：0〜15に丸めた濃さを16進1文字ずつ ----
const encode = v => Array.from(v, x => Math.max(0, Math.min(15, Math.round(x * 15))).toString(16)).join('');
const decode = s => Float32Array.from(s, c => parseInt(c, 16) / 15);
function corr(a, b, n = a.length) {
  let sa = 0, sb = 0;
  for (let i = 0; i < n; i++) { sa += a[i]; sb += b[i]; }
  const ma = sa / n, mb = sb / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; num += x * y; da += x * x; db += y * y; }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

// ---- 罫線とマス目 ----
function analyze(img) {
  const { width: W, height: H, data } = img;
  const L = new Float32Array(W * H);
  for (let i = 0, p = 0; i < L.length; i++, p += 4) L[i] = lumOf(data[p], data[p + 1], data[p + 2]);
  // 上下の黒い余白（ステータスバーを含む）を除いた、明るい行が続く一番長い範囲が表。
  // 表の中の黒い太線（数px）は余白とみなさない。
  let top = 0, bottom = 0;
  for (let y = 0, run = -1, dark = 0; y <= H; y++) {
    let bright = 0;
    if (y < H) for (let x = 0; x < W; x += 2) bright += L[y * W + x] > 45;
    if (y < H && bright / (W / 2) > .5) { if (run < 0) run = y; dark = 0; }
    else if (run >= 0 && y < H && ++dark <= 4) continue;
    else if (run >= 0) { const end = y - dark; if (end - run > bottom - top) { top = run; bottom = end; } run = -1; dark = 0; }
  }
  if (bottom - top < 100) throw readError('シフト表の範囲が見つかりませんでした。');
  // 横線：上下2pxより暗い細い線が横幅の大半に続く行。
  const hScore = new Float32Array(H);
  for (let y = top + 2; y < bottom - 2; y++) {
    let c = 0;
    for (let x = 0; x < W; x++) c += (L[(y - 2) * W + x] + L[(y + 2) * W + x]) / 2 - L[y * W + x] > 14;
    hScore[y] = c / W;
  }
  const hLines = peaks(hScore, top, bottom, .6);
  const rows = spans(hLines, 8);
  // 縦線：文字のない「各行の上下の端」だけで調べる（同じ列に並ぶ文字の縦画を線と取り違えない）。
  const vScore = new Float32Array(W), bandYs = [];
  for (const [y0, y1] of rows) bandYs.push(y0 + 2, y0 + 3, y1 - 3, y1 - 2);
  for (let x = 2; x < W - 2; x++) {
    let c = 0;
    for (const y of bandYs) c += (L[y * W + x - 2] + L[y * W + x + 2]) / 2 - L[y * W + x] > 14;
    vScore[x] = c / bandYs.length;
  }
  const vLines = peaks(vScore, 2, W - 2, .5);
  const cols = spans(vLines, 10);
  if (rows.length < 30 || cols.length < 3) throw Object.assign(readError('罫線（マス目）を見つけられませんでした。'), { debug: { top, bottom, h: hLines.length, v: vLines.length, rows: rows.length, cols: cols.length, hMax: Math.max(...hScore), vMax: Math.max(...vScore) } });
  return { img, L, W, H, rows, cols, right: vLines[vLines.length - 1] };
}
function peaks(score, from, to, min) {
  const out = [];
  for (let i = from; i < to; i++) {
    if (score[i] < min) continue;
    const last = out[out.length - 1];
    if (last != null && i - last <= 3) { if (score[i] > score[last]) out[out.length - 1] = i; }
    else out.push(i);
  }
  return out;
}
const spans = (lines, min) => lines.slice(1).map((v, i) => [lines[i], v]).filter(([a, b]) => b - a >= min);
const readError = message => Object.assign(new Error(message), { reader: true });

// ---- マスの背景色と文字 ----
function rectOf(g, r, c, c2 = c) {
  const [y0, y1] = g.rows[r], x0 = g.cols[c][0], x1 = g.cols[c2][1];
  // 罫線のにじみを文字と取り違えないよう、四辺を少し内側へ寄せる。
  return { x0: x0 + 3, y0: y0 + 3, x1: x1 - 2, y1: y1 - 2 };
}
function background(g, rect) {
  const { data, width } = g.img, R = [], G = [], B = [];
  for (let y = rect.y0; y < rect.y1; y += 2) for (let x = rect.x0; x < rect.x1; x += 2) { const p = (y * width + x) * 4; R.push(data[p]); G.push(data[p + 1]); B.push(data[p + 2]); }
  return [median(R), median(G), median(B)];
}
function bgClass([r, g, b]) {
  const l = lumOf(r, g, b);
  if (g > r + 25 && g > b + 15 && l < 150) return 'green';
  if (r > 180 && g > 170 && b < 140) return 'yellow';
  if (Math.abs(r - g) < 14 && Math.abs(g - b) < 14 && l > 140 && l < 222) return 'gray';
  return 'light';
}
// 背景との色の差を濃さ（0〜1）にした文字のマップ。
function inkMap(g, rect, bg) {
  const { data, width } = g.img, w = rect.x1 - rect.x0, h = rect.y1 - rect.y0, m = new Float32Array(w * h);
  let sum = [0, 0, 0], n = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = ((rect.y0 + y) * width + rect.x0 + x) * 4, dr = data[p] - bg[0], dg = data[p + 1] - bg[1], db = data[p + 2] - bg[2];
    const v = Math.min(1, Math.max(0, (Math.sqrt(dr * dr + dg * dg + db * db) - 45) / 90));
    m[y * w + x] = v;
    if (v > .8) { sum[0] += data[p]; sum[1] += data[p + 1]; sum[2] += data[p + 2]; n++; }
  }
  // 端に残った太い罫線（横幅・縦幅の大半を覆う濃い帯）は文字ではないので消す。
  for (const y of [0, 1, 2, h - 3, h - 2, h - 1]) { if (y < 0 || y >= h) continue; let k = 0; for (let x = 0; x < w; x++) k += m[y * w + x] > .5; if (k > w * .6) for (let x = 0; x < w; x++) m[y * w + x] = 0; }
  for (const x of [0, 1, 2, w - 3, w - 2, w - 1]) { if (x < 0 || x >= w) continue; let k = 0; for (let y = 0; y < h; y++) k += m[y * w + x] > .5; if (k > h * .6) for (let y = 0; y < h; y++) m[y * w + x] = 0; }
  const [r, gg, b] = n ? sum.map(s => s / n) : [0, 0, 0];
  const color = !n ? 'none' : lumOf(r, gg, b) > 185 ? 'white' : r > 140 && r - gg > 60 ? 'red' : 'dark';
  return { m, w, h, color, n };
}
function bbox({ m, w, h }, x0 = 0, x1 = w) {
  let a = x1, b = -1, c = h, d = -1, n = 0;
  for (let y = 0; y < h; y++) for (let x = x0; x < x1; x++) if (m[y * w + x] > .5) { n++; if (x < a) a = x; if (x > b) b = x; if (y < c) c = y; if (y > d) d = y; }
  return n < 4 ? null : { x0: a, x1: b + 1, y0: c, y1: d + 1 };
}
// 文字の外接枠を、縦横比を保って決まった大きさの枠へ描き直す（拡大率の違う画像でも比べられる）。
function normalize(ink, box, size, align = 'center') {
  const bw = box.x1 - box.x0, bh = box.y1 - box.y0;
  let s = size.h / bh; if (align === 'center' && bw * s > size.w) s = size.w / bw;
  // stretch：数字は縦横それぞれを枠いっぱいに伸ばす（小さくにじんだ数字でも形の違いが出やすい）。
  const sxs = align === 'stretch' ? size.w / bw : s, sys = align === 'stretch' ? size.h / bh : s;
  const out = new Float32Array(size.h * size.w), ox = align === 'center' ? (size.w - bw * s) / 2 : 0, oy = align === 'stretch' ? 0 : (size.h - bh * s) / 2;
  for (let y = 0; y < size.h; y++) for (let x = 0; x < size.w; x++) {
    const sx = box.x0 + (x - ox + .5) / sxs - .5, sy = box.y0 + (y - oy + .5) / sys - .5;
    if (sx < box.x0 - .5 || sx > box.x1 - .5 || sy < box.y0 - .5 || sy > box.y1 - .5) continue;
    const ix = Math.floor(sx), iy = Math.floor(sy), fx = sx - ix, fy = sy - iy;
    const at = (xx, yy) => (xx < 0 || yy < 0 || xx >= ink.w || yy >= ink.h) ? 0 : ink.m[yy * ink.w + xx];
    out[y * size.w + x] = at(ix, iy) * (1 - fx) * (1 - fy) + at(ix + 1, iy) * fx * (1 - fy) + at(ix, iy + 1) * (1 - fx) * fy + at(ix + 1, iy + 1) * fx * fy;
  }
  return { v: out, width: Math.min(size.w, Math.round(bw * s)) };
}
function glyph(g, r, c, size = CODE, align, c2) {
  const rect = rectOf(g, r, c, c2), bg = background(g, rect), ink = inkMap(g, rect, bg), box = bbox(ink);
  return { bg: bgClass(bg), color: ink.color, ink, box, ...(box ? normalize(ink, box, size, align) : { v: null, width: 0 }) };
}
// 数字：縦の隙間で1文字ずつに分ける。
function pieces(ink) {
  const cols = [];
  for (let x = 0; x < ink.w; x++) { let s = 0; for (let y = 0; y < ink.h; y++) s += ink.m[y * ink.w + x] > .5; cols.push(s); }
  const out = [];
  for (let x = 0, start = -1; x <= ink.w; x++) {
    if (x < ink.w && cols[x] > 0) { if (start < 0) start = x; }
    else if (start >= 0) { const b = bbox(ink, start, x); if (b && b.y1 - b.y0 >= 4) out.push(b); start = -1; }
  }
  return out;
}
// 隣の数字とくっついて1つに見えるものは、横長なら一番薄い縦の位置で分ける。
function digitPieces(ink, want = 0) {
  const out = pieces(ink);
  for (let guard = 0; guard < 3; guard++) {
    const i = out.findIndex(b => (b.x1 - b.x0) > (b.y1 - b.y0) * (want > out.length ? .75 : 1.15));
    if (i < 0 || (want && out.length >= want)) break;
    const b = out[i], w = b.x1 - b.x0;
    let cut = -1, low = Infinity;
    for (let x = b.x0 + Math.floor(w * .3); x < b.x0 + Math.ceil(w * .7); x++) { let s = 0; for (let y = b.y0; y < b.y1; y++) s += ink.m[y * ink.w + x]; if (s < low) { low = s; cut = x; } }
    const left = bbox(ink, b.x0, cut), right = bbox(ink, cut + 1, b.x1);
    if (!left || !right) break;
    out.splice(i, 1, left, right);
  }
  return out;
}
// 「1」だけは細長いので幅で見分け、ほかの数字は枠いっぱいに伸ばして形で比べる。
const digitVecs = (ink, boxes) => boxes.map(b => (b.x1 - b.x0) / (b.y1 - b.y0) < .55 ? null : normalize(ink, b, DIGIT, 'stretch').v);
function bestDigit(v, digits) {
  if (v == null) return { key: digits.some(d => d.key === '1') ? '1' : null, s: 1, gap: 1 };
  return best(v, digits, d => d.key !== '1');
}

// ---- 表の構造：灰色の氏名行・日付の行・集計の行 ----
function structure(g) {
  const gray = g.rows.map((_, r) => g.cols.map((_, c) => bgClass(background(g, rectOf(g, r, c))) === 'gray'));
  const grayShare = gray.map(row => row.slice(2).filter(Boolean).length / Math.max(1, row.length - 2));
  const nameRow = grayShare.findIndex(s => s >= .6);
  if (nameRow < 0) throw readError('氏名の行（灰色の行）が見つかりませんでした。');
  let footRow = -1;
  for (let r = nameRow + 1; r < g.rows.length; r++) if (grayShare[r] >= .6) { footRow = r; break; }
  if (footRow < 0) throw readError('下の集計の行が見つかりませんでした。');
  const people = g.cols.map((_, c) => c).filter(c => gray[nameRow][c]);
  const first = people[0];
  if (first < 2) throw readError('日付と曜日の列が見つかりませんでした。');
  const dateCol = first - 2, weekCol = first - 1;
  const dayRows = [];
  for (let r = nameRow + 1; r < footRow; r++) if (glyph(g, r, dateCol, DIGIT).box) dayRows.push(r);
  if (dayRows.length < 28 || dayRows.length > 31) throw readError(`日付の行が${dayRows.length}行でした（28〜31行のはず）。`);
  // 右端で切れた列：最後の縦線より右に、灰色の氏名欄か文字が残っていないか。
  let cut = false;
  if (g.W - g.right > 8) {
    const fake = { ...g, cols: [[g.right, g.W - 1]] };
    cut = dayRows.some(r => glyph(fake, r, 0).box) || bgClass(background(fake, rectOf(fake, nameRow, 0))) === 'gray';
  }
  return { nameRow, footRow, people, dateCol, weekCol, dayRows, cut };
}

// ---- 読み取り ----
function prepareTemplates(t) {
  const each = obj => Object.entries(obj ?? {}).map(([k, x]) => ({ key: k, bg: x.bg, color: x.color, v: decode(x.v), width: x.width }));
  return { codes: each(t.codes), weeks: each(t.weeks), names: each(t.names) };
}
function best(vec, list, filter = () => true, n) {
  const scored = list.filter(filter).map(t => ({ key: t.key, s: corr(vec, t.v, n) })).sort((a, b) => b.s - a.s);
  return { key: scored[0]?.key ?? null, s: scored[0]?.s ?? 0, gap: (scored[0]?.s ?? 0) - (scored[1]?.s ?? -1) };
}
// 記号は記号ごとの一番近い見本で比べる。似た2つ（BとDなど）で差が小さいときは、2つの見本で形が違う部分だけを見比べ直す。
function decideCode(vec, list) {
  const byCode = new Map();
  for (const t of list) { const code = t.key.split('#')[0], s = corr(vec, t.v); if (!byCode.has(code) || byCode.get(code).s < s) byCode.set(code, { code, s, t }); }
  const [a, b] = [...byCode.values()].sort((x, y) => y.s - x.s);
  if (!a) return { code: null, s: 0, gap: 0, ok: false };
  if (!b) return { code: a.code, s: a.s, gap: 1, ok: a.s >= LIMIT.code };
  const gap = a.s - b.s;
  if (gap >= LIMIT.codeGap) return { code: a.code, s: a.s, gap, ok: a.s >= LIMIT.code };
  const idx = [];
  for (let i = 0; i < vec.length; i++) if (Math.abs(a.t.v[i] - b.t.v[i]) > .25) idx.push(i);
  if (idx.length < 6) return { code: a.code, s: a.s, gap, ok: false };
  const pick = v => Float32Array.from(idx, i => v[i]), x = pick(vec), sa = corr(x, pick(a.t.v)), sb = corr(x, pick(b.t.v));
  const win = sa >= sb ? a : b, diff = Math.abs(sa - sb);
  return { code: win.code, s: win.s, gap, diff, ok: win.s >= LIMIT.code && diff >= LIMIT.tie };
}
// 氏名は漢字の部分だけを比べる（月ごとに変わる末尾の「F」「21」などに左右されない）。
function nameScore(cand, t) {
  if (!cand.v || cand.width < t.width * .8) return 0;
  const w = t.width, a = new Float32Array(NAME.h * w), b = new Float32Array(NAME.h * w);
  for (let y = 0; y < NAME.h; y++) for (let x = 0; x < w; x++) { a[y * w + x] = cand.v[y * NAME.w + x]; b[y * w + x] = t.v[y * NAME.w + x]; }
  return corr(a, b);
}
function read(img, templates, { today = new Date() } = {}) {
  const T = prepareTemplates(templates), g = analyze(img), s = structure(g), N = s.dayRows.length;
  // 数字の見本をこの画像の日付列から作る。
  const digitSamples = Array.from({ length: 10 }, () => []);
  s.dayRows.forEach((r, i) => {
    const gl = glyph(g, r, s.dateCol, DIGIT), ds = String(i + 1).split('').map(Number);
    const boxes = digitPieces(gl.ink, ds.length);
    if (boxes.length === ds.length) digitVecs(gl.ink, boxes).forEach((v, k) => { if (v || ds[k] === 1) digitSamples[ds[k]].push(v ?? new Float32Array(DIGIT.h * DIGIT.w)); });
  });
  const digits = digitSamples.map((list, d) => list.length ? { key: String(d), v: mean(list) } : null).filter(Boolean);
  // 集計の数字は、記号から数えた数（expected）の形と比べる。ほかの数の方がはっきり近ければ「合わない」、どちらとも言えなければ「読めない」。
  const verify = (r, c, expected) => {
    const rect = rectOf(g, r, c), ink = inkMap(g, rect, background(g, rect)), want = String(expected), boxes = digitPieces(ink, want.length);
    if (!boxes.length || boxes.length > 2) return { state: 'unread' };
    const vecs = digitVecs(ink, boxes), free = vecs.map(v => bestDigit(v, digits));
    const read = free.every(x => x.s >= LIMIT.digit) ? Number(free.map(x => x.key).join('')) : null;
    if (boxes.length !== want.length) return { state: read == null ? 'unread' : 'mismatch', read };
    const fit = vecs.map((v, i) => v == null ? (want[i] === '1' ? 1 : 0) : want[i] === '1' ? 0 : corr(v, digits.find(d => d.key === want[i])?.v ?? v));
    const ok = fit.every((s, i) => s >= LIMIT.digit && s >= free[i].s - .03);
    return { state: ok ? 'ok' : read != null && read !== expected && free.every((x, i) => x.s - fit[i] > .08) ? 'mismatch' : 'unread', read };
  };
  // 曜日：上から順に並ぶ曜日のずれ方で、1日の曜日を多数決で決める。
  const votes = Array(7).fill(0);
  s.dayRows.forEach((r, i) => {
    const gl = glyph(g, r, s.weekCol); if (!gl.v) return;
    const m = best(gl.v, T.weeks); if (m.s >= LIMIT.week) votes[(Number(m.key) - i % 7 + 7) % 7]++;
  });
  const firstDow = votes.indexOf(Math.max(...votes)), weekOk = votes[firstDow] >= N * .6;
  // 左上の「10月」の数字。
  let monthDigit = null;
  {
    const rect = rectOf(g, s.nameRow, s.dateCol, s.weekCol), ink = inkMap(g, rect, background(g, rect)), boxes = pieces(ink);
    const lead = []; for (const b of boxes) { if (b.x1 - b.x0 > (b.y1 - b.y0) * .8) break; lead.push(b); }
    if (lead.length && lead.length <= 2) {
      const got = digitVecs(ink, lead).map(v => bestDigit(v, digits));
      if (got.every(x => x.s >= LIMIT.digit)) monthDigit = Number(got.map(x => x.key).join(''));
    }
  }
  const month = pickMonth(today, N, weekOk ? firstDow : null, monthDigit);
  // 氏名：灰色の氏名行と、下の集計の氏名行の2か所を見本と比べる。
  const used = new Map();
  const columns = s.people.map((c, k) => {
    const a = glyph(g, s.nameRow, c, NAME, 'left'), b = glyph(g, s.footRow, c, NAME, 'left');
    const scores = T.names.map(t => ({ key: t.key, s: (nameScore(a, t) + nameScore(b, t)) / 2 })).sort((x, y) => y.s - x.s);
    const top = scores[0], gap = top ? top.s - (scores[1]?.s ?? 0) : 0;
    const sameSpot = templates.order?.[k] === top?.key;
    const person = top && (top.s >= LIMIT.name && gap >= LIMIT.nameGap || sameSpot && top.s >= LIMIT.nameSpot && gap >= LIMIT.nameGap) ? top.key : null;
    const cells = s.dayRows.map(r => {
      const gl = glyph(g, r, c), [y0, y1] = g.rows[r], box = { x0: g.cols[c][0], y0, x1: g.cols[c][1], y1 };
      if (!gl.v) return { code: null, s: 0, empty: true, sample: null, box };
      const m = decideCode(gl.v, T.codes.filter(t => t.bg === gl.bg && t.color === gl.color));
      return { code: m.ok ? m.code : null, guess: m.code, s: m.s, gap: m.gap, diff: m.diff, box, sample: { bg: gl.bg, color: gl.color, v: encode(gl.v) } };
    });
    // nameBoxes：氏名のマス（上の氏名行・下の集計の氏名行）の位置。見本のない氏名を文字認識で読むときに使う。
    const col = { index: k, person, nameScore: top?.s ?? 0, nameSample: a.v ? { v: encode(a.v), width: a.width } : null, nameBoxes: [rectOf(g, s.nameRow, c), rectOf(g, s.footRow, c)], cells, column: c };
    if (person) { if (used.has(person)) { const other = used.get(person); if (other.nameScore < col.nameScore) other.person = null; else col.person = null; } used.set(person, col); }
    return col;
  });
  // 公休数（公休＋希休）と有休・特休数で検算する。読めた記号だけで数えて合わなければ、その人の列を確認対象にする。
  for (const col of columns) {
    const codes = col.cells.map(x => x.code ?? x.guess), off = codes.filter(x => x === '公休' || x === '希休').length, paid = codes.filter(x => x === '有休').length;
    const a = verify(s.footRow + 1, col.column, off), b = verify(s.footRow + 2, col.column, paid);
    col.summary = { off: a.read ?? null, paid: b.read ?? null, counted: { off, paid } };
    col.check = a.state === 'mismatch' || b.state === 'mismatch' ? 'mismatch' : a.state === 'ok' && b.state === 'ok' ? 'ok' : 'unread';
  }
  return { month, days: N, firstDow: weekOk ? firstDow : null, monthDigit, columns, cut: s.cut };
}
function mean(list) { const out = new Float32Array(list[0].length); for (const v of list) for (let i = 0; i < v.length; i++) out[i] += v[i] / list.length; return out; }
// 日数・1日の曜日・左上の月の数字のすべてに合う月を、今日に近い順で選ぶ。合う月がなければ推測しない。
function pickMonth(today, N, firstDow, digit) {
  const hits = [];
  for (let off = -6; off <= 12; off++) {
    const d = new Date(today.getFullYear(), today.getMonth() + off, 1), y = d.getFullYear(), m = d.getMonth() + 1;
    if (new Date(y, m, 0).getDate() !== N) continue;
    if (firstDow != null && d.getDay() !== firstDow) continue;
    if (digit != null && m !== digit) continue;
    if (firstDow == null && digit == null) continue;
    hits.push({ key: `${y}-${String(m).padStart(2, '0')}`, off });
  }
  hits.sort((a, b) => Math.abs(a.off) - Math.abs(b.off) || b.off - a.off);
  // 月の数字が読み違いで日数・曜日と合わないときは、数字を使わずに日数と曜日だけで選ぶ。
  if (!hits.length && digit != null && firstDow != null) return pickMonth(today, N, firstDow, null);
  return hits[0]?.key ?? null;
}

// ---- 見本づくり：正しく登録できた画像と、その正解から ----
function samples(img, truth) {
  const g = analyze(img), s = structure(g), out = { codes: {}, weeks: {}, names: {} };
  const add = (bucket, key, item) => (bucket[key] ??= []).push(item);
  s.dayRows.forEach((r, i) => {
    const gl = glyph(g, r, s.weekCol);
    if (gl.v && truth.firstDow != null) add(out.weeks, String((truth.firstDow + i) % 7), { v: gl.v });
  });
  s.people.forEach((c, k) => {
    const id = truth.columns[k]; if (!id) return;
    const codes = truth.shifts[id];
    s.dayRows.forEach((r, i) => { const gl = glyph(g, r, c); if (gl.v && codes?.[i] && codes[i] !== '?') add(out.codes, codes[i], { v: gl.v, bg: gl.bg, color: gl.color }); });
    const chars = truth.nameChars?.[k];
    for (const row of [s.nameRow, s.footRow]) {
      const gl = glyph(g, row, c, NAME, 'left');
      if (gl.v && chars) add(out.names, id, { v: gl.v, width: Math.min(gl.width, Math.round(NAME.h * chars * 1.05)) });
    }
  });
  return out;
}
// 見本の束を平均して1つの見本にする（背景色・文字色の組ごとに分ける）。
function build(...sets) {
  const out = { codes: {}, weeks: {}, names: {} };
  const merged = { codes: {}, weeks: {}, names: {} };
  for (const set of sets) for (const kind of Object.keys(merged)) for (const [k, list] of Object.entries(set[kind] ?? {})) (merged[kind][k] ??= []).push(...list);
  for (const [code, list] of Object.entries(merged.codes)) {
    const groups = {};
    for (const x of list) (groups[`${x.bg}/${x.color}`] ??= []).push(x);
    for (const [gk, items] of Object.entries(groups)) {
      if (items.length < 2 && list.length > 2) continue;
      const [bg, color] = gk.split('/');
      // 書体の太さなどが違う見た目（1日の行など）は、別の見本として最大4つまで分けて持つ。
      const clusters = [];
      for (const x of items) {
        let near = null, top = -1;
        for (const c of clusters) { const s = corr(x.v, mean(c)); if (s > top) { top = s; near = c; } }
        if (near && (top >= .9 || clusters.length >= 4)) near.push(x.v); else clusters.push([x.v]);
      }
      clusters.filter(c => c.length >= 2 || clusters.length === 1).forEach((c, i) => { out.codes[`${code}#${gk}#${i}`] = { bg, color, n: c.length, v: encode(mean(c)) }; });
    }
  }
  for (const [k, list] of Object.entries(merged.weeks)) out.weeks[k] = { n: list.length, v: encode(mean(list.map(x => x.v))) };
  for (const [k, list] of Object.entries(merged.names)) out.names[k] = { n: list.length, width: Math.min(...list.map(x => x.width)), v: encode(mean(list.map(x => x.v))) };
  return out;
}

window.ShiftReader = { read, samples, build, encode, decode, sizes: { CODE, NAME, DIGIT }, LIMIT, _internal: { analyze, structure, background, rectOf, bgClass, glyph, digitPieces, inkMap, digitVecs, corr, pieces } };
})();
