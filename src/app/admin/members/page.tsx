import { redirect } from "next/navigation";

/** سجلّ الأعضاء انضمّ إلى إدارة الأعضاء في `/admin/people`: الشخص
 *  وموقعه وقسمه في موضعٍ واحد، فلا يُدخَل مرتين ولا يُقرأ من شاشتين. */
export default function MovedMembersPage() {
  redirect("/admin/people");
}
