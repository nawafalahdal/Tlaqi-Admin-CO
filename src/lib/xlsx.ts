import { deflateRawSync } from "node:zlib";

/** **كاتبُ ملف Excel (.xlsx) صغير** — بلا اعتمادٍ جديد: ملفُّ OOXML حدُّه الأدنى (ورقةٌ أو عدّة أوراق)
 *  داخل ZIP يُبنى هنا بـ`zlib` المدمجة.
 *
 *  - **عربيٌّ من اليمين:** الورقةُ `rightToLeft`، والنصوصُ UTF-8.
 *  - **قابلٌ للفرز والتصفية:** صفُّ العناوين مثبَّت، وعليه مرشّحٌ تلقائي (AutoFilter)، والتواريخُ
 *    تواريخُ حقيقية (أرقامٌ بتنسيق تاريخ) والتقييماتُ أرقام — فتُفرَز فرزاً صحيحاً.
 *  - **لا صيغ:** كلُّ نصٍّ يُكتب نصّاً مضمَّناً (`inlineStr`)، فما يبدأ بـ`=` أو `+` لا يُنفَّذ
 *    صيغةً (حقن الصيغ). وتُحذف محارفُ التحكّم التي لا تقبلها XML. */

export type XlsxCell = string | number | Date | null | undefined;
export type XlsxColumn = { header: string; width?: number };

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** أرشيفُ ZIP (DEFLATE) — يكفي لحزمة OOXML */
export function zip(files: { name: string; data: Buffer }[], at = new Date()): Buffer {
  const dosTime = ((at.getHours() << 11) | (at.getMinutes() << 5) | (at.getSeconds() >> 1)) & 0xffff;
  const dosDate = (((at.getFullYear() - 1980) << 9) | ((at.getMonth() + 1) << 5) | at.getDate()) & 0xffff;
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, "utf8");
    const packed = deflateRawSync(f.data);
    const crc = crc32(f.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // أسماءٌ بـUTF-8
    local.writeUInt16LE(8, 8); // DEFLATE
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(f.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, packed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(f.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + packed.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

const INVALID_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
export function xmlText(s: string): string {
  return s.replace(INVALID_XML, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function colName(i: number): string {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** تاريخٌ برقم Excel التسلسلي — بتوقيتٍ ثابت (الرياض +3 افتراضاً، بلا توقيتٍ صيفي) */
function excelSerial(d: Date, tzOffsetMinutes: number): number {
  return (d.getTime() + tzOffsetMinutes * 60_000) / 86_400_000 + 25569;
}

const SHEET_NAME_BAD = /[\[\]:*?/\\]/g;

export type XlsxSheet = { sheetName: string; columns: XlsxColumn[]; rows: XlsxCell[][] };

/** ورقةٌ واحدة — الواجهةُ القديمة كما هي */
export function buildXlsx(opts: XlsxSheet & { rtl?: boolean; tzOffsetMinutes?: number }): Buffer {
  return buildXlsxWorkbook({ sheets: [opts], rtl: opts.rtl, tzOffsetMinutes: opts.tzOffsetMinutes });
}

/** **مصنَّفٌ بعدّة أوراق** — لكلٍّ عناوينُها المثبَّتة ومرشّحُها التلقائي، والأسماءُ فريدة (Excel يرفض
 *  ورقتين بالاسم نفسه، فيُضاف رقمٌ للمكرّر). */
export function buildXlsxWorkbook(opts: { sheets: XlsxSheet[]; rtl?: boolean; tzOffsetMinutes?: number }): Buffer {
  const tz = opts.tzOffsetMinutes ?? 180;
  const rtl = opts.rtl !== false;
  const used = new Set<string>();
  const sheets = (opts.sheets.length ? opts.sheets : [{ sheetName: "Sheet1", columns: [], rows: [] }]).map((sh, idx) => {
    const base = sh.sheetName.replace(SHEET_NAME_BAD, " ").trim().slice(0, 28) || `Sheet${idx + 1}`;
    let name = base;
    for (let k = 2; used.has(name.toLowerCase()); k++) name = `${base} ${k}`;
    used.add(name.toLowerCase());
    return { ...sh, name };
  });

  const built = sheets.map((sh) => {
    const lastCol = colName(Math.max(sh.columns.length, 1) - 1);
    const lastRow = sh.rows.length + 1;
    const ref = `A1:${lastCol}${lastRow}`;
    const cell = (v: XlsxCell, r: number, c: number, header = false): string => {
      const at = `${colName(c)}${r}`;
      if (v === null || v === undefined || v === "") return "";
      if (v instanceof Date) return Number.isNaN(v.getTime()) ? "" : `<c r="${at}" s="2"><v>${excelSerial(v, tz)}</v></c>`;
      if (typeof v === "number") return Number.isFinite(v) ? `<c r="${at}"><v>${v}</v></c>` : "";
      return `<c r="${at}" t="inlineStr"${header ? ' s="1"' : ""}><is><t xml:space="preserve">${xmlText(String(v))}</t></is></c>`;
    };
    const rowsXml = [
      `<row r="1">${sh.columns.map((col, c) => cell(col.header, 1, c, true)).join("")}</row>`,
      ...sh.rows.map((row, i) => `<row r="${i + 2}">${row.map((v, c) => cell(v, i + 2, c)).join("")}</row>`),
    ].join("");
    const cols = sh.columns.map((col, i) => `<col min="${i + 1}" max="${i + 1}" width="${col.width ?? 18}" customWidth="1"/>`).join("");
    return {
      filterRef: `$A$1:$${lastCol}$${lastRow}`,
      xml:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
        `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
        `<dimension ref="${ref}"/>` +
        `<sheetViews><sheetView workbookViewId="0"${rtl ? ' rightToLeft="1"' : ""}>` +
        `<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/>` +
        `</sheetView></sheetViews>` +
        `<sheetFormatPr defaultRowHeight="18"/>` +
        (cols ? `<cols>${cols}</cols>` : "") +
        `<sheetData>${rowsXml}</sheetData>` +
        `<autoFilter ref="${ref}"/>` +
        `</worksheet>`,
    };
  });

  const workbook =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<bookViews><workbookView${rtl ? ' rightToLeft="1"' : ""}/></bookViews>` +
    `<sheets>${sheets.map((sh, i) => `<sheet name="${xmlText(sh.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets>` +
    `<definedNames>${sheets
      .map((sh, i) => `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${xmlText(sh.name).replace(/'/g, "''")}'!${built[i].filterRef}</definedName>`)
      .join("")}</definedNames>` +
    `</workbook>`;

  const styles =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd hh:mm"/></numFmts>` +
    `<fonts count="2"><font><sz val="11"/><name val="Arial"/></font><font><b/><sz val="11"/><name val="Arial"/></font></fonts>` +
    `<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>` +
    `<fill><patternFill patternType="solid"><fgColor rgb="FFE5E7EB"/><bgColor indexed="64"/></patternFill></fill></fills>` +
    `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
    `<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>` +
    `<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>` +
    `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
    `</styleSheet>`;

  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("") +
    `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
    `</Types>`;
  const rels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
    `</Relationships>`;
  const wbRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("") +
    `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    `</Relationships>`;

  const b = (x: string) => Buffer.from(x, "utf8");
  return zip([
    { name: "[Content_Types].xml", data: b(contentTypes) },
    { name: "_rels/.rels", data: b(rels) },
    { name: "xl/workbook.xml", data: b(workbook) },
    { name: "xl/_rels/workbook.xml.rels", data: b(wbRels) },
    ...built.map((x, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: b(x.xml) })),
    { name: "xl/styles.xml", data: b(styles) },
  ]);
}
