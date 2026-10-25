/**
 * salesSummary.js — หน้า "สรุป" (รอบ 15): ยอดขายของใบกำกับภาษี + ใบเงินสด อ่านอย่างเดียว
 *
 *   salesBuild (เซิร์ฟเวอร์ Api.gs action summaryData): แถวเอกสาร + รายการของทั้งสองไฟล์ → ข้อมูลสรุปของ 1 ปีแบบย่อ
 *     (ยอดรายวันของปีนั้นและปีก่อน / ร้านและสินค้ารายเดือน / ร้านและสินค้าของวันนี้ / ร้านที่หายไป) — cache ได้ ส่งให้มือถือทั้งก้อน
 *   salesView (มือถือ liff-site/summary.js): ข้อมูลสรุป + ช่วงเวลาที่เลือก → ตัวเลขบนจอ (สลับช่วงเวลาได้ทันที ไม่ต้องถามเซิร์ฟเวอร์)
 *
 *   ไม่นับ: บิลยกเลิก, บิลทดสอบ 0000, บิลที่วันที่อ่านไม่ได้ / สินค้าขายดีไม่นับของแถม
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
}

var SALES_VERSION = 2;        // รูปแบบข้อมูลสรุป (เปลี่ยนเมื่อรูปแบบเปลี่ยน → cache / ข้อมูลที่มือถือจำไว้รุ่นเก่าไม่ถูกใช้) — รอบ 21: + recent
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
 *   recent [[ประเภท 't'|'c', เลขที่, วันที่บิล, เวลาที่ออก (created_at), ชื่อร้าน, สตางค์, ยกเลิก 0|1]] — รอบ 21: 10 ใบล่าสุดตามเวลาที่ออก (ไม่ขึ้นกับปีที่ขอ)
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
    var inYear = {}; // เลขที่ → วันที่ (บิลของปีที่ขอ)
    (book.docs || []).forEach(function (d) {
      var no = salesDocKey(kind, d.doc_no);
      if (!no) return;
      var date = salesIso(d.doc_date);
      if (!date) return;
      var cancelled = salesText(d.status) === 'cancelled';
      recent.push([kind, kind === 'c' ? no : Number(no), date, salesText(d.created_at), salesText(d.shop_short_name) || salesText(d.shop_legal_name), toSatang(d.total), cancelled ? 1 : 0]);
      if (cancelled) return;
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
      inYear[no] = date;
      var m = Number(date.slice(5, 7));
      bump(shopMonth, m + '|' + shop, [m, shop, 0, 0], [sat, 1]);
      if (date === today) bump(shopToday, shop, [shop, 0, 0], [sat, 1]);
    });
    (book.items || []).forEach(function (it) {
      var date = inYear[salesDocKey(kind, it.doc_no)];
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
 * @param {{kind:'today'|'month'|'year', year?:number, month?:number}} period
 *   เดือน/ปีปัจจุบัน (ยังไม่จบ): ช่วงนี้ = ทั้งเดือน/ปี (บิลลงวันที่ล่วงหน้าก็นับ) เทียบกับช่วงก่อนหน้าถึงวันที่เดียวกับวันนี้
 * @returns {{from, to, pfrom, pto, label, plabel, partial}}
 */
function salesRange(period, today) {
  var t = today.split('-').map(Number);
  var r;
  if (period.kind === 'today') {
    var y1 = addDaysIso(today, -1);
    return { from: today, to: today, pfrom: y1, pto: y1, label: 'วันนี้ ' + salesDayText(today), plabel: salesDayText(y1), partial: false };
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
 * @returns {object} { range, all, cash, tax, chart, chartBy, shops, productsQty, productsAmt, lost, missing }
 *   all/cash/tax: { sat, n, psat, pn, pct, avg, pavg } (tax มี vat, net ของช่วงนี้ด้วย)
 */
function salesView(data, period) {
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
  var chartBy = period.kind === 'year' ? 'month' : period.kind === 'month' ? 'day' : '';
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
  if (period.kind === 'today') {
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
  var names = data.names || {};
  var pnames = data.pnames || {};
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
    shops: shops, productsQty: productsQty, productsAmt: productsAmt, lost: lost,
    missing: data.missing || { tax: false, cash: false }
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SALES_VERSION: SALES_VERSION,
    SALES_TOP: SALES_TOP,
    SALES_LOST_DAYS: SALES_LOST_DAYS,
    SALES_RECENT: SALES_RECENT,
    salesBuild: salesBuild,
    salesView: salesView,
    salesRange: salesRange,
    salesRangeText: salesRangeText,
    salesPct: salesPct
  };
}
