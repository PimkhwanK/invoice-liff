/**
 * bahtText.js — แปลงจำนวนเงินเป็นคำอ่านภาษาไทย ให้ผลเหมือน BAHTTEXT ของ Excel
 *
 *   21        → ยี่สิบเอ็ดบาทถ้วน
 *   101       → หนึ่งร้อยเอ็ดบาทถ้วน
 *   1000001   → หนึ่งล้านเอ็ดบาทถ้วน
 *   54000.50  → ห้าหมื่นสี่พันบาทห้าสิบสตางค์
 *   0         → ศูนย์บาทถ้วน
 *   0.25      → ยี่สิบห้าสตางค์
 *   -5        → ลบห้าบาทถ้วน
 */

var BAHT_DIGITS = ['', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
var BAHT_PLACES = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน'];

/**
 * อ่านตัวเลข 0–999,999 (1 กลุ่มล้าน)
 * @param {number} n
 * @param {boolean} hasHigher มีหลักที่สูงกว่ากลุ่มนี้หรือไม่ (ใช้ตัดสิน "เอ็ด")
 */
function bahtReadGroup_(n, hasHigher) {
  var s = String(n);
  var out = '';
  var len = s.length;
  for (var i = 0; i < len; i++) {
    var d = Number(s.charAt(i));
    var place = len - i - 1;
    if (d === 0) continue;
    if (place === 0) {
      // หลักหน่วย: 1 อ่าน "เอ็ด" ถ้ามีหลักอื่นที่สูงกว่า
      out += (d === 1 && (hasHigher || n > 9)) ? 'เอ็ด' : BAHT_DIGITS[d];
    } else if (place === 1) {
      if (d === 1) out += 'สิบ';
      else if (d === 2) out += 'ยี่สิบ';
      else out += BAHT_DIGITS[d] + 'สิบ';
    } else {
      out += BAHT_DIGITS[d] + BAHT_PLACES[place];
    }
  }
  return out;
}

/** อ่านจำนวนเต็มไม่ติดลบใด ๆ (รองรับเกินล้าน เช่น ล้านล้าน) */
function bahtReadInteger_(n, hasHigher) {
  if (n >= 1000000) {
    var high = Math.floor(n / 1000000);
    var low = n % 1000000;
    return bahtReadInteger_(high, hasHigher) + 'ล้าน' + (low > 0 ? bahtReadGroup_(low, true) : '');
  }
  return bahtReadGroup_(n, hasHigher);
}

/**
 * @param {number|string} amount
 * @returns {string}
 */
function bahtText(amount) {
  var n = Number(String(amount).replace(/,/g, ''));
  if (!isFinite(n)) return '';
  var neg = n < 0;
  // ปัดเป็นสตางค์ (ใช้ toPrecision กัน floating point เช่น 1.005)
  var satangTotal = Math.round(Number((Math.abs(n) * 100).toPrecision(15)));
  var baht = Math.floor(satangTotal / 100);
  var satang = satangTotal % 100;

  var out = '';
  if (baht === 0 && satang === 0) return 'ศูนย์บาทถ้วน';
  if (baht > 0) out += bahtReadInteger_(baht, false) + 'บาท';
  if (satang === 0) out += 'ถ้วน';
  else out += bahtReadGroup_(satang, false) + 'สตางค์';
  return (neg ? 'ลบ' : '') + out;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { bahtText: bahtText };
}
