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
 * @param {object} input เอกสารจากฟอร์ม (รูปแบบเดียวกับที่ส่งให้ createDocument)
 * @param {object} init ผลของ action init (ร้าน/สินค้าที่ใช้งานอยู่, config, today, nextDocNo, lastDoc)
 * @returns {{ok:true, errors:string[], warnings:string[], totals:object, amount_text:string, due_date:string, nextDocNo:number}}
 */
function previewLocal(input, init) {
  var config = init.config;
  // init ส่งเฉพาะร้าน/สินค้าที่ใช้งานอยู่ → ทุกตัวในรายการ active
  var products = (init.products || []).map(function (p) {
    return { barcode: p.barcode, name: p.name, unit: p.unit, price: p.price, active: true };
  });
  var ctx = {
    shops: init.shops || [],
    products: products,
    documents: init.lastDoc ? [init.lastDoc] : [], // คำเตือนวันที่ดูแค่ใบล่าสุดที่ไม่ยกเลิก
    config: config,
    today: init.today,
    checkTextLimits: true
  };
  var v = validateDocumentInput(input, ctx);
  var errors = v.errors.slice();
  if (String(input.ref || '').length > PREVIEW_REF_MAX) errors.push('ช่อง "อ้างถึง" ยาวเกิน ' + PREVIEW_REF_MAX + ' ตัวอักษร');
  (input.items || []).forEach(function (it, i) {
    if (String((it && it.note) || '').length > PREVIEW_NOTE_MAX) errors.push('บรรทัดที่ ' + (i + 1) + ': หมายเหตุยาวเกิน ' + PREVIEW_NOTE_MAX + ' ตัวอักษร');
  });
  var shop = findBy(ctx.shops, 'shop_id', input.shop_id);
  var totals = calcTotals(input.items || [], config.vat_rate);
  return {
    ok: true,
    errors: errors,
    warnings: v.warnings,
    totals: totals,
    amount_text: bahtText(totals.total),
    due_date: isCashSale(input.sale_type, config) ? '' : (input.due_date || computeDueDate(input.doc_date, shop, config, input.sale_type)),
    nextDocNo: init.nextDocNo
  };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { previewLocal: previewLocal };
