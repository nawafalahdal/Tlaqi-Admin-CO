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

/** يسجّل كل رسالة بريد تُرسلها المنصة — لمن، ونوعها، وهل وصلت فعلاً أم
 *  تُجوهلت لغياب المفتاح أو فشل الإرسال. بدون هذا السجل تبقى الحوكمة
 *  البريدية غير مرئية: لا تعرف هل بلغ الشخصَ إشعارُه أم لا. */
export async function appendEmailLog(row: {
  to: string[];
  kind: string;
  subject: string;
  status: "أُرسلت" | "لم تُرسل (البريد معطّل)" | "فشل الإرسال";
  at: Date;
}) {
  return appendRow("الرسائل المُرسَلة", [
    row.to.join("، "),
    row.kind,
    row.subject,
    row.status,
    formatSheetDate(row.at),
  ]);
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
  /** القسم أو الصفة — كان يُترك فارغاً في كل الأحداث، فيتعذّر فلترة السجل
   *  بالقسم ويضيع نصف فائدته. يُمرَّر الآن من موضع الاستدعاء. */
  roleOrDepartment?: string;
}) {
  return appendSheetRow({
    fullName: row.fullName,
    email: row.email,
    roleOrDepartment: row.roleOrDepartment ?? "",
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

/** يحدّث (أو ينشئ أول مرة) الصف الثابت الخاص بتذكرة واحدة في تبويب "التذاكر" —
 *  صف واحد لكل تذكرة بعمرها كاملاً، يعكس دائماً آخر حالة وجهة المسؤولية
 *  والتأخر من عدمه، بدل سجل أحداث متعدد الصفوف. يعيد رقم الصف ليُحفظ على
 *  التذكرة (sheetRow) ويُستخدم في التحديثات اللاحقة. */
export async function upsertTicketRow(row: {
  sheetRow: number | null;
  ticketNumber: number;
  fullName: string;
  email: string;
  targetDepartment: string;
  subject: string;
  details: string;
  status: "جديدة" | "قيد المعالجة" | "تم الحل";
  currentOwner: string;
  isLate: boolean;
  createdAt: Date;
  closedOrDueAt: Date;
  closedOnTime: boolean | null;
}) {
  return upsertRow("التذاكر", row.sheetRow, [
    row.ticketNumber,
    row.fullName,
    row.email,
    row.targetDepartment,
    row.subject,
    row.details,
    row.status,
    row.status === "تم الحل" ? "—" : row.currentOwner,
    row.isLate ? "نعم" : "لا",
    formatSheetDate(row.createdAt),
    formatSheetDate(row.closedOrDueAt),
    row.closedOnTime === null ? "—" : row.closedOnTime ? "نعم" : "لا",
  ]);
}

/** يحدّث (أو ينشئ أول مرة) الصف الثابت الخاص بعضو واحد في تبويب "الأعضاء —
 *  دورة الحياة" — صف واحد لكل عضو يعكس دائماً آخر حالة: تسليم البانر الترحيبي،
 *  إكمال 3 أشهر عضوية فعّالة، إصدار شهادة الإتمام، أو التوقف وسببه. */
export async function upsertMemberLifecycleRow(row: {
  sheetRow: number | null;
  fullName: string;
  email: string;
  departmentName: string;
  roleLabel: string;
  phone: string | null;
  jobTitle: string | null;
  createdAt: Date;
  credentialsIssuedAt: Date | null;
  firstLoginAt: Date | null;
  testScore: number | null;
  testStatus: string;
  decidedAt: Date;
  bannerDelivered: boolean | null;
  bannerDeliveredAt: Date | null;
  reachedThreeMonths: "نعم" | "لا بعد" | "توقف قبل إكمالها";
  certificateIssuedAt: Date | null;
  isActive: boolean;
  terminatedAt: Date | null;
  exitReason: string | null;
  warningsCount: number;
}) {
  const TEST_VERDICT: Record<string, string> = {
    passed: "ناجح",
    failed: "لم يجتز",
    not_started: "لم يبدأ",
  };

  return upsertRow("الأعضاء — دورة الحياة", row.sheetRow, [
    row.fullName,
    row.email,
    row.departmentName,
    row.roleLabel,
    row.phone ?? "—",
    row.jobTitle ?? "—",
    formatSheetDate(row.createdAt),
    row.credentialsIssuedAt ? formatSheetDate(row.credentialsIssuedAt) : "—",
    row.firstLoginAt ? formatSheetDate(row.firstLoginAt) : "لم يدخل بعد",
    row.testScore === null ? "—" : `${row.testScore}%`,
    TEST_VERDICT[row.testStatus] ?? row.testStatus,
    formatSheetDate(row.decidedAt),
    row.bannerDelivered === null ? "—" : row.bannerDelivered ? "نعم" : "لا",
    row.bannerDeliveredAt ? formatSheetDate(row.bannerDeliveredAt) : "—",
    row.reachedThreeMonths,
    row.certificateIssuedAt ? `نعم — ${formatSheetDate(row.certificateIssuedAt)}` : "لم تصدر",
    row.isActive ? "نشط" : "متوقف",
    row.terminatedAt ? formatSheetDate(row.terminatedAt) : "—",
    row.exitReason ?? "—",
    row.warningsCount,
  ]);
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
  "الرسائل المُرسَلة": {
    title: "تَـــلاقِ — سجل الرسائل المُرسَلة",
    headers: ["المستلم", "نوع الرسالة", "عنوان الرسالة", "الحالة", "التاريخ"],
    widths: [240, 180, 300, 120, 170],
  },
  "التذاكر": {
    title: "تَـــلاقِ — سجل التذاكر (صف ثابت لكل تذكرة)",
    headers: [
      "رقم التذكرة",
      "اسم العضو",
      "البريد الإلكتروني",
      "القسم المستهدف",
      "الموضوع",
      "التفاصيل",
      "الحالة",
      "الجهة المسؤولة حالياً",
      "متأخرة؟",
      "تاريخ الرفع",
      "الموعد الحالي / تاريخ الإغلاق",
      "أُغلقت بالموعد؟",
    ],
    widths: [100, 160, 220, 150, 200, 280, 110, 170, 90, 160, 190, 120],
  },
  "الأعضاء — دورة الحياة": {
    title: "تَـــلاقِ — دورة حياة الأعضاء (صف ثابت لكل عضو)",
    headers: [
      "الاسم",
      "البريد الإلكتروني",
      "القسم",
      "الصفة",
      "رقم الجوال",
      "المسمى الوظيفي",
      "تاريخ إنشاء الحساب",
      "تاريخ تسليم بيانات الدخول",
      "أول دخول",
      "نتيجة الاختبار",
      "حكم الاختبار",
      "تاريخ الاعتماد",
      "وصل البانر الترحيبي؟",
      "تاريخ تسليم البانر",
      "أكمل 3 أشهر فعّالة؟",
      "شهادة الإتمام",
      "الحالة الحالية",
      "تاريخ التوقف",
      "سبب التوقف",
      "عدد التنبيهات",
    ],
    widths: [160, 220, 150, 140, 130, 150, 170, 180, 160, 110, 110, 160, 140, 160, 150, 200, 110, 160, 220, 100],
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

/** يكتب صفاً ثابتاً لكيان واحد (تذكرة/عضو): يحدّث الصف نفسه إذا كان رقمه
 *  معروفاً مسبقاً (sheetRow)، أو يضيف صفاً جديداً أول مرة ويُرجع رقمه ليُحفظ. */
async function upsertRow(
  tabName: string,
  existingRow: number | null,
  values: (string | number)[]
): Promise<{ skipped: boolean; error?: boolean; sheetRow?: number }> {
  const sheets = getClient();
  if (!sheets) {
    console.warn(`[google-sheets:disabled] لم تُضبط بيانات اعتماد Google Sheets — تم تجاهل الكتابة إلى "${tabName}".`, values);
    return { skipped: true };
  }

  try {
    await ensureTab(sheets, tabName);
    const colCount = values.length;
    const lastCol = columnLetter(colCount);

    if (existingRow) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID!,
        range: `'${tabName}'!A${existingRow}:${lastCol}${existingRow}`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [values] },
      });
      return { skipped: false, sheetRow: existingRow };
    }

    const appendResult = await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID!,
      range: `'${tabName}'!A:${lastCol}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [values] },
    });
    const updatedRange = appendResult.data.updates?.updatedRange ?? "";
    const match = updatedRange.match(/![A-Z]+(\d+)/);
    const sheetRow = match ? Number(match[1]) : undefined;
    return { skipped: false, sheetRow };
  } catch (err) {
    console.error(`فشلت الكتابة إلى تبويب "${tabName}":`, err);
    return { skipped: true, error: true };
  }
}

function columnLetter(count: number) {
  let n = count;
  let letters = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
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
  const lastCol = columnLetter(colCount);

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID!,
    range: `'${tabName}'!A1:${lastCol}2`,
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
            ranges: [{ sheetId, startRowIndex: 2, endRowIndex: 2000, startColumnIndex: 6, endColumnIndex: 7 }],
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
            ranges: [{ sheetId, startRowIndex: 2, endRowIndex: 2000, startColumnIndex: 8, endColumnIndex: 9 }],
            booleanRule: {
              condition: { type: "TEXT_EQ", values: [{ userEnteredValue: "نعم" }] },
              format: { backgroundColor: { red: 0.98, green: 0.9, blue: 0.88 }, textFormat: { foregroundColor: { red: 0.6, green: 0.18, blue: 0.11 } } },
            },
          },
          index: 1,
        },
      }
    );
  }

  if (tabName === "الأعضاء — دورة الحياة") {
    requests.push(
      {
        addConditionalFormatRule: {
          rule: {
            ranges: [{ sheetId, startRowIndex: 2, endRowIndex: 2000, startColumnIndex: 8, endColumnIndex: 9 }],
            booleanRule: {
              condition: { type: "TEXT_EQ", values: [{ userEnteredValue: "نشط" }] },
              format: { backgroundColor: { red: 0.89, green: 0.95, blue: 0.91 }, textFormat: { foregroundColor: { red: 0.12, green: 0.42, blue: 0.23 } } },
            },
          },
          index: 0,
        },
      },
      {
        addConditionalFormatRule: {
          rule: {
            ranges: [{ sheetId, startRowIndex: 2, endRowIndex: 2000, startColumnIndex: 8, endColumnIndex: 9 }],
            booleanRule: {
              condition: { type: "TEXT_EQ", values: [{ userEnteredValue: "متوقف" }] },
              format: { backgroundColor: { red: 0.98, green: 0.9, blue: 0.88 }, textFormat: { foregroundColor: { red: 0.6, green: 0.18, blue: 0.11 } } },
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

/** يُجهّز التبويبات الأربعة كاملةً منسّقةً بهوية تَـــلاقِ قبل وصول أي بيانات.
 *
 *  التبويب كان يُنشأ عند أول كتابة فيه، فيبدو الملف شبه فارغ ولا يرى صاحبه
 *  الأعمدة التي ستصله. هذا يقلب الترتيب: القالب جاهز أولاً، ثم تنزل البيانات
 *  في مكانها لحظة وقوعها.
 *
 *  آمن للتكرار: ensureTab يتحقق من وجود التبويب فعلياً قبل إنشائه، فلا
 *  يُنشئ نسخة ثانية ولا يمس تنسيق تبويب قائم ولا بياناته. */
/** مخطط التبويبات كما يُبنى فعلاً — يُصدَّر ليعرض في الواجهة نفس الأعمدة
 *  التي ستُكتب في الملف، فلا يفترق الشرح عن الواقع */
export const TAB_LAYOUTS = Object.entries(TAB_SPECS).map(([name, spec]) => ({
  name,
  title: spec.title,
  headers: spec.headers,
}));

export async function prepareAllTabs() {
  const sheets = getClient();
  if (!sheets) {
    throw new Error("لم تُضبط بيانات اعتماد Google Sheets في بيئة التشغيل");
  }

  const prepared: string[] = [];
  for (const tabName of Object.keys(TAB_SPECS)) {
    // التحقق يسبق الإنشاء داخل ensureTab، فنُفرغ ذاكرة العملية لنضمن فحصاً
    // حقيقياً للملف لا اعتماداً على تشغيل سابق في نفس الدالة
    ensuredTabs.delete(tabName);
    await ensureTab(sheets, tabName);
    prepared.push(tabName);
  }
  return prepared;
}
