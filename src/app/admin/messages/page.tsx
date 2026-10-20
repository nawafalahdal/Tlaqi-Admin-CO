import { redirect } from "next/navigation";

/** «سجل الرسائل» صار «سجل التنبيهات» — تنبيهاتُ صاحب الحساب وحده (قرار المؤسس).
 *  والرابطُ القديم يُوصل إليه فلا ينكسر ما حُفظ منه. */
export default function MessagesPage() {
  redirect("/notifications");
}
