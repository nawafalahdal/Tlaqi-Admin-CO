import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { agreementContext, signedCopyAccess, signedCopyHtml } from "@/lib/governance/agreements";
import { PrintButton } from "./PrintButton";

export const dynamic = "force-dynamic";

/** **النسخةُ الموقّعة** — لصاحبها ولمن يطّلع على الاتفاقيات؛ تُعرض كما تُنزَّل (المولِّدُ نفسُه، وكلُّ حقلٍ مُهرَّب) */
export default async function SignedCopyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session) redirect(`/login?callbackUrl=${encodeURIComponent(`/agreements/signed/${id}`)}`);
  const ctx = await agreementContext(session);
  const v = await signedCopyAccess(ctx, id);
  if (!v) notFound();
  const html = signedCopyHtml(v, { logoUrl: "/brand/lockup-on-light.png" });
  const inner = html.slice(html.indexOf('<div class="doc">'), html.lastIndexOf("</body>"));
  const style = html.slice(html.indexOf("<style>") + 7, html.indexOf("</style>"));
  return (
    <main className="min-h-screen bg-white">
      <style>{style}</style>
      <div className="noprint mx-auto flex max-w-[820px] flex-wrap items-center gap-3 px-6 pt-5 text-sm">
        <Link href={v.own ? "/agreements" : "/agreements/manage"} className="font-semibold underline">← {v.own ? "اتفاقياتي" : "إدارة الاتفاقيات"}</Link>
        <a href={`/agreements/signed/${id}/download`} className="btn-brand inline-flex min-h-10 items-center rounded-xl px-4 font-semibold">تنزيل النسخة (HTML)</a>
        <PrintButton />
      </div>
      <div dangerouslySetInnerHTML={{ __html: inner }} />
    </main>
  );
}
