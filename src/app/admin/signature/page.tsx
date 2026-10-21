import { redirect } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { auth } from "@/auth";
import { themeFromColor, SUPER_ADMIN_THEME } from "@/lib/brand";
import { Card } from "@/components/ui";
import { accountRoleLabel } from "@/lib/testTracks";
import {
  currentSignatureFor,
  pendingSignatures,
  leadersMissingSignature,
  isSigningRole,
} from "@/lib/signatures";
import { formatDate } from "@/lib/format";
import { SignaturePad } from "./SignaturePad";
import { SignatureReview } from "./SignatureReview";

import { getLocale, getDictionary } from "@/i18n/server";
import { fmt } from "@/i18n/fmt";
export const dynamic = "force-dynamic";

/** صفحة التوقيعات: يرفع القائد توقيعه، ويُراجعها المؤسس والتنفيذي.
 *
 *  صفحةٌ واحدة لا اثنتان: من يرفع يرى حالته، ومن يُراجع يرى المعلّق —
 *  والمؤسس يرى الاثنين لأنه يرفع ويُراجع. */
export default async function SignaturePage() {
  const locale = await getLocale();
  const L = getDictionary(locale).rSigPage;
  const session = await auth();
  if (!session) redirect("/login");

  const role = session.user.role;
  const canReview = role === "super_admin" || role === "executive";
  // من لا يُوقّع ولا يُراجع لا شأن له بهذه الصفحة
  if (!canReview && !isSigningRole(role)) redirect("/admin");

  const theme = themeFromColor(SUPER_ADMIN_THEME.colorHex);
  const mine = isSigningRole(role) ? await currentSignatureFor(session.user.id) : null;

  const [pending, missing] = canReview
    ? await Promise.all([pendingSignatures(), leadersMissingSignature()])
    : [[], []];

  const STATUS: Record<string, string> = {
    requested: L.requestedNotUploadedYet,
    submitted: L.uploadedAwaitingManagementApproval,
    approved: L.approvedDrawnOnYour,
    rejected: L.rejectedUploadAnother,
  };

  return (
    <div className="min-h-screen bg-page">

      <main className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-6 sm:px-5">

        <PageHeader title={L.certificateSignatures} description={<>{L.thankYouCertificatesCarry}</>} />

        {isSigningRole(role) && (
          <section>
            <h2 className="mb-1 text-base font-bold">{L.yourSignature}</h2>
            {mine ? (
              <Card className="p-4 sm:p-5">
                <p className="text-sm font-bold">{STATUS[mine.status] ?? mine.status}</p>
                {mine.status === "rejected" && mine.rejectionNote && (
                  <p className="mt-1.5 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
                    {fmt(L.reasonForRejection, mine.rejectionNote)}</p>
                )}
                {mine.status === "approved" && mine.imageData && (
                  <div className="mt-3 rounded-xl border border-black/10 bg-white p-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={mine.imageData}
                      alt={L.yourApprovedSignature}
                      style={{ maxHeight: 110, maxWidth: "100%", objectFit: "contain" }}
                    />
                    <p className="mt-2 text-xs text-black/40">
                      {fmt(L.approved, mine.approvedAt ? formatDate(mine.approvedAt) : "")}</p>
                  </div>
                )}
                {(mine.status === "requested" || mine.status === "rejected") && (
                  <div className="mt-4">
                    <SignaturePad theme={theme} />
                  </div>
                )}
              </Card>
            ) : (
              <Card className="p-6 text-center text-sm text-black/40">{L.noSignatureRequestIs}</Card>
            )}
          </section>
        )}

        {canReview && (
          <SignatureReview
            theme={theme}
            pending={pending.map((p) => ({
              id: p.id,
              imageData: p.imageData,
              ownerName: p.user.fullName,
              roleLabel: accountRoleLabel(p.user.role, locale),
              departmentName: p.department?.name ?? null,
              isSelf: p.userId === session.user.id,
            }))}
            missing={missing.map((m) => ({
              id: m.id,
              fullName: m.fullName,
              roleLabel: accountRoleLabel(m.role, locale),
              departmentName: m.department?.name ?? null,
            }))}
          />
        )}
      </main>
    </div>
  );
}
