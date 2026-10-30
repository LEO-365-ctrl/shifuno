// 見本のない氏名を、端末の中の文字認識（Tesseract.js・日本語の汎用データ）で読む。外部へは何も送らない。
// ・初めての端末など、氏名の見本と照合できなかった列だけを読む。見本で読めた列には使わない。
// ・氏名のマスは小さくにじみやすいので、上下2か所のマスを、拡大率と読み方を変えて何通りも読み、多数決で決める。
// ・決めた氏名もかならず「確かめてください」の印を付けて確認画面へ回す（自動で登録はしない）。決まらなければ「？N列目」のまま。
// ・部品（約6MB）は初めて使うときだけ読み込み、Service Worker が端末に残す。
(() => {
'use strict';
const BASE = 'ocr/';
let workerP = null;
const han = s => (s.match(/[一-鿿々]/g) ?? []).join('');
function loadScript(src) {
  return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(Error('文字認識の部品を読み込めませんでした。')); document.head.append(s); });
}
async function worker() {
  workerP ??= (async () => {
    if (!window.Tesseract) await loadScript(`${BASE}tesseract.min.js`);
    const abs = new URL(BASE, location.href).href;
    return window.Tesseract.createWorker('jpn', 1, { workerPath: `${abs}worker.min.js`, corePath: abs, langPath: abs, gzip: false, workerBlobURL: false, cacheMethod: 'none' });
  })().catch(e => { workerP = null; throw e; });
  return workerP;
}
// 1列分：氏名のマスを何通りも読み、票を数える。ひらがな・カタカナ混じりや、漢字が1〜4字でない読みは捨てる。
async function readColumn(w, src, boxes) {
  const votes = new Map();
  for (const b of boxes) for (const S of [3, 4, 6]) for (const mode of ['7', '13']) {
    await w.setParameters({ tessedit_pageseg_mode: mode });
    const width = b.x1 - b.x0, height = b.y1 - b.y0, pad = 12;
    if (width < 4 || height < 4) continue;
    const cv = document.createElement('canvas'); cv.width = width * S + pad * 2; cv.height = height * S + pad * 2;
    const x = cv.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, cv.width, cv.height); x.imageSmoothingQuality = 'high';
    x.filter = 'grayscale(1) contrast(1.6)'; x.drawImage(src, b.x0, b.y0, width, height, pad, pad, width * S, height * S);
    const { data } = await w.recognize(cv);
    const text = data.text.replace(/\s/g, ''), k = han(text);
    if (k.length >= 1 && k.length <= 4 && !/[぀-ヿ]/.test(text)) votes.set(k, (votes.get(k) ?? 0) + 1 + data.confidence / 100);
  }
  const ranked = [...votes].sort((a, b) => b[1] - a[1]), [name, score] = ranked[0] ?? ['', 0], second = ranked[1]?.[1] ?? 0;
  return score >= 4 && score >= second * 2 ? name : null;
}
// read.columns のうち person が決まらなかった列に ocrName を足す。時間がかかりすぎたら、そこまでで止める。
async function fill(imageData, read, { limitMs = 90000 } = {}) {
  const todo = read.columns.filter(c => !c.person && c.nameBoxes?.length);
  if (!todo.length) return 0;
  const started = Date.now(), w = await worker();
  const src = document.createElement('canvas'); src.width = imageData.width; src.height = imageData.height;
  src.getContext('2d').putImageData(imageData, 0, 0);
  const taken = new Set(read.columns.map(c => c.ocrName).filter(Boolean));
  let n = 0;
  for (const col of todo) {
    if (Date.now() - started > limitMs) break;
    const name = await readColumn(w, src, col.nameBoxes);
    if (name && !taken.has(name)) { col.ocrName = name; taken.add(name); n++; }
  }
  return n;
}
window.NameOCR = { fill };
})();
