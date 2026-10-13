import { prisma } from "@/lib/prisma";
import { BRAND } from "@/lib/brand";
import { accountRoleLabel } from "@/lib/testTracks";

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
  avatarData: string | null;
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
};

export type OrgChart = {
  founder: OrgSeat;
  ceo: OrgSeat;
  /** المناصب الإدارية التابعة للتنفيذي — مسؤول التشغيل ومن مثله */
  underCeo: OrgSeat[];
  departments: OrgDepartment[];
  /** معتمدون في المنصة بلا قسم — يُعرضون ولا يُخفَون */
  unassigned: OrgPerson[];
  counts: { people: number; departments: number; vacancies: number };
};

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
  avatarData: string | null;
  department?: { name: string } | null;
}): OrgPerson {
  const roleLabel = accountRoleLabel(u.role);
  const title = u.jobTitle?.trim() || roleLabel;
  // القسم يُعرض حين يُضيف: «قائدة التسويق» لا تحتاج أن يُقال بعدها
  // «التسويق»، أما «أخصائية» فتحتاج
  const deptName = u.department?.name ?? null;
  const scope = deptName && !title.includes(deptName) ? deptName : null;
  return { id: u.id, fullName: u.fullName, title, scope, avatarData: u.avatarData };
}

function personFromMember(m: {
  id: string;
  fullName: string;
  jobTitle: string | null;
  avatarData: string | null;
  department?: { name: string } | null;
}): OrgPerson {
  const title = m.jobTitle?.trim() || "عضو";
  const deptName = m.department?.name ?? null;
  const scope = deptName && !title.includes(deptName) ? deptName : null;
  return { id: m.id, fullName: m.fullName, title, scope, avatarData: m.avatarData };
}

const USER_SELECT = {
  id: true,
  fullName: true,
  jobTitle: true,
  role: true,
  avatarData: true,
  department: { select: { name: true } },
} as const;

const MEMBER_SELECT = {
  id: true,
  fullName: true,
  // البريد يُقرأ ليُطرَح التوأم القيادي، ولا يُعرَض في البطاقة
  email: true,
  jobTitle: true,
  avatarData: true,
  department: { select: { name: true } },
} as const;

/** يبني الهيكل من الحقيقة المسجَّلة. */
export async function buildOrgChart(): Promise<OrgChart> {
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
  const notAlreadyShown = (m: { email: string }) =>
    !leadershipEmails.has(m.email.toLowerCase());

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
      orderBy: [{ leadershipOnly: "desc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        colorHex: true,
        leadershipOnly: true,
        admins: {
          where: { isActive: true, role: "department_admin" },
          select: USER_SELECT,
          orderBy: { createdAt: "asc" },
        },
        members: {
          // الهيكل يَعرض من هو في الفريق الآن: المعتمَد النشط.
          // والمرشّح لم يُعتمد بعد، والخارج خرج — وظهورُ أحدهما يقول
          // عن المنظمة ما ليس فيها.
          where: { isActive: true, approvalStatus: "approved" },
          select: MEMBER_SELECT,
          orderBy: { fullName: "asc" },
        },
      },
    }),
  ]);

  const unassignedMembers = await prisma.member.findMany({
    where: { isActive: true, approvalStatus: "approved", departmentId: null },
    select: MEMBER_SELECT,
    orderBy: { fullName: "asc" },
  });

  let vacancies = 0;

  const founderSeat: OrgSeat = founder
    ? { kind: "filled", person: personFromUser(founder) }
    : ((vacancies++, { kind: "vacant", title: "المؤسس" }) as OrgSeat);

  const ceoSeat: OrgSeat = ceo
    ? { kind: "filled", person: personFromUser(ceo) }
    : ((vacancies++, { kind: "vacant", title: "الرئيس التنفيذي" }) as OrgSeat);

  // مسؤول التشغيل: يُعرَض شاغراً إن لم يُعيَّن — منصبٌ معتمدٌ في المنصة
  const underCeo: OrgSeat[] =
    opsOfficers.length > 0
      ? opsOfficers.map((u) => ({ kind: "filled", person: personFromUser(u) }))
      : [{ kind: "vacant", title: "مسؤول التشغيل" }];
  if (opsOfficers.length === 0) vacancies++;

  const departments: OrgDepartment[] = deptRows.map((d) => {
    const leadRow = d.admins[0];
    const lead: OrgSeat = leadRow
      ? { kind: "filled", person: personFromUser(leadRow) }
      : { kind: "vacant", title: `قائد ${d.name}` };
    if (!leadRow) vacancies++;
    return {
      id: d.id,
      name: d.name,
      colorHex: d.colorHex,
      displayColor: departmentDisplayColor(d.name, d.colorHex),
      leadershipOnly: d.leadershipOnly,
      lead,
      members: d.members.filter(notAlreadyShown).map(personFromMember),
    };
  });

  const people =
    (founder ? 1 : 0) +
    (ceo ? 1 : 0) +
    opsOfficers.length +
    departments.reduce((n, d) => n + (d.lead.kind === "filled" ? 1 : 0) + d.members.length, 0) +
    unassignedMembers.filter(notAlreadyShown).length;

  return {
    founder: founderSeat,
    ceo: ceoSeat,
    underCeo,
    departments,
    unassigned: unassignedMembers.filter(notAlreadyShown).map(personFromMember),
    counts: { people, departments: departments.length, vacancies },
  };
}
