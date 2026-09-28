/**
 * money.js — การคำนวณเงิน (pure functions)
 *
 * ใช้ได้ 3 ที่โดยไม่ต้องแก้: Node (require), เบราว์เซอร์ (<script>), Apps Script (.gs)
 * ชื่อฟังก์ชันระดับบนสุดต้องไม่ซ้ำกับไฟล์อื่นใน core เพราะ Apps Script ใช้ global scope ร่วมกัน
 *
 * หลักการ: ทุกยอดคำนวณเป็น "สตางค์" (จำนวนเต็ม) แล้วค่อยแปลงกลับ เพื่อกันปัญหา floating point
 */

/** แปลงเป็นสตางค์ (จำนวนเต็ม) ปัดครึ่งขึ้นแบบห่างจากศูนย์ เช่น 1.005 → 101 */
function toSatang(x) {
  var n = Number(x);
  if (!isFinite(n)) return 0;
  var sign = n < 0 ? -1 : 1;
  // toPrecision(15) ตัดเศษ binary เช่น 100.49999999999999 → 100.5
  return sign * Math.round(Number((Math.abs(n) * 100).toPrecision(15)));
}

/** แปลงสตางค์กลับเป็นบาท */
function fromSatang(s) {
  return s / 100;
}

/** ปัดทศนิยม 2 ตำแหน่ง (ปัดครึ่งขึ้น) กันปัญหา floating point */
function round2(x) {
  return fromSatang(toSatang(x));
}

/**
 * คำนวณยอดของ 1 บรรทัด
 * @param {{qty:number, price:number, discount?:number, is_free?:boolean}} line
 * @returns {{qty:number, price:number, discount:number, is_free:boolean, amount:number}}
 *   amount = qty × price (ของแถม price = 0 และ discount = 0)
 */
function calcLine(line) {
  var isFree = line.is_free === true || line.is_free === 'TRUE' || line.is_free === 'true';
  var qty = Number(line.qty) || 0;
  var price = isFree ? 0 : round2(line.price);
  var discount = isFree ? 0 : round2(line.discount || 0);
  var amount = round2(qty * price);
  return { qty: qty, price: price, discount: discount, is_free: isFree, amount: amount };
}

/**
 * คำนวณยอดรวมของเอกสาร (ราคาสินค้าเป็นราคารวม VAT แล้ว)
 * @param {Array} lines รายการสินค้า (ผ่าน calcLine หรือยังก็ได้)
 * @param {number} vatRate เช่น 0.07
 */
function calcTotals(lines, vatRate) {
  var sumS = 0;
  var discS = 0;
  for (var i = 0; i < lines.length; i++) {
    var l = calcLine(lines[i]);
    sumS += toSatang(l.amount);
    discS += toSatang(l.discount);
  }
  var totalS = sumS - discS;
  var rate = Number(vatRate) || 0;
  var netS = toSatang(fromSatang(totalS) / (1 + rate));
  var vatS = totalS - netS; // บังคับให้ net + vat = total พอดี
  return {
    sum_amount: fromSatang(sumS),
    discount: fromSatang(discS),
    total: fromSatang(totalS),
    net_before_vat: fromSatang(netS),
    vat: fromSatang(vatS)
  };
}

/** รูปแบบ #,##0.00 เช่น 1234567.5 → "1,234,567.50" */
function formatMoney(x) {
  var s = toSatang(x);
  var neg = s < 0;
  s = Math.abs(s);
  var baht = Math.floor(s / 100);
  var st = s % 100;
  var intStr = String(baht).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (neg ? '-' : '') + intStr + '.' + (st < 10 ? '0' : '') + st;
}

/** รูปแบบจำนวน: ไม่มีทศนิยมถ้าเป็นจำนวนเต็ม เช่น 12 → "12", 1500 → "1,500", 2.5 → "2.50" */
function formatQty(x) {
  var n = Number(x) || 0;
  if (Math.round(n) === n) return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return formatMoney(n);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    toSatang: toSatang,
    fromSatang: fromSatang,
    round2: round2,
    calcLine: calcLine,
    calcTotals: calcTotals,
    formatMoney: formatMoney,
    formatQty: formatQty
  };
}
