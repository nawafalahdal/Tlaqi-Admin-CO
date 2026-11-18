import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { buildOrgGraph } from "@/lib/org/orgGraph";
import { buildOrgChart } from "@/lib/orgChart";
import { renderStructurePdf } from "@/lib/org/structurePdf";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/** **تنزيلُ الهيكل PDF** — للمؤسس وحده (طلب المؤسس، 18 نوفمبر 2026).
 *
 *  ملفٌّ بالموجود: القيادة والأقسام واللجان والأسماء والصور والأرقام الوظيفية (`renderStructurePdf`)، ويعمل ولو كان الهيكلُ
 *  ناقصاً — بختم «نسخة عمل» ونواقصه، فلا يُدَّعى أنه الرسمي. والنسخةُ الرسمية (`/structure/pdf`) باقيةٌ بشرط اكتمالها.
 *
 *  **الصلاحيةُ هنا لا في إخفاء الزرّ** — من كتب العنوان بيده يُرفض. **وكلُّ تنزيلٍ يُسجَّل** (`DataExportLog`): الملفُّ يحمل
 *  أسماءَ الفريق وصورَهم. ولا يُخزَّن الملفّ (`no-store`). */
export async function GET() {
  const session = await auth();
  if (!session) return new Response("سجّل الدخول أولاً", { status: 401 });
  if (session.user.role !== "super_admin") return new Response("تنزيلُ الهيكل للمؤسس وحده", { status: 403 });

  const [graph, chart] = await Promise.all([buildOrgGraph({ viewer: { id: session.user.id, role: session.user.role }, locale: "ar" }), buildOrgChart("ar")]);
  const now = new Date();
  const { pdf, people } = await renderStructurePdf(graph, { date: formatDate(now), ready: chart.readiness.ready, blockers: chart.readiness.blockers });

  await prisma.dataExportLog.create({
    data: { kind: "org-structure-pdf", actorId: session.user.id, actorName: session.user.name ?? "—", actorRole: session.user.role, rowCount: people },
  });

  // اسمٌ لاتينيٌّ وحده: الاسمُ العربي المرمَّز (`filename*`) جرّبتُه فأسقطه Chromium إلى «download» — واللاتينيُّ يُقرأ في كل متصفح
  const day = now.toISOString().slice(0, 10);
  const ascii = `TLAQI-structure-${day}.pdf`;
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${ascii}"`,
      "Content-Length": String(pdf.length),
      "Cache-Control": "no-store, private",
    },
  });
}
