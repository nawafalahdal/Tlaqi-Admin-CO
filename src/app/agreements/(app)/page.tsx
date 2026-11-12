import Link from "next/link";
import { redirect } from "next/navigation";
import type { AgreementKind } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/PageHeader";
import { Card } from "@/components/ui";
import { agreementContext, statusOf, AGREEMENT_STATUS_LABEL, activeTemplate } from "@/lib/governance/agreements";
import { AGREEMENT_KIND_LABEL } from "@/lib/governance/agreementTexts";
import { Chip, fmtWhen } from "@/app/committees/_components/bits";

export const dynamic = "force-dynamic";

const TONE = { signed: "ok", pending: "warn", needs_update: "warn", not_sent: "neutral", ended: "neutral", cancelled: "neutral" } as const;

/** **اتفاقياتي** — حالتي مع كل اتفاقية، وقراءتُها وتوقيعُها، ونسخي الموقّعة (والقديمةُ باقية) */
export default async function MyAgreementsPage() {
  const session = await auth();
  if (!session) redirect("/login?callbackUrl=%2Fagreements");
  const ctx = await agreementContext(session);
  if (!ctx.account) redirect("/login");
  const me = { kind: ctx.account.kind, id: ctx.account.id };
  const kinds: AgreementKind[] = ["marketing", "technical"];
  const [rows, signatures] = await Promise.all([
    Promise.all(kinds.map(async (k) => ({ kind: k, st: await statusOf(me, k), active: await activeTemplate(k) }))),
    prisma.agreementSignature.findMany({ where: { signerKind: me.kind, signerId: me.id }, orderBy: { signedAt: "desc" } }),
  ]);
  const issuer = ["super_admin", "executive"].includes(ctx.account.role);
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="اتفاقياتي"
        description="اتفاقيتا السرية وحماية الأصول: اقرأ النص كاملاً ثم وقّع إلكترونياً. ولا يُفتح الوصولُ الحساس قبل التوقيع على الإصدار السارى."
        actions={ctx.canView ? <Link href="/agreements/manage" className="btn-brand inline-flex min-h-11 items-center rounded-xl px-4 text-sm font-semibold">إدارة الاتفاقيات</Link> : undefined}
      />
      {issuer && (
        <Card className="p-4 text-sm leading-relaxed">أنت تمثّل المنصة (الجهة المُصدِرة) — لا توقّع بصفة مستلم. وتُدار الاتفاقياتُ من «إدارة الاتفاقيات».</Card>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {rows.map(({ kind, st, active }) => (
          <Card key={kind} className="flex flex-col gap-2 p-5">
            <div className="flex items-center justify-between gap-2">
              <p className="font-bold">{AGREEMENT_KIND_LABEL[kind]}</p>
              <Chip tone={TONE[st.status]}>{AGREEMENT_STATUS_LABEL[st.status]}</Chip>
            </div>
            <p className="text-xs text-black/55">
              {active ? `الإصدار السارى: ${active.version}` : "لا إصدارَ سارياً بعد"}
              {st.signedVersion ? ` · وقّعتَ الإصدار ${st.signedVersion}` : ""}
            </p>
            {active && !issuer && st.status !== "signed" && (
              <Link href={`/agreements/${kind}`} className="btn-brand inline-flex min-h-11 items-center justify-center rounded-xl px-4 text-sm font-semibold">
                {st.status === "needs_update" ? "قراءة الإصدار الجديد وتوقيعه" : "قراءة الاتفاقية وتوقيعها"}
              </Link>
            )}
            {st.status === "signed" && st.signatureId && (
              <Link href={`/agreements/signed/${st.signatureId}`} className="text-sm font-semibold underline">عرض نسختي الموقّعة وتنزيلها</Link>
            )}
          </Card>
        ))}
      </div>
      {signatures.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-bold text-black/70">كل توقيعاتي ({signatures.length})</h2>
          <ul className="flex flex-col gap-2 text-sm">
            {signatures.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-hairline bg-white p-3">
                <span className="font-semibold">{AGREEMENT_KIND_LABEL[s.kind]} — الإصدار {s.version}</span>
                <span className="text-xs text-black/55">{fmtWhen(s.signedAt)}</span>
                <Link href={`/agreements/signed/${s.id}`} className="ms-auto text-xs font-semibold underline">النسخة الموقّعة</Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
