/**
 * search.js — ค้นหาร้าน (ใช้ร่วมกันทุกหน้า: ประวัติเอกสาร, เลือกร้านในฟอร์มออกบิล, จัดการข้อมูล)
 *
 * เทียบแบบไม่สนตัวพิมพ์เล็ก/ใหญ่ เว้นวรรค ขีด และจุด เช่น
 *   "ดาวเหนือบ้านไผ่"    เจอ "ดาวเหนือ บ้านไผ่"
 *   "12-34.5"            เจอเลขภาษี "12345" (ขีดและจุดถูกตัดก่อนเทียบ)
 */

/** ตัดตัวอักษรที่ไม่ใช้เทียบ: ช่องว่างทุกชนิด, ขีด (- – —), จุด */
function normalizeSearchText(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/[\s\-‐-―.]+/g, '');
}

/** ร้านนี้ตรงกับคำค้นหรือไม่ (ค้นจากชื่อย่อ ชื่อเต็ม เลขภาษี) คำค้นว่าง = ตรงทุกร้าน */
function shopMatches(shop, term) {
  var q = normalizeSearchText(term);
  if (!q) return true;
  return [shop.short_name, shop.legal_name, shop.tax_id].some(function (f) {
    return normalizeSearchText(f).indexOf(q) >= 0;
  });
}

/**
 * ค้นร้าน — คืนทุกร้านที่ตรง รวมร้านที่ปิดใช้งาน (active = false)
 * กฎ active ใช้กับการออกบิลใหม่เท่านั้น ผู้เรียกกรองเองถ้าต้องการเฉพาะร้านที่ใช้งานอยู่
 */
function searchShops(shops, term) {
  return shops.filter(function (s) { return shopMatches(s, term); });
}

/** เอกสารของร้าน เรียงจากใหม่ไปเก่า (รวมใบที่ยกเลิก) */
function documentsOfShop(documents, shopId) {
  return documents
    .filter(function (d) { return String(d.shop_id) === String(shopId); })
    .sort(function (a, b) { return Number(b.doc_no) - Number(a.doc_no); });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { normalizeSearchText: normalizeSearchText, shopMatches: shopMatches, searchShops: searchShops, documentsOfShop: documentsOfShop };
}
