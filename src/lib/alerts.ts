import { prisma } from "@/lib/prisma";
import type { Session } from "next-auth";
import { canDecideCommittee } from "@/lib/committees";
import { canDecideDepartmentRequest } from "@/lib/departments";
import { canManagePlans } from "@/lib/plans";
import { canGovernPeriod, OUTSTANDING_STATES } from "@/lib/execution";
import { improvementCounts } from "@/lib/improvements";

import { getDictionary, type Locale } from "@/i18n";
import { fmt } from "@/i18n/fmt";
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
export async function alertsForUser(session: Session, locale: Locale = "ar"): Promise<Alert[]> {
  const L = getDictionary(locale).libAlerts;
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
    departmentRequests,
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
      ? prisma.department.count({ where: { committeeStatus: "pending_review", parentId: { not: null } } })
      : Promise.resolve(0),
    prisma.planDoc.count({ where: { createdAt: { gte: weekAgo } } }),
    role === "super_admin" || role === "executive" || role === "department_admin"
      ? prisma.terminationRequest.count({ where: { status: { in: ["submitted", "meeting_requested"] } } })
      : Promise.resolve(0),
    // طلباتُ إنشاء الأقسام تصل المؤسس وحده — هو من يعتمدها
    canDecideDepartmentRequest(role)
      ? prisma.department.count({ where: { committeeStatus: "pending_review", parentId: null } })
      : Promise.resolve(0),
  ]);

  // ── الأمنُ أولاً: بابُ الدخول قبل كل عمل
  if (me.mustChangePassword) {
    alerts.push({
      id: "temp-password",
      tone: "danger",
      title: L.yourPasswordIsStill,
      body: L.theTemporaryCodeWas,
      href: "/change-password",
      cta: L.changeItNow,
    });
  }
  if (!me.totpEnabled) {
    alerts.push({
      id: "totp",
      tone: "warn",
      title: L.twoFactorAuthenticationIs,
      body: L.yourSignInHangs,
      href: "/admin/security",
      cta: L.turnItOn,
    });
  }

  // ── البيانات: الهيكلُ والشهادةُ يُقرآن منها
  const missing: string[] = [];
  if (!me.jobTitle?.trim()) missing.push(L.jobTitle);
  if (!me.phone?.trim()) missing.push(L.mobileNumber);
  if (!me.avatarVersion) missing.push(L.profilePhoto);
  if (!me.departmentId && role === "super_admin") missing.push(L.yourDepartmentInThe);
  if (missing.length > 0) {
    alerts.push({
      id: "profile",
      tone: "warn",
      title: fmt(L.missingData, missing.join(L.listSep)),
      body: L.yourCardInThe,
      href: "/admin/profile",
      cta: L.completeThem,
    });
  }

  // ── العمل المعلَّق باسمه
  if (overdueTickets > 0) {
    alerts.push({
      id: "tickets-overdue",
      tone: "danger",
      title: fmt(L.ticketsInYourName, overdueTickets),
      body: L.lateTicketsEscalateAutomatically,
      href: "/admin/tickets",
      cta: L.openThem,
    });
  } else if (openAssignedTickets > 0) {
    alerts.push({
      id: "tickets-open",
      tone: "info",
      title: fmt(L.openTicketsAreAssigned, openAssignedTickets),
      body: L.eachHasASet,
      href: "/admin/tickets",
      cta: L.openThem,
    });
  }
  if (awaitingApprovals > 0) {
    alerts.push({
      id: "approvals",
      tone: "warn",
      title: fmt(L.approvalRequestsAwaitYour, awaitingApprovals),
      body: L.theirOwnersCannotStart,
      href: "/admin/approvals",
      cta: L.decideOnThem,
    });
  }
  if (returnedApprovals > 0) {
    alerts.push({
      id: "approvals-returned",
      tone: "warn",
      title: fmt(L.ofYourRequestsWere, returnedApprovals),
      body: L.withWrittenNotesThey,
      href: "/admin/approvals",
      cta: L.editThem,
    });
  }
  if (signatureTodo > 0) {
    alerts.push({
      id: "signature",
      tone: "warn",
      title: L.yourSignatureIsRequired,
      body: L.certificatesIssuedInYour,
      href: "/admin/signature",
      cta: L.uploadYourSignature,
    });
  }
  if (signaturesToApprove > 0) {
    alerts.push({
      id: "signatures-approve",
      tone: "info",
      title: fmt(L.signaturesAwaitYourApproval, signaturesToApprove),
      body: L.noSignatureIsDrawn,
      href: "/admin/signature",
      cta: L.reviewThem,
    });
  }
  if (pendingCommittees > 0) {
    alerts.push({
      id: "committees",
      tone: "warn",
      title: fmt(L.committeeProposalsAwaitYour, pendingCommittees),
      body: L.aCommitteeDoesNot,
      href: "/admin/departments",
      cta: L.openTheQueue,
    });
  }
  if (departmentRequests > 0) {
    alerts.push({
      id: "department-requests",
      tone: "warn",
      title: fmt(L.departmentCreationRequestsAwait, departmentRequests),
      body: L.aDepartmentIsNot,
      href: "/admin/departments",
      cta: L.openTheRequests,
    });
  }
  if (terminationsToDecide > 0) {
    alerts.push({
      id: "terminations",
      tone: "warn",
      title: fmt(L.administrationTermTerminationRequests, terminationsToDecide),
      body: L.youCanApproveWith,
      href: "/admin/terminations",
      cta: L.openThem,
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
      title: fmt(L.commitmentsInYourName, myOverdueTasks),
      body: L.whatIsUnfinishedDoes,
      href: "/admin/execution",
      cta: L.openThem,
    });
  } else if (myOpenTasks > 0) {
    alerts.push({
      id: "exec-open",
      tone: "info",
      title: fmt(L.openCommitmentsInYour, myOpenTasks),
      body: L.eachHasAnAcceptance,
      href: "/admin/execution",
      cta: L.openThem,
    });
  }
  if (awaitingVerify > 0) {
    alerts.push({
      id: "exec-verify",
      tone: "warn",
      title: fmt(L.submissionsAwaitYourVerification, awaitingVerify),
      body: L.noneCountsAsApproved,
      href: "/admin/execution/review",
      cta: L.reviewThem,
    });
  }
  if (carryNeedsPlan > 0) {
    alerts.push({
      id: "exec-carry",
      tone: "warn",
      title: fmt(L.carriedOverCommitmentsLack, carryNeedsPlan),
      body: L.yourDepartmentSPlan,
      href: "/admin",
      cta: L.confirmThem,
    });
  }
  if (unopenedNext > 0) {
    alerts.push({
      id: "exec-open-week",
      tone: "warn",
      title: L.theReviewIsComplete,
      body: L.itDoesNotOpen,
      href: "/admin/execution",
      cta: L.openIt,
    });
  }

  // ── الخطط: خبرٌ لا نقص
  if (freshPlans > 0) {
    alerts.push({
      id: "plans",
      tone: "info",
      title: fmt(L.newDocumentsInThe, freshPlans),
      body: canManagePlans(role)
        ? L.addedDuringTheWeek
        : L.addedDuringTheWeek2,
      href: "/plans",
      cta: L.readThem,
    });
  }

  // ── مركزُ التحسين: ما ينتظر شهادتي، وما ينتظر قراري
  //
  //    والشهادةُ تتصدّر القرار: ملاحظةٌ أُصلحت وتَنتظر صاحبَها تقف إلى
  //    الأبد إن لم يُقَل له، فيُقفَل عليها الصندوق.
  {
    const { inbox, awaitingMe } = await improvementCounts(session);
    if (awaitingMe > 0) {
      alerts.push({
        id: "improve-mine",
        tone: "warn",
        title: fmt(L.fixedNotesAwaitYour, awaitingMe),
        body: L.tryItAndConfirm,
        href: "/admin/improvements",
        cta: L.tryIt,
      });
    }
    if (inbox > 0) {
      alerts.push({
        id: "improve-inbox",
        tone: "info",
        title: fmt(L.improvementNotesInThe, inbox),
        body: L.raisedFromTheImprove,
        href: "/admin/improvements",
        cta: L.openTheInbox,
      });
    }
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
}, locale: Locale = "ar"): Promise<Alert[]> {
  const L = getDictionary(locale).libAlerts;
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
      title: L.yourPasswordIsStill,
      body: L.theTemporaryCodeWas2,
      href: "/change-password",
      cta: L.changeItNow,
    });
  }
  if (opts.unacknowledgedWarnings > 0) {
    alerts.push({
      id: "warnings",
      tone: "danger",
      title: fmt(L.warningsYouHaveNot, opts.unacknowledgedWarnings),
      body: L.threeWarningsLeadTo,
      href: "/member",
      cta: L.viewThem,
    });
  }

  const missing: string[] = [];
  if (!opts.phone?.trim()) missing.push(L.mobileNumber);
  if (!opts.avatarVersion) missing.push(L.profilePhoto);
  if (!opts.profileCompletedAt) missing.push(L.specialisationAndSectionDetails);
  if (missing.length > 0) {
    alerts.push({
      id: "profile",
      tone: "warn",
      title: fmt(L.missingData, missing.join(L.listSep)),
      body: L.yourCardInThe2,
      href: "/member/welcome",
      cta: L.completeThem,
    });
  }

  if (overdueTickets > 0) {
    alerts.push({
      id: "tickets-overdue",
      tone: "danger",
      title: fmt(L.ticketsInYourName, overdueTickets),
      body: L.lateTicketsEscalateAutomatically2,
      href: "/member",
      cta: L.openThem,
    });
  } else if (openTickets > 0) {
    alerts.push({
      id: "tickets-open",
      tone: "info",
      title: fmt(L.openTicketsAreAssigned, openTickets),
      body: L.eachHasASet2,
      href: "/member",
      cta: L.openThem,
    });
  }
  if (openTermination > 0) {
    alerts.push({
      id: "termination",
      tone: "info",
      title: L.yourRequestToEnd,
      body: L.youStayInYour,
      href: "/member",
      cta: L.followIt,
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
      title: fmt(L.commitmentsInYourName, myOverdue),
      body: L.itDoesNotDisappear,
      href: "/member",
      cta: L.openThem,
    });
  } else if (myOpen > 0) {
    alerts.push({
      id: "exec-open",
      tone: "info",
      title: fmt(L.openCommitmentsInYour2, myOpen),
      body: L.eachHasAnAcceptance2,
      href: "/member",
      cta: L.openThem,
    });
  }

  if (freshPlans > 0) {
    alerts.push({
      id: "plans",
      tone: "info",
      title: fmt(L.newDocumentsInThe, freshPlans),
      body: L.tlaqiSPlanAnd,
      href: "/plans",
      cta: L.readThem,
    });
  }

  // ── مركزُ التحسين: ما ينتظر شهادتي، وما ينتظر قراري
  //
  //    والشهادةُ تتصدّر القرار: ملاحظةٌ أُصلحت وتَنتظر صاحبَها تقف إلى
  //    الأبد إن لم يُقَل له، فيُقفَل عليها الصندوق.
  {
    const { inbox, awaitingMe } = await improvementCounts({ user: { id: opts.memberId, role: "member" } } as Session);
    if (awaitingMe > 0) {
      alerts.push({
        id: "improve-mine",
        tone: "warn",
        title: fmt(L.fixedNotesAwaitYour, awaitingMe),
        body: L.tryItAndConfirm,
        href: "/admin/improvements",
        cta: L.tryIt,
      });
    }
    if (inbox > 0) {
      alerts.push({
        id: "improve-inbox",
        tone: "info",
        title: fmt(L.improvementNotesInThe, inbox),
        body: L.raisedFromTheImprove,
        href: "/admin/improvements",
        cta: L.openTheInbox,
      });
    }
  }

  return alerts;
}
