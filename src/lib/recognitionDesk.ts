import { prisma } from "@/lib/prisma";
import { appreciationState, type AppreciationState } from "@/lib/appreciation";
import { earnsFinalCertificate, serviceDays } from "@/lib/certificate";
import { ROSTER_MEMBER_WHERE } from "@/lib/roster";

/** **الترحيب والتكريم** — صفحةٌ واحدة لبطاقات الانضمام والشهادات.
 *
 *  كان إصدارُ الشهادة زرّاً في قائمة أعضاء القسم لا يراه إلا المؤسس والتنفيذي
 *  وقائدُ القسم، فلم يجد مسؤولُ المتابعة والتشغيل للشهادات باباً أصلاً. فصار
 *  لها مكانٌ واحد بجانب بطاقات الانضمام: من يُرحِّب بالقادمين يُكرِّمهم.
 *
 *  **من يُصدر:** مسؤول المتابعة والتشغيل (قرار المؤسس)، والرئيس التنفيذي
 *  والمؤسس. ولا تُمنح لغيرهم. والشرطُ يُفرَض في كل إجراءٍ في الخادم؛ والصفحةُ
 *  تبعٌ له.
 *
 *  **ما يُصدَر هنا:**
 *  - شهادة التقدير (ثلاثة أشهر) للأعضاء: في موعدها، أو قبله بقرارٍ إداريٍّ مكتوب.
 *  - شهادة الشكر والخبرة لمن بدأ ختام تجربته (تنحّى ولم يُغلَق ختامه).
 *  وكلاهما يمرّ بمَخنَقه الوحيد (`issueAppreciation` و`markCertificateShared`)،
 *  فحمايةُ التكرار وحوكمةُ الأسبوعين وسجلُّ من أصدر ومتى لا تُعاد كتابتها هنا. */
export const CERTIFICATE_ISSUERS = ["operations_officer", "executive", "super_admin"] as const;

export function canIssueCertificates(role: string | null | undefined): boolean {
  return (CERTIFICATE_ISSUERS as readonly string[]).includes(role ?? "");
}

export type FinalState =
  | { kind: "sent"; at: Date }
  | { kind: "undelivered"; at: Date }
  | { kind: "ready" }
  | { kind: "ineligible"; days: number };

export function finalState(m: {
  certificateSentAt: Date | null;
  certificateIssuedAt: Date | null;
  orgJoinDate: Date | null;
  decidedAt: Date | null;
  joinDate: Date;
  endDate: Date | null;
  stepDownAt: Date | null;
  terminatedAt: Date | null;
}): FinalState {
  if (m.certificateSentAt) return { kind: "sent", at: m.certificateSentAt };
  if (m.certificateIssuedAt) return { kind: "undelivered", at: m.certificateIssuedAt };
  if (!earnsFinalCertificate(m)) return { kind: "ineligible", days: serviceDays(m) };
  return { kind: "ready" };
}

/** ترتيبُ الصفوف: ما يحتاج يداً الآن أولاً */
const APPRECIATION_ORDER: Record<AppreciationState["kind"], number> = {
  undelivered: 0,
  due: 1,
  upcoming: 2,
  sent: 3,
  blocked: 4,
};
const FINAL_ORDER: Record<FinalState["kind"], number> = { undelivered: 0, ready: 1, ineligible: 2, sent: 3 };

const DATES = {
  orgJoinDate: true,
  decidedAt: true,
  joinDate: true,
  endDate: true,
  stepDownAt: true,
  terminatedAt: true,
} as const;

/** ما تعرضه الصفحة في تبويب الشهادات — مقيّدٌ بسقفٍ، ومرتّبٌ بالحاجة */
export async function loadCertificateDesk(q: string, now = new Date()) {
  const nameFilter = q ? { fullName: { contains: q, mode: "insensitive" as const } } : {};
  const [members, closing] = await Promise.all([
    prisma.member.findMany({
      where: {
        ...ROSTER_MEMBER_WHERE,
        ...nameFilter,
        convertedAt: null,
        noFurtherEmail: false,
        stepDownAt: null,
        offboardingClosedAt: null,
      },
      select: {
        id: true,
        fullName: true,
        isActive: true,
        noFurtherEmail: true,
        stepDownAt: true,
        offboardingClosedAt: true,
        appreciationIssuedAt: true,
        appreciationSentAt: true,
        decidedAt: true,
        joinDate: true,
        department: { select: { name: true } },
      },
      orderBy: { fullName: "asc" },
      take: 500,
    }),
    prisma.member.findMany({
      where: { ...nameFilter, stepDownAt: { not: null }, offboardingClosedAt: null },
      select: {
        id: true,
        fullName: true,
        certificateIssuedAt: true,
        certificateSentAt: true,
        ...DATES,
        department: { select: { name: true } },
        invite: { select: { targetRole: true } },
      },
      orderBy: { stepDownAt: "desc" },
      take: 200,
    }),
  ]);

  const appreciation = members
    .map((m) => ({
      id: m.id,
      name: m.fullName,
      dept: m.department?.name ?? "—",
      state: appreciationState(m, now),
    }))
    .sort(
      (a, b) =>
        APPRECIATION_ORDER[a.state.kind] - APPRECIATION_ORDER[b.state.kind] ||
        dueTime(a.state) - dueTime(b.state) ||
        a.name.localeCompare(b.name, "ar")
    );

  const final = closing
    .map((m) => ({
      id: m.id,
      name: m.fullName,
      dept: m.department?.name ?? "—",
      isLead: m.invite.targetRole !== "member",
      stepDownAt: m.stepDownAt!,
      state: finalState(m),
    }))
    .sort((a, b) => FINAL_ORDER[a.state.kind] - FINAL_ORDER[b.state.kind]);

  const monthAgo = new Date(now.getTime() - 30 * 86_400_000);
  const [issuedAppreciation, issuedFinal] = await Promise.all([
    prisma.member.count({ where: { appreciationIssuedAt: { gte: monthAgo } } }),
    prisma.member.count({ where: { certificateIssuedAt: { gte: monthAgo } } }),
  ]);

  return {
    appreciation,
    final,
    stats: {
      due: appreciation.filter((r) => r.state.kind === "due").length,
      undelivered:
        appreciation.filter((r) => r.state.kind === "undelivered").length +
        final.filter((r) => r.state.kind === "undelivered").length,
      closing: final.filter((r) => r.state.kind === "ready").length,
      issuedThisMonth: issuedAppreciation + issuedFinal,
    },
  };
}

function dueTime(s: AppreciationState): number {
  return s.kind === "due" || s.kind === "upcoming" ? s.dueAt.getTime() : 0;
}
