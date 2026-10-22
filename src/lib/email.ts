import { Resend } from "resend";
import { formatDate } from "@/lib/format";
import { appendEmailLog } from "@/lib/googleSheets";
import { prisma } from "@/lib/prisma";
import {
  renderEmail,
  htmlToText,
  variantForKind,
  toneForVariant,
  appBaseUrl,
  SOCIAL_HANDLE,
  BRAND_HASHTAG,
  type EmailContent,
  type EmailTheme,
} from "@/lib/emailBrand";
import { departmentBrand } from "@/lib/departmentBrand";
import { forms, gx, positionTitle, roleTitle, type MaybeGender } from "@/lib/gender";
import { emailAllowed, policyReason, type EmailEvent } from "@/lib/emailPolicy";
import { resultOf, type SendResult } from "@/lib/emailOutcome";
import { deploymentEnv, emailRecipientsAllowed } from "@/lib/deploymentEnv";

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const FROM = process.env.EMAIL_FROM || "تَـــلاقِ <hello@tlaqiteam.site>";

/** يهرّب أي نص قد يكون مُدخلاً من مستخدم (اسم، سبب تنبيه، موضوع تذكرة...) قبل
 *  دمجه داخل HTML البريد — يمنع حقن وسوم/روابط ضارة تُعرض في عميل البريد */
function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** كل إرسال يُسجَّل في تبويب "الرسائل المُرسَلة" — نجح أم لم ينجح. التسجيل
 *  لا يُفشل الإرسال أبداً: لو تعذّر الوصول للشيت يمضي البريد في طريقه. */
async function logEmail(
  recipients: string[],
  kind: string,
  subject: string,
  status:
    | "أُرسلت"
    | "لم تُرسل (البريد معطّل)"
    | "فشل الإرسال"
    | "لم تُرسل (سياسة التقليل)",
  /** جوابُ المزوّد — معرّفُ القبول أو سببُ الرفض بنصّه.
   *
   *  وبدونه كان السجلُّ يقول «فشل الإرسال» ولا يقول لماذا، وسجلُّ
   *  المنصة المستضيفة لا يُبقي شيئاً بعد ساعة — فيضيع الجوابُ الوحيد
   *  الذي يُفيد. */
  diag?: { providerId?: string | null; failureKind?: string; failureDetail?: string }
) {
  const at = new Date();
  // قاعدة البيانات أولاً لأنها مصدر صفحة "سجل الرسائل" داخل المنصة،
  // ثم الشيت نسخةً للمراجعة الخارجية. فشل أيٍّ منهما لا يُفشل الإرسال:
  // رسالة وصلت فعلاً ثم تعذّر تسجيلها تبقى واصلة.
  try {
    await prisma.emailLog.createMany({
      data: recipients.map((recipient) => ({
        recipient,
        kind,
        subject,
        status,
        createdAt: at,
        providerId: diag?.providerId ?? null,
        failureKind: diag?.failureKind ?? null,
        // مقصوصٌ: أثرٌ كاملٌ لا يُحفَظ في سجلٍّ يُقرأ في المنصة
        failureDetail: diag?.failureDetail ? diag.failureDetail.slice(0, 500) : null,
      })),
    });
  } catch (err) {
    console.error("تعذّر تسجيل البريد في قاعدة البيانات:", err);
  }
  try {
    await appendEmailLog({ to: recipients, kind, subject, status, at });
  } catch (err) {
    console.error("تعذّر تسجيل البريد في الشيت:", err);
  }
}

/** من أُغلقت تجربته لا يُراسَل بعدها أبداً.
 *
 *  الوعد قُطع في رسالة الوداع («هذه آخر رسالة تصلك»)، وحفظُه لا يصحّ أن
 *  يكون مسؤولية عشرين دالة إرسال: تُنسى في واحدة فيُخلَف الوعد. فيُفحص
 *  هنا، في المَخنَق الوحيد الذي تمرّ منه كل رسالة — إعلاناً كانت أو
 *  تنبيهاً أو رمز دخول.
 *
 *  والفشل لا يُسكِت البريد: لو تعذّر الوصول للقاعدة مضت الرسالة. منعُ
 *  كل بريد الفريق لأن استعلاماً تعثّر أسوأ من رسالة تصل من لا يريدها. */
/** يَمنع نوعاً كُتم بالسياسة — ويُسجّله مكتوماً لا مفقوداً.
 *
 *  الحدث يبقى في «سجل الرسائل» بسببه، فيُقرأ ما لم يُرسَل كما يُقرأ ما
 *  أُرسل. ولو قُطع السطر صامتاً لظنّ من يراجع أن الحدث لم يقع.
 */
async function suppressed(
  event: EmailEvent,
  to: string | string[],
  kind: string,
  subject: string
): Promise<(SendResult & { suppressed: true }) | null> {
  if (emailAllowed(event)) return null;
  const all = (Array.isArray(to) ? to : [to]).filter(Boolean);
  const why = policyReason(event);
  console.warn(`[email:policy] كُتم «${event}» — ${why}`);
  if (all.length > 0) await logEmail(all, kind, subject, "لم تُرسل (سياسة التقليل)");
  return { ...resultOf({ state: "suppressed_policy", why }), suppressed: true };
}

async function withoutClosedRecipients(recipients: string[]): Promise<string[]> {
  try {
    const closed = await prisma.member.findMany({
      where: { email: { in: recipients }, noFurtherEmail: true },
      select: { email: true },
    });
    if (closed.length === 0) return recipients;
    const blocked = new Set(closed.map((m) => m.email.toLowerCase()));
    return recipients.filter((r) => !blocked.has(r.toLowerCase()));
  } catch (err) {
    console.error("تعذّر فحص قائمة من أُغلقت تجربتهم:", err);
    return recipients;
  }
}

/** من يُراسَل — جنسُه ودورُه وقسمُه، من سجلّه هو.
 *
 *  كانت كلُّ رسالةٍ تُكتب بالمذكّر وبلا لون: الدالةُ لا تعرف إلا البريد.
 *  فصار البريدُ نفسُه مفتاحاً إلى سجلّ صاحبه، فيُخاطَب بجنسه ويأخذ
 *  الشريطُ والزرُّ لونَ قسمه — دون أن تحمل عشرون دالةً هذا العبء.
 *
 *  ولرسالةٍ لعدّة مستلمين (`to` مصفوفة) لا جنسَ واحداً ولا قسماً واحداً،
 *  فتُكتب بالصيغة المحايدة وبلون الهوية. والفشل لا يُسكِت البريد. */
type Recipient = {
  gender: MaybeGender;
  role: string | null;
  departmentName: string | null;
  colorHex: string | null;
};

const NO_RECIPIENT: Recipient = { gender: null, role: null, departmentName: null, colorHex: null };

async function recipientOf(to: string | string[]): Promise<Recipient> {
  const list = (Array.isArray(to) ? to : [to]).filter(Boolean);
  if (list.length !== 1) return NO_RECIPIENT;
  const email = { equals: list[0], mode: "insensitive" as const };
  try {
    const user = await prisma.user.findFirst({
      where: { email },
      select: { gender: true, role: true, department: { select: { name: true, colorHex: true } } },
    });
    if (user) {
      return {
        gender: user.gender,
        role: user.role,
        departmentName: user.department?.name ?? null,
        colorHex: user.department?.colorHex ?? null,
      };
    }
    const member = await prisma.member.findFirst({
      where: { email },
      select: {
        gender: true,
        invite: { select: { targetRole: true } },
        department: { select: { name: true, colorHex: true } },
      },
    });
    if (member) {
      return {
        gender: member.gender,
        role: member.invite.targetRole,
        departmentName: member.department?.name ?? null,
        colorHex: member.department?.colorHex ?? null,
      };
    }
  } catch (err) {
    console.error("تعذّر قراءة سجلّ المستلِم للمخاطبة:", err);
  }
  return NO_RECIPIENT;
}

function themeOf(r: Recipient): EmailTheme {
  return { departmentName: r.departmentName, colorHex: r.colorHex };
}

/** الاسم الأول — للعناوين القصيرة: «أهلاً بكِ في العائلة، سارة» */
function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] || fullName;
}

const portal = () => `${appBaseUrl()}/login`;

async function send(
  to: string | string[],
  subject: string,
  content: EmailContent,
  kind = "عام",
  /** لون القسم في الرسالة — من سجلّ المستلِم في الغالب */
  theme?: EmailTheme
) {
  const all = Array.isArray(to) ? to.filter(Boolean) : [to].filter(Boolean);
  if (all.length === 0) return resultOf({ state: "no_recipient" });

  // رسالة الوداع نفسها تمرّ قبل أن يُرفع العلم، فلا تحجب نفسها
  const open = await withoutClosedRecipients(all);
  if (open.length === 0) return resultOf({ state: "suppressed_closed" });

  // المعاينةُ لا تراسل أحداً إلا من سُمّي لها (`PREVIEW_EMAIL_ALLOWLIST`)، وبعنوانٍ يقول إنها معاينة
  const preview = deploymentEnv() === "preview";
  const recipients = emailRecipientsAllowed(open);
  if (preview) subject = `[معاينة] ${subject}`;
  if (recipients.length === 0) {
    console.warn(`[email:preview] حُجب بريدٌ بعنوان "${subject}" — لا مستلمَ في قائمة المعاينة`);
    await logEmail(open, kind, subject, "لم تُرسل (البريد معطّل)");
    return resultOf({ state: "provider_disabled" });
  }

  if (!resend) {
    // لا نطبع محتوى الرسالة كاملاً (قد يحمل كلمة مرور مؤقتة أو رابطاً حساساً) — فقط عنوانها ومستلمها
    console.warn(
      `[email:disabled] لم يُضبط RESEND_API_KEY — تم تجاهل إرسال بريد بعنوان "${subject}" إلى: ${recipients.join(", ")}`
    );
    await logEmail(recipients, kind, subject, "لم تُرسل (البريد معطّل)");
    return resultOf({ state: "provider_disabled" });
  }
  try {
    // الهوية تُضاف هنا لا في كل دالة: الدالةُ تصف ما حدث بنيةً، والقالبُ
    // الموحَّد يرسمها — فلا تتفرّق الهوية على ثلاثين دالة ولا تُنسى في واحدة.
    // والنبرةُ إن لم تحدّدها الرسالة تُشتقّ من وسم نوعها.
    const { html, bodyHtml } = renderEmail({
      subject,
      content: { ...content, tone: content.tone ?? toneForVariant(variantForKind(kind)) },
      theme,
      preheader: subject,
    });
    // Resend لا يرمي استثناءً عند رفض الـAPI: يرجع `{ data, error }`.
    // فكان كل رفضٍ — مفتاحٌ خاطئ، نطاقٌ غير موثّق، حدُّ إرسال، مستلمٌ
    // غير مقبول — يُسجَّل «أُرسلت» ويُقال لصاحب الشأن إنها وصلت. وهذا
    // أسوأ من الفشل: الفشلُ يُعاد، والفشلُ المكتوبُ نجاحاً لا يُعاد أبداً.
    const result = await resend.emails.send({
      from: FROM,
      to: recipients,
      subject,
      html,
      // النسخة النصّية ليست ترفاً: رسالة HTML بلا بديل نصّي علامةٌ معروفة
      // عند مرشّحات السبام، وتصل مشوّهة لمن يقرأ بالنص المجرّد
      text: htmlToText(bodyHtml),
      headers: {
        // يمنع تجميع الرسائل المتتابعة في خيط واحد عند Gmail
        "X-Entity-Ref-ID": `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      },
    });
    if (result.error) {
      const name = result.error.name ?? "خطأٌ غيرُ مسمّى";
      const message = result.error.message ?? "بلا نصّ";
      console.error("رفض Resend إرسال البريد:", result.error);
      await logEmail(recipients, kind, subject, "فشل الإرسال", {
        failureKind: name,
        failureDetail: message,
      });
      return resultOf({ state: "provider_rejected", name, message });
    }
    // المعرّفُ هو الدليلُ الوحيد على القبول — يُحفَظ ليُراجَع به عند
    // المزوّد نفسِه لو سُئل عن رسالةٍ بعد أسابيع
    const providerId = result.data?.id ?? null;
    await logEmail(recipients, kind, subject, "أُرسلت", { providerId });
    return resultOf({ state: "accepted", providerId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("فشل إرسال البريد:", err);
    await logEmail(recipients, kind, subject, "فشل الإرسال", {
      failureKind: "انقطاعٌ قبل بلوغ المزوّد",
      failureDetail: message,
    });
    return resultOf({ state: "transport_failed", message });
  }
}

/** بيانات الدخول — ولها مناسبتان لا مناسبة واحدة.
 *
 *  **الدعوة ليست ترحيباً.** المدعوّ لم يُعتمد بعد: أمامه اختبارٌ ثم قرارٌ
 *  قد يكون بالرفض. فرسالتُها إعلانُ دعوة — من دعاه، وإلى أين، وما
 *  خطواته — ومعها ملصقُ الدعوة باسمه ولون قسمه. والترحيبُ وبطاقةُ العضوية
 *  يصلان عند الاعتماد وحده.
 *
 *  **ولا جنسَ معروفاً للمدعوّ بعد** — لم يُسجِّل شيئاً. فيُسمّى الموقعُ لا
 *  صاحبه («قيادة قسم التقنية»)، وتُكتب الخطواتُ مصادرَ لا أوامر. */
export async function sendCredentialsEmail(opts: {
  to: string;
  fullName: string;
  tempPassword: string;
  loginUrl: string;
  /** `invitation` لحظة الدعوة، `reset` لإعادة تعيين بيانات حسابٍ قائم */
  occasion?: "invitation" | "reset";
  /** القسم والمسمّى كما حدّدتهما الإدارة الداعية — لا يُغيّرهما المدعوّ */
  departmentName?: string | null;
  departmentColorHex?: string | null;
  jobTitle?: string | null;
  roleLabel?: string | null;
  /** الدور الخام للدعوة — منه يُسمّى الموقع بصيغةٍ لا تحتاج جنساً */
  targetRole?: string | null;
  /** من أصدر الدعوة — يُذكَر باسمه في الرسالة وعلى الملصق */
  invitedByName?: string | null;
  /** رابطُ ملصق الدعوة الموقَّع */
  inviteCardUrl?: string | null;
  /** مهلة أول دخول بالساعات */
  hoursValid?: number;
}) {
  const invitation = (opts.occasion ?? "invitation") === "invitation";

  if (!invitation) {
    const r = await recipientOf(opts.to);
    const G = (m: string, f: string, n?: string) => gx(r.gender, m, f, n);
    return send(
      opts.to,
      "بيانات دخول جديدة لحسابك في تَـــلاقِ",
      {
        tone: "security",
        title: "بيانات دخول جديدة لحسابك",
        lead: `${esc(opts.fullName)}، أُعيد تعيين بيانات دخولك إلى منصة تَـــلاقِ. هذه بياناتك الجديدة:`,
        facts: [
          ["البريد الإلكتروني", opts.to],
          ["كلمة المرور المؤقتة", opts.tempPassword],
        ],
        cta: { label: "تسجيل الدخول", url: esc(opts.loginUrl) },
        note: `سيُطلب تغيير كلمة المرور عند الدخول الأول. وإن لم يكن هذا بطلبٍ منك ${G("فأبلغ", "فأبلغي", "فأبلغ")} إدارتك فوراً.`,
      },
      "بيانات الدخول",
      themeOf(r)
    );
  }

  const dept = opts.departmentName?.trim() || null;
  const position = opts.targetRole ? positionTitle(opts.targetRole, dept) : opts.roleLabel?.trim() || null;
  const where = dept ? (dept === "الإدارة العليا" ? "الإدارة العليا" : `قسم ${dept}`) : "فريق تَـــلاقِ";
  const by = opts.invitedByName?.trim();
  const hours = opts.hoursValid ?? 24;

  return send(
    opts.to,
    `دعوة للانضمام إلى تَـــلاقِ${dept ? ` — ${dept}` : ""}`,
    {
      tone: "action",
      badge: "دعوة خاصّة",
      title: `${firstName(opts.fullName)}، هذه دعوتك إلى تَـــلاقِ`,
      lead: `${by ? `دعاك <b>${esc(by)}</b>` : "دعتك إدارة <b>تَـــلاقِ</b>"} للانضمام إلى ${esc(where)}${position ? ` في موقع <b>${esc(position)}</b>` : ""}. وهذه دعوةٌ خاصّة باسمك، وبياناتُها سجّلتها الجهة الداعية.`,
      image: opts.inviteCardUrl
        ? // صورةٌ تُحفظ لا رابط: الضغطُ عليها كان يفتح المنصة بدل أن تُحفظ —
          // والدخولُ للزرّ وحده (قرار المؤسس)
          { src: opts.inviteCardUrl, width: 544, height: 680, alt: `دعوة خاصّة — ${opts.fullName}` }
        : undefined,
      paragraphs: [
        `<b>الخطوات من هنا:</b><br>١. الدخول بالبيانات أدناه وتغيير كلمة المرور.<br>٢. استكمال البيانات الشخصية.<br>٣. اجتياز اختبار القبول — وهو شرط النظر في الانضمام.<br>٤. عرض النتيجة على الإدارة المختصّة لقرار الاعتماد.`,
      ],
      facts: [
        ["الموقع", position],
        ["المسمّى الوظيفي", opts.jobTitle],
        ["البريد الإلكتروني", opts.to],
        ["كلمة المرور المؤقتة", opts.tempPassword],
      ],
      cta: { label: "الدخول وبدء الخطوات", url: esc(opts.loginUrl) },
      after: [
        "<b>الاعتماد ليس تلقائياً:</b> اجتياز الاختبار يرفع الطلب للمراجعة، وبطاقةُ العضوية تصل عند الاعتماد.",
      ],
      note: `للدعوة مهلة ${hours} ساعة؛ إن انقضت دون دخولٍ سقطت ووجب إصدارها من جديد.`,
    },
    "دعوة",
    { departmentName: dept, colorHex: opts.departmentColorHex ?? null }
  );
}

export async function sendWarningEmail(opts: {
  to: string;
  fullName: string;
  reason: string;
  warningsCount: number;
  loginUrl: string;
}) {
  const r = await recipientOf(opts.to);
  const isFinal = opts.warningsCount >= 3;
  const content: EmailContent = isFinal
    ? {
        tone: "alert",
        badge: "إشعار رسمي",
        title: "إشعار إنهاء العضوية",
        lead: `${esc(opts.fullName)}، بلغت التنبيهاتُ الحدَّ المسموح (٣)، ونأسف لإبلاغك بإنهاء العضوية في المنصة.`,
        quote: { label: "السبب الأخير", text: opts.reason },
        note: "هذا الإشعار مُسجَّلٌ في سجلّ الفريق ويمكن الرجوع إليه.",
      }
    : {
        tone: "alert",
        badge: `تنبيه رسمي · ${opts.warningsCount} من ٣`,
        title: "تنبيهٌ رسمي",
        lead: `${esc(opts.fullName)}، صدر في حسابك تنبيهٌ رسميّ، وهو مسجَّلٌ في سجلّ الفريق.`,
        quote: { label: "سبب التنبيه", text: opts.reason },
        facts: [["التنبيهات", `${opts.warningsCount} من ٣`]],
        cta: { label: "الاطّلاع على التنبيه", url: esc(opts.loginUrl) },
        note: "عند بلوغ ثلاثة تنبيهات تنتهي العضوية تلقائياً.",
      };
  return send(
    opts.to,
    isFinal ? "إشعار إنهاء العضوية — تَـــلاقِ" : `تنبيه (${opts.warningsCount}/3) — تَـــلاقِ`,
    content,
    "تنبيه",
    themeOf(r)
  );
}

export async function sendExitEmail(opts: { to: string; fullName: string; reason: string }) {
  const r = await recipientOf(opts.to);
  return send(
    opts.to,
    "إنهاء العضوية — تَـــلاقِ",
    {
      tone: "alert",
      badge: "إشعار رسمي",
      title: "إنهاء العضوية",
      lead: `${esc(opts.fullName)}، نحيطك علماً بإنهاء العضوية في منصة تَـــلاقِ.`,
      quote: { label: "السبب", text: opts.reason },
      note: "هذا الإشعار مُسجَّلٌ في سجلّ الفريق ويمكن الرجوع إليه.",
    },
    "إنهاء عضوية",
    themeOf(r)
  );
}

/** شهادة الشكر والخبرة — تصل برابطها لا بخبرها.
 *
 *  صاحبها خرج من الفريق وحسابه مُعطَّل، فلا يستطيع الدخول ليقرأها. فالرابط
 *  الموقَّع هو الشهادة نفسها — يُفتح بلا تسجيل دخول، ويُطبَع PDF بضغطة. */
export async function sendCertificateEmail(opts: {
  to: string;
  fullName: string;
  roleLabel?: string | null;
  departmentName?: string | null;
  mission?: string | null;
  period?: { start: Date; end: Date } | null;
  certificateUrl: string;
}) {
  const r = await recipientOf(opts.to);
  const role = r.role ? roleTitle(r.role, r.gender, opts.departmentName ?? r.departmentName) : opts.roleLabel;
  return send(
    opts.to,
    "شهادة شكر وخبرة — تَـــلاقِ",
    {
      tone: "celebrate",
      badge: "شهادة شكر وخبرة",
      title: `${forms(r.gender).thanks}، ${firstName(opts.fullName)}`,
      lead: `تقديراً لمسيرتك في تَـــلاقِ، صدرت ${forms(r.gender).toYou} شهادةُ شكرٍ وخبرة موقَّعة، بلون قسمك وبتوقيع من عملتَ معهم.`.replace(
        "عملتَ",
        gx(r.gender, "عملتَ", "عملتِ", "عملت")
      ),
      facts: [
        ["الصفة", role],
        ["المهمة", opts.mission],
        ["القسم", opts.departmentName],
        ["المدّة", opts.period ? `${formatDate(opts.period.start)} — ${formatDate(opts.period.end)}` : null],
      ],
      cta: { label: "عرض الشهادة وحفظها PDF", url: esc(opts.certificateUrl) },
      note: "الرابط خاصٌّ بك ويعمل بلا تسجيل دخول — فالأفضل حفظ الشهادة عندك.",
    },
    "شهادة إتمام",
    { departmentName: opts.departmentName ?? r.departmentName, colorHex: r.colorHex }
  );
}

/** شهادة تقدير الثلاثة أشهر — تكريمٌ لمسيرةٍ جارية لا وداعٌ لها.
 *
 *  ونصُّها لا يَنسب إليه إنجازاً بعينه: المنصة تعرف أنه أكمل ثلاثة
 *  أشهر، ولا تعرف ماذا صنع فيها. فاختراعُ إنجازٍ يُفرغ التكريم من
 *  صدقه — ومن يقرأ ثناءً على عملٍ لم يعمله يعرف أنه آليّ. */
export async function sendAppreciationEmail(opts: {
  to: string;
  fullName: string;
  jobTitle?: string | null;
  departmentName?: string | null;
  certificateUrl: string;
}) {
  const r = await recipientOf(opts.to);
  const f = forms(r.gender);
  return send(
    opts.to,
    "ثلاثة أشهر من العطاء — شهادة تقدير من تَـــلاقِ",
    {
      tone: "celebrate",
      badge: "ثلاثة أشهر من العطاء",
      title: `ثلاثة أشهرٍ معاً، ${firstName(opts.fullName)}`,
      lead: "مضت ثلاثة أشهرٍ على انضمامك إلى مسيرتنا — ثلاثة أشهرٍ من العمل والتعلّم والإسهام في بناء ما نطمح إليه معاً.",
      paragraphs: [
        `يسعدنا أن نحتفي بهذه المحطّة، وأن نعبّر ${f.toYou} عن تقديرنا للوقت والجهد في هذه التجربة. فالأثرُ الحقيقي لا يُقاس بالوقت وحده، بل بما نتعلّمه ونبنيه ونضيفه إلى الفريق.`,
      ],
      facts: [
        ["المسمّى", opts.jobTitle],
        ["القسم", opts.departmentName],
      ],
      cta: { label: "عرض شهادة التقدير", url: esc(opts.certificateUrl) },
      after: [`${f.thanks} — ونتطلّع إلى ما نصنعه معاً في الأشهر القادمة.`],
    },
    "تقدير ثلاثة أشهر",
    { departmentName: opts.departmentName ?? r.departmentName, colorHex: r.colorHex }
  );
}

/** رسالةُ تحفيزٍ وتكريمٍ على إنجاز — يُرسلها المؤسس أو التنفيذي بيده.
 *
 *  **وليست تلقائية.** لا كنسٌ يُطلقها ولا قاعدةٌ تستنتج الإنجاز: من
 *  يقودُ يرى الأثر ويَنسبه لصاحبه. والجائزةُ اختيارية، وما لم يُذكَر لا
 *  يُفترَض. */
export async function sendAwardEmail(opts: {
  to: string;
  fullName: string;
  /** عنوان الإنجاز — ما الذي تحقّق */
  achievement: string;
  /** الجائزة المرافقة إن وُجدت */
  award?: string | null;
  /** كلمةٌ من المُكرِّم */
  note?: string | null;
  /** اسمُ المُكرِّم وصفته — التكريم يُنسَب لمن قصده */
  fromName: string;
  fromRole: string;
  portalUrl: string;
}) {
  const r = await recipientOf(opts.to);
  const G = (m: string, f: string, n?: string) => gx(r.gender, m, f, n);
  const note = opts.note?.trim();
  return send(
    opts.to,
    `تكريمٌ من تَـــلاقِ: ${opts.achievement}`,
    {
      tone: "celebrate",
      badge: "تكريم",
      title: `${forms(r.gender).wellDone}، ${firstName(opts.fullName)}!`,
      lead: `وصلنا أثرُ ما ${G("صنعتَه", "صنعتِه", "صنعته")}، ونحبّ أن نقوله ${forms(r.gender).toYou} صريحاً لا أن نكتفي بمعرفته:`,
      quote: { label: "الإنجاز", text: opts.achievement },
      facts: [["الجائزة المرافقة", opts.award]],
      paragraphs: note ? [esc(note)] : [],
      after: [`مع التقدير،<br><b>${esc(opts.fromName)}</b> — ${esc(opts.fromRole)}`],
      cta: { label: "فتح المنصة", url: esc(opts.portalUrl) },
    },
    "تكريم إنجاز",
    themeOf(r)
  );
}

/** طلب توقيع من قائدٍ جديد.
 *
 *  يشرح لماذا يُطلب وأين يُرسَم: التوقيع يُوضَع على شهادات الشكر التي
 *  يُوقّعها. ومن لا يفهم لماذا يُطلب توقيعُه لا يرفعه. */
export async function sendSignatureRequestEmail(opts: {
  to: string;
  fullName: string;
  roleLabel: string;
  departmentName?: string | null;
  uploadUrl: string;
}) {
  const r = await recipientOf(opts.to);
  const role = r.role ? roleTitle(r.role, r.gender, opts.departmentName ?? r.departmentName) : opts.roleLabel;
  const scope = opts.departmentName?.trim() ? `أعضاء ${opts.departmentName.trim()}` : "من تُوقَّع لهم";
  return send(
    opts.to,
    "نحتاج توقيعك — شهادات تَـــلاقِ",
    {
      tone: "action",
      title: "نحتاج توقيعك",
      lead: `${esc(opts.fullName)}، بصفتك <b>${esc(role)}</b> يحمل توقيعُك شهاداتِ الشكر والتقدير التي تُصدرها تَـــلاقِ لـ${esc(scope)}.`,
      paragraphs: [
        "يُرفع التوقيع مرّةً واحدة، ويُرسَم على الشهادات التي تصدر باسمك — فيقرأ صاحبُها توقيعَ من عمل معه فعلاً، لا اسماً مطبوعاً.",
      ],
      facts: [
        ["الصفة", role],
        ["القسم", opts.departmentName],
      ],
      cta: { label: "رفع التوقيع", url: esc(opts.uploadUrl) },
      note: "يُرسم التوقيع على ورقةٍ بيضاء ويُصوَّر، أو داخل الصفحة مباشرة. ويُعتمد من الإدارة قبل استعماله، ولا يُستعمل توقيعُ قائدٍ سابق مكانه.",
    },
    "طلب توقيع",
    themeOf(r)
  );
}

/** طلب إنهاء فترة الإدارة — للمسؤول المختصّ وحده.
 *
 *  ويُنصّ فيها أن اللقاء خيارٌ ثالث: مسؤولٌ يرى الموافقة والرفض فقط
 *  يقرّر على عجلٍ في أمرٍ يستحقّ حواراً. */
export async function sendTerminationRequestEmail(opts: {
  to: string | string[];
  memberName: string;
  memberEmail: string;
  assignmentLabel: string;
  reason: string;
  requestedEndDate: Date | null;
  portalUrl: string;
}) {
  const r = await recipientOf(opts.to);
  return send(
    opts.to,
    `طلب إنهاء فترة الإدارة: ${opts.memberName}`,
    {
      tone: "action",
      title: "طلب إنهاء فترة الإدارة",
      lead: `رُفع طلبُ إنهاء فترة الإدارة من <b>${esc(opts.memberName)}</b>، وهو بانتظار قرارك.`,
      facts: [
        ["مقدّم الطلب", opts.memberName],
        ["التكليف", opts.assignmentLabel],
        ["البريد", opts.memberEmail],
        ["التاريخ المقترح", opts.requestedEndDate ? formatDate(opts.requestedEndDate) : null],
      ],
      quote: { label: "سبب الطلب كما كُتب", text: opts.reason },
      after: [
        "الخيارات ثلاثة: الموافقة بتاريخٍ يُثبَت، أو الرفض بتفسيرٍ يُقرأ لصاحب الطلب، أو <b>طلب لقاءٍ قبل القرار</b> — واللقاء ليس موافقةً ولا رفضاً.",
      ],
      cta: { label: "فتح الطلب", url: esc(opts.portalUrl) },
      note: "لا يتوقّف العمل برفع الطلب: يبقى التكليف قائماً حتى القرار وحلول المهلة.",
    },
    "طلب إنهاء إدارة",
    themeOf(r)
  );
}

/** قرار الطلب — لصاحبه، فهو صاحب الشأن */
export async function sendTerminationDecisionEmail(opts: {
  to: string;
  memberName: string;
  assignmentLabel: string;
  decision: "approve" | "reject" | "request_meeting";
  note: string | null;
  endDate: Date | null;
  byName: string;
}) {
  const r = await recipientOf(opts.to);
  const G = (m: string, f: string, n?: string) => gx(r.gender, m, f, n);
  const subject =
    opts.decision === "approve"
      ? "وُوفق على طلب إنهاء فترة الإدارة"
      : opts.decision === "reject"
        ? "بشأن طلب إنهاء فترة الإدارة"
        : "طلب لقاء بشأن طلبك";

  const content: EmailContent =
    opts.decision === "approve"
      ? {
          tone: "info",
          badge: "قرار",
          title: "وُوفق على طلبك",
          lead: `${esc(opts.memberName)}، وُوفق على طلبك إنهاءَ فترة الإدارة في <b>${esc(opts.assignmentLabel)}</b>.`,
          paragraphs: [
            `${opts.endDate ? `${G("وتبقى", "وتبقين", "ويبقى التكليف قائماً")}${r.gender ? " على عملك" : ""} حتى تاريخ الانتهاء المُثبَت أدناه. ` : ""}وتصلك شهادة شكرٍ وخبرة عند الختام — لا ينتهي أحدٌ عندنا بلا توثيق.`,
          ],
        }
      : opts.decision === "reject"
        ? {
            tone: "info",
            badge: "قرار",
            title: "بشأن طلب إنهاء فترة الإدارة",
            lead: `${esc(opts.memberName)}، نُظر في طلبك إنهاءَ فترة الإدارة في <b>${esc(opts.assignmentLabel)}</b>، ولم يُوافَق عليه.`,
          }
        : {
            tone: "action",
            badge: "طلب لقاء",
            title: "طلب لقاءٍ قبل القرار",
            lead: `${esc(opts.memberName)}، بشأن طلبك إنهاءَ فترة الإدارة في <b>${esc(opts.assignmentLabel)}</b>: طُلب لقاءٌ قبل اتخاذ القرار.`,
            paragraphs: ["<b>وهذا ليس موافقةً ولا رفضاً</b> — الطلب قائمٌ كما هو، والقرار بعد اللقاء."],
          };

  return send(
    opts.to,
    subject,
    {
      ...content,
      facts: [
        ["التكليف", opts.assignmentLabel],
        ["تاريخ الانتهاء", opts.decision === "approve" && opts.endDate ? formatDate(opts.endDate) : null],
        ["القرار من", opts.byName],
      ],
      quote: opts.note ? { label: opts.decision === "reject" ? "التفسير" : "ملاحظة", text: opts.note } : null,
    },
    "قرار إنهاء إدارة",
    themeOf(r)
  );
}

export async function sendTicketCreatedEmail(opts: {
  to: string | string[];
  subject: string;
  description: string;
  memberName: string;
  dueDate: Date;
  portalUrl: string;
  linkUrl?: string | null;
}) {
  const r = await recipientOf(opts.to);
  return send(
    opts.to,
    `تذكرة جديدة: ${opts.subject}`,
    {
      tone: "action",
      badge: "تذكرة جديدة · إجراء مطلوب",
      title: opts.subject,
      lead: `وصلت تذكرةٌ جديدة من <b>${esc(opts.memberName)}</b>، وهي بانتظار ردّك.`,
      facts: [
        ["من", opts.memberName],
        ["المهلة", formatDate(opts.dueDate)],
        ["الرابط المرفق", opts.linkUrl],
      ],
      quote: { label: "التفاصيل", text: opts.description },
      cta: { label: "فتح التذكرة", url: esc(opts.portalUrl) },
      note: "إن انقضت المهلة دون ردّ تُصعَّد التذكرة تلقائياً إلى المرحلة التالية.",
    },
    "تذكرة جديدة",
    themeOf(r)
  );
}

export async function sendTicketEscalatedEmail(opts: {
  to: string | string[];
  subject: string;
  memberName: string;
  description: string;
  stageLabel: string;
  dueDate: Date | null;
  portalUrl: string;
}) {
  const blocked = await suppressed("ticket.escalated", opts.to, "تصعيد تذكرة", `تذكرة متصعّدة إليك: ${opts.subject}`);
  if (blocked) return blocked;
  const r = await recipientOf(opts.to);

  return send(
    opts.to,
    `تذكرة متصعّدة إليك: ${opts.subject}`,
    {
      tone: "action",
      badge: "تصعيد · إجراء مطلوب",
      title: opts.subject,
      lead: `لم تُحَلّ تذكرة <b>${esc(opts.memberName)}</b> خلال مهلتها، فصُعِّدت إلى: <b>${esc(opts.stageLabel)}</b>.`,
      facts: [
        ["من", opts.memberName],
        ["المرحلة", opts.stageLabel],
        ["المهلة الجديدة", opts.dueDate ? formatDate(opts.dueDate) : null],
      ],
      quote: { label: "التفاصيل", text: opts.description },
      cta: { label: "فتح التذكرة", url: esc(opts.portalUrl) },
    },
    "تصعيد تذكرة",
    themeOf(r)
  );
}

export async function sendTicketResolvedEmail(opts: {
  to: string;
  subject: string;
  resolutionNote: string;
}) {
  const r = await recipientOf(opts.to);
  return send(
    opts.to,
    `تم حل تذكرتك: ${opts.subject}`,
    {
      tone: "celebrate",
      badge: "أُنجزت",
      title: `أُنجزت تذكرتك: ${opts.subject}`,
      lead: "تمّ التعامل مع تذكرتك، وهذه ملاحظة الحلّ كما كُتبت:",
      quote: { label: "ملاحظة الحلّ", text: opts.resolutionNote },
      cta: { label: "فتح المنصة", url: portal() },
    },
    "حل تذكرة",
    themeOf(r)
  );
}

/** سحب التذكرة — يُخبَر به من كان الطلب في يده ليتوقّف عن عملٍ صار بلا
 *  داعٍ. ولا يُقال فيه «تم الحل»: لم يُحَلّ، بل رفعه صاحبه ثم سحبه. */
export async function sendTicketWithdrawnEmail(opts: {
  to: string | string[];
  ticketNumber: number;
  subject: string;
  reason: string;
  byName: string;
}) {
  const blocked = await suppressed("ticket.withdrawn", opts.to, "سحب تذكرة", `سُحبت التذكرة: ${opts.subject}`);
  if (blocked) return blocked;
  const r = await recipientOf(opts.to);

  return send(
    opts.to,
    `سُحبت التذكرة #${opts.ticketNumber}: ${opts.subject}`,
    {
      tone: "info",
      badge: "سُحبت",
      title: `سُحبت التذكرة #${opts.ticketNumber}`,
      lead: `سُحبت التذكرة بطلبٍ من <b>${esc(opts.byName)}</b>، فلم تعد بانتظار ردّك.`,
      facts: [["التذكرة", `#${opts.ticketNumber} — ${opts.subject}`]],
      quote: { label: "السبب", text: opts.reason },
      note: "لم تُحَلّ التذكرة — سُحبت. فلا إجراء مطلوب.",
    },
    "سحب تذكرة",
    themeOf(r)
  );
}

/** طلبُ اعتمادٍ يقف على طاولة المعتمِد — يحمل ما يُقرَّر به لا دعوةً للدخول */
export async function sendApprovalRequestEmail(opts: {
  to: string | string[];
  ticketNumber: number;
  subject: string;
  kindLabel: string;
  requesterName: string;
  requesterRole: string;
  stepsTotal: number;
  url: string;
  /** حين يكون هذا اعتماداً ثانياً في مسارٍ متسلسل */
  afterStepBy?: string;
  /** حين يُعاد الطلب بعد تعديله */
  resubmitted?: boolean;
}) {
  const r = await recipientOf(opts.to);
  const lead = opts.resubmitted
    ? "أُعيد إليك طلبٌ بعد تعديله، وهو بانتظار قرارك."
    : opts.afterStepBy
      ? `اعتمد <b>${esc(opts.afterStepBy)}</b> هذا الطلب، وانتقل إليك لاستكمال الاعتماد.`
      : "طلبُ اعتمادٍ ينتظر قرارك.";
  return send(
    opts.to,
    `طلب اعتماد #${opts.ticketNumber}: ${opts.subject}`,
    {
      tone: "action",
      badge: "طلب اعتماد",
      title: `#${opts.ticketNumber} — ${opts.subject}`,
      lead,
      facts: [
        ["النوع", opts.kindLabel],
        ["مقدّم الطلب", `${opts.requesterName} — ${opts.requesterRole}`],
        ["مسار الاعتماد", opts.stepsTotal > 1 ? `${opts.stepsTotal} موافقات` : null],
      ],
      cta: { label: "مراجعة الطلب واتخاذ القرار", url: esc(opts.url) },
      note: "لا يُعتمد الطلب إلا من صاحب الصلاحية، ويُسجَّل القرار باسمه ووقته.",
    },
    "طلب اعتماد",
    themeOf(r)
  );
}

/** قرارُ المعتمِد يصل صاحبَ الطلب — اعتماداً أو ردّاً أو رفضاً */
export async function sendApprovalDecisionEmail(opts: {
  to: string | string[];
  ticketNumber: number;
  subject: string;
  stateLabel: string;
  note: string;
  byName: string;
  /** في المسار المتسلسل: إلى من انتقل بعد هذه الموافقة */
  nextApproverName?: string;
  url: string;
}) {
  const r = await recipientOf(opts.to);
  return send(
    opts.to,
    `قرار على طلبك #${opts.ticketNumber}: ${opts.stateLabel}`,
    {
      tone: "info",
      badge: "قرار",
      title: `قرارٌ على طلبك #${opts.ticketNumber}`,
      lead: `صار طلبك <b>${esc(opts.subject)}</b>: <b>${esc(opts.stateLabel)}</b>.${
        opts.nextApproverName ? ` وانتقل إلى <b>${esc(opts.nextApproverName)}</b> لاستكمال الموافقات.` : ""
      }`,
      facts: [
        ["الحالة", opts.stateLabel],
        ["القرار من", opts.byName],
        ["التالي", opts.nextApproverName],
      ],
      quote: opts.note ? { label: "الملاحظة", text: opts.note } : null,
      cta: { label: "فتح الطلب", url: esc(opts.url) },
    },
    "قرار اعتماد",
    themeOf(r)
  );
}

export async function sendTicketReminderEmail(opts: {
  to: string | string[];
  subject: string;
  memberName: string;
  stageLabel: string;
  dueDate: Date;
  fromName: string;
  portalUrl: string;
}) {
  const blocked = await suppressed("ticket.reminder", opts.to, "تذكير تذكرة", `تذكير: ${opts.subject}`);
  if (blocked) return blocked;
  const r = await recipientOf(opts.to);

  return send(
    opts.to,
    `تذكير — تذكرة لم تُحل بعد: ${opts.subject}`,
    {
      tone: "action",
      badge: "تذكير",
      title: opts.subject,
      lead: `تذكيرٌ من <b>${esc(opts.fromName)}</b> (المتابعة والتشغيل): هذه التذكرة ما زالت بانتظار ردّك في مرحلة <b>${esc(opts.stageLabel)}</b>.`,
      facts: [
        ["من", opts.memberName],
        ["الموعد النهائي", formatDate(opts.dueDate)],
      ],
      cta: { label: "فتح التذكرة", url: esc(opts.portalUrl) },
    },
    "تذكير تذكرة",
    themeOf(r)
  );
}

export async function sendRequestReminderEmail(opts: {
  to: string | string[];
  typeLabel: string;
  memberName: string | null;
  note: string | null;
  dueDate: Date | null;
  fromName: string;
}) {
  const blocked = await suppressed("request.reminder", opts.to, "تذكير طلب", `تذكير بطلب: ${opts.typeLabel}`);
  if (blocked) return blocked;
  const r = await recipientOf(opts.to);

  return send(
    opts.to,
    `تذكير — طلب بانتظار الإنجاز: ${opts.typeLabel}`,
    {
      tone: "action",
      badge: "تذكير",
      title: opts.typeLabel,
      lead: `تذكيرٌ من <b>${esc(opts.fromName)}</b> (المتابعة والتشغيل): هذا الطلب ما زال بانتظار الإنجاز.`,
      facts: [
        ["متعلّقٌ بـ", opts.memberName],
        ["الموعد النهائي", opts.dueDate ? formatDate(opts.dueDate) : null],
      ],
      quote: opts.note ? { label: "ملاحظة", text: opts.note } : null,
      cta: { label: "فتح المنصة", url: portal() },
    },
    "تذكير طلب",
    themeOf(r)
  );
}

export async function sendMeetingReminderEmail(opts: {
  to: string;
  candidateName: string;
  dueDate: Date;
}) {
  const blocked = await suppressed("meeting.reminder", opts.to, "تذكير اجتماع", "تذكير باجتماع");
  if (blocked) return blocked;
  const r = await recipientOf(opts.to);

  return send(
    opts.to,
    `طلب اجتماع شرح — ${opts.candidateName}`,
    {
      tone: "action",
      title: `اجتماع شرح — ${opts.candidateName}`,
      lead: `لم تبلغ نتيجةُ <b>${esc(opts.candidateName)}</b> نسبةَ الاجتياز في اختبار القبول، والمطلوب جدولةُ اجتماع شرحٍ قبل الموعد أدناه.`,
      facts: [["الموعد", formatDate(opts.dueDate)]],
      cta: { label: "فتح المنصة", url: portal() },
    },
    "اجتماع شرح",
    themeOf(r)
  );
}

/** «طلبٌ ينتظر اعتمادك» — للمعتمِد المختصّ وحده.
 *
 *  يُخبَر من يفعل، ولا يُخبَر من ينتظر: المرشّح يقرأ نتيجته على الشاشة،
 *  ومن يملك اعتماده يحتاج أن يعرف أن أمامه قراراً. */
export async function sendAwaitingApprovalEmail(opts: {
  to: string | string[];
  candidateName: string;
  candidateEmail: string;
  score: number;
  scopeLabel: string;
  portalUrl: string;
}) {
  const r = await recipientOf(opts.to);
  return send(
    opts.to,
    `طلب انضمام ينتظر اعتمادك: ${opts.candidateName}`,
    {
      tone: "action",
      badge: "طلب انضمام",
      title: `طلب انضمام: ${opts.candidateName}`,
      lead: `اكتمل تسجيلُ <b>${esc(opts.candidateName)}</b> واجتيازُ اختبار القبول، والطلب بانتظار اعتمادك.`,
      facts: [
        ["الاسم", opts.candidateName],
        ["البريد", opts.candidateEmail],
        ["الجهة", opts.scopeLabel],
        ["النتيجة", `${opts.score}%`],
      ],
      cta: { label: "فتح قائمة الاعتماد", url: esc(opts.portalUrl) },
      note: "لا تُرسَل بطاقة العضوية حتى الاعتماد — فالاعتماد هو ما يُنشئ الحساب.",
    },
    "طلب ينتظر الاعتماد",
    themeOf(r)
  );
}

/** إشعار عدم الاجتياز — يُصاغ كخطوة تالية لا كرفض: اجتماع شرح مجدول */
export async function sendTestFailedEmail(opts: {
  to: string;
  fullName: string;
  score: number;
  departmentName: string;
  dueDate: Date;
}) {
  const blocked = await suppressed("test.failed", opts.to, "نتيجة اختبار", "نتيجة اختبارك");
  if (blocked) return blocked;
  const r = await recipientOf(opts.to);

  return send(
    opts.to,
    "نتيجة اختبار القبول — اجتماع شرح قادم",
    {
      tone: "info",
      badge: "نتيجة الاختبار",
      title: "نتيجة اختبار القبول",
      lead: `${esc(opts.fullName)}، كانت نتيجتك <b>${opts.score}%</b> ولم تبلغ الحدّ المطلوب هذه المرّة.`,
      paragraphs: [
        `أُبلغ <b>${esc(opts.departmentName)}</b> لجدولة <b>اجتماع شرح</b> معك قبل الموعد أدناه، يوضّح المتوقَّع ويجيب عن أسئلتك.`,
        "<b>حسابك يبقى قائماً</b>، ولا حاجة لإنشاء حسابٍ جديد.",
      ],
      facts: [
        ["النتيجة", `${opts.score}%`],
        ["اجتماع الشرح قبل", formatDate(opts.dueDate)],
      ],
    },
    "عدم اجتياز الاختبار",
    themeOf(r)
  );
}

/** إبلاغ القسم بمرشّح يحتاج اجتماع شرح — الطرف المسؤول عن تنفيذ الاجتماع */
export async function sendMeetingOwnerEmail(opts: {
  to: string[];
  candidateName: string;
  candidateEmail: string;
  score: number;
  departmentName: string;
  dueDate: Date;
}) {
  const blocked = await suppressed("meeting.owner", opts.to, "اجتماع شرح", "اجتماع شرح مجدول");
  if (blocked) return blocked;
  const r = await recipientOf(opts.to);

  return send(
    opts.to,
    `مطلوب جدولة اجتماع شرح — ${opts.candidateName}`,
    {
      tone: "action",
      title: `جدولة اجتماع شرح — ${opts.candidateName}`,
      lead: `وصل إلى <b>${esc(opts.departmentName)}</b> طلبٌ جديد: لم تبلغ نتيجةُ <b>${esc(opts.candidateName)}</b> في اختبار القبول نسبةَ الاجتياز.`,
      facts: [
        ["المرشّح", opts.candidateName],
        ["البريد", opts.candidateEmail],
        ["النتيجة", `${opts.score}%`],
        ["الاجتماع قبل", formatDate(opts.dueDate)],
      ],
      cta: { label: "فتح المنصة", url: portal() },
      note: "الطلب مسجَّلٌ في لوحة القسم ضمن الطلبات، ويُتابَع آلياً حتى إنجازه.",
    },
    "تكليف اجتماع شرح",
    { departmentName: opts.departmentName, colorHex: r.colorHex }
  );
}

/** تذكير قبل سقوط مهلة الـ24 ساعة — فرصة أخيرة قبل أن يفقد الرمز صلاحيته */
export async function sendWindowReminderEmail(opts: {
  to: string;
  fullName: string;
  hoursLeft: number;
  loginUrl: string;
}) {
  const blocked = await suppressed("window.reminder", opts.to, "تذكير مهلة", "تذكير بمهلة الدخول");
  if (blocked) return blocked;
  const r = await recipientOf(opts.to);

  return send(
    opts.to,
    `تبقّى ${opts.hoursLeft} ساعة لتفعيل حسابك في تَـــلاقِ`,
    {
      tone: "alert",
      badge: "مهلة توشك أن تنقضي",
      title: `تبقّى ${opts.hoursLeft} ساعة لتفعيل حسابك`,
      lead: `${esc(opts.fullName)}، أُنشئ ${forms(r.gender).toYou} حسابٌ في تَـــلاقِ ولم يُستعمل بعد.`,
      paragraphs: [
        `<b>يتبقّى ${opts.hoursLeft} ساعة</b> قبل أن يسقط الحساب تلقائياً وتفقد كلمة المرور المؤقتة صلاحيتها.`,
      ],
      cta: { label: "تسجيل الدخول الآن", url: esc(opts.loginUrl) },
      note: "إن ضاعت كلمة المرور المؤقتة فالتواصل مع الجهة التي أنشأت الحساب.",
    },
    "تذكير قبل سقوط المهلة",
    themeOf(r)
  );
}

/** رابط استعادة كلمة المرور — صالح لمدة محدودة ولمرة واحدة */
export async function sendPasswordResetEmail(opts: {
  to: string;
  fullName: string;
  resetUrl: string;
  minutesValid: number;
}) {
  const r = await recipientOf(opts.to);
  return send(
    opts.to,
    "استعادة كلمة المرور — تَـــلاقِ",
    {
      tone: "security",
      title: "استعادة كلمة المرور",
      lead: `${esc(opts.fullName)}، وصلنا طلبٌ لاستعادة كلمة مرور حسابك في تَـــلاقِ.`,
      cta: { label: "تعيين كلمة مرور جديدة", url: esc(opts.resetUrl) },
      facts: [["صلاحية الرابط", `${opts.minutesValid} دقيقة · يُستعمل مرّة واحدة`]],
      note: `إن لم يكن الطلب منك ${gx(r.gender, "فتجاهل", "فتجاهلي", "فتجاهل")} الرسالة — لن يتغيّر شيءٌ في حسابك.`,
    },
    "استعادة كلمة المرور",
    themeOf(r)
  );
}

/** يُرسَل عند إعادة فتح الاختبار بعد اجتماع الشرح — فرصة ثانية صريحة لا صامتة */
export async function sendTestReopenedEmail(opts: {
  to: string;
  fullName: string;
  roleLabel: string;
  loginUrl: string;
  hoursValid: number;
}) {
  const blocked = await suppressed("test.reopened", opts.to, "إعادة اختبار", "أُعيد فتح اختبارك");
  if (blocked) return blocked;
  const r = await recipientOf(opts.to);
  const position = r.role ? positionTitle(r.role, r.departmentName) : opts.roleLabel;

  return send(
    opts.to,
    "أُعيد فتح اختبار القبول لك — تَـــلاقِ",
    {
      tone: "celebrate",
      badge: "فرصة ثانية",
      title: "أُعيد فتح اختبار القبول",
      lead: `${esc(opts.fullName)}، بعد اجتماع الشرح أُعيد فتح اختبار القبول لموقع <b>${esc(position)}</b>.`,
      paragraphs: [
        gx(r.gender, "ادخل بالحساب نفسه وابدأ الاختبار.", "ادخلي بالحساب نفسه وابدئي الاختبار.", "الدخول بالحساب نفسه، ثم بدء الاختبار."),
      ],
      facts: [["المهلة", `${opts.hoursValid} ساعة من الآن`]],
      cta: { label: "فتح المنصة", url: esc(opts.loginUrl) },
      note: "إن انقضت المهلة دون دخول يُغلق الحساب تلقائياً.",
    },
    "إعادة فتح الاختبار",
    themeOf(r)
  );
}

/** يبثّ إعلاناً إلى بريد جمهوره.
 *
 *  يُرسَل نسخةً واحدةً لكل مستلم (لا دفعة واحدة في حقل "إلى") حتى لا يرى
 *  أحدٌ عناوين البقية: إعلان داخلي لا يجوز أن يكشف دليل بريد الفريق.
 *  ولأنه لكلٍّ نسختُه، يأخذ كلٌّ لونَ قسمه. */
export async function sendAnnouncementEmail(opts: {
  recipients: string[];
  title: string;
  body: string;
  authorName: string;
  audienceLabel: string;
  portalUrl: string;
  meetingUrl?: string | null;
  linkUrl?: string | null;
  linkLabel?: string | null;
}) {
  let delivered = 0;
  for (const to of opts.recipients) {
    const r = await recipientOf(to);
    // الاجتماع أبرز من الرابط العام: من يفتح إعلان اجتماع يبحث عن رابطه
    // أولاً، فيُعطى الزرَّ الرئيسي
    const primary = opts.meetingUrl
      ? { label: "الانضمام إلى الاجتماع", url: esc(opts.meetingUrl) }
      : { label: "فتح المنصة", url: esc(opts.portalUrl) };
    const secondary = opts.linkUrl
      ? { label: opts.linkLabel?.trim() || "فتح الرابط المرفق", url: esc(opts.linkUrl) }
      : null;
    const result = await send(
      to,
      `إعلان: ${opts.title}`,
      {
        tone: "info",
        badge: "إعلان",
        title: opts.title,
        lead: `موجَّهٌ إلى: ${esc(opts.audienceLabel)} · نشره ${esc(opts.authorName)}`,
        paragraphs: [`<span style="white-space:pre-wrap">${esc(opts.body)}</span>`],
        cta: primary,
        secondary,
      },
      "إعلان عام",
      themeOf(r)
    );
    if (!result.skipped) delivered++;
  }
  return delivered;
}

/** رمز الدخول لمرة واحدة.
 *
 *  الرمز يُعرض كبيراً مفرّق الخانات: هذا ما يُقرأ من شاشة الجوال في ثانية
 *  ويُنسخ بلا خطأ. ولا يحمل البريد رابطاً للدخول إطلاقاً — رسالةٌ فيها
 *  رمزٌ ورابطٌ معاً هي بالضبط شكل رسائل التصيّد. */
export async function sendLoginCodeEmail(opts: {
  to: string;
  fullName: string;
  code: string;
  minutesValid: number;
}) {
  const r = await recipientOf(opts.to);
  return send(
    opts.to,
    `رمز دخولك: ${opts.code} — تَـــلاقِ`,
    {
      tone: "security",
      title: "رمز الدخول",
      lead: `${esc(opts.fullName)}، وصلنا طلب دخولٍ إلى حسابك. هذا الرمز يُكمل الدخول:`,
      code: { value: opts.code, caption: `صالح ${opts.minutesValid} دقائق · يُستخدم مرّة واحدة` },
      note: "لا يُشارَك هذا الرمز مع أحدٍ مهما كان — فريق تَـــلاقِ لا يطلبه أبداً، لا بمكالمة ولا برسالة. وطلبُ رمزٍ جديد يُبطل هذا فوراً.",
    },
    "رمز الدخول",
    themeOf(r)
  );
}

export type WelcomeEmailOpts = {
  fullName: string;
  roleLabel: string;
  jobTitle?: string | null;
  specialization?: string | null;
  section?: string | null;
  departmentName?: string | null;
  /** لون القسم المسجَّل — منه تُعرف هويته، ولا يُخمَّن */
  departmentColorHex?: string | null;
  /** رابط اللوحة المتحرّكة القديمة — باقٍ للتوافق، ولم يعد يُعرض */
  bannerUrl?: string | null;
  /** رابطُ بطاقة العضوية الموقَّع — الصورة التي تُشارَك */
  cardUrl?: string | null;
  /** جنسُ صاحبها ودورُه الخام — للمخاطبة والصفة بصيغته */
  gender?: MaybeGender;
  accountRole?: string | null;
  portalUrl: string;
  joinedAt?: Date | null;
  /** عدّة المشاركة — تُدرَج داخل الرسالة نفسها لا في رسالة ثانية */
  handles?: { label: string; handle: string; url: string }[];
  hashtag?: string;
  /** `approved`: تصل لحظة الاعتماد فتُعلنه. `resend`: يطلبها صاحبها لأنها
   *  ضاعت منه، فلا تُعلن خبراً قديماً وكأنه جديد. */
  occasion?: "approved" | "resend";
};

export function welcomeEmailSubject(
  fullName: string,
  occasion: "approved" | "resend" = "approved",
  gender?: MaybeGender
) {
  return occasion === "approved"
    ? `أهلاً ${forms(gender).you} في عائلة تَـــلاقِ، ${fullName}!`
    : `بطاقتك في تَـــلاقِ، ${fullName}`;
}

/** رسالة الاعتماد — تُعلنه وتُرحّب وتحمل بطاقة العضوية للمشاركة.
 *
 *  **البطاقة صورةٌ لا HTML:** المطلوب أن تُصوَّر الشاشة وتُنشر كما هي، وما
 *  يُرسَم صورةً على الخادم يصل في كل بريدٍ بالخطّ واللون نفسيهما. وتحتها
 *  النصُّ حيّاً: الاسم والصفة والقسم والتاريخ — فلا تُفقَد المعلومة إن
 *  حُجبت الصور. */
function welcomeContent(opts: WelcomeEmailOpts): { subject: string; content: EmailContent; theme: EmailTheme } {
  const g = opts.gender ?? null;
  const f = forms(g);
  const G = (m: string, fe: string, n?: string) => gx(g, m, fe, n);
  const brand = departmentBrand(opts.departmentName ?? null, opts.departmentColorHex ?? null);
  const role = opts.accountRole ? roleTitle(opts.accountRole, g, opts.departmentName) : opts.roleLabel;
  const job = opts.jobTitle?.trim();
  const as = job ? ` بصفتك ${esc(job)}` : role ? ` بصفتك ${esc(role)}` : "";
  const approved = (opts.occasion ?? "approved") === "approved";
  const first = firstName(opts.fullName);
  const handle = `@${SOCIAL_HANDLE}`;
  const tag = opts.hashtag ?? BRAND_HASHTAG;

  return {
    subject: welcomeEmailSubject(opts.fullName, opts.occasion ?? "approved", g),
    theme: { departmentName: opts.departmentName ?? null, colorHex: opts.departmentColorHex ?? null },
    content: {
      tone: "celebrate",
      badge: approved ? "اعتُمد انضمامك" : "بطاقة العضوية",
      title: `أهلاً ${f.you} في العائلة، ${first}`,
      lead: approved
        ? `اعتُمد انضمامك إلى ${esc(brand.copy.phrase)}${as}. ومن اليوم ${G("أنت", "أنتِ", "أنت")} جزءٌ من تَـــلاقِ.`
        : `هذه بطاقة عضويتك في ${esc(brand.copy.phrase)} كما طلبتها.`,
      image: opts.cardUrl
        ? // البطاقةُ تُحفظ وتُنشر ولا تفتح شيئاً — الدخولُ للزرّ وحده (قرار المؤسس)
          { src: opts.cardUrl, width: 544, height: 680, alt: `بطاقة العضوية — ${opts.fullName}` }
        : undefined,
      paragraphs: approved ? [esc(brand.copy.belief), esc(brand.copy.aspiration)] : [],
      facts: [
        ["الاسم", opts.fullName],
        ["الصفة", role],
        ["المسمّى الوظيفي", job],
        ["القسم", opts.departmentName],
        ["تاريخ الانضمام", opts.joinedAt ? formatDate(opts.joinedAt) : null],
      ],
      cta: { label: "الدخول إلى المنصة", url: esc(opts.portalUrl) },
      after: [
        `البطاقة أعلاه ${f.toYou} — تُحفظ بضغطةٍ مطوّلة وتُنشر كما هي. ويسعدنا أن ${G("تشاركنا", "تشاركينا", "تشاركنا")} الخبر بالإشارة إلى <b dir="ltr">${esc(handle)}</b> ووسمِنا الرسمي <b>${esc(tag)}</b>.`,
        `أهلاً ${f.you} بيننا، ونتطلّع إلى ما سنصنعه معاً.`,
      ],
      note: `${G("احتفظ", "احتفظي", "يُحتفظ")} بهذه الرسالة: فيها البيانات كما سُجِّلت عندنا، وتصحيحُ أيّ خطأٍ فيها من صفحة «بياناتي».`,
    },
  };
}

/** يبني رسالة الترحيب كاملةً — للمعاينة والاختبار ولما يُرسَل فعلاً */
export function renderWelcomeEmail(opts: WelcomeEmailOpts): string {
  const w = welcomeContent(opts);
  return renderEmail({ subject: w.subject, content: w.content, theme: w.theme }).html;
}

export async function sendWelcomeEmail(opts: WelcomeEmailOpts & { to: string }) {
  const w = welcomeContent(opts);
  return send(
    opts.to,
    w.subject,
    w.content,
    "ترحيب",
    w.theme
  );
}

/** رسالة الختام — آخر ما يصل صاحبها من المنصة على الإطلاق.
 *
 *  التجربة لا تُقفل بانقطاع الرسائل فجأة: تُقفل بشكرٍ مكتوب وشهادةٍ
 *  سُلِّمت ووداعٍ صُنع. وبعدها يتوقّف البريد تماماً. */
export async function sendFarewellEmail(opts: {
  to: string;
  fullName: string;
  roleLabel: string;
  departmentName?: string | null;
  joinDate: Date;
  endDate: Date;
  /** سُلِّمت له شهادة؟ — من خرج خلال أول أسبوعين لا شهادة له، فلا يُقال إنها سُلِّمت */
  withCertificate?: boolean;
}) {
  const r = await recipientOf(opts.to);
  const f = forms(r.gender);
  const role = r.role ? roleTitle(r.role, r.gender, opts.departmentName ?? r.departmentName) : opts.roleLabel;
  return send(
    opts.to,
    `${f.thanks}، ${opts.fullName} — ختام تجربتك مع تَـــلاقِ`,
    {
      tone: "farewell",
      title: `${f.thanks}، ${firstName(opts.fullName)}`,
      lead: `انتهت رحلتك معنا رسمياً${opts.withCertificate === false ? "" : "، وسُلِّمت شهادتك"}. وما ${gx(r.gender, "قدّمتَه", "قدّمتِه", "قُدِّم")} لم يذهب: هو جزءٌ ممّا بناه الفريق، ويبقى في سجلّنا باسمك.`,
      facts: [
        ["الصفة", role],
        ["القسم", opts.departmentName],
        ["من", formatDate(opts.joinDate)],
        ["إلى", formatDate(opts.endDate)],
      ],
      note: "هذه آخر رسالة تصلك من المنصة. سجلّك محفوظٌ عندنا، وبابنا مفتوح.",
    },
    "ختام التجربة",
    { departmentName: opts.departmentName ?? r.departmentName, colorHex: r.colorHex }
  );
}

/** تذكير بتفعيل التحقق الثنائي — يتكرّر كل أسبوعين لمن لم يفعّله. */
export async function sendTotpNudgeEmail(opts: {
  to: string;
  fullName: string;
  securityUrl: string;
}) {
  const blocked = await suppressed("totp.nudge", opts.to, "تنبيه حماية", "تفعيل التحقق بخطوتين");
  if (blocked) return blocked;
  const r = await recipientOf(opts.to);

  return send(
    opts.to,
    "طريق دخولك الثاني لم يُفعَّل بعد — تَـــلاقِ",
    {
      tone: "security",
      title: "طريق دخولك الثاني لم يُفعَّل بعد",
      lead: `${esc(opts.fullName)}، دخولك إلى المنصة معلّقٌ ببريدك وحده. فإن تعذّر الوصول إليه يوماً — عطلٌ، أو تأخّر رمز، أو فقدانٌ للحساب — فلا طريق ثانياً.`,
      paragraphs: [
        "التحقق بخطوتين يحلّ هذا: يُفعَّل مرّة، فيكون الدخول بعدها برمز تطبيق المصادقة <b>أو</b> برمز البريد، أيّهما توفّر. والتفعيل يستغرق دقيقة.",
      ],
      cta: { label: "تفعيل التحقق بخطوتين", url: esc(opts.securityUrl) },
      note: "يصل هذا التذكير كل أسبوعين ما دام التحقق غير مفعَّل، ويتوقّف تلقائياً بتفعيله.",
    },
    "تذكير التحقق الثنائي",
    themeOf(r)
  );
}

/** اقتراحُ لجنةٍ — رسالةٌ واحدة إلى المعتمِد وحده.
 *
 *  مسارُ اللجنة رسالتان في عمرها كلّه: واحدةٌ تُخبر المعتمِد أن أمامه
 *  قراراً، وواحدةٌ تُخبر مقترِحها بما قُرِّر. */
export async function sendCommitteeRequestEmail(opts: {
  to: string;
  approverName: string;
  committeeName: string;
  parentName: string;
  leadTitle: string;
  requestedByName: string;
  reviewUrl: string;
}) {
  const r = await recipientOf(opts.to);
  return send(
    opts.to,
    `اقتراح لجنة «${opts.committeeName}» داخل ${opts.parentName}`,
    {
      tone: "action",
      title: `اقتراح لجنة «${opts.committeeName}»`,
      lead: `${esc(opts.approverName)}، رُفع اقتراحُ لجنةٍ داخل ${esc(opts.parentName)} من <b>${esc(opts.requestedByName)}</b>، وهو بانتظار قرارك.`,
      facts: [
        ["اللجنة", opts.committeeName],
        ["داخل قسم", opts.parentName],
        ["مسمّى قائدها", opts.leadTitle],
        ["مقدّم الاقتراح", opts.requestedByName],
      ],
      after: [
        "ولا تُفتح اللجنة باقتراحها: لا تظهر في الهيكل، ولا تُوجَّه إليها تذكرة، ولا يُدعى لها قائد — حتى تُعتمد. ومتى اعتُمدت صارت قسماً داخل قسمها بلونها ومسمّاها وبنك أسئلتها.",
      ],
      cta: { label: "فتح طلبات اللجان", url: esc(opts.reviewUrl) },
      note: "لا يقع الردّ بلا سببٍ مكتوب يقرؤه صاحب الاقتراح.",
    },
    "طلب لجنة",
    themeOf(r)
  );
}

/** قرارُ اللجنة — لمن اقترحها، فهو صاحب الشأن */
export async function sendCommitteeDecisionEmail(opts: {
  to: string;
  fullName: string;
  committeeName: string;
  parentName: string;
  approved: boolean;
  note: string | null;
  decidedByName: string;
  boardUrl: string;
}) {
  const r = await recipientOf(opts.to);
  const head = opts.approved
    ? `اعتُمدت لجنة «${opts.committeeName}» — وفُتحت`
    : `لم تُعتمد لجنة «${opts.committeeName}»`;

  return send(
    opts.to,
    head,
    {
      tone: opts.approved ? "celebrate" : "info",
      badge: opts.approved ? "اعتُمدت" : "قرار",
      title: head,
      lead: opts.approved
        ? `${esc(opts.fullName)}، اعتُمدت لجنة <b>${esc(opts.committeeName)}</b> داخل ${esc(opts.parentName)} — وفُتحت الآن.`
        : `${esc(opts.fullName)}، رُوجع اقتراحُ لجنة <b>${esc(opts.committeeName)}</b> داخل ${esc(opts.parentName)} ولم يُعتمد.`,
      quote: opts.note ? { label: opts.approved ? "ملاحظة المعتمِد" : "السبب", text: opts.note } : null,
      facts: [["القرار من", opts.decidedByName]],
      after: [
        opts.approved
          ? `والخطوة التالية من لوحة قسمك: <b>${gx(r.gender, "ادعُ قائدها", "ادعي قائدها", "دعوةُ قائدها")}</b> — ومن يُدعى لقيادتها يتولّاها بمسمّاها، ثم يدعو أعضاءها ويملأ بنك أسئلتهم.`
          : "واللجنة لم تُفتح: لا تظهر في الهيكل ولا يُدعى لها أحد. ويمكن إزالة الاقتراح من لوحة القسم، أو اقتراحُ لجنةٍ أخرى تُعالج السبب أعلاه.",
      ],
      cta: { label: "فتح لوحة القسم", url: esc(opts.boardUrl) },
    },
    "قرار لجنة",
    themeOf(r)
  );
}

/** ردُّ تسليمٍ للتصحيح — **الرسالةُ الوحيدة في نظام التنفيذ كلِّه.**
 *
 *  حدُّ الإرسال الشهريُّ محدود، وصاحبُ المنصة طلب صراحةً ألّا تمتلئ
 *  البرُد بما يُقرأ على المنصة. والردُّ وحده يخرج إلى البريد: صاحبُه قد
 *  يَحسب عملَه منتهياً فلا يَفتح المنصة أياماً، والمهلةُ تمضي عليه. */
export async function sendWorkReturnedEmail(opts: {
  to: string;
  fullName: string;
  taskTitle: string;
  reason: string;
  dueLabel: string;
  taskUrl: string;
}) {
  const r = await recipientOf(opts.to);
  return send(
    opts.to,
    `يحتاج تصحيحاً: ${opts.taskTitle}`,
    {
      tone: "action",
      badge: "يحتاج تصحيحاً",
      title: opts.taskTitle,
      lead: `${esc(opts.fullName)}، راجعت الإدارةُ التسليم وأعادته للتصحيح — <b>ولم يُحتسَب منجَزاً بعد</b>.`,
      quote: { label: "السبب كما كُتب", text: opts.reason },
      facts: [["الموعد", opts.dueLabel]],
      after: ["والتسليم السابق محفوظٌ لم يُمحَ: يُعدَّل ما طُلب ويُرفع ثانيةً، فيُراجَع من جديد."],
      cta: { label: "فتح الالتزام", url: esc(opts.taskUrl) },
      note: "هذه الرسالة الوحيدة التي يرسلها نظام التنفيذ؛ وبقيّة ما ينتظرك في لوحة «ما ينتظرك».",
    },
    "ردّ تسليم",
    themeOf(r)
  );
}
