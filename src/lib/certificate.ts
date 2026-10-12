import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { BRAND, themeFromColor } from "@/lib/brand";
import { accountRoleLabel } from "@/lib/testTracks";
import { formatDate } from "@/lib/format";

/** شهادة الشكر والتقدير — آخر ما يحمله معه من مرّ بالفريق.
 *
 *  ليست ملفاً يُصمَّم يدوياً لكل خارج: لونها لون قسمه، ونصّها مبنيّ على
 *  مهمته واسمه، ومدّتها من يوم انضمامه إلى يوم انتهائه. فتُصدر نفسها
 *  متى اكتملت الشروط، ولا تنتظر أن يتفرّغ أحد لتصميمها.
 */

/** المدّة من الانضمام إلى الانتهاء — ركن الشهادة الذي لا تصحّ بدونه */
export type CertificatePeriod = { start: Date; end: Date };

export type CertificateSigner = {
  /** الصفة: «قائد قسم التسويق»، «المؤسس»، «المدير التنفيذي» */
  title: string;
  name: string;
};

export type CertificateData = {
  memberId: string;
  fullName: string;
  /** المهمة كما حدّدتها الإدارة الداعية */
  mission: string | null;
  departmentName: string | null;
  roleLabel: string;
  isLead: boolean;
  period: CertificatePeriod;
  colorHex: string;
  /** يُوقّعها اثنان: صاحب الجهة التي عمل تحتها، ومن يمثّل المنصة */
  signers: [CertificateSigner, CertificateSigner];
};

/** رابط الشهادة موقَّع، فيصل بالبريد ويُفتح بلا تسجيل دخول.
 *
 *  صاحب الشهادة خرج من الفريق، فحسابه مُعطَّل ولا يستطيع الدخول ليقرأها.
 *  وجعلها مفتوحة بالمعرّف وحده يعني أن يُخمَّن معرّفُ غيره فتُقرأ شهادته.
 *  فالتوقيع يربط الرابط بصاحبه: لا يُفتح إلا بما وُقِّع له. */
function certificateSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET غير مضبوط — لا يمكن توقيع رابط الشهادة");
  return secret;
}

export function signCertificateToken(memberId: string): string {
  const mac = crypto
    .createHmac("sha256", certificateSecret())
    .update(`certificate:${memberId}`)
    .digest("base64url");
  return `${memberId}.${mac}`;
}

export function verifyCertificateToken(token: string): string | null {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const memberId = token.slice(0, dot);
  const expected = signCertificateToken(memberId);
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  // المقارنة ثابتة الزمن: المقارنة العادية تُسرّب طول البادئة الصحيحة
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return memberId;
}

export function certificateUrl(memberId: string, base: string): string {
  return `${base}/certificate/${signCertificateToken(memberId)}`;
}

/** نصّ الشهادة — يتبدّل بالمهمة والصفة لا بالاسم وحده.
 *
 *  وصيغته محايدة في التذكير والتأنيث عمداً: المنصة لا تسجّل جنس أحد،
 *  وتخمينُه من الاسم يُخطئ ويُسيء. فيُخاطَب الجميع بما يصحّ للجميع. */
export function certificateBody(data: CertificateData): string {
  const dept = data.departmentName?.trim() || null;
  const mission = data.mission?.trim() || null;

  // المهمة كثيراً ما تحمل اسم القسم في نصّها («تطوير سياسات الموارد
  // البشرية»)، فإلحاق القسم بها يكرّره: «... في الموارد البشرية».
  // فلا يُلحَق إلا إذا لم يُذكر أصلاً.
  const missionNamesDept = Boolean(dept && mission && mission.includes(dept));
  const where = dept ? `في ${dept}` : "في تَـــلاقِ";

  const contribution = data.isLead
    ? `على القيادة الاستثنائية ${dept ? `لـ${dept}` : "داخل الفريق"}`
    : mission
      ? missionNamesDept
        ? `على ${mission}`
        : `على ${mission} ${where}`
      : `على الإسهام ${where}`;

  return [
    `كلمات الثناء لا توفي حقّه، تتقدّم «تَـــلاقِ» بخالص الشكر إلى ${data.fullName}`,
    `${contribution} (${formatDate(data.period.start)} — ${formatDate(data.period.end)}).`,
    "إسهاماته القيّمة صنعت أثراً بالغاً في مسيرتنا،",
    "ونتمنّى له مستقبلاً حافلاً بالإنجازات.",
  ].join(" ");
}

/** يجمع كل ما تحتاجه الشهادة من القاعدة.
 *
 *  يرجع null لمن لم تُسلَّم شهادته بعد: الشهادة أثرُ خطوةٍ في الحوكمة لا
 *  صفحةٌ تُفتح متى شئنا، وإصدارها قبل أوانها يُفرغ الخطوة من معناها. */
export async function certificateFor(memberId: string): Promise<CertificateData | null> {
  const member = await prisma.member.findUnique({
    where: { id: memberId },
    include: { department: true, invite: true },
  });
  if (!member) return null;
  if (!member.certificateIssuedAt) return null;

  const isLead = member.invite.targetRole !== "member";
  const colorHex = member.department?.colorHex ?? BRAND.temptress;

  // الموقّعان: من يمثّل جهته، ومن يمثّل المنصة. فإن كان قائداً أو من
  // الإدارة العليا وقّعها المؤسس والتنفيذي — لأن لا قسم فوقه يوقّع له.
  const [founder, executive, deptLead] = await Promise.all([
    prisma.user.findFirst({ where: { role: "super_admin", isActive: true } }),
    prisma.user.findFirst({ where: { role: "executive", isActive: true } }),
    member.departmentId
      ? prisma.user.findFirst({
          where: { role: "department_admin", departmentId: member.departmentId, isActive: true },
        })
      : null,
  ]);

  const founderSigner: CertificateSigner = {
    title: "المؤسس",
    name: founder?.fullName ?? "—",
  };
  const executiveSigner: CertificateSigner = {
    title: "المدير التنفيذي",
    name: executive?.fullName ?? "—",
  };
  const leadSigner: CertificateSigner = {
    title: member.department ? `قائد ${member.department.name}` : "قائد القسم",
    name: deptLead?.fullName ?? "—",
  };

  const signers: [CertificateSigner, CertificateSigner] =
    isLead || !deptLead ? [founderSigner, executiveSigner] : [leadSigner, executiveSigner];

  return {
    memberId: member.id,
    fullName: member.fullName,
    mission: member.jobTitle,
    departmentName: member.department?.name ?? null,
    roleLabel: accountRoleLabel(member.invite.targetRole),
    isLead,
    period: {
      start: member.decidedAt ?? member.joinDate,
      // تاريخ الانتهاء المتّفق عليه، وإلا فيوم التنحي، وإلا فاليوم
      end: member.endDate ?? member.stepDownAt ?? member.terminatedAt ?? new Date(),
    },
    colorHex,
    signers,
  };
}

/** ألوان الشهادة مشتقّة من لون القسم نفسه.
 *
 *  فلا تُكتب أربعة ألوان في الكود ثم يُضاف قسمٌ خامس بلا لون. والبيج
 *  فاتح فيُكتب عليه بالداكن، وغيره داكن فيُكتب عليه بالفاتح — يحسمها
 *  `themeFromColor` بالتباين لا بقائمة استثناءات. */
export function certificatePalette(colorHex: string) {
  const theme = themeFromColor(colorHex);
  const onLight = theme.text === BRAND.ink;
  return {
    background: colorHex,
    ink: theme.text,
    muted: onLight ? "rgba(26,16,35,0.70)" : "rgba(238,246,223,0.78)",
    rule: onLight ? "rgba(26,16,35,0.35)" : "rgba(238,246,223,0.45)",
    // الزخرفة العضوية: أفتح قليلاً من الخلفية على الداكن، وأغمق على الفاتح
    ornament: onLight ? "rgba(26,16,35,0.07)" : "rgba(255,255,255,0.10)",
    accent: onLight ? BRAND.mahogany : "rgba(238,246,223,0.92)",
  };
}
