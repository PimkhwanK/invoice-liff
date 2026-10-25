/*
 * stock.js — หน้า "สต็อก" (รอบ 16) เปิดจาก Rich Menu (/stock) ไม่ผูกกับประเภทเอกสาร (shell.js ALONE) ทุกคนในแท็บผู้ใช้ใช้ได้
 *   รายการสินค้า + คงเหลือ (ค้นหาได้) — ติดลบ / ใกล้หมด อยู่บนสุด / สินค้าที่ยังไม่นับอยู่ท้าย (ยังไม่ตัดอัตโนมัติ)
 *   ปุ่มล่าง: ของเข้า / ของออก (ไม่มีบิล) / แก้ยอดตามที่นับ (ทีละหลายสินค้า — รอบ 18 เปลี่ยนชื่อจาก รับเข้า / หักออก / นับสต็อก) → stockMove / แตะสินค้า → stock?barcode= ความเคลื่อนไหวย้อนหลัง (stockHistory)
 *   เรียง (รอบ 19): คงเหลือมาก→น้อย / น้อย→มาก / ชื่อ ก-ฮ ใช้กับรายการ "สินค้า" (ต้องดูอยู่บนสุดเสมอ) จำไว้ในเครื่อง (stock-sort)
 *   ข้อมูล: stockData (StockApi.gs) จำไว้ในเครื่อง ('stock') → เปิดครั้งถัดไปเห็นทันที แล้วอัปเดตเบื้องหลัง
 *   รอบ 22: แตะสินค้า → หน้าสินค้า แก้ "เตือนเมื่อเหลือ" ของสินค้านั้นได้ (setStockAlert — ว่าง = ค่าเริ่มต้น / 0 = ไม่เตือน)
 *   รอบ 21: แท็บ "สินค้าทั้งหมด" | "ของใกล้หมด" (stock?tab=low — ≤ จุดเตือน หรือติดลบ เรียงน้อยสุดก่อน) + ตั้งจุดเตือน (setStockThreshold) ตัวเลขเดียวทุกสินค้า
 *     เตือนในหน้าเว็บเท่านั้น ไม่ส่งข้อความ LINE
 *   กติกา (ตรวจซ้ำที่เซิร์ฟเวอร์): stockCore.js stockPlanManual — หน้าเว็บใช้ตัวเดียวกันแสดงยอดใหม่ระหว่างพิมพ์
 */
(function () {
  var esc = LiffApp.esc;
  var scr = null;
  var view = null;
  var acts = null;
  var data = null;      // คำตอบ stockData { ready, threshold, pending, products, message }
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
  /** หัวหน้า: ค่าเริ่มต้นของการเตือน (รอบ 22 — สินค้าที่ตั้งเองใช้ค่าของสินค้านั้น) */
  function subText(t) { return 'ค่าเริ่มต้น: เตือนเมื่อเหลือไม่เกิน ' + qtyText(t); }
  function find(bc) { return products().find(function (p) { return p.barcode === bc; }); }

  // ---------- ข้อมูล

  function load() {
    return LiffApp.api('stockData').then(function (r) {
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
    $('sub').textContent = subText(data.threshold);
    if (!$('stock-q')) {
      view.innerHTML =
        '<nav class="tabs stock-tabs" id="stock-tabs"><button type="button" data-tab="all">สินค้าทั้งหมด</button>' +
        '<button type="button" data-tab="low">ของใกล้หมด <span id="low-count"></span></button></nav>' +
        '<div id="stock-pending-box"></div>' +
        '<div id="tab-all"><section class="card"><input type="search" id="stock-q" placeholder="ค้นหาชื่อสินค้า หรือบาร์โค้ด" autocomplete="off">' +
        '<div class="sum-pick"><select id="stock-sort" aria-label="เรียงตาม">' + Object.keys(SORTS).map(function (k) {
          return '<option value="' + k + '">เรียง: ' + esc(SORTS[k]) + '</option>';
        }).join('') + '</select></div></section>' +
        '<div id="stock-lists"></div></div>' +
        '<div id="tab-low" class="hidden"><section class="card" id="th-card"><h2>ค่าเริ่มต้นเตือนใกล้หมด</h2>' +
        '<div class="th-box"><label for="th-input">เตือนเมื่อเหลือไม่เกิน</label><input type="number" class="num" id="th-input" min="0" step="any" inputmode="decimal">' +
        '<button type="button" class="btn sm primary" id="th-save">บันทึก</button></div>' +
        '<div class="hint">ใช้กับสินค้าที่ไม่ได้ตั้งเอง (ตั้งแยกได้โดยแตะที่สินค้า) เตือนในหน้าเว็บเท่านั้น ไม่ส่งข้อความ LINE</div><div id="th-error"></div></section>' +
        '<div id="low-box"></div></div>';
      $('stock-tabs').addEventListener('click', function (e) {
        var b = e.target.closest('button[data-tab]');
        if (b) setTab(b.dataset.tab);
      });
      $('th-save').addEventListener('click', saveThreshold);
      $('th-input').addEventListener('keydown', function (e) { if (e.key === 'Enter') saveThreshold(); });
      $('th-input').value = String(data.threshold);
      $('stock-q').addEventListener('input', function (e) { term = e.target.value; drawLists(); });
      $('stock-q').value = term;
      $('stock-sort').value = currentSort();
      $('stock-sort').addEventListener('change', function (e) { sortBy = SORTS[e.target.value] ? e.target.value : 'desc'; LiffApp.keep('stock-sort', sortBy); drawLists(); });
    }
    $('stock-pending-box').innerHTML = data.pending
      ? '<section class="card alert warn" id="stock-pending">มีบิลที่ยังตัดสต็อกไม่ครบ ระบบกำลังตัดให้อัตโนมัติ ยอดอาจยังไม่ตรง</section>' : '';
    drawLists();
    setTab(scr.params.tab === 'low' ? 'low' : 'all', true);
  }

  /** รอบ 21: แท็บ สินค้าทั้งหมด / ของใกล้หมด (จำใน URL stock?tab=low) */
  function setTab(t, keepUrl) {
    $('tab-all').classList.toggle('hidden', t === 'low');
    $('tab-low').classList.toggle('hidden', t !== 'low');
    $('stock-tabs').querySelectorAll('button[data-tab]').forEach(function (b) {
      var on = b.dataset.tab === t;
      b.classList.toggle('on', on);
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    if (!keepUrl) Shell.setParams(scr, t === 'low' ? { tab: 'low' } : {});
  }

  /** ของใกล้หมด: ≤ จุดเตือน หรือติดลบ (เฉพาะสินค้าที่นับแล้ว) เรียงน้อยสุดก่อน (ไม่ขึ้นกับช่องค้นหา) */
  function drawLow() {
    var low = products().filter(function (p) { return p.level === 'neg' || p.level === 'low'; })
      .sort(function (a, b) { return a.qty - b.qty || byName(a, b); });
    $('low-count').textContent = '(' + low.length + ')';
    $('low-box').innerHTML = '<section class="card" id="stock-low"><h2>ของใกล้หมด <span class="count">' + low.length + ' รายการ · น้อยสุดก่อน</span></h2>' +
      (low.length ? '<ul class="list">' + low.map(row).join('') + '</ul>' : '<div class="empty">ไม่มีของใกล้หมด</div>') + '</section>';
  }

  /** รอบ 21: บันทึกจุดเตือน (ตัวเลข ≥ 0) → เซิร์ฟเวอร์ตอบรายการสินค้าใหม่ (ระดับคำนวณใหม่) */
  async function saveThreshold() {
    var input = $('th-input');
    var btn = $('th-save');
    var v = String(input.value).trim();
    var n = Number(v);
    if (v === '' || !isFinite(n) || n < 0) {
      $('th-error').innerHTML = '<div class="alert err" id="th-errors" style="margin-top:8px">จุดเตือนต้องเป็นตัวเลข 0 ขึ้นไป</div>';
      return;
    }
    $('th-error').innerHTML = '';
    btn.disabled = true;
    var r = await LiffApp.api('setStockThreshold', { threshold: n });
    btn.disabled = false;
    if (!r.ok) {
      if (LiffApp.isAuthFail(r.code)) return LiffApp.showApiError(r, scr);
      $('th-error').innerHTML = '<div class="alert err" id="th-errors" style="margin-top:8px">' + LiffApp.errorHtml(r.error || 'บันทึกไม่สำเร็จ ลองอีกครั้ง') + '</div>';
      return;
    }
    data = r;
    LiffApp.keep('stock', r);
    $('sub').textContent = subText(r.threshold);
    input.value = String(r.threshold);
    drawLists();
    LiffApp.toast('บันทึกค่าเริ่มต้นแล้ว เตือนเมื่อเหลือไม่เกิน ' + qtyText(r.threshold));
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
      var r = await LiffApp.api('stockMove', { kind: kind, lines: ls, reason: reason, requestId: requestId });
      if (!r.ok) {
        if (LiffApp.isAuthFail(r.code)) { s.close(); return LiffApp.showApiError(r, scr); }
        btn.disabled = false;
        refresh();
        return showErr([r.error || 'บันทึกไม่สำเร็จ ลองอีกครั้ง']);
      }
      if (r.products) {
        data.products = r.products;
        data.threshold = r.threshold;
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
    var r = await LiffApp.api('stockHistory', { barcode: bc });
    if (!Shell.isCurrent(scr) || scr.params.barcode !== bc) return;
    if (!r.ok) return LiffApp.showApiError(r, scr);
    p = r.product;
    $('title').textContent = p.name;
    $('sub').textContent = p.tracked ? 'เริ่มนับ ' + formatThaiDateShort(String(p.since).slice(0, 10)) : 'ยังไม่เริ่มนับสต็อก';
    var level = p.tracked ? stockLevel({ stock_qty: p.qty, stock_since: p.since, low_alert: p.lowAlert === null || p.lowAlert === undefined ? '' : p.lowAlert }, data ? data.threshold : STOCK_LOW_DEFAULT) : 'off';
    view.innerHTML =
      '<section class="card"><div class="row"><span class="grow">คงเหลือ</span>' +
      (p.tracked ? '<span class="st-big ' + level + '"><b class="num" id="hist-qty">' + esc(qtyText(p.qty)) + '</b> ' + esc(p.unit) + '</span>' : '<span class="muted">ยังไม่เริ่มนับ</span>') + '</div>' +
      '<div id="alert-box" class="alert-box"></div></section>' +
      '<section class="card"><h2>ความเคลื่อนไหว <span class="count">' + r.total + ' รายการ</span></h2><ul class="list" id="hist-list">' +
      (r.moves.length ? r.moves.map(function (m) {
        var when = formatThaiDateShort(m.at.slice(0, 10)) + (m.at.length > 15 ? ' ' + m.at.slice(11, 16) : '');
        return '<li class="mv"><div class="t"><b>' + esc(m.kind) + '</b>' + (m.ref ? ' ' + esc(m.ref) : '') +
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

  function alertText(p) {
    var t = data ? data.threshold : STOCK_LOW_DEFAULT;
    if (p.lowAlert === 0) return 'ไม่เตือน';
    if (p.lowAlert === null || p.lowAlert === undefined) return qtyText(t) + ' ' + p.unit + ' (ค่าเริ่มต้น)';
    return qtyText(p.lowAlert) + ' ' + p.unit;
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
    var t = data ? data.threshold : STOCK_LOW_DEFAULT;
    box.innerHTML = '<label class="f" for="alert-input">เตือนเมื่อเหลือไม่เกิน (' + esc(p.unit) + ')</label>' +
      '<div class="th-box"><input type="number" class="num" id="alert-input" min="0" step="any" inputmode="decimal" placeholder="' + esc(qtyText(t)) + '" value="' +
      (p.lowAlert === null || p.lowAlert === undefined ? '' : esc(String(p.lowAlert))) + '">' +
      '<button type="button" class="btn sm primary" id="alert-save">บันทึก</button><button type="button" class="btn sm" id="alert-cancel">ยกเลิก</button></div>' +
      '<div class="hint">เว้นว่าง = ใช้ค่าเริ่มต้น (' + esc(qtyText(t)) + ') · ใส่ 0 = ไม่ต้องเตือนสินค้านี้</div><div id="alert-error"></div>';
    var input = $('alert-input');
    input.focus();
    $('alert-cancel').addEventListener('click', function () { drawAlert(p); });
    $('alert-save').addEventListener('click', function () { saveAlert(p); });
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') saveAlert(p); if (e.key === 'Escape') drawAlert(p); });
  }

  async function saveAlert(p) {
    var v = String($('alert-input').value).trim();
    if (v !== '' && !(isFinite(Number(v)) && Number(v) >= 0)) {
      $('alert-error').innerHTML = '<div class="alert err" id="alert-errors" style="margin-top:8px">ใส่ตัวเลข 0 ขึ้นไป หรือเว้นว่าง</div>';
      return;
    }
    var btn = $('alert-save');
    btn.disabled = true;
    var r = await LiffApp.api('setStockAlert', { barcode: p.barcode, alert: v === '' ? '' : Number(v) });
    if (!Shell.isCurrent(scr) || scr.params.barcode !== p.barcode) return;
    btn.disabled = false;
    if (!r.ok) {
      if (LiffApp.isAuthFail(r.code)) return LiffApp.showApiError(r, scr);
      $('alert-error').innerHTML = '<div class="alert err" id="alert-errors" style="margin-top:8px">' + LiffApp.errorHtml(r.error || 'บันทึกไม่สำเร็จ ลองอีกครั้ง') + '</div>';
      return;
    }
    data = Object.assign(data || {}, { ready: true, threshold: r.threshold, pending: r.pending, products: r.products });
    LiffApp.keep('stock', data);
    var np = r.product || p;
    p.lowAlert = np.lowAlert;
    var q = $('hist-qty');
    if (q && q.parentNode) q.parentNode.className = 'st-big ' + np.level;
    drawAlert(p);
    LiffApp.toast('บันทึกแล้ว เตือนเมื่อเหลือ ' + alertText(p));
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
