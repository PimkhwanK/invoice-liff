/*
 * common.js — ตัวช่วยที่หน้า LIFF ใช้ร่วมกัน แทน Sim.* ของระบบจำลอง
 *
 *   LiffApp.start()                 liff.init → (ยังไม่ login → liff.login) → ตรวจว่ามี idToken  คืน true ถ้าพร้อมเรียก API
 *   LiffApp.api(action, payload)    POST ไป Apps Script พร้อม idToken (ไม่ส่ง userId — เซิร์ฟเวอร์ไม่เชื่ออยู่แล้ว)
 *   LiffApp.showApiError(r, scr)    แสดงข้อผิดพลาดเต็มหน้า (ไม่มีสิทธิ์ / เชื่อมต่อไม่ได้ / หมดอายุ ...)
 *   LiffApp.isDenied(code)          ไม่มีสิทธิ์ใช้งาน (not_registered / disabled / forbidden ของเซิร์ฟเวอร์รุ่นเก่า)
 *   LiffApp.showDenied(code, scr)   หน้าไม่มีสิทธิ์ (รอบ 6 ข้อ 3): ยังไม่ได้ลงทะเบียน → ชื่อ + รหัส + ส่งให้ผู้ดูแล / ถูกปิด → ติดต่อผู้ดูแล
 *   LiffApp.inClient()              เปิดในแอป LINE หรือไม่
 *   LiffApp.toast / sheet / uuid / esc / el   เหมือน Sim.* ของระบบจำลอง
 *   LiffApp.remember / keep / forget          ข้อมูลที่จำไว้ใน localStorage (ไม่มี idToken / ล้างเมื่อไม่มีสิทธิ์)
 *
 * รอบ 6 ข้อ 3.5 (แอปหน้าเดียว shell.js): แต่ละหน้าจอมีส่วนหัว / #view / #totalbar ของตัวเอง และเก็บไว้นอกเอกสารตอนไม่ได้แสดง
 *   scr = { root, dock } ของหน้าจอ — ตัวช่วยที่แตะหน้าจอ (loading, showError, syncing ...) รับ scr ได้ ไม่ส่ง = หน้าจอที่แสดงอยู่ (LiffApp.setScope)
 *   หน้าตรวจระบบ (check.html) ไม่มี shell → ใช้ทั้งเอกสารเหมือนเดิม
 *   LiffApp.hooks.timing(ชื่อ, ms) / hooks.denied(code) — shell ใช้แสดงแถบเวลา (?debug=1) และซ่อนเมนูเมื่อไม่มีสิทธิ์
 *
 * fetch ด้วย Content-Type text/plain (ไม่เกิด CORS preflight ที่ Apps Script ตอบไม่ได้) และตาม redirect 302 ของ Apps Script
 */
var LiffApp = (function () {
  var CFG = window.APP_CONFIG || {};
  var hooks = { timing: null, denied: null, debugOn: null, server: null };
  var scope = null; // function → scr ของหน้าจอที่แสดงอยู่ (shell.js ตั้ง)

  function setScope(fn) { scope = fn; }

  /** หา element ตาม id ในหน้าจอ scr (ส่วนหัว/เนื้อหา แล้วแถบล่างของหน้าจอนั้น) — ไม่มี shell = ทั้งเอกสาร */
  function find(id, scr) {
    scr = scr || (scope ? scope() : null);
    if (!scr) return document.getElementById(id);
    return scr.root.querySelector('#' + id) || (scr.dock ? scr.dock.querySelector('#' + id) : null);
  }

  function timing(name, ms) {
    if (hooks.timing) { try { hooks.timing(name, ms); } catch (e) { /* ไม่เป็นไร */ } }
  }

  /**
   * รอบ 6 ข้อ 4: ระบบตั้งค่าไม่ครบ/ผิด → ขึ้นต้นด้วยประโยคนี้เสมอ แล้วรายละเอียดทางเทคนิคเป็นตัวเล็กด้านล่าง (detail)
   * เซิร์ฟเวอร์ (Api.gs API_SETUP) ส่งรูปแบบเดียวกัน: "<ประโยคนี้>\n<รายละเอียด>" → splitSetup แยกให้
   */
  var SETUP = 'ระบบยังตั้งค่าไม่ครบ กรุณาแจ้งผู้ดูแลระบบ';
  var FOR_ADMIN = 'รายละเอียดสำหรับผู้ดูแลระบบ: ';
  var NL = String.fromCharCode(10);

  var MSG = {
    notConfigured: { title: SETUP, text: '', detail: FOR_ADMIN + 'ยังไม่ได้ใส่ LIFF_ID หรือ API_URL ในไฟล์ config.js' },
    sdk: { title: 'เชื่อมต่อไม่ได้', text: 'โหลดระบบของ LINE ไม่สำเร็จ ตรวจสอบอินเทอร์เน็ตแล้วกด "ลองใหม่"' },
    init: {
      title: 'เปิดหน้าไม่สำเร็จ', text: 'ตรวจสอบอินเทอร์เน็ตแล้วกด "ลองใหม่" ถ้ายังเปิดไม่ได้ กรุณาแจ้งผู้ดูแลระบบ',
      detail: FOR_ADMIN + 'liff.init ไม่สำเร็จ (LIFF_ID ใน config.js อาจไม่ถูกต้อง)'
    },
    noToken: { title: SETUP, text: '', detail: FOR_ADMIN + 'ไม่ได้รับ ID token จาก LINE — LIFF app ต้องเปิด scope openid' },
    network: { title: 'เชื่อมต่อไม่ได้', text: 'ติดต่อระบบไม่ได้ ตรวจสอบอินเทอร์เน็ตแล้วกด "ลองใหม่"' },
    http: { title: 'เชื่อมต่อไม่ได้', text: 'ระบบตอบกลับผิดปกติ กรุณากด "ลองใหม่" อีกครั้ง' },
    badResponse: {
      title: SETUP, text: '',
      detail: FOR_ADMIN + 'คำตอบไม่ใช่ข้อมูลของระบบ — ตรวจ API_URL ใน config.js และ Web app ต้องตั้ง Who has access เป็น Anyone'
    }
  };
  /** ข้อความของคำตอบ (r.error) จาก MSG — แบบตั้งค่าไม่ครบ = ประโยคหลัก + ขึ้นบรรทัด + รายละเอียด */
  function msgText(m) { return m.title === SETUP ? SETUP + NL + m.detail : m.text; }

  /** "ระบบยังตั้งค่าไม่ครบ…\nรายละเอียด" → { detail } / ข้อความอื่น → null */
  function splitSetup(text) {
    text = String(text == null ? '' : text);
    if (text.indexOf(SETUP) !== 0) return null;
    return { detail: text.slice(SETUP.length).replace(/^\s+/, '') };
  }

  /**
   * ข้อความผิดพลาดในกล่องเล็ก (.alert) เป็น HTML: ตั้งค่าไม่ครบ → ประโยคหลักตัวหนา + รายละเอียดตัวเล็ก / อื่น ๆ → ขึ้นบรรทัดตาม \n
   * (รหัส E-xxxx ในข้อความขัดข้องอยู่ในข้อความเดิม)
   */
  function errorHtml(text) {
    var s = splitSetup(text);
    if (s) return '<b>' + esc(SETUP) + '</b>' + (s.detail ? '<div class="detail">' + esc(s.detail) + '</div>' : '');
    return esc(text).split(NL).join('<br>');
  }

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

  function view(scr) { return find('view', scr); }

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
  function showError(m, action, code, scr) {
    var card = el('<section class="card alert err" id="error"><h2></h2><p></p></section>');
    if (code) card.setAttribute('data-code', code);
    card.querySelector('h2').textContent = m.title;
    if (m.text) card.querySelector('p').textContent = m.text;
    else card.querySelector('p').remove();
    if (m.detail) { // รายละเอียดทางเทคนิค ตัวเล็ก (ผู้ใช้ทั่วไปไม่ต้องอ่าน ส่งต่อให้ผู้ดูแลได้)
      var d = el('<div class="detail" id="error-detail"></div>');
      d.textContent = m.detail;
      card.appendChild(d);
    }
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
    var t = find('totalbar', scr);
    if (t) t.classList.add('hidden');
    var tabsEl = find('tabs', scr);
    if (tabsEl) tabsEl.classList.add('hidden');
    syncing(false, scr);
    var sub = find('subtitle', scr);
    if (sub) sub.textContent = '';
    view(scr).replaceChildren(card);
  }

  // ---------- จำข้อมูลบนมือถือ (localStorage) — แสดงทันทีแล้วค่อยดึงใหม่เบื้องหลัง (stale-while-revalidate)
  // เก็บเฉพาะข้อมูลที่ใช้แสดงผล (ร้าน สินค้า ตั้งค่า ชื่อผู้ใช้ เอกสารล่าสุด) ห้ามเก็บ idToken
  // แยกตามบัญชี LINE (แฮชของ sub ไม่เก็บ userId ตรง ๆ) / เซิร์ฟเวอร์ตอบว่าไม่มีสิทธิ์ → ล้างทั้งหมด
  // การบันทึกทุกอย่างยังตรวจที่เซิร์ฟเวอร์ ข้อมูลที่จำไว้ใช้แสดงผลเท่านั้น
  var STORE_PREFIX = 'invoice-liff:v1:';
  var AUTH_FAIL = { forbidden: 1, not_registered: 1, disabled: 1, no_token: 1, token_invalid: 1, config: 1 };
  /** คำตอบที่แปลว่า "บัญชีนี้ไม่มีสิทธิ์ใช้งาน" (forbidden = เซิร์ฟเวอร์รุ่นก่อนรอบ 6 ถือเป็นยังไม่ได้ลงทะเบียน) */
  var DENIED = { forbidden: 1, not_registered: 1, disabled: 1 };
  function isDenied(code) { return !!DENIED[code]; }

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

  /** คำตอบที่แปลว่าต้องยืนยันตัวตนใหม่ / ไม่มีสิทธิ์ (ข้อมูลที่จำไว้ใช้ต่อไม่ได้) */
  function isAuthFail(code) { return !!AUTH_FAIL[code] || code === 'token_expired'; }

  /** ป้าย "กำลังอัปเดตข้อมูลล่าสุด…" ใต้หัวข้อ ระหว่างดึงข้อมูลใหม่เบื้องหลัง */
  function syncing(on, scr) {
    scr = scr || (scope ? scope() : null);
    var bar = scr ? scr.root.querySelector('.topbar') : document.querySelector('.topbar');
    var s = find('sync', scr);
    if (!on) { if (s) s.remove(); return; }
    if (s || !bar) return;
    s = el('<div class="sync" id="sync" role="status"><span class="spinner sm" aria-hidden="true"></span> กำลังอัปเดตข้อมูลล่าสุด…</div>');
    bar.appendChild(s);
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
    var debug = !!(hooks.debugOn && hooks.debugOn());
    if (debug) body.debug = true; // แถบเวลา ?debug=1: ขอเวลาแยกขั้นของเซิร์ฟเวอร์ (serverTiming) มาด้วย
    var t0 = Date.now();
    try {
      var r = await apiFetch(body);
      if (r && !r.ok && AUTH_FAIL[r.code]) forget(); // ไม่มีสิทธิ์ → ลืมทุกอย่างที่จำไว้บนเครื่องนี้
      if (r && r.serverTiming) {
        var st = r.serverTiming;
        delete r.serverTiming; // ไม่จำ / ไม่ใช้เทียบข้อมูล
        if (hooks.server) { try { hooks.server(action, st, Date.now() - t0); } catch (e) { /* ไม่เป็นไร */ } }
      }
      return r;
    } finally {
      // เวลาที่หน้าเว็บรอ (รวมเน็ต + redirect ของ Apps Script) ดูได้ใน console และแถบเวลา (?debug=1) — เทียบกับ "[เวลา]" ในหน้าการดำเนินการ
      var ms = Date.now() - t0;
      try { console.info('[เวลา] ' + action + ' ' + ms + 'ms (หน้าเว็บรอ)'); } catch (e) { /* ไม่เป็นไร */ }
      timing(action, ms);
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
      return { ok: false, code: 'network', error: msgText(MSG.network) };
    }
    if (!res.ok) return { ok: false, code: 'http', error: msgText(MSG.http) };
    try {
      var data = await res.json();
      return data && typeof data === 'object' ? data : { ok: false, code: 'bad_response', error: msgText(MSG.badResponse) };
    } catch (e) {
      return { ok: false, code: 'bad_response', error: msgText(MSG.badResponse) };
    }
  }

  /** ติดต่อเซิร์ฟเวอร์ไม่ได้ชั่วคราว (ลองอีกครั้งได้ด้วยข้อมูลเดิม) */
  function isRetryable(r) {
    return r.code === 'network' || r.code === 'http' || r.code === 'bad_response' || r.code === 'busy' || r.code === 'verify_unavailable' || r.code === 'server';
  }

  /** แปลงคำตอบที่ไม่สำเร็จเป็นข้อความเต็มหน้า */
  function showApiError(r, scr) {
    if (r.code === 'network') return showError(MSG.network, reload, r.code, scr);
    if (r.code === 'http') return showError(MSG.http, reload, r.code, scr);
    if (r.code === 'bad_response') return showError(MSG.badResponse, reload, r.code, scr);
    if (isDenied(r.code)) return showDenied(r.code, scr);
    if (r.code === 'no_token' || r.code === 'token_invalid') {
      return showError({ title: 'ยืนยันตัวตนไม่ได้', text: 'ยืนยันตัวตนกับ LINE ไม่สำเร็จ กรุณาปิดหน้านี้แล้วเปิดใหม่จากแชท LINE' }, relogin, r.code, scr);
    }
    if (r.code === 'token_expired') return showError({ title: 'การเข้าสู่ระบบหมดอายุ', text: r.error }, relogin, r.code, scr);
    // ตั้งค่าไม่ครบ (code config หรือข้อความแบบ API_SETUP) — เซิร์ฟเวอร์รุ่นเก่าส่งข้อความเดิม → ทั้งข้อความเป็นรายละเอียด
    var s = splitSetup(r.error);
    if (s || r.code === 'config') return showError({ title: SETUP, text: '', detail: s ? s.detail : (r.error || '') }, reload, r.code, scr);
    return showError({ title: 'เกิดข้อผิดพลาด', text: r.error || 'กรุณาลองใหม่อีกครั้ง' }, reload, r.code, scr);
  }

  // ---------- หน้าไม่มีสิทธิ์ใช้งาน (รอบ 6 ข้อ 3 — สีจาก theme.css)
  /** ข้อความที่ส่งให้ผู้ดูแลผ่าน shareTargetPicker (มีรหัสและวิธีเพิ่มสิทธิ์ — เฉพาะข้อความนี้ที่พูดถึงแท็บผู้ใช้) */
  function accessRequestText(name, id) {
    return ['ขอสิทธิ์ใช้งานระบบออกบิล', 'ชื่อ: ' + (name || '-'), 'รหัส: ' + id, '', 'ผู้ดูแล: นำรหัสนี้ไปเพิ่มในแท็บ ผู้ใช้ ของ Google Sheet'].join(String.fromCharCode(10));
  }

  /** ชื่อ LINE และรหัส (sub) จาก idToken บนเครื่อง — ไม่ต้องถามเซิร์ฟเวอร์ */
  function lineIdentity() {
    var d = null;
    try { d = liff.getDecodedIDToken(); } catch (e) { d = null; }
    d = d || {};
    return { name: typeof d.name === 'string' ? d.name : '', id: typeof d.sub === 'string' ? d.sub : '' };
  }

  /** ใช้ shareTargetPicker ได้ไหม (เปิดในแอป LINE + เปิดใช้ใน LINE Developers แล้ว) */
  function canShare() {
    try {
      return inClient() && typeof liff.shareTargetPicker === 'function' &&
        typeof liff.isApiAvailable === 'function' && liff.isApiAvailable('shareTargetPicker');
    } catch (e) { return false; }
  }

  /**
   * แสดงหน้าไม่มีสิทธิ์แทนเนื้อหาทั้งหมดของหน้า (ข้อมูลที่จำไว้ถูกล้างใน api() แล้ว)
   * @param {string} code 'disabled' = ถูกปิดสิทธิ์ / อื่น ๆ (not_registered, forbidden) = ยังไม่ได้ลงทะเบียน
   */
  function showDenied(code, scr) {
    var disabled = code === 'disabled';
    var card = el('<section class="denied" id="error" role="alert"><div class="icon" aria-hidden="true"></div><h2></h2><p></p></section>');
    card.setAttribute('data-code', disabled ? 'disabled' : 'not_registered');
    // ไอคอนเส้นจาก icons.js (สีตามธีม currentColor): กุญแจล็อก / หยุดชั่วคราว
    card.querySelector('.icon').innerHTML = iconSvg(disabled ? 'pause' : 'lock');
    card.querySelector('h2').textContent = disabled ? 'บัญชีนี้ถูกปิดการใช้งาน' : 'ยังไม่ได้รับสิทธิ์ใช้งาน';
    card.querySelector('p').textContent = disabled ? 'กรุณาติดต่อผู้ดูแลระบบ' : 'ส่งรหัสด้านล่างให้ผู้ดูแลระบบ เพื่อเปิดสิทธิ์ใช้งาน';
    if (!disabled) addRequest(card, lineIdentity());
    document.body.classList.add('denied-mode');
    syncing(false, scr);
    var sub = find('subtitle', scr);
    if (sub) sub.textContent = '';
    view(scr).replaceChildren(card);
    if (hooks.denied) hooks.denied(code); // แอปหน้าเดียว: ทุกหน้าจอแสดงหน้านี้ ซ่อนเมนู
  }

  /** ชื่อ + รหัส + ปุ่ม "ส่งรหัสให้ผู้ดูแล" (shareTargetPicker) / "คัดลอกรหัส" */
  function addRequest(card, me) {
    var who = el('<div class="who"><div class="label">ชื่อ LINE</div><div class="name" id="denied-name"></div>' +
      '<div class="label">รหัส</div><code class="uid" id="denied-id"></code></div>');
    who.querySelector('#denied-name').textContent = me.name || '-';
    who.querySelector('#denied-id').textContent = me.id || 'ไม่พบรหัส กรุณาปิดแล้วเปิดหน้านี้ใหม่จากแอป LINE';
    card.appendChild(who);
    if (!me.id) return;
    var actions = el('<div class="actions"></div>');
    var msg = el('<div class="msg" id="denied-msg" role="status"></div>');
    function say(text, ok) { msg.textContent = text; msg.className = 'msg ' + (ok ? 'ok' : 'err'); }
    if (canShare()) {
      var share = el('<button type="button" class="btn-theme primary" id="btn-share-id">' + iconSvg('send') + '<span>ส่งรหัสให้ผู้ดูแล</span></button>');
      share.addEventListener('click', async function () {
        share.disabled = true;
        try {
          var res = await liff.shareTargetPicker([{ type: 'text', text: accessRequestText(me.name, me.id) }], { isMultiple: false });
          if (res && res.status === 'success') say('ส่งรหัสแล้ว รอผู้ดูแลเปิดสิทธิ์ แล้วเปิดหน้านี้ใหม่', true);
          else say('ยังไม่ได้ส่ง — กดอีกครั้งเพื่อเลือกผู้ดูแล', false);
        } catch (e) {
          say('ส่งไม่สำเร็จ — กด "คัดลอกรหัส" แล้วส่งให้ผู้ดูแลเอง', false);
        }
        share.disabled = false;
      });
      actions.appendChild(share);
    }
    var copy = el('<button type="button" class="btn-theme secondary" id="btn-copy-id">' + iconSvg('copy') + '<span>คัดลอกรหัส</span></button>');
    copy.addEventListener('click', async function () {
      try {
        if (!navigator.clipboard || !navigator.clipboard.writeText) throw new Error('no clipboard');
        await navigator.clipboard.writeText(me.id);
        say('คัดลอกรหัสแล้ว', true);
      } catch (e) {
        // คัดลอกเองไม่ได้ (บางเบราว์เซอร์) → เลือกข้อความรหัสไว้ให้ กดค้างแล้วเลือก "คัดลอก"
        try { window.getSelection().selectAllChildren(card.querySelector('#denied-id')); } catch (e2) { /* ไม่เป็นไร */ }
        say('คัดลอกอัตโนมัติไม่ได้ — เลือกรหัสไว้ให้แล้ว กดค้างที่รหัสแล้วเลือก "คัดลอก"', false);
      }
    });
    actions.appendChild(copy);
    card.appendChild(actions);
    card.appendChild(msg);
  }

  /** เริ่ม LIFF — คืน true เมื่อพร้อมเรียก API (false = แสดงข้อผิดพลาดแล้ว หรือกำลังไปหน้า login) */
  async function start() {
    if (!CFG.LIFF_ID || !CFG.API_URL) { showError(MSG.notConfigured, null, 'not_configured'); return false; }
    if (typeof liff === 'undefined') { showError(MSG.sdk, reload, 'sdk'); return false; }
    loading('กำลังเชื่อมต่อ LINE…');
    var t0 = Date.now();
    try {
      await liff.init({ liffId: CFG.LIFF_ID });
    } catch (e) {
      showError(MSG.init, reload, 'init');
      return false;
    }
    timing('liff.init', Date.now() - t0);
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
      '<header><h2></h2><button type="button" class="btn ghost" data-close aria-label="ปิด">' + iconSvg('x') + '</button></header>' +
      '<div class="body"></div>' + (footerHtml ? '<footer></footer>' : '') + '</div></div>');
    back.querySelector('h2').textContent = title;
    back.querySelector('.body').innerHTML = bodyHtml;
    if (footerHtml) back.querySelector('footer').innerHTML = footerHtml;
    function close() {
      back.remove();
      document.removeEventListener('keydown', onKey);
      openSheets = openSheets.filter(function (c) { return c !== close; });
    }
    function onKey(e) { if (e.key === 'Escape') close(); }
    // ปิดด้วยการคลิก (พื้นหลัง / ปุ่ม data-close) ส่ง event "click" ต่อให้ผู้เรียกฟังได้ก่อนปิด
    back.addEventListener('click', function (e) { if (e.target === back || e.target.closest('[data-close]')) close(); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(back);
    openSheets.push(close);
    return { el: back, close: close };
  }
  var openSheets = [];

  /** ปิดแผ่นเลื่อนขึ้นทั้งหมด (เปลี่ยนหน้าจอในแอป / กดย้อนกลับ) */
  function closeSheets() {
    openSheets.slice().forEach(function (close) { close(); });
  }

  return {
    start: start, api: api, showError: showError, showApiError: showApiError, isRetryable: isRetryable,
    isDenied: isDenied, isAuthFail: isAuthFail, showDenied: showDenied, accessRequestText: accessRequestText,
    inClient: inClient, relogin: relogin, toast: toast, uuid: uuid, sheet: sheet, closeSheets: closeSheets, esc: esc, el: el, loading: loading,
    syncing: syncing, setScope: setScope, find: find, hooks: hooks,
    openExternal: openExternal, remember: remember, keep: keep, forget: forget, drop: drop,
    MSG: MSG, SETUP: SETUP, splitSetup: splitSetup, errorHtml: errorHtml
  };
})();
