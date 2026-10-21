import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/PageHeader";
import { DataTable } from "@/components/DataTable";
import { accountRoleLabel } from "@/lib/testTracks";
import { formatDate } from "@/lib/format";
import { ROSTER_MEMBER_WHERE } from "@/lib/roster";
import { canResendWelcome, canRequestWelcomeResend, resendTargetsFor, WELCOME_MAX_SENDS } from "@/lib/welcomeResend";
import { ResendWelcomeButton } from "./ResendWelcomeButton";

export const dynamic = "force-dynamic";


/** بطاقاتُ الانضمام — إعادتُها للقادة والأعضاء.
 *
 *  **لمن الصفحة:** مسؤول المتابعة والتشغيل يُعيد منها (`canResendWelcome`)،
 *  وقيادةُ التسويق تطلب منها الإعادة (`canRequestWelcomeResend`) فيصله
 *  الطلب تذكرة. والشرطان يُفرَضان مرّةً ثانيةً في كل إجراء، فمن كتب العنوان
 *  بيده بلا صلاحية يُعاد، ومن نادى الإجراء مباشرةً يُرفَض.
 *
 *  **وما يُعرَض:** الاسمُ والصفةُ والقسم، وعددُ البطاقات من سقفها
 *  (`WELCOME_MAX_SENDS`) وتاريخُ آخرها. ولا بُرُد: الإعادةُ لا تحتاجها. */
export default async function WelcomeCardsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const session = await auth();
  if (!session) redirect("/login");
  const canSend = await canResendWelcome(session);
  const canRequest = !canSend && (await canRequestWelcomeResend(session));
  if (!canSend && !canRequest) redirect("/admin");
  const q = ((await searchParams).q ?? "").trim().slice(0, 80);

  const nameFilter = q ? { fullName: { contains: q, mode: "insensitive" as const } } : {};
  // كلٌّ يرى من يُعيد بطاقاتِهم في السلسلة (`resendTargetsFor`): مسؤولُ التشغيل
  // القادةَ والأعضاء، والتنفيذيُّ مسؤولي التشغيل، والمؤسسُ التنفيذيَّ.
  // وقيادةُ التسويق تطلب لمن يُعيدهم مسؤول التشغيل.
  const targets = canSend ? resendTargetsFor(session.user.role) : resendTargetsFor("operations_officer");
  const userRoles = targets.filter((r) => r !== "member") as ("department_admin" | "operations_officer" | "executive")[];
  const [users, members] = await Promise.all([
    prisma.user.findMany({
      where: {
        isActive: true,
        role: { in: userRoles },
        id: { not: session.user.id },
        ...nameFilter,
      },
      select: {
        id: true,
        fullName: true,
        role: true,
        welcomeEmailSentAt: true,
        welcomeEmailCount: true,
        department: { select: { name: true } },
      },
      orderBy: { fullName: "asc" },
      take: 300,
    }),
    !targets.includes("member")
      ? Promise.resolve([])
      : prisma.member.findMany({
      where: { ...ROSTER_MEMBER_WHERE, noFurtherEmail: false, decidedAt: { not: null }, ...nameFilter },
      select: {
        id: true,
        fullName: true,
        welcomeEmailSentAt: true,
        welcomeEmailCount: true,
        department: { select: { name: true } },
      },
      orderBy: { fullName: "asc" },
      take: 500,
    }),
  ]);

  const rows = [
    ...users.map((u) => ({
      kind: "user" as const,
      id: u.id,
      name: u.fullName,
      role: accountRoleLabel(u.role),
      dept: u.department?.name ?? "—",
      sentAt: u.welcomeEmailSentAt,
      count: u.welcomeEmailCount,
    })),
    ...members.map((m) => ({
      kind: "member" as const,
      id: m.id,
      name: m.fullName,
      role: "عضو",
      dept: m.department?.name ?? "—",
      sentAt: m.welcomeEmailSentAt,
      count: m.welcomeEmailCount,
    })),
  ];


  return (
    <div className="min-h-screen bg-page">

      <main className="mx-auto flex max-w-5xl flex-col gap-5 px-4 py-6 sm:px-5 sm:py-8">
        <PageHeader
          title="بطاقات الانضمام"
          description={
            canSend
              ? "أعِد إرسال بطاقة الانضمام لمن ضاعت منه أو لم تصله، بعد أن تتأكّد من بريده. لكل شخصٍ إعادةٌ واحدة بعد بطاقة الاعتماد، وتُسجَّل باسمك. وبلاغاتُ «لم تصلني» تصلك تذاكرَ."
              : "اطلب إعادة بطاقة الانضمام لمن ضاعت منه أو لم تصله، فيصل طلبك تذكرةً إلى مسؤول المتابعة والتشغيل وهو من يُرسلها. لكل شخصٍ إعادةٌ واحدة."
          }
        />

        <form className="flex flex-wrap items-center gap-2" role="search">
          <input
            name="q"
            defaultValue={q}
            placeholder="ابحث بالاسم"
            aria-label="ابحث بالاسم"
            className="min-h-11 min-w-56 flex-1 rounded-xl border border-black/10 bg-white px-3 text-sm"
          />
          <button type="submit" className="wizard-btn-2">بحث</button>
        </form>

        <DataTable
          emptyLabel={q ? "لا أحد بهذا الاسم" : "لا قادة ولا أعضاء معتمدون بعد"}
          columns={[
            { key: "name", label: "الاسم", primary: true },
            { key: "role", label: "الصفة" },
            { key: "dept", label: "القسم" },
            { key: "last", label: "البطاقات" },
            { key: "actions", label: "" },
          ]}
          rows={rows.map((r) => ({
            id: `${r.kind}:${r.id}`,
            cells: {
              name: <span className="font-bold">{r.name}</span>,
              role: r.role,
              dept: r.dept,
              last: (
                <span className="text-xs">
                  <span className={`font-bold ${r.count >= WELCOME_MAX_SENDS ? "text-black/45" : ""}`}>
                    {r.count >= WELCOME_MAX_SENDS ? "استُنفدت الإعادة" : r.count === 0 ? "لم تُرسَل" : "بقيت إعادةٌ واحدة"}
                  </span>
                  {r.sentAt ? ` · آخرها قُبلت ${formatDate(r.sentAt)}` : " · لم تُرسَل بعد"}
                </span>
              ),
              actions: (
                <ResendWelcomeButton
                  kind={r.kind}
                  id={r.id}
                  name={r.name}
                  mode={canSend ? "resend" : "request"}
                  capped={r.count >= WELCOME_MAX_SENDS}
                />
              ),
            },
          }))}
        />
      </main>
    </div>
  );
}
