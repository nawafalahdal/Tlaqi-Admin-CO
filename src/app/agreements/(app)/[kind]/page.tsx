import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { PageHeader } from "@/components/PageHeader";
import { Card } from "@/components/ui";
import { themeFromColor, SUPER_ADMIN_THEME } from "@/lib/brand";
import { agreementContext, activeTemplate, statusOf, AGREEMENT_STATUS_LABEL } from "@/lib/governance/agreements";
import { AGREEMENT_KIND_LABEL } from "@/lib/governance/agreementTexts";
import { SignForm } from "./SignForm";

export const dynamic = "force-dynamic";

/** **قراءةُ الاتفاقية وتوقيعُها** — النصُّ كاملاً أولاً، ثم الاسمُ المكتوب ورمزُ البريد والموافقةُ الصريحة. ولا تُجمع
 *  الهويةُ الوطنية ولا صورتها. والتحقّقُ كلُّه في الخادم (`signAgreement`). */
export default async function SignAgreementPage({ params, searchParams }: { params: Promise<{ kind: string }>; searchParams: Promise<{ next?: string }> }) {
  const { kind } = await params;
  if (kind !== "marketing" && kind !== "technical") notFound();
  const session = await auth();
  if (!session) redirect(`/login?callbackUrl=${encodeURIComponent(`/agreements/${kind}`)}`);
  const ctx = await agreementContext(session);
  if (!ctx.account) redirect("/login");
  const sp = await searchParams;
  const t = await activeTemplate(kind);
  const st = await statusOf({ kind: ctx.account.kind, id: ctx.account.id }, kind);
  const issuer = ["super_admin", "executive"].includes(ctx.account.role);
  const theme = themeFromColor(SUPER_ADMIN_THEME.colorHex);
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        back={<Link href="/agreements" className="mb-2 inline-flex text-xs font-bold text-black/55 hover:underline">← اتفاقياتي</Link>}
        title={t?.titleAr ?? AGREEMENT_KIND_LABEL[kind]}
        description={t ? `الإصدار ${t.version} · الجهة المُصدِرة: ${t.issuer} · حالتك: ${AGREEMENT_STATUS_LABEL[st.status]}` : "لا إصدارَ سارياً لهذه الاتفاقية بعد"}
      />
      {sp.next && (
        <p role="status" className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
          الوصولُ الذي طلبتَه يتطلّب توقيع الإصدار السارى من هذه الاتفاقية أولاً.
        </p>
      )}
      {!t ? (
        <Card className="p-5 text-sm">لم تُنشر هذه الاتفاقية بعد.</Card>
      ) : (
        <>
          <Card className="p-0">
            <div
              id="agreement-text"
              tabIndex={0}
              aria-label="نص الاتفاقية"
              className="max-h-[60vh] overflow-y-auto whitespace-pre-line p-5 text-[15px] leading-loose"
            >
              {t.body}
            </div>
            <p dir="ltr" className="border-t border-hairline px-5 py-2 text-[11px] text-black/50 break-all">Document SHA-256: {t.bodyHash}</p>
          </Card>
          {issuer ? (
            <Card className="p-5 text-sm">أنت تمثّل المنصة (الجهة المُصدِرة) — لا توقّع بصفة مستلم.</Card>
          ) : st.status === "signed" ? (
            <Card className="p-5 text-sm">
              وقّعتَ هذا الإصدار. <Link href={`/agreements/signed/${st.signatureId}`} className="font-semibold underline">عرض نسختك الموقّعة</Link>
            </Card>
          ) : (
            <SignForm
              kind={kind}
              templateId={t.id}
              documentHash={t.bodyHash}
              accountName={ctx.account.name}
              roleLabel={ctx.account.roleLabel}
              email={ctx.account.email}
              next={sp.next ?? ""}
              theme={theme}
            />
          )}
        </>
      )}
    </div>
  );
}
