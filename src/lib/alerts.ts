import { prisma } from "@/lib/prisma";
import type { Session } from "next-auth";
import { canDecideCommittee } from "@/lib/committees";
import { canManagePlans } from "@/lib/plans";
import { canGovernPeriod, OUTSTANDING_STATES } from "@/lib/execution";

/** تنبيهاتُ الصفحة الرئيسية — ما على هذا الشخص أن يفعله الآن.
 *
 *  **العطب الذي تُصلحه:** المنصة صارت عشرَ صفحات، فما ينتظر الشخصَ
 *  مبعثرٌ فيها: توقيعٌ مطلوبٌ في صفحة، واعتمادٌ في أخرى، وتحقّقٌ ثنائيٌّ
 *  في ثالثة، وبياناتٌ ناقصةٌ في رابعة. فمن لم يتجوّل في الصفحات لم
 *  يعرف أن عليه شيئاً — والتجوالُ ليس نظاماً.
 *
 *  فصار كلُّ ما ينتظره **سطراً أمامه في أول صفحةٍ يفتحها**، لكلٍّ
 *  وجهتُه. وشرطُ ذلك ثلاثةٌ تُراعى هنا:
 *
 *  1. **لا تنبيهَ بلا فعلٍ ممكن.** كلُّ سطرٍ له رابطٌ يُفضي إلى موضع
 *     الحلّ، فلا يُقال للشخص «عندك نقص» ويُترك يبحث.
 *  2. **لا تنبيهَ لمن لا يملكه.** طابورُ اللجان لا يُعرَض لقائد قسم،
 *     ولا طلباتُ التوقيع لمن لا توقيعَ عليه.
 *  3. **الصمتُ عند السلامة.** من لا شيء عليه لا يرى لوحةً فارغة تقول
 *     «لا تنبيهات» — ترتفع اللوحةُ كلُّها. فالتنبيهُ يبقى ذا معنى.
 *
 *  والقراءةُ كلُّها **عدٌّ لا جلبُ صفوف**: اللوحة تقول «ثلاث تذاكر» لا
 *  تعرضها، فلا تُحمَّل الصفحةُ الرئيسية بما يُعرَض في صفحته.
 */

export type AlertTone = "danger" | "warn" | "info";

export type Alert = {
  id: string;
  tone: AlertTone;
  title: string;
  body: string;
  href: string;
  cta: string;
};

function canReviewRole(role: string) {
  return role === "executive" || role === "super_admin";
}

/** يبني تنبيهاتِ صاحبِ حسابٍ إداري (مؤسس، تنفيذي، مسؤول تشغيل، قائد قسم) */
export async function alertsForUser(session: Session): Promise<Alert[]> {
  const userId = session.user.id;
  const role = session.user.role;
  const alerts: Alert[] = [];

  const me = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      totpEnabled: true,
      mustChangePassword: true,
      profileCompletedAt: true,
      // الختمُ يَكفي للسؤال «أله صورة؟» — ولا يَجلب ميجاباتٍ ليُجيب بحرف
      avatarVersion: true,
      phone: true,
      jobTitle: true,
      departmentId: true,
    },
  });
  if (!me) return alerts;

  const weekAgo = new Date(Date.now() - 7 * 86_400_000);
  const [
    awaitingApprovals,
    returnedApprovals,
    openAssignedTickets,
    overdueTickets,
    signatureTodo,
    signaturesToApprove,
    pendingCommittees,
    freshPlans,
    terminationsToDecide,
  ] = await Promise.all([
    prisma.ticket.count({
      where: { approverUserId: userId, approvalState: { in: ["awaiting", "reviewing"] } },
    }),
    prisma.ticket.count({
      where: { raisedByUserId: userId, approvalState: "returned" },
    }),
    prisma.ticket.count({
      where: { targetUserId: userId, status: { in: ["open", "in_progress"] } },
    }),
    // المتأخّرةُ تُقاس بموعدها لا بمرحلتها — والمرحلةُ تتبدّل
    prisma.ticket.count({
      where: {
        targetUserId: userId,
        status: { in: ["open", "in_progress"] },
        stageDueAt: { lt: new Date() },
      },
    }),
    prisma.leaderSignature.count({
      where: { userId, status: { in: ["requested", "rejected"] } },
    }),
    // اعتمادُ التوقيعات بيد الإدارة العليا والتنفيذي
    role === "super_admin" || role === "executive"
      ? prisma.leaderSignature.count({ where: { status: "submitted" } })
      : Promise.resolve(0),
    canDecideCommittee(role)
      ? prisma.department.count({ where: { committeeStatus: "pending_review" } })
      : Promise.resolve(0),
    prisma.planDoc.count({ where: { createdAt: { gte: weekAgo } } }),
    role === "super_admin" || role === "executive" || role === "department_admin"
      ? prisma.terminationRequest.count({ where: { status: { in: ["submitted", "meeting_requested"] } } })
      : Promise.resolve(0),
  ]);

  // ── الأمنُ أولاً: بابُ الدخول قبل كل عمل
  if (me.mustChangePassword) {
    alerts.push({
      id: "temp-password",
      tone: "danger",
      title: "كلمة مرورك ما زالت مؤقتة",
      body: "الرمزُ المؤقت سُلِّم إليك ليُستبدَل. وما دام قائماً فمن اطّلع عليه يدخل بحسابك.",
      href: "/change-password",
      cta: "غيّرها الآن",
    });
  }
  if (!me.totpEnabled) {
    alerts.push({
      id: "totp",
      tone: "warn",
      title: "التحقق بخطوتين غير مُفعَّل",
      body: "دخولك معلَّقٌ ببريدك وحده — فإن تعذّر الوصول إليه يوماً فلا طريق ثانياً لك. والتفعيلُ دقيقة.",
      href: "/admin/security",
      cta: "فعّله",
    });
  }

  // ── البيانات: الهيكلُ والشهادةُ يُقرآن منها
  const missing: string[] = [];
  if (!me.jobTitle?.trim()) missing.push("المسمّى الوظيفي");
  if (!me.phone?.trim()) missing.push("رقم الجوال");
  if (!me.avatarVersion) missing.push("الصورة الشخصية");
  if (!me.departmentId && role === "super_admin") missing.push("قسمك في الهيكل");
  if (missing.length > 0) {
    alerts.push({
      id: "profile",
      tone: "warn",
      title: `بياناتك ناقصة: ${missing.join("، ")}`,
      body: "بطاقتُك في الهيكل التنظيمي وشهادتُك تُقرآن من هذه البيانات — والناقصُ يظهر ناقصاً للجميع.",
      href: "/admin/profile",
      cta: "أكمِلها",
    });
  }

  // ── العمل المعلَّق باسمه
  if (overdueTickets > 0) {
    alerts.push({
      id: "tickets-overdue",
      tone: "danger",
      title: `${overdueTickets} تذكرة تأخّرت عن موعدها وهي باسمك`,
      body: "المتأخّرةُ تُصعَّد إلى من فوقك تلقائياً، وتُحسَب تأخّراً في تقرير الالتزام.",
      href: "/admin/tickets",
      cta: "افتحها",
    });
  } else if (openAssignedTickets > 0) {
    alerts.push({
      id: "tickets-open",
      tone: "info",
      title: `${openAssignedTickets} تذكرة مفتوحة موجَّهة إليك`,
      body: "لكلٍّ موعدٌ محدَّد — وما تأخّر منها يُصعَّد من تلقائه.",
      href: "/admin/tickets",
      cta: "افتحها",
    });
  }
  if (awaitingApprovals > 0) {
    alerts.push({
      id: "approvals",
      tone: "warn",
      title: `${awaitingApprovals} طلب اعتماد ينتظر قرارك`,
      body: "صاحبُها لا يبدأ التنفيذ حتى تقرّر — والانتظارُ بلا قرارٍ تعطيلٌ لا حياد.",
      href: "/admin/approvals",
      cta: "قرِّر فيها",
    });
  }
  if (returnedApprovals > 0) {
    alerts.push({
      id: "approvals-returned",
      tone: "warn",
      title: `${returnedApprovals} طلب من طلباتك رُدَّ إليك للتعديل`,
      body: "بملاحظاتٍ مكتوبة — تُعدَّل ويُعاد الطلب، ولا يُنشأ طلبٌ جديد.",
      href: "/admin/approvals",
      cta: "عدّلها",
    });
  }
  if (signatureTodo > 0) {
    alerts.push({
      id: "signature",
      tone: "warn",
      title: "توقيعك مطلوبٌ ولم يُرفَع بعد",
      body: "الشهاداتُ التي تصدر باسمك تُرسَم بتوقيعك أنت — ولا يُستعمل توقيعُ غيرك مكانه.",
      href: "/admin/signature",
      cta: "ارفع توقيعك",
    });
  }
  if (signaturesToApprove > 0) {
    alerts.push({
      id: "signatures-approve",
      tone: "info",
      title: `${signaturesToApprove} توقيع ينتظر اعتمادك`,
      body: "ولا يُرسَم توقيعٌ على شهادةٍ قبل اعتماده.",
      href: "/admin/signature",
      cta: "راجِعها",
    });
  }
  if (pendingCommittees > 0) {
    alerts.push({
      id: "committees",
      tone: "warn",
      title: `${pendingCommittees} اقتراح لجنة ينتظر قرارك`,
      body: "اللجنةُ لا تُفتح ولا يُدعى لها قائدٌ قبل اعتمادك — واقتراحُها يقف حتى تقرّر.",
      href: "/admin/departments",
      cta: "افتح الطابور",
    });
  }
  if (terminationsToDecide > 0) {
    alerts.push({
      id: "terminations",
      tone: "warn",
      title: `${terminationsToDecide} طلب إنهاء فترة إدارة ينتظر قراراً`,
      body: "أمامك الموافقةُ بتاريخٍ أو الرفضُ بتفسيرٍ أو طلبُ لقاءٍ قبل أن تقرّر.",
      href: "/admin/terminations",
      cta: "افتحها",
    });
  }

  // ── التنفيذ الاستراتيجي: ما عليه فيه، وما ينتظر قرارَه
  const [myOpenTasks, myOverdueTasks, awaitingVerify, carryNeedsPlan, unopenedNext] =
    await Promise.all([
      prisma.planTask.count({
        where: { ownerUserId: userId, execState: { in: OUTSTANDING_STATES } },
      }),
      prisma.planTask.count({
        where: {
          ownerUserId: userId,
          execState: { in: OUTSTANDING_STATES },
          dueAt: { lt: new Date() },
        },
      }),
      canReviewRole(role)
        ? prisma.planTask.count({ where: { execState: "submitted" } })
        : Promise.resolve(0),
      // المُرحَّلُ بلا إقرارٍ في قسمه — يَمنع اعتمادَ خطة الأسبوع
      role === "department_admin" && me.departmentId
        ? prisma.planTask.count({
            where: {
              departmentId: me.departmentId,
              carryoverCount: { gt: 0 },
              carryReason: null,
              execState: { in: OUTSTANDING_STATES },
            },
          })
        : Promise.resolve(0),
      canGovernPeriod(role)
        ? prisma.executionPeriod.count({ where: { state: "awaiting_opening" } })
        : Promise.resolve(0),
    ]);

  if (myOverdueTasks > 0) {
    alerts.push({
      id: "exec-overdue",
      tone: "danger",
      title: `${myOverdueTasks} التزاماً تأخّر عن موعده وهو باسمك`,
      body: "وما لم يكتمل لا يَختفي بانتهاء الأسبوع: يُرحَّل بموعده الأصلي ويُطلَب سببُه وخطةُ تصحيحه.",
      href: "/admin/execution",
      cta: "افتحها",
    });
  } else if (myOpenTasks > 0) {
    alerts.push({
      id: "exec-open",
      tone: "info",
      title: `${myOpenTasks} التزاماً قائماً باسمك هذا الأسبوع`,
      body: "لكلٍّ معيارُ إنجازٍ ومُراجِع — والتحقّقُ لا يقع على إعلانٍ بل على دليل.",
      href: "/admin/execution",
      cta: "افتحها",
    });
  }
  if (awaitingVerify > 0) {
    alerts.push({
      id: "exec-verify",
      tone: "warn",
      title: `${awaitingVerify} تسليماً ينتظر تحقّقك`,
      body: "ولا يُحتسَب أيٌّ منها إنجازاً معتمَداً قبل قرارك — والنسبةُ تُقرأ كما هي.",
      href: "/admin/execution/review",
      cta: "راجِعها",
    });
  }
  if (carryNeedsPlan > 0) {
    alerts.push({
      id: "exec-carry",
      tone: "warn",
      title: `${carryNeedsPlan} التزاماً مُرحَّلاً بلا سببٍ وخطةِ تصحيح`,
      body: "ولا تُرفَع خطةُ قسمك ولا تُعتمَد قبل إقرارهما — الترحيلُ التزامٌ يُعاد إقرارُه.",
      href: "/admin",
      cta: "أقِرَّها",
    });
  }
  if (unopenedNext > 0) {
    alerts.push({
      id: "exec-open-week",
      tone: "warn",
      title: "اكتملت المراجعةُ وأسبوعٌ ينتظر إذنَ الفتح",
      body: "ولا يُفتَح بمرور التقويم — الإذنُ قرارُك الصريح.",
      href: "/admin/execution",
      cta: "افتحه",
    });
  }

  // ── الخطط: خبرٌ لا نقص
  if (freshPlans > 0) {
    alerts.push({
      id: "plans",
      tone: "info",
      title: `${freshPlans} وثيقة جديدة في مركز الخطط`,
      body: canManagePlans(role)
        ? "أُضيفت خلال الأسبوع — راجِع ترتيبَها ونبذتَها."
        : "أُضيفت خلال الأسبوع ويقرؤها الجميع.",
      href: "/plans",
      cta: "اقرأها",
    });
  }

  return alerts;
}

/** يبني تنبيهاتِ عضو — ووجهاتُه غيرُ وجهات الإداري */
export async function alertsForMember(opts: {
  memberId: string;
  mustChangePassword: boolean;
  profileCompletedAt: Date | null;
  avatarVersion: Date | null;
  phone: string | null;
  unacknowledgedWarnings: number;
}): Promise<Alert[]> {
  const alerts: Alert[] = [];
  const weekAgo = new Date(Date.now() - 7 * 86_400_000);

  const [openTickets, overdueTickets, openTermination, freshPlans] = await Promise.all([
    prisma.ticket.count({
      where: { targetMemberId: opts.memberId, status: { in: ["open", "in_progress"] } },
    }),
    prisma.ticket.count({
      where: {
        targetMemberId: opts.memberId,
        status: { in: ["open", "in_progress"] },
        stageDueAt: { lt: new Date() },
      },
    }),
    prisma.terminationRequest.count({
      where: { memberId: opts.memberId, status: { in: ["submitted", "meeting_requested"] } },
    }),
    prisma.planDoc.count({ where: { createdAt: { gte: weekAgo } } }),
  ]);

  if (opts.mustChangePassword) {
    alerts.push({
      id: "temp-password",
      tone: "danger",
      title: "كلمة مرورك ما زالت مؤقتة",
      body: "الرمزُ المؤقت سُلِّم إليك ليُستبدَل — وما دام قائماً فمن اطّلع عليه يدخل بحسابك.",
      href: "/change-password",
      cta: "غيّرها الآن",
    });
  }
  if (opts.unacknowledgedWarnings > 0) {
    alerts.push({
      id: "warnings",
      tone: "danger",
      title: `${opts.unacknowledgedWarnings} تنبيه لم تطّلع عليه بعد`,
      body: "ثلاثةُ تنبيهاتٍ تؤدّي إلى إنهاء العضوية — والاطّلاعُ يُسجَّل باسمك.",
      href: "/member",
      cta: "اطّلع عليها",
    });
  }

  const missing: string[] = [];
  if (!opts.phone?.trim()) missing.push("رقم الجوال");
  if (!opts.avatarVersion) missing.push("الصورة الشخصية");
  if (!opts.profileCompletedAt) missing.push("بيانات التخصص والشعبة");
  if (missing.length > 0) {
    alerts.push({
      id: "profile",
      tone: "warn",
      title: `بياناتك ناقصة: ${missing.join("، ")}`,
      body: "بطاقتُك في الهيكل التنظيمي وشهادتُك تُقرآن منها — والناقصُ يظهر ناقصاً للجميع.",
      href: "/member/welcome",
      cta: "أكمِلها",
    });
  }

  if (overdueTickets > 0) {
    alerts.push({
      id: "tickets-overdue",
      tone: "danger",
      title: `${overdueTickets} تذكرة تأخّرت عن موعدها وهي باسمك`,
      body: "المتأخّرةُ تُصعَّد إلى قائد قسمك تلقائياً.",
      href: "/member",
      cta: "افتحها",
    });
  } else if (openTickets > 0) {
    alerts.push({
      id: "tickets-open",
      tone: "info",
      title: `${openTickets} تذكرة مفتوحة موجَّهة إليك`,
      body: "لكلٍّ موعدٌ محدَّد — وما تأخّر يُصعَّد من تلقائه.",
      href: "/member",
      cta: "افتحها",
    });
  }
  if (openTermination > 0) {
    alerts.push({
      id: "termination",
      tone: "info",
      title: "طلبُ إنهاء فترة إدارتك قائمٌ بانتظار القرار",
      body: "وأنت على عملك حتى يُقرَّر وتحلّ المهلة — الرفعُ لا يُعطّل أحداً.",
      href: "/member",
      cta: "تابِعه",
    });
  }
  const [myOpen, myOverdue] = await Promise.all([
    prisma.planTask.count({
      where: { ownerMemberId: opts.memberId, execState: { in: OUTSTANDING_STATES } },
    }),
    prisma.planTask.count({
      where: {
        ownerMemberId: opts.memberId,
        execState: { in: OUTSTANDING_STATES },
        dueAt: { lt: new Date() },
      },
    }),
  ]);
  if (myOverdue > 0) {
    alerts.push({
      id: "exec-overdue",
      tone: "danger",
      title: `${myOverdue} التزاماً تأخّر عن موعده وهو باسمك`,
      body: "ولا يَختفي بانتهاء الأسبوع: يُرحَّل بموعده الأصلي ويُطلَب سببُه وخطةُ تصحيحه.",
      href: "/member",
      cta: "افتحها",
    });
  } else if (myOpen > 0) {
    alerts.push({
      id: "exec-open",
      tone: "info",
      title: `${myOpen} التزاماً قائماً باسمك`,
      body: "لكلٍّ معيارُ إنجازٍ ودليلٌ يُرفَع — والتحقّقُ من مسؤولك لا منك.",
      href: "/member",
      cta: "افتحها",
    });
  }

  if (freshPlans > 0) {
    alerts.push({
      id: "plans",
      tone: "info",
      title: `${freshPlans} وثيقة جديدة في مركز الخطط`,
      body: "خطةُ تَـــلاقِ وأهدافُها — أُضيفت خلال الأسبوع.",
      href: "/plans",
      cta: "اقرأها",
    });
  }

  return alerts;
}
