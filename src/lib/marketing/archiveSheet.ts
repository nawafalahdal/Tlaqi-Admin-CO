import { google } from "googleapis";
import type { sheets_v4 } from "googleapis";
import { marketingArchiveSpreadsheetId } from "@/lib/deploymentEnv";
import { ARCHIVE_TABS, ARCHIVE_README_TAB, ARCHIVE_FILE_LABEL, ARCHIVE_BRAND, type ArchiveTab } from "./archiveLayout";

/** التكاملُ الحقيقيُّ مع ملف أرشيف التسويق — منفصلٌ عن `googleSheets.ts` (شيت المنصة المشترك):
 *  ملفٌّ آخر بمتغيّرٍ آخر، فلا يمسّ أحدُهما الآخر ولا يعطّله تغييرُه.
 *
 *  **الملف:** `MARKETING_ARCHIVE_SPREADSHEET_ID` (وفي المعاينة `…_PREVIEW`، ملفُّ اختبارٍ لا غير).
 *  **بياناتُ الاعتماد:** حسابُ الخدمة نفسُه الذي تكتب به المنصة (`GOOGLE_SHEETS_CLIENT_EMAIL`/
 *  `GOOGLE_SHEETS_PRIVATE_KEY`) — أو زوجٌ مخصّص (`MARKETING_ARCHIVE_CLIENT_EMAIL`/`…_PRIVATE_KEY`)
 *  إن ضُبط كاملاً. ولا يُطبع منها شيء.
 *
 *  **ولا يبتلع الأخطاء:** الكتابةُ هنا شرطُ حذفٍ من النظام النشط، فكلُّ فشلٍ يُرمى ليُسجَّل في سجلّ
 *  الأرشفة. والقيمُ تُكتب `RAW` فتُقرأ كما كُتبت. والقراءةُ دفعةٌ واحدة لكل التبويبات (`batchGet`). */
export interface ArchiveStore {
  /** اسمُ الملف كما يُسجَّل في سجلّ الأرشفة */
  readonly sheet: string;
  /** يضمن التبويبات بعناوينها وتنسيقها بألوان الهوية — ويُنشئ الناقصَ وحده، ولا يمسّ الصفوف */
  ensure(): Promise<{ created: string[]; fixedHeaders: string[] }>;
  /** صفوفُ البيانات (من الصف الثالث) لكل تبويبٍ مطلوب — بأعمدته الأولى (عددٌ واحدٌ للكل أو لكل
   *  تبويبٍ عددُه)، وفي نافذةٍ إن حُدّدت له (`from`/`to` ترتيبُ الصف بين صفوف البيانات، من الصفر،
   *  شاملان) — فلا يُحمَّل الأرشيفُ كلُّه لحملةٍ واحدة */
  read(tabs: readonly string[], columns: number | Readonly<Record<string, number>>, windows?: Partial<Record<string, { from: number; to: number }>>): Promise<Record<string, string[][]>>;
  append(tab: string, rows: string[][]): Promise<void>;
}

const TIMEOUT_MS = 20_000;
/** الأسماءُ التي يعطيها Google للتبويب الأول — يصير «اقرأني» إن لم يوجد */
const DEFAULT_FIRST_TAB = ["Untitled", "Sheet1", "الورقة1", "ورقة1"];
const rgb = (hex: string) => ({ red: parseInt(hex.slice(1, 3), 16) / 255, green: parseInt(hex.slice(3, 5), 16) / 255, blue: parseInt(hex.slice(5, 7), 16) / 255 });
const BRAND = { purple: rgb(ARCHIVE_BRAND.purple), orange: rgb(ARCHIVE_BRAND.orange), beige: rgb(ARCHIVE_BRAND.beige), white: rgb(ARCHIVE_BRAND.white) };

export function columnLetter(n: number): string {
  let s = "";
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
}
const quote = (name: string) => `'${name.replace(/'/g, "''")}'`;
/** ما ضُمن في هذه العملية — لا يُعاد فحصُه في كل طلب */
const ensuredFiles = new Set<string>();

type Env = Record<string, string | undefined>;

/** بياناتُ الاعتماد: الزوجُ المخصّص كاملاً، وإلا حسابُ خدمة المنصة — لا خلطَ بينهما */
function credentials(env: Env) {
  const own = env.MARKETING_ARCHIVE_CLIENT_EMAIL?.trim() && env.MARKETING_ARCHIVE_PRIVATE_KEY?.trim();
  const email = own ? env.MARKETING_ARCHIVE_CLIENT_EMAIL : env.GOOGLE_SHEETS_CLIENT_EMAIL;
  const key = (own ? env.MARKETING_ARCHIVE_PRIVATE_KEY : env.GOOGLE_SHEETS_PRIVATE_KEY)?.replace(/\\n/g, "\n");
  return email && key ? { email, key } : null;
}

/** المخزنُ الحقيقيّ — أو `null` إن لم يُضبط الملفُّ وبياناتُ اعتماده (فالأرشيف «غير مهيّأ»: لا أرشفةَ ولا حذف) */
export function marketingArchiveStore(env: Env = process.env): ArchiveStore | null {
  const spreadsheetId = marketingArchiveSpreadsheetId(env);
  const creds = credentials(env);
  if (!spreadsheetId || !creds) return null;
  const auth = new google.auth.JWT({ email: creds.email, key: creds.key, scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
  return sheetsArchiveStore(google.sheets({ version: "v4", auth }), spreadsheetId);
}

export function sheetsArchiveStore(sheets: sheets_v4.Sheets, spreadsheetId: string): ArchiveStore {
  return {
    sheet: ARCHIVE_FILE_LABEL,

    async ensure() {
      if (ensuredFiles.has(spreadsheetId)) return { created: [], fixedHeaders: [] };
      const fields = "sheets(properties(sheetId,title,index),bandedRanges(bandedRangeId))";
      const meta = await sheets.spreadsheets.get({ spreadsheetId, fields }, { timeout: TIMEOUT_MS });
      const props = (meta.data.sheets ?? []).map((s) => ({ ...(s.properties ?? {}), banded: (s.bandedRanges ?? []).length > 0 }));
      const titles = new Set(props.map((p) => p.title));
      const requests: sheets_v4.Schema$Request[] = [];
      const first = props.find((p) => p.index === 0);
      if (!titles.has(ARCHIVE_README_TAB) && first?.title && DEFAULT_FIRST_TAB.includes(first.title) && first.sheetId != null) {
        requests.push({ updateSheetProperties: { properties: { sheetId: first.sheetId, title: ARCHIVE_README_TAB, rightToLeft: true }, fields: "title,rightToLeft" } });
      }
      const missing = ARCHIVE_TABS.filter((t) => !titles.has(t.name));
      const addAt = requests.length;
      for (const t of missing) requests.push({ addSheet: { properties: { title: t.name, rightToLeft: true, gridProperties: { frozenRowCount: 2 } } } });
      const ids = new Map<string, { sheetId: number; banded: boolean }>();
      for (const p of props) if (p.title && p.sheetId != null) ids.set(p.title, { sheetId: p.sheetId, banded: p.banded });
      if (requests.length) {
        const res = await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } }, { timeout: TIMEOUT_MS });
        missing.forEach((t, i) => {
          const id = res.data.replies?.[addAt + i]?.addSheet?.properties?.sheetId;
          if (id != null) ids.set(t.name, { sheetId: id, banded: false });
        });
      }

      // العناوينُ: سطرا الرأس وحدهما — والصفوفُ من الثالث لا تُمسّ
      const heads = await sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges: ARCHIVE_TABS.map((t) => `${quote(t.name)}!A2:${columnLetter(t.width)}2`) }, { timeout: TIMEOUT_MS });
      const wrong = ARCHIVE_TABS.filter((t, i) => {
        const got = (heads.data.valueRanges?.[i]?.values?.[0] ?? []).map(String);
        return got.length !== t.headers.length || t.headers.some((h, j) => got[j] !== h);
      });
      if (wrong.length) {
        await sheets.spreadsheets.values.batchUpdate({
          spreadsheetId,
          requestBody: { valueInputOption: "RAW", data: wrong.map((t) => ({ range: `${quote(t.name)}!A1:${columnLetter(t.width)}2`, values: [[t.title, ...Array(t.width - 1).fill("")], t.headers] })) },
        }, { timeout: TIMEOUT_MS });
      }
      // التنسيقُ بألوان الهوية لكل تبويب — طلباتٌ لا تتراكم بالتكرار (تنسيقُ الرأس والعرض والتجميد)،
      // وتناوبُ الألوان يُضاف مرّةً واحدة لما لا تناوبَ فيه. والقيمُ لا تُمسّ.
      const format: sheets_v4.Schema$Request[] = [];
      for (const t of ARCHIVE_TABS) {
        const s = ids.get(t.name);
        if (!s) continue;
        format.push(...styleTab(t, s.sheetId, !s.banded));
      }
      if (format.length) await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: format } }, { timeout: TIMEOUT_MS });
      ensuredFiles.add(spreadsheetId);
      return { created: missing.map((t) => t.name), fixedHeaders: wrong.filter((t) => !missing.includes(t)).map((t) => t.name) };
    },

    async read(tabs, columns, windows = {}) {
      if (tabs.length === 0) return {};
      const widthOf = (name: string) => (typeof columns === "number" ? columns : columns[name] ?? 2);
      const ranges = tabs.map((name) => {
        const w = windows[name];
        const last = columnLetter(widthOf(name));
        return w ? `${quote(name)}!A${w.from + 3}:${last}${w.to + 3}` : `${quote(name)}!A3:${last}`;
      });
      const res = await sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges, valueRenderOption: "FORMATTED_VALUE" }, { timeout: TIMEOUT_MS });
      const out: Record<string, string[][]> = {};
      tabs.forEach((name, i) => {
        out[name] = ((res.data.valueRanges?.[i]?.values ?? []) as unknown[][]).map((r) => r.map((v) => (v === null || v === undefined ? "" : String(v))));
      });
      return out;
    },

    async append(tab, rows) {
      if (rows.length === 0) return;
      const width = ARCHIVE_TABS.find((t) => t.name === tab)?.width ?? rows[0].length;
      await sheets.spreadsheets.values.append(
        { spreadsheetId, range: `${quote(tab)}!A:${columnLetter(width)}`, valueInputOption: "RAW", insertDataOption: "INSERT_ROWS", requestBody: { values: rows } },
        { timeout: TIMEOUT_MS }
      );
    },
  };
}

/** تنسيقُ تبويبٍ بالهوية: صفُّ العنوان بنفسجيٌّ داكن بخطٍّ بيج، ورؤوسُ الأعمدة برتقاليّةٌ بخطٍّ أبيض،
 *  وتناوبُ الصفوف أبيض/بيج، والنصوصُ الطويلة ملتفّة، والعرضُ لكل عمود، والرأسُ مثبَّت، والاتجاهُ من
 *  اليمين. كلُّها تُعاد بلا أثرٍ متراكم — إلا التناوب فيُضاف مرّةً (`addBanding`). */
export function styleTab(t: ArchiveTab, sheetId: number, addBanding: boolean): sheets_v4.Schema$Request[] {
  const row = (r: number, bg: typeof BRAND.white, fg: typeof BRAND.white, size: number): sheets_v4.Schema$Request => ({
    repeatCell: {
      range: { sheetId, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: 0, endColumnIndex: t.width },
      cell: { userEnteredFormat: { backgroundColor: bg, textFormat: { bold: true, fontSize: size, foregroundColor: fg, fontFamily: "Cairo" }, horizontalAlignment: "RIGHT", verticalAlignment: "MIDDLE", wrapStrategy: r === 1 ? "WRAP" : "OVERFLOW_CELL" } },
      fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)",
    },
  });
  const out: sheets_v4.Schema$Request[] = [
    { updateSheetProperties: { properties: { sheetId, rightToLeft: true, gridProperties: { frozenRowCount: 2 } }, fields: "rightToLeft,gridProperties.frozenRowCount" } },
    row(0, BRAND.purple, BRAND.beige, 13),
    row(1, BRAND.orange, BRAND.white, 10),
    { updateDimensionProperties: { range: { sheetId, dimension: "ROWS", startIndex: 0, endIndex: 1 }, properties: { pixelSize: 38 }, fields: "pixelSize" } },
    { updateDimensionProperties: { range: { sheetId, dimension: "ROWS", startIndex: 1, endIndex: 2 }, properties: { pixelSize: 34 }, fields: "pixelSize" } },
    ...t.widths.map((pixelSize, i): sheets_v4.Schema$Request => ({ updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: i, endIndex: i + 1 }, properties: { pixelSize }, fields: "pixelSize" } })),
    // صفوفُ البيانات: محاذاةٌ لأعلى، والنصوصُ الطويلة ملتفّة — للعمود كلِّه فيرثها كلُّ صفٍّ يُلحق
    ...t.columns.map((c, i): sheets_v4.Schema$Request => ({
      repeatCell: {
        range: { sheetId, startRowIndex: 2, startColumnIndex: i, endColumnIndex: i + 1 },
        cell: { userEnteredFormat: { verticalAlignment: "TOP", horizontalAlignment: "RIGHT", wrapStrategy: c.wrap ? "WRAP" : "CLIP", textFormat: { fontFamily: "Cairo", fontSize: 10 } } },
        fields: "userEnteredFormat(verticalAlignment,horizontalAlignment,wrapStrategy,textFormat(fontFamily,fontSize))",
      },
    })),
  ];
  if (addBanding) {
    out.push({
      addBanding: {
        bandedRange: {
          range: { sheetId, startRowIndex: 2, startColumnIndex: 0, endColumnIndex: t.width },
          rowProperties: { firstBandColor: BRAND.white, secondBandColor: BRAND.beige },
        },
      },
    });
  }
  return out;
}

