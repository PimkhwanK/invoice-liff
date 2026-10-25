/**
 * stock.js — ระบบสต็อก (รอบ 16) กติกาทั้งหมดแบบ pure (ไม่อ่าน/เขียนชีตเอง)
 *
 *   ข้อมูลอยู่ในไฟล์ใบกำกับที่เดียว (ใช้กับทั้งใบกำกับและใบเงินสด):
 *     แท็บ "ความเคลื่อนไหวสต็อก" (stock_moves) = ประวัติทุกรายการ ห้ามลบ — ยอดจริงคำนวณจากแท็บนี้ได้เสมอ (stockBalancesFromMoves)
 *     แท็บ "รายการ" คอลัมน์ "คงเหลือ" + "เริ่มนับสต็อก" (product_stock) = ยอดล่าสุดเก็บไว้ให้อ่านเร็ว / "เริ่มนับสต็อก" ว่าง = ไม่ติดตาม
 *   เริ่มนับเมื่อมี "ยอดเริ่มต้น" (นับสต็อกครั้งแรก) / บิลที่ออกหลังเวลาเริ่มนับเท่านั้นที่ถูกหัก (เทียบเวลาที่ออก created_at ไม่ใช่วันที่บิล)
 *   ออกบิลจริง → หักทุกบรรทัด (รวมของแถม) / บิลทดสอบ 0000 ไม่หัก / ยกเลิก → คืน (รายการใหม่) เฉพาะที่เคยหักจริง
 *   1 บิลหัก 1 สินค้าได้ครั้งเดียว (อ้างอิง + บาร์โค้ด) → ตามแก้ (stockSyncPlan) รันซ้ำกี่ครั้งก็ไม่หักเกิน / ติดลบได้
 *   จำนวนเป็นจำนวนหน่วยของสินค้า (สินค้าละ 1 หน่วย โกดังเดียว) ปัดทศนิยม 3 ตำแหน่ง
 *
 * ใช้ได้ทั้ง Node (test), เบราว์เซอร์ (liff-site/stockCore.js) และ Apps Script (gas/stockCore.gs) — สำเนาตรงตัวทุกไฟล์
 * ทุกชื่อระดับบนสุดขึ้นต้นด้วย stock / STOCK (Apps Script ใช้ global scope ร่วมกันทุกไฟล์ — Store.gs ใช้ store) / ระบบจำลองไม่ใช้ไฟล์นี้
 */

if (typeof require === 'function' && typeof module !== 'undefined') {
  var cashDocParse = require('./cashDoc').cashDocParse;
  var taxItemOwners = require('./invoice').taxItemOwners;
}

/** ประเภทของรายการ (ค่าในคอลัมน์ "ประเภท") */
var STOCK_KIND = {
  open: 'ยอดเริ่มต้น',
  sale: 'ขาย',
  ret: 'คืนจากยกเลิก',
  in: 'ของเข้า',
  out: 'ของออก (ไม่มีบิล)',
  count: 'แก้ยอดตามที่นับ'
};
/** รอบ 18: ชื่อประเภทเดิมในชีต (รอบ 16) → ชื่อปัจจุบัน (แถวเก่าในแท็บความเคลื่อนไหวยังอ่านได้ — ไม่แก้แถวเดิม) */
var STOCK_KIND_OLD = { 'รับเข้า': 'ของเข้า', 'หักออก': 'ของออก (ไม่มีบิล)', 'นับสต็อก': 'แก้ยอดตามที่นับ' };
var STOCK_LOW_DEFAULT = 10;  // ใกล้หมดเมื่อเหลือไม่เกินเท่านี้ (แท็บตั้งค่า stock_low_threshold)
var STOCK_MAX_LINES = 50;    // ของเข้า / ของออก / แก้ยอดตามที่นับ ได้ครั้งละไม่เกินกี่สินค้า
var STOCK_MAX_QTY = 1000000; // จำนวนต่อบรรทัดไม่เกินเท่านี้ (กันพิมพ์เกิน)
var STOCK_TEXT_MAX = 200;    // เหตุผล / หมายเหตุ
/** รอบ 21: ใบกำกับประเภทนี้ไม่หัก/ไม่คืนสต็อก (ใบที่ 2 ของการขายเดียวกัน — ของออกไปแล้วตอนออกใบกำกับภาษี/ใบส่งสินค้า) */
var STOCK_NO_DEDUCT_DOC_TYPE = 'ใบเสร็จรับเงิน';

/** บิลนี้หักสต็อกไหม — ใบกำกับประเภท "ใบเสร็จรับเงิน" ไม่หัก / ใบกำกับภาษี/ใบส่งสินค้า และใบเงินสด หักตามปกติ */
function stockDeducts(kind, docType) {
  return !(kind === 'tax' && stockText(docType) === STOCK_NO_DEDUCT_DOC_TYPE);
}

function stockText(v) {
  return v === undefined || v === null ? '' : String(v).trim();
}

/** ชื่อประเภทสำหรับแสดง (ชื่อเดิมของรอบ 16 → ชื่อปัจจุบัน) */
function stockKindText(v) {
  var k = stockText(v);
  return STOCK_KIND_OLD[k] || k;
}

function stockRound(n) {
  return Math.round(Number(n) * 1000) / 1000;
}

/**
 * รอบ 22–23: ค่าในช่อง "เตือนเมื่อเหลือ" ของสินค้า → ตัวเลข ≥ 0 / ว่าง หรืออ่านไม่ได้ → null (ไม่เตือน)
 * รอบ 23: ไม่มีค่ากลางแล้ว (stock_low_threshold ไม่อ่าน) — 0 = เตือนเมื่อของหมด
 */
function stockAlertValue(v) {
  var s = stockText(v);
  if (s === '') return null;
  var n = Number(s);
  return isFinite(n) && n >= 0 ? stockRound(n) : null;
}

/** ช่อง "เริ่มนับสต็อก" ไม่ว่าง = ติดตามสต็อกสินค้านี้ */
function stockTracked(p) {
  return !!p && stockText(p.stock_since) !== '';
}

/** ค่าในช่อง "อ้างอิง": ประเภทบิล + เลขที่ เช่น "ใบกำกับภาษี 1705" / "ใบเงินสด 1069-15" ('cash' / อื่น ๆ = ใบกำกับ) */
/**
 * อ้างอิงของบิลในแท็บความเคลื่อนไหว
 * รอบ 24: ใบกำกับเลขที่ซ้ำได้ถ้าคนละประเภท → ใบเสร็จรับเงิน = "ใบเสร็จรับเงิน N" (ไม่หักสต็อกอยู่แล้ว) / ประเภทอื่น = "ใบกำกับภาษี N" เหมือนเดิม
 * (แถวเดิมในชีตไม่ต้องแก้ — ประเภทที่หักสต็อกได้มีประเภทเดียวตามค่าเริ่มต้น จึงไม่ชนกัน)
 */
function stockRef(kind, docNo, docType) {
  if (kind === 'cash') {
    var p = cashDocParse(docNo);
    return 'ใบเงินสด ' + (p ? p.text : stockText(docNo));
  }
  return (stockText(docType) === STOCK_NO_DEDUCT_DOC_TYPE ? STOCK_NO_DEDUCT_DOC_TYPE : 'ใบกำกับภาษี') + ' ' + Number(docNo);
}

/** ค่าเกณฑ์ใกล้หมดจากแท็บตั้งค่า (ไม่มี / ไม่ใช่ตัวเลข ≥ 0 → 10) */
function stockLowThreshold(config) {
  var n = Number(config && config.stock_low_threshold);
  return config && stockText(config.stock_low_threshold) !== '' && isFinite(n) && n >= 0 ? n : STOCK_LOW_DEFAULT;
}

/**
 * สถานะยอด: 'neg' ติดลบ / 'low' ใกล้หมด (≤ "เตือนเมื่อเหลือ" ของสินค้านั้น) / 'ok' / 'off' ยังไม่ติดตาม
 * รอบ 23: ช่อง "เตือนเมื่อเหลือ" ว่าง = ไม่เตือน (ไม่มีค่ากลาง) / 0 = เตือนเมื่อหมด / ติดลบเตือนเสมอ
 */
function stockLevel(p) {
  if (!stockTracked(p)) return 'off';
  var q = Number(p.stock_qty) || 0;
  if (q < 0) return 'neg'; // ติดลบ = ยอดผิด เตือนเสมอ
  var alert = stockAlertValue(p.low_alert);
  return alert !== null && q <= alert ? 'low' : 'ok';
}

/**
 * แถวของแท็บรายการ (products + product_stock) → สินค้าพร้อมยอด { barcode, name, unit, active, tracked, qty, since }
 * @param {object[]} products แถว products (ชื่อ หน่วย สถานะ)
 * @param {object[]} stockRows แถว product_stock (barcode, stock_qty, stock_since)
 */
function stockProducts(products, stockRows) {
  var byBc = {};
  (stockRows || []).forEach(function (r) { var bc = stockText(r.barcode); if (bc) byBc[bc] = r; });
  return (products || []).filter(function (p) { return stockText(p.barcode) !== ''; }).map(function (p) {
    var bc = stockText(p.barcode);
    var s = byBc[bc] || {};
    var tracked = stockTracked(s);
    return {
      barcode: bc, name: stockText(p.name), unit: stockText(p.unit), active: p.active !== false,
      tracked: tracked, qty: tracked ? stockRound(Number(s.stock_qty) || 0) : 0, since: tracked ? stockText(s.stock_since) : '',
      lowAlert: stockAlertValue(s.low_alert) // รอบ 22: null = ไม่เตือน (รอบ 23)
    };
  });
}

/** จำนวนรวมต่อบาร์โค้ดของรายการในบิล (รวมของแถม / บรรทัดสินค้าเดียวกันหลายบรรทัดรวมกัน) — ลำดับตามที่พบครั้งแรก */
function stockSaleLines(items) {
  var out = [];
  var at = {};
  (items || []).forEach(function (it) {
    var bc = stockText(it.barcode);
    var q = Number(it.qty);
    if (!bc || !isFinite(q) || q === 0) return;
    if (at[bc] === undefined) { at[bc] = out.length; out.push({ barcode: bc, name: stockText(it.name), qty: 0 }); }
    out[at[bc]].qty = stockRound(out[at[bc]].qty + q);
  });
  return out;
}

/**
 * คำเตือน "สต็อกไม่พอ" ของบิลที่กำลังจะออก (ไม่ block — ออกบิลได้ ยอดติดลบได้)
 * @param {object[]} items รายการในบิล (barcode, qty)
 * @param {object} stock { barcode: { qty, tracked, name, unit } }
 * @returns {string[]}
 */
function stockShortages(items, stock) {
  var out = [];
  stockSaleLines(items).forEach(function (l) {
    var s = stock && stock[l.barcode];
    if (!s || !s.tracked) return;
    var after = stockRound((Number(s.qty) || 0) - l.qty);
    if (after < 0) {
      out.push((s.name || l.name || l.barcode) + ': คงเหลือ ' + stockRound(s.qty) + ' ' + (s.unit || '') + ' หลังออกบิลนี้เหลือ ' + after);
    }
  });
  return out;
}

/**
 * รายการหักสต็อกของบิลที่เพิ่งบันทึก (เฉพาะสินค้าที่ติดตาม และเริ่มนับก่อนเวลาที่ออกบิล)
 * @param {object} o { items, stock: {bc: {qty, since, tracked}}, ref, at (เวลาที่ออก = created_at), by, kind?, docType? }
 *   รอบ 21: kind 'tax' + docType "ใบเสร็จรับเงิน" → ไม่หัก (stockDeducts)
 * @returns {{moves: object[], balances: {bc: qty}}} moves พร้อม "คงเหลือหลังรายการ" (balance)
 */
function stockPlanSale(o) {
  var moves = [];
  var balances = {};
  if (o.kind && !stockDeducts(o.kind, o.docType)) return { moves: moves, balances: balances };
  stockSaleLines(o.items).forEach(function (l) {
    var s = o.stock && o.stock[l.barcode];
    if (!s || !s.tracked || !(stockText(s.since) <= stockText(o.at))) return;
    var cur = balances[l.barcode] !== undefined ? balances[l.barcode] : Number(s.qty) || 0;
    var bal = stockRound(cur - l.qty);
    balances[l.barcode] = bal;
    moves.push({ at: o.at, barcode: l.barcode, name: s.name || l.name, kind: STOCK_KIND.sale, qty: -l.qty, balance: bal, ref: o.ref, reason: '', by: o.by || '', request_id: '' });
  });
  return { moves: moves, balances: balances };
}

/**
 * รายการคืนสต็อกของบิลที่ยกเลิก — คืนเท่าที่เคยหักจริง (รายการ "ขาย" ของอ้างอิงนี้) และยังไม่เคยคืน
 * @param {object} o { ref, moves (ทั้งแท็บ หรืออย่างน้อยของอ้างอิงนี้), stock: {bc: {qty}}, at, by }
 */
function stockPlanReturn(o) {
  var sold = {};
  var back = {};
  (o.moves || []).forEach(function (m) {
    if (stockText(m.ref) !== o.ref) return;
    var bc = stockText(m.barcode);
    var q = Number(m.qty) || 0;
    if (stockText(m.kind) === STOCK_KIND.sale) sold[bc] = stockRound((sold[bc] || 0) - q);
    if (stockText(m.kind) === STOCK_KIND.ret) back[bc] = stockRound((back[bc] || 0) + q);
  });
  var moves = [];
  var balances = {};
  Object.keys(sold).forEach(function (bc) {
    var q = stockRound(sold[bc] - (back[bc] || 0));
    if (q <= 0) return;
    var s = (o.stock && o.stock[bc]) || {};
    var cur = balances[bc] !== undefined ? balances[bc] : Number(s.qty) || 0;
    var bal = stockRound(cur + q);
    balances[bc] = bal;
    var name = s.name || '';
    if (!name) (o.moves || []).forEach(function (m) { if (stockText(m.barcode) === bc && stockText(m.name)) name = stockText(m.name); });
    moves.push({ at: o.at, barcode: bc, name: name, kind: STOCK_KIND.ret, qty: q, balance: bal, ref: o.ref, reason: '', by: o.by || '', request_id: '' });
  });
  return { moves: moves, balances: balances };
}

/**
 * รับเข้า / หักออก / นับสต็อก (หลายสินค้าในครั้งเดียว) — ตรวจข้อมูล + สร้างรายการ
 * @param {object} o {
 *   kind: 'in' | 'out' | 'count', lines: [{ barcode, qty }] (นับสต็อก: qty = ยอดที่นับได้),
 *   reason, stock: {bc: {qty, tracked, name}}, at, by, requestId
 * }
 *   รับเข้า: จำนวน > 0 / หักออก: จำนวน > 0 + ต้องมีหมายเหตุ / ทั้งสองแบบใช้กับสินค้าที่เริ่มนับแล้วเท่านั้น
 *   นับสต็อก: ยอดที่นับได้ ≥ 0 — สินค้าที่ยังไม่เริ่มนับ = "ยอดเริ่มต้น" (ไม่ต้องมีเหตุผล) / เริ่มนับแล้ว = บันทึกส่วนต่าง (มีส่วนต่าง → ต้องมีเหตุผล)
 * @returns {{errors: string[], moves: object[], balances: {bc: qty}, opened: string[], same: string[]}} opened = บาร์โค้ดที่เริ่มนับครั้งนี้ / same = นับแล้วตรงกับระบบ
 */
function stockPlanManual(o) {
  var errors = [];
  var moves = [];
  var balances = {};
  var opened = [];
  var same = [];
  var reason = stockText(o.reason);
  var lines = Array.isArray(o.lines) ? o.lines : [];
  if (['in', 'out', 'count'].indexOf(o.kind) < 0) return { errors: ['ไม่รู้จักรายการนี้'], moves: [], balances: {}, opened: [], same: [] };
  if (!lines.length) errors.push('กรุณาเลือกสินค้าอย่างน้อย 1 รายการ');
  if (lines.length > STOCK_MAX_LINES) errors.push('บันทึกได้ครั้งละไม่เกิน ' + STOCK_MAX_LINES + ' รายการ');
  if (reason.length > STOCK_TEXT_MAX) errors.push('หมายเหตุยาวเกิน ' + STOCK_TEXT_MAX + ' ตัวอักษร');
  if (o.kind === 'out' && !reason) errors.push('กรุณาใส่หมายเหตุว่าของออกเพราะอะไร');
  var seen = {};
  var needReason = false;
  lines.forEach(function (l, i) {
    var bc = stockText(l && l.barcode);
    var s = o.stock && o.stock[bc];
    var label = s && s.name ? s.name : 'รายการที่ ' + (i + 1);
    if (!bc || !s) { errors.push('รายการที่ ' + (i + 1) + ': ไม่พบสินค้านี้'); return; }
    if (seen[bc]) { errors.push(label + ': เลือกซ้ำ'); return; }
    seen[bc] = true;
    var raw = l.qty;
    var q = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\s*-?[0-9]+(\.[0-9]+)?\s*$/.test(raw) ? Number(raw) : NaN;
    if (!isFinite(q)) { errors.push(label + ': กรุณาใส่จำนวนเป็นตัวเลข'); return; }
    q = stockRound(q);
    if (Math.abs(q) > STOCK_MAX_QTY) { errors.push(label + ': จำนวนมากเกินไป'); return; }
    var cur = Number(s.qty) || 0;
    if (o.kind === 'count') {
      if (q < 0) { errors.push(label + ': ยอดที่นับได้ต้องไม่ติดลบ'); return; }
      if (!s.tracked) {
        opened.push(bc);
        balances[bc] = q;
        moves.push({ kind: STOCK_KIND.open, barcode: bc, name: s.name, qty: q, balance: q });
        return;
      }
      var diff = stockRound(q - cur);
      if (diff === 0) { same.push(bc); return; }
      needReason = true;
      balances[bc] = q;
      moves.push({ kind: STOCK_KIND.count, barcode: bc, name: s.name, qty: diff, balance: q, note: 'นับได้ ' + q + ' (ระบบมี ' + stockRound(cur) + ')' });
      return;
    }
    if (!s.tracked) { errors.push(label + ': ยังไม่เริ่มนับสต็อก กด "แก้ยอดตามที่นับ" ใส่ยอดเริ่มต้นก่อน'); return; }
    if (!(q > 0)) { errors.push(label + ': จำนวนต้องมากกว่า 0'); return; }
    var signed = o.kind === 'in' ? q : -q;
    var bal = stockRound(cur + signed);
    balances[bc] = bal;
    moves.push({ kind: o.kind === 'in' ? STOCK_KIND.in : STOCK_KIND.out, barcode: bc, name: s.name, qty: signed, balance: bal });
  });
  if (o.kind === 'count' && needReason && !reason) errors.push('ยอดที่นับได้ไม่ตรงกับระบบ กรุณาใส่เหตุผล');
  if (errors.length) return { errors: errors, moves: [], balances: {}, opened: [], same: [] };
  moves = moves.map(function (m) {
    var why = m.note ? m.note + (reason ? ' · ' + reason : '') : reason;
    return { at: o.at, barcode: m.barcode, name: m.name, kind: m.kind, qty: m.qty, balance: m.balance, ref: '', reason: why, by: o.by || '', request_id: o.requestId || '' };
  });
  return { errors: [], moves: moves, balances: balances, opened: opened, same: same };
}

/**
 * ยอดจากแท็บความเคลื่อนไหว (ยอดจริง) — ใช้ตรวจ/ซ่อมคอลัมน์ "คงเหลือ" ในแท็บรายการ (มีคนแก้ในชีตเอง / เขียนไม่ครบ)
 * @returns {{bc: {qty, since}}} since = เวลาของ "ยอดเริ่มต้น" แรก / สินค้าที่ไม่มียอดเริ่มต้น = ไม่ติดตาม (ไม่อยู่ในผล)
 */
function stockBalancesFromMoves(moves) {
  var out = {};
  (moves || []).forEach(function (m) {
    var bc = stockText(m.barcode);
    if (!bc) return;
    var k = stockText(m.kind);
    if (k === STOCK_KIND.open && !out[bc]) out[bc] = { qty: 0, since: stockText(m.at) };
    if (!out[bc]) return; // รายการก่อนเริ่มนับ (ไม่ควรมี) ไม่นับ
    out[bc].qty = stockRound(out[bc].qty + (Number(m.qty) || 0));
  });
  return out;
}

/**
 * ตามแก้สต็อกให้ตรงกับบิล (หลังบันทึกสต็อกไม่สำเร็จ / เมนู "ตรวจสต็อกกับบิล") — รันซ้ำได้ ไม่หักเกิน
 *   บิลจริงที่ยังไม่ยกเลิก + ออกหลังเวลาเริ่มนับของสินค้า + ยังไม่มีรายการ "ขาย" (อ้างอิง + บาร์โค้ด) → เพิ่มรายการขาย
 *   บิลที่ยกเลิกแล้ว + มีรายการขาย + คืนยังไม่ครบ → เพิ่มรายการคืน
 *   (บิลที่ยกเลิกและไม่เคยถูกหัก → ไม่ทำอะไร)
 * @param {object} o {
 *   books: [{ kind: 'tax'|'cash', docs, items }]   แถวเอกสาร / รายการของแต่ละไฟล์
 *   moves: ทุกแถวของแท็บความเคลื่อนไหว, names: {bc: ชื่อสินค้า}, at, by
 * }
 * @returns {{moves: object[], balances: {bc: {qty, since}}, sales: number, returns: number}} balances = ยอดจริงหลังเพิ่มรายการเหล่านี้
 */
function stockSyncPlan(o) {
  var base = stockBalancesFromMoves(o.moves);
  var bal = {};
  Object.keys(base).forEach(function (bc) { bal[bc] = { qty: base[bc].qty, since: base[bc].since }; });
  var sold = {}; // ref|bc → จำนวนที่หัก (บวก)
  var back = {}; // ref|bc → จำนวนที่คืน
  (o.moves || []).forEach(function (m) {
    var k = stockText(m.ref) + '|' + stockText(m.barcode);
    if (stockText(m.kind) === STOCK_KIND.sale) sold[k] = stockRound((sold[k] || 0) - (Number(m.qty) || 0));
    if (stockText(m.kind) === STOCK_KIND.ret) back[k] = stockRound((back[k] || 0) + (Number(m.qty) || 0));
  });
  var out = [];
  var counts = { sales: 0, returns: 0 };
  function add(bc, qty, kind, ref) {
    bal[bc].qty = stockRound(bal[bc].qty + qty);
    out.push({ at: o.at, barcode: bc, name: (o.names && o.names[bc]) || '', kind: kind, qty: qty, balance: bal[bc].qty, ref: ref, reason: 'ตามแก้อัตโนมัติ', by: o.by || '', request_id: '' });
  }
  (o.books || []).forEach(function (book) {
    var itemsOf = {};
    // รอบ 24: ใบกำกับ — รายการเป็นของบิล (เลขที่ + ประเภท) / ใบเงินสด — เลขที่อย่างเดียว
    var owners = book.kind === 'tax' ? taxItemOwners(book.docs, book.items) : null;
    (book.items || []).forEach(function (it, i) {
      var key = owners ? (owners[i] >= 0 ? 'd' + owners[i] : '') : stockSyncDocKey(book.kind, it.doc_no);
      if (key) (itemsOf[key] = itemsOf[key] || []).push(it);
    });
    (book.docs || []).forEach(function (d, di) {
      if (!stockSyncDocKey(book.kind, d.doc_no)) return;
      var key = owners ? 'd' + di : stockSyncDocKey(book.kind, d.doc_no);
      var ref = stockRef(book.kind, d.doc_no, d.doc_type);
      var cancelled = stockText(d.status) === 'cancelled';
      var deduct = stockDeducts(book.kind, d.doc_type); // รอบ 21: ใบเสร็จรับเงินไม่หัก (ยกเลิก = คืนเฉพาะที่เคยหักจริง)
      stockSaleLines(itemsOf[key]).forEach(function (l) {
        var k = ref + '|' + l.barcode;
        var b = bal[l.barcode];
        if (cancelled) {
          var need = stockRound((sold[k] || 0) - (back[k] || 0));
          if (b && need > 0) { add(l.barcode, need, STOCK_KIND.ret, ref); back[k] = stockRound((back[k] || 0) + need); counts.returns++; }
          return;
        }
        if (!deduct || !b || sold[k] || !(b.since <= stockText(d.created_at))) return;
        add(l.barcode, -l.qty, STOCK_KIND.sale, ref);
        sold[k] = l.qty;
        counts.sales++;
      });
    });
  });
  return { moves: out, balances: bal, sales: counts.sales, returns: counts.returns };
}

/**
 * รอบ 21: ผลการคืนสต็อกของบิลที่ยกเลิก (ข้อความบนจอ)
 * @param {object} o { ref, moves (ทั้งแท็บหลังคืน), items (รายการในบิล), stock: {bc: {tracked, since}}, createdAt, kind, docType }
 * @returns {{returned: number, note: string}} returned = จำนวนสินค้าที่คืนแล้ว (นับรวมที่คืนไว้ก่อนหน้า)
 *   คืนแล้ว → "คืนสต็อกแล้ว N รายการ" / ใบเสร็จรับเงิน → ไม่ได้หักตั้งแต่แรก / ออกก่อนเริ่มนับ → "บิลนี้ออกก่อนเริ่มนับสต็อก จึงไม่ได้คืน" / ไม่มีสินค้าที่นับสต็อก → ''
 */
function stockReturnNote(o) {
  var back = {};
  (o.moves || []).forEach(function (m) {
    if (stockText(m.ref) === o.ref && stockText(m.kind) === STOCK_KIND.ret && Number(m.qty) > 0) back[stockText(m.barcode)] = true;
  });
  var n = Object.keys(back).length;
  if (n) return { returned: n, note: 'คืนสต็อกแล้ว ' + n + ' รายการ' };
  if (o.kind && !stockDeducts(o.kind, o.docType)) return { returned: 0, note: 'ใบเสร็จรับเงินไม่หักสต็อก จึงไม่ได้คืน' };
  var at = stockText(o.createdAt);
  var early = stockSaleLines(o.items).some(function (l) {
    var s = o.stock && o.stock[l.barcode];
    return s && s.tracked && at !== '' && !(stockText(s.since) <= at);
  });
  return { returned: 0, note: early ? 'บิลนี้ออกก่อนเริ่มนับสต็อก จึงไม่ได้คืน' : '' };
}

/** เลขที่ของบิลจริง ('tax' จำนวนเต็ม ≥ 1 / 'cash' MMYY-ลำดับ) → ข้อความ / บิลทดสอบ 0000 หรืออ่านไม่ได้ → '' */
function stockSyncDocKey(kind, v) {
  if (kind === 'cash') {
    var p = cashDocParse(v);
    return p && !p.test ? p.text : '';
  }
  var s = stockText(v);
  var n = Number(s);
  return s !== '' && isFinite(n) && n >= 1 && Math.floor(n) === n ? String(n) : '';
}

// ---------- รอบ 24: รายงานสต็อก (ช่วงวันที่ → 1 แถวต่อสินค้า)

var STOCK_REPORT_MAX_DAYS = 400; // เลือกวันเองได้ยาวไม่เกินเท่านี้
var STOCK_REPORT_PERIODS = ['week', 'lastweek', 'month', 'pick', 'custom'];

function stockIsoOk(s) {
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(String(s))) return false;
  var p = String(s).split('-').map(Number);
  var d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
  return d.getUTCFullYear() === p[0] && d.getUTCMonth() === p[1] - 1 && d.getUTCDate() === p[2];
}

function stockIsoAdd(iso, days) {
  var p = iso.split('-').map(Number);
  return new Date(Date.UTC(p[0], p[1] - 1, p[2] + days)).toISOString().slice(0, 10);
}

function stockIsoDays(from, to) {
  var a = from.split('-').map(Number);
  var b = to.split('-').map(Number);
  return Math.round((Date.UTC(b[0], b[1] - 1, b[2]) - Date.UTC(a[0], a[1] - 1, a[2])) / 86400000);
}

/**
 * ช่วงเวลาของรายงาน (สัปดาห์เริ่มวันจันทร์)
 * @param {object} o { period: 'week'|'lastweek'|'month'|'pick'|'custom', month: 'YYYY-MM' (pick), from, to (custom) }
 * @param {string} today YYYY-MM-DD (เวลาไทย)
 * @returns {{from, to, period} | {error}} สัปดาห์นี้ / เดือนนี้ = ถึงวันนี้ / เลือกเดือน = ทั้งเดือน (เดือนนี้ = ถึงวันนี้)
 */
function stockReportRange(o, today) {
  o = o || {};
  var period = STOCK_REPORT_PERIODS.indexOf(o.period) >= 0 ? o.period : 'month';
  var p = today.split('-').map(Number);
  var dow = (new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay() + 6) % 7; // จันทร์ = 0
  var monday = stockIsoAdd(today, -dow);
  if (period === 'week') return { period: period, from: monday, to: today };
  if (period === 'lastweek') return { period: period, from: stockIsoAdd(monday, -7), to: stockIsoAdd(monday, -1) };
  if (period === 'month') return { period: period, from: today.slice(0, 8) + '01', to: today };
  if (period === 'pick') {
    var m = stockText(o.month);
    if (!/^[0-9]{4}-[0-9]{2}$/.test(m) || !stockIsoOk(m + '-01')) return { error: 'กรุณาเลือกเดือน' };
    var from = m + '-01';
    if (from > today) return { error: 'เลือกเดือนที่ยังไม่ถึงไม่ได้' };
    var last = stockIsoAdd(stockIsoAdd(from, 32).slice(0, 8) + '01', -1);
    return { period: period, month: m, from: from, to: last < today ? last : today };
  }
  var f = stockText(o.from);
  var t = stockText(o.to);
  if (!stockIsoOk(f) || !stockIsoOk(t)) return { error: 'กรุณาเลือกวันเริ่มและวันจบ' };
  if (f > t) return { error: 'วันเริ่มต้องไม่หลังวันจบ' };
  if (f > today) return { error: 'วันเริ่มต้องไม่เกินวันนี้' };
  if (stockIsoDays(f, t) + 1 > STOCK_REPORT_MAX_DAYS) return { error: 'เลือกได้ไม่เกิน ' + STOCK_REPORT_MAX_DAYS + ' วัน' };
  return { period: period, from: f, to: t };
}

/**
 * รายงานสต็อกจากแท็บความเคลื่อนไหว (ยอดจริง) — เทียบวันที่ของ "เวลา" (at) ของรายการ
 *   ยอดต้นช่วง = รวมทุกรายการก่อนวันเริ่ม / เริ่มนับกลางช่วง → ยอดต้นช่วง = ยอดเริ่มต้นที่นับได้ (startedIn = true)
 *   ขายตามบิล = ขาย − คืนจากยกเลิก (บิลที่ออกและยกเลิกในช่วงเดียวกัน = 0) / 0000 ไม่มีรายการอยู่แล้ว
 *   แก้ยอด = แก้ยอดตามที่นับ (+/−) และรายการอื่นที่ไม่รู้จัก (ยอดปลายช่วงต้องตรงกับยอดจริง)
 *   คงเหลือปลายช่วง = ต้นช่วง + ของเข้า − ขาย − ของออก + แก้ยอด = รวมทุกรายการถึงวันจบ
 *   รายการก่อน "ยอดเริ่มต้น" แรกไม่นับ (เหมือน stockBalancesFromMoves) / เริ่มนับหลังวันจบ → ไม่อยู่ในรายงาน
 * @param {object} o { moves, products: [{barcode, name, unit}], from, to }
 * @returns {object[]} [{ barcode, name, unit, since, startedIn, open, inQty, sale, out, adjust, close }] เรียงตามชื่อ
 */
function stockReportRows(o) {
  var acc = {};
  var order = [];
  (o.moves || []).forEach(function (m) {
    var bc = stockText(m.barcode);
    if (!bc) return;
    var kind = stockKindText(m.kind);
    var day = stockText(m.at).slice(0, 10);
    var q = Number(m.qty) || 0;
    var a = acc[bc];
    if (!a) {
      if (kind !== STOCK_KIND.open) return; // ก่อนเริ่มนับ
      a = acc[bc] = { barcode: bc, name: stockText(m.name), since: stockText(m.at), startedIn: false, open: 0, inQty: 0, sale: 0, out: 0, adjust: 0, close: 0, first: true };
      order.push(bc);
    }
    if (day > o.to) return;
    var first = a.first;
    a.first = false;
    if (day < o.from) { a.open = stockRound(a.open + q); a.close = a.open; return; }
    a.close = stockRound(a.close + q);
    if (first) { a.startedIn = true; a.open = stockRound(a.open + q); return; }
    if (kind === STOCK_KIND.sale || kind === STOCK_KIND.ret) a.sale = stockRound(a.sale - q);
    else if (kind === STOCK_KIND.in) a.inQty = stockRound(a.inQty + q);
    else if (kind === STOCK_KIND.out) a.out = stockRound(a.out - q);
    else a.adjust = stockRound(a.adjust + q);
  });
  var info = {};
  (o.products || []).forEach(function (p) { info[stockText(p.barcode)] = p; });
  return order.filter(function (bc) { return stockText(acc[bc].since).slice(0, 10) <= o.to; }).map(function (bc) {
    var a = acc[bc];
    var p = info[bc] || {};
    return {
      barcode: bc, name: stockText(p.name) || a.name, unit: stockText(p.unit), since: a.since, startedIn: a.startedIn,
      open: a.open, inQty: a.inQty, sale: a.sale, out: a.out, adjust: a.adjust, close: a.close
    };
  }).sort(function (x, y) { return String(x.name).localeCompare(String(y.name), 'th'); });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    STOCK_REPORT_MAX_DAYS: STOCK_REPORT_MAX_DAYS,
    stockReportRange: stockReportRange,
    stockReportRows: stockReportRows,
    STOCK_KIND: STOCK_KIND,
    STOCK_KIND_OLD: STOCK_KIND_OLD,
    stockKindText: stockKindText,
    STOCK_LOW_DEFAULT: STOCK_LOW_DEFAULT,
    STOCK_MAX_LINES: STOCK_MAX_LINES,
    STOCK_NO_DEDUCT_DOC_TYPE: STOCK_NO_DEDUCT_DOC_TYPE,
    stockDeducts: stockDeducts,
    stockReturnNote: stockReturnNote,
    stockTracked: stockTracked,
    stockRef: stockRef,
    stockLowThreshold: stockLowThreshold,
    stockAlertValue: stockAlertValue,
    stockLevel: stockLevel,
    stockProducts: stockProducts,
    stockSaleLines: stockSaleLines,
    stockShortages: stockShortages,
    stockPlanSale: stockPlanSale,
    stockPlanReturn: stockPlanReturn,
    stockPlanManual: stockPlanManual,
    stockBalancesFromMoves: stockBalancesFromMoves,
    stockSyncPlan: stockSyncPlan
  };
}
