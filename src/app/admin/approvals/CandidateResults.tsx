import type { Session } from "next-auth";
import { prisma } from "@/lib/prisma";
import { DataTable } from "@/components/DataTable";
import { Card } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { authoritiesFor } from "@/lib/candidateDecision";
import { recordOrgEvent } from "@/lib/org/audit";
import { getLocale, getDictionary } from "@/i18n/server";

/** **نتائجُ المرشّحين — للاطّلاع وحده** (قرار المؤسس، ق١ وق١١).
 *
 *  المؤسسُ والرئيسُ التنفيذيُّ يطّلعان على نتائج المرشّحين في الأقسام واللجان كلِّها — حالةُ الاختبار ودرجتُه
 *  ومحاولاتُه، ومن يملك الحسم، وما حُسم ومتى وبيد من — **ولا زرَّ قرارٍ هنا**: الحسمُ لجهته (قائدُ القسم، أو جهةُ
 *  الاعتماد المستقلة)، والخادمُ يرفض قرارَهما ولو وصل مباشرةً (`mayDecideCandidate`).
 *
 *  والاطّلاعُ نفسُه يُسجَّل في سجلّ التدقيق — مرّةً في الساعة لكل مطّلع، فلا يغرق السجلّ بكل تحديثٍ للصفحة. */
const VIEW_LOG_EVERY_MS = 60 * 60_000;
const DECISIONS_TAKE = 50;
const PENDING_TAKE = 200;

function testState(m: { testStatus: string; firstLoginAt: Date | null }): string {
  if (m.testStatus === "passed") return "مجتاز";
  if (m.testStatus === "failed") return "غير مجتاز";
  return m.firstLoginAt ? "قيد التنفيذ (دخل ولم يُسلّم)" : "لم يبدأ";
}

export async function CandidateResults({ session }: { session: Session }) {
  const dict = getDictionary(await getLocale());
  const since = new Date(Date.now() - VIEW_LOG_EVERY_MS);
  const [pending, decided, approvers] = await Promise.all([
    prisma.member.findMany({
      where: { approvalStatus: "pending_review", isActive: true, terminatedAt: null },
      select: {
        id: true, fullName: true, email: true, departmentId: true, testStatus: true, testScore: true, firstLoginAt: true,
        testReopenCount: true, createdAt: true,
        department: { select: { name: true } },
        invite: { select: { targetRole: true } },
        testAttempts: { select: { score: true, passed: true, attemptedAt: true }, orderBy: { attemptedAt: "desc" } },
      },
      orderBy: { createdAt: "asc" },
      take: PENDING_TAKE,
    }),
    prisma.member.findMany({
      where: { approvalStatus: { in: ["approved", "rejected"] }, decidedAt: { not: null }, testStatus: { not: "not_started" } },
      select: {
        id: true, fullName: true, approvalStatus: true, decidedAt: true, decidedByName: true, testScore: true,
        department: { select: { name: true } },
        invite: { select: { targetRole: true } },
      },
      orderBy: { decidedAt: "desc" },
      take: DECISIONS_TAKE,
    }),
    prisma.seniorPosition.count({ where: { status: "active", capabilities: { has: "membership_decide" } } }),
  ]);

  const authority = await authoritiesFor(pending);
  const leads = await prisma.user.findMany({
    where: { isActive: true, role: "department_admin", departmentId: { in: pending.map((p) => p.departmentId).filter((d): d is string => !!d) } },
    select: { fullName: true, departmentId: true },
  });
  const leadOf = new Map(leads.map((l) => [l.departmentId, l.fullName]));

  // الاطّلاعُ في سجلّ التدقيق — مرّةً في الساعة لكل مطّلع
  const recent = await prisma.orgAuditEvent.findFirst({
    where: { action: "candidate.results.viewed", actorId: session.user.id, createdAt: { gte: since } },
    select: { id: true },
  });
  if (!recent) {
    await recordOrgEvent(prisma, {
      scope: "member", entityId: "candidate-results", departmentId: "—", action: "candidate.results.viewed",
      actor: { kind: "user", id: session.user.id, name: session.user.name ?? "—", role: session.user.role },
      after: { pending: pending.length, decisions: decided.length },
    });
  }

  const roleLabel = (r: string) => dict.roles[r as keyof typeof dict.roles] ?? r;
  const decider = (m: (typeof pending)[number]) => {
    if (authority.get(m.id) === "department_lead") return `قائدُ القسم${leadOf.get(m.departmentId) ? ` — ${leadOf.get(m.departmentId)}` : ""}`;
    return approvers > 0 ? "جهةُ الاعتماد المستقلة" : "جهةُ الاعتماد المستقلة — لم تُعيَّن بعد (ينتظر)";
  };

  return (
    <section id="joins" className="flex scroll-mt-24 flex-col gap-5">
      <Card className="border-amber-200 bg-amber-50 p-4 text-sm leading-relaxed text-amber-950">
        <b>للاطّلاع وحده.</b> يطّلع المؤسسُ والرئيسُ التنفيذيُّ على نتائج المرشّحين في كل الأقسام واللجان، ولا يحسمانها:
        يحسم كلَّ مرشّحٍ قائدُ قسمه، أو جهةُ الاعتماد المستقلة («اعتماد العضوية» في الإدارة العليا) للمناصب القيادية
        وأعضاءِ الإدارة العليا وأعضاءِ قسمٍ لا قائدَ له.
        {approvers === 0 && (
          <span className="mt-1 block font-semibold">
            لم تُمنح «اعتماد العضوية» لأحدٍ بعد — فمن يحسمه هذه الجهة ينتظر حتى تُعيَّن، ولا يحسمه غيرُها.
          </span>
        )}
      </Card>

      <div>
        <h2 className="mb-3 text-base font-bold">نتائج المرشّحين ({pending.length})</h2>
        <DataTable
          emptyLabel="لا مرشّحين قائمين الآن"
          columns={[
            { key: "name", label: "المرشّح", primary: true },
            { key: "position", label: "المنصب / القسم" },
            { key: "test", label: "حالة الاختبار" },
            { key: "score", label: "الدرجة" },
            { key: "attempts", label: "المحاولات" },
            { key: "decider", label: "يحسمه" },
          ]}
          rows={pending.map((m) => ({
            id: m.id,
            cells: {
              name: (
                <span className="min-w-0">
                  <span className="block font-bold">{m.fullName}</span>
                  <span className="block break-all text-[11px] text-black/45" dir="ltr">{m.email}</span>
                </span>
              ),
              position: m.invite.targetRole === "member" ? `عضو — ${m.department?.name ?? "—"}` : `${roleLabel(m.invite.targetRole)}${m.department ? ` — ${m.department.name}` : ""}`,
              test: testState(m),
              score: m.testScore == null ? "—" : `${m.testScore}%`,
              attempts:
                m.testAttempts.length === 0
                  ? "لا محاولات"
                  : `${m.testAttempts.length} — ${m.testAttempts.map((a) => `${a.score}% (${formatDate(a.attemptedAt)})`).join("، ")}`,
              decider: decider(m),
            },
          }))}
        />
      </div>

      <div>
        <h2 className="mb-3 text-base font-bold">سجلّ قرارات الاعتماد</h2>
        <DataTable
          emptyLabel="لا قراراتٍ مسجّلة بعد"
          columns={[
            { key: "name", label: "العضو", primary: true },
            { key: "position", label: "المنصب / القسم" },
            { key: "decision", label: "القرار" },
            { key: "at", label: "التاريخ" },
            { key: "by", label: "حسمه" },
          ]}
          rows={decided.map((m) => ({
            id: m.id,
            cells: {
              name: m.fullName,
              position: m.invite.targetRole === "member" ? `عضو — ${m.department?.name ?? "—"}` : roleLabel(m.invite.targetRole),
              decision: m.approvalStatus === "approved" ? "اعتُمد" : "رُفض",
              at: m.decidedAt ? formatDate(m.decidedAt) : "—",
              // ما حُسم قبل تسجيل الحاسم (نوفمبر 2026) يبقى بتاريخه بلا اسم — لا يُخمَّن
              by: m.decidedByName ?? "— (قبل تسجيل الحاسم)",
            },
          }))}
        />
      </div>
    </section>
  );
}
