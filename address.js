/**
 * address.js — ตัดที่อยู่บรรทัดเดียวเป็น 2 บรรทัดสำหรับพิมพ์บนเอกสาร
 *
 * กฎ: ตัดหน้าคำว่า "อำเภอ" หรือ "เขต" ที่เจอก่อน (ต้องอยู่ตำแหน่งมากกว่า 0)
 *     ถ้าไม่เจอ ให้ตัดที่ช่องว่างที่ใกล้กึ่งกลางข้อความที่สุด
 *     ถ้าไม่มีช่องว่างเลย ให้อยู่บรรทัดแรกทั้งหมด
 */

var ADDRESS_SPLIT_WORDS = ['อำเภอ', 'เขต'];

/**
 * @param {string} address
 * @returns {[string, string]}
 */
function splitAddress(address) {
  var s = String(address == null ? '' : address).replace(/\s+/g, ' ').trim();
  if (!s) return ['', ''];

  var cut = -1;
  for (var i = 0; i < ADDRESS_SPLIT_WORDS.length; i++) {
    var idx = s.indexOf(ADDRESS_SPLIT_WORDS[i], 1);
    if (idx > 0 && (cut === -1 || idx < cut)) cut = idx;
  }

  if (cut === -1) {
    var mid = s.length / 2;
    var best = -1;
    for (var j = 0; j < s.length; j++) {
      if (s.charAt(j) === ' ' && (best === -1 || Math.abs(j - mid) < Math.abs(best - mid))) best = j;
    }
    if (best === -1) return [s, ''];
    cut = best;
  }

  return [s.slice(0, cut).trim(), s.slice(cut).trim()];
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { splitAddress: splitAddress };
}
