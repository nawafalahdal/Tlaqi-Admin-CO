import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/PageHeader";
import { Card } from "@/components/ui";
import { themeFromColor, SUPER_ADMIN_THEME } from "@/lib/brand";
import { brandContext, ensureBrandVersion, STATUS_LABEL, ACTION_LABEL, type BrandAction } from "@/lib/brandReview";
import { itemDef, emailPreview, contentHashOf, KIND_LABEL } from "@/lib/brandReview/registry";
import { OPEN_DECISIONS } from "@/lib/brandReview/decisions";
import { COLORS, TYPEFACE, BRAND_VERSION } from "@/lib/brand2026/tokens";
import { ActionForm } from "@/app/committees/_components/ActionForm";
import { fmtWhen, inputCls, textareaCls } from "@/app/committees/_components/bits";
import { brandTransitionAction, brandCommentAction } from "../../actions";
import { ItemPreview, FontFaces, ASSET } from "../../_previews/Previews";
import { STATUS_CLS } from "../../_previews/status";

export const dynamic = "force-dynamic";

/** **عنصرُ هويةٍ للمراجعة** — المعاينة (وللبريد: القالبُ الحالي والجديد، على الحاسب والجوال)، ومكانُ الاستعمال،
 *  والألوانُ والخطوط، والقراراتُ المفتوحة، والإجراءاتُ بحسب الدور والحالة، والملاحظات، والسجلُّ الكامل. */
export default async function BrandItemPage({ params }: { params: Promise<{ key: string }> }) {
  const session = await auth();
  const { key } = await params;
  if (!session) redirect(`/login?callbackUrl=${encodeURIComponent(`/brand-review/${key}`)}`);
  const ctx = await brandContext(session);
  if (!ctx.canView) redirect(session.user.role === "member" ? "/member" : "/admin");
  const def = itemDef(key);
  if (!def) notFound();
  const v = await ensureBrandVersion(ctx);
  if (!v) notFound();
  const item = await prisma.brandItem.findUnique({ where: { versionId_key: { versionId: v.id, key } } });
  if (!item) notFound();
  const [events, email, currentHash] = await Promise.all([
    prisma.brandReviewEvent.findMany({ where: { itemId: item.id }, orderBy: { createdAt: "desc" } }),
    def.email ? emailPreview(def, ASSET, `${ASSET}/fonts`) : Promise.resolve(null),
    contentHashOf(def),
  ]);
  const theme = themeFromColor(SUPER_ADMIN_THEME.colorHex);
  const changedAfterApproval = !!item.approvedHash && item.approvedHash !== currentHash;

  const can = (a: BrandAction) => {
    const prepare = ["submit", "revise"].includes(a);
    if (prepare ? !ctx.canPrepare : !ctx.canApprove) return false;
    const from: Record<BrandAction, string[]> = {
      submit: ["draft"],
      start_review: ["ready_for_review"],
      request_changes: ["ready_for_review", "pending_approval", "approved"],
      approve: ["ready_for_review", "pending_approval"],
      revise: ["changes_requested"],
      publish: ["approved"],
    };
    return from[a].includes(item.status);
  };
  const simple = (["submit", "start_review", "approve", "publish"] as BrandAction[]).filter(can);
  const withNote = (["request_changes", "revise"] as BrandAction[]).filter(can);
  const decisions = OPEN_DECISIONS.filter((d) => def.decisions?.some((x) => x.startsWith(d.id)));

  return (
    <div className="flex flex-col gap-5">
      <FontFaces />
      <PageHeader
        back={<Link href="/brand-review" className="mb-2 inline-flex text-xs font-bold text-black/55 hover:underline">← مركز مراجعة الهوية</Link>}
        title={
          <span className="flex flex-wrap items-center gap-2">
            {item.titleAr}
            <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${STATUS_CLS[item.status]}`}>{STATUS_LABEL[item.status]}</span>
          </span>
        }
        description={`${KIND_LABEL[def.kind]} · ${BRAND_VERSION.label} · المراجعة ${item.revision}`}
      />

      <div className="grid gap-3 md:grid-cols-3">
        <Card className="p-4 text-sm">
          <p className="text-xs font-semibold text-black/55">مكان الاستعمال في المنصة</p>
          <p className="mt-1 leading-relaxed">{def.usage}</p>
        </Card>
        <Card className="p-4 text-sm">
          <p className="text-xs font-semibold text-black/55">الألوان المستعملة</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {def.colors.map((c) => (
              <span key={c} className="inline-flex items-center gap-1.5 text-xs">
                <span className="inline-block h-4 w-4 rounded border border-black/40" style={{ background: COLORS[c].hex }} />
                {COLORS[c].name} <span dir="ltr">{COLORS[c].hex}</span>
              </span>
            ))}
          </div>
        </Card>
        <Card className="p-4 text-sm">
          <p className="text-xs font-semibold text-black/55">الخطوط</p>
          <p className="mt-1">{def.fonts.length ? def.fonts.join("، ") : "—"}{def.fonts.includes(TYPEFACE.family) && " (احتياطاً: Tahoma / Arial)"}</p>
          <p className="mt-2 text-xs text-black/55">
            أُعِدّ: {item.createdByName}
            {item.submittedByName && ` · أرسله للمراجعة: ${item.submittedByName} (${fmtWhen(item.submittedAt)})`}
            {item.approvedByName && ` · اعتمده: ${item.approvedByName} (${fmtWhen(item.approvedAt)}، المراجعة ${item.approvedRevision})`}
            {item.publishedByName && ` · نشره: ${item.publishedByName} (${fmtWhen(item.publishedAt)})`}
          </p>
        </Card>
      </div>

      {changedAfterApproval && (
        <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">
          تغيّر هذا العنصرُ بعد اعتماده — لا يُنشر حتى تُطلب مراجعتُه ويُعتمد من جديد.
        </p>
      )}
      {!def.implemented && (
        <p className="rounded-xl bg-black/[0.04] px-4 py-3 text-xs leading-relaxed text-black/65">
          معاينةٌ فقط: لم يُطبَّق هذا العنصر في المنصة الحية. بعد اعتماده يُطبَّق ويُختبر، ثم يُتاح نشرُه.
        </p>
      )}

      {decisions.length > 0 && (
        <Card className="p-4 text-sm">
          <p className="text-xs font-semibold text-black/55">قراراتٌ مفتوحة تمسّ هذا العنصر</p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {decisions.map((d) => (
              <li key={d.id}><b>{d.id} — {d.title}:</b> <span className="text-black/65">{d.proposal}</span></li>
            ))}
          </ul>
        </Card>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-bold text-black/70">المعاينة</h2>
        {email ? (
          <div className="flex flex-col gap-3">
            <p className="text-xs text-black/60">
              الرسالة بدالتها الحقيقية ومتغيّراتٍ تجريبية (لا بيانات أعضاء): العنوان «{email.subject}». الروابطُ والمتغيّرات كما هي — تغيّر التصميمُ وحده.
            </p>
            <div className="grid gap-4 xl:grid-cols-2">
              <figure className="m-0">
                <figcaption className="mb-1 text-xs font-bold">المقترح — هوية 2026 (حاسوب)</figcaption>
                <iframe title="البريد بالهوية الجديدة" srcDoc={email.next} sandbox="allow-same-origin" className="h-[760px] w-full rounded-xl border border-black/20 bg-white" />
              </figure>
              <figure className="m-0">
                <figcaption className="mb-1 text-xs font-bold">الحالي (للمقارنة)</figcaption>
                <iframe title="البريد الحالي" srcDoc={email.current} sandbox="allow-same-origin" className="h-[760px] w-full rounded-xl border border-black/20 bg-white" />
              </figure>
            </div>
            <figure className="m-0">
              <figcaption className="mb-1 text-xs font-bold">المقترح على الجوال (375 بكسل)</figcaption>
              <iframe title="البريد بالهوية الجديدة على الجوال" srcDoc={email.next} sandbox="allow-same-origin" className="h-[760px] w-[375px] max-w-full rounded-xl border border-black/20 bg-white" />
            </figure>
          </div>
        ) : (
          <ItemPreview itemKey={item.key} />
        )}
      </section>

      {(simple.length > 0 || withNote.length > 0) && (
        <Card className="flex flex-col gap-4 p-5">
          <h2 className="text-sm font-bold">القرار</h2>
          {simple.length > 0 && (
            <div className="flex flex-wrap gap-3">
              {simple.map((a) => (
                <ActionForm
                  key={a}
                  action={brandTransitionAction}
                  theme={theme}
                  pendingLabel="يُنفَّذ…"
                  submits={[{ label: ACTION_LABEL[a], variant: a === "approve" ? "solid" : "outline" }]}
                  confirm={
                    a === "approve"
                      ? { title: "اعتماد العنصر", body: `تعتمد المراجعة ${item.revision} كما تراها الآن. ويُسجَّل اعتمادُك ببصمتها؛ وأيُّ تغييرٍ بعده يُعيدها للمراجعة.`, confirmLabel: "اعتماد" }
                      : a === "publish"
                        ? { title: "نشر العنصر", body: "يُنشر العنصرُ المعتمَد في المنصة.", confirmLabel: "نشر" }
                        : undefined
                  }
                >
                  <input type="hidden" name="itemId" value={item.id} />
                  <input type="hidden" name="key" value={item.key} />
                  <input type="hidden" name="action" value={a} />
                </ActionForm>
              ))}
            </div>
          )}
          {withNote.map((a) => (
            <ActionForm key={a} action={brandTransitionAction} theme={theme} pendingLabel="يُنفَّذ…" submits={[{ label: ACTION_LABEL[a], variant: "outline" }]}>
              <input type="hidden" name="itemId" value={item.id} />
              <input type="hidden" name="key" value={item.key} />
              <input type="hidden" name="action" value={a} />
              <textarea name="note" required minLength={3} maxLength={2000} placeholder={a === "revise" ? "ما الذي عُدِّل؟" : "التعديلات المطلوبة"} aria-label="الملاحظات" className={textareaCls} />
            </ActionForm>
          ))}
        </Card>
      )}

      <Card className="flex flex-col gap-3 p-5">
        <h2 className="text-sm font-bold">الملاحظات والسجل</h2>
        <ActionForm action={brandCommentAction} theme={theme} pendingLabel="تُضاف…" submits={[{ label: "إضافة ملاحظة", variant: "outline" }]}>
          <input type="hidden" name="itemId" value={item.id} />
          <input type="hidden" name="key" value={item.key} />
          <input name="note" required minLength={2} maxLength={2000} placeholder="ملاحظتك على هذا العنصر" aria-label="ملاحظة" className={inputCls} />
        </ActionForm>
        <ol className="flex flex-col gap-2 text-sm">
          {events.map((e) => (
            <li key={e.id} className="rounded-xl border border-hairline p-3">
              <p className="text-xs text-black/55">
                {fmtWhen(e.createdAt)} · {e.actorName}
                {e.actorRole && ` (${e.actorRole})`} · المراجعة {e.revision ?? "—"}
              </p>
              <p className="font-semibold">
                {ACTION_LABEL[e.action as BrandAction] ?? (e.action === "item.create" ? "إعداد العنصر" : e.action === "comment" ? "ملاحظة" : e.action)}
                {e.fromStatus && e.toStatus && e.fromStatus !== e.toStatus && (
                  <span className="text-xs font-normal text-black/55"> — {STATUS_LABEL[e.fromStatus as keyof typeof STATUS_LABEL] ?? e.fromStatus} ← {STATUS_LABEL[e.toStatus as keyof typeof STATUS_LABEL] ?? e.toStatus}</span>
                )}
              </p>
              {e.note && <p className="mt-1 whitespace-pre-line text-black/75">{e.note}</p>}
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}
