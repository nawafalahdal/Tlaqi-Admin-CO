import { google } from "googleapis";
import type { sheets_v4 } from "googleapis";

const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
const CLIENT_EMAIL = process.env.GOOGLE_SHEETS_CLIENT_EMAIL;
const PRIVATE_KEY = process.env.GOOGLE_SHEETS_PRIVATE_KEY?.replace(/\\n/g, "\n");

const BRAND = {
  temptress: { red: 0x34 / 255, green: 0x1d / 255, blue: 0x2b / 255 },
  mahogany: { red: 0xc3 / 255, green: 0x49 / 255, blue: 0x00 / 255 },
  beige: { red: 0xee / 255, green: 0xf6 / 255, blue: 0xdf / 255 },
  white: { red: 1, green: 1, blue: 1 },
};

function getClient() {
  if (!SPREADSHEET_ID || !CLIENT_EMAIL || !PRIVATE_KEY) return null;
  const auth = new google.auth.JWT({
    email: CLIENT_EMAIL,
    key: PRIVATE_KEY,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

/** يضيف صفاً واحداً للسجل الحي الموحّد (الاسم، البريد، القسم/الصفة، النوع،
 *  التفاصيل، التاريخ) — هذا هو السجل الرسمي المحدّث أولاً بأول لكل الأحداث:
 *  اعتماد عضو جديد، تنبيه، استبعاد... إلخ */
export async function appendSheetRow(row: {
  fullName: string;
  email: string;
  roleOrDepartment: string;
  eventType: string;
  details: string;
  at: Date;
}) {
  return appendRow("السجل الحي", [
    row.fullName,
    row.email,
    row.roleOrDepartment,
    row.eventType,
    row.details,
    formatSheetDate(row.at),
  ]);
}

export async function appendApprovedMember(row: {
  fullName: string;
  email: string;
  departmentName: string;
  jobTitle?: string | null;
  approvedAt: Date;
}) {
  return appendSheetRow({
    fullName: row.fullName,
    email: row.email,
    roleOrDepartment: row.departmentName,
    eventType: "اعتماد نهائي",
    details: row.jobTitle ?? "",
    at: row.approvedAt,
  });
}

export async function appendMemberEvent(row: {
  fullName: string;
  email: string;
  event: string;
  details: string;
  at: Date;
}) {
  return appendSheetRow({
    fullName: row.fullName,
    email: row.email,
    roleOrDepartment: "",
    eventType: row.event,
    details: row.details,
    at: row.at,
  });
}

/** يضيف صفاً لتبويب "نتائج الاختبارات" عند كل محاولة اختبار — نجاح أو رسوب */
export async function appendTestResult(row: {
  fullName: string;
  email: string;
  track: string;
  score: number;
  passed: boolean;
  at: Date;
}) {
  return appendRow("نتائج الاختبارات", [
    row.fullName,
    row.email,
    row.track,
    `${row.score}%`,
    row.passed ? "ناجح" : "راسب",
    formatSheetDate(row.at),
  ]);
}

/** يضيف صفاً لتبويب "التذاكر" عند كل حدث على تذكرة: رفع، تصعيد، حل */
export async function appendTicketEvent(row: {
  fullName: string;
  email: string;
  targetDepartment: string;
  subject: string;
  details: string;
  event: string;
  stage: string;
  at: Date;
}) {
  return appendRow("التذاكر", [
    row.fullName,
    row.email,
    row.targetDepartment,
    row.subject,
    row.details,
    row.event,
    row.stage,
    formatSheetDate(row.at),
  ]);
}

function formatSheetDate(at: Date) {
  return at.toLocaleString("ar-SA", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const TAB_SPECS: Record<string, { title: string; headers: string[]; widths: number[] }> = {
  "السجل الحي": {
    title: "تَـــلاقِ — السجل الحي للأعضاء والأحداث",
    headers: ["الاسم", "البريد الإلكتروني", "القسم / الصفة", "النوع", "التفاصيل", "التاريخ"],
    widths: [160, 220, 160, 130, 320, 170],
  },
  "نتائج الاختبارات": {
    title: "تَـــلاقِ — نتائج اختبارات القبول",
    headers: ["الاسم", "البريد الإلكتروني", "القسم / المسار", "النتيجة", "الحكم", "التاريخ"],
    widths: [160, 220, 170, 100, 100, 170],
  },
  "التذاكر": {
    title: "تَـــلاقِ — سجل التذاكر والتصعيد",
    headers: ["الاسم", "البريد الإلكتروني", "القسم المستهدف", "الموضوع", "التفاصيل", "الحدث", "المرحلة الحالية", "التاريخ"],
    widths: [160, 220, 160, 200, 300, 130, 160, 170],
  },
};

async function appendRow(tabName: string, values: (string | number)[]) {
  const sheets = getClient();
  if (!sheets) {
    console.warn(`[google-sheets:disabled] لم تُضبط بيانات اعتماد Google Sheets — تم تجاهل الكتابة إلى "${tabName}".`, values);
    return { skipped: true };
  }

  try {
    await ensureTab(sheets, tabName);
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID!,
      range: `'${tabName}'!A:Z`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [values] },
    });
    return { skipped: false };
  } catch (err) {
    console.error(`فشلت الكتابة إلى تبويب "${tabName}":`, err);
    return { skipped: true, error: true };
  }
}

const ensuredTabs = new Set<string>();

/** ينشئ التبويب إن لم يكن موجوداً وينسّقه بهوية تَـــلاقِ (عنوان مُدمج، رؤوس
 *  ملوّنة، تجميد، اتجاه RTL، عرض أعمدة) — يُنفَّذ مرة واحدة فقط لكل تبويب في
 *  عمر العملية (serverless) بفضل ensuredTabs، والتحقق الفعلي من وجود التبويب
 *  يحمي بقية الاستدعاءات حتى بعد إعادة تشغيل الدالة */
async function ensureTab(sheets: sheets_v4.Sheets, tabName: string) {
  if (ensuredTabs.has(tabName)) return;

  const spec = TAB_SPECS[tabName];
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID! });
  const existing = meta.data.sheets?.find((s) => s.properties?.title === tabName);

  if (existing) {
    ensuredTabs.add(tabName);
    return;
  }

  if (!spec) {
    ensuredTabs.add(tabName);
    return;
  }

  const addResult = await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID!,
    requestBody: { requests: [{ addSheet: { properties: { title: tabName } } }] },
  });
  const sheetId = addResult.data.replies?.[0]?.addSheet?.properties?.sheetId;
  if (sheetId === undefined || sheetId === null) {
    ensuredTabs.add(tabName);
    return;
  }

  const colCount = spec.headers.length;

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID!,
    range: `'${tabName}'!A1:${String.fromCharCode(64 + colCount)}2`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [
        [spec.title, ...Array(colCount - 1).fill("")],
        spec.headers,
      ],
    },
  });

  const requests: sheets_v4.Schema$Request[] = [
    { updateSheetProperties: { properties: { sheetId, rightToLeft: true }, fields: "rightToLeft" } },
    {
      mergeCells: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: colCount },
        mergeType: "MERGE_ALL",
      },
    },
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: colCount },
        cell: {
          userEnteredFormat: {
            backgroundColor: BRAND.temptress,
            horizontalAlignment: "CENTER",
            verticalAlignment: "MIDDLE",
            textFormat: { foregroundColor: BRAND.beige, bold: true, fontSize: 14 },
          },
        },
        fields: "userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,textFormat)",
      },
    },
    { updateDimensionProperties: { range: { sheetId, dimension: "ROWS", startIndex: 0, endIndex: 1 }, properties: { pixelSize: 44 }, fields: "pixelSize" } },
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: colCount },
        cell: {
          userEnteredFormat: {
            backgroundColor: BRAND.mahogany,
            horizontalAlignment: "CENTER",
            verticalAlignment: "MIDDLE",
            textFormat: { foregroundColor: BRAND.white, bold: true, fontSize: 11 },
          },
        },
        fields: "userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,textFormat)",
      },
    },
    { updateDimensionProperties: { range: { sheetId, dimension: "ROWS", startIndex: 1, endIndex: 2 }, properties: { pixelSize: 34 }, fields: "pixelSize" } },
    { updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: 2 } }, fields: "gridProperties.frozenRowCount" } },
    ...spec.widths.map((pixelSize, i) => ({
      updateDimensionProperties: {
        range: { sheetId, dimension: "COLUMNS" as const, startIndex: i, endIndex: i + 1 },
        properties: { pixelSize },
        fields: "pixelSize",
      },
    })),
    {
      addBanding: {
        bandedRange: {
          range: { sheetId, startRowIndex: 2, endRowIndex: 2000, startColumnIndex: 0, endColumnIndex: colCount },
          rowProperties: {
            headerColor: BRAND.mahogany,
            firstBandColor: BRAND.white,
            secondBandColor: { red: 0.97, green: 0.96, blue: 0.93 },
          },
        },
      },
    },
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 2, endRowIndex: 2000, startColumnIndex: 0, endColumnIndex: colCount },
        cell: { userEnteredFormat: { horizontalAlignment: "RIGHT", wrapStrategy: "WRAP" } },
        fields: "userEnteredFormat(horizontalAlignment,wrapStrategy)",
      },
    },
  ];

  if (tabName === "نتائج الاختبارات") {
    requests.push(
      {
        addConditionalFormatRule: {
          rule: {
            ranges: [{ sheetId, startRowIndex: 2, endRowIndex: 2000, startColumnIndex: 4, endColumnIndex: 5 }],
            booleanRule: {
              condition: { type: "TEXT_EQ", values: [{ userEnteredValue: "ناجح" }] },
              format: { backgroundColor: { red: 0.89, green: 0.95, blue: 0.91 }, textFormat: { foregroundColor: { red: 0.12, green: 0.42, blue: 0.23 } } },
            },
          },
          index: 0,
        },
      },
      {
        addConditionalFormatRule: {
          rule: {
            ranges: [{ sheetId, startRowIndex: 2, endRowIndex: 2000, startColumnIndex: 4, endColumnIndex: 5 }],
            booleanRule: {
              condition: { type: "TEXT_EQ", values: [{ userEnteredValue: "راسب" }] },
              format: { backgroundColor: { red: 0.98, green: 0.9, blue: 0.88 }, textFormat: { foregroundColor: { red: 0.6, green: 0.18, blue: 0.11 } } },
            },
          },
          index: 1,
        },
      }
    );
  }

  if (tabName === "التذاكر") {
    requests.push(
      {
        addConditionalFormatRule: {
          rule: {
            ranges: [{ sheetId, startRowIndex: 2, endRowIndex: 2000, startColumnIndex: 5, endColumnIndex: 6 }],
            booleanRule: {
              condition: { type: "TEXT_EQ", values: [{ userEnteredValue: "تم الحل" }] },
              format: { backgroundColor: { red: 0.89, green: 0.95, blue: 0.91 }, textFormat: { foregroundColor: { red: 0.12, green: 0.42, blue: 0.23 } } },
            },
          },
          index: 0,
        },
      },
      {
        addConditionalFormatRule: {
          rule: {
            ranges: [{ sheetId, startRowIndex: 2, endRowIndex: 2000, startColumnIndex: 5, endColumnIndex: 6 }],
            booleanRule: {
              condition: { type: "TEXT_CONTAINS", values: [{ userEnteredValue: "تصعيد" }] },
              format: { backgroundColor: { red: 1, green: 0.95, blue: 0.87 }, textFormat: { foregroundColor: { red: 0.54, green: 0.35, blue: 0 } } },
            },
          },
          index: 1,
        },
      }
    );
  }

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID!,
    requestBody: { requests },
  });

  ensuredTabs.add(tabName);
}
