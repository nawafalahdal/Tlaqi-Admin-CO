import { redirect } from "next/navigation";
import { auth } from "@/auth";
import {
  approvalsAwaiting,
  myApprovalRequests,
  possibleApprovers,
  APPROVAL_KIND_LABELS,
  APPROVAL_STATE_LABELS,
} from "@/lib/approvals";
import { accountRoleLabel } from "@/lib/testTracks";
import { themeFromColor, SUPER_ADMIN_THEME } from "@/lib/brand";
import { AppHeader, Card } from "@/components/ui";
import { HeaderActions } from "@/components/HeaderActions";
import { BackButton } from "@/components/BackButton";
import { formatDate } from "@/lib/format";
import { ApprovalDecide } from "./ApprovalDecide";
import { RequesterActions } from "./RequesterActions";
import { RequestApproval } from "./RequestApproval";
import { myTicketsWithoutApproval } from "./actions";
import type { ApprovalKind, ApprovalState } from "@prisma/client";

/** الاعتمادات الإدارية — «بانتظار اعتمادي» و«طلباتي» في صفحةٍ واحدة.
 *
 *  والصفحة لا تمنح تصريحاً: كلُّ زرٍّ فيها يستدعي إجراءً يفرض شرطه في
 *  `where` بنفسه، فلو وصل أحدٌ إلى الصفحة بغير حقّه لم يصنع بها شيئاً.
 *  وإخفاء الأزرار راحةٌ للعين، لا حِمىً.
 */
export const dynamic = "force-dynamic";

const OPEN_STATES: ApprovalState[] = ["draft", "awaiting", "reviewing", "returned", "executing"];

export default async function ApprovalsPage() {
  const session = await auth();
  if (!session) redirect("/login");

  const theme = themeFromColor(SUPER_ADMIN_THEME.colorHex);

  const [awaiting, mine, approvers, attachable] = await Promise.all([
    approvalsAwaiting(session.user.id),
    myApprovalRequests(session.user.id),
    possibleApprovers(session.user.id),
    myTicketsWithoutApproval(),
  ]);

  const openMine = mine.filter(
    (x) => x.approvalState && OPEN_STATES.includes(x.approvalState)
  );
  const settledMine = mine.filter(
    (x) => x.approvalState && !OPEN_STATES.includes(x.approvalState)
  );

  return (
    <div className="min-h-screen bg-page">
      <AppHeader
        theme={theme}
        roleName={accountRoleLabel(session.user.role)}
        userName={session.user.name ?? ""}
      >
        <HeaderActions color={theme.text} />
      </AppHeader>

      <main className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-6 sm:px-5 sm:py-8">
        <div>
          <BackButton />
          <h1 className="text-lg font-bold sm:text-xl">الاعتمادات الإدارية</h1>
          <p className="mt-1 text-sm leading-relaxed text-black/50">
            ما يحتاج موافقةَ مسؤولٍ أعلى قبل التنفيذ يمرّ من هنا. والحالة تُنقل بقرارٍ صريح —
            فتحُ الطلب وقراءته لا يُغيّر حالته.
          </p>
        </div>

        <section>
          <h2 className="mb-3 text-base font-bold">
            بانتظار اعتمادي ({awaiting.length})
          </h2>
          {awaiting.length === 0 ? (
            <Card className="p-8 text-center text-sm text-black/40">
              لا طلبات على طاولتك الآن.
            </Card>
          ) : (
            <div className="flex flex-col gap-3">
              {awaiting.map((x) => (
                <Card key={x.id} className="p-4 sm:p-5">
                  <RequestHead
                    ticketNumber={x.ticketNumber}
                    subject={x.subject}
                    description={x.description}
                    kind={x.approvalKind}
                    state={x.approvalState}
                    createdAt={x.createdAt}
                    personName={x.raisedByUser?.fullName ?? "—"}
                    personTitle={x.raisedByUser?.jobTitle ?? null}
                    personRole={x.raisedByUser ? accountRoleLabel(x.raisedByUser.role) : null}
                    personDept={x.raisedByUser?.department?.name ?? null}
                    personLabel="مُقدِّم الطلب"
                    step={x.approvalStep}
                    chainLength={x.approvalChain.length}
                  />
                  <Trail decisions={x.decisions} />
                  <ApprovalDecide
                    ticketId={x.id}
                    ticketNumber={x.ticketNumber}
                    subject={x.subject}
                    requesterName={x.raisedByUser?.fullName ?? "—"}
                    isReviewing={x.approvalState === "reviewing"}
                    theme={theme}
                  />
                </Card>
              ))}
            </div>
          )}
        </section>

        <RequestApproval
          tickets={attachable}
          approvers={approvers.map((a) => ({
            id: a.id,
            label: a.department
              ? `${a.fullName} — ${accountRoleLabel(a.role)} · ${a.department.name}`
              : `${a.fullName} — ${accountRoleLabel(a.role)}`,
          }))}
          theme={theme}
        />

        <section>
          <h2 className="mb-3 text-base font-bold">طلباتي القائمة ({openMine.length})</h2>
          {openMine.length === 0 ? (
            <Card className="p-8 text-center text-sm text-black/40">
              لا طلبات اعتمادٍ قائمةً لك.
            </Card>
          ) : (
            <div className="flex flex-col gap-3">
              {openMine.map((x) => (
                <Card key={x.id} className="p-4 sm:p-5">
                  <RequestHead
                    ticketNumber={x.ticketNumber}
                    subject={x.subject}
                    description={x.description}
                    kind={x.approvalKind}
                    state={x.approvalState}
                    createdAt={x.createdAt}
                    personName={x.approverUser?.fullName ?? "—"}
                    personTitle={null}
                    personRole={null}
                    personDept={null}
                    personLabel="عند المعتمِد"
                    step={x.approvalStep}
                    chainLength={x.approvalChain.length}
                  />
                  <Trail decisions={x.decisions} />
                  <RequesterActions
                    ticketId={x.id}
                    state={x.approvalState ?? ""}
                    theme={theme}
                  />
                </Card>
              ))}
            </div>
          )}
        </section>

        {settledMine.length > 0 && (
          <section>
            <h2 className="mb-3 text-base font-bold">
              طلباتٌ انتهت ({settledMine.length})
            </h2>
            <div className="flex flex-col gap-3">
              {settledMine.map((x) => (
                <Card key={x.id} className="p-4 sm:p-5">
                  <RequestHead
                    ticketNumber={x.ticketNumber}
                    subject={x.subject}
                    description={null}
                    kind={x.approvalKind}
                    state={x.approvalState}
                    createdAt={x.createdAt}
                    personName={x.approvedByUser?.fullName ?? x.approverUser?.fullName ?? "—"}
                    personTitle={null}
                    personRole={null}
                    personDept={null}
                    personLabel={x.approvalState === "approved" ? "اعتمده" : "آخر من قرّر"}
                    step={x.approvalStep}
                    chainLength={x.approvalChain.length}
                  />
                  <Trail decisions={x.decisions} />
                </Card>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

function StateChip({ state }: { state: ApprovalState }) {
  const tone =
    state === "approved" || state === "completed"
      ? "bg-green-50 text-green-800 ring-green-200"
      : state === "rejected"
        ? "bg-red-50 text-red-800 ring-red-200"
        : state === "returned"
          ? "bg-amber-50 text-amber-800 ring-amber-200"
          : "bg-black/[0.04] text-black/60 ring-black/10";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold ring-1 ${tone}`}
    >
      {APPROVAL_STATE_LABELS[state]}
    </span>
  );
}

function RequestHead({
  ticketNumber,
  subject,
  description,
  kind,
  state,
  createdAt,
  personName,
  personTitle,
  personRole,
  personDept,
  personLabel,
  step,
  chainLength,
}: {
  ticketNumber: number;
  subject: string;
  description: string | null;
  kind: ApprovalKind | null;
  state: ApprovalState | null;
  createdAt: Date;
  personName: string;
  personTitle: string | null;
  personRole: string | null;
  personDept: string | null;
  personLabel: string;
  step: number;
  chainLength: number;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-bold text-black/40">#{ticketNumber}</span>
        {state && <StateChip state={state} />}
        {kind && (
          <span className="inline-flex items-center rounded-full bg-black/[0.04] px-2.5 py-1 text-[11px] font-semibold text-black/60">
            {APPROVAL_KIND_LABELS[kind]}
          </span>
        )}
        {/* المسار المتسلسل يُقال صريحاً: الاعتماد الأول ليس نهائياً إن
            كان بعده معتمِد، فيُعرَض موضعُ الطلب من السلسلة */}
        {chainLength > 0 && (
          <span className="text-[11px] font-semibold text-black/45">
            موافقة {step} من {chainLength + 1}
          </span>
        )}
      </div>

      <p className="text-sm font-semibold">{subject}</p>
      {description && (
        <p className="text-xs leading-relaxed whitespace-pre-wrap text-black/60">{description}</p>
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-black/50">
        <span>
          <span className="text-black/35">{personLabel}:</span> {personName}
          {personTitle ? ` — ${personTitle}` : personRole ? ` — ${personRole}` : ""}
          {personDept ? ` · ${personDept}` : ""}
        </span>
        <span className="text-black/35">رُفع في {formatDate(createdAt)}</span>
      </div>
    </div>
  );
}

/** سجلّ القرارات — صفٌّ لكل قرار، لا يُستبدَل ولا يُحرَّر */
function Trail({
  decisions,
}: {
  decisions: {
    id: string;
    deciderName: string;
    decision: ApprovalState;
    note: string | null;
    step: number;
    decidedAt: Date;
  }[];
}) {
  if (decisions.length === 0) return null;
  return (
    <ol className="mt-3 flex flex-col gap-2 border-t border-black/5 pt-3">
      {decisions.map((d) => (
        <li key={d.id} className="text-xs leading-relaxed text-black/60">
          <span className="font-semibold text-black/70">{APPROVAL_STATE_LABELS[d.decision]}</span>
          {" — "}
          {d.deciderName}
          <span className="text-black/35"> · {formatDate(d.decidedAt)}</span>
          {d.note && <span className="block text-black/50">{d.note}</span>}
        </li>
      ))}
    </ol>
  );
}
