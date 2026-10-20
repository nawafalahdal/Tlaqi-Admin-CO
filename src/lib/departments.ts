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

/** يحذف قسماً — وللمؤسس وحده، ولا يحذف قسماً يحمل أحداً.
 *
 *  **ولا يُهدَر سجلٌّ ليُفرَّغ قسم.** القسم تُشير إليه سبعة جداول: قادته
 *  وأعضاؤه ودعواته وبنك أسئلته وتوقيعاته وتذاكره وإعلاناته وطلباته.
 *  فحذفُه وهو يحملها إمّا يفشل بخطأ قيدٍ أجنبيٍّ غامض، أو — لو فُكّت
 *  القيود — يُنتج سجلّاتٍ يتيمة: عضوٌ بلا قسم لا يعرف أحدٌ من أين جاء،
 *  وتذكرةٌ وُجِّهت إلى لا شيء.
 *
 *  فالقاعدة: يُفرَّغ القسم أولاً بيد صاحب القرار في كل سجلّ — يُنحّى
 *  قائده، وتُنهى عضوية أعضائه أو يُنقلوا، وتُغلق تذاكره — ثم يُحذف.
 *  والرفض يُسمّي ما يمنعه بالعدد، فلا يُترك المؤسس يُخمّن.
 *
 *  وما يُحذف معه: بنك أسئلته (فارغٌ أو مملوء، هو بنكُه لا بنكُ غيره)
 *  وإعلاناته التي تخصّه وحده. وهذان لا يعنيان أحداً بعده. */
export async function deleteDepartment(opts: {
  departmentId: string;
  /** يُكتب اسم القسم كاملاً: الحذف لا يقع بنقرةٍ في المكان الخطأ */
  confirmName: string;
  actorRole: string;
  actorName: string;
}): Promise<{ ok: true; name: string } | { ok: false; reason: string }> {
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

  if (opts.confirmName.trim() !== dept.name.trim()) {
    return { ok: false, reason: "الاسم المكتوب لا يطابق اسم القسم — لم يُحذف شيء" };
  }

  // ما يمنع الحذف يُسمّى بعدده، لا يُقال «لا يمكن» فحسب — وهو نفسُه ما
  // يُخفي زرَّ الحذف في الصفحة (`deleteBlockers`)
  const blockers = deleteBlockers(dept._count, await seniorPeopleIn(dept.id));
  if (blockers.length > 0) {
    return {
      ok: false,
      reason: `القسم ما زال يحمل: ${blockers.join("، ")}. فرّغه أولاً — ولا يُهدَر سجلٌّ ليُفرَّغ قسم.`,
    };
  }

  // السجل يُختم قبل الحذف: بعده لا يبقى ما يُكتب
  await appendMemberEvent({
    fullName: opts.actorName,
    email: "",
    roleOrDepartment: dept.name,
    event: "حذف قسم نهائياً",
    details: `المعرّف: ${dept.slug} — اللون: ${dept.colorHex} — كان فارغاً عند الحذف`,
    at: new Date(),
  });

  // بنك أسئلته وإعلاناته يخصّانه وحده، فيزولان معه. وأسئلة البنك
  // مرتبطةٌ به بـcascade في القاعدة.
  await prisma.$transaction(async (tx) => {
    await tx.announcement.deleteMany({ where: { departmentId: dept.id } });
    await tx.testTrack.deleteMany({ where: { departmentId: dept.id } });
    await tx.department.delete({ where: { id: dept.id } });
  });

  return { ok: true, name: dept.name };
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
