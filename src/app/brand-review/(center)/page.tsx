import Link from "next/link";
import { redirect } from "next/navigation";
import type { BrandItemStatus } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/PageHeader";
import { Card } from "@/components/ui";
import { themeFromColor, SUPER_ADMIN_THEME } from "@/lib/brand";
import { brandContext, ensureBrandVersion, STATUS_LABEL } from "@/lib/brandReview";
import { BRAND_ITEMS, KIND_LABEL, type BrandItemKind } from "@/lib/brandReview/registry";
import { OPEN_DECISIONS } from "@/lib/brandReview/decisions";
import { ActionForm } from "@/app/committees/_components/ActionForm";
import { fmtWhen } from "@/app/committees/_components/bits";
import { brandActivateAction } from "../actions";
import { STATUS_CLS } from "../_previews/status";

export const dynamic = "force-dynamic";

/** **مركز مراجعة واعتماد الهوية** — عناصرُ إصدار الهوية بحالاتها، والقراراتُ المفتوحة، والتفعيلُ الرسمي.
 *  تُعرض الواجهةُ نفسُها بالهوية الحالية (لم تُعتمد الجديدة بعد) — والمعايناتُ داخل كل عنصر. */
export default async function BrandReviewPage() {
  const session = await auth();
  if (!session) redirect("/login?callbackUrl=%2Fbrand-review");
  const ctx = await brandContext(session);
  if (!ctx.canView) redirect(session.user.role === "member" ? "/member" : "/admin");
  const v = await ensureBrandVersion(ctx);
  if (!v) redirect("/admin");
  const [items, events, active] = await Promise.all([
    prisma.brandItem.findMany({ where: { versionId: v.id }, orderBy: { createdAt: "asc" } }),
    prisma.brandReviewEvent.findMany({ where: { versionId: v.id }, orderBy: { createdAt: "desc" }, take: 8 }),
    prisma.brandVersion.findFirst({ where: { status: "active" }, select: { name: true, activatedAt: true, activatedByName: true } }),
  ]);
  const theme = themeFromColor(SUPER_ADMIN_THEME.colorHex);
  const order = new Map(BRAND_ITEMS.map((d, i) => [d.key, i]));
  const byKind = (Object.keys(KIND_LABEL) as BrandItemKind[]).map((k) => ({
    kind: k,
    rows: items.filter((i) => i.kind === k).sort((a, b) => (order.get(a.key) ?? 0) - (order.get(b.key) ?? 0)),
  }));
  const count = (s: BrandItemStatus) => items.filter((i) => i.status === s).length;
  const allPublished = items.length > 0 && items.every((i) => i.status === "published");

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="مركز مراجعة واعتماد الهوية"
        description="Brand Identity Review & Approval — كلُّ عنصرٍ من الهوية الجديدة يُعرض هنا قبل تطبيقه: شكلُه، ومكانُ استعماله، وألوانُه وخطوطُه. ولا يُنشر شيءٌ قبل اعتماد المؤسس الصريح."
      />

      <Card className="flex flex-col gap-3 p-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-black/55">الإصدار قيد المراجعة</p>
            <p className="text-lg font-bold">{v.name}</p>
            <p className="text-xs text-black/55">
              أنشأه {v.createdByName} · {fmtWhen(v.createdAt)} · الحالة: {v.status === "draft" ? "قيد المراجعة (غير مفعَّل)" : v.status === "active" ? "الهوية الرسمية السارية" : "متقاعد"}
            </p>
            <p className="mt-1 text-xs text-black/55">
              الهوية السارية في المنصة الآن: {active ? `${active.name} — فعّلها ${active.activatedByName}` : "الهوية الحالية للمنصة (قبل هذا النظام)"}
            </p>
          </div>
          {ctx.canApprove && v.status === "draft" && (
            <ActionForm
              action={brandActivateAction}
              theme={theme}
              compact
              pendingLabel="يُفعَّل…"
              submits={[{ label: allPublished ? "التفعيل الرسمي للهوية" : "التفعيل الرسمي (بعد نشر كل العناصر)", variant: allPublished ? "solid" : "outline" }]}
              confirm={{ title: "التفعيل الرسمي للهوية", body: "يصير هذا الإصدار المرجعَ الرسمي، ويبقى السابقُ محفوظاً للرجوع.", confirmLabel: "تفعيل" }}
            >
              <input type="hidden" name="versionId" value={v.id} />
            </ActionForm>
          )}
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          {(Object.keys(STATUS_LABEL) as BrandItemStatus[]).map((s) => (
            <span key={s} className={`rounded-full px-2.5 py-1 font-bold ${STATUS_CLS[s]}`}>
              {STATUS_LABEL[s]}: {count(s)}
            </span>
          ))}
        </div>
        <p className="text-xs leading-relaxed text-black/55">
          {ctx.canApprove
            ? "أنت المعتمِد: تبدأ المراجعة، وتطلب التعديل بملاحظات، وتعتمد، ثم تنشر ما طُبّق واختُبر."
            : "أنت من المُعِدّين: ترسل العناصر للمراجعة وتعيد إعدادها بعد طلب التعديل — والاعتمادُ والنشرُ للمؤسس وحده."}
        </p>
      </Card>

      <details className="rounded-2xl border border-hairline bg-white p-4" open>
        <summary className="cursor-pointer text-sm font-bold">قراراتٌ لا يحسمها ملفُّ الهوية ({OPEN_DECISIONS.length}) — بانتظار رأي المؤسس</summary>
        <ul className="mt-3 flex flex-col gap-2 text-sm">
          {OPEN_DECISIONS.map((d) => (
            <li key={d.id} className="rounded-xl border border-hairline p-3">
              <b>{d.id} — {d.title}</b>
              <p className="mt-1 text-xs leading-relaxed text-black/65">المقترح: {d.proposal}</p>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-black/50">اكتب رأيك في ملاحظات العنصر المعنيّ (كلُّ عنصرٍ يذكر القرارات التي تمسّه).</p>
      </details>

      {byKind.map(({ kind, rows }) => (
        <section key={kind} className="flex flex-col gap-2">
          <h2 className="text-sm font-bold text-black/70">{KIND_LABEL[kind]} ({rows.length})</h2>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {rows.map((i) => (
              <Link key={i.id} href={`/brand-review/${i.key}`} className="block rounded-2xl border border-hairline bg-white p-4 shadow-sm hover:border-black/30">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-semibold leading-snug">{i.titleAr}</p>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${STATUS_CLS[i.status]}`}>{STATUS_LABEL[i.status]}</span>
                </div>
                <p className="mt-1 text-xs text-black/55">{i.usage}</p>
                <p className="mt-2 text-[11px] text-black/45">المراجعة {i.revision} · آخر تحديث {fmtWhen(i.updatedAt)}</p>
              </Link>
            ))}
          </div>
        </section>
      ))}

      {events.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-bold text-black/70">آخر ما جرى</h2>
          <ul className="flex flex-col gap-1 text-xs text-black/65">
            {events.map((e) => (
              <li key={e.id}>
                {fmtWhen(e.createdAt)} — {e.actorName}: {e.action}
                {e.note ? ` — ${e.note.slice(0, 120)}` : ""}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
