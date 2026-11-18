import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { buildOrgChart } from "@/lib/orgChart";
import { buildOrgGraph } from "@/lib/org/orgGraph";
import { getLocale, getDictionary } from "@/i18n/server";
import { OrgExplorer } from "./OrgExplorer";

export const dynamic = "force-dynamic";

/** **هيكل تلاق التنظيمي — للعرض، لكل الأعضاء** (إعادة بناءٍ كاملة، نوفمبر 2026).
 *
 *  **ولا إجراء في هذه الصفحة على الإطلاق.** الهيكلُ لا يُخزَّن: يُحسَب في كل قراءة من المناصب والعضويات المسجَّلة
 *  (`buildOrgGraph`)، فلا دالّةَ نقلٍ ولا عمودَ ترتيبٍ يُكتب — ولا تتغيّر به صلاحيةٌ ولا قاعدةُ حوكمة.
 *
 *  **ومن يرى ماذا:** الصفحةُ لمن له جلسة (والمرشّحُ تحجبه البوابةُ المركزية كما كانت). والبياناتُ المرسلة إلى المتصفح
 *  الاسمُ والصورةُ والمسمّى والوحدةُ والرقمُ الوظيفي — بلا بريدٍ ولا جوّال. **وحالاتُ البيانات التي تحتاج مراجعة**
 *  (تعارضُ رقمٍ وظيفي، قيادتان لقسمٍ واحد…) للقيادة وحدها: لا تُرسل إلى متصفح العضو أصلاً.
 *
 *  والنسخةُ الرسمية (PDF) باقيةٌ على شرط اكتمالها كما كانت (`buildOrgChart().readiness`). */
export default async function StructurePage() {
  const session = await auth();
  if (!session) redirect("/login");
  const locale = await getLocale();
  const L = getDictionary(locale).rOrgExplorer;
  const [graph, chart] = await Promise.all([
    buildOrgGraph({ viewer: { id: session.user.id, role: session.user.role }, locale }),
    buildOrgChart(locale),
  ]);
  const isMember = session.user.role === "member";
  return (
    <main className="mx-auto max-w-[1240px] px-2 py-3 sm:px-4 sm:py-6">
      <OrgExplorer graph={isMember ? { ...graph, issues: [] } : graph} L={L} pdf={{ ready: chart.readiness.ready, href: "/structure/pdf" }} download={session.user.role === "super_admin" ? "/structure/download" : null} />
    </main>
  );
}
