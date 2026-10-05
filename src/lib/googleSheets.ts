import { google } from "googleapis";

const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
const CLIENT_EMAIL = process.env.GOOGLE_SHEETS_CLIENT_EMAIL;
const PRIVATE_KEY = process.env.GOOGLE_SHEETS_PRIVATE_KEY?.replace(/\\n/g, "\n");

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
  const sheets = getClient();
  if (!sheets) {
    console.warn(
      "[google-sheets:disabled] لم تُضبط بيانات اعتماد Google Sheets — تم تجاهل الكتابة.",
      row
    );
    return { skipped: true };
  }

  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID!,
      range: "A:F",
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [
          [
            row.fullName,
            row.email,
            row.roleOrDepartment,
            row.eventType,
            row.details,
            row.at.toISOString(),
          ],
        ],
      },
    });
    return { skipped: false };
  } catch (err) {
    console.error("فشلت الكتابة إلى Google Sheet:", err);
    return { skipped: true, error: true };
  }
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

const BRAND = {
  temptress: { red: 0x34 / 255, green: 0x1d / 255, blue: 0x2b / 255 },
  mahogany: { red: 0xc3 / 255, green: 0x49 / 255, blue: 0x00 / 255 },
  beige: { red: 0xee / 255, green: 0xf6 / 255, blue: 0xdf / 255 },
  white: { red: 1, green: 1, blue: 1 },
};

/** ينسّق السجل الحي بهوية تَـــلاقِ: عنوان مُدمج، رؤوس بألوان الهوية، تجميد،
 *  اتجاه RTL، تلوين تبادلي للصفوف، وتنسيق شرطي حسب نوع الحدث. عملية لمرة واحدة. */
export async function formatBrandedSheet() {
  const sheets = getClient();
  if (!sheets) return { skipped: true };

  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID! });
  const sheet0 = meta.data.sheets?.[0];
  const sheetId = sheet0?.properties?.sheetId;
  if (sheetId === undefined || sheetId === null) return { skipped: true, error: "no-sheet" };

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID!,
    range: "A1:F2",
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [
        ["تَـــلاقِ — السجل الحي للأعضاء والأحداث", "", "", "", "", ""],
        ["الاسم", "البريد الإلكتروني", "القسم / الصفة", "النوع", "التفاصيل", "التاريخ"],
      ],
    },
  });

  const requests = [
    { updateSheetProperties: { properties: { sheetId, rightToLeft: true }, fields: "rightToLeft" } },
    {
      mergeCells: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 6 },
        mergeType: "MERGE_ALL" as const,
      },
    },
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 6 },
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
    { updateDimensionProperties: { range: { sheetId, dimension: "ROWS" as const, startIndex: 0, endIndex: 1 }, properties: { pixelSize: 44 }, fields: "pixelSize" } },
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: 6 },
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
    { updateDimensionProperties: { range: { sheetId, dimension: "ROWS" as const, startIndex: 1, endIndex: 2 }, properties: { pixelSize: 34 }, fields: "pixelSize" } },
    { updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: 2 } }, fields: "gridProperties.frozenRowCount" } },
    { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS" as const, startIndex: 0, endIndex: 1 }, properties: { pixelSize: 160 }, fields: "pixelSize" } },
    { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS" as const, startIndex: 1, endIndex: 2 }, properties: { pixelSize: 220 }, fields: "pixelSize" } },
    { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS" as const, startIndex: 2, endIndex: 3 }, properties: { pixelSize: 160 }, fields: "pixelSize" } },
    { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS" as const, startIndex: 3, endIndex: 4 }, properties: { pixelSize: 130 }, fields: "pixelSize" } },
    { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS" as const, startIndex: 4, endIndex: 5 }, properties: { pixelSize: 320 }, fields: "pixelSize" } },
    { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS" as const, startIndex: 5, endIndex: 6 }, properties: { pixelSize: 170 }, fields: "pixelSize" } },
    {
      addBanding: {
        bandedRange: {
          range: { sheetId, startRowIndex: 2, endRowIndex: 1000, startColumnIndex: 0, endColumnIndex: 6 },
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
        range: { sheetId, startRowIndex: 2, endRowIndex: 1000, startColumnIndex: 0, endColumnIndex: 6 },
        cell: { userEnteredFormat: { horizontalAlignment: "RIGHT", wrapStrategy: "WRAP" } },
        fields: "userEnteredFormat(horizontalAlignment,wrapStrategy)",
      },
    },
    {
      addConditionalFormatRule: {
        rule: {
          ranges: [{ sheetId, startRowIndex: 2, endRowIndex: 1000, startColumnIndex: 3, endColumnIndex: 4 }],
          booleanRule: {
            condition: { type: "TEXT_CONTAINS" as const, values: [{ userEnteredValue: "اعتماد" }] },
            format: { backgroundColor: { red: 0.89, green: 0.95, blue: 0.91 }, textFormat: { foregroundColor: { red: 0.12, green: 0.42, blue: 0.23 } } },
          },
        },
        index: 0,
      },
    },
    {
      addConditionalFormatRule: {
        rule: {
          ranges: [{ sheetId, startRowIndex: 2, endRowIndex: 1000, startColumnIndex: 3, endColumnIndex: 4 }],
          booleanRule: {
            condition: { type: "TEXT_CONTAINS" as const, values: [{ userEnteredValue: "تنبيه" }] },
            format: { backgroundColor: { red: 1, green: 0.95, blue: 0.87 }, textFormat: { foregroundColor: { red: 0.54, green: 0.35, blue: 0 } } },
          },
        },
        index: 1,
      },
    },
    {
      addConditionalFormatRule: {
        rule: {
          ranges: [{ sheetId, startRowIndex: 2, endRowIndex: 1000, startColumnIndex: 3, endColumnIndex: 4 }],
          booleanRule: {
            condition: { type: "TEXT_CONTAINS" as const, values: [{ userEnteredValue: "استبعاد" }] },
            format: { backgroundColor: { red: 0.98, green: 0.9, blue: 0.88 }, textFormat: { foregroundColor: { red: 0.6, green: 0.18, blue: 0.11 } } },
          },
        },
        index: 2,
      },
    },
    {
      addConditionalFormatRule: {
        rule: {
          ranges: [{ sheetId, startRowIndex: 2, endRowIndex: 1000, startColumnIndex: 3, endColumnIndex: 4 }],
          booleanRule: {
            condition: { type: "TEXT_CONTAINS" as const, values: [{ userEnteredValue: "رفض" }] },
            format: { backgroundColor: { red: 0.98, green: 0.9, blue: 0.88 }, textFormat: { foregroundColor: { red: 0.6, green: 0.18, blue: 0.11 } } },
          },
        },
        index: 3,
      },
    },
    { updateSheetProperties: { properties: { sheetId, title: "السجل الحي" }, fields: "title" } },
  ];

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID!,
    requestBody: { requests },
  });

  return { skipped: false };
}
