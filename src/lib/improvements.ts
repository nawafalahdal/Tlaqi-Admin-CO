import type { Session } from "next-auth";
import type { ImprovementKind, ImprovementState, TicketStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { TICKET_STAGE_DAYS, syncTicketSheetRow, TICKET_INCLUDE } from "@/lib/tickets";

/** مركزُ التحسين — «شفتَ شيئاً؟ قُله من مكانك».
 *
 *  ## لماذا هو تذكرةٌ ولا نظامٌ ثانٍ
 *
 *  **اللجنةُ قسمٌ له أبٌ، والتحسينُ تذكرةٌ لها نوع.** ولو بُني للتحسينات
 *  جدولُها الخاصُّ لصار للمنصة طابورانِ وبريدانِ وملفّا إكسلٍ ومسارا
 *  اعتماد — وكلُّ إصلاحٍ في أحدهما يُنسى في الآخر. فالتحسينُ يَرث ذلك
 *  كلَّه بحقلٍ واحد، ويُميّزه `improvementKind`.
 *
 *  ## وثلاثةُ أحكامٍ تَحكم مساره
 *
 *  **١) لا يُغلَق بشهادة من أصلحه.** بين `in_progress` و`resolved` تقف
 *  `awaiting_user`: من رأى العطبَ هو من يَشهد بزواله. فلا يُقال «أُصلح»
 *  ثم يُفتَح البابُ فيُرى كما كان.
 *
 *  **٢) ولا يُصعَّد على ساعة التذاكر.** مهلةُ التذكرة يومان ثم تَصعد إلى
 *  القائد فالتنفيذي فالمؤسس. وفكرةٌ عن لونِ زرٍّ لا تَستحقّ ذلك: لو
 *  مرّت على المسار نفسِه لبلغت المؤسسَ في يومين ومعها بريدٌ في كل
 *  مرحلة. فالتحسيناتُ مُستثناةٌ من الكنس — ووجهتُها المؤسسُ ابتداءً،
 *  فليس بعده من يُصعَّد إليه.
 *
 *  **٣) ولا بريدَ عليه.** حدُّ الإرسال محدود، والمؤسسُ يَفتح صندوقَه
 *  فيَراها. وهذا عينُ ما قُرّر في إشعارات التنفيذ: رسالةٌ واحدةٌ في
 *  النظام كلِّه، وما عداها يُقرأ على المنصة.
 *
 *  ## والحالتان تُكتَبان معاً
 *
 *  `status` الخشنُ هو ما تَقرؤه طبقةُ التصعيد والإكسل، و
 *  `improvementState` هو التفصيل. ولو كُتب أحدُهما دون الآخر لصار
 *  للمنصة حقيقتان. فيُكتَبان في موضعٍ واحدٍ هنا، و`STATUS_OF` هو
 *  الإسقاطُ الوحيد بينهما.
 */

/** الإسقاطُ من الحالة التفصيلية إلى حالة التذكرة الخشنة */
const STATUS_OF: Record<ImprovementState, TicketStatus> = {
  new: "open",
  triaged: "open",
  in_progress: "in_progress",
  awaiting_user: "in_progress",
  resolved: "resolved",
  closed: "resolved",
};

/** الانتقالاتُ المسموحة — جدولٌ يُقرأ لا شروطٌ متناثرة.
 *
 *  و`closed` تُبلَغ من أيّ حالة: ما لن يُنفَّذ يُغلَق بسببه ولا يبقى
 *  في الصندوق يُقرأ عملاً قائماً. */
const ALLOWED: Record<ImprovementState, readonly ImprovementState[]> = {
  new: ["triaged", "in_progress", "closed"],
  triaged: ["in_progress", "closed"],
  in_progress: ["awaiting_user", "triaged", "closed"],
  // ومن جرّبه فوجده كما كان يُعيده إلى العمل
  awaiting_user: ["resolved", "in_progress", "closed"],
  resolved: ["closed", "in_progress"],
  closed: ["in_progress"],
};

export const STATE_LABEL: Record<ImprovementState, string> = {
  new: "جديد",
  triaged: "مُصنَّف",
  in_progress: "قيد العمل",
  awaiting_user: "ينتظر تجربتك",
  resolved: "تمّ وأُقِرّ",
  closed: "مُغلَق",
};

export const KIND_LABEL: Record<ImprovementKind, string> = {
  bug: "إصلاح",
  confusing: "توضيح",
  idea: "اقتراح",
};

/** حدُّ النصّ: ملاحظةٌ لا مقال. والحدُّ مفروضٌ في الخادم لا في الواجهة
 *  وحدها — الواجهةُ تُلتَفّ عليها. */
export const MAX_NOTE = 2000;
export const MAX_TITLE = 160;
/** وحدُّ السياق: ما يُلتقَط معدودٌ، وما كَبُر عنه ليس سياقاً */
const MAX_CONTEXT = 1200;

/** السياقُ الذي يُلتقَط — معدودٌ ومُعلَن، لا «كلُّ ما في المتصفّح».
 *
 *  ولا يَحمل نصَّ الصفحة ولا ما فيها من بيانات: المسارُ والمقاسُ
 *  والسمةُ واللغة. وهي ما يَلزم لإعادة إنتاج العطب، ولا تَخصّ غيرَ
 *  من رفعه. */
export type PageContext = {
  path?: string;
  viewport?: string;
  theme?: string;
  locale?: string;
  /** عريضُ المتصفّح — يُقطَع، فالكاملُ بصمةٌ لا حاجةَ بها */
  agent?: string;
};

function cleanContext(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  const pick = (k: keyof PageContext, max: number) => {
    const v = c[k];
    return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined;
  };
  const out: PageContext = {
    path: pick("path", 300),
    viewport: pick("viewport", 20),
    theme: pick("theme", 10),
    locale: pick("locale", 10),
    agent: pick("agent", 180),
  };
  const json = JSON.stringify(out);
  return json.length > MAX_CONTEXT ? json.slice(0, MAX_CONTEXT) : json;
}

export function readContext(raw: string | null): PageContext {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as PageContext) : {};
  } catch {
    // سياقٌ معطوبٌ لا يُسقِط الصندوق: الملاحظةُ أهمُّ من سياقها
    return {};
  }
}

/** من يَفتح الصندوق ويَقرّر — المؤسسُ والتنفيذي.
 *
 *  والمؤسسُ هو الوجهةُ ابتداءً (الصندوقُ صندوقُه كما في المواصفة)،
 *  والتنفيذي معه لئلا يَقف العملُ على شخصٍ واحد. */
export function canTriage(role: string): boolean {
  return role === "super_admin" || role === "executive";
}

/** يَرفع ملاحظةَ تحسينٍ من أيّ شاشة — وتصير تذكرةً حقيقية.
 *
 *  ووجهتُها المؤسس. فإن لم يكن ثَمَّ مؤسسٌ نشط فالتنفيذي — ولا تُترَك
 *  بلا وجهة: تذكرةٌ بلا وجهةٍ تَقف إلى الأبد.
 */
export async function submitImprovement(opts: {
  kind: ImprovementKind;
  title: string;
  note: string;
  context?: unknown;
  session: Session;
}): Promise<{ ok: true; ticketNumber: number } | { ok: false; reason: string }> {
  const title = opts.title.trim().slice(0, MAX_TITLE);
  const note = opts.note.trim().slice(0, MAX_NOTE);
  if (!title) return { ok: false, reason: "اكتب عنواناً مختصراً للملاحظة" };
  if (note.length < 5) {
    return { ok: false, reason: "اشرح الملاحظة في سطرٍ على الأقل — المُصلِحُ يقرؤه" };
  }

  // الوجهةُ: المؤسسُ، وإلّا فالتنفيذي
  const owner =
    (await prisma.user.findFirst({
      where: { role: "super_admin", isActive: true },
      select: { id: true },
    })) ??
    (await prisma.user.findFirst({
      where: { role: "executive", isActive: true },
      select: { id: true },
    }));
  if (!owner) return { ok: false, reason: "لا حسابَ نشطاً يستقبل الملاحظات الآن" };

  const isMember = opts.session.user.role === "member";
  // المهلةُ تُكتَب لأن العمودَ لازم، ولا تُقرأ: التحسيناتُ خارج الكنس
  const due = new Date(Date.now() + TICKET_STAGE_DAYS * 86_400_000);

  const created = await prisma.ticket.create({
    data: {
      subject: `${KIND_LABEL[opts.kind]}: ${title}`,
      description: note,
      memberId: isMember ? opts.session.user.id : null,
      raisedByUserId: isMember ? null : opts.session.user.id,
      targetUserId: owner.id,
      stage: "department",
      stageDueAt: due,
      firstDueAt: due,
      improvementKind: opts.kind,
      improvementState: "new",
      status: "open",
      pageContext: cleanContext(opts.context),
    },
    include: TICKET_INCLUDE,
  });

  // ولا بريد: المؤسسُ يَفتح صندوقَه فيَراها، وحدُّ الإرسال محدود
  await syncTicketSheetRow(created);
  return { ok: true, ticketNumber: created.ticketNumber };
}

/** يَنقل التحسينَ إلى حالته التالية — ويَرفض ما لا يُنتقَل إليه.
 *
 *  **والادّعاءُ في الشرط لا في التطبيق:** الحالةُ القديمةُ داخل `where`،
 *  فضغطتان متسارعتان على «أُصلح» تَمرّان مرّةً واحدة — والثانيةُ تُصيب
 *  صفراً من الصفوف. ولو قُرئت الحالةُ ثم قُورنت ثم كُتبت لمرّتا معاً.
 */
export async function advanceImprovement(opts: {
  ticketId: string;
  to: ImprovementState;
  note?: string | null;
  session: Session;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!canTriage(opts.session.user.role)) {
    return { ok: false, reason: "إدارةُ صندوق التحسين للمؤسس والمدير التنفيذي" };
  }

  const ticket = await prisma.ticket.findUnique({
    where: { id: opts.ticketId },
    select: { improvementKind: true, improvementState: true },
  });
  if (!ticket?.improvementKind || !ticket.improvementState) {
    return { ok: false, reason: "هذه ليست ملاحظةَ تحسين" };
  }
  const from = ticket.improvementState;
  if (from === opts.to) return { ok: true };
  if (!ALLOWED[from].includes(opts.to)) {
    return {
      ok: false,
      reason: `لا يُنتقَل من «${STATE_LABEL[from]}» إلى «${STATE_LABEL[opts.to]}» — والمسار: ${ALLOWED[
        from
      ]
        .map((s) => STATE_LABEL[s])
        .join("، ")}`,
    };
  }
  // الإغلاقُ يُسمّي سببَه: ملاحظةٌ تُغلَق بلا كلمةٍ تُقرأ تجاهلاً
  if (opts.to === "closed" && !opts.note?.trim()) {
    return { ok: false, reason: "اكتب سببَ الإغلاق — صاحبُ الملاحظة يقرؤه" };
  }

  const note = opts.note?.trim().slice(0, MAX_NOTE) || null;
  const claimed = await prisma.ticket.updateMany({
    where: { id: opts.ticketId, improvementState: from },
    data: {
      improvementState: opts.to,
      status: STATUS_OF[opts.to],
      ...(note ? { resolutionNote: note } : {}),
      ...(opts.to === "resolved" || opts.to === "closed"
        ? { resolvedAt: new Date(), resolvedByUserId: opts.session.user.id }
        : {}),
      // العودةُ إلى العمل تَمسح شهادةَ الرفض فلا تُقرأ قائمةً بعد معالجتها
      ...(opts.to === "in_progress" ? { userRejectedAt: null, resolvedAt: null } : {}),
    },
  });
  if (claimed.count === 0) return { ok: false, reason: "تغيّرت حالتُها — افتح الصفحة من جديد" };

  const full = await prisma.ticket.findUnique({
    where: { id: opts.ticketId },
    include: TICKET_INCLUDE,
  });
  if (full) await syncTicketSheetRow(full);
  return { ok: true };
}

/** شهادةُ صاحب الملاحظة: أزال الإصلاحُ ما رآه أم لا؟
 *
 *  ولا يَشهد إلا صاحبُها: من رفعها هو من رأى العطب. ومن شهد بزواله
 *  أُغلقت عنده، ومن قال إنها كما كانت عادت إلى العمل بملاحظته.
 */
export async function confirmImprovementFix(opts: {
  ticketId: string;
  verified: boolean;
  note?: string | null;
  session: Session;
}): Promise<{ ok: true; state: ImprovementState } | { ok: false; reason: string }> {
  const ticket = await prisma.ticket.findUnique({
    where: { id: opts.ticketId },
    select: {
      improvementKind: true,
      improvementState: true,
      memberId: true,
      raisedByUserId: true,
    },
  });
  if (!ticket?.improvementKind) return { ok: false, reason: "هذه ليست ملاحظةَ تحسين" };

  const mine =
    ticket.memberId === opts.session.user.id || ticket.raisedByUserId === opts.session.user.id;
  if (!mine) return { ok: false, reason: "يَشهد بالإصلاح صاحبُ الملاحظة وحده" };
  if (ticket.improvementState !== "awaiting_user") {
    return {
      ok: false,
      reason: `الملاحظةُ «${STATE_LABEL[ticket.improvementState ?? "new"]}» — ولا تُجرَّب إلا حين تَنتظر تجربتك`,
    };
  }

  const to: ImprovementState = opts.verified ? "resolved" : "in_progress";
  const claimed = await prisma.ticket.updateMany({
    where: { id: opts.ticketId, improvementState: "awaiting_user" },
    data: {
      improvementState: to,
      status: STATUS_OF[to],
      ...(opts.verified
        ? { userVerifiedAt: new Date(), userRejectedAt: null, resolvedAt: new Date() }
        : { userRejectedAt: new Date(), userVerifiedAt: null, resolvedAt: null }),
      ...(opts.note?.trim() ? { resolutionNote: opts.note.trim().slice(0, MAX_NOTE) } : {}),
    },
  });
  if (claimed.count === 0) return { ok: false, reason: "تغيّرت حالتُها — افتح الصفحة من جديد" };

  const full = await prisma.ticket.findUnique({
    where: { id: opts.ticketId },
    include: TICKET_INCLUDE,
  });
  if (full) await syncTicketSheetRow(full);
  return { ok: true, state: to };
}

/** الحقولُ التي يَقرؤها الصندوق — لا وصفاً كاملاً ولا علاقاتٍ ثقيلة */
const INBOX_SELECT = {
  id: true,
  ticketNumber: true,
  subject: true,
  description: true,
  improvementKind: true,
  improvementState: true,
  pageContext: true,
  resolutionNote: true,
  userVerifiedAt: true,
  userRejectedAt: true,
  convertedTaskId: true,
  convertedGoalId: true,
  createdAt: true,
  member: { select: { fullName: true } },
  raisedByUser: { select: { fullName: true } },
} as const;

/** حدُّ الصندوق — يُقرأ ولا يُمسَح كاملاً */
export const INBOX_TAKE = 200;

/** صندوقُ التحسينات لمن يُقرّر — مرتَّباً بالأحدث.
 *
 *  والمُغلَقُ يُطوى افتراضاً: الصندوقُ موضعُ عملٍ لا أرشيف. */
export async function improvementInbox(opts: { includeClosed?: boolean } = {}) {
  return prisma.ticket.findMany({
    where: {
      improvementKind: { not: null },
      ...(opts.includeClosed ? {} : { improvementState: { not: "closed" } }),
    },
    select: INBOX_SELECT,
    orderBy: { createdAt: "desc" },
    take: INBOX_TAKE,
  });
}

/** ملاحظاتي أنا — وما ينتظر شهادتي منها */
export async function myImprovements(session: Session) {
  const isMember = session.user.role === "member";
  return prisma.ticket.findMany({
    where: {
      improvementKind: { not: null },
      ...(isMember ? { memberId: session.user.id } : { raisedByUserId: session.user.id }),
    },
    select: INBOX_SELECT,
    orderBy: { createdAt: "desc" },
    take: INBOX_TAKE,
  });
}

/** عدُّ ما ينتظر في الصندوق — يُقال على الرابط نفسِه.
 *
 *  فالملاحظةُ المعلَّقة لا تُكتشَف بالتجوال في الصفحات. */
export async function improvementCounts(session: Session) {
  const isMember = session.user.role === "member";
  const [inbox, awaitingMe] = await Promise.all([
    canTriage(session.user.role)
      ? prisma.ticket.count({
          where: { improvementKind: { not: null }, improvementState: { in: ["new", "triaged"] } },
        })
      : Promise.resolve(0),
    prisma.ticket.count({
      where: {
        improvementKind: { not: null },
        improvementState: "awaiting_user",
        ...(isMember ? { memberId: session.user.id } : { raisedByUserId: session.user.id }),
      },
    }),
  ]);
  return { inbox, awaitingMe };
}
