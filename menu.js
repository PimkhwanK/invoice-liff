/*
 * menu.js — หน้าแรก (รอบ 21 เมนูหลัก / รอบ 34 ขั้น 2: หน้าแรกแบบสรุปสั้น)
 *   หน้าแรกของแอปทั้งใน LINE และนอก LINE (index.html → menu) / แถบล่าง "หน้าแรก" (shell.js)
 *   เรียงจากบน: ปุ่มใหญ่ ออกใบเงินสด / ออกใบกำกับภาษี → ตัวเลขวันนี้ (ยอดขาย เทียบเมื่อวาน จำนวนบิล) → สิ่งที่ต้องทำ
 *     (ลูกหนี้เลยกำหนด / ใกล้ครบกำหนด / สินค้าใกล้หมด — ไม่มีอะไรค้าง = ซ่อนทั้งส่วน) → บิลล่าสุด 5 ใบ → ปุ่มใหญ่ จัดการข้อมูล → ชื่อผู้ใช้ + ปุ่มเดิม
 *   ข้อมูล: summaryData (ปีนี้ — ข้อมูลชุดเดียวกับหน้าสรุป จำไว้ที่ 'sales-<ปี>' ใช้ร่วมกัน) + debtData (จำไว้ที่ 'home-debt')
 *     แสดงตัวเลขที่จำไว้ก่อน แล้วอัปเดตเบื้องหลัง / ไม่สำเร็จชั่วคราว → ลองใหม่เงียบ ๆ 3 ครั้ง (แบบหน้าสรุป)
 *   ใน LINE: ปุ่ม "เปิดแบบเต็มจอ" (liff.openWindow external → เบราว์เซอร์ของเครื่องที่หน้านี้)
 *   นอก LINE: ปุ่ม "ออกจากระบบ" / "ติดตั้งเป็นแอป" (pwa.js) / "กลับไปแชท LINE" (APP_CONFIG.LINE_OA_ID — ไม่ใส่ = ไม่มีปุ่ม)
 *   ชื่อผู้ใช้มาจากแท็บผู้ใช้ (whoami ตรวจสิทธิ์ที่เซิร์ฟเวอร์) — ถูกปิดสิทธิ์ → หน้าไม่มีสิทธิ์ทันที
 */
(function () {
  var esc = LiffApp.esc;
  var scr = null;
  var RECENT = 5;        // บิลล่าสุดกี่ใบ
  var RETRIES = 3;       // ติดต่อไม่สำเร็จชั่วคราว → ลองใหม่เงียบ ๆ ก่อนบอกผู้ใช้ (เหมือนหน้าสรุป)
  var RETRY_MS = 1500;
  var sales = null;      // ข้อมูลสรุปปีนี้ (salesBuild)
  var stockLow;          // { products } / null = ยังไม่ได้ตั้งค่าสต็อก / undefined = ยังไม่รู้
  var debt = null;       // { overdue: [n, สตางค์], soon: [n, สตางค์] }
  var failed = { sales: false, debt: false };

  function $(id) { return scr.$(id); }
  function money(sat) { return formatMoney(fromSatang(sat)); }
  function deviceToday() { return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10); }

  /** ปุ่มใหญ่: ออกบิล 2 ประเภท (เปิดในโหมดนั้น — คนละโหมดโหลดหน้าใหม่) / จัดการข้อมูล (โหมดที่ใช้ล่าสุด) */
  var TILES = [
    { id: 'cash', href: 'issue?type=cash', icon: 'cash', name: 'ออกใบเงินสด' },
    { id: 'tax', href: 'issue?type=tax', icon: 'receipt', name: 'ออกใบกำกับภาษี' }
  ];
  function tile(t) {
    return '<a class="menu-tile ' + t.id + '" id="tile-' + t.id + '" href="' + esc(t.href) + '">' + iconSvg(t.icon) +
      '<span class="n">' + esc(t.name) + '</span>' + (t.sub ? '<span class="s">' + esc(t.sub) + '</span>' : '') + '</a>';
  }

  // ---------- ข้อมูล (action ของหน้าแรกอยู่กับใบกำกับเสมอ — type tax)

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

  /** ตัวเลขที่จำไว้ (เปิดครั้งถัดไปเห็นทันที) */
  function recall() {
    var year = Number(deviceToday().slice(0, 4));
    var k = LiffApp.remember('sales-' + year);
    if (!sales && k && k.data && k.data.v === SALES_VERSION && k.data.year === year) sales = k.data;
    var s = LiffApp.remember('stock-low');
    if (stockLow === undefined && s) stockLow = s.data;
    var d = LiffApp.remember('home-debt');
    if (!debt && d && d.data) debt = d.data;
  }

  function fetchAll() {
    var year = Number(deviceToday().slice(0, 4));
    var one = function (action, payload, done, key) {
      return tapi(action, payload).then(function (r) {
        if (!r.ok) {
          if (LiffApp.isAuthFail(r.code)) { LiffApp.showApiError(r, scr); return; }
          failed[key] = true;
        } else {
          failed[key] = false;
          done(r);
        }
        if (Shell.isCurrent(scr)) drawStats();
      });
    };
    LiffApp.syncing(true, scr);
    return Promise.all([
      one('summaryData', { year: year }, function (r) {
        sales = r.summary;
        LiffApp.keep('sales-' + sales.year, sales);
        if ('stockLow' in r) { stockLow = r.stockLow; LiffApp.keep('stock-low', r.stockLow); }
      }, 'sales'),
      one('debtData', {}, function (r) {
        var d = r.debt;
        debt = { overdue: [d.overdue.length, d.sums.overdue], soon: [d.soon.length, d.sums.soon], days: d.days };
        LiffApp.keep('home-debt', debt);
      }, 'debt')
    ]).then(function () {
      LiffApp.syncing(false, scr);
      // มีตัวเลขเดิมแสดงอยู่แล้ว → บอกสั้น ๆ (ตัวเลขเดิมยังอยู่)
      if (Shell.isCurrent(scr) && (failed.sales && sales || failed.debt && debt)) LiffApp.toast('อัปเดตตัวเลขไม่สำเร็จ ตัวเลขที่เห็นอาจไม่ใช่ล่าสุด', true);
    });
  }

  // ---------- วาด

  function draw() {
    var inLine = LiffApp.inClient();
    var oa = LiffApp.lineChatUrl();
    $('view').innerHTML =
      '<nav class="menu-grid" aria-label="ออกบิล">' + TILES.map(tile).join('') + '</nav>' +
      '<div id="home-stats"></div>' +
      '<nav class="menu-grid" aria-label="จัดการข้อมูล">' + tile({ id: 'manage', href: 'manage?type=' + Shell.lastMode(), icon: 'manage', name: 'จัดการข้อมูล', sub: 'ร้านค้า · สินค้า · ยกเลิกบิล · แจ้งเตือน' }) + '</nav>' +
      '<section class="card menu-hello"><div class="t"><div class="small muted">เข้าสู่ระบบเป็น</div><div><b id="menu-name"></b></div></div>' +
      (inLine
        ? '<button type="button" class="btn sm primary" id="btn-full">' + iconSvg('link') + '<span>เปิดแบบเต็มจอ</span></button>'
        : '<button type="button" class="btn sm" id="btn-logout">' + iconSvg('logout') + '<span>ออกจากระบบ</span></button>') + '</section>' +
      (inLine ? '' :
        '<section class="card menu-more" id="menu-more">' +
        '<button type="button" class="btn block hidden" id="btn-install">' + iconSvg('download') + '<span>ติดตั้งเป็นแอปบนเครื่องนี้</span></button>' +
        (oa ? '<a class="btn block" id="btn-chat" href="' + esc(oa) + '" rel="noopener">' + iconSvg('send') + '<span>กลับไปแชท LINE</span></a>' : '') +
        '</section>');
    $('menu-name').textContent = LiffApp.profileName() || '…';
    if (inLine) $('btn-full').addEventListener('click', function () { LiffApp.openFullScreen(); });
    else $('btn-logout').addEventListener('click', function () { LiffApp.logout(); });
    if (!inLine && window.Pwa) Pwa.menu(scr);
    drawStats();
  }

  function drawStats() {
    var box = $('home-stats');
    if (!box) return;
    box.innerHTML = todayCard() + todoCard() + recentCard();
  }

  function delta(pct) {
    if (pct === null) return '<span class="sum-delta none">เมื่อวานไม่มียอด</span>';
    if (pct === 0) return '<span class="sum-delta same">เท่าเมื่อวาน</span>';
    var up = pct > 0;
    return '<span class="sum-delta ' + (up ? 'up' : 'down') + '">' + iconSvg(up ? 'up' : 'down') + (up ? 'เพิ่ม ' : 'ลด ') +
      Math.abs(pct).toLocaleString('th-TH', { maximumFractionDigits: 1 }) + '%</span>';
  }

  /** ตัวเลขวันนี้: ยอดขาย (เทียบเมื่อวาน) + จำนวนบิล — แตะ = หน้าสรุป */
  function todayCard() {
    var head = '<a class="card home-today" id="home-today" href="summary"><h2>วันนี้ <span class="count">ดูสรุป</span>' + iconSvg('next') + '</h2>';
    if (!sales) {
      return head + '<div class="small muted" id="home-today-msg">' + (failed.sales ? 'โหลดตัวเลขไม่สำเร็จ ลองเปิดหน้านี้ใหม่' : 'กำลังโหลด…') + '</div></a>';
    }
    var a = salesView(sales, { kind: 'today' }).all;
    return head + '<div class="home-nums"><div><span class="muted">ยอดขาย (บาท)</span><b class="num" id="home-sales">' + money(a.sat) + '</b>' + delta(a.pct) + '</div>' +
      '<div><span class="muted">จำนวนบิล</span><b class="num" id="home-bills">' + a.n.toLocaleString('th-TH') + '</b>' +
      '<span class="small muted">เมื่อวาน ' + a.pn.toLocaleString('th-TH') + ' บิล</span></div></div></a>';
  }

  /** สิ่งที่ต้องทำ — ไม่มีอะไรค้าง (หรือยังไม่รู้) → ซ่อนทั้งส่วน */
  function todoCard() {
    var rows = [];
    if (debt && debt.overdue[0]) rows.push(['home-todo-overdue', 'summary', 'warn', 'ลูกหนี้เลยกำหนด ' + debt.overdue[0] + ' บิล', money(debt.overdue[1]) + ' บาท', 'late']);
    if (debt && debt.soon[0]) rows.push(['home-todo-soon', 'summary', 'calendar', 'ลูกหนี้ใกล้ครบกำหนด ' + debt.soon[0] + ' บิล', money(debt.soon[1]) + ' บาท', 'near']);
    var low = stockLow && Array.isArray(stockLow.products) ? stockLow.products.length : 0;
    if (low) rows.push(['home-todo-stock', 'stock?tab=low', 'stock', 'สินค้าใกล้หมด ' + low + ' รายการ', 'ดูสต็อก', 'near']);
    if (!rows.length) return '';
    return '<section class="card" id="home-todo"><h2>สิ่งที่ต้องทำ</h2><ul class="list">' + rows.map(function (r) {
      return '<li><a class="home-todo-row ' + r[5] + '" id="' + r[0] + '" href="' + r[1] + '">' + iconSvg(r[2]) +
        '<span class="t">' + esc(r[3]) + '</span><span class="v">' + esc(r[4]) + '</span>' + iconSvg('next') + '</a></li>';
    }).join('') + '</ul></section>';
  }

  /** บิลล่าสุด 5 ใบ ทั้งสองประเภท (รวมใบยกเลิก ไม่รวม 0000) — แตะ = ดู PDF */
  function recentCard() {
    if (!sales || !Array.isArray(sales.recent)) return '';
    var list = sales.recent.slice(0, RECENT);
    var today = sales.today;
    return '<section class="card" id="home-recent"><h2>บิลล่าสุด <span class="count">' + RECENT + ' ใบ</span></h2><ul class="list">' + (list.length ? list.map(function (r) {
      var kind = r[0], no = r[1], date = r[2], at = String(r[3] || ''), cancelled = !!r[6];
      var receipt = kind === 't' && r[7] === TAX_RECEIPT_TYPE;
      var when = (date === today ? 'วันนี้' : formatThaiDateShort(date)) + (at.length > 15 && date === today ? ' ' + at.slice(11, 16) : '');
      var href = 'view?type=' + (kind === 'c' ? 'cash' : 'tax') + '&no=' + encodeURIComponent(String(no)) +
        (receipt ? '&dt=rc' : kind === 't' && r[7] && r[7] !== DEFAULT_DOC_TYPES[0] ? '&dt=' + encodeURIComponent(r[7]) : '');
      return '<li><a class="home-bill" href="' + esc(href) + '"><span class="nm"><span class="n">' + esc(r[4] || '-') + '</span>' +
        '<span class="small muted">' + esc(kind === 'c' ? 'เงินสด ' + no : (receipt ? 'ใบเสร็จ ' : 'ใบกำกับ ') + no) + ' · ' + esc(when) + '</span></span>' +
        (cancelled ? '<span class="badge red">ยกเลิก</span>' : '') + '<b class="num">' + money(r[5]) + '</b></a></li>';
    }).join('') : '<li class="empty">ยังไม่มีบิล</li>') + '</ul></section>';
  }

  /** ชื่อจากแท็บผู้ใช้ + ตรวจสิทธิ์ (ไม่บังหน้าจอระหว่างรอ) */
  async function check() {
    var r = await LiffApp.api('whoami', { type: 'tax' });
    if (!r.ok) {
      if (LiffApp.isAuthFail(r.code)) LiffApp.showApiError(r, scr);
      return;
    }
    if (Shell.isCurrent(scr) && $('menu-name')) $('menu-name').textContent = r.name || LiffApp.profileName() || '';
  }

  Shell.define('menu', {
    title: 'เมนูหลัก',
    build: function (s) {
      scr = s;
      s.root.innerHTML = '<div class="topbar"><h1>หน้าแรก</h1><div class="sub">ระบบออกบิล</div></div><div id="view"></div>';
    },
    show: function (s) {
      recall();
      draw();
      Shell.drawn(s);
      fetchAll();
      return check();
    }
  });
})();
