/*
 * common.js — ตัวช่วยที่หน้า LIFF (ออกบิล / เร็ว ๆ นี้) ใช้ร่วมกัน แทน Sim.* ของระบบจำลอง
 *
 *   LiffApp.start()                 liff.init → (ยังไม่ login → liff.login) → ตรวจว่ามี idToken  คืน true ถ้าพร้อมเรียก API
 *   LiffApp.api(action, payload)    POST ไป Apps Script พร้อม idToken (ไม่ส่ง userId — เซิร์ฟเวอร์ไม่เชื่ออยู่แล้ว)
 *   LiffApp.showApiError(r)         แสดงข้อผิดพลาดเต็มหน้า (ไม่มีสิทธิ์ / เชื่อมต่อไม่ได้ / หมดอายุ ...)
 *   LiffApp.inClient()              เปิดในแอป LINE หรือไม่
 *   LiffApp.toast / sheet / uuid / esc / el   เหมือน Sim.* ของระบบจำลอง
 *   LiffApp.fresh(name, action, payload, render)   แสดงข้อมูลที่จำไว้ทันที แล้วดึงใหม่เบื้องหลัง (รอบ 5A-2)
 *   LiffApp.remember / keep / forget          ข้อมูลที่จำไว้ใน localStorage (ไม่มี idToken / ล้างเมื่อไม่มีสิทธิ์)
 *
 * fetch ด้วย Content-Type text/plain (ไม่เกิด CORS preflight ที่ Apps Script ตอบไม่ได้) และตาม redirect 302 ของ Apps Script
 */
var LiffApp = (function () {
  var CFG = window.APP_CONFIG || {};

  var MSG = {
    notConfigured: { title: 'ยังไม่ได้ตั้งค่า', text: 'ยังไม่ได้ใส่ LIFF_ID หรือ API_URL ในไฟล์ config.js' },
    sdk: { title: 'เชื่อมต่อไม่ได้', text: 'โหลดระบบของ LINE ไม่สำเร็จ ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่' },
    init: { title: 'เปิดหน้าไม่สำเร็จ', text: 'เริ่มต้น LINE ไม่ได้ (LIFF ID อาจไม่ถูกต้อง หรือเชื่อมต่อไม่ได้)' },
    noToken: { title: 'ยืนยันตัวตนไม่ได้', text: 'ไม่ได้รับข้อมูลยืนยันตัวตนจาก LINE (LIFF app ต้องเปิด scope openid) ลองปิดแล้วเปิดหน้านี้ใหม่' },
    network: { title: 'เชื่อมต่อไม่ได้', text: 'ติดต่อเซิร์ฟเวอร์ไม่ได้ ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่' },
    http: { title: 'เชื่อมต่อไม่ได้', text: 'เซิร์ฟเวอร์ตอบกลับผิดปกติ กรุณาลองใหม่อีกครั้ง' },
    badResponse: { title: 'เชื่อมต่อไม่ได้', text: 'เซิร์ฟเวอร์ตอบกลับไม่ใช่ข้อมูลที่ระบบเข้าใจ (ตรวจ API_URL และการตั้งค่า Web app ให้ผู้ใช้เป็น Anyone)' }
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function el(html) {
    var t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  function view() { return document.getElementById('view'); }

  /**
   * ข้อความระหว่างรอ (บอกว่ากำลังทำอะไร ไม่ใช่แค่วงกลมหมุน) — รอนานเกิน 6 วินาทีมีคำอธิบายเพิ่ม
   * @param {string} text เช่น "กำลังโหลดรายชื่อร้านและเอกสาร…"
   * @param {Element} [target] ค่าเริ่มต้น #view
   */
  function loading(text, target) {
    var box = el('<div class="loading" id="loading" role="status"><span class="spinner" aria-hidden="true"></span>' +
      '<div class="msg" id="loading-msg"></div><div class="small muted slow hidden" id="loading-slow">' +
      'ใช้เวลานานกว่าปกติ — ถ้าไม่ได้ใช้งานมาสักพัก ระบบต้องตื่นก่อน ครั้งแรกอาจใช้ 5–15 วินาที</div></div>');
    box.querySelector('.msg').textContent = text;
    (target || view()).replaceChildren(box);
    setTimeout(function () {
      if (box.isConnected) box.querySelector('.slow').classList.remove('hidden');
    }, 6000);
    return box;
  }

  /**
   * แสดงข้อผิดพลาดเต็มหน้า
   * @param {{title:string, text:string, hint?:string}} m
   * @param {{label:string, run:function}} [action] ปุ่มแก้ไข เช่น ลองใหม่
   */
  function showError(m, action, code) {
    var card = el('<section class="card alert err" id="error"><h2></h2><p></p></section>');
    if (code) card.setAttribute('data-code', code);
    card.querySelector('h2').textContent = m.title;
    card.querySelector('p').textContent = m.text;
    if (m.hint) {
      var h = el('<p class="small"></p>');
      h.textContent = m.hint;
      card.appendChild(h);
    }
    if (action) {
      var b = el('<button type="button" class="btn primary block" id="error-action"></button>');
      b.textContent = action.label;
      b.addEventListener('click', action.run);
      card.appendChild(b);
    }
    var t = document.getElementById('totalbar');
    if (t) t.classList.add('hidden');
    var tabsEl = document.getElementById('tabs');
    if (tabsEl) tabsEl.classList.add('hidden');
    syncing(false);
    var sub = document.getElementById('subtitle');
    if (sub) sub.textContent = '';
    view().replaceChildren(card);
  }

  // ---------- จำข้อมูลบนมือถือ (localStorage) — แสดงทันทีแล้วค่อยดึงใหม่เบื้องหลัง (stale-while-revalidate)
  // เก็บเฉพาะข้อมูลที่ใช้แสดงผล (ร้าน สินค้า ตั้งค่า ชื่อผู้ใช้ เอกสารล่าสุด) ห้ามเก็บ idToken
  // แยกตามบัญชี LINE (แฮชของ sub ไม่เก็บ userId ตรง ๆ) / เซิร์ฟเวอร์ตอบว่าไม่มีสิทธิ์ → ล้างทั้งหมด
  // การบันทึกทุกอย่างยังตรวจที่เซิร์ฟเวอร์ ข้อมูลที่จำไว้ใช้แสดงผลเท่านั้น
  var STORE_PREFIX = 'invoice-liff:v1:';
  var AUTH_FAIL = { forbidden: 1, no_token: 1, token_invalid: 1, config: 1 };

  function storeOk() {
    try { return typeof localStorage !== 'undefined' && !!localStorage; } catch (e) { return false; }
  }

  /** แฮชสั้นของ sub (FNV-1a) — แยกข้อมูลของแต่ละบัญชี LINE บนเครื่องเดียวกัน */
  function accountKey() {
    var sub = '';
    try { sub = (liff.getDecodedIDToken() || {}).sub || ''; } catch (e) { sub = ''; }
    if (!sub) return '';
    var h = 2166136261; // FNV-1a (เขียนเป็นเลขฐานสิบ: เลขฐานสิบหกบางตัวหน้าตาเหมือนเบอร์โทร check-public จับ)
    for (var i = 0; i < sub.length; i++) { h ^= sub.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h.toString(36);
  }

  function storeKey(name) {
    var acc = accountKey();
    return acc ? STORE_PREFIX + acc + ':' + name : '';
  }

  /** ข้อมูลที่จำไว้ {at, data} หรือ null */
  function remember(name) {
    var k = storeKey(name);
    if (!k || !storeOk()) return null;
    try {
      var v = JSON.parse(localStorage.getItem(k) || 'null');
      return v && typeof v === 'object' && 'data' in v ? v : null;
    } catch (e) { return null; }
  }

  /** จำข้อมูล (ตัด idToken ออกเสมอ) — พื้นที่เต็ม → ไม่จำ (ใช้งานต่อได้ปกติ) */
  function keep(name, data) {
    var k = storeKey(name);
    if (!k || !storeOk()) return false;
    try {
      var copy = JSON.parse(JSON.stringify(data));
      delete copy.idToken;
      localStorage.setItem(k, JSON.stringify({ at: Date.now(), data: copy }));
      return true;
    } catch (e) {
      try { localStorage.removeItem(k); } catch (e2) { /* ไม่เป็นไร */ }
      return false;
    }
  }

  /** ลืมข้อมูลชื่อนี้ (เช่น หลังบันทึก ไม่ให้แสดงรายการก่อนแก้) */
  function drop(name) {
    var k = storeKey(name);
    if (!k || !storeOk()) return;
    try { localStorage.removeItem(k); } catch (e) { /* ไม่เป็นไร */ }
  }

  /** ล้างข้อมูลที่จำไว้ทั้งหมด (ทุกบัญชี) */
  function forget() {
    if (!storeOk()) return;
    try {
      var keys = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf(STORE_PREFIX) === 0) keys.push(k);
      }
      keys.forEach(function (k) { localStorage.removeItem(k); });
    } catch (e) { /* ไม่เป็นไร */ }
  }

  /** ป้าย "กำลังอัปเดตข้อมูลล่าสุด…" ใต้หัวข้อ ระหว่างดึงข้อมูลใหม่เบื้องหลัง */
  function syncing(on) {
    var bar = document.querySelector('.topbar');
    var s = document.getElementById('sync');
    if (!on) { if (s) s.remove(); return; }
    if (s || !bar) return;
    s = el('<div class="sync" id="sync" role="status"><span class="spinner sm" aria-hidden="true"></span> กำลังอัปเดตข้อมูลล่าสุด…</div>');
    bar.appendChild(s);
  }

  /**
   * แสดงจากที่จำไว้ทันที แล้วดึงใหม่เบื้องหลัง ถ้าเปลี่ยนค่อยเรียก render อีกครั้ง
   * @param {string} name ชื่อข้อมูลที่จำ เช่น 'init'
   * @param {string} action / payload คำขอไปเซิร์ฟเวอร์
   * @param {function(object, {cached:boolean, update:boolean})} render
   * @param {{loadingText:string, slim?:function(object):object}} opts slim = ย่อข้อมูลก่อนจำ (เช่น เก็บเอกสารแค่ล่าสุด)
   * @returns {Promise<object|null>} คำตอบจากเซิร์ฟเวอร์ (null ถ้าไม่สำเร็จ)
   */
  async function fresh(name, action, payload, render, opts) {
    opts = opts || {};
    var c = remember(name);
    if (c) render(c.data, { cached: true, update: false });
    else loading(opts.loadingText || 'กำลังโหลด…');
    if (c) syncing(true);
    var r = await api(action, payload);
    syncing(false);
    if (!r.ok) {
      if (c && !AUTH_FAIL[r.code] && r.code !== 'token_expired') {
        toast('อัปเดตข้อมูลไม่สำเร็จ — กำลังแสดงข้อมูลที่จำไว้', true);
        return null;
      }
      showApiError(r); // ไม่มีสิทธิ์ → api() ล้างข้อมูลที่จำไว้แล้ว และหน้าจอแทนที่ข้อมูลเดิมทั้งหมด
      return null;
    }
    var slim = opts.slim ? opts.slim(r) : r;
    if (!c) {
      keep(name, slim);
      render(r, { cached: false, update: false });
      return r;
    }
    if (JSON.stringify(stripMeta(slim)) !== JSON.stringify(stripMeta(c.data))) render(r, { cached: false, update: true });
    keep(name, slim);
    return r;
  }

  function stripMeta(d) {
    var o = {};
    for (var k in d) if (k !== 'idToken') o[k] = d[k];
    return o;
  }

  var reload = { label: 'ลองใหม่', run: function () { location.reload(); } };
  var relogin = {
    label: 'เข้าสู่ระบบใหม่',
    run: function () {
      try { liff.logout(); } catch (e) { /* ไม่เป็นไร */ }
      liff.login({ redirectUri: location.href });
    }
  };

  /** เรียก API ของ Apps Script — คืน {ok:false, code:'network'|'http'|'bad_response'} ถ้าติดต่อไม่ได้ */
  async function api(action, payload) {
    var idToken = '';
    try { idToken = liff.getIDToken() || ''; } catch (e) { idToken = ''; }
    var body = Object.assign({}, payload || {}, { action: action, idToken: idToken });
    var t0 = Date.now();
    try {
      var r = await apiFetch(body);
      if (r && !r.ok && AUTH_FAIL[r.code]) forget(); // ไม่มีสิทธิ์ → ลืมทุกอย่างที่จำไว้บนเครื่องนี้
      return r;
    } finally {
      // เวลาที่หน้าเว็บรอ (รวมเน็ต + redirect ของ Apps Script) ดูได้ใน console — เทียบกับ "[เวลา]" ในหน้าการดำเนินการ
      try { console.info('[เวลา] ' + action + ' ' + (Date.now() - t0) + 'ms (หน้าเว็บรอ)'); } catch (e) { /* ไม่เป็นไร */ }
    }
  }

  async function apiFetch(body) {
    var res;
    try {
      res = await fetch(CFG.API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(body),
        redirect: 'follow',
        cache: 'no-store'
      });
    } catch (e) {
      return { ok: false, code: 'network', error: MSG.network.text };
    }
    if (!res.ok) return { ok: false, code: 'http', error: MSG.http.text };
    try {
      var data = await res.json();
      return data && typeof data === 'object' ? data : { ok: false, code: 'bad_response', error: MSG.badResponse.text };
    } catch (e) {
      return { ok: false, code: 'bad_response', error: MSG.badResponse.text };
    }
  }

  /** ติดต่อเซิร์ฟเวอร์ไม่ได้ชั่วคราว (ลองอีกครั้งได้ด้วยข้อมูลเดิม) */
  function isRetryable(r) {
    return r.code === 'network' || r.code === 'http' || r.code === 'bad_response' || r.code === 'busy' || r.code === 'verify_unavailable' || r.code === 'server';
  }

  /** แปลงคำตอบที่ไม่สำเร็จเป็นข้อความเต็มหน้า */
  function showApiError(r) {
    if (r.code === 'network') return showError(MSG.network, reload, r.code);
    if (r.code === 'http') return showError(MSG.http, reload, r.code);
    if (r.code === 'bad_response') return showError(MSG.badResponse, reload, r.code);
    if (r.code === 'forbidden' || r.code === 'no_token' || r.code === 'token_invalid') {
      return showError({
        title: 'ไม่มีสิทธิ์ใช้งาน',
        text: String(r.error || 'บัญชี LINE นี้ไม่มีสิทธิ์ใช้งาน').replace(/^ไม่มีสิทธิ์ใช้งาน:\s*/, ''),
        hint: 'ถ้าควรใช้งานได้: พิมพ์ myid ในแชทของ OA แล้วส่ง userId ให้ผู้ดูแลเพิ่มในแท็บ "ผู้ใช้"'
      }, null, r.code);
    }
    if (r.code === 'token_expired') return showError({ title: 'การเข้าสู่ระบบหมดอายุ', text: r.error }, relogin, r.code);
    return showError({ title: 'เกิดข้อผิดพลาด', text: r.error || 'กรุณาลองใหม่อีกครั้ง' }, reload, r.code);
  }

  /** เริ่ม LIFF — คืน true เมื่อพร้อมเรียก API (false = แสดงข้อผิดพลาดแล้ว หรือกำลังไปหน้า login) */
  async function start() {
    if (!CFG.LIFF_ID || !CFG.API_URL) { showError(MSG.notConfigured, null, 'not_configured'); return false; }
    if (typeof liff === 'undefined') { showError(MSG.sdk, reload, 'sdk'); return false; }
    loading('กำลังเชื่อมต่อ LINE…');
    try {
      await liff.init({ liffId: CFG.LIFF_ID });
    } catch (e) {
      showError(MSG.init, reload, 'init');
      return false;
    }
    if (!liff.isLoggedIn()) {
      liff.login({ redirectUri: location.href });
      return false;
    }
    var idToken = null;
    try { idToken = liff.getIDToken(); } catch (e) { idToken = null; }
    if (!idToken) { showError(MSG.noToken, relogin, 'no_id_token'); return false; }
    return true;
  }

  function inClient() {
    try { return typeof liff !== 'undefined' && liff.isInClient(); } catch (e) { return false; }
  }

  /** เปิดลิงก์ในเบราว์เซอร์ภายนอก (ในแอป LINE ใช้ liff.openWindow external) คืน true ถ้าเปิดเองแล้ว */
  function openExternal(url) {
    if (!inClient() || typeof liff.openWindow !== 'function') return false;
    try { liff.openWindow({ url: url, external: true }); return true; } catch (e) { return false; }
  }

  var toastTimer = null;
  function toast(msg, isErr) {
    var old = document.querySelector('.toast');
    if (old) old.remove();
    var t = el('<div class="toast' + (isErr ? ' err' : '') + '"></div>');
    t.textContent = msg;
    document.body.appendChild(t);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.remove(); }, isErr ? 5000 : 2600);
  }

  /** UUID v4 (ใช้เป็น requestId กันส่งซ้ำ) */
  function uuid() {
    if (window.crypto && crypto.randomUUID && window.isSecureContext) return crypto.randomUUID();
    var b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    var h = Array.from(b, function (x) { return x.toString(16).padStart(2, '0'); }).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }

  /** แผ่นเลื่อนขึ้น คืน {el, close} */
  function sheet(title, bodyHtml, footerHtml) {
    var back = el('<div class="sheet-back"><div class="sheet" role="dialog" aria-modal="true">' +
      '<header><h2></h2><button type="button" class="btn ghost" data-close aria-label="ปิด">✕</button></header>' +
      '<div class="body"></div>' + (footerHtml ? '<footer></footer>' : '') + '</div></div>');
    back.querySelector('h2').textContent = title;
    back.querySelector('.body').innerHTML = bodyHtml;
    if (footerHtml) back.querySelector('footer').innerHTML = footerHtml;
    function close() { back.remove(); document.removeEventListener('keydown', onKey); }
    function onKey(e) { if (e.key === 'Escape') close(); }
    back.addEventListener('click', function (e) { if (e.target === back || e.target.closest('[data-close]')) close(); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(back);
    return { el: back, close: close };
  }

  return {
    start: start, api: api, showError: showError, showApiError: showApiError, isRetryable: isRetryable,
    inClient: inClient, relogin: relogin, toast: toast, uuid: uuid, sheet: sheet, esc: esc, el: el, loading: loading,
    openExternal: openExternal, fresh: fresh, remember: remember, keep: keep, forget: forget, drop: drop
  };
})();
