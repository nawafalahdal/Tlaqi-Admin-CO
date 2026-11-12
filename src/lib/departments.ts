import { prisma } from "@/lib/prisma";
import { appendMemberEvent } from "@/lib/googleSheets";
import { SENIOR_ROLES, seniorDepartment } from "@/lib/seniorAffiliation";
import type { Session } from "next-auth";

/** من يملك إنشاء قسم: الفاوندر والمدير التنفيذي.
 *  بناء الهيكل قرار تنظيمي، لا إجراء تشغيلي يومي. */
export function canCreateDepartment(role: string) {
  return role === "super_admin" || role === "executive";
}

/** **قرارُ المؤسس:** القسمُ لا يُبنى إلا باعتماده.
 *
 *  المؤسس يُنشئ مباشرةً — هو المعتمِد. والمدير التنفيذي يرفع طلباً: يُكتب
 *  القسمُ «بانتظار الاعتماد» فلا يظهر في أي قائمةٍ ولا هيكلٍ ولا دعوة
 *  (`OPEN_DEPARTMENT_WHERE` تحجبه كما تحجب اللجنةَ المقترحة)، ويُبنى حين
 *  يعتمده المؤسس. فحالةُ الاعتماد هي نفسُها حالةُ اللجنة (`committeeStatus`)،
 *  والفرقُ أن القسمَ الأصيل بلا أب ومعتمِدُه المؤسس وحده. */
export function departmentNeedsApproval(role: string) {
  return role === "executive";
}

export function canDecideDepartmentRequest(role: string) {
  return role === "super_admin";
}

/** ما يحمله القسم — وكلُّه يمنع حذفه */
export type DepartmentHoldings = {
  admins: number;
  members: number;
  invites: number;
  tickets: number;
  requests: number;
  signatures: number;
  committees: number;
};

/** ما يمنع حذفَ قسمٍ، مسمّىً بعدده — والصفحةُ والخادمُ يقرآنه من هنا.
 *
 *  **قرارُ المؤسس:** لا يُحذف قسمٌ فيه شخصٌ واحد، ولا يظهر زرُّ حذفه
 *  أصلاً — فلا يقع حذفٌ بالخطأ. و`seniorPeople` أهلُ الإدارة العليا
 *  المشتقّون من أدوارهم (المؤسس والتنفيذي والتشغيل): ليسوا مسجَّلين في
 *  القسم لكنهم أهلُه، فلا تُحذف وهم فيها. */
export function deleteBlockers(c: DepartmentHoldings, seniorPeople = 0): string[] {
  const blockers: string[] = [];
  if (seniorPeople > 0) blockers.push(`${seniorPeople} من الإدارة العليا (المؤسس والتنفيذي والتشغيل)`);
  if (c.admins > 0) blockers.push(`${c.admins} حساب قيادي`);
  if (c.members > 0) blockers.push(`${c.members} سجلّ عضوية`);
  if (c.invites > 0) blockers.push(`${c.invites} دعوة`);
  if (c.tickets > 0) blockers.push(`${c.tickets} تذكرة`);
  if (c.requests > 0) blockers.push(`${c.requests} طلب`);
  if (c.signatures > 0) blockers.push(`${c.signatures} توقيع`);
  if (c.committees > 0) blockers.push(`${c.committees} لجنة`);
  return blockers;
}

/** عددُ أهل الإدارة العليا المشتقّين — للقسم الذي هو الإدارة العليا وحده */
export async function seniorPeopleIn(departmentId: string): Promise<number> {
  const senior = await seniorDepartment();
  if (!senior || senior.id !== departmentId) return 0;
  return prisma.user.count({ where: { role: { in: [...SENIOR_ROLES] }, isActive: true } });
}

const HEX = /^#[0-9a-fA-F]{6}$/;

/** يبني معرّفاً لاتينياً صالحاً للرابط من اسم القسم.
 *
 *  أسماء الأقسام عربية، والعربية لا تصلح جزءاً من مسار URL نظيف، فإن لم
 *  يبقَ من الاسم حرف لاتيني واحد نولّد معرّفاً مقروءاً بدل أن نفشل. */
function slugify(name: string) {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return base || `dept-${Date.now().toString(36)}`;
}

/** يضمن تفرّد المعرّف بإضافة لاحقة رقمية عند التعارض */
async function uniqueSlug(base: string) {
  let slug = base;
  let n = 2;
  while (await prisma.department.findUnique({ where: { slug } })) {
    slug = `${base}-${n}`;
    n++;
  }
  return slug;
}

/** ينشئ قسماً جديداً كامل الأهلية.
 *
 *  القسم بلا بنك أسئلة قسمٌ لا يمكن دعوة أحد إليه: دالة اختيار المسار
 *  تبحث عن بنك عضو القسم وتفشل إن لم تجده. فيُنشأ البنك فارغاً مع القسم،
 *  ويملؤه قائده لاحقاً — هكذا يولد القسم مكتملاً لا ناقصاً. */
export async function createDepartment(opts: {
  name: string;
  colorHex: string;
  createdByName: string;
  /** قسم استثنائي يتبع الإدارة العليا: ممثل قانوني، مستشار، جهة خارجية.
   *  أعضاؤه ليسوا فريق عملٍ يُدار بتذاكر القسم وإعلاناته، بل جهات تواصل
   *  وترتيبٍ تخصّ الإدارة العليا وحدها. */
  leadershipOnly?: boolean;
  /** طلبٌ ينتظر اعتماد المؤسس (`departmentNeedsApproval`) — لا قسمٌ يُبنى الآن */
  request?: { byId: string; byName: string };
}) {
  const name = opts.name.trim();
  const colorHex = opts.colorHex.trim();

  if (!name) throw new Error("اسم القسم مطلوب");
  if (!HEX.test(colorHex)) throw new Error("اللون يجب أن يكون بصيغة #RRGGBB");

  const existing = await prisma.department.findUnique({ where: { name } });
  if (existing) throw new Error("يوجد قسم بهذا الاسم بالفعل");

  const slug = await uniqueSlug(slugify(name));

  const leadershipOnly = Boolean(opts.leadershipOnly);

  if (opts.request) {
    const now = new Date();
    const department = await prisma.department.create({
      data: {
        name,
        slug,
        colorHex,
        leadershipOnly,
        committeeStatus: "pending_review",
        requestedById: opts.request.byId,
        requestedByName: opts.request.byName,
        requestedAt: now,
      },
    });
    // بنكُ الأسئلة يُنشأ عند الاعتماد لا هنا: طلبٌ قد يُرَدّ لا يُورَّث بنكاً
    await appendMemberEvent({
      fullName: opts.request.byName,
      email: "",
      roleOrDepartment: name,
      event: "طلب إنشاء قسم — بانتظار اعتماد المؤسس",
      details: `اللون: ${colorHex} — المعرّف: ${slug}${leadershipOnly ? " — قسم استثنائي يتبع الإدارة العليا" : ""}`,
      at: now,
    });
    return department;
  }

  const department = await prisma.department.create({
    data: { name, slug, colorHex, leadershipOnly },
  });

  // القسم الاستثنائي لا يُدعى إليه باختبار: من يُضاف إليه يُختار لا
  // يُمتحَن. فلا بنك أسئلة له — وبنكٌ فارغ لا يُستعمل أبداً عبءٌ لا فائدة فيه.
  if (!leadershipOnly) {
    await prisma.testTrack.create({
      data: { scope: "department_member", departmentId: department.id },
    });
  }

  await appendMemberEvent({
    fullName: opts.createdByName,
    email: "",
    roleOrDepartment: name,
    event: leadershipOnly ? "إنشاء قسم استثنائي (الإدارة العليا)" : "إنشاء قسم جديد",
    details: leadershipOnly
      ? `اللون: ${colorHex} — المعرّف: ${slug} — قسم استثنائي يتبع الإدارة العليا، بلا بنك أسئلة`
      : `اللون: ${colorHex} — المعرّف: ${slug} — أُنشئ معه بنك أسئلة فارغ لأعضائه`,
    at: new Date(),
  });

  return department;
}

/** من يملك حذف قسم: المؤسس وحده.
 *
 *  الإنشاء يملكه المؤسس والتنفيذي، أما الحذف فلا. إنشاءُ قسمٍ زائد يُصلَح
 *  بحذفه، وحذفُ قسمٍ قائم لا يُصلَح بإنشائه: الاسم يحمله كل سجلٍّ سابق
 *  في الشيت، والتذاكر والدعوات تُشير إليه. فضيق الباب هنا مقصود. */
export function canDeleteDepartment(role: string) {
  return role === "super_admin";
}

/** **خطةُ حذف القسم الأصيل** — ما يمنعه، ومن يبقى فيه، وما يُحفظ من سجلّه.
 *
 *  **قرارُ المؤسس:** يُحذف القسمُ حين يخلو من أعضائه — ويبقى قائدُه وحده فلا يمنع ذلك.
 *  وكان الحذفُ يَعُدّ كلَّ سجلٍّ مانعاً: القائدَ نفسَه، وسجلَّ ترشّحه، وكلَّ دعوةٍ صدرت
 *  يوماً، وكلَّ تذكرةٍ أُغلقت — فلا يُحذف قسمٌ عمل يوماً (ومنه الموارد البشرية). فصار
 *  المانعُ هو **الحيُّ وحده**: من في القسم اليوم، وما ينتظر عملاً.
 *
 *  **ولا يُهدَر سجلٌّ ليُحذف قسم:** الحذفُ النهائيُّ كان يمحو أهدافَ القسم وخططَه
 *  الأسبوعية معه (Cascade)، ويَفُكّ أعضاءَه السابقين وتذاكرَه ودعواته عنه. فإن كان للقسم
 *  تاريخ **أُرشف** (`committeeStatus = archived` — الحالةُ نفسُها التي تُغلق بها اللجان):
 *  يغيب من كل قائمةٍ وهيكلٍ ودعوة (`OPEN_DEPARTMENT_WHERE`)، ويبقى كلُّ ما يُشير إليه
 *  صحيحاً. ولا يُحذف حذفاً نهائياً إلا قسمٌ بلا تاريخٍ أصلاً. */
export type DeletionPlan = {
  mode: "delete" | "archive";
  /** ما يمنع الحذف الآن — مسمّىً بعدده. فارغٌ = يُحذف */
  blockers: string[];
  /** القائدُ الباقي وحده — تُسحب قيادتُه ويُسلَّم عملُه المعلَّق لخلفه */
  lead: { id: string; fullName: string } | null;
  /** ما يبقى من سجلّه عند الأرشفة */
  preserved: string[];
};

const OPEN_PLAN_STATES = ["not_started", "in_progress", "submitted", "returned"] as const;
const CLOSED_OBJECTIVES = ["done", "missed", "rejected", "cancelled"] as const;
const LIVE_COMMITTEE = ["pending_review", "draft", "awaiting_lead", "approved", "suspended", "completed"] as const;

export async function departmentDeletionPlan(departmentId: string): Promise<DeletionPlan | null> {
  const dept = await prisma.department.findUnique({
    where: { id: departmentId },
    select: { id: true, slug: true, parentId: true, committeeStatus: true },
  });
  if (!dept || dept.parentId) return null;

  const users = await prisma.user.findMany({
    where: { departmentId, isActive: true },
    select: { id: true, fullName: true, email: true, role: true },
    orderBy: { createdAt: "asc" },
  });
  const lead = users.find((u) => u.role === "department_admin") ?? null;
  const otherUsers = users.filter((u) => u.id !== lead?.id);
  // سجلُّ ترشّح القائد نفسه (`approveMember` يُبقيه مع حسابه الإداري) ليس عضواً ثانياً
  const leadEmails = users.map((u) => u.email.toLowerCase());
  const memberWhere = { departmentId, email: { notIn: leadEmails } };

  const [
    activeMembers, candidates, closing, liveCommittees, openTickets, openRequests, openTasks, openObjectives,
    seniorPeople, marketingTeam,
    allMembers, invites, tickets, requests, signatures, committees, objectives, weekPlans, planTasks,
  ] = await Promise.all([
    // member-roster: all — مانعُ الحذف يعدّ كلَّ صفٍّ حيٍّ في القسم (أحوطُ من قائمة العرض): صفٌّ واحدٌ قائمٌ يمنع
    prisma.member.count({
      where: { ...memberWhere, isActive: true, terminatedAt: null, approvalStatus: "approved", stepDownAt: null, offboardingClosedAt: null },
    }),
    prisma.member.findMany({
      where: { ...memberWhere, isActive: true, terminatedAt: null, approvalStatus: "pending_review" },
      select: { firstLoginAt: true, credentialsIssuedAt: true, approvalStatus: true },
    }),
    prisma.member.count({ where: { ...memberWhere, stepDownAt: { not: null }, offboardingClosedAt: null } }),
    prisma.department.count({ where: { parentId: departmentId, committeeStatus: { in: [...LIVE_COMMITTEE] } } }),
    prisma.ticket.count({ where: { targetDepartmentId: departmentId, status: { not: "resolved" } } }),
    prisma.request.count({ where: { targetDepartmentId: departmentId, status: { not: "done" } } }),
    prisma.planTask.count({ where: { departmentId, execState: { in: [...OPEN_PLAN_STATES] } } }),
    prisma.departmentObjective.count({ where: { departmentId, status: { notIn: [...CLOSED_OBJECTIVES] } } }),
    seniorPeopleIn(departmentId),
    dept.slug === "marketing" ? prisma.marketingMember.count({ where: { active: true } }) : Promise.resolve(0),
    prisma.member.count({ where: { departmentId } }),
    prisma.invite.count({ where: { departmentId } }),
    prisma.ticket.count({ where: { targetDepartmentId: departmentId } }),
    prisma.request.count({ where: { targetDepartmentId: departmentId } }),
    prisma.leaderSignature.count({ where: { departmentId } }),
    prisma.department.count({ where: { parentId: departmentId } }),
    prisma.departmentObjective.count({ where: { departmentId } }),
    prisma.weekPlan.count({ where: { departmentId } }),
    prisma.planTask.count({ where: { departmentId } }),
  ]);
  // المرشّحُ الذي سقطت مهلتُه دون دخول سجلٌّ لا شخص — `candidateWindowExpired`
  const { candidateWindowExpired } = await import("@/lib/workflow");
  const liveCandidates = candidates.filter((c) => !candidateWindowExpired(c)).length;

  const blockers: string[] = [];
  if (seniorPeople > 0) blockers.push(`${seniorPeople} من الإدارة العليا (المؤسس والتنفيذي والتشغيل)`);
  if (otherUsers.length > 0) blockers.push(`${otherUsers.length} حساب إداري نشط غير القائد`);
  if (activeMembers > 0) blockers.push(`${activeMembers} عضو نشط غير القائد — تُنهى عضويتُهم أو يُنقلون أولاً`);
  if (liveCandidates > 0) blockers.push(`${liveCandidates} مرشّح قيد الانضمام`);
  if (closing > 0) blockers.push(`${closing} ختام تجربةٍ لم يُغلَق`);
  if (liveCommittees > 0) blockers.push(`${liveCommittees} لجنة قائمة — تُغلَق أو تُؤرشف أولاً`);
  if (openTickets > 0) blockers.push(`${openTickets} تذكرة مفتوحة موجّهة إليه`);
  if (openRequests > 0) blockers.push(`${openRequests} طلب لم يُنجَز`);
  if (openTasks > 0) blockers.push(`${openTasks} مهمة خطةٍ مفتوحة`);
  if (openObjectives > 0) blockers.push(`${openObjectives} هدف لم يُغلَق`);
  if (marketingTeam > 0) blockers.push(`وكيل التسويق يعمل بهذا القسم (${marketingTeam} في فريقه)`);

  const preserved: string[] = [];
  if (allMembers > 0) preserved.push(`${allMembers} سجلّ عضوية سابق`);
  if (invites > 0) preserved.push(`${invites} دعوة`);
  if (tickets > 0) preserved.push(`${tickets} تذكرة`);
  if (requests > 0) preserved.push(`${requests} طلب`);
  if (signatures > 0) preserved.push(`${signatures} توقيع`);
  if (committees > 0) preserved.push(`${committees} لجنة سابقة`);
  if (objectives > 0) preserved.push(`${objectives} هدف`);
  if (weekPlans > 0) preserved.push(`${weekPlans} خطة أسبوعية`);
  if (planTasks > 0) preserved.push(`${planTasks} مهمة خطة`);

  // بلا تاريخٍ ولا قائد: يُحذف نهائياً. وإلا يُؤرشف فيبقى كلُّ ما يُشير إليه صحيحاً
  const mode: DeletionPlan["mode"] = preserved.length === 0 && !lead ? "delete" : "archive";
  return { mode, blockers, lead: lead ? { id: lead.id, fullName: lead.fullName } : null, preserved };
}

/** يحذف قسماً — وللمؤسس وحده، ولا يحذف قسماً فيه أحدٌ غير قائده.
 *
 *  - **القسمُ الأصيل:** بخطّته (`departmentDeletionPlan`) — يُرفض بما يمنعه مسمّىً، أو
 *    يُؤرشف حافظاً سجلّه، أو يُحذف نهائياً إن لم يكن له تاريخ.
 *  - **اللجنة:** بقاعدتها القديمة كما هي — لها دورةُ حياتها في وحدة اللجان (إغلاقٌ ثم
 *    أرشفة)، ولا تُحذف إلا فارغةً تماماً. */
export async function deleteDepartment(opts: {
  departmentId: string;
  /** يُكتب اسم القسم كاملاً: الحذف لا يقع بنقرةٍ في المكان الخطأ */
  confirmName: string;
  actorRole: string;
  actorName: string;
  actorId?: string;
}): Promise<{ ok: true; name: string; mode: "delete" | "archive" } | { ok: false; reason: string }> {
  if (!canDeleteDepartment(opts.actorRole)) {
    return { ok: false, reason: "حذف الأقسام للمؤسس وحده" };
  }

  const dept = await prisma.department.findUnique({
    where: { id: opts.departmentId },
    include: {
      _count: {
        select: {
          admins: true,
          members: true,
          invites: true,
          requests: true,
          tickets: true,
          signatures: true,
          committees: true,
        },
      },
    },
  });
  if (!dept) return { ok: false, reason: "القسم غير موجود" };
  if (dept.committeeStatus === "archived") return { ok: false, reason: "القسم مؤرشفٌ من قبل" };

  if (opts.confirmName.trim() !== dept.name.trim()) {
    return { ok: false, reason: "الاسم المكتوب لا يطابق اسم القسم — لم يُحذف شيء" };
  }

  // ── اللجنة: القاعدةُ القديمة كما هي
  if (dept.parentId) {
    const blockers = deleteBlockers(dept._count, 0);
    if (blockers.length > 0) {
      return {
        ok: false,
        reason: `القسم ما زال يحمل: ${blockers.join("، ")}. فرّغه أولاً — ولا يُهدَر سجلٌّ ليُفرَّغ قسم.`,
      };
    }
    await appendMemberEvent({
      fullName: opts.actorName,
      email: "",
      roleOrDepartment: dept.name,
      event: "حذف قسم نهائياً",
      details: `المعرّف: ${dept.slug} — اللون: ${dept.colorHex} — كان فارغاً عند الحذف`,
      at: new Date(),
    });
    await prisma.$transaction(async (tx) => {
      await tx.announcement.deleteMany({ where: { departmentId: dept.id } });
      await tx.testTrack.deleteMany({ where: { departmentId: dept.id } });
      await tx.department.delete({ where: { id: dept.id } });
    });
    return { ok: true, name: dept.name, mode: "delete" };
  }

  // ── القسمُ الأصيل: بخطّته
  const plan = await departmentDeletionPlan(dept.id);
  if (!plan) return { ok: false, reason: "القسم غير موجود" };
  if (plan.blockers.length > 0) {
    return { ok: false, reason: `لا يُحذف القسم وفيه: ${plan.blockers.join("، ")}.` };
  }

  if (plan.mode === "delete") {
    // بلا تاريخٍ ولا قائد: لا يُشير إليه شيءٌ يُهدَر — بنكُ أسئلته وإعلاناتُه تخصّه وحده
    await appendMemberEvent({
      fullName: opts.actorName,
      email: "",
      roleOrDepartment: dept.name,
      event: "حذف قسم نهائياً",
      details: `المعرّف: ${dept.slug} — اللون: ${dept.colorHex} — لا سجلّ له عند الحذف`,
      at: new Date(),
    });
    await prisma.$transaction(async (tx) => {
      await tx.announcement.deleteMany({ where: { departmentId: dept.id } });
      await tx.testTrack.deleteMany({ where: { departmentId: dept.id } });
      await tx.department.delete({ where: { id: dept.id } });
    });
    return { ok: true, name: dept.name, mode: "delete" };
  }

  return archiveDepartment(dept, plan, { id: opts.actorId ?? null, name: opts.actorName });
}

/** **أرشفةُ القسم** — «حذفٌ» يحفظ السجلّ.
 *
 *  - الحالة `archived`: يغيب من كل قائمةٍ وهيكلٍ ودعوةٍ ووجهةِ تذكرة.
 *  - اسمُه ومعرّفُه يُوسَمان «مؤرشف» بتاريخه: فيُنشأ غيرُه بالاسم نفسه إن شاء المؤسس،
 *    ويُقرأ اسمُه في السجلات القديمة على حقيقته.
 *  - قائدُه الباقي وحده: تُسحب قيادتُه (حسابُه الإداريُّ يُعطَّل بسببٍ مكتوب، وجلساتُه
 *    تُبطَل)، ويُسلَّم عملُه المعلَّق لخلفه في السلسلة (`handOver`)، ويُبطَل توقيعُه
 *    للمستقبل — والصادرُ به يبقى صحيحاً.
 *  - لا يُحذف صفٌّ واحد: أعضاؤه السابقون ودعواته وتذاكره وأهدافه وخططه تبقى تُشير إليه. */
async function archiveDepartment(
  dept: { id: string; name: string; slug: string; colorHex: string },
  plan: DeletionPlan,
  actor: { id: string | null; name: string }
): Promise<{ ok: true; name: string; mode: "archive" } | { ok: false; reason: string }> {
  const now = new Date();
  const stamp = now.toISOString().slice(0, 10);
  const { revokeAccess } = await import("@/lib/accessRevocation");
  const { recordOrgEvent } = await import("@/lib/org/audit");

  let archivedName = `${dept.name} — مؤرشف ${stamp}`;
  for (let n = 2; await prisma.department.findUnique({ where: { name: archivedName }, select: { id: true } }); n++) {
    archivedName = `${dept.name} — مؤرشف ${stamp} (${n})`;
  }
  const archivedSlug = await uniqueSlug(`${dept.slug}-archived-${stamp.replace(/-/g, "")}`);
  const leadUser = plan.lead
    ? await prisma.user.findUnique({
        where: { id: plan.lead.id },
        select: { id: true, fullName: true, email: true, role: true, departmentId: true },
      })
    : null;

  const done = await prisma.$transaction(async (tx) => {
    // الحالةُ شرطُ الكتابة نفسها: ضغطتان متسابقتان لا تؤرشفان مرّتين
    const flipped = await tx.department.updateMany({
      where: { id: dept.id, OR: [{ committeeStatus: null }, { committeeStatus: "approved" }] },
      data: {
        committeeStatus: "archived",
        statusChangedAt: now,
        statusNote: `أرشفه ${actor.name} — حُذف من الأقسام العاملة مع حفظ سجلّه (الاسم الأصلي: ${dept.name})`,
        name: archivedName,
        slug: archivedSlug,
        deputyMemberId: null,
        deputyPermissions: [],
      },
    });
    if (flipped.count === 0) return false;
    if (leadUser) {
      await tx.user.update({
        where: { id: leadUser.id },
        data: { isActive: false, removedAt: now, removalReason: `أُرشف قسمُه (${dept.name}) بقرار المؤسس — انتهت قيادته` },
      });
      await revokeAccess(tx, { accountKind: "user", accountId: leadUser.id, reason: "أرشفة القسم", byName: actor.name });
    }
    await recordOrgEvent(tx, {
      scope: "department",
      entityId: dept.id,
      departmentId: dept.id,
      action: "department.archived",
      actor: { id: actor.id ?? "system", name: actor.name, kind: actor.id ? "user" : "system" },
      before: { name: dept.name, slug: dept.slug, lead: leadUser ? { userId: leadUser.id, name: leadUser.fullName } : null },
      after: { name: archivedName, slug: archivedSlug, status: "archived", preserved: plan.preserved },
      note: "حذفٌ مع حفظ السجلّ — لا يُحذف صفٌّ يُشير إليه",
    });
    return true;
  });
  if (!done) return { ok: false, reason: "القسم أُرشف أو تغيّرت حالتُه للتوّ — حدّث الصفحة" };

  // ── ما بعد المعاملة: العملُ المعلَّق والتوقيعُ والشيت — لا يُبطل القرارَ إن تعثّر
  let handover = "لا قائد له";
  if (leadUser) {
    try {
      const { handOver } = await import("@/lib/succession");
      const h = await handOver({ user: leadUser, byName: actor.name, occasion: "أرشفة القسم" });
      handover = h.summary;
    } catch {
      handover = "تعذّر تسليم العمل المعلَّق آلياً — يُراجَع من صفحة الحساب";
    }
    try {
      const { supersedeSignatures } = await import("@/lib/signatures");
      await supersedeSignatures(leadUser.id, `أُرشف قسمُه (${dept.name})`);
    } catch {
      /* يُبطَل من صفحة التوقيعات */
    }
    try {
      const { syncAdminAccountRow } = await import("@/lib/workflow");
      await syncAdminAccountRow(leadUser.id);
    } catch {
      /* يُزامَن في الكنس التالي */
    }
  }
  await appendMemberEvent({
    fullName: actor.name,
    email: "",
    roleOrDepartment: dept.name,
    event: "أرشفة قسم (حذف مع حفظ السجل)",
    details:
      `المعرّف: ${dept.slug} ← ${archivedSlug} — يُحفظ: ${plan.preserved.join("، ") || "لا شيء"}` +
      (leadUser ? ` — القائد ${leadUser.fullName}: انتهت قيادته — ${handover}` : ""),
    at: now,
  });
  return { ok: true, name: dept.name, mode: "archive" };
}

/** الأقسامُ المؤرشفة — لصفحة الأقسام (للمؤسس): أسماؤها وتاريخُ أرشفتها وسببُها */
export async function archivedDepartments() {
  // department-scope: all — قائمةُ المؤرشفة نفسها: هي ما يستبعده OPEN_DEPARTMENT_WHERE عمداً
  return prisma.department.findMany({
    where: { parentId: null, committeeStatus: "archived" },
    select: { id: true, name: true, colorHex: true, statusChangedAt: true, statusNote: true },
    orderBy: { statusChangedAt: "desc" },
    take: 50,
  });
}

/** يُصنّف عضواً غير مصنّف في قسم — وللمؤسس وحده.
 *
 *  **ولا يُعيد تصنيف من صُنِّف.** وهذا شرطُ المؤسس صريحاً، وله وجهٌ
 *  حوكميٌّ صحيح: القسم ليس وسماً يُبدَّل. من اعتُمد في قسمٍ اجتاز بنك
 *  أسئلة ذلك القسم، وقائدُ القسم هو من اعتمده، وتذاكره ومهامّه وشهادتُه
 *  تُقرأ على أنه من أهله. فنقلُه بتعديل حقلٍ واحد يُبقي كلّ ذلك معلّقاً
 *  بقسمٍ لم يعد فيه — ويجعل شهادتَه تشهد بما لم يكن.
 *
 *  أما غير المصنّف فلا شيء يُنقض بتصنيفه: هو سجلٌّ ناقصٌ يُكمَل.
 *
 *  ومن أراد نقلاً حقيقياً فطريقه الحوكمة: تُنهى عضويته في قسمه ويُدعى
 *  إلى الآخر — فيبقى لكل قسمٍ سجلُّه صحيحاً.
 */
export async function assignMemberDepartment(opts: {
  memberId: string;
  departmentId: string;
  actorRole: string;
  actorName: string;
}): Promise<{ ok: true; memberName: string; departmentName: string } | { ok: false; reason: string }> {
  if (opts.actorRole !== "super_admin") {
    return { ok: false, reason: "تصنيف الأعضاء في الأقسام للمؤسس وحده" };
  }

  const dept = await prisma.department.findUnique({ where: { id: opts.departmentId } });
  if (!dept) return { ok: false, reason: "القسم غير موجود" };
  // اللجنةُ ليست قسماً لأحد — يُصنَّف العضوُ في قسمه الأصيل ثم يُضَمّ إلى لجانه
  if (dept.parentId) return { ok: false, reason: "اللجنةُ ليست قسماً: صنّفه في القسم الأصيل ثم يضمّه قائدُه إلى اللجنة" };

  // الحرس في `where` لا قبله: `departmentId: null` شرطُ التحديث نفسه،
  // فمتسابقان لا يمرّان، ومن صُنِّف لحظةَ الضغط لا يُعاد تصنيفه.
  const written = await prisma.member.updateMany({
    where: { id: opts.memberId, departmentId: null },
    data: { departmentId: dept.id },
  });

  const member = await prisma.member.findUnique({
    where: { id: opts.memberId },
    include: { department: true },
  });
  if (!member) return { ok: false, reason: "السجل غير موجود" };

  if (written.count === 0) {
    return {
      ok: false,
      reason: `هذا العضو مصنّفٌ في ${member.department?.name ?? "قسمٍ آخر"} — ولا يُعاد التصنيف. النقل يكون بإنهاء عضويته ودعوته إلى القسم الآخر.`,
    };
  }

  await appendMemberEvent({
    fullName: member.fullName,
    email: member.email,
    roleOrDepartment: dept.name,
    event: "تصنيف عضو في قسم",
    details: `كان غير مصنّف — صنّفه ${opts.actorName}`,
    at: new Date(),
  });

  const { syncMemberLifecycleRow } = await import("@/lib/workflow");
  await syncMemberLifecycleRow(member.id);

  return { ok: true, memberName: member.fullName, departmentName: dept.name };
}

/** طلباتُ إنشاء الأقسام المنتظِرة — طابورُ المؤسس */
export async function pendingDepartmentRequests() {
  // department-scope: all — الطابورُ هو المنتظِرُ نفسُه، وهو غير مفتوح
  return prisma.department.findMany({
    where: { parentId: null, committeeStatus: "pending_review" },
    orderBy: { requestedAt: "asc" },
    take: 50,
    select: {
      id: true,
      name: true,
      colorHex: true,
      leadershipOnly: true,
      requestedByName: true,
      requestedAt: true,
    },
  });
}

/** قرارُ المؤسس في طلب إنشاء قسم: يُبنى، أو يُرَدّ بسببٍ مكتوب.
 *
 *  والاعتمادُ يُعيد القسمَ قسماً أصيلاً (`committeeStatus: null`) ويُنشئ
 *  بنكَ أسئلته — فيولد مكتملاً كما يولد ما يُنشئه المؤسس بيده. والردُّ
 *  لا يحذف الصفّ: يبقى مكتوباً بسببه، ويُرى في الصفحة لمن طلبه. */
export async function decideDepartmentRequest(opts: {
  departmentId: string;
  decision: "approved" | "rejected";
  note?: string | null;
  session: Session;
}): Promise<{ ok: true; name: string; decision: "approved" | "rejected" } | { ok: false; reason: string }> {
  if (!canDecideDepartmentRequest(opts.session.user.role)) {
    return { ok: false, reason: "اعتمادُ الأقسام للمؤسس وحده" };
  }
  const note = opts.note?.trim() || null;
  if (opts.decision === "rejected" && !note) {
    return { ok: false, reason: "الردّ لا يقع بلا سبب مكتوب" };
  }

  const dept = await prisma.department.findUnique({
    where: { id: opts.departmentId },
    select: { id: true, name: true, leadershipOnly: true, parentId: true, committeeStatus: true },
  });
  if (!dept || dept.parentId) return { ok: false, reason: "الطلب غير موجود" };

  const now = new Date();
  // الحرسُ في `where`: قرارانِ متسابقان لا يمرّان، ولا يُنقَض قرارٌ بضغطةٍ متأخّرة
  const written = await prisma.department.updateMany({
    where: { id: dept.id, parentId: null, committeeStatus: "pending_review" },
    data: {
      committeeStatus: opts.decision === "approved" ? null : "rejected",
      decidedAt: now,
      decidedByName: opts.session.user.name ?? "—",
      decisionNote: note,
    },
  });
  if (written.count === 0) return { ok: false, reason: "قُرِّر هذا الطلب من قبل" };

  if (opts.decision === "approved" && !dept.leadershipOnly) {
    await prisma.testTrack.upsert({
      where: { scope_departmentId: { scope: "department_member", departmentId: dept.id } },
      create: { scope: "department_member", departmentId: dept.id },
      update: {},
    });
  }

  await appendMemberEvent({
    fullName: opts.session.user.name ?? "—",
    email: "",
    roleOrDepartment: dept.name,
    event: opts.decision === "approved" ? "اعتماد طلب قسم وإنشاؤه" : "ردّ طلب إنشاء قسم",
    details:
      opts.decision === "approved"
        ? `بُني القسم${dept.leadershipOnly ? " (استثنائي)" : " وأُنشئ له بنك أسئلة فارغ"}${note ? ` — ملاحظة: ${note}` : ""}`
        : `السبب: ${note}`,
    at: now,
  });

  return { ok: true, name: dept.name, decision: opts.decision };
}
