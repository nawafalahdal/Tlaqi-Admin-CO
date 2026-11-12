import Link from "next/link";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/PageHeader";
import { Card } from "@/components/ui";
import { Pager, pageParam } from "@/components/Pager";
import { seniorContext } from "@/lib/governance/senior";
import { PERMISSION_MATRIX, MATRIX_ROLES, GRANT_LABEL, type Grant } from "@/lib/governance/permissions";
import { Chip, inputCls, fmtWhen } from "@/app/committees/_components/bits";
import { ActionForm } from "@/app/committees/_components/ActionForm";
import { themeFromColor, SUPER_ADMIN_THEME } from "@/lib/brand";
import { syncGovernanceNowAction } from "../../actions";

export const dynamic = "force-dynamic";

const PAGE = 50;
const SCOPE_LABEL: Record<string, string> = {
  committee: "لجنة",
  department: "قسم / قيادة",
  member: "عضوية",
  senior: "الإدارة العليا",
  agreement: "اتفاقية",
  account: "حساب",
};
const ACTION_LABEL: Record<string, string> = {
  "senior.leadership": "انتقالُ قيادة الإدارة العليا",
  "senior.invite.create": "إنشاءُ دعوة",
  "senior.invite.send": "إرسالُ دعوة",
  "senior.invite.resend": "إعادةُ إرسال دعوة",
  "senior.invite.cancel": "إلغاءُ دعوة",
  "senior.invite.expired": "انتهاءُ دعوة",
  "senior.invite.accept": "قبولُ دعوة",
  "senior.position.update": "تعديلُ تكليف",
  "senior.position.permissions": "تعديلُ صلاحيات تكليف",
  "senior.position.status": "تغييرُ حالة تكليف",
  "committee.archive": "أرشفةُ لجنة",
  "committee.restore": "استرجاعُ لجنة",
  "committee.lead": "تعيينُ قائد لجنة",
  "committee.decided": "قرارُ اعتماد لجنة",
  "committee.status": "تغييرُ حالة لجنة",
};
const GRANT_CLS: Record<Grant, string> = {
  yes: "bg-emerald-100 text-emerald-900",
  scoped: "bg-sky-100 text-sky-900",
  cond: "bg-amber-100 text-amber-900",
  no: "bg-black/[0.05] text-black/45",
};

function pairs(v: Prisma.JsonValue | null): string {
  if (!v || typeof v !== "object" || Array.isArray(v)) return v == null ? "" : String(v);
  return Object.entries(v)
    .map(([k, x]) => `${k}: ${x === null ? "—" : typeof x === "object" ? JSON.stringify(x) : String(x)}`)
    .join(" · ")
    .slice(0, 600);
}

/** **سجلُّ الحوكمة** — كلُّ عمليةٍ إدارية حساسة: من، وبأي دور وقتَها، وماذا، وعلى ماذا، وقبل وبعد، ومتى، ولماذا،
 *  وبأي نتيجة (ومنها المحاولاتُ المرفوضة). قراءةٌ فقط: لا تعديلَ ولا حذفَ في الواجهة ولا في الخادم ولا في
 *  القاعدة (`APPEND_ONLY`). ومعه مصفوفةُ الصلاحيات كما تُنفَّذ. */
export default async function GovernanceLogPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; scope?: string; result?: string; q?: string; from?: string; to?: string; page?: string }>;
}) {
  const session = await auth();
  if (!session) redirect("/login?callbackUrl=%2Fsenior%2Flog");
  const ctx = await seniorContext(session);
  if (!ctx.capabilities.has("governance_log_view")) redirect(session.user.role === "member" ? "/member" : "/admin");
  const sp = await searchParams;
  const tab = sp.tab === "matrix" ? "matrix" : "log";

  const day = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  const from = day(sp.from);
  const to = day(sp.to);
  const q = sp.q?.trim().slice(0, 80) || null;
  const where: Prisma.OrgAuditEventWhereInput = {
    ...(sp.scope && SCOPE_LABEL[sp.scope] ? { scope: sp.scope } : {}),
    ...(sp.result === "denied" || sp.result === "success" ? { result: sp.result } : {}),
    ...(from || to ? { createdAt: { ...(from ? { gte: new Date(`${from}T00:00:00+03:00`) } : {}), ...(to ? { lte: new Date(`${to}T23:59:59+03:00`) } : {}) } } : {}),
    ...(q
      ? { OR: [{ actorName: { contains: q, mode: "insensitive" } }, { action: { contains: q, mode: "insensitive" } }, { note: { contains: q, mode: "insensitive" } }] }
      : {}),
  };
  const [total, lastSync] = await Promise.all([
    tab === "log" ? prisma.orgAuditEvent.count({ where }) : Promise.resolve(0),
    prisma.governanceSyncRun.findFirst({ orderBy: { startedAt: "desc" } }),
  ]);
  const canSync = !!ctx.account && ["super_admin", "executive"].includes(ctx.account.role);
  const { page, pages } = pageParam(sp.page, total, PAGE);
  const rows =
    tab === "log"
      ? await prisma.orgAuditEvent.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE, take: PAGE })
      : [];
  const entityIds = [...new Set(rows.map((r) => r.entityId))];
  const [depts, positions] = entityIds.length
    ? await Promise.all([
        // department-scope: all — أسماءُ أهداف أحداث السجل، وفيها المؤرشفُ والمغلق: السجلُّ يسمّي ما وقع عليه الحدث أياً كانت حاله
        prisma.department.findMany({ where: { id: { in: entityIds } }, select: { id: true, name: true, parentId: true } }),
        prisma.seniorPosition.findMany({ where: { id: { in: entityIds } }, select: { id: true, titleAr: true } }),
      ])
    : [[], []];
  const target = new Map<string, { label: string; href?: string }>([
    ...depts.map((d) => [d.id, { label: d.name, href: d.parentId ? `/committees/${d.id}?tab=log` : undefined }] as const),
    ...positions.map((p) => [p.id, { label: p.titleAr }] as const),
  ]);
  const href = (n: number) => {
    const p = new URLSearchParams();
    for (const k of ["scope", "result", "q", "from", "to"] as const) if (sp[k]) p.set(k, sp[k]!);
    if (n > 1) p.set("page", String(n));
    const s = p.toString();
    return s ? `/senior/log?${s}` : "/senior/log";
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="سجل الحوكمة"
        description="كلُّ عمليةٍ إدارية حساسة بفاعلها ودوره وقتَها، وقيمها قبل وبعد، وسببها ونتيجتها — للقراءة فقط، ولا يُعدَّل ولا يُحذف."
      />
      <Card className="flex flex-wrap items-center gap-3 p-4 text-sm">
        <div className="min-w-0 flex-1">
          <p className="font-semibold">السجل الحي وExcel</p>
          <p className="text-xs leading-relaxed text-black/55">
            تبويباتُ «الإدارة العليا» و«اللجان» و«سجل الحوكمة» لقطةٌ من قاعدة البيانات (مصدر الحقيقة) تُحدَّث بعد كل
            إجراءٍ حاكم وفي الكنس الدوري.{" "}
            {lastSync
              ? lastSync.ok
                ? `آخر مزامنة ناجحة: ${fmtWhen(lastSync.finishedAt ?? lastSync.startedAt)} (${lastSync.rows} صفّاً).`
                : `آخر محاولة ${fmtWhen(lastSync.startedAt)} لم تكتمل: ${lastSync.error ?? "جارية"} — البياناتُ سليمة في المنصة.`
              : "لم تُزامَن بعد."}
          </p>
        </div>
        <a href="/senior/log/export" className="btn-brand inline-flex min-h-11 items-center rounded-xl px-4 text-sm font-semibold">
          تنزيل Excel
        </a>
        {canSync && (
          <ActionForm action={syncGovernanceNowAction} theme={themeFromColor(SUPER_ADMIN_THEME.colorHex)} compact pendingLabel="يُزامَن…" submits={[{ label: "مزامنة الآن", variant: "outline" }]} />
        )}
      </Card>
      <nav className="flex gap-1" aria-label="أقسام السجل">
        {(["log", "matrix"] as const).map((t) => (
          <Link
            key={t}
            href={t === "log" ? "/senior/log" : "/senior/log?tab=matrix"}
            aria-current={t === tab ? "page" : undefined}
            className={`inline-flex min-h-10 items-center rounded-xl px-3 text-sm font-semibold ${t === tab ? "bg-black/[0.07]" : "text-black/60 hover:bg-black/[0.04]"}`}
          >
            {t === "log" ? "السجل" : "مصفوفة الصلاحيات"}
          </Link>
        ))}
      </nav>

      {tab === "log" ? (
        <>
          <form className="grid gap-2 sm:grid-cols-6" role="search">
            <input name="q" defaultValue={q ?? ""} placeholder="بحث: الفاعل أو الإجراء أو السبب" aria-label="بحث" className={`${inputCls} sm:col-span-2`} />
            <select name="scope" defaultValue={sp.scope ?? ""} aria-label="النطاق" className={inputCls}>
              <option value="">كل النطاقات</option>
              {Object.entries(SCOPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <select name="result" defaultValue={sp.result ?? ""} aria-label="النتيجة" className={inputCls}>
              <option value="">كل النتائج</option>
              <option value="success">نُفِّذت</option>
              <option value="denied">مرفوضة</option>
            </select>
            <input type="date" name="from" defaultValue={from ?? ""} aria-label="من تاريخ" className={inputCls} />
            <input type="date" name="to" defaultValue={to ?? ""} aria-label="إلى تاريخ" className={inputCls} />
            <button type="submit" className="btn-brand min-h-11 rounded-xl px-4 text-sm font-semibold sm:col-span-6 sm:justify-self-start">
              تصفية
            </button>
          </form>
          <p className="text-xs text-black/50">{total} حدثاً</p>
          {!rows.length && <Card className="p-5 text-sm text-black/55">لا أحداثَ مطابقة.</Card>}
          <ol className="flex flex-col gap-2">
            {rows.map((e) => {
              const t = target.get(e.entityId);
              return (
                <li key={e.id}>
                  <Card className="flex flex-col gap-1.5 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{ACTION_LABEL[e.action] ?? e.action}</span>
                      <Chip tone="neutral">{SCOPE_LABEL[e.scope] ?? e.scope}</Chip>
                      {e.result === "denied" && <Chip tone="danger">مرفوضة</Chip>}
                      <span className="ms-auto text-xs tabular-nums text-black/45">{fmtWhen(e.createdAt)}</span>
                    </div>
                    <p className="text-sm">
                      {e.actorName}
                      {e.actorRole && <span className="text-xs text-black/45"> · {e.actorRole}</span>}
                      {t && (
                        <>
                          {" ← "}
                          {t.href ? <Link href={t.href} className="underline">{t.label}</Link> : t.label}
                        </>
                      )}
                    </p>
                    {pairs(e.before) && <p className="break-words text-xs text-black/55">قبل: {pairs(e.before)}</p>}
                    {pairs(e.after) && <p className="break-words text-xs text-black/70">بعد: {pairs(e.after)}</p>}
                    {e.note && <p className="text-xs text-black/60">السبب: {e.note}</p>}
                  </Card>
                </li>
              );
            })}
          </ol>
          <Pager page={page} pages={pages} href={href} labels={{ pageOf: "صفحة {0} من {1}", prevPage: "السابقة", nextPage: "التالية" }} />
        </>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[56rem] border-collapse text-sm">
            <caption className="p-4 text-start text-xs leading-relaxed text-black/55">
              المصفوفةُ وصفٌ لما يُنفَّذ في الخادم والقاعدة؛ والعمودُ الأخير يسمّي موضعَ التنفيذ. «في نطاقه»: قسمُه أو
              لجنتُه أو نفسُه. «بشرط»: كما في الملاحظة.
            </caption>
            <thead>
              <tr className="border-y border-hairline bg-black/[0.03] text-xs">
                <th scope="col" className="p-2 text-start">المجال</th>
                <th scope="col" className="p-2 text-start">الإجراء</th>
                {MATRIX_ROLES.map((r) => <th key={r.key} scope="col" className="p-2 text-center">{r.label}</th>)}
                <th scope="col" className="p-2 text-start">موضعُ التنفيذ</th>
              </tr>
            </thead>
            <tbody>
              {PERMISSION_MATRIX.map((row, i) => (
                <tr key={i} className="border-b border-hairline align-top">
                  <td className="p-2 text-xs text-black/55">{row.area}</td>
                  <th scope="row" className="p-2 text-start font-semibold">
                    {row.action}
                    {row.note && <p className="mt-1 text-xs font-normal leading-relaxed text-black/55">{row.note}</p>}
                  </th>
                  {MATRIX_ROLES.map((r) => (
                    <td key={r.key} className="p-2 text-center">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-bold ${GRANT_CLS[row.grants[r.key]]}`}>{GRANT_LABEL[row.grants[r.key]]}</span>
                    </td>
                  ))}
                  <td className="p-2 text-[11px] text-black/50" dir="ltr">{row.enforcedBy}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
