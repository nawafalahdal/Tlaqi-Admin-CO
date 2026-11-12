import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { requireOnboardingSurveyDone } from "@/lib/onboardingGate";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/PageHeader";
import { Card } from "@/components/ui";
import { themeFromColor, SUPER_ADMIN_THEME } from "@/lib/brand";
import { BASIS_LABEL } from "@/lib/governance/leadership";
import { seniorContext, seniorBoard, SENIOR_CAPABILITIES, INVITE_STATE_LABEL, POSITION_STATUS_LABEL } from "@/lib/governance/senior";
import { ActionForm } from "../../committees/_components/ActionForm";
import { Chip, Field, inputCls, fmtDay } from "../../committees/_components/bits";
import { PositionFields } from "../_components/PositionFields";
import {
  createInviteAction,
  sendInviteAction,
  cancelInviteAction,
  updatePositionAction,
  setPositionStatusAction,
} from "../actions";

export const dynamic = "force-dynamic";

const SEAT_LABEL: Record<string, string> = {
  super_admin: "المؤسس",
  executive: "الرئيس التنفيذي",
  operations_officer: "مسؤول التشغيل",
};
const CAP_LABEL = Object.fromEntries(SENIOR_CAPABILITIES.map((c) => [c.key, c.label]));
const STATE_TONE: Record<string, "neutral" | "info" | "warn" | "ok" | "danger"> = {
  draft: "neutral",
  sent: "info",
  opened: "warn",
  accepted: "ok",
  expired: "danger",
  cancelled: "neutral",
};

/** **الإدارة العليا** — القائدُ الحالي وأساسُ قيادته، والمقاعدُ القيادية، والمناصبُ بأصحابها ومسؤولياتهم.
 *
 *  تفتح لمن له «لوحة الإدارة العليا» (`seniorContext`): المؤسس، والرئيس التنفيذي، ومسؤول التشغيل، وأصحابِ
 *  التكليفات النشطة. والدعواتُ وإدارةُ التكليفات تظهر للقائد وحده — والخادمُ يفحص ذلك ثانيةً في كل إجراء. */
export default async function SeniorPage() {
  const session = await auth();
  if (!session) redirect("/login?callbackUrl=%2Fsenior");
  await requireOnboardingSurveyDone(session);
  const ctx = await seniorContext(session);
  if (!ctx.capabilities.has("board_view")) redirect(session.user.role === "member" ? "/member" : "/admin");

  const board = await seniorBoard(ctx.isLeader);
  if (!board) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title="الإدارة العليا" />
        <Card className="p-5 text-sm text-black/60">لا قسمَ للإدارة العليا في المنصة بعد.</Card>
      </div>
    );
  }
  const dept = await prisma.department.findUnique({ where: { id: board.leadership.departmentId }, select: { colorHex: true } });
  const theme = themeFromColor(dept?.colorHex ?? SUPER_ADMIN_THEME.colorHex);
  const { leadership } = board;
  const live = board.positions.filter((p) => p.status === "active" || p.status === "suspended");
  const invitations = board.positions.filter((p) => p.status === "pending");
  const history = board.positions.filter((p) => p.status === "ended");

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="الإدارة العليا"
        description="القيادةُ الحالية، والمناصبُ الإدارية بأصحابها ومسؤولياتهم وصلاحياتهم — وكلُّ تغييرٍ فيها مسجَّلٌ في سجل الحوكمة."
      />

      {/* ── القائدُ الحالي — قائدٌ فعليٌّ واحد */}
      <Card className="flex flex-col gap-2 p-5" style={{ borderInlineStart: `4px solid ${theme.fill}` }}>
        <p className="text-xs font-semibold text-black/50">قائد الإدارة العليا الآن</p>
        {leadership.leader ? (
          <>
            <p className="text-lg font-bold" data-testid="senior-leader">{leadership.leader.fullName}</p>
            <p className="text-sm text-black/60">{leadership.basis ? BASIS_LABEL[leadership.basis] : ""}</p>
            <p className="text-xs text-black/45">منذ {fmtDay(leadership.since)}</p>
            {leadership.basis === "founder_fallback" && (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
                لا رئيسَ تنفيذياً نشطاً — فالمؤسسُ يقود الإدارةَ العليا مؤقتاً بكامل صلاحياتها. وتعود القيادةُ إلى الرئيس
                التنفيذي تلقائياً حين يُعيَّن أو يعود حسابُه، ويُسجَّل الانتقال.
              </p>
            )}
          </>
        ) : (
          <p className="text-sm text-red-700">لا قائدَ نشطاً الآن — لا رئيسَ تنفيذياً ولا مؤسساً نشطاً.</p>
        )}
      </Card>

      {ctx.position && (
        <Card className="flex flex-col gap-2 p-5">
          <p className="text-xs font-semibold text-black/50">تكليفي</p>
          <p className="text-base font-bold">
            {ctx.position.titleAr}
            {ctx.position.titleEn && <span className="ms-2 text-sm font-normal text-black/50" dir="ltr">{ctx.position.titleEn}</span>}
          </p>
          {ctx.position.responsibilities && <p className="whitespace-pre-line text-sm leading-relaxed text-black/70">{ctx.position.responsibilities}</p>}
          <div className="flex flex-wrap gap-1.5">
            {ctx.position.capabilities.map((c) => <Chip key={c} tone="info">{CAP_LABEL[c] ?? c}</Chip>)}
          </div>
        </Card>
      )}

      {/* ── المقاعدُ القيادية بأدوارها */}
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-bold text-black/70">المقاعد القيادية</h2>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {board.seats.map((u) => (
            <Card key={u.id} className="p-4">
              <p className="text-xs text-black/50">{SEAT_LABEL[u.role] ?? u.role}</p>
              <p className="font-semibold">{u.fullName}</p>
              {leadership.leader?.id === u.id && <Chip tone="ok">القائد الحالي</Chip>}
            </Card>
          ))}
        </div>
      </section>

      {/* ── المناصب الإدارية */}
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-bold text-black/70">المناصب الإدارية ({live.length})</h2>
        {!live.length && <Card className="p-4 text-sm text-black/55">لا مناصبَ نشطةً بعد.</Card>}
        {live.map((p) => (
          <Card key={p.id} className="flex flex-col gap-2 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-bold">{p.titleAr}</p>
              {p.titleEn && <span className="text-xs text-black/50" dir="ltr">{p.titleEn}</span>}
              <Chip tone={p.status === "active" ? "ok" : "warn"}>{POSITION_STATUS_LABEL[p.status]}</Chip>
            </div>
            <p className="text-sm">{p.holderName ?? p.inviteName} <span className="text-xs text-black/45">· منذ {fmtDay(p.startDate ?? p.acceptedAt)}</span></p>
            {p.description && <p className="text-sm text-black/65">{p.description}</p>}
            {p.responsibilities && <p className="whitespace-pre-line text-sm leading-relaxed text-black/65">{p.responsibilities}</p>}
            <div className="flex flex-wrap gap-1.5">
              {p.capabilities.map((c) => <Chip key={c} tone="info">{CAP_LABEL[c] ?? c}</Chip>)}
            </div>
            {ctx.isLeader && (
              <details className="rounded-xl border border-hairline p-3">
                <summary className="cursor-pointer text-sm font-semibold">تعديل التكليف أو حالته</summary>
                <div className="mt-3 flex flex-col gap-4">
                  <ActionForm action={updatePositionAction} theme={theme} submits={[{ label: "حفظ التعديل" }]} pendingLabel="يُحفظ…">
                    <input type="hidden" name="positionId" value={p.id} />
                    <PositionFields defaults={p} />
                  </ActionForm>
                  <ActionForm
                    action={setPositionStatusAction}
                    theme={theme}
                    pendingLabel="يُنفَّذ…"
                    submits={[
                      p.status === "active" ? { label: "إيقاف التكليف", name: "to", value: "suspended", variant: "outline" } : { label: "إعادة التفعيل", name: "to", value: "active", variant: "outline" },
                      { label: "إنهاء التكليف", name: "to", value: "ended", variant: "outline" },
                    ]}
                    confirm={{ title: "تغيير حالة التكليف", body: "يُسجَّل التغيير بسببه. والإنهاءُ نهائي: يبقى التكليفُ سجلاً تاريخياً ولا يُعاد.", confirmLabel: "تأكيد" }}
                  >
                    <input type="hidden" name="positionId" value={p.id} />
                    <Field label="السبب" required>
                      <input name="reason" required minLength={3} maxLength={400} className={inputCls} />
                    </Field>
                  </ActionForm>
                </div>
              </details>
            )}
          </Card>
        ))}
      </section>

      {ctx.isLeader && (
        <>
          {/* ── الدعوات */}
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-bold text-black/70">الدعوات القائمة ({invitations.length})</h2>
            {!invitations.length && <Card className="p-4 text-sm text-black/55">لا دعواتٍ قائمة.</Card>}
            {invitations.map((p) => (
              <Card key={p.id} className="flex flex-col gap-2 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-bold">{p.titleAr}</p>
                  <Chip tone={STATE_TONE[p.inviteState] ?? "neutral"}>{INVITE_STATE_LABEL[p.inviteState]}</Chip>
                </div>
                <p className="text-sm">
                  {p.inviteName} <span className="text-xs text-black/45" dir="ltr">{p.inviteEmail}</span>
                </p>
                <p className="text-xs text-black/45">
                  دعاه {p.invitedByName}
                  {p.sentAt && ` · أُرسلت ${fmtDay(p.sentAt)}`}
                  {p.inviteExpiresAt && p.inviteState !== "draft" && ` · تنتهي ${fmtDay(p.inviteExpiresAt)}`}
                </p>
                <div className="flex flex-wrap items-start gap-3">
                  <ActionForm
                    action={sendInviteAction}
                    theme={theme}
                    compact
                    pendingLabel="يُرسَل…"
                    submits={[{ label: p.inviteState === "draft" ? "إرسال الدعوة" : "إعادة الإرسال (رابطٌ جديد)" }]}
                  >
                    <input type="hidden" name="positionId" value={p.id} />
                  </ActionForm>
                  <details className="min-w-60 flex-1">
                    <summary className="cursor-pointer text-xs font-semibold text-red-700">إلغاء الدعوة</summary>
                    <ActionForm
                      action={cancelInviteAction}
                      theme={theme}
                      className="mt-2 flex flex-col gap-2"
                      pendingLabel="يُلغى…"
                      submits={[{ label: "إلغاء الدعوة", variant: "outline" }]}
                      confirm={{ title: "إلغاء الدعوة", body: "يُبطَل الرابط، وتبقى الدعوةُ في السجل بسبب إلغائها.", confirmLabel: "إلغاء الدعوة" }}
                    >
                      <input type="hidden" name="positionId" value={p.id} />
                      <input name="reason" required minLength={3} maxLength={400} placeholder="سبب الإلغاء" aria-label="سبب الإلغاء" className={inputCls} />
                    </ActionForm>
                  </details>
                </div>
              </Card>
            ))}
          </section>

          {/* ── دعوةٌ جديدة */}
          <Card className="flex flex-col gap-3 p-5">
            <h2 className="text-base font-bold">دعوة عضوٍ إلى الإدارة العليا</h2>
            <p className="text-xs leading-relaxed text-black/50">
              يصل المدعوَّ رابطٌ لمرّةٍ واحدة صالحٌ سبعة أيام. إن كان له حسابٌ في المنصة قبل بعد الدخول به، وإلا أنشأ
              حسابَه بكلمة مرور. ولا تُمنح بالدعوة صلاحيةٌ قيادية.
            </p>
            <ActionForm
              action={createInviteAction}
              theme={theme}
              pendingLabel="يُحفظ…"
              submits={[
                { label: "إنشاء وإرسال", name: "intent", value: "send" },
                { label: "حفظ مسودّة", name: "intent", value: "draft" },
              ]}
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="اسم المدعوّ" required>
                  <input name="inviteName" required minLength={3} maxLength={120} className={inputCls} />
                </Field>
                <Field label="البريد الإلكتروني" required>
                  <input name="inviteEmail" type="email" required dir="ltr" maxLength={200} className={inputCls} />
                </Field>
              </div>
              <PositionFields />
            </ActionForm>
          </Card>
        </>
      )}

      {/* ── السجلّ التاريخي: المنتهي لا يُحذف */}
      {ctx.isLeader && history.length > 0 && (
        <details className="rounded-2xl border border-hairline bg-white p-4">
          <summary className="cursor-pointer text-sm font-bold text-black/70">التكليفات والدعوات المنتهية ({history.length})</summary>
          <ul className="mt-3 flex flex-col gap-2 text-sm">
            {history.map((p) => (
              <li key={p.id} className="rounded-xl border border-hairline p-3">
                <span className="font-semibold">{p.titleAr}</span> — {p.holderName ?? p.inviteName}
                <span className="ms-2 text-xs text-black/45">
                  {INVITE_STATE_LABEL[p.inviteState] === "ملغاة" ? `أُلغيت: ${p.cancelReason ?? "—"}` : `انتهى ${fmtDay(p.endedAt)}: ${p.endReason ?? "—"}`}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
