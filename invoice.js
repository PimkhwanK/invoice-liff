/**
 * invoice.js — กฎทางธุรกิจของเอกสาร: validate, ออกเลข, วันครบกำหนด, snapshot, สร้างแถวข้อมูล
 *
 * ไม่มีการอ่าน/เขียนข้อมูลในไฟล์นี้ ผู้เรียก (api.js / Apps Script) เป็นคนส่งข้อมูลตารางเข้ามา
 */

// ใน Node ดึงฟังก์ชันจากไฟล์อื่น ส่วนในเบราว์เซอร์/Apps Script ฟังก์ชันเหล่านี้เป็น global อยู่แล้ว
// (var ที่ไม่ได้กำหนดค่าจะไม่ทับ global เดิม)
if (typeof require === 'function' && typeof module !== 'undefined') {
  var _money = require('./money');
  var calcLine = _money.calcLine, calcTotals = _money.calcTotals, round2 = _money.round2, formatMoney = _money.formatMoney;
  var _date = require('./thaiDate');
  var isIsoDate = _date.isIsoDate, addDaysIso = _date.addDaysIso, formatThaiDate = _date.formatThaiDate;
  var splitAddress = require('./address').splitAddress;
}

var DEFAULT_DOC_TYPES = ['ใบกำกับภาษี/ใบส่งสินค้า', 'ใบเสร็จรับเงิน'];

/** ค่าที่แปลงเป็น boolean ได้ทั้งจาก JSON และจาก Sheets */
function isTrue(v) {
  return v === true || v === 'TRUE' || v === 'true' || v === 1;
}

var DEFAULT_SALE_TYPES = ['เครดิต', 'สินเชื่อ', 'เงินสด'];

/** ชนิดการขายที่เลือกได้ — แก้ได้ใน config.sale_type_labels */
function saleTypeLabels(config) {
  var l = config && config.sale_type_labels;
  return Array.isArray(l) && l.length ? l : DEFAULT_SALE_TYPES;
}

/** ป้ายของ "ขายเงินสด" (ไม่มีวันครบกำหนด) ชนิดอื่นทั้งหมดถือเป็นขายเชื่อ */
function cashSaleLabel(config) {
  return (config && config.cash_sale_label) || 'เงินสด';
}

function docTypes(config) {
  var l = config && config.doc_types;
  return Array.isArray(l) && l.length ? l : DEFAULT_DOC_TYPES;
}

function isCashSale(saleType, config) {
  return saleType === cashSaleLabel(config);
}

/** เลขผู้เสียภาษี: ว่างได้ ถ้ามีค่าต้องเป็นตัวเลข 13 หลัก */
function isValidTaxId(taxId) {
  var s = String(taxId == null ? '' : taxId).trim();
  return s === '' || /^\d{13}$/.test(s);
}

function taxIdWarning(shop) {
  if (!shop || isValidTaxId(shop.tax_id)) return null;
  return 'เลขประจำตัวผู้เสียภาษีของร้าน "' + shop.short_name + '" (' + shop.tax_id + ') ไม่ใช่ตัวเลข 13 หลัก กรุณาตรวจสอบ';
}

/** เลขที่เอกสารถัดไป = สูงสุด + 1 (นับรวมใบที่ยกเลิก) ถ้ายังไม่มีเอกสารใช้ start_doc_no */
function nextDocNo(documents, config) {
  var start = Number(config && config.start_doc_no) || 1;
  var max = 0;
  for (var i = 0; i < documents.length; i++) {
    var n = Number(documents[i].doc_no);
    if (n > max) max = n;
  }
  return max > 0 ? max + 1 : start;
}

/** ลำดับร้านถัดไป = สูงสุด + 1 (ไม่นำเลขกลับมาใช้ใหม่) */
function nextShopId(shops) {
  var max = 0;
  for (var i = 0; i < shops.length; i++) {
    var n = Number(shops[i].shop_id);
    if (n > max) max = n;
  }
  return max + 1;
}

/** จำนวนวันเครดิตของร้าน (ว่าง → default) */
function creditDaysOf(shop, config) {
  var v = shop ? shop.credit_days : '';
  if (v === '' || v === null || v === undefined || isNaN(Number(v))) return Number(config.default_credit_days) || 0;
  return Number(v);
}

/** วันครบกำหนด = วันที่เอกสาร + เครดิตของร้าน; ขายเงินสด → '' */
function computeDueDate(docDate, shop, config, saleType) {
  if (isCashSale(saleType, config)) return '';
  if (!isIsoDate(docDate)) return '';
  return addDaysIso(docDate, creditDaysOf(shop, config));
}

/**
 * คำเตือนเรื่องวันที่ (ไม่ block การออกเอกสาร)
 *  (ก) ก่อนวันที่ของเอกสารเลขล่าสุดที่ยังไม่ถูกยกเลิก
 *  (ข) เป็นวันในอนาคต
 */
function dateWarnings(docDate, documents, today) {
  var out = [];
  if (!isIsoDate(docDate)) return out;
  var latest = null;
  for (var i = 0; i < documents.length; i++) {
    var d = documents[i];
    if (d.status === 'cancelled') continue;
    if (!latest || Number(d.doc_no) > Number(latest.doc_no)) latest = d;
  }
  if (latest && docDate < latest.doc_date) {
    out.push('วันที่เอกสาร (' + formatThaiDate(docDate) + ') อยู่ก่อนวันที่ของเอกสารเลขล่าสุด #' +
      latest.doc_no + ' (' + formatThaiDate(latest.doc_date) + ')');
  }
  if (today && docDate > today) {
    out.push('วันที่เอกสาร (' + formatThaiDate(docDate) + ') เป็นวันในอนาคต (วันนี้ ' + formatThaiDate(today) + ')');
  }
  return out;
}

function findBy(list, key, value) {
  for (var i = 0; i < list.length; i++) {
    if (String(list[i][key]) === String(value)) return list[i];
  }
  return null;
}

function isNumberLike(v) {
  return v !== '' && v !== null && v !== undefined && !isNaN(Number(v)) && isFinite(Number(v));
}

/**
 * ตรวจข้อมูลก่อนออกเอกสาร
 * @param {object} input { doc_type, doc_date, ref, sale_type, due_date, shop_id, items:[{barcode, qty, price, discount, is_free, note}] }
 * @param {object} ctx { shops, products, documents, config, today }
 * @returns {{errors:string[], warnings:string[]}}
 */
function validateDocumentInput(input, ctx) {
  var errors = [];
  var warnings = [];
  var config = ctx.config;
  input = input || {};

  if (docTypes(config).indexOf(input.doc_type) < 0) {
    errors.push('กรุณาเลือกประเภทเอกสาร');
  }
  if (!isIsoDate(input.doc_date)) {
    errors.push('วันที่เอกสารไม่ถูกต้อง');
  }
  if (saleTypeLabels(config).indexOf(input.sale_type) < 0) {
    errors.push('กรุณาเลือกชนิดการขาย (' + saleTypeLabels(config).join('/') + ')');
  } else if (!isCashSale(input.sale_type, config) && input.due_date) {
    if (!isIsoDate(input.due_date)) errors.push('วันครบกำหนดชำระไม่ถูกต้อง');
    else if (isIsoDate(input.doc_date) && input.due_date < input.doc_date) {
      errors.push('วันครบกำหนดชำระต้องไม่อยู่ก่อนวันที่เอกสาร');
    }
  }

  // ร้านค้า
  var shop = null;
  if (input.shop_id === undefined || input.shop_id === null || input.shop_id === '') {
    errors.push('กรุณาเลือกร้านค้า');
  } else {
    shop = findBy(ctx.shops, 'shop_id', input.shop_id);
    if (!shop) errors.push('ไม่พบร้านค้าลำดับ ' + input.shop_id);
    else if (!isTrue(shop.active)) errors.push('ร้าน "' + shop.short_name + '" ถูกปิดการใช้งานแล้ว');
    else {
      var tw = taxIdWarning(shop);
      if (tw) warnings.push(tw);
    }
  }

  // รายการสินค้า
  var items = Array.isArray(input.items) ? input.items : [];
  var maxItems = Number(config.max_items) || 16;
  if (items.length === 0) errors.push('ต้องมีสินค้าอย่างน้อย 1 รายการ');
  if (items.length > maxItems) errors.push('รายการสินค้าเกิน ' + maxItems + ' บรรทัด (มี ' + items.length + ' บรรทัด)');

  for (var i = 0; i < items.length; i++) {
    var it = items[i] || {};
    var p = 'บรรทัดที่ ' + (i + 1) + ': ';
    var product = it.barcode ? findBy(ctx.products, 'barcode', it.barcode) : null;
    if (!it.barcode) errors.push(p + 'ไม่ได้ระบุสินค้า');
    else if (!product) errors.push(p + 'ไม่พบสินค้าบาร์โค้ด ' + it.barcode);
    else if (!isTrue(product.active)) errors.push(p + 'สินค้า "' + product.name + '" เลิกขายแล้ว');

    if (!isNumberLike(it.qty) || Number(it.qty) <= 0) errors.push(p + 'จำนวนต้องมากกว่า 0');

    var free = isTrue(it.is_free);
    if (!free) {
      if (!isNumberLike(it.price)) errors.push(p + 'กรุณาระบุราคา');
      else if (Number(it.price) < 0) errors.push(p + 'ราคาติดลบไม่ได้');
      var disc = it.discount === '' || it.discount === undefined || it.discount === null ? 0 : it.discount;
      if (!isNumberLike(disc)) errors.push(p + 'ส่วนลดไม่ถูกต้อง');
      else if (Number(disc) < 0) errors.push(p + 'ส่วนลดติดลบไม่ได้');
      else if (isNumberLike(it.qty) && isNumberLike(it.price) && Number(it.price) >= 0) {
        var line = calcLine(it);
        if (line.discount > line.amount) errors.push(p + 'ส่วนลด (' + formatMoney(line.discount) + ') มากกว่ายอดของบรรทัด (' + formatMoney(line.amount) + ')');
      }
    }
  }

  if (errors.length === 0) {
    var totals = calcTotals(items, config.vat_rate);
    if (totals.total < 0) errors.push('ยอดรวมทั้งสิ้นติดลบไม่ได้');
  }

  if (isIsoDate(input.doc_date)) {
    warnings = warnings.concat(dateWarnings(input.doc_date, ctx.documents || [], ctx.today));
  }

  return { errors: errors, warnings: warnings };
}

/** สำเนาข้อมูลร้าน ณ วันออกเอกสาร */
function shopSnapshot(shop) {
  var lines = splitAddress(shop.address);
  return {
    shop_short_name: shop.short_name || '',
    shop_legal_name: shop.legal_name || shop.short_name || '',
    shop_address1: lines[0],
    shop_address2: lines[1],
    shop_tel: shop.tel || '',
    shop_fax: shop.fax || '',
    shop_branch: shop.branch || '',
    shop_tax_id: String(shop.tax_id == null ? '' : shop.tax_id)
  };
}

/**
 * สร้างแถว documents + doc_items (เรียกหลัง validate ผ่านแล้ว)
 * @param {object} input ข้อมูลจากฟอร์ม
 * @param {object} ctx { shops, products, config }
 * @param {object} meta { docNo, createdAt, requestId, issuedBy } issuedBy = ชื่อผู้ใช้ ณ ตอนออก (snapshot)
 */
function buildDocument(input, ctx, meta) {
  var config = ctx.config;
  var shop = findBy(ctx.shops, 'shop_id', input.shop_id);
  var cash = isCashSale(input.sale_type, config);
  var dueDate = cash ? '' : (input.due_date || computeDueDate(input.doc_date, shop, config, input.sale_type));

  var items = input.items.map(function (it, i) {
    var product = findBy(ctx.products, 'barcode', it.barcode) || {};
    var line = calcLine(it);
    return {
      doc_no: meta.docNo,
      line_no: i + 1,
      barcode: String(it.barcode),
      name: product.name || it.name || '',
      unit: product.unit || it.unit || '',
      qty: line.qty,
      price: line.price,
      discount: line.discount,
      is_free: line.is_free,
      note: it.note ? String(it.note) : '',
      amount: line.amount
    };
  });

  var totals = calcTotals(items, config.vat_rate);
  var snap = shopSnapshot(shop);

  var document = {
    doc_no: meta.docNo,
    shop_id: Number(shop.shop_id),
    doc_type: input.doc_type,
    doc_date: input.doc_date,
    sale_type: input.sale_type,
    due_date: dueDate,
    ref: input.ref ? String(input.ref) : ''
  };
  for (var k in snap) document[k] = snap[k];
  document.sum_amount = totals.sum_amount;
  document.discount = totals.discount;
  document.net_before_vat = totals.net_before_vat;
  document.vat = totals.vat;
  document.total = totals.total;
  document.pdf_path = '';
  document.status = 'issued';
  document.cancelled_reason = '';
  document.cancelled_at = '';
  document.request_id = meta.requestId || '';
  document.created_at = meta.createdAt || '';
  document.issued_by = meta.issuedBy || '';
  document.cancelled_by = '';

  return { document: document, items: items };
}

/** ตรวจการยกเลิกเอกสาร */
function validateCancel(doc, reason) {
  if (!doc) return 'ไม่พบเอกสาร';
  if (doc.status === 'cancelled') return 'เอกสารเลขที่ ' + doc.doc_no + ' ถูกยกเลิกไปแล้ว';
  if (!reason || !String(reason).trim()) return 'กรุณาระบุเหตุผลที่ยกเลิก';
  return null;
}

/** ตรวจข้อมูลร้านก่อนบันทึก */
function validateShopInput(shop) {
  var errors = [];
  var warnings = [];
  if (!shop.short_name || !String(shop.short_name).trim()) errors.push('กรุณาระบุชื่อร้านค้า (ชื่อย่อ)');
  if (!shop.legal_name || !String(shop.legal_name).trim()) errors.push('กรุณาระบุชื่อเต็มตามใบกำกับ');
  var br = String(shop.branch == null ? '' : shop.branch).trim();
  if (br && br !== 'สำนักงานใหญ่' && !/^\d{5}$/.test(br)) errors.push('สาขาต้องเป็น "สำนักงานใหญ่" หรือเลข 5 หลัก เช่น 00001');
  var cd = shop.credit_days;
  if (cd !== '' && cd !== null && cd !== undefined && (!/^\d+$/.test(String(cd)))) errors.push('เครดิต (วัน) ต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป หรือเว้นว่าง');
  if (!isValidTaxId(shop.tax_id)) warnings.push('เลขประจำตัวผู้เสียภาษีไม่ใช่ตัวเลข 13 หลัก (บันทึกได้ แต่กรุณาตรวจสอบ)');
  return { errors: errors, warnings: warnings };
}

/** ตรวจข้อมูลสินค้าก่อนบันทึก */
function validateProductInput(product) {
  var errors = [];
  if (!product.barcode || !String(product.barcode).trim()) errors.push('กรุณาระบุบาร์โค้ดลัง');
  if (!product.name || !String(product.name).trim()) errors.push('กรุณาระบุชื่อสินค้า');
  if (!product.unit || !String(product.unit).trim()) errors.push('กรุณาระบุหน่วย');
  if (!isNumberLike(product.price)) errors.push('กรุณาระบุราคาเป็นตัวเลข');
  else if (Number(product.price) < 0) errors.push('ราคาติดลบไม่ได้');
  return { errors: errors, warnings: [] };
}

/** ชื่อไฟล์ PDF: INV-{doc_no}_{short_name}.pdf (ตัดอักขระที่ใช้ในชื่อไฟล์ไม่ได้) */
function pdfFileName(doc) {
  var name = String(doc.shop_short_name || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').replace(/\s+/g, '_').trim();
  return 'INV-' + doc.doc_no + (name ? '_' + name : '') + '.pdf';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    DEFAULT_DOC_TYPES: DEFAULT_DOC_TYPES,
    isTrue: isTrue,
    saleTypeLabels: saleTypeLabels,
    cashSaleLabel: cashSaleLabel,
    docTypes: docTypes,
    isCashSale: isCashSale,
    isValidTaxId: isValidTaxId,
    taxIdWarning: taxIdWarning,
    nextDocNo: nextDocNo,
    nextShopId: nextShopId,
    creditDaysOf: creditDaysOf,
    computeDueDate: computeDueDate,
    dateWarnings: dateWarnings,
    validateDocumentInput: validateDocumentInput,
    shopSnapshot: shopSnapshot,
    buildDocument: buildDocument,
    validateCancel: validateCancel,
    validateShopInput: validateShopInput,
    validateProductInput: validateProductInput,
    pdfFileName: pdfFileName,
    findBy: findBy
  };
}
