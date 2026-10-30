/* Image entry runs in any browser. Drafts are saved on this device (local-store.js). */
(() => {
'use strict';
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
window.ImageEntry = class {
  // hints：自動読み取りで確認が必要になった所（cells: 氏名→日の一覧、people: 氏名→理由）。
  constructor(root, item, saved, codes, api, reopen, hints = null) {
    const need = hints ? Object.fromEntries(Object.entries(hints.cells ?? {}).map(([n, days]) => [n, new Set(days.map(String))])) : {};
    const flagged = saved.draft.names.find(n => need[n]?.size || hints?.people?.[n]);
    Object.assign(this, { root, item, codes, api, version: saved.version, draft: saved.draft, selected: flagged ?? saved.draft.names[0] ?? '', queue: Promise.resolve(), dirty: false, error: null, need, why: { ...(hints?.people ?? {}) }, crops: { ...(hints?.crops ?? {}) } });
    root.innerHTML = `${hints ? '<div class="entry-hints" role="status"></div>' : ''}<div class="entry-source"><img src="${LocalShift.imageSrc(item.id)}" alt="登録する元のシフト表"><button type="button" class="entry-zoom">画像を拡大</button></div>
      <p class="entry-help">${hints ? '読み取れた所は入力済みです。色の付いた所だけ、画像を見て直してください。' : '画像を見ながら年月・氏名・記号を入力してください。読めない欄は「未確認」のまま残せます。'}</p>
      <label>画像の年月<input class="entry-month" type="month" min="2000-01" max="2100-12" value="${esc(this.draft.month)}"></label>
      <label>画像に載っている氏名（1行に1人）<textarea class="entry-names" rows="3" placeholder="山田21&#10;佐々木">${esc(this.draft.names.join('\n'))}</textarea></label>
      <label>入力するメンバー<select class="entry-person"></select></label>
      <p class="entry-count"></p><div class="entry-days"></div><p class="entry-status" role="status" aria-live="polite"></p><button type="button" class="entry-reload" hidden>未保存の入力を破棄して開き直す</button>`;
    root.querySelector('.entry-reload').addEventListener('click', reopen);
    root.querySelector('.entry-month').addEventListener('change', e => {
      this.draft.month = e.target.value; this.changed(); this.renderDays();
    });
    root.querySelector('.entry-names').addEventListener('change', e => {
      const names = e.target.value.split(/\r?\n/).map(n => n.trim()).filter(Boolean);
      // 行数が同じなら、書き換えた行の入力をそのまま新しい氏名へ引き継ぐ（読めなかった氏名を直したとき）。
      const before = this.draft.names;
      if (names.length === before.length) names.forEach((n, i) => {
        const old = before[i]; if (n === old || Object.hasOwn(this.draft.cells, n)) return;
        if (Object.hasOwn(this.draft.cells, old)) { Object.defineProperty(this.draft.cells, n, { value: this.draft.cells[old], enumerable: true, writable: true, configurable: true }); delete this.draft.cells[old]; }
        for (const map of [this.need, this.why, this.crops]) if (Object.hasOwn(map, old)) { map[n] = map[old]; delete map[old]; }
        if (/^？/.test(old)) delete this.why[n];
        if (this.selected === old) this.selected = n;
      });
      // Retain removed names' entries locally until a successful save; never guess aliases.
      this.draft.names = names;
      if (!names.includes(this.selected)) this.selected = names[0] ?? '';
      this.changed(); this.renderPeople();
    });
    root.querySelector('.entry-person').addEventListener('change', e => { this.selected = e.target.value; this.renderDays(); });
    // 理由を読んで記号を見直したら「確認しました」で印を外す。
    root.addEventListener('click', e => { if (e.target.closest('.entry-ack') && this.why[this.selected]) { delete this.why[this.selected]; this.renderPeople(false); } });
    root.querySelector('.entry-days').addEventListener('change', e => {
      if (!e.target.dataset.day) return;
      if (!Object.hasOwn(this.draft.cells, this.selected)) Object.defineProperty(this.draft.cells, this.selected, { value: {}, enumerable: true, writable: true });
      this.draft.cells[this.selected][e.target.dataset.day] = e.target.value;
      // 直したマスは確認済みにして、色をそっと消す。
      if (e.target.value && this.need[this.selected]?.delete(e.target.dataset.day)) { e.target.closest('label').classList.remove('need'); this.renderPeople(false); }
      this.changed(); this.count();
    });
    root.querySelector('.entry-zoom').addEventListener('click', () => {
      const dialog = document.querySelector('.image-viewer');
      dialog.querySelector('img').src = LocalShift.imageSrc(item.id);
      dialog.showModal();
    });
    this.renderPeople(); this.status(saved.version ? '保存済みの下書きを開きました' : '入力すると下書きを自動保存します');
  }
  days() {
    if (!/^(20\d{2}|2100)-(0[1-9]|1[0-2])$/.test(this.draft.month)) return 0;
    const [y,m] = this.draft.month.split('-').map(Number); return new Date(y,m,0).getDate();
  }
  renderPeople(days = true) {
    const select = this.root.querySelector('.entry-person');
    select.innerHTML = this.draft.names.map(n => { const k = this.need[n]?.size ?? 0; return `<option value="${esc(n)}">${esc(n)}${k ? `（確認 ${k}か所）` : this.why[n] ? '（要確認）' : ''}</option>`; }).join('');
    select.value = this.selected; select.disabled = !this.draft.names.length;
    if (days) this.renderDays(); else this.renderHints();
  }
  // 上の案内：確認が必要な所の数と、選んでいる人の理由。全部済むと「確認が必要な所はなくなりました」に変わる。
  renderHints() {
    const box = this.root.querySelector('.entry-hints'); if (!box) return;
    const left = Object.values(this.need).reduce((n, s) => n + s.size, 0), flagged = Object.keys(this.why).filter(n => this.draft.names.includes(n)), why = this.why[this.selected];
    const clear = !left && !flagged.length, was = box.classList.contains('clear');
    box.classList.toggle('clear', clear);
    box.innerHTML = clear ? '<b>確認が必要な所はなくなりました</b><span>「登録内容を確認」で保存へ進めます。</span>'
      : `<b>自動で読み取りました · 確認が必要 ${[left ? `${left}マス` : '', flagged.length ? `${flagged.length}人` : ''].filter(Boolean).join('・')}</b>${why ? `<span>${esc(this.selected)}：${esc(why)}</span>${/^？/.test(this.selected) ? '' : '<button type="button" class="entry-ack">確認しました</button>'}` : left ? '<span>色の付いた日だけ、画像を見て記号を選んでください。</span>' : ''}`;
    if (clear && !was && !matchMedia('(prefers-reduced-motion: reduce)').matches) box.animate([{ transform: 'scale(.96)' }, { transform: 'none' }], { duration: 360, easing: 'cubic-bezier(.34,1.56,.64,1)' });
  }
  renderDays() {
    const days = this.days(), name = this.selected;
    const choices = Object.entries(this.codes).map(([code,c]) => [code, c.kind === 'work' ? `${code} · ${c.start}–${c.end}` : code]);
    this.root.querySelector('.entry-days').innerHTML = days && name ? Array.from({length:days}, (_,i) => {
      const day = i+1, value = Object.hasOwn(this.draft.cells, name) ? this.draft.cells[name][day] ?? '' : '';
      const need = this.need[name]?.has(String(day)), crop = need && this.crops[name]?.[day];
      return `<label${need ? ` class="need${crop ? ' has-crop' : ''}"` : ''}><span>${day}日</span>${crop ? `<img class="need-crop" src="${esc(crop)}" alt="画像のこのマス">` : ''}<select data-day="${day}" aria-label="${esc(name)} ${day}日の勤務"><option value="">未確認</option>${choices.map(([c,l]) => `<option value="${esc(c)}"${value===c?' selected':''}>${esc(l)}</option>`).join('')}</select></label>`;
    }).join('') : '<p>年月と氏名を入力すると、日別の入力欄が表示されます。</p>';
    this.count(); this.renderHints();
  }
  count() {
    const total = this.days()*this.draft.names.length;
    let count = 0;
    for (const name of this.draft.names) for (let d=1;d<=this.days();d++) if (Object.hasOwn(this.draft.cells,name) && Object.hasOwn(this.codes,this.draft.cells[name][d]??'')) count++;
    this.root.querySelector('.entry-count').textContent = `${count} / ${total}件 確認済み`;
  }
  // 確認が必要な最初の日を、入力画面の中で見える位置までなめらかに送る（.app 自体は動かさない）。
  focusNeed(instant) {
    const el = this.root.querySelector('.entry-days .need'); if (!el) return;
    let sc = el.parentElement; while (sc && !/(auto|scroll)/.test(getComputedStyle(sc).overflowY)) sc = sc.parentElement;
    if (!sc) return;
    sc.scrollTo({ top: el.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop - sc.clientHeight / 3, behavior: instant ? 'auto' : 'smooth' });
    if (!instant) el.animate([{ transform: 'scale(.97)' }, { transform: 'scale(1.02)', offset: .5 }, { transform: 'none' }], { duration: 520, delay: 380, easing: 'cubic-bezier(.34,1.56,.64,1)' });
  }
  status(message) { this.root.querySelector('.entry-status').textContent = message; this.root.querySelector('.entry-reload').hidden = !this.error; }
  snapshot() { return { month: this.draft.month, names: [...this.draft.names], cells: Object.fromEntries(this.draft.names.map(n => [n, Object.hasOwn(this.draft.cells,n) ? {...this.draft.cells[n]} : {}])) }; }
  changed() {
    this.dirty = true;
    const draft = this.snapshot();
    this.status('下書きを保存中…');
    this.queue = this.queue.then(async () => {
      if (this.error) return;
      try {
        const result = await this.api('/api/image-draft', { id:this.item.id, draft, version:this.version });
        this.version = result.version;
        if (JSON.stringify(draft) === JSON.stringify(this.snapshot())) this.dirty = false;
        this.status(this.dirty ? '下書きを保存中…' : '下書きを保存しました');
      } catch (e) { this.error=e; this.status(`未保存：${e.message}`); }
    });
  }
  async flush() {
    // Blur flushes a pending names/month edit before a review or close.
    if (this.root.contains(document.activeElement)) document.activeElement.blur();
    await this.queue;
    if (this.error) throw this.error;
    if (this.dirty) throw Error('下書きの保存が完了していません。');
  }
  async retry() {
    await this.queue; this.error=null; this.changed(); await this.flush();
  }
  async files() {
    await this.flush();
    if (!this.days() || !this.draft.names.length) throw Error('画像の年月と氏名を入力してください。');
    const unnamed = this.draft.names.filter(n => /^？/.test(n));
    if (unnamed.length) throw Error(`読み取れなかった氏名があります（${unnamed.join('・')}）。画像を見て、氏名の欄で書き換えてください。`);
    const missing=[];
    for (const name of this.draft.names) {
      const days=[];
      for (let d=1;d<=this.days();d++) if (!Object.hasOwn(this.draft.cells,name) || !Object.hasOwn(this.codes,this.draft.cells[name][d]??'')) days.push(d);
      if (days.length) missing.push(`${name}：${days.join('・')}日`);
    }
    if (missing.length) throw Error(`未確認の勤務があります。読めない箇所は下書きのまま保管し、確認後に登録してください。\n${missing.join('\n')}`);
    const quote = s => `"${String(s).replace(/"/g,'""')}"`;
    const rows = [[this.draft.month,...this.draft.names], ...Array.from({length:this.days()},(_,i)=>[String(i+1),...this.draft.names.map(n=>this.draft.cells[n][i+1])])];
    return [{name:`画像入力-${this.draft.month}.csv`,text:rows.map(r=>r.map(quote).join(',')).join('\n')}];
  }
};
})();
