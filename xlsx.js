/*
 * xlsx.js — สร้างไฟล์ Excel (.xlsx) บนเครื่อง ไม่ใช้ไลบรารีภายนอก (รอบ 24 รายงานสต็อก)
 *   .xlsx = ไฟล์ zip ของ XML (UTF-8) → ภาษาไทยไม่เพี้ยน (ต่างจาก CSV) / zip แบบไม่บีบอัด (store) + CRC32
 *   Xlsx.build({ sheet, cols, rows, merges }) → Uint8Array
 *     rows: [[cell, …], …] cell = ข้อความ | ตัวเลข | null | { v, s } (s = ชื่อรูปแบบใน STYLES)
 *   Xlsx.save(ชื่อไฟล์, bytes) ดาวน์โหลด (ในแอป LINE มักใช้ไม่ได้ — หน้าสต็อกเปิดเบราว์เซอร์ให้แทน)
 */
var Xlsx = (function () {
  // ลำดับต้องตรงกับ cellXfs ใน stylesXml()
  var STYLES = { normal: 0, title: 1, head: 2, text: 3, int: 4, dec: 5, signed: 6, small: 7, bold: 8, boldInt: 9, signedInt: 10 };
  // จำนวนเต็มใช้รูปแบบไม่มีทศนิยม ("#,##0.###" แสดง 140 เป็น "140." ใน Excel)
  var INT_OF = { 5: 4, 6: 10, 8: 9 };

  function esc(s) {
    var out = '';
    s = String(s);
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c < 32 && c !== 9 && c !== 10 && c !== 13) continue; // ตัวควบคุมใช้ใน XML ไม่ได้
      var ch = s.charAt(i);
      out += ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : ch === '"' ? '&quot;' : ch;
    }
    return out;
  }

  function colName(n) {
    var s = '';
    for (n = n + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s;
    return s;
  }

  function cellXml(c, r, i) {
    if (c === null || c === undefined || c === '') return '';
    var v = c && typeof c === 'object' ? c.v : c;
    var s = c && typeof c === 'object' && STYLES[c.s] !== undefined ? STYLES[c.s] : null;
    var ref = colName(i) + (r + 1);
    if (typeof v === 'number' && isFinite(v)) {
      if (s === null) s = STYLES.dec;
      if (Math.round(v) === v && INT_OF[s] !== undefined) s = INT_OF[s];
      return '<c r="' + ref + '" s="' + s + '"><v>' + v + '</v></c>';
    }
    if (v === null || v === undefined || v === '') return s === null ? '' : '<c r="' + ref + '" s="' + s + '"/>';
    return '<c r="' + ref + '" s="' + (s === null ? 0 : s) + '" t="inlineStr"><is><t xml:space="preserve">' + esc(v) + '</t></is></c>';
  }

  function sheetXml(o) {
    var cols = (o.cols || []).map(function (w, i) { return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>'; }).join('');
    var rows = (o.rows || []).map(function (row, r) {
      return '<row r="' + (r + 1) + '">' + (row || []).map(function (c, i) { return cellXml(c, r, i); }).join('') + '</row>';
    }).join('');
    var merges = (o.merges || []).length ? '<mergeCells count="' + o.merges.length + '">' + o.merges.map(function (m) { return '<mergeCell ref="' + m + '"/>'; }).join('') + '</mergeCells>' : '';
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>' +
      (cols ? '<cols>' + cols + '</cols>' : '') + '<sheetData>' + rows + '</sheetData>' + merges +
      '<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>' +
      '<pageSetup paperSize="9" orientation="portrait" fitToWidth="1" fitToHeight="0"/></worksheet>';
  }

  function stylesXml() {
    var b = '<border><left style="thin"/><right style="thin"/><top style="thin"/><bottom style="thin"/><diagonal/></border>';
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<numFmts count="3"><numFmt numFmtId="164" formatCode="#,##0.###"/><numFmt numFmtId="165" formatCode="+#,##0.###;-#,##0.###;0"/><numFmt numFmtId="166" formatCode="+#,##0;-#,##0;0"/></numFmts>' +
      '<fonts count="4"><font><sz val="11"/><name val="Tahoma"/></font><font><b/><sz val="14"/><name val="Tahoma"/></font>' +
      '<font><b/><sz val="11"/><name val="Tahoma"/></font><font><sz val="9"/><name val="Tahoma"/></font></fonts>' +
      '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FFEDE7DF"/><bgColor indexed="64"/></patternFill></fill></fills>' +
      '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>' + b + '</borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="11">' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +                                                   // normal
      '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +                                     // title
      '<xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' + // head
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' + // text
      '<xf numFmtId="3" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>' +            // int
      '<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>' +          // dec
      '<xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>' +          // signed
      '<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +                                     // small
      '<xf numFmtId="164" fontId="2" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>' + // bold
      '<xf numFmtId="3" fontId="2" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>' +   // boldInt
      '<xf numFmtId="166" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>' +              // signedInt
      '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
  }

  function sheetName(s) {
    var out = String(s || 'Sheet1').split('').filter(function (ch) { return '[]:*?/'.indexOf(ch) < 0 && ch.charCodeAt(0) !== 92; }).join('');
    return out.slice(0, 31) || 'Sheet1';
  }

  function parts(o) {
    return [
      ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'],
      ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
      ['xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        '<sheets><sheet name="' + esc(sheetName(o.sheet)) + '" sheetId="1" r:id="rId1"/></sheets></workbook>'],
      ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
      ['xl/styles.xml', stylesXml()],
      ['xl/worksheets/sheet1.xml', sheetXml(o)]
    ];
  }

  // ---------- zip (ไม่บีบอัด)

  var crcTable = null;
  function crc32(bytes) {
    if (!crcTable) {
      crcTable = [];
      for (var n = 0; n < 256; n++) {
        var c = n;
        for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
        crcTable[n] = c >>> 0;
      }
    }
    var crc = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 255] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function zip(files) {
    var enc = new TextEncoder();
    var chunks = [];
    var central = [];
    var offset = 0;
    function u16(v) { return [v & 255, (v >>> 8) & 255]; }
    function u32(v) { return [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255]; }
    files.forEach(function (f) {
      var name = enc.encode(f[0]);
      var data = enc.encode(f[1]);
      var crc = crc32(data);
      // เวลาในไฟล์ zip คงที่ (1 ม.ค. 2024) — ไฟล์เดียวกันได้ไบต์เดียวกัน
      var common = [].concat(u16(20), u16(0x0800), u16(0), u16(0), u16(0x5821), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0));
      var local = new Uint8Array([].concat(u32(0x04034b50), common));
      chunks.push(local, name, data);
      central.push(new Uint8Array([].concat(u32(0x02014b50), u16(20), common, u16(0), u16(0), u16(0), u32(0), u32(offset))), name);
      offset += local.length + name.length + data.length;
    });
    var size = central.reduce(function (s, c) { return s + c.length; }, 0);
    var end = new Uint8Array([].concat(u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(size), u32(offset), u16(0)));
    var all = chunks.concat(central, [end]);
    var out = new Uint8Array(all.reduce(function (s, c) { return s + c.length; }, 0));
    var p = 0;
    all.forEach(function (c) { out.set(c, p); p += c.length; });
    return out;
  }

  function build(o) { return zip(parts(o || {})); }

  function save(name, bytes) {
    var blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
  }

  return { build: build, save: save, colName: colName, STYLES: STYLES };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = Xlsx;
