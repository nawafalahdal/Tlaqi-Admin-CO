import { readFileSync } from "fs";
import { join } from "path";
import { Resend } from "resend";
import { formatDate } from "@/lib/format";
import { appendEmailLog } from "@/lib/googleSheets";
import { prisma } from "@/lib/prisma";
import { wrapEmail, htmlToText, variantForKind, appBaseUrl, SOCIAL_HANDLE } from "@/lib/emailBrand";
import { welcomeParagraphs } from "@/lib/departmentBrand";
import { readableTextOn } from "@/lib/colors";

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
    // Resend لا يرمي استثناءً عند رفض الـAPI: يرجع `{ data, error }`.
    // فكان كل رفضٍ — مفتاحٌ خاطئ، نطاقٌ غير موثّق، حدُّ إرسال، مستلمٌ
    // غير مقبول — يُسجَّل «أُرسلت» ويُقال لصاحب الشأن إنها وصلت. وهذا
    // أسوأ من الفشل: الفشلُ يُعاد، والفشلُ المكتوبُ نجاحاً لا يُعاد أبداً.
    const result = await resend.emails.send({
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
    if (result.error) {
      console.error("رفض Resend إرسال البريد:", result.error);
      await logEmail(recipients, kind, subject, "فشل الإرسال");
      return { skipped: true, error: true };
    }
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
    const result = await resend.emails.send({
      from: FROM,
      to: recipients,
      subject,
      html,
      text: htmlToText(html),
      headers: {
        "X-Entity-Ref-ID": `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      },
    });
    if (result.error) {
      console.error("رفض Resend إرسال البريد:", result.error);
      await logEmail(recipients, kind, subject, "فشل الإرسال");
      return { skipped: true, error: true };
    }
    await logEmail(recipients, kind, subject, "أُرسلت");
    return { skipped: false };
  } catch (err) {
    console.error("فشل إرسال البريد:", err);
    await logEmail(recipients, kind, subject, "فشل الإرسال");
    return { skipped: true, error: true };
  }
}

/** بيانات الدخول — ولها مناسبتان لا مناسبة واحدة.
 *
 *  **كانت تقول للمدعوّ «تهانينا، تم اعتماد انضمامك».** وهو لم يُعتمد:
 *  دُعي للتوّ، وأمامه اختبارٌ ثم قرارُ اعتماد قد يكون بالرفض. فكانت
 *  الرسالة تَعِد بما لم يُقرَّر، ويقرأ صاحبها أنه صار عضواً ثم يُفاجَأ
 *  باختبارٍ لم يُذكر له. ثم تُرسَل الرسالة نفسها عند إعادة تعيين كلمة
 *  المرور لعضوٍ قديم، فتُهنّئه على انضمامٍ جرى قبل سنة.
 *
 *  فصار لكلّ مناسبةٍ نصُّها: الدعوة تقول إنها دعوة وتشرح الخطوات،
 *  وإعادة التعيين تقول إنها إعادة تعيين. */
export async function sendCredentialsEmail(opts: {
  to: string;
  fullName: string;
  tempPassword: string;
  loginUrl: string;
  /** `invitation` لحظة الدعوة، `reset` لإعادة تعيين بيانات حسابٍ قائم */
  occasion?: "invitation" | "reset";
  /** القسم والمسمّى كما حدّدتهما الإدارة الداعية — لا يُغيّرهما المدعوّ */
  departmentName?: string | null;
  jobTitle?: string | null;
  roleLabel?: string | null;
  /** مهلة أول دخول بالساعات */
  hoursValid?: number;
}) {
  const invitation = (opts.occasion ?? "invitation") === "invitation";

  const facts: [string, string][] = [];
  if (opts.roleLabel?.trim()) facts.push(["الصفة", opts.roleLabel.trim()]);
  if (opts.departmentName?.trim()) facts.push(["القسم", opts.departmentName.trim()]);
  if (opts.jobTitle?.trim()) facts.push(["المسمّى الوظيفي", opts.jobTitle.trim()]);

  const credentials = `
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:16px 0">
        ${factRow("البريد الإلكتروني", opts.to)}
        ${factRow("كلمة المرور المؤقتة", opts.tempPassword)}
      </table>
      <p style="margin:22px 0">
        <a href="${esc(opts.loginUrl)}"
           style="display:inline-block;padding:12px 28px;background:#C34900;color:#FFFFFF;border-radius:999px;font-weight:bold;text-decoration:none">
          ${invitation ? "ابدأ من هنا" : "تسجيل الدخول"}
        </a>
      </p>
      <p style="font-size:13px;color:#6B6B6B">سيُطلب منك تغيير كلمة المرور فور الدخول الأول.</p>`;

  if (!invitation) {
    return send(
      opts.to,
      "بيانات دخول جديدة لحسابك في تَـــلاقِ",
      `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif">
        <p>مرحباً ${esc(opts.fullName)}،</p>
        <p>أُعيد تعيين بيانات دخولك إلى منصة تَـــلاقِ. استعمل البيانات التالية:</p>
        ${credentials}
        <p style="font-size:13px;color:#6B6B6B">إن لم تكن قد طلبت هذا، أبلغ إدارتك فوراً.</p>
      </div>`,
      "بيانات الدخول"
    );
  }

  const where = opts.departmentName?.trim()
    ? `إلى ${opts.departmentName.trim()}`
    : "إلى فريق تَـــلاقِ";
  const hours = opts.hoursValid ?? 24;

  return send(
    opts.to,
    `دعوة للانضمام إلى تَـــلاقِ${opts.departmentName?.trim() ? ` — ${opts.departmentName.trim()}` : ""}`,
    `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif">
      <p>مرحباً ${esc(opts.fullName)}،</p>
      <p>دعتك إدارة <strong>تَـــلاقِ</strong> للانضمام ${esc(where)}. وهذه دعوةٌ خاصّةٌ بك،
         والبيانات أدناه سجّلتها الإدارة الداعية — فلا تحتاج إلى تعبئتها ولا يمكن تعديلها.</p>
      ${facts.length ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:16px 0">${facts.map(([k, v]) => factRow(k, v)).join("")}</table>` : ""}

      <p style="margin:20px 0 8px;font-weight:bold">خطواتك:</p>
      <ol style="margin:0 0 16px;padding-inline-start:20px;line-height:2;font-size:14px">
        <li>ادخل بالبيانات أدناه وغيّر كلمة المرور.</li>
        <li>أكمل بياناتك الشخصية (تخصّصك وبيانات التواصل).</li>
        <li>اجتز اختبار القسم — وهو شرط النظر في انضمامك.</li>
        <li>تُعرض نتيجتك على الإدارة المختصّة لقرار الاعتماد.</li>
      </ol>
      <p style="font-size:14px"><strong>الاعتماد ليس تلقائياً:</strong> اجتياز الاختبار يُقدّم طلبك
         للمراجعة، وتصلك رسالة الانضمام عند الاعتماد.</p>
      ${credentials}
      <p style="font-size:13px;color:#6B6B6B">
        وللدعوة مهلة: إن لم تدخل خلال ${hours} ساعة سقطت ووجب على الإدارة إعادة إصدارها.
      </p>
    </div>`,
    "دعوة"
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

/** شهادة الشكر والتقدير — تصل برابطها لا بخبرها.
 *
 *  كانت الرسالة تُعلن «أُصدرت لك شهادة» ثم تنتهي: خبرٌ بلا شهادة. وصاحبها
 *  خرج من الفريق وحسابه مُعطَّل، فلا يستطيع الدخول ليقرأها. فالرابط
 *  الموقَّع هو الشهادة نفسها — يُفتح بلا تسجيل دخول، ويُطبَع PDF بضغطة.
 *
 *  والرسالة تذكر مدّته وقسمه ومهمته من السجل الرسمي: الشهادة وثيقةٌ،
 *  ومن يقرأ بريدها يجب أن يرى ما فيها قبل أن يفتحها. */
export async function sendCertificateEmail(opts: {
  to: string;
  fullName: string;
  roleLabel?: string | null;
  departmentName?: string | null;
  mission?: string | null;
  period?: { start: Date; end: Date } | null;
  certificateUrl: string;
}) {
  const facts: [string, string][] = [];
  if (opts.roleLabel?.trim()) facts.push(["الصفة", opts.roleLabel.trim()]);
  if (opts.mission?.trim()) facts.push(["المهمة", opts.mission.trim()]);
  if (opts.departmentName?.trim()) facts.push(["القسم", opts.departmentName.trim()]);
  if (opts.period) {
    facts.push(["المدّة", `${formatDate(opts.period.start)} — ${formatDate(opts.period.end)}`]);
  }

  return send(
    opts.to,
    "شهادة شكر وتقدير — تَـــلاقِ",
    `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif">
      <p>مرحباً ${esc(opts.fullName)}،</p>
      <p>تقديراً لمسيرتك في منصة تَـــلاقِ، صدرت لك شهادة شكر وتقدير موقَّعة.</p>
      ${facts.length ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:18px 0">${facts.map(([k, v]) => factRow(k, v)).join("")}</table>` : ""}
      <p style="margin:22px 0">
        <a href="${esc(opts.certificateUrl)}"
           style="display:inline-block;padding:12px 28px;background:#C34900;color:#FFFFFF;border-radius:999px;font-weight:bold;text-decoration:none">
          اعرض شهادتك واحفظها PDF
        </a>
      </p>
      <p style="font-size:13px;color:#6B6B6B">الرابط خاصٌّ بك ويعمل بلا تسجيل دخول — فاحفظ الشهادة عندك.</p>
    </div>`,
    "شهادة إتمام"
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
  const role = opts.jobTitle?.trim();
  const dept = opts.departmentName?.trim();
  const place = role
    ? dept
      ? `في منصبك ${role} ضمن ${dept}`
      : `في منصبك ${role}`
    : dept
      ? `ضمن ${dept}`
      : "معنا";

  return send(
    opts.to,
    "ثلاثة أشهر من العطاء — شهادة تقدير من تَـــلاقِ",
    `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif">
      <p>أهلاً وسهلاً، ${esc(opts.fullName)}،</p>
      <p>ثلاثة أشهرٍ مضت منذ انضمامك إلى مسيرتنا في تَـــلاقِ، وثلاثة أشهرٍ من
         العمل والتعلّم والمساهمة في بناء ما نطمح إليه معاً.</p>
      <p>يسعدنا أن نحتفي بإكمالك ثلاثة أشهرٍ ${esc(place)}، وأن نعبّر لك عن
         تقديرنا للوقت والجهد الذي خصّصته لهذه التجربة.</p>
      <p>نؤمن أن الأثر الحقيقي لا يُقاس بالوقت وحده، بل بما نتعلّمه، وما نبنيه،
         وما نضيفه إلى الفريق. ونتمنّى أن تكون الأشهر القادمة مليئةً بفرصٍ أكبر،
         وأفكارٍ أجمل، وإنجازاتٍ نفتخر بها جميعاً.</p>
      <p style="margin:22px 0">
        <a href="${esc(opts.certificateUrl)}"
           style="display:inline-block;padding:12px 28px;background:#C34900;color:#FFFFFF;border-radius:999px;font-weight:bold;text-decoration:none">
          اعرض شهادة التقدير
        </a>
      </p>
      <p>شكراً لكونك جزءاً من تَـــلاقِ.</p>
    </div>`,
    "تقدير ثلاثة أشهر"
  );
}

/** طلب توقيع من قائدٍ جديد.
 *
 *  يشرح لماذا يُطلب وأين يُرسَم: التوقيع يُوضَع على شهادات الشكر التي
 *  يُوقّعها لأعضاء قسمه. ومن لا يفهم لماذا يُطلب توقيعُه لا يرفعه. */
export async function sendSignatureRequestEmail(opts: {
  to: string;
  fullName: string;
  roleLabel: string;
  departmentName?: string | null;
  uploadUrl: string;
}) {
  const scope = opts.departmentName?.trim()
    ? `أعضاء ${opts.departmentName.trim()}`
    : "من تُوقّع لهم";

  return send(
    opts.to,
    "نحتاج توقيعك — شهادات تَـــلاقِ",
    `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif">
      <p>مرحباً ${esc(opts.fullName)}،</p>
      <p>بصفتك <strong>${esc(opts.roleLabel)}</strong>، أنت من يُوقّع شهادات الشكر والتقدير
         التي تُصدرها تَـــلاقِ لـ${esc(scope)}.</p>
      <p>ولهذا نحتاج توقيعك مرّةً واحدة: يُرسَم على الشهادات التي تصدر باسمك، فيقرأ صاحبُها
         توقيعَ من عمل تحته فعلاً لا اسماً مطبوعاً.</p>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:16px 0">
        ${factRow("الصفة", opts.roleLabel)}
        ${opts.departmentName?.trim() ? factRow("القسم", opts.departmentName.trim()) : ""}
      </table>
      <p style="margin:22px 0">
        <a href="${esc(opts.uploadUrl)}"
           style="display:inline-block;padding:12px 28px;background:#C34900;color:#FFFFFF;border-radius:999px;font-weight:bold;text-decoration:none">
          ارفع توقيعك
        </a>
      </p>
      <p style="font-size:13px;color:#6B6B6B">
        ارسم توقيعك على ورقةٍ بيضاء وصوّره، أو ارسمه داخل الصفحة مباشرةً. ويُعتمد من الإدارة
        قبل أن يُرسَم على أي شهادة — ولا يُستعمل توقيعُ قائدٍ سابق مكانه.
      </p>
    </div>`,
    "طلب توقيع"
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
  return send(
    opts.to,
    `طلب إنهاء فترة الإدارة: ${opts.memberName}`,
    `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif">
      <p>رفع <strong>${esc(opts.memberName)}</strong> طلب إنهاء فترة الإدارة في تَـــلاقِ.</p>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:16px 0">
        ${factRow("التكليف", opts.assignmentLabel)}
        ${factRow("البريد", opts.memberEmail)}
        ${opts.requestedEndDate ? factRow("التاريخ المقترح", formatDate(opts.requestedEndDate)) : ""}
      </table>
      <p style="margin:0 0 6px;font-weight:bold">سبب الطلب بكلماته:</p>
      <p style="margin:0 0 18px;padding:12px 14px;background:#F6F4F0;border-radius:10px">${esc(opts.reason)}</p>
      <p style="font-size:14px">وأمامك ثلاثة: الموافقة بتاريخٍ تُثبته، أو الرفض بتفسيرٍ يُقرأ له،
         أو <strong>طلب لقاءٍ قبل أن تقرّر</strong> — واللقاء ليس موافقةً ولا رفضاً.</p>
      <p style="font-size:14px;color:#6B6B6B">ولم يتوقّف عمله بالرفع: يبقى على تكليفه حتى تقرّر
         وتحلّ المهلة.</p>
      <p style="margin:22px 0">
        <a href="${esc(opts.portalUrl)}"
           style="display:inline-block;padding:12px 28px;background:#C34900;color:#FFFFFF;border-radius:999px;font-weight:bold;text-decoration:none">
          افتح الطلب
        </a>
      </p>
    </div>`,
    "طلب إنهاء إدارة"
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
  const subject =
    opts.decision === "approve"
      ? "وُوفق على طلب إنهاء فترة الإدارة"
      : opts.decision === "reject"
        ? "بشأن طلب إنهاء فترة الإدارة"
        : "طلب لقاء بشأن طلبك";

  const body =
    opts.decision === "approve"
      ? `<p>وُوفق على طلبك إنهاء فترة الإدارة في <strong>${esc(opts.assignmentLabel)}</strong>.</p>
         ${opts.endDate ? `<p>تاريخ الانتهاء المُثبَت: <strong>${esc(formatDate(opts.endDate))}</strong>. وتبقى على عملك حتى ذلك اليوم.</p>` : ""}
         <p>وتصلك شهادة شكرٍ وتقدير عند الختام — لا ينتهي أحدٌ عندنا بلا توثيق.</p>`
      : opts.decision === "reject"
        ? `<p>نظرنا في طلبك إنهاء فترة الإدارة في <strong>${esc(opts.assignmentLabel)}</strong>،
             ولم يُوافَق عليه.</p>`
        : `<p>بشأن طلبك إنهاء فترة الإدارة في <strong>${esc(opts.assignmentLabel)}</strong>:
             يطلب مسؤولك لقاءً قبل أن يقرّر.</p>
           <p><strong>وهذا ليس موافقةً ولا رفضاً</strong> — طلبك قائمٌ كما هو، والقرار يأتي بعد اللقاء.</p>`;

  return send(
    opts.to,
    subject,
    `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif">
      <p>مرحباً ${esc(opts.memberName)}،</p>
      ${body}
      ${opts.note ? `<p style="margin:16px 0 0;padding:12px 14px;background:#F6F4F0;border-radius:10px"><strong>${opts.decision === "reject" ? "التفسير" : "ملاحظة"}:</strong> ${esc(opts.note)}</p>` : ""}
      <p style="margin-top:18px;font-size:13px;color:#6B6B6B">القرار من: ${esc(opts.byName)}</p>
    </div>`,
    "قرار إنهاء إدارة"
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

/** سحب التذكرة — يُخبَر به من كان الطلب في يده ليتوقّف عن عملٍ صار بلا
 *  داعٍ. ولا يُقال فيه «تم الحل»: لم يُحَلّ، بل رفعه صاحبه ثم رفَعه. */
export async function sendTicketWithdrawnEmail(opts: {
  to: string | string[];
  ticketNumber: number;
  subject: string;
  reason: string;
  byName: string;
}) {
  return send(
    opts.to,
    `سُحبت التذكرة #${opts.ticketNumber}: ${opts.subject}`,
    `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif">
      <p>سحب <strong>${esc(opts.byName)}</strong> التذكرة التي رفعها، فلم تبقَ بانتظار ردّك:</p>
      <p><strong>#${opts.ticketNumber} — ${esc(opts.subject)}</strong></p>
      <p>السبب: ${esc(opts.reason)}</p>
      <p style="color:#555">لم تُحَلّ التذكرة — سُحبت. فلا إجراء عليك.</p>
    </div>`,
    "سحب تذكرة"
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
  const head = opts.resubmitted
    ? "أُعيد إليك طلبٌ بعد تعديله"
    : opts.afterStepBy
      ? `اعتمده ${esc(opts.afterStepBy)} وانتقل إليك`
      : "طلبُ اعتمادٍ ينتظر قرارك";
  return send(
    opts.to,
    `طلب اعتماد #${opts.ticketNumber}: ${opts.subject}`,
    `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif">
      <p><strong>${head}.</strong></p>
      <p><strong>#${opts.ticketNumber} — ${esc(opts.subject)}</strong></p>
      <p>النوع: ${esc(opts.kindLabel)}</p>
      <p>مُقدّم الطلب: ${esc(opts.requesterName)} — ${esc(opts.requesterRole)}</p>
      ${opts.stepsTotal > 1 ? `<p>مسارُ الاعتماد: ${opts.stepsTotal} موافقات</p>` : ""}
      <p><a href="${opts.url}">راجع الطلب وقرّر</a></p>
      <p style="color:#555">ولا يُعتمد الطلب إلا منك — الزرّ في صفحته، والقرار يُسجَّل باسمك ووقته.</p>
    </div>`,
    "طلب اعتماد"
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
  return send(
    opts.to,
    `قرار على طلبك #${opts.ticketNumber}: ${opts.stateLabel}`,
    `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif">
      <p>طلبك <strong>#${opts.ticketNumber} — ${esc(opts.subject)}</strong> صار:
         <strong>${esc(opts.stateLabel)}</strong></p>
      <p>القرار من: ${esc(opts.byName)}</p>
      ${opts.note ? `<p>الملاحظة: ${esc(opts.note)}</p>` : ""}
      ${
        opts.nextApproverName
          ? `<p>وانتقل الطلب إلى <strong>${esc(opts.nextApproverName)}</strong> لاستكمال الموافقات.</p>`
          : ""
      }
      <p><a href="${opts.url}">افتح الطلب</a></p>
    </div>`,
    "قرار اعتماد"
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
/** «طلبٌ ينتظر اعتمادك» — للمعتمِد المختصّ وحده.
 *
 *  هذا هو البريد الذي كان ناقصاً: المرشّح كان يُراسَل بنتيجته (وهو
 *  يقرأها على الشاشة)، ومن يملك اعتماده لا يُراسَل أصلاً — فيبقى الطلب
 *  معلّقاً حتى يفتح أحدٌ اللوحة مصادفةً. فانعكس الأمر: يُخبَر من يفعل،
 *  ولا يُخبَر من ينتظر. */
export async function sendAwaitingApprovalEmail(opts: {
  to: string | string[];
  candidateName: string;
  candidateEmail: string;
  score: number;
  scopeLabel: string;
  portalUrl: string;
}) {
  return send(
    opts.to,
    `طلب انضمام ينتظر اعتمادك: ${opts.candidateName}`,
    `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif">
      <p>أكمل مرشّحٌ تسجيله واجتاز اختباره، وينتظر اعتمادك:</p>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:16px 0">
        ${factRow("الاسم", opts.candidateName)}
        ${factRow("البريد", opts.candidateEmail)}
        ${factRow("الجهة", opts.scopeLabel)}
        ${factRow("النتيجة", `${opts.score}%`)}
      </table>
      <p>لا تصل المرشّحَ رسالةُ ترحيبٍ حتى تعتمده — فالاعتماد هو ما يُنشئ حسابه.</p>
      <p style="margin:22px 0">
        <a href="${esc(opts.portalUrl)}"
           style="display:inline-block;padding:12px 28px;background:#C34900;color:#FFFFFF;border-radius:999px;font-weight:bold;text-decoration:none">
          افتح قائمة الاعتماد
        </a>
      </p>
    </div>`,
    "طلب ينتظر الاعتماد"
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
  /** لون القسم المسجَّل — منه تُعرف هويته، ولا يُخمَّن */
  departmentColorHex?: string | null;
  /** رابط اللوحة المتحرّكة المُخصَّصة — موقَّعٌ لصاحبها */
  bannerUrl?: string | null;
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
/** مربّع الرمز المخبوز بلون هذا القسم.
 *
 *  الملفّات تُولَّد بـ`scripts/gen-card-marks.ts`، ولكلٍّ حبرٌ محسوب.
 *  ومن جاء بلونٍ غير ألوان الهوية يأخذ المهوجني — لا مربّعاً مفقوداً. */
function cardMarkFile(colorHex: string): string {
  const byColor: Record<string, string> = {
    "#c34900": "card-mark-mahogany.png",
    "#67c090": "card-mark-green.png",
    "#eef6df": "card-mark-beige.png",
    "#341d2b": "card-mark-temptress.png",
  };
  return byColor[colorHex.trim().toLowerCase()] ?? "card-mark-mahogany.png";
}

/** الصفةُ والفريقُ في سطرٍ واحد، بلا تكرارٍ ولا شَرَطاتٍ فارغة.
 *
 *  يُقارَن بعد التشذيب: «المؤسس» و«المؤسس » واحد. ومن لا قسم له ولا
 *  مسمّى يبقى سطرُه صفتَه وحدها — لا «المؤسس · —». */
function cardMeta(opts: WelcomeEmailOpts): string {
  // المسمّى الوظيفي أخصُّ من الصفة، فإن وُجد كفى عنها: «قائدة التسويق»
  // تُغني عن «قائد قسم». ثم القسم بعده — وهما حقيقتان لا ثلاث.
  const parts = [opts.jobTitle || opts.roleLabel, opts.departmentName]
    .map((v) => v?.trim())
    .filter((v): v is string => !!v && v !== "—");
  const seen = new Set<string>();
  const unique = parts.filter((v) => {
    if (seen.has(v)) return false;
    seen.add(v);
    return true;
  });
  return unique.length > 0 ? unique.join(" · ") : "عضو في تَـــلاقِ";
}

export function renderWelcomeEmail(opts: WelcomeEmailOpts): string {
  const base = appBaseUrl();
  // نصُّ القسم يُركَّب في موضعه لا في القالب: القالب شكلٌ، والنصّ هويّة
  const p = welcomeParagraphs({
    fullName: opts.fullName,
    role: opts.jobTitle ?? opts.roleLabel,
    departmentName: opts.departmentName ?? null,
    colorHex: opts.departmentColorHex ?? null,
  });
  const deptColor = opts.departmentColorHex?.trim() || "#C34900";
  return fillTemplate(welcomeTemplate(), {
    greeting: p.greeting,
    intro: p.intro,
    belief: p.belief,
    aspiration: p.aspiration,
    closing: p.closing,
    full_name: opts.fullName,
    role: opts.roleLabel,
    team: opts.departmentName?.trim() || opts.jobTitle?.trim() || "—",
    // سطر البطاقة: الصفةُ والفريقُ بلا تكرار.
    //
    // كان القالب يَعرض «الدور» و«الفريق» صفّين مستقلّين، و`team` يرتدّ
    // إلى المسمّى الوظيفي لمن لا قسم له. فمن كان مسمّاه هو صفتَه —
    // المؤسس مثلاً — قرأ الكلمة نفسها في الصفّين، وقرأها ثالثةً في
    // اسمه إن كتبه بصفته. والبطاقة تقول الحقائق مرّةً واحدة.
    //
    // والإسقاط هنا لا في القالب: القالب لا يعرف أيُّ القيمتين تكرار،
    // والخادم يعرف — فهو من يقرأ السجل.
    card_meta: cardMeta(opts),
    join_date: opts.joinedAt ? formatDate(opts.joinedAt) : "—",
    portal_url: opts.portalUrl,
    banner_url: opts.bannerUrl || `${base}/brand/banner/base.gif`,
    dept_color: deptColor,
    card_mark: cardMarkFile(deptColor),
    btn_bg: deptColor,
    // حبر الزرّ يُشتقّ من إضاءة لونه لا يُكتب ثابتاً: «الموارد البشرية»
    // لونُها بيجٌ فاتح (#EEF6DF)، ونصٌّ أبيض عليه لا يُقرأ. و
    // `readableTextOn` هي الدالة نفسها التي تحكم ألوان الواجهة — فلا
    // يُتّخذ القرار مرّتين بطريقتين.
    btn_text: readableTextOn(deptColor),
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
