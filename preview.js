/*
 * preview.js — ตรวจเอกสารบนมือถือตอนกด "ตรวจสอบ" (รอบ 5A-2) ไม่ต้องรอเซิร์ฟเวอร์
 *   ผลเหมือน action previewDocument ของ Apps Script (Api.gs) เพราะใช้ invoice.js / money.js / bahtText.js ชุดเดียวกัน
 *   (สำเนาตรงตัวของ src/core) + ขีดจำกัดความยาวข้อความ (text_max_*) และ max_items จากแท็บตั้งค่า
 *   ใช้แสดงผลเท่านั้น: createDocument คำนวณและตรวจซ้ำที่เซิร์ฟเวอร์เสมอ ยอดไม่ตรงกับที่ส่งไป (expected) = ไม่บันทึก
 * ต้องโหลดหลัง money.js, bahtText.js, thaiDate.js, address.js, invoice.js
 */

var PREVIEW_REF_MAX = 100;  // ตรงกับ API_REF_MAX ใน Api.gs
var PREVIEW_NOTE_MAX = 200; // ตรงกับ API_NOTE_MAX ใน Api.gs

/**
 * สินค้าสำหรับตรวจ: allProducts = ทั้งหมดพร้อมสถานะ (AppData รอบ 10 — สินค้าที่เพิ่งเลิกขายได้ข้อความเดียวกับเซิร์ฟเวอร์)
 * ไม่มี → products ของ init (เฉพาะที่ขายอยู่)
 */
function previewProducts(init) {
  if (Array.isArray(init.allProducts)) return init.allProducts;
  return (init.products || []).map(function (p) {
    return { barcode: p.barcode, name: p.name, unit: p.unit, price: p.price, active: true };
  });
}

/**
 * @param {object} input เอกสารจากฟอร์ม (รูปแบบเดียวกับที่ส่งให้ createDocument)
 * @param {object} init ผลของ action init (ร้าน/สินค้าที่ใช้งานอยู่, config, today, nextDocNo, lastDoc)
 * @returns {{ok:true, errors:string[], warnings:string[], dateConfirm:object|null, totals:object, amount_text:string, due_date:string, nextDocNo:number}}
 */
function previewLocal(input, init) {
  var config = init.config;
  // init ส่งเฉพาะร้าน/สินค้าที่ใช้งานอยู่ → ทุกตัวในรายการ active
  var products = previewProducts(init);
  var ctx = {
    shops: init.allShops || init.shops || [], // รอบ 10: ร้านทั้งหมดพร้อมสถานะ (ร้านที่เพิ่งถูกปิด → ข้อความเดียวกับเซิร์ฟเวอร์)
    products: products,
    documents: init.lastDoc ? [init.lastDoc] : [], // คำเตือนวันที่ดูแค่ใบล่าสุดที่ไม่ยกเลิก
    config: config,
    today: init.today,
    checkTextLimits: true,
    liveChecks: true // รอบ 5B: กฎวันที่ / ราคา 0 / ยอดเกินช่อง — ตรงกับ apiInvoiceContext ใน Api.gs
  };
  var v = validateDocumentInput(input, ctx);
  var errors = v.errors.slice();
  if (String(input.ref || '').length > PREVIEW_REF_MAX) errors.push('ช่อง "อ้างถึง" ยาวเกิน ' + PREVIEW_REF_MAX + ' ตัวอักษร');
  (input.items || []).forEach(function (it, i) {
    if (String((it && it.note) || '').length > PREVIEW_NOTE_MAX) errors.push('บรรทัดที่ ' + (i + 1) + ': หมายเหตุยาวเกิน ' + PREVIEW_NOTE_MAX + ' ตัวอักษร');
  });
  var totals = calcTotals(input.items || [], config.vat_rate);
  return {
    ok: true,
    errors: errors,
    warnings: v.warnings,
    dateConfirm: v.dateConfirm || null, // วันที่ไม่ใช่วันนี้ → กล่องเตือน + ต้องติ๊กยืนยัน
    totals: totals,
    amount_text: bahtText(totals.total),
    due_date: isCashSale(input.sale_type, config) ? '' : (input.due_date || ''), // รอบ 19: ไม่คำนวณให้ (ตรงกับ previewDocument)
    nextDocNo: init.nextDocNo,
    needFirstDocNo: !!init.needFirstDocNo, // ฟอร์มถามเลขที่ (รอบ 10: ทุกใบ) — ตรงกับ previewDocument
    hasRealDoc: !!init.hasRealDoc          // รอบ 10: มีบิลจริงแล้ว (ออกบิลทดสอบ 0000 ไม่ได้)
  };
}

/**
 * รอบ 10: ตรวจใบเงินสดบนมือถือ — ผลเหมือน previewDocument ของ Cash.gs (cashDoc.js ชุดเดียวกับเซิร์ฟเวอร์)
 * @param {object} input { doc_date, ref, sale_type, due_date (รอบ 19), shop_id, date_confirmed, items }
 * @param {object} init ข้อมูลตั้งต้นของฟอร์มใบเงินสด (AppData.issueInit: shops, products, config, today, monthMax, hasRealDoc)
 */
function previewCashLocal(input, init) {
  var products = previewProducts(init);
  // allShops = ร้านทั้งหมดพร้อมสถานะ (AppData) → ร้านที่เพิ่งถูกปิดได้ข้อความ "ถูกปิดการใช้งานแล้ว" เหมือนเซิร์ฟเวอร์ (ไม่ใช่ "ไม่พบร้าน")
  var ctx = { shops: init.allShops || init.shops || [], products: products, config: init.config, today: init.today, checkTextLimits: true, liveChecks: true };
  var v = cashDocValidate(input, ctx);
  var errors = v.errors.slice();
  if (String(input.ref || '').length > PREVIEW_REF_MAX) errors.push('ช่อง "อ้างถึง" ยาวเกิน ' + PREVIEW_REF_MAX + ' ตัวอักษร');
  (input.items || []).forEach(function (it, i) {
    if (String((it && it.note) || '').length > PREVIEW_NOTE_MAX) errors.push('บรรทัดที่ ' + (i + 1) + ': หมายเหตุยาวเกิน ' + PREVIEW_NOTE_MAX + ' ตัวอักษร');
  });
  var totals = cashDocTotals(input.items || []);
  return {
    ok: true,
    errors: errors,
    warnings: v.warnings,
    dateConfirm: v.dateConfirm || null,
    totals: totals,
    amount_text: bahtText(totals.total),
    due_date: isCashSale(cashDocInput(input, init.config).sale_type, cashDocConfig(init.config)) ? '' : (input.due_date || ''), // รอบ 19
    nextDocNo: cashDocNextFromMax(init.monthMax || {}, input.doc_date), // เลขที่โดยประมาณ (เซิร์ฟเวอร์ออกจริงใน lock)
    hasRealDoc: !!init.hasRealDoc
  };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { previewLocal: previewLocal, previewCashLocal: previewCashLocal };
