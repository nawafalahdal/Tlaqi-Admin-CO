import { prisma } from "@/lib/prisma";
import { avatarUrl } from "@/lib/avatarUrl";
import { employeeIdLabel } from "@/lib/employeeId";
import { roleTitle, gx, type MaybeGender } from "@/lib/gender";
import { OPEN_DEPARTMENT_WHERE } from "@/lib/committees";
import { leftoverLeaderIds } from "@/lib/leftoverLeaders";
import { resolvePortrait, type Portrait } from "@/lib/portrait";
import type { Locale } from "@/i18n";

/** **الهيكلُ التنظيمي بهوية الشخص** (طلب المؤسس، نوفمبر 2026 — «شخصٌ واحد = هويةٌ واحدة = ملفٌّ أساسيٌّ واحد»).
 *
 *  **السببُ الجذري للتكرار في الهيكل السابق (`orgChart`)** أنه يرسم **المقاعد** لا **الأشخاص**: عضوُ اللجنة يُرسم في قسمه وفي
 *  لجنته («يُرسَم في قسمه وفي لجنته أيضاً»)، وقائدُ اللجنة يُرسم قائداً ثم عضواً في قسمه؛ وقائدُ القسم الذي له عضويةٌ في لجنة
 *  يُطرح من اللجنة كلياً (طرحُ سجلّ ترشّحه التوأم) فتضيع العلاقة. فهنا يُبنى **الأشخاصُ أولاً** ثم المواضع:
 *
 *  1. **الهوية:** كلُّ حسابٍ إداري (`User`) وسجلِّ عضوية (`Member`) يُجمعان شخصاً واحداً **بالبريد** — وهو ما يصل السجلَّين
 *     التوأمين في هذه المنصة (الترقيةُ القيادية تُبقي سجلَّ الترشّح). لا بالاسم أبداً. والرقمُ الوظيفي يُتحقَّق به لا يُدمَج به:
 *     رقمٌ واحدٌ لبريدين مختلفين **تعارضٌ يُسجَّل للمراجعة** ولا يُدمَج الشخصان.
 *  2. **الأدوار:** كلُّ ارتباطٍ مسجَّل يصير دوراً للشخص — مؤسس، تنفيذي، تشغيل، منصبٌ في الإدارة العليا، قيادةُ قسم، قيادةُ لجنة،
 *     نيابة، عضويةُ لجنة، عضويةُ قسم. ولا دورَ يُخترع: لا علاقةَ تبعيةٍ تُفترض ما لم تكن مسجَّلة.
 *  3. **الموضعُ الأساسي واحد:** أعلى الأدوار رتبةً — فيه وحده تُرسم بطاقتُه وصورتُه. وكلُّ دورٍ آخر **إشارةٌ** إلى ملفّه
 *     (لا بطاقةٌ ثانية ولا صورةٌ ثانية)، ويبقى محفوظاً في `roles`.
 *
 *  ويُبنى في كل قراءةٍ من البيانات المسجَّلة (لا جدولَ له): إضافةُ شخصٍ، تغييرُ قائد، أرشفةُ لجنة، إنهاءُ عضوية — كلُّها تظهر
 *  في القراءة التالية. ولا يحمل بريداً ولا جوّالاً: الهيكلُ يُعرض لكل الأعضاء. */

export type OrgRoleKind =
  | "founder"
  | "ceo"
  | "operations"
  | "senior_position"
  | "department_lead"
  | "committee_lead"
  | "deputy"
  | "committee_member"
  | "department_member";

/** الرتبةُ تحدّد الموضعَ الأساسي: الأصغرُ أعلى */
const RANK: Record<OrgRoleKind, number> = {
  founder: 0,
  ceo: 1,
  operations: 2,
  senior_position: 3,
  department_lead: 4,
  committee_lead: 5,
  deputy: 6,
  committee_member: 7,
  department_member: 8,
};

export type OrgRole = {
  kind: OrgRoleKind;
  /** «قائدة قسم التسويق»، «منسّق المحتوى» */
  label: string;
  unitId: string | null;
  unitName: string | null;
};

export type OrgPersonView = {
  key: string;
  name: string;
  /** مسمّى الموضع الأساسي */
  title: string;
  unitName: string | null;
  etid: string | null;
  portrait: Portrait;
  /** كلُّ ارتباطاته — الأساسيُّ أولاً */
  roles: OrgRole[];
  isViewer: boolean;
};

export type OrgCommitteeView = {
  id: string;
  name: string;
  parentId: string;
  parentName: string;
  /** `awaiting_lead` تُرسم بمقعد قائدٍ شاغر؛ و`null` لجنةٌ من النظام الأول */
  status: string | null;
  description: string | null;
  leadKey: string | null;
  /** القائدُ ملفُّه الأساسيُّ في موضعٍ آخر — يُرسم إشارةً لا بطاقة */
  leadIsReference: boolean;
  /** أعضاءُ موضعُهم الأساسيُّ هذه اللجنة (خلا القائد) */
  memberKeys: string[];
  /** أعضاءٌ فيها وموضعُهم الأساسيُّ في غيرها — إشاراتٌ إلى ملفّاتهم */
  referenceKeys: string[];
  /** مسؤوليةُ كلِّ عضوٍ داخل اللجنة («منسّق المحتوى») */
  responsibilities: Record<string, string>;
  memberCount: number;
};

export type OrgUnitView = {
  id: string;
  name: string;
  kind: "department" | "senior";
  description: string | null;
  leadKey: string | null;
  leadIsReference: boolean;
  /** قياداتٌ إضافيةٌ مسجَّلة للقسم نفسه — تعارضٌ يُسجَّل ولا يُخفى */
  coLeadKeys: string[];
  /** مسؤولو التشغيل المسجَّلون على هذا القسم (`User.departmentId`) */
  overseerKeys: string[];
  deputyKey: string | null;
  /** أعضاءُ موضعُهم الأساسيُّ القسمُ نفسُه (خارج لجانه) */
  memberKeys: string[];
  committees: OrgCommitteeView[];
  /** الأشخاصُ المختلفون في القسم ولجانه — يُعَدّ الشخصُ مرّةً */
  memberCount: number;
  committeeCount: number;
};

export type OrgIssue = { kind: string; detail: string };

export type OrgGraph = {
  people: Record<string, OrgPersonView>;
  founderKey: string | null;
  ceoKey: string | null;
  /** مسؤولو التشغيل — تابعون للتنفيذي في تصميم المنصة (كما في الهيكل السابق)، ومعهم قسمُهم إن سُجِّل */
  operations: { key: string; unitId: string | null }[];
  /** مؤسسٌ أو تنفيذيٌّ إضافيٌّ نشط — تعارضٌ يُعرض ويُسجَّل */
  extraLeaders: string[];
  senior: OrgUnitView | null;
  seniorPositions: { key: string; title: string; id: string }[];
  departments: OrgUnitView[];
  unassignedKeys: string[];
  issues: OrgIssue[];
  counts: { people: number; departments: number; committees: number };
};

const committeeNamed = (n: string) => (/^لجنة\s/.test(n.trim()) ? n.trim() : `لجنة ${n.trim()}`);

type Rec = {
  kind: "user" | "member";
  id: string;
  email: string;
  fullName: string;
  jobTitle: string | null;
  gender: MaybeGender;
  employeeNo: number | null;
  avatarVersion: Date | null;
};

export async function buildOrgGraph(opts: { viewer?: { id: string; role: string } | null; locale?: Locale } = {}): Promise<OrgGraph> {
  const locale = opts.locale ?? "ar";
  const PERSON = { id: true, email: true, fullName: true, jobTitle: true, gender: true, employeeNo: true, avatarVersion: true } as const;
  const [users, members, units, positions, erased] = await Promise.all([
    prisma.user.findMany({ where: { isActive: true }, select: { ...PERSON, role: true, departmentId: true, createdAt: true }, orderBy: { createdAt: "asc" } }),
    // المعتمَدون النشطون وحدهم: المرشّحُ لم يُعتمد، والخارجُ خرج — وسجلُّه التاريخيُّ باقٍ في موضعه لا في الهيكل
    prisma.member.findMany({
      // member-roster: all — يُضمّ سجلُّ ترشّح القائد إلى حسابه بالبريد (الهوية الواحدة) لا يُعرض شخصاً ثانياً
      where: { isActive: true, approvalStatus: "approved", terminatedAt: null },
      select: { ...PERSON, departmentId: true, invite: { select: { targetRole: true } } },
    }),
    prisma.department.findMany({
      // كما في الهيكل السابق: المفتوحةُ والمعتمدةُ بانتظار قائد — لا المقترحةُ ولا المردودةُ ولا المؤرشفة
      where: { OR: [...OPEN_DEPARTMENT_WHERE.OR, { committeeStatus: "awaiting_lead" as const }] },
      select: {
        id: true,
        name: true,
        leadershipOnly: true,
        parentId: true,
        committeeStatus: true,
        description: true,
        purpose: true,
        leadTitle: true,
        leadMemberId: true,
        // قيادةٌ بالخلافة (التنفيذيُّ ثم المؤسس) — علاقةٌ مسجَّلة تُرسم إشارةً إلى ملفّه الأساسي
        actingLeadUserId: true,
        deputyMemberId: true,
        committeeMemberships: { where: { active: true }, select: { memberId: true, responsibility: true }, orderBy: { addedAt: "asc" } },
      },
      orderBy: { name: "asc" },
    }),
    prisma.seniorPosition.findMany({ where: { status: "active" }, select: { id: true, titleAr: true, holderMemberId: true, holderUserId: true, departmentId: true }, orderBy: { createdAt: "asc" } }),
    leftoverLeaderIds(),
  ]);

  const issues: OrgIssue[] = [];

  // ═══ ١) الهوية: سجلّاتٌ تُجمع شخصاً واحداً بالبريد ═══
  const recs: Rec[] = [
    ...users.map((u) => ({ kind: "user" as const, id: u.id, email: u.email, fullName: u.fullName, jobTitle: u.jobTitle, gender: u.gender, employeeNo: u.employeeNo, avatarVersion: u.avatarVersion })),
    // سجلُّ ترشّحٍ بقي بعد حذف حساب قائده لا يُعرض (`leftoverLeaderIds`)، ولا سجلُّ ترشّحٍ قياديٍّ لا حسابَ نشطاً له
    ...members
      .filter((m) => !erased.has(m.id))
      .filter((m) => m.invite.targetRole === "member" || users.some((u) => u.email.toLowerCase() === m.email.toLowerCase()))
      .map((m) => ({ kind: "member" as const, id: m.id, email: m.email, fullName: m.fullName, jobTitle: m.jobTitle, gender: m.gender, employeeNo: m.employeeNo, avatarVersion: m.avatarVersion })),
  ];
  const byEmail = new Map<string, Rec[]>();
  for (const r of recs) {
    const k = r.email.trim().toLowerCase();
    byEmail.set(k, [...(byEmail.get(k) ?? []), r]);
  }
  const keyOfRec = new Map<string, string>(); // "user:<id>" | "member:<id>" → مفتاحُ الشخص
  type Person = { key: string; recs: Rec[]; roles: (OrgRole & { rank: number; order: number })[] };
  const persons = new Map<string, Person>();
  for (const group of byEmail.values()) {
    const u = group.find((r) => r.kind === "user");
    const key = u ? `u:${u.id}` : `m:${group[0].id}`;
    persons.set(key, { key, recs: group, roles: [] });
    for (const r of group) keyOfRec.set(`${r.kind}:${r.id}`, key);
  }
  // الرقمُ الوظيفي: يُتحقَّق به لا يُدمَج به
  const numOwners = new Map<number, Set<string>>();
  for (const p of persons.values()) {
    const nums = [...new Set(p.recs.map((r) => r.employeeNo).filter((n): n is number => n != null))];
    if (nums.length > 1) issues.push({ kind: "number_mismatch", detail: `سجلّا شخصٍ واحد بالبريد نفسه يحملان رقمين وظيفيين مختلفين (${nums.map((n) => employeeIdLabel(n)).join("، ")})` });
    for (const n of nums) numOwners.set(n, new Set([...(numOwners.get(n) ?? []), p.key]));
  }
  for (const [n, owners] of numOwners) {
    if (owners.size > 1) issues.push({ kind: "duplicate_number", detail: `الرقم الوظيفي ${employeeIdLabel(n)} مسجَّلٌ لأكثر من شخص (${owners.size}) — لم يُدمَجوا` });
  }

  const unitById = new Map(units.map((u) => [u.id, u]));
  const seniorRow = units.find((u) => u.leadershipOnly && !u.parentId) ?? null;
  let order = 0;
  const add = (recKey: string, kind: OrgRoleKind, label: string, unitId: string | null) => {
    const pk = keyOfRec.get(recKey);
    if (!pk) return null;
    const unit = unitId ? unitById.get(unitId) ?? null : null;
    persons.get(pk)!.roles.push({ kind, label, unitId: unit ? unit.id : null, unitName: unit ? unit.name : null, rank: RANK[kind], order: order++ });
    return pk;
  };
  const genderOf = (pk: string) => persons.get(pk)?.recs.map((r) => r.gender).find((g) => g) ?? null;
  const g = (recKey: string) => genderOf(keyOfRec.get(recKey) ?? "");

  // ═══ ٢) الأدوار — كلُّ ارتباطٍ مسجَّل، ولا شيءَ يُخترع ═══
  let founderKey: string | null = null;
  let ceoKey: string | null = null;
  const extraLeaders: string[] = [];
  const operations: { key: string; unitId: string | null }[] = [];
  const leadOf = new Map<string, string[]>(); // unitId → مفاتيح قادته المسجَّلين (حساباتٌ قيادية)
  const overseersOf = new Map<string, string[]>();
  for (const u of users) {
    const rk = `user:${u.id}`;
    if (u.role === "super_admin") {
      const pk = add(rk, "founder", roleTitle("super_admin", u.gender, null, locale), null)!;
      if (founderKey) {
        extraLeaders.push(pk);
        issues.push({ kind: "multiple_founders", detail: "أكثر من حسابٍ مؤسسٍ نشط" });
      } else founderKey = pk;
    } else if (u.role === "executive") {
      const pk = add(rk, "ceo", roleTitle("executive", u.gender, null, locale), null)!;
      if (ceoKey) {
        extraLeaders.push(pk);
        issues.push({ kind: "multiple_ceos", detail: "أكثر من رئيسٍ تنفيذيٍّ نشط" });
      } else ceoKey = pk;
    } else if (u.role === "operations_officer") {
      const unitId = u.departmentId && unitById.has(u.departmentId) ? u.departmentId : null;
      const pk = add(rk, "operations", u.jobTitle?.trim() || roleTitle("operations_officer", u.gender, null, locale), unitId)!;
      operations.push({ key: pk, unitId });
      if (unitId) overseersOf.set(unitId, [...(overseersOf.get(unitId) ?? []), pk]);
    } else if (u.role === "department_admin") {
      const unit = u.departmentId ? unitById.get(u.departmentId) : null;
      if (!unit) {
        add(rk, "department_member", roleTitle("department_admin", u.gender, null, locale), null);
        issues.push({ kind: "lead_without_unit", detail: `${u.fullName}: حسابُ قيادةٍ بلا قسمٍ مفتوح` });
        continue;
      }
      // حسابٌ قياديٌّ على لجنة (النظامُ الأول) يُعامل قيادةَ لجنة
      const kind: OrgRoleKind = unit.parentId ? "committee_lead" : "department_lead";
      const label = unit.parentId ? `${gx(u.gender, "قائد", "قائدة", "قيادة")} ${committeeNamed(unit.name)}` : roleTitle("department_admin", u.gender, unit.name, locale);
      const pk = add(rk, kind, label, unit.id)!;
      leadOf.set(unit.id, [...(leadOf.get(unit.id) ?? []), pk]);
    }
  }
  const membersOf = new Map<string, string[]>();
  for (const m of members) {
    const rk = `member:${m.id}`;
    if (!keyOfRec.has(rk)) continue;
    if (m.departmentId && unitById.has(m.departmentId)) {
      const unit = unitById.get(m.departmentId)!;
      const label = m.jobTitle?.trim() || gx(m.gender, "عضو", "عضوة");
      const pk = add(rk, unit.parentId ? "committee_member" : "department_member", label, unit.id)!;
      membersOf.set(unit.id, [...(membersOf.get(unit.id) ?? []), pk]);
    } else if (m.departmentId) {
      issues.push({ kind: "closed_unit", detail: `${m.fullName}: مسجَّلٌ في وحدةٍ غير مفتوحة (مؤرشفة أو مقترحة) — يُعرض بلا قسم` });
    }
  }
  const responsibilities = new Map<string, Record<string, string>>();
  for (const unit of units) {
    if (unit.deputyMemberId && !unit.parentId) {
      const rk = `member:${unit.deputyMemberId}`;
      add(rk, "deputy", `${gx(g(rk), "نائب", "نائبة")} ${roleTitle("department_admin", "male", unit.name, locale)}`, unit.id);
    }
    if (unit.parentId && unit.leadMemberId) {
      const rk = `member:${unit.leadMemberId}`;
      const pk = add(rk, "committee_lead", unit.leadTitle?.trim() || `${gx(g(rk), "قائد", "قائدة", "قيادة")} ${committeeNamed(unit.name)}`, unit.id);
      if (pk) leadOf.set(unit.id, [pk, ...(leadOf.get(unit.id) ?? []).filter((k) => k !== pk)]);
    }
    if (unit.parentId && unit.actingLeadUserId) {
      const rk = `user:${unit.actingLeadUserId}`;
      const pk = add(rk, "committee_lead", `${gx(g(rk), "قائد", "قائدة", "قيادة")} ${committeeNamed(unit.name)} بالإنابة`, unit.id);
      if (pk) leadOf.set(unit.id, [pk, ...(leadOf.get(unit.id) ?? []).filter((k) => k !== pk)]);
    }
    for (const cm of unit.committeeMemberships) {
      const rk = `member:${cm.memberId}`;
      const pk = add(rk, "committee_member", cm.responsibility?.trim() || gx(g(rk), "عضو اللجنة", "عضوة اللجنة"), unit.id);
      if (!pk) continue;
      membersOf.set(unit.id, [...(membersOf.get(unit.id) ?? []), pk]);
      if (cm.responsibility?.trim()) responsibilities.set(unit.id, { ...(responsibilities.get(unit.id) ?? {}), [pk]: cm.responsibility.trim() });
    }
  }
  const seniorPositions: { key: string; title: string; id: string }[] = [];
  for (const sp of positions) {
    const rk = sp.holderUserId ? `user:${sp.holderUserId}` : sp.holderMemberId ? `member:${sp.holderMemberId}` : null;
    const pk = rk ? add(rk, "senior_position", sp.titleAr, sp.departmentId) : null;
    if (pk) seniorPositions.push({ key: pk, title: sp.titleAr, id: sp.id });
  }

  // ═══ ٣) الموضعُ الأساسي: أعلى الأدوار رتبةً — وحده تُرسم فيه البطاقة ═══
  const primaryOf = new Map<string, OrgRole & { rank: number; order: number }>();
  const people: Record<string, OrgPersonView> = {};
  const viewerKey = opts.viewer ? keyOfRec.get(`${opts.viewer.role === "member" ? "member" : "user"}:${opts.viewer.id}`) ?? null : null;
  for (const p of persons.values()) {
    if (p.roles.length === 0) continue;
    // تُرتَّب الأدوار: الأعلى رتبةً، ثم الأسبقُ تسجيلاً — وتُطرح الأدوارُ المكرَّرة (عضويةُ لجنةٍ من قسمه ومن عضويته معاً)
    const seen = new Set<string>();
    const roles = p.roles
      .sort((a, b) => a.rank - b.rank || a.order - b.order)
      .filter((r) => {
        const k = `${r.kind}|${r.unitId}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    p.roles = roles;
    const primary = roles[0];
    primaryOf.set(p.key, primary);
    const user = p.recs.find((r) => r.kind === "user");
    const member = p.recs.find((r) => r.kind === "member");
    const nameRec = user ?? member!;
    const photoRec = p.recs.find((r) => r.avatarVersion);
    const photo = photoRec ? avatarUrl(photoRec.kind, photoRec.id, photoRec.avatarVersion) : null;
    const num = user?.employeeNo ?? member?.employeeNo ?? null;
    people[p.key] = {
      key: p.key,
      name: nameRec.fullName,
      title: primary.label,
      unitName: primary.unitName,
      etid: employeeIdLabel(num),
      portrait: resolvePortrait(photo, genderOf(p.key), nameRec.fullName),
      roles: roles.map(({ kind, label, unitId, unitName }) => ({ kind, label, unitId, unitName })),
      isViewer: p.key === viewerKey,
    };
  }
  const isPrimaryAt = (pk: string, kind: OrgRoleKind, unitId: string | null) => {
    const pr = primaryOf.get(pk);
    return !!pr && pr.kind === kind && pr.unitId === unitId;
  };
  const byName = (a: string, b: string) => (people[a]?.name ?? "").localeCompare(people[b]?.name ?? "", "ar");
  const uniq = (xs: string[]) => [...new Set(xs)];

  // ═══ ٤) الوحدات: القسمُ ولجانُه — كلُّ شخصٍ بطاقةٌ في موضعه الأساسي، وإشارةٌ فيما سواه ═══
  const committeeView = (c: (typeof units)[number]): OrgCommitteeView => {
    const leads = leadOf.get(c.id) ?? [];
    const leadKey = leads[0] ?? null;
    if (leads.length > 1) issues.push({ kind: "multiple_leads", detail: `${committeeNamed(c.name)}: أكثرُ من قائدٍ مسجَّل` });
    const all = uniq(membersOf.get(c.id) ?? []).filter((k) => k !== leadKey);
    return {
      id: c.id,
      name: c.name,
      parentId: c.parentId!,
      parentName: unitById.get(c.parentId!)?.name ?? "",
      status: c.committeeStatus,
      description: c.purpose?.trim() || c.description?.trim() || null,
      leadKey,
      leadIsReference: !!leadKey && !isPrimaryAt(leadKey, primaryOf.get(leadKey)!.kind, c.id),
      memberKeys: all.filter((k) => primaryOf.get(k)?.unitId === c.id).sort(byName),
      referenceKeys: all.filter((k) => primaryOf.get(k)?.unitId !== c.id).sort(byName),
      responsibilities: responsibilities.get(c.id) ?? {},
      memberCount: uniq([...(leadKey ? [leadKey] : []), ...all]).length,
    };
  };
  const unitView = (d: (typeof units)[number], kind: "department" | "senior"): OrgUnitView => {
    const leads = leadOf.get(d.id) ?? [];
    const leadKey = leads[0] ?? null;
    if (leads.length > 1) issues.push({ kind: "multiple_leads", detail: `قسم ${d.name}: أكثرُ من قائدٍ مسجَّل` });
    const committees = units.filter((c) => c.parentId === d.id).map(committeeView);
    const deputyPk = d.deputyMemberId ? keyOfRec.get(`member:${d.deputyMemberId}`) ?? null : null;
    const deputyKey = deputyPk && isPrimaryAt(deputyPk, "deputy", d.id) ? deputyPk : null;
    const own = uniq(membersOf.get(d.id) ?? []).filter((k) => k !== leadKey && k !== deputyKey);
    const everyone = uniq([
      ...leads,
      ...(deputyPk ? [deputyPk] : []),
      ...own,
      ...committees.flatMap((c) => [...(c.leadKey ? [c.leadKey] : []), ...c.memberKeys, ...c.referenceKeys]),
    ]);
    return {
      id: d.id,
      name: d.name,
      kind,
      description: d.purpose?.trim() || d.description?.trim() || null,
      leadKey,
      leadIsReference: !!leadKey && primaryOf.get(leadKey)?.unitId !== d.id,
      coLeadKeys: leads.slice(1),
      overseerKeys: overseersOf.get(d.id) ?? [],
      deputyKey,
      // من موضعُه الأساسيُّ عضويةُ هذا القسم وحده — من في لجنةٍ منه يُرسم في لجنته
      memberKeys: own.filter((k) => isPrimaryAt(k, "department_member", d.id)).sort(byName),
      committees,
      memberCount: everyone.length,
      committeeCount: committees.length,
    };
  };
  const roots = units.filter((u) => !u.parentId);
  const senior = seniorRow ? unitView(seniorRow, "senior") : null;
  const departments = roots.filter((u) => u.id !== seniorRow?.id).map((u) => unitView(u, "department"));
  // لجنةٌ أبوها غيرُ مفتوح: لا تُسقَط صامتة
  for (const c of units.filter((u) => u.parentId && !unitById.has(u.parentId))) {
    issues.push({ kind: "orphan_committee", detail: `${committeeNamed(c.name)}: قسمُها الأصيل غير مفتوح` });
  }
  // بلا موضع: من لا دورَ له في وحدةٍ مفتوحة
  const unassignedKeys = Object.keys(people)
    .filter((k) => people[k].roles.every((r) => r.kind === "department_member" && !r.unitId))
    .sort(byName);
  for (const p of persons.values()) {
    if (p.roles.length === 0 && p.recs.some((r) => r.kind === "member")) {
      const m = p.recs.find((r) => r.kind === "member")!;
      const view: OrgPersonView = {
        key: p.key,
        name: m.fullName,
        title: m.jobTitle?.trim() || gx(m.gender, "عضو", "عضوة"),
        unitName: null,
        etid: employeeIdLabel(m.employeeNo),
        portrait: resolvePortrait(m.avatarVersion ? avatarUrl("member", m.id, m.avatarVersion) : null, m.gender, m.fullName),
        roles: [],
        isViewer: p.key === viewerKey,
      };
      people[p.key] = view;
      unassignedKeys.push(p.key);
    }
  }

  if (issues.length) console.warn(`[org] ${issues.length} حالةً تحتاج مراجعة في بيانات الهيكل: ${issues.map((i) => i.kind).join(", ")}`);
  return {
    people,
    founderKey,
    ceoKey,
    operations,
    extraLeaders,
    senior,
    seniorPositions,
    departments,
    unassignedKeys: uniq(unassignedKeys),
    issues,
    counts: {
      people: Object.keys(people).length,
      departments: departments.length,
      committees: units.filter((u) => u.parentId).length,
    },
  };
}
