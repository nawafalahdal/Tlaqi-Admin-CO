import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { recordOrgEvent } from "@/lib/org/audit";
import { appBaseUrl } from "@/lib/emailBrand";
import { agreementContext, signedCopyAccess, signedCopyHtml } from "@/lib/governance/agreements";

export const dynamic = "force-dynamic";

/** **تنزيلُ النسخة الموقّعة** — ملفُّ HTML مكتفٍ بذاته؛ لصاحبه ولمن يطّلع على الاتفاقيات، ويُسجَّل التنزيل */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await agreementContext(await auth());
  const v = await signedCopyAccess(ctx, id);
  if (!v || !ctx.account) return new NextResponse("غير موجود", { status: 404 });
  await recordOrgEvent(prisma, {
    scope: "agreement", entityId: id, departmentId: "platform", action: "agreement.copy.download",
    actor: { kind: ctx.account.kind, id: ctx.account.id, name: ctx.account.name, role: ctx.account.role },
    after: { own: v.own, valid: v.valid },
  }).catch(() => {});
  const html = signedCopyHtml(v, { logoUrl: `${appBaseUrl()}/brand/lockup-on-light.png` });
  const day = v.signature.signedAt.toISOString().slice(0, 10);
  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `attachment; filename="tlaqi-agreement-${v.signature.kind}-v${v.signature.version}-${day}.html"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self' https: data:; style-src 'unsafe-inline'",
    },
  });
}
