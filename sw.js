// ホーム画面アプリの Service Worker。アプリの画面（ファイル）だけを端末に置き、電波がなくても開けるようにする。
// ・シフトや画像はここでは扱わない（IndexedDB にあり、更新しても消えない）。
// ・版（VERSION）は tools/stamp.cjs がファイルの中身から決める。中身が変わると新しい版を丸ごと受け取り、古い版は消す。
// ・version.json は端末の時計の確認用なので、いつも公開先へ取りに行く。
'use strict';
const VERSION = '08b0209ec3';
const FILES = ["./","app.js","boot.js","holidays.js","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/maskable-512.png","image-entry.js","image-reader.js","index.html","local-store.js","manifest.webmanifest","name-ocr.js","seed.js"];
const CACHE = `shift-app-${VERSION}`;
// 文字認識の部品（約6MB）は初めて使うときに取り、版と別に残す（アプリを更新しても取り直さない）。部品を入れ替えたらこの名前を変える。
const OCR = 'shift-ocr-tess7.0.0-jpnfast';

self.addEventListener('install', event => event.waitUntil((async () => {
  const cache = await caches.open(CACHE);
  await cache.addAll(FILES.map(f => new Request(f, { cache: 'reload' })));
  await self.skipWaiting();
})()));
self.addEventListener('activate', event => event.waitUntil((async () => {
  for (const key of await caches.keys()) if (key.startsWith('shift-') && key !== CACHE && key !== OCR) await caches.delete(key);
  await self.clients.claim();
})()));
self.addEventListener('fetch', event => {
  const req = event.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.endsWith('/version.json')) return;
  if (url.pathname.includes('/ocr/')) {
    event.respondWith((async () => {
      const cache = await caches.open(OCR), hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone()).catch(() => {});
      return res;
    })());
    return;
  }
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req.mode === 'navigate' ? './' : req, { ignoreSearch: true });
    if (hit) return hit;
    try { return await fetch(req); }
    catch (e) { if (req.mode === 'navigate') { const page = await cache.match('./'); if (page) return page; } throw e; }
  })());
});
