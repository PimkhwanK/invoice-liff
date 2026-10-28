/*
 * history.js — หน้าประวัติเอกสารบน LIFF จริง (ย้ายจาก public/history.html ของระบบจำลอง หน้าตาและขั้นตอนเดิม)
 *   ค้นหาร้านช่องเดียว (ชื่อย่อ ชื่อเต็ม เลขภาษี — search.js ตัวเดียวกับระบบจำลอง) รวมร้านที่ปิด
 *   แตะร้าน → เอกสารทั้งหมด ใหม่ → เก่า, ยอดรวมไม่นับใบที่ยกเลิก, ป้าย "ยกเลิก" + เหตุผล, ออกโดย / ยกเลิกโดย
 *   ปุ่ม "ดู PDF" → หน้าจอ view?no=<เลขที่> (ดูในแอป LINE + ปุ่มดาวน์โหลด / ส่งต่อ) / ใบที่ไม่มี PDF มีปุ่ม "สร้าง PDF ใหม่" (regeneratePdf)
 * รอบ 6 ข้อ 3.5: หน้าจอหนึ่งของแอปหน้าเดียว (shell.js) — ร้าน + เอกสารล่าสุดจาก AppData (appData ตอนเปิดแอป)
 *   จำนวนเอกสารของแต่ละร้านมาจากเซิร์ฟเวอร์ (shopStats) / ร้านที่มีเอกสารมากกว่าที่ส่งมา → โหลดเพิ่มตอนแตะร้าน (listDocuments) แล้วจำไว้
 *   แตะร้าน = เพิ่มรายการใน history (ปุ่มย้อนกลับกลับไปหน้าค้นหา) / ?shopId= เปิดร้านนั้นตรง ๆ
 * รอบ 10: โหมดใบเงินสด = ร้านและเอกสารของไฟล์ใบเงินสด (เลขที่เป็นข้อความ เช่น 1069-15)
 * รอบ 33: ปุ่มมุมมอง 2 ปุ่มใต้หัวข้อ (#hist-mode) — "เลือกร้าน" (แบบเดิม) / "บิลล่าสุด 10 ใบ" (#recent)
 *   รอบ 35: ค่าเริ่มต้น = เลือกร้าน ทุกครั้งที่เข้าหน้าประวัติ (ไม่จำมุมมอง) — ยกเว้นกดย้อนกลับ (เช่น จากหน้าดู PDF) = มุมมองเดิม
 *   บิลล่าสุด = เรียงตามเวลาที่ออก (created_at — เซิร์ฟเวอร์รุ่นก่อนรอบ 33 ไม่ส่ง → ลำดับเลขที่เดิม) / แตะแถว = ดู PDF เหมือนมุมมองเดิม
 *   ใบเสร็จที่เลขซ้ำกับใบกำกับ: หัวแถว "#25 ใบเสร็จรับเงิน" (docLabel) + data-dt
 */
(function () {
  var esc = LiffApp.esc;
  var scr = null;
  var view = null;         // #hv (เนื้อหาใต้ปุ่มมุมมอง)
  var mode = 'shops';      // 'shops' | 'recent' — รอบ 35: เข้าหน้านี้ใหม่ = shops เสมอ (ย้อนกลับ = คงไว้)
  var RECENT_N = 10;
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
  async function show(s, params, how) {
    if (!how || (how.nav !== 'pop' && how.nav !== 'replace')) mode = 'shops'; // replace = กดปุ่มมุมมองขณะดูบิลของร้าน
    frame();
    if (!AppData.has()) LiffApp.loading('กำลังโหลดข้อมูล…', view);
    var r = await AppData.ensure();
    if (!r.ok) { failed = true; return LiffApp.showApiError(r, scr); }
    failed = false;
    frame(); // หน้าแสดงข้อผิดพลาดแทนที่ทั้ง #view → สร้างปุ่มมุมมองใหม่
    var fresh = scr.seen !== AppData.version();
    if (fresh) sortShops();
    var shop = params.shopId ? findShop(params.shopId) : null;
    markMode(shop ? 'shops' : mode);
    if (shop) {
      if (!fresh && current && String(current.shop_id) === String(shop.shop_id) && $('docs')) return;
      showShop(shop);
    } else if (mode === 'recent') {
      if (!fresh && !current && $('recent')) return;
      showRecent();
    } else {
      if (!fresh && !current && $('q')) return;
      fromSearch = false;
      showSearch();
    }
    Shell.drawn(scr);
  }

  // ---------- รอบ 33: ปุ่มมุมมอง
  function frame() {
    if (!$('hv')) {
      $('view').innerHTML =
        '<div class="seg-choice hist-mode" id="hist-mode" role="radiogroup" aria-label="มุมมอง">' +
        '<label><input type="radio" name="hist-mode" value="shops">เลือกร้าน</label>' +
        '<label><input type="radio" name="hist-mode" value="recent">บิลล่าสุด ' + RECENT_N + ' ใบ</label></div>' +
        '<div id="hv"></div>';
      $('hist-mode').addEventListener('change', function (e) {
        if (e.target.name !== 'hist-mode') return;
        mode = e.target.value;
        if (current) return Shell.go('history', {}, { replace: true }); // กำลังดูบิลของร้าน → กลับหน้ารายการ
        markMode(mode);
        if (mode === 'recent') showRecent();
        else { fromSearch = false; showSearch(); }
      });
    }
    view = $('hv');
  }

  function markMode(m) {
    Array.prototype.forEach.call(scr.root.querySelectorAll('input[name=hist-mode]'), function (i) { i.checked = i.value === m; });
    $('subtitle').textContent = m === 'recent' ? 'บิลที่ออกล่าสุด แตะเพื่อดูบิล' : 'ค้นหาร้าน แล้วแตะเพื่อดูบิล';
  }

  /** ข้อมูลในแอปเปลี่ยน: วาดหน้าเดิมใหม่ (คงคำค้น / ร้านที่ดูอยู่ / ตำแหน่งเลื่อน) */
  function update() {
    if (!AppData.has()) return;
    sortShops();
    Shell.drawn(scr);
    var q = $('q');
    if (q) return drawShops(q.value);
    if ($('recent')) return drawRecent();
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
      '<input type="search" id="q" placeholder="' + (LiffApp.isCash() ? 'พิมพ์ชื่อร้าน หรือชื่อเต็ม' : 'พิมพ์ชื่อร้าน ชื่อเต็ม หรือเลขภาษี') + '" autocomplete="off"></section>' +
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
      return '<li role="button" tabindex="0" class="tap shop-row" data-id="' + esc(s.shop_id) + '"><div class="t"><div class="n">' + esc(s.short_name) +
        (s.active ? '' : ' <span class="badge gray">ปิด</span>') + '</div><div class="s">' + esc(s.legal_name) + '</div></div>' +
        '<div class="c"><b class="num">' + st.count + '</b> ใบ' +
        (st.count && st.lastDate ? '<br>ล่าสุด ' + formatThaiDate(st.lastDate) : '') + '</div></li>';
    }).join('') : '<li class="empty">ไม่พบร้านที่ค้นหา</li>';
  }

  // ---------- รอบ 33: บิลล่าสุด
  function showRecent() {
    current = null;
    view.innerHTML = '<section class="card"><ul class="list" id="recent"></ul></section>';
    $('recent').addEventListener('click', onDocClick);
    drawRecent();
    Shell.scrollTop(scr);
  }

  function drawRecent() {
    var list = latestDocs(AppData.recentDocs(), RECENT_N);
    $('recent').innerHTML = list.length ? list.map(function (d) { return docRow(d, true); }).join('') : '<li class="empty">ยังไม่มีบิล</li>';
  }

  /** n ใบที่ออกล่าสุด — ทุกใบมี created_at → เรียงตามเวลาที่ออก (เท่ากัน = ลำดับเดิม) / ไม่มี (เซิร์ฟเวอร์รุ่นเก่า) → ลำดับเดิม (เลขที่) */
  function latestDocs(docs, n) {
    var all = docs.map(function (d, i) { return { d: d, i: i, at: String(d.created_at || '') }; });
    if (all.every(function (x) { return x.at; })) {
      all.sort(function (a, b) { return a.at > b.at ? -1 : a.at < b.at ? 1 : a.i - b.i; });
    }
    return all.slice(0, n).map(function (x) { return x.d; });
  }

  /** แตะแถวบิล (ที่ไม่ใช่ปุ่ม) = ดู PDF / ปุ่ม "สร้าง PDF ใหม่" */
  function onDocClick(e) {
    var b = e.target.closest('[data-regen]');
    if (b) return regenerate(b);
    if (e.target.closest('a, button')) return;
    var li = e.target.closest('li.doc');
    var a = li && li.querySelector('a[data-pdf]');
    if (a) a.click();
  }

  // ---------- เอกสารของร้าน
  function showShop(shop, keepScroll) {
    current = shop;
    view.innerHTML =
      '<section class="card chosen"><div class="t"><div class="n" id="shop-name">' + esc(shop.short_name) +
      (shop.active ? '' : ' <span class="badge gray">ปิด</span>') + '</div>' +
      '<div class="small muted">' + esc(shop.legal_name || '') + '</div></div>' +
      '<button type="button" class="btn sm" id="change">เปลี่ยนร้าน</button></section>' +
      '<section class="card" id="shop-docs"></section>';
    $('change').addEventListener('click', function () {
      if (fromSearch && Shell.canBack()) Shell.back(); // กลับหน้าค้นหาเดิม (เหมือนปุ่มย้อนกลับ)
      else Shell.go('history', {}, { replace: true });
    });
    $('shop-docs').addEventListener('click', function (e) {
      onDocClick(e);
      var retry = e.target.closest('#docs-retry');
      if (retry) showShop(shop);
    });
    if (!keepScroll) Shell.scrollTop(scr);
    if (AppData.shopComplete(shop.shop_id)) return drawDocs(AppData.docsOfShop(shop.shop_id));
    // ร้านนี้มีเอกสารมากกว่าที่โหลดมาตอนเปิดแอป → โหลดเพิ่มครั้งเดียว (จำไว้ แตะร้านนี้อีกไม่ต้องโหลด)
    LiffApp.loading('กำลังโหลดบิลของร้านนี้…', $('shop-docs'));
    AppData.loadShopDocs(shop.shop_id).then(function (r) {
      if (current !== shop || !$('shop-docs')) return; // เปลี่ยนร้านไปแล้ว
      if (r.ok) return drawDocs(r.documents);
      if (LiffApp.isAuthFail(r.code)) return LiffApp.showApiError(r, scr);
      $('shop-docs').innerHTML = '<div class="alert err" id="docs-error">' + LiffApp.errorHtml(r.error || 'โหลดบิลไม่สำเร็จ') + '</div>' +
        '<button type="button" class="btn block" id="docs-retry" style="margin-top:10px">ลองอีกครั้ง</button>';
    });
  }

  function drawDocs(mine) {
    var issued = mine.filter(function (d) { return d.status !== 'cancelled'; });
    var sum = issued.reduce(function (a, d) { return a + toSatang(d.total); }, 0);
    $('shop-docs').innerHTML =
      '<div class="summary"><span>ทั้งหมด <b id="doc-count">' + mine.length + '</b> ใบ</span>' +
      '<span>ยอดรวมไม่นับใบยกเลิก <b class="num" id="doc-sum">' + formatMoney(fromSatang(sum)) + '</b></span></div>' +
      '<ul class="list" id="docs">' + (mine.length ? mine.map(docRow).join('') : '<li class="empty">ร้านนี้ยังไม่มีบิล</li>') + '</ul>';
  }

  /** ปุ่ม "สร้าง PDF ใหม่" สำหรับใบที่ไม่มี PDF (เซิร์ฟเวอร์ตรวจ idToken + แท็บผู้ใช้) */
  async function regenerate(btn) {
    var no = btn.getAttribute('data-regen');
    var type = btn.getAttribute('data-dt') || ''; // รอบ 24: ประเภท
    btn.disabled = true;
    btn.textContent = 'กำลังสร้าง PDF…';
    var r = await LiffApp.api('regeneratePdf', { docNo: LiffApp.docParam(no), docType: type });
    if (!r.ok) {
      if (LiffApp.isDenied(r.code) || r.code === 'token_expired') return LiffApp.showApiError(r, scr);
      btn.disabled = false;
      btn.textContent = 'สร้าง PDF ใหม่';
      LiffApp.toast(r.error || 'สร้าง PDF ไม่สำเร็จ', true);
      return;
    }
    AppData.patchDoc(LiffApp.docParam(no), { hasPdf: true, pdfUrl: r.pdfUrl }, type); // วาดรายการใหม่ (มีปุ่ม "ดู PDF")
    LiffApp.toast('สร้าง PDF ของบิล ' + LiffApp.docLabel(no, type) + ' แล้ว');
  }

  /** ปุ่ม "ดู PDF" → หน้าจอ view (ดูในแอป LINE ก่อน มีปุ่มดาวน์โหลด / ส่งต่อในหน้านั้น) */
  function pdfActs(no, type) {
    return '<div class="acts"><a class="btn sm" data-pdf href="' + esc(LiffApp.viewHref(no, type)) + '">' + iconSvg('file') + '<span>ดู PDF</span></a></div>';
  }

  /** withShop (รอบ 33 บิลล่าสุด) = มีชื่อร้าน / หัวแถว: ใบเสร็จบอกประเภท (เลขซ้ำกับใบกำกับได้) */
  function docRow(d, withShop) {
    var c = d.status === 'cancelled';
    var shop = withShop ? d.shop_short_name || d.shop_legal_name || (findShop(d.shop_id) || {}).short_name || '' : '';
    return '<li class="doc' + (d.hasPdf ? ' doc-tap' : '') + '" data-no="' + esc(d.doc_no) + '" data-dt="' + esc(d.doc_type || '') + '">' +
      '<div class="no' + (c ? ' cancel' : '') + '">' + esc(LiffApp.docLabel(d.doc_no, d.doc_type)) + ' ' + (c ? '<span class="badge red">ยกเลิก</span>' : '<span class="badge">ออกแล้ว</span>') + '</div>' +
      '<div class="amt num">' + formatMoney(d.total) + '</div>' +
      (withShop ? '<div class="shop-n">' + esc(shop) + '</div>' : '') +
      '<div class="meta">' + formatThaiDate(d.doc_date) + ' · ' + (LiffApp.isCash() ? esc(CASH_DOC_TITLE) + ' · ' + esc(d.sale_type || CASH_DOC_SALE_TYPE) : esc(d.doc_type) + ' · ' + esc(d.sale_type)) +
      (d.issued_by ? '<br>ออกโดย ' + esc(d.issued_by) : '') +
      (c ? '<br>เหตุผล: ' + esc(d.cancelled_reason) + (d.cancelled_by ? ' · ยกเลิกโดย ' + esc(d.cancelled_by) : '') : '') + '</div>' +
      (d.hasPdf
        ? pdfActs(d.doc_no, d.doc_type)
        : '<div class="acts"><span class="badge amber no-pdf">ไม่มี PDF</span>' +
          '<button type="button" class="btn sm" data-regen="' + esc(d.doc_no) + '" data-dt="' + esc(LiffApp.isCash() ? '' : d.doc_type || '') + '">สร้าง PDF ใหม่</button></div>') +
      '</li>';
  }

  Shell.define('history', {
    title: 'ประวัติเอกสาร',
    build: function (s) {
      scr = s;
      s.root.innerHTML =
        '<div class="topbar"><h1>ประวัติเอกสาร</h1><div class="sub" id="subtitle"></div></div>' +
        '<div id="view" aria-live="polite"></div>';
      view = $('view');
    },
    show: function (s, params, how) {
      if (failed) s.seen = -2; // โหลดไม่สำเร็จครั้งก่อน → วาดใหม่
      return show(s, params, how);
    },
    update: update
  });
})();
