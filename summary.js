/*
 * summary.js — หน้า "สรุป" (รอบ 15): ยอดขายของใบกำกับภาษี + ใบเงินสด อ่านอย่างเดียว ทุกคนในแท็บผู้ใช้ดูได้
 *   เปิดจาก Rich Menu (/summary) — ไม่ผูกกับประเภทเอกสาร (shell.js ALONE: ไม่มีแถบเมนูล่าง ไม่มี ?type=)
 *   ข้อมูล: summaryData (Api.gs) ทีละปี → salesView (salesSummary.js) คำนวณตามช่วงเวลาที่เลือกบนมือถือ (สลับช่วงเวลาไม่ต้องรอเซิร์ฟเวอร์)
 *   จำไว้ในเครื่อง ('sales-<ปี>') → เปิดครั้งถัดไปเห็นตัวเลขเดิมทันที แล้วอัปเดตเบื้องหลัง
 *   ช่วงเวลา: วันนี้ / เดือนนี้ / เลือกเดือน / ทั้งปี (ย้อนหลังได้ทุกปีที่มีบิล)
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
  var KINDS = [['today', 'วันนี้'], ['month', 'เดือนนี้'], ['pick', 'เลือกเดือน'], ['year', 'ทั้งปี']];
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
      if (Shell.isCurrent(scr) && yearOf() === year) draw();
      return r;
    });
    return pending[year];
  }

  async function show() {
    if (!pick.year) { pick.year = thisYear(); pick.month = Number(today().slice(5, 7)); yearPick = thisYear(); }
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
    box.innerHTML = '<div class="seg-choice" id="sum-kinds" role="radiogroup" aria-label="ช่วงเวลา">' + KINDS.map(function (k) {
      return '<label><input type="radio" name="sum-kind" value="' + k[0] + '"' + (period.kind === k[0] ? ' checked' : '') + '>' + k[1] + '</label>';
    }).join('') + '</div>' +
      (period.kind === 'pick' ? '<div class="sum-pick"><select id="sum-month" aria-label="เดือน">' + options(months, pick.month) + '</select>' +
        '<select id="sum-year" aria-label="ปี">' + options(years, pick.year) + '</select></div>' : '') +
      (period.kind === 'year' ? '<div class="sum-pick"><select id="sum-year" aria-label="ปี">' + options(years, yearPick) + '</select></div>' : '') +
      '<div class="small muted sum-range" id="sum-range">' + esc(range.label) + (d ? ' เทียบกับ ' + esc(range.plabel) : '') + '</div>';
  }

  function periodArg() {
    if (period.kind === 'pick') return { kind: 'month', year: pick.year, month: pick.month };
    if (period.kind === 'year') return { kind: 'year', year: yearPick };
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
    var v = salesView(d, periodArg());
    var miss = [];
    if (v.missing.tax) miss.push('ใบกำกับภาษี');
    if (v.missing.cash) miss.push('ใบเงินสด');
    body.innerHTML =
      (miss.length ? '<div class="alert warn" id="sum-missing" style="margin:12px">ยังไม่รวม' + miss.join(' และ ') + ' กรุณาแจ้งผู้ดูแลระบบ</div>' : '') +
      totalCard(v) + chartCard(v) + vatCard(v) + shopsCard(v) + productsCard(v) + lostCard(v);
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

  function rankRows(list, valueOf, maxOf, extra) {
    if (!list.length) return '<li class="empty">ยังไม่มีบิลในช่วงนี้</li>';
    var max = Math.max.apply(null, list.map(maxOf)) || 1;
    return list.map(function (x, i) {
      return '<li class="sum-rank"' + (extra ? extra(x) : '') + '><span class="no">' + (i + 1) + '</span>' +
        '<div class="nm"><div class="n">' + esc(x.name) + (x.kind ? ' ' + kindBadge(x.kind) : '') + '</div>' +
        '<div class="bar" style="width:' + Math.max(2, Math.round(maxOf(x) / max * 100)) + '%"></div></div>' +
        '<div class="amt">' + valueOf(x) + '</div></li>';
    }).join('');
  }

  function kindBadge(kind) {
    return kind === 'c' ? '<span class="badge sum-kind cash">เงินสด</span>' : '<span class="badge sum-kind tax">ใบกำกับ</span>';
  }

  /** แตะร้าน → ประวัติของร้านนั้น (เปิดแอปในโหมดของร้าน: ร้านของสองไฟล์เป็นคนละรายชื่อ) */
  function historyHref(x) {
    return 'history?type=' + (x.kind === 'c' ? 'cash' : 'tax') + '&shopId=' + encodeURIComponent(x.id);
  }

  function shopsCard(v) {
    return '<section class="card" id="sum-shops"><h2>ร้านซื้อเยอะสุด <span class="count">' + v.shops.length + ' อันดับ</span></h2>' +
      '<ul class="list">' + rankRows(v.shops, function (x) {
        return '<b class="num">' + money(x.sat) + '</b><span class="small muted">' + x.n.toLocaleString('th-TH') + ' บิล</span>';
      }, function (x) { return x.sat; }, function (x) { return ' data-href="' + esc(historyHref(x)) + '" role="link" tabindex="0"'; }) + '</ul></section>';
  }

  function productsCard(v) {
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
      }, function (x) { return qty ? x.qty : x.sat; }) + '</ul></section>';
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
      view.addEventListener('click', function (e) { go(e.target); });
      view.addEventListener('keydown', function (e) { if (e.key === 'Enter') go(e.target); });
    },
    show: function () { return show(); }
  });
})();
