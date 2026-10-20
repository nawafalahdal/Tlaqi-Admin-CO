import { prisma } from "@/lib/prisma";
import type { Session } from "next-auth";
import { appendMemberEvent } from "@/lib/googleSheets";
import { sendCommitteeRequestEmail, sendCommitteeDecisionEmail } from "@/lib/email";
import { ROSTER_MEMBER_WHERE } from "@/lib/roster";

/** اللجان — قسمٌ داخل قسم، يقترحه قائدُ القسم ويعتمده المدير التنفيذي.
 *
 *  **واللجنة قسمٌ له أبٌ لا كائنٌ جديد.** فمتى اعتُمدت صارت لها لوحةٌ
 *  وبنكُ أسئلةٍ ودعواتٌ وتذاكرُ وتوقيعٌ وصفٌّ في الهيكل — كلُّ ذلك يعمل
 *  من يومها بلا سطرٍ واحدٍ جديد في تلك المسارات. وقائدُها
 *  `department_admin` قسمُه اللجنة: فتدور الدائرةُ كما طُلبت، ويقدر هو
 *  أن يقترح لجنةً داخل لجنته.
 *
 *  **ولا تُفتح لجنةٌ باقتراحها.** الاقتراحُ يُنشئ الصفَّ ساكناً:
 *  `committeeStatus = pending_review`، فلا تظهر في قائمةٍ ولا تُوجَّه
 *  إليها تذكرةٌ ولا يُدعى لها أحد. والفتحُ قرارُ المدير التنفيذي — وهو
 *  ما يمنع أن يصير الهيكلُ شجرةً تنمو بلا إذنٍ من أحد.
 */

function baseUrl() {
  return process.env.APP_BASE_URL || "http://localhost:3000";
}

/** أقصى عمقٍ للتفريع: قسم ← لجنة ← لجنة فرعية.
 *
 *  «وتدور الدائرة» تعني أن المسار نفسَه يُعاد، لا أن التفريع بلا قرار.
 *  والعمقُ الرابع هيكلٌ لا يُقرأ في ورقةٍ ولا على شاشة — فيُمنَع بحدٍّ
 *  مكتوبٍ يُسمّى في الرفض، لا بانهيارٍ في الرسم. */
export const MAX_COMMITTEE_DEPTH = 2;

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

/** من يقترح لجنةً في قسمٍ بعينه.
 *
 *  **قائدُ ذلك القسم هو صاحبُ هذا القرار** — هو من يعرف أن عملَه يحتاج
 *  لجنة. والمؤسس والمدير التنفيذي يملكانه أيضاً بحكم ملكيّتهما للهيكل
 *  كلِّه؛ ولا يُعفيهما ذلك من مسار الاعتماد إلا بأنهما همُ المعتمِدون.
 *  وقائدُ لجنةٍ قائدُ قسمٍ في لجنته: يقترح داخلها كما يقترح غيرُه. */
export function canRequestCommitteeIn(session: Session, parentId: string) {
  if (session.user.role === "super_admin" || session.user.role === "executive") return true;
  return session.user.role === "department_admin" && session.user.departmentId === parentId;
}

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

/** عمقُ الصفّ في الشجرة: ٠ للقسم الأصيل، ١ للجنةٍ فيه، وهكذا */
async function depthOf(departmentId: string): Promise<number> {
  let depth = 0;
  let cursor: string | null = departmentId;
  // الحدُّ على عدد الخطوات حمايةٌ من حلقةٍ في البيانات لا من عمقٍ مشروع
  for (let i = 0; i < 12 && cursor; i++) {
    const row: { parentId: string | null } | null = await prisma.department.findUnique({
      where: { id: cursor },
      select: { parentId: true },
    });
    if (!row?.parentId) return depth;
    depth++;
    cursor = row.parentId;
  }
  return depth;
}

/** معتمِدُ اللجان الآن: التنفيذي، وإلا فالمؤسس — ولا يُترك الطلبُ بلا مُرسَلٍ إليه */
async function committeeApprover() {
  const exec = await prisma.user.findFirst({
    where: { role: "executive", isActive: true },
    select: { id: true, fullName: true, email: true },
    orderBy: { createdAt: "asc" },
  });
  if (exec) return { ...exec, label: "المدير التنفيذي" };
  const founder = await prisma.user.findFirst({
    where: { role: "super_admin", isActive: true },
    select: { id: true, fullName: true, email: true },
    orderBy: { createdAt: "asc" },
  });
  return founder ? { ...founder, label: "المؤسس" } : null;
}

export type CommitteeResult =
  | { ok: true; id: string; name: string; approverName: string | null }
  | { ok: false; reason: string };

/** يقترح لجنةً داخل قسم — ولا يفتحها.
 *
 *  **ولا لونَ لها تختاره.** كانت تختار لوناً مميّزاً، فصار في الهيكل
 *  لونٌ سادسٌ وسابع لا يدلّ على شيء: اللجنةُ **من** قسمها، فلونٌ غريبٌ
 *  عنه يقطع نسبَها إليه ويُقرأ قسماً مستقلاً. فصارت تأخذ لون قسمها
 *  نفسَه، ويُميَّزها شكلُها لا لونُها: إطارٌ متقطّعٌ، ووسمُ «لجنة» على
 *  ترويستها، ووسمٌ على بطاقة قائدها وكلِّ عضوٍ فيها — فتُعرَف لجنةً
 *  بأعضائها وقائدها من النظرة الأولى، وتبقى من قسمها لوناً.
 *
 *  واللونُ يُحفَظ في صفّها مع ذلك: نسخةٌ من لون أبيها يوم الاقتراح،
 *  تُبقي الصفَّ قائماً بذاته إن قُرئ وحده. أمّا العرضُ فيُشتقّ من
 *  الأب في كل قراءة — فإن غُيّر لونُ القسم تبعته لجانُه بلا إجراء. */
export async function requestCommittee(opts: {
  parentId: string;
  name: string;
  leadTitle?: string | null;
  session: Session;
}): Promise<CommitteeResult> {
  if (!canRequestCommitteeIn(opts.session, opts.parentId)) {
    return { ok: false, reason: "اقتراح اللجنة لقائد القسم نفسه — ومن يعلوه" };
  }

  const name = opts.name.trim();
  const leadTitle = opts.leadTitle?.trim() || null;

  if (!name) return { ok: false, reason: "اسم اللجنة مطلوب" };

  const parent = await prisma.department.findUnique({
    where: { id: opts.parentId },
    select: {
      id: true,
      name: true,
      colorHex: true,
      committeeStatus: true,
      leadershipOnly: true,
      committees: { select: { name: true } },
    },
  });
  if (!parent) return { ok: false, reason: "القسم غير موجود" };

  // اللجنةُ لا تُقترَح داخل لجنةٍ لم تُعتمد بعد: فرعٌ على فرعٍ معلّق
  if (parent.committeeStatus && parent.committeeStatus !== "approved") {
    return { ok: false, reason: "هذه اللجنة نفسها لم تُعتمد بعد — لا تُفرَّع قبل أن تُفتح" };
  }
  // القسم الاستثنائي جهاتُ تواصلٍ مع الإدارة العليا لا فريقَ عملٍ يُفرَّع
  if (parent.leadershipOnly) {
    return { ok: false, reason: "القسم الاستثنائي لا تُنشأ فيه لجان — أعضاؤه جهاتُ تواصلٍ لا فريقُ عمل" };
  }

  const depth = await depthOf(parent.id);
  if (depth >= MAX_COMMITTEE_DEPTH) {
    return {
      ok: false,
      reason: `أقصى تفريع ${MAX_COMMITTEE_DEPTH} مستويَين داخل القسم — وما بعده هيكلٌ لا يُقرأ`,
    };
  }

  if (await prisma.department.findUnique({ where: { name } })) {
    return { ok: false, reason: "يوجد قسم أو لجنة بهذا الاسم بالفعل" };
  }

  // لونُ اللجنة لونُ قسمها — يُنسَخ في صفّها ويُشتقّ في العرض
  const colorHex = parent.colorHex;

  const approver = await committeeApprover();
  const slug = await uniqueSlug(slugify(name));
  const now = new Date();

  const committee = await prisma.department.create({
    data: {
      name,
      slug,
      colorHex,
      parentId: parent.id,
      committeeStatus: "pending_review",
      leadTitle,
      requestedById: opts.session.user.id,
      requestedByName: opts.session.user.name ?? "—",
      requestedAt: now,
    },
  });

  // بنكُ الأسئلة لا يُنشأ هنا بل عند الاعتماد: لجنةٌ قد تُرَدّ لا تُورَّث
  // بنكاً فارغاً يبقى في القاعدة بلا صاحب.

  await appendMemberEvent({
    fullName: opts.session.user.name ?? "—",
    email: "",
    roleOrDepartment: `${parent.name} ← ${name}`,
    event: "اقتراح لجنة داخل قسم",
    details: `لونُ قسمها: ${colorHex} — مسمّى قائدها: ${committeeLeadTitle(name, leadTitle)} — بانتظار اعتماد ${approver?.label ?? "الإدارة"}`,
    at: now,
  });

  if (approver) {
    await sendCommitteeRequestEmail({
      to: approver.email,
      approverName: approver.fullName,
      committeeName: name,
      parentName: parent.name,
      leadTitle: committeeLeadTitle(name, leadTitle),
      requestedByName: opts.session.user.name ?? "—",
      reviewUrl: `${baseUrl()}/admin/departments`,
    });
  }

  return { ok: true, id: committee.id, name, approverName: approver?.fullName ?? null };
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
    return { ok: false, reason: "اعتماد اللجان للمدير التنفيذي — ومعه المؤسس" };
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
    },
  });
  if (!committee) return { ok: false, reason: "اللجنة غير موجودة" };
  // وطلبُ القسم الأصيل يحمل الحالةَ نفسَها — لكن اعتمادَه للمؤسس وحده
  // (`decideDepartmentRequest`)، فلا يمرّ من باب اللجان
  if (!committee.committeeStatus || !committee.parentId) return { ok: false, reason: "هذا قسمٌ أصيل لا لجنة" };

  const now = new Date();
  // الحرسُ في `where` لا قبله: قرارانِ متسابقان لا يمرّان، ومن قُرِّر
  // أمرُه لا يُقرَّر ثانيةً — فلا يُفتَح ما رُدَّ بضغطةٍ متأخّرة.
  const written = await prisma.department.updateMany({
    where: { id: committee.id, parentId: { not: null }, committeeStatus: "pending_review" },
    data: {
      committeeStatus: opts.decision,
      decidedAt: now,
      decidedByName: opts.session.user.name ?? "—",
      decisionNote: note,
    },
  });
  if (written.count === 0) {
    return {
      ok: false,
      reason:
        committee.committeeStatus === "approved"
          ? "هذه اللجنة معتمدةٌ ومفتوحة بالفعل"
          : "هذه اللجنة رُدَّت بالفعل — ولا يُنقض القرار من هنا",
    };
  }

  if (opts.decision === "approved") {
    // البنكُ يُنشأ مرّةً: `upsert` لا `create`، فإعادةُ اعتمادٍ لا تُكرّره
    await prisma.testTrack.upsert({
      where: { scope_departmentId: { scope: "department_member", departmentId: committee.id } },
      create: { scope: "department_member", departmentId: committee.id },
      update: {},
    });
  }

  await appendMemberEvent({
    fullName: opts.session.user.name ?? "—",
    email: "",
    roleOrDepartment: `${committee.parent?.name ?? "—"} ← ${committee.name}`,
    event: opts.decision === "approved" ? "اعتماد لجنة وفتحها" : "ردّ اقتراح لجنة",
    details:
      opts.decision === "approved"
        ? `فُتحت وأُنشئ لها بنك أسئلة فارغ — تُدعى لها قيادةٌ من لوحة القسم${note ? ` — ملاحظة: ${note}` : ""}`
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
        boardUrl: `${baseUrl()}/admin`,
      });
    }
  }

  return {
    ok: true,
    name: committee.name,
    parentName: committee.parent?.name ?? "—",
    decision: opts.decision,
  };
}

/** يسحب اقتراح لجنةٍ أو يُزيل لجنةً مردودة — ولا يمسّ لجنةً مفتوحة.
 *
 *  المفتوحةُ قسمٌ عاملٌ له قائدٌ وأعضاءٌ وتذاكر، وإزالتُها تمرّ من باب
 *  حذف الأقسام بشروطه. وهذه الدالةُ للساكن وحده: ما اقتُرح ولم يُفتح،
 *  وما رُدَّ فلا يُنتظَر. ولا تُزال إلا وهي فارغةٌ تماماً — ولو أُخطئ
 *  فأُسندت إليها سجلّات، فالرفضُ يُسمّيها بعددها. */
export async function withdrawCommittee(opts: {
  committeeId: string;
  session: Session;
}): Promise<{ ok: true; name: string } | { ok: false; reason: string }> {
  const committee = await prisma.department.findUnique({
    where: { id: opts.committeeId },
    select: {
      id: true,
      name: true,
      slug: true,
      colorHex: true,
      parentId: true,
      committeeStatus: true,
      _count: {
        select: {
          admins: true,
          members: true,
          invites: true,
          tickets: true,
          requests: true,
          signatures: true,
          committees: true,
        },
      },
    },
  });
  if (!committee) return { ok: false, reason: "اللجنة غير موجودة" };
  if (!committee.committeeStatus || !committee.parentId) {
    return { ok: false, reason: "هذا قسمٌ أصيل — حذفُه من صفحة الأقسام بشروطه" };
  }
  if (committee.committeeStatus === "approved") {
    return {
      ok: false,
      reason: "اللجنة مفتوحةٌ وعاملة — إزالتُها تمرّ من حذف الأقسام بشروطه، لا من هنا",
    };
  }
  const mayWithdraw =
    canDecideCommittee(opts.session.user.role) ||
    canRequestCommitteeIn(opts.session, committee.parentId);
  if (!mayWithdraw) return { ok: false, reason: "هذا الإجراء لقائد القسم ومن يعلوه" };

  const c = committee._count;
  const blockers: string[] = [];
  if (c.admins > 0) blockers.push(`${c.admins} حساب قيادي`);
  if (c.members > 0) blockers.push(`${c.members} سجلّ عضوية`);
  if (c.invites > 0) blockers.push(`${c.invites} دعوة`);
  if (c.tickets > 0) blockers.push(`${c.tickets} تذكرة`);
  if (c.requests > 0) blockers.push(`${c.requests} طلب`);
  if (c.signatures > 0) blockers.push(`${c.signatures} توقيع`);
  if (c.committees > 0) blockers.push(`${c.committees} لجنة فرعية`);
  if (blockers.length > 0) {
    return { ok: false, reason: `اللجنة تحمل: ${blockers.join("، ")} — ولا يُهدَر سجلٌّ لتُفرَّغ` };
  }

  await appendMemberEvent({
    fullName: opts.session.user.name ?? "—",
    email: "",
    roleOrDepartment: committee.name,
    event: committee.committeeStatus === "rejected" ? "إزالة لجنة مردودة" : "سحب اقتراح لجنة",
    details: `المعرّف: ${committee.slug} — اللون: ${committee.colorHex} — كانت فارغةً تماماً`,
    at: new Date(),
  });

  await prisma.$transaction(async (tx) => {
    await tx.testTrack.deleteMany({ where: { departmentId: committee.id } });
    await tx.department.delete({ where: { id: committee.id } });
  });

  return { ok: true, name: committee.name };
}

/** لجانُ قسمٍ بعينه — بكل حالاتها، لأنها تُعرَض لقائده هو */
export async function committeesOf(parentId: string) {
  // department-scope: all — لجانُ هذا القسم بكل حالاتها، وهي لقائده
  return prisma.department.findMany({
    where: { parentId },
    orderBy: [{ requestedAt: "asc" }],
    select: {
      id: true,
      name: true,
      slug: true,
      colorHex: true,
      leadTitle: true,
      committeeStatus: true,
      requestedByName: true,
      requestedAt: true,
      decidedAt: true,
      decidedByName: true,
      decisionNote: true,
      admins: {
        where: { isActive: true, role: "department_admin" },
        select: { id: true, fullName: true, jobTitle: true },
      },
      _count: { select: { members: { where: ROSTER_MEMBER_WHERE }, committees: true } },
    },
  });
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
      requestedByName: true,
      requestedAt: true,
      parent: { select: { id: true, name: true, colorHex: true } },
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
