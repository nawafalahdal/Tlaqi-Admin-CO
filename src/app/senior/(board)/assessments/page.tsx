import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AssessmentsView } from "./AssessmentsView";

export const dynamic = "force-dynamic";

/** **اختباراتُ الأعضاء تبويبٌ في «الأعضاء»** (قرار المؤسس، 24 نوفمبر 2026) — والصفحةُ باقيةٌ هنا لعضوٍ يحمل صلاحيتها في
 *  الإدارة العليا (لا يدخل `/admin`). والحرسُ نفسُه في `AssessmentsView`. */
export default async function AssessmentsPage() {
  const session = await auth();
  if (session && session.user.role !== "member") redirect("/admin/people?view=assessments");
  return <AssessmentsView />;
}
