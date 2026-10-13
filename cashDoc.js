/**
 * cashDoc.js — กฎของ "ใบเงินสด" (ใบส่งสินค้าชั่วคราว/ใบเสร็จรับเงิน) รอบ 10
 *
 *   เลขที่ = MMYY-ลำดับ เช่น 1069-15 (เดือน 2 หลัก + ปี พ.ศ. 2 หลัก + ลำดับในเดือน ไม่เติม 0)
 *     ระบบรันเอง ตามเดือนของ "วันที่บิล" เริ่ม 1 ใหม่ทุกเดือน (ลำดับ = สูงสุดของเดือนนั้น + 1 นับรวมใบที่ยกเลิก)
 *     บิลทดสอบ = "0000" (ใบเดียว ออกซ้ำเขียนทับ / ออกใบเงินสดจริงใบแรกแล้วถูกลบ — เหมือนบิลทดสอบของใบกำกับ)
 *   ไม่มีภาษีเลย: ยอด = รวมสุทธิ (รวมเงิน − ส่วนลด) ไม่มี VAT / เลขผู้เสียภาษี / สาขา / วันครบกำหนด / ชนิดการขายให้เลือก (เงินสดเสมอ)
 *   ตรวจข้อมูลและสร้างแถวด้วย validateDocumentInput / buildDocument ของ invoice.js (กฎชุดเดียวกับใบกำกับ) ผ่านตั้งค่าแบบใบเงินสด
 *
 * ใช้ได้ทั้ง Node (test), เบราว์เซอร์ (liff-site/cashDoc.js) และ Apps Script (gas/cashDoc.gs) — สำเนาตรงตัวทุกไฟล์
 * ทุกชื่อระดับบนสุดขึ้นต้นด้วย cashDoc / CASH_DOC (Apps Script ใช้ global scope ร่วมกันทุกไฟล์) / ระบบจำลองไม่ใช้ไฟล์นี้
 */

if (typeof require === 'function' && typeof module !== 'undefined') {
  var calcTotals = require('./money').calcTotals;
  var _cashInv = require('./invoice');
  var validateDocumentInput = _cashInv.validateDocumentInput, buildDocument = _cashInv.buildDocument;
}

var CASH_DOC_TEST_NO = '0000';
var CASH_DOC_TITLE = 'ใบส่งสินค้าชั่วคราว/ใบเสร็จรับเงิน';
var CASH_DOC_SALE_TYPE = 'เงินสด';

/** เลขที่เป็นบิลทดสอบ "0000" ไหม (เลข 0 ที่ชีตแปลงเป็นตัวเลขก็นับ) */
function cashDocIsTest(v) {
  var s = String(v == null ? '' : v).trim();
  return s !== '' && /^0+$/.test(s);
}

/**
 * อ่านเลขที่ใบเงินสด
 * @returns {null | {test:true, text:'0000'} | {test:false, text:string, prefix:string, mm:number, yy:number, seq:number}}
 *   text = รูปแบบมาตรฐาน (ลำดับไม่มี 0 นำหน้า) ใช้เทียบ/แสดง
 */
function cashDocParse(v) {
  var s = String(v == null ? '' : v).trim();
  if (cashDocIsTest(s)) return { test: true, text: CASH_DOC_TEST_NO };
  var m = s.match(/^([0-9]{2})([0-9]{2})-([0-9]{1,5})$/);
  if (!m) return null;
  var mm = Number(m[1]);
  var seq = Number(m[3]);
  if (mm < 1 || mm > 12 || seq < 1) return null;
  var prefix = m[1] + m[2];
  return { test: false, text: prefix + '-' + seq, prefix: prefix, mm: mm, yy: Number(m[2]), seq: seq };
}

/** เลขที่สำหรับแสดง/เทียบ (อ่านไม่ได้ → ข้อความเดิม) */
function cashDocNoText(v) {
  var p = cashDocParse(v);
  return p ? p.text : String(v == null ? '' : v).trim();
}

/** เลขที่สองค่าเป็นใบเดียวกันไหม ("1069-015" = "1069-15", 0 = "0000") */
function cashDocSame(a, b) {
  var x = cashDocNoText(a);
  return x !== '' && x === cashDocNoText(b);
}

/** ส่วนหน้าของเลขที่จากวันที่บิล (YYYY-MM-DD ค.ศ.) เช่น 2026-10-05 → "1069" / วันที่ไม่ถูกต้อง → '' */
function cashDocPrefix(isoDate) {
  var m = String(isoDate == null ? '' : isoDate).match(/^([0-9]{4})-([0-9]{2})-[0-9]{2}$/);
  if (!m) return '';
  var yy = (Number(m[1]) + 543) % 100;
  return m[2] + (yy < 10 ? '0' : '') + yy;
}

/** ลำดับสูงสุดของแต่ละเดือน { "1069": 15, ... } (นับใบที่ยกเลิก ไม่นับบิลทดสอบ) */
function cashDocMonthMax(documents) {
  var out = {};
  (documents || []).forEach(function (d) {
    var p = cashDocParse(d && d.doc_no);
    if (!p || p.test) return;
    if (!out[p.prefix] || p.seq > out[p.prefix]) out[p.prefix] = p.seq;
  });
  return out;
}

/** เลขที่ถัดไปจากลำดับสูงสุดของแต่ละเดือน (ใช้ในหน้าเว็บแสดงเลขโดยประมาณ) / วันที่ไม่ถูกต้อง → '' */
function cashDocNextFromMax(monthMax, isoDate) {
  var prefix = cashDocPrefix(isoDate);
  if (!prefix) return '';
  return prefix + '-' + ((Number(monthMax && monthMax[prefix]) || 0) + 1);
}

/** เลขที่ถัดไปของวันที่บิลนี้ = MMYY-(ลำดับสูงสุดของเดือนนั้น + 1) */
function cashDocNext(documents, isoDate) {
  return cashDocNextFromMax(cashDocMonthMax(documents), isoDate);
}

/** มีใบเงินสดจริงแล้วหรือยัง (ไม่นับบิลทดสอบ 0000) */
function cashDocHasReal(documents) {
  return (documents || []).some(function (d) {
    var p = cashDocParse(d && d.doc_no);
    return !!p && !p.test;
  });
}

/** ค่าสำหรับเรียงลำดับ (ใหม่ = มาก): ปี → เดือน → ลำดับ / บิลทดสอบ = -1 / อ่านไม่ได้ = -2 */
function cashDocSortKey(v) {
  var p = cashDocParse(v);
  if (!p) return -2;
  if (p.test) return -1;
  return (p.yy * 100 + p.mm) * 100000 + p.seq;
}

/** เรียงเอกสาร ใหม่ → เก่า (ใช้กับ Array.sort) */
function cashDocCompareDesc(a, b) {
  return cashDocSortKey(b && b.doc_no) - cashDocSortKey(a && a.doc_no);
}

/**
 * ตั้งค่าแบบใบเงินสดสำหรับ validateDocumentInput / buildDocument ของ invoice.js
 * ประเภทเอกสารมีแบบเดียว (doc_title ในแท็บตั้งค่า), ชนิดการขาย = เงินสด (ไม่มีวันครบกำหนด), VAT 0
 */
function cashDocConfig(config) {
  config = config || {};
  var out = {};
  for (var k in config) out[k] = config[k];
  var title = typeof config.doc_title === 'string' && config.doc_title.trim() ? config.doc_title.trim() : CASH_DOC_TITLE;
  out.doc_title = title;
  out.doc_types = [title];
  out.sale_type_labels = [CASH_DOC_SALE_TYPE];
  out.cash_sale_label = CASH_DOC_SALE_TYPE;
  out.vat_rate = 0;
  return out;
}

/** ข้อมูลจากฟอร์มใบเงินสด → รูปแบบที่ invoice.js รับ (ประเภทเอกสาร/ชนิดการขายใส่ให้ ไม่มีวันครบกำหนด) */
function cashDocInput(input, config) {
  input = input || {};
  var c = cashDocConfig(config);
  return {
    doc_type: c.doc_title,
    doc_date: input.doc_date,
    ref: input.ref,
    sale_type: CASH_DOC_SALE_TYPE,
    due_date: '',
    shop_id: input.shop_id,
    date_confirmed: input.date_confirmed,
    items: input.items
  };
}

/**
 * ตรวจข้อมูลใบเงินสด (กฎเดียวกับใบกำกับ: ร้าน สินค้า จำนวน ราคา ส่วนลด จำนวนบรรทัด ความยาวข้อความ วันที่)
 * ไม่เตือน "อยู่ก่อนบิลใบล่าสุด" (เลขที่รันตามเดือนของวันที่บิล)
 * @param {object} ctx { shops (ร้านของใบเงินสด), products, config (แท็บตั้งค่าของใบเงินสด), today, checkTextLimits?, liveChecks?, requireDateConfirm? }
 */
function cashDocValidate(input, ctx) {
  var c = {};
  for (var k in ctx) c[k] = ctx[k];
  c.config = cashDocConfig(ctx.config);
  c.documents = [];
  return validateDocumentInput(cashDocInput(input, ctx.config), c);
}

/** ยอดของใบเงินสด: รวมเงิน, ส่วนลด, รวมสุทธิ (ไม่มี VAT) — คำนวณเป็นสตางค์ด้วย calcTotals */
function cashDocTotals(items) {
  var t = calcTotals(items || [], 0);
  return { sum_amount: t.sum_amount, discount: t.discount, total: t.total };
}

/** คอลัมน์ของแถวใบเงินสด (ตรงกับ SCHEMA.cash_documents) */
var CASH_DOC_KEYS = ['doc_no', 'shop_id', 'doc_date', 'ref', 'shop_legal_name', 'shop_address1', 'shop_address2', 'shop_tel', 'shop_short_name',
  'sum_amount', 'discount', 'total', 'pdf_path', 'status', 'cancelled_reason', 'cancelled_at', 'request_id', 'created_at', 'issued_by', 'cancelled_by'];

/**
 * สร้างแถวใบเงินสด + รายการ (เรียกหลังตรวจผ่านแล้ว) — snapshot ร้านและชื่อ/หน่วยสินค้า ณ วันออก
 * @param {object} meta { docNo (ข้อความ), createdAt, requestId, issuedBy }
 */
function cashDocBuild(input, ctx, meta) {
  var c = {};
  for (var k in ctx) c[k] = ctx[k];
  c.config = cashDocConfig(ctx.config);
  var b = buildDocument(cashDocInput(input, ctx.config), c, meta);
  var doc = {};
  CASH_DOC_KEYS.forEach(function (key) { doc[key] = b.document[key] === undefined ? '' : b.document[key]; });
  doc.doc_no = String(meta.docNo);
  b.items.forEach(function (it) { it.doc_no = String(meta.docNo); });
  return { document: doc, items: b.items };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CASH_DOC_TEST_NO: CASH_DOC_TEST_NO,
    CASH_DOC_TITLE: CASH_DOC_TITLE,
    CASH_DOC_SALE_TYPE: CASH_DOC_SALE_TYPE,
    CASH_DOC_KEYS: CASH_DOC_KEYS,
    cashDocIsTest: cashDocIsTest,
    cashDocParse: cashDocParse,
    cashDocNoText: cashDocNoText,
    cashDocSame: cashDocSame,
    cashDocPrefix: cashDocPrefix,
    cashDocMonthMax: cashDocMonthMax,
    cashDocNextFromMax: cashDocNextFromMax,
    cashDocNext: cashDocNext,
    cashDocHasReal: cashDocHasReal,
    cashDocSortKey: cashDocSortKey,
    cashDocCompareDesc: cashDocCompareDesc,
    cashDocConfig: cashDocConfig,
    cashDocInput: cashDocInput,
    cashDocValidate: cashDocValidate,
    cashDocTotals: cashDocTotals,
    cashDocBuild: cashDocBuild
  };
}
