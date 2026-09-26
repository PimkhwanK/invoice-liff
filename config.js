/*
 * config.js — ค่าตั้งค่าของหน้า LIFF (ไฟล์เดียวที่ต้องแก้)
 *
 * LIFF_ID  ได้จาก LINE Developers → LINE Login channel → แท็บ LIFF (เช่น 1234567890-AbCdEfGh)
 * API_URL  Web app URL ของ Apps Script (ลงท้ายด้วย /exec) — ใช้ URL เดิมของ webhook
 *
 * ทั้งสองค่าเป็นค่าสาธารณะ ใส่ในไฟล์นี้ได้
 * ห้ามใส่ Channel access token, Channel secret หรือ userId ในไฟล์ใด ๆ ของโฟลเดอร์นี้
 */
window.APP_CONFIG = {
  LIFF_ID: '2011752962-XEyAA1HD',
  API_URL: 'https://script.google.com/macros/s/AKfycbxY7jfg8K2ixWO2XNj4Q3FezsyrD4OBEkJK38za7uVl5bMJWqOYm5tDnGAhQBqzwC-9/exec'
};
