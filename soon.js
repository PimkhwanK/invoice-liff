/*
 * soon.js — หน้า "เร็ว ๆ นี้" (ประวัติเอกสาร / จัดการข้อมูล) ยังไม่เรียก API และไม่แสดงข้อมูลใด ๆ
 * เริ่ม LIFF เพื่อให้ปุ่ม "กลับไปแชท" ปิดหน้าได้ (ถ้าเปิดในแอป LINE)
 */
(function () {
  var CFG = window.APP_CONFIG || {};
  var btn = document.getElementById('btn-close');
  btn.addEventListener('click', function () {
    try { liff.closeWindow(); } catch (e) { history.back(); }
  });
  if (typeof liff === 'undefined' || !CFG.LIFF_ID) return;
  liff.init({ liffId: CFG.LIFF_ID }).then(function () {
    if (liff.isInClient()) btn.classList.remove('hidden');
  }, function () { /* หน้านี้ไม่มีข้อมูล ไม่ต้องแจ้ง error */ });
})();
