/**
 * thaiDate.js — วันที่แบบไทย (พ.ศ.) และเครื่องมือวันที่แบบ ISO (YYYY-MM-DD)
 *
 * เก็บวันที่ในข้อมูลเป็น ISO date string เสมอ แปลงเป็นรูปแบบไทยตอนแสดงผลเท่านั้น
 *   formatThaiDate('2026-09-24') → '24/ก.ย./2569'
 */

var THAI_MONTHS_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
var THAI_MONTHS_FULL = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];

/** ตรวจว่าเป็น ISO date ที่มีอยู่จริง เช่น 2026-02-30 ไม่ผ่าน */
function isIsoDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  var p = s.split('-').map(Number);
  var d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
  return d.getUTCFullYear() === p[0] && d.getUTCMonth() === p[1] - 1 && d.getUTCDate() === p[2];
}

/** '2026-09-24' → '24/ก.ย./2569' (วันเป็นเลข 2 หลัก) */
function formatThaiDate(iso) {
  if (!isIsoDate(iso)) return '';
  var p = iso.split('-').map(Number);
  var day = p[2] < 10 ? '0' + p[2] : String(p[2]);
  return day + '/' + THAI_MONTHS_SHORT[p[1] - 1] + '/' + (p[0] + 543);
}

/** '2026-09-24' → '24 กันยายน 2569' */
function formatThaiDateLong(iso) {
  if (!isIsoDate(iso)) return '';
  var p = iso.split('-').map(Number);
  return p[2] + ' ' + THAI_MONTHS_FULL[p[1] - 1] + ' ' + (p[0] + 543);
}

/** บวกวันให้ ISO date */
function addDaysIso(iso, days) {
  if (!isIsoDate(iso)) return '';
  var p = iso.split('-').map(Number);
  var d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + Number(days || 0)));
  return d.toISOString().slice(0, 10);
}

/** วันที่ ISO ของ Date ตามเขตเวลา (ค่าเริ่มต้น Asia/Bangkok) */
function isoDateInTz(date, timeZone) {
  var fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: timeZone || 'Asia/Bangkok',
    year: 'numeric', month: '2-digit', day: '2-digit'
  });
  return fmt.format(date);
}

/** วันเวลาแบบ ISO พร้อม offset ของไทย เช่น '2026-09-25T14:03:05+07:00' */
function isoDateTimeBangkok(date) {
  var t = new Date(date.getTime() + 7 * 3600 * 1000);
  return t.toISOString().slice(0, 19) + '+07:00';
}

/** เปรียบเทียบ ISO date: <0, 0, >0 */
function compareIso(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    THAI_MONTHS_SHORT: THAI_MONTHS_SHORT,
    isIsoDate: isIsoDate,
    formatThaiDate: formatThaiDate,
    formatThaiDateLong: formatThaiDateLong,
    addDaysIso: addDaysIso,
    isoDateInTz: isoDateInTz,
    isoDateTimeBangkok: isoDateTimeBangkok,
    compareIso: compareIso
  };
}
