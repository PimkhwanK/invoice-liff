/*
 * manage.js — หน้าจัดการข้อมูลบน LIFF จริง (ย้ายจาก public/manage.html ของระบบจำลอง หน้าตาและขั้นตอนเดิม)
 *   แท็บร้านค้า: ค้นหา / เพิ่ม (ลำดับ = สูงสุด + 1 ที่เซิร์ฟเวอร์) / แก้ / ปิด-เปิดใช้งาน — ห้ามลบ เอกสารเก่าไม่เปลี่ยน (snapshot)
 *   แท็บสินค้า: เพิ่ม (บาร์โค้ดห้ามซ้ำ) / แก้ / เลิกขาย — ห้ามลบ
 *   แท็บยกเลิกเอกสาร: ต้องใส่เหตุผลแล้วกดยืนยัน → cancelDocument บันทึกสถานะแล้วตอบทันที
 *     → แสดง "บันทึกการยกเลิกแล้ว กำลังทำ PDF ลายน้ำ…" แล้วเรียก regeneratePdf { replace } เขียนทับ PDF เดิม (ลิงก์เดิม)
 * ต่างจากระบบจำลอง: เรียก Apps Script ผ่าน LiffApp.api (ส่ง idToken) / คำเตือน check digit ของเลขภาษีมาจากเซิร์ฟเวอร์
 * รอบ 6 ข้อ 3.5: หน้าจอหนึ่งของแอปหน้าเดียว (shell.js) — ร้าน / สินค้า / เอกสารจาก AppData (appData ตอนเปิดแอป)
 *   สลับแท็บไม่เรียกเซิร์ฟเวอร์ / บันทึกแล้วแก้ข้อมูลในแอปจากคำตอบ (putShop, putProduct, patchDoc) ไม่โหลดรายการใหม่ทั้งหมด
 */
(function () {
  var esc = LiffApp.esc;
  var scr = null;
  var view = null;
  var tabs = null;
  var tab = 'shops';
  var failed = false;
  function $(id) { return scr.$(id); }

  function setTab(t) {
    if (['shops', 'products', 'cancel'].indexOf(t) < 0) t = 'shops';
    tab = t;
    tabs.querySelectorAll('button').forEach(function (b) { b.classList.toggle('on', b.dataset.tab === t); });
    Shell.setParams(scr, t === 'shops' ? {} : { tab: t });
    render();
  }

  function errText(msg) { return esc(msg).replace(/\n/g, '<br>'); }

  /** ข้อผิดพลาดจากเซิร์ฟเวอร์: ไม่มีสิทธิ์ / หมดอายุ → เต็มหน้า, อื่น ๆ → คืน true ให้ผู้เรียกแสดงเอง */
  function fatal(r) {
    if (LiffApp.isDenied(r.code) || r.code === 'token_expired' || r.code === 'no_token' || r.code === 'token_invalid') {
      tabs.classList.add('hidden');
      LiffApp.showApiError(r, scr);
      return true;
    }
    return false;
  }

  var LOADING = { shops: 'กำลังโหลดรายชื่อร้านค้า…', products: 'กำลังโหลดรายการสินค้า…', cancel: 'กำลังโหลดเอกสารที่ยกเลิกได้…' };

  var CANCEL_LIMIT = 50; // แท็บยกเลิกเอกสาร: ใบที่ยังไม่ยกเลิก ล่าสุดกี่ใบ

  /** ข้อมูลของแท็บจาก AppData (รูปแบบเดียวกับคำตอบ listShops / listProducts all / listDocuments issued เดิม) */
  function source(t) {
    if (t === 'shops') return { shops: AppData.shops() };
    if (t === 'products') return { products: AppData.products() };
    return { documents: AppData.recentDocs().filter(function (d) { return d.status !== 'cancelled'; }).slice(0, CANCEL_LIMIT) };
  }

  /**
   * แสดงรายการของแท็บจากข้อมูลในแอป (ไม่เรียกเซิร์ฟเวอร์ ยกเว้นยังไม่มีข้อมูลเลย)
   * @param {boolean} keepTerm true = ข้อมูลเปลี่ยน (บันทึก / ดึงใหม่) → คงคำค้นและตำแหน่งเลื่อน
   */
  async function render(keepTerm) {
    var t = tab;
    if (!AppData.has()) LiffApp.loading(LOADING[t], view);
    var r = await AppData.ensure();
    if (!r.ok) { failed = true; tabs.classList.add('hidden'); return LiffApp.showApiError(r, scr); }
    failed = false;
    if (tab !== t) return; // เปลี่ยนแท็บไปแล้ว
    tabs.classList.remove('hidden');
    var q = $('q');
    var term = keepTerm === true && q ? q.value : '';
    ({ shops: renderShops, products: renderProducts, cancel: renderCancel })[t](source(t));
    if (term) { var q2 = $('q'); q2.value = term; q2.dispatchEvent(new Event('input')); }
    if (keepTerm !== true) Shell.scrollTop(scr);
    Shell.drawn(scr);
  }

  /** ข้อมูลในแอปเปลี่ยน — กำลังแก้ข้อมูลในแผ่นอยู่ ไม่วาดทับ (วาดหลังปิดแผ่น) */
  function update() {
    if (document.querySelector('.sheet-back')) return;
    render(true);
  }

  // ---------- ร้านค้า
  function renderShops(r) {
    var rows = r.shops;
    view.innerHTML = '<section class="card"><div class="toolbar"><input type="search" id="q" placeholder="ค้นหาร้าน" autocomplete="off">' +
      '<button type="button" class="btn primary" id="add">＋ เพิ่มร้าน</button></div><ul class="list" id="list"></ul></section>';
    var q = $('q');
    function draw() {
      var list = searchShops(rows, q.value);
      $('list').innerHTML = list.map(function (s) {
        return '<li class="tap item" data-id="' + esc(s.shop_id) + '"><div class="t"><div class="n">' + esc(s.short_name) +
          ' <span class="small muted">#' + esc(s.shop_id) + '</span></div><div class="s">' + esc(s.legal_name) + '</div>' +
          '<div class="s">สาขา ' + esc(s.branch || '-') + ' · ' + esc(s.tax_id || 'ไม่มีเลขภาษี') + ' · เครดิต ' + (s.credit_days === '' ? 'ค่าเริ่มต้น' : esc(s.credit_days) + ' วัน') + '</div></div>' +
          (s.active ? '' : '<span class="badge gray">ปิด</span>') +
          (s.tax_id && !taxIdCheckDigitOk(s.tax_id) ? '<span class="badge amber">เลขภาษี?</span>' : '') + '</li>';
      }).join('') || '<li class="empty">ไม่พบร้าน</li>';
    }
    q.addEventListener('input', draw);
    $('list').addEventListener('click', function (e) {
      var li = e.target.closest('li[data-id]');
      if (li) shopForm(rows.find(function (s) { return String(s.shop_id) === li.dataset.id; }));
    });
    $('add').addEventListener('click', function () { shopForm(null); });
    draw();
  }

  function shopForm(shop) {
    var s = shop || { short_name: '', legal_name: '', address: '', tel: '', fax: '', branch: 'สำนักงานใหญ่', tax_id: '', credit_days: '', active: true };
    var f = function (key, label, type, extra) {
      return '<div class="field"><label class="f" for="f-' + key + '">' + label + '</label><input type="' + (type || 'text') + '" id="f-' + key + '" value="' + esc(s[key]) + '"' + (extra || '') + '></div>';
    };
    var sh = LiffApp.sheet(shop ? 'แก้ไขร้าน #' + shop.shop_id : 'เพิ่มร้านใหม่',
      (shop ? '<div class="alert warn small" style="margin-bottom:10px">แก้แล้วมีผลกับเอกสารใหม่เท่านั้น เอกสารเก่ายังใช้ข้อมูล ณ วันที่ออก (snapshot)</div>' : '') +
      f('short_name', 'ชื่อร้านค้า (ชื่อย่อ ใช้ค้นหา)') +
      f('legal_name', 'ชื่อเต็มตามใบกำกับ') +
      '<div class="field"><label class="f" for="f-address">ที่อยู่ (บรรทัดเดียว)</label><textarea id="f-address" rows="3">' + esc(s.address) + '</textarea><div class="hint" id="addr-preview"></div></div>' +
      '<div class="two">' + f('tel', 'โทรศัพท์', 'tel') + f('fax', 'แฟกซ์', 'tel') + '</div>' +
      '<div class="two">' + f('branch', 'สาขา', 'text', ' placeholder="สำนักงานใหญ่ หรือ 00001"') + f('credit_days', 'เครดิต (วัน)', 'number', ' min="0" inputmode="numeric" placeholder="ว่าง = ค่าเริ่มต้น"') + '</div>' +
      f('tax_id', 'เลขประจำตัวผู้เสียภาษี (13 หลัก หรือว่าง)', 'text', ' inputmode="numeric"') +
      '<div class="field"><label class="chk"><input type="checkbox" id="f-active"' + (s.active ? ' checked' : '') + '> ใช้งานอยู่</label></div>' +
      '<div id="f-msg"></div>',
      '<button type="button" class="btn grow" data-close>ยกเลิก</button><button type="button" class="btn primary grow" id="f-save">บันทึก</button>');
    var addr = sh.el.querySelector('#f-address');
    function preview() {
      var p = splitAddress(addr.value);
      sh.el.querySelector('#addr-preview').innerHTML = 'บนเอกสาร: <b>' + esc(p[0]) + '</b><br>' + (p[1] ? '<b>' + esc(p[1]) + '</b>' : '');
    }
    addr.addEventListener('input', preview);
    preview();
    sh.el.querySelector('#f-save').addEventListener('click', async function () {
      var btn = this;
      var payload = { active: sh.el.querySelector('#f-active').checked };
      ['short_name', 'legal_name', 'address', 'tel', 'fax', 'branch', 'credit_days', 'tax_id'].forEach(function (k) { payload[k] = sh.el.querySelector('#f-' + k).value; });
      if (shop) payload.shop_id = shop.shop_id;
      btn.disabled = true;
      btn.textContent = 'กำลังบันทึก…';
      var r = await LiffApp.api('upsertShop', { shop: payload });
      btn.disabled = false;
      btn.textContent = 'บันทึก';
      if (!r.ok) {
        if (fatal(r)) { sh.close(); return; }
        sh.el.querySelector('#f-msg').innerHTML = '<div class="alert err" id="f-error">' + errText(r.error) + '</div>';
        return;
      }
      sh.close();
      LiffApp.toast((r.created ? 'เพิ่มร้าน #' + r.shop.shop_id + ' แล้ว' : 'บันทึกแล้ว') + (r.warnings.length ? '\n' + r.warnings.join('\n') : ''), r.warnings.length > 0);
      AppData.putShop(r.shop); // แก้เฉพาะร้านนี้ในแอป → รายการวาดใหม่
    });
  }

  // ---------- สินค้า
  function renderProducts(r) {
    var rows = r.products;
    view.innerHTML = '<section class="card"><div class="toolbar"><input type="search" id="q" placeholder="ค้นหาสินค้า" autocomplete="off">' +
      '<button type="button" class="btn primary" id="add">＋ เพิ่มสินค้า</button></div><ul class="list" id="list"></ul></section>';
    var q = $('q');
    function draw() {
      var term = q.value.trim().toLowerCase();
      $('list').innerHTML = rows.filter(function (p) {
        return !term || (p.name + ' ' + p.barcode).toLowerCase().indexOf(term) >= 0;
      }).map(function (p) {
        return '<li class="tap item" data-bc="' + esc(p.barcode) + '"><div class="t"><div class="n">' + esc(p.name) + '</div>' +
          '<div class="s">' + esc(p.barcode) + ' · ' + esc(p.unit) + '</div></div><div class="right"><b class="num">' + formatMoney(p.price) + '</b><br>' +
          (p.active ? '' : '<span class="badge gray">เลิกขาย</span>') + '</div></li>';
      }).join('') || '<li class="empty">ไม่พบสินค้า</li>';
    }
    q.addEventListener('input', draw);
    $('list').addEventListener('click', function (e) {
      var li = e.target.closest('li[data-bc]');
      if (li) productForm(rows.find(function (p) { return p.barcode === li.dataset.bc; }));
    });
    $('add').addEventListener('click', function () { productForm(null); });
    draw();
  }

  function productForm(p) {
    var v = p || { barcode: '', name: '', unit: 'ลัง', price: '', active: true };
    var sh = LiffApp.sheet(p ? 'แก้ไขสินค้า' : 'เพิ่มสินค้าใหม่',
      '<div class="field"><label class="f" for="p-barcode">บาร์โค้ดลัง</label><input type="text" id="p-barcode" inputmode="numeric" value="' + esc(v.barcode) + '"' + (p ? ' disabled' : '') + '>' +
      (p ? '<div class="hint">บาร์โค้ดเป็นคีย์หลัก แก้ไม่ได้</div>' : '') + '</div>' +
      '<div class="field"><label class="f" for="p-name">รายการสินค้า</label><input type="text" id="p-name" value="' + esc(v.name) + '"></div>' +
      '<div class="two"><div><label class="f" for="p-unit">หน่วย</label><input type="text" id="p-unit" value="' + esc(v.unit) + '" list="units"></div>' +
      '<div><label class="f" for="p-price">ราคา (รวม VAT)</label><input type="number" id="p-price" class="num" min="0" step="any" inputmode="decimal" value="' + esc(v.price) + '"></div></div>' +
      '<datalist id="units"><option value="ลัง"><option value="กล่อง"><option value="แพ็ค"></datalist>' +
      '<div class="field"><label class="chk"><input type="checkbox" id="p-active"' + (v.active ? ' checked' : '') + '> ยังขายอยู่</label></div><div id="p-msg"></div>',
      '<button type="button" class="btn grow" data-close>ยกเลิก</button><button type="button" class="btn primary grow" id="p-save">บันทึก</button>');
    sh.el.querySelector('#p-save').addEventListener('click', async function () {
      var btn = this;
      var product = {
        barcode: sh.el.querySelector('#p-barcode').value,
        name: sh.el.querySelector('#p-name').value,
        unit: sh.el.querySelector('#p-unit').value,
        price: sh.el.querySelector('#p-price').value,
        active: sh.el.querySelector('#p-active').checked
      };
      btn.disabled = true;
      btn.textContent = 'กำลังบันทึก…';
      var r = await LiffApp.api('upsertProduct', { mode: p ? 'update' : 'create', product: product });
      btn.disabled = false;
      btn.textContent = 'บันทึก';
      if (!r.ok) {
        if (fatal(r)) { sh.close(); return; }
        sh.el.querySelector('#p-msg').innerHTML = '<div class="alert err" id="p-error">' + errText(r.error) + '</div>';
        return;
      }
      sh.close();
      LiffApp.toast((r.created ? 'เพิ่มสินค้าแล้ว' : 'บันทึกแล้ว') + (r.warnings.length ? '\n' + r.warnings.join('\n') : ''), r.warnings.length > 0);
      AppData.putProduct(r.product);
    });
  }

  // ---------- ยกเลิกเอกสาร
  function renderCancel(r) {
    view.innerHTML =
      '<section class="card"><p class="small muted" style="margin-top:0">ห้ามลบเอกสาร — การยกเลิกจะเปลี่ยนสถานะเป็น "ยกเลิก" เก็บเหตุผล และทำ PDF ใหม่ที่มีลายน้ำ "ยกเลิก" ทับไฟล์เดิม (ลิงก์ที่ส่งให้ลูกค้าไปแล้วจะเห็นลายน้ำ) เลขที่เอกสารจะไม่ถูกนำกลับมาใช้</p>' +
      '<div class="toolbar"><input type="search" id="q" inputmode="numeric" placeholder="กรองด้วยเลขที่" autocomplete="off"></div>' +
      '<ul class="list" id="list"></ul></section>';
    var q = $('q');
    function draw() {
      var term = q.value.replace(/\D/g, '');
      $('list').innerHTML = r.documents.filter(function (d) { return !term || String(d.doc_no).indexOf(term) >= 0; }).map(function (d) {
        return '<li class="item" data-no="' + d.doc_no + '"><div class="t"><div class="n">#' + d.doc_no + ' · ' + esc(d.shop_short_name) + '</div>' +
          '<div class="s">' + formatThaiDate(d.doc_date) + ' · ' + formatMoney(d.total) + ' บาท</div></div>' +
          (d.hasPdf ? '<a class="btn sm" href="view?no=' + d.doc_no + '">PDF</a>' : '<span class="badge amber">ไม่มี PDF</span>') +
          '<button type="button" class="btn sm danger" data-cancel="' + d.doc_no + '">ยกเลิก</button></li>';
      }).join('') || '<li class="empty">ไม่มีเอกสารที่ยกเลิกได้</li>';
    }
    q.addEventListener('input', draw);
    $('list').addEventListener('click', function (e) {
      var b = e.target.closest('[data-cancel]');
      if (b) cancelForm(r.documents.find(function (d) { return String(d.doc_no) === b.dataset.cancel; }));
    });
    draw();
  }

  function cancelForm(d) {
    var sh = LiffApp.sheet('ยกเลิกเอกสาร #' + d.doc_no,
      '<p style="margin-top:0">' + esc(d.shop_legal_name) + '<br><span class="muted">' + formatThaiDate(d.doc_date) + ' · ' + formatMoney(d.total) + ' บาท</span></p>' +
      '<label class="f" for="reason">เหตุผลที่ยกเลิก (ต้องระบุ)</label><textarea id="reason" rows="3" maxlength="200" placeholder="เช่น ออกผิดร้าน, ลูกค้าคืนสินค้า"></textarea><div id="c-msg" style="margin-top:8px"></div>',
      '<button type="button" class="btn grow" data-close>ไม่ยกเลิก</button><button type="button" class="btn danger grow" id="c-ok">ยืนยันยกเลิก</button>');
    var reason = sh.el.querySelector('#reason');
    var msg = sh.el.querySelector('#c-msg');
    var ok = sh.el.querySelector('#c-ok');
    // ขั้น 1: บันทึกการยกเลิก (เซิร์ฟเวอร์ตอบทันที) → ขั้น 2: ทำ PDF ลายน้ำ (regeneratePdf replace) ต่อเอง
    ok.addEventListener('click', async function () {
      if (ok.dataset.retry) return makePdf();
      if (!reason.value.trim()) { msg.innerHTML = '<div class="alert err" id="c-error">กรุณาระบุเหตุผลที่ยกเลิก</div>'; return; }
      ok.disabled = true;
      ok.textContent = 'กำลังบันทึกการยกเลิก…';
      var r = await LiffApp.api('cancelDocument', { docNo: d.doc_no, reason: reason.value });
      if (!r.ok) {
        ok.disabled = false;
        ok.textContent = 'ยืนยันยกเลิก';
        if (fatal(r)) { sh.close(); return; }
        msg.innerHTML = '<div class="alert err" id="c-error">' + errText(r.error) + '</div>';
        return;
      }
      reason.disabled = true;
      AppData.patchDoc(d.doc_no, r.document); // สถานะยกเลิก + เหตุผล + ยกเลิกโดย (ทุกหน้าจอในแอปเห็นทันที)
      ok.dataset.retry = '1'; // ยกเลิกแล้ว: ปุ่มนี้ต่อจากนี้ = ทำ PDF ใหม่ (ห้ามส่งยกเลิกซ้ำ)
      makePdf();
    });
    async function makePdf() {
      ok.disabled = true;
      ok.textContent = 'กำลังทำ PDF…';
      msg.innerHTML = '<div class="alert ok" id="c-wait">บันทึกการยกเลิกแล้ว กำลังทำ PDF ลายน้ำ… (อาจใช้เวลา 10–20 วินาที ปิดหน้านี้ได้ แต่ PDF อาจยังไม่มีลายน้ำ)</div>';
      var r = await LiffApp.api('regeneratePdf', { docNo: d.doc_no, replace: true });
      ok.disabled = false;
      if (!r.ok) {
        if (fatal(r)) { sh.close(); return; }
        // ยกเลิกแล้ว แต่ทำ PDF ลายน้ำไม่สำเร็จ → ปุ่มเดิมกลายเป็น "ลองทำ PDF ใหม่"
        ok.textContent = 'ลองทำ PDF ใหม่';
        msg.innerHTML = '<div class="alert err" id="c-error">' + errText('ยกเลิกเอกสารเลขที่ ' + d.doc_no + ' แล้ว แต่' + (r.error || 'ทำ PDF ใหม่ไม่สำเร็จ')) + '</div>';
        return;
      }
      sh.close();
      LiffApp.toast('ยกเลิกเอกสาร #' + d.doc_no + ' แล้ว (PDF มีลายน้ำ "ยกเลิก")');
      AppData.patchDoc(d.doc_no, { pdfUrl: r.pdfUrl, hasPdf: !!r.pdfUrl }); // PDF เปลี่ยน (ลายน้ำ) → หน้าจอดู PDF ของใบนี้โหลดใหม่
    }
    // เมื่อปิดแผ่น ให้รายการอัปเดตเสมอ (เผื่อยกเลิกไปแล้วแต่ PDF ล้มเหลว)
    sh.el.addEventListener('click', function (e) {
      if (ok.dataset.retry && (e.target === sh.el || e.target.closest('[data-close]'))) setTimeout(update, 0);
    });
  }

  Shell.define('manage', {
    title: 'จัดการข้อมูล',
    build: function (s) {
      scr = s;
      s.root.innerHTML =
        '<div class="topbar"><h1>จัดการข้อมูล</h1><div class="sub" id="subtitle">ร้านค้า · สินค้า · ยกเลิกเอกสาร</div></div>' +
        '<nav class="tabs hidden" id="tabs">' +
        '<button type="button" data-tab="shops">ร้านค้า</button>' +
        '<button type="button" data-tab="products">สินค้า</button>' +
        '<button type="button" data-tab="cancel">ยกเลิกเอกสาร</button></nav>' +
        '<div id="view" aria-live="polite"></div>';
      view = $('view');
      tabs = $('tabs');
      tabs.addEventListener('click', function (e) {
        var b = e.target.closest('button[data-tab]');
        if (b) setTab(b.dataset.tab);
      });
    },
    /** เข้าหน้าจอ: แท็บตาม URL (?tab=) / แท็บเดิม ข้อมูลเดิม → ไม่ต้องวาดใหม่ */
    show: function (s, params) {
      var t = ['shops', 'products', 'cancel'].indexOf(params.tab) >= 0 ? params.tab : 'shops';
      if (!failed && t === tab && s.seen === AppData.version() && $('q')) return;
      var same = t === tab && s.seen !== -1 && !failed;
      tab = t;
      tabs.querySelectorAll('button').forEach(function (b) { b.classList.toggle('on', b.dataset.tab === t); });
      return render(same);
    },
    update: update
  });
})();
