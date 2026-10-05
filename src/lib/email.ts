import { Resend } from "resend";
import { formatDate } from "@/lib/format";

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const FROM = process.env.EMAIL_FROM || "Tlaqi <onboarding@tlaqi.co>";

async function send(to: string, subject: string, html: string) {
  if (!resend) {
    console.warn(`[email:disabled] لم يُضبط RESEND_API_KEY — سيُطبع البريد هنا فقط.`);
    console.warn(`→ إلى: ${to} | الموضوع: ${subject}\n${html}`);
    return { skipped: true };
  }
  try {
    await resend.emails.send({ from: FROM, to, subject, html });
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
    `دعوتك للانضمام إلى تلاقي — ${opts.roleLabel}`,
    `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif">
      <p>مرحباً ${opts.fullName}،</p>
      <p>تمت دعوتك للانضمام إلى منصة <strong>تلاقي</strong> بصفة <strong>${opts.roleLabel}</strong>.</p>
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
    "تم اعتماد انضمامك إلى تلاقي — بيانات الدخول",
    `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif">
      <p>مرحباً ${opts.fullName}،</p>
      <p>تهانينا، تم اعتماد انضمامك. يمكنك الآن الدخول إلى المنصة بالبيانات التالية:</p>
      <p>البريد الإلكتروني: <strong dir="ltr">${opts.to}</strong><br/>
         كلمة المرور المؤقتة: <strong dir="ltr">${opts.tempPassword}</strong></p>
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
    isFinal ? "إشعار إنهاء العضوية — تلاقي" : `تنبيه (${opts.warningsCount}/3) — تلاقي`,
    `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif">
      <p>مرحباً ${opts.fullName}،</p>
      ${
        isFinal
          ? `<p>نظراً لتجاوز عدد التنبيهات المسموح (3)، نأسف لإبلاغك بإنهاء عضويتك في المنصة.</p>
             <p>السبب الأخير: ${opts.reason}</p>`
          : `<p>وصلك تنبيه رقم <strong>${opts.warningsCount} من 3</strong>:</p>
             <p>${opts.reason}</p>
             <p>يرجى الدخول إلى المنصة لتأكيد الاطلاع عليه.</p>
             <p><a href="${opts.loginUrl}" style="background:#C34900;color:#fff;padding:10px 18px;border-radius:10px;text-decoration:none">الدخول إلى المنصة</a></p>`
      }
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
      <p>المرشح <strong>${opts.candidateName}</strong> لم يحقق نسبة النجاح في الاختبار.</p>
      <p>يرجى جدولة اجتماع شرح قبل ${formatDate(opts.dueDate)}.</p>
    </div>`
  );
}
