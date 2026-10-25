/*
 * sw.js — service worker ของแอปที่ติดตั้ง (รอบ 21)
 *   มีไว้ให้เบราว์เซอร์ยอมติดตั้งเป็นแอปเท่านั้น: ไม่จำไฟล์ / ข้อมูลบิล / การเข้าสู่ระบบไว้ในเครื่อง
 *   ทุกคำขอวิ่งไปที่เครือข่ายตามปกติ (หน้าเว็บเวอร์ชันใหม่มีผลทันทีหลัง push ไม่มีหน้าเก่าค้าง)
 */
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', function () { /* ไม่แตะคำขอ (ใช้เครือข่ายตามปกติ) */ });
