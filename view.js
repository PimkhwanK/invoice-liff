/*
 * view.js — ดู PDF ในแอป LINE ก่อนดาวน์โหลด (รอบที่ 5A)
 *   เปิดด้วย https://liff.line.me/<LIFF ID>/view?no=<เลขที่> (ปุ่ม "ดู PDF" ในการ์ดแชท และหน้าประวัติ)
 *   → getPdf (เซิร์ฟเวอร์ตรวจ idToken + แท็บผู้ใช้) ได้ไฟล์ PDF เป็น base64 → แสดงด้วย pdf.js กว้างพอดีจอ ซูมได้
 *   ปุ่ม "ดาวน์โหลด / ส่งต่อ" = ลิงก์ Drive เดิม (botPdfUrl) เปิดนอกแอป LINE
 *   ใบที่ยังไม่มี PDF → ปุ่ม "สร้าง PDF ใหม่" (regeneratePdf withPdf ได้ไฟล์กลับมาในคำขอเดียว)
 * pdf.js 3.11.174 จาก cdnjs (view.html ตรวจ SRI) worker โหลดจาก cdnjs เวอร์ชันเดียวกัน
 */
(function () {
  var esc = LiffApp.esc;
  var view = document.getElementById('view');
  var PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  var ZOOMS = [1, 1.5, 2, 3];
  var MAX_CANVAS_PIXELS = 16000000; // iPhone วาด canvas ใหญ่กว่านี้ไม่ได้ (จอขาว)
  var S = { no: 0, doc: null, pdf: null, zoom: 0, renderId: 0 };

  function docNoParam() {
    var v = new URLSearchParams(location.search).get('no') || '';
    return /^\d{1,12}$/.test(v) && Number(v) > 0 ? Number(v) : 0;
  }

  async function load() {
    S.no = docNoParam();
    if (!S.no) return LiffApp.showError({ title: 'ไม่ได้ระบุเลขที่เอกสาร', text: 'กรุณาเปิดจากปุ่ม "ดู PDF" ในแชท หรือจากหน้าประวัติเอกสาร' }, null, 'no_doc');
    document.getElementById('title').textContent = 'เอกสาร #' + S.no;
    LiffApp.loading('กำลังโหลด PDF เลขที่ ' + S.no + '…');
    var r = await LiffApp.api('getPdf', { docNo: S.no });
    if (!r.ok) return LiffApp.showApiError(r);
    show(r);
  }

  function head(d) {
    var c = d.status === 'cancelled';
    return '<section class="card" id="doc-head"><div class="doc-head"><span class="no' + (c ? ' cancel' : '') + '">#' + d.doc_no + '</span>' +
      (c ? '<span class="badge red">ยกเลิก</span>' : '<span class="badge">ออกแล้ว</span>') + '</div>' +
      '<div>' + esc(d.shop_legal_name || d.shop_short_name) + '</div>' +
      '<div class="small muted">' + formatThaiDate(d.doc_date) + ' · ' + esc(d.doc_type) + ' · <b class="num">' + formatMoney(d.total) + '</b> บาท</div>' +
      (c ? '<div class="small" style="color:var(--red)">เหตุผลที่ยกเลิก: ' + esc(d.cancelled_reason) + '</div>' : '') + '</section>';
  }

  function show(r) {
    S.doc = r.document;
    document.getElementById('subtitle').textContent = (S.doc.shop_short_name || '') + (S.doc.status === 'cancelled' ? ' · ยกเลิกแล้ว' : '');
    if (!r.hasPdf) {
      view.innerHTML = head(S.doc) +
        '<section class="card" id="no-pdf"><p style="margin-top:0"><span class="badge amber">ยังไม่มี PDF</span></p>' +
        '<p class="small muted">เอกสารถูกบันทึกแล้ว แต่ยังสร้างไฟล์ PDF ไม่สำเร็จ กดปุ่มด้านล่างเพื่อสร้างใหม่ (เลขที่เดิม ไม่ออกเลขใหม่)</p>' +
        '<button type="button" class="btn primary block" id="btn-regen">สร้าง PDF ใหม่</button><div id="regen-msg"></div></section>';
      document.getElementById('btn-regen').addEventListener('click', regenerate);
      return;
    }
    view.innerHTML =
      '<div class="pdf-bar" id="pdf-bar"><div class="zoom">' +
      '<button type="button" class="btn sm" id="zoom-out" aria-label="ย่อ">−</button><span id="zoom-label">พอดีจอ</span>' +
      '<button type="button" class="btn sm" id="zoom-in" aria-label="ขยาย">＋</button></div><span class="grow"></span>' +
      '<a class="btn sm primary" id="btn-download" href="' + esc(r.pdfUrl) + '" target="_blank" rel="noopener">ดาวน์โหลด / ส่งต่อ</a></div>' +
      head(S.doc) + '<div class="pdf-pages" id="pages"></div>';
    document.getElementById('btn-download').addEventListener('click', function (e) {
      if (LiffApp.openExternal(r.pdfUrl)) e.preventDefault(); // ในแอป LINE: เปิดเบราว์เซอร์ภายนอก (ดาวน์โหลด/แชร์ได้)
    });
    document.getElementById('zoom-in').addEventListener('click', function () { setZoom(S.zoom + 1); });
    document.getElementById('zoom-out').addEventListener('click', function () { setZoom(S.zoom - 1); });
    if (r.pdfError || !r.pdfBase64) return showRenderError(r.pdfError || 'เปิด PDF ในแอปไม่สำเร็จ');
    openPdf(r.pdfBase64);
  }

  function showRenderError(msg) {
    document.getElementById('pdf-bar').querySelector('.zoom').classList.add('hidden');
    document.getElementById('pages').outerHTML = '<section class="card alert err" id="render-error">' + esc(msg) +
      '<br>กด "ดาวน์โหลด / ส่งต่อ" ด้านบนเพื่อเปิดนอกแอป LINE</section>';
  }

  async function openPdf(b64) {
    var pages = document.getElementById('pages');
    LiffApp.loading('กำลังแสดงผล PDF…', pages);
    if (typeof pdfjsLib === 'undefined') return showRenderError('โหลดตัวแสดง PDF ไม่สำเร็จ (ตรวจสอบอินเทอร์เน็ต)');
    try {
      pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
      var bin = atob(b64);
      var bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      S.pdf = await pdfjsLib.getDocument({ data: bytes, isEvalSupported: false }).promise;
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
    var pages = document.getElementById('pages');
    if (!pages || !S.pdf) return;
    var zoom = ZOOMS[S.zoom];
    document.getElementById('zoom-label').textContent = S.zoom === 0 ? 'พอดีจอ' : Math.round(zoom * 100) + '%';
    document.getElementById('zoom-out').disabled = S.zoom === 0;
    document.getElementById('zoom-in').disabled = S.zoom === ZOOMS.length - 1;
    var width = Math.max(200, pages.clientWidth - 16);
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
      canvas.setAttribute('aria-label', 'หน้า ' + n + ' ของเอกสาร #' + S.no);
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
    resizeTimer = setTimeout(function () { if (S.pdf) render(); }, 250);
  });

  async function regenerate() {
    var btn = document.getElementById('btn-regen');
    var msg = document.getElementById('regen-msg');
    btn.disabled = true;
    btn.textContent = 'กำลังสร้าง PDF… อาจใช้เวลา 10–20 วินาที';
    msg.innerHTML = '';
    var r = await LiffApp.api('regeneratePdf', { docNo: S.no, withPdf: true });
    if (!r.ok) {
      if (LiffApp.isDenied(r.code) || r.code === 'token_expired' || r.code === 'no_token' || r.code === 'token_invalid') return LiffApp.showApiError(r);
      btn.disabled = false;
      btn.textContent = 'สร้าง PDF ใหม่';
      msg.innerHTML = '<div class="alert err" id="regen-error" style="margin-top:10px">' + esc(r.error || 'สร้าง PDF ไม่สำเร็จ') + '</div>';
      return;
    }
    LiffApp.toast('สร้าง PDF ของเอกสาร #' + S.no + ' แล้ว');
    if (r.pdfBase64) return show({ document: S.doc, hasPdf: true, pdfUrl: r.pdfUrl, pdfBase64: r.pdfBase64 });
    load(); // ได้ลิงก์แต่ไม่ได้ไฟล์มาด้วย → โหลดใหม่
  }

  LiffApp.start().then(function (ready) { if (ready) load(); });
})();
