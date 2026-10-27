import { google } from "googleapis";
import type { sheets_v4 } from "googleapis";
import { marketingArchiveSpreadsheetId } from "@/lib/deploymentEnv";
import { ARCHIVE_TABS, ARCHIVE_COLS, ARCHIVE_README_TAB, ARCHIVE_FILE_LABEL } from "./archiveLayout";

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
  /** يضمن التبويبات بعناوينها — ويُنشئ الناقصَ وحده، ولا يمسّ الصفوف */
  ensure(): Promise<{ created: string[]; fixedHeaders: string[] }>;
  /** صفوفُ البيانات (من الصف الثالث) لكل تبويبٍ مطلوب — بأعمدته الأولى، وفي نافذةٍ إن حُدّدت له
   *  (`from`/`to` ترتيبُ الصف بين صفوف البيانات، من الصفر، شاملان) — فلا يُحمَّل الأرشيفُ كلُّه لحملةٍ واحدة */
  read(tabs: readonly string[], columns: number, windows?: Partial<Record<string, { from: number; to: number }>>): Promise<Record<string, string[][]>>;
  append(tab: string, rows: string[][]): Promise<void>;
}

const TIMEOUT_MS = 20_000;
/** الأسماءُ التي يعطيها Google للتبويب الأول — يصير «اقرأني» إن لم يوجد */
const DEFAULT_FIRST_TAB = ["Untitled", "Sheet1", "الورقة1", "ورقة1"];
const BRAND = {
  temptress: { red: 0x34 / 255, green: 0x1d / 255, blue: 0x2b / 255 },
  beige: { red: 0xee / 255, green: 0xf6 / 255, blue: 0xdf / 255 },
  white: { red: 1, green: 1, blue: 1 },
};

export function columnLetter(n: number): string {
  let s = "";
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
}
const quote = (name: string) => `'${name.replace(/'/g, "''")}'`;
const LAST = columnLetter(ARCHIVE_COLS);
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
      const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties(sheetId,title,index)" }, { timeout: TIMEOUT_MS });
      const props = (meta.data.sheets ?? []).map((s) => s.properties ?? {});
      const titles = new Set(props.map((p) => p.title));
      const requests: sheets_v4.Schema$Request[] = [];
      const first = props.find((p) => p.index === 0);
      if (!titles.has(ARCHIVE_README_TAB) && first?.title && DEFAULT_FIRST_TAB.includes(first.title) && first.sheetId != null) {
        requests.push({ updateSheetProperties: { properties: { sheetId: first.sheetId, title: ARCHIVE_README_TAB, rightToLeft: true }, fields: "title,rightToLeft" } });
      }
      const missing = ARCHIVE_TABS.filter((t) => !titles.has(t.name));
      const addAt = requests.length;
      for (const t of missing) requests.push({ addSheet: { properties: { title: t.name, rightToLeft: true, gridProperties: { frozenRowCount: 2 } } } });
      const newIds = new Map<string, number>();
      if (requests.length) {
        const res = await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } }, { timeout: TIMEOUT_MS });
        missing.forEach((t, i) => {
          const id = res.data.replies?.[addAt + i]?.addSheet?.properties?.sheetId;
          if (id != null) newIds.set(t.name, id);
        });
      }

      // العناوينُ: سطرا الرأس وحدهما — والصفوفُ من الثالث لا تُمسّ
      const heads = await sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges: ARCHIVE_TABS.map((t) => `${quote(t.name)}!A2:${LAST}2`) }, { timeout: TIMEOUT_MS });
      const wrong = ARCHIVE_TABS.filter((t, i) => {
        const got = (heads.data.valueRanges?.[i]?.values?.[0] ?? []).map(String);
        return got.length !== t.headers.length || t.headers.some((h, j) => got[j] !== h);
      });
      if (wrong.length) {
        await sheets.spreadsheets.values.batchUpdate({
          spreadsheetId,
          requestBody: { valueInputOption: "RAW", data: wrong.map((t) => ({ range: `${quote(t.name)}!A1:${LAST}2`, values: [[t.title, ...Array(ARCHIVE_COLS - 1).fill("")], t.headers] })) },
        }, { timeout: TIMEOUT_MS });
      }
      // التنسيقُ للتبويب الجديد وحده: رأسٌ بلون الهوية، وعرضُ الأعمدة
      const format: sheets_v4.Schema$Request[] = [];
      for (const t of missing) {
        const sheetId = newIds.get(t.name);
        if (sheetId == null) continue;
        const row = (r: number, bg: typeof BRAND.white, fg: typeof BRAND.white, size: number): sheets_v4.Schema$Request => ({
          repeatCell: {
            range: { sheetId, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: 0, endColumnIndex: ARCHIVE_COLS },
            cell: { userEnteredFormat: { backgroundColor: bg, textFormat: { bold: true, fontSize: size, foregroundColor: fg }, horizontalAlignment: "RIGHT" } },
            fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)",
          },
        });
        format.push(row(0, BRAND.temptress, BRAND.white, 12), row(1, BRAND.beige, BRAND.temptress, 10));
        t.widths.forEach((pixelSize, i) => format.push({ updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: i, endIndex: i + 1 }, properties: { pixelSize }, fields: "pixelSize" } }));
      }
      if (format.length) await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: format } }, { timeout: TIMEOUT_MS });
      ensuredFiles.add(spreadsheetId);
      return { created: missing.map((t) => t.name), fixedHeaders: wrong.filter((t) => !missing.includes(t)).map((t) => t.name) };
    },

    async read(tabs, columns, windows = {}) {
      if (tabs.length === 0) return {};
      const ranges = tabs.map((name) => {
        const w = windows[name];
        return w ? `${quote(name)}!A${w.from + 3}:${columnLetter(columns)}${w.to + 3}` : `${quote(name)}!A3:${columnLetter(columns)}`;
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
      await sheets.spreadsheets.values.append(
        { spreadsheetId, range: `${quote(tab)}!A:${LAST}`, valueInputOption: "RAW", insertDataOption: "INSERT_ROWS", requestBody: { values: rows } },
        { timeout: TIMEOUT_MS }
      );
    },
  };
}
