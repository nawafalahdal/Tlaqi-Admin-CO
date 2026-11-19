import type { Session } from "next-auth";
import { prisma } from "@/lib/prisma";
import { QUEUE_TAKE, halfApprovedLeaders } from "@/lib/workflow";
import { canDecideCandidate } from "@/lib/permissions";
import { authoritiesFor, decisionViewer } from "@/lib/candidateDecision";
import { BRAND, themeFromColor } from "@/lib/brand";
import { NeedsMeetingRow } from "@/app/admin/departments/[slug]/NeedsMeetingRow";
import { SeniorPositionDecisionRow } from "./SeniorPositionDecisionRow";
import { seniorPositionsAwaitingDecision } from "@/lib/assessments";
import { getLocale, getDictionary } from "@/i18n/server";
import { ApprovalQueue } from "../ApprovalQueue";
import { IncompletePromotionRow } from "./IncompletePromotionRow";

/** **طابورُ القرار** — طلباتُ الانضمام التي يحسمها صاحبُ الجلسة وحده (`canDecideCandidate` بجهة كلِّ مرشّحٍ من
 *  القاعدة — `lib/candidateDecision`)، والخادمُ يفرض الشرطَ ذاته عند القرار.
 *
 *  **ولا يحسم المؤسسُ ولا الرئيسُ التنفيذيُّ شيئاً منها** (قرار المؤسس، ق١): لهما «نتائجُ المرشّحين» للاطّلاع
 *  (`CandidateResults`). ويَظهر هذا الطابورُ لجهة الاعتماد المستقلة («اعتماد العضوية») في `/senior/approvals`
 *  — وقد تكون عضواً لا يدخل `/admin` — ولأيّ حسابٍ إداريٍّ يحملها في «الاعتمادات». */
export async function CandidateApprovals({ session }: { session: Session }) {
  const viewer = await decisionViewer(session);
  const dict = getDictionary(await getLocale());
  const ta = dict.admin;

  const [allLeadership, memberQueue, allIncomplete, allFailed] = await Promise.all([
    prisma.member.findMany({
      omit: { avatarData: true },
      where: {
        approvalStatus: "pending_review",
        testStatus: "passed",
        isActive: true,
        invite: { targetRole: { in: ["department_admin", "operations_officer", "executive"] } },
      },
      include: { department: true, invite: true },
      orderBy: { createdAt: "asc" },
      take: QUEUE_TAKE,
    }),
    prisma.member.findMany({
      omit: { avatarData: true },
      where: { approvalStatus: "pending_review", testStatus: "passed", isActive: true, invite: { targetRole: "member" } },
      include: { department: true, invite: true },
      orderBy: { createdAt: "asc" },
      take: QUEUE_TAKE,
    }),
    halfApprovedLeaders(),
    // لم يجتازوا — إعادةُ فتح اختبارهم قرارُ اعتمادٍ لجهة حسمهم (قائدُ القسم يراهم في صفحة قسمه)
    viewer.designatedApprover || viewer.seniorLeader
      ? prisma.member.findMany({
          omit: { avatarData: true },
          where: { approvalStatus: "pending_review", testStatus: "failed", isActive: true, terminatedAt: null },
          include: { department: true, invite: true },
          orderBy: { createdAt: "asc" },
          take: QUEUE_TAKE,
        })
      : Promise.resolve([]),
  ]);
  const authority = await authoritiesFor([...allLeadership, ...memberQueue, ...allIncomplete, ...allFailed]);
  const mine = <T extends { id: string; departmentId: string | null }>(rows: T[]) =>
    rows.filter((m) => canDecideCandidate(viewer, { departmentId: m.departmentId, authority: authority.get(m.id)! }));
  // اعتماداتٌ قياديةٌ تعثّرت قبل الإصلاح: أصحابُها معتمَدون يدخلون أعضاءً — يراها من يملك منصبَهم
  const incomplete = mine(allIncomplete);
  const leadership = mine(allLeadership);
  const members = mine(memberQueue);
  const failed = mine(allFailed);
  // مناصبُ الإدارة العليا لأصحاب حساباتٍ قائمة — بعد تسليم اختبارهم (جهةُ الاعتماد المستقلة وحدها)
  const positions = viewer.designatedApprover ? await seniorPositionsAwaitingDecision() : [];
  if (!viewer.designatedApprover && !viewer.seniorLeader && viewer.role !== "department_admin") return null;
  // قائدُ الإدارة العليا (الرئيسُ التنفيذي) لا يُعرض له طابورٌ فارغ — يرى ما يحسمه حين يوجد
  if (viewer.seniorLeader && !viewer.designatedApprover && members.length + failed.length === 0) return null;

  return (
    <section id="joins" className="flex scroll-mt-24 flex-col gap-5">
      {incomplete.length > 0 && (
        <div>
          <h2 className="text-base font-bold">{ta.incompletePromotionTitle}</h2>
          <p className="mb-3 mt-1 text-xs text-black/50">{ta.incompletePromotionHint}</p>
          <div className="flex flex-col gap-3">
            {incomplete.map((m) => (
              <IncompletePromotionRow
                key={m.id}
                member={{
                  id: m.id,
                  fullName: m.fullName,
                  email: m.email,
                  positionName: m.department ? `${dict.roles[m.invite.targetRole]} — ${m.department.name}` : dict.roles[m.invite.targetRole],
                  departmentColor: m.department?.colorHex ?? BRAND.temptress,
                }}
              />
            ))}
          </div>
        </div>
      )}
      <div>
        <h2 className="mb-3 text-base font-bold">{ta.leadershipQueueTitle}</h2>
        <ApprovalQueue
          emptyMessage={ta.leadershipQueueEmpty}
          members={leadership.map((m) => ({
            id: m.id,
            fullName: m.fullName,
            email: m.email,
            testScore: m.testScore,
            departmentName: m.department?.name ?? dict.roles[m.invite.targetRole],
            departmentColor: m.department?.colorHex ?? BRAND.temptress,
          }))}
        />
      </div>
      <div>
        <h2 className="text-base font-bold">{ta.memberQueueTitle}</h2>
        <p className="mb-3 mt-1 text-xs text-black/40">{ta.memberQueueHint}</p>
        <ApprovalQueue
          emptyMessage={ta.memberQueueEmpty}
          members={members.map((m) => ({
            id: m.id,
            fullName: m.fullName,
            email: m.email,
            testScore: m.testScore,
            departmentName: m.department?.name ?? "—",
            departmentColor: m.department?.colorHex ?? BRAND.temptress,
          }))}
        />
      </div>
      {positions.length > 0 && (
        <div>
          <h2 className="text-base font-bold">مناصبُ الإدارة العليا بانتظار التفعيل ({positions.length})</h2>
          <p className="mb-3 mt-1 text-xs text-black/40">
            أصحابُ حساباتٍ قائمة قبلوا منصباً واختبروا — عضويتُهم القائمة لا تُمسّ، والمنصبُ لا يُفعَّل إلا باعتمادك.
          </p>
          <div className="flex flex-col gap-3">
            {positions.map((p) => (
              <SeniorPositionDecisionRow
                key={p.id}
                item={{
                  id: p.id,
                  name: p.member?.fullName ?? p.user?.fullName ?? "—",
                  email: p.member?.email ?? p.user?.email ?? "",
                  title: p.seniorPosition?.titleAr ?? "",
                  score: p.score,
                  passed: p.status === "passed",
                }}
              />
            ))}
          </div>
        </div>
      )}
      {failed.length > 0 && (
        <div>
          <h2 className="text-base font-bold">لم يجتازوا الاختبار ({failed.length})</h2>
          <p className="mb-3 mt-1 text-xs text-black/40">
            يُعاد فتحُ الاختبار على السجلّ نفسه بعد اجتماع الشرح — بلا دعوةٍ جديدة، ولا رسالةٍ ما لم تُخترها.
          </p>
          <div className="flex flex-col gap-3">
            {failed.map((m) => (
              <NeedsMeetingRow
                key={m.id}
                theme={themeFromColor(m.department?.colorHex ?? BRAND.temptress)}
                member={{ id: m.id, fullName: m.fullName, email: m.email, testScore: m.testScore }}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
