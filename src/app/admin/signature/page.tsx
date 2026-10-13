import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { themeFromColor, SUPER_ADMIN_THEME } from "@/lib/brand";
import { AppHeader, Card } from "@/components/ui";
import { HeaderActions } from "@/components/HeaderActions";
import { BackButton } from "@/components/BackButton";
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

export const dynamic = "force-dynamic";

/** صفحة التوقيعات: يرفع القائد توقيعه، ويُراجعها المؤسس والتنفيذي.
 *
 *  صفحةٌ واحدة لا اثنتان: من يرفع يرى حالته، ومن يُراجع يرى المعلّق —
 *  والمؤسس يرى الاثنين لأنه يرفع ويُراجع. */
export default async function SignaturePage() {
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
    requested: "مطلوب — لم تُرفعه بعد",
    submitted: "مرفوع — ينتظر اعتماد الإدارة",
    approved: "معتمَد — يُرسَم على شهاداتك",
    rejected: "مرفوض — ارفع غيره",
  };

  return (
    <div className="min-h-screen bg-[#FAF8F4]">
      <AppHeader theme={theme} roleName={accountRoleLabel(role)} userName={session.user.name ?? ""}>
        <HeaderActions color={theme.text} />
      </AppHeader>

      <main className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-6 sm:px-5">
        <BackButton />

        <div>
          <h1 className="text-lg font-bold sm:text-xl">توقيعات الشهادات</h1>
          <p className="mt-1 text-xs leading-relaxed text-black/50">
            شهادات الشكر تحمل توقيع من عمل صاحبُها تحته. والتوقيع مِلكُ صاحبه لا مِلكُ المنصب:
            من خرج بطل توقيعه ولم يُورَّث لخَلَفِه، ومن جاء طُلب منه توقيعُه هو.
          </p>
        </div>

        {isSigningRole(role) && (
          <section>
            <h2 className="mb-1 text-base font-bold">توقيعك</h2>
            {mine ? (
              <Card className="p-4 sm:p-5">
                <p className="text-sm font-bold">{STATUS[mine.status] ?? mine.status}</p>
                {mine.status === "rejected" && mine.rejectionNote && (
                  <p className="mt-1.5 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
                    سبب الرفض: {mine.rejectionNote}
                  </p>
                )}
                {mine.status === "approved" && mine.imageData && (
                  <div className="mt-3 rounded-xl border border-black/10 bg-white p-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={mine.imageData}
                      alt="توقيعك المعتمَد"
                      style={{ maxHeight: 110, maxWidth: "100%", objectFit: "contain" }}
                    />
                    <p className="mt-2 text-xs text-black/40">
                      اعتُمد {mine.approvedAt ? formatDate(mine.approvedAt) : ""}
                    </p>
                  </div>
                )}
                {(mine.status === "requested" || mine.status === "rejected") && (
                  <div className="mt-4">
                    <SignaturePad theme={theme} />
                  </div>
                )}
              </Card>
            ) : (
              <Card className="p-6 text-center text-sm text-black/40">
                لا طلب توقيعٍ مفتوحٌ لك. وإن احتاجته الإدارة طلبته منك وأُشعرت ببريد.
              </Card>
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
              roleLabel: accountRoleLabel(p.user.role),
              departmentName: p.department?.name ?? null,
              isSelf: p.userId === session.user.id,
            }))}
            missing={missing.map((m) => ({
              id: m.id,
              fullName: m.fullName,
              roleLabel: accountRoleLabel(m.role),
              departmentName: m.department?.name ?? null,
            }))}
          />
        )}
      </main>
    </div>
  );
}
