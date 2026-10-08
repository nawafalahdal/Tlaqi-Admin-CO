import { readFileSync } from "fs";
import { join } from "path";
import { Resend } from "resend";
import { formatDate } from "@/lib/format";
import { appendEmailLog } from "@/lib/googleSheets";
import { prisma } from "@/lib/prisma";
import { wrapEmail, htmlToText, variantForKind, appBaseUrl, SOCIAL_HANDLE } from "@/lib/emailBrand";

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
  status: "أُرسلت" | "لم تُرسل (البريد معطّل)" | "فشل الإرسال"
) {
  const at = new Date();
  // قاعدة البيانات أولاً لأنها مصدر صفحة "سجل الرسائل" داخل المنصة،
  // ثم الشيت نسخةً للمراجعة الخارجية. فشل أيٍّ منهما لا يُفشل الإرسال:
  // رسالة وصلت فعلاً ثم تعذّر تسجيلها تبقى واصلة.
  try {
    await prisma.emailLog.createMany({
      data: recipients.map((recipient) => ({ recipient, kind, subject, status, createdAt: at })),
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

async function send(
  to: string | string[],
  subject: string,
  html: string,
  kind = "عام",
  /** ترويسة بديلة لهذه الرسالة — تمرّ كما هي إلى الغلاف */
  hero?: { src: string; width: number; height: number; alt: string }
) {
  const all = Array.isArray(to) ? to.filter(Boolean) : [to].filter(Boolean);
  if (all.length === 0) return { skipped: true };

  // رسالة الوداع نفسها تمرّ قبل أن يُرفع العلم، فلا تحجب نفسها
  const recipients = await withoutClosedRecipients(all);
  if (recipients.length === 0) return { skipped: true };

  if (!resend) {
    // لا نطبع محتوى الرسالة كاملاً (قد يحمل كلمة مرور مؤقتة أو رابطاً حساساً) — فقط عنوانها ومستلمها
    console.warn(
      `[email:disabled] لم يُضبط RESEND_API_KEY — تم تجاهل إرسال بريد بعنوان "${subject}" إلى: ${recipients.join(", ")}`
    );
    await logEmail(recipients, kind, subject, "لم تُرسل (البريد معطّل)");
    return { skipped: true };
  }
  try {
    // الهوية تُضاف هنا لا في كل دالة: متن الرسالة يصف ما حدث، والغلاف
    // يصنع شكلها — فلا تتفرّق الهوية على تسع عشرة دالة ولا تُنسى في واحدة.
    const wrapped = wrapEmail({
      title: subject,
      bodyHtml: html,
      preheader: subject,
      // التصميم يُشتقّ من وسم النوع الذي تمرّره كل دالة أصلاً، فلا دالة
      // تختار تصميمها ولا تنساه — وما لا وسم له يأخذ العام
      variant: variantForKind(kind),
      hero,
    });
    await resend.emails.send({
      from: FROM,
      to: recipients,
      subject,
      html: wrapped,
      // النسخة النصّية ليست ترفاً: رسالة HTML بلا بديل نصّي علامةٌ معروفة
      // عند مرشّحات السبام، وتصل مشوّهة لمن يقرأ بالنص المجرّد
      text: htmlToText(html),
      headers: {
        // يمنع تجميع الرسائل المتتابعة في خيط واحد عند Gmail
        "X-Entity-Ref-ID": `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      },
    });
    await logEmail(recipients, kind, subject, "أُرسلت");
    return { skipped: false };
  } catch (err) {
    console.error("فشل إرسال البريد:", err);
    await logEmail(recipients, kind, subject, "فشل الإرسال");
    return { skipped: true, error: true };
  }
}

/** يُرسل رسالة مبنيّة كاملةً، بلا غلاف.
 *
 *  أكثر الرسائل متنٌ يلفّه `send` بهوية المنصة. وبعضها — كقالب الترحيب
 *  الرسمي — وثيقة HTML قائمة بذاتها لها ترويستها وتذييلها، فلفّها يُنتج
 *  رسالةً بترويستين. وما عدا الغلاف يبقى كما هو: فحص من أُغلقت تجربته،
 *  والنسخة النصّية، والتسجيل في السجلّ.
 */
async function sendPrebuilt(to: string | string[], subject: string, html: string, kind: string) {
  const all = Array.isArray(to) ? to.filter(Boolean) : [to].filter(Boolean);
  if (all.length === 0) return { skipped: true };
  const recipients = await withoutClosedRecipients(all);
  if (recipients.length === 0) return { skipped: true };

  if (!resend) {
    console.warn(
      `[email:disabled] لم يُضبط RESEND_API_KEY — تم تجاهل إرسال بريد بعنوان "${subject}" إلى: ${recipients.join(", ")}`
    );
    await logEmail(recipients, kind, subject, "لم تُرسل (البريد معطّل)");
    return { skipped: true };
  }
  try {
    await resend.emails.send({
      from: FROM,
      to: recipients,
      subject,
      html,
      text: htmlToText(html),
      headers: {
        "X-Entity-Ref-ID": `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      },
    });
    await logEmail(recipients, kind, subject, "أُرسلت");
    return { skipped: false };
  } catch (err) {
    console.error("فشل إرسال البريد:", err);
    await logEmail(recipients, kind, subject, "فشل الإرسال");
    return { skipped: true, error: true };
  }
}

export async function sendInviteEmail(opts: {
  to: string;
  fullName: string;
  roleLabel: string;
  inviteUrl: string;
}) {
  return send(
    opts.to,
    `دعوتك للانضمام إلى تَـــلاقِ — ${opts.roleLabel}`,
    `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif">
      <p>مرحباً ${esc(opts.fullName)}،</p>
      <p>تمت دعوتك للانضمام إلى منصة <strong>تَـــلاقِ</strong> بصفة <strong>${esc(opts.roleLabel)}</strong>.</p>
      <p><a href="${opts.inviteUrl}" style="background:#C34900;color:#fff;padding:10px 18px;border-radius:10px;text-decoration:none">فتح رابط الدعوة</a></p>
      <p style="color:#777;font-size:12px">هذا الرابط مخصص لك فقط بالاسم والبريد المذكورين.</p>
    </div>`,
    "دعوة"
  );
}

export async function sendCredentialsEmail(opts: {
  to: string;
  fullName: string;
  tempPassword: string;
  loginUrl: string;
}) {
  return send(
    opts.to,
    "تم اعتماد انضمامك إلى تَـــلاقِ — بيانات الدخول",
    `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif">
      <p>مرحباً ${esc(opts.fullName)}،</p>
      <p>تهانينا، تم اعتماد انضمامك. يمكنك الآن الدخول إلى المنصة بالبيانات التالية:</p>
      <p>البريد الإلكتروني: <strong dir="ltr">${esc(opts.to)}</strong><br/>
         كلمة المرور المؤقتة: <strong dir="ltr">${esc(opts.tempPassword)}</strong></p>
      <p><a href="${opts.loginUrl}" style="background:#341D2B;color:#fff;padding:10px 18px;border-radius:10px;text-decoration:none">تسجيل الدخول</a></p>
      <p style="color:#777;font-size:12px">سيُطلب منك تغيير كلمة المرور فور الدخول الأول.</p>
    </div>`,
    "بيانات الدخول"
  );
}

export async function sendWarningEmail(opts: {
  to: string;
  fullName: string;
  reason: string;
  warningsCount: number;
  loginUrl: string;
}) {
  const isFinal = opts.warningsCount >= 3;
  return send(
    opts.to,
    isFinal ? "إشعار إنهاء العضوية — تَـــلاقِ" : `تنبيه (${opts.warningsCount}/3) — تَـــلاقِ`,
    `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif">
      <p>مرحباً ${esc(opts.fullName)}،</p>
      ${
        isFinal
          ? `<p>نظراً لتجاوز عدد التنبيهات المسموح (3)، نأسف لإبلاغك بإنهاء عضويتك في المنصة.</p>
             <p>السبب الأخير: ${esc(opts.reason)}</p>`
          : `<p>وصلك تنبيه رقم <strong>${opts.warningsCount} من 3</strong>:</p>
             <p>${esc(opts.reason)}</p>
             <p>يرجى الدخول إلى المنصة لتأكيد الاطلاع عليه.</p>
             <p><a href="${opts.loginUrl}" style="background:#C34900;color:#fff;padding:10px 18px;border-radius:10px;text-decoration:none">الدخول إلى المنصة</a></p>`
      }
    </div>`,
    "تنبيه"
  );
}

export async function sendExitEmail(opts: { to: string; fullName: string; reason: string }) {
  return send(
    opts.to,
    "إنهاء العضوية — تَـــلاقِ",
    `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif">
      <p>مرحباً ${esc(opts.fullName)}،</p>
      <p>نحيطك علماً بإنهاء عضويتك في منصة تَـــلاقِ.</p>
      <p>السبب: ${esc(opts.reason)}</p>
    </div>`,
    "إنهاء عضوية"
  );
}

export async function sendCertificateEmail(opts: { to: string; fullName: string }) {
  return send(
    opts.to,
    "شهادة إتمام — تَـــلاقِ",
    `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif">
      <p>مرحباً ${esc(opts.fullName)}،</p>
      <p>يسعدنا إبلاغك بإصدار شهادة إتمام لك تقديراً لمسيرتك في منصة تَـــلاقِ.</p>
    </div>`,
    "شهادة إتمام"
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
  return send(
    opts.to,
    `تذكرة جديدة: ${opts.subject}`,
    `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif">
      <p>رفع العضو <strong>${esc(opts.memberName)}</strong> تذكرة جديدة:</p>
      <p><strong>${esc(opts.subject)}</strong></p>
      <p>${esc(opts.description)}</p>
      ${opts.linkUrl ? `<p style="font-size:14px">الرابط المرفق: <a href="${esc(opts.linkUrl)}" style="color:#8C3600;font-weight:bold" dir="ltr">${esc(opts.linkUrl)}</a></p>` : ""}
      <p>المهلة للرد: ${formatDate(opts.dueDate)} — إذا لم يُستجب خلالها تتصعّد التذكرة تلقائياً.</p>
      <p><a href="${opts.portalUrl}" style="background:#C34900;color:#fff;padding:10px 18px;border-radius:10px;text-decoration:none">فتح المنصة</a></p>
    </div>`,
    "تذكرة جديدة"
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
  return send(
    opts.to,
    `تذكرة متصعّدة إليك: ${opts.subject}`,
    `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif">
      <p>لم تُحل تذكرة العضو <strong>${esc(opts.memberName)}</strong> خلال المهلة المحددة، وتصعّدت الآن إلى: <strong>${esc(opts.stageLabel)}</strong>.</p>
      <p><strong>${esc(opts.subject)}</strong></p>
      <p>${esc(opts.description)}</p>
      ${opts.dueDate ? `<p>المهلة الجديدة: ${formatDate(opts.dueDate)}</p>` : ""}
      <p><a href="${opts.portalUrl}" style="background:#341D2B;color:#fff;padding:10px 18px;border-radius:10px;text-decoration:none">فتح المنصة</a></p>
    </div>`,
    "تصعيد تذكرة"
  );
}

export async function sendTicketResolvedEmail(opts: {
  to: string;
  subject: string;
  resolutionNote: string;
}) {
  return send(
    opts.to,
    `تم حل تذكرتك: ${opts.subject}`,
    `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif">
      <p>تم التعامل مع تذكرتك: <strong>${esc(opts.subject)}</strong>.</p>
      <p>${esc(opts.resolutionNote)}</p>
    </div>`,
    "حل تذكرة"
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
  return send(
    opts.to,
    `تذكير — تذكرة لم تُحل بعد: ${opts.subject}`,
    `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif">
      <p>تذكير من ${esc(opts.fromName)} (مسؤول التشغيل): التذكرة التالية ما زالت بانتظار ردك كـ<strong>${esc(opts.stageLabel)}</strong>:</p>
      <p><strong>${esc(opts.subject)}</strong> — من العضو ${esc(opts.memberName)}</p>
      <p>الموعد النهائي: ${formatDate(opts.dueDate)}</p>
      <p><a href="${opts.portalUrl}" style="background:#C34900;color:#fff;padding:10px 18px;border-radius:10px;text-decoration:none">فتح المنصة</a></p>
    </div>`,
    "تذكير تذكرة"
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
  return send(
    opts.to,
    `تذكير — طلب بانتظار الإنجاز: ${opts.typeLabel}`,
    `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif">
      <p>تذكير من ${esc(opts.fromName)} (مسؤول التشغيل): الطلب التالي ما زال بانتظار الإنجاز:</p>
      <p><strong>${esc(opts.typeLabel)}</strong>${opts.memberName ? ` — متعلق بـ ${esc(opts.memberName)}` : ""}</p>
      ${opts.note ? `<p>${esc(opts.note)}</p>` : ""}
      ${opts.dueDate ? `<p>الموعد النهائي: ${formatDate(opts.dueDate)}</p>` : ""}
    </div>`,
    "تذكير طلب"
  );
}

export async function sendMeetingReminderEmail(opts: {
  to: string;
  candidateName: string;
  dueDate: Date;
}) {
  return send(
    opts.to,
    `طلب اجتماع شرح — ${opts.candidateName}`,
    `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif">
      <p>المرشح <strong>${esc(opts.candidateName)}</strong> لم يحقق نسبة النجاح في الاختبار.</p>
      <p>يرجى جدولة اجتماع شرح قبل ${formatDate(opts.dueDate)}.</p>
    </div>`,
    "اجتماع شرح"
  );
}

/** تهنئة فور اجتياز الاختبار — تُطمئن المرشّح أن نتيجته وصلت القيادة،
 *  فلا يبقى في فراغ بين الاختبار والقرار */
export async function sendTestPassedEmail(opts: {
  to: string;
  fullName: string;
  score: number;
  roleLabel: string;
}) {
  return send(
    opts.to,
    `مبروك — اجتزت اختبار القبول (${opts.score}%)`,
    `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif">
      <p>مرحباً ${esc(opts.fullName)}،</p>
      <p style="font-size:17px"><strong>مبروك! اجتزت اختبار القبول بنتيجة ${opts.score}%.</strong></p>
      <p>تقدّمت لصفة <strong>${esc(opts.roleLabel)}</strong>، ونتيجتك وصلت القيادة للاعتماد النهائي.</p>
      <p>بمجرد اعتمادك تُفتح لك بوابتك كاملة <strong>بنفس كلمة المرور التي اخترتها</strong> — لن يُرسل لك رمز جديد.</p>
      <p style="color:#777;font-size:12px">سيصلك إشعار فور صدور القرار.</p>
    </div>`,
    "اجتياز الاختبار"
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
  return send(
    opts.to,
    "نتيجة اختبار القبول — اجتماع شرح قادم",
    `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif">
      <p>مرحباً ${esc(opts.fullName)}،</p>
      <p>نتيجتك في اختبار القبول كانت <strong>${opts.score}%</strong>، ولم تبلغ الحد المطلوب هذه المرة.</p>
      <p>تم إبلاغ <strong>${esc(opts.departmentName)}</strong> لجدولة <strong>اجتماع شرح</strong> معك قبل
        ${esc(formatDate(opts.dueDate))}، يوضّح لك المتوقع ويجيب أسئلتك.</p>
      <p><strong>حسابك يبقى قائماً</strong> ولا تحتاج إنشاء حساب جديد.</p>
    </div>`,
    "عدم اجتياز الاختبار"
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
  return send(
    opts.to,
    `مطلوب جدولة اجتماع شرح — ${opts.candidateName}`,
    `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif">
      <p>وصل طلب جديد إلى <strong>${esc(opts.departmentName)}</strong>:</p>
      <p><strong>${esc(opts.candidateName)}</strong> (${esc(opts.candidateEmail)}) لم يجتز اختبار القبول
        بنتيجة <strong>${opts.score}%</strong>.</p>
      <p>المطلوب: جدولة <strong>اجتماع شرح</strong> معه قبل <strong>${esc(formatDate(opts.dueDate))}</strong>.</p>
      <p>الطلب مسجّل في لوحة قسمكم ضمن الطلبات، ويُتابَع آلياً حتى إنجازه.</p>
    </div>`,
    "تكليف اجتماع شرح"
  );
}

/** تذكير قبل سقوط مهلة الـ24 ساعة — فرصة أخيرة قبل أن يفقد الرمز صلاحيته */
export async function sendWindowReminderEmail(opts: {
  to: string;
  fullName: string;
  hoursLeft: number;
  loginUrl: string;
}) {
  return send(
    opts.to,
    `تبقّى ${opts.hoursLeft} ساعة لتفعيل حسابك في تَـــلاقِ`,
    `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif">
      <p>مرحباً ${esc(opts.fullName)}،</p>
      <p>أُنشئ لك حساب في <strong>تَـــلاقِ</strong> ولم تدخل إليه بعد.</p>
      <p style="background:#FFF1DE;border-radius:10px;padding:12px">
        <strong>يتبقّى ${opts.hoursLeft} ساعة</strong> قبل أن يسقط الحساب تلقائياً وتفقد كلمة المرور المؤقتة صلاحيتها.
      </p>
      <p><a href="${opts.loginUrl}" style="background:#C34900;color:#fff;padding:10px 18px;border-radius:10px;text-decoration:none">تسجيل الدخول الآن</a></p>
      <p style="color:#777;font-size:12px">إن لم تصلك كلمة المرور المؤقتة أو ضاعت، تواصل مع من أنشأ حسابك.</p>
    </div>`,
    "تذكير قبل سقوط المهلة"
  );
}

/** إشعار الاعتماد النهائي — يُغلق دائرة الانتظار */
/** رابط استعادة كلمة المرور — صالح لمدة محدودة ولمرة واحدة */
export async function sendPasswordResetEmail(opts: {
  to: string;
  fullName: string;
  resetUrl: string;
  minutesValid: number;
}) {
  return send(
    opts.to,
    "استعادة كلمة المرور — تَـــلاقِ",
    `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif">
      <p>مرحباً ${esc(opts.fullName)}،</p>
      <p>وصلنا طلب لاستعادة كلمة مرور حسابك في <strong>تَـــلاقِ</strong>.</p>
      <p><a href="${opts.resetUrl}" style="background:#C34900;color:#fff;padding:10px 18px;border-radius:10px;text-decoration:none">تعيين كلمة مرور جديدة</a></p>
      <p style="color:#777;font-size:13px">الرابط صالح <strong>${opts.minutesValid} دقيقة</strong> ويُستخدم مرة واحدة.</p>
      <p style="color:#777;font-size:12px">إن لم تطلب هذا، تجاهل الرسالة — لن يتغيّر شيء في حسابك.</p>
    </div>`,
    "استعادة كلمة المرور"
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
  return send(
    opts.to,
    "أُعيد فتح اختبار القبول لك — تَـــلاقِ",
    `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif">
      <p>مرحباً ${esc(opts.fullName)}،</p>
      <p>بعد اجتماع الشرح، أُعيد فتح اختبار القبول لموقع <strong>${esc(opts.roleLabel)}</strong>.</p>
      <p>ادخل بالحساب نفسه وابدأ الاختبار. المهلة <strong>${opts.hoursValid} ساعة</strong> من الآن.</p>
      <p><a href="${opts.loginUrl}" style="background:#C34900;color:#fff;padding:10px 18px;border-radius:10px;text-decoration:none">فتح المنصة</a></p>
      <p style="color:#666;font-size:13px">إن لم تدخل خلال المهلة يُغلق الحساب تلقائياً.</p>
    </div>`,
    "إعادة فتح الاختبار"
  );
}

/** يبثّ إعلاناً إلى بريد جمهوره.
 *
 *  يُرسَل نسخةً واحدةً لكل مستلم (لا دفعة واحدة في حقل "إلى") حتى لا يرى
 *  أحدٌ عناوين البقية: إعلان داخلي لا يجوز أن يكشف دليل بريد الفريق. */
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
  // الاجتماع أبرز من الرابط العام: من يفتح إعلان اجتماع يبحث عن رابطه
  // أولاً، فيُعطى زرّاً لا سطراً يُقرأ
  const meetingBlock = opts.meetingUrl
    ? `<p style="margin:0 0 14px"><a href="${esc(opts.meetingUrl)}" style="display:inline-block;background:#341D2B;color:#EEF6DF;text-decoration:none;font-weight:bold;font-size:14px;padding:12px 26px;border-radius:999px">انضم إلى الاجتماع</a></p>`
    : "";
  const linkBlock = opts.linkUrl
    ? `<p style="margin:0 0 14px;font-size:14px">${esc(opts.linkLabel || "الرابط")}: <a href="${esc(opts.linkUrl)}" style="color:#8C3600;font-weight:bold" dir="ltr">${esc(opts.linkUrl)}</a></p>`
    : "";

  let delivered = 0;
  for (const to of opts.recipients) {
    const result = await send(
      to,
      `إعلان: ${opts.title}`,
      `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif">
        <p style="color:#666;font-size:13px;margin:0 0 6px">إعلان موجَّه إلى: ${esc(opts.audienceLabel)}</p>
        <h2 style="margin:0 0 10px;color:#341D2B">${esc(opts.title)}</h2>
        <div style="white-space:pre-wrap;font-size:15px;line-height:1.8;margin-bottom:16px">${esc(opts.body)}</div>
        ${meetingBlock}
        ${linkBlock}
        <p style="color:#666;font-size:13px;margin-top:18px">نشره: ${esc(opts.authorName)}</p>
        <p><a href="${opts.portalUrl}" style="background:#C34900;color:#fff;padding:10px 18px;border-radius:10px;text-decoration:none">فتح المنصة</a></p>
      </div>`,
      "إعلان عام"
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
  // الخانات في خلايا منفصلة لا بمسافات: الفراغات المتتابعة تتمدّد عشوائياً
  // بحسب العميل فتتباعد الأرقام حتى يصعب قراءتها رقماً واحداً
  const cells = opts.code
    .split("")
    .map(
      (d) =>
        `<td align="center" style="padding:0 3px"><div style="width:42px;height:54px;line-height:54px;background:#ffffff;border:1px solid rgba(52,29,43,0.14);border-radius:10px;font-family:'Courier New',Consolas,monospace;font-size:28px;font-weight:bold;color:#341D2B">${d}</div></td>`
    )
    .join("");

  return send(
    opts.to,
    `رمز دخولك: ${opts.code} — تَـــلاقِ`,
    `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif">
      <p>مرحباً ${esc(opts.fullName)}،</p>
      <p>وصلنا طلب دخول إلى حسابك. أدخل الرمز التالي لإكمال الدخول:</p>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" dir="ltr" style="margin:20px auto 10px">
        <tr>${cells}</tr>
      </table>
      <p align="center" style="font-size:12px;color:#8a8a8a;margin:0 0 20px">صالح ${opts.minutesValid} دقائق · يُستخدم مرة واحدة</p>
      <p style="color:#8a8a8a;font-size:13px;margin:0">إن طلبت رمزاً جديداً بطل هذا فوراً.</p>
    </div>`,
    "رمز الدخول"
  );
}

/** صفٌّ في بطاقة البيانات: ما لا قيمة له لا يُرسم أصلاً بدل أن يظهر فارغاً.
 *
 *  الفاصلة بين العنوان وقيمته على يمين القيمة لا يسارها: الجدول عربي،
 *  فالعنوان يمينٌ والقيمة يسارُه، وحافّتها المواجهة له هي اليمنى. ووضعُها
 *  يساراً كان يبدو سليماً في كل صف إلا الأطول — حيث يملأ العنوان عمودَه
 *  فتلتصق القيمة به: «التخصصإدارة أعمال». */
function factRow(label: string, value: string | null | undefined): string {
  if (!value || !value.trim()) return "";
  return `<tr>
    <td style="padding:7px 0;font-size:13px;color:rgba(26,16,35,0.55);white-space:nowrap">${esc(label)}</td>
    <td style="padding:7px 14px 7px 0;font-size:14px;font-weight:bold;color:#1A1023">${esc(value)}</td>
  </tr>`;
}

export type WelcomeEmailOpts = {
  fullName: string;
  roleLabel: string;
  jobTitle?: string | null;
  specialization?: string | null;
  section?: string | null;
  departmentName?: string | null;
  portalUrl: string;
  joinedAt?: Date | null;
  /** عدّة المشاركة — تُدرَج داخل الرسالة نفسها لا في رسالة ثانية */
  handles?: { label: string; handle: string; url: string }[];
  hashtag?: string;
  /** `approved`: تصل لحظة الاعتماد فتُعلنه. `resend`: يطلبها صاحبها لأنها
   *  ضاعت منه، فلا تُعلن خبراً قديماً وكأنه جديد. */
  occasion?: "approved" | "resend";
};

/** قالب الترحيب الرسمي — يُقرأ من `src/emails/welcome.html`.
 *
 *  القالب ملفّ HTML قائم بذاته لا نصّ داخل الكود، لسببين: يُفتح في
 *  المتصفّح ويُراجَع كما يُرسل بالضبط، ويُسلَّم لأي نظام إرسال آخر دون
 *  أن يُنتزع من بين سطور TypeScript.
 *
 *  ولأنه القالب الرسمي الدائم، تبديل المتغيّرات وحده يكفي لتخصيصه — لا
 *  تُلمس بنيته عند كل مستقبِل. */
const WELCOME_TEMPLATE_PATH = join(process.cwd(), "src/emails/welcome.html");

let welcomeTemplateCache: string | null = null;

function welcomeTemplate(): string {
  // يُقرأ مرة واحدة لكل نسخة من الخادم: ملفٌّ ثابت لا داعي لقراءته مع
  // كل رسالة. وفي التطوير يُعاد تحميل الوحدة مع كل تعديل فيُقرأ من جديد.
  if (welcomeTemplateCache === null) {
    welcomeTemplateCache = readFileSync(WELCOME_TEMPLATE_PATH, "utf8");
  }
  return welcomeTemplateCache;
}

/** يملأ متغيّرات القالب.
 *
 *  كل قيمة تُهرَّب قبل الإدراج: الاسم والصفة يكتبهما بشر، ووضعُهما في
 *  HTML بلا تهريب يفتح باب وسمٍ مدسوس في بريدٍ يحمل اسمنا. وما لا قيمة
 *  له يُكتب شَرطةً بدل أن يظهر `{{team}}` كما هو لمن لا فريق له. */
function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_m, key: string) => {
    const value = vars[key];
    if (value === undefined) return "—";
    // الروابط لا تُهرَّب كنصّ: هي سمات href، وتهريب & يكسر معاملاتها.
    // وهي من عندنا لا من المستخدم، ويُتحقّق منها عند الضبط.
    return key.endsWith("_url") || key === "asset_base" ? value : esc(value);
  });
}

export function welcomeEmailSubject(fullName: string, occasion: "approved" | "resend" = "approved") {
  // العنوان يقول ما تقوله الترويسة: من يرى «أهلاً بك» في صندوقه ثم يفتح
  // فيجد العبارة نفسها كبيرةً يشعر برسالة واحدة لا باثنتين
  return occasion === "approved"
    ? `أهلاً بك في عائلة تَـــلاقِ، ${fullName}!`
    : `بطاقتك في تَـــلاقِ، ${fullName}`;
}

/** رسالة الانضمام — تُعلن الاعتماد وتُرحّب وتحمل عدّة المشاركة معاً.
 *
 *  هي الموضع الوحيد الذي يقرأ فيه الواحد اسمه ومهمته كما سُجِّلت، فيعرف
 *  أن له مكاناً مُثبَتاً لا مجرّد حساب. */
/** يبني الرسالة كاملةً من القالب الرسمي.
 *
 *  لا تمرّ على `wrapEmail`: القالب غلافٌ كامل بترويسته وتذييله، ولفّه
 *  بغلافٍ ثانٍ يُنتج رسالةً بترويستين. */
export function renderWelcomeEmail(opts: WelcomeEmailOpts): string {
  const base = appBaseUrl();
  const firstName = opts.fullName.trim().split(/\s+/)[0] || opts.fullName;
  return fillTemplate(welcomeTemplate(), {
    first_name: firstName,
    full_name: opts.fullName,
    role: opts.roleLabel,
    team: opts.departmentName?.trim() || opts.jobTitle?.trim() || "—",
    join_date: opts.joinedAt ? formatDate(opts.joinedAt) : "—",
    portal_url: opts.portalUrl,
    asset_base: base,
    handle: `@${SOCIAL_HANDLE}`,
    x_url: `https://x.com/${SOCIAL_HANDLE}`,
    instagram_url: `https://instagram.com/${SOCIAL_HANDLE}`,
    linkedin_url: `https://linkedin.com/company/${SOCIAL_HANDLE}`,
  });
}

export async function sendWelcomeEmail(opts: WelcomeEmailOpts & { to: string }) {
  return sendPrebuilt(
    opts.to,
    welcomeEmailSubject(opts.fullName, opts.occasion ?? "approved"),
    renderWelcomeEmail(opts),
    "ترحيب"
  );
}

/** رسالة الختام — آخر ما يصل صاحبها من المنصة على الإطلاق.
 *
 *  التجربة لا تُقفل بانقطاع الرسائل فجأة: تُقفل بشكرٍ مكتوب وشهادةٍ
 *  سُلِّمت ووداعٍ صُنع. وبعدها يتوقّف البريد تماماً — فالاحترام أن
 *  نَكُفّ عن المراسلة لا أن نستمر بها بلا سبب. */
export async function sendFarewellEmail(opts: {
  to: string;
  fullName: string;
  roleLabel: string;
  departmentName?: string | null;
  joinDate: Date;
  endDate: Date;
}) {
  return send(
    opts.to,
    `شكراً لك، ${opts.fullName} — ختام تجربتك مع تَـــلاقِ`,
    `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif">
      <p style="font-size:17px;font-weight:bold;margin:0 0 14px">شكراً لك، ${esc(opts.fullName)}.</p>
      <p style="margin:0 0 16px">انتهت رحلتك معنا رسمياً، وسُلِّمت شهادتك. ما قدّمته لم يذهب: هو جزء ممّا بناه الفريق، ويبقى في سجلّنا باسمك.</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;border:1px solid rgba(52,29,43,0.12);border-radius:12px;background:#FAF8F4">
        <tr><td style="padding:10px 16px">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0">
            ${factRow("الصفة", opts.roleLabel)}
            ${factRow("القسم", opts.departmentName)}
            ${factRow("من", formatDate(opts.joinDate))}
            ${factRow("إلى", formatDate(opts.endDate))}
          </table>
        </td></tr>
      </table>
      <p style="margin:0;font-size:13px;color:rgba(26,16,35,0.6)">ولأن التجربة انتهت، لن تصلك منّا رسائل بعد اليوم. دمت بخير.</p>
    </div>`,
    "ختام التجربة"
  );
}

/** تذكير بتفعيل التحقق الثنائي — يتكرّر كل أسبوعين لمن لم يفعّله. */
export async function sendTotpNudgeEmail(opts: {
  to: string;
  fullName: string;
  securityUrl: string;
}) {
  return send(
    opts.to,
    "طريق دخولك الثاني لم يُفعَّل بعد — تَـــلاقِ",
    `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif">
      <p>مرحباً ${esc(opts.fullName)}،</p>
      <p style="margin:0 0 16px">دخولك إلى المنصة معلّق ببريدك وحده. إن تعذّر الوصول إليه يوماً — عطلٌ، أو تأخّر رمز، أو فقدان للحساب — فلا طريق ثانياً لك.</p>
      <p style="margin:0 0 16px">التحقق الثنائي يحلّ هذا: تُفعّله مرة، فتدخل بعدها برمز تطبيق المصادقة <b>أو</b> برمز البريد، أيّهما توفّر. والتفعيل يستغرق دقيقة.</p>
      <p style="margin:0 0 20px"><a href="${opts.securityUrl}" style="display:inline-block;background:#341D2B;color:#EEF6DF;text-decoration:none;font-weight:bold;font-size:14px;padding:12px 26px;border-radius:999px">فعّله الآن</a></p>
      <p style="margin:0;font-size:13px;color:rgba(26,16,35,0.6)">يصلك هذا التذكير كل أسبوعين ما دام غير مُفعَّل، ويتوقّف من تلقائه بمجرد تفعيله.</p>
    </div>`,
    "تذكير التحقق الثنائي"
  );
}
