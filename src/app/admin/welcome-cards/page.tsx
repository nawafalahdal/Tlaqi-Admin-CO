import Link from "next/link";
import type { Session } from "next-auth";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/PageHeader";
import { DataTable } from "@/components/DataTable";
import { Card } from "@/components/ui";
import { brandInk, themeFromColor, SUPER_ADMIN_THEME } from "@/lib/brand";
import { accountRoleLabel } from "@/lib/testTracks";
import { formatDate } from "@/lib/format";
import { ROSTER_MEMBER_WHERE } from "@/lib/roster";
import { certificateUrl } from "@/lib/certificate";
import { canResendWelcome, canRequestWelcomeResend, resendTargetsFor, WELCOME_MAX_SENDS } from "@/lib/welcomeResend";
import { canIssueCertificates, certificateTargetsFor, loadCertificateDesk } from "@/lib/recognitionDesk";
import { listIssued } from "@/lib/certificateRegistry";
import { isCertificateType, type CertificateType } from "@/lib/certificateTypes";
import { ResendWelcomeButton } from "./ResendWelcomeButton";
import { CertificateAction } from "./CertificateAction";
import { IssueWorkspace } from "./IssueWorkspace";
import { ResendIssuedButton } from "./ResendIssuedButton";

import { getLocale, getDictionary } from "@/i18n/server";
import { fmt } from "@/i18n/fmt";
export const dynamic = "force-dynamic";

/** **الترحيب والتكريم** — بطاقاتُ الانضمام والشهادات في صفحةٍ واحدة.
 *
 *  **لمن الصفحة:** السلسلةُ نفسُها للبطاقات والشهادات — المؤسس للرئيس التنفيذي،
 *  والتنفيذي لمسؤول المتابعة والتشغيل، ومسؤول التشغيل للقادة والأعضاء
 *  (`resendTargetsFor` و`certificateTargetsFor`). وقيادةُ التسويق تطلب منها إعادة
 *  البطاقة فيصله الطلب تذكرة — ولا ترى تبويب الشهادات. والشروطُ تُفرَض
 *  مرّةً ثانيةً في كل إجراء، فمن كتب العنوان بيده بلا صلاحية يُعاد، ومن
 *  نادى الإجراء مباشرةً يُرفَض.
 *
 *  **تبويبان** (`?tab=`): البطاقات، والشهادات. وفوق كلٍّ أرقامُه: ما يحتاج
 *  يداً الآن أولاً. ولا بُرُد تُعرَض: الإعادةُ والإصدار لا يحتاجانها. */
export default async function WelcomeCardsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; tab?: string; m?: string; t?: string }>;
}) {
  const locale = await getLocale();
  const dict = getDictionary(locale);
  const L = dict.rWelcomePage;
  const R = dict.rRecognitionDesk;
  const session = await auth();
  if (!session) redirect("/login");
  const canSend = await canResendWelcome(session);
  const canRequest = !canSend && (await canRequestWelcomeResend(session));
  const canCertify = canIssueCertificates(session.user.role);
  if (!canSend && !canRequest && !canCertify) redirect("/admin");
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().slice(0, 80);
  const tab: "cards" | "certificates" = canCertify && sp.tab === "certificates" ? "certificates" : "cards";
  const theme = themeFromColor(SUPER_ADMIN_THEME.colorHex);
  const tabHref = (t: "cards" | "certificates") =>
    `/admin/welcome-cards?${new URLSearchParams({ ...(t === "certificates" ? { tab: t } : {}), ...(q ? { q } : {}) })}`;

  return (
    <div className="min-h-screen bg-page">
      <main
        className={`mx-auto flex flex-col gap-5 px-4 py-6 sm:px-5 sm:py-8 ${tab === "certificates" ? "max-w-6xl" : "max-w-5xl"}`}
      >
        <PageHeader
          title={R.title}
          description={canCertify ? R.descIssuer : canSend ? L.resendTheWelcomeCard : L.requestAWelcomeCard}
        />

        {canCertify && (
          <nav aria-label={R.title} className="flex w-full gap-1 rounded-2xl border border-hairline bg-white p-1 sm:w-fit">
            {(["cards", "certificates"] as const).map((t) => (
              <Link
                key={t}
                href={tabHref(t)}
                aria-current={tab === t ? "page" : undefined}
                className={`flex min-h-11 flex-1 items-center justify-center rounded-xl px-5 text-sm sm:flex-none ${
                  tab === t ? "btn-brand font-bold" : "font-semibold text-black/60 hover:bg-black/[0.04]"
                }`}
              >
                {t === "cards" ? R.tabCards : R.tabCertificates}
              </Link>
            ))}
          </nav>
        )}

        {tab === "cards" ? (
          <CardsTab session={session} canSend={canSend} q={q} theme={theme} L={L} R={R} locale={locale} />
        ) : (
          <CertificatesTab
            q={q}
            role={session.user.role}
            theme={theme}
            R={R}
            L={L}
            locale={locale}
            initialMemberId={typeof sp.m === "string" && sp.m ? sp.m.slice(0, 40) : undefined}
            initialType={isCertificateType(sp.t) ? sp.t : undefined}
          />
        )}
      </main>
    </div>
  );
}

type Dict = ReturnType<typeof getDictionary>;
type Theme = ReturnType<typeof themeFromColor>;

function SearchBar({ q, tab, L }: { q: string; tab: "cards" | "certificates"; L: Dict["rWelcomePage"] }) {
  return (
    <form className="flex flex-wrap items-center gap-2" role="search">
      {tab === "certificates" && <input type="hidden" name="tab" value="certificates" />}
      <input
        name="q"
        defaultValue={q}
        placeholder={L.searchByName}
        aria-label={L.searchByName}
        className="min-h-11 min-w-56 flex-1 rounded-xl border border-black/10 bg-white px-3 text-sm"
      />
      <button type="submit" className="wizard-btn-2">{L.search}</button>
    </form>
  );
}

function StatTile({ label, value, theme, accent }: { label: string; value: number; theme: Theme; accent?: boolean }) {
  return (
    // ما يحتاج يداً الآن يُعلَّم بخطٍّ بلون الهوية أسفله — لا بلونٍ جديد
    <Card
      className="p-3.5 sm:p-4"
      style={accent && value > 0 ? { boxShadow: `inset 0 -3px 0 ${brandInk(theme)}` } : undefined}
    >
      <p className="text-2xl font-bold leading-none" style={{ color: brandInk(theme) }}>
        {value}
      </p>
      <p className="mt-1.5 text-xs leading-snug text-black/55">{label}</p>
    </Card>
  );
}

function Pill({ tone, children }: { tone: "ok" | "warn" | "muted"; children: React.ReactNode }) {
  const cls =
    tone === "ok"
      ? "bg-green-700/10 text-green-800"
      : tone === "warn"
        ? "bg-[#C34900]/10 text-[#C34900]"
        : "bg-black/[0.06] text-black/60";
  return <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold ${cls}`}>{children}</span>;
}

/** تبويبُ البطاقات — كما كان: يرى كلٌّ من يُعيد بطاقاتِهم في السلسلة */
async function CardsTab({
  session,
  canSend,
  q,
  theme,
  L,
  R,
  locale,
}: {
  session: Session;
  canSend: boolean;
  q: string;
  theme: Theme;
  L: Dict["rWelcomePage"];
  R: Dict["rRecognitionDesk"];
  locale: Awaited<ReturnType<typeof getLocale>>;
}) {
  const nameFilter = q ? { fullName: { contains: q, mode: "insensitive" as const } } : {};
  // كلٌّ يرى من يُعيد بطاقاتِهم في السلسلة (`resendTargetsFor`): مسؤولُ التشغيل
  // القادةَ والأعضاء، والتنفيذيُّ مسؤولي التشغيل، والمؤسسُ التنفيذيَّ.
  // وقيادةُ التسويق تطلب لمن يُعيدهم مسؤول التشغيل.
  const targets = canSend ? resendTargetsFor(session.user.role) : resendTargetsFor("operations_officer");
  const userRoles = targets.filter((r) => r !== "member") as ("department_admin" | "operations_officer" | "executive")[];
  const [users, members] = await Promise.all([
    prisma.user.findMany({
      where: { isActive: true, role: { in: userRoles }, id: { not: session.user.id }, ...nameFilter },
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
      role: accountRoleLabel(u.role, locale),
      dept: u.department?.name ?? "—",
      sentAt: u.welcomeEmailSentAt,
      count: u.welcomeEmailCount,
    })),
    ...members.map((m) => ({
      kind: "member" as const,
      id: m.id,
      name: m.fullName,
      role: L.member,
      dept: m.department?.name ?? "—",
      sentAt: m.welcomeEmailSentAt,
      count: m.welcomeEmailCount,
    })),
  ];

  return (
    <>
      <section className="grid grid-cols-3 gap-3">
        <StatTile label={R.statCardsNotSent} value={rows.filter((r) => r.count === 0).length} theme={theme} accent />
        <StatTile label={R.statCardsOneLeft} value={rows.filter((r) => r.count > 0 && r.count < WELCOME_MAX_SENDS).length} theme={theme} />
        <StatTile label={R.statCardsUsedUp} value={rows.filter((r) => r.count >= WELCOME_MAX_SENDS).length} theme={theme} />
      </section>

      <SearchBar q={q} tab="cards" L={L} />

      <DataTable
        emptyLabel={q ? L.noOneWithThat : L.noApprovedLeadersOr}
        columns={[
          { key: "name", label: L.name, primary: true },
          { key: "role", label: L.role },
          { key: "dept", label: L.department },
          { key: "last", label: L.cards },
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
                  {r.count >= WELCOME_MAX_SENDS ? L.resendUsedUp : r.count === 0 ? L.notSent : L.oneResendLeft}
                </span>
                {r.sentAt ? fmt(L.lastOneAccepted, formatDate(r.sentAt)) : L.notSentYet}
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
    </>
  );
}

/** تبويبُ الشهادات — ختامُ التجربة أولاً ثم التقدير، وكلٌّ مرتّبٌ بالحاجة */
async function CertificatesTab({
  q,
  role,
  theme,
  R,
  L,
  locale,
  initialMemberId,
  initialType,
}: {
  q: string;
  role: string;
  theme: Theme;
  R: Dict["rRecognitionDesk"];
  L: Dict["rWelcomePage"];
  locale: Awaited<ReturnType<typeof getLocale>>;
  initialMemberId?: string;
  initialType?: CertificateType;
}) {
  const T = getDictionary(locale).rIssueDesk;
  // كلٌّ يرى من في عهدته في السلسلة وحدهم — في النموذج والسجل وقوائم الانتظار
  const targets = certificateTargetsFor(role);
  const [desk, issued, recipients] = await Promise.all([
    loadCertificateDesk(q, role),
    listIssued(targets, q, 30),
    prisma.member.findMany({
      where: {
        invite: { targetRole: { in: targets } },
        approvalStatus: "approved",
        offboardingClosedAt: null,
        noFurtherEmail: false,
      },
      select: { id: true, fullName: true, department: { select: { name: true } }, invite: { select: { targetRole: true } } },
      orderBy: { fullName: "asc" },
      take: 500,
    }),
  ]);
  const prepare = (memberId: string, type: CertificateType) => (
    <Link
      href={`/admin/welcome-cards?${new URLSearchParams({ tab: "certificates", m: memberId, t: type })}#issue`}
      className="wizard-btn-2 !min-h-9 !px-3 !text-xs"
    >
      {R.prepare}
    </Link>
  );
  const typeLabel: Record<CertificateType, string> = {
    appreciation: T.typeAppreciation,
    achievement: T.typeAchievement,
    appointment: T.typeAppointment,
    leadership: T.typeLeadership,
    membership: T.typeMembership,
    final: T.typeFinal,
  };
  const view = (memberId: string, kind: "final" | "appreciation") => (
    <a
      href={certificateUrl(memberId, "", kind)}
      target="_blank"
      rel="noopener"
      className="text-xs font-bold underline underline-offset-2"
    >
      {R.aView}
    </a>
  );
  const muted = (text: string) => <span className="text-xs text-black/55">{text}</span>;
  const ok = (text: string) => <span className="text-xs font-bold text-green-800">{text}</span>;
  const warn = (text: string) => <span className="text-xs font-bold text-amber-800">{text}</span>;

  return (
    <>
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label={R.statDue} value={desk.stats.due} theme={theme} accent />
        <StatTile label={R.statClosing} value={desk.stats.closing} theme={theme} accent />
        <StatTile label={R.statUndelivered} value={desk.stats.undelivered} theme={theme} accent />
        <StatTile label={R.statIssued} value={desk.stats.issuedThisMonth} theme={theme} />
      </section>

      <IssueWorkspace
        key={`${initialMemberId ?? ""}:${initialType ?? ""}`}
        role={role}
        initialMemberId={initialMemberId}
        initialType={initialType}
        recipients={recipients.map((m) => ({
          id: m.id,
          name: m.fullName,
          dept: m.department?.name ?? "",
          role: accountRoleLabel(m.invite.targetRole, locale),
        }))}
      />

      <section className="flex flex-col gap-2">
        <h2 className="text-base font-bold">{T.logTitle}</h2>
        <DataTable
          emptyLabel={T.logEmpty}
          columns={[
            { key: "number", label: T.colNumber },
            { key: "name", label: T.colRecipient, primary: true },
            { key: "type", label: T.colType },
            { key: "by", label: T.colBy },
            { key: "date", label: T.colDate },
            { key: "status", label: "" },
            { key: "actions", label: "" },
          ]}
          rows={issued.map((r) => ({
            id: `issued:${r.id}`,
            cells: {
              number: (
                <bdi dir="ltr" className="text-xs">
                  {r.number}
                </bdi>
              ),
              name: <span className="font-bold">{r.member.fullName}</span>,
              type: r.type ? typeLabel[r.type] : r.kind,
              by: r.issuedById ? r.issuedByName : r.issuedByName === "آلياً" ? T.byAuto : r.issuedByName,
              date: formatDate(r.issuedAt),
              status: (
                <span className="flex flex-wrap gap-1">
                  {r.sentAt ? <Pill tone="ok">{T.pSent}</Pill> : <Pill tone="warn">{T.pUndelivered}</Pill>}
                  {r.early && (
                    <span title={[r.earlyReason, r.earlyReference].filter(Boolean).join(" — ")}>
                      <Pill tone="warn">{T.pEarly}</Pill>
                    </span>
                  )}
                  {r.editsCount > 0 && <Pill tone="muted">{T.pEdited}</Pill>}
                </span>
              ),
              actions: (
                <div className="flex items-center justify-end gap-3">
                  <a href={r.url} target="_blank" rel="noopener" className="text-xs font-bold underline underline-offset-2">
                    {R.aView}
                  </a>
                  {!r.sentAt && <ResendIssuedButton id={r.id} number={r.number} name={r.member.fullName} />}
                </div>
              ),
            },
          }))}
        />
      </section>

      <div className="mt-2 flex flex-col gap-1">
        <h2 className="text-base font-bold">{R.queueTitle}</h2>
        <p className="text-xs leading-relaxed text-black/55">{R.queueHint}</p>
      </div>
      <SearchBar q={q} tab="certificates" L={L} />
      <p className="-mt-2 text-xs leading-relaxed text-black/55">{R.chainNote}</p>

      {desk.final.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-base font-bold">{R.closingTitle}</h2>
          <p className="text-xs leading-relaxed text-black/55">{R.closingHint}</p>
          <DataTable
            emptyLabel={L.noOneWithThat}
            columns={[
              { key: "name", label: L.name, primary: true },
              { key: "role", label: L.role },
              { key: "dept", label: L.department },
              { key: "status", label: R.colStatus },
              { key: "actions", label: "" },
            ]}
            rows={desk.final.map((r) => ({
              id: `final:${r.id}`,
              cells: {
                name: <span className="font-bold">{r.name}</span>,
                role: accountRoleLabel(r.targetRole, locale),
                dept: r.dept,
                status:
                  r.state.kind === "sent"
                    ? ok(fmt(R.sSent, formatDate(r.state.at)))
                    : r.state.kind === "undelivered"
                      ? warn(fmt(R.sUndelivered, formatDate(r.state.at)))
                      : r.state.kind === "ready"
                        ? muted(fmt(R.fReady, formatDate(r.stepDownAt)))
                        : muted(fmt(R.fIneligible, r.state.days)),
                actions:
                  r.state.kind === "sent" || r.state.kind === "undelivered" ? (
                    <div className="flex items-center justify-end gap-3">
                      {view(r.id, "final")}
                      {r.state.kind === "undelivered" && (
                        <CertificateAction type="final" mode="resend" memberId={r.id} name={r.name} />
                      )}
                    </div>
                  ) : r.state.kind === "ready" ? (
                    <div className="flex justify-end">{prepare(r.id, "final")}</div>
                  ) : null,
              },
            }))}
          />
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-base font-bold">{R.appreciationTitle}</h2>
        <p className="text-xs leading-relaxed text-black/55">{R.appreciationHint}</p>
        <DataTable
          emptyLabel={q ? L.noOneWithThat : R.emptyAppreciation}
          columns={[
            { key: "name", label: L.name, primary: true },
            { key: "role", label: L.role },
            { key: "dept", label: L.department },
            { key: "status", label: R.colStatus },
            { key: "actions", label: "" },
          ]}
          rows={desk.appreciation.map((r) => ({
            id: `appr:${r.id}`,
            cells: {
              name: <span className="font-bold">{r.name}</span>,
              role: accountRoleLabel(r.targetRole, locale),
              dept: r.dept,
              status:
                r.state.kind === "sent"
                  ? ok(fmt(R.sSent, formatDate(r.state.at)))
                  : r.state.kind === "undelivered"
                    ? warn(fmt(R.sUndelivered, formatDate(r.state.at)))
                    : r.state.kind === "due"
                      ? warn(fmt(R.sDue, formatDate(r.state.dueAt)))
                      : r.state.kind === "upcoming"
                        ? muted(fmt(R.sUpcoming, formatDate(r.state.dueAt)))
                        : muted(r.state.reason),
              actions:
                r.state.kind === "sent" ? (
                  <div className="flex justify-end">{view(r.id, "appreciation")}</div>
                ) : r.state.kind === "undelivered" ? (
                  <div className="flex items-center justify-end gap-3">
                    {view(r.id, "appreciation")}
                    <CertificateAction type="appreciation" mode="resend" memberId={r.id} name={r.name} />
                  </div>
                ) : r.state.kind === "due" || r.state.kind === "upcoming" ? (
                  <div className="flex justify-end">{prepare(r.id, "appreciation")}</div>
                ) : null,
            },
          }))}
        />
      </section>
    </>
  );
}
