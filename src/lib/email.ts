import { Resend } from "resend";
import { formatDate } from "@/lib/format";
import { appendEmailLog } from "@/lib/googleSheets";
import { prisma } from "@/lib/prisma";

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

async function send(to: string | string[], subject: string, html: string, kind = "عام") {
  const recipients = Array.isArray(to) ? to.filter(Boolean) : [to].filter(Boolean);
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
    await resend.emails.send({ from: FROM, to: recipients, subject, html });
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
    </div>`,
    "تذكرة جديدة"
  );
}

export async function sendTicketConfirmationEmail(opts: { to: string; subject: string; dueDate: Date }) {
  return send(
    opts.to,
    `تم استلام تذكرتك: ${opts.subject}`,
    `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif">
      <p>تم رفع تذكرتك بنجاح: <strong>${esc(opts.subject)}</strong>.</p>
      <p>سيتم الرد خلال يومين (قبل ${formatDate(opts.dueDate)})، وإذا لم يحدث ذلك تتصعّد تلقائياً للمستوى التالي — نظامنا صارم وواضح.</p>
    </div>`,
    "تأكيد تذكرة"
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
export async function sendApprovedEmail(opts: {
  to: string;
  fullName: string;
  roleLabel: string;
  loginUrl: string;
}) {
  return send(
    opts.to,
    "تم اعتمادك في تَـــلاقِ",
    `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif">
      <p>مرحباً ${esc(opts.fullName)}،</p>
      <p style="font-size:17px"><strong>تم اعتمادك رسمياً بصفة ${esc(opts.roleLabel)}.</strong></p>
      <p>بوابتك مفتوحة الآن — ادخل <strong>بنفس كلمة المرور التي اخترتها</strong> عند أول دخول.</p>
      <p><a href="${opts.loginUrl}" style="background:#C34900;color:#fff;padding:10px 18px;border-radius:10px;text-decoration:none">فتح المنصة</a></p>
    </div>`,
    "الاعتماد النهائي"
  );
}

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
}) {
  let delivered = 0;
  for (const to of opts.recipients) {
    const result = await send(
      to,
      `إعلان: ${opts.title}`,
      `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif">
        <p style="color:#666;font-size:13px;margin:0 0 6px">إعلان موجَّه إلى: ${esc(opts.audienceLabel)}</p>
        <h2 style="margin:0 0 10px;color:#341D2B">${esc(opts.title)}</h2>
        <div style="white-space:pre-wrap;font-size:15px;line-height:1.8">${esc(opts.body)}</div>
        <p style="color:#666;font-size:13px;margin-top:18px">نشره: ${esc(opts.authorName)}</p>
        <p><a href="${opts.portalUrl}" style="background:#C34900;color:#fff;padding:10px 18px;border-radius:10px;text-decoration:none">فتح المنصة</a></p>
      </div>`,
      "إعلان عام"
    );
    if (!result.skipped) delivered++;
  }
  return delivered;
}
