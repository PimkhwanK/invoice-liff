/*
 * history.js — หน้าประวัติเอกสารบน LIFF จริง (ย้ายจาก public/history.html ของระบบจำลอง หน้าตาและขั้นตอนเดิม)
 *   ค้นหาร้านช่องเดียว (ชื่อย่อ ชื่อเต็ม เลขภาษี — search.js ตัวเดียวกับระบบจำลอง) รวมร้านที่ปิด
 *   แตะร้าน → เอกสารทั้งหมด ใหม่ → เก่า, ยอดรวมไม่นับใบที่ยกเลิก, ป้าย "ยกเลิก" + เหตุผล, ออกโดย / ยกเลิกโดย
 *   ปุ่ม "ดู PDF" → หน้าจอ view?no=<เลขที่> (ดูในแอป LINE + ปุ่มดาวน์โหลด / ส่งต่อ) / ใบที่ไม่มี PDF มีปุ่ม "สร้าง PDF ใหม่" (regeneratePdf)
 * รอบ 6 ข้อ 3.5: หน้าจอหนึ่งของแอปหน้าเดียว (shell.js) — ร้าน + เอกสารล่าสุดจาก AppData (appData ตอนเปิดแอป)
 *   จำนวนเอกสารของแต่ละร้านมาจากเซิร์ฟเวอร์ (shopStats) / ร้านที่มีเอกสารมากกว่าที่ส่งมา → โหลดเพิ่มตอนแตะร้าน (listDocuments) แล้วจำไว้
 *   แตะร้าน = เพิ่มรายการใน history (ปุ่มย้อนกลับกลับไปหน้าค้นหา) / ?shopId= เปิดร้านนั้นตรง ๆ
 */
(function () {
  var esc = LiffApp.esc;
  var scr = null;
  var view = null;
  var shops = [];
  var current = null;      // ร้านที่กำลังดู (null = หน้าค้นหา)
  var term = '';           // คำค้นล่าสุด (กลับมาหน้าค้นหาแล้วยังอยู่)
  var fromSearch = false;  // มาจากการแตะร้านในหน้าค้นหา → "เปลี่ยนร้าน" = ย้อนกลับ
  var failed = false;      // โหลดข้อมูลครั้งแรกไม่สำเร็จ → เข้าหน้าจอใหม่ = ลองใหม่
  function $(id) { return scr.$(id); }

  function sortShops() {
    shops = AppData.shops().slice().sort(function (a, b) { return a.short_name.localeCompare(b.short_name, 'th'); });
  }

  function findShop(id) {
    return shops.find(function (s) { return String(s.shop_id) === String(id); });
  }

  /** เข้าหน้าจอตาม URL: ?shopId= → เอกสารของร้าน / ไม่มี → ค้นหาร้าน (ข้อมูลเดิม + หน้าเดิม → ไม่ต้องวาดใหม่) */
  async function show(s, params) {
    if (!AppData.has()) LiffApp.loading('กำลังโหลดรายชื่อร้านและเอกสาร…', view);
    var r = await AppData.ensure();
    if (!r.ok) { failed = true; return LiffApp.showApiError(r, scr); }
    failed = false;
    var fresh = scr.seen !== AppData.version();
    if (fresh) sortShops();
    var shop = params.shopId ? findShop(params.shopId) : null;
    if (shop) {
      if (!fresh && current && String(current.shop_id) === String(shop.shop_id) && $('docs')) return;
      showShop(shop);
    } else {
      if (!fresh && !current && $('q')) return;
      fromSearch = false;
      showSearch();
    }
    Shell.drawn(scr);
  }

  /** ข้อมูลในแอปเปลี่ยน: วาดหน้าเดิมใหม่ (คงคำค้น / ร้านที่ดูอยู่ / ตำแหน่งเลื่อน) */
  function update() {
    if (!AppData.has()) return;
    sortShops();
    Shell.drawn(scr);
    var q = $('q');
    if (q) return drawShops(q.value);
    if (current) {
      var shop = findShop(current.shop_id);
      if (shop) showShop(shop, true);
    }
  }

  // ---------- ค้นหาร้าน
  function showSearch() {
    current = null;
    view.innerHTML =
      '<section class="card"><label class="f" for="q">ค้นหาชื่อร้าน</label>' +
      '<input type="search" id="q" placeholder="พิมพ์ชื่อร้าน ชื่อเต็ม หรือเลขภาษี" autocomplete="off"></section>' +
      '<section class="card"><ul class="list" id="shops"></ul></section>';
    var q = $('q');
    q.value = term;
    q.addEventListener('input', function () { term = q.value; drawShops(q.value); });
    $('shops').addEventListener('click', function (e) {
      var li = e.target.closest('li[data-id]');
      if (!li) return;
      fromSearch = true;
      Shell.go('history', { shopId: li.dataset.id });
    });
    drawShops(term);
    Shell.scrollTop(scr);
  }

  function drawShops(t) {
    // รวมร้านที่ปิดใช้งาน: ยังต้องค้นเจอเพื่อดูเอกสารเก่า / จำนวนใบและวันที่ล่าสุดนับทุกใบที่เซิร์ฟเวอร์
    var list = searchShops(shops, t);
    $('shops').innerHTML = list.length ? list.map(function (s) {
      var st = AppData.shopStat(s.shop_id);
      return '<li class="tap shop-row" data-id="' + esc(s.shop_id) + '"><div class="t"><div class="n">' + esc(s.short_name) +
        (s.active ? '' : ' <span class="badge gray">ปิด</span>') + '</div><div class="s">' + esc(s.legal_name) + '</div></div>' +
        '<div class="c"><b class="num">' + st.count + '</b> ใบ' +
        (st.count && st.lastDate ? '<br>ล่าสุด ' + formatThaiDate(st.lastDate) : '') + '</div></li>';
    }).join('') : '<li class="empty">ไม่พบร้านที่ค้นหา</li>';
  }

  // ---------- เอกสารของร้าน
  function showShop(shop, keepScroll) {
    current = shop;
    view.innerHTML =
      '<section class="card chosen"><div class="t"><div class="n" id="shop-name">' + esc(shop.short_name) +
      (shop.active ? '' : ' <span class="badge gray">ปิด</span>') + '</div>' +
      '<div class="small muted">' + esc(shop.legal_name) + '</div></div>' +
      '<button type="button" class="btn sm" id="change">เปลี่ยนร้าน</button></section>' +
      '<section class="card" id="shop-docs"></section>';
    $('change').addEventListener('click', function () {
      if (fromSearch && Shell.canBack()) Shell.back(); // กลับหน้าค้นหาเดิม (เหมือนปุ่มย้อนกลับ)
      else Shell.go('history', {}, { replace: true });
    });
    $('shop-docs').addEventListener('click', function (e) {
      var b = e.target.closest('[data-regen]');
      if (b) regenerate(b);
      var retry = e.target.closest('#docs-retry');
      if (retry) showShop(shop);
    });
    if (!keepScroll) Shell.scrollTop(scr);
    if (AppData.shopComplete(shop.shop_id)) return drawDocs(AppData.docsOfShop(shop.shop_id));
    // ร้านนี้มีเอกสารมากกว่าที่โหลดมาตอนเปิดแอป → โหลดเพิ่มครั้งเดียว (จำไว้ แตะร้านนี้อีกไม่ต้องโหลด)
    LiffApp.loading('กำลังโหลดเอกสารทั้งหมดของร้านนี้…', $('shop-docs'));
    AppData.loadShopDocs(shop.shop_id).then(function (r) {
      if (current !== shop || !$('shop-docs')) return; // เปลี่ยนร้านไปแล้ว
      if (r.ok) return drawDocs(r.documents);
      if (LiffApp.isAuthFail(r.code)) return LiffApp.showApiError(r, scr);
      $('shop-docs').innerHTML = '<div class="alert err" id="docs-error">' + LiffApp.errorHtml(r.error || 'โหลดเอกสารไม่สำเร็จ') + '</div>' +
        '<button type="button" class="btn block" id="docs-retry" style="margin-top:10px">ลองใหม่</button>';
    });
  }

  function drawDocs(mine) {
    var issued = mine.filter(function (d) { return d.status !== 'cancelled'; });
    var sum = issued.reduce(function (a, d) { return a + toSatang(d.total); }, 0);
    $('shop-docs').innerHTML =
      '<div class="summary"><span>ทั้งหมด <b id="doc-count">' + mine.length + '</b> ใบ</span>' +
      '<span>ยอดที่ไม่ยกเลิก <b class="num" id="doc-sum">' + formatMoney(fromSatang(sum)) + '</b></span></div>' +
      '<ul class="list" id="docs">' + (mine.length ? mine.map(docRow).join('') : '<li class="empty">ร้านนี้ยังไม่มีเอกสาร</li>') + '</ul>';
  }

  /** ปุ่ม "สร้าง PDF ใหม่" สำหรับใบที่ไม่มี PDF (เซิร์ฟเวอร์ตรวจ idToken + แท็บผู้ใช้) */
  async function regenerate(btn) {
    var no = btn.getAttribute('data-regen');
    btn.disabled = true;
    btn.textContent = 'กำลังสร้าง PDF…';
    var r = await LiffApp.api('regeneratePdf', { docNo: Number(no) });
    if (!r.ok) {
      if (LiffApp.isDenied(r.code) || r.code === 'token_expired') return LiffApp.showApiError(r, scr);
      btn.disabled = false;
      btn.textContent = 'สร้าง PDF ใหม่';
      LiffApp.toast(r.error || 'สร้าง PDF ไม่สำเร็จ', true);
      return;
    }
    AppData.patchDoc(Number(no), { hasPdf: true, pdfUrl: r.pdfUrl }); // วาดรายการใหม่ (มีปุ่ม "ดู PDF")
    LiffApp.toast('สร้าง PDF ของเอกสาร #' + no + ' แล้ว');
  }

  /** ปุ่ม "ดู PDF" → หน้าจอ view (ดูในแอป LINE ก่อน มีปุ่มดาวน์โหลด / ส่งต่อในหน้านั้น) */
  function pdfActs(no) {
    return '<div class="acts"><a class="btn sm" data-pdf href="view?no=' + encodeURIComponent(no) + '">' + iconSvg('file') + '<span>ดู PDF</span></a></div>';
  }

  function docRow(d) {
    var c = d.status === 'cancelled';
    return '<li class="doc" data-no="' + d.doc_no + '">' +
      '<div class="no' + (c ? ' cancel' : '') + '">#' + LiffApp.docNoText(d.doc_no) + ' ' + (c ? '<span class="badge red">ยกเลิก</span>' : '<span class="badge">ออกแล้ว</span>') + '</div>' +
      '<div class="amt num">' + formatMoney(d.total) + '</div>' +
      '<div class="meta">' + formatThaiDate(d.doc_date) + ' · ' + esc(d.doc_type) + ' · ' + esc(d.sale_type) +
      (d.issued_by ? '<br>ออกโดย ' + esc(d.issued_by) : '') +
      (c ? '<br>เหตุผล: ' + esc(d.cancelled_reason) + (d.cancelled_by ? ' · ยกเลิกโดย ' + esc(d.cancelled_by) : '') : '') + '</div>' +
      (d.hasPdf
        ? pdfActs(d.doc_no)
        : '<div class="acts"><span class="badge amber no-pdf">ไม่มี PDF</span>' +
          '<button type="button" class="btn sm" data-regen="' + d.doc_no + '">สร้าง PDF ใหม่</button></div>') +
      '</li>';
  }

  Shell.define('history', {
    title: 'ประวัติเอกสาร',
    build: function (s) {
      scr = s;
      s.root.innerHTML =
        '<div class="topbar"><h1>ประวัติเอกสาร</h1><div class="sub" id="subtitle">ค้นหาชื่อร้าน แล้วแตะเพื่อดูเอกสารทุกใบของร้านนั้น</div></div>' +
        '<div id="view" aria-live="polite"></div>';
      view = $('view');
    },
    show: function (s, params) {
      if (failed) s.seen = -2; // โหลดไม่สำเร็จครั้งก่อน → วาดใหม่
      return show(s, params);
    },
    update: update
  });
})();
