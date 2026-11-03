/**
 * profit.js — หน้า "กำไรบิล" (รอบ 45) แท็บที่ 6 ของแถบบน/ล่าง ถัดจาก "สรุป"
 *   เลย์เอาต์เดียวกับหน้าประวัติ มุมมอง "บิลล่าสุด" (การ์ด li.doc: เลขที่ + ป้ายสถานะ / ยอด / ร้าน / วันที่ · ประเภท · ชนิดการขาย / ออกโดย)
 *   + กำไร/ขาดทุนเป็นบาทต่อบิล (เขียว กำไร / แดง ขาดทุน / เทา เท่าทุน / เทาตัวเอียง ต้นทุนไม่ครบ) / แตะ = รายสินค้า (จำนวน ยอดขายก่อน VAT ต้นทุน กำไร)
 *   ทั้งสองประเภท ใบใหม่อยู่บน ทีละ 10 ใบ + "โหลดบิลเพิ่ม" / ไม่มีช่วงเวลา ไม่มีสวิตช์
 *   ข้อมูลจาก StockApi.gs action profitBills (type tax — ตรวจ idToken + แท็บผู้ใช้ที่เซิร์ฟเวอร์) ไม่จำไว้ในเครื่อง
 *   ปุ่มตาซ่อนตัวเลขกำไร ใช้ค่าเดียวกับหน้าสรุป (localStorage profit-eye ค่าเริ่มต้น = แสดง)
 */
(function () {
  var esc = LiffApp.esc;
  var scr = null;
  var view = null;
  var PAGE = 10;
  var list = [];
  var total = 0;
  var ready = true;
  var COST_HINT = 'กรอกต้นทุนที่หน้าสต็อก (ปุ่มของเข้า) หรือคอลัมน์ "ต้นทุนเริ่มต้น (บาท)" ในชีต';
  function $(id) { return scr.$(id); }
  function money(sat) { return formatMoney(fromSatang(sat)); }
  function eyeOff() { var k = LiffApp.remember('profit-eye'); return !!(k && k.data === 'off'); }

  /** action อยู่กับใบกำกับเสมอ (type tax) — เปิดต่อจากใบเงินสดในแอปเดียวกัน LiffApp.MODE อาจเป็น cash */
  function tapi(action, payload) { return LiffApp.api(action, Object.assign({}, payload, { type: 'tax' })); }

  /** กำไร: +/− คำกำกับ สี / null = ต้นทุนไม่ครบ (ไม่แสดง 0) */
  function pfHtml(sat) {
    if (sat === null || sat === undefined) return '<span class="pf miss">ต้นทุนไม่ครบ</span>';
    var cls = sat > 0 ? 'up' : sat < 0 ? 'down' : 'zero';
    var label = sat > 0 ? 'กำไร' : sat < 0 ? 'ขาดทุน' : 'เท่าทุน';
    var num = eyeOff() ? '••••' : (sat > 0 ? '+' : sat < 0 ? '−' : '') + money(Math.abs(sat));
    return '<span class="pf ' + cls + '">' + label + ' <span class="num">' + num + '</span></span>';
  }

  async function show() {
    list = [];
    LiffApp.loading('กำลังคำนวณกำไรรายบิล…', view);
    var r = await tapi('profitBills', { offset: 0, limit: PAGE });
    if (!Shell.isCurrent(scr)) return;
    if (!r.ok) return LiffApp.showApiError(r, scr);
    ready = !!r.ready;
    view.innerHTML = '<section class="card">' +
      (ready ? '' : '<div class="alert warn" id="pb-not-ready">ยังไม่ได้ตั้งค่าต้นทุน กรุณาแจ้งผู้ดูแลระบบ</div>') +
      '<ul class="list" id="pb-list"></ul><div id="pb-foot"></div>' +
      '<p class="small muted" id="pb-hint">ต้นทุนไม่ครบ = ' + esc(COST_HINT) + '</p></section>';
    add(r);
    Shell.drawn(scr);
  }

  function add(r) {
    total = r.total || 0;
    var start = list.length;
    list = list.concat(r.bills || []);
    var ul = $('pb-list');
    if (!list.length) ul.innerHTML = '<li class="empty">ยังไม่มีบิล</li>';
    else ul.insertAdjacentHTML('beforeend', (r.bills || []).map(function (b, i) { return row(b, start + i); }).join(''));
    $('pb-foot').innerHTML = list.length < total ? '<button type="button" class="btn block" id="pb-more">โหลดบิลเพิ่ม</button>' : '';
  }

  async function more(btn) {
    btn.disabled = true;
    btn.textContent = 'กำลังโหลด…';
    var r = await tapi('profitBills', { offset: list.length, limit: PAGE });
    if (!Shell.isCurrent(scr)) return;
    if (!r.ok) {
      if (LiffApp.isAuthFail(r.code)) return LiffApp.showApiError(r, scr);
      btn.disabled = false;
      btn.textContent = 'ลองอีกครั้ง';
      return LiffApp.toast(r.error || 'โหลดไม่สำเร็จ', true);
    }
    add(r);
  }

  /** การ์ดบิล — โครงเดียวกับ docRow ของหน้าประวัติ + กำไร/ขาดทุน */
  function row(b, i) {
    var label = b.kind === 'c' ? '#' + b.no : LiffApp.docLabel(b.no, b.docType);
    var why = b.cancelled ? '<span class="pf miss">ยกเลิก ไม่นับกำไร</span>' : b.paired ? '<span class="pf miss">ไม่นับซ้ำ (มีใบกำกับคู่)</span>' : pfHtml(b.profit);
    return '<li class="doc pb-doc" role="button" tabindex="0" aria-expanded="false" data-i="' + i + '">' +
      '<div class="no' + (b.cancelled ? ' cancel' : '') + '">' + esc(label) + ' ' + (b.cancelled ? '<span class="badge red">ยกเลิก</span>' : '<span class="badge">ออกแล้ว</span>') + '</div>' +
      '<div class="amt num">' + money(b.total) + '</div>' +
      '<div class="shop-n">' + esc(b.shopName || '') + '</div>' +
      '<div class="meta">' + formatThaiDate(b.date) + ' · ' + esc(b.kind === 'c' ? CASH_DOC_TITLE : b.docType) + (b.saleType ? ' · ' + esc(b.saleType) : '') +
      (b.issuedBy ? '<br>ออกโดย ' + esc(b.issuedBy) : '') + '</div>' +
      '<div class="pb-pf">' + why + '</div><div class="pb-lines hidden"></div></li>';
  }

  function toggle(li) {
    var box = li.querySelector('.pb-lines');
    var open = box.classList.contains('hidden');
    li.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (!open) { box.classList.add('hidden'); return; }
    var b = list[Number(li.dataset.i)];
    var hide = eyeOff();
    var cell = function (sat) { return sat === null || sat === undefined ? '<span class="pf miss">ไม่ครบ</span>' : hide ? '••••' : money(sat); };
    box.innerHTML = '<table class="pb-table"><thead><tr><th>สินค้า</th><th>ขาย*</th><th>ต้นทุน*</th><th>กำไร</th></tr></thead><tbody>' +
      b.lines.map(function (l) {
        return '<tr><td>' + esc(l.name) + (l.free ? ' <span class="badge">แถม</span>' : '') + '<div class="small muted">' + formatQty(l.qty) + ' ' + esc(l.unit) + '</div></td>' +
          '<td class="num">' + (hide ? '••••' : money(l.sale)) + '</td><td class="num">' + cell(l.cost) + '</td><td class="num">' +
          (l.profit === null ? cell(null) : pfHtml(l.profit).replace(/กำไร |ขาดทุน |เท่าทุน /, '')) + '</td></tr>';
      }).join('') + '</tbody></table><div class="small muted">* ก่อน VAT</div>';
    box.classList.remove('hidden');
  }

  /** ปุ่มตา: สลับซ่อน/แสดง (จำค่าเดียวกับหน้าสรุป) แล้ววาดการ์ดที่มีอยู่ใหม่ */
  function drawEye() {
    var b = $('pb-eye');
    var off = eyeOff();
    b.setAttribute('aria-pressed', off ? 'true' : 'false');
    b.innerHTML = iconSvg(off ? 'eyeOff' : 'eye') + '<span>' + (off ? 'แสดงกำไร' : 'ซ่อนกำไร') + '</span>';
  }

  Shell.define('profit', {
    title: 'กำไรบิล',
    build: function (s) {
      scr = s;
      s.root.innerHTML =
        '<div class="topbar"><div class="sum-head"><div><h1>กำไรบิล</h1><div class="sub">บิลล่าสุด แตะเพื่อดูรายสินค้า</div></div>' +
        '<button type="button" class="btn" id="pb-eye"></button></div></div>' +
        '<div id="view" aria-live="polite"></div>';
      view = $('view');
      drawEye();
      $('pb-eye').addEventListener('click', function () {
        LiffApp.keep('profit-eye', eyeOff() ? 'on' : 'off');
        drawEye();
        var ul = $('pb-list');
        if (ul) ul.innerHTML = list.length ? list.map(row).join('') : '<li class="empty">ยังไม่มีบิล</li>';
      });
      view.addEventListener('click', function (e) {
        var m = e.target.closest('#pb-more');
        if (m) return more(m);
        var li = e.target.closest('li.pb-doc');
        if (li) toggle(li);
      });
      view.addEventListener('keydown', function (e) {
        var li = e.target.closest('li.pb-doc');
        if (li && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggle(li); }
      });
    },
    show: function (s) { drawEye(); return show(); }
  });
})();
