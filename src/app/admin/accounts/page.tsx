import { redirect } from "next/navigation";

/** «إدارة حسابات القيادة» و«سجلّ الأعضاء» صارا موضعاً واحداً:
 *  `/admin/people`. والمسار القديم يُحوِّل ولا يُحجَب — من حفظ الرابط أو
 *  وصل إليه من رسالةٍ قديمة يصل إلى الصفحة الجديدة لا إلى 404. */
export default function MovedAccountsPage() {
  redirect("/admin/people");
}
