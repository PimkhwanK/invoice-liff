/*
 * menu.js — หน้าเมนูหลัก (รอบ 21): ปุ่มใหญ่ ใบเงินสด / ใบกำกับภาษี / สต็อก / สรุป
 *   หน้าแรกของแอปทั้งใน LINE และนอก LINE (index.html → menu) / ทุกหน้ามีปุ่ม "เมนูหลัก" บนหัว (shell.js)
 *   ใน LINE: ปุ่ม "เปิดแบบเต็มจอ" (liff.openWindow external → เบราว์เซอร์ของเครื่องที่หน้านี้)
 *   นอก LINE: ปุ่ม "ออกจากระบบ" / "ติดตั้งเป็นแอป" (pwa.js) / "กลับไปแชท LINE" (APP_CONFIG.LINE_OA_ID — ไม่ใส่ = ไม่มีปุ่ม)
 *   ชื่อผู้ใช้มาจากแท็บผู้ใช้ (whoami ตรวจสิทธิ์ที่เซิร์ฟเวอร์) — ถูกปิดสิทธิ์ → หน้าไม่มีสิทธิ์ทันที
 */
(function () {
  var esc = LiffApp.esc;
  var scr = null;

  function $(id) { return scr.$(id); }

  /** ปุ่มใหญ่: ใบเงินสด / ใบกำกับ เปิดแอปใหม่ในโหมดนั้น (โหมดคงที่ต่อการเปิดแอป) / สต็อก สรุป สลับหน้าจอในแอป */
  var TILES = [
    { id: 'cash', href: 'issue?type=cash', icon: 'cash', name: 'ใบเงินสด', sub: 'ออกบิล · ประวัติ · จัดการ' },
    { id: 'tax', href: 'issue?type=tax', icon: 'receipt', name: 'ใบกำกับภาษี', sub: 'ออกบิล · ประวัติ · จัดการ' },
    { id: 'stock', href: 'stock', icon: 'stock', name: 'สต็อก', sub: 'คงเหลือ · ของเข้า-ออก' },
    { id: 'summary', href: 'summary', icon: 'summary', name: 'สรุป', sub: 'ยอดขาย · สินค้าขายดี' }
  ];

  function draw() {
    var inLine = LiffApp.inClient();
    var oa = LiffApp.lineChatUrl();
    $('view').innerHTML =
      '<section class="card menu-hello"><div class="t"><div class="small muted">เข้าสู่ระบบเป็น</div><div><b id="menu-name"></b></div></div>' +
      (inLine
        ? '<button type="button" class="btn sm primary" id="btn-full">' + iconSvg('link') + '<span>เปิดแบบเต็มจอ</span></button>'
        : '<button type="button" class="btn sm" id="btn-logout">' + iconSvg('logout') + '<span>ออกจากระบบ</span></button>') + '</section>' +
      '<nav class="menu-grid" aria-label="เมนูหลัก">' + TILES.map(function (t) {
        return '<a class="menu-tile ' + t.id + '" id="tile-' + t.id + '" href="' + t.href + '">' + iconSvg(t.icon) +
          '<span class="n">' + esc(t.name) + '</span><span class="s">' + esc(t.sub) + '</span></a>';
      }).join('') + '</nav>' +
      (inLine ? '' :
        '<section class="card menu-more" id="menu-more">' +
        '<button type="button" class="btn block hidden" id="btn-install">' + iconSvg('download') + '<span>ติดตั้งเป็นแอปบนเครื่องนี้</span></button>' +
        (oa ? '<a class="btn block" id="btn-chat" href="' + esc(oa) + '" rel="noopener">' + iconSvg('send') + '<span>กลับไปแชท LINE</span></a>' : '') +
        '</section>');
    $('menu-name').textContent = LiffApp.profileName() || '…';
    if (inLine) $('btn-full').addEventListener('click', function () { LiffApp.openFullScreen(); });
    else $('btn-logout').addEventListener('click', function () { LiffApp.logout(); });
    if (!inLine && window.Pwa) Pwa.menu(scr);
  }

  /** ชื่อจากแท็บผู้ใช้ + ตรวจสิทธิ์ (ไม่บังหน้าจอระหว่างรอ) */
  async function check() {
    var r = await LiffApp.api('whoami', { type: 'tax' });
    if (!r.ok) {
      if (LiffApp.isAuthFail(r.code)) LiffApp.showApiError(r, scr);
      return;
    }
    if (Shell.isCurrent(scr) && $('menu-name')) $('menu-name').textContent = r.name || LiffApp.profileName() || '';
  }

  Shell.define('menu', {
    title: 'เมนูหลัก',
    build: function (s) {
      scr = s;
      s.root.innerHTML = '<div class="topbar"><h1>ระบบออกบิล</h1><div class="sub">เลือกงานที่ต้องการ</div></div><div id="view"></div>';
    },
    show: function (s) {
      draw();
      Shell.drawn(s);
      return check();
    }
  });
})();
