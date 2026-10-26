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
 * รอบ 10: LiffApp.MODE ('cash' ใบเงินสด / 'tax' ใบกำกับภาษี) จาก ?type= — ทุกคำขอส่ง type / docParam, sameNo ใช้กับเลขที่ทั้งสองแบบ
 *
 * fetch ด้วย Content-Type text/plain (ไม่เกิด CORS preflight ที่ Apps Script ตอบไม่ได้) และตาม redirect 302 ของ Apps Script
 */
var LiffApp = (function () {
  var CFG = window.APP_CONFIG || {};
  var hooks = { timing: null, denied: null, debugOn: null, server: null };
  var scope = null; // function → scr ของหน้าจอที่แสดงอยู่ (shell.js ตั้ง)

  /**
   * รอบ 10: โหมดเอกสารของการเปิดแอปครั้งนี้ (เปลี่ยนจาก Rich Menu เท่านั้น ไม่มีปุ่มสลับในแอป)
   *   ?type=cash → ใบเงินสด / ?type=tax → ใบกำกับภาษี
   *   ไม่มี ?type= → ใบเงินสด (ใช้บ่อยกว่า) ยกเว้นหน้าดู PDF (view?no=…) จากการ์ดบิลเดิมในแชท = ใบกำกับภาษี
   * ทุกคำขอส่ง type ไปด้วย / ข้อมูลที่จำไว้แยกตามโหมด / body มี class mode-cash หรือ mode-tax (theme.css เปลี่ยนสีหลัก)
   */
  var MODE = (function () {
    var q = new URLSearchParams(location.search);
    var t = q.get('type');
    if (t === 'cash' || t === 'tax') return t;
    var page = location.pathname.split('/').pop().replace(/\.html$/, '');
    if (page === 'check') return 'tax'; // หน้าตรวจระบบ (ผู้ดูแล) เรียก action ของใบกำกับ
    if (page === 'summary' || page === 'stock' || page === 'menu' || page === '' || page === 'index') return 'tax'; // รอบ 15: หน้าสรุป (ทั้งสองประเภท) เรียก summaryData ใน Api.gs / รอบ 21: เมนูหลัก
    return page === 'view' && q.has('no') ? 'tax' : 'cash';
  })();
  var MODE_LABEL = MODE === 'cash' ? 'ใบเงินสด' : 'ใบกำกับภาษี';
  if (document.body) document.body.classList.add('mode-' + MODE);
  function isCash() { return MODE === 'cash'; }
  /** เลขที่สำหรับส่งเซิร์ฟเวอร์ / เทียบ: ใบเงินสด = ข้อความ ("1069-15") / ใบกำกับ = ตัวเลข */
  function docParam(no) { return MODE === 'cash' ? String(no) : Number(no); }
  /** เลขที่สองค่าเป็นใบเดียวกันไหม (ทั้งสองโหมด) */
  function sameNo(a, b) { return String(a) === String(b); }

  // ---------- รอบ 24: ใบกำกับ — เลขที่ซ้ำได้ถ้าคนละประเภท (ใบกำกับภาษี 25 + ใบเสร็จรับเงิน 25) / ใบเงินสดไม่มีประเภท
  function typeText(v) { return v === undefined || v === null ? '' : String(v).trim(); }
  /** แถวเอกสาร x คือบิล (no, type) ไหม — type '' = ไม่ระบุ / 0000 ไม่สนประเภท / ใบเงินสดเทียบเลขที่อย่างเดียว */
  function sameDoc(x, no, type) {
    if (!x || !sameNo(x.doc_no, no)) return false;
    if (MODE === 'cash' || Number(no) === 0 || !typeText(type)) return true;
    return !typeText(x.doc_type) || typeText(x.doc_type) === typeText(type);
  }
  /** ประเภท → ค่าในลิงก์ (?dt=) : ใบเสร็จรับเงิน = rc / ประเภทแรก (ใบกำกับภาษี) = '' ไม่ใส่ (ลิงก์เดิม) / อื่น ๆ = ชื่อเต็ม */
  function dtCode(type) {
    var t = typeText(type);
    if (MODE === 'cash' || !t || t === DEFAULT_DOC_TYPES[0]) return '';
    return t === TAX_RECEIPT_TYPE ? 'rc' : t;
  }
  /** ค่าใน ?dt= → ประเภท ('' = ไม่ระบุ — เซิร์ฟเวอร์เลือกใบที่ไม่ใช่ใบเสร็จ) */
  function dtType(code) {
    var c = typeText(code);
    return c === 'rc' ? TAX_RECEIPT_TYPE : c;
  }
  /** ลิงก์หน้าดู PDF ของบิล (no, type) */
  function viewHref(no, type) {
    var dt = Number(no) === 0 ? '' : dtCode(type);
    return 'view?no=' + encodeURIComponent(String(no)) + (dt ? '&dt=' + encodeURIComponent(dt) : '');
  }
  /** ข้อความบิล: "#25" / "#25 ใบเสร็จรับเงิน" (ใบเสร็จบอกประเภทเสมอ เลขอาจซ้ำกับใบกำกับ) */
  function docLabel(no, type) {
    return '#' + docNoText(no) + (MODE !== 'cash' && Number(no) !== 0 && typeText(type) === TAX_RECEIPT_TYPE ? ' ' + TAX_RECEIPT_TYPE : '');
  }

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
   * ระบบตั้งค่าไม่ครบ/ผิด → "ระบบยังไม่พร้อมใช้งาน" + "กรุณาแจ้งผู้ดูแลระบบ" (รอบ 9: ไม่แสดงรายละเอียดทางเทคนิคบนจอ — อยู่ใน console)
   * เซิร์ฟเวอร์ (Api.gs API_SETUP) ส่ง "<ประโยคนี้>\n<รายละเอียด>" → splitSetup แยกให้ / รับข้อความแบบเดิมของเซิร์ฟเวอร์รุ่นเก่าด้วย
   */
  var SETUP = 'ระบบยังไม่พร้อมใช้งาน';
  var SETUP_TEXT = 'กรุณาแจ้งผู้ดูแลระบบ';
  var SETUP_PREFIXES = ['ระบบยังไม่พร้อมใช้งาน กรุณาแจ้งผู้ดูแลระบบ', 'ระบบยังตั้งค่าไม่ครบ กรุณาแจ้งผู้ดูแลระบบ'];
  var FOR_ADMIN = 'รายละเอียดสำหรับผู้ดูแลระบบ: ';
  var NL = String.fromCharCode(10);
  var RETRY = 'ลองอีกครั้ง';

  var MSG = {
    notConfigured: { title: SETUP, text: SETUP_TEXT, detail: FOR_ADMIN + 'ยังไม่ได้ใส่ LIFF_ID หรือ API_URL ในไฟล์ config.js' },
    sdk: { title: 'เชื่อมต่อไม่สำเร็จ', text: 'ตรวจสอบอินเทอร์เน็ต แล้วลองอีกครั้ง' },
    init: { title: 'เปิดหน้าไม่สำเร็จ', text: 'ตรวจสอบอินเทอร์เน็ต แล้วลองอีกครั้ง', detail: FOR_ADMIN + 'liff.init ไม่สำเร็จ (LIFF_ID ใน config.js อาจไม่ถูกต้อง)' },
    noToken: { title: SETUP, text: SETUP_TEXT, detail: FOR_ADMIN + 'ไม่ได้รับ ID token จาก LINE (LIFF app ต้องเปิด scope openid)' },
    network: { title: 'เชื่อมต่อไม่สำเร็จ', text: RETRY },
    http: { title: 'เชื่อมต่อไม่สำเร็จ', text: RETRY },
    badResponse: { title: SETUP, text: SETUP_TEXT, detail: FOR_ADMIN + 'คำตอบไม่ใช่ข้อมูลของระบบ (ตรวจ API_URL ใน config.js และ Web app ต้องตั้ง Who has access เป็น Anyone)' }
  };
  /** ข้อความของคำตอบ (r.error) จาก MSG — แบบตั้งค่าไม่ครบ = ประโยคหลัก + ขึ้นบรรทัด + รายละเอียด (รายละเอียดไม่แสดงบนจอ) */
  function msgText(m) { return m.title === SETUP ? SETUP_PREFIXES[0] + NL + m.detail : m.title + ' ' + m.text; }

  /** "ระบบยังไม่พร้อมใช้งาน…\nรายละเอียด" → { detail } / ข้อความอื่น → null */
  function splitSetup(text) {
    text = String(text == null ? '' : text);
    for (var i = 0; i < SETUP_PREFIXES.length; i++) {
      if (text.indexOf(SETUP_PREFIXES[i]) === 0) return { detail: text.slice(SETUP_PREFIXES[i].length).replace(/^\s+/, '') };
    }
    return null;
  }

  /** รายละเอียดทางเทคนิค → console เท่านั้น (ผู้ดูแลเปิดดูได้) */
  function logDetail(detail) {
    if (!detail) return;
    try { console.error('[ผู้ดูแลระบบ] ' + detail); } catch (e) { /* ไม่เป็นไร */ }
  }

  /** รอบ 9: ตัดรหัสอ้างอิง (รหัส E-1234) ออกจากข้อความที่แสดง (ยังอยู่ในบันทึกของ Apps Script) */
  function cleanError(text) {
    return String(text == null ? '' : text).replace(/\s*\(?รหัส E-[0-9]+\)?/g, '');
  }

  /**
   * ข้อความผิดพลาดในกล่องเล็ก (.alert) เป็น HTML: ตั้งค่าไม่ครบ → ประโยคหลักตัวหนา + "กรุณาแจ้งผู้ดูแลระบบ" / อื่น ๆ → ขึ้นบรรทัดตาม \n
   */
  function errorHtml(text) {
    var s = splitSetup(text);
    if (s) { logDetail(s.detail); return '<b>' + esc(SETUP) + '</b> ' + esc(SETUP_TEXT); }
    return esc(cleanError(text)).split(NL).join('<br>');
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
      'ใช้เวลานานกว่าปกติ กรุณารอสักครู่</div></div>');
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
    if (m.text) card.querySelector('p').textContent = cleanError(m.text);
    else card.querySelector('p').remove();
    logDetail(m.detail); // รอบ 9: รายละเอียดทางเทคนิคไม่แสดงบนจอ อยู่ใน console
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
        if (k && (k.indexOf(STORE_PREFIX) === 0 || k === 'invoice-liff:active')) keys.push(k); // รอบ 21: + เวลาที่ใช้งานล่าสุด
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
    s = el('<div class="sync" id="sync" role="status"><span class="spinner sm" aria-hidden="true"></span> กำลังอัปเดตข้อมูล…</div>');
    bar.appendChild(s);
  }

  var reload = { label: RETRY, run: function () { location.reload(); } };
  var relogin = {
    label: 'เข้าสู่ระบบใหม่',
    run: function () {
      try { liff.logout(); } catch (e) { /* ไม่เป็นไร */ }
      liff.login({ redirectUri: location.href });
    }
  };

  // ---------- รอบ 21: ใช้นอก LINE (เบราว์เซอร์ / แอปที่ติดตั้ง)
  //   - การเข้าสู่ระบบหมดอายุ → เข้าสู่ระบบใหม่เองอัตโนมัติ 1 ครั้ง (กันวน: ไม่ทำซ้ำภายใน 2 นาที) แล้วกลับหน้าเดิม
  //   - ไม่ได้ใช้งานเกิน IDLE_MS (30 วัน — ผู้ใช้เปลี่ยนจาก 8 ชั่วโมง 2026-10-25) → ออกจากระบบ + ล้างข้อมูลที่จำไว้ ต้องเข้าสู่ระบบใหม่
  //   - ปุ่มออกจากระบบ (เครื่องที่ใช้ร่วมกัน) → ล้างการเข้าสู่ระบบ + ข้อมูลที่จำไว้ทั้งหมด
  //   ทุกคำขอยังตรวจ idToken + แท็บผู้ใช้ที่เซิร์ฟเวอร์เหมือนเดิม (ส่วนนี้ลดความเสี่ยงบนเครื่อง ไม่ได้แทนการตรวจที่เซิร์ฟเวอร์)
  var IDLE_MS = 30 * 24 * 3600 * 1000;
  var ACTIVE_KEY = 'invoice-liff:active';    // เวลาที่ใช้งานล่าสุด (ไม่ใช่ข้อมูลส่วนตัว)
  var RELOGIN_KEY = 'invoice-liff:relogin';  // sessionStorage: เวลาที่พาไปเข้าสู่ระบบใหม่เองครั้งล่าสุด
  var OUT_KEY = 'invoice-liff:out';          // sessionStorage: เหตุที่ออกจากระบบ ('logout' | 'idle') → หน้า "ออกจากระบบแล้ว"
  function nowMs() { return Date.now(); }
  function sget(store, k) { try { return store.getItem(k); } catch (e) { return null; } }
  function sset(store, k, v) { try { if (v === null) store.removeItem(k); else store.setItem(k, v); } catch (e) { /* ไม่เป็นไร */ } }
  var lastTouch = 0;
  function touch() {
    var t = nowMs();
    if (t - lastTouch < 30000) return; // เขียนไม่เกินทุก 30 วินาที
    lastTouch = t;
    if (storeOk()) sset(localStorage, ACTIVE_KEY, String(t));
  }
  function idleTooLong() {
    var t = storeOk() ? Number(sget(localStorage, ACTIVE_KEY)) : 0;
    return !!t && nowMs() - t > IDLE_MS;
  }
  /** ออกจากระบบ: ล้างการเข้าสู่ระบบ + ข้อมูลที่จำไว้ทั้งหมด แล้วแสดงหน้า "ออกจากระบบแล้ว" (why: 'logout' | 'idle') */
  function logout(why) {
    forget();
    if (storeOk()) sset(localStorage, ACTIVE_KEY, null);
    if (window.AppData && AppData.clear) { try { AppData.clear(); } catch (e) { /* ไม่เป็นไร */ } }
    try { liff.logout(); } catch (e) { /* ไม่เป็นไร */ }
    sset(sessionStorage, OUT_KEY, why || 'logout');
    location.replace(appUrl('menu'));
  }
  /** หน้า "ออกจากระบบแล้ว" — ไม่พาไปหน้าเข้าสู่ระบบเอง (คนถัดไปที่ใช้เครื่องกดเอง) */
  function showLoggedOut(why) {
    var card = el('<section class="card alert ok" id="logged-out"><h2></h2><p></p></section>');
    card.querySelector('h2').textContent = why === 'idle' ? 'ไม่ได้ใช้งานนาน' : 'ออกจากระบบแล้ว';
    card.querySelector('p').textContent = why === 'idle' ? 'กรุณาเข้าสู่ระบบอีกครั้ง' : 'ข้อมูลที่จำไว้ในเครื่องนี้ถูกลบแล้ว';
    var b = el('<button type="button" class="btn primary block" id="btn-login">เข้าสู่ระบบด้วย LINE</button>');
    b.addEventListener('click', function () { sset(sessionStorage, OUT_KEY, null); liff.login({ redirectUri: appUrl('menu') }); });
    card.appendChild(b);
    // การเข้าสู่ระบบ LINE: เครื่องที่มีแอป LINE จะเปิดแอป LINE ให้กดอนุญาต (LINE ทำให้เอง — ไม่ต้องพิมพ์รหัสผ่าน)
    card.appendChild(el('<p class="small muted" id="login-hint">เครื่องที่มีแอป LINE จะเปิดแอป LINE ให้กดอนุญาต</p>'));
    view().replaceChildren(card);
  }
  /** การเข้าสู่ระบบหมดอายุนอก LINE → เข้าใหม่เอง (คืน true = กำลังพาไป) / ทำไปแล้วภายใน 2 นาที → false (แสดงปุ่มแทน กันวน) */
  function autoRelogin() {
    if (inClient()) return false;
    var last = Number(sget(sessionStorage, RELOGIN_KEY)) || 0;
    if (nowMs() - last < 120000) return false;
    sset(sessionStorage, RELOGIN_KEY, String(nowMs()));
    try { liff.logout(); } catch (e) { /* ไม่เป็นไร */ }
    liff.login({ redirectUri: location.href });
    return true;
  }
  /** idToken บนเครื่องหมดอายุแล้ว (หรือเหลือไม่ถึง 1 นาที) */
  function tokenExpired() {
    var d = null;
    try { d = liff.getDecodedIDToken(); } catch (e) { d = null; }
    return !!(d && typeof d.exp === 'number' && d.exp * 1000 - nowMs() < 60000);
  }
  /** URL ของหน้าในแอป (โฟลเดอร์เดียวกับหน้านี้) เช่น appUrl('menu') */
  function appUrl(name) { return new URL(name, location.href).href.split('?')[0].split('#')[0]; }
  /** ใน LINE: เปิดเมนูหลักในเบราว์เซอร์ของเครื่อง (เต็มจอ) */
  function openFullScreen() {
    try { liff.openWindow({ url: appUrl('menu'), external: true }); } catch (e) { toast('เปิดไม่สำเร็จ ลองอีกครั้ง', true); }
  }
  /** ลิงก์กลับไปแชท LINE ของร้าน (APP_CONFIG.LINE_OA_ID เช่น @abc1234) — ไม่ได้ตั้ง → '' */
  function lineChatUrl() {
    var id = String(CFG.LINE_OA_ID || '').trim();
    return /^@[A-Za-z0-9._-]{2,40}$/.test(id) ? 'https://line.me/R/ti/p/' + encodeURIComponent(id) : '';
  }
  /**
   * รอบ 29: คำสั่งในแชทที่บอทตอบเป็นการ์ดของบิล — "เงินสด 1069-15" / "ใบเสร็จ 25" (เลขซ้ำกับใบกำกับได้) / "บิล 25"
   */
  function chatCommand(no, type) {
    if (MODE === 'cash') return 'เงินสด ' + docNoText(no);
    return (Number(no) !== 0 && typeText(type) === TAX_RECEIPT_TYPE ? 'ใบเสร็จ ' : 'บิล ') + docNoText(no);
  }
  /** รอบ 29: ลิงก์เปิดแชท OA พร้อมพิมพ์ข้อความไว้ให้ (ผู้ใช้กดส่งเอง บอทตอบด้วย reply — ไม่ใช้ push) / ไม่ได้ตั้ง LINE_OA_ID → '' */
  function oaMessageUrl(text) {
    var id = String(CFG.LINE_OA_ID || '').trim();
    if (!/^@[A-Za-z0-9._-]{2,40}$/.test(id)) return '';
    return 'https://line.me/R/oaMessage/' + encodeURIComponent(id) + '/?' + encodeURIComponent(text);
  }
  /** รอบ 29: นอก LINE เปิดแชทพร้อมข้อความเอง — คืน true ถ้าเบราว์เซอร์เปิดให้ (ถูกบล็อก → false หน้าเว็บแสดงปุ่มแทน) */
  function openChat(text) {
    var url = oaMessageUrl(text);
    if (!url) return false;
    try {
      var w = window.open(url, '_blank');
      if (!w) return false;
      try { w.opener = null; } catch (e) { /* ไม่เป็นไร */ }
      return true;
    } catch (e) { return false; }
  }
  /** ชื่อ LINE ของผู้ที่เข้าสู่ระบบ (จาก idToken บนเครื่อง) */
  function profileName() { return lineIdentity().name; }
  // ใช้งานอยู่ (แตะ / พิมพ์) → จดเวลา / กลับมาที่แอปหลังไม่ได้ใช้นาน → ออกจากระบบ / token ใกล้หมด → เข้าใหม่เองก่อนกรอกฟอร์ม
  document.addEventListener('pointerdown', touch, true);
  document.addEventListener('keydown', touch, true);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible' || inClient() || typeof liff === 'undefined') return;
    var loggedIn = false;
    try { loggedIn = liff.isLoggedIn(); } catch (e) { loggedIn = false; }
    if (!loggedIn) return;
    if (idleTooLong()) return logout('idle');
    if (tokenExpired()) autoRelogin();
  });

  /** เรียก API ของ Apps Script — คืน {ok:false, code:'network'|'http'|'bad_response'} ถ้าติดต่อไม่ได้ */
  async function api(action, payload) {
    var idToken = '';
    try { idToken = liff.getIDToken() || ''; } catch (e) { idToken = ''; }
    var body = Object.assign({}, payload || {}, { action: action, idToken: idToken, type: (payload && payload.type) || MODE }); // รอบ 10: ประเภทเอกสาร (รอบ 21: หน้าเลือกเองได้)
    var debug = !!(hooks.debugOn && hooks.debugOn());
    if (debug) body.debug = true; // แถบเวลา ?debug=1: ขอเวลาแยกขั้นของเซิร์ฟเวอร์ (serverTiming) มาด้วย
    var t0 = Date.now();
    try {
      var r = await apiFetch(body);
      // รอบ 9: คำตอบผิดรูป (เช่น ครั้งแรกหลังผู้ดูแลกด New version) — เครื่องนี้เคยเชื่อมต่อสำเร็จแล้ว → ส่งคำขอเดิมใหม่ 1 ครั้ง
      // (requestId เดิมอยู่ใน body → createDocument ไม่ออกบิลซ้ำ)
      if (r && r.code === 'bad_response' && wasConnected()) {
        try { console.warn('[เชื่อมต่อ] ' + action + ' ได้คำตอบผิดรูป ส่งใหม่อีกครั้ง'); } catch (e) { /* ไม่เป็นไร */ }
        r = await apiFetch(body);
        if (r && r.code === 'bad_response') r = { ok: false, code: 'bad_response', error: msgText(MSG.network), connected: true };
      }
      if (r && r.code !== 'bad_response' && r.code !== 'network' && r.code !== 'http') markConnected();
      if (r && !r.ok && typeof r.error === 'string') r.error = cleanError(r.error);
      if (r && !r.ok && AUTH_FAIL[r.code]) forget(); // ไม่มีสิทธิ์ → ลืมทุกอย่างที่จำไว้บนเครื่องนี้
      if (r && !r.ok && (r.code === 'token_expired' || r.code === 'token_invalid') && autoRelogin()) return new Promise(function () { /* กำลังไปหน้าเข้าสู่ระบบ */ });
      if (r && r.ok) touch();
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

  /** รอบ 9: เครื่องนี้เคยได้คำตอบปกติจากเซิร์ฟเวอร์แล้ว (ไม่แยกบัญชี ไม่ใช่ข้อมูลส่วนตัว) */
  var CONNECTED_KEY = STORE_PREFIX + 'connected'; // ล้างพร้อมข้อมูลอื่นเมื่อไม่มีสิทธิ์ (forget)
  var connectedNow = false;
  function wasConnected() {
    if (connectedNow) return true;
    try { return !!(storeOk() && localStorage.getItem(CONNECTED_KEY)); } catch (e) { return false; }
  }
  function markConnected() {
    if (connectedNow) return;
    connectedNow = true;
    try { if (storeOk()) localStorage.setItem(CONNECTED_KEY, '1'); } catch (e) { /* ไม่เป็นไร */ }
  }

  /** ติดต่อเซิร์ฟเวอร์ไม่ได้ชั่วคราว (ลองอีกครั้งได้ด้วยข้อมูลเดิม) */
  function isRetryable(r) {
    return r.code === 'network' || r.code === 'http' || r.code === 'bad_response' || r.code === 'busy' || r.code === 'verify_unavailable' || r.code === 'server';
  }

  /** แปลงคำตอบที่ไม่สำเร็จเป็นข้อความเต็มหน้า */
  function showApiError(r, scr) {
    if (r.code === 'network') return showError(MSG.network, reload, r.code, scr);
    if (r.code === 'http') return showError(MSG.http, reload, r.code, scr);
    if (r.code === 'bad_response') return showError(r.connected || wasConnected() ? MSG.network : MSG.badResponse, reload, r.code, scr);
    if (isDenied(r.code)) return showDenied(r.code, scr);
    if (r.code === 'no_token' || r.code === 'token_invalid') {
      return showError({ title: 'เข้าสู่ระบบไม่สำเร็จ', text: 'ปิดหน้านี้ แล้วเปิดใหม่จากแชท LINE' }, relogin, r.code, scr);
    }
    if (r.code === 'token_expired') return showError({ title: 'การเข้าสู่ระบบหมดอายุ', text: 'ปิดหน้านี้ แล้วเปิดใหม่จากแชท LINE' }, relogin, r.code, scr);
    // ตั้งค่าไม่ครบ (code config หรือข้อความแบบ API_SETUP) — เซิร์ฟเวอร์รุ่นเก่าส่งข้อความเดิม → ทั้งข้อความเป็นรายละเอียด (console)
    var s = splitSetup(r.error);
    if (s || r.code === 'config') return showError({ title: SETUP, text: SETUP_TEXT, detail: s ? s.detail : (r.error || '') }, reload, r.code, scr);
    return showError({ title: 'เกิดข้อผิดพลาด', text: cleanError(r.error) || RETRY }, reload, r.code, scr);
  }

  // ---------- หน้าไม่มีสิทธิ์ใช้งาน (รอบ 6 ข้อ 3 — สีจาก theme.css)
  /** ข้อความที่ส่งให้ผู้ดูแลผ่าน shareTargetPicker (มีรหัสและวิธีเพิ่มสิทธิ์ — เฉพาะข้อความนี้ที่พูดถึงแท็บผู้ใช้) */
  function accessRequestText(name, id) {
    return ['ขอสิทธิ์ใช้งานระบบออกบิล', 'ชื่อ: ' + (name || '-'), 'รหัส: ' + id, '', 'ผู้ดูแล: เพิ่มรหัสนี้ในแท็บ "ผู้ใช้"'].join(String.fromCharCode(10));
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
    card.querySelector('h2').textContent = disabled ? 'บัญชีนี้ถูกปิดการใช้งาน' : 'ยังไม่มีสิทธิ์ใช้งาน';
    card.querySelector('p').textContent = disabled ? 'กรุณาติดต่อผู้ดูแลระบบ' : 'ส่งรหัสด้านล่างให้ผู้ดูแลระบบ';
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
    who.querySelector('#denied-id').textContent = me.id || 'ไม่พบรหัส ปิดหน้านี้ แล้วเปิดใหม่จากแอป LINE';
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
          else say('ยังไม่ได้ส่ง กดอีกครั้งเพื่อเลือกผู้ดูแล', false);
        } catch (e) {
          say('ส่งไม่สำเร็จ กด "คัดลอกรหัส" แล้วส่งให้ผู้ดูแลเอง', false);
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
        say('คัดลอกไม่สำเร็จ กดค้างที่รหัส แล้วเลือก "คัดลอก"', false);
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
    var out = sget(sessionStorage, OUT_KEY);
    if (!liff.isLoggedIn()) {
      if (out) { showLoggedOut(out); return false; } // รอบ 21: เพิ่งออกจากระบบ → ไม่เข้าสู่ระบบเอง
      liff.login({ redirectUri: location.href });
      return false;
    }
    sset(sessionStorage, OUT_KEY, null);
    if (!inClient()) {
      if (idleTooLong()) { logout('idle'); return false; } // รอบ 21: ไม่ได้ใช้งานเกิน 30 วัน
      if (tokenExpired() && autoRelogin()) return false;
    }
    touch();
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
  /** รอบ 8: เลขที่สำหรับแสดง — 0 = บิลทดสอบ "0000" (ตรงกับ botDocNoText ใน LineBot.gs) */
  function docNoText(n) {
    return Number(n) === 0 && String(n).trim() !== '' ? '0000' : String(n);
  }

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
    var opener = document.activeElement; // รอบ 20: ปิดแล้วคืนโฟกัสให้ปุ่มที่เปิด (คีย์บอร์ด)
    function close() {
      back.remove();
      document.removeEventListener('keydown', onKey);
      openSheets = openSheets.filter(function (c) { return c !== close; });
      if (opener && opener.isConnected && opener.focus && (!document.activeElement || document.activeElement === document.body)) opener.focus();
    }
    // รอบ 20: Esc ปิด / Tab วนอยู่ในแผ่น / Enter ในช่องค้นหา = เลือกรายการแรก
    function onKey(e) {
      if (openSheets[openSheets.length - 1] !== close) return; // แผ่นบนสุดเท่านั้น
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      if (e.key === 'Tab') {
        var all = Array.prototype.filter.call(back.querySelectorAll('button, input, select, textarea, [tabindex="0"]'), function (x) {
          return !x.disabled && x.offsetParent !== null;
        });
        if (!all.length) return;
        var first = all[0], last = all[all.length - 1];
        if (!back.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
        else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        return;
      }
      if (e.key === 'Enter' && e.target.matches && e.target.matches('input[type=search]') && back.contains(e.target)) {
        var li = back.querySelector('li.tap');
        if (li) { e.preventDefault(); li.click(); }
      }
    }
    // ปิดด้วยการคลิก (พื้นหลัง / ปุ่ม data-close) ส่ง event "click" ต่อให้ผู้เรียกฟังได้ก่อนปิด
    back.addEventListener('click', function (e) { if (e.target === back || e.target.closest('[data-close]')) close(); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(back);
    openSheets.push(close);
    return { el: back, close: close };
  }
  var openSheets = [];

  // รอบ 20: รายการที่แตะได้ (li.tap role=button tabindex=0) กด Enter / Space = แตะ
  // (รายการแบบลิงก์ role=link ของหน้าสรุป/สต็อก มีตัวจัดการ Enter ของตัวเอง)
  document.addEventListener('keydown', function (e) {
    var t = e.target;
    if ((e.key === 'Enter' || e.key === ' ') && t && t.matches && t.matches('li.tap[role=button]')) {
      e.preventDefault();
      t.click();
    }
  });

  /** ปิดแผ่นเลื่อนขึ้นทั้งหมด (เปลี่ยนหน้าจอในแอป / กดย้อนกลับ) */
  function closeSheets() {
    openSheets.slice().forEach(function (close) { close(); });
  }

  return {
    start: start, api: api, showError: showError, showApiError: showApiError, isRetryable: isRetryable,
    isDenied: isDenied, isAuthFail: isAuthFail, showDenied: showDenied, accessRequestText: accessRequestText,
    inClient: inClient, relogin: relogin, toast: toast, uuid: uuid, docNoText: docNoText, sheet: sheet, closeSheets: closeSheets, esc: esc, el: el, loading: loading,
    MODE: MODE, MODE_LABEL: MODE_LABEL, isCash: isCash, docParam: docParam, sameNo: sameNo,
    sameDoc: sameDoc, dtCode: dtCode, dtType: dtType, viewHref: viewHref, docLabel: docLabel, // รอบ 24
    syncing: syncing, setScope: setScope, find: find, hooks: hooks,
    openExternal: openExternal, remember: remember, keep: keep, forget: forget, drop: drop,
    MSG: MSG, SETUP: SETUP, splitSetup: splitSetup, errorHtml: errorHtml,
    logout: logout, openFullScreen: openFullScreen, lineChatUrl: lineChatUrl, profileName: profileName, appUrl: appUrl, IDLE_MS: IDLE_MS,
    chatCommand: chatCommand, oaMessageUrl: oaMessageUrl, openChat: openChat // รอบ 29
  };
})();
