import { redirect } from "next/navigation";

/** **انتقلت إلى «التذاكر» ← «بانتظار اعتمادي»** (قرار المؤسس، 24 نوفمبر 2026): اعتماداتُ الطلبات تذاكرُ أصلاً — والرابطُ
 *  القديم (من بريدٍ أو إشارةٍ محفوظة) يُحوَّل إليها. */
export default function Moved() {
  redirect("/admin/tickets?view=approvals");
}
