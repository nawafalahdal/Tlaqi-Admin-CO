import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordOrgEvent } from "@/lib/org/audit";

/** **قيادةُ الإدارة العليا — قائدٌ فعليٌّ واحد، يُحسب ويُحفَظ ويُسجَّل كلُّ انتقالٍ له.**
 *
 *  | الحال | القائدُ الفعلي | الأساس |
 *  |---|---|---|
 *  | رئيسٌ تنفيذيٌّ نشط | هو | `ceo` |
 *  | لا رئيسَ تنفيذياً نشطاً (لم يُعيَّن، أو عُطِّل، أو نُحّي، أو انتهت عضويتُه) | المؤسس | `founder_fallback` |
 *  | عاد رئيسٌ تنفيذي أو عُيِّن جديد (بإجراء المؤسس المصرَّح: الدعوة ثم الاعتماد) | الرئيسُ التنفيذي | `ceo` |
 *
 *  **في الخادم والقاعدة لا في الواجهة:** القائدُ يُحفَظ في صفّ الإدارة العليا (`seniorLeaderUserId`)،
 *  وكلُّ صلاحيةٍ قيادية تُسأل هنا (`isSeniorLeader`) لا عن الدور وحده. ولا يجتمع قائدان: الحقلُ واحد،
 *  والرئيسُ التنفيذي النشطُ واحدٌ بقيدٍ في القاعدة (`User_single_active_executive`). والانتقالُ في معاملةٍ
 *  بقفلٍ على الصف، ومعه حدثٌ في سجل الحوكمة — فلا انتقالَ بلا أثر، ولا انتقالان متزامنان.
 *
 *  **ولا يُفقَد شيء بالانتقال:** القيادةُ صفةٌ تُقرأ، لا ملكيةٌ تُنقل — المناصبُ والدعواتُ واللجانُ والسجلّات
 *  باقيةٌ كما هي، ومن يقود الآن يتولّاها. */

type Db = Prisma.TransactionClient | typeof prisma;

export type SeniorLeaderBasis = "ceo" | "founder_fallback";

export type SeniorLeadership = {
  departmentId: string;
  departmentName: string;
  leader: { id: string; fullName: string; role: "executive" | "super_admin" } | null;
  basis: SeniorLeaderBasis | null;
  since: Date | null;
};

export const BASIS_LABEL: Record<SeniorLeaderBasis, string> = {
  ceo: "الرئيس التنفيذي — قائد الإدارة العليا",
  founder_fallback: "المؤسس — قيادةٌ بالخلافة لغياب رئيسٍ تنفيذيٍّ نشط",
};

async function seniorDept(db: Db) {
  return db.department.findFirst({
    where: { leadershipOnly: true, parentId: null },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      seniorLeaderUserId: true,
      seniorLeaderSince: true,
      seniorLeaderBasis: true,
      seniorLeaderUser: { select: { id: true, fullName: true, role: true, isActive: true } },
    },
  });
}

/** من يجب أن يقود الآن — الرئيسُ التنفيذي النشط، وإلا أقدمُ مؤسسٍ نشط */
export async function expectedSeniorLeader(db: Db = prisma) {
  const ceo = await db.user.findFirst({
    where: { role: "executive", isActive: true },
    orderBy: { createdAt: "asc" },
    select: { id: true, fullName: true, role: true },
  });
  if (ceo) return { ...ceo, role: "executive" as const, basis: "ceo" as const };
  const founder = await db.user.findFirst({
    where: { role: "super_admin", isActive: true },
    orderBy: { createdAt: "asc" },
    select: { id: true, fullName: true, role: true },
  });
  return founder ? { ...founder, role: "super_admin" as const, basis: "founder_fallback" as const } : null;
}

function noteFor(from: SeniorLeaderBasis | null, to: SeniorLeaderBasis | null, trigger: string) {
  const what =
    to === "founder_fallback" && from === "ceo"
      ? "انتقلت قيادةُ الإدارة العليا إلى المؤسس — لا رئيسَ تنفيذياً نشطاً"
      : to === "ceo" && from === "founder_fallback"
        ? "عادت قيادةُ الإدارة العليا إلى الرئيس التنفيذي"
        : to === "ceo" && from === "ceo"
          ? "انتقلت قيادةُ الإدارة العليا إلى رئيسٍ تنفيذيٍّ جديد"
          : to === null
            ? "لا قائدَ نشطاً للإدارة العليا — لا رئيسَ تنفيذياً ولا مؤسساً نشطاً"
            : "تأسيسُ قيادة الإدارة العليا";
  return `${what} — ${trigger}`;
}

/** **يُطابق القائدَ المحفوظ بمن يجب أن يقود — ويسجّل الانتقال إن وقع.** آمنٌ للتكرار: لا يكتب شيئاً إن لم
 *  يتغيّر شيء. يُستدعى بعد كل إجراءٍ يمسّ حسابَ رئيسٍ تنفيذي أو مؤسس، وفي الكنس الدوري احتياطاً. */
export async function reconcileSeniorLeadership(trigger: string): Promise<SeniorLeadership | null> {
  // قراءةٌ بلا قفل أولاً: الحالُ الغالبة «لم يتغيّر شيء»
  const glance = await seniorDept(prisma);
  if (!glance) return null;
  const want = await expectedSeniorLeader(prisma);
  if ((want?.id ?? null) === glance.seniorLeaderUserId && (want?.basis ?? null) === (glance.seniorLeaderBasis ?? null)) {
    return view(glance);
  }
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Department" WHERE id = ${glance.id} FOR UPDATE`;
    const dept = (await seniorDept(tx))!;
    const expected = await expectedSeniorLeader(tx);
    const toId = expected?.id ?? null;
    const toBasis = expected?.basis ?? null;
    if (toId === dept.seniorLeaderUserId && toBasis === (dept.seniorLeaderBasis ?? null)) return view(dept);
    const now = new Date();
    await tx.department.update({
      where: { id: dept.id },
      data: { seniorLeaderUserId: toId, seniorLeaderSince: toId ? now : null, seniorLeaderBasis: toBasis },
    });
    const fromBasis = (dept.seniorLeaderBasis as SeniorLeaderBasis | null) ?? null;
    await recordOrgEvent(tx, {
      scope: "department",
      entityId: dept.id,
      departmentId: dept.id,
      action: "senior.leadership",
      actor: { kind: "system", id: "system", name: "المنصة — آلياً", role: "system" },
      before: { leaderId: dept.seniorLeaderUserId, leaderName: dept.seniorLeaderUser?.fullName ?? null, basis: fromBasis },
      after: { leaderId: toId, leaderName: expected?.fullName ?? null, basis: toBasis },
      note: noteFor(fromBasis, toBasis, trigger),
    });
    return {
      departmentId: dept.id,
      departmentName: dept.name,
      leader: expected ? { id: expected.id, fullName: expected.fullName, role: expected.role } : null,
      basis: toBasis,
      since: toId ? now : null,
    };
  });
}

function view(d: NonNullable<Awaited<ReturnType<typeof seniorDept>>>): SeniorLeadership {
  const u = d.seniorLeaderUser;
  return {
    departmentId: d.id,
    departmentName: d.name,
    leader: u && u.isActive && (u.role === "executive" || u.role === "super_admin") ? { id: u.id, fullName: u.fullName, role: u.role } : null,
    basis: (d.seniorLeaderBasis as SeniorLeaderBasis | null) ?? null,
    since: d.seniorLeaderSince,
  };
}

/** القيادةُ الآن — بعد المطابقة (فلا يُقرأ قائدٌ عُطِّل حسابُه للتوّ) */
export async function currentSeniorLeadership(): Promise<SeniorLeadership | null> {
  return reconcileSeniorLeadership("قراءة القيادة الحالية");
}

/** هل صاحبُ هذا الحساب قائدُ الإدارة العليا الآن؟ — مصدرُ كل صلاحيةٍ قيادية فيها */
export async function isSeniorLeader(actor: { kind: "user" | "member"; id: string } | null): Promise<boolean> {
  if (!actor || actor.kind !== "user") return false;
  const l = await currentSeniorLeadership();
  return !!l?.leader && l.leader.id === actor.id;
}
