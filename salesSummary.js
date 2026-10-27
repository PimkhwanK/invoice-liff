/**
 * salesSummary.js — หน้า "สรุป" (รอบ 15): ยอดขายของใบกำกับภาษี + ใบเงินสด อ่านอย่างเดียว
 *
 *   salesBuild (เซิร์ฟเวอร์ Api.gs action summaryData): แถวเอกสาร + รายการของทั้งสองไฟล์ → ข้อมูลสรุปของ 1 ปีแบบย่อ
 *     (ยอดรายวันของปีนั้นและปีก่อน / ร้านและสินค้ารายเดือน / ร้านและสินค้าของวันนี้ / ร้านที่หายไป) — cache ได้ ส่งให้มือถือทั้งก้อน
 *   salesView (มือถือ liff-site/summary.js): ข้อมูลสรุป + ช่วงเวลาที่เลือก → ตัวเลขบนจอ (สลับช่วงเวลาได้ทันที ไม่ต้องถามเซิร์ฟเวอร์)
 *
 *   salesDay (เซิร์ฟเวอร์ action salesDay — รอบ 29): บิลของวันเดียว → ร้าน/สินค้าของวันนั้น + รายการบิลสำหรับใบเช็คยอดขายรายวัน
 *
 *   ไม่นับ: บิลยกเลิก, บิลทดสอบ 0000, บิลที่วันที่อ่านไม่ได้, ใบเสร็จรับเงินที่มีใบกำกับคู่ (รอบ 29 — ขายครั้งเดียวกัน นับซ้ำ) / สินค้าขายดีไม่นับของแถม
 *     ใบเสร็จที่ไม่มีใบกำกับคู่ (หรือใบกำกับคู่ถูกยกเลิก) = ยอดขาย นับปกติ
 *   ร้าน = ประเภท + รหัสร้าน ('t:5' ใบกำกับ / 'c:5' ใบเงินสด — ร้านของสองไฟล์เป็นคนละรายชื่อ) / สินค้า = บาร์โค้ด (แท็บสินค้าใช้ร่วมกัน)
 *   เงินเป็นสตางค์ (จำนวนเต็ม) ทั้งหมด / วันที่เป็น YYYY-MM-DD (ค.ศ.)
 *
 * ใช้ได้ทั้ง Node (test), เบราว์เซอร์ (liff-site/salesSummary.js) และ Apps Script (gas/salesSummary.gs) — สำเนาตรงตัวทุกไฟล์
 * ทุกชื่อระดับบนสุดขึ้นต้นด้วย sales / SALES (Apps Script ใช้ global scope ร่วมกันทุกไฟล์) / ระบบจำลองไม่ใช้ไฟล์นี้
 */

if (typeof require === 'function' && typeof module !== 'undefined') {
  var toSatang = require('./money').toSatang;
  var _salesDate = require('./thaiDate');
  var isIsoDate = _salesDate.isIsoDate, addDaysIso = _salesDate.addDaysIso, isoDayDiff = _salesDate.isoDayDiff;
  var THAI_MONTHS_SHORT = _salesDate.THAI_MONTHS_SHORT;
  var cashDocParse = require('./cashDoc').cashDocParse;
  var taxItemOwners = require('./invoice').taxItemOwners;
  var TAX_RECEIPT_TYPE = require('./invoice').TAX_RECEIPT_TYPE;
}

var SALES_VERSION = 5;        // รูปแบบข้อมูลสรุป (เปลี่ยนเมื่อรูปแบบเปลี่ยน → cache / ข้อมูลที่มือถือจำไว้รุ่นเก่าไม่ถูกใช้) — รอบ 21: + recent / รอบ 24: recent มีประเภทเอกสาร (ช่องที่ 8) / รอบ 29: ไม่นับใบเสร็จที่มีใบกำกับคู่
var SALES_RECENT = 10;        // รอบ 21: บิลที่ออกล่าสุด (ทั้งสองประเภท รวมใบที่ยกเลิก ไม่รวม 0000)
var SALES_TOP = 10;           // อันดับร้าน / สินค้า
var SALES_LOST_DAYS = 30;     // ร้านที่หายไป: ไม่ได้ซื้อเกินกี่วัน
var SALES_LOST_LOOKBACK = 365; // ดูประวัติย้อนหลังกี่วัน
var SALES_LOST_MIN_BILLS = 2; // ต้องเคยซื้ออย่างน้อยกี่บิลในช่วงนั้น (ซื้อครั้งเดียวไม่นับว่า "ซื้อประจำ")

function salesText(v) {
  return v === undefined || v === null ? '' : String(v).trim();
}

function salesIso(v) {
  var s = salesText(v).slice(0, 10);
  return isIsoDate(s) ? s : '';
}

function salesTrue(v) {
  return v === true || /^(true|1|yes|y|ใช่)$/i.test(salesText(v));
}

/** เลขที่ของบิลจริง ('t' = ใบกำกับ จำนวนเต็ม ≥ 1 / 'c' = ใบเงินสด MMYY-ลำดับ) → ข้อความ / บิลทดสอบหรืออ่านไม่ได้ → '' */
function salesDocKey(kind, v) {
  if (kind === 'c') {
    var p = cashDocParse(v);
    return p && !p.test ? p.text : '';
  }
  var s = salesText(v);
  var n = Number(s);
  return s !== '' && isFinite(n) && n >= 1 && Math.floor(n) === n ? String(n) : '';
}

/** รอบ 29: ใบเสร็จรับเงินของไฟล์ใบกำกับ */
function salesIsReceipt(kind, d) {
  return kind === 't' && salesText(d.doc_type) === TAX_RECEIPT_TYPE;
}

/**
 * รอบ 29: ใบเสร็จที่ไม่นับในยอดขาย (ลำดับแถว → true) = มีใบกำกับคู่: เลขที่เดียวกัน ร้านเดียวกัน ประเภทอื่นที่ไม่ใช่ใบเสร็จ ยังไม่ยกเลิก (ขายครั้งเดียวกัน)
 * ใบเสร็จที่ไม่มีใบคู่ / ใบคู่ถูกยกเลิก → นับเป็นยอดขาย / ใบเงินสด → ว่าง
 */
function salesPairedReceipts(kind, docs) {
  var out = {};
  if (kind !== 't') return out;
  var live = {};
  (docs || []).forEach(function (d) {
    var no = salesDocKey('t', d.doc_no);
    if (no && !salesIsReceipt('t', d) && salesText(d.status) !== 'cancelled') live[no + '|' + salesText(d.shop_id)] = true;
  });
  (docs || []).forEach(function (d, i) {
    var no = salesDocKey('t', d.doc_no);
    if (no && salesIsReceipt('t', d) && live[no + '|' + salesText(d.shop_id)]) out[i] = true;
  });
  return out;
}

function salesQty(n) {
  return Math.round(n * 1000) / 1000;
}

/**
 * ข้อมูลสรุปของ 1 ปี (เซิร์ฟเวอร์)
 * @param {object} input {
 *   tax: {docs, items} | null   แถวแท็บเอกสาร / รายการในเอกสารของไฟล์ใบกำกับ (null = อ่านไม่ได้)
 *   cash: {docs, items} | null  ของไฟล์ใบเงินสด
 *   year: ปี ค.ศ., today: 'YYYY-MM-DD'
 *   closedShops: {'t:5': true} ร้านที่ปิดใช้งาน (ไม่อยู่ในรายการร้านที่หายไป)
 * }
 * @returns {object} { v, year, today, years, days, shops, shopsToday, products, productsToday, names, pnames, lost, missing }
 *   days {'YYYY-MM-DD': [เงินสดสตางค์, เงินสดใบ, ใบกำกับสตางค์, ใบกำกับใบ, VAT สตางค์, ก่อน VAT สตางค์]} ของปีนี้และปีก่อน
 *   shops [[เดือน, ร้าน, สตางค์, ใบ]] / shopsToday [[ร้าน, สตางค์, ใบ]]
 *   products [[เดือน, บาร์โค้ด, จำนวน, สตางค์]] / productsToday [[บาร์โค้ด, จำนวน, สตางค์]]
 *   names {ร้าน: ชื่อย่อล่าสุด} / pnames {บาร์โค้ด: [ชื่อ, หน่วย]} / lost [[ร้าน, วันที่ซื้อล่าสุด, ใบ, สตางค์]]
 *   recent [[ประเภท 't'|'c', เลขที่, วันที่บิล, เวลาที่ออก (created_at), ชื่อร้าน, สตางค์, ยกเลิก 0|1, ประเภทเอกสาร (ใบกำกับ — รอบ 24)]] — รอบ 21: 10 ใบล่าสุดตามเวลาที่ออก (ไม่ขึ้นกับปีที่ขอ)
 */
function salesBuild(input) {
  var year = Number(input.year);
  var today = input.today;
  var closed = input.closedShops || {};
  var lookFrom = addDaysIso(today, -SALES_LOST_LOOKBACK);
  var years = {};
  years[Number(today.slice(0, 4))] = true;
  var days = {};
  var shopMonth = {};
  var shopToday = {};
  var prodMonth = {};
  var prodToday = {};
  var names = {};    // ร้าน → {name, date}
  var pnames = {};   // บาร์โค้ด → {name, unit, date}
  var buys = {};     // ร้าน → {last, n, sat} (ประวัติย้อนหลัง SALES_LOST_LOOKBACK วัน)
  var recent = [];   // รอบ 21: บิลจริงทุกใบ (รวมใบที่ยกเลิก) → 10 ใบล่าสุด

  function bump(map, key, init, add) {
    var r = map[key] || (map[key] = init.slice());
    for (var i = 0; i < add.length; i++) r[init.length - add.length + i] += add[i];
    return r;
  }

  [['t', input.tax], ['c', input.cash]].forEach(function (pair) {
    var kind = pair[0];
    var book = pair[1];
    if (!book) return;
    var inYear = {}; // บิล → วันที่ (บิลของปีที่ขอ) — ใบเงินสด: เลขที่ / ใบกำกับ (รอบ 24): ลำดับแถว (เลขที่ซ้ำได้ถ้าคนละประเภท)
    var owners = kind === 't' ? taxItemOwners(book.docs, book.items) : null;
    var paired = salesPairedReceipts(kind, book.docs);
    (book.docs || []).forEach(function (d, di) {
      var no = salesDocKey(kind, d.doc_no);
      if (!no) return;
      var date = salesIso(d.doc_date);
      if (!date) return;
      var cancelled = salesText(d.status) === 'cancelled';
      recent.push([kind, kind === 'c' ? no : Number(no), date, salesText(d.created_at), salesText(d.shop_short_name) || salesText(d.shop_legal_name), toSatang(d.total), cancelled ? 1 : 0, kind === 't' ? salesText(d.doc_type) : '']);
      if (cancelled || paired[di]) return; // รอบ 29: ใบเสร็จที่มีใบกำกับคู่อยู่ใน "บิลที่ออกล่าสุด" แต่ไม่นับยอด
      var y = Number(date.slice(0, 4));
      years[y] = true;
      var sat = toSatang(d.total);
      var shop = kind + ':' + (salesText(d.shop_id) === '' ? '?' : Number(d.shop_id));
      var name = salesText(d.shop_short_name) || salesText(d.shop_legal_name);
      if (name && (!names[shop] || date >= names[shop].date)) names[shop] = { name: name, date: date };
      var b = buys[shop] || (buys[shop] = { last: '', n: 0, sat: 0 });
      if (date > b.last) b.last = date;
      if (date >= lookFrom && date <= today) { b.n++; b.sat += sat; }
      if (y !== year && y !== year - 1) return;
      var day = days[date] || (days[date] = [0, 0, 0, 0, 0, 0]);
      if (kind === 'c') {
        day[0] += sat; day[1]++;
      } else {
        day[2] += sat; day[3]++; day[4] += toSatang(d.vat); day[5] += toSatang(d.net_before_vat);
      }
      if (y !== year) return;
      inYear[owners ? 'd' + di : no] = date;
      var m = Number(date.slice(5, 7));
      bump(shopMonth, m + '|' + shop, [m, shop, 0, 0], [sat, 1]);
      if (date === today) bump(shopToday, shop, [shop, 0, 0], [sat, 1]);
    });
    (book.items || []).forEach(function (it, ii) {
      var date = inYear[owners ? 'd' + owners[ii] : salesDocKey(kind, it.doc_no)];
      if (!date || salesTrue(it.is_free)) return;
      var bc = salesText(it.barcode);
      if (!bc) return;
      var name = salesText(it.name);
      if (name && (!pnames[bc] || date >= pnames[bc].date)) pnames[bc] = { name: name, unit: salesText(it.unit), date: date };
      var qty = Number(it.qty) || 0;
      var sat = toSatang(it.amount);
      var m = Number(date.slice(5, 7));
      bump(prodMonth, m + '|' + bc, [m, bc, 0, 0], [qty, sat]);
      if (date === today) bump(prodToday, bc, [bc, 0, 0], [qty, sat]);
    });
  });

  var lost = Object.keys(buys).filter(function (k) {
    var b = buys[k];
    return !closed[k] && b.n >= SALES_LOST_MIN_BILLS && b.last <= today && isoDayDiff(b.last, today) > SALES_LOST_DAYS;
  }).sort(function (a, b) {
    return buys[b].sat - buys[a].sat || (buys[a].last < buys[b].last ? -1 : 1);
  }).slice(0, SALES_TOP).map(function (k) { return [k, buys[k].last, buys[k].n, buys[k].sat]; });

  var values = function (map) { return Object.keys(map).map(function (k) { return map[k]; }); };
  var shops = values(shopMonth);
  var shopsToday = values(shopToday);
  var products = values(prodMonth).map(function (r) { return [r[0], r[1], salesQty(r[2]), r[3]]; });
  var productsToday = values(prodToday).map(function (r) { return [r[0], salesQty(r[1]), r[2]]; });
  // ชื่อเฉพาะร้าน/สินค้าที่ใช้ในข้อมูลนี้ (ข้อมูลเล็กลง)
  var nameOut = {};
  shops.concat(shopsToday).forEach(function (r) { var k = r.length === 4 ? r[1] : r[0]; if (names[k]) nameOut[k] = names[k].name; });
  lost.forEach(function (r) { if (names[r[0]]) nameOut[r[0]] = names[r[0]].name; });
  var pnameOut = {};
  Object.keys(pnames).forEach(function (k) { pnameOut[k] = [pnames[k].name, pnames[k].unit]; });

  return {
    v: SALES_VERSION,
    year: year,
    today: today,
    years: Object.keys(years).map(Number).sort(function (a, b) { return a - b; }),
    days: days,
    shops: shops,
    shopsToday: shopsToday,
    products: products,
    productsToday: productsToday,
    names: nameOut,
    pnames: pnameOut,
    lost: lost,
    recent: recent.sort(function (a, b) { return (b[3] || b[2]) < (a[3] || a[2]) ? -1 : (b[3] || b[2]) > (a[3] || a[2]) ? 1 : 0; }).slice(0, SALES_RECENT),
    missing: { tax: !input.tax, cash: !input.cash }
  };
}

// ---------- มือถือ: ช่วงเวลา → ตัวเลขบนจอ

function salesPad(n) {
  return (n < 10 ? '0' : '') + n;
}

/** วันสุดท้ายของเดือน (ปี ค.ศ., เดือน 1–12) */
function salesLastDay(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function salesMonthText(y, m) {
  return THAI_MONTHS_SHORT[m - 1] + ' ' + (y + 543);
}

function salesDayText(iso) {
  var p = iso.split('-').map(Number);
  return p[2] + ' ' + salesMonthText(p[0], p[1]);
}

/** ข้อความของช่วงวันที่ เช่น "1–21 ก.ย. 2569" / "1 ม.ค.–21 ต.ค. 2568" / "20 ต.ค. 2569" */
function salesRangeText(from, to) {
  if (from === to) return salesDayText(from);
  var a = from.split('-').map(Number);
  var b = to.split('-').map(Number);
  if (a[0] === b[0] && a[1] === 1 && a[2] === 1 && b[1] === 12 && b[2] === 31) return 'ปี ' + (a[0] + 543);
  if (a[0] === b[0] && a[1] === b[1]) {
    return a[2] === 1 && b[2] === salesLastDay(b[0], b[1]) ? salesMonthText(b[0], b[1]) : a[2] + '–' + salesDayText(to);
  }
  if (a[0] === b[0]) return a[2] + ' ' + THAI_MONTHS_SHORT[a[1] - 1] + '–' + salesDayText(to);
  return salesDayText(from) + '–' + salesDayText(to);
}

/**
 * ช่วงเวลาที่เลือก → วันที่ของช่วงนี้และช่วงก่อนหน้า
 * @param {{kind:'today'|'day'|'month'|'year', date?:string, year?:number, month?:number}} period (day = รอบ 29 เลือกวัน)
 *   เดือน/ปีปัจจุบัน (ยังไม่จบ): ช่วงนี้ = ทั้งเดือน/ปี (บิลลงวันที่ล่วงหน้าก็นับ) เทียบกับช่วงก่อนหน้าถึงวันที่เดียวกับวันนี้
 * @returns {{from, to, pfrom, pto, label, plabel, partial}}
 */
function salesRange(period, today) {
  var t = today.split('-').map(Number);
  var r;
  if (period.kind === 'today' || period.kind === 'day') {
    var day = period.kind === 'day' && isIsoDate(period.date) ? period.date : today; // รอบ 29: เลือกวัน
    var y1 = addDaysIso(day, -1);
    return { from: day, to: day, pfrom: y1, pto: y1, label: (day === today ? 'วันนี้ ' : '') + salesDayText(day), plabel: salesDayText(y1), partial: false };
  }
  if (period.kind === 'year') {
    var y = Number(period.year) || t[0];
    var cur = y === t[0];
    var pd = cur ? Math.min(t[2], salesLastDay(y - 1, t[1])) : 31;
    r = {
      from: y + '-01-01', to: y + '-12-31',
      pfrom: (y - 1) + '-01-01', pto: (y - 1) + '-' + (cur ? salesPad(t[1]) : '12') + '-' + salesPad(pd),
      label: 'ปี ' + (y + 543) + (cur ? ' (ถึงวันนี้)' : ''), partial: cur
    };
  } else {
    var yy = Number(period.year) || t[0];
    var mm = Number(period.month) || t[1];
    var py = mm === 1 ? yy - 1 : yy;
    var pm = mm === 1 ? 12 : mm - 1;
    var now = yy === t[0] && mm === t[1];
    var last = salesLastDay(py, pm);
    r = {
      from: yy + '-' + salesPad(mm) + '-01', to: yy + '-' + salesPad(mm) + '-' + salesPad(salesLastDay(yy, mm)),
      pfrom: py + '-' + salesPad(pm) + '-01', pto: py + '-' + salesPad(pm) + '-' + salesPad(now ? Math.min(t[2], last) : last),
      label: salesMonthText(yy, mm) + (now ? ' (ถึงวันนี้)' : ''), partial: now
    };
  }
  r.plabel = salesRangeText(r.pfrom, r.pto);
  return r;
}

/** % เปลี่ยนจากช่วงก่อน (ทศนิยม 1 ตำแหน่ง) / ช่วงก่อนไม่มียอด → null */
function salesPct(now, prev) {
  return prev > 0 ? Math.round((now - prev) / prev * 1000) / 10 : null;
}

function salesSumDays(days, from, to) {
  var s = [0, 0, 0, 0, 0, 0];
  Object.keys(days).forEach(function (k) {
    if (k < from || k > to) return;
    for (var i = 0; i < 6; i++) s[i] += days[k][i];
  });
  return s;
}

/**
 * ตัวเลขบนจอของช่วงเวลาที่เลือก
 * @param {object} data ผลจาก salesBuild (ปีเดียวกับช่วงเวลา — วันนี้/เดือนนี้ = ปีปัจจุบัน)
 * @param {object} [day] รอบ 29: ผลจาก salesDay ของวันที่เลือก (period {kind:"day", date})
 * @returns {object} { range, all, cash, tax, chart, chartBy, shops, productsQty, productsAmt, lost, missing }
 *   all/cash/tax: { sat, n, psat, pn, pct, avg, pavg } (tax มี vat, net ของช่วงนี้ด้วย)
 */
function salesView(data, period, day) {
  var today = data.today;
  var range = salesRange(period, today);
  var now = salesSumDays(data.days, range.from, range.to);
  var prev = salesSumDays(data.days, range.pfrom, range.pto);
  function part(sat, n, psat, pn) {
    return {
      sat: sat, n: n, psat: psat, pn: pn, pct: salesPct(sat, psat),
      avg: n ? Math.round(sat / n) : 0, pavg: pn ? Math.round(psat / pn) : 0
    };
  }
  var cash = part(now[0], now[1], prev[0], prev[1]);
  var tax = part(now[2], now[3], prev[2], prev[3]);
  tax.vat = now[4];
  tax.net = now[5];
  var all = part(now[0] + now[2], now[1] + now[3], prev[0] + prev[2], prev[1] + prev[3]);

  // กราฟ: ดูเดือน → รายวัน / ดูทั้งปี → รายเดือน / วันนี้ → ไม่มีกราฟ
  var chart = [];
  var chartBy = period.kind === 'year' ? 'month' : period.kind === 'month' ? 'day' : ''; // วันนี้ / เลือกวัน → ไม่มีกราฟ
  if (chartBy === 'day') {
    var ym = range.from.slice(0, 8);
    var lastDay = Number(range.to.slice(8, 10));
    for (var d = 1; d <= lastDay; d++) {
      var row = data.days[ym + salesPad(d)];
      chart.push({ label: String(d), cash: row ? row[0] : 0, tax: row ? row[2] : 0 });
    }
  } else if (chartBy === 'month') {
    var y = range.from.slice(0, 4);
    for (var m = 1; m <= 12; m++) {
      var s = salesSumDays(data.days, y + '-' + salesPad(m) + '-01', y + '-' + salesPad(m) + '-31');
      chart.push({ label: THAI_MONTHS_SHORT[m - 1], cash: s[0], tax: s[2] });
    }
  }

  // ร้าน / สินค้า: วันนี้ = ของวันนี้ / เดือน = เดือนนั้น / ปี = ทั้งปี
  var month = period.kind === 'month' ? Number(range.from.slice(5, 7)) : 0;
  var shopSum = {};
  var prodSum = {};
  var names = data.names || {};
  var pnames = data.pnames || {};
  // รอบ 29: เลือกวัน — วันนี้ใช้ข้อมูลสรุป / วันอื่นใช้ day (ผลจาก salesDay ของวันนั้น) / ยังไม่มี → dayPending
  var dayPending = false;
  if (period.kind === 'day' && range.from !== today) {
    if (day && day.date === range.from) {
      (day.shops || []).forEach(function (r) { shopSum[r[0]] = [r[1], r[2]]; });
      (day.products || []).forEach(function (r) { prodSum[r[0]] = [r[1], r[2]]; });
      names = Object.assign({}, names, day.names || {});
      pnames = Object.assign({}, pnames, day.pnames || {});
    } else dayPending = true;
  } else if (period.kind === 'today' || period.kind === 'day') {
    (data.shopsToday || []).forEach(function (r) { shopSum[r[0]] = [r[1], r[2]]; });
    (data.productsToday || []).forEach(function (r) { prodSum[r[0]] = [r[1], r[2]]; });
  } else {
    (data.shops || []).forEach(function (r) {
      if (month && r[0] !== month) return;
      var x = shopSum[r[1]] || (shopSum[r[1]] = [0, 0]);
      x[0] += r[2]; x[1] += r[3];
    });
    (data.products || []).forEach(function (r) {
      if (month && r[0] !== month) return;
      var x = prodSum[r[1]] || (prodSum[r[1]] = [0, 0]);
      x[0] += r[2]; x[1] += r[3];
    });
  }
  function shopOf(k) {
    var i = k.indexOf(':');
    return { key: k, kind: k.slice(0, i), id: k.slice(i + 1), name: names[k] || 'ร้านรหัส ' + k.slice(i + 1) };
  }
  var shops = Object.keys(shopSum).map(function (k) {
    var s = shopOf(k);
    s.sat = shopSum[k][0];
    s.n = shopSum[k][1];
    return s;
  }).sort(function (a, b) { return b.sat - a.sat || b.n - a.n || (a.name < b.name ? -1 : 1); }).slice(0, SALES_TOP);
  var prods = Object.keys(prodSum).map(function (k) {
    var p = pnames[k] || [k, ''];
    return { barcode: k, name: p[0], unit: p[1], qty: salesQty(prodSum[k][0]), sat: prodSum[k][1] };
  });
  var byName = function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; };
  var productsQty = prods.slice().sort(function (a, b) { return b.qty - a.qty || b.sat - a.sat || byName(a, b); }).slice(0, SALES_TOP);
  var productsAmt = prods.slice().sort(function (a, b) { return b.sat - a.sat || b.qty - a.qty || byName(a, b); }).slice(0, SALES_TOP);

  var lost = (data.lost || []).map(function (r) {
    var s = shopOf(r[0]);
    s.last = r[1];
    s.days = isoDayDiff(r[1], today);
    s.n = r[2];
    s.sat = r[3];
    return s;
  });

  return {
    range: range, all: all, cash: cash, tax: tax, chart: chart, chartBy: chartBy,
    shops: shops, productsQty: productsQty, productsAmt: productsAmt, lost: lost, dayPending: dayPending,
    missing: data.missing || { tax: false, cash: false }
  };
}

/** รอบ 29: ข้อความเลขที่ในใบเช็คยอด — "ใบกำกับ 25" / "ใบเสร็จ 25" (ไม่มีใบกำกับคู่) / "เงินสด 1069-15" */
function salesBillLabel(kind, no, receipt) {
  return (kind === 'c' ? 'เงินสด ' : receipt ? 'ใบเสร็จ ' : 'ใบกำกับ ') + no;
}

/**
 * รอบ 29: บิลของวันเดียว (เซิร์ฟเวอร์ action salesDay) — กติกาเดียวกับ salesBuild (ไม่นับยกเลิก / 0000 / ใบเสร็จที่มีใบกำกับคู่ / ของแถมในสินค้า)
 * @param {object} input { tax: {docs, items} | null, cash: {docs, items} | null, date: 'YYYY-MM-DD' }
 * @returns {object} { date, bills, total, shops, products, names, pnames, missing }
 *   bills [{ kind 't'|'c', no, label, shop, sat, at }] เรียงตามเวลาที่ออก (created_at — ไม่มี = ลำดับแถว ต่อท้าย) / total = รวมสตางค์
 *   shops [[ร้าน, สตางค์, ใบ]] / products [[บาร์โค้ด, จำนวน, สตางค์]] (รูปแบบเดียวกับ shopsToday / productsToday)
 */
function salesDay(input) {
  var date = input.date;
  var bills = [];
  var shopSum = {};
  var prodSum = {};
  var names = {};
  var pnames = {};
  var seq = 0;
  [['t', input.tax], ['c', input.cash]].forEach(function (pair) {
    var kind = pair[0];
    var book = pair[1];
    if (!book) return;
    var mine = {};
    var owners = kind === 't' ? taxItemOwners(book.docs, book.items) : null;
    var paired = salesPairedReceipts(kind, book.docs);
    (book.docs || []).forEach(function (d, di) {
      var no = salesDocKey(kind, d.doc_no);
      if (!no || salesIso(d.doc_date) !== date) return;
      if (salesText(d.status) === 'cancelled' || paired[di]) return;
      var sat = toSatang(d.total);
      var shop = kind + ':' + (salesText(d.shop_id) === '' ? '?' : Number(d.shop_id));
      var name = salesText(d.shop_short_name) || salesText(d.shop_legal_name);
      if (name) names[shop] = name;
      bills.push({ kind: kind, no: no, label: salesBillLabel(kind, no, salesIsReceipt(kind, d)), shop: salesText(d.shop_legal_name) || name, sat: sat, at: salesText(d.created_at), seq: seq++ });
      var x = shopSum[shop] || (shopSum[shop] = [shop, 0, 0]);
      x[1] += sat; x[2]++;
      mine[owners ? 'd' + di : no] = true;
    });
    (book.items || []).forEach(function (it, ii) {
      if (!mine[owners ? 'd' + owners[ii] : salesDocKey(kind, it.doc_no)] || salesTrue(it.is_free)) return;
      var bc = salesText(it.barcode);
      if (!bc) return;
      if (salesText(it.name)) pnames[bc] = [salesText(it.name), salesText(it.unit)];
      var p = prodSum[bc] || (prodSum[bc] = [bc, 0, 0]);
      p[1] += Number(it.qty) || 0;
      p[2] += toSatang(it.amount);
    });
  });
  // เวลาที่ออก (ข้อความ ISO เทียบกันได้) — บิลที่ไม่มีเวลาไว้ท้ายตามลำดับแถว
  bills.sort(function (a, b) {
    if (a.at && b.at && a.at !== b.at) return a.at < b.at ? -1 : 1;
    if (!a.at !== !b.at) return a.at ? -1 : 1;
    return a.seq - b.seq;
  });
  var total = 0;
  bills.forEach(function (b) { total += b.sat; delete b.seq; });
  var values = function (map) { return Object.keys(map).map(function (k) { return map[k]; }); };
  return {
    date: date, bills: bills, total: total,
    shops: values(shopSum),
    products: values(prodSum).map(function (r) { return [r[0], salesQty(r[1]), r[2]]; }),
    names: names, pnames: pnames,
    missing: { tax: !input.tax, cash: !input.cash }
  };
}

// ---------- รอบ 33: ลูกหนี้ (บิลเครดิต/สินเชื่อที่ยังไม่รับชำระ) — หน้าสรุป + แจ้งเตือน LINE รายวัน

var SALES_DEBT_DAYS = 3;        // ค่าเริ่มต้นของ "ใกล้ครบกำหนด" = เหลือไม่เกินกี่วัน (ตั้งได้ในหน้าจัดการข้อมูล — debt_alert_days)
var SALES_DEBT_DAYS_MAX = 60;
var SALES_DEBT_ALERT_MAX = 10;  // ข้อความ LINE แสดงไม่เกินกี่บิล (ที่เหลือ "และอีก N บิล")

/** จำนวนวันของ "ใกล้ครบกำหนด": จำนวนเต็ม 0–60 / ว่างหรือผิด → ค่าเริ่มต้น */
function salesDebtDays(v) {
  var s = salesText(v);
  var n = Number(s);
  return s !== '' && isFinite(n) && Math.floor(n) === n && n >= 0 && n <= SALES_DEBT_DAYS_MAX ? n : SALES_DEBT_DAYS;
}

/**
 * ลูกหนี้ของทั้งสองไฟล์ (เซิร์ฟเวอร์ action debtData + แจ้งเตือนรายวัน)
 *   นับ: ชนิดการขายไม่ใช่เงินสด (เครดิต / สินเชื่อ) ไม่ยกเลิก ไม่ใช่ 0000 ไม่ใช่ใบเสร็จที่มีใบกำกับคู่
 *   รับชำระแล้ว: ช่อง "วันที่รับชำระ" มีค่า / ใบกำกับที่ออกใบเสร็จคู่แล้ว (เลขที่ + ร้านเดียวกัน ใบเสร็จไม่ยกเลิก — นับอัตโนมัติ ไม่เขียนชีต)
 * @param {object} input { tax: docs[] | null, cash: docs[] | null, today: 'YYYY-MM-DD', days, cashLabel? ('เงินสด') }
 * @returns {object} { today, days, overdue, soon, later, noDue, paidToday, sums: {ส่วน: สตางค์}, missing }
 *   แต่ละบิล { kind 't'|'c', no, docType, label ("ใบกำกับ 25" / "ใบเสร็จ 25" / "เงินสด 1069-15"), shop, sat, due, left (วันที่เหลือ ติดลบ = เลยมา),
 *              docDate, paidDate, paidBy, byReceipt (ใบเสร็จที่ทำให้รับชำระแล้ว หรือ '') }
 *   overdue = เลยกำหนด / soon = เหลือ 0..days วัน / later = มากกว่านั้น / noDue = ไม่มีวันครบกำหนด / paidToday = รับชำระวันนี้
 *   เรียงตามวันครบกำหนด ใกล้สุด (เก่าสุด) ก่อน
 */
function salesDebt(input) {
  var today = input.today;
  var days = salesDebtDays(input.days);
  var cashLabel = salesText(input.cashLabel) || 'เงินสด';
  var out = { today: today, days: days, overdue: [], soon: [], later: [], noDue: [], paidToday: [], sums: {}, missing: { tax: !input.tax, cash: !input.cash } };
  [['t', input.tax], ['c', input.cash]].forEach(function (pair) {
    var kind = pair[0];
    var docs = pair[1];
    if (!docs) return;
    var paired = salesPairedReceipts(kind, docs);
    var receiptOf = {}; // 'เลขที่|ร้าน' → ใบเสร็จที่ไม่ยกเลิก (ใบกำกับคู่ = รับชำระแล้ว)
    if (kind === 't') {
      docs.forEach(function (d) {
        var no = salesDocKey('t', d.doc_no);
        if (no && salesIsReceipt('t', d) && salesText(d.status) !== 'cancelled') receiptOf[no + '|' + salesText(d.shop_id)] = d;
      });
    }
    docs.forEach(function (d, i) {
      var no = salesDocKey(kind, d.doc_no);
      if (!no || salesText(d.status) === 'cancelled' || paired[i]) return;
      var st = salesText(d.sale_type);
      if (!st || st === cashLabel) return;
      var receipt = !salesIsReceipt(kind, d) && receiptOf[no + '|' + salesText(d.shop_id)];
      var item = {
        kind: kind, no: no, docType: kind === 't' ? salesText(d.doc_type) : '', label: salesBillLabel(kind, no, salesIsReceipt(kind, d)),
        shop: salesText(d.shop_short_name) || salesText(d.shop_legal_name), sat: toSatang(d.total), due: salesIso(d.due_date), left: null,
        docDate: salesIso(d.doc_date), paidDate: salesIso(d.paid_date), paidBy: salesText(d.paid_by), byReceipt: ''
      };
      if (receipt && !item.paidDate) {
        item.byReceipt = salesBillLabel('t', no, true);
        item.paidDate = salesIso(receipt.created_at) || salesIso(receipt.doc_date);
        item.paidBy = salesText(receipt.issued_by);
      }
      if (item.paidDate || receipt) {
        if (item.paidDate === today) out.paidToday.push(item);
        return;
      }
      if (!item.due) return out.noDue.push(item);
      item.left = isoDayDiff(today, item.due);
      (item.left < 0 ? out.overdue : item.left <= days ? out.soon : out.later).push(item);
    });
  });
  var byDue = function (a, b) {
    var x = a.due || a.docDate;
    var y = b.due || b.docDate;
    return x < y ? -1 : x > y ? 1 : a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0;
  };
  ['overdue', 'soon', 'later', 'noDue', 'paidToday'].forEach(function (k) {
    out[k].sort(byDue);
    out.sums[k] = out[k].reduce(function (a, x) { return a + x.sat; }, 0);
  });
  return out;
}

/** ข้อความ "เหลือ N วัน" / "ครบกำหนดวันนี้" / "เลยมา N วัน" */
function salesDebtLeftText(left) {
  if (left === null || left === undefined || isNaN(left)) return '';
  if (left === 0) return 'ครบกำหนดวันนี้';
  return left < 0 ? 'เลยมา ' + (-left) + ' วัน' : 'เหลือ ' + left + ' วัน';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SALES_DEBT_DAYS: SALES_DEBT_DAYS,
    SALES_DEBT_ALERT_MAX: SALES_DEBT_ALERT_MAX,
    salesDebt: salesDebt,
    salesDebtDays: salesDebtDays,
    salesDebtLeftText: salesDebtLeftText,
    SALES_VERSION: SALES_VERSION,
    SALES_TOP: SALES_TOP,
    SALES_LOST_DAYS: SALES_LOST_DAYS,
    SALES_RECENT: SALES_RECENT,
    salesBuild: salesBuild,
    salesView: salesView,
    salesRange: salesRange,
    salesRangeText: salesRangeText,
    salesPct: salesPct,
    salesDay: salesDay,
    salesBillLabel: salesBillLabel,
    salesPairedReceipts: salesPairedReceipts
  };
}
