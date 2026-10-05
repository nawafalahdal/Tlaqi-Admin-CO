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
