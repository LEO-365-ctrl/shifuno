// シフトの保存と処理を、この端末（ブラウザー）の中だけで行う。外部へは何も送らない。
// ・CSVの解釈・取り込み計画（prepare）・読み取り見本の学習・画像の中身の確認は、以前のサーバー（store.cjs）と同じ処理。
// ・保存先は IndexedDB。シフトの登録・修正・下書きは、そのたびに自動で保存する。
// ・起動時に、期限の来た元画像と古い月のシフトを整理する（cleanup）。
(() => {
'use strict';
// 文字列の SHA-256（16進）。新しい人のIDや取り込んだ内容の見分けに使う（以前のサーバーと同じ値になる）。
function hash(text) {
  const K = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  const bytes = new TextEncoder().encode(text), len = bytes.length;
  const n = ((len + 9 + 63) >> 6) << 6, m = new Uint8Array(n);
  m.set(bytes); m[len] = 0x80;
  const dv = new DataView(m.buffer); dv.setUint32(n - 8, Math.floor(len / 0x20000000)); dv.setUint32(n - 4, (len << 3) >>> 0);
  const H = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19], W = new Array(64);
  const r = (x, k) => (x >>> k) | (x << (32 - k));
  for (let o = 0; o < n; o += 64) {
    for (let i = 0; i < 16; i++) W[i] = dv.getUint32(o + i * 4);
    for (let i = 16; i < 64; i++) { const s0 = r(W[i - 15], 7) ^ r(W[i - 15], 18) ^ (W[i - 15] >>> 3), s1 = r(W[i - 2], 17) ^ r(W[i - 2], 19) ^ (W[i - 2] >>> 10); W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0; }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (r(e, 6) ^ r(e, 11) ^ r(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + W[i]) | 0, t2 = ((r(a, 2) ^ r(a, 13) ^ r(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0; H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
  }
  return H.map(x => (x >>> 0).toString(16).padStart(8, '0')).join('');
}
const normal = s => s.normalize('NFKC').replace(/\s+/g, '');
function fail(message, status = 400) { throw Object.assign(new Error(message), { status }); }
function csvRows(text) {
  const rows = []; let row = [], value = '', quoted = false, ended = false;
  text = text.replace(/^\uFEFF/, '');
  const delim = text.split(/\r?\n/, 1)[0].includes('\t') ? '\t' : ',';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) { if (c === '"') { if (text[i + 1] === '"') { value += '"'; i++; } else { quoted = false; ended = true; } } else value += c; }
    else if (c === delim || c === '\n' || c === '\r') {
      row.push(value.trim()); value = ''; ended = false;
      if (c !== delim) { if (row.some(Boolean)) rows.push(row); row = []; if (c === '\r' && text[i + 1] === '\n') i++; }
    } else if (c === '"' && !value && !ended) quoted = true;
    else { if (ended && c.trim()) fail('CSVの引用符の後に区切り以外の文字があります。'); value += c; }
  }
  if (quoted) fail('CSVの引用符が閉じていません。');
  row.push(value.trim()); if (row.some(Boolean)) rows.push(row);
  return rows;
}
function prepare(data, files) {
  if (!Array.isArray(files) || !files.length || files.length > 12) fail('CSVは1回に1〜12件選んでください。');
  const issues = [], writes = new Map(), newPeople = new Map(), summaries = [];
  const names = new Map();
  for (const p of data.people) for (const a of new Set([p.name, ...p.aliases].map(normal))) {
    if (names.has(a) && names.get(a).id !== p.id) fail('登録済みの名前が重複しています。');
    names.set(a, p);
  }
  for (const file of files) {
    if (typeof file?.name !== 'string' || file.name.length > 200 || typeof file.text !== 'string' || new TextEncoder().encode(file.text).length > 1024 * 1024) fail('CSVは1件1MB以内にしてください。');
    try {
      const rows = csvRows(file.text);
      if (rows.length < 2) fail('対象月・氏名の見出しと日付の行が必要です。');
      const head = rows[0], ym = normal(head[0]).match(/^(\d{4})[-/.年](\d{1,2})月?$/);
      const labels = head.slice(1).map(normal);
      if (!labels.length || labels.length > 100 || labels.some(n => !n || n.length > 40 || /[<>\x00-\x1f]/.test(n))) fail('氏名の列が空欄か、使用できない氏名があります。');
      const ids = labels.map(name => {
        let p = names.get(name) || newPeople.get(name);
        if (!p) { p = { id: `p-${hash(name).slice(0, 20)}`, name, aliases: [name] }; newPeople.set(name, p); }
        return p.id;
      });
      if (new Set(ids).size !== ids.length) fail('同じ人の列が重複しています（山田・山田21も同じ人です）。');
      if (ym && (+ym[1] < 2000 || +ym[1] > 2100 || +ym[2] < 1 || +ym[2] > 12)) fail('見出しの年月が不正です。');
      const months = new Set();
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i], v = normal(row[0]);
        let match = v.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?$/);
        if (!match && ym) {
          const d = v.match(/^(\d{1,2})日?$/), md = v.match(/^(\d{1,2})[/月](\d{1,2})日?$/);
          if (d) match = ['', ym[1], ym[2], d[1]];
          else if (md) match = ['', ym[1], md[1], md[2]];
        }
        if (!match || +match[1] < 2000 || +match[1] > 2100 || +match[2] < 1 || +match[2] > 12 || +match[3] < 1 || +match[3] > new Date(+match[1], +match[2], 0).getDate()) { issues.push(`${file.name} ${i + 1}行目：日付「${v}」を確認してください。`); continue; }
        if (ym && (+ym[1] !== +match[1] || +ym[2] !== +match[2])) { issues.push(`${file.name} ${i + 1}行目：見出しと日付の月が異なります。`); continue; }
        if (row.length !== head.length) { issues.push(`${file.name} ${i + 1}行目：氏名と勤務記号の列数が一致しません。`); continue; }
        const key = `${match[1]}-${String(+match[2]).padStart(2, '0')}`, d = +match[3]; months.add(key);
        ids.forEach((id, j) => {
          let code = normal(row[j + 1]); if (!Object.hasOwn(data.codes, code)) code = code.toUpperCase();
          if (!Object.hasOwn(data.codes, code)) { issues.push(`${file.name} ${key}-${String(d).padStart(2, '0')} ${labels[j]}：${code ? `未定義の記号「${code}」` : '空欄'}。記号を確認してください。`); return; }
          const k = `${key}/${d}/${id}`, previous = writes.get(k);
          if (previous && previous.code !== code) { issues.push(`${key}-${d} ${labels[j]}：同じ日・人物に異なる記号があります。`); return; }
          const before = data.months[key]?.shifts[id]?.split(/\s+/)[d - 1] ?? '?';
          writes.set(k, { key, d, id, name: names.get(labels[j])?.name ?? labels[j], code, before });
        });
      }
      summaries.push({ file: file.name, hash: hash(file.text), months: [...months].sort() });
    } catch (e) { issues.push(`${file.name}：${e.message}`); }
  }
  if (!writes.size && !issues.length) issues.push('登録できる日付がありません。');
  const changes = [...writes.values()].filter(w => w.before !== w.code);
  const months = [...new Set([...writes.values()].map(w => w.key))].sort();
  // Detect existing months from the same stored revision used for the review,
  // not from a potentially stale calendar in the browser.
  const existingMonths = months.filter(key => Object.hasOwn(data.months, key));
  return { revision: data.revision ?? 0, issues, changes, same: writes.size - changes.length, newPeople: [...newPeople.values()], files: summaries, months, existingMonths };
}
// ---- 画像読み取りの見本（記号・氏名の形）。登録が済むたびに、確定した内容から少しずつ学ぶ ----
const HEX = /^[0-9a-f]+$/;
const hexVec = s => Array.from(s, c => parseInt(c, 16) / 15);
const vecHex = v => v.map(x => Math.max(0, Math.min(15, Math.round(x * 15))).toString(16)).join('');
function hexCorr(a, b) {
  const x = hexVec(a), y = hexVec(b), n = x.length; let sx = 0, sy = 0; for (let i = 0; i < n; i++) { sx += x[i]; sy += y[i]; }
  let num = 0, dx = 0, dy = 0; for (let i = 0; i < n; i++) { const p = x[i] - sx / n, q = y[i] - sy / n; num += p * q; dx += p * p; dy += q * q; }
  return dx && dy ? num / Math.sqrt(dx * dy) : 0;
}
// 平均に混ぜる（古い見本も残るよう、重みは最大30件分）。
function blend(t, v) { const n = Math.min(t.n ?? 1, 30), a = hexVec(t.v), b = hexVec(v); t.v = vecHex(a.map((x, i) => (x * n + b[i]) / (n + 1))); t.n = (t.n ?? 1) + 1; }
function learnReader(reader, input, codes, people) {
  const next = structuredClone(reader ?? { codes: {}, weeks: {}, names: {}, order: [] });
  for (const s of Array.isArray(input?.codes) ? input.codes.slice(0, 600) : []) {
    if (!Object.hasOwn(codes, s?.code) || !['light', 'yellow', 'green', 'gray'].includes(s.bg) || !['dark', 'red', 'white'].includes(s.color) || typeof s.v !== 'string' || s.v.length !== 512 || !HEX.test(s.v)) continue;
    const prefix = `${s.code}#${s.bg}/${s.color}#`, own = Object.keys(next.codes).filter(k => k.startsWith(prefix));
    let near = null, top = -1;
    for (const k of own) { const c = hexCorr(next.codes[k].v, s.v); if (c > top) { top = c; near = k; } }
    if (near && (top >= .9 || own.length >= 4)) blend(next.codes[near], s.v);
    else next.codes[prefix + own.length] = { bg: s.bg, color: s.color, n: 1, v: s.v };
  }
  for (const s of Array.isArray(input?.names) ? input.names.slice(0, 100) : []) {
    if (!people.some(p => p.id === s?.id) || typeof s.v !== 'string' || s.v.length !== 16 * 72 || !HEX.test(s.v) || !Number.isInteger(s.width) || s.width < 8 || s.width > 72) continue;
    const t = next.names[s.id];
    if (t) { blend(t, s.v); t.width = Math.min(t.width, s.width); } else next.names[s.id] = { n: 1, width: s.width, v: s.v };
  }
  if (Array.isArray(input?.order) && input.order.length <= 100 && input.order.every(id => id === null || people.some(p => p.id === id))) next.order = input.order;
  return next;
}
// 画像の中身が本当にその形式で、大きさが扱える範囲かを確かめる（拡張子や先頭だけで信用しない）。
function imageSize(bytes, ext) {
  if (ext === 'png') {
    if (bytes.length < 45 || bytes.toString('ascii', 12, 16) !== 'IHDR' || bytes.toString('ascii', bytes.length - 8, bytes.length - 4) !== 'IEND') return null;
    return { w: bytes.readUInt32BE(16), h: bytes.readUInt32BE(20) };
  }
  if (ext === 'jpg') {
    if (bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) return null;
    for (let i = 2; i + 9 < bytes.length;) {
      if (bytes[i] !== 0xff) return null;
      const m = bytes[i + 1], len = bytes.readUInt16BE(i + 2);
      if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { w: bytes.readUInt16BE(i + 7), h: bytes.readUInt16BE(i + 5) };
      i += 2 + len;
    }
    return null;
  }
  if (ext === 'webp') {
    if (bytes.readUInt32LE(4) + 8 !== bytes.length) return null;
    const kind = bytes.toString('ascii', 12, 16);
    if (kind === 'VP8 ') return { w: bytes.readUInt16LE(26) & 0x3fff, h: bytes.readUInt16LE(28) & 0x3fff };
    if (kind === 'VP8L') { const b = bytes.readUInt32LE(21); return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 }; }
    if (kind === 'VP8X') return { w: 1 + bytes.readUIntLE(24, 3), h: 1 + bytes.readUIntLE(27, 3) };
  }
  return null;
}
// ---- ここから下は、この端末の中だけで動く保存と整理（サーバーへは何も送らない）----
const HOUR = 3600e3, DAY = 24 * HOUR;
// 日本時間の「年-月」。
const jstMonthKey = (t = Date.now()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit' }).format(new Date(t)).slice(0, 7);
const monthDiff = (a, b) => { const [ay, am] = a.split('-').map(Number), [by, bm] = b.split('-').map(Number); return (by - ay) * 12 + (bm - am); };
const KEEP_MONTHS = 13;   // 終わった月から1年たったら（例：2026-10 は 2027-11 に）シフトも消す
function blankData(seed) {
  return { version: 1, self: 'me', codes: structuredClone(seed.codes), people: [{ id: 'me', name: '自分', aliases: [] }], months: {}, revision: 0, history: [], inbox: [], reader: structuredClone(seed.reader) };
}
// 終わった月の登録済みシフトは閲覧のみ。まだ登録していない過去の月を新しく入れることはできる。
function prepareLocal(data, files, current) {
  const plan = prepare(data, files);
  const past = [...new Set(plan.changes.filter(w => w.key < current && data.months[w.key]).map(w => w.key))];
  for (const key of past) plan.issues.push(`${Number(key.slice(5))}月は終わった月のため、登録済みのシフトは変更できません（閲覧のみ）。`);
  return plan;
}
// 期限の来たものを整理する。消す画像のIDと、整理後のデータを返す（純粋な計算。保存は呼び出し側）。
// ・元画像：登録が終わっていて、対象の月がすべて終わったもの。対象の月が分からない・登録が終わっていない画像は残す。
// ・シフト：終わった月から1年たった月（今の月との差が13か月以上）。今の月と未来の月は消さない。
function cleanup(data, current) {
  const next = structuredClone(data), drop = [];
  const expired = key => monthDiff(key, current) >= KEEP_MONTHS;
  let changed = false;
  for (const key of Object.keys(next.months)) if (expired(key)) { delete next.months[key]; changed = true; }
  next.inbox = (next.inbox ?? []).filter(item => {
    const months = Array.isArray(item.months) ? item.months.filter(k => /^\d{4}-\d{2}$/.test(k)) : [];
    const known = item.status === 'complete' && months.length > 0 && months.length === (item.months?.length ?? 0);
    if (known && months.every(expired)) { if (!item.imageDeleted) drop.push(item.id); changed = true; return false; }
    if (known && !item.imageDeleted && months.every(k => k < current)) { drop.push(item.id); item.imageDeleted = true; delete item.draft; changed = true; }
    return true;
  });
  const before = next.history?.length ?? 0;
  next.history = (next.history ?? []).filter(r => !(Array.isArray(r.months) && r.months.length && r.months.every(expired)));
  if (next.history.length !== before) changed = true;
  return { next, drop, changed };
}
// 端末の時計が明らかにおかしいときは消さない（大きく戻った・1年以上先へ飛んだ・サーバーの時刻と2日以上ずれた）。
function clockOk(now, meta) {
  if (meta.skew) return false;
  if (!meta.lastSeen) return true;
  return now >= meta.lastSeen - 2 * DAY && now <= meta.lastSeen + 400 * DAY;
}
async function sha256Hex(bytes) {
  if (globalThis.crypto?.subtle) return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
  // https でない試験環境用（重複の見分けにだけ使う）。
  let out = '';
  for (let seed = 0; seed < 8; seed++) { let h = 0x811c9dc5 ^ seed; for (const b of bytes) h = Math.imul(h ^ b, 16777619) >>> 0; out += h.toString(16).padStart(8, '0'); }
  return out;
}
const fromBase64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

// adapter：保存先（ブラウザーでは IndexedDB、試験ではメモリ）。get/put/del(store, key) と keys(store)。
function createLocal(adapter, { seed, now = () => Date.now() } = {}) {
  let data, meta;
  const urls = new Map();
  const current = () => jstMonthKey(now());
  const saveFailed = () => fail('この端末に保存できませんでした。空き容量を確認して、もう一度お試しください。', 507);
  const save = async next => {
    next.revision = (data.revision ?? 0) + 1;
    try { await adapter.put('kv', 'data', next); } catch { saveFailed(); }
    data = next;
  };
  const forgetUrl = id => { const u = urls.get(id); if (u) { URL.revokeObjectURL(u); urls.delete(id); } };
  const preload = async ids => {
    for (const id of ids) if (!urls.has(id)) { const rec = await adapter.get('images', id).catch(() => null); if (rec?.blob) urls.set(id, URL.createObjectURL(rec.blob)); }
  };
  const local = {
    // 起動時：保存済みのデータを読み、期限の来たものを整理する。
    async open() {
      data = await adapter.get('kv', 'data') ?? blankData(seed);
      meta = await adapter.get('kv', 'meta') ?? {};
      await local.tidy();
      return structuredClone(data);
    },
    async tidy() {
      const t = now();
      if (!clockOk(t, meta)) return { skipped: true };
      const { next, drop, changed } = cleanup(data, jstMonthKey(t));
      for (const id of drop) { await adapter.del('images', id).catch(() => {}); forgetUrl(id); }
      // どの記録からも使われていない画像（途中で止まった保存の残りなど）も消す。
      const used = new Set(next.inbox.filter(i => !i.imageDeleted).map(i => i.id));
      for (const id of await adapter.keys('images').catch(() => [])) if (!used.has(id)) { await adapter.del('images', id).catch(() => {}); drop.push(id); }
      if (changed) await save(next).catch(() => {});
      meta.lastSeen = Math.max(meta.lastSeen ?? 0, t);
      await adapter.put('kv', 'meta', meta).catch(() => {});
      return { skipped: false, dropped: drop.length, changed };
    },
    // 公開先の時刻（応答の Date）と比べて、端末の時計のずれを覚える。通信できなければ何もしない。
    noteServerTime(serverTime) {
      if (!Number.isFinite(serverTime)) return;
      meta.skew = Math.abs(now() - serverTime) > 2 * DAY;
      if (!meta.skew) meta.lastSeen = Math.max(meta.lastSeen ?? 0, serverTime);
      return adapter.put('kv', 'meta', meta).catch(() => {});
    },
    isPast: key => key < current(),
    imageSrc: id => urls.get(id) ?? '',
    // 今までサーバーが受け持っていた処理を、同じ形の要求・応答のまま端末の中で行う。
    async api(url, body) {
      const u = new URL(url, 'https://local.invalid'), p = u.pathname;
      if (body === undefined) {
        if (p === '/api/data') return structuredClone(data);
        if (p === '/api/history') {
          const inbox = data.inbox.filter(i => !i.imageDeleted);
          await preload(inbox.map(i => i.id));
          return structuredClone({ history: data.history ?? [], inbox });
        }
        if (p === '/api/image-draft') {
          const item = data.inbox.find(i => i.id === u.searchParams.get('id') && !i.imageDeleted);
          if (!item) fail('元画像が見つかりません。', 404);
          await preload([item.id]);
          return { draft: structuredClone(item.draft ?? { month: '', names: [], cells: {} }), version: item.draftVersion ?? 0, status: item.status };
        }
      } else {
        if (p === '/api/prepare') return prepareLocal(data, body.files, current());
        if (p === '/api/cell') return local.editCell(body);
        if (p === '/api/commit') return local.commit(body);
        if (p === '/api/image-draft') return local.saveDraft(body);
        if (p === '/api/reader-learn') { const next = structuredClone(data); next.reader = learnReader(data.reader, body, data.codes, data.people); await save(next); return { data: structuredClone(data) }; }
        if (p === '/api/images') return local.receiveImages(body.files);
      }
      fail('見つかりません。', 404);
    },
    // 仮の「自分」から、選んだ人を本人にする。仮の人にシフトがなければ一覧から外す。
    async adoptSelf(id) {
      if (data.self !== 'me' || !data.people.some(p => p.id === id)) return null;
      const next = structuredClone(data);
      next.self = id;
      if (!Object.values(next.months).some(m => m.shifts.me)) next.people = next.people.filter(p => p.id !== 'me');
      await save(next); return structuredClone(data);
    },
    async editCell({ key, day, id, code, revision }) {
      if (revision !== data.revision) fail('別の画面から更新されています。最新の内容を読み込みました。', 409);
      const cells = typeof key === 'string' && /^\d{4}-\d{2}$/.test(key) ? data.months[key]?.shifts[id]?.split(/\s+/) : null;
      if (!cells || !Number.isInteger(day) || day < 1 || day > cells.length) fail('修正する日・人が見つかりません。');
      if (key < current()) fail('終わった月のシフトは変更できません（閲覧のみ）。', 403);
      if (typeof code !== 'string' || !Object.hasOwn(data.codes, code)) fail('選べない記号です。');
      const before = cells[day - 1], person = data.people.find(x => x.id === id);
      if (before === code) return { data: structuredClone(data), unchanged: true };
      const next = structuredClone(data);
      cells[day - 1] = code; next.months[key].shifts[id] = cells.join(' ');
      (next.history ??= []).push({ kind: 'edit', at: new Date(now()).toISOString(), files: [{ file: '勤務表から修正' }], changes: 1, months: [key], edit: { id, name: person?.name ?? id, day, before, after: code } });
      await save(next); return { data: structuredClone(data), unchanged: false, before };
    },
    async commit({ files, revision, imageIds = [], draftVersions = {} }) {
      if (revision !== data.revision) fail('別の画面から更新されています。内容を読み直して確認してください。', 409);
      const plan = prepareLocal(data, files, current());
      if (plan.issues.length) fail(plan.issues.join('\n'));
      if (!Array.isArray(imageIds) || imageIds.some(id => !data.inbox.some(i => i.id === id))) fail('元画像の受付IDが見つかりません。');
      for (const [id, version] of Object.entries(draftVersions ?? {})) if (!imageIds.includes(id) || version !== data.inbox.find(i => i.id === id)?.draftVersion) fail('画像の下書きが更新されています。履歴から開き直してください。', 409);
      const completing = imageIds.filter(id => data.inbox.find(i => i.id === id).status !== 'complete');
      if (!plan.changes.length && !completing.length) return { plan, data: structuredClone(data), unchanged: true };
      const next = structuredClone(data), at = new Date(now()).toISOString();
      next.people.push(...plan.newPeople);
      for (const w of plan.changes) {
        const m = next.months[w.key] ??= { scope: 'all', shifts: {}, source: {} };
        const [year, month] = w.key.split('-').map(Number);
        const cells = m.shifts[w.id]?.split(/\s+/) ?? Array(new Date(year, month, 0).getDate()).fill('?');
        cells[w.d - 1] = w.code; m.shifts[w.id] = cells.join(' ');
        if (Object.keys(m.shifts).length > 1) m.scope = 'all';
        m.source = { file: plan.files.map(f => f.file).join('・'), importedAt: at };
      }
      for (const item of next.inbox) if (completing.includes(item.id)) { item.status = 'complete'; item.completedAt = at; item.months = plan.months; }
      next.history.push({ kind: 'csv', at, files: plan.files, changes: plan.changes.length, months: plan.months, imageIds });
      await save(next); return { plan, data: structuredClone(data), unchanged: false };
    },
    async saveDraft({ id, draft, version }) {
      const item = data.inbox.find(i => i.id === id);
      if (!item) fail('元画像が見つかりません。', 404);
      if (item.status === 'complete' || version !== (item.draftVersion ?? 0)) fail('別の画面で更新されています。履歴から開き直してください。', 409);
      if (!draft || typeof draft.month !== 'string' || (draft.month && !/^(20\d{2}|2100)-(0[1-9]|1[0-2])$/.test(draft.month)) || !Array.isArray(draft.names) || draft.names.length > 100 || draft.names.some(n => typeof n !== 'string' || !n.trim() || n.length > 40 || /[<>\x00-\x1f]/.test(n)) || new Set(draft.names).size !== draft.names.length || !draft.cells || typeof draft.cells !== 'object' || Array.isArray(draft.cells)) fail('下書きの年月・氏名を確認してください。');
      const cells = Object.create(null);
      for (const [name, values] of Object.entries(draft.cells)) {
        if (!draft.names.includes(name) || !values || typeof values !== 'object' || Array.isArray(values)) fail('下書きの氏名を確認してください。');
        cells[name] = Object.create(null);
        for (const [d, code] of Object.entries(values)) { if (!/^(?:[1-9]|[12]\d|3[01])$/.test(d) || typeof code !== 'string' || code.length > 30) fail('下書きの日付・記号を確認してください。'); cells[name][d] = code; }
      }
      const next = structuredClone(data), target = next.inbox.find(i => i.id === id);
      target.draft = { month: draft.month, names: [...draft.names], cells: { ...cells } };
      target.draftVersion = version + 1; target.draftSavedAt = new Date(now()).toISOString();
      await save(next);
      return { version: target.draftVersion, savedAt: target.draftSavedAt };
    },
    async receiveImages(files) {
      if (!Array.isArray(files) || !files.length || files.length > 5) fail('画像は1回に1〜5枚選んでください。');
      const checked = [];
      for (const f of files) {
        if (typeof f?.name !== 'string' || f.name.length > 200 || typeof f.base64 !== 'string') fail('画像を読み込めませんでした。');
        let bytes; try { bytes = fromBase64(f.base64); } catch { fail('画像を読み込めませんでした。'); }
        if (!bytes.length || bytes.length > 8 * 1024 * 1024) fail('画像は1枚8MB以内にしてください。');
        const b = typeof Buffer !== 'undefined' ? Buffer.from(bytes) : bytesView(bytes);
        const ext = bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71 ? 'png' : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? 'jpg' : b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' ? 'webp' : null;
        if (!ext) fail('JPEG・PNG・WebP画像を選んでください。');
        const size = imageSize(b, ext);
        if (!size || size.w < 50 || size.h < 50 || size.w > 10000 || size.h > 10000 || size.w * size.h > 40e6) fail('画像の中身を確認できませんでした。スクリーンショットなどのJPEG・PNG・WebP画像を選んでください。');
        checked.push({ id: await sha256Hex(bytes), name: f.name, ext, bytes });
      }
      const next = structuredClone(data), results = [];
      for (const f of checked) {
        const previous = next.inbox.find(x => x.id === f.id);
        if (previous && !previous.imageDeleted) { results.push({ ...previous, duplicate: true }); continue; }
        // 期限で画像だけ消した記録は、同じ画像が来たら「反映済み」として扱う（もう一度読み込みはしない）。
        if (previous) { results.push({ ...previous, duplicate: true }); continue; }
        const type = f.ext === 'jpg' ? 'image/jpeg' : `image/${f.ext}`;
        try { await adapter.put('images', f.id, { blob: new Blob([f.bytes], { type }), type, name: f.name }); } catch { saveFailed(); }
        const item = { id: f.id, name: f.name, ext: f.ext, status: 'pending', at: new Date(now()).toISOString() };
        next.inbox.push(item); results.push(item);
      }
      if (results.some(r => !r.duplicate)) await save(next);
      await preload(results.map(r => r.id));
      return { results };
    },
  };
  return local;
}
// ブラウザーで Buffer の代わりに使う最小限の読み取り（imageSize が使う分だけ）。
function bytesView(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  return Object.assign(u8, {
    toString: (enc, s = 0, e = u8.length) => String.fromCharCode(...u8.subarray(s, e)),
    readUInt32BE: o => dv.getUint32(o), readUInt16BE: o => dv.getUint16(o),
    readUInt32LE: o => dv.getUint32(o, true), readUInt16LE: o => dv.getUint16(o, true),
    readUIntLE: (o, n) => { let v = 0; for (let i = n - 1; i >= 0; i--) v = v * 256 + u8[o + i]; return v; },
  });
}

// ---- IndexedDB（ブラウザーの中の保存先）----
function idbAdapter(name = 'futari-shift') {
  let dbp;
  const db = () => dbp ??= new Promise((res, rej) => {
    const r = indexedDB.open(name, 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('kv'); r.result.createObjectStore('images'); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); r.onblocked = () => rej(Error('blocked'));
  });
  const run = async (store, mode, fn) => { const d = await db(); return new Promise((res, rej) => { const tx = d.transaction(store, mode), req = fn(tx.objectStore(store)); tx.oncomplete = () => res(req?.result); tx.onerror = tx.onabort = () => rej(tx.error ?? Error('abort')); }); };
  return {
    get: (s, k) => run(s, 'readonly', st => st.get(k)),
    put: (s, k, v) => run(s, 'readwrite', st => st.put(v, k)),
    del: (s, k) => run(s, 'readwrite', st => st.delete(k)),
    keys: s => run(s, 'readonly', st => st.getAllKeys()),
  };
}
// メモリだけの保存先（IndexedDB が使えない環境・試験用）。
function memoryAdapter() {
  const m = { kv: new Map(), images: new Map() };
  return { m, get: async (s, k) => structuredClone(m[s].get(k)), put: async (s, k, v) => { m[s].set(k, s === 'images' ? v : structuredClone(v)); }, del: async (s, k) => { m[s].delete(k); }, keys: async s => [...m[s].keys()] };
}
const exported = { createLocal, idbAdapter, memoryAdapter, cleanup, clockOk, prepareLocal, jstMonthKey, monthDiff, blankData, csvRows, prepare, learnReader, imageSize };
if (typeof module !== 'undefined') module.exports = exported;
if (typeof window !== 'undefined') window.LocalShiftLib = exported;
})();
