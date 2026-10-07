/*
 * shell.js — แอป LIFF หน้าเดียว (รอบ 6 ข้อ 3.5): liff.init ครั้งเดียวต่อการเปิดแอป แล้วสลับหน้าจอในแอปโดยไม่โหลดหน้าใหม่
 *
 *   ลิงก์เดิมใช้ได้ทั้งหมด: issue.html / history.html / manage.html / view.html เป็นไฟล์เดียวกันทุกตัวอักษร (มี test ตรวจ)
 *   → เปิด /issue, /history?shopId=…, /manage?tab=…, /view?no=… ตรง ๆ ได้ / หน้าแรก (index.html) พาไป /issue / /check แยกต่างหาก
 *   แต่ละหน้าจอ (issue.js, history.js, manage.js, view.js) ลงทะเบียนด้วย Shell.define(ชื่อ, { title, build, show, update })
 *     build(scr)        สร้างส่วนหัว / #view (scr.root) และแถบล่างของหน้าจอ (scr.dock เช่น แถบยอดรวม) ครั้งเดียว
 *     show(scr, params) ทุกครั้งที่เข้าหน้าจอ (ข้อมูลยังเหมือนเดิม → ไม่ต้องทำอะไร หน้าจอค้างไว้ตามเดิม)
 *     update(scr)       ข้อมูลในแอปเปลี่ยน (AppData) ขณะหน้าจอนี้แสดงอยู่ หรือเปลี่ยนไปตอนที่ไม่ได้แสดง
 *   หน้าจอที่ไม่ได้แสดงถูกถอดออกจากเอกสาร (เก็บไว้ทั้งก้อน) → id ซ้ำกันข้ามหน้าจอได้ / ฟอร์มที่กรอกค้างไว้ไม่หาย
 *   ปุ่มย้อนกลับ (Android) / ปัดย้อนกลับ: history.pushState ทุกครั้งที่เปลี่ยนหน้าจอ → popstate กลับหน้าจอก่อนหน้าในแอป
 *   ลำดับโหลด: shell.js → หน้าจอ (Shell.define) → Shell.boot() ท้ายหน้า
 *   แถบเมนูล่าง 3 ปุ่ม: ออกบิล / ประวัติ / จัดการข้อมูล (หน้าดู PDF ไม่อยู่ในแถบ)
 *   ?debug=1 → แถบเวลาเล็ก ๆ บนจอ: liff.init, คำขอเซิร์ฟเวอร์แต่ละครั้ง, เวลาสลับหน้าจอ (จำไว้ในแท็บนี้จนปิด / ?debug=0 ปิด)
 */
var Shell = (function () {
  var ROUTES = { issue: [], history: ['shopId'], manage: ['tab'], view: ['no'] };
  var TABS = ['issue', 'history', 'manage'];
  var defs = {};
  var screens = {};
  var current = null;
  var locked = '';   // ไม่มีสิทธิ์ (code) → ทุกหน้าจอแสดงหน้าไม่มีสิทธิ์
  var ready = false; // liff.init + มี idToken แล้ว
  var depth = 0;     // ลำดับใน history ของแอป (0 = หน้าที่เปิดมา)
  var appEl = document.getElementById('app');
  var dockEl = document.getElementById('dock');
  var tabbar = document.getElementById('tabbar');
  // ไอคอนของแถบเมนูล่างมาจาก icons.js (ชุดเดียวกับรูป Rich Menu)
  tabbar.querySelectorAll('i[data-icon]').forEach(function (i) { i.outerHTML = iconSvg(i.getAttribute('data-icon')); });

  function define(name, def) { defs[name] = def; }
  /** หน้าจอนี้ลงทะเบียนแล้ว (ไฟล์ของหน้าจอโหลดสำเร็จ — ตัวตรวจท้ายหน้าใช้) */
  function has(name) { return !!defs[name]; }

  // ---------- เส้นทาง

  /** URL → {name, params} (ค่าที่ไม่รู้จัก เช่น ?code= ของการเข้าสู่ระบบ ถูกตัดทิ้ง) */
  function parse(href) {
    var u = new URL(href, location.href);
    var name = u.pathname.split('/').pop().replace(/\.html$/, '');
    if (!ROUTES[name]) name = 'issue';
    var params = {};
    ROUTES[name].forEach(function (k) { if (u.searchParams.has(k)) params[k] = u.searchParams.get(k); });
    return { name: name, params: params };
  }

  /** {name, params} → URL แบบสัมพัทธ์ (ใช้ได้ทั้ง /issue และ /invoice-liff/issue) */
  function urlOf(name, params) {
    var q = new URLSearchParams();
    (ROUTES[name] || []).forEach(function (k) { if (params && params[k] !== undefined && params[k] !== '') q.set(k, params[k]); });
    var s = q.toString();
    return name + (s ? '?' + s : '');
  }

  // ---------- หน้าจอ

  function screen(name) {
    if (screens[name]) return screens[name];
    var s = { name: name, def: defs[name], root: LiffApp.el('<div class="screen" data-screen="' + name + '"></div>'), dock: null, params: {}, scroll: 0, seen: -1 };
    s.dock = LiffApp.el('<div class="dock-part"></div>');
    s.$ = function (id) { return LiffApp.find(id, s); };
    s.def.build(s);
    screens[name] = s;
    return s;
  }

  function attach(s) {
    if (current === s) return;
    if (current) {
      current.scroll = appEl.scrollTop;
      current.root.remove();
      current.dock.remove();
    }
    current = s;
    appEl.replaceChildren(s.root);
    dockEl.replaceChildren(s.dock);
    appEl.scrollTop = s.scroll;
    document.title = s.def.title;
    LiffApp.syncing(AppData.isRefreshing(), s);
    drawTabbar();
  }

  function drawTabbar() {
    tabbar.classList.toggle('hidden', !ready || !!locked);
    document.body.classList.toggle('has-tabbar', ready && !locked);
    tabbar.querySelectorAll('button[data-go]').forEach(function (b) {
      var on = !!current && b.dataset.go === current.name;
      b.classList.toggle('on', on);
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
  }

  /** แสดงหน้าจอ (ไม่แตะ history) — วัดเวลาสลับหน้าจอจนวาดเสร็จ */
  function show(name, params, how) {
    var t0 = performance.now();
    LiffApp.closeSheets();
    var s = screen(name);
    attach(s);
    s.params = params;
    if (locked) {
      LiffApp.showDenied(locked, s);
      return;
    }
    var changed = s.seen !== -1 && s.seen !== AppData.version();
    s.def.show(s, params, { nav: how, changed: changed });
    if (how !== 'boot') {
      requestAnimationFrame(function () { Debug.set('สลับหน้า', performance.now() - t0); });
    }
  }

  /** หน้าจอวาดด้วยข้อมูลรุ่นปัจจุบันแล้ว (เรียกจากหน้าจอหลังวาด) */
  function drawn(s) { s.seen = AppData.version(); }

  /** ไปหน้าจออื่นในแอป (เพิ่มรายการใน history — ปุ่มย้อนกลับกลับมาหน้านี้) / replace = แทนที่รายการเดิม */
  function go(name, params, opts) {
    if (!ready) return;
    params = params || {};
    var url = urlOf(name, params);
    if (opts && opts.replace) {
      history.replaceState({ app: 1, depth: depth }, '', url);
    } else {
      depth++;
      history.pushState({ app: 1, depth: depth }, '', url);
    }
    show(name, params, opts && opts.replace ? 'replace' : 'push');
  }

  /** เปลี่ยนค่าใน URL ของหน้าจอที่แสดงอยู่ (เช่น แท็บของหน้าจัดการข้อมูล) โดยไม่เพิ่มรายการใน history */
  function setParams(s, params) {
    s.params = params;
    if (current === s) history.replaceState({ app: 1, depth: depth }, '', urlOf(s.name, params));
  }

  function canBack() { return depth > 0; }
  function back() { if (depth > 0) history.back(); }
  function isCurrent(s) { return current === s; }
  function scrollTop(s) { if (current === s) appEl.scrollTop = 0; else s.scroll = 0; }

  window.addEventListener('popstate', function () {
    if (!ready) return;
    var st = history.state;
    depth = st && st.app ? st.depth : 0;
    var r = parse(location.href);
    show(r.name, r.params, 'pop');
  });

  // แตะแถบเมนูล่าง → หน้าจอนั้นตามที่ค้างไว้ล่าสุด (เช่น ร้านที่ดูอยู่) / แตะหน้าจอที่อยู่แล้ว → เลื่อนขึ้นบนสุด
  tabbar.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-go]');
    if (!b) return;
    var name = b.dataset.go;
    if (current && current.name === name) { appEl.scrollTop = 0; return; }
    go(name, screens[name] ? screens[name].params : {});
  });

  // ลิงก์ภายในแอป (เช่น ปุ่ม "ดู PDF" → view?no=…) → สลับหน้าจอแทนการโหลดหน้าใหม่
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href]');
    if (!a || a.target || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
    var href = a.getAttribute('href');
    if (/^[a-z]+:|^\/\/|^#/i.test(href)) return;
    var name = href.split(/[?#]/)[0].replace(/\.html$/, '');
    if (!ROUTES[name] || !ready) return;
    e.preventDefault();
    var r = parse(href);
    go(r.name, r.params);
  });

  // พิมพ์อยู่ (แป้นพิมพ์ขึ้น) → ซ่อนแถบเมนูล่าง ให้เนื้อหามีที่มากขึ้น
  // เลิกพิมพ์ → แสดงแถบอีกครั้งหลัง 300ms: การแตะปุ่ม (เช่น "ตรวจสอบ") ที่ทำให้ช่องพิมพ์หลุดโฟกัสต้องจบก่อนหน้าจอขยับ
  var typingTimer = null;
  function isTyping() {
    var a = document.activeElement;
    return !!a && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && /^(text|search|number|tel|email)$/.test(a.type)));
  }
  // ช่องที่พิมพ์อยู่ถูกลบออกจากหน้า (วาดใหม่) จะไม่มี focusout → ระหว่างซ่อนแถบตรวจซ้ำทุก 0.5 วินาที
  var typingCheck = null;
  function setTyping(on) {
    document.body.classList.toggle('typing', on);
    if (on && !typingCheck) {
      typingCheck = setInterval(function () { if (!isTyping()) setTyping(false); }, 500);
    } else if (!on && typingCheck) {
      clearInterval(typingCheck);
      typingCheck = null;
    }
  }
  document.addEventListener('focusin', function () {
    if (!isTyping()) return; // โฟกัสไปที่ปุ่ม → ปล่อยให้ตัวจับเวลาของ focusout แสดงแถบ
    clearTimeout(typingTimer);
    setTyping(true);
  });
  document.addEventListener('focusout', function () {
    clearTimeout(typingTimer);
    typingTimer = setTimeout(function () { setTyping(isTyping()); }, 300);
  });

  // ข้อมูลในแอปเปลี่ยน → หน้าจอที่แสดงอยู่วาดใหม่ (หน้าจออื่นวาดใหม่ตอนเข้า) / ป้ายกำลังอัปเดต
  AppData.onChange(function (kind) {
    if (kind === 'sync') { if (current) LiffApp.syncing(AppData.isRefreshing(), current); return; }
    if (current && !locked && current.seen !== -1 && current.def.update) current.def.update(current);
  });

  LiffApp.setScope(function () { return current; });
  LiffApp.hooks.denied = function (code) {
    locked = code;
    AppData.clear();
    drawTabbar();
  };

  // ---------- แถบเวลา (?debug=1)

  var Debug = (function () {
    var KEY = 'invoice-liff:debug';
    var on = false;
    var q = new URLSearchParams(location.search).get('debug');
    try {
      if (q === '1') sessionStorage.setItem(KEY, '1');
      if (q === '0') sessionStorage.removeItem(KEY);
      on = q === '1' || sessionStorage.getItem(KEY) === '1';
    } catch (e) { on = q === '1'; }
    var vals = [];
    var bar = null;
    function set(name, ms) {
      if (!on) return;
      ms = Math.round(ms);
      vals = vals.filter(function (v) { return v[0] !== name; });
      vals.push([name, ms]);
      // liff.init อยู่หน้าสุดเสมอ คำขอเซิร์ฟเวอร์เก็บ 3 ครั้งล่าสุด สลับหน้าอยู่ท้าย
      var init = vals.filter(function (v) { return v[0] === 'liff.init'; });
      var sw = vals.filter(function (v) { return v[0] === 'สลับหน้า'; });
      var apis = vals.filter(function (v) { return v[0] !== 'liff.init' && v[0] !== 'สลับหน้า'; }).slice(-3);
      vals = init.concat(apis, sw);
      draw().querySelector('#debug-main').textContent = vals.map(function (v) { return v[0] + ' ' + v[1] + 'ms'; }).join(' · ');
    }
    function draw() {
      if (!bar) {
        bar = LiffApp.el('<div class="debug-bar" id="debug-bar" aria-hidden="true"><div id="debug-main"></div><div id="debug-server"></div></div>');
        document.body.insertBefore(bar, document.body.firstChild);
      }
      return bar;
    }
    /**
     * บรรทัดที่สอง: เวลาฝั่งเซิร์ฟเวอร์ของคำขอล่าสุด แยกขั้น (serverTiming จาก apiHandle เมื่อส่ง debug: true)
     * เน็ต = เวลาที่หน้าเว็บรอ − เวลาที่เซิร์ฟเวอร์ทำงาน (รวม redirect ของ Apps Script และการเริ่มสคริปต์)
     */
    function server(action, t, clientMs) {
      if (!on) return;
      var src = function (k) { return t.sources && t.sources[k] ? '(' + t.sources[k] + ')' : ''; };
      var parts = ['token ' + t.token, 'ผู้ใช้ ' + t.users + src('users'), 'ร้าน/สินค้า/ตั้งค่า ' + t.master + src('master'),
        'เอกสาร ' + t.docs + (t.docsSource ? '(' + t.docsSource + ')' : src('docs')), 'สร้างคำตอบ ' + t.build];
      draw().querySelector('#debug-server').textContent = 'เซิร์ฟเวอร์ ' + action + ' ' + t.total + 'ms: ' + parts.join(' · ') +
        ' | เน็ต+เริ่มสคริปต์ ' + Math.max(0, Math.round(clientMs - t.total)) + 'ms';
    }
    return { set: set, server: server, on: function () { return on; } };
  })();
  LiffApp.hooks.timing = Debug.set;
  LiffApp.hooks.server = Debug.server;
  LiffApp.hooks.debugOn = Debug.on;

  // ---------- เริ่มแอป

  function boot() {
    var r = parse(location.href);
    var s = screen(r.name);
    attach(s);
    s.params = r.params;
    LiffApp.start().then(function (ok) {
      if (!ok) return;
      ready = true;
      // ล้างค่าที่ไม่ใช่ของหน้าจอ (เช่น ?code= หลังเข้าสู่ระบบ, ?debug=1) ออกจาก URL — รายการแรกของแอป
      history.replaceState({ app: 1, depth: 0 }, '', urlOf(r.name, r.params));
      drawTabbar();
      show(r.name, r.params, 'boot');
    });
  }

  return {
    define: define, has: has, go: go, back: back, canBack: canBack, setParams: setParams, drawn: drawn, isCurrent: isCurrent,
    scrollTop: scrollTop, boot: boot, debug: Debug
  };
})();
