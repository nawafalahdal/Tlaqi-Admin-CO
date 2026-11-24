import Link from "next/link";
import type { Session } from "next-auth";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getLocale, getDictionary } from "@/i18n/server";
import { canResendWelcome, canRequestWelcomeResend } from "@/lib/welcomeResend";
import { canIssueCertificates } from "@/lib/recognitionDesk";
import { canManageOnboardingSurvey } from "@/lib/onboardingSurvey";
import { RegisterView } from "./RegisterView";
import { JoinsView } from "./JoinsView";
import { InvitesView } from "../invites/InvitesView";
import { TerminationsView } from "../terminations/TerminationsView";
import { WelcomeCardsView } from "../welcome-cards/WelcomeCardsView";
import { OnboardingView } from "../onboarding/OnboardingView";

export const dynamic = "force-dynamic";

const VIEWS = ["register", "invites", "joins", "terminations", "welcome", "onboarding"] as const;
type View = (typeof VIEWS)[number];

/** من يرى أيَّ تبويب — **الشروطُ نفسُها التي كانت على كل صفحةٍ وحدها**، وكلُّ تبويبٍ يفحص صلاحيته ثانيةً، والإجراءاتُ في الخادم */
async function viewsFor(session: Session): Promise<View[]> {
  const r = session.user.role;
  const top = r === "super_admin" || r === "executive";
  const welcome = (await canResendWelcome(session)) || (await canRequestWelcomeResend(session)) || canIssueCertificates(r);
  const can: Record<View, boolean> = {
    register: top,
    invites: top,
    joins: r !== "member",
    terminations: top || r === "department_admin",
    welcome,
    onboarding: canManageOnboardingSurvey(r),
  };
  return VIEWS.filter((v) => can[v]);
}

/** **«الأعضاء» — إدارةُ الأشخاص في مكانٍ واحد** (طلبُ المؤسس، 24 نوفمبر 2026).
 *
 *  كانت سبعُ صفحاتٍ تعرض الأشخاص (الأعضاء، الدعوات، طلبات الانضمام، الإنهاء، الترحيب والتكريم، الاستبيان…)، فصارت تبويباتٍ
 *  هنا. **ولا تتغيّر حوكمةٌ:** كلُّ تبويبٍ هو صفحتُه السابقة بعينها وحرسُها، ويظهر لمن كانت تظهر له وحده؛ والروابطُ القديمة
 *  تُحوَّل إلى تبويبها (`/admin/invites` ← `?view=invites`…). وقائدُ القسم يجد أعضاءَ قسمه في لوحة قسمه (تبويبُ «أعضاء قسمي»). */
export default async function PeopleHub({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await auth();
  if (!session) redirect("/login");
  const views = await viewsFor(session);
  const L = getDictionary(await getLocale()).peopleHub;
  const ownDept =
    session.user.role === "department_admin" && session.user.departmentId
      ? await prisma.department.findUnique({ where: { id: session.user.departmentId }, select: { slug: true } })
      : null;
  if (!views.length && !ownDept) redirect("/admin");
  const sp = await searchParams;
  const view: View | null = views.includes(sp.view as View) ? (sp.view as View) : views[0] ?? null;
  if (!view && ownDept) redirect(`/admin/departments/${ownDept.slug}`);

  const pill = (active: boolean) =>
    `inline-flex min-h-10 shrink-0 items-center rounded-full px-4 text-sm font-semibold transition ${
      active ? "bg-[#341D2B] text-on-brand" : "bg-white text-black/70 ring-1 ring-black/10 hover:bg-black/[0.03]"
    }`;
  const params = searchParams as unknown as Promise<never>;

  return (
    <div className="min-h-screen bg-page">
      <div className="mx-auto max-w-6xl px-4 pt-5 sm:px-5 sm:pt-7">
        {/* السجلُّ له عنوانُه «الأعضاء» — فلا يتكرّر العنوان فوقه */}
        {view !== "register" && (
          <>
            <h1 className="text-xl font-bold">{L.title}</h1>
            <p className="mt-1 text-xs text-black/50">{L.hint}</p>
          </>
        )}
        <nav aria-label={L.title} className="-mx-4 mt-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
          {ownDept && (
            <Link href={`/admin/departments/${ownDept.slug}`} className={pill(false)}>
              {L.myDept}
            </Link>
          )}
          {views.map((v) => (
            <Link key={v} href={v === views[0] ? "/admin/people" : `/admin/people?view=${v}`} aria-current={v === view ? "page" : undefined} className={pill(v === view)}>
              {L[v]}
            </Link>
          ))}
        </nav>
      </div>
      {view === "register" && <RegisterView searchParams={params} />}
      {view === "invites" && <InvitesView />}
      {view === "joins" && <JoinsView session={session} empty={L.joinsEmpty} />}
      {view === "terminations" && <TerminationsView />}
      {view === "welcome" && <WelcomeCardsView searchParams={params} />}
      {view === "onboarding" && <OnboardingView searchParams={params} />}
    </div>
  );
}
