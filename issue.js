/*
 * issue.js — ฟอร์มออกบิลบน LIFF จริง (ย้ายมาจาก public/liff/liff.js ของระบบจำลอง หน้าตาและขั้นตอนเดิม)
 *   เลือกร้าน → เพิ่มสินค้า → ตรวจสอบ (บนมือถือ preview.js) → ยืนยัน (createDocument deferPdf → regeneratePdf → ส่งเข้าแชท)
 * รอบ 5A-2: เปิดหน้าแสดงข้อมูลที่จำไว้ทันที / ตรวจสอบไม่รอเซิร์ฟเวอร์ / ยืนยันแสดงความคืบหน้าทีละขั้น
 *   เซิร์ฟเวอร์ตรวจและคำนวณซ้ำตอนบันทึก ยอดไม่ตรงกับที่มือถือแสดง (expected) = ไม่บันทึก (code mismatch)
 * คำนวณด้วยไฟล์ชุดเดียวกับเซิร์ฟเวอร์ (money.js, invoice.js, cashDoc.js ... สำเนาตรงตัวของ src/core)
 *   - ปุ่ม "คัดลอกจากบิลเก่า" (รอบที่ 4): ใช้จำนวน/ราคา/ส่วนลด/แถม/หมายเหตุจากบิลเก่า ข้ามสินค้าที่เลิกขาย (เหมือนระบบจำลอง)
 *   - ยืนยันแล้วสร้าง PDF ต่อ ถ้า PDF ล้มเหลว เอกสารยังถูกบันทึก → หน้า "บันทึกบิลแล้ว" + ปุ่ม "ลองอีกครั้ง" (regeneratePdf)
 *   - ออกบิลสำเร็จในแอป LINE: liff.sendMessages("บิล <เลขที่>" / "เงินสด <เลขที่>") แล้วปิดหน้า / นอกแอป LINE: หน้าสำเร็จ + ปุ่มเปิด PDF
 * รอบ 6 ข้อ 3.5: เป็นหน้าจอหนึ่งของแอปหน้าเดียว (shell.js) — ข้อมูลจาก AppData ไม่เรียกเซิร์ฟเวอร์ตอนสลับหน้าจอ
 *   ทุกการหา element อยู่ในหน้าจอนี้ ($) เพราะหน้าจอที่ไม่ได้แสดงถูกถอดออกจากเอกสาร
 * รอบ 10: สองโหมด (LiffApp.MODE)
 *   ใบกำกับภาษี: ช่อง "เลขที่บิล" บนสุดทุกใบ (ว่างทุกครั้ง พิมพ์เอง 1–9999 / 0000 = บิลทดสอบจนกว่าจะมีบิลจริง) เตือนเลขซ้ำก่อนส่ง ไม่มีช่องติ๊กยืนยัน
 *   ใบเงินสด: ร้าน → สินค้า → ตรวจสอบ / ไม่มีภาษี ประเภท (รอบ 19: มีชนิดการขาย เงินสด/เครดิต/สินเชื่อ + วันครบกำหนดเหมือนใบกำกับ)
 *     เลขที่ระบบรันให้ (แสดงเลขโดยประมาณ) / ยังไม่มีใบจริง → ติ๊ก "บิลทดสอบ (0000)" ได้
 *   รอบ 19 ทั้งสองประเภท: วันครบกำหนดเริ่มว่าง ผู้ใช้เลือกเอง (เครดิต/สินเชื่อต้องใส่ ไม่ก่อนวันที่บิล) / เงินสดซ่อนช่อง
 */
(function () {
  var esc = LiffApp.esc;
  var CASH = LiffApp.isCash();
  var scr = null;   // หน้าจอนี้ { root, dock, $ } (Shell สร้าง)
  var view = null;  // #view ของหน้าจอนี้
  var totalbar = null;
  function $(id) { return scr.$(id); }
  /** เลื่อนเนื้อหากลับบนสุด (เนื้อหาเลื่อนใน #app ไม่ใช่ window) */
  function scrollTop() { Shell.scrollTop(scr); }

  var TITLE = 'ออกบิล'; // รอบ 13: ทั้งสองประเภท (ประเภทดูจากป้ายบนหัว)
  var CHAT_CMD = CASH ? 'เงินสด ' : 'บิล '; // คำสั่งในแชทที่บอทตอบเป็นการ์ดของบิล

  var S = {
    init: null,       // ข้อมูลตั้งต้น (AppData.issueInit)
    doc: null,        // หัวเอกสารในฟอร์ม
    shop: null,       // ร้านที่เลือก
    lines: [],        // รายการสินค้า
    requestId: null,  // 1 ค่าต่อ 1 รอบการยืนยัน (ใช้ซ้ำถ้ากดลองใหม่หลังเน็ตหลุด)
    lastKey: 0,
    docNoInput: '',   // ใบกำกับ: เลขที่ที่พิมพ์
    cashTest: false   // ใบเงินสด: ออกเป็นบิลทดสอบ 0000
  };

  function cfg() { return S.init.config; }
  /** ชนิดการขายที่เลือกได้ — ใบเงินสด (รอบ 19) เซิร์ฟเวอร์รุ่นเก่า / ชีตยังไม่อัปเดตส่งมาแค่ ['เงินสด'] หรือไม่ส่ง → ไม่มีตัวเลือก */
  function labels() { var l = cfg().sale_type_labels; return Array.isArray(l) && l.length ? l : [CASH_DOC_SALE_TYPE]; }
  function isCashSaleType() { return S.doc.sale_type === (cfg().cash_sale_label || CASH_DOC_SALE_TYPE); }
  function money(n) { return formatMoney(n); }
  /** บาร์โค้ดที่แสดง (สินค้าที่ไม่มีบาร์โค้ด → "ไม่มีบาร์โค้ด") */
  function barcodeText(code) { return printedBarcode(code) || 'ไม่มีบาร์โค้ด'; }

  // ---------- โหลดข้อมูล: จาก AppData (มีที่จำไว้ → แสดงทันที แล้วดึงใหม่เบื้องหลัง) → ฟอร์มว่าง
  async function load() {
    totalbar.classList.add('hidden');
    S.screen = 'loading';
    if (!AppData.has()) LiffApp.loading('กำลังโหลดข้อมูล…', view);
    var r = await AppData.ensure();
    if (!r.ok) { S.screen = 'error'; return LiffApp.showApiError(r, scr); }
    var init = AppData.issueInit();
    Shell.drawn(scr);
    if (init.error) { S.screen = 'error'; return LiffApp.showApiError(init.error, scr); }
    S.init = init;
    // รอบ 19: วันครบกำหนดเริ่มว่างเสมอ (ผู้ใช้เลือกเอง ระบบไม่คำนวณ) / ชนิดการขายตัวแรก (ใบกำกับ = เครดิต, ใบเงินสด = เงินสด)
    S.doc = CASH
      ? { doc_date: init.today, ref: '', sale_type: labels()[0], due_date: '' }
      : { doc_type: init.config.doc_types[0], doc_date: init.today, ref: '', sale_type: labels()[0], due_date: '' };
    S.shop = null;
    S.lines = [];
    S.docNoInput = '';
    S.cashTest = false;
    showForm();
  }

  /**
   * เลขที่ใบกำกับที่พิมพ์ — 0 / "0000" = บิลทดสอบ / 1–9999 = บิลจริง / ไม่ได้ใส่หรือไม่ถูกต้อง → -1
   * ตรงกับ apiFirstDocNo ใน Api.gs (เซิร์ฟเวอร์ตรวจซ้ำใน lock)
   */
  var DOC_NO_MAX = 9999;
  var TEST_DOC_NO = 0; // ตรงกับ API_TEST_DOC_NO ใน Api.gs
  function docNoOf(s) {
    s = String(s == null ? '' : s).trim();
    if (!/^[0-9]{1,6}$/.test(s)) return -1;
    var n = Number(s);
    return n <= DOC_NO_MAX ? n : -1;
  }
  var DOC_NO_ERROR = 'กรุณาใส่เลขที่บิล (ตัวเลข 1–9999)';
  /** เลขที่ซ้ำกับเอกสารที่แอปรู้จัก (รวมใบที่ยกเลิก — เซิร์ฟเวอร์ตรวจจริงอีกครั้งใน lock) */
  function docNoTaken(n) {
    return S.init.docNos.indexOf(n) >= 0 || AppData.recentDocs().some(function (d) { return Number(d.doc_no) === n; });
  }

  /** ข้อมูลในแอปเปลี่ยน (ดึงใหม่เสร็จ / ออกบิล / แก้ร้านหรือสินค้าในหน้าจัดการข้อมูล) — ฟอร์มที่กรอกไว้ไม่หาย */
  function update() {
    if (!S.init || !AppData.has()) return;
    var init = AppData.issueInit();
    Shell.drawn(scr);
    if (init.error) return;
    refreshInit(init);
  }

  /** ข้อมูลใหม่จากเซิร์ฟเวอร์มาถึงหลังแสดงจากที่จำไว้ — ฟอร์มยังว่างอยู่ = วาดใหม่ / กรอกไปแล้ว = แค่ใช้ข้อมูลใหม่ (ไม่ล้างสิ่งที่กรอก) */
  function refreshInit(r) {
    var untouched = S.screen === 'form' && !S.shop && !S.lines.length;
    var sameDay = S.doc && S.doc.doc_date === S.init.today;
    var realChanged = !!S.init.hasRealDoc !== !!r.hasRealDoc; // เช่น อีกคนออกบิลจริงใบแรกไปแล้ว → คำใบ้/ตัวเลือกบิลทดสอบหายไป
    S.init = r;
    if (sameDay && S.doc) S.doc.doc_date = r.today;
    if (!CASH && S.doc && r.config.doc_types.indexOf(S.doc.doc_type) < 0) S.doc.doc_type = r.config.doc_types[0];
    if (S.doc && labels().indexOf(S.doc.sale_type) < 0) S.doc.sale_type = labels()[0];
    if (r.hasRealDoc) S.cashTest = false;
    if (untouched || (realChanged && S.screen === 'form')) { showForm(); return; } // วาดใหม่จาก S (สิ่งที่กรอกไว้ไม่หาย)
    if (S.screen === 'form') { setSubtitle(); updateDocDateHint(); }
  }

  /** ใบกำกับ: เลขที่บิลจริงสูงสุดที่ใช้แล้ว (0 = ยังไม่มี) — ช่วยผู้ใช้พิมพ์เลขถัดไป */
  function lastTaxNo() {
    return S.init.docNos.reduce(function (m, n) { return n > m ? n : m; }, 0);
  }

  /** ใบเงินสด: เลขที่ใบจริงล่าสุด (เรียงตามเลขที่ — ไม่นับ 0000) หรือ '' */
  function lastCashNo() {
    var docs = AppData.recentDocs().filter(function (d) { var p = cashDocParse(d.doc_no); return p && !p.test; });
    return docs.length ? cashDocNoText(docs.slice().sort(cashDocCompareDesc)[0].doc_no) : '';
  }

  function setSubtitle() {
    var last = CASH ? lastCashNo() : (lastTaxNo() ? LiffApp.docNoText(lastTaxNo()) : '');
    $('subtitle').textContent = (last ? 'เลขที่ล่าสุด #' + last : 'ยังไม่มีบิล') + ' · ' + S.init.name;
  }

  /** ใบกำกับ: ช่องเลขที่บนสุดของฟอร์ม (ทุกใบ ว่างทุกครั้ง — ตัวอย่างในช่อง = เลขล่าสุด + 1) */
  function docNoField() {
    var hint = lastTaxNo() ? lastTaxNo() + 1 : 1701;
    return '<section class="card first-no" id="first-no-card">' +
      '  <div class="field"><label class="f" for="first-doc-no">เลขที่บิลใบนี้</label>' +
      '  <input type="text" id="first-doc-no" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="off" required placeholder="เช่น ' + hint + '" value="' + esc(S.docNoInput) + '">' +
      (S.init.hasRealDoc ? '' : '  <div class="hint" id="first-doc-hint">ทดสอบ: ใส่ 0000</div>') + '</div>' +
      '</section>';
  }

  /** ใบเงินสด: ตัวเลือกบิลทดสอบ 0000 (เฉพาะตอนยังไม่มีใบเงินสดจริง) */
  function cashTestField() {
    if (S.init.hasRealDoc) return '';
    return '<section class="card" id="cash-test-card"><label class="chk"><input type="checkbox" id="cash-test"' + (S.cashTest ? ' checked' : '') + '> ' +
      'ออกเป็นบิลทดสอบ (เลขที่ 0000)</label><div class="hint">ใช้ทดสอบก่อนเริ่มใช้จริง ออกซ้ำจะแทนที่ใบเดิม</div></section>';
  }

  // ---------- ฟอร์ม
  function showForm() {
    S.screen = 'form';
    $('title').textContent = TITLE;
    setSubtitle();
    totalbar.classList.remove('hidden');
    view.innerHTML = CASH ? cashFormHtml() : taxFormHtml();
    if (!CASH) {
      view.querySelectorAll('input[name=doc_type]').forEach(function (i) {
        i.addEventListener('change', function () { S.doc.doc_type = i.value; });
      });
      var noInput = $('first-doc-no');
      noInput.addEventListener('input', function () {
        var digits = noInput.value.replace(/[^0-9]/g, ''); // ตัวเลขเท่านั้น
        if (digits !== noInput.value) noInput.value = digits;
        S.docNoInput = digits;
      });
    } else {
      var t = $('cash-test');
      if (t) t.addEventListener('change', function () { S.cashTest = t.checked; setSubtitle(); });
    }
    view.querySelectorAll('input[name=sale_type]').forEach(function (i) {
      i.addEventListener('change', function () { S.doc.sale_type = i.value; updateDue(); });
    });
    if ($('due-date')) {
      $('due-date').addEventListener('change', function (e) { S.doc.due_date = e.target.value; updateDue(); });
      listenDateBox('due-date');
    }
    $('doc-date').addEventListener('change', function (e) { S.doc.doc_date = e.target.value; updateDocDateHint(); updateDue(); if (CASH) setSubtitle(); });
    $('doc-ref').addEventListener('input', function (e) { S.doc.ref = e.target.value; updateDocDateHint(); });
    listenDateBox('doc-date');
    $('btn-add').addEventListener('click', openProductPicker);
    $('btn-copy').addEventListener('click', openCopyFromOld);

    renderShop();
    renderLines();
    updateDocDateHint();
    updateDue();
  }

  function shopCard() {
    return '<section class="card"><h2>ร้านค้า</h2><div id="shop-box"></div></section>';
  }

  function linesCard() {
    return '<section class="card">' +
      '  <h2>รายการสินค้า <span class="count" id="line-count"></span></h2>' +
      '  <div id="lines"></div>' +
      '  <div class="row" style="margin-top:10px">' +
      '    <button type="button" class="btn block grow" id="btn-add">' + iconSvg('plus') + '<span>เพิ่มสินค้า</span></button>' +
      '    <button type="button" class="btn" id="btn-copy" title="คัดลอกรายการจากบิลเก่าของร้านนี้">' + iconSvg('copy') + '<span>คัดลอกจากบิลเก่า</span></button>' +
      '  </div>' +
      '</section>';
  }

  /** ใบกำกับภาษี: เลขที่ → ข้อมูลบิล → ร้าน → สินค้า (แบบเดิม) */
  function taxFormHtml() {
    var c = cfg();
    return docNoField() +
      '<section class="card">' +
      '  <h2>ข้อมูลบิล</h2>' +
      '  <div class="field"><div class="seg-choice" id="doc-type">' +
      c.doc_types.map(function (t) {
        return '<label><input type="radio" name="doc_type" value="' + esc(t) + '"' + (t === S.doc.doc_type ? ' checked' : '') + '>' + esc(t) + '</label>';
      }).join('') + '</div></div>' +
      '  <div class="field two">' +
      '    <div><label class="f" for="doc-date">วันที่</label>' + dateBox('doc-date', S.doc.doc_date) + '</div>' +
      '    <div><label class="f" for="doc-ref">อ้างถึง</label><input type="text" id="doc-ref" placeholder="เช่น เลข PO" maxlength="100" value="' + esc(S.doc.ref) + '"></div>' +
      '  </div>' +
      saleTypeFields() +
      '</section>' +
      shopCard() + linesCard();
  }

  /**
   * รอบ 19: ชนิดการขาย + วันครบกำหนดชำระ (ใบกำกับและใบเงินสดตำแหน่งเดียวกัน ใต้วันที่/อ้างถึง)
   * วันครบกำหนดเริ่มว่าง ผู้ใช้เลือกเอง / เงินสด → ซ่อนช่อง (updateDue) / ตัวเลือกเดียว (เซิร์ฟเวอร์ใบเงินสดรุ่นเก่า) → ไม่แสดงทั้งสองช่อง
   */
  function saleTypeFields() {
    if (labels().length < 2) return '';
    return '  <div class="field"><label class="f">ชนิดการขาย</label><div class="seg-choice" id="sale-type">' +
      labels().map(function (t) {
        return '<label><input type="radio" name="sale_type" value="' + esc(t) + '"' + (t === S.doc.sale_type ? ' checked' : '') + '>' + esc(t) + '</label>';
      }).join('') + '</div></div>' +
      '  <div class="field" id="due-field"><label class="f" for="due-date">วันครบกำหนดชำระ</label>' + dateBox('due-date', S.doc.due_date) + '</div>';
  }

  /**
   * ใบเงินสด: ลำดับเดียวกับใบกำกับ (รอบ 13) — (บิลทดสอบ แทนช่องเลขที่) → ข้อมูลบิล (วันที่ / อ้างถึง / ชนิดการขาย / ครบกำหนด) → ร้าน → สินค้า
   * ช่องที่ใบเงินสดไม่มี (เลขที่ ประเภทเอกสาร) ไม่แสดง
   */
  function cashFormHtml() {
    return cashTestField() +
      '<section class="card">' +
      '  <h2>ข้อมูลบิล</h2>' +
      '  <div class="field two">' +
      '    <div><label class="f" for="doc-date">วันที่</label>' + dateBox('doc-date', S.doc.doc_date) + '</div>' +
      '    <div><label class="f" for="doc-ref">อ้างถึง</label><input type="text" id="doc-ref" placeholder="เช่น เลข PO" maxlength="100" value="' + esc(S.doc.ref) + '"></div>' +
      '  </div>' +
      saleTypeFields() +
      '</section>' +
      shopCard() + linesCard();
  }

  /**
   * รอบ 9: ช่องวันที่แสดงวันที่ไทยบรรทัดเดียว เช่น "9 ต.ค. 2569" (ปฏิทินของมือถือแสดงเป็นภาษาอังกฤษ เช่น "9 Oct BE 2569")
   * ช่องวันที่จริง (input type=date) ซ้อนอยู่ด้านบนแบบโปร่งใส แตะแล้วยังเปิดปฏิทินของมือถือเหมือนเดิม
   */
  function dateBox(id, value) {
    return '<div class="date-box" id="' + id + '-box"><span class="date-text" id="' + id + '-th"></span>' + iconSvg('calendar') +
      '<input type="date" id="' + id + '" value="' + esc(value) + '"></div>';
  }

  /** คอมพิวเตอร์: คลิกตรงไหนของช่องก็เปิดปฏิทิน (มือถือเปิดเองอยู่แล้ว) */
  function listenDateBox(id) {
    var input = $(id);
    input.addEventListener('click', function () {
      try { if (typeof input.showPicker === 'function') input.showPicker(); } catch (e) { /* บางเบราว์เซอร์ไม่ให้เรียก ไม่เป็นไร */ }
    });
  }

  /** ข้อความในช่องวันที่เอกสาร (วันที่ไทย) — ย้อนหลัง/ล่วงหน้า แจ้งตอนกด "ตรวจสอบ" */
  function updateDocDateHint() {
    var el = $('doc-date-th');
    if (!el) return;
    var d = S.doc.doc_date;
    el.textContent = isIsoDate(d) ? formatThaiDateShort(d) : 'เลือกวันที่';
  }

  /** รอบ 19: เงินสด → ซ่อนช่องวันครบกำหนด / เครดิต-สินเชื่อ → แสดง (ว่างจนผู้ใช้เลือก — ไม่คำนวณจากเครดิตของร้าน) */
  function updateDue() {
    var input = $('due-date');
    if (!input) return;
    var th = $('due-date-th');
    $('due-field').classList.toggle('hidden', isCashSaleType());
    input.value = S.doc.due_date;
    input.min = isIsoDate(S.doc.doc_date) ? S.doc.doc_date : ''; // ปฏิทินเริ่มที่วันที่บิล (ตรวจจริงตอนกดตรวจสอบ)
    th.textContent = isIsoDate(S.doc.due_date) ? formatThaiDateShort(S.doc.due_date) : 'เลือกวันที่';
  }

  // ---------- ร้านค้า
  function renderShop() {
    var box = $('shop-box');
    $('btn-copy').disabled = !S.shop;
    if (!S.shop) {
      box.innerHTML = '<button type="button" class="btn block" id="btn-shop">' + iconSvg('search') + '<span>เลือกร้านค้า</span></button>';
      box.querySelector('#btn-shop').addEventListener('click', openShopPicker);
      return;
    }
    var s = S.shop;
    var addr = splitAddress(s.address);
    var detail = CASH
      ? ''
      : '  <div class="small" style="margin-top:4px">สาขา: <b>' + esc(s.branch || '-') + '</b> · เลขผู้เสียภาษี: <b>' + esc(s.tax_id || '-') + '</b></div>' +
        (isValidTaxId(s.tax_id) ? '' : '<div class="alert warn small" style="margin-top:8px">เลขผู้เสียภาษีไม่ครบ 13 หลัก กรุณาตรวจสอบ</div>');
    box.innerHTML =
      '<div class="picked">' +
      '  <div class="row"><div class="grow"><div class="name">' + esc(s.legal_name || s.short_name) + '</div>' +
      '    <div class="small muted">' + esc(s.short_name) + ' · ลำดับ ' + esc(s.shop_id) + '</div></div>' +
      '    <button type="button" class="btn sm" id="btn-shop">เปลี่ยน</button></div>' +
      '  <div class="small" style="margin-top:6px">' + esc(addr[0] || '-') + (addr[1] ? '<br>' + esc(addr[1]) : '') + '</div>' +
      detail +
      '</div>';
    box.querySelector('#btn-shop').addEventListener('click', openShopPicker);
  }

  function openShopPicker() {
    var s = LiffApp.sheet('เลือกร้านค้า',
      '<input type="search" id="shop-q" placeholder="' + (CASH ? 'ค้นหาชื่อร้าน หรือชื่อเต็ม' : 'ค้นหาชื่อย่อ ชื่อเต็ม หรือเลขภาษี') + '" autocomplete="off">' +
      '<ul class="list pick-list" id="shop-list" style="margin-top:8px"></ul>');
    var q = s.el.querySelector('#shop-q');
    var ul = s.el.querySelector('#shop-list');
    function draw() {
      var list = searchShops(S.init.shops, q.value); // เฉพาะร้านที่ active
      ul.innerHTML = list.length ? list.map(function (x) {
        var sub = CASH
          ? '<div class="s">' + esc(x.address || '-') + (x.tel ? ' · ' + esc(x.tel) : '') + '</div>'
          : '<div class="s">สาขา ' + esc(x.branch || '-') + ' · ' + esc(x.tax_id || 'ไม่มีเลขภาษี') + '</div>';
        return '<li role="button" tabindex="0" class="tap" data-id="' + esc(x.shop_id) + '"><div class="t"><div class="n">' + esc(x.short_name) + '</div>' +
          (x.legal_name && x.legal_name !== x.short_name ? '<div class="s">' + esc(x.legal_name) + '</div>' : '') + sub + '</div></li>';
      }).join('') : '<li class="empty">ไม่พบร้านที่ค้นหา</li>';
    }
    q.addEventListener('input', draw);
    ul.addEventListener('click', function (e) {
      var li = e.target.closest('li[data-id]');
      if (!li) return;
      S.shop = S.init.shops.find(function (x) { return String(x.shop_id) === li.dataset.id; });
      var kb = e.detail === 0; // รอบ 20: เลือกด้วยคีย์บอร์ด (Enter) → โฟกัสปุ่ม "เปลี่ยน" ต่อ
      s.close();
      renderShop();
      updateDue();
      if (kb && $('btn-shop')) $('btn-shop').focus();
    });
    draw();
    q.focus();
  }

  // ---------- สินค้า
  function renderLines() {
    var wrap = $('lines');
    var max = cfg().max_items;
    $('line-count').textContent = S.lines.length + '/' + max + ' บรรทัด';
    $('btn-add').disabled = S.lines.length >= max;
    if (!S.lines.length) {
      wrap.innerHTML = '<div class="empty small">ยังไม่มีสินค้า กด "เพิ่มสินค้า"</div>';
      updateTotals();
      return;
    }
    wrap.innerHTML = S.lines.map(function (l, i) {
      return '<div class="line' + (l.is_free ? ' free' : '') + '" data-key="' + l.key + '">' +
        '<div class="head"><div class="t"><div class="n">' + (i + 1) + '. ' + esc(l.name) + '</div>' +
        '<div class="b">' + esc(barcodeText(l.barcode)) + ' · ราคาตั้งต้น ' + money(l.list_price) + '/' + esc(l.unit) + '</div></div>' +
        '<button type="button" class="x" data-act="del" aria-label="ลบบรรทัด">' + iconSvg('x') + '</button></div>' +
        '<div class="grid">' +
        '<div><label>จำนวน (' + esc(l.unit) + ')</label><input type="number" inputmode="decimal" class="num" data-f="qty" min="0" step="any" placeholder="0" value="' + esc(l.qty) + '"></div>' +
        '<div><label>ราคา/หน่วย</label><input type="number" inputmode="decimal" class="num" data-f="price" min="0" step="any" placeholder="0.00" value="' + esc(l.is_free ? '' : l.price) + '"' + (l.is_free ? ' disabled' : '') + '></div>' +
        '<div><label>ส่วนลด (บาท)</label><input type="number" inputmode="decimal" class="num" data-f="discount" min="0" step="any" placeholder="0.00" value="' + esc(l.is_free ? '' : l.discount) + '"' + (l.is_free ? ' disabled' : '') + '></div>' +
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

  /** ช่องในบรรทัดสินค้า (จำนวน ราคา ส่วนลด หมายเหตุ แถม ลบ) — ฟังที่หน้าจอนี้ */
  function listenLines(root) {
    root.addEventListener('input', function (e) {
      var f = e.target.dataset && e.target.dataset.f;
      if (!f || !e.target.closest('.line')) return;
      var l = lineByEl(e.target);
      if (f === 'is_free') return;
      l[f] = e.target.value;
      updateTotals();
    });
    root.addEventListener('change', function (e) {
      if (e.target.dataset && e.target.dataset.f === 'is_free') {
        var l = lineByEl(e.target);
        l.is_free = e.target.checked;
        if (!l.is_free && Number(l.price || 0) === 0) l.price = startPrice(l.list_price);
        renderLines();
      }
    });
    root.addEventListener('click', function (e) {
      var b = e.target.closest('[data-act=del]');
      if (!b) return;
      var l = lineByEl(b);
      S.lines = S.lines.filter(function (x) { return x !== l; });
      renderLines();
    });
  }

  /** รอบ 13: ราคาตั้งต้นจากรายการสินค้า — มากกว่า 0 เติมให้ / 0 หรือไม่มี = ช่องว่าง */
  function startPrice(v) {
    return Number(v) > 0 ? v : '';
  }

  function addLine(p, over) {
    if (S.lines.length >= cfg().max_items) {
      LiffApp.toast('ใส่ได้ไม่เกิน ' + cfg().max_items + ' บรรทัด', true);
      return false;
    }
    S.lines.push(Object.assign({
      key: ++S.lastKey, barcode: p.barcode, name: p.name, unit: p.unit, list_price: p.price,
      qty: '', price: startPrice(p.price), discount: '', is_free: false, note: '' // รอบ 13: ช่องตัวเลขเริ่มว่าง (ไม่ใส่ 0)
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
        return !term || (p.name + ' ' + printedBarcode(p.barcode)).toLowerCase().indexOf(term) >= 0;
      });
      ul.innerHTML = list.length ? list.map(function (p) {
        return '<li role="button" tabindex="0" class="tap" data-bc="' + esc(p.barcode) + '"><div class="t"><div class="n">' + esc(p.name) + '</div>' +
          '<div class="s">' + esc(barcodeText(p.barcode)) + '</div></div><div class="num right"><b>' + money(p.price) + '</b><div class="small muted">/' + esc(p.unit) + '</div></div></li>';
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
        var last = view.querySelector('.line:last-child input[data-f=qty]');
        if (last) { last.focus(); last.select(); }
      }
    });
    draw();
    q.focus();
  }

  // ---------- คัดลอกจากบิลเก่า (ย้ายจาก public/liff/liff.js)
  async function openCopyFromOld() {
    if (!S.shop) return;
    var s = LiffApp.sheet('คัดลอกจากบิลเก่า · ' + S.shop.short_name, '');
    var body = s.el.querySelector('.body');
    if (!AppData.shopComplete(S.shop.shop_id)) LiffApp.loading('กำลังโหลดบิลเก่าของร้านนี้…', body);
    var r = await AppData.loadShopDocs(S.shop.shop_id); // มีในแอปครบแล้ว → ไม่เรียกเซิร์ฟเวอร์
    if (!r.ok) { body.innerHTML = '<div class="alert err">' + LiffApp.errorHtml(r.error) + '</div>'; return; }
    r = { documents: r.documents.slice(0, 20) };
    if (!r.documents.length) { body.innerHTML = '<div class="empty" id="copy-empty">ร้านนี้ยังไม่มีบิลเก่า</div>'; return; }
    body.innerHTML = '<p class="small muted" style="margin-top:0">เลือกบิลที่จะคัดลอกรายการสินค้า</p><ul class="list pick-list" id="copy-list">' +
      r.documents.map(function (d) {
        return '<li role="button" tabindex="0" class="tap" data-no="' + esc(d.doc_no) + '"><div class="t"><div class="n">#' + esc(LiffApp.docNoText(d.doc_no)) + ' · ' + formatThaiDate(d.doc_date) + '</div>' +
          '<div class="s">' + esc(CASH ? LiffApp.MODE_LABEL : d.doc_type) + '</div></div><div class="right"><b class="num">' + money(d.total) + '</b><br>' +
          (d.status === 'cancelled' ? '<span class="badge red">ยกเลิก</span>' : '') + '</div></li>';
      }).join('') + '</ul>';
    body.addEventListener('click', async function (e) {
      var li = e.target.closest('li[data-no]');
      if (!li) return;
      var shown = LiffApp.docNoText(li.dataset.no);
      if (S.lines.length && !confirm('แทนที่รายการสินค้า ' + S.lines.length + ' บรรทัดที่มีอยู่ด้วยรายการจากบิล #' + shown + '?')) return;
      var g = await AppData.docItems(LiffApp.docParam(li.dataset.no)); // จำรายการของใบนี้ไว้ (เอกสารที่ออกแล้วไม่เปลี่ยน)
      if (!g.ok) { LiffApp.toast(g.error, true); return; }
      S.lines = [];
      var skipped = [];
      g.items.forEach(function (it) {
        var p = S.init.products.find(function (x) { return x.barcode === it.barcode; }); // มีเฉพาะสินค้าที่ยังขาย
        if (!p) { skipped.push(it.name); return; }
        addLine(p, { qty: it.qty, price: it.is_free ? startPrice(p.price) : it.price, discount: it.discount, is_free: !!it.is_free, note: it.note || '' });
      });
      s.close();
      renderLines();
      LiffApp.toast('คัดลอก ' + S.lines.length + ' บรรทัดจากบิล #' + shown +
        (skipped.length ? '\nข้าม ' + skipped.length + ' รายการที่เลิกขายแล้ว: ' + skipped.join(', ') : ''), skipped.length > 0);
    });
  }

  // ---------- ยอดรวม
  function totalsOf(lines) {
    return CASH ? cashDocTotals(lines) : calcTotals(lines, cfg().vat_rate);
  }

  function updateTotals() {
    var t = totalsOf(S.lines);
    if (!CASH) {
      $('t-net').textContent = money(t.net_before_vat);
      $('t-vat').textContent = money(t.vat);
    }
    $('t-total').textContent = money(t.total);
    view.querySelectorAll('.line').forEach(function (el) {
      var l = S.lines.find(function (x) { return x.key === Number(el.dataset.key); });
      var c = calcLine(l);
      var txt = l.is_free ? 'แถม · 0.00' : money(c.amount) + (c.discount ? ' − ' + money(c.discount) : '');
      el.querySelector('[data-amt]').textContent = txt;
    });
  }

  function blankNum(v) {
    return v === '' || v === null || v === undefined || String(v).trim() === '';
  }

  function itemsPayload() {
    return S.lines.map(function (l) {
      return { barcode: l.barcode, qty: blankNum(l.qty) ? '' : l.qty, price: l.is_free || blankNum(l.price) ? 0 : l.price, discount: l.is_free || blankNum(l.discount) ? 0 : l.discount, is_free: l.is_free, note: l.note.trim() };
    });
  }

  function buildDocumentPayload() {
    var base = {
      doc_date: S.doc.doc_date,
      ref: S.doc.ref.trim(),
      shop_id: S.shop ? S.shop.shop_id : '',
      date_confirmed: S.dateConfirmed || '', // ติ๊ก "ยืนยันว่าตั้งใจลงวันที่นี้" แล้ว = วันที่นั้น (เซิร์ฟเวอร์ตรวจว่าตรงกับ doc_date)
      items: itemsPayload()
    };
    base.sale_type = S.doc.sale_type;
    base.due_date = isCashSaleType() ? '' : S.doc.due_date;
    if (CASH) return base;
    base.doc_type = S.doc.doc_type;
    return base;
  }

  // ---------- หน้าตรวจสอบ

  /** รอบ 16: บิลทดสอบ 0000 ไม่หักสต็อก */
  function isTestIssue() { return CASH ? !!S.cashTest : S.reviewNo === TEST_DOC_NO; }

  /** รอบ 16: สต็อกไม่พอ (เตือนอย่างเดียว ออกบิลได้ ยอดติดลบได้) — ยอดจากข้อมูลที่โหลดตอนเปิดแอป */
  function stockBox(items) {
    if (isTestIssue()) return '';
    var list = stockShortages(items, AppData.stockMap());
    return list.length ? '<div class="card alert warn" id="review-stock"><b>สต็อกไม่พอ (ออกบิลได้)</b><ul>' +
      list.map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('') + '</ul></div>' : '';
  }

  /**
   * ตรวจบนมือถือทันที (preview.js — invoice.js / cashDoc.js / money.js ชุดเดียวกับเซิร์ฟเวอร์ + ขีดจำกัดจากแท็บตั้งค่า) ไม่รอเซิร์ฟเวอร์
   * ยอดที่แสดงส่งไปเป็น expected ตอนยืนยัน → เซิร์ฟเวอร์คำนวณซ้ำ ถ้าไม่ตรงจะไม่บันทึก
   */
  function showReview() {
    S.dateConfirmed = ''; // ทุกรอบตรวจต้องติ๊กยืนยันวันที่ใหม่
    var payload = buildDocumentPayload();
    var r = CASH ? previewCashLocal(payload, S.init) : previewLocal(payload, S.init);
    payload.items.forEach(function (it, i) {
      if (it.qty !== '') return;
      var p = 'บรรทัดที่ ' + (i + 1) + ': ';
      r.errors = r.errors.map(function (e) { return e === p + 'จำนวนต้องมากกว่า 0' ? p + 'กรุณากรอกจำนวน' : e; });
    });
    if (!CASH) {
      // เลขที่ที่แสดงในหน้านี้คือเลขที่ส่งไป / -1 = ยังไม่ได้ใส่ / 0 = บิลทดสอบ 0000 / 1–9999 = บิลจริง
      S.reviewNo = docNoOf(S.docNoInput);
      if (S.reviewNo < 0) r.errors.unshift(DOC_NO_ERROR);
      else if (S.reviewNo === TEST_DOC_NO && S.init.hasRealDoc) r.errors.unshift('มีบิลจริงแล้ว ใช้เลขที่ 0000 (บิลทดสอบ) ไม่ได้');
      else if (S.reviewNo > 0 && docNoTaken(S.reviewNo)) r.errors.unshift('เลขที่ ' + S.reviewNo + ' มีอยู่แล้วในระบบ กรุณาใช้เลขอื่น');
    }
    S.requestId = LiffApp.uuid(); // รหัสคำขอของรอบยืนยันนี้
    S.expected = r.totals;
    S.screen = 'review';

    totalbar.classList.add('hidden');
    $('title').textContent = 'ตรวจสอบก่อนยืนยัน';
    $('subtitle').textContent = CASH
      ? 'เลขที่บิลใบนี้ #' + (S.cashTest ? CASH_DOC_TEST_NO : (r.nextDocNo || '-'))
      : (S.reviewNo >= 0 ? 'เลขที่บิลใบนี้ #' + LiffApp.docNoText(S.reviewNo) : 'ยังไม่ได้ใส่เลขที่บิลใบนี้');
    var t = r.totals;
    var s = S.shop;
    var sums = CASH
      ? '<div class="sumrow"><span>รวมเงิน</span><span>' + money(t.sum_amount) + '</span></div>' +
        '<div class="sumrow"><span>ส่วนลดร้านค้า</span><span>' + money(t.discount) + '</span></div>' +
        '<div class="sumrow grand"><span>รวมสุทธิ</span><span id="review-total">' + money(t.total) + '</span></div>'
      : '<div class="sumrow"><span>รวมเงิน</span><span>' + money(t.sum_amount) + '</span></div>' +
        '<div class="sumrow"><span>ส่วนลดร้านค้า</span><span>' + money(t.discount) + '</span></div>' +
        '<div class="sumrow"><span>มูลค่าสินค้า (ก่อน VAT)</span><span>' + money(t.net_before_vat) + '</span></div>' +
        '<div class="sumrow"><span>ภาษีมูลค่าเพิ่ม ' + Math.round(cfg().vat_rate * 100) + '%</span><span>' + money(t.vat) + '</span></div>' +
        '<div class="sumrow grand"><span>รวมสุทธิ</span><span id="review-total">' + money(t.total) + '</span></div>';
    var head = CASH
      ? '<section class="card"><h2>' + esc(cfg().doc_title || LiffApp.MODE_LABEL) + '</h2><dl class="kv">' +
        '<dt>วันที่</dt><dd>' + esc(formatThaiDate(payload.doc_date) || '-') + '</dd>' +
        '<dt>อ้างถึง</dt><dd>' + esc(payload.ref || '-') + '</dd>' +
        '<dt>ชนิดการขาย</dt><dd>' + esc(payload.sale_type) + '</dd>' +
        (isCashSaleType() ? '' : '<dt>ครบกำหนดชำระ</dt><dd>' + esc(r.due_date ? formatThaiDate(r.due_date) : '-') + '</dd>') +
        '</dl></section>'
      : '<section class="card"><h2>' + esc(payload.doc_type) + '</h2><dl class="kv">' +
        '<dt>วันที่</dt><dd>' + esc(formatThaiDate(payload.doc_date) || '-') + '</dd>' +
        '<dt>อ้างถึง</dt><dd>' + esc(payload.ref || '-') + '</dd>' +
        '<dt>ชนิดการขาย</dt><dd>' + esc(payload.sale_type) + '</dd>' +
        '<dt>ครบกำหนดชำระ</dt><dd>' + esc(r.due_date ? formatThaiDate(r.due_date) : '-') + '</dd>' +
        '</dl></section>';
    var customer = !s ? '<div class="muted">ยังไม่ได้เลือกร้าน</div>'
      : '<div><b>' + esc(s.legal_name || s.short_name) + '</b></div><div class="small">' + esc(s.address || '-') + '</div>' +
        (CASH ? '' : '<div class="small">สาขา ' + esc(s.branch || '-') + ' · เลขผู้เสียภาษี ' + esc(s.tax_id || '-') + '</div>');
    view.innerHTML =
      (r.errors.length ? '<div class="card alert err" id="review-errors"><b>ต้องแก้ไขก่อนออกบิล</b><ul>' + r.errors.map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('') + '</ul></div>' : '') +
      (!r.errors.length ? noBox(r) : '') +
      (r.dateConfirm && !r.errors.length ? dateConfirmBox(r.dateConfirm) : '') +
      (r.warnings.length ? '<div class="card alert warn" id="review-warnings"><b>โปรดตรวจสอบ</b><ul>' + r.warnings.map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('') + '</ul></div>' : '') +
      stockBox(payload.items) +
      head +
      '<section class="card"><h2>ลูกค้า</h2>' + customer + '</section>' +
      '<section class="card"><h2>สินค้า <span class="count">' + payload.items.length + ' บรรทัด</span></h2><table class="review-items">' +
      S.lines.map(function (l) {
        var c = calcLine(l);
        return '<tr><td>' + esc(l.name) + '<div class="small muted">' + esc(formatQty(c.qty)) + ' ' + esc(l.unit) + ' × ' + money(c.price) +
          (c.discount ? ' ลด ' + money(c.discount) : '') + (l.note.trim() ? ' · ' + esc(l.note.trim()) : '') + '</div></td>' +
          '<td class="r num">' + (c.is_free ? '<span class="badge">แถม</span>' : money(c.amount - c.discount)) + '</td></tr>';
      }).join('') + '</table>' +
      '<div style="margin-top:10px" class="num">' + sums +
      '<div class="small muted right">(' + esc(bahtText(t.total)) + ')</div></div></section>' +
      '<div class="card" style="background:transparent;box-shadow:none;padding:0 0 24px">' +
      '<div id="confirm-msg"></div>' +
      '<div class="row"><button type="button" class="btn grow" id="btn-back">' + iconSvg('back') + '<span>แก้ไข</span></button>' +
      '<button type="button" class="btn primary grow" id="btn-confirm"' + (r.errors.length ? ' disabled' : '') + '>ยืนยันออกบิล</button></div></div>';

    $('btn-back').addEventListener('click', function () { showForm(); scrollTop(); });
    $('btn-confirm').addEventListener('click', confirmCreate);
    // ปุ่มยืนยันกดได้เมื่อไม่มีข้อผิดพลาด และติ๊กยืนยันวันที่แล้ว (เมื่อวันที่ไม่ใช่วันนี้)
    var tick = $('date-confirm');
    var syncConfirm = function () {
      $('btn-confirm').disabled = r.errors.length > 0 || (tick && !tick.checked);
    };
    if (tick) {
      tick.addEventListener('change', function () {
        S.dateConfirmed = tick.checked ? r.dateConfirm.date : '';
        syncConfirm();
      });
    }
    syncConfirm();
    scrollTop();
  }

  /**
   * เลขที่ตัวใหญ่ในหน้าตรวจสอบ
   *   ใบกำกับ: เลขที่พิมพ์ / 0000 = ป้าย "บิลทดสอบ" (ออกซ้ำแทนที่ใบเดิม)
   *   ใบเงินสด: เลขที่โดยประมาณ (ระบบใส่ให้ตอนบันทึก) / บิลทดสอบ 0000
   */
  function noBox(r) {
    var test = CASH ? S.cashTest : S.reviewNo === TEST_DOC_NO;
    var no = CASH ? (S.cashTest ? '0000' : r.nextDocNo) : LiffApp.docNoText(S.reviewNo);
    return '<div class="card first-no-review" id="first-no-box"><div class="muted">เลขที่บิลใบนี้</div>' +
      '<div class="big-no num" id="first-no-big">#' + esc(no) + '</div>' +
      (test
        ? '<div><span class="badge amber test-badge" id="test-badge">บิลทดสอบ</span></div><div class="small muted" id="test-note">ออกซ้ำจะแทนที่ใบเดิม</div>'
        : CASH ? '<div class="small muted" id="no-note">ถ้ามีคนออกใบเงินสดพร้อมกัน เลขที่อาจขยับ</div>' : '') +
      '</div>';
  }

  /** กล่องเตือนสีเหลือง: วันที่เอกสารไม่ใช่วันนี้ (ไม่เกินขีดจำกัด) + ช่องติ๊กยืนยัน */
  function dateConfirmBox(c) {
    return '<div class="card alert warn" id="date-confirm-box"><b>วันที่บิลไม่ใช่วันนี้</b><ul>' +
      c.messages.map(function (m) { return '<li>' + esc(m) + '</li>'; }).join('') + '</ul>' +
      '<label class="chk date-ok"><input type="checkbox" id="date-confirm"> ยืนยันว่าตั้งใจลงวันที่นี้</label></div>';
  }

  /** ความคืบหน้าทีละขั้น: บันทึกเอกสาร → สร้าง PDF → ส่งเข้าแชท (นอกแอป LINE ไม่มีขั้นส่ง) */
  function steps(box) {
    var list = [['save', 'บันทึกบิล…'], ['pdf', 'สร้าง PDF… อาจใช้เวลาสักครู่']];
    if (LiffApp.inClient()) list.push(['send', 'ส่งเข้าแชท…']);
    box.innerHTML = '<ol class="steps" id="steps">' + list.map(function (s) { return '<li data-step="' + s[0] + '">' + s[1] + '</li>'; }).join('') + '</ol>';
    return function (step, state, text) {
      var li = view.querySelector('#steps li[data-step="' + step + '"]');
      if (!li) return;
      li.className = state;
      if (text) li.textContent = text;
    };
  }

  async function confirmCreate() {
    var btn = $('btn-confirm');
    var back = $('btn-back');
    var msg = $('confirm-msg');
    var label = btn.textContent;
    btn.disabled = true;
    back.disabled = true;
    btn.textContent = 'กำลังออกบิล…';
    var mark = steps(msg);
    // ขั้นที่ 1: บันทึก (ออกเลข) แล้วตอบทันที — เซิร์ฟเวอร์ตรวจและคำนวณซ้ำ เทียบยอดกับที่มือถือแสดง (expected)
    mark('save', 'doing');
    var body = { requestId: S.requestId, document: buildDocumentPayload(), expected: S.expected, deferPdf: true };
    if (CASH) { if (S.cashTest) body.test = true; }
    else body.firstDocNo = S.reviewNo; // ชื่อ firstDocNo เดิม (รอบ 7) — รอบ 10 ใช้กับทุกใบ
    var r = await LiffApp.api('createDocument', body);
    if (!r.ok) {
      msg.innerHTML = '';
      if (LiffApp.isDenied(r.code)) return LiffApp.showApiError(r, scr);
      btn.disabled = false;
      back.disabled = false;
      // เน็ตหลุด / มีคนออกบิลพร้อมกัน: กดใหม่ใช้ requestId เดิม ระบบจะไม่ออกเลขซ้ำ
      btn.textContent = LiffApp.isRetryable(r) ? 'ลองอีกครั้ง' : label;
      if (r.code === 'mismatch' || r.code === 'invalid') {
        btn.disabled = true; // ต้องกลับไปแก้/ตรวจใหม่ก่อน
        refreshInBackground(); // ข้อมูลที่จำไว้อาจเก่า → ดึงใหม่ให้รอบตรวจถัดไป
      }
      msg.innerHTML = '<div class="alert err" id="confirm-error" style="margin-bottom:10px">' + LiffApp.errorHtml(r.error || 'ออกบิลไม่สำเร็จ') + '</div>';
      if (r.code === 'token_expired') {
        var re = LiffApp.el('<button type="button" class="btn block" style="margin-bottom:10px">เข้าสู่ระบบใหม่</button>');
        re.addEventListener('click', LiffApp.relogin.run);
        msg.appendChild(re);
      }
      return;
    }
    mark('save', 'done', 'บันทึกบิลแล้ว เลขที่ #' + LiffApp.docNoText(r.docNo));
    rememberIssued(r);
    // ขั้นที่ 2: สร้าง PDF (คำขอที่สอง — ใบเดิมที่มี PDF แล้วได้ลิงก์เดิม / บิลทดสอบ 0000 เขียนทับไฟล์เดิมเสมอ)
    if (!r.pdfUrl) {
      mark('pdf', 'doing');
      var p = await LiffApp.api('regeneratePdf', { docNo: r.docNo });
      if (!p.ok) {
        if (LiffApp.isDenied(p.code)) return LiffApp.showApiError(p, scr);
        mark('pdf', 'fail');
        return showPdfFailed(Object.assign({}, r, { pdfError: 'บันทึกบิล #' + LiffApp.docNoText(r.docNo) + ' แล้ว แต่สร้าง PDF ไม่สำเร็จ กด "ลองอีกครั้ง"' }));
      }
      r = Object.assign({}, r, { pdfUrl: p.pdfUrl });
      AppData.patchDoc(r.docNo, { pdfUrl: p.pdfUrl, hasPdf: true });
    }
    mark('pdf', 'done', 'สร้าง PDF แล้ว');
    // ขั้นที่ 3: ส่งเข้าแชท (finish)
    mark('send', 'doing');
    await finish(r);
  }

  /**
   * หลังออกบิล: เพิ่มใบนี้ในข้อมูลของแอป (ใบล่าสุด, รายการเอกสารของร้าน, เลขที่ที่ใช้แล้ว) ไม่ต้องโหลดใหม่ทั้งหมด
   * เซิร์ฟเวอร์ส่งสรุปเอกสารมา (r.document) / เซิร์ฟเวอร์รุ่นเก่าไม่ส่ง → ประกอบจากฟอร์ม
   */
  function rememberIssued(r) {
    var p = buildDocumentPayload();
    var doc = r.document || {
      doc_no: LiffApp.docParam(r.docNo), shop_id: S.shop ? Number(S.shop.shop_id) : 0, doc_type: p.doc_type || '', doc_date: p.doc_date,
      due_date: p.due_date || '', sale_type: p.sale_type || '', ref: p.ref, shop_short_name: r.shopName || (S.shop && S.shop.short_name) || '',
      shop_legal_name: r.legalName || (S.shop && S.shop.legal_name) || '', total: Number(r.total) || 0, status: 'issued',
      cancelled_reason: '', cancelled_at: '', issued_by: S.init.name || '', cancelled_by: '', pdfUrl: r.pdfUrl || '', hasPdf: !!r.pdfUrl
    };
    AppData.addDoc(doc);
    if (!r.isTest && !r.duplicate) AppData.takeStock(p.items); // รอบ 16
  }

  /** ข้อมูลที่จำไว้อาจเก่า (ยอดไม่ตรง / ข้อมูลไม่ผ่าน / เลขซ้ำ) → ดึงใหม่เบื้องหลัง ให้รอบตรวจถัดไปใช้ข้อมูลใหม่ */
  function refreshInBackground() { AppData.refresh(); }

  // ---------- PDF ล้มเหลว (เอกสารถูกบันทึกแล้ว)
  /** บอกเลขที่ที่บันทึกแล้ว + ปุ่ม "ลองอีกครั้ง" (regeneratePdf) สำเร็จแล้วค่อยส่งเข้าแชท */
  function showPdfFailed(r) {
    S.screen = 'done';
    totalbar.classList.add('hidden');
    $('title').textContent = 'บันทึกบิลแล้ว';
    $('subtitle').textContent = 'เลขที่ #' + LiffApp.docNoText(r.docNo) + ' · ยังไม่มี PDF';
    view.innerHTML =
      '<div class="success"><div class="muted">เลขที่บิล</div><div class="no" id="saved-no">#' + esc(LiffApp.docNoText(r.docNo)) + '</div>' +
      '<div>' + esc(r.legalName || (S.shop && S.shop.legal_name) || '') + '</div><div class="num" style="font-size:20px;font-weight:700;margin-top:4px">' + money(r.total) + ' บาท</div></div>' +
      '<div class="card alert err" id="pdf-error">' + esc(r.pdfError) + '</div>' +
      '<div class="card stack">' +
      '<button type="button" class="btn primary block" id="btn-pdf-retry">ลองอีกครั้ง</button>' +
      '<button type="button" class="btn block" id="btn-pdf-skip">ข้ามไปก่อน</button>' +
      '<div class="small muted">บันทึกบิลแล้ว กดลองอีกครั้งได้ เลขที่ไม่เปลี่ยน</div>' +
      '</div>';
    $('btn-pdf-retry').addEventListener('click', function () { retryPdf(r); });
    $('btn-pdf-skip').addEventListener('click', function () { finish(Object.assign({}, r, { pdfUrl: '' })); });
    scrollTop();
  }

  async function retryPdf(r) {
    var btn = $('btn-pdf-retry');
    var skip = $('btn-pdf-skip');
    var box = $('pdf-error');
    btn.disabled = true;
    skip.disabled = true;
    btn.textContent = 'กำลังสร้าง PDF…';
    var res = await LiffApp.api('regeneratePdf', { docNo: r.docNo });
    if (res.ok) {
      AppData.patchDoc(r.docNo, { pdfUrl: res.pdfUrl, hasPdf: true });
      await finish(Object.assign({}, r, { pdfUrl: res.pdfUrl, pdfError: '' }));
      return;
    }
    if (LiffApp.isDenied(res.code) || res.code === 'token_expired') return LiffApp.showApiError(res, scr);
    btn.disabled = false;
    skip.disabled = false;
    btn.textContent = 'ลองอีกครั้ง';
    box.textContent = 'บันทึกบิล #' + LiffApp.docNoText(r.docNo) + ' แล้ว แต่สร้าง PDF ไม่สำเร็จ กด "ลองอีกครั้ง"';
  }

  // ---------- สำเร็จ
  /** ในแอป LINE: ส่ง "บิล <เลขที่>" / "เงินสด <เลขที่>" เข้าแชทแล้วปิดหน้า / นอกแอป LINE หรือส่งไม่ได้: แสดงหน้าสำเร็จ */
  async function finish(r) {
    var cmd = CHAT_CMD + LiffApp.docNoText(r.docNo);
    if (LiffApp.inClient()) {
      try {
        await liff.sendMessages([{ type: 'text', text: cmd }]);
      } catch (e) {
        showSuccess(r, 'ส่งเข้าแชทไม่สำเร็จ พิมพ์ "' + cmd + '" ในแชทเพื่อดูบิล');
        return;
      }
      showSuccess(r, 'ส่ง "' + cmd + '" เข้าแชทแล้ว กำลังปิดหน้า…');
      liff.closeWindow();
      return;
    }
    showSuccess(r, 'พิมพ์ "' + cmd + '" ในแชท LINE เพื่อดูบิล');
  }

  function showSuccess(r, note) {
    S.screen = 'done';
    totalbar.classList.add('hidden');
    $('title').textContent = 'ออกบิลสำเร็จ';
    $('subtitle').textContent = '';
    view.innerHTML =
      '<div class="success" id="success"><div class="check">' + iconSvg('check') + '</div><div class="muted">เลขที่บิล</div><div class="no" id="success-no">#' + esc(LiffApp.docNoText(r.docNo)) + '</div>' +
      '<div>' + esc(r.legalName || (S.shop && (S.shop.legal_name || S.shop.short_name)) || '') + '</div><div class="num" style="font-size:20px;font-weight:700;margin-top:4px">' + money(r.total) + ' บาท</div></div>' +
      (r.duplicate ? '<div class="card alert warn">บิลนี้ออกไปแล้ว แสดงเลขที่เดิม</div>' : '') +
      (r.warnings && r.warnings.length ? '<div class="card alert warn"><ul style="margin:0">' + r.warnings.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul></div>' : '') +
      (r.stockMessage ? '<div class="card alert warn" id="stock-pending">' + esc(r.stockMessage) + '</div>' : '') + // รอบ 16: ตัดสต็อกไม่สำเร็จ (บิลบันทึกแล้ว)
      '<div class="card alert ok" id="success-note">' + esc(note) + '</div>' +
      '<div class="card stack">' +
      (r.pdfUrl
        ? '<a class="btn block" id="btn-pdf" href="' + esc(r.pdfUrl) + '" target="_blank" rel="noopener">' + iconSvg('file') + '<span>เปิด PDF</span></a>'
        : '<div class="small muted" id="no-pdf">ยังไม่มี PDF สร้างได้ที่เมนู "ประวัติเอกสาร"</div>') +
      '<button type="button" class="btn primary block" id="btn-new">ออกบิลใหม่</button>' +
      '</div>';
    $('btn-new').addEventListener('click', load);
    scrollTop();
  }

  // ---------- หน้าจอของแอป
  Shell.define('issue', {
    title: TITLE,
    build: function (s) {
      scr = s;
      s.root.innerHTML =
        '<div class="topbar"><h1 id="title">' + TITLE + '</h1><div class="sub" id="subtitle">กำลังโหลด…</div></div>' +
        '<div id="view" aria-live="polite"><div class="loading" role="status"><span class="spinner" aria-hidden="true"></span><div class="msg">กำลังเปิดหน้า…</div></div></div>';
      s.dock.innerHTML =
        '<div class="totalbar hidden" id="totalbar"><div class="inner"><div class="sums num">' +
        (CASH
          ? '<div>รวมสุทธิ <b id="t-total">0.00</b></div>' // รอบ 13: แบบเดียวกับใบกำกับ (ไม่มีบรรทัด VAT)
          : '<div>ก่อน VAT <span id="t-net">0.00</span> · VAT <span id="t-vat">0.00</span></div><div>รวมสุทธิ <b id="t-total">0.00</b></div>') +
        '</div><button type="button" class="btn primary" id="btn-review"><span>ตรวจสอบ</span>' + iconSvg('next') + '</button></div></div>';
      view = $('view');
      totalbar = $('totalbar');
      $('btn-review').addEventListener('click', showReview);
      listenLines(s.root);
    },
    /** เข้าหน้าจอ: ครั้งแรก (หรือโหลดไม่สำเร็จ) → โหลด / ข้อมูลเปลี่ยนระหว่างไปหน้าอื่น → ใช้ข้อมูลใหม่ (ฟอร์มที่กรอกไว้ไม่หาย) */
    show: function () {
      if (!S.screen || S.screen === 'error') return load();
      if (scr.seen !== AppData.version()) update();
    },
    update: update
  });
})();
