/*
 * issue.js — ฟอร์มออกบิลบน LIFF จริง (ย้ายมาจาก public/liff/liff.js ของระบบจำลอง หน้าตาและขั้นตอนเดิม)
 *   เลือกร้าน → เพิ่มสินค้า → ตรวจสอบ (previewDocument) → ยืนยัน (createDocument)
 * คำนวณด้วยไฟล์ชุดเดียวกับเซิร์ฟเวอร์ (money.js, invoice.js ... สำเนาตรงตัวของ src/core)
 * ต่างจากระบบจำลอง:
 *   - เรียก Apps Script ผ่าน LiffApp.api (ส่ง idToken) แทน Sim.api
 *   - ยังไม่มีปุ่ม "คัดลอกจากบิลเก่า" (รอบที่ 4) และยังไม่มี PDF (รอบที่ 3)
 *   - ออกบิลสำเร็จในแอป LINE: liff.sendMessages("บิล <เลขที่>") แล้วปิดหน้า / นอกแอป LINE: แสดงหน้าสำเร็จ
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
  async function load() {
    view.innerHTML = '<div class="empty">กำลังโหลด…</div>';
    totalbar.classList.add('hidden');
    var r = await LiffApp.api('init');
    if (!r.ok) return LiffApp.showApiError(r);
    S.init = r;
    S.doc = { doc_type: r.config.doc_types[0], doc_date: r.today, ref: '', sale_type: r.config.sale_type_labels[0], due_date: '' };
    S.shop = null;
    S.lines = [];
    S.dueTouched = false;
    showForm();
  }

  // ---------- ฟอร์ม
  function showForm() {
    document.getElementById('title').textContent = 'ออกเอกสาร';
    document.getElementById('subtitle').textContent = 'เลขที่ถัดไปโดยประมาณ #' + S.init.nextDocNo + ' (ออกเลขจริงตอนยืนยัน) · ' + S.init.name;
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
      '    <div><label class="f" for="doc-date">วันที่</label><input type="date" id="doc-date" value="' + esc(S.doc.doc_date) + '"></div>' +
      '    <div><label class="f" for="doc-ref">อ้างถึง</label><input type="text" id="doc-ref" placeholder="เช่น เลข PO" maxlength="100" value="' + esc(S.doc.ref) + '"></div>' +
      '  </div>' +
      '  <div class="field"><label class="f">ชนิดการขาย</label><div class="seg-choice" id="sale-type">' +
      labels().map(function (t) {
        return '<label><input type="radio" name="sale_type" value="' + esc(t) + '"' + (t === S.doc.sale_type ? ' checked' : '') + '>' + esc(t) + '</label>';
      }).join('') + '</div></div>' +
      '  <div class="field"><label class="f" for="due-date">วันครบกำหนดชำระ</label><input type="date" id="due-date">' +
      '    <div class="hint" id="due-hint"></div></div>' +
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
      // ปุ่ม "คัดลอกจากบิลเก่า" ซ่อนไว้ก่อน — ทำในรอบที่ 4 (ต้องมี API ประวัติเอกสาร)
      '  </div>' +
      '</section>';

    view.querySelectorAll('input[name=doc_type]').forEach(function (i) {
      i.addEventListener('change', function () { S.doc.doc_type = i.value; });
    });
    view.querySelectorAll('input[name=sale_type]').forEach(function (i) {
      i.addEventListener('change', function () { S.doc.sale_type = i.value; S.dueTouched = false; updateDue(); });
    });
    document.getElementById('doc-date').addEventListener('change', function (e) { S.doc.doc_date = e.target.value; S.dueTouched = false; updateDue(); });
    document.getElementById('doc-ref').addEventListener('input', function (e) { S.doc.ref = e.target.value; });
    document.getElementById('due-date').addEventListener('change', function (e) { S.doc.due_date = e.target.value; S.dueTouched = true; updateDue(); });
    document.getElementById('btn-add').addEventListener('click', openProductPicker);

    renderShop();
    renderLines();
    updateDue();
  }

  function updateDue() {
    var input = document.getElementById('due-date');
    var hint = document.getElementById('due-hint');
    if (!input) return;
    if (isCash()) {
      S.doc.due_date = '';
      input.value = '';
      input.disabled = true;
      hint.textContent = 'ขายเงินสด ไม่มีวันครบกำหนดชำระ';
      return;
    }
    input.disabled = false;
    var days = creditDaysOf(S.shop, { default_credit_days: cfg().default_credit_days });
    var fromShop = S.shop && S.shop.credit_days !== '' && S.shop.credit_days != null;
    if (!S.dueTouched) S.doc.due_date = S.doc.doc_date ? addDaysIso(S.doc.doc_date, days) : '';
    input.value = S.doc.due_date;
    hint.textContent = S.dueTouched
      ? 'แก้เองแล้ว (ค่าที่ระบบคำนวณ: ' + formatThaiDate(addDaysIso(S.doc.doc_date, days)) + ')'
      : 'วันที่ + เครดิต ' + days + ' วัน' + (fromShop ? 'ของร้าน' : (S.shop ? ' (ค่าเริ่มต้น ร้านนี้ไม่ได้ตั้งเครดิต)' : ' (ค่าเริ่มต้น)')) + ' — แก้ได้';
  }

  // ---------- ร้านค้า
  function renderShop() {
    var box = document.getElementById('shop-box');
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
        '<div class="note"><input type="text" data-f="note" maxlength="200" placeholder="หมายเหตุ (ถ้ามี)" value="' + esc(l.note) + '"></div>' +
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
      items: S.lines.map(function (l) {
        return { barcode: l.barcode, qty: l.qty, price: l.is_free ? 0 : l.price, discount: l.is_free ? 0 : (l.discount === '' ? 0 : l.discount), is_free: l.is_free, note: l.note.trim() };
      })
    };
  }

  // ---------- หน้าตรวจสอบ
  document.getElementById('btn-review').addEventListener('click', showReview);

  async function showReview() {
    var btn = document.getElementById('btn-review');
    btn.disabled = true;
    btn.textContent = 'กำลังตรวจ…';
    var payload = buildDocumentPayload();
    var r = await LiffApp.api('previewDocument', { document: payload });
    btn.disabled = false;
    btn.textContent = 'ตรวจสอบ ›';
    if (!r.ok) {
      if (r.code === 'token_expired' || r.code === 'forbidden') return LiffApp.showApiError(r);
      LiffApp.toast(r.error || 'ตรวจสอบไม่สำเร็จ กรุณาลองใหม่', true);
      return;
    }
    S.requestId = LiffApp.uuid(); // รหัสคำขอของรอบยืนยันนี้

    totalbar.classList.add('hidden');
    document.getElementById('title').textContent = 'ตรวจสอบก่อนยืนยัน';
    document.getElementById('subtitle').textContent = 'เลขที่จะได้โดยประมาณ #' + r.nextDocNo;
    var t = r.totals;
    var s = S.shop;
    view.innerHTML =
      (r.errors.length ? '<div class="card alert err" id="review-errors"><b>ต้องแก้ไขก่อนออกเอกสาร</b><ul>' + r.errors.map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('') + '</ul></div>' : '') +
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
    scrollTop();
  }

  async function confirmCreate() {
    var btn = document.getElementById('btn-confirm');
    var back = document.getElementById('btn-back');
    var msg = document.getElementById('confirm-msg');
    btn.disabled = true;
    back.disabled = true;
    btn.textContent = 'กำลังออกเอกสาร…';
    msg.innerHTML = '';
    var r = await LiffApp.api('createDocument', { requestId: S.requestId, document: buildDocumentPayload() });
    if (!r.ok) {
      if (r.code === 'forbidden') return LiffApp.showApiError(r);
      btn.disabled = false;
      back.disabled = false;
      // เน็ตหลุด / มีคนออกบิลพร้อมกัน: กดใหม่ใช้ requestId เดิม ระบบจะไม่ออกเลขซ้ำ
      btn.textContent = LiffApp.isRetryable(r) ? 'ลองอีกครั้ง' : 'ยืนยันออกเอกสาร';
      msg.innerHTML = '<div class="alert err" id="confirm-error" style="margin-bottom:10px">' + esc(r.error || 'ออกเอกสารไม่สำเร็จ').replace(/\n/g, '<br>') + '</div>';
      if (r.code === 'token_expired') {
        var re = LiffApp.el('<button type="button" class="btn block" style="margin-bottom:10px">เข้าสู่ระบบใหม่</button>');
        re.addEventListener('click', LiffApp.relogin.run);
        msg.appendChild(re);
      }
      return;
    }
    await finish(r);
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
      '<div class="small muted">ยังไม่มี PDF (จะเพิ่มในรอบถัดไป)</div>' +
      '<button type="button" class="btn primary block" id="btn-new">ออกบิลใหม่</button>' +
      '</div>';
    document.getElementById('btn-new').addEventListener('click', load);
    scrollTop();
  }

  LiffApp.start().then(function (ready) { if (ready) load(); });
})();
