import { createHash } from "node:crypto";
import { captureEmails, type CapturedEmail } from "@/lib/emailCapture";
import { renderEmail } from "@/lib/emailBrand";
import { renderEmail2026 } from "@/lib/brand2026/email";
import { COLORS, TYPEFACE, ROLE, STATES, PATTERNS, LOGOS, ICONS, LETTER_MARKS, BRAND_VERSION } from "@/lib/brand2026/tokens";

/** **سجلُّ عناصر الهوية للمراجعة** — كلُّ عنصرٍ: ما هو، وأين يُستعمل، وبأي ألوانٍ وخطوط، وكيف تُرسم معاينتُه،
 *  وبصمتُها. والبصمةُ تُحسب من مواصفة المعاينة نفسها (للبريد: HTML القالب الجديد بمتغيّراتٍ ثابتة)، فإن تغيّر
 *  العنصرُ بعد اعتماده تغيّرت بصمتُه ومُنع نشرُه حتى يُعاد اعتمادُه (`lib/brandReview`).
 *
 *  `implemented`: هل طُبّق العنصرُ في المنصة الحية؟ — لا يُنشر عنصرٌ لم يُطبَّق بعد اعتماده (المرحلة الخامسة). */

export type BrandItemKind = "identity" | "component" | "email" | "document";
export const KIND_LABEL: Record<BrandItemKind, string> = {
  identity: "عناصر الهوية",
  component: "مكوّنات الواجهة",
  email: "قوالب البريد",
  document: "المستندات والقوالب الرسمية",
};

type Def = {
  key: string;
  kind: BrandItemKind;
  titleAr: string;
  usage: string;
  colors: (keyof typeof COLORS)[];
  fonts: string[];
  /** مسائلُ مفتوحة من التدقيق تمسّ هذا العنصر (`docs/brand/BRAND-AUDIT.md`) */
  decisions?: string[];
  implemented: boolean;
  /** إصدارُ تصميم المعاينة — يُرفع حين يتغيّر التصميم فتتغيّر البصمة */
  design: number;
  email?: () => Promise<unknown>;
};

const F = TYPEFACE.family;
const ALL4: (keyof typeof COLORS)[] = ["beige", "temptress", "mahogany", "greenSheen"];
// متغيّراتٌ تجريبيةٌ ثابتة — لا بيانات أعضاءٍ حقيقيين، ولا تواريخ متغيّرة (فتثبت البصمة)
const D = new Date("2026-11-20T09:00:00+03:00");
const P = { to: "preview@example.test", fullName: "سارة أحمد", url: "https://tlaqiteam.site/" };

export const BRAND_ITEMS: Def[] = [
  { key: "identity.logo", kind: "identity", titleAr: "الشعار ونسخه حسب الخلفية", usage: "القائمة الجانبية، صفحة الدخول، ترويسة البريد وتذييله، الشهادات والمستندات", colors: ALL4, fonts: [], decisions: ["ق4 مساحة الأمان", "ق5 نسخة Green Sheen المشتقّة"], implemented: false, design: 1 },
  { key: "identity.colors", kind: "identity", titleAr: "الألوان الأربعة وأزواج التباين", usage: "كل الواجهات والبريد والمستندات", colors: ALL4, fonts: [], decisions: ["ق2 ألوان الحالات", "ق3 ألوان الأقسام", "ق9 الأزرار", "ق10 الحدود والمعطَّل"], implemented: false, design: 1 },
  { key: "identity.typography", kind: "identity", titleAr: "الخط المعتمد — The Year of The Camel", usage: "كل النصوص العربية والإنجليزية", colors: ["temptress", "beige", "mahogany"], fonts: [F], decisions: ["ق1 رخصة الخط", "ق8 الخط في البريد"], implemented: false, design: 1 },
  { key: "identity.patterns", kind: "identity", titleAr: "الأنماط: موهبة، ابتكار، ربط", usage: "أشرطة الترويسة، أغلفة التقارير والشهادات، البطاقات الكبيرة", colors: ["mahogany", "beige", "temptress"], fonts: [], implemented: false, design: 1 },
  { key: "identity.icons", kind: "identity", titleAr: "الأيقونات (30 أيقونة lucide)", usage: "القائمة الجانبية، البطاقات، الحالات", colors: ["temptress"], fonts: [], decisions: ["ق11 ما ليس في الحزمة"], implemented: false, design: 1 },
  { key: "identity.letters", kind: "identity", titleAr: "الحروف المختصرة T·L·A·Q·I", usage: "المساحات الصغيرة والإشارات المختصرة", colors: ["temptress", "beige"], fonts: [F], implemented: false, design: 1 },

  { key: "component.actions", kind: "component", titleAr: "الأزرار والنماذج والتحقق من المدخلات", usage: "كل النماذج: الدخول، الدعوات، اللجان، الإدارة العليا، الاتفاقيات", colors: ALL4, fonts: [F], decisions: ["ق9", "ق10"], implemented: false, design: 1 },
  { key: "component.surfaces", kind: "component", titleAr: "البطاقات والجداول والشارات", usage: "اللوحات، قوائم الأعضاء واللجان، التقارير، سجل الحوكمة", colors: ALL4, fonts: [F], decisions: ["ق3"], implemented: false, design: 1 },
  { key: "component.states", kind: "component", titleAr: "الحالات: التحميل، الفراغ، النجاح، الخطأ، التأكيد، التنبيهات، التلميحات", usage: "كل الصفحات", colors: ALL4, fonts: [F], decisions: ["ق2"], implemented: false, design: 1 },
  { key: "component.navigation", kind: "component", titleAr: "القائمة الجانبية والترويسة (فاتح وداكن)", usage: "كل صفحات مساحة العمل", colors: ALL4, fonts: [F], implemented: false, design: 1 },

  { key: "email.invitation", kind: "email", titleAr: "دعوة الانضمام (بيانات الدخول)", usage: "دعوة عضوٍ أو قائدٍ جديد", colors: ALL4, fonts: [F], decisions: ["ق7", "ق8"], implemented: false, design: 1,
    email: async () => (await import("@/lib/email")).sendCredentialsEmail({ ...P, tempPassword: "Tq-Preview-0000", loginUrl: P.url + "login", occasion: "invitation", departmentName: "التسويق", jobTitle: "صانعة محتوى", invitedByName: "الإدارة", hoursValid: 72 }) },
  { key: "email.login-code", kind: "email", titleAr: "رمز الدخول (التحقق)", usage: "كل تسجيل دخول", colors: ALL4, fonts: [F], implemented: false, design: 1,
    email: async () => (await import("@/lib/email")).sendLoginCodeEmail({ ...P, code: "482913", minutesValid: 10 }) },
  { key: "email.password-reset", kind: "email", titleAr: "استعادة كلمة المرور", usage: "صفحة «نسيت كلمة المرور»", colors: ALL4, fonts: [F], implemented: false, design: 1,
    email: async () => (await import("@/lib/email")).sendPasswordResetEmail({ ...P, resetUrl: P.url + "reset-password/preview", minutesValid: 30 }) },
  { key: "email.decision", kind: "email", titleAr: "قرار طلب (قبول / رد)", usage: "قرارات الاعتماد على التذاكر والطلبات", colors: ALL4, fonts: [F], implemented: false, design: 1,
    email: async () => (await import("@/lib/email")).sendApprovalDecisionEmail({ to: P.to, ticketNumber: 1042, subject: "طلب شهادة إنجاز", stateLabel: "اعتُمد", note: "اعتُمد الطلب وتُصدر الشهادة خلال يومين.", byName: "قائدة القسم", url: P.url }) },
  { key: "email.apology", kind: "email", titleAr: "رسالة اعتذار (لم يجتز التقييم)", usage: "نتيجة تقييم القبول", colors: ALL4, fonts: [F], implemented: false, design: 1,
    email: async () => (await import("@/lib/email")).sendTestFailedEmail({ ...P, score: 54, departmentName: "التقنية", dueDate: D }) },
  { key: "email.reminder", kind: "email", titleAr: "تذكير بموعد", usage: "تذكير التذاكر والمواعيد", colors: ALL4, fonts: [F], implemented: false, design: 1,
    email: async () => (await import("@/lib/email")).sendTicketReminderEmail({ to: P.to, subject: "تسليم خطة الحملة", memberName: P.fullName, stageLabel: "بانتظار التنفيذ", dueDate: D, fromName: "المنصة", portalUrl: P.url }) },
  { key: "email.internal-alert", kind: "email", titleAr: "تنبيه إداري داخلي (تذكرة جديدة)", usage: "تنبيهات الإدارة والفرق", colors: ALL4, fonts: [F], implemented: false, design: 1,
    email: async () => (await import("@/lib/email")).sendTicketCreatedEmail({ to: P.to, subject: "طلب صلاحية لأداة التصميم", description: "أحتاج صلاحية لملفات الهوية لتجهيز منشورات الحملة.", memberName: P.fullName, dueDate: D, portalUrl: P.url }) },
  { key: "email.committee-lead", kind: "email", titleAr: "تعيين قائد لجنة", usage: "دعوات القيادة في الإدارات واللجان", colors: ALL4, fonts: [F], implemented: false, design: 1,
    email: async () => (await import("@/lib/email")).sendCommitteeLeadAppointedEmail({ ...P, committeeName: "لجنة المحتوى الرقمي", parentName: "التسويق", appointedByName: "قائد القسم", url: P.url, appointedAt: D }) },
  { key: "email.committee-member", kind: "email", titleAr: "الانضمام إلى لجنة", usage: "إضافة عضوٍ إلى لجنة", colors: ALL4, fonts: [F], implemented: false, design: 1,
    email: async () => (await import("@/lib/email")).sendCommitteeMemberAddedEmail({ ...P, committeeName: "لجنة المحتوى الرقمي" }) },
  { key: "email.senior-invitation", kind: "email", titleAr: "دعوة الإدارة العليا", usage: "تكليفٌ بمنصبٍ في الإدارة العليا", colors: ALL4, fonts: [F], implemented: false, design: 1,
    email: async () => (await import("@/lib/email")).sendSeniorInvitationEmail({ to: P.to, fullName: P.fullName, titleAr: "المستشار القانوني", inviterName: "الرئيس التنفيذي", acceptUrl: P.url + "senior/invite/preview", expiresAt: D }) },
  { key: "email.agreement-request", kind: "email", titleAr: "طلب توقيع اتفاقية", usage: "اتفاقيتا التسويق والتقنية", colors: ALL4, fonts: [F], implemented: false, design: 1,
    email: async () => (await import("@/lib/email")).sendAgreementRequestEmail({ to: P.to, fullName: P.fullName, agreementTitle: "اتفاقية السرية وحماية أصول التسويق", signUrl: P.url + "agreements/marketing" }) },
  { key: "email.agreement-otp", kind: "email", titleAr: "رمز توقيع الاتفاقية", usage: "التحقق قبل التوقيع الإلكتروني", colors: ALL4, fonts: [F], implemented: false, design: 1,
    email: async () => (await import("@/lib/email")).sendAgreementOtpEmail({ to: P.to, fullName: P.fullName, agreementTitle: "اتفاقية السرية وحماية أصول التسويق", code: "730154", minutesValid: 10 }) },
  { key: "email.certificate", kind: "email", titleAr: "إصدار شهادة", usage: "الشهادات الصادرة من المنصة", colors: ALL4, fonts: [F], implemented: false, design: 1,
    email: async () => (await import("@/lib/email")).sendIssuedCertificateEmail({ ...P, heading: "شهادة إنجاز", sentence: "تشهد تلاق بإتمام سارة أحمد مهامّها في حملة الإطلاق بكفاءة.", number: "TLQ-2026-0042", departmentName: "التسويق", certificateUrl: P.url + "certificate/preview" }) },

  { key: "document.certificate", kind: "document", titleAr: "الشهادة الرسمية", usage: "صفحة الشهادة وتنزيلها", colors: ALL4, fonts: [F], implemented: false, design: 1 },
  { key: "document.agreement", kind: "document", titleAr: "النسخة الموقّعة من الاتفاقية", usage: "تنزيل الاتفاقية الموقّعة والتحقق منها", colors: ["beige", "temptress", "mahogany"], fonts: [F], implemented: false, design: 1 },
  { key: "document.report", kind: "document", titleAr: "غلاف التقارير ومحاضر الاجتماعات وتقارير اللجان", usage: "التقارير والمحاضر وورقة الهيكل", colors: ALL4, fonts: [F], implemented: false, design: 1 },
];

export const itemDef = (key: string) => BRAND_ITEMS.find((d) => d.key === key) ?? null;

export const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

/** **معاينةُ رسالة:** تُبنى بالدالة الحقيقية (بلا إرسال)، ثم تُرسم بالقالب الحالي والجديد */
export async function emailPreview(def: Def, assetBase: string, fontFaceBase: string | null) {
  if (!def.email) return null;
  const captured: CapturedEmail[] = await captureEmails(def.email);
  const m = captured[0];
  if (!m) return null;
  const current = renderEmail({ subject: m.subject, content: m.content, theme: m.theme, preheader: m.subject }).html;
  const next = renderEmail2026({ subject: m.subject, content: m.content, theme: m.theme, assetBase, fontFaceBase });
  return { subject: m.subject, kind: m.kind, current, next };
}

/** **بصمةُ العنصر** — للبريد: القالبُ الجديد بأصولٍ ثابتة؛ ولغيره: مواصفتُه ورموزُ التصميم التي يقرؤها */
export async function contentHashOf(def: Def): Promise<string> {
  if (def.email) {
    const p = await emailPreview(def, "/brand-assets", null);
    return sha256(JSON.stringify([def.key, def.design, p?.subject ?? "", p?.next ?? ""]));
  }
  const tokens = { COLORS, TYPEFACE, ROLE, STATES, PATTERNS, LOGOS, ICONS, LETTER_MARKS, BRAND_VERSION };
  return sha256(JSON.stringify([def.key, def.design, def.titleAr, def.usage, def.colors, def.fonts, tokens]));
}
