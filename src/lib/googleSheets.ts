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

/** يكتب صفاً جديداً في Google Sheet فور اعتماد العضو نهائياً — هذا هو السجل الرسمي */
export async function appendApprovedMember(row: {
  fullName: string;
  email: string;
  departmentName: string;
  jobTitle?: string | null;
  approvedAt: Date;
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
      range: "التسجيل!A:E",
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [
          [
            row.fullName,
            row.email,
            row.departmentName,
            row.jobTitle ?? "",
            row.approvedAt.toISOString(),
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
