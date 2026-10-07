/*
 * app.js — หน้าตรวจระบบ /check (check.html) สำหรับผู้ดูแล: LINE Login → idToken → Apps Script API (อ่านอย่างเดียว)
 *   รอบ 6: ย้ายจากหน้าแรก (index.html พาไปหน้าออกบิลแทน) ไม่มีลิงก์จากหน้าอื่น ผู้ดูแลเปิดเองที่ https://liff.line.me/<LIFF ID>/check
 *
 * ขั้นตอน: liff.init → (ยังไม่ login → liff.login) → liff.getIDToken()
 *          → เรียก homeData (คำขอเดียว: ชื่อ + ร้าน + สินค้า) → แสดงชื่อผู้ใช้ จำนวนร้าน/สินค้า และช่องค้นหาร้าน
 * ค้นหาร้านใช้ searchShops จาก search.js (สำเนาของ src/core/search.js ในระบบจำลอง)
 * ส่งเฉพาะ idToken ให้เซิร์ฟเวอร์ตรวจ ไม่ส่ง userId (เซิร์ฟเวอร์ไม่เชื่อ userId ที่ส่งมาอยู่แล้ว)
 */
(function () {
  var CFG = window.APP_CONFIG || {};
  var view = document.getElementById('view');
  var MAX_RESULTS = 50;

  // ข้อความชุดเดียวกับทุกหน้า (common.js รอบ 6 ข้อ 4: ตั้งค่าไม่ครบ → ประโยคหลัก + รายละเอียดตัวเล็ก)
  var MSG = LiffApp.MSG;

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  /**
   * แสดงข้อผิดพลาดที่ผู้ใช้เข้าใจได้
   * @param {{title:string, text:string}} m
   * @param {{label:string, run:function}} [action] ปุ่มแก้ไข เช่น ลองใหม่
   */
  function showError(m, action, code) {
    var card = el('section', 'card error');
    card.id = 'error';
    if (code) card.setAttribute('data-code', code);
    card.appendChild(el('h2', '', m.title));
    if (m.text) card.appendChild(el('p', '', m.text));
    if (m.detail) {
      var d = el('p', 'detail', m.detail);
      d.id = 'error-detail';
      card.appendChild(d);
    }
    if (m.hint) card.appendChild(el('p', 'small', m.hint));
    if (action) {
      var b = el('button', '', action.label);
      b.id = 'error-action';
      b.type = 'button';
      b.addEventListener('click', action.run);
      card.appendChild(b);
    }
    view.replaceChildren(card);
  }

  var retry = { label: 'ลองใหม่', run: function () { start(); } };
  var relogin = {
    label: 'เข้าสู่ระบบใหม่',
    run: function () {
      try { liff.logout(); } catch (e) { /* ไม่เป็นไร */ }
      liff.login({ redirectUri: location.href });
    }
  };

  /** เรียก API ของ Apps Script — text/plain กัน CORS preflight, redirect: follow เพราะ Apps Script ตอบ 302 */
  async function callApi(action, idToken) {
    var res;
    try {
      res = await fetch(CFG.API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: action, idToken: idToken }),
        redirect: 'follow',
        cache: 'no-store'
      });
    } catch (e) {
      return { ok: false, code: 'network' };
    }
    if (!res.ok) return { ok: false, code: 'http' };
    try {
      var data = await res.json();
      return data && typeof data === 'object' ? data : { ok: false, code: 'bad_response' };
    } catch (e) {
      return { ok: false, code: 'bad_response' };
    }
  }

  /** แปลงคำตอบที่ไม่สำเร็จเป็นข้อความและปุ่มที่เหมาะสม */
  function showApiError(r) {
    if (r.code === 'network') return showError(MSG.network, retry, r.code);
    if (r.code === 'http') return showError(MSG.http, retry, r.code);
    if (r.code === 'bad_response') return showError(MSG.badResponse, retry, r.code);
    // ไม่มีสิทธิ์ → หน้าเดียวกับทุกหน้า (common.js รอบ 6 ข้อ 3: ขอสิทธิ์ / บัญชีถูกปิด)
    if (LiffApp.isDenied(r.code)) return LiffApp.showDenied(r.code);
    if (r.code === 'no_token' || r.code === 'token_invalid') {
      return showError({ title: 'ยืนยันตัวตนไม่ได้', text: 'ยืนยันตัวตนกับ LINE ไม่สำเร็จ กรุณาปิดหน้านี้แล้วเปิดใหม่จากแชท LINE' }, relogin, r.code);
    }
    if (r.code === 'token_expired') return showError({ title: 'การเข้าสู่ระบบหมดอายุ', text: r.error }, relogin, r.code);
    var setup = LiffApp.splitSetup(r.error);
    if (setup || r.code === 'config') return showError({ title: LiffApp.SETUP, text: '', detail: setup ? setup.detail : (r.error || '') }, retry, r.code);
    return showError({ title: 'เกิดข้อผิดพลาด', text: r.error || 'กรุณาลองใหม่อีกครั้ง' }, retry, r.code);
  }

  function render(name, shops, products) {
    var open = shops.filter(function (s) { return s.active; }).length;
    var frag = document.createDocumentFragment();

    var hello = el('section', 'card');
    hello.id = 'hello';
    var ok = el('h2', 'ok-title');
    ok.innerHTML = iconSvg('ok');
    ok.appendChild(el('span', '', 'เชื่อมต่อสำเร็จ'));
    hello.appendChild(ok);
    var who = el('div', '', 'ผู้ใช้: ');
    var b = el('b', '', name);
    b.id = 'user-name';
    who.appendChild(b);
    hello.appendChild(who);
    var stats = el('div', 'stats');
    var s1 = el('div', 'stat');
    s1.id = 'stat-shops';
    s1.appendChild(el('b', '', String(shops.length)));
    s1.appendChild(el('span', 'small muted', 'ร้านค้า (เปิด ' + open + ' / ปิด ' + (shops.length - open) + ')'));
    var s2 = el('div', 'stat');
    s2.id = 'stat-products';
    s2.appendChild(el('b', '', String(products.length)));
    s2.appendChild(el('span', 'small muted', 'สินค้าที่ขายอยู่'));
    stats.appendChild(s1);
    stats.appendChild(s2);
    hello.appendChild(stats);
    frag.appendChild(hello);

    var box = el('section', 'card');
    box.appendChild(el('h2', '', 'ค้นหาร้าน'));
    var input = el('input');
    input.type = 'search';
    input.id = 'shop-search';
    input.placeholder = 'ชื่อร้าน ชื่อเต็ม หรือเลขภาษี';
    input.autocomplete = 'off';
    input.setAttribute('aria-label', 'ค้นหาร้าน');
    box.appendChild(input);
    var count = el('div', 'small muted');
    count.id = 'result-count';
    box.appendChild(count);
    var list = el('ul', 'shops');
    list.id = 'shop-results';
    box.appendChild(list);
    frag.appendChild(box);

    function update() {
      var found = searchShops(shops, input.value);
      count.textContent = 'พบ ' + found.length + ' ร้าน' + (found.length > MAX_RESULTS ? ' (แสดง ' + MAX_RESULTS + ' ร้านแรก)' : '');
      list.replaceChildren();
      found.slice(0, MAX_RESULTS).forEach(function (s) {
        var li = el('li');
        var n = el('div', 'shop-name', s.short_name || s.legal_name || ('ร้านลำดับ ' + s.shop_id));
        if (!s.active) n.appendChild(el('span', 'badge', 'ปิด'));
        li.appendChild(n);
        var sub = [s.legal_name, s.tax_id ? 'เลขภาษี ' + s.tax_id : ''].filter(Boolean).join(' · ');
        if (sub) li.appendChild(el('div', 'small muted', sub));
        list.appendChild(li);
      });
    }
    input.addEventListener('input', update);
    update();
    view.replaceChildren(frag);
  }

  async function start() {
    view.replaceChildren(el('div', 'card empty', 'กำลังเชื่อมต่อ LINE…'));
    if (!CFG.LIFF_ID || !CFG.API_URL) return showError(MSG.notConfigured, null, 'not_configured');
    if (typeof liff === 'undefined') return showError(MSG.sdk, { label: 'ลองใหม่', run: function () { location.reload(); } }, 'sdk');
    // มี ?liff.state → liff.init พาไปหน้าอื่นเอง จึงไม่ต้องเรียก API (ปกติ index.html จัดการ เผื่อเปิดหน้านี้เป็นหน้าแรก)
    var goingElsewhere = new URLSearchParams(location.search).has('liff.state');
    try {
      await liff.init({ liffId: CFG.LIFF_ID });
    } catch (e) {
      return showError(MSG.init, { label: 'ลองใหม่', run: function () { location.reload(); } }, 'init');
    }
    if (goingElsewhere) return;
    if (!liff.isLoggedIn()) {
      liff.login({ redirectUri: location.href });
      return;
    }
    var idToken = liff.getIDToken();
    if (!idToken) return showError(MSG.noToken, relogin, 'no_id_token');

    view.replaceChildren(el('div', 'card empty', 'กำลังโหลดชื่อผู้ใช้ ร้านค้า และสินค้า…'));
    var r = await callApi('homeData', idToken); // คำขอเดียว (รอบที่ 5A)
    if (!r.ok) return showApiError(r);
    render(r.name, r.shops || [], r.products || []);
  }

  start();
})();
