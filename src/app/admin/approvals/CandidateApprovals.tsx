import type { Session } from "next-auth";
import { prisma } from "@/lib/prisma";
import { QUEUE_TAKE, halfApprovedLeaders } from "@/lib/workflow";
import { canDecideCandidate } from "@/lib/permissions";
import { BRAND } from "@/lib/brand";
import { getLocale, getDictionary } from "@/i18n/server";
import { ApprovalQueue } from "../ApprovalQueue";
import { IncompletePromotionRow } from "./IncompletePromotionRow";

/** طلباتُ الانضمام بانتظار الاعتماد — موضعُها الواحد.
 *
 *  كانت قائمتاها في النظرة العامة وحدها: اللوحةُ التي يُفترض أنها ملخّص
 *  صارت المكانَ الوحيد لقرار اعتماد القادة. فنُقلتا إلى «الاعتمادات»
 *  حيث يُبحث عن كلّ ما ينتظر موافقة، والنظرة العامة تَعُدّهما وتُحيل إليهما.
 *
 *  والتصفية نفسها كما كانت: كلٌّ يرى من يَحسم أمره وحده
 *  (`canDecideCandidate`)، والخادم يفرض الشرط ذاته عند القرار. */
export async function CandidateApprovals({ session }: { session: Session }) {
  const dict = getDictionary(await getLocale());
  const ta = dict.admin;

  const [allLeadership, memberQueue, allIncomplete] = await Promise.all([
    prisma.member.findMany({
      omit: { avatarData: true },
      where: {
        approvalStatus: "pending_review",
        testStatus: "passed",
        invite: { targetRole: { in: ["department_admin", "operations_officer", "executive"] } },
      },
      include: { department: true, invite: true },
      orderBy: { createdAt: "asc" },
      take: QUEUE_TAKE,
    }),
    prisma.member.findMany({
      omit: { avatarData: true },
      where: { approvalStatus: "pending_review", testStatus: "passed", invite: { targetRole: "member" } },
      include: { department: true, invite: true },
      orderBy: { createdAt: "asc" },
      take: QUEUE_TAKE,
    }),
    halfApprovedLeaders(),
  ]);
  const viewer = { role: session.user.role, departmentId: session.user.departmentId };
  // اعتماداتٌ قياديةٌ تعثّرت قبل الإصلاح: أصحابُها معتمَدون يدخلون أعضاءً — يراها من يملك منصبَهم
  const incomplete = allIncomplete.filter((m) =>
    canDecideCandidate(viewer, { targetRole: m.invite.targetRole, departmentId: m.departmentId })
  );
  const leadership = allLeadership.filter((m) =>
    canDecideCandidate(
      { role: session.user.role, departmentId: session.user.departmentId },
      { targetRole: m.invite.targetRole, departmentId: m.departmentId }
    )
  );

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
          members={memberQueue.map((m) => ({
            id: m.id,
            fullName: m.fullName,
            email: m.email,
            testScore: m.testScore,
            departmentName: m.department?.name ?? "—",
            departmentColor: m.department?.colorHex ?? BRAND.temptress,
          }))}
        />
      </div>
    </section>
  );
}
