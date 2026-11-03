/*
 * icons.js — ไอคอนแบบเส้นชุดเดียวของทั้งระบบ (รอบ 6 ข้อ 4) แทนอีโมจิ
 *   กรอบ 24×24 เส้นหนา 1.8 ปลายมน สีตามตัวหนังสือ (currentColor) — สีมาจาก theme.css
 *   ใช้ในหน้า LIFF (iconSvg) แถบเมนูล่าง (shell.js) และรูป Rich Menu (scripts/make-richmenu.js อ่านไฟล์นี้)
 *   ไอคอนในกล่องข้อความ (.alert) และขั้นตอน (.steps) อยู่ใน form.css เป็นเส้นชุดเดียวกัน (test ตรวจว่าตรงกับไฟล์นี้)
 */
var ICONS = {
  issue: '<path d="M6 3h8l5 5v13H6z"/><path d="M14 3v5h5M9 13h7M9 17h7"/>',
  history: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  manage: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5v.7"/><path d="M12 17.2v.1"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  next: '<path d="M9 5l7 7-7 7"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 5V4H5v11h1"/>',
  file: '<path d="M6 3h8l5 5v13H6z"/><path d="M14 3v5h5"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  send: '<path d="M21 3L10 14"/><path d="M21 3l-7 18-4-7-7-4z"/>',
  warn: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17v.1"/>',
  error: '<circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/>',
  ok: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.7 2.7L16 10"/>',
  pending: '<circle cx="12" cy="12" r="7"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  pause: '<circle cx="12" cy="12" r="9"/><path d="M10 9v6M14 9v6"/>',
  calendar: '<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>',
  link: '<path d="M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1"/><path d="M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1"/>',
  // รอบ 10: ป้ายประเภทเอกสาร / Rich Menu — ใบเงินสด (ธนบัตร) / ใบกำกับภาษี (ใบเสร็จมีเปอร์เซ็นต์)
  cash: '<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6.5 9.5v.1M17.5 14.5v.1"/>',
  receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9.5 14.5l5-5"/><path d="M9.6 9.6v.1M14.4 14.4v.1"/>',
  // รอบ 15: Rich Menu / หน้าสรุป — สต็อก (กล่อง) / สรุป (กราฟแท่ง) / ยอดเพิ่ม-ลด (ลูกศร)
  stock: '<path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z"/><path d="M3 7.5 12 12l9-4.5M12 12v9"/>',
  summary: '<path d="M4 20V11M10 20V5M16 20v-6M2 20h20"/>',
  up: '<path d="M12 19V6M6 11l6-6 6 6"/>',
  down: '<path d="M12 5v13M6 13l6 6 6-6"/>',
  profit: '<circle cx="12" cy="12" r="9"/><path d="M14.5 9.2c-.5-.9-1.5-1.4-2.6-1.4-1.5 0-2.6.8-2.6 2s1 1.7 2.6 2.1c1.7.4 2.8 1 2.8 2.3s-1.2 2.1-2.8 2.1c-1.2 0-2.3-.6-2.8-1.5M12 6v1.8M12 16.3V18"/>', // รอบ 45: แท็บกำไรบิล (เหรียญ)
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>', // รอบ 44: ซ่อน/แสดงกำไร
  eyeOff: '<path d="M3 3l18 18"/><path d="M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6C3.7 8.4 2 12 2 12s3.5 7 10 7a9.6 9.6 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  // รอบ 21: เมนูหลัก (บ้าน) / ออกจากระบบ (ประตู + ลูกศร) / แชร์ (กล่อง + ลูกศรขึ้น แบบปุ่มแชร์ของ Safari)
  home: '<path d="M4 11l8-7 8 7"/><path d="M6 9.5V20h12V9.5M10 20v-5h4v5"/>',
  logout: '<path d="M14 4H5v16h9"/><path d="M10 12h10M16 8l4 4-4 4"/>',
  share: '<path d="M12 3v12M8 7l4-4 4 4"/><path d="M6 11H5v10h14V11h-1"/>'
};

/** <svg> ของไอคอน (ตกแต่งเท่านั้น aria-hidden — ปุ่มต้องมีข้อความหรือ aria-label เอง) */
function iconSvg(name, cls) {
  return '<svg class="icon' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + (ICONS[name] || '') + '</svg>';
}

if (typeof module !== 'undefined' && module.exports) module.exports = { ICONS: ICONS, iconSvg: iconSvg };
