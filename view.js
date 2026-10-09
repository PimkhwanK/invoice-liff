/*
 * view.js — ดู PDF ในแอป LINE ก่อนดาวน์โหลด (รอบที่ 5A)
 *   เปิดด้วย https://liff.line.me/<LIFF ID>/view?no=<เลขที่> (ปุ่ม "ดู PDF" ในการ์ดแชท และหน้าประวัติ)
 *   → getPdf (เซิร์ฟเวอร์ตรวจ idToken + แท็บผู้ใช้) ได้ไฟล์ PDF เป็น base64 → แสดงด้วย pdf.js กว้างพอดีจอ ซูมได้
 *   ปุ่ม "ดาวน์โหลด / ส่งต่อ" = ลิงก์ Drive เดิม (botPdfUrl) เปิดนอกแอป LINE
 *   ใบที่ยังไม่มี PDF → ปุ่ม "สร้าง PDF ใหม่" (regeneratePdf withPdf ได้ไฟล์กลับมาในคำขอเดียว)
 * pdf.js 3.11.174 จาก cdnjs (ตรวจ SRI) worker โหลดจาก cdnjs เวอร์ชันเดียวกัน
 * รอบ 6 ข้อ 3.5: หน้าจอหนึ่งของแอปหน้าเดียว (shell.js)
 *   pdf.js โหลดตอนเข้าหน้าจอนี้ครั้งแรกเท่านั้น (พร้อมกับคำขอ getPdf) / ไม่ใช้ข้อมูลของ AppData (เปิดจากการ์ดแชทได้ไฟล์ในคำขอเดียว)
 *   กลับมาดูใบเดิม → แสดงที่วาดไว้ ไม่โหลดใหม่ (ยกเว้นใบนั้นถูกยกเลิก / สร้าง PDF ใหม่ในแอประหว่างนั้น) / ปุ่ม "‹ กลับ" เมื่อเปิดมาจากหน้าอื่นในแอป
 */
(function () {
  var esc = LiffApp.esc;
  var scr = null;
  var view = null;
  var PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  // สคริปต์ pdf.js เวอร์ชันตายตัว + SRI (ไฟล์ถูกแก้ = เบราว์เซอร์ไม่โหลด) — ใส่ในหน้าตอนเข้าหน้าจอนี้ครั้งแรก
  var PDFJS_TAG = '<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js" integrity="sha512-q+4liFwdPC/bNdhUpZx6aXDx/h77yEQtn4I1slHydcbZK34nLaR3cAeYSJshoxIOq3mjEf7xJE8YWIUHMn+oCQ==" crossorigin="anonymous" referrerpolicy="no-referrer"></script>';
  var ZOOMS = [1, 1.5, 2, 3];
  var MAX_CANVAS_PIXELS = 16000000; // iPhone วาด canvas ใหญ่กว่านี้ไม่ได้ (จอขาว)
  var S = { no: -1, doc: null, pdf: null, zoom: 0, renderId: 0, state: '', stale: false, width: 0, loadId: 0 };
  var pdfjsLoading = null;
  function $(id) { return scr.$(id); }

  /** โหลด pdf.js ครั้งเดียวต่อการเปิดแอป → true ถ้าใช้ได้ */
  function loadPdfJs() {
    if (typeof pdfjsLib !== 'undefined') return Promise.resolve(true);
    if (pdfjsLoading) return pdfjsLoading;
    pdfjsLoading = new Promise(function (resolve) {
      var t = document.createElement('template');
      t.innerHTML = PDFJS_TAG;
      var tag = t.content.firstChild;
      var s = document.createElement('script'); // สคริปต์จาก innerHTML ไม่ทำงาน → สร้างใหม่ด้วยค่าเดียวกัน
      for (var i = 0; i < tag.attributes.length; i++) s.setAttribute(tag.attributes[i].name, tag.attributes[i].value);
      s.onload = function () { resolve(typeof pdfjsLib !== 'undefined'); };
      s.onerror = function () { pdfjsLoading = null; s.remove(); resolve(false); }; // ครั้งหน้าลองโหลดใหม่
      document.head.appendChild(s);
    });
    return pdfjsLoading;
  }

  /** เลขที่จาก ?no= (0 = บิลทดสอบ 0000) / ไม่มีหรือไม่ถูกต้อง → -1 */
  function docNoParam(v) {
    v = v || '';
    return /^[0-9]{1,12}$/.test(v) ? Number(v) : -1;
  }

  async function load(no) {
    var id = ++S.loadId;
    S.no = no;
    S.pdf = null;
    S.state = 'loading';
    S.stale = false;
    if (S.no < 0) {
      S.state = 'error';
      return LiffApp.showError({ title: 'ไม่ได้ระบุเลขที่เอกสาร', text: 'กรุณาเปิดจากปุ่ม "ดู PDF" ในแชท หรือจากหน้าประวัติเอกสาร' }, null, 'no_doc', scr);
    }
    $('title').textContent = 'เอกสาร #' + LiffApp.docNoText(S.no);
    $('subtitle').textContent = 'ใบกำกับภาษี';
    LiffApp.loading('กำลังโหลด PDF เลขที่ ' + LiffApp.docNoText(S.no) + '…', view);
    var lib = loadPdfJs(); // โหลดพร้อมกับรอเซิร์ฟเวอร์
    var r = await LiffApp.api('getPdf', { docNo: S.no });
    if (id !== S.loadId) return; // เปิดใบอื่นไปแล้ว
    if (!r.ok) { S.state = 'error'; return LiffApp.showApiError(r, scr); }
    show(r, lib);
  }

  function head(d) {
    var c = d.status === 'cancelled';
    return '<section class="card" id="doc-head"><div class="doc-head"><span class="no' + (c ? ' cancel' : '') + '">#' + LiffApp.docNoText(d.doc_no) + '</span>' +
      (c ? '<span class="badge red">ยกเลิก</span>' : '<span class="badge">ออกแล้ว</span>') + '</div>' +
      '<div>' + esc(d.shop_legal_name || d.shop_short_name) + '</div>' +
      '<div class="small muted">' + formatThaiDate(d.doc_date) + ' · ' + esc(d.doc_type) + ' · <b class="num">' + formatMoney(d.total) + '</b> บาท</div>' +
      (c ? '<div class="small cancel-reason">เหตุผลที่ยกเลิก: ' + esc(d.cancelled_reason) + '</div>' : '') + '</section>';
  }

  function show(r, lib) {
    S.doc = r.document;
    S.state = 'shown';
    $('subtitle').textContent = (S.doc.shop_short_name || '') + (S.doc.status === 'cancelled' ? ' · ยกเลิกแล้ว' : '');
    if (!r.hasPdf) {
      view.innerHTML = head(S.doc) +
        '<section class="card" id="no-pdf"><p style="margin-top:0"><span class="badge amber">ยังไม่มี PDF</span></p>' +
        '<p class="small muted">เอกสารถูกบันทึกแล้ว แต่ยังสร้างไฟล์ PDF ไม่สำเร็จ กดปุ่มด้านล่างเพื่อสร้างใหม่ (เลขที่เดิม ไม่ออกเลขใหม่)</p>' +
        '<button type="button" class="btn primary block" id="btn-regen">สร้าง PDF ใหม่</button><div id="regen-msg"></div></section>';
      $('btn-regen').addEventListener('click', regenerate);
      return;
    }
    view.innerHTML =
      '<div class="pdf-bar" id="pdf-bar"><div class="zoom">' +
      '<button type="button" class="btn sm" id="zoom-out" aria-label="ย่อ">' + iconSvg('minus') + '</button><span id="zoom-label">พอดีจอ</span>' +
      '<button type="button" class="btn sm" id="zoom-in" aria-label="ขยาย">' + iconSvg('plus') + '</button></div><span class="grow"></span>' +
      '<a class="btn sm primary" id="btn-download" href="' + esc(r.pdfUrl) + '" target="_blank" rel="noopener">' + iconSvg('download') + '<span>ดาวน์โหลด / ส่งต่อ</span></a></div>' +
      head(S.doc) + '<div class="pdf-pages" id="pages"></div>';
    $('btn-download').addEventListener('click', function (e) {
      if (LiffApp.openExternal(r.pdfUrl)) e.preventDefault(); // ในแอป LINE: เปิดเบราว์เซอร์ภายนอก (ดาวน์โหลด/แชร์ได้)
    });
    $('zoom-in').addEventListener('click', function () { setZoom(S.zoom + 1); });
    $('zoom-out').addEventListener('click', function () { setZoom(S.zoom - 1); });
    if (r.pdfError || !r.pdfBase64) return showRenderError(r.pdfError || 'เปิด PDF ในแอปไม่สำเร็จ');
    openPdf(r.pdfBase64, lib || loadPdfJs());
  }

  function showRenderError(msg) {
    $('pdf-bar').querySelector('.zoom').classList.add('hidden');
    $('pages').outerHTML = '<section class="card alert err" id="render-error">' + esc(msg) +
      '<br>กด "ดาวน์โหลด / ส่งต่อ" ด้านบนเพื่อเปิดนอกแอป LINE</section>';
  }

  async function openPdf(b64, lib) {
    var pages = $('pages');
    var id = S.loadId;
    LiffApp.loading('กำลังแสดงผล PDF…', pages);
    var ok = await lib;
    if (id !== S.loadId) return;
    if (!ok) return showRenderError('โหลดตัวแสดง PDF ไม่สำเร็จ (ตรวจสอบอินเทอร์เน็ต)');
    try {
      pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
      var bin = atob(b64);
      var bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      var pdf = await pdfjsLib.getDocument({ data: bytes, isEvalSupported: false }).promise;
      if (id !== S.loadId) return;
      S.pdf = pdf;
      S.zoom = 0;
      await render();
    } catch (e) {
      console.error(e);
      showRenderError('แสดง PDF ในแอปไม่สำเร็จ');
    }
  }

  function setZoom(z) {
    z = Math.max(0, Math.min(ZOOMS.length - 1, z));
    if (z === S.zoom || !S.pdf) return;
    S.zoom = z;
    render();
  }

  /** วาดทุกหน้า: กว้างพอดีจอ × ระดับซูม (ความละเอียดตามจอ แต่ไม่เกินที่มือถือวาดได้) */
  async function render() {
    var id = ++S.renderId;
    var pages = $('pages');
    if (!pages || !S.pdf || !pages.isConnected) return; // หน้าจอไม่ได้แสดงอยู่ → วาดตอนกลับมา
    var zoom = ZOOMS[S.zoom];
    $('zoom-label').textContent = S.zoom === 0 ? 'พอดีจอ' : Math.round(zoom * 100) + '%';
    $('zoom-out').disabled = S.zoom === 0;
    $('zoom-in').disabled = S.zoom === ZOOMS.length - 1;
    var width = Math.max(200, pages.clientWidth - 16);
    S.width = pages.clientWidth;
    var dpr = Math.min(window.devicePixelRatio || 1, 3);
    var canvases = [];
    for (var n = 1; n <= S.pdf.numPages; n++) {
      var page = await S.pdf.getPage(n);
      var base = page.getViewport({ scale: 1 });
      var css = (width / base.width) * zoom;
      var px = css * dpr;
      if (base.width * px * base.height * px > MAX_CANVAS_PIXELS) px = Math.sqrt(MAX_CANVAS_PIXELS / (base.width * base.height));
      var vp = page.getViewport({ scale: px });
      var canvas = document.createElement('canvas');
      canvas.width = Math.floor(vp.width);
      canvas.height = Math.floor(vp.height);
      canvas.style.width = Math.floor(base.width * css) + 'px';
      canvas.style.height = Math.floor(base.height * css) + 'px';
      canvas.setAttribute('aria-label', 'หน้า ' + n + ' ของเอกสาร #' + LiffApp.docNoText(S.no));
      await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
      if (id !== S.renderId) return; // มีการซูมใหม่ระหว่างวาด
      canvases.push(canvas);
    }
    pages.replaceChildren.apply(pages, canvases);
    pages.dataset.rendered = String(canvases.length);
    pages.dataset.zoom = String(zoom);
  }

  var resizeTimer = null;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { if (S.pdf && Shell.isCurrent(scr)) render(); }, 250);
  });

  async function regenerate() {
    var btn = $('btn-regen');
    var msg = $('regen-msg');
    var no = S.no;
    btn.disabled = true;
    btn.textContent = 'กำลังสร้าง PDF… อาจใช้เวลา 10–20 วินาที';
    msg.innerHTML = '';
    var r = await LiffApp.api('regeneratePdf', { docNo: no, withPdf: true });
    if (no !== S.no) return;
    if (!r.ok) {
      if (LiffApp.isDenied(r.code) || r.code === 'token_expired' || r.code === 'no_token' || r.code === 'token_invalid') return LiffApp.showApiError(r, scr);
      btn.disabled = false;
      btn.textContent = 'สร้าง PDF ใหม่';
      msg.innerHTML = '<div class="alert err" id="regen-error" style="margin-top:10px">' + LiffApp.errorHtml(r.error || 'สร้าง PDF ไม่สำเร็จ') + '</div>';
      return;
    }
    LiffApp.toast('สร้าง PDF ของเอกสาร #' + LiffApp.docNoText(no) + ' แล้ว');
    if (AppData.has()) AppData.patchDoc(no, { hasPdf: true, pdfUrl: r.pdfUrl });
    S.stale = false; // ไฟล์ที่ได้มาคือไฟล์ล่าสุดแล้ว
    if (r.pdfBase64) return show({ document: S.doc, hasPdf: true, pdfUrl: r.pdfUrl, pdfBase64: r.pdfBase64 });
    load(no); // ได้ลิงก์แต่ไม่ได้ไฟล์มาด้วย → โหลดใหม่
  }

  // เอกสารใบที่เปิดอยู่ถูกยกเลิก / สร้าง PDF ใหม่จากหน้าจออื่นในแอป → กลับมาหน้าจอนี้แล้วโหลดใหม่
  AppData.onChange(function (kind, no) {
    if (kind === 'doc' && no === S.no) S.stale = true;
  });

  function drawBack() {
    $('btn-back-app').classList.toggle('hidden', !Shell.canBack());
  }

  Shell.define('view', {
    title: 'ดู PDF',
    build: function (s) {
      scr = s;
      s.root.innerHTML =
        '<div class="topbar"><div class="row"><button type="button" class="btn ghost back hidden" id="btn-back-app" aria-label="กลับ">' + iconSvg('back') + '<span>กลับ</span></button>' +
        '<h1 id="title" class="grow">ดู PDF</h1></div><div class="sub" id="subtitle">ใบกำกับภาษี</div></div>' +
        '<div id="view" aria-live="polite"></div>';
      view = $('view');
      $('btn-back-app').addEventListener('click', function () { Shell.back(); });
    },
    show: function (s, params) {
      drawBack();
      var no = docNoParam(params.no);
      if (no >= 0 && no === S.no && S.state === 'shown' && !S.stale) {
        // ใบเดิมที่แสดงอยู่แล้ว: ไม่ถามเซิร์ฟเวอร์ใหม่ — ขนาดจอเปลี่ยนระหว่างไปหน้าอื่น → วาดใหม่
        var pages = $('pages');
        if (S.pdf && pages && pages.clientWidth !== S.width) render();
        return;
      }
      return load(no);
    }
  });
})();
