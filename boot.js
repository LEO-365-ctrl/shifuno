// 起動：端末の保存先（IndexedDB）からシフトを読み込み、期限の来たものを整理してから app.js を始める。
(async () => {
'use strict';
const L = window.LocalShiftLib;
let local, warning = '';
try {
  local = L.createLocal(L.idbAdapter(), { seed: window.SHIFT_SEED });
  window.SHIFT_DATA = await local.open();
} catch {
  // プライベートブラウズなどで保存先が使えないときも、画面は使えるようにする（閉じると消えることを知らせる）。
  local = L.createLocal(L.memoryAdapter(), { seed: window.SHIFT_SEED });
  window.SHIFT_DATA = await local.open();
  warning = 'この端末では保存できません<br><small>プライベートブラウズなどでは、閉じると登録した内容が消えます。</small>';
}
// iPhone は Safari とホーム画面のアプリで保存先が別。Safari のまま登録すると、アプリ側には引き継がれない。
const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
if (!warning && ios && !navigator.standalone) warning = 'ホーム画面に追加してから使ってください<br><small>Safariで登録したシフトは、ホーム画面のアプリには引き継がれません。共有ボタン →「ホーム画面に追加」</small>';
window.LocalShift = Object.assign(local, { warning });
// ブラウザーが空き容量の都合で勝手に消さないよう、保存の保護をお願いする（できない環境では何もしない）。
navigator.storage?.persist?.().catch(() => {});
const app = document.createElement('script');
app.src = 'app.js';
document.body.append(app);
// 公開先の時刻（応答の Date）で端末の時計を確かめる。自動削除を誤らないため。オフラインなら何もしない。
fetch('version.json', { cache: 'no-store' }).then(r => local.noteServerTime(Date.parse(r.headers.get('Date')))).catch(() => {});
})();
