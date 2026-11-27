/*
 * shadow.js — เทียบรายงานจาก Apps Script กับ Supabase แบบเงียบ ๆ (จุด B ย้ายฐานข้อมูล — docs/supabase-migration-design.md หัวข้อ 14)
 *
 * ผู้ใช้เห็นผลจาก Apps Script เท่านั้น / ไม่มีคำขอไป Apps Script เพิ่ม (ใช้ผลที่หน้าสรุปโหลดอยู่แล้ว)
 * ปิดได้ทั้งหมด: config.js SHADOW_API_URL ว่าง / ไม่ใช่เจ้าของ (api ตอบ not_owner) → จำไว้ ไม่เรียกอีก
 *
 *   Shadow.after(action, args, ผลจาก Apps Script)  เก็บไว้เทียบ (ไม่เกิน 6 รายการ) แล้วลองเทียบ
 *   Shadow.flush()                                 ลองเทียบรายการที่ค้าง (ข้อมูลในฐานยังเก่ากว่าผลของ Apps Script = รอรอบซิงก์ถัดไป)
 *                                                  ระหว่างหน้ายังเปิด ลองซ้ำเองที่ ~6 และ ~11 นาทีหลังได้ผล แล้วหยุด (2026-11-27)
 *                                                  api ตอบ skip changed (ข้อมูลเปลี่ยนหลังเวลาอ่าน) = ทิ้งผลนั้น ลองซ้ำก็ไม่ผ่าน
 *   Shadow.status()                                ผลเทียบสำหรับการ์ดในหน้าจัดการ (null = ไม่แสดง)
 *   Shadow.compareSummary(a, b)                    ช่องที่ไม่ตรง [{path, note}] (ไม่มีตัวเลขเงินในผล) — test ใช้ด้วย
 *   Shadow.compareStock(a, b) / compareReport(a, b) รายงานสต็อก (2026-11-22): รายการสินค้า / แท็บรายงาน
 *   Shadow.compareProfit(a, b) / compareBills(a, b)  รายงานกำไร (2026-11-22): การ์ดกำไร / กำไรรายบิลหน้าแรก
 */
var Shadow = (function () {
  var MAX_PENDING = 8; // 5 รายงาน × ช่วงที่ต่างกัน
  var MAX_DIFFS = 50;
  var KEEP_MS = 6 * 3600 * 1000; // รอเทียบได้นานสุด (เกินนี้ทิ้ง — ข้อมูลเปลี่ยนไปมากแล้ว)
  var TIMEOUT_MS = 10000;
  var RETRY_MS = [6 * 60 * 1000, 11 * 60 * 1000]; // ลองซ้ำหลังได้ผลจาก Apps Script (รอบซิงก์/touch ทุก 5 นาที) แล้วหยุด
  var running = false;
  var timer = null;
  var timerAt = 0;
  // รายงานที่เทียบ → ช่องผลในคำตอบของ api (ฟังก์ชันเทียบกำหนดหลังประกาศ)
  var RESULT = { summaryData: 'summary', stockData: 'stock', stockReport: 'report', profitData: 'profit', profitBills: 'bills' };
  var COMPARE = {};

  function url() {
    var c = typeof window !== 'undefined' && window.APP_CONFIG;
    return c && typeof c.SHADOW_API_URL === 'string' ? c.SHADOW_API_URL : '';
  }

  // ---------- เทียบ (pure)

  /** เวลาของบิล (ข้อความในชีต / จากฐาน) → มิลลิวินาที — ไม่มีเขตเวลา = เวลาไทย */
  function timeMs(s) {
    s = String(s === undefined || s === null ? '' : s).trim();
    if (!s) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) s += 'T00:00:00';
    s = s.replace(' ', 'T');
    if (!/(Z|[+-]\d{2}:?\d{2})$/.test(s)) s += '+07:00';
    var ms = Date.parse(s);
    return isNaN(ms) ? s : ms;
  }

  function keyed(list, keyOf, valueOf) {
    var out = {};
    (list || []).forEach(function (r) { out[keyOf(r)] = valueOf ? valueOf(r) : r; });
    return out;
  }

  /** ผล summaryData → ส่วนที่เทียบได้ (รายการที่ลำดับไม่มีความหมายเปลี่ยนเป็น map ตามคีย์) */
  function sections(s) {
    s = s || {};
    return {
      head: { v: s.v, year: s.year, today: s.today, years: (s.years || []).slice().sort() },
      days: s.days || {},
      shops: keyed(s.shops, function (r) { return r[0] + '|' + r[1]; }),
      shopsToday: keyed(s.shopsToday, function (r) { return r[0]; }),
      products: keyed(s.products, function (r) { return r[0] + '|' + r[1]; }),
      productsToday: keyed(s.productsToday, function (r) { return r[0]; }),
      names: s.names || {},
      pnames: s.pnames || {},
      lost: keyed(s.lost, function (r) { return r[0]; }),
      recent: keyed(s.recent, function (r) { return r[0] + ':' + r[1] + ':' + (r[7] || ''); }, function (r) {
        var x = r.slice();
        x[3] = timeMs(x[3]);
        return x;
      }),
      missing: s.missing || {}
    };
  }

  /** ช่องที่ไม่ตรง (สูงสุด MAX_DIFFS) — path = ส่วน/คีย์ / note ไม่มีตัวเลข */
  function compareSummary(a, b) {
    return compareSections(sections(a), sections(b));
  }

  /** stockData → ส่วนที่เทียบได้ (สถานะ "กำลังตามแก้สต็อก" ไม่เทียบ — มาจากค่าใน Apps Script ไม่ใช่ข้อมูลในชีต / ลำดับรายการไม่สำคัญ) */
  function stockSections(s) {
    s = s || {};
    return {
      head: { ready: !!s.ready, costReady: !!s.costReady, noCostCount: s.noCostCount === undefined ? null : s.noCostCount },
      products: keyed(s.products, function (p) { return p.barcode; }, function (p) {
        return [p.name, p.unit, !!p.active, !!p.tracked, p.qty, timeMs(p.since), p.level, p.brand || '', p.lowAlert === undefined ? null : p.lowAlert,
          p.costStart === undefined ? null : p.costStart, p.costLast === undefined ? null : p.costLast];
      }),
      noCostLots: keyed(s.noCostLots, function (l) { return l.lot_id; }, function (l) { return [l.barcode, l.name, timeMs(l.at), l.qty_in, l.qty_left, l.source, l.where]; })
    };
  }

  function compareStock(a, b) {
    return compareSections(stockSections(a), stockSections(b));
  }

  /** stockReport → ส่วนที่เทียบได้ (เวลาพิมพ์ / ชื่อบริษัท ไม่เทียบ) */
  function reportSections(r) {
    r = r || {};
    return {
      head: { ready: r.ready !== false, period: r.period, month: r.month || '', from: r.from, to: r.to },
      rows: keyed(r.rows, function (x) { return x.barcode; }, function (x) {
        return [x.name, x.unit, timeMs(x.since), !!x.startedIn, x.open, x.inQty, x.sale, x.out, x.adjust, x.close, x.brand || ''];
      })
    };
  }

  function compareReport(a, b) {
    return compareSections(reportSections(a), reportSections(b));
  }

  /** การ์ดกำไร (profitData) → ส่วนที่เทียบได้ (ร้าน/สินค้าเทียบตามคีย์ ไม่สนลำดับ) */
  function profitSections(p) {
    p = p || {};
    return {
      head: { ready: p.ready !== false, from: p.from || '', to: p.to || '', start: p.start || '', salesBeforeVat: !!p.salesBeforeVat },
      totals: { cur: p.cur || null, prev: p.prev || null },
      shops: keyed(p.shops, function (x) { return x.key; }),
      products: keyed(p.products, function (x) { return x.barcode; })
    };
  }

  function compareProfit(a, b) {
    return compareSections(profitSections(a), profitSections(b));
  }

  /** กำไรรายบิล หน้าแรก (profitBills) — บิลเทียบตาม ประเภท+เลขที่+ชนิด / สินค้าที่ยังไม่มีต้นทุนตามบาร์โค้ด */
  function billsSections(r) {
    r = r || {};
    return {
      head: { ready: r.ready !== false, total: r.total === undefined ? null : r.total, start: r.start || '', salesBeforeVat: !!r.salesBeforeVat },
      bills: keyed(r.bills, function (b) { return b.kind + ':' + b.no + ':' + (b.docType || ''); }, function (b) {
        var x = JSON.parse(JSON.stringify(b));
        x.at = timeMs(x.at);
        return x;
      }),
      noCost: keyed(r.noCost, function (x) { return x.barcode; })
    };
  }

  function compareBills(a, b) {
    return compareSections(billsSections(a), billsSections(b));
  }

  function compareSections(A, B) {
    var out = [];
    Object.keys(A).forEach(function (sec) {
      var x = A[sec];
      var y = B[sec];
      var keys = {};
      Object.keys(x).forEach(function (k) { keys[k] = true; });
      Object.keys(y).forEach(function (k) { keys[k] = true; });
      Object.keys(keys).sort().forEach(function (k) {
        if (out.length >= MAX_DIFFS) return;
        if (!(k in y)) out.push({ path: sec + '/' + k, note: 'ไม่มีในระบบใหม่' });
        else if (!(k in x)) out.push({ path: sec + '/' + k, note: 'ไม่มีในระบบเดิม' });
        else if (JSON.stringify(x[k]) !== JSON.stringify(y[k])) out.push({ path: sec + '/' + k, note: 'ค่าต่างกัน' });
      });
    });
    return out;
  }

  // ---------- เรียก api ของ Supabase (ไม่ผ่าน LiffApp.api — คนละเซิร์ฟเวอร์)

  async function call(action, payload) {
    var idToken = '';
    try { idToken = liff.getIDToken() || ''; } catch (e) { idToken = ''; }
    var ctl = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = ctl ? setTimeout(function () { ctl.abort(); }, TIMEOUT_MS) : null;
    try {
      // text/plain = ไม่มี preflight (เหมือนคำขอไป Apps Script)
      var res = await fetch(url(), { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(Object.assign({}, payload, { action: action, idToken: idToken })), signal: ctl ? ctl.signal : undefined });
      var j = await res.json();
      return j && typeof j === 'object' ? j : { ok: false, code: 'bad_response' };
    } catch (e) {
      return { ok: false, code: 'network' };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function off() {
    var k = LiffApp.remember('shadow-off');
    return !url() || !!(k && k.data);
  }

  /** ไม่ใช่เจ้าของ / ไม่มีสิทธิ์ → ไม่เรียกอีก (ล้างได้ด้วยการออกจากระบบ) */
  function denied(r) {
    if (r && (r.code === 'not_owner' || r.code === 'no_owner')) {
      LiffApp.keep('shadow-off', true);
      LiffApp.drop('shadow-pending');
      return true;
    }
    return false;
  }

  /** รหัสของผลที่รอเทียบ (api ใช้นับการข้ามต่อผล ไม่ซ้ำ) */
  function newCid() {
    var out = '';
    while (out.length < 16) out += Math.random().toString(36).slice(2);
    return out.slice(0, 16);
  }

  function pending() {
    var k = LiffApp.remember('shadow-pending');
    var list = k && Array.isArray(k.data) ? k.data : [];
    return list.filter(function (p) { return p && Date.now() - p.gasAt < KEEP_MS; }).map(function (p) {
      if (!/^[a-z0-9]{8,40}$/.test(String(p.cid || ''))) p.cid = newCid(); // รายการจากรุ่นก่อน
      return p;
    });
  }

  /** ตั้งเวลาลองครั้งถัดไป (ตัวเดียว — เลือกเวลาที่ใกล้สุด) */
  function schedule(ms) {
    var at = Date.now() + Math.max(0, ms);
    if (timer && timerAt <= at) return;
    if (timer) clearTimeout(timer);
    timerAt = at;
    timer = setTimeout(function () { timer = null; timerAt = 0; flush(); }, Math.max(0, ms));
  }

  /** ยังมีผลรอเทียบ → ลองซ้ำที่ ~6 / ~11 นาทีหลังได้ผล (ผ่านจุดสุดท้ายแล้ว = หยุด รอเปิดหน้าครั้งหน้า) */
  function planRetry(list) {
    var now = Date.now();
    var next = 0;
    list.forEach(function (p) {
      RETRY_MS.forEach(function (d) {
        var t = p.gasAt + d;
        if (t > now && (!next || t < next)) next = t;
      });
    });
    if (next) schedule(next - now);
  }

  function after(action, args, result) {
    if (off() || !COMPARE[action] || !result) return;
    var list = pending().filter(function (p) { return !(p.action === action && JSON.stringify(p.args) === JSON.stringify(args)); });
    list.push({ action: action, args: args, gasAt: Date.now(), result: result, cid: newCid() });
    LiffApp.keep('shadow-pending', list.slice(-MAX_PENDING));
    schedule(1500); // หลังหน้าวาดเสร็จ
  }

  async function flush() {
    if (running || off()) return;
    running = true;
    var left = [];
    try {
      var list = pending();
      for (var i = 0; i < list.length; i++) {
        var p = list[i];
        var r = await call(p.action, Object.assign({}, p.args, { gasAgoMs: Math.max(0, Date.now() - p.gasAt), cid: p.cid }));
        if (denied(r)) { left = []; return; }
        if (r.ok && !r.comparable && r.skip === 'changed') continue; // ข้อมูลเปลี่ยนหลังเวลาอ่าน → ผลนี้เทียบไม่ได้อีก (api จดเหตุผลแล้ว)
        if (!r.ok || !r.comparable) { left.push(p); continue; } // ยังไม่มีรอบซิงก์ใหม่พอ / ล่ม → ลองใหม่
        var diffs = COMPARE[p.action](p.result, r[RESULT[p.action]]);
        var rep = await call('shadowReport', {
          check: { action: p.action, args: p.args, gasAgoMs: Math.max(0, Date.now() - p.gasAt), syncReadAt: r.syncReadAt, ok: !diffs.length, diffs: diffs, cid: p.cid }
        });
        if (denied(rep)) { left = []; return; }
        if (!rep.ok && rep.skip !== 'changed') left.push(p);
      }
      LiffApp.keep('shadow-pending', left);
    } catch (e) {
      /* เงียบ — ไม่กระทบหน้าจอ */
    } finally {
      running = false;
      if (left.length && !off()) planRetry(left);
    }
  }

  async function status() {
    if (off()) return null;
    var r = await call('shadowStatus', {});
    if (denied(r) || !r.ok) return null;
    return r;
  }

  COMPARE = { summaryData: compareSummary, stockData: compareStock, stockReport: compareReport, profitData: compareProfit, profitBills: compareBills };
  return { after: after, flush: flush, status: status, compareSummary: compareSummary, compareStock: compareStock, compareReport: compareReport, compareProfit: compareProfit, compareBills: compareBills, timeMs: timeMs };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Shadow;
