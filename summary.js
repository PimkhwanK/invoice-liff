/*
 * summary.js — หน้า "สรุป" (รอบ 15): ยอดขายของใบกำกับภาษี + ใบเงินสด อ่านอย่างเดียว ทุกคนในแท็บผู้ใช้ดูได้
 *   เปิดจาก Rich Menu (/summary) — ไม่ผูกกับประเภทเอกสาร (shell.js ALONE: ไม่มีแถบเมนูล่าง ไม่มี ?type=)
 *   ข้อมูล: summaryData (Api.gs) ทีละปี → salesView (salesSummary.js) คำนวณตามช่วงเวลาที่เลือกบนมือถือ (สลับช่วงเวลาไม่ต้องรอเซิร์ฟเวอร์)
 *   จำไว้ในเครื่อง ('sales-<ปี>') → เปิดครั้งถัดไปเห็นตัวเลขเดิมทันที แล้วอัปเดตเบื้องหลัง
 *   ช่วงเวลา (รอบ 29 สองแถว): วันนี้ / เดือนนี้ / ปีนี้ — เลือกวัน / เลือกเดือน / เลือกปี (ย้อนหลังได้ทุกปีที่มีบิล)
 *     เลือกวัน: ยอดรวมจากข้อมูลของปี / ร้านและสินค้าของวันนั้นจาก salesDay (Api.gs) ทีละวัน
 *   รอบ 29: ใบเช็คยอดขายรายวัน (summary?print=YYYY-MM-DD) — A4 แนวตั้ง ขาวดำ พิมพ์ / PDF ด้วย window.print() แบบรายงานสต็อก / ในแอป LINE → เปิดเบราว์เซอร์
 *   เนื้อหา: ยอดขายรวม (แยกประเภท เทียบช่วงก่อน จำนวนบิล เฉลี่ยต่อบิล) / กราฟ / ภาษีขาย (ใบกำกับ) / ร้านซื้อเยอะสุด / สินค้าขายดี / ร้านที่ไม่ได้ซื้อนาน
 * รอบ 34 ขั้น 3: ช่วงเวลา → ตัวเลขสำคัญ 4 ตัว (#sum-total: ยอดขาย / จำนวนบิล / เฉลี่ยต่อบิล / ลูกหนี้ค้าง) → แท็บย่อย (#sum-tabs) ภาพรวม / ร้านค้า / สินค้า / ลูกหนี้
 *   ภาพรวม = ยอดตามประเภท กราฟ ภาษีขาย บิลล่าสุด สินค้าใกล้หมด / ร้านค้า สินค้า = 5 อันดับแรก + "ดูทั้งหมด" (สูงสุด 10) / ลูกหนี้ = การ์ดลูกหนี้
 *   แท็บ: summary?tab=… (หน้าแรกแตะลูกหนี้ → tab=debt) ไม่มี = แท็บที่เลือกล่าสุด (จำในเครื่อง 'sum-tab') / ใบเช็คยอดรายวัน = ปุ่มบนหัว (#sum-daily-btn → แผ่นเลือกวัน)
 */
(function () {
  var esc = LiffApp.esc;
  var scr = null;
  var view = null;
  var data = {};        // ปี → ข้อมูลสรุป (salesBuild)
  var fetched = {};     // ปี → ดึงจากเซิร์ฟเวอร์แล้วในการเปิดครั้งนี้
  var pending = {};     // ปี → Promise ของคำขอที่กำลังรอ
  var period = { kind: 'month' };
  var pick = { year: 0, month: 0 };  // ช่วง "เลือกเดือน"
  var yearPick = 0;                  // ช่วง "ทั้งปี"
  var prodBy = 'qty';                // สินค้าขายดี: ตามจำนวน / ตามยอดเงิน
  var stockLow;                      // รอบ 16: สินค้าใกล้หมด { products } (รอบ 23: ไม่มี threshold) / null = ยังไม่ได้ตั้งค่าสต็อก / undefined = ยังไม่รู้
  var KINDS = [['today', 'วันนี้'], ['month', 'เดือนนี้'], ['thisyear', 'ปีนี้'], ['day', 'เลือกวัน'], ['pick', 'เลือกเดือน'], ['year', 'เลือกปี']]; // รอบ 29: 2 แถว แถวละ 3
  var dayPick = '';                  // รอบ 29: ช่วง "เลือกวัน"
  var days = {};                     // รอบ 29: วันที่ → คำตอบ salesDay (ร้าน/สินค้าของวันนั้น + บิลสำหรับใบเช็คยอด)
  var dayPending = {};               // วันที่ → Promise ของคำขอที่กำลังรอ
  var TABS = [['overview', 'ภาพรวม'], ['shops', 'ร้านค้า'], ['products', 'สินค้า'], ['debt', 'ลูกหนี้']]; // รอบ 34
  var tab = '';                      // แท็บที่แสดง
  var TOP_SHOW = 5;                  // ร้านค้า / สินค้า: แสดงกี่อันดับก่อนกด "ดูทั้งหมด"
  var showAll = {};                  // 'shops' / 'products' → กดดูทั้งหมดแล้ว
  var MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
  function $(id) { return scr.$(id); }

  /** วันนี้ตามเวลาไทย (ก่อนได้คำตอบจากเซิร์ฟเวอร์) */
  function deviceToday() {
    return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
  }
  function today() {
    var best = '';
    Object.keys(data).forEach(function (y) { if (data[y].today > best) best = data[y].today; });
    return best || deviceToday();
  }
  function thisYear() { return Number(today().slice(0, 4)); }

  /** ปีของข้อมูลที่ช่วงเวลานี้ต้องใช้ */
  function yearOf() {
    if (period.kind === 'pick') return pick.year;
    if (period.kind === 'year') return yearPick;
    if (period.kind === 'day') return Number(dayPick.slice(0, 4));
    return thisYear();
  }

  function money(sat) { return formatMoney(fromSatang(sat)); }

  // ---------- ข้อมูล

  var RETRIES = 3;      // ติดต่อไม่สำเร็จชั่วคราว → ลองใหม่เงียบ ๆ ก่อนบอกผู้ใช้
  var RETRY_MS = 1500;
  /**
   * action ของหน้าสรุปอยู่กับใบกำกับเสมอ (type tax) — เปิดต่อจากใบเงินสดในแอปเดียวกัน (เมนูหลัก → สรุป) LiffApp.MODE ยังเป็น cash
   * ไม่สำเร็จแบบลองใหม่ได้ (เน็ต / ระบบขัดข้อง / มีคนออกบิลอยู่) → ลองใหม่สูงสุด RETRIES ครั้ง เว้น RETRY_MS
   */
  function tapi(action, payload) {
    var tries = 0;
    function once() {
      return LiffApp.api(action, Object.assign({}, payload, { type: 'tax' })).then(function (r) {
        if (r.ok || !LiffApp.isRetryable(r) || tries >= RETRIES) return r;
        tries++;
        return new Promise(function (res) { setTimeout(res, RETRY_MS); }).then(once);
      });
    }
    return once();
  }

  /** ข้อมูลของปี: จำไว้ → ทันที (อัปเดตเบื้องหลัง) / ไม่มี → รอเซิร์ฟเวอร์ */
  function ensure(year) {
    if (!data[year]) {
      var kept = LiffApp.remember('sales-' + year);
      if (kept && kept.data && kept.data.v === SALES_VERSION && kept.data.year === year) data[year] = kept.data;
    }
    if (!fetched[year]) fetchYear(year);
    return data[year] ? Promise.resolve({ ok: true }) : pending[year];
  }

  function fetchYear(year) {
    if (pending[year]) return pending[year];
    if (data[year]) LiffApp.syncing(true, scr);
    pending[year] = tapi('summaryData', { year: year }).then(function (r) {
      delete pending[year];
      if (!Object.keys(pending).length) LiffApp.syncing(false, scr);
      if (!r.ok) {
        // มีข้อมูลที่จำไว้แสดงอยู่แล้ว → บอกสั้น ๆ (ตัวเลขเดิมยังอยู่) / ไม่มีสิทธิ์ → หน้าไม่มีสิทธิ์
        if (data[year] && !LiffApp.isAuthFail(r.code)) LiffApp.toast('อัปเดตตัวเลขไม่สำเร็จ ตัวเลขที่เห็นอาจไม่ใช่ล่าสุด', true);
        else if (data[year]) LiffApp.showApiError(r, scr);
        return r;
      }
      fetched[year] = true;
      data[year] = r.summary;
      LiffApp.keep('sales-' + year, r.summary);
      if ('stockLow' in r) { stockLow = r.stockLow; LiffApp.keep('stock-low', r.stockLow); }
      if (Shell.isCurrent(scr) && yearOf() === year) draw();
      return r;
    });
    return pending[year];
  }

  async function show(params) {
    if (!pick.year) { pick.year = thisYear(); pick.month = Number(today().slice(5, 7)); yearPick = thisYear(); dayPick = today(); }
    if (params && params.print) return showDaily(params.print);
    document.title = SUMMARY_TITLE; // กลับจากใบเช็คยอด (หน้าจอเดียวกัน shell ไม่ตั้งชื่อใหม่)
    setTab(params && params.tab, true);
    fetchDebt(); // รอบ 33: ลูกหนี้ (ทุกครั้งที่เข้าหน้า — ยอดเปลี่ยนตามวัน)
    var year = yearOf();
    if (!data[year] && !LiffApp.remember('sales-' + year)) LiffApp.loading('กำลังรวมยอดขาย…', view);
    var r = await ensure(year);
    if (!r.ok) return LiffApp.showApiError(r, scr);
    if (yearOf() === year) draw();
    Shell.drawn(scr);
  }

  /** เปลี่ยนช่วงเวลา → วาดใหม่ (ปีที่ยังไม่มีข้อมูล → รอเซิร์ฟเวอร์ ตัวเลือกช่วงเวลายังอยู่) */
  function change() {
    var year = yearOf();
    if (data[year] || LiffApp.remember('sales-' + year)) {
      ensure(year);
      return draw();
    }
    drawPeriod();
    LiffApp.loading('กำลังรวมยอดขายปี ' + (year + 543) + '…', $('sum-body'));
    ensure(year).then(function (r) {
      if (yearOf() !== year || !Shell.isCurrent(scr)) return;
      if (!r.ok) {
        if (LiffApp.isAuthFail(r.code)) return LiffApp.showApiError(r, scr);
        $('sum-body').innerHTML = '<div class="alert err" id="sum-error">' + LiffApp.errorHtml(r.error || 'โหลดยอดขายไม่สำเร็จ') + '</div>' +
          '<button type="button" class="btn block" id="sum-retry" style="margin-top:10px">ลองอีกครั้ง</button>';
        $('sum-retry').addEventListener('click', change);
        return;
      }
      draw();
    });
  }

  /** รอบ 29: ข้อมูลของวันเดียว (salesDay) — ไม่จำไว้ในเครื่อง (บิลของวันเก่าเปลี่ยนได้จากการยกเลิก) */
  function fetchDay(date) {
    if (dayPending[date]) return dayPending[date];
    dayPending[date] = tapi('salesDay', { date: date }).then(function (r) {
      delete dayPending[date];
      if (r.ok) days[date] = r;
      return r;
    });
    return dayPending[date];
  }

  /** เลือกวัน (ไม่ใช่วันนี้) → ร้าน/สินค้าของวันนั้น แล้ววาดใหม่ */
  function needDay() {
    if (period.kind !== 'day' || dayPick === today() || days[dayPick]) return;
    var date = dayPick;
    fetchDay(date).then(function (r) {
      if (!Shell.isCurrent(scr) || period.kind !== 'day' || dayPick !== date || !$('sum-body')) return;
      if (!r.ok && LiffApp.isAuthFail(r.code)) return LiffApp.showApiError(r, scr);
      if (!r.ok) return LiffApp.toast('โหลดร้านและสินค้าของวันนั้นไม่สำเร็จ ลองอีกครั้ง', true);
      drawBody();
    });
  }

  // ---------- วาด

  function draw() {
    var d = data[yearOf()];
    if (!d) return;
    drawPeriod();
    drawBody();
  }

  function yearsList() {
    var ys = {};
    Object.keys(data).forEach(function (y) { (data[y].years || []).forEach(function (x) { ys[x] = true; }); });
    ys[thisYear()] = true;
    var list = Object.keys(ys).map(Number);
    var min = Math.min.apply(null, list);
    var out = [];
    for (var y = thisYear(); y >= min; y--) out.push(y);
    return out;
  }

  function options(list, cur) {
    return list.map(function (o) {
      return '<option value="' + o[0] + '"' + (String(o[0]) === String(cur) ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
    }).join('');
  }

  /** โครงหน้า: ตัวเลือกช่วงเวลา + เนื้อหา (สร้างใหม่หลังข้อความระหว่างรอ / หน้าผิดพลาดแทนที่ไป) */
  function layout() {
    if ($('sum-period')) return;
    view.innerHTML = '<section class="card" id="sum-period"></section><section class="card sum-key" id="sum-total"></section>' +
      '<div class="seg-choice sum-tabs" id="sum-tabs" role="tablist" aria-label="หัวข้อ">' + TABS.map(function (t) {
        return '<button type="button" role="tab" data-tab="' + t[0] + '" id="sum-tab-' + t[0] + '">' + t[1] + '</button>';
      }).join('') + '</div><div id="sum-body"></div>';
    $('sum-tabs').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-tab]');
      if (b && b.dataset.tab !== tab) { setTab(b.dataset.tab); drawBody(); }
    });
    $('sum-period').addEventListener('change', onPeriod);
    $('sum-body').addEventListener('change', function (e) {
      if (e.target.name === 'prod-by') { prodBy = e.target.value; drawBody(); }
    });
  }

  function drawPeriod() {
    layout();
    var box = $('sum-period');
    var years = yearsList().map(function (y) { return [y, 'ปี ' + (y + 543)]; });
    var t = today();
    var months = MONTHS.map(function (m, i) { return [i + 1, m]; })
      .filter(function (m) { return pick.year < Number(t.slice(0, 4)) || m[0] <= Number(t.slice(5, 7)); });
    var d = data[yearOf()];
    var range = salesRange(periodArg(), t);
    box.innerHTML = '<div class="seg-choice sum-kinds" id="sum-kinds" role="radiogroup" aria-label="ช่วงเวลา">' + KINDS.map(function (k) {
      return '<label><input type="radio" name="sum-kind" value="' + k[0] + '"' + (period.kind === k[0] ? ' checked' : '') + '>' + k[1] + '</label>';
    }).join('') + '</div>' +
      (period.kind === 'pick' ? '<div class="sum-pick"><select id="sum-month" aria-label="เดือน">' + options(months, pick.month) + '</select>' +
        '<select id="sum-year" aria-label="ปี">' + options(years, pick.year) + '</select></div>' : '') +
      (period.kind === 'year' ? '<div class="sum-pick"><select id="sum-year" aria-label="ปี">' + options(years, yearPick) + '</select></div>' : '') +
      (period.kind === 'day' ? '<div class="sum-pick">' + dateBox('sum-day', dayPick, 'วันที่') + '</div>' : '') +
      '<div class="small muted sum-range" id="sum-range">' + esc(range.label) + (d ? ' เทียบกับ ' + esc(range.plabel) : '') + '</div>';
  }

  function periodArg() {
    if (period.kind === 'pick') return { kind: 'month', year: pick.year, month: pick.month };
    if (period.kind === 'year') return { kind: 'year', year: yearPick };
    if (period.kind === 'thisyear') return { kind: 'year', year: thisYear() };
    if (period.kind === 'day') return { kind: 'day', date: dayPick };
    if (period.kind === 'month') return { kind: 'month', year: thisYear(), month: Number(today().slice(5, 7)) };
    return { kind: 'today' };
  }

  function onPeriod(e) {
    var t = e.target;
    if (t.name === 'sum-kind') period.kind = t.value;
    else if (t.id === 'sum-month') pick.month = Number(t.value);
    else if (t.id === 'sum-year') {
      if (period.kind === 'pick') {
        pick.year = Number(t.value);
        if (pick.year === thisYear()) pick.month = Math.min(pick.month, Number(today().slice(5, 7)));
      } else yearPick = Number(t.value);
    } else if (t.id === 'sum-day') {
      if (!t.value || t.value > today()) return;
      dayPick = t.value;
    } else return;
    change();
  }

  /** ป้าย % เทียบช่วงก่อน */
  function delta(pct, cls) {
    if (pct === null) return '<span class="sum-delta none' + (cls ? ' ' + cls : '') + '">ช่วงก่อนไม่มียอด</span>';
    if (pct === 0) return '<span class="sum-delta same' + (cls ? ' ' + cls : '') + '">เท่าเดิม</span>';
    var up = pct > 0;
    return '<span class="sum-delta ' + (up ? 'up' : 'down') + (cls ? ' ' + cls : '') + '">' + iconSvg(up ? 'up' : 'down') +
      (up ? 'เพิ่ม ' : 'ลด ') + Math.abs(pct).toLocaleString('th-TH', { maximumFractionDigits: 1 }) + '%</span>';
  }

  function drawBody() {
    var body = $('sum-body');
    var d = data[yearOf()];
    if (!body || !d) return;
    var v = salesView(d, periodArg(), period.kind === 'day' && days[dayPick] ? days[dayPick].day : null);
    needDay();
    var miss = [];
    if (v.missing.tax) miss.push('ใบกำกับภาษี');
    if (v.missing.cash) miss.push('ใบเงินสด');
    lastView = v;
    drawKey();
    markTab();
    var miss1 = miss.length ? '<div class="alert warn" id="sum-missing" style="margin:12px">ยังไม่รวม' + miss.join(' และ ') + ' กรุณาแจ้งผู้ดูแลระบบ</div>' : '';
    body.dataset.tab = tab;
    // รอบ 34: เนื้อหาตามแท็บ (ของใกล้หมดอยู่ท้ายภาพรวม — ดูแล้วไปหน้าสต็อกต่อได้)
    body.innerHTML = tab === 'shops' ? miss1 + shopsCard(v, v.dayPending)
      : tab === 'products' ? miss1 + productsCard(v, v.dayPending)
      : tab === 'debt' ? debtCard()
      : miss1 + typesCard(v) + chartCard(v) + vatCard(v) + recentCard(d) + lowCard();
  }

  // ---------- รอบ 34: แท็บย่อย / ตัวเลข 4 ตัว

  var lastView = null; // ตัวเลขของช่วงเวลาที่แสดงอยู่ (วาดตัวเลข 4 ตัวใหม่เมื่อลูกหนี้มาถึง)

  /** เลือกแท็บ: ค่าจาก URL / ที่จำไว้ / ภาพรวม — จำในเครื่อง + ใส่ใน URL (ปุ่มย้อนกลับ / เปิดซ้ำได้แท็บเดิม) */
  function setTab(t, fromUrl) {
    var ok = function (x) { return TABS.some(function (y) { return y[0] === x; }); };
    if (!ok(t)) {
      if (fromUrl && tab) t = tab;
      else { var k = LiffApp.remember('sum-tab'); t = k && ok(k.data) ? k.data : 'overview'; }
    }
    tab = t;
    LiffApp.keep('sum-tab', t);
    Shell.setParams(scr, t === 'overview' ? {} : { tab: t });
  }

  function markTab() {
    var box = $('sum-tabs');
    if (!box) return;
    Array.prototype.forEach.call(box.querySelectorAll('button[data-tab]'), function (b) {
      var on = b.dataset.tab === tab;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
  }

  /** ตัวเลขสำคัญ 4 ตัว (เห็นโดยไม่ต้องเลื่อน) — ลูกหนี้ค้างไม่ขึ้นกับช่วงเวลา แตะ = แท็บลูกหนี้ */
  function drawKey() {
    var box = $('sum-total');
    if (!box || !lastView) return;
    var a = lastView.all;
    var dd = debt && debt.debt;
    var owe = dd ? dd.overdue.concat(dd.soon, dd.later, dd.noDue) : null;
    var oweSat = owe ? owe.reduce(function (x, y) { return x + y.sat; }, 0) : 0;
    box.innerHTML =
      '<div class="key"><span class="l">ยอดขาย (บาท)</span><b class="num" id="sum-all">' + money(a.sat) + '</b>' + delta(a.pct) +
      '<span class="small muted">ช่วงก่อน ' + money(a.psat) + '</span></div>' +
      '<div class="key"><span class="l">จำนวนบิล</span><b class="num" id="sum-count">' + a.n.toLocaleString('th-TH') + '</b>' +
      '<span class="small muted">ช่วงก่อน ' + a.pn.toLocaleString('th-TH') + '</span></div>' +
      '<div class="key"><span class="l">เฉลี่ยต่อบิล</span><b class="num" id="sum-avg">' + money(a.avg) + '</b>' +
      '<span class="small muted">ช่วงก่อน ' + money(a.pavg) + '</span></div>' +
      '<button type="button" class="key key-debt" id="sum-owe" data-tab-go="debt"><span class="l">ลูกหนี้ค้าง (บาท)</span>' +
      '<b class="num" id="sum-owe-amt">' + (owe ? money(oweSat) : '…') + '</b>' +
      '<span class="small' + (dd && dd.overdue.length ? ' late' : ' muted') + '" id="sum-owe-sub">' +
      (owe ? owe.length + ' บิล' + (dd.overdue.length ? ' · เลยกำหนด ' + dd.overdue.length : '') : 'กำลังโหลด') + '</span></button>';
  }

  /** ภาพรวม: ยอดตามประเภท (ใบเงินสด / ใบกำกับภาษี) */
  function typesCard(v) {
    return '<section class="card" id="sum-types"><h2>ยอดตามประเภท <span class="count">บาท</span></h2>' +
      '<div class="sum-tiles">' + tile('cash', 'ใบเงินสด', v.cash) + tile('tax', 'ใบกำกับภาษี', v.tax) + '</div></section>';
  }

  /** 5 อันดับแรก + ปุ่ม "ดูทั้งหมด" (ไม่เกิน 10) */
  function topOf(name, list) { return showAll[name] ? list : list.slice(0, TOP_SHOW); }
  function moreBtn(name, list) {
    if (list.length <= TOP_SHOW) return '';
    return '<button type="button" class="btn block sum-more" id="sum-more-' + name + '" data-more="' + name + '">' +
      (showAll[name] ? 'แสดงแค่ ' + TOP_SHOW + ' อันดับ' : 'ดูทั้งหมด (' + list.length + ' อันดับ)') + '</button>';
  }

  /** ช่องวันที่แบบหน้าออกบิล: วันที่ไทยในช่อง + input date โปร่งใสซ้อน */
  function dateBox(id, value, label) {
    return '<div class="date-box" id="' + id + '-box"><span class="date-text" id="' + id + '-th">' + esc(value ? formatThaiDateShort(value) : 'เลือกวันที่') + '</span>' +
      iconSvg('calendar') + '<input type="date" id="' + id + '" value="' + esc(value) + '" max="' + esc(today()) + '" aria-label="' + esc(label) + '"></div>';
  }

  function pickerOpen(e) {
    var input = e.target.closest && e.target.closest('input[type=date]');
    try { if (input && typeof input.showPicker === 'function') input.showPicker(); } catch (err) { /* ไม่เป็นไร */ }
  }

  // ---------- รอบ 29: ใบเช็คยอดขายรายวัน

  /** วันที่เริ่มต้นของใบเช็คยอด: เลือกวันอยู่ → วันนั้น / อื่น ๆ → วันนี้ (แก้ในกล่องได้) */
  function dailyDefault() { return period.kind === 'day' ? dayPick : today(); }

  /** รอบ 34: ปุ่มบนหัว → แผ่นเลือกวันที่ → พิมพ์ (เดิมเป็นการ์ดในหน้า) */
  function openDaily() {
    var sh = LiffApp.sheet('ใบเช็คยอดขายรายวัน',
      '<div id="sum-daily"><label class="f" for="sum-daily-date">วันที่จะพิมพ์</label>' + dateBox('sum-daily-date', dailyDefault(), 'วันที่จะพิมพ์') +
      // รอบ 36–37: ปุ่มส่งต่อ (ไฟล์ PDF) อยู่ในหน้าต่างนี้ — ในแอป LINE กด "พิมพ์" แล้วไปเปิดในเบราว์เซอร์ข้างนอก ไม่เคยเห็นหน้าใบเช็คยอดในแอป
      shareBtn('sum-daily-share', 'btn block') + '</div>',
      '<button type="button" class="btn grow" data-close>ยกเลิก</button><button type="button" class="btn primary grow" id="sum-daily-go">' + iconSvg('file') + '<span>พิมพ์</span></button>');
    var input = sh.el.querySelector('#sum-daily-date');
    sh.el.addEventListener('click', pickerOpen);
    var pickedDate = function () { return input.value && input.value <= today() ? input.value : dailyDefault(); };
    input.addEventListener('change', function () {
      sh.el.querySelector('#sum-daily-date-th').textContent = input.value ? formatThaiDateShort(input.value) : 'เลือกวันที่';
    });
    var share = sh.el.querySelector('#sum-daily-share');
    share.addEventListener('click', function () { shareDaily(pickedDate(), share); });
    sh.el.querySelector('#sum-daily-go').addEventListener('click', function () {
      var date = input.value && input.value <= today() ? input.value : dailyDefault();
      // ในแอป LINE พิมพ์ / บันทึก PDF มักไม่ได้ → เปิดหน้าเดียวกันในเบราว์เซอร์ (แบบรายงานสต็อก) + กล่องทางเลือกถ้าไม่เปิด (รอบ 31)
      if (LiffApp.openOutside(dailyUrl(date), sh.el.querySelector('#sum-daily'), 'กดพิมพ์')) return;
      sh.close();
      Shell.go('summary', { print: date });
    });
  }

  function dailyUrl(date) { return LiffApp.appUrl('summary') + '?print=' + encodeURIComponent(date); }

  /** รอบ 31: หน้าต่างพิมพ์ไม่ขึ้น (เบราว์เซอร์ในแอป LINE / แอปบนหน้าจอโฮม) → ทางเลือก */
  function printFailed(date) {
    LiffApp.outsideHelp(view, dailyUrl(date), 'หน้านี้เปิดหน้าต่างพิมพ์ไม่ได้ กด "เปิดในเบราว์เซอร์" หรือคัดลอกลิงก์ไปวางใน Safari แล้วกดพิมพ์ที่นั่น');
  }

  // รอบ 35: แบบฟอร์มตาม Daily_Sales_Reconciliation.pdf ที่ผู้ใช้ให้มา — ตาราง 7 คอลัมน์ อย่างน้อย 10 แถว (บิลมากกว่านี้ → ตารางยาวขึ้น หน้าถัดไปพิมพ์หัวตารางซ้ำ)
  // หลังรอบ 35: 10 แถว + ค่าใช้จ่าย 10 แถว = A4 หน้าเดียวพอดี (ความสูงแถวใน form.css --dsr-row)
  var DAILY_MIN_ROWS = 10;
  var DAILY_COST_ROWS = 10;  // หักค่าใช้จ่ายรายวัน 1–10 (เขียนมือ ไม่มีชื่อรายการสำเร็จรูป)
  var DAILY_COLS = ['ชื่อร้าน', 'เลขที่บิล', 'ยอดเงิน', 'เงินสด', 'เหรียญ', 'เครดิต', 'หมายเหตุ/เช็ค'];
  var DAILY_W = ['shop', 'bill', 'amt', 'cash', 'coin', 'credit', 'note'];

  var SUMMARY_TITLE = 'สรุปยอดขาย';
  /** ชื่อไฟล์ PDF = ชื่อหน้า — Safari บน iPad ใช้ชื่อหน้า ณ ตอนสร้าง PDF จากหน้าแชร์ (หลัง window.print() คืนค่าไปแล้ว) จึงตั้งค้างไว้ตลอดที่เปิดใบเช็คยอด */
  function dailyTitle(date) { return SUMMARY_TITLE + ' ' + LiffApp.fileDate(date); }

  async function showDaily(date) {
    if (!isIsoDate(date)) date = today();
    document.title = dailyTitle(date);
    LiffApp.loading('กำลังเตรียมใบเช็คยอดขาย…', view);
    var r = await fetchDay(date);
    if (!Shell.isCurrent(scr) || scr.params.print !== date && isIsoDate(scr.params.print)) return;
    if (!r.ok) {
      if (LiffApp.isAuthFail(r.code)) return LiffApp.showApiError(r, scr);
      view.innerHTML = '<section class="card alert err" id="dsr-error">' + LiffApp.errorHtml(r.error || 'โหลดยอดขายไม่สำเร็จ ลองอีกครั้ง') + '</section>' +
        '<div class="rep-acts"><button type="button" class="btn block" id="dsr-retry">ลองอีกครั้ง</button></div>';
      $('dsr-retry').addEventListener('click', function () { showDaily(date); });
      Shell.drawn(scr);
      return;
    }
    view.innerHTML = dailySheet(r) +
      '<div class="rep-acts no-print"><button type="button" class="btn" id="dsr-back">กลับ</button>' +
      '<button type="button" class="btn primary" id="dsr-print">พิมพ์ / PDF</button>' +
      shareBtn('dsr-share', 'btn') + '</div>'; // รอบ 36
    dailyFitAll(view);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { dailyFitAll(view); });
    $('dsr-print').addEventListener('click', function () { document.title = dailyTitle(date); LiffApp.printAs(dailyTitle(date), function () { printFailed(date); }); });
    $('dsr-share').addEventListener('click', function () { shareDaily(date, this); });
    $('dsr-back').addEventListener('click', function () { Shell.go('summary', {}); });
    Shell.drawn(scr);
  }

  /** รอบ 37: การ์ดใบเช็คยอด — ยอดรวม + จำนวนบิล + ปุ่ม "เปิด PDF" (ลิงก์ Drive แบบ PDF บิล ผู้รับเปิดได้โดยไม่ต้องเข้าสู่ระบบ) */
  function dailyCard(r) {
    var day = LiffApp.fileDate(r.date);
    return LiffApp.cardFlex({
      alt: 'ใบเช็คยอด ' + day + ' ยอดรวม ' + money(r.total) + ' บาท',
      title: 'ใบเช็คยอดขายประจำวัน',
      sub: day,
      rows: [['ยอดรวม', money(r.total) + ' บาท'], ['จำนวนบิล', r.bills + ' ใบ']],
      button: 'เปิด PDF',
      uri: r.pdfUrl
    });
  }

  function shareBtn(id, cls) {
    return '<button type="button" class="' + cls + '" id="' + id + '">' + iconSvg('send') + '<span>ส่งต่อ</span></button>';
  }

  /**
   * รอบ 37: ส่งต่อใบเช็คยอดเป็นไฟล์ PDF (ลำดับเดียวกับปุ่มส่งต่อของบิล — ไม่ใช้ push / sendMessages)
   *   สร้าง PDF ที่ Apps Script (dailySheetPdf — วันเดียวกันเขียนทับไฟล์เดิม) แล้ว
   *   แชร์ไฟล์ได้ → เมนูแชร์ของเครื่องพร้อมไฟล์ "สรุปยอดขาย D-M-พ.ศ..pdf" → ไม่ได้ → shareTargetPicker การ์ด Flex ปุ่ม "เปิด PDF" → คัดลอก
   *   สร้าง PDF ใช้เวลาหลายวินาที เบราว์เซอร์อาจไม่ยอมเปิดเมนูแชร์ (ไม่นับเป็นการแตะ) → ไฟล์จำไว้ที่ปุ่ม แตะอีกครั้งส่งทันที
   */
  async function shareDaily(date, btn) {
    var ready = btn.dailyPdf && btn.dailyPdf.r.date === date ? btn.dailyPdf : null;
    if (!ready) {
      var span = btn.querySelector('span');
      var label = span.textContent;
      btn.disabled = true;
      span.textContent = 'กำลังสร้าง PDF…';
      var r = await LiffApp.api('dailySheetPdf', { date: date, type: 'tax' });
      btn.disabled = false;
      span.textContent = label;
      if (!r.ok) {
        if (LiffApp.isAuthFail(r.code)) return LiffApp.showApiError(r, scr);
        return LiffApp.toast(r.error || 'สร้าง PDF ไม่สำเร็จ ลองอีกครั้ง', true);
      }
      ready = btn.dailyPdf = { r: r, file: r.pdfBase64 ? LiffApp.pdfFile(r.pdfBase64, r.fileName || dailyTitle(date) + '.pdf') : null };
    }
    if (ready.file && LiffApp.canShareFiles()) {
      try {
        await navigator.share({ files: [ready.file], title: ready.file.name });
        return;
      } catch (e) {
        if (e && e.name === 'AbortError') return; // ผู้ใช้ปิดเอง
        if (e && e.name === 'NotAllowedError') { LiffApp.toast('PDF พร้อมแล้ว กด "ส่งต่อ" อีกครั้ง'); return; }
      }
    }
    var card = dailyCard(ready.r);
    var picker = false;
    try { picker = typeof liff.isApiAvailable === 'function' && liff.isApiAvailable('shareTargetPicker'); } catch (e) { picker = false; }
    if (picker) {
      try {
        var res = await liff.shareTargetPicker([card], { isMultiple: true });
        if (res) LiffApp.toast('ส่งแล้ว');
        return;
      } catch (e) { /* ใช้วิธีถัดไป */ }
    }
    var NL = String.fromCharCode(10);
    var text = card.altText + NL + 'จำนวนบิล ' + ready.r.bills + ' ใบ' + NL + ready.r.pdfUrl;
    try { await navigator.clipboard.writeText(text); LiffApp.toast('คัดลอกข้อความและลิงก์ PDF แล้ว'); } catch (e) { LiffApp.toast('ส่งต่อไม่สำเร็จ ลองอีกครั้ง', true); }
  }

  /**
   * ช่องตัวหนังสือบรรทัดเดียวของใบเช็คยอด (หลังรอบ 35): ข้อความใน <span class="t"> — dailyFitAll วัดความกว้างต่อขนาดตัวอักษร 1px ใส่เป็น --k
   * แล้ว form.css ย่อตัวอักษรให้พอดีคอลัมน์ (คิดจากความกว้างตาราง cqw จึงถูกทั้งบนจอและตอนพิมพ์)
   */
  function dailyFit(col, cls, html, tag) {
    tag = tag || 'td';
    return '<' + tag + ' class="fit k-' + col + (cls ? ' ' + cls : '') + '"><span class="t">' + html + '</span></' + tag + '>';
  }

  function dailyFitAll(root) {
    var nums = [];
    var kMax = 0;
    Array.prototype.forEach.call(root.querySelectorAll('.dsr-table .fit > .t'), function (t) {
      var fs = parseFloat(getComputedStyle(t).fontSize);
      var w = t.getBoundingClientRect().width;
      if (!(fs > 0 && w > 0)) return;
      var td = t.parentNode;
      td.style.setProperty('--k', (w / fs).toFixed(3));
      // ยอดเงิน / เครดิต ในแถวบิล: ขนาดเดียวกันทุกช่อง (คิดจากตัวเลขที่ยาวที่สุด ในช่องที่แคบที่สุด 13%)
      if (td.classList.contains('num') && !td.closest('.dsr-sum')) { nums.push(td); kMax = Math.max(kMax, w / fs); }
    });
    nums.forEach(function (td) { td.classList.add('num-same'); td.style.setProperty('--k', kMax.toFixed(3)); });
  }

  /** ช่องเครดิต: บิลที่ชนิดการขายไม่ใช่เงินสด (เครดิต / สินเชื่อ) — บิลไม่ระบุชนิด (ใบเงินสดเก่า) = เงินสด */
  function dailyCredit(b) { return !!b.sale && b.sale !== CASH_DOC_SALE_TYPES[0]; }

  function dailySheet(r) {
    var d = r.day;
    var bills = d.bills || [];
    var hasSale = !bills.length || bills.some(function (b) { return 'sale' in b; }); // เซิร์ฟเวอร์ก่อนรอบ 35 ไม่ส่งชนิดการขาย
    var credit = 0;
    var rows = '';
    var n = Math.max(DAILY_MIN_ROWS, bills.length);
    for (var i = 0; i < n; i++) {
      var b = bills[i];
      var cr = b && hasSale && dailyCredit(b);
      if (cr) credit += b.sat;
      rows += '<tr' + (b ? ' class="bill"' : '') + '>' + dailyFit('shop', 'shop', '<span class="dsr-no">' + (i + 1) + '.</span>' + (b ? esc(b.shop) : '')) +
        dailyFit('bill', '', b ? esc(b.label) : '') + dailyFit('amt', 'r num', b ? money(b.sat) : '') + '<td></td><td></td>' +
        dailyFit('credit', 'r num', cr ? money(b.sat) : '') + '<td></td></tr>';
    }
    var cols = '<colgroup>' + DAILY_W.map(function (w) { return '<col class="w-' + w + '">'; }).join('') + '</colgroup>';
    var blank4 = '<td></td><td></td><td></td><td></td>';
    var cost = '';
    for (var k = 1; k <= DAILY_COST_ROWS; k++) cost += '<tr class="dsr-exp"><td colspan="3"><span class="dsr-no">' + k + '.</span></td>' + blank4 + '</tr>';
    var miss = [];
    if (d.missing && d.missing.tax) miss.push('ใบกำกับภาษี');
    if (d.missing && d.missing.cash) miss.push('ใบเงินสด');
    var p = String(d.date).split('-');
    var dateCell = function (t) { return '<span class="dsr-u">' + esc(t) + '</span>'; };
    return '<section class="card dsr' + (bills.length <= DAILY_MIN_ROWS ? ' dsr-short' : '') + '" id="dsr">' +
      (miss.length ? '<div class="alert warn no-print" id="dsr-missing">ยังไม่รวม' + miss.join(' และ ') + ' กรุณาแจ้งผู้ดูแลระบบ</div>' : '') +
      (hasSale ? '' : '<div class="alert warn no-print" id="dsr-no-credit">ช่องเครดิตยังไม่แสดง กรุณาแจ้งผู้ดูแลระบบ</div>') +
      '<div class="dsr-scroll"><div class="dsr-sheet">' +
      '<div class="dsr-head">' + (r.company ? '<div class="dsr-co" id="dsr-co">' + esc(r.company) + '</div>' : '') +
      '<h2>ใบเช็คยอดขายประจำวัน</h2></div>' +
      '<div class="dsr-meta"><div><b>วันที่:</b> <span id="dsr-date">' + dateCell(Number(p[2])) + '/' + dateCell(Number(p[1])) + '/' + dateCell(Number(p[0]) + 543) + '</span></div>' +
      '<div class="dsr-fill"><b>ผู้ตรวจสอบ:</b><span class="dsr-line"></span></div></div>' +
      '<table class="dsr-table" id="dsr-table">' + cols + '<thead><tr>' + DAILY_COLS.map(function (c, j) { return dailyFit(DAILY_W[j], '', c, 'th'); }).join('') + '</tr></thead>' +
      '<tbody>' + rows + '</tbody>' +
      '<tbody class="dsr-sum"><tr><td colspan="2" class="c fill"><b>รวมยอดขายทุกร้าน</b></td>' + dailyFit('amt', 'r num', '<b id="dsr-total">' + money(d.total) + '</b>') + '<td></td><td></td>' +
      dailyFit('credit', 'r num', '<b id="dsr-credit">' + (hasSale && credit ? money(credit) : '') + '</b>') + '<td></td></tr></tbody></table>' +
      '<div class="dsr-end" id="dsr-end">' +
      '<table class="dsr-table dsr-cost" id="dsr-cost">' + cols + '<tbody>' +
      '<tr><td colspan="3" class="c fill dsr-cost-h"><b><u>หักค่าใช้จ่ายรายวัน</u></b></td><td rowspan="2" class="fill"></td><td rowspan="2" class="fill"></td><td rowspan="2" class="fill"></td><td rowspan="2" class="fill"></td></tr>' +
      '<tr class="dsr-order"><td colspan="3"><b>ลำดับ</b></td></tr>' + cost +
      '<tr><td colspan="3" class="c fill"><b>รวมค่าใช้จ่ายรายวัน</b></td>' + blank4 + '</tr>' +
      '<tr class="dsr-net"><td colspan="3" class="c fill"><b>ยอดเงินสุทธิหลังหักค่าใช้จ่าย</b></td>' + blank4 + '</tr>' +
      '</tbody></table></div>' +
      (LiffApp.hooks.debugOn && LiffApp.hooks.debugOn() ? '<div class="dsr-ruler" id="dsr-ruler"><i></i>แถบนี้ยาว 100 มม. (วัดบน PDF — สั้นกว่า = เบราว์เซอร์ย่อหน้า)</div>' : '') +
      '</div></div>' +
      '<div class="small muted no-print dsr-foot">นับใบกำกับภาษี ใบเงินสด และใบเสร็จที่ไม่มีใบกำกับคู่ เรียงตามเวลาออกบิล ไม่นับใบเสร็จที่ออกคู่กับใบกำกับ บิลที่ยกเลิก และบิลทดสอบ 0000 / ช่องเครดิต = บิลเครดิตและสินเชื่อ</div></section>';
  }

  function tile(kind, label, p) {
    return '<div class="sum-tile ' + kind + '" id="sum-' + kind + '"><div class="t">' + label + '</div>' +
      '<div class="v num">' + money(p.sat) + '</div>' + delta(p.pct) +
      '<div class="small muted">' + p.n.toLocaleString('th-TH') + ' บิล</div></div>';
  }

  /** กราฟแท่งซ้อน (ใบเงินสดล่าง / ใบกำกับบน) — SVG วาดเอง ไม่พึ่งไลบรารี */
  function chartCard(v) {
    if (!v.chart.length) return '';
    var W = 340, H = 150, L = 34, top = 8;
    var max = 0;
    v.chart.forEach(function (c) { max = Math.max(max, c.cash + c.tax); });
    var step = niceStep(max / 3);
    var ticks = Math.max(1, Math.ceil(max / step));
    var ymax = step * ticks;
    var n = v.chart.length;
    var gap = (W - L) / n;
    var bw = Math.max(3, Math.min(18, gap * 0.62));
    var h = function (sat) { return sat / ymax * (H - top); };
    var out = '';
    for (var i = 0; i <= ticks; i++) {
      var y = H - h(step * i);
      out += '<line x1="' + L + '" x2="' + W + '" y1="' + y + '" y2="' + y + '" class="grid"/>' +
        '<text x="' + (L - 4) + '" y="' + (y + 3) + '" text-anchor="end" class="ax">' + short(step * i) + '</text>';
    }
    v.chart.forEach(function (c, k) {
      var x = L + k * gap + (gap - bw) / 2;
      var hc = h(c.cash);
      var ht = h(c.tax);
      if (hc > 0) out += '<rect x="' + x.toFixed(1) + '" y="' + (H - hc).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + hc.toFixed(1) + '" class="bar-cash"/>';
      if (ht > 0) out += '<rect x="' + x.toFixed(1) + '" y="' + (H - hc - ht).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + ht.toFixed(1) + '" class="bar-tax"/>';
      var label = v.chartBy === 'month' ? (k % 2 === 0 ? c.label : '') : ([1, 8, 15, 22, 29].indexOf(k + 1) >= 0 ? c.label : '');
      if (label) out += '<text x="' + (L + k * gap + gap / 2).toFixed(1) + '" y="' + (H + 14) + '" text-anchor="middle" class="ax">' + esc(label) + '</text>';
    });
    var title = v.chartBy === 'month' ? 'ยอดขายรายเดือน' : 'ยอดขายรายวัน';
    return '<section class="card" id="sum-chart"><h2>' + title + '</h2>' +
      '<svg class="sum-graph" viewBox="0 0 ' + W + ' ' + (H + 20) + '" role="img" aria-label="' + title + '">' + out + '</svg>' +
      '<div class="sum-legend"><span><i class="cash"></i>ใบเงินสด</span><span><i class="tax"></i>ใบกำกับภาษี</span></div></section>';
  }

  /** ช่วงห่างของเส้นแกน: 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8 × 10^n บาท (สตางค์) — ไม่ต่ำกว่าที่ขอ */
  function niceStep(sat) {
    var baht = Math.max(1, sat / 100);
    var p = Math.pow(10, Math.floor(Math.log10(baht)));
    var m = baht / p;
    var nice = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].filter(function (x) { return x >= m - 1e-9; })[0];
    return nice * p * 100;
  }

  /** ตัวเลขย่อบนแกน: 1,500 → 1.5 พัน / 2,000,000 → 2 ล้าน */
  function short(sat) {
    var b = sat / 100;
    if (b >= 1000000) return trim(b / 1000000) + ' ล้าน';
    if (b >= 1000) return trim(b / 1000) + ' พัน';
    return trim(b);
  }
  function trim(x) { return String(Math.round(x * 10) / 10); }

  /** ข้อ ข: ภาษีขายของใบกำกับในช่วงนี้ (ใบเงินสดไม่มี VAT) */
  function vatCard(v) {
    var t = v.tax;
    return '<section class="card" id="sum-vat"><h2>ภาษีขาย <span class="count">เฉพาะใบกำกับภาษี</span></h2>' +
      '<div class="sum-rows"><div><span>ยอดรวมภาษี</span><b class="num">' + money(t.sat) + '</b></div>' +
      '<div><span>มูลค่าก่อนภาษี</span><b class="num">' + money(t.net) + '</b></div>' +
      '<div><span>ภาษีมูลค่าเพิ่ม</span><b class="num" id="sum-vat-amt">' + money(t.vat) + '</b></div></div>' +
      '<div class="hint" id="sum-vat-note">ตัวเลขประมาณการ ยื่นภาษีให้ใช้ตัวเลขจากนักบัญชี</div></section>';
  }

  function rankRows(list, valueOf, maxOf, extra, pending) {
    if (!list.length) return '<li class="empty">' + (pending ? 'กำลังโหลด…' : 'ยังไม่มีบิลในช่วงนี้') + '</li>';
    var max = Math.max.apply(null, list.map(maxOf)) || 1;
    return list.map(function (x, i) {
      return '<li class="sum-rank"' + (extra ? extra(x) : '') + '><span class="no">' + (i + 1) + '</span>' +
        '<div class="nm"><div class="n">' + esc(x.name) + (x.kind ? ' ' + kindBadge(x.kind) : '') + '</div>' +
        '<div class="bar" style="width:' + Math.max(2, Math.round(maxOf(x) / max * 100)) + '%"></div></div>' +
        '<div class="amt">' + valueOf(x) + '</div></li>';
    }).join('');
  }

  function kindBadge(kind) {
    return kind === 'c' ? '<span class="badge sum-kind cash">ใบเงินสด</span>' : '<span class="badge sum-kind tax">ใบกำกับ</span>';
  }

  /** แตะร้าน → ประวัติของร้านนั้น (เปิดแอปในโหมดของร้าน: ร้านของสองไฟล์เป็นคนละรายชื่อ) */
  function historyHref(x) {
    return 'history?type=' + (x.kind === 'c' ? 'cash' : 'tax') + '&shopId=' + encodeURIComponent(x.id);
  }

  function shopsCard(v, pending) {
    return '<section class="card" id="sum-shops"><h2>ร้านซื้อเยอะสุด <span class="count">' + v.shops.length + ' อันดับ</span></h2>' +
      '<ul class="list">' + rankRows(topOf('shops', v.shops), function (x) {
        return '<b class="num">' + money(x.sat) + '</b><span class="small muted">' + x.n.toLocaleString('th-TH') + ' บิล</span>';
      }, function (x) { return x.sat; }, function (x) { return ' data-href="' + esc(historyHref(x)) + '" role="link" tabindex="0"'; }, pending) + '</ul>' + moreBtn('shops', v.shops) + '</section>';
  }

  function productsCard(v, pending) {
    var qty = prodBy === 'qty';
    var list = qty ? v.productsQty : v.productsAmt;
    return '<section class="card" id="sum-products"><h2>สินค้าขายดี <span class="count">ไม่นับของแถม</span></h2>' +
      '<div class="seg-choice sum-mini" role="radiogroup" aria-label="เรียงตาม">' +
      '<label><input type="radio" name="prod-by" value="qty"' + (qty ? ' checked' : '') + '>ตามจำนวน</label>' +
      '<label><input type="radio" name="prod-by" value="amt"' + (qty ? '' : ' checked') + '>ตามยอดเงิน</label></div>' +
      '<ul class="list" id="sum-prod-list">' + rankRows(topOf('products', list), function (x) {
        var q = '<span class="num">' + formatQty(x.qty) + '</span> ' + esc(x.unit);
        var m = '<span class="num">' + money(x.sat) + '</span>';
        return qty ? '<b>' + q + '</b><span class="small muted">' + m + '</span>' : '<b>' + m + '</b><span class="small muted">' + q + '</span>';
      }, function (x) { return qty ? x.qty : x.sat; }, null, pending) + '</ul>' + moreBtn('products', list) + '</section>';
  }

/**
   * รอบ 21: บิลที่ออกล่าสุด 10 ใบ ทั้งสองประเภท (รวมใบที่ยกเลิก ไม่รวม 0000) แตะ → ดู PDF (view?type=…&no=…) — ไม่ขึ้นกับช่วงเวลาที่เลือก
   * (แทน "ร้านที่ไม่ได้ซื้อเกิน 30 วัน" — lostCard ยังอยู่ ไม่ได้ใช้)
   */
  function recentCard(d) {
    var list = Array.isArray(d.recent) ? d.recent : [];
    var today = d.today;
    return '<section class="card" id="sum-recent"><h2>บิลที่ออกล่าสุด <span class="count">' + SALES_RECENT + ' ใบล่าสุด · ทั้ง 2 ประเภท</span></h2>' +
      '<ul class="list">' + (list.length ? list.map(function (r) {
        var kind = r[0], no = r[1], date = r[2], at = String(r[3] || ''), cancelled = !!r[6];
        var when = (date === today ? 'วันนี้' : formatThaiDateShort(date)) + (at.length > 15 && date === today ? ' ' + at.slice(11, 16) : '');
        var href = 'view?type=' + (kind === 'c' ? 'cash' : 'tax') + '&no=' + encodeURIComponent(String(no)) +
          (kind === 't' && r[7] === TAX_RECEIPT_TYPE ? '&dt=rc' : kind === 't' && r[7] && r[7] !== DEFAULT_DOC_TYPES[0] ? '&dt=' + encodeURIComponent(r[7]) : ''); // รอบ 24
        return '<li class="sum-lost tap recent" data-href="' + esc(href) + '" role="link" tabindex="0"><div class="nm"><div class="n">' +
          (kind === 'c' ? '' : '#') + esc(no) + (kind === 't' && r[7] === TAX_RECEIPT_TYPE ? ' ' + esc(TAX_RECEIPT_TYPE) : '') + ' · ' + esc(r[4] || '-') + ' ' + kindBadge(kind) + (cancelled ? ' <span class="badge red">ยกเลิก</span>' : '') + '</div>' +
          '<div class="small muted">' + esc(when) + ' · แตะเพื่อดู PDF</div></div>' +
          '<div class="amt"><b class="num">' + money(r[5]) + '</b></div></li>';
      }).join('') : '<li class="empty">ยังไม่มีบิล</li>') + '</ul></section>';
  }

  /** ข้อ ค: ร้านที่เคยซื้อประจำแต่ไม่ได้ซื้อเกิน 30 วัน (ไม่ขึ้นกับช่วงเวลาที่เลือก) */
  function lostCard(v) {
    return '<section class="card" id="sum-lost"><h2>ร้านที่ไม่ได้ซื้อเกิน ' + SALES_LOST_DAYS + ' วัน</h2>' +
      '<div class="hint" style="margin-bottom:6px">ร้านที่ซื้อ 2 บิลขึ้นไปใน 1 ปีล่าสุด เรียงตามยอดซื้อ</div>' +
      '<ul class="list">' + (v.lost.length ? v.lost.map(function (x) {
        return '<li class="sum-lost tap" data-href="' + esc(historyHref(x)) + '" role="link" tabindex="0"><div class="nm"><div class="n">' + esc(x.name) + ' ' + kindBadge(x.kind) + '</div>' +
          '<div class="small muted">ซื้อล่าสุด ' + esc(formatThaiDateShort(x.last)) + ' (' + x.days + ' วันก่อน)</div></div>' +
          '<div class="amt"><b class="num">' + money(x.sat) + '</b><span class="small muted">' + x.n + ' บิล</span></div></li>';
      }).join('') : '<li class="empty">ไม่มีร้านที่หายไป</li>') + '</ul></section>';
  }

  /** รอบ 16: สินค้าใกล้หมด / ติดลบ (ยอดตอนนี้ ไม่ขึ้นกับช่วงเวลา) — ยังไม่ได้ตั้งค่าสต็อก → ไม่แสดง */
  function lowCard() {
    if (stockLow === undefined) {
      var kept = LiffApp.remember('stock-low');
      stockLow = kept ? kept.data : undefined;
    }
    if (!stockLow || !Array.isArray(stockLow.products)) return '';
    var list = stockLow.products;
    return '<section class="card" id="sum-low"><h2>สินค้าใกล้หมด <span class="count">ตามที่ตั้งแต่ละสินค้า</span></h2>' +
      '<ul class="list">' + (list.length ? list.slice(0, 10).map(function (p) {
        return '<li class="st-row"><div class="nm"><div class="n">' + esc(p.name) + '</div></div>' +
          '<div class="q ' + esc(p.level) + '"><b class="num">' + esc(formatQty(p.qty)) + '</b> ' + esc(p.unit) + '</div></li>';
      }).join('') : '<li class="empty">ไม่มีสินค้าใกล้หมด</li>') + '</ul>' +
      '<a class="btn block" id="sum-to-stock" href="stock?tab=low" style="margin-top:8px">ไปหน้าสต็อก</a></section>'; // รอบ 21: แท็บของใกล้หมด
  }

  // ---------- รอบ 33: ลูกหนี้ใกล้ครบกำหนดชำระ (debtData — ไม่ขึ้นกับช่วงเวลา อ่านใหม่ทุกครั้งที่เปิดหน้า)

  var debt = null;       // คำตอบ debtData ล่าสุด { debt, ready, settings } / null = ยังไม่ได้
  var debtErr = null;    // โหลดไม่สำเร็จ (ข้อความ)
  var debtPending = null;

  function fetchDebt() {
    if (debtPending) return debtPending;
    debtPending = tapi('debtData', {}).then(function (r) {
      debtPending = null;
      if (r.ok) { debt = r; debtErr = null; }
      else if (LiffApp.isAuthFail(r.code)) return r;
      else debtErr = r.error || 'โหลดลูกหนี้ไม่สำเร็จ';
      drawDebt();
      return r;
    });
    return debtPending;
  }

  /** วาดการ์ดลูกหนี้ใหม่ที่เดิม (ไม่วาดทั้งหน้า) */
  function drawDebt() {
    var box = $('sum-debt');
    if (box) box.outerHTML = debtCard();
    drawKey(); // รอบ 34: ลูกหนี้ค้างในตัวเลข 4 ตัว
  }

  function debtRow(x, part) {
    var cls = part === 'overdue' ? ' late' : part === 'soon' ? ' near' : '';
    var when = part === 'paidToday'
      ? (x.byReceipt ? 'ออก' + esc(x.byReceipt) + ' แล้ว' : 'รับชำระแล้ว' + (x.paidBy ? ' โดย ' + esc(x.paidBy) : ''))
      : x.due ? 'ครบกำหนด ' + esc(formatThaiDateShort(x.due)) + ' · <b class="left' + cls + '">' + esc(salesDebtLeftText(x.left)) + '</b>'
        : 'บิลวันที่ ' + esc(formatThaiDateShort(x.docDate));
    var ready = debt && debt.ready && debt.ready[x.kind === 'c' ? 'cash' : 'tax'];
    var btn = part === 'paidToday'
      ? (x.byReceipt ? '' : '<button type="button" class="btn sm" data-debt="undo">ย้อนกลับ</button>')
      : '<button type="button" class="btn sm' + (ready ? ' primary' : '') + '" data-debt="pay"' + (ready ? '' : ' disabled') + '>รับชำระแล้ว</button>';
    return '<li class="debt-row" data-book="' + x.kind + '" data-no="' + esc(x.no) + '" data-dt="' + esc(x.docType) + '">' +
      '<div class="nm"><div class="n">' + esc(x.shop || '-') + '</div>' +
      '<div class="small">' + esc(x.label) + '</div>' + // ป้ายบอกประเภทอยู่ในเลขที่แล้ว (ใบกำกับ / ใบเสร็จ / เงินสด)
      '<div class="small muted">' + when + '</div></div>' +
      '<div class="amt"><b class="num">' + money(x.sat) + '</b>' + btn + '</div></li>';
  }

  function debtPart(id, title, list, part, sum, empty) {
    if (!list.length && !empty) return '';
    return '<div class="debt-part" id="' + id + '"><h3>' + title + ' <span class="count">' + list.length + ' บิล' + (list.length ? ' · ' + money(sum) + ' บาท' : '') + '</span></h3>' +
      '<ul class="list">' + (list.length ? list.map(function (x) { return debtRow(x, part); }).join('') : '<li class="empty">' + empty + '</li>') + '</ul></div>';
  }

  function debtCard() {
    var head = '<section class="card" id="sum-debt"><h2>ลูกหนี้ใกล้ครบกำหนดชำระ <span class="count">บิลเครดิต / สินเชื่อ</span></h2>';
    if (!debt) {
      if (!debtErr) return head + '<div class="small muted">กำลังโหลด…</div></section>';
      return head + '<div class="alert err" id="debt-error">' + LiffApp.errorHtml(debtErr) + '</div>' +
        '<button type="button" class="btn block" id="debt-retry" style="margin-top:10px">ลองอีกครั้ง</button></section>';
    }
    var d = debt.debt;
    var s = d.sums || {};
    var notReady = debt.ready && (!debt.ready.tax || (!d.missing.cash && !debt.ready.cash));
    return head +
      (notReady ? '<div class="alert warn small" id="debt-not-ready">ยังกด "รับชำระแล้ว" ไม่ได้ กรุณาแจ้งผู้ดูแลระบบ</div>' : '') +
      debtPart('debt-overdue', 'เลยกำหนด', d.overdue, 'overdue', s.overdue, 'ไม่มีบิลเลยกำหนด') +
      debtPart('debt-soon', 'ใกล้ครบกำหนด (ภายใน ' + d.days + ' วัน)', d.soon, 'soon', s.soon, 'ไม่มีบิลใกล้ครบกำหนด') +
      debtPart('debt-nodue', 'ไม่มีวันครบกำหนด', d.noDue, 'noDue', s.noDue, '') +
      debtPart('debt-paid', 'รับชำระแล้ววันนี้', d.paidToday, 'paidToday', s.paidToday, '') +
      (d.later.length ? '<details class="debt-later" id="debt-later"><summary>ยังไม่ถึงกำหนดอีก ' + d.later.length + ' บิล · ' + money(s.later) + ' บาท</summary>' +
        '<ul class="list">' + d.later.map(function (x) { return debtRow(x, 'later'); }).join('') + '</ul></details>' : '') +
      '</section>';
  }

  /** ปุ่ม "รับชำระแล้ว" / "ย้อนกลับ" → ยืนยันในแผ่น → debtPay → วาดการ์ดจากคำตอบ */
  function debtAsk(btn) {
    var li = btn.closest('li.debt-row');
    var all = debt ? [].concat(debt.debt.overdue, debt.debt.soon, debt.debt.later, debt.debt.noDue, debt.debt.paidToday) : [];
    var x = all.filter(function (y) { return y.kind === li.dataset.book && String(y.no) === li.dataset.no && y.docType === li.dataset.dt; })[0];
    if (!x) return;
    var pay = btn.dataset.debt === 'pay';
    var sh = LiffApp.sheet(pay ? 'บันทึกรับชำระ' : 'ย้อนกลับการรับชำระ',
      '<div class="debt-confirm"><div class="n">' + esc(x.shop || '-') + '</div><div>' + esc(x.label) + '</div>' +
      '<div class="num" style="font-size:20px;font-weight:700">' + money(x.sat) + ' บาท</div>' +
      '<div class="small muted">' + (pay ? 'บันทึกว่ารับเงินบิลนี้ครบแล้ววันนี้' : 'บิลนี้จะกลับไปอยู่ในรายการลูกหนี้') + '</div></div><div id="debt-msg"></div>',
      '<button type="button" class="btn grow" data-close>ยกเลิก</button><button type="button" class="btn primary grow" id="debt-ok">' + (pay ? 'ยืนยันรับชำระ' : 'ยืนยันย้อนกลับ') + '</button>');
    var ok = sh.el.querySelector('#debt-ok');
    ok.addEventListener('click', function () {
      ok.disabled = true;
      ok.textContent = 'กำลังบันทึก…';
      tapi('debtPay', { book: x.kind, docNo: x.no, docType: x.docType, paid: pay }).then(function (r) {
        if (!r.ok) {
          if (LiffApp.isAuthFail(r.code)) { sh.close(); return LiffApp.showApiError(r, scr); }
          ok.disabled = false;
          ok.textContent = 'ลองอีกครั้ง';
          sh.el.querySelector('#debt-msg').innerHTML = '<div class="alert err" id="debt-pay-error" style="margin-top:10px">' + LiffApp.errorHtml(r.error || 'บันทึกไม่สำเร็จ') + '</div>';
          return;
        }
        sh.close();
        debt = r;
        drawDebt();
        LiffApp.toast(pay ? 'บันทึกรับชำระ ' + x.label + ' แล้ว' : 'ย้อนกลับ ' + x.label + ' แล้ว');
      });
    });
  }

  function go(el) {
    var more = el.closest && el.closest('[data-more]');
    if (more) { showAll[more.dataset.more] = !showAll[more.dataset.more]; return drawBody(); }
    var tg = el.closest && el.closest('[data-tab-go]');
    if (tg) { setTab(tg.dataset.tabGo); drawBody(); var t = $('sum-tabs'); if (t) t.scrollIntoView({ block: 'start' }); return; }
    var b = el.closest && el.closest('[data-debt]');
    if (b) return debtAsk(b);
    if (el.closest && el.closest('#debt-retry')) { debtErr = null; drawDebt(); return fetchDebt(); }
    var row = el.closest && el.closest('[data-href]');
    if (row) location.assign(row.getAttribute('data-href'));
  }

  Shell.define('summary', {
    title: SUMMARY_TITLE,
    build: function (s) {
      scr = s;
      s.root.innerHTML =
        '<div class="topbar"><div class="mode-pill" data-mode="all">' + iconSvg('summary') + '<span>ทุกประเภท</span></div>' +
        '<div class="sum-head"><div><h1>สรุปยอดขาย</h1><div class="sub">ไม่นับบิลที่ยกเลิกและบิลทดสอบ</div></div>' +
        '<button type="button" class="btn sum-daily-btn" id="sum-daily-btn">' + iconSvg('file') + '<span>ใบเช็คยอดรายวัน</span></button></div></div>' +
        '<div id="view" aria-live="polite"></div>';
      view = $('view');
      $('sum-daily-btn').addEventListener('click', openDaily);
      view.addEventListener('click', function (e) { pickerOpen(e); go(e.target); });
      view.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.target.closest('button')) go(e.target); }); // ปุ่มกด Enter = click อยู่แล้ว
    },
    show: function (s, params) { return show(params); }
  });
})();
