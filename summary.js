/*
 * summary.js — หน้า "สรุป" (รอบ 15): ยอดขายของใบกำกับภาษี + ใบเงินสด อ่านอย่างเดียว ทุกคนในแท็บผู้ใช้ดูได้
 *   เปิดจาก Rich Menu (/summary) — ไม่ผูกกับประเภทเอกสาร (shell.js ALONE: ไม่มีแถบเมนูล่าง ไม่มี ?type=)
 *   ข้อมูล: summaryData (Api.gs) ทีละปี → salesView (salesSummary.js) คำนวณตามช่วงเวลาที่เลือกบนมือถือ (สลับช่วงเวลาไม่ต้องรอเซิร์ฟเวอร์)
 *   จำไว้ในเครื่อง ('sales-<ปี>') → เปิดครั้งถัดไปเห็นตัวเลขเดิมทันที แล้วอัปเดตเบื้องหลัง
 *   ช่วงเวลา (รอบ 29 สองแถว): วันนี้ / เดือนนี้ / ปีนี้ — เลือกวัน / เลือกเดือน / เลือกปี (ย้อนหลังได้ทุกปีที่มีบิล)
 *     เลือกวัน: ยอดรวมจากข้อมูลของปี / ร้านและสินค้าของวันนั้นจาก salesDay (Api.gs) ทีละวัน
 *   รอบ 29: ใบเช็คยอดขายรายวัน (summary?print=YYYY-MM-DD) — A4 แนวตั้ง ขาวดำ พิมพ์ / PDF ด้วย window.print() แบบรายงานสต็อก / ในแอป LINE → เปิดเบราว์เซอร์
 *   เนื้อหา: ยอดขายรวม (แยกประเภท เทียบช่วงก่อน จำนวนบิล เฉลี่ยต่อบิล) / กราฟ / ภาษีขาย (ใบกำกับ) / ร้านซื้อเยอะสุด / สินค้าขายดี / ร้านที่ไม่ได้ซื้อนาน
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
    pending[year] = LiffApp.api('summaryData', { year: year }).then(function (r) {
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
    dayPending[date] = LiffApp.api('salesDay', { date: date }).then(function (r) {
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
    view.innerHTML = '<section class="card" id="sum-period"></section><div id="sum-body"></div>';
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
    body.innerHTML =
      (miss.length ? '<div class="alert warn" id="sum-missing" style="margin:12px">ยังไม่รวม' + miss.join(' และ ') + ' กรุณาแจ้งผู้ดูแลระบบ</div>' : '') +
      totalCard(v) + dailyCard() + chartCard(v) + vatCard(v) + shopsCard(v, v.dayPending) + productsCard(v, v.dayPending) + recentCard(d) + lowCard(); // รอบ 21: บิลที่ออกล่าสุด แทนร้านที่ไม่ได้ซื้อ
    $('sum-daily-go').addEventListener('click', printDaily);
    $('sum-daily-date').addEventListener('change', function (e) {
      $('sum-daily-date-th').textContent = e.target.value ? formatThaiDateShort(e.target.value) : 'เลือกวันที่';
    });
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

  function dailyCard() {
    return '<section class="card" id="sum-daily"><h2>ใบเช็คยอดขายรายวัน</h2>' +
      '<label class="f" for="sum-daily-date">วันที่จะพิมพ์</label>' + dateBox('sum-daily-date', dailyDefault(), 'วันที่จะพิมพ์') +
      '<button type="button" class="btn primary block" id="sum-daily-go" style="margin-top:10px">' + iconSvg('file') + '<span>พิมพ์ใบเช็คยอดขายรายวัน</span></button></section>';
  }

  function printDaily() {
    var input = $('sum-daily-date');
    var date = input && input.value && input.value <= today() ? input.value : dailyDefault();
    if (LiffApp.inClient()) {
      // ในแอป LINE พิมพ์ / บันทึก PDF มักไม่ได้ → เปิดหน้าเดียวกันในเบราว์เซอร์ (แบบรายงานสต็อก)
      if (!LiffApp.openExternal(LiffApp.appUrl('summary') + '?print=' + encodeURIComponent(date))) LiffApp.toast('เปิดเบราว์เซอร์ไม่สำเร็จ ลองอีกครั้ง', true);
      else LiffApp.toast('เปิดในเบราว์เซอร์แล้ว กดพิมพ์ที่นั่น');
      return;
    }
    Shell.go('summary', { print: date });
  }

  var DAILY_MIN_ROWS = 10;   // ตารางอย่างน้อย 10 แถว (บิลมากกว่านี้ → ตารางยาวขึ้น ขึ้นหน้าใหม่ได้ หัวตารางซ้ำ)
  // ส่วนหักค่าใช้จ่ายรายวัน: ชื่อรายการตามแบบฟอร์ม จำนวนเงินเขียนมือ
  var DAILY_COSTS = ['ค่าเชื้อเพลิง/ค่าน้ำมัน', 'ค่าแรง/ค่าจ้าง', 'ค่าขนส่ง', 'ค่าน้ำ/ค่าไฟ/อินเทอร์เน็ต', 'ค่าใช้จ่ายอื่นๆ'];

  async function showDaily(date) {
    if (!isIsoDate(date)) date = today();
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
      '<button type="button" class="btn primary" id="dsr-print">พิมพ์ / PDF</button></div>';
    $('dsr-print').addEventListener('click', function () { LiffApp.printAs('สรุปยอดขาย ' + LiffApp.fileDate(date)); });
    $('dsr-back').addEventListener('click', function () { Shell.go('summary', {}); });
    Shell.drawn(scr);
  }

  function dailySheet(r) {
    var d = r.day;
    var bills = d.bills || [];
    var rows = '';
    var n = Math.max(DAILY_MIN_ROWS, bills.length);
    for (var i = 0; i < n; i++) {
      var b = bills[i];
      rows += '<tr' + (b ? ' class="bill"' : '') + '><td class="c">' + (b ? i + 1 : '') + '</td><td>' + (b ? esc(b.shop) : '') + '</td>' +
        '<td class="nw">' + (b ? esc(b.label) : '') + '</td><td class="r num">' + (b ? money(b.sat) : '') + '</td><td></td></tr>';
    }
    var cost = '';
    DAILY_COSTS.forEach(function (c, k) { cost += '<tr><td class="c">' + (k + 1) + '</td><td>' + esc(c) + '</td><td></td></tr>'; });
    var miss = [];
    if (d.missing && d.missing.tax) miss.push('ใบกำกับภาษี');
    if (d.missing && d.missing.cash) miss.push('ใบเงินสด');
    // ลงชื่อ ..... ผู้จัดทำ / ผู้ตรวจสอบ แล้ววงเล็บใต้เส้นสำหรับเขียนชื่อ (ตามแบบฟอร์ม)
    var signer = function (role) {
      return '<div class="dsr-signer"><div class="dsr-fill">ลงชื่อ<span class="dsr-line"></span>' + role + '</div>' +
        '<div class="dsr-paren">(<span class="dsr-line"></span>)</div></div>';
    };
    return '<section class="card dsr" id="dsr">' +
      (miss.length ? '<div class="alert warn no-print" id="dsr-missing">ยังไม่รวม' + miss.join(' และ ') + ' กรุณาแจ้งผู้ดูแลระบบ</div>' : '') +
      '<div class="dsr-head">' + (r.company ? '<div class="dsr-co">' + esc(r.company) + '</div>' : '') +
      '<h2>ใบเช็คยอดขายรายวัน</h2><div class="dsr-en">DAILY SALES RECONCILIATION</div></div>' +
      '<div class="dsr-meta"><div>วันที่ <b id="dsr-date">' + esc(formatThaiDateLong(d.date)) + '</b></div>' +
      '<div class="dsr-fill">ผู้ตรวจสอบ <span class="dsr-line"></span></div></div>' +
      '<table class="dsr-table" id="dsr-table"><thead><tr><th class="w-no">ลำดับ</th><th>ชื่อร้าน</th><th class="w-bill">เลขที่บิล</th><th class="w-amt">ยอดเงิน</th><th class="w-amt">ยอดเงินที่ได้รับ</th></tr></thead>' +
      '<tbody>' + rows + '</tbody>' +
      '<tbody class="dsr-sum"><tr><td colspan="3" class="r"><b>รวมยอดขายทุกร้าน</b> (' + bills.length + ' บิล)</td><td class="r num"><b id="dsr-total">' + money(d.total) + '</b></td><td></td></tr></tbody></table>' +
      '<div class="dsr-end" id="dsr-end">' +
      '<table class="dsr-table dsr-cost" id="dsr-cost"><thead><tr><th class="w-no">ลำดับ</th><th>ส่วนหักค่าใช้จ่ายรายวัน</th><th class="w-amt">จำนวนเงิน</th></tr></thead>' +
      '<tbody>' + cost +
      '<tr><td colspan="2" class="r"><b>รวมค่าใช้จ่าย</b></td><td></td></tr>' +
      '<tr><td colspan="2" class="r"><b>ยอดเงินสุทธิ</b></td><td></td></tr></tbody></table>' +
      '<div class="dsr-sign" id="dsr-sign">' + signer('ผู้จัดทำ') + signer('ผู้ตรวจสอบ') + '</div>' +
      '<div class="dsr-note" id="dsr-note">หมายเหตุ: สามารถเขียนรายละเอียดค่าใช้จ่าย เช่น ค่าน้ำมัน ค่าแรง ค่าขนส่ง หรือค่าใช้จ่ายอื่น ๆ ในช่องชื่อร้านของรายการหักค่าใช้จ่ายได้</div>' +
      '</div><div class="small muted no-print dsr-foot">นับใบกำกับภาษี ใบเงินสด และใบเสร็จที่ไม่มีใบกำกับคู่ เรียงตามเวลาออกบิล ไม่นับใบเสร็จที่ออกคู่กับใบกำกับ บิลที่ยกเลิก และบิลทดสอบ 0000</div></section>';
  }

  function tile(kind, label, p) {
    return '<div class="sum-tile ' + kind + '" id="sum-' + kind + '"><div class="t">' + label + '</div>' +
      '<div class="v num">' + money(p.sat) + '</div>' + delta(p.pct) +
      '<div class="small muted">' + p.n.toLocaleString('th-TH') + ' บิล</div></div>';
  }

  function totalCard(v) {
    var a = v.all;
    return '<section class="card" id="sum-total"><h2>ยอดขายรวม <span class="count">บาท</span></h2>' +
      '<div class="sum-big num" id="sum-all">' + money(a.sat) + '</div>' +
      '<div class="sum-sub">' + delta(a.pct) + ' <span class="small muted">ช่วงก่อน ' + money(a.psat) + '</span></div>' +
      '<div class="sum-tiles">' + tile('cash', 'ใบเงินสด', v.cash) + tile('tax', 'ใบกำกับภาษี', v.tax) + '</div>' +
      '<div class="sum-stats"><div><span class="muted">จำนวนบิล</span><b class="num" id="sum-count">' + a.n.toLocaleString('th-TH') + '</b>' +
      '<span class="small muted">ช่วงก่อน ' + a.pn.toLocaleString('th-TH') + '</span></div>' +
      '<div><span class="muted">เฉลี่ยต่อบิล</span><b class="num" id="sum-avg">' + money(a.avg) + '</b>' +
      '<span class="small muted">ช่วงก่อน ' + money(a.pavg) + '</span></div></div></section>';
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
      '<ul class="list">' + rankRows(v.shops, function (x) {
        return '<b class="num">' + money(x.sat) + '</b><span class="small muted">' + x.n.toLocaleString('th-TH') + ' บิล</span>';
      }, function (x) { return x.sat; }, function (x) { return ' data-href="' + esc(historyHref(x)) + '" role="link" tabindex="0"'; }, pending) + '</ul></section>';
  }

  function productsCard(v, pending) {
    var qty = prodBy === 'qty';
    var list = qty ? v.productsQty : v.productsAmt;
    return '<section class="card" id="sum-products"><h2>สินค้าขายดี <span class="count">ไม่นับของแถม</span></h2>' +
      '<div class="seg-choice sum-mini" role="radiogroup" aria-label="เรียงตาม">' +
      '<label><input type="radio" name="prod-by" value="qty"' + (qty ? ' checked' : '') + '>ตามจำนวน</label>' +
      '<label><input type="radio" name="prod-by" value="amt"' + (qty ? '' : ' checked') + '>ตามยอดเงิน</label></div>' +
      '<ul class="list" id="sum-prod-list">' + rankRows(list, function (x) {
        var q = '<span class="num">' + formatQty(x.qty) + '</span> ' + esc(x.unit);
        var m = '<span class="num">' + money(x.sat) + '</span>';
        return qty ? '<b>' + q + '</b><span class="small muted">' + m + '</span>' : '<b>' + m + '</b><span class="small muted">' + q + '</span>';
      }, function (x) { return qty ? x.qty : x.sat; }, null, pending) + '</ul></section>';
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

  function go(el) {
    var row = el.closest && el.closest('[data-href]');
    if (row) location.assign(row.getAttribute('data-href'));
  }

  Shell.define('summary', {
    title: 'สรุปยอดขาย',
    build: function (s) {
      scr = s;
      s.root.innerHTML =
        '<div class="topbar"><div class="mode-pill" data-mode="all">' + iconSvg('summary') + '<span>ทุกประเภท</span></div>' +
        '<h1>สรุปยอดขาย</h1><div class="sub">ไม่นับบิลที่ยกเลิกและบิลทดสอบ</div></div>' +
        '<div id="view" aria-live="polite"></div>';
      view = $('view');
      view.addEventListener('click', function (e) { pickerOpen(e); go(e.target); });
      view.addEventListener('keydown', function (e) { if (e.key === 'Enter') go(e.target); });
    },
    show: function (s, params) { return show(params); }
  });
})();
