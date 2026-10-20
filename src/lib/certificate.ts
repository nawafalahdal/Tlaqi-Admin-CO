import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { BRAND, themeFromColor } from "@/lib/brand";
import { accountRoleLabel } from "@/lib/testTracks";
import { gx, roleTitle, type MaybeGender } from "@/lib/gender";

/** شهادة الشكر والتقدير — آخر ما يحمله معه من مرّ بالفريق.
 *
 *  ليست ملفاً يُصمَّم يدوياً لكل خارج: لونها لون قسمه، ونصّها مبنيّ على
 *  مهمته واسمه، ومدّتها من يوم انضمامه إلى يوم انتهائه. فتُصدر نفسها
 *  متى اكتملت الشروط، ولا تنتظر أن يتفرّغ أحد لتصميمها.
 */

/** المدّة من الانضمام إلى الانتهاء — ركن الشهادة الذي لا تصحّ بدونه */
export type CertificatePeriod = { start: Date; end: Date };

export type CertificateSigner = {
  /** الصفة بجنس صاحبها: «قائدة قسم التسويق»، «المؤسس»، «الرئيس التنفيذي» */
  title: string;
  name: string;
  /** توقيعه المعتمَد — `null` إن لم يُعتمد له توقيع بعد.
   *
   *  ولا يُستعار توقيعُ من سبقه في المنصب: الشهادة تحمل توقيع من عمل
   *  صاحبُها تحته فعلاً، أو لا توقيع — ولا توقيعاً منتحلاً. */
  signatureImage: string | null;
};

export type CertificateData = {
  memberId: string;
  kind: CertificateKind;
  fullName: string;
  /** جنسُ صاحبها — لصيغة النصّ وحدها، ولا يُخمَّن إن لم يُختر */
  gender: MaybeGender;
  /** ما يُكتب تحت الاسم: المسمّى، أو الصفة لمن يقود */
  personTitle: string;
  /** المهمة كما حدّدتها الإدارة الداعية */
  mission: string | null;
  departmentName: string | null;
  roleLabel: string;
  isLead: boolean;
  period: CertificatePeriod;
  colorHex: string;
  /** يُوقّعها اثنان: صاحب الجهة التي عمل تحتها، ومن يمثّل المنصة */
  signers: [CertificateSigner, CertificateSigner];
  /** هل صدرت بتوقيعٍ ناقص؟ يُعرَض للإدارة ويُسجَّل — فلا تصدر «صامتةً»
   *  وكأنها موقَّعة. والاسم والصفة يبقيان: نسبةٌ لا انتحال. */
  missingSignatures: string[];
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

/** نوع الشهادة: ختامُ مسيرةٍ أم تقديرُ ثلاثة أشهر.
 *
 *  الاثنتان بالتصميم نفسه ولون القسم نفسه — فهما من منظّمةٍ واحدة —
 *  لكن نصّهما ومناسبتهما مختلفان، ولا تحلّ إحداهما محلّ الأخرى. */
export type CertificateKind = "final" | "appreciation";

/** الرسالة الموقَّعة. و«final» تُوقَّع بصيغتها القديمة بلا بادئة نوع:
 *  روابطُ شهاداتٍ صدرت ووصلت بريدَ أصحابها، وتغيير الصيغة يُبطلها. */
function tokenMessage(memberId: string, kind: CertificateKind): string {
  return kind === "final" ? `certificate:${memberId}` : `certificate:${kind}:${memberId}`;
}

export function signCertificateToken(memberId: string, kind: CertificateKind = "final"): string {
  const mac = crypto
    .createHmac("sha256", certificateSecret())
    .update(tokenMessage(memberId, kind))
    .digest("base64url");
  return kind === "final" ? `${memberId}.${mac}` : `${kind}.${memberId}.${mac}`;
}

export function verifyCertificateToken(
  token: string
): { memberId: string; kind: CertificateKind } | null {
  // النوع في مقدّمة الرابط، فلا يُقرأ تقديرُ أحدٍ على أنه ختامُ مسيرته
  const kind: CertificateKind = token.startsWith("appreciation.") ? "appreciation" : "final";
  const rest = kind === "final" ? token : token.slice("appreciation.".length);

  const dot = rest.lastIndexOf(".");
  if (dot <= 0) return null;
  const memberId = rest.slice(0, dot);
  const expected = signCertificateToken(memberId, kind);
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  // المقارنة ثابتة الزمن: المقارنة العادية تُسرّب طول البادئة الصحيحة
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return { memberId, kind };
}

export function certificateUrl(
  memberId: string,
  base: string,
  kind: CertificateKind = "final"
): string {
  return `${base}/certificate/${signCertificateToken(memberId, kind)}`;
}

/** نصّ الشهادة — جملةٌ واحدة تُقرأ بعد الاسم، بجنس صاحبها.
 *
 *  كانت فقرةً واحدةً يُدفَن فيها الاسم، وبالمذكّر للجميع («على إكماله»)،
 *  وتقول لكلّ قائدٍ «القيادة الاستثنائية لـالتسويق». فصار الاسمُ بطلَ
 *  الورقة وحده، وتحته صفتُه، ثم جملةُ التقدير بصيغته — ومن لم يختر
 *  جنسه تُكتب له بالمصدر: «تقديراً للعطاء» لا «لعطائه».
 *
 *  ولا يُنسَب إليه إنجازٌ بعينه: المنصة تعرف المدّة ولا تعرف ما صُنع
 *  فيها، واختراعُ إنجازٍ يُفرغ التقدير من صدقه. */
export function certificateBody(data: CertificateData): string {
  const G = (m: string, f: string, n: string) => gx(data.gender, m, f, n);
  if (data.kind === "appreciation") {
    return `تقديراً ${G("لعطائه", "لعطائها", "للعطاء")} خلال ثلاثة أشهرٍ من العمل والتعلّم، ${G("وإسهامه", "وإسهامها", "والإسهام")} في بناء ما نطمح إليه معاً.`;
  }
  const wish = G("ونتمنّى له", "ونتمنّى لها", "ونتمنّى");
  return `تقديراً لما ${G("قدّمه", "قدّمته", "قُدِّم")} خلال ${G("مسيرته", "مسيرتها", "المسيرة")} معنا، ${G("وإسهامه", "وإسهامها", "والإسهام")} في بناء ما نطمح إليه معاً — ${wish} مستقبلاً حافلاً بالإنجازات.`;
}

/** عنوان الشهادة — المناسبة تُقرأ من أعلى الورقة لا من نصّها.
 *
 *  نوعان بتصميمين: شهادةُ الشكر والخبرة تختم المسيرة (لونُ القسم كاملاً)،
 *  وشهادةُ التقدير تُكرّم محطّةً في مسيرةٍ جارية (ورقٌ وشريطٌ بلون القسم). */
export function certificateHeading(kind: CertificateKind): { ar: string; en: string } {
  return kind === "appreciation"
    ? { ar: "شهادة تقدير — ثلاثة أشهر", en: "Certificate of Appreciation" }
    : { ar: "شهادة شكر وخبرة", en: "Certificate of Appreciation & Experience" };
}

/** يجمع كل ما تحتاجه الشهادة من القاعدة.
 *
 *  يرجع null لمن لم تُسلَّم شهادته بعد: الشهادة أثرُ خطوةٍ في الحوكمة لا
 *  صفحةٌ تُفتح متى شئنا، وإصدارها قبل أوانها يُفرغ الخطوة من معناها. */
export async function certificateFor(
  memberId: string,
  kind: CertificateKind = "final"
): Promise<CertificateData | null> {
  const member = await prisma.member.findUnique({
    where: { id: memberId },
    include: { department: true, invite: true },
  });
  if (!member) return null;
  // كلُّ نوعٍ ختمُه: ولا يُفتح نوعٌ بختم الآخر
  const issuedAt = kind === "appreciation" ? member.appreciationIssuedAt : member.certificateIssuedAt;
  if (!issuedAt) return null;

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

  // التوقيع يُقرأ بالشخص لا بالمنصب — ولو قُرئ بالمنصب لعاد توقيع من سبقه
  const { approvedSignatureFor } = await import("@/lib/signatures");
  const [founderSig, execSig, leadSig] = await Promise.all([
    founder ? approvedSignatureFor(founder.id) : null,
    executive ? approvedSignatureFor(executive.id) : null,
    deptLead ? approvedSignatureFor(deptLead.id) : null,
  ]);

  // الصفة بجنس الموقِّع نفسه: «الرئيسة التنفيذية» لا «المدير التنفيذي»
  const founderSigner: CertificateSigner = {
    title: roleTitle("super_admin", founder?.gender),
    name: founder?.fullName ?? "—",
    signatureImage: founderSig,
  };
  const executiveSigner: CertificateSigner = {
    title: roleTitle("executive", executive?.gender),
    name: executive?.fullName ?? "—",
    signatureImage: execSig,
  };
  const leadSigner: CertificateSigner = {
    title: roleTitle("department_admin", deptLead?.gender, member.department?.name),
    name: deptLead?.fullName ?? "—",
    signatureImage: leadSig,
  };

  const signers: [CertificateSigner, CertificateSigner] =
    isLead || !deptLead ? [founderSigner, executiveSigner] : [leadSigner, executiveSigner];

  const missingSignatures = signers
    .filter((sg) => !sg.signatureImage)
    .map((sg) => `${sg.title}${sg.name !== "—" ? ` (${sg.name})` : ""}`);

  return {
    memberId: member.id,
    kind,
    fullName: member.fullName,
    gender: member.gender,
    // القائد تُكتب صفتُه («قائدة قسم التسويق»)، وغيره مسمّاه، ثم صفتُه
    personTitle: isLead
      ? roleTitle(member.invite.targetRole, member.gender, member.department?.name)
      : member.jobTitle?.trim() || roleTitle("member", member.gender),
    mission: member.jobTitle,
    departmentName: member.department?.name ?? null,
    roleLabel: accountRoleLabel(member.invite.targetRole),
    isLead,
    period: {
      // شهادة التقدير تُكرّم مدّة التكليف، وشهادة الختام تُوثّق المسيرة
      // كلّها — فتبدأ من الانضمام التنظيمي إن كان مُسجَّلاً.
      start:
        kind === "appreciation"
          ? (member.decidedAt ?? member.joinDate)
          : (member.orgJoinDate ?? member.decidedAt ?? member.joinDate),
      // شهادة التقدير تُصدَر في موعد الاستحقاق ومسيرتُه جارية، فنهايتها
      // يوم استحقاقها لا «اليوم»: من أُرسلت له متأخّرةً تبقى بتاريخها.
      end:
        kind === "appreciation"
          ? (member.appreciationDueAt ?? issuedAt)
          : (member.endDate ?? member.stepDownAt ?? member.terminatedAt ?? new Date()),
    },
    colorHex,
    signers,
    missingSignatures,
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
