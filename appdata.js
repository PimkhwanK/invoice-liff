/*
 * appdata.js — ข้อมูลของทุกหน้าในแอป LIFF หน้าเดียว (รอบ 6 ข้อ 3.5)
 *
 *   เปิดแอป → คำขอเดียว appData (ผู้ใช้, ตั้งค่า, ร้าน, สินค้า, เอกสารล่าสุด) เก็บในแอป + localStorage ('app' / ใบเงินสด 'app-cash')
 *   มีที่จำไว้ → แสดงทันที แล้วดึงใหม่เบื้องหลัง (ต่างจากเดิม → หน้าจอที่แสดงอยู่วาดใหม่)
 *   สลับหน้าจอในแอป → ใช้ข้อมูลที่มีอยู่ ไม่เรียกเซิร์ฟเวอร์
 *   หลังออกบิล / ยกเลิก / แก้ร้าน / แก้สินค้า / สร้าง PDF → แก้เฉพาะส่วนนั้นจากคำตอบของเซิร์ฟเวอร์ (addDoc, patchDoc, putShop, putProduct)
 *   เอกสารของร้านที่มีมากกว่าที่ส่งมา (shopStats.count) → loadShopDocs โหลดเพิ่มตอนแตะร้าน แล้วจำไว้ในแอป
 *
 * รอบ 10: แยกตามโหมด (LiffApp.MODE) — ใบเงินสดเป็นข้อมูลของไฟล์ใบเงินสด เลขที่เป็นข้อความ ("1069-15" / บิลทดสอบ "0000")
 *   ใบกำกับ: hasRealDoc + docNos (เลขที่ที่ใช้แล้ว — เตือนเลขซ้ำก่อนส่ง) / ใบเงินสด: hasRealDoc + monthMax (เลขที่โดยประมาณ)
 *   เซิร์ฟเวอร์ที่ยังไม่รู้จักใบเงินสด (ตอบ appData โดยไม่มี type: 'cash') → "ระบบยังไม่พร้อมใช้งาน" (ไม่ให้ออกเอกสารผิดประเภท)
 *
 * ข้อมูลที่จำไว้ใช้แสดงผลเท่านั้น — การบันทึกทุกอย่างตรวจสิทธิ์และคำนวณใหม่ที่เซิร์ฟเวอร์
 * เซิร์ฟเวอร์รุ่นก่อนรอบ 6 ข้อ 3.5 (ไม่มี appData) → ใบกำกับประกอบจาก init + historyData + listProducts แทน
 */
var AppData = (function () {
  var KEEP_DOCS = 200; // เอกสารล่าสุดที่จำไว้ (เท่ากับ API_APP_DOCS ใน Api.gs)
  // common.js โหลดไม่สำเร็จ → ไม่ throw ตรงนี้ (ตัวตรวจท้ายหน้าจัดการ) / โหมดคงที่ตลอดการเปิดแอป
  var CASH = typeof LiffApp !== 'undefined' && LiffApp.isCash();
  var STORE = CASH ? 'app-cash' : 'app';
  var TEST_NO = CASH ? '0000' : 0; // บิลทดสอบของโหมดนี้
  var S = {
    data: null,        // คำตอบของ appData (แก้ตามการบันทึกในแอป)
    cached: false,     // true = ยังเป็นข้อมูลที่จำไว้ (กำลังดึงใหม่)
    refreshing: false,
    loading: null,     // Promise ระหว่างโหลดครั้งแรก
    version: 0,        // เพิ่มทุกครั้งที่ข้อมูลเปลี่ยน — หน้าจอเทียบกับรุ่นที่วาดไว้
    shopFull: {},      // shop_id → เอกสารทั้งหมดของร้าน (โหลดเพิ่มตอนแตะร้าน)
    items: {}          // เลขที่ → รายการสินค้าในเอกสาร (คัดลอกจากบิลเก่า — เอกสารเก่าไม่เปลี่ยน)
  };
  var listeners = [];

  /** ฟังการเปลี่ยนแปลง fn(kind, detail) kind = 'fresh' | 'doc' | 'shop' | 'product' | 'sync' */
  function onChange(fn) { listeners.push(fn); }

  function emit(kind, detail) {
    listeners.forEach(function (fn) {
      try { fn(kind, detail); } catch (e) { console.error(e); }
    });
  }

  function changed(kind, detail) {
    S.version++;
    if (S.data) LiffApp.keep(STORE, S.data);
    emit(kind, detail);
  }

  function has() { return !!S.data; }
  function version() { return S.version; }
  function isCached() { return S.cached; }
  function isRefreshing() { return S.refreshing; }

  /** ข้อมูลที่จำไว้ใช้ได้ไหม (รูปแบบของรุ่นนี้) */
  function usable(d) {
    return !!d && Array.isArray(d.shops) && Array.isArray(d.products) && Array.isArray(d.documents) && !!d.shopStats && typeof d.shopStats === 'object';
  }

  /**
   * ข้อมูลพร้อมใช้: มีในแอปแล้ว → ทันที / มีที่จำไว้ → ทันที + ดึงใหม่เบื้องหลัง / ไม่มี → รอคำขอ appData
   * @returns {Promise<{ok:true}|{ok:false, code, error}>}
   */
  function ensure() {
    if (S.data) return Promise.resolve({ ok: true });
    if (S.loading) return S.loading;
    var c = LiffApp.remember(STORE);
    if (c && usable(c.data)) {
      S.data = c.data;
      S.cached = true;
      S.version++;
      refresh();
      return Promise.resolve({ ok: true, cached: true });
    }
    S.loading = fetchAll().then(function (r) {
      S.loading = null;
      if (!r.ok) return r;
      S.data = r;
      S.cached = false;
      changed('fresh');
      return { ok: true };
    });
    return S.loading;
  }

  /** ดึงข้อมูลใหม่เบื้องหลัง (ป้าย "กำลังอัปเดตข้อมูลล่าสุด…") — ต่างจากเดิม → แจ้งหน้าจอ */
  function refresh() {
    if (S.refreshing) return S.refreshing;
    S.refreshing = fetchAll().then(function (r) {
      S.refreshing = false;
      emit('sync', false);
      if (!r.ok) {
        // ไม่มีสิทธิ์แล้ว / หมดอายุ → แทนที่หน้าจอทั้งหมด (api() ล้างข้อมูลที่จำไว้แล้ว) / ติดต่อไม่ได้ → ใช้ที่จำไว้ต่อ
        if (LiffApp.isAuthFail(r.code)) { clear(); LiffApp.showApiError(r); }
        else LiffApp.toast('อัปเดตข้อมูลไม่สำเร็จ แสดงข้อมูลเดิมไปก่อน', true);
        return r;
      }
      var same = S.data && JSON.stringify(r) === JSON.stringify(S.data);
      S.data = r;
      S.cached = false;
      if (same) { LiffApp.keep(STORE, S.data); return r; }
      S.shopFull = {};
      changed('fresh');
      return r;
    });
    emit('sync', true);
    return S.refreshing;
  }

  /** ลืมข้อมูลในแอป (ไม่มีสิทธิ์แล้ว) */
  function clear() {
    S.data = null;
    S.shopFull = {};
    S.items = {};
    S.version++;
  }

  // ---------- คำขอ

  /** ใบเงินสด: เซิร์ฟเวอร์ต้องตอบ type 'cash' (Api.gs/Cash.gs รอบ 10) ไม่อย่างนั้นถือว่ายังไม่พร้อม */
  var CASH_NOT_READY = { ok: false, code: 'config', error: 'ระบบยังไม่พร้อมใช้งาน กรุณาแจ้งผู้ดูแลระบบ\nรายละเอียดสำหรับผู้ดูแลระบบ: เซิร์ฟเวอร์ยังไม่รู้จักใบเงินสด (วาง Api.gs / Cash.gs รุ่นใหม่ แล้วกด New version)' };

  async function fetchAll() {
    var r = await LiffApp.api('appData');
    if (CASH) {
      if (r.ok && r.type !== 'cash') return CASH_NOT_READY;
      if (!r.ok && r.code === 'unknown_action') return CASH_NOT_READY;
      return r;
    }
    if (r.ok || r.code !== 'unknown_action') return r;
    return fetchLegacy();
  }

  /** เซิร์ฟเวอร์รุ่นเก่า (ยังไม่ได้วาง Api.gs รอบ 6 ข้อ 3.5): ประกอบข้อมูลชุดเดียวกันจาก 3 คำขอ */
  async function fetchLegacy() {
    var all = await Promise.all([LiffApp.api('init'), LiffApp.api('historyData'), LiffApp.api('listProducts', { all: true })]);
    var init = all[0];
    var hist = all[1];
    var prods = all[2];
    if (!hist.ok) return hist;
    if (!prods.ok) return prods;
    if (!init.ok && LiffApp.isAuthFail(init.code)) return init;
    var out = { ok: true, name: init.name || '', shops: hist.shops, products: prods.products };
    if (init.ok) {
      out.today = init.today;
      out.nextDocNo = init.nextDocNo;
      out.needFirstDocNo = !!init.needFirstDocNo;
      out.config = init.config;
      out.lastDoc = init.lastDoc || null;
    } else {
      out.initError = { code: init.code, error: init.error };
    }
    var docs = hist.documents.slice().sort(function (a, b) { return b.doc_no - a.doc_no; });
    out.totalDocuments = docs.length;
    out.shopStats = statsOf(docs);
    out.documents = docs.slice(0, KEEP_DOCS);
    out.docNos = docs.map(function (d) { return Number(d.doc_no); }).filter(function (n) { return n >= 1; });
    out.hasRealDoc = out.docNos.length > 0;
    return out;
  }

  function statsOf(docs) {
    var stats = {};
    docs.forEach(function (d) {
      var k = String(d.shop_id);
      if (!stats[k]) stats[k] = { count: 0, lastDate: d.doc_date };
      stats[k].count++;
    });
    return stats;
  }

  // ---------- อ่าน

  function data() { return S.data; }
  function shops() { return S.data.shops; }
  function products() { return S.data.products; }
  function recentDocs() { return S.data.documents; }
  function name() { return S.data.name || ''; }

  /** วันนี้ตามเวลาไทยจากนาฬิกาของมือถือ (ข้อมูลที่จำไว้อาจเป็นของเมื่อวาน) */
  function phoneToday() { return isoDateTimeBangkok(new Date()).slice(0, 10); }

  /**
   * ข้อมูลตั้งต้นของฟอร์มออกบิล — รูปแบบเดียวกับ action init (preview.js ใช้ชุดนี้คำนวณ / ตรวจบนมือถือ)
   *   shops / products = ที่เลือกได้ (เปิดอยู่ / ขายอยู่) / allShops / allProducts = ทั้งหมดพร้อมสถานะ (ข้อความตรวจตรงกับเซิร์ฟเวอร์)
   * @returns {object} หรือ { error: {code, error} } ถ้าเซิร์ฟเวอร์บอกว่าตั้งค่าไม่ครบ
   */
  function issueInit() {
    var d = S.data;
    if (d.initError) return { error: d.initError };
    return {
      ok: true,
      name: d.name,
      today: S.cached ? phoneToday() : d.today,
      nextDocNo: d.nextDocNo,
      needFirstDocNo: !!d.needFirstDocNo,
      hasRealDoc: !!d.hasRealDoc,                  // รอบ 10: มีบิลจริงแล้ว → ออกบิลทดสอบไม่ได้
      docNos: Array.isArray(d.docNos) ? d.docNos : [], // ใบกำกับ: เลขที่ที่ใช้แล้ว
      monthMax: d.monthMax || {},                  // ใบเงินสด: ลำดับสูงสุดของแต่ละเดือน
      shops: d.shops.filter(function (s) { return s.active; }),
      allShops: d.shops,
      products: d.products.filter(function (p) { return p.active; }).map(function (p) {
        return { barcode: p.barcode, name: p.name, unit: p.unit, price: p.price };
      }),
      allProducts: d.products,
      config: d.config,
      lastDoc: d.lastDoc || null
    };
  }

  /** จำนวนเอกสารทั้งหมดของร้าน + วันที่ของใบล่าสุด (นับจากเซิร์ฟเวอร์ ไม่ใช่แค่ที่ส่งมา) */
  function shopStat(id) {
    return S.data.shopStats[String(id)] || { count: 0, lastDate: '' };
  }

  /** เอกสารของร้านที่มีในแอป (ใหม่ → เก่า) */
  function docsOfShop(id) {
    return S.shopFull[String(id)] || documentsOfShop(S.data.documents, id);
  }

  /** มีเอกสารของร้านครบแล้วหรือยัง */
  function shopComplete(id) {
    return !!S.shopFull[String(id)] || documentsOfShop(S.data.documents, id).length >= shopStat(id).count;
  }

  /** เอกสารทั้งหมดของร้าน: ครบแล้ว → ทันที / ยังไม่ครบ → listDocuments ครั้งเดียว แล้วจำไว้ */
  async function loadShopDocs(id) {
    if (shopComplete(id)) return { ok: true, documents: docsOfShop(id) };
    var r = await LiffApp.api('listDocuments', { shopId: id, limit: 5000 });
    if (!r.ok) return r;
    S.shopFull[String(id)] = r.documents;
    var st = S.data.shopStats[String(id)] || (S.data.shopStats[String(id)] = { count: 0, lastDate: '' });
    st.count = r.total;
    if (r.documents[0]) st.lastDate = r.documents[0].doc_date;
    return { ok: true, documents: r.documents };
  }

  /** รายการสินค้าในเอกสาร (getDocument ครั้งเดียวต่อใบ — เอกสารที่ออกแล้วรายการไม่เปลี่ยน) */
  async function docItems(no) {
    var key = String(no);
    if (S.items[key]) return { ok: true, items: S.items[key] };
    var r = await LiffApp.api('getDocument', { docNo: LiffApp.docParam(no) });
    if (r.ok) S.items[key] = r.items;
    return r;
  }

  // ---------- แก้ตามการบันทึก (ไม่ต้องโหลดใหม่ทั้งหมด)

  function eachDocList(fn) {
    fn(S.data.documents);
    for (var k in S.shopFull) fn(S.shopFull[k]);
  }

  /** เรียงใหม่ → เก่า แบบเดียวกับเซิร์ฟเวอร์ (ใบกำกับ: เลขที่มากก่อน / ใบเงินสด: ปี เดือน ลำดับ) */
  function sortDocs(list) {
    list.sort(CASH ? cashDocCompareDesc : function (a, b) { return Number(b.doc_no) - Number(a.doc_no); });
  }

  function isTestNo(no) { return CASH ? cashDocIsTest(no) : Number(no) === 0 && String(no).trim() !== ''; }

  /** เอกสารใหม่ (หลังออกบิล) — ใบล่าสุด / จำนวนของร้าน / เลขที่ที่ใช้แล้ว / ลำดับของเดือน */
  function addDoc(doc) {
    if (!S.data) return;
    var d = S.data;
    var test = isTestNo(doc.doc_no);
    // บิลจริงใบแรก → บิลทดสอบ 0000 ถูกลบที่เซิร์ฟเวอร์แล้ว เอาออกจากรายการในแอปด้วย
    if (!d.hasRealDoc && !test) dropDoc(TEST_NO);
    var exists = d.documents.some(function (x) { return LiffApp.sameNo(x.doc_no, doc.doc_no); });
    if (exists && test) {
      // บิลทดสอบ 0000 ออกซ้ำ = เขียนทับใบเดิม → แทนที่ในรายการ (ไม่เพิ่มแถว)
      eachDocList(function (list) { list.forEach(function (x, i) { if (LiffApp.sameNo(x.doc_no, doc.doc_no)) list[i] = doc; }); });
    }
    if (!exists) {
      d.documents.unshift(doc);
      sortDocs(d.documents);
      if (d.documents.length > KEEP_DOCS) d.documents.length = KEEP_DOCS;
      var full = S.shopFull[String(doc.shop_id)];
      if (full) { full.unshift(doc); sortDocs(full); }
      var st = d.shopStats[String(doc.shop_id)] || (d.shopStats[String(doc.shop_id)] = { count: 0, lastDate: '' });
      st.count++;
      st.lastDate = doc.doc_date;
      d.totalDocuments = (Number(d.totalDocuments) || 0) + 1;
    }
    if (!test) {
      d.hasRealDoc = true;
      if (CASH) {
        var p = cashDocParse(doc.doc_no);
        if (p && !p.test) {
          d.monthMax = d.monthMax || {};
          d.monthMax[p.prefix] = Math.max(Number(d.monthMax[p.prefix]) || 0, p.seq);
        }
      } else {
        d.docNos = Array.isArray(d.docNos) ? d.docNos : [];
        if (d.docNos.indexOf(Number(doc.doc_no)) < 0) d.docNos.push(Number(doc.doc_no));
      }
    }
    if (!CASH && doc.status !== 'cancelled' && (!d.lastDoc || Number(doc.doc_no) >= Number(d.lastDoc.doc_no))) {
      d.lastDoc = { doc_no: Number(doc.doc_no), doc_date: doc.doc_date, status: 'issued' };
    }
    changed('doc', doc.doc_no);
  }

  /** เอาเอกสารออกจากรายการในแอป (บิลทดสอบ 0000 ที่เซิร์ฟเวอร์ลบหลังออกบิลจริงใบแรก) */
  function dropDoc(no) {
    var d = S.data;
    var same = function (x) { return isTestNo(no) ? isTestNo(x.doc_no) : LiffApp.sameNo(x.doc_no, no); };
    var gone = d.documents.filter(same);
    d.documents = d.documents.filter(function (x) { return !same(x); });
    for (var k in S.shopFull) S.shopFull[k] = S.shopFull[k].filter(function (x) { return !same(x); });
    gone.forEach(function (x) {
      var st = d.shopStats[String(x.shop_id)];
      if (st && st.count > 0) st.count--;
      d.totalDocuments = Math.max(0, (Number(d.totalDocuments) || 0) - 1);
    });
    if (d.lastDoc && same(d.lastDoc)) d.lastDoc = null;
    delete S.items[String(no)];
  }

  /** แก้เอกสาร (ยกเลิก / มี PDF แล้ว) ทุกที่ที่มีใบนี้ */
  function patchDoc(no, patch) {
    if (!S.data) return;
    eachDocList(function (list) {
      list.forEach(function (d) {
        if (!LiffApp.sameNo(d.doc_no, no)) return;
        for (var k in patch) d[k] = patch[k];
      });
    });
    var d = S.data;
    if (patch.status === 'cancelled' && d.lastDoc && LiffApp.sameNo(d.lastDoc.doc_no, no)) {
      // ใบล่าสุดถูกยกเลิก → ใบล่าสุดที่ยังไม่ยกเลิก (คำเตือนวันที่ของฟอร์มออกบิล)
      var last = null;
      d.documents.forEach(function (x) { if (x.status !== 'cancelled' && (!last || x.doc_no > last.doc_no)) last = x; });
      d.lastDoc = last ? { doc_no: last.doc_no, doc_date: last.doc_date, status: 'issued' } : null;
    }
    changed('doc', LiffApp.docParam(no));
  }

  function putShop(shop) {
    if (!S.data) return;
    var list = S.data.shops;
    var i = list.findIndex(function (s) { return String(s.shop_id) === String(shop.shop_id); });
    if (i >= 0) list[i] = shop; else list.push(shop);
    changed('shop', shop.shop_id);
  }

  function putProduct(p) {
    if (!S.data) return;
    var list = S.data.products;
    var i = list.findIndex(function (x) { return x.barcode === p.barcode; });
    if (i >= 0) list[i] = p; else list.push(p);
    changed('product', p.barcode);
  }

  return {
    onChange: onChange, has: has, version: version, isCached: isCached, isRefreshing: isRefreshing,
    ensure: ensure, refresh: refresh, clear: clear,
    data: data, shops: shops, products: products, recentDocs: recentDocs, name: name, issueInit: issueInit,
    shopStat: shopStat, docsOfShop: docsOfShop, shopComplete: shopComplete, loadShopDocs: loadShopDocs, docItems: docItems,
    addDoc: addDoc, patchDoc: patchDoc, putShop: putShop, putProduct: putProduct
  };
})();
