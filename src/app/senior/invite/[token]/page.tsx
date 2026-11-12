import Link from "next/link";
import { auth } from "@/auth";
import { ThemedLockup } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ControlGroup } from "@/components/ControlGroup";
import { openSeniorInvitation, SENIOR_CAPABILITIES } from "@/lib/governance/senior";
import { prisma } from "@/lib/prisma";
import { AcceptForm } from "./AcceptForm";

export const dynamic = "force-dynamic";

const CAP_LABEL = Object.fromEntries(SENIOR_CAPABILITIES.map((c) => [c.key, c.label]));

/** **قبولُ دعوة الإدارة العليا** — صفحةٌ عامة (المدعوُّ قد لا يكون له حساب). فتحُها يعلّم الدعوةَ
 *  «بانتظار القبول»، وتنتهي بوقتها. والقبولُ نفسُه في الخادم (`acceptSeniorInvitation`). */
export default async function SeniorInvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [p, session] = await Promise.all([openSeniorInvitation(token), auth()]);
  const live = !!p && ["sent", "opened"].includes(p.inviteState) && p.status === "pending";
  const hasAccount =
    live &&
    !!(
      (await prisma.user.findFirst({ where: { email: { equals: p.inviteEmail, mode: "insensitive" } }, select: { id: true } })) ||
      (await prisma.member.findFirst({ where: { email: { equals: p.inviteEmail, mode: "insensitive" } }, select: { id: true } }))
    );

  return (
    <main className="auth-page flex min-h-screen flex-col items-center justify-center gap-6 px-4 py-10">
      <div className="flex w-full max-w-lg justify-end">
        <ControlGroup color="var(--ink)" label="أدوات العرض">
          <ThemeToggle />
        </ControlGroup>
      </div>
      <ThemedLockup height={32} />
      <div className="auth-card w-full max-w-lg rounded-3xl bg-white p-6 shadow-xl sm:p-8">
        {!p || !live ? (
          <div className="text-center">
            <h1 className="mb-3 text-lg font-bold">
              {p?.inviteState === "expired" ? "انتهت مدّة الدعوة" : p?.inviteState === "accepted" ? "قُبلت هذه الدعوة" : "الرابط غير صالح"}
            </h1>
            <p className="mb-6 text-sm leading-relaxed text-black/60">
              {p?.inviteState === "expired"
                ? "اطلب من قائد الإدارة العليا إعادة إرسالها."
                : p?.inviteState === "accepted"
                  ? "سجّل الدخول لترى تكليفك."
                  : "الرابط غير صحيح، أو أُعيد إرسالُ الدعوة برابطٍ أحدث، أو أُلغيت."}
            </p>
            <Link href="/login" className="btn-brand inline-flex min-h-11 items-center justify-center rounded-xl px-6 text-sm font-semibold">
              تسجيل الدخول
            </Link>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div>
              <p className="text-xs font-semibold text-black/50">دعوةٌ إلى {p.department.name}</p>
              <h1 className="mt-1 text-xl font-bold">{p.titleAr}</h1>
              {p.titleEn && <p className="text-sm text-black/50" dir="ltr">{p.titleEn}</p>}
              <p className="mt-2 text-sm text-black/60">
                {p.inviteName} — دعاك {p.invitedByName}
              </p>
            </div>
            {p.description && <p className="text-sm leading-relaxed text-black/70">{p.description}</p>}
            {p.responsibilities && (
              <div>
                <p className="mb-1 text-xs font-semibold text-black/50">المسؤوليات</p>
                <p className="whitespace-pre-line text-sm leading-relaxed">{p.responsibilities}</p>
              </div>
            )}
            <div>
              <p className="mb-1 text-xs font-semibold text-black/50">الصلاحيات</p>
              <ul className="list-inside list-disc text-sm">
                {p.capabilities.map((c) => <li key={c}>{CAP_LABEL[c] ?? c}</li>)}
              </ul>
            </div>
            <AcceptForm token={token} needsPassword={!hasAccount} signedIn={!!session} />
          </div>
        )}
      </div>
    </main>
  );
}
