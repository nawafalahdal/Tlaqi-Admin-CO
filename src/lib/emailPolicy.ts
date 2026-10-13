/** سياسة البريد — ما يُرسَل وما يُقال في المنصة وحدها.
 *
 *  **القاعدة:** البريد لِما لا يُعرَف إلا به. ومن عَرَفَه على الشاشة لا
 *  يُخبَر به ثانيةً في بريده.
 *
 *  والسبب عملي لا جمالي: حصّة الإرسال شهرية، وأكثرُ ما كان يستهلكها
 *  رسائلُ متكرّرة لا قرار فيها — تصعيدٌ كلَّ يومين لكل تذكرة مفتوحة،
 *  وتذكيراتٌ يومية من الكنس المجدول، ونُخَزٌ بالتفعيل. فتُقال هذه في
 *  المنصة حيث مواعيدُها ولوحاتُها، ويبقى البريد لما يُوجب فعلاً من
 *  إنسان: رمز دخول، بطاقة انضمام، تذكرةٌ وصلتك، قرارٌ في طلبك.
 *
 *  **ولا نُسخةَ مجاملة (CC).** الرسالة لمن يفعل، لا لمن يُطالع. وحيث
 *  كان المستلم جمعاً — ثلاثة تنفيذيين، أو قادةُ قسم — يُرسَل إلى واحدٍ
 *  معيَّنٍ بقاعدةٍ ثابتة، والبقية يرونها في لوحتهم.
 *
 *  **والكتمان ليس حذفاً.** الحدث يبقى، والقالب يبقى، ويُسجَّل في «سجل
 *  الرسائل» أنه كُتم بالسياسة — فيُقرأ ما لم يُرسَل كما يُقرأ ما أُرسل،
 *  ويُعاد أيُّ نوعٍ بتغيير `send` إلى `true` في سطرٍ واحد هنا.
 */
export type EmailEvent =
  // ── ما يُرسَل
  | "auth.login_code"
  | "auth.password_reset"
  | "member.credentials"
  | "member.welcome"
  | "member.warning"
  | "member.exit"
  | "member.certificate"
  | "member.farewell"
  | "member.appreciation"
  | "registration.awaiting_approval"
  | "ticket.created"
  | "ticket.resolved"
  | "approval.request"
  | "approval.decision"
  | "termination.request"
  | "termination.decision"
  | "signature.request"
  | "announcement.broadcast"
  // ── ما يُكتم
  | "ticket.escalated"
  | "ticket.withdrawn"
  | "ticket.reminder"
  | "request.reminder"
  | "meeting.reminder"
  | "meeting.owner"
  | "test.failed"
  | "test.reopened"
  | "window.reminder"
  | "totp.nudge";

export const EMAIL_POLICY: Record<EmailEvent, { send: boolean; why: string }> = {
  // ═══ يُرسَل: لا يُعرَف إلا بالبريد، أو يُوجب فعلاً ═══
  "auth.login_code": { send: true, why: "العامل الثاني نفسه — لا دخول بدونه" },
  "auth.password_reset": { send: true, why: "طلبه صاحبه، والرابط لا يصل بغيره" },
  "member.credentials": {
    send: true,
    why: "أول رسالة في المسار: الدخول وكلمة المرور المؤقتة والتفاصيل — ولا طريق إلى المنصة قبلها",
  },
  "member.welcome": {
    send: true,
    why: "ثاني رسالة وآخرها في الانضمام: عند الاعتماد وحده، ومرّةً واحدة",
  },
  "member.warning": { send: true, why: "ثلاثةُ تنبيهاتٍ تُنهي العضوية — فالتنبيه يجب أن يصل" },
  "member.exit": { send: true, why: "انقطاعُ وصولٍ يجب أن يعرفه صاحبه" },
  "member.certificate": { send: true, why: "الشهادة وثيقتُه — والبريد هو تسليمها" },
  "member.farewell": { send: true, why: "الوداع وعدٌ قُطِع، ويُحمَل مع شهادته النهائية" },
  "member.appreciation": { send: true, why: "شهادة الثلاثة أشهر — مرّةً لكل عضو" },
  "registration.awaiting_approval": {
    send: true,
    why: "من يملك الاعتماد لا يعلم أن طلباً ينتظره — ولا يمضي المسار بغيره. ويُرسَل إلى واحدٍ لا إلى الجميع",
  },
  "ticket.created": {
    send: true,
    why: "التذكرة الأولى من اثنتين: تصل لمن وُجِّهت إليه — وحده",
  },
  "ticket.resolved": {
    send: true,
    why: "الثانية والأخيرة: تعود إلى من رفعها حين تُحَلّ — وحده، بلا نسخةٍ لأحد",
  },
  "approval.request": { send: true, why: "المعتمِد المسمّى لا يعلم بطلبٍ ينتظره إلا به" },
  "approval.decision": { send: true, why: "قرارٌ في طلبِ صاحبه — يعود إليه وحده" },
  "termination.request": { send: true, why: "طلبُ إنهاءٍ ينتظر قراراً من شخصٍ بعينه" },
  "termination.decision": { send: true, why: "قرارٌ في طلبِ صاحبه" },
  "signature.request": { send: true, why: "توقيعٌ ينتظر اعتماداً — ولا تُختم شهادةٌ بغيره" },
  "announcement.broadcast": {
    send: true,
    why: "اختياريٌّ بقرار الناشر لا بافتراض النظام — وهو الافتراضُ مُطفأ",
  },

  // ═══ يُكتم: قيل على الشاشة، أو تكرارٌ لا قرار فيه ═══
  "ticket.escalated": {
    send: false,
    why: "التصعيد يقع كلَّ يومين لكل تذكرة مفتوحة — وهو معروضٌ في اللوحة بمرحلته وموعده. بريدُه أكبرُ مستهلكٍ للحصّة بلا خبرٍ جديد",
  },
  "ticket.withdrawn": {
    send: false,
    why: "صاحبها سحبها فأُغلقت، ومن وُجِّهت إليه يراها مُغلقةً في لوحته — ولا فعل عليه",
  },
  "ticket.reminder": { send: false, why: "الموعد معروضٌ في البطاقة ومُصدَّرٌ إلى التقويم" },
  "request.reminder": { send: false, why: "الطلب في لوحة القسم بموعده" },
  "meeting.reminder": { send: false, why: "الاجتماع في التقويم، والتذكير تكرارٌ له" },
  "meeting.owner": { send: false, why: "الاجتماع يظهر في لوحة قائد القسم عند جدولته" },
  "test.failed": {
    send: false,
    why: "قرأ نتيجته على الشاشة لحظة التسليم، واجتماعُ الشرح يُجدَّل في المنصة",
  },
  "test.reopened": { send: false, why: "الاختبار يُفتَح في بوابته — يراه حين يدخل" },
  "window.reminder": { send: false, why: "المهلة مكتوبةٌ في رسالة الدخول الأولى وفي بوابته" },
  "totp.nudge": { send: false, why: "نُخزةٌ لا خبر — وصفحة الحماية تقولها لمن يفتحها" },
};

export function emailAllowed(event: EmailEvent): boolean {
  return EMAIL_POLICY[event].send;
}

export function policyReason(event: EmailEvent): string {
  return EMAIL_POLICY[event].why;
}

/** مستلمٌ واحد من جمع — لا نسخةَ مجاملة.
 *
 *  والاختيار ثابتٌ لا عشوائي: أول عنوانٍ في ترتيبٍ مستقرٍّ يأتي من
 *  الاستعلام (الأقدم إنشاءً عادةً). فالرسالة نفسها تذهب إلى الشخص نفسه
 *  في كل مرّة، ولا يُفاجأ أحدٌ برسالةٍ مرّةً ويُحجَب عنها مرّة.
 */
export function singleRecipient(candidates: string[]): string[] {
  const clean = candidates.filter(Boolean);
  return clean.length === 0 ? [] : [clean[0]];
}
