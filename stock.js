/*
 * stock.js — หน้า "สต็อก" (รอบ 15: ยังไม่มีระบบสต็อก แสดง "เร็วๆ นี้" ไว้ก่อน — ปุ่มใน Rich Menu เปิดหน้านี้)
 *   เปิดจาก Rich Menu (/stock) — ไม่ผูกกับประเภทเอกสาร (shell.js ALONE) / ไม่เรียกเซิร์ฟเวอร์
 */
(function () {
  Shell.define('stock', {
    title: 'สต็อก',
    build: function (s) {
      s.root.innerHTML = '<div class="topbar"><h1>สต็อก</h1></div><div id="view"></div>';
    },
    // ข้อความระหว่างเข้าสู่ระบบ (LiffApp.start) ใช้ #view เดียวกัน → วาดตอนแสดงหน้าจอ
    show: function (s) {
      s.$('view').innerHTML = '<section class="card soon" id="stock-soon"><div class="soon-icon">' + iconSvg('stock') + '</div>' +
        '<h2>เร็วๆ นี้</h2><p class="muted">หน้านี้กำลังจัดทำ</p></section>';
      Shell.drawn(s);
    }
  });
})();
