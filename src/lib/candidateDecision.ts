import type { Session } from "next-auth";
import type { InviteTargetRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  canDecideCandidate,
  canViewCandidateResults,
  decisionAuthorityFor,
  type DecisionAuthority,
  type DecisionViewer,
} from "@/lib/permissions";

/** **حسمُ المرشّحين من القاعدة** — الطبقةُ التي تقرأ ما تحتاجه مصفوفةُ `permissions.ts` (قائدُ القسم النشط، والإدارةُ
 *  العليا، ومن يحمل «اعتماد العضوية») فلا تُصدَّق الواجهة. كلُّ قرارٍ في الخادم يمرّ بـ`mayDecideCandidate`. */

/** يحمل «اعتماد العضوية» في تكليفٍ نشطٍ بالإدارة العليا، وحسابُه نشطٌ معتمَد — **ولا يكون مؤسساً ولا رئيساً تنفيذياً**:
 *  الصلاحيةُ لا تسري لهما ولو كُتبت في تكليف (ق١: «لا تمنح Founder أو CEO صلاحية اعتماد احتياطية») */
export async function isDesignatedApprover(session: Session | null): Promise<boolean> {
  const id = session?.user?.id;
  const role = session?.user?.role;
  if (!id || !role || role === "super_admin" || role === "executive") return false;
  if (role === "member" && session.user.candidate) return false;
  const pos = await prisma.seniorPosition.findFirst({
    where: {
      status: "active",
      capabilities: { has: "membership_decide" },
      ...(role === "member"
        ? { holderMemberId: id, holderMember: { isActive: true, approvalStatus: "approved", terminatedAt: null } }
        : { holderUserId: id, holderUser: { isActive: true, role: { notIn: ["super_admin", "executive"] } } }),
    },
    select: { id: true },
  });
  return !!pos;
}

export async function decisionViewer(session: Session): Promise<DecisionViewer> {
  return {
    role: session.user.role,
    departmentId: session.user.departmentId,
    designatedApprover: await isDesignatedApprover(session),
  };
}

type CandidateRef = { id: string; departmentId: string | null; invite: { targetRole: InviteTargetRole } };

/** جهةُ الحسم لكل مرشّح — قراءةٌ واحدة للأقسام المعنية وقادتها النشطين، لا قراءةٌ لكل صفّ */
export async function authoritiesFor(cands: CandidateRef[]): Promise<Map<string, DecisionAuthority>> {
  const deptIds = [...new Set(cands.map((c) => c.departmentId).filter((d): d is string => !!d))];
  const [depts, leads] = deptIds.length
    ? await Promise.all([
        // department-scope: all — قراءةٌ بمعرّفات أقسام المرشّحين أنفسهم لحسم جهة القرار، لا قائمةٌ تُعرض: والنطاقُ هنا
        // يُسقط قسمَ المرشّح الفعلي فتُحسب له جهةٌ غيرُ جهته
        prisma.department.findMany({ where: { id: { in: deptIds } }, select: { id: true, leadershipOnly: true } }),
        prisma.user.findMany({
          where: { isActive: true, role: "department_admin", departmentId: { in: deptIds } },
          select: { departmentId: true },
        }),
      ])
    : [[], []];
  const led = new Set(leads.map((l) => l.departmentId));
  const info = new Map(depts.map((d) => [d.id, { leadershipOnly: d.leadershipOnly, hasActiveLead: led.has(d.id) }]));
  return new Map(
    cands.map((c) => [
      c.id,
      decisionAuthorityFor(
        { targetRole: c.invite.targetRole, departmentId: c.departmentId },
        c.departmentId ? info.get(c.departmentId) ?? null : null
      ),
    ])
  );
}

/** يحسم صاحبُ الجلسة أمرَ هذا المرشّح؟ — من القاعدة لحظةَ القرار (الاعتماد والرفض وإعادة الفتح وإكمال الترقية) */
export async function mayDecideCandidate(session: Session, memberId: string): Promise<boolean> {
  const m = await prisma.member.findUnique({
    where: { id: memberId },
    select: { id: true, email: true, departmentId: true, invite: { select: { targetRole: true } } },
  });
  if (!m) return false;
  // ولا يحسم أحدٌ أمرَ نفسه
  if (session.user.email && session.user.email.toLowerCase() === m.email.toLowerCase()) return false;
  const authority = (await authoritiesFor([m])).get(m.id)!;
  return canDecideCandidate(await decisionViewer(session), { departmentId: m.departmentId, authority });
}

/** يطّلع صاحبُ الجلسة على نتائج هذا المرشّح؟ (المؤسسُ والرئيسُ على الجميع، وجهةُ الحسم على من تحسمهم) */
export async function mayViewCandidate(session: Session, memberId: string): Promise<boolean> {
  const m = await prisma.member.findUnique({
    where: { id: memberId },
    select: { id: true, departmentId: true, invite: { select: { targetRole: true } } },
  });
  if (!m) return false;
  const authority = (await authoritiesFor([m])).get(m.id)!;
  return canViewCandidateResults(await decisionViewer(session), { departmentId: m.departmentId, authority });
}

export const AUTHORITY_LABEL: Record<DecisionAuthority, string> = {
  department_lead: "قائدُ القسم",
  designated_approver: "جهةُ الاعتماد المستقلة (اعتماد العضوية)",
};

/** **من يُخبَر أن مرشّحاً ينتظر الحسم** — جهةُ حسمه وحدها: قائدُ قسمه، أو حمَلةُ «اعتماد العضوية». **ولا يُحال إلى المؤسس
 *  ولا إلى الرئيس التنفيذي** — كان ذلك احتياطَ «لا قائد للقسم» قبل قرار المؤسس (ق١)، وهو منحُ قرارٍ لمن لا يملكه. فإن لم
 *  تُعيَّن الجهةُ بعد لم يُرسَل شيء، ويظهر ذلك في «نتائج المرشّحين» للمؤسس والرئيس («لم تُعيَّن بعد — ينتظر»). */
export async function candidateDecidersFor(m: CandidateRef): Promise<{ to: string[]; because: string; path: string }> {
  const authority = (await authoritiesFor([m])).get(m.id)!;
  if (authority === "department_lead") {
    const leads = await prisma.user.findMany({
      where: { isActive: true, role: "department_admin", departmentId: m.departmentId! },
      select: { email: true, department: { select: { slug: true } } },
    });
    return {
      to: [...new Set(leads.map((l) => l.email))],
      because: "قائدُ القسم يحسم أعضاءه",
      path: leads[0]?.department?.slug ? `/admin/departments/${leads[0].department.slug}` : "/admin",
    };
  }
  const holders = await prisma.seniorPosition.findMany({
    where: { status: "active", capabilities: { has: "membership_decide" } },
    select: {
      holderMember: { select: { email: true, isActive: true, approvalStatus: true, terminatedAt: true } },
      holderUser: { select: { email: true, isActive: true, role: true } },
    },
  });
  const to = holders.flatMap((h) => {
    if (h.holderMember?.isActive && h.holderMember.approvalStatus === "approved" && !h.holderMember.terminatedAt) return [h.holderMember.email];
    if (h.holderUser?.isActive && h.holderUser.role !== "super_admin" && h.holderUser.role !== "executive") return [h.holderUser.email];
    return [];
  });
  return {
    to: [...new Set(to)],
    because: to.length ? "جهةُ الاعتماد المستقلة («اعتماد العضوية»)" : "لا جهةَ اعتمادٍ معيّنة بعد — ينتظر المرشّح",
    path: "/senior/approvals",
  };
}
