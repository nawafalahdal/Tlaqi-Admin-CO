import { Resend } from "resend";
import { formatDate } from "@/lib/format";

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const FROM = process.env.EMAIL_FROM || "Tlaqi <onboarding@tlaqi.co>";

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

async function send(to: string | string[], subject: string, html: string) {
  const recipients = Array.isArray(to) ? to.filter(Boolean) : [to];
  if (recipients.length === 0) return { skipped: true };

  if (!resend) {
    // لا نطبع محتوى الرسالة كاملاً (قد يحمل كلمة مرور مؤقتة أو رابط دعوة حساس) — فقط عنوان الرسالة ومستلمها
    console.warn(
      `[email:disabled] لم يُضبط RESEND_API_KEY — تم تجاهل إرسال بريد بعنوان "${subject}" إلى: ${recipients.join(", ")}`
    );
    return { skipped: true };
  }
  try {
    await resend.emails.send({ from: FROM, to: recipients, subject, html });
    return { skipped: false };
  } catch (err) {
    console.error("فشل إرسال البريد:", err);
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
    </div>`
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
    </div>`
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
    </div>`
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
    </div>`
  );
}

export async function sendCertificateEmail(opts: { to: string; fullName: string }) {
  return send(
    opts.to,
    "شهادة إتمام — تَـــلاقِ",
    `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif">
      <p>مرحباً ${esc(opts.fullName)}،</p>
      <p>يسعدنا إبلاغك بإصدار شهادة إتمام لك تقديراً لمسيرتك في منصة تَـــلاقِ.</p>
    </div>`
  );
}

export async function sendTicketCreatedEmail(opts: {
  to: string | string[];
  subject: string;
  description: string;
  memberName: string;
  dueDate: Date;
  portalUrl: string;
}) {
  return send(
    opts.to,
    `تذكرة جديدة: ${opts.subject}`,
    `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif">
      <p>رفع العضو <strong>${esc(opts.memberName)}</strong> تذكرة جديدة:</p>
      <p><strong>${esc(opts.subject)}</strong></p>
      <p>${esc(opts.description)}</p>
      <p>المهلة للرد: ${formatDate(opts.dueDate)} — إذا لم يُستجب خلالها تتصعّد التذكرة تلقائياً.</p>
      <p><a href="${opts.portalUrl}" style="background:#C34900;color:#fff;padding:10px 18px;border-radius:10px;text-decoration:none">فتح المنصة</a></p>
    </div>`
  );
}

export async function sendTicketConfirmationEmail(opts: { to: string; subject: string; dueDate: Date }) {
  return send(
    opts.to,
    `تم استلام تذكرتك: ${opts.subject}`,
    `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif">
      <p>تم رفع تذكرتك بنجاح: <strong>${esc(opts.subject)}</strong>.</p>
      <p>سيتم الرد خلال يومين (قبل ${formatDate(opts.dueDate)})، وإذا لم يحدث ذلك تتصعّد تلقائياً للمستوى التالي — نظامنا صارم وواضح.</p>
    </div>`
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
    </div>`
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
    </div>`
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
    </div>`
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
    </div>`
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
    </div>`
  );
}
