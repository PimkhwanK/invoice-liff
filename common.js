/*
 * common.js — ตัวช่วยที่หน้า LIFF (ออกบิล / เร็ว ๆ นี้) ใช้ร่วมกัน แทน Sim.* ของระบบจำลอง
 *
 *   LiffApp.start()                 liff.init → (ยังไม่ login → liff.login) → ตรวจว่ามี idToken  คืน true ถ้าพร้อมเรียก API
 *   LiffApp.api(action, payload)    POST ไป Apps Script พร้อม idToken (ไม่ส่ง userId — เซิร์ฟเวอร์ไม่เชื่ออยู่แล้ว)
 *   LiffApp.showApiError(r)         แสดงข้อผิดพลาดเต็มหน้า (ไม่มีสิทธิ์ / เชื่อมต่อไม่ได้ / หมดอายุ ...)
 *   LiffApp.inClient()              เปิดในแอป LINE หรือไม่
 *   LiffApp.toast / sheet / uuid / esc / el   เหมือน Sim.* ของระบบจำลอง
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
    var sub = document.getElementById('subtitle');
    if (sub) sub.textContent = '';
    view().replaceChildren(card);
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
    inClient: inClient, relogin: relogin, toast: toast, uuid: uuid, sheet: sheet, esc: esc, el: el
  };
})();
