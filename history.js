/*
 * history.js — หน้าประวัติเอกสารบน LIFF จริง (ย้ายจาก public/history.html ของระบบจำลอง หน้าตาและขั้นตอนเดิม)
 *   ค้นหาร้านช่องเดียว (ชื่อย่อ ชื่อเต็ม เลขภาษี — search.js ตัวเดียวกับระบบจำลอง) รวมร้านที่ปิด
 *   แตะร้าน → เอกสารทั้งหมด ใหม่ → เก่า, ยอดรวมไม่นับใบที่ยกเลิก, ป้าย "ยกเลิก" + เหตุผล, ออกโดย / ยกเลิกโดย
 *   ปุ่ม "เปิด PDF" ใช้ลิงก์ที่เซิร์ฟเวอร์ส่งมา (botPdfUrl) / ใบที่ไม่มี PDF มีปุ่ม "สร้าง PDF ใหม่" (regeneratePdf)
 * ต่างจากระบบจำลอง: เรียก Apps Script ผ่าน LiffApp.api (ส่ง idToken) / ไม่มีปุ่มดาวน์โหลดแยก (ลิงก์ PDF เปิดนอกแอป LINE ดาวน์โหลดได้เอง)
 */
(function () {
  var esc = LiffApp.esc;
  var view = document.getElementById('view');
  var appEl = document.getElementById('app');
  var shops = [];
  var docs = [];

  async function load() {
    view.innerHTML = '<div class="empty">กำลังโหลด…</div>';
    var rs = await Promise.all([LiffApp.api('listShops'), LiffApp.api('listDocuments', { limit: 5000 })]);
    var bad = rs.find(function (r) { return !r.ok; });
    if (bad) return LiffApp.showApiError(bad);
    shops = rs[0].shops.slice().sort(function (a, b) { return a.short_name.localeCompare(b.short_name, 'th'); });
    docs = rs[1].documents;
    var pre = new URLSearchParams(location.search).get('shopId');
    var shop = pre && shops.find(function (s) { return String(s.shop_id) === pre; });
    if (shop) showShop(shop); else showSearch('');
  }

  function setShopParam(id) {
    var u = new URL(location.href);
    if (id) u.searchParams.set('shopId', id); else u.searchParams.delete('shopId');
    history.replaceState(null, '', u);
  }

  // ---------- ค้นหาร้าน
  function showSearch(term) {
    setShopParam(null);
    view.innerHTML =
      '<section class="card"><label class="f" for="q">ค้นหาชื่อร้าน</label>' +
      '<input type="search" id="q" placeholder="พิมพ์ชื่อร้าน ชื่อเต็ม หรือเลขภาษี" autocomplete="off"></section>' +
      '<section class="card"><ul class="list" id="shops"></ul></section>';
    var q = document.getElementById('q');
    q.value = term;
    q.addEventListener('input', function () { drawShops(q.value); });
    document.getElementById('shops').addEventListener('click', function (e) {
      var li = e.target.closest('li[data-id]');
      if (li) showShop(shops.find(function (s) { return String(s.shop_id) === li.dataset.id; }), q.value);
    });
    drawShops(term);
    appEl.scrollTop = 0;
  }

  function drawShops(term) {
    // รวมร้านที่ปิดใช้งาน: ยังต้องค้นเจอเพื่อดูเอกสารเก่า
    var list = searchShops(shops, term);
    document.getElementById('shops').innerHTML = list.length ? list.map(function (s) {
      var mine = documentsOfShop(docs, s.shop_id);
      var last = mine[0];
      return '<li class="tap shop-row" data-id="' + esc(s.shop_id) + '"><div class="t"><div class="n">' + esc(s.short_name) +
        (s.active ? '' : ' <span class="badge gray">ปิด</span>') + '</div><div class="s">' + esc(s.legal_name) + '</div></div>' +
        '<div class="c"><b class="num" style="color:var(--ink)">' + mine.length + '</b> ใบ' +
        (last ? '<br>ล่าสุด ' + formatThaiDate(last.doc_date) : '') + '</div></li>';
    }).join('') : '<li class="empty">ไม่พบร้านที่ค้นหา</li>';
  }

  // ---------- เอกสารของร้าน
  function showShop(shop, backTerm) {
    setShopParam(shop.shop_id);
    var mine = documentsOfShop(docs, shop.shop_id);
    var issued = mine.filter(function (d) { return d.status !== 'cancelled'; });
    var sum = issued.reduce(function (a, d) { return a + toSatang(d.total); }, 0);
    view.innerHTML =
      '<section class="card chosen"><div class="t"><div class="n" id="shop-name">' + esc(shop.short_name) +
      (shop.active ? '' : ' <span class="badge gray">ปิด</span>') + '</div>' +
      '<div class="small muted">' + esc(shop.legal_name) + '</div></div>' +
      '<button type="button" class="btn sm" id="change">เปลี่ยนร้าน</button></section>' +
      '<section class="card"><div class="summary"><span>ทั้งหมด <b id="doc-count">' + mine.length + '</b> ใบ</span>' +
      '<span>ยอดที่ไม่ยกเลิก <b class="num" id="doc-sum">' + formatMoney(fromSatang(sum)) + '</b></span></div>' +
      '<ul class="list" id="docs">' + (mine.length ? mine.map(docRow).join('') : '<li class="empty">ร้านนี้ยังไม่มีเอกสาร</li>') + '</ul></section>';
    document.getElementById('change').addEventListener('click', function () { showSearch(backTerm || ''); });
    document.getElementById('docs').addEventListener('click', function (e) {
      var b = e.target.closest('[data-regen]');
      if (b) regenerate(b);
    });
    appEl.scrollTop = 0;
  }

  /** ปุ่ม "สร้าง PDF ใหม่" สำหรับใบที่ไม่มี PDF (เซิร์ฟเวอร์ตรวจ idToken + แท็บผู้ใช้) */
  async function regenerate(btn) {
    var no = btn.getAttribute('data-regen');
    btn.disabled = true;
    btn.textContent = 'กำลังสร้าง PDF…';
    var r = await LiffApp.api('regeneratePdf', { docNo: Number(no) });
    if (!r.ok) {
      if (r.code === 'forbidden' || r.code === 'token_expired') return LiffApp.showApiError(r);
      btn.disabled = false;
      btn.textContent = 'สร้าง PDF ใหม่';
      LiffApp.toast(r.error || 'สร้าง PDF ไม่สำเร็จ', true);
      return;
    }
    var d = docs.find(function (x) { return String(x.doc_no) === no; });
    if (d) { d.hasPdf = true; d.pdfUrl = r.pdfUrl; }
    btn.closest('.acts').outerHTML = pdfActs(r.pdfUrl);
    LiffApp.toast('สร้าง PDF ของเอกสาร #' + no + ' แล้ว');
  }

  function pdfActs(url) {
    return '<div class="acts"><a class="btn sm" data-pdf href="' + esc(url) + '" target="_blank" rel="noopener">📄 เปิด PDF</a></div>';
  }

  function docRow(d) {
    var c = d.status === 'cancelled';
    return '<li class="doc" data-no="' + d.doc_no + '">' +
      '<div class="no' + (c ? ' cancel' : '') + '">#' + d.doc_no + ' ' + (c ? '<span class="badge red">ยกเลิก</span>' : '<span class="badge">ออกแล้ว</span>') + '</div>' +
      '<div class="amt num">' + formatMoney(d.total) + '</div>' +
      '<div class="meta">' + formatThaiDate(d.doc_date) + ' · ' + esc(d.doc_type) + ' · ' + esc(d.sale_type) +
      (d.issued_by ? '<br>ออกโดย ' + esc(d.issued_by) : '') +
      (c ? '<br>เหตุผล: ' + esc(d.cancelled_reason) + (d.cancelled_by ? ' · ยกเลิกโดย ' + esc(d.cancelled_by) : '') : '') + '</div>' +
      (d.hasPdf
        ? pdfActs(d.pdfUrl)
        : '<div class="acts"><span class="badge amber no-pdf">ไม่มี PDF</span>' +
          '<button type="button" class="btn sm" data-regen="' + d.doc_no + '">สร้าง PDF ใหม่</button></div>') +
      '</li>';
  }

  LiffApp.start().then(function (ready) { if (ready) load(); });
})();
