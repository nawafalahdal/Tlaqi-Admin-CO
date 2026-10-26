import { prisma } from "@/lib/prisma";
import { BRAND } from "@/lib/brand";
import { accountRoleLabel } from "@/lib/testTracks";
import { getDictionary, type Dictionary, type Locale } from "@/i18n";
import { fmt } from "@/i18n/fmt";
import { OPEN_DEPARTMENT_WHERE } from "@/lib/committees";
import { avatarUrl } from "@/lib/avatarUrl";
import { ROSTER_MEMBER_WHERE } from "@/lib/roster";
import { leftoverLeaderIds } from "@/lib/leftoverLeaders";

/** الهيكل التنظيمي — يُستخرَج ولا يُحرَّر.
 *
 *  **لا جدول له ولا حقلَ ترتيب.** وهذا قرارٌ لا سهو: الهيكل لو كان
 *  جدولاً لصار نسخةً ثانية من الحقيقة تحتاج مزامنة — فيُعتمد عضوٌ
 *  ويبقى الهيكل على حاله، أو يُنقل قسمٌ ويُنسى صفُّه. فلا يُخزَّن:
 *  يُحسَب في كل قراءة من المناصب والأقسام المسجَّلة.
 *
 *  **ومنعُ التحرير اليدوي ليس إخفاءَ أزرار.** لا توجد دالّة تكتب ترتيباً
 *  ولا تبعيةً ولا موضعَ بطاقة، ولا عمودٌ يحملها في القاعدة. فمن استطاع
 *  نداءَ أيِّ إجراءٍ في المنصة لم يجد إجراءً يُحرّك بطاقةً — لأنه ليس
 *  موجوداً. وتبقى التغييرات من بابها: اعتماد عضو، تصنيفه، تغيير منصبه،
 *  إنهاء عضويته — والهيكل يتبعها في القراءة التالية.
 *
 *  **والبطاقة تحمل أربعة فقط:** الصورة والاسم والمسمّى والقسم. ولا بريد
 *  ولا جوّال: الهيكل يُعرَض لكل الأعضاء، وعرضُ بُرُد الجميع على الجميع
 *  نشرٌ لبياناتهم لا تنظيمٌ لهيكل.
 */

export type OrgPerson = {
  id: string;
  fullName: string;
  /** المسمّى الوظيفي إن سُجِّل، وإلا فاسم الصفة */
  title: string;
  /** القسم أو المسؤولية — يُعرض حين يُوضّح شيئاً زائداً على المسمّى */
  scope: string | null;
  /** رابطُ صورته، أو `null` إن لم يرفع — ولا تُحمَل الصورةُ في الصفحة */
  avatarUrl: string | null;
};

/** مقعدٌ في الهيكل: إمّا شاغلُه أو إعلانُ شغوره.
 *
 *  والشاغر يُعلَن شاغراً ولا يُسنَد إلى أحد. ولو حُذف من الهيكل لقُرئ
 *  الهيكل كاملاً وهو ناقصٌ منصباً. */
export type OrgSeat =
  | { kind: "filled"; person: OrgPerson }
  | { kind: "vacant"; title: string };

export type OrgDepartment = {
  id: string;
  name: string;
  colorHex: string;
  /** لونُ العرض المعتمد لهذا القسم في الهيكل */
  displayColor: string;
  leadershipOnly: boolean;
  /** قائد القسم — أو إعلانُ شغور المنصب */
  lead: OrgSeat;
  members: OrgPerson[];
  /** لجانُه المعتمدة — فروعٌ داخله لا أقساماً بجانبه.
   *
   *  واللجنة تُرسَم **داخل** إطار أبيها بلونها هي: فيُقرأ أنها منه لا
   *  أنها قسمٌ ثالث. والمقترحةُ لم تُعتمد لا تدخل الهيكل أصلاً —
   *  `OPEN_DEPARTMENT_WHERE` يَحجبها من القراءة. */
  committees: OrgDepartment[];
  /** لجنةٌ لا قسمٌ أصيل — يُكتب على ترويستها «لجنة» */
  isCommittee: boolean;
};

/** اكتمالُ الهيكل — شرطُ تنزيله نسخةً رسمية.
 *
 *  الهيكل الناقص وثيقةٌ تكذب: تُنزَّل وتُعمَّم فتقول عن المنظمة أقلَّ
 *  مما فيها، أو تُظهر قسماً بقائدٍ وحيدٍ كأنه فريق. فالتنزيل يُمنَع حتى
 *  يكتمل، والمانعُ يُسمّى بعينه لا يُقال «غير مكتمل».
 */
export type OrgReadiness = {
  ready: boolean;
  /** ما ينقص — جملةٌ لكل نقص، تُعرَض كما هي */
  blockers: string[];
};

export type OrgChart = {
  founder: OrgSeat;
  ceo: OrgSeat;
  /** المناصب الإدارية التابعة للتنفيذي — مسؤول التشغيل ومن مثله */
  underCeo: OrgSeat[];
  /** الإدارة العليا — قسمٌ استثنائيٌّ موضعُه **مع** المؤسس والتنفيذي لا
   *  صفّاً مكرّراً تحت الأقسام. فهو ليس فرعاً من فروع العمل، بل الطبقةُ
   *  التي تعلوها جميعاً. */
  senior: OrgDepartment | null;
  departments: OrgDepartment[];
  /** معتمدون في المنصة بلا قسم — يُعرضون ولا يُخفَون */
  unassigned: OrgPerson[];
  counts: { people: number; departments: number; committees: number; vacancies: number };
  readiness: OrgReadiness;
};

/** أقلُّ عددٍ من الأعضاء في القسم **خلا قائده**.
 *
 *  قسمٌ بقائدٍ وعضوٍ واحد ليس فريقاً، والهيكل الذي يُنزَّل رسمياً يقول
 *  إنه كذلك. والعدد قرارُ صاحب المنصة لا اجتهاد. */
export const MIN_DEPARTMENT_MEMBERS = 2;

/** أقلُّ عددٍ في اللجنة خلا قائدها.
 *
 *  واللجنة ليست قسماً في هذا الحدّ: القسمُ فريقُ عملٍ دائم، واللجنةُ
 *  تُنشأ لعملٍ بعينه وقد تكون قائداً وعضواً. فلو طُبِّق عليها حدُّ
 *  القسم لمنعت كلُّ لجنةٍ جديدة تنزيلَ الهيكل الرسمي يومَ فتحها —
 *  ولصار الحدُّ عقوبةً على التنظيم لا حرصاً عليه.
 *
 *  أما القائدُ فلازم: لجنةٌ بلا قائدٍ مقعدٌ شاغرٌ في وثيقةٍ رسمية. */
export const MIN_COMMITTEE_MEMBERS = 1;

/** ألوان العرض — مرتبطةٌ بالمستوى والقسم لا تُختار عشوائياً.
 *
 *  والمفتاح اسمُ القسم كما هو في القاعدة. ومن لم يُذكَر هنا يأخذ لونَه
 *  المسجَّل في سجلّه — فالقسم الجديد يدخل الهيكل بلونه من يوم إنشائه
 *  بلا تعديلٍ في الكود.
 */
export const ORG_SENIOR_COLOR = "#1A0E1C";

const DEPARTMENT_DISPLAY: Record<string, string> = {
  "الإدارة العليا": ORG_SENIOR_COLOR,
  "التسويق": "#C34900",
  "الموارد البشرية": "#FFFFFF",
  "التقنية": BRAND.greenSheen,
};

export function departmentDisplayColor(name: string, fallbackHex: string): string {
  return DEPARTMENT_DISPLAY[name.trim()] ?? fallbackHex;
}

/** حدٌّ يُرى للألوان الفاتحة جداً.
 *
 *  **عطبٌ رأيتُه مرسوماً:** «الموارد البشرية» لونُها الأبيض، فشريطُ
 *  بطاقتها الأبيض على سطحٍ أبيض لم يُرَ، وحدُّ ترويسة قسمها كذلك —
 *  فبدا القسم بلا لونٍ أصلاً.
 *
 *  والطلب كان صريحاً: «الأبيض **مع حدود وتفاصيل واضحة تضمن التباين**».
 *  فالأبيض يبقى لونَه، ويُحمَل بحدٍّ رماديٍّ داكن يُرسمه — فيُقرأ
 *  أبيضَ مقصوداً لا لوناً ناقصاً.
 *
 *  والعتبة تُحسَب لا تُسمّى: أيُّ لونٍ فاتحٍ يُضاف لقسمٍ جديد يأخذ
 *  الحدَّ من تلقائه. */
export function needsOutline(hex: string): boolean {
  const h = hex.replace("#", "");
  if (h.length !== 6) return false;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  // الإضاءة المُدرَكة — المعادلة نفسها المستعملة في `readableTextOn`
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.88;
}

/** حدُّ العرض: اللون نفسه، أو رماديٌّ داكن إن كان اللون لا يُرى */
export function outlineFor(hex: string): string {
  return needsOutline(hex) ? "#B9BFA8" : hex;
}

function personFromUser(u: {
  id: string;
  fullName: string;
  jobTitle: string | null;
  role: string;
  avatarVersion: Date | null;
  department?: { name: string } | null;
}, locale: Locale): OrgPerson {
  const roleLabel = accountRoleLabel(u.role, locale);
  const title = u.jobTitle?.trim() || roleLabel;
  // القسم يُعرض حين يُضيف: «قائدة التسويق» لا تحتاج أن يُقال بعدها
  // «التسويق»، أما «أخصائية» فتحتاج
  const deptName = u.department?.name ?? null;
  const scope = deptName && !title.includes(deptName) ? deptName : null;
  return { id: u.id, fullName: u.fullName, title, scope, avatarUrl: avatarUrl("user", u.id, u.avatarVersion) };
}

function personFromMember(m: {
  id: string;
  fullName: string;
  jobTitle: string | null;
  avatarVersion: Date | null;
  department?: { name: string } | null;
}, T: Dictionary["libOrgChart"]): OrgPerson {
  const title = m.jobTitle?.trim() || T.member;
  const deptName = m.department?.name ?? null;
  const scope = deptName && !title.includes(deptName) ? deptName : null;
  return { id: m.id, fullName: m.fullName, title, scope, avatarUrl: avatarUrl("member", m.id, m.avatarVersion) };
}

const USER_SELECT = {
  id: true,
  fullName: true,
  jobTitle: true,
  role: true,
  // الختمُ لا البيانات: الصورةُ تُطلَب من مسارها، فلا تُحمَل في الاستعلام
  avatarVersion: true,
  department: { select: { name: true } },
} as const;

const MEMBER_SELECT = {
  id: true,
  fullName: true,
  // البريد يُقرأ ليُطرَح التوأم القيادي، ولا يُعرَض في البطاقة
  email: true,
  jobTitle: true,
  avatarVersion: true,
  department: { select: { name: true } },
} as const;

/** موانعُ اللجان — تُجمَع في العمق كلِّه لا في الطبقة الأولى وحدها.
 *
 *  فلجنةٌ فرعيةٌ بلا قائدٍ مقعدٌ شاغرٌ كغيره، وإخفاؤه لأنه في الطبقة
 *  الثانية يُنزِّل ورقةً تقول «لا مقاعد شاغرة» وفيها مقعد. */
function collectCommitteeBlockers(dept: OrgDepartment, blockers: string[], T: Dictionary["libOrgChart"]) {
  for (const c of dept.committees) {
    if (c.lead.kind !== "filled") {
      blockers.push(fmt(T.committeeNoLead, c.name, dept.name));
    }
    if (c.members.length < MIN_COMMITTEE_MEMBERS) {
      blockers.push(fmt(T.committeeFewMembers, c.name, c.members.length, MIN_COMMITTEE_MEMBERS));
    }
    collectCommitteeBlockers(c, blockers, T);
  }
}

/** يبني الهيكل من الحقيقة المسجَّلة. والعربيةُ افتراضاً: النسخةُ الرسمية تُكتب بها. */
export async function buildOrgChart(locale: Locale = "ar"): Promise<OrgChart> {
  const T = getDictionary(locale).libOrgChart;
  /** بُرُد أصحاب الحسابات الإدارية النشطة.
   *
   *  **والسبب عطبٌ رأيتُه مرسوماً:** من رُقِّي إلى قائدٍ يبقى له سجلُّ
   *  ترشّحه (`Member`) إلى جانب حسابه الإداري (`User`) — هكذا بُنيت
   *  المنصة، والسجلّ يُحفظ ولا يُهدَر. فكان الهيكل يَعرضه مرّتين: مرّةً
   *  قائداً للقسم، ومرّةً عضواً فيه أو في «غير المصنّفين». ورأيتُ بندر
   *  التقني قائداً وعضواً في بطاقتين، والمؤسس والتنفيذي في قائمة غير
   *  المصنّفين.
   *
   *  وبطاقتُه القيادية هي التي تُمثّله، فيُطرَح سجلُّ ترشّحه من العرض.
   *  والوصلُ بالبريد لأنه هو ما يربط السجلَّين في هذه المنصة. */
  const leadershipEmails = new Set(
    (
      await prisma.user.findMany({
        where: { isActive: true },
        select: { email: true },
      })
    ).map((u) => u.email.toLowerCase())
  );
  // وقائدٌ حُذف حسابُه وبقي سجلُّ ترشّحه (قبل أن يصير الحذفُ للسجلَّين) لا يُعرَض عضواً:
  // كان يظهر في قسمه كأنه ما زال في الفريق. ومن أُعيدت دعوتُه لا يدخل في هذا.
  const erased = await leftoverLeaderIds();
  const notAlreadyShown = (m: { id: string; email: string }) =>
    !leadershipEmails.has(m.email.toLowerCase()) && !erased.has(m.id);

  const [founder, ceo, opsOfficers, deptRows] = await Promise.all([
    prisma.user.findFirst({
      where: { role: "super_admin", isActive: true },
      select: USER_SELECT,
      orderBy: { createdAt: "asc" },
    }),
    prisma.user.findFirst({
      where: { role: "executive", isActive: true },
      select: USER_SELECT,
      orderBy: { createdAt: "asc" },
    }),
    prisma.user.findMany({
      where: { role: "operations_officer", isActive: true },
      select: USER_SELECT,
      orderBy: { fullName: "asc" },
    }),
    prisma.department.findMany({
      // اللجنةُ المقترحةُ أو المردودة لا تدخل الهيكل: الاقتراحُ ليس فتحاً
      where: OPEN_DEPARTMENT_WHERE,
      orderBy: [{ leadershipOnly: "desc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        colorHex: true,
        leadershipOnly: true,
        parentId: true,
        committeeStatus: true,
        admins: {
          where: { isActive: true, role: "department_admin" },
          select: USER_SELECT,
          orderBy: { createdAt: "asc" },
        },
        members: {
          // الهيكل يَعرض من هو في الفريق الآن: المعتمَد النشط.
          // والمرشّح لم يُعتمد بعد، والخارج خرج — وظهورُ أحدهما يقول
          // عن المنظمة ما ليس فيها.
          // member-roster: all — سجلُّ ترشّح القائد يُطرح في الذاكرة: من له حسابٌ
          // نشط (`notAlreadyShown`)، ومن حُذف حسابُه (`leftoverLeaderIds`)
          where: { isActive: true, approvalStatus: "approved" },
          select: MEMBER_SELECT,
          orderBy: { fullName: "asc" },
        },
      },
    }),
  ]);

  const unassignedMembers = await prisma.member.findMany({
    where: { ...ROSTER_MEMBER_WHERE, departmentId: null },
    select: MEMBER_SELECT,
    orderBy: { fullName: "asc" },
  });

  let vacancies = 0;

  // المؤسس والتنفيذي من الإدارة العليا بدورهما (`seniorAffiliation`) — فبطاقتاهما
  // تحملان اسمَها ولو لم يُسجَّل لهما قسم
  const seniorName = deptRows.find((d) => d.leadershipOnly && !d.parentId)?.name ?? "الإدارة العليا";
  const asSenior = (p: OrgPerson): OrgPerson => ({
    ...p,
    scope: p.title.includes(seniorName) ? null : seniorName,
  });

  const founderSeat: OrgSeat = founder
    ? { kind: "filled", person: asSenior(personFromUser(founder, locale)) }
    : ((vacancies++, { kind: "vacant", title: T.vacantFounder }) as OrgSeat);

  const ceoSeat: OrgSeat = ceo
    ? { kind: "filled", person: asSenior(personFromUser(ceo, locale)) }
    : ((vacancies++, { kind: "vacant", title: T.vacantCeo }) as OrgSeat);

  // مسؤول التشغيل: يُعرَض شاغراً إن لم يُعيَّن — منصبٌ معتمدٌ في المنصة
  const underCeo: OrgSeat[] =
    opsOfficers.length > 0
      ? opsOfficers.map((u) => ({ kind: "filled", person: personFromUser(u, locale) }))
      : [{ kind: "vacant", title: T.vacantOps }];
  if (opsOfficers.length === 0) vacancies++;

  const flat: OrgDepartment[] = deptRows.map((d) => {
    const leadRow = d.admins[0];
    const isCommittee = Boolean(d.parentId);
    const lead: OrgSeat = leadRow
      ? { kind: "filled", person: personFromUser(leadRow, locale) }
      : { kind: "vacant", title: fmt(isCommittee ? T.vacantCommitteeLead : T.vacantDeptLead, d.name) };
    // الإدارةُ العليا يرأسها المؤسس والتنفيذي — لا مقعدَ «قائدٍ» لها يُعَدّ شاغراً
    if (!leadRow && !(d.leadershipOnly && !d.parentId)) vacancies++;
    return {
      id: d.id,
      name: d.name,
      colorHex: d.colorHex,
      displayColor: departmentDisplayColor(d.name, d.colorHex),
      leadershipOnly: d.leadershipOnly,
      lead,
      members: d.members.filter(notAlreadyShown).map((m) => personFromMember(m, T)),
      committees: [],
      isCommittee,
    };
  });

  /** الوصلُ: كلُّ لجنةٍ تُعلَّق في أبيها، فتُرسَم داخله لا بجانبه.
   *
   *  ولجنةٌ ضاع أبوها من القراءة (حالٌ لا تقع: الأبُ قسمٌ أصيل أو لجنةٌ
   *  معتمدة، وكلاهما مقروء) تبقى جذراً فتُرى — ولا تُسقَط صامتةً. */
  const byId = new Map(flat.map((d) => [d.id, d]));
  const roots: OrgDepartment[] = [];
  for (const row of deptRows) {
    const node = byId.get(row.id)!;
    const parent = row.parentId ? byId.get(row.parentId) : null;
    if (parent) {
      // **لونُ اللجنة لونُ قسمها** — يُشتقّ هنا لا يُقرأ من صفّها: فإن
      // غُيّر لونُ القسم تبعته لجانُه في القراءة التالية بلا إجراء.
      // وتمييزُها بشكلها لا بلونها: إطارٌ متقطّعٌ ووسمُ «لجنة».
      node.displayColor = parent.displayColor;
      parent.committees.push(node);
    } else roots.push(node);
  }
  const departments = roots;

  const people =
    (founder ? 1 : 0) +
    (ceo ? 1 : 0) +
    opsOfficers.length +
    flat.reduce((n, d) => n + (d.lead.kind === "filled" ? 1 : 0) + d.members.length, 0) +
    unassignedMembers.filter(notAlreadyShown).length;

  // الإدارة العليا تُرفَع إلى أعلى ولا تُكرَّر تحت الأقسام: هي الطبقة
  // التي تعلو الفروع لا فرعٌ بينها. وكان عرضُها صفّاً بين الأقسام
  // يُقرأ خطأً — قسمٌ كالتسويق والتقنية، وهي ليست كذلك.
  const senior = departments.find((d) => d.leadershipOnly) ?? null;
  const branches = departments.filter((d) => !d.leadershipOnly);

  const unassignedShown = unassignedMembers.filter(notAlreadyShown).map((m) => personFromMember(m, T));

  const blockers: string[] = [];
  if (founderSeat.kind !== "filled") blockers.push(T.founderVacant);
  if (ceoSeat.kind !== "filled") blockers.push(T.ceoVacant);
  if (branches.length === 0) blockers.push(T.noBranches);
  for (const d of branches) {
    // الاسمُ بين قوسين لا بسابقةِ «قسم»: أسماءُ بعض الأقسام تبدأ بها
    // فيُقرأ «قسم قسم التسويق»
    if (d.lead.kind !== "filled") blockers.push(fmt(T.noLead, d.name));
    if (d.members.length < MIN_DEPARTMENT_MEMBERS) {
      blockers.push(fmt(T.fewMembers, d.name, d.members.length, MIN_DEPARTMENT_MEMBERS));
    }
    collectCommitteeBlockers(d, blockers, T);
  }
  // ومسؤولو التشغيل منها: لا تُعَدّ خاليةً وفيها مسؤولُ تشغيلٍ معيَّن
  const opsFilled = underCeo.some((seat) => seat.kind === "filled");
  if (senior && senior.members.length === 0 && senior.lead.kind !== "filled" && !opsFilled) {
    blockers.push(T.seniorEmpty);
  }
  // وأيُّ مقعدٍ شاغرٍ يمنع: الورقة الرسمية تقول في تذييلها «لا مقاعد
  // شاغرة»، وكانت تقولها بينما يظهر فيها مقعدٌ شاغر — وثيقةٌ تُناقض
  // نفسها. فإمّا أن يُملأ المقعد أو لا تُنزَّل النسخة.
  for (const seat of underCeo) {
    if (seat.kind === "vacant") blockers.push(fmt(T.seatVacant, seat.title));
  }
  if (unassignedShown.length > 0) {
    blockers.push(`${unassignedShown.length} عضواً غير مصنّفٍ في قسم`);
  }

  return {
    founder: founderSeat,
    ceo: ceoSeat,
    underCeo,
    senior,
    departments: branches,
    unassigned: unassignedShown,
    counts: {
      people,
      departments: branches.length,
      // اللجانُ تُعَدّ وحدها: ليست أقساماً تُجمَع إليها، ولا تُخفى
      committees: flat.filter((d) => d.isCommittee).length,
      vacancies,
    },
    readiness: { ready: blockers.length === 0, blockers },
  };
}
