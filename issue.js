/*
 * issue.js — ฟอร์มออกบิลบน LIFF จริง (ย้ายมาจาก public/liff/liff.js ของระบบจำลอง หน้าตาและขั้นตอนเดิม)
 *   เลือกร้าน → เพิ่มสินค้า → ตรวจสอบ (บนมือถือ preview.js) → ยืนยัน (createDocument deferPdf → regeneratePdf → ส่งเข้าแชท)
 * รอบ 5A-2: เปิดหน้าแสดงข้อมูลที่จำไว้ทันที (LiffApp.fresh) / ตรวจสอบไม่รอเซิร์ฟเวอร์ / ยืนยันแสดงความคืบหน้าทีละขั้น
 *   เซิร์ฟเวอร์ตรวจและคำนวณซ้ำตอนบันทึก ยอดไม่ตรงกับที่มือถือแสดง (expected) = ไม่บันทึก (code mismatch)
 * คำนวณด้วยไฟล์ชุดเดียวกับเซิร์ฟเวอร์ (money.js, invoice.js ... สำเนาตรงตัวของ src/core)
 * ต่างจากระบบจำลอง:
 *   - เรียก Apps Script ผ่าน LiffApp.api (ส่ง idToken) แทน Sim.api
 *   - ปุ่ม "คัดลอกจากบิลเก่า" (รอบที่ 4): ใช้จำนวน/ราคา/ส่วนลด/แถม/หมายเหตุจากบิลเก่า ข้ามสินค้าที่เลิกขาย (เหมือนระบบจำลอง)
 *   - ยืนยันแล้วเซิร์ฟเวอร์สร้าง PDF ต่อทันที (แสดง "กำลังสร้าง PDF…") ถ้า PDF ล้มเหลว เอกสารยังถูกบันทึก
 *     → หน้า "บันทึกเอกสารแล้ว" + ปุ่ม "ลองสร้าง PDF ใหม่" (regeneratePdf) สำเร็จแล้วค่อยส่งข้อความเข้าแชท
 *   - ออกบิลสำเร็จในแอป LINE: liff.sendMessages("บิล <เลขที่>") แล้วปิดหน้า / นอกแอป LINE: แสดงหน้าสำเร็จ + ปุ่มเปิด PDF
 */
(function () {
  var esc = LiffApp.esc;
  var view = document.getElementById('view');
  var appEl = document.getElementById('app');
  /** เลื่อนเนื้อหากลับบนสุด (เนื้อหาเลื่อนใน #app ไม่ใช่ window) */
  function scrollTop() { appEl.scrollTop = 0; }
  var totalbar = document.getElementById('totalbar');

  var S = {
    init: null,       // ผลจาก action init
    doc: null,        // หัวเอกสารในฟอร์ม
    shop: null,       // ร้านที่เลือก
    lines: [],        // รายการสินค้า
    dueTouched: false,
    requestId: null,  // 1 ค่าต่อ 1 รอบการยืนยัน (ใช้ซ้ำถ้ากดลองใหม่หลังเน็ตหลุด)
    lastKey: 0
  };

  function cfg() { return S.init.config; }
  function labels() { return cfg().sale_type_labels; }
  function isCash() { return S.doc.sale_type === cfg().cash_sale_label; }
  function money(n) { return formatMoney(n); }

  // ---------- โหลดข้อมูล
  /** วันนี้ตามเวลาไทยจากนาฬิกาของมือถือ (ใช้ตอนแสดงจากข้อมูลที่จำไว้ — วันที่ในข้อมูลที่จำไว้อาจเป็นเมื่อวาน) */
  function phoneToday() { return isoDateTimeBangkok(new Date()).slice(0, 10); }

  // ---------- โหลดข้อมูล: แสดงจากที่จำไว้ทันที แล้วดึงใหม่เบื้องหลัง (LiffApp.fresh)
  async function load() {
    totalbar.classList.add('hidden');
    S.screen = 'loading';
    await LiffApp.fresh('init', 'init', {}, function (r, how) {
      if (how.update) return refreshInit(r);
      S.init = how.cached ? Object.assign({}, r, { today: phoneToday() }) : r;
      S.doc = { doc_type: r.config.doc_types[0], doc_date: S.init.today, ref: '', sale_type: r.config.sale_type_labels[0], due_date: '' };
      S.shop = null;
      S.lines = [];
      S.dueTouched = false;
      showForm();
    }, { loadingText: 'กำลังโหลดร้านค้า สินค้า และเลขที่ถัดไป…' });
  }

  /** ข้อมูลใหม่จากเซิร์ฟเวอร์มาถึงหลังแสดงจากที่จำไว้ — ฟอร์มยังว่างอยู่ = วาดใหม่ / กรอกไปแล้ว = แค่ใช้ข้อมูลใหม่ (ไม่ล้างสิ่งที่กรอก) */
  function refreshInit(r) {
    var untouched = S.screen === 'form' && !S.shop && !S.lines.length;
    var sameDay = S.doc && S.doc.doc_date === S.init.today;
    S.init = r;
    if (sameDay && S.doc) S.doc.doc_date = r.today;
    if (S.doc && r.config.doc_types.indexOf(S.doc.doc_type) < 0) S.doc.doc_type = r.config.doc_types[0];
    if (S.doc && r.config.sale_type_labels.indexOf(S.doc.sale_type) < 0) S.doc.sale_type = r.config.sale_type_labels[0];
    if (untouched) { showForm(); return; }
    if (S.screen === 'form') { setSubtitle(); updateDocDateHint(); }
  }

  function setSubtitle() {
    document.getElementById('subtitle').textContent = 'เลขที่ถัดไปโดยประมาณ #' + S.init.nextDocNo + ' (ออกเลขจริงตอนยืนยัน) · ' + S.init.name;
  }

  // ---------- ฟอร์ม
  function showForm() {
    S.screen = 'form';
    document.getElementById('title').textContent = 'ออกเอกสาร';
    setSubtitle();
    totalbar.classList.remove('hidden');
    var c = cfg();
    view.innerHTML =
      '<section class="card">' +
      '  <h2>เอกสาร</h2>' +
      '  <div class="field"><div class="seg-choice" id="doc-type">' +
      c.doc_types.map(function (t) {
        return '<label><input type="radio" name="doc_type" value="' + esc(t) + '"' + (t === S.doc.doc_type ? ' checked' : '') + '>' + esc(t) + '</label>';
      }).join('') + '</div></div>' +
      '  <div class="field two">' +
      '    <div><label class="f" for="doc-date">วันที่</label><input type="date" id="doc-date" value="' + esc(S.doc.doc_date) + '">' +
      '      <div class="hint th-date" id="doc-date-th"></div></div>' +
      '    <div><label class="f" for="doc-ref">อ้างถึง</label><input type="text" id="doc-ref" placeholder="เช่น เลข PO" maxlength="100" value="' + esc(S.doc.ref) + '"></div>' +
      '  </div>' +
      '  <div class="field"><label class="f">ชนิดการขาย</label><div class="seg-choice" id="sale-type">' +
      labels().map(function (t) {
        return '<label><input type="radio" name="sale_type" value="' + esc(t) + '"' + (t === S.doc.sale_type ? ' checked' : '') + '>' + esc(t) + '</label>';
      }).join('') + '</div></div>' +
      '  <div class="field"><label class="f" for="due-date">วันครบกำหนดชำระ</label><input type="date" id="due-date">' +
      '    <div class="hint th-date" id="due-date-th"></div><div class="hint" id="due-hint"></div></div>' +
      '</section>' +

      '<section class="card">' +
      '  <h2>ร้านค้า</h2>' +
      '  <div id="shop-box"></div>' +
      '</section>' +

      '<section class="card">' +
      '  <h2>รายการสินค้า <span class="count" id="line-count"></span></h2>' +
      '  <div id="lines"></div>' +
      '  <div class="row" style="margin-top:10px">' +
      '    <button type="button" class="btn block grow" id="btn-add">＋ เพิ่มสินค้า</button>' +
      '    <button type="button" class="btn" id="btn-copy" title="คัดลอกรายการจากบิลเก่าของร้านนี้">⧉ คัดลอกจากบิลเก่า</button>' +
      '  </div>' +
      '</section>';

    view.querySelectorAll('input[name=doc_type]').forEach(function (i) {
      i.addEventListener('change', function () { S.doc.doc_type = i.value; });
    });
    view.querySelectorAll('input[name=sale_type]').forEach(function (i) {
      i.addEventListener('change', function () { S.doc.sale_type = i.value; S.dueTouched = false; updateDue(); });
    });
    document.getElementById('doc-date').addEventListener('change', function (e) { S.doc.doc_date = e.target.value; S.dueTouched = false; updateDocDateHint(); updateDue(); });
    document.getElementById('doc-ref').addEventListener('input', function (e) { S.doc.ref = e.target.value; });
    document.getElementById('due-date').addEventListener('change', function (e) { S.doc.due_date = e.target.value; S.dueTouched = true; updateDue(); });
    document.getElementById('btn-add').addEventListener('click', openProductPicker);
    document.getElementById('btn-copy').addEventListener('click', openCopyFromOld);

    renderShop();
    renderLines();
    updateDocDateHint();
    updateDue();
  }

  /** ใต้ช่องวันที่: วันที่แบบไทย เช่น "28 ก.ย. 2569" + ห่างจากวันนี้กี่วัน (กฎวันที่ตรวจจริงตอนกด "ตรวจสอบ") */
  function updateDocDateHint() {
    var el = document.getElementById('doc-date-th');
    if (!el) return;
    var d = S.doc.doc_date;
    var diff = isoDayDiff(S.init.today, d);
    el.textContent = !isIsoDate(d) ? 'ยังไม่ได้เลือกวันที่'
      : formatThaiDateShort(d) + (diff === 0 ? ' (วันนี้)' : diff < 0 ? ' (ย้อนหลัง ' + (-diff) + ' วัน)' : ' (ล่วงหน้า ' + diff + ' วัน)');
    el.classList.toggle('off', isIsoDate(d) && diff !== 0);
  }

  function updateDue() {
    var input = document.getElementById('due-date');
    var hint = document.getElementById('due-hint');
    if (!input) return;
    var th = document.getElementById('due-date-th');
    if (isCash()) {
      S.doc.due_date = '';
      input.value = '';
      input.disabled = true;
      th.textContent = '';
      hint.textContent = 'ขายเงินสด ไม่มีวันครบกำหนดชำระ';
      return;
    }
    input.disabled = false;
    var days = creditDaysOf(S.shop, { default_credit_days: cfg().default_credit_days });
    var fromShop = S.shop && S.shop.credit_days !== '' && S.shop.credit_days != null;
    if (!S.dueTouched) S.doc.due_date = S.doc.doc_date ? addDaysIso(S.doc.doc_date, days) : '';
    input.value = S.doc.due_date;
    th.textContent = formatThaiDateShort(S.doc.due_date);
    hint.textContent = S.dueTouched
      ? 'แก้เองแล้ว (ค่าที่ระบบคำนวณ: ' + formatThaiDate(addDaysIso(S.doc.doc_date, days)) + ')'
      : 'วันที่ + เครดิต ' + days + ' วัน' + (fromShop ? 'ของร้าน' : (S.shop ? ' (ค่าเริ่มต้น ร้านนี้ไม่ได้ตั้งเครดิต)' : ' (ค่าเริ่มต้น)')) + ' — แก้ได้';
  }

  // ---------- ร้านค้า
  function renderShop() {
    var box = document.getElementById('shop-box');
    document.getElementById('btn-copy').disabled = !S.shop;
    if (!S.shop) {
      box.innerHTML = '<button type="button" class="btn block" id="btn-shop">🔍 เลือกร้านค้า</button>';
      box.querySelector('#btn-shop').addEventListener('click', openShopPicker);
      return;
    }
    var s = S.shop;
    var addr = splitAddress(s.address);
    var taxOk = isValidTaxId(s.tax_id);
    box.innerHTML =
      '<div class="picked">' +
      '  <div class="row"><div class="grow"><div class="name">' + esc(s.legal_name) + '</div>' +
      '    <div class="small muted">' + esc(s.short_name) + ' · ลำดับ ' + esc(s.shop_id) + '</div></div>' +
      '    <button type="button" class="btn sm" id="btn-shop">เปลี่ยน</button></div>' +
      '  <div class="small" style="margin-top:6px">' + esc(addr[0]) + (addr[1] ? '<br>' + esc(addr[1]) : '') + '</div>' +
      '  <div class="small" style="margin-top:4px">สาขา: <b>' + esc(s.branch || '-') + '</b> · เลขผู้เสียภาษี: <b>' + esc(s.tax_id || '-') + '</b></div>' +
      (taxOk ? '' : '<div class="alert warn small" style="margin-top:8px">เลขประจำตัวผู้เสียภาษีไม่ใช่ตัวเลข 13 หลัก — ออกเอกสารได้ แต่กรุณาตรวจสอบ</div>') +
      '</div>';
    box.querySelector('#btn-shop').addEventListener('click', openShopPicker);
  }

  function openShopPicker() {
    var s = LiffApp.sheet('เลือกร้านค้า',
      '<input type="search" id="shop-q" placeholder="ค้นหาชื่อย่อ ชื่อเต็ม หรือเลขภาษี" autocomplete="off">' +
      '<ul class="list pick-list" id="shop-list" style="margin-top:8px"></ul>');
    var q = s.el.querySelector('#shop-q');
    var ul = s.el.querySelector('#shop-list');
    function draw() {
      var list = searchShops(S.init.shops, q.value); // init ส่งมาเฉพาะร้านที่ active
      ul.innerHTML = list.length ? list.map(function (x) {
        return '<li class="tap" data-id="' + esc(x.shop_id) + '"><div class="t"><div class="n">' + esc(x.short_name) + '</div>' +
          '<div class="s">' + esc(x.legal_name) + '</div><div class="s">สาขา ' + esc(x.branch || '-') + ' · ' + esc(x.tax_id || 'ไม่มีเลขภาษี') + '</div></div></li>';
      }).join('') : '<li class="empty">ไม่พบร้านที่ค้นหา</li>';
    }
    q.addEventListener('input', draw);
    ul.addEventListener('click', function (e) {
      var li = e.target.closest('li[data-id]');
      if (!li) return;
      S.shop = S.init.shops.find(function (x) { return String(x.shop_id) === li.dataset.id; });
      S.dueTouched = false;
      s.close();
      renderShop();
      updateDue();
    });
    draw();
    q.focus();
  }

  // ---------- สินค้า
  function renderLines() {
    var wrap = document.getElementById('lines');
    var max = cfg().max_items;
    document.getElementById('line-count').textContent = S.lines.length + '/' + max + ' บรรทัด';
    document.getElementById('btn-add').disabled = S.lines.length >= max;
    if (!S.lines.length) {
      wrap.innerHTML = '<div class="empty small">ยังไม่มีสินค้า กด "เพิ่มสินค้า"</div>';
      updateTotals();
      return;
    }
    wrap.innerHTML = S.lines.map(function (l, i) {
      return '<div class="line' + (l.is_free ? ' free' : '') + '" data-key="' + l.key + '">' +
        '<div class="head"><div class="t"><div class="n">' + (i + 1) + '. ' + esc(l.name) + '</div>' +
        '<div class="b">' + esc(l.barcode) + ' · ราคาตั้งต้น ' + money(l.list_price) + '/' + esc(l.unit) + '</div></div>' +
        '<button type="button" class="x" data-act="del" aria-label="ลบบรรทัด">✕</button></div>' +
        '<div class="grid">' +
        '<div><label>จำนวน (' + esc(l.unit) + ')</label><input type="number" inputmode="decimal" class="num" data-f="qty" min="0" step="any" value="' + esc(l.qty) + '"></div>' +
        '<div><label>ราคา/หน่วย</label><input type="number" inputmode="decimal" class="num" data-f="price" min="0" step="any" value="' + esc(l.is_free ? 0 : l.price) + '"' + (l.is_free ? ' disabled' : '') + '></div>' +
        '<div><label>ส่วนลด (บาท)</label><input type="number" inputmode="decimal" class="num" data-f="discount" min="0" step="any" value="' + esc(l.is_free ? 0 : l.discount) + '"' + (l.is_free ? ' disabled' : '') + '></div>' +
        '</div>' +
        '<div class="note"><input type="text" data-f="note" maxlength="200" placeholder="หมายเหตุ (ถ้ามี ไม่เกิน ' + esc(cfg().text_max_note || 20) + ' ตัวอักษร)" value="' + esc(l.note) + '"></div>' +
        '<div class="foot"><label class="chk"><input type="checkbox" data-f="is_free"' + (l.is_free ? ' checked' : '') + '> แถม</label>' +
        '<span class="amt num" data-amt></span></div>' +
        '</div>';
    }).join('');
    updateTotals();
  }

  function lineByEl(el) {
    var key = Number(el.closest('.line').dataset.key);
    return S.lines.find(function (l) { return l.key === key; });
  }

  document.addEventListener('input', function (e) {
    var f = e.target.dataset && e.target.dataset.f;
    if (!f || !e.target.closest('.line')) return;
    var l = lineByEl(e.target);
    if (f === 'is_free') return;
    l[f] = e.target.value;
    updateTotals();
  });
  document.addEventListener('change', function (e) {
    if (e.target.dataset && e.target.dataset.f === 'is_free') {
      var l = lineByEl(e.target);
      l.is_free = e.target.checked;
      if (!l.is_free && Number(l.price) === 0) l.price = l.list_price;
      renderLines();
    }
  });
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act=del]');
    if (!b) return;
    var l = lineByEl(b);
    S.lines = S.lines.filter(function (x) { return x !== l; });
    renderLines();
  });

  function addLine(p, over) {
    if (S.lines.length >= cfg().max_items) {
      LiffApp.toast('ใส่ได้ไม่เกิน ' + cfg().max_items + ' บรรทัด', true);
      return false;
    }
    S.lines.push(Object.assign({
      key: ++S.lastKey, barcode: p.barcode, name: p.name, unit: p.unit, list_price: p.price,
      qty: 1, price: p.price, discount: 0, is_free: false, note: ''
    }, over || {}));
    return true;
  }

  function openProductPicker() {
    var s = LiffApp.sheet('เพิ่มสินค้า',
      '<input type="search" id="prod-q" placeholder="ค้นหาชื่อสินค้าหรือบาร์โค้ด" autocomplete="off">' +
      '<ul class="list pick-list" id="prod-list" style="margin-top:8px"></ul>');
    var q = s.el.querySelector('#prod-q');
    var ul = s.el.querySelector('#prod-list');
    function draw() {
      var term = q.value.trim().toLowerCase();
      var list = S.init.products.filter(function (p) {
        return !term || (p.name + ' ' + p.barcode).toLowerCase().indexOf(term) >= 0;
      });
      ul.innerHTML = list.length ? list.map(function (p) {
        return '<li class="tap" data-bc="' + esc(p.barcode) + '"><div class="t"><div class="n">' + esc(p.name) + '</div>' +
          '<div class="s">' + esc(p.barcode) + '</div></div><div class="num right"><b>' + money(p.price) + '</b><div class="small muted">/' + esc(p.unit) + '</div></div></li>';
      }).join('') : '<li class="empty">ไม่พบสินค้า</li>';
    }
    q.addEventListener('input', draw);
    ul.addEventListener('click', function (e) {
      var li = e.target.closest('li[data-bc]');
      if (!li) return;
      var p = S.init.products.find(function (x) { return x.barcode === li.dataset.bc; });
      if (addLine(p)) {
        s.close();
        renderLines();
        var last = document.querySelector('.line:last-child input[data-f=qty]');
        if (last) { last.focus(); last.select(); }
      }
    });
    draw();
    q.focus();
  }

  // ---------- คัดลอกจากบิลเก่า (ย้ายจาก public/liff/liff.js)
  async function openCopyFromOld() {
    if (!S.shop) return;
    var s = LiffApp.sheet('คัดลอกจากบิลเก่า — ' + S.shop.short_name, '');
    var body = s.el.querySelector('.body');
    LiffApp.loading('กำลังโหลดบิลเก่าของร้านนี้…', body);
    var r = await LiffApp.api('listDocuments', { shopId: S.shop.shop_id, limit: 20 });
    if (!r.ok) { body.innerHTML = '<div class="alert err">' + esc(r.error) + '</div>'; return; }
    if (!r.documents.length) { body.innerHTML = '<div class="empty" id="copy-empty">ร้านนี้ยังไม่มีบิลเก่า</div>'; return; }
    body.innerHTML = '<p class="small muted" style="margin-top:0">เลือกบิลเพื่อดึงรายการสินค้า จำนวน ราคา ส่วนลด และของแถม มาใส่ในฟอร์ม</p><ul class="list pick-list" id="copy-list">' +
      r.documents.map(function (d) {
        return '<li class="tap" data-no="' + d.doc_no + '"><div class="t"><div class="n">#' + d.doc_no + ' · ' + formatThaiDate(d.doc_date) + '</div>' +
          '<div class="s">' + esc(d.doc_type) + '</div></div><div class="right"><b class="num">' + money(d.total) + '</b><br>' +
          (d.status === 'cancelled' ? '<span class="badge red">ยกเลิก</span>' : '') + '</div></li>';
      }).join('') + '</ul>';
    body.addEventListener('click', async function (e) {
      var li = e.target.closest('li[data-no]');
      if (!li) return;
      if (S.lines.length && !confirm('แทนที่รายการสินค้า ' + S.lines.length + ' บรรทัดที่มีอยู่ด้วยรายการจากบิล #' + li.dataset.no + '?')) return;
      var g = await LiffApp.api('getDocument', { docNo: Number(li.dataset.no) });
      if (!g.ok) { LiffApp.toast(g.error, true); return; }
      S.lines = [];
      var skipped = [];
      g.items.forEach(function (it) {
        var p = S.init.products.find(function (x) { return x.barcode === it.barcode; }); // init มีเฉพาะสินค้าที่ยังขาย
        if (!p) { skipped.push(it.name); return; }
        addLine(p, { qty: it.qty, price: it.is_free ? p.price : it.price, discount: it.discount, is_free: !!it.is_free, note: it.note || '' });
      });
      s.close();
      renderLines();
      LiffApp.toast('คัดลอก ' + S.lines.length + ' บรรทัดจากบิล #' + li.dataset.no +
        (skipped.length ? '\nข้าม ' + skipped.length + ' รายการที่เลิกขายแล้ว: ' + skipped.join(', ') : ''), skipped.length > 0);
    });
  }

  // ---------- ยอดรวม
  function updateTotals() {
    var t = calcTotals(S.lines, cfg().vat_rate);
    document.getElementById('t-net').textContent = money(t.net_before_vat);
    document.getElementById('t-vat').textContent = money(t.vat);
    document.getElementById('t-total').textContent = money(t.total);
    document.querySelectorAll('.line').forEach(function (el) {
      var l = S.lines.find(function (x) { return x.key === Number(el.dataset.key); });
      var c = calcLine(l);
      var txt = l.is_free ? 'แถม · 0.00' : money(c.amount) + (c.discount ? ' − ' + money(c.discount) : '');
      el.querySelector('[data-amt]').textContent = txt;
    });
  }

  function buildDocumentPayload() {
    return {
      doc_type: S.doc.doc_type,
      doc_date: S.doc.doc_date,
      ref: S.doc.ref.trim(),
      sale_type: S.doc.sale_type,
      due_date: isCash() ? '' : S.doc.due_date,
      shop_id: S.shop ? S.shop.shop_id : '',
      date_confirmed: S.dateConfirmed || '', // ติ๊ก "ยืนยันว่าตั้งใจลงวันที่นี้" แล้ว = วันที่นั้น (เซิร์ฟเวอร์ตรวจว่าตรงกับ doc_date)
      items: S.lines.map(function (l) {
        return { barcode: l.barcode, qty: l.qty, price: l.is_free ? 0 : l.price, discount: l.is_free ? 0 : (l.discount === '' ? 0 : l.discount), is_free: l.is_free, note: l.note.trim() };
      })
    };
  }

  // ---------- หน้าตรวจสอบ
  document.getElementById('btn-review').addEventListener('click', showReview);

  /**
   * ตรวจบนมือถือทันที (preview.js — invoice.js / money.js ชุดเดียวกับเซิร์ฟเวอร์ + ขีดจำกัดจากแท็บตั้งค่า) ไม่รอเซิร์ฟเวอร์
   * ยอดที่แสดงส่งไปเป็น expected ตอนยืนยัน → เซิร์ฟเวอร์คำนวณซ้ำ ถ้าไม่ตรงจะไม่บันทึก
   */
  function showReview() {
    S.dateConfirmed = ''; // ทุกรอบตรวจต้องติ๊กยืนยันวันที่ใหม่
    var payload = buildDocumentPayload();
    var r = previewLocal(payload, S.init);
    S.requestId = LiffApp.uuid(); // รหัสคำขอของรอบยืนยันนี้
    S.expected = r.totals;
    S.screen = 'review';

    totalbar.classList.add('hidden');
    document.getElementById('title').textContent = 'ตรวจสอบก่อนยืนยัน';
    document.getElementById('subtitle').textContent = 'เลขที่จะได้โดยประมาณ #' + r.nextDocNo;
    var t = r.totals;
    var s = S.shop;
    view.innerHTML =
      (r.errors.length ? '<div class="card alert err" id="review-errors"><b>ต้องแก้ไขก่อนออกเอกสาร</b><ul>' + r.errors.map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('') + '</ul></div>' : '') +
      (r.dateConfirm && !r.errors.length ? dateConfirmBox(r.dateConfirm) : '') +
      (r.warnings.length ? '<div class="card alert warn" id="review-warnings"><b>คำเตือน (ออกเอกสารได้)</b><ul>' + r.warnings.map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('') + '</ul></div>' : '') +
      '<section class="card"><h2>' + esc(payload.doc_type) + '</h2><dl class="kv">' +
      '<dt>วันที่</dt><dd>' + esc(formatThaiDate(payload.doc_date) || '-') + '</dd>' +
      '<dt>อ้างถึง</dt><dd>' + esc(payload.ref || '-') + '</dd>' +
      '<dt>ชนิดการขาย</dt><dd>' + esc(payload.sale_type) + '</dd>' +
      '<dt>ครบกำหนดชำระ</dt><dd>' + esc(r.due_date ? formatThaiDate(r.due_date) : '-') + '</dd>' +
      '</dl></section>' +
      '<section class="card"><h2>ลูกค้า</h2>' + (s ? '<div><b>' + esc(s.legal_name) + '</b></div><div class="small">' + esc(s.address) + '</div>' +
        '<div class="small">สาขา ' + esc(s.branch || '-') + ' · เลขผู้เสียภาษี ' + esc(s.tax_id || '-') + '</div>' : '<div class="muted">ยังไม่ได้เลือกร้าน</div>') + '</section>' +
      '<section class="card"><h2>สินค้า <span class="count">' + payload.items.length + ' บรรทัด</span></h2><table class="review-items">' +
      S.lines.map(function (l) {
        var c = calcLine(l);
        return '<tr><td>' + esc(l.name) + '<div class="small muted">' + esc(formatQty(c.qty)) + ' ' + esc(l.unit) + ' × ' + money(c.price) +
          (c.discount ? ' ลด ' + money(c.discount) : '') + (l.note.trim() ? ' · ' + esc(l.note.trim()) : '') + '</div></td>' +
          '<td class="r num">' + (c.is_free ? '<span class="badge">แถม</span>' : money(c.amount - c.discount)) + '</td></tr>';
      }).join('') + '</table>' +
      '<div style="margin-top:10px" class="num">' +
      '<div class="sumrow"><span>รวมเงิน</span><span>' + money(t.sum_amount) + '</span></div>' +
      '<div class="sumrow"><span>ส่วนลดร้านค้า</span><span>' + money(t.discount) + '</span></div>' +
      '<div class="sumrow"><span>มูลค่าสินค้า (ก่อน VAT)</span><span>' + money(t.net_before_vat) + '</span></div>' +
      '<div class="sumrow"><span>ภาษีมูลค่าเพิ่ม ' + Math.round(cfg().vat_rate * 100) + '%</span><span>' + money(t.vat) + '</span></div>' +
      '<div class="sumrow grand"><span>รวมทั้งสิ้น</span><span id="review-total">' + money(t.total) + '</span></div>' +
      '<div class="small muted right">(' + esc(bahtText(t.total)) + ')</div></div></section>' +
      '<div class="card" style="background:transparent;box-shadow:none;padding:0 0 24px">' +
      '<div id="confirm-msg"></div>' +
      '<div class="row"><button type="button" class="btn grow" id="btn-back">‹ แก้ไข</button>' +
      '<button type="button" class="btn primary grow" id="btn-confirm"' + (r.errors.length ? ' disabled' : '') + '>ยืนยันออกเอกสาร</button></div></div>';

    document.getElementById('btn-back').addEventListener('click', function () { showForm(); scrollTop(); });
    document.getElementById('btn-confirm').addEventListener('click', confirmCreate);
    var tick = document.getElementById('date-confirm');
    if (tick) {
      // วันที่ไม่ใช่วันนี้: ปุ่มยืนยันกดได้หลังติ๊กเท่านั้น
      document.getElementById('btn-confirm').disabled = true;
      tick.addEventListener('change', function () {
        S.dateConfirmed = tick.checked ? r.dateConfirm.date : '';
        document.getElementById('btn-confirm').disabled = !tick.checked;
      });
    }
    scrollTop();
  }

  /** กล่องเตือนสีเหลือง: วันที่เอกสารไม่ใช่วันนี้ (ไม่เกินขีดจำกัด) + ช่องติ๊กยืนยัน */
  function dateConfirmBox(c) {
    return '<div class="card alert warn" id="date-confirm-box"><b>วันที่เอกสารไม่ใช่วันนี้</b><ul>' +
      c.messages.map(function (m) { return '<li>' + esc(m) + '</li>'; }).join('') + '</ul>' +
      '<label class="chk date-ok"><input type="checkbox" id="date-confirm"> ยืนยันว่าตั้งใจลงวันที่นี้</label></div>';
  }

  /** ความคืบหน้าทีละขั้น: บันทึกเอกสาร → สร้าง PDF → ส่งเข้าแชท (นอกแอป LINE ไม่มีขั้นส่ง) */
  function steps(box) {
    var list = [['save', 'บันทึกเอกสาร…'], ['pdf', 'สร้าง PDF… (อาจใช้เวลา 10–20 วินาที)']];
    if (LiffApp.inClient()) list.push(['send', 'ส่งเข้าแชท…']);
    box.innerHTML = '<ol class="steps" id="steps">' + list.map(function (s) { return '<li data-step="' + s[0] + '">' + s[1] + '</li>'; }).join('') + '</ol>';
    return function (step, state, text) {
      var li = document.querySelector('#steps li[data-step="' + step + '"]');
      if (!li) return;
      li.className = state;
      if (text) li.textContent = text;
    };
  }

  async function confirmCreate() {
    var btn = document.getElementById('btn-confirm');
    var back = document.getElementById('btn-back');
    var msg = document.getElementById('confirm-msg');
    btn.disabled = true;
    back.disabled = true;
    btn.textContent = 'กำลังออกเอกสาร…';
    var mark = steps(msg);
    // ขั้นที่ 1: บันทึก (ออกเลข) แล้วตอบทันที — เซิร์ฟเวอร์ตรวจและคำนวณซ้ำ เทียบยอดกับที่มือถือแสดง (expected)
    mark('save', 'doing');
    var r = await LiffApp.api('createDocument', { requestId: S.requestId, document: buildDocumentPayload(), expected: S.expected, deferPdf: true });
    if (!r.ok) {
      msg.innerHTML = '';
      if (LiffApp.isDenied(r.code)) return LiffApp.showApiError(r);
      btn.disabled = false;
      back.disabled = false;
      // เน็ตหลุด / มีคนออกบิลพร้อมกัน: กดใหม่ใช้ requestId เดิม ระบบจะไม่ออกเลขซ้ำ
      btn.textContent = LiffApp.isRetryable(r) ? 'ลองอีกครั้ง' : 'ยืนยันออกเอกสาร';
      if (r.code === 'mismatch' || r.code === 'invalid') {
        btn.disabled = true; // ต้องกลับไปแก้/ตรวจใหม่ก่อน
        refreshInBackground(); // ข้อมูลที่จำไว้อาจเก่า → ดึงใหม่ให้รอบตรวจถัดไป
      }
      msg.innerHTML = '<div class="alert err" id="confirm-error" style="margin-bottom:10px">' + esc(r.error || 'ออกเอกสารไม่สำเร็จ').replace(/\n/g, '<br>') + '</div>';
      if (r.code === 'token_expired') {
        var re = LiffApp.el('<button type="button" class="btn block" style="margin-bottom:10px">เข้าสู่ระบบใหม่</button>');
        re.addEventListener('click', LiffApp.relogin.run);
        msg.appendChild(re);
      }
      return;
    }
    mark('save', 'done', 'บันทึกเอกสารแล้ว เลขที่ #' + r.docNo);
    rememberIssued(r.docNo);
    // ขั้นที่ 2: สร้าง PDF (คำขอที่สอง — ใบเดิมที่มี PDF แล้วได้ลิงก์เดิม)
    if (!r.pdfUrl) {
      mark('pdf', 'doing');
      var p = await LiffApp.api('regeneratePdf', { docNo: r.docNo });
      if (!p.ok) {
        if (LiffApp.isDenied(p.code)) return LiffApp.showApiError(p);
        mark('pdf', 'fail');
        return showPdfFailed(Object.assign({}, r, { pdfError: 'บันทึกเอกสารเลขที่ ' + r.docNo + ' แล้ว แต่' + (p.error || 'สร้าง PDF ไม่สำเร็จ') }));
      }
      r = Object.assign({}, r, { pdfUrl: p.pdfUrl });
    }
    mark('pdf', 'done', 'สร้าง PDF แล้ว');
    // ขั้นที่ 3: ส่งเข้าแชท (finish)
    mark('send', 'doing');
    await finish(r);
  }

  /** หลังออกบิล: เลขถัดไปที่จำไว้ = เลขนี้ + 1 และวันที่ของใบล่าสุด (ข้อมูลจริงจะมาแทนเมื่อเปิดหน้าครั้งต่อไป) */
  function rememberIssued(docNo) {
    var c = LiffApp.remember('init');
    var data = c ? c.data : S.init;
    if (!data) return;
    data.nextDocNo = Math.max(Number(data.nextDocNo) || 0, Number(docNo) + 1);
    data.lastDoc = { doc_no: Number(docNo), doc_date: S.doc.doc_date, status: 'issued' };
    LiffApp.keep('init', data);
  }

  async function refreshInBackground() {
    var r = await LiffApp.api('init');
    if (r.ok) { LiffApp.keep('init', r); S.init = r; }
  }

  // ---------- PDF ล้มเหลว (เอกสารถูกบันทึกแล้ว)
  /** บอกเลขที่ที่บันทึกแล้ว + ปุ่ม "ลองสร้าง PDF ใหม่" (regeneratePdf) สำเร็จแล้วค่อยส่ง "บิล <เลขที่>" เข้าแชท */
  function showPdfFailed(r) {
    S.screen = 'done';
    totalbar.classList.add('hidden');
    document.getElementById('title').textContent = 'บันทึกเอกสารแล้ว';
    document.getElementById('subtitle').textContent = 'เลขที่ #' + r.docNo + ' · ยังไม่มี PDF';
    view.innerHTML =
      '<div class="success"><div class="muted">เลขที่เอกสาร</div><div class="no" id="saved-no">#' + esc(r.docNo) + '</div>' +
      '<div>' + esc(r.legalName || (S.shop && S.shop.legal_name) || '') + '</div><div class="num" style="font-size:20px;font-weight:700;margin-top:4px">' + money(r.total) + ' บาท</div></div>' +
      '<div class="card alert err" id="pdf-error">' + esc(r.pdfError) + '</div>' +
      '<div class="card stack">' +
      '<button type="button" class="btn primary block" id="btn-pdf-retry">ลองสร้าง PDF ใหม่</button>' +
      '<button type="button" class="btn block" id="btn-pdf-skip">ข้ามไปก่อน (ส่งการ์ดโดยยังไม่มี PDF)</button>' +
      '<div class="small muted">เอกสารถูกบันทึกแล้ว เลขที่ไม่เปลี่ยน กดลองใหม่กี่ครั้งก็ไม่ออกเลขซ้ำ</div>' +
      '</div>';
    document.getElementById('btn-pdf-retry').addEventListener('click', function () { retryPdf(r); });
    document.getElementById('btn-pdf-skip').addEventListener('click', function () { finish(Object.assign({}, r, { pdfUrl: '' })); });
    scrollTop();
  }

  async function retryPdf(r) {
    var btn = document.getElementById('btn-pdf-retry');
    var skip = document.getElementById('btn-pdf-skip');
    var box = document.getElementById('pdf-error');
    btn.disabled = true;
    skip.disabled = true;
    btn.textContent = 'กำลังสร้าง PDF…';
    var res = await LiffApp.api('regeneratePdf', { docNo: r.docNo });
    if (res.ok) {
      await finish(Object.assign({}, r, { pdfUrl: res.pdfUrl, pdfError: '' }));
      return;
    }
    if (LiffApp.isDenied(res.code) || res.code === 'token_expired') return LiffApp.showApiError(res);
    btn.disabled = false;
    skip.disabled = false;
    btn.textContent = 'ลองสร้าง PDF ใหม่';
    box.textContent = res.error || 'สร้าง PDF ไม่สำเร็จ กรุณาลองใหม่';
  }

  // ---------- สำเร็จ
  /** ในแอป LINE: ส่ง "บิล <เลขที่>" เข้าแชทแล้วปิดหน้า / นอกแอป LINE หรือส่งไม่ได้: แสดงหน้าสำเร็จ */
  async function finish(r) {
    if (LiffApp.inClient()) {
      try {
        await liff.sendMessages([{ type: 'text', text: 'บิล ' + r.docNo }]);
      } catch (e) {
        showSuccess(r, 'ส่งข้อความเข้าแชทไม่สำเร็จ — พิมพ์ "บิล ' + r.docNo + '" ในแชท OA เพื่อดูการ์ดเอกสาร');
        return;
      }
      showSuccess(r, 'ส่ง "บิล ' + r.docNo + '" เข้าแชทแล้ว กำลังปิดหน้า…');
      liff.closeWindow();
      return;
    }
    showSuccess(r, 'เปิดนอกแอป LINE จึงไม่ได้ส่งข้อความเข้าแชท — พิมพ์ "บิล ' + r.docNo + '" ในแชท OA เพื่อดูการ์ดเอกสาร');
  }

  function showSuccess(r, note) {
    S.screen = 'done';
    totalbar.classList.add('hidden');
    document.getElementById('title').textContent = 'ออกเอกสารสำเร็จ';
    document.getElementById('subtitle').textContent = '';
    view.innerHTML =
      '<div class="success" id="success"><div class="check">✓</div><div class="muted">เลขที่เอกสาร</div><div class="no" id="success-no">#' + esc(r.docNo) + '</div>' +
      '<div>' + esc(r.legalName || (S.shop && S.shop.legal_name) || '') + '</div><div class="num" style="font-size:20px;font-weight:700;margin-top:4px">' + money(r.total) + ' บาท</div></div>' +
      (r.duplicate ? '<div class="card alert warn">คำขอนี้เคยออกเอกสารไปแล้ว จึงแสดงเลขที่เดิม (ไม่ได้ออกเลขใหม่)</div>' : '') +
      (r.warnings && r.warnings.length ? '<div class="card alert warn"><ul style="margin:0">' + r.warnings.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul></div>' : '') +
      '<div class="card alert ok" id="success-note">' + esc(note) + '</div>' +
      '<div class="card stack">' +
      (r.pdfUrl
        ? '<a class="btn block" id="btn-pdf" href="' + esc(r.pdfUrl) + '" target="_blank" rel="noopener">📄 เปิด PDF</a>'
        : '<div class="small muted" id="no-pdf">ยังไม่มี PDF — สร้างภายหลังได้ที่เมนู "ประวัติเอกสาร" (ปุ่ม "สร้าง PDF ใหม่")</div>') +
      '<button type="button" class="btn primary block" id="btn-new">ออกบิลใหม่</button>' +
      '</div>';
    document.getElementById('btn-new').addEventListener('click', load);
    scrollTop();
  }

  LiffApp.start().then(function (ready) { if (ready) load(); });
})();
