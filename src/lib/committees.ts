import { prisma } from "@/lib/prisma";
import type { Session } from "next-auth";
import { appendMemberEvent } from "@/lib/googleSheets";
import { sendCommitteeDecisionEmail, sendCommitteeLeadAppointedEmail } from "@/lib/email";
import { recordOrgEvent } from "@/lib/org/audit";

/** اللجان — **صفُّ القسم نفسُه بأبٍ**، لا كائنٌ جديد.
 *
 *  تنشئها إدارةُ القسم (قائدُه، ونائبُه المفوَّض، والمؤسس والرئيس التنفيذي) من
 *  `@/lib/org/committeeService` باسمها وغرضها وقائدها وأعضائها من القسم نفسه.
 *  **ولا تعمل لجنةٌ قبل اعتمادها:** تُرسَل `pending_review`، ويقرّر فيها الرئيسُ
 *  التنفيذي (ومعه المؤسس) هنا — وهو ما يمنع أن ينمو الهيكلُ بلا إذن.
 *
 *  وقائدُ اللجنة عضوٌ من القسم في حقلٍ واحد (`leadMemberId`) — لا حسابٌ قياديٌّ
 *  ولا دورُ «قائد قسم». (لجانُ النظام الأول قادها حسابٌ قياديٌّ على اللجنة نفسها؛
 *  يبقى كما هو حتى يُعيَّن غيرُه.) ولا لجنةَ داخل لجنة: اللجانُ تابعةٌ للأقسام مباشرة.
 */

function baseUrl() {
  return process.env.APP_BASE_URL || "http://localhost:3000";
}

/** الصفوف الظاهرة: الأقسام الأصيلة واللجانُ المعتمدة وحدها.
 *
 *  **وهذا الشرطُ يُمرَّر على كل قائمةٍ تُقرأ منها الأقسام** — قوائم
 *  الوجهات، ونماذج الدعوة، والتقارير، والهيكل. فلجنةٌ مقترحةٌ لم تُعتمد
 *  لا تَظهر وجهةً لتذكرةٍ ولا خياراً في قائمة: الاقتراحُ ليس فتحاً.
 *
 *  ويحرسه فحصُ بناءٍ (`check-department-scope`) يرفض أيَّ قائمةٍ جديدة
 *  لا تمرّ به — فالنسيانُ هنا يُسرِّب لجنةً مقترحةً إلى الواجهة. */
export const OPEN_DEPARTMENT_WHERE = {
  OR: [{ committeeStatus: null }, { committeeStatus: "approved" as const }],
};

/** من يعتمد اللجان: المدير التنفيذي — ومعه المؤسس.
 *
 *  الطلبُ يصل التنفيذي كما طُلب صريحاً. والمؤسس يعتمد أيضاً لأنه يعلوه،
 *  ولأن المنصة لا تتوقّف إن خلا مقعدُ التنفيذي. */
export function canDecideCommittee(role: string) {
  return role === "executive" || role === "super_admin";
}

/** المسمّى الذي يُعرَض لقائد اللجنة — ما اختاره مقترِحُها، أو المشتقّ من اسمها */
export function committeeLeadTitle(name: string, leadTitle?: string | null) {
  const chosen = leadTitle?.trim();
  return chosen && chosen.length > 0 ? chosen : `قائد لجنة ${name.trim()}`;
}

function slugify(name: string) {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return base || `committee-${Date.now().toString(36)}`;
}

async function uniqueSlug(base: string) {
  let slug = base;
  let n = 2;
  while (await prisma.department.findUnique({ where: { slug } })) {
    slug = `${base}-${n}`;
    n++;
  }
  return slug;
}

/** معرّفٌ فريدٌ للجنةٍ جديدة من اسمها */
export async function newCommitteeSlug(name: string) {
  return uniqueSlug(slugify(name));
}

/** معتمِدُ اللجان الآن: التنفيذي، وإلا فالمؤسس — ولا يُترك الطلبُ بلا مُرسَلٍ إليه */
export async function committeeApprover() {
  const exec = await prisma.user.findFirst({
    where: { role: "executive", isActive: true },
    select: { id: true, fullName: true, email: true },
    orderBy: { createdAt: "asc" },
  });
  if (exec) return { ...exec, label: "الرئيس التنفيذي" };
  const founder = await prisma.user.findFirst({
    where: { role: "super_admin", isActive: true },
    select: { id: true, fullName: true, email: true },
    orderBy: { createdAt: "asc" },
  });
  return founder ? { ...founder, label: "المؤسس" } : null;
}

/** يقرّر في لجنةٍ مقترحة: فتحاً أو ردّاً.
 *
 *  والفتحُ يُنشئ بنكَ أسئلتها حينه — فتولد مكتملةً كما يولد القسم: لجنةٌ
 *  بلا بنكٍ لا يُدعى إليها أحد، لأن اختيارَ المسار يفشل إن لم يجده.
 *
 *  والردُّ لا يُحذَف به صفٌّ: يبقى مكتوباً بسببه، فلا يُعاد اقتراحُ ما
 *  رُدَّ كأن شيئاً لم يكن، ويقرأ قائدُ القسم لماذا رُدَّ. */
export async function decideCommittee(opts: {
  committeeId: string;
  decision: "approved" | "rejected";
  note?: string | null;
  session: Session;
}): Promise<
  { ok: true; name: string; parentName: string; decision: "approved" | "rejected" } | { ok: false; reason: string }
> {
  if (!canDecideCommittee(opts.session.user.role)) {
    return { ok: false, reason: "اعتماد اللجان للرئيس التنفيذي — ومعه المؤسس" };
  }
  const note = opts.note?.trim() || null;
  if (opts.decision === "rejected" && !note) {
    return { ok: false, reason: "الردّ لا يقع بلا سبب مكتوب" };
  }

  const committee = await prisma.department.findUnique({
    where: { id: opts.committeeId },
    select: {
      id: true,
      name: true,
      parentId: true,
      committeeStatus: true,
      requestedById: true,
      parent: { select: { name: true } },
      leadMember: { select: { email: true, fullName: true, isActive: true } },
    },
  });
  if (!committee) return { ok: false, reason: "اللجنة غير موجودة" };
  // وطلبُ القسم الأصيل يحمل الحالةَ نفسَها — لكن اعتمادَه للمؤسس وحده
  // (`decideDepartmentRequest`)، فلا يمرّ من باب اللجان
  if (!committee.committeeStatus || !committee.parentId) return { ok: false, reason: "هذا قسمٌ أصيل لا لجنة" };

  const now = new Date();
  // الحرسُ في `where` لا قبله: قرارانِ متسابقان لا يمرّان، ومن قُرِّر
  // أمرُه لا يُقرَّر ثانيةً — فلا يُفتَح ما رُدَّ بضغطةٍ متأخّرة.
  // والقرارُ وسجلُّه في معاملةٍ واحدة: لا قرارَ بلا أثرٍ في سجلّ التدقيق
  const written = await prisma.$transaction(async (tx) => {
    const w = await tx.department.updateMany({
      where: { id: committee.id, parentId: { not: null }, committeeStatus: "pending_review" },
      data: {
        committeeStatus: opts.decision,
        decidedAt: now,
        decidedByName: opts.session.user.name ?? "—",
        decisionNote: note,
        statusChangedAt: now,
        statusNote: note,
      },
    });
    if (w.count) {
      await recordOrgEvent(tx, {
        scope: "committee",
        entityId: committee.id,
        departmentId: committee.parentId!,
        action: "committee.decided",
        actor: { kind: "user", id: opts.session.user.id, name: opts.session.user.name ?? "—" },
        before: { status: "pending_review" },
        after: { status: opts.decision },
        note,
      });
    }
    return w;
  });
  if (written.count === 0) {
    return {
      ok: false,
      reason:
        committee.committeeStatus === "approved"
          ? "هذه اللجنة معتمدةٌ ومفتوحة بالفعل"
          : "هذه اللجنة ليست بانتظار الاعتماد — قُرِّر أمرُها أو أُعيدت مسودّة",
    };
  }

  await appendMemberEvent({
    fullName: opts.session.user.name ?? "—",
    email: "",
    roleOrDepartment: `${committee.parent?.name ?? "—"} ← ${committee.name}`,
    event: opts.decision === "approved" ? "اعتماد لجنة وفتحها" : "ردّ اقتراح لجنة",
    details:
      opts.decision === "approved"
        ? `فُتحت وتعمل بقائدها وأعضائها من القسم${note ? ` — ملاحظة: ${note}` : ""}`
        : `السبب: ${note}`,
    at: now,
  });

  // رسالةٌ واحدة لمن اقترحها — لا نسخةَ لأحدٍ غيره
  if (committee.requestedById) {
    const requester = await prisma.user.findUnique({
      where: { id: committee.requestedById },
      select: { email: true, fullName: true, isActive: true },
    });
    if (requester?.isActive) {
      await sendCommitteeDecisionEmail({
        to: requester.email,
        fullName: requester.fullName,
        committeeName: committee.name,
        parentName: committee.parent?.name ?? "—",
        approved: opts.decision === "approved",
        note,
        decidedByName: opts.session.user.name ?? "—",
        boardUrl: `${baseUrl()}/committees/${committee.id}`,
      });
    }
  }

  // وتكليفُ قائدها يصله حين تُعتمد — لا قبلها: المسودّةُ والطلبُ ليسا تكليفاً بعد
  if (opts.decision === "approved" && committee.leadMember?.isActive) {
    await sendCommitteeLeadAppointedEmail({
      to: committee.leadMember.email,
      fullName: committee.leadMember.fullName,
      committeeName: committee.name,
      parentName: committee.parent?.name ?? "—",
      appointedByName: opts.session.user.name ?? "—",
      url: `${baseUrl()}/committees/${committee.id}`,
    });
  }

  return {
    ok: true,
    name: committee.name,
    parentName: committee.parent?.name ?? "—",
    decision: opts.decision,
  };
}

/** اللجانُ المنتظِرة قراراً — طابورُ المدير التنفيذي */
export async function pendingCommittees() {
  // department-scope: all — الطابورُ هو المقترحةُ نفسُها، وهي غير مفتوحة
  return prisma.department.findMany({
    // اللجانُ وحدها: طلباتُ الأقسام الأصيلة طابورُ المؤسس (`pendingDepartmentRequests`)
    where: { committeeStatus: "pending_review", parentId: { not: null } },
    orderBy: { requestedAt: "asc" },
    select: {
      id: true,
      name: true,
      colorHex: true,
      leadTitle: true,
      purpose: true,
      committeeKind: true,
      startDate: true,
      endDate: true,
      requestedByName: true,
      requestedAt: true,
      leadMember: { select: { fullName: true } },
      parent: { select: { id: true, name: true, colorHex: true } },
      _count: { select: { committeeMemberships: { where: { active: true } } } },
    },
  });
}

/** حدُّ قائمة الأقسام المعروضة.
 *
 *  الأقسام قليلةٌ بطبعها (أحدَ عشرَ اليوم)، ولا يُنتظَر أن تَبلغ هذا
 *  الحدّ. والحدُّ مكتوبٌ لأن العقدَ يُعلَن ولا يُفترَض: استعلامٌ بلا
 *  `take` يقول «كلَّ شيء» ولا يَعرف متى يَكبر الجدول. وأعمدتُها كلُّها
 *  نصوصٌ قصيرة، فلا يُضيَّق `select` هنا — التضييقُ بلا مكسبٍ مقيسٍ
 *  مجازفةٌ بخمس شاشاتٍ تَقرأ منها حقولاً مختلفة. */
export const DEPARTMENT_TAKE = 100;
