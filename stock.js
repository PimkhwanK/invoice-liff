/*
 * stock.js — หน้า "สต็อก" (รอบ 16) เปิดจาก Rich Menu (/stock) ไม่ผูกกับประเภทเอกสาร (shell.js ALONE) ทุกคนในแท็บผู้ใช้ใช้ได้
 *   รายการสินค้า + คงเหลือ (ค้นหาได้) — ติดลบ / ใกล้หมด อยู่บนสุด / สินค้าที่ยังไม่นับอยู่ท้าย (ยังไม่ตัดอัตโนมัติ)
 *   ปุ่มล่าง: ของเข้า / ของออก (ไม่มีบิล) / แก้ยอดตามที่นับ (ทีละหลายสินค้า — รอบ 18 เปลี่ยนชื่อจาก รับเข้า / หักออก / นับสต็อก) → stockMove / แตะสินค้า → stock?barcode= ความเคลื่อนไหวย้อนหลัง (stockHistory)
 *   เรียง (รอบ 19): คงเหลือมาก→น้อย / น้อย→มาก / ชื่อ ก-ฮ ใช้กับรายการ "สินค้า" (ต้องดูอยู่บนสุดเสมอ) จำไว้ในเครื่อง (stock-sort)
 *   ข้อมูล: stockData (StockApi.gs) จำไว้ในเครื่อง ('stock') → เปิดครั้งถัดไปเห็นทันที แล้วอัปเดตเบื้องหลัง
 *   รอบ 22–23: แตะสินค้า → หน้าสินค้า แก้ "เตือนเมื่อเหลือ" ของสินค้านั้นได้ (setStockAlert — ว่าง = ไม่เตือน / 0 = เตือนเมื่อหมด / ไม่มีค่ากลางแล้ว)
 *   รอบ 21: แท็บ "สินค้าทั้งหมด" | "ของใกล้หมด" (stock?tab=low — ≤ "เตือนเมื่อเหลือ" ของสินค้า หรือติดลบ เรียงน้อยสุดก่อน)
 *     เตือนในหน้าเว็บเท่านั้น ไม่ส่งข้อความ LINE
 *   กติกา (ตรวจซ้ำที่เซิร์ฟเวอร์): stockCore.js stockPlanManual — หน้าเว็บใช้ตัวเดียวกันแสดงยอดใหม่ระหว่างพิมพ์
 */
(function () {
  var esc = LiffApp.esc;
  // หน้าที่ไม่ผูกกับประเภทเอกสาร: action ของสต็อกอยู่กับใบกำกับเสมอ (เปิดต่อจากใบเงินสดในแอปเดียวกัน LiffApp.MODE ยังเป็น cash)
  function tapi(action, payload) { return LiffApp.api(action, Object.assign({}, payload, { type: 'tax' })); }
  var scr = null;
  var view = null;
  var acts = null;
  var data = null;      // คำตอบ stockData { ready, pending, products, message }
  var fetched = false;  // ดึงจากเซิร์ฟเวอร์แล้วในการเปิดครั้งนี้
  var term = '';
  var KIND = {
    in: { title: 'ของเข้า', desc: 'มีของมาส่งเพิ่ม', note: 'หมายเหตุ (ไม่บังคับ)', hint: 'เช่น รับจากโรงงาน รอบเช้า', qty: 'จำนวนที่รับเข้า' },
    out: { title: 'ของออก (ไม่มีบิล)', desc: 'ขายนอกบิล ของเสีย แจก', note: 'หมายเหตุ (ต้องใส่)', hint: 'เช่น ขายหน้าร้าน แจกตัวอย่าง', qty: 'จำนวนที่หักออก' },
    count: { title: 'แก้ยอดตามที่นับ', desc: 'ใส่จำนวนที่นับได้จริง (ครั้งแรก = ยอดเริ่มต้น)', note: 'เหตุผล (ใส่เมื่อยอดไม่ตรง)', hint: 'เช่น แตกเสียหาย นับใหม่', qty: 'ยอดที่นับได้' }
  };
  var LEVEL = { neg: '<span class="badge red">ติดลบ</span>', low: '<span class="badge amber">ใกล้หมด</span>' };
  // การเรียงรายการ "สินค้า" (กลุ่ม "ต้องดู" อยู่บนสุดเสมอ ไม่เรียงตามนี้) จำไว้ในเครื่อง ('stock-sort')
  var SORTS = { desc: 'คงเหลือ มากสุด → น้อยสุด', asc: 'คงเหลือ น้อยสุด → มากสุด', name: 'ชื่อ ก-ฮ' };
  var sortBy = null;
  function $(id) { return scr.$(id); }
  function qtyText(n) { return formatQty(n); }

  function products() { return (data && data.products) || []; }
  function find(bc) { return products().find(function (p) { return p.barcode === bc; }); }

  // ---------- ข้อมูล

  function load() {
    return tapi('stockData').then(function (r) {
      if (!r.ok) return r;
      data = r;
      fetched = true;
      LiffApp.keep('stock', r);
      return r;
    });
  }

  async function show(s, params) {
    LiffApp.closeSheets();
    if (!data) {
      var kept = LiffApp.remember('stock');
      if (kept && kept.data && Array.isArray(kept.data.products)) data = kept.data;
    }
    if (params.barcode) return showHistory(params.barcode);
    if (data) {
      drawList();
      if (!fetched) {
        LiffApp.syncing(true, scr);
        var r0 = await load();
        LiffApp.syncing(false, scr);
        if (!r0.ok) { if (LiffApp.isAuthFail(r0.code)) return LiffApp.showApiError(r0, scr); return LiffApp.toast('อัปเดตยอดไม่สำเร็จ ยอดที่เห็นอาจไม่ใช่ล่าสุด', true); }
        if (Shell.isCurrent(scr) && !scr.params.barcode) drawList();
      }
      return Shell.drawn(scr);
    }
    LiffApp.loading('กำลังโหลดสต็อก…', view);
    var r = await load();
    if (!r.ok) return LiffApp.showApiError(r, scr);
    if (!scr.params.barcode) drawList();
    Shell.drawn(scr);
  }

  // ---------- รายการสินค้า

  function row(p) {
    var q = p.tracked
      ? '<div class="q ' + p.level + '"><b class="num">' + esc(qtyText(p.qty)) + '</b> ' + esc(p.unit) + '</div>'
      : '<div class="q small muted">ยังไม่เริ่มนับ</div>';
    return '<li class="tap st-row" data-bc="' + esc(p.barcode) + '" role="link" tabindex="0"><div class="nm"><div class="n">' + esc(p.name) + '</div>' +
      (LEVEL[p.level] ? LEVEL[p.level] : p.active ? '' : '<span class="badge gray">เลิกขาย</span>') + '</div>' + q + '</li>';
  }

  function drawList() {
    $('title').textContent = 'สต็อก';
    acts.classList.toggle('hidden', !(data && data.ready));
    if (!data.ready) {
      $('sub').textContent = '';
      view.innerHTML = '<section class="card alert warn" id="stock-not-ready">' + esc(data.message || 'ยังไม่ได้ตั้งค่าสต็อก กรุณาแจ้งผู้ดูแลระบบ') + '</section>';
      return;
    }
    $('sub').textContent = 'แตะสินค้าเพื่อตั้งการเตือนของใกล้หมด'; // รอบ 23
    if (!$('stock-q')) {
      view.innerHTML =
        '<nav class="tabs stock-tabs" id="stock-tabs"><button type="button" data-tab="all">สินค้าทั้งหมด</button>' +
        '<button type="button" data-tab="low">ของใกล้หมด <span id="low-count"></span></button>' +
        '<button type="button" data-tab="report">รายงาน</button></nav>' +
        '<div id="stock-pending-box"></div>' +
        '<div id="tab-all"><section class="card"><input type="search" id="stock-q" placeholder="ค้นหาชื่อสินค้า หรือบาร์โค้ด" autocomplete="off">' +
        '<div class="sum-pick"><select id="stock-sort" aria-label="เรียงตาม">' + Object.keys(SORTS).map(function (k) {
          return '<option value="' + k + '">เรียง: ' + esc(SORTS[k]) + '</option>';
        }).join('') + '</select></div></section>' +
        '<div id="stock-lists"></div></div>' +
        '<div id="tab-low" class="hidden"><div id="low-box"></div></div>' +
        '<div id="tab-report" class="hidden"></div>';
      $('stock-tabs').addEventListener('click', function (e) {
        var b = e.target.closest('button[data-tab]');
        if (!b) return;
        // รอบ 27: แตะแท็บ "รายงาน" = เริ่มที่ "เดือนนี้" เสมอ (ช่วงที่เลือกครั้งก่อนไม่ติดมา — วันจันทร์ "สัปดาห์นี้" มีวันเดียว สับสน)
        if (b.dataset.tab === 'report' && !b.classList.contains('on')) { rep = null; repData = null; scr.params = { tab: 'report' }; }
        setTab(b.dataset.tab);
      });
      $('stock-q').addEventListener('input', function (e) { term = e.target.value; drawLists(); });
      $('stock-q').value = term;
      $('stock-sort').value = currentSort();
      $('stock-sort').addEventListener('change', function (e) { sortBy = SORTS[e.target.value] ? e.target.value : 'desc'; LiffApp.keep('stock-sort', sortBy); drawLists(); });
    }
    $('stock-pending-box').innerHTML = data.pending
      ? '<section class="card alert warn" id="stock-pending">มีบิลที่ยังตัดสต็อกไม่ครบ ระบบกำลังตัดให้อัตโนมัติ ยอดอาจยังไม่ตรง</section>' : '';
    drawLists();
    setTab(scr.params.tab === 'low' || scr.params.tab === 'report' ? scr.params.tab : 'all', true);
  }

  /** รอบ 21: แท็บ สินค้าทั้งหมด / ของใกล้หมด (จำใน URL stock?tab=low) / รอบ 24: รายงาน (stock?tab=report&period=…) */
  function setTab(t, keepUrl) {
    $('tab-all').classList.toggle('hidden', t !== 'all');
    $('tab-low').classList.toggle('hidden', t !== 'low');
    $('tab-report').classList.toggle('hidden', t !== 'report');
    acts.classList.toggle('hidden', t === 'report');
    $('sub').textContent = t === 'report' ? 'ยอดเข้า-ออกตามช่วงวันที่ พิมพ์หรือดาวน์โหลดได้' : 'แตะสินค้าเพื่อตั้งการเตือนของใกล้หมด';
    if (t === 'report') {
      showReport();
      if (!keepUrl) Shell.setParams(scr, repParams());
    }
    $('stock-tabs').querySelectorAll('button[data-tab]').forEach(function (b) {
      var on = b.dataset.tab === t;
      b.classList.toggle('on', on);
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    if (!keepUrl && t !== 'report') Shell.setParams(scr, t === 'low' ? { tab: 'low' } : {});
  }

  /** ของใกล้หมด: ≤ "เตือนเมื่อเหลือ" ของสินค้านั้น หรือติดลบ (เฉพาะสินค้าที่นับแล้ว) เรียงน้อยสุดก่อน (ไม่ขึ้นกับช่องค้นหา) */
  function drawLow() {
    var low = products().filter(function (p) { return p.level === 'neg' || p.level === 'low'; })
      .sort(function (a, b) { return a.qty - b.qty || byName(a, b); });
    $('low-count').textContent = '(' + low.length + ')';
    $('low-box').innerHTML = '<section class="card" id="stock-low"><h2>ของใกล้หมด <span class="count">' + low.length + ' รายการ · น้อยสุดก่อน</span></h2>' +
      (low.length ? '<ul class="list">' + low.map(row).join('') + '</ul>' : '<div class="empty">ไม่มีของใกล้หมด</div>') +
      '<div class="hint" id="low-hint">เตือนเฉพาะสินค้าที่ตั้ง "เตือนเมื่อเหลือ" ไว้ (แตะที่สินค้าเพื่อตั้ง) และสินค้าที่ยอดติดลบ เตือนในหน้าเว็บเท่านั้น</div></section>';
  }

  function currentSort() {
    if (!sortBy) {
      var kept = LiffApp.remember('stock-sort');
      sortBy = kept && SORTS[kept.data] ? kept.data : 'desc';
    }
    return sortBy;
  }

  function byName(a, b) { return String(a.name).localeCompare(String(b.name), 'th'); }

  /** เรียงสินค้าที่นับแล้ว (ยอดเท่ากัน → ชื่อ) / สินค้าที่ยังไม่นับไม่มียอด → เรียงชื่อเมื่อเลือกเรียงชื่อเท่านั้น */
  function sorted(list, counted) {
    var s = currentSort();
    if (s === 'name') return list.slice().sort(byName);
    if (!counted) return list;
    return list.slice().sort(function (a, b) { return (s === 'asc' ? a.qty - b.qty : b.qty - a.qty) || byName(a, b); });
  }

  function drawLists() {
    var t = term.trim().toLowerCase();
    var list = products().filter(function (p) { return !t || (p.name + ' ' + p.barcode).toLowerCase().indexOf(t) >= 0; });
    var watch = list.filter(function (p) { return p.level === 'neg' || p.level === 'low'; });
    var ok = sorted(list.filter(function (p) { return p.level === 'ok'; }), true);
    var off = sorted(list.filter(function (p) { return p.level === 'off'; }), false);
    $('stock-lists').innerHTML =
      (watch.length ? '<section class="card" id="stock-watch"><h2>ต้องดู <span class="count">' + watch.length + ' รายการ</span></h2><ul class="list">' + watch.map(row).join('') + '</ul></section>' : '') +
      '<section class="card" id="stock-all"><h2>สินค้า <span class="count">' + (ok.length + off.length) + ' รายการ</span></h2>' +
      (ok.length ? '<ul class="list">' + ok.map(row).join('') + '</ul>' : '') +
      (off.length ? '<div class="st-grp">ยังไม่นับสต็อก (ไม่ตัดอัตโนมัติ) กด "แก้ยอดตามที่นับ" เพื่อเริ่ม</div><ul class="list" id="stock-off">' + off.map(row).join('') + '</ul>' : '') +
      (!list.length ? '<div class="empty">ไม่พบสินค้าที่ค้นหา</div>' : '') + '</section>';
    drawLow();
  }

  // ---------- ของเข้า / ของออก / แก้ยอดตามที่นับ

  function openMove(kind) {
    var K = KIND[kind];
    var choices = products().filter(function (p) { return kind === 'count' ? p.tracked || p.active : p.tracked; });
    var body =
      '<input type="search" id="move-q" placeholder="ค้นหาสินค้า" autocomplete="off">' +
      '<ul class="list move-list" id="move-list">' + (choices.length ? choices.map(function (p) {
        return '<li class="move-line" data-bc="' + esc(p.barcode) + '"><div class="t"><div class="n">' + esc(p.name) + '</div>' +
          '<div class="s" data-now>' + (p.tracked ? 'คงเหลือ ' + esc(qtyText(p.qty)) + ' ' + esc(p.unit) : 'ยังไม่เริ่มนับ') + '</div></div>' +
          '<input type="number" inputmode="decimal" min="0" step="any" data-qty aria-label="' + esc(K.qty + ' ' + p.name) + '"></li>';
      }).join('') : '<li class="empty">ยังไม่มีสินค้าที่นับสต็อก กด "แก้ยอดตามที่นับ" ใส่ยอดเริ่มต้นก่อน</li>') + '</ul>' +
      '<label class="f" for="move-reason" style="margin-top:10px">' + esc(K.note) + '</label>' +
      '<input type="text" id="move-reason" maxlength="200" placeholder="' + esc(K.hint) + '">' +
      '<div id="move-error"></div>';
    var s = LiffApp.sheet(K.title, body, '<button type="button" class="btn primary block" id="move-save" disabled>บันทึก' + esc(K.title) + '</button>');
    s.el.querySelector('.sheet').classList.add('move-sheet');
    // คำอธิบาย 1 บรรทัดใต้หัวแผ่น (อยู่นอกส่วนที่เลื่อน → เห็นตลอดระหว่างพิมพ์)
    s.el.querySelector('.sheet header').insertAdjacentHTML('afterend', '<p class="small muted move-desc" id="move-desc">' + esc(K.desc) + '</p>');
    var el = function (sel) { return s.el.querySelector(sel); };
    var requestId = LiffApp.uuid();
    function lines() {
      return Array.from(s.el.querySelectorAll('.move-line')).map(function (li) {
        return { barcode: li.dataset.bc, qty: li.querySelector('[data-qty]').value.trim() };
      }).filter(function (l) { return l.qty !== ''; });
    }
    function stockOf() {
      var m = {};
      products().forEach(function (p) { m[p.barcode] = p; });
      return m;
    }
    function refresh() {
      var ls = lines();
      var plan = stockPlanManual({ kind: kind, lines: ls, reason: el('#move-reason').value, stock: stockOf() });
      s.el.querySelectorAll('.move-line').forEach(function (li) {
        var p = find(li.dataset.bc);
        var v = li.querySelector('[data-qty]').value.trim();
        var m = plan.moves.find(function (x) { return x.barcode === li.dataset.bc; });
        var now = p.tracked ? 'คงเหลือ ' + qtyText(p.qty) + ' ' + p.unit : 'ยังไม่เริ่มนับ';
        li.querySelector('[data-now]').textContent = v !== '' && m ? now + ' → ' + qtyText(m.balance) : now;
        li.classList.toggle('picked-line', v !== '');
      });
      el('#move-save').disabled = !ls.length;
      el('#move-save').textContent = 'บันทึก' + K.title + (ls.length ? ' ' + ls.length + ' รายการ' : '');
    }
    el('#move-q').addEventListener('input', function (e) {
      var t = e.target.value.trim().toLowerCase();
      s.el.querySelectorAll('.move-line').forEach(function (li) {
        var p = find(li.dataset.bc);
        li.classList.toggle('hidden', !!t && (p.name + ' ' + p.barcode).toLowerCase().indexOf(t) < 0);
      });
    });
    s.el.addEventListener('input', function (e) { if (e.target.matches('[data-qty], #move-reason')) refresh(); });
    el('#move-save').addEventListener('click', async function () {
      var ls = lines();
      var reason = el('#move-reason').value;
      var plan = stockPlanManual({ kind: kind, lines: ls, reason: reason, stock: stockOf() });
      if (plan.errors.length) return showErr(plan.errors);
      if (kind === 'count' && !plan.moves.length) { s.close(); return LiffApp.toast('ยอดที่นับได้ตรงกับระบบ ไม่ต้องบันทึก'); }
      var btn = el('#move-save');
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner sm" aria-hidden="true"></span> กำลังบันทึก…';
      var r = await tapi('stockMove', { kind: kind, lines: ls, reason: reason, requestId: requestId });
      if (!r.ok) {
        if (LiffApp.isAuthFail(r.code)) { s.close(); return LiffApp.showApiError(r, scr); }
        btn.disabled = false;
        refresh();
        return showErr([r.error || 'บันทึกไม่สำเร็จ ลองอีกครั้ง']);
      }
      if (r.products) {
        data.products = r.products;
        LiffApp.keep('stock', data);
      }
      s.close();
      drawList();
      LiffApp.toast('บันทึก' + K.title + 'แล้ว' + (r.duplicate ? '' : ' ' + (r.saved || 0) + ' รายการ'));
    });
    function showErr(list) {
      el('#move-error').innerHTML = '<div class="alert err" id="move-errors" style="margin-top:10px">' + LiffApp.errorHtml(list.join('\n')) + '</div>';
      el('#move-error').scrollIntoView({ block: 'nearest' });
    }
    refresh();
  }

  // ---------- ความเคลื่อนไหวของสินค้า

  async function showHistory(bc) {
    acts.classList.add('hidden');
    var p = find(bc);
    $('title').textContent = p ? p.name : 'สต็อก';
    $('sub').textContent = '';
    LiffApp.loading('กำลังโหลดความเคลื่อนไหว…', view);
    Shell.scrollTop(scr);
    var r = await tapi('stockHistory', { barcode: bc });
    if (!Shell.isCurrent(scr) || scr.params.barcode !== bc) return;
    if (!r.ok) return LiffApp.showApiError(r, scr);
    p = r.product;
    $('title').textContent = p.name;
    $('sub').textContent = p.tracked ? 'เริ่มนับ ' + formatThaiDateShort(String(p.since).slice(0, 10)) : 'ยังไม่เริ่มนับสต็อก';
    var level = p.tracked ? stockLevel({ stock_qty: p.qty, stock_since: p.since, low_alert: p.lowAlert === null || p.lowAlert === undefined ? '' : p.lowAlert }) : 'off';
    view.innerHTML =
      '<section class="card"><div class="row"><span class="grow">คงเหลือ</span>' +
      (p.tracked ? '<span class="st-big ' + level + '"><b class="num" id="hist-qty">' + esc(qtyText(p.qty)) + '</b> ' + esc(p.unit) + '</span>' : '<span class="muted">ยังไม่เริ่มนับ</span>') + '</div>' +
      '<div id="alert-box" class="alert-box"></div></section>' +
      '<section class="card"><h2>ความเคลื่อนไหว <span class="count">' + r.total + ' รายการ</span></h2><ul class="list" id="hist-list">' +
      (r.moves.length ? r.moves.map(function (m) {
        var when = formatThaiDateShort(m.at.slice(0, 10)) + (m.at.length > 15 ? ' ' + m.at.slice(11, 16) : '');
        // รอบ 26: รายการจากบิล → ชื่อร้าน (ณ วันออกบิล) ต่อท้าย บรรทัดเดียว ยาวตัดด้วย …
        return '<li class="mv"><div class="t"><div class="mv-h"><b>' + esc(m.kind) + '</b>' + (m.ref ? ' ' + esc(m.ref) : '') +
          (m.shop ? ' · <span class="mv-shop">' + esc(m.shop) + '</span>' : '') + '</div>' +
          '<div class="small muted">' + esc(when) + (m.by ? ' · ' + esc(m.by) : '') + (m.reason ? ' · ' + esc(m.reason) : '') + '</div></div>' +
          '<div class="d"><b class="num ' + (m.qty < 0 ? 'minus' : 'plus') + '">' + (m.qty > 0 ? '+' : '') + esc(qtyText(m.qty)) + '</b>' +
          '<div class="small muted">เหลือ ' + esc(qtyText(m.balance)) + '</div></div></li>';
      }).join('') : '<li class="empty">ยังไม่มีความเคลื่อนไหว</li>') + '</ul></section>' +
      '<div class="card" style="background:transparent;box-shadow:none;padding:0"><button type="button" class="btn block" id="hist-back">' + iconSvg('back') + '<span>กลับไปรายการสินค้า</span></button></div>';
    drawAlert(p);
    $('hist-back').addEventListener('click', function () {
      if (Shell.canBack()) Shell.back(); else Shell.go('stock', {}, { replace: true });
    });
    Shell.drawn(scr);
  }

  // ---------- รอบ 22: เตือนเมื่อเหลือ ของสินค้านี้ (ปุ่มเล็ก "แก้" → ช่องเดียว + บันทึก)

  /** รอบ 23: ว่าง = ไม่เตือน / 0 = เตือนเมื่อหมด / ตัวเลข = เหลือไม่เกินเท่านั้น */
  function alertText(p) {
    if (p.lowAlert === null || p.lowAlert === undefined) return 'ไม่เตือน';
    if (p.lowAlert === 0) return 'เมื่อหมด';
    return 'ไม่เกิน ' + qtyText(p.lowAlert) + ' ' + p.unit;
  }

  function drawAlert(p, editing) {
    var box = $('alert-box');
    if (!box) return;
    if (!editing) {
      box.innerHTML = '<div class="row"><span class="grow small muted">เตือนเมื่อเหลือ</span><span id="alert-text">' + esc(alertText(p)) + '</span>' +
        '<button type="button" class="btn sm ghost" id="alert-edit">แก้</button></div>';
      $('alert-edit').addEventListener('click', function () { drawAlert(p, true); });
      return;
    }
    box.innerHTML = '<label class="f" for="alert-input">เตือนเมื่อเหลือไม่เกิน (' + esc(p.unit) + ')</label>' +
      '<div class="th-box"><input type="number" class="num" id="alert-input" min="0" step="any" inputmode="decimal" placeholder="ไม่เตือน" value="' +
      (p.lowAlert === null || p.lowAlert === undefined ? '' : esc(String(p.lowAlert))) + '">' +
      '<button type="button" class="btn sm primary" id="alert-save">บันทึก</button><button type="button" class="btn sm" id="alert-cancel">ยกเลิก</button></div>' +
      '<div class="hint">เว้นว่าง = ไม่เตือน · ใส่ 0 = เตือนเมื่อของหมด · ยอดติดลบเตือนเสมอ</div><div id="alert-error"></div>';
    var input = $('alert-input');
    input.focus();
    $('alert-cancel').addEventListener('click', function () { drawAlert(p); });
    $('alert-save').addEventListener('click', function () { saveAlert(p); });
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') saveAlert(p); if (e.key === 'Escape') drawAlert(p); });
  }

  async function saveAlert(p) {
    var v = String($('alert-input').value).trim();
    if (v !== '' && !(isFinite(Number(v)) && Number(v) >= 0)) {
      $('alert-error').innerHTML = '<div class="alert err" id="alert-errors" style="margin-top:8px">ใส่ตัวเลข 0 ขึ้นไป หรือเว้นว่างถ้าไม่ต้องเตือน</div>';
      return;
    }
    var btn = $('alert-save');
    btn.disabled = true;
    var r = await tapi('setStockAlert', { barcode: p.barcode, alert: v === '' ? '' : Number(v) });
    if (!Shell.isCurrent(scr) || scr.params.barcode !== p.barcode) return;
    btn.disabled = false;
    if (!r.ok) {
      if (LiffApp.isAuthFail(r.code)) return LiffApp.showApiError(r, scr);
      $('alert-error').innerHTML = '<div class="alert err" id="alert-errors" style="margin-top:8px">' + LiffApp.errorHtml(r.error || 'บันทึกไม่สำเร็จ ลองอีกครั้ง') + '</div>';
      return;
    }
    data = Object.assign(data || {}, { ready: true, pending: r.pending, products: r.products });
    LiffApp.keep('stock', data);
    var np = r.product || p;
    p.lowAlert = np.lowAlert;
    var q = $('hist-qty');
    if (q && q.parentNode) q.parentNode.className = 'st-big ' + np.level;
    drawAlert(p);
    LiffApp.toast('บันทึกแล้ว เตือนเมื่อเหลือ ' + alertText(p));
  }

  // ---------- รอบ 24: รายงานสต็อก (แท็บ "รายงาน") — ตัวเลขคำนวณที่เซิร์ฟเวอร์ (stockReport → stockCore.js stockReportRows)
  //   พิมพ์ / PDF = window.print() + @media print ใน form.css (A4) / Excel = xlsx.js บนเครื่อง
  //   ในแอป LINE ดาวน์โหลด/พิมพ์มักไม่ได้ → เปิดหน้ารายงานช่วงเดียวกันในเบราว์เซอร์แทน (ล็อกอินนอก LINE แบบรอบ 21)

  var REP_PERIODS = [['week', 'สัปดาห์นี้'], ['lastweek', 'สัปดาห์ก่อน'], ['month', 'เดือนนี้'], ['pick', 'เลือกเดือน'], ['custom', 'เลือกวันเอง']];
  var REP_COLS = ['สินค้า', 'หน่วย', 'ยอดต้นช่วง', 'ของเข้า', 'ขายตามบิล', 'ของออก (ไม่มีบิล)', 'แก้ยอด (+/-)', 'คงเหลือปลายช่วง'];
  var rep = null;     // ช่วงที่เลือก { period, month, from, to }
  var repData = null; // คำตอบ stockReport ล่าสุด
  var repSeq = 0;

  function deviceToday() { return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10); }
  function repToday() { return (repData && repData.today) || deviceToday(); }
  function thDate(iso) { return formatThaiDateShort(String(iso).slice(0, 10)); }

  function repInit() {
    if (rep) return;
    var p = scr.params;
    rep = { period: REP_PERIODS.some(function (k) { return k[0] === p.period; }) ? p.period : 'month', month: p.month || '', from: p.from || '', to: p.to || '' };
    if (!rep.month) rep.month = deviceToday().slice(0, 7);
  }

  function repParams() {
    var q = { tab: 'report', period: rep.period };
    if (rep.period === 'pick') q.month = rep.month;
    if (rep.period === 'custom') { q.from = rep.from; q.to = rep.to; }
    return q;
  }

  function showReport() {
    repInit();
    var box = $('tab-report');
    if (!$('rep-period')) {
      box.innerHTML = '<section class="card no-print" id="rep-period"></section><div id="rep-body"></div>';
      $('rep-period').addEventListener('change', onRepPeriod);
      $('rep-period').addEventListener('click', function (e) {
        var input = e.target.closest && e.target.closest('input[type=date]');
        try { if (input && typeof input.showPicker === 'function') input.showPicker(); } catch (err) { /* ไม่เป็นไร */ }
      });
    }
    drawRepPeriod();
    loadReport();
  }

  /** เดือนให้เลือก: 24 เดือนล่าสุดถึงเดือนนี้ */
  function repMonths() {
    var t = repToday();
    var y = Number(t.slice(0, 4));
    var m = Number(t.slice(5, 7));
    var out = [];
    for (var i = 0; i < 24; i++) {
      out.push([y + '-' + (m < 10 ? '0' : '') + m, THAI_MONTHS_SHORT[m - 1] + ' ' + (y + 543)]);
      if (--m === 0) { m = 12; y--; }
    }
    return out;
  }

  function repDateBox(id, value) {
    return '<div class="date-box" id="' + id + '-box"><span class="date-text" id="' + id + '-th">' + esc(value ? thDate(value) : 'เลือกวันที่') + '</span>' +
      iconSvg('calendar') + '<input type="date" id="' + id + '" value="' + esc(value) + '" max="' + esc(repToday()) + '"></div>';
  }

  function drawRepPeriod() {
    var box = $('rep-period');
    box.innerHTML = '<div class="seg-choice rep-kinds" id="rep-kinds" role="radiogroup" aria-label="ช่วงเวลา">' + REP_PERIODS.map(function (k) {
      return '<label><input type="radio" name="rep-kind" value="' + k[0] + '"' + (rep.period === k[0] ? ' checked' : '') + '>' + k[1] + '</label>';
    }).join('') + '</div>' +
      (rep.period === 'pick' ? '<div class="sum-pick"><select id="rep-month" aria-label="เดือน">' + repMonths().map(function (m) {
        return '<option value="' + m[0] + '"' + (m[0] === rep.month ? ' selected' : '') + '>' + esc(m[1]) + '</option>';
      }).join('') + '</select></div>' : '') +
      (rep.period === 'custom' ? '<div class="two rep-dates"><div><label class="f" for="rep-from">วันเริ่ม</label>' + repDateBox('rep-from', rep.from) + '</div>' +
        '<div><label class="f" for="rep-to">วันจบ</label>' + repDateBox('rep-to', rep.to) + '</div></div>' : '');
  }

  function onRepPeriod(e) {
    var t = e.target;
    if (t.name === 'rep-kind') {
      rep.period = t.value;
      if (rep.period === 'custom' && !rep.from) { rep.from = repToday().slice(0, 8) + '01'; rep.to = repToday(); }
      drawRepPeriod();
    } else if (t.id === 'rep-month') rep.month = t.value;
    else if (t.id === 'rep-from' || t.id === 'rep-to') {
      rep[t.id === 'rep-from' ? 'from' : 'to'] = t.value;
      $(t.id + '-th').textContent = t.value ? thDate(t.value) : 'เลือกวันที่';
    } else return;
    Shell.setParams(scr, repParams());
    loadReport();
  }

  async function loadReport() {
    var seq = ++repSeq;
    var body = $('rep-body');
    LiffApp.loading('กำลังทำรายงาน…', body);
    var r = await tapi('stockReport', { period: rep.period, month: rep.month, from: rep.from, to: rep.to });
    if (seq !== repSeq || !Shell.isCurrent(scr) || !$('rep-body')) return;
    if (!r.ok) {
      if (LiffApp.isAuthFail(r.code)) return LiffApp.showApiError(r, scr);
      body.innerHTML = '<section class="card alert err" id="rep-error">' + LiffApp.errorHtml(r.error || 'ทำรายงานไม่สำเร็จ ลองอีกครั้ง') + '</section>';
      return;
    }
    repData = r;
    drawReport();
  }

  function repRangeText(r) { return thDate(r.from) + ' – ' + thDate(r.to); }
  function repPrintedText(r) { return thDate(r.printedAt) + (String(r.printedAt).length > 15 ? ' ' + String(r.printedAt).slice(11, 16) + ' น.' : ''); }
  function repNum(n, signed) {
    if (!n) return '<span class="muted">0</span>';
    return esc((signed && n > 0 ? '+' : '') + qtyText(n));
  }

  function drawReport() {
    var r = repData;
    var rows = r.rows || [];
    $('rep-body').innerHTML =
      '<section class="card rep-sheet" id="rep-sheet">' +
      '<div class="rep-head"><div class="rep-co" id="rep-company">' + esc(r.company || '') + '</div><h2>รายงานสต็อก</h2>' +
      '<div id="rep-range">ช่วงวันที่ ' + esc(repRangeText(r)) + '</div>' +
      '<div class="small muted" id="rep-printed">พิมพ์เมื่อ ' + esc(repPrintedText(r)) + '</div></div>' +
      (rows.length ? '<div class="rep-scroll"><table class="rep-table" id="rep-table"><thead><tr>' + REP_COLS.map(function (c) { return '<th>' + esc(c) + '</th>'; }).join('') +
        '</tr></thead><tbody>' + rows.map(function (x) {
          return '<tr data-bc="' + esc(x.barcode) + '"><td class="nm">' + esc(x.name) + (x.startedIn ? '<div class="small muted">เริ่มนับ ' + esc(thDate(x.since)) + '</div>' : '') + '</td>' +
            '<td>' + esc(x.unit) + '</td><td class="num">' + repNum(x.open) + '</td><td class="num">' + repNum(x.inQty) + '</td>' +
            '<td class="num">' + repNum(x.sale) + '</td><td class="num">' + repNum(x.out) + '</td><td class="num">' + repNum(x.adjust, true) + '</td>' +
            '<td class="num"><b>' + repNum(x.close) + '</b></td></tr>';
        }).join('') + '</tbody></table></div>' : '<div class="empty" id="rep-empty">ยังไม่มีสินค้าที่นับสต็อกในช่วงนี้</div>') +
      '<div class="small muted rep-note">' + rows.length + ' รายการ · ไม่นับบิลที่ยกเลิกและบิลทดสอบ 0000 · แสดงเฉพาะสินค้าที่เริ่มนับสต็อกแล้ว</div></section>' +
      (rows.length ? '<div class="rep-acts no-print"><button type="button" class="btn primary" id="rep-print">พิมพ์ / PDF</button>' +
        '<button type="button" class="btn" id="rep-xlsx">ดาวน์โหลด Excel</button></div>' : '');
    if (!rows.length) return;
    $('rep-print').addEventListener('click', function () {
      if (!toBrowser()) LiffApp.printAs(repFileName(repData), function () { repHelp('หน้านี้เปิดหน้าต่างพิมพ์ไม่ได้', 'กดพิมพ์'); });
    });
    $('rep-xlsx').addEventListener('click', function () { if (!toBrowser()) saveXlsx(); });
  }

  function repUrl() { return LiffApp.appUrl('stock') + '?' + new URLSearchParams(repParams()).toString(); }
  /** รอบ 31: ทางเลือกเมื่อพิมพ์ / ดาวน์โหลดจากหน้านี้ไม่ได้ (กล่องอยู่บนสุดของรายงาน) */
  function repHelp(why, what) {
    LiffApp.outsideHelp($('rep-body'), repUrl(), why + ' กด "เปิดในเบราว์เซอร์" หรือคัดลอกลิงก์ไปวางใน Safari แล้ว' + what + 'ที่นั่น');
  }

  /** ในแอป LINE → เปิดหน้ารายงานช่วงเดียวกันในเบราว์เซอร์ + กล่องทางเลือกถ้าไม่เปิด (คืน true) */
  function toBrowser() {
    return LiffApp.openOutside(repUrl(), $('rep-body'), 'กดพิมพ์หรือดาวน์โหลด');
  }

  /** ชื่อไฟล์ (PDF และ Excel ใช้ชื่อเดียวกัน) เช่น "รายงานสต็อก 1-10-2569 ถึง 27-10-2569" */
  function repFileName(r) {
    return 'รายงานสต็อก ' + LiffApp.fileDate(r.from) + (r.from === r.to ? '' : ' ถึง ' + LiffApp.fileDate(r.to));
  }

  function saveXlsx() {
    var r = repData;
    var head = REP_COLS.map(function (c) { return { v: c, s: 'head' }; });
    var rows = [
      [{ v: r.company || '', s: 'title' }],
      [{ v: 'รายงานสต็อก', s: 'bold' }],
      ['ช่วงวันที่ ' + repRangeText(r)],
      ['พิมพ์เมื่อ ' + repPrintedText(r)],
      [],
      head
    ].concat(r.rows.map(function (x) {
      return [{ v: x.name + (x.startedIn ? ' (เริ่มนับ ' + thDate(x.since) + ')' : ''), s: 'text' }, { v: x.unit, s: 'text' },
        x.open, x.inQty, x.sale, x.out, { v: x.adjust, s: 'signed' }, { v: x.close, s: 'bold' }];
    }), [[], [{ v: 'ไม่นับบิลที่ยกเลิกและบิลทดสอบ 0000 · แสดงเฉพาะสินค้าที่เริ่มนับสต็อกแล้ว', s: 'small' }]]);
    var name = repFileName(r) + '.xlsx';
    var bytes = Xlsx.build({ sheet: 'รายงานสต็อก', cols: [34, 8, 11, 10, 11, 13, 12, 14], rows: rows, merges: ['A1:H1', 'A2:H2', 'A3:H3', 'A4:H4'] });
    // รอบ 31: เบราว์เซอร์ในแอป LINE ดาวน์โหลดไม่ได้ (ไม่มี error) → ทางเลือกทันที
    if (LiffApp.inLineBrowser()) return repHelp('หน้านี้ดาวน์โหลดไฟล์ไม่ได้', 'กดดาวน์โหลด');
    // iPad / iPhone: ส่งไฟล์ผ่านแผ่นแชร์ (บันทึกลงไฟล์ / ส่งต่อ) — ดาวน์โหลดแบบลิงก์ในแอปบนหน้าจอโฮมอาจไม่ขึ้นอะไร
    if (LiffApp.isIos() && typeof File === 'function' && navigator.canShare && navigator.share) {
      var file = new File([bytes], name, { type: Xlsx.TYPE || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      var ok = false;
      try { ok = navigator.canShare({ files: [file] }); } catch (e) { ok = false; }
      if (ok) {
        navigator.share({ files: [file], title: repFileName(r) }).catch(function (e) {
          if (e && e.name === 'AbortError') return; // ผู้ใช้ปิดแผ่นแชร์เอง
          Xlsx.save(name, bytes);
          repHelp('ส่งไฟล์ไม่สำเร็จ ถ้าไฟล์ไม่ขึ้น', 'กดดาวน์โหลด');
        });
        return;
      }
    }
    Xlsx.save(name, bytes);
    LiffApp.toast('ดาวน์โหลดแล้ว');
    // แอปบนหน้าจอโฮมของ iPad / iPhone: ดาวน์โหลดอาจไม่ขึ้นอะไร → บอกทางเลือกไว้ด้วย
    if (LiffApp.isIos() && LiffApp.standalone()) repHelp('ถ้าไฟล์ไม่ขึ้น', 'กดดาวน์โหลด');
  }

  function tap(e) {
    var li = e.target.closest && e.target.closest('li[data-bc].st-row');
    if (li) Shell.go('stock', { barcode: li.dataset.bc });
  }

  Shell.define('stock', {
    title: 'สต็อก',
    build: function (s) {
      scr = s;
      s.root.innerHTML = '<div class="topbar"><h1 id="title">สต็อก</h1><div class="sub" id="sub"></div></div><div id="view" aria-live="polite"></div>';
      s.dock.innerHTML = '<div class="totalbar stock-acts hidden" id="stock-acts"><div class="inner">' +
        '<button type="button" class="btn primary" id="btn-in">' + KIND.in.title + '</button>' +
        '<button type="button" class="btn" id="btn-out">ของออก <br>(ไม่มีบิล)</button>' + // ตัดบรรทัดตรงวงเล็บ (textContent = ชื่อเต็ม)
        '<button type="button" class="btn" id="btn-count">' + KIND.count.title + '</button></div></div>';
      view = $('view');
      acts = $('stock-acts');
      view.addEventListener('click', tap);
      view.addEventListener('keydown', function (e) { if (e.key === 'Enter') tap(e); });
      $('btn-in').addEventListener('click', function () { openMove('in'); });
      $('btn-out').addEventListener('click', function () { openMove('out'); });
      $('btn-count').addEventListener('click', function () { openMove('count'); });
    },
    show: function (s, params) { return show(s, params); }
  });
})();
