/*
 * pwa.js — ติดตั้งเป็นแอปบนเครื่อง (รอบ 21) — ใช้นอก LINE เท่านั้น
 *   - ลงทะเบียน sw.js (ไม่จำไฟล์/ข้อมูลใด ๆ — มีไว้ให้เบราว์เซอร์ยอมติดตั้ง)
 *   - Android / คอมพิวเตอร์ (Chrome, Edge): เก็บ beforeinstallprompt ไว้ → ปุ่ม "ติดตั้ง" เรียกหน้าติดตั้งของเบราว์เซอร์
 *   - iPad / iPhone (Safari): ติดตั้งจากโค้ดไม่ได้ → แผ่นสอน "แชร์ → เพิ่มไปยังหน้าจอโฮม"
 *   - เปิดครั้งแรกในเบราว์เซอร์ (ยังไม่ได้ติดตั้ง) → แผ่นสอนติดตั้งขึ้นเองครั้งเดียว ("ไว้ทีหลัง" แล้วไม่ถามอีก — ยังกดได้จากเมนูหลัก)
 */
var Pwa = (function () {
  var ASKED_KEY = 'invoice-liff:install-asked';
  var deferred = null; // beforeinstallprompt ของ Chrome/Edge
  var scr = null;

  function standalone() {
    try {
      return (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
    } catch (e) { return false; }
  }
  /** iPad (iPadOS 13+ บอกตัวเองว่าเป็น Mac แต่มีจอสัมผัส) / iPhone */
  function isIos() {
    var ua = navigator.userAgent || '';
    return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  }
  function canInstall() { return !standalone() && (!!deferred || isIos()); }
  function asked() { try { return !!localStorage.getItem(ASKED_KEY); } catch (e) { return true; } }
  function markAsked() { try { localStorage.setItem(ASKED_KEY, '1'); } catch (e) { /* ไม่เป็นไร */ } }

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () { /* ติดตั้งไม่ได้ แต่ใช้งานได้ปกติ */ }); });
  }
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferred = e;
    if (scr) menu(scr);
  });
  window.addEventListener('appinstalled', function () { deferred = null; markAsked(); if (scr) menu(scr); });

  /** แผ่นสอนติดตั้ง */
  function guide() {
    markAsked();
    var ios = !deferred;
    var body = '<p style="margin:0">มีไอคอนบนหน้าจอ เปิดได้ทันทีแบบเต็มจอ ไม่ต้องเข้า LINE</p>' + (ios
      ? '<ol class="install-steps" id="install-ios"><li>แตะปุ่ม <b>แชร์</b> ' + iconSvg('share') + ' ของ Safari</li><li>เลือก <b>เพิ่มไปยังหน้าจอโฮม</b></li><li>แตะ <b>เพิ่ม</b> แล้วเปิดจากไอคอน "ออกบิล"</li></ol>' +
        '<p class="small muted" style="margin:10px 0 0">ต้องเข้าสู่ระบบ LINE ในแอปที่ติดตั้งอีก 1 ครั้ง</p>'
      : '<ol class="install-steps" id="install-android"><li>แตะ <b>ติดตั้ง</b> ด้านล่าง</li><li>ยืนยัน <b>ติดตั้งแอป</b></li><li>เปิดจากไอคอน "ออกบิล" บนหน้าจอ</li></ol>');
    var foot = ios
      ? '<button type="button" class="btn primary block" data-close>เข้าใจแล้ว</button>'
      : '<button type="button" class="btn grow" data-close>ไว้ทีหลัง</button><button type="button" class="btn primary grow" id="btn-do-install">' + iconSvg('download') + '<span>ติดตั้ง</span></button>';
    var s = LiffApp.sheet('ติดตั้งเป็นแอป', body, foot);
    s.el.classList.add('install-sheet');
    var go = s.el.querySelector('#btn-do-install');
    if (go) go.addEventListener('click', function () {
      var p = deferred;
      s.close();
      if (!p) return;
      deferred = null;
      p.prompt();
      if (p.userChoice) p.userChoice.then(function () { if (scr) menu(scr); }, function () { /* ไม่เป็นไร */ });
    });
  }

  /** เมนูหลัก (นอก LINE): ปุ่มติดตั้ง + แผ่นสอนครั้งแรก */
  function menu(s) {
    scr = s;
    var b = s.$('btn-install');
    if (!b) return;
    b.classList.toggle('hidden', !canInstall());
    if (!b.dataset.on) { b.dataset.on = '1'; b.addEventListener('click', guide); }
    if (canInstall() && !asked() && Shell.isCurrent(s) && !document.querySelector('.sheet-back')) guide();
  }

  return { menu: menu, standalone: standalone, guide: guide };
})();
