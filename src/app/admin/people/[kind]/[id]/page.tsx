import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { themeFromColor, SUPER_ADMIN_THEME, BRAND } from "@/lib/brand";
import { Card } from "@/components/ui";
import { formatDate, sinceLabel } from "@/lib/format";
import { roleTitle } from "@/lib/gender";
import { avatarUrl } from "@/lib/avatarUrl";
import { canAward } from "@/lib/awards";
import { OPEN_DEPARTMENT_WHERE } from "@/lib/committees";
import { portraitColorFor } from "@/lib/portraitTone";
import { PersonAvatar } from "@/components/PersonAvatar";
import { seniorDepartment, affiliationFor } from "@/lib/seniorAffiliation";
import { AccountRow } from "../../AccountRow";
import { MemberAccountRow } from "../../MemberAccountRow";
import { MyAccountCard } from "../../MyAccountCard";
import { FounderMemberControls } from "@/components/FounderMemberControls";

export const dynamic = "force-dynamic";

const OPEN_TASK = ["not_started", "in_progress", "submitted", "returned", "incomplete", "blocked"] as const;
const COMM_KINDS = ["دعوة", "ترحيب", "تقدير ثلاثة أشهر", "شهادة إتمام", "تكريم إنجاز", "تنبيه", "ختام التجربة"];

/** ملفُّ الشخص — موضعُه الواحد: من هو، وما عمل، وما وصله، وما يُدار به حسابه.
 *
 *  **من يفتحه:** المؤسس والرئيس التنفيذي لكلّ أحد، وقائدُ القسم لأعضاء قسمه
 *  وحدهم. والشرط هنا في الخادم قبل أيّ قراءة — لا إخفاءُ رابط.
 *
 *  **ولا رقمَ مقدَّر:** المهامُّ من الالتزامات المسجّلة، والتذاكرُ من سجلّها،
 *  والتواصلُ من «سجل الرسائل» بحالته كما سُجّلت («قُبلت» لا «فُتحت»). وما
 *  لا تسجّله المنصة — كآخر دخول — لا يُعرَض.
 *
 *  **وإدارةُ الحساب** هي المكوّنات القائمة نفسها (كلمة المرور، التنحية،
 *  الحذف، التكريم، بطاقة الانضمام، تاريخ الانضمام) — نُقلت إلى هنا من
 *  السجلّ ولم يُكتب لها إجراءٌ جديد. */
/** طريقُ العودة إلى القائمة كما تُركت — بحثُها وتبويبُها وقسمُها.
 *
 *  يُقبَل مساراً داخلياً لسجلّ الأعضاء وحده، ويُبنى من جديد من مُعامِلاته
 *  المعروفة: فلا يصير الرابطُ باباً إلى عنوانٍ خارجي (`//host` أو
 *  `https:`)، ولا تمرّ منه معاملاتٌ لا تعرفها القائمة. ومن فتح الملفّ من
 *  رابطٍ مباشر بلا `from` يعود إلى القائمة نفسها بلا تصفية. */
function rosterReturn(from: string | undefined): string {
  if (!from || !from.startsWith("/admin/people")) return "/admin/people";
  let u: URL;
  try {
    u = new URL(from, "http://local");
  } catch {
    return "/admin/people";
  }
  if (u.origin !== "http://local" || u.pathname !== "/admin/people") return "/admin/people";
  const p = new URLSearchParams();
  for (const k of ["tab", "q", "dept"]) {
    const v = u.searchParams.get(k);
    if (v) p.set(k, v.slice(0, 120));
  }
  const q = p.toString();
  return q ? `/admin/people?${q}` : "/admin/people";
}

export default async function PersonPage({
  params,
  searchParams,
}: {
  params: Promise<{ kind: string; id: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const session = await auth();
  if (!session) redirect("/login");
  const { kind, id } = await params;
  const backHref = rosterReturn((await searchParams).from);
  if (kind !== "user" && kind !== "member") notFound();

  const role = session.user.role;
  const top = role === "super_admin" || role === "executive";
  const isFounder = role === "super_admin";
  if (!top && role !== "department_admin") redirect("/admin");
  const leadHome = session.user.departmentSlug ? `/admin/departments/${session.user.departmentSlug}` : "/admin";

  const user =
    kind === "user"
      ? await prisma.user.findUnique({
          where: { id },
          omit: { avatarData: true, passwordHash: true, totpSecret: true },
          include: { department: true },
        })
      : null;
  const member =
    kind === "member"
      ? await prisma.member.findUnique({
          where: { id },
          omit: { avatarData: true, passwordHash: true },
          include: { department: true, invite: true, warnings: { orderBy: { createdAt: "desc" }, take: 10 } },
        })
      : null;
  const person = user ?? member;
  if (!person) notFound();

  // قائدُ القسم: أعضاءُ قسمه وحدهم — والقيادةُ الأخرى ليست من شأنه
  if (!top) {
    if (!member || !session.user.departmentId || member.departmentId !== session.user.departmentId) {
      redirect("/admin");
    }
  }

  const now = new Date();
  const ownerWhere = user ? { ownerUserId: user.id } : { ownerMemberId: member!.id };
  const raisedWhere = user ? { raisedByUserId: user.id } : { memberId: member!.id };
  const [done, overdue, openTasks, raised, raisedResolved, closedFor, comms, departments] = await Promise.all([
    prisma.planTask.count({ where: { ...ownerWhere, execState: "verified" } }),
    prisma.planTask.count({ where: { ...ownerWhere, execState: { in: [...OPEN_TASK] }, dueAt: { lt: now } } }),
    prisma.planTask.count({ where: { ...ownerWhere, execState: { in: [...OPEN_TASK] } } }),
    prisma.ticket.count({ where: raisedWhere }),
    prisma.ticket.count({ where: { ...raisedWhere, status: "resolved" } }),
    user ? prisma.ticket.count({ where: { resolvedByUserId: user.id } }) : Promise.resolve(null),
    prisma.emailLog.findMany({
      where: { recipient: { equals: person.email, mode: "insensitive" }, kind: { in: COMM_KINDS } },
      orderBy: { createdAt: "desc" },
      take: 12,
      select: { id: true, kind: true, subject: true, status: true, createdAt: true },
    }),
    isFounder && member && !member.departmentId
      ? prisma.department.findMany({ where: OPEN_DEPARTMENT_WHERE, select: { id: true, name: true } })
      : Promise.resolve(undefined),
  ]);

  const theme = themeFromColor(SUPER_ADMIN_THEME.colorHex);
  const accountRole = user ? user.role : member!.invite.targetRole;
  // المؤسس والتنفيذي ومسؤول التشغيل من الإدارة العليا بدورهم — `seniorAffiliation`
  const senior = await seniorDepartment();
  const dept = affiliationFor(
    accountRole,
    person.department ? { name: person.department.name, colorHex: person.department.colorHex } : null,
    senior ? { name: senior.name, colorHex: senior.colorHex } : null
  );
  const color = dept?.colorHex ?? BRAND.temptress;
  const title = roleTitle(accountRole, person.gender, dept?.name);
  const joined = user ? user.createdAt : (member!.orgJoinDate ?? member!.decidedAt ?? member!.joinDate);
  const avatar = avatarUrl(kind, person.id, person.avatarVersion);
  // خلفيةُ الصورة بلون انتمائه كما في الهيكل — والإدارة العليا ببنفسجيّها
  const portraitColor = portraitColorFor(accountRole, dept);
  const isSelf = user?.id === session.user.id;
  const statusOk = person.isActive;
  const commStatus = (s: string) =>
    s === "أُرسلت" ? "قُبلت عند المزوّد" : s;

  const identity: [string, string][] = [
    ["البريد", person.email],
    ["الجوال", person.phone ?? "—"],
    ["القسم", dept?.name ?? "—"],
    ["المسمّى الوظيفي", person.jobTitle ?? "—"],
    ["تاريخ الانضمام", formatDate(joined)],
    ["المدة", sinceLabel(joined, now)],
    ...(user ? ([["التحقق بخطوتين", user.totpEnabled ? "مُفعّل" : "غير مُفعّل"]] as [string, string][]) : []),
    ...(member
      ? ([
          ["أول دخول", member.firstLoginAt ? formatDate(member.firstLoginAt) : "لم يدخل بعد"],
          ["نتيجة الاختبار", member.testScore === null ? "—" : `${member.testScore}%`],
          ["التنبيهات", `${member.warningsCount} من ٣`],
        ] as [string, string][])
      : []),
  ];

  return (
    <div className="min-h-screen bg-page">

      <main className="mx-auto flex max-w-6xl flex-col gap-5 px-4 py-6 sm:px-5 sm:py-8">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <nav className="text-xs font-bold text-black/45" aria-label="المسار">
            {top ? (
              <Link href={backHref} className="hover:underline">الأفراد والحسابات</Link>
            ) : (
              <Link href={leadHome} className="hover:underline">قسمي</Link>
            )}
            {" ‹ "}
            <span aria-current="page" className="text-black/70">{person.fullName}</span>
          </nav>
          <Link href={top ? backHref : leadHome} className="wizard-btn-2 !min-h-9 !px-3 !text-xs">
            {top ? "→ عودة إلى القائمة" : "→ عودة إلى القسم"}
          </Link>
        </div>

        <Card className="flex flex-wrap items-center gap-4 p-5" style={{ borderTop: `5px solid ${color}` }}>
          <PersonAvatar src={avatar} name={person.fullName} color={portraitColor} className="h-20 w-20" textClassName="text-2xl" />
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold">{person.fullName}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-black/60">
              {dept && (
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full ring-1 ring-black/10" style={{ background: dept.colorHex }} />
                  {dept.name}
                </span>
              )}
              <span>· {title}</span>
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-bold ring-1 ${
                  statusOk ? "bg-green-50 text-green-800 ring-green-200" : "bg-black/[0.04] text-black/60 ring-black/10"
                }`}
              >
                {statusOk ? "نشط" : "غير نشط"}
              </span>
            </p>
          </div>
          {top && (
            <a href="#manage" className="wizard-btn-2">
              إدارة الحساب
            </a>
          )}
        </Card>

        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="p-4 sm:p-5">
            <h2 className="text-base font-bold">الهوية والحساب</h2>
            <dl className="mt-2">
              {identity.map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3 border-b border-hairline py-2 text-sm last:border-0">
                  <dt className="text-black/50">{k}</dt>
                  <dd className="break-all text-end font-bold">{v}</dd>
                </div>
              ))}
            </dl>
          </Card>

          <Card className="p-4 sm:p-5">
            <h2 className="text-base font-bold">العمل والإسهام</h2>
            <div className="mt-3 grid grid-cols-2 gap-2.5">
              {[
                [done, "مهمة مُنجزة (متحقَّق منها)"],
                [overdue, "مهمة متأخرة"],
                [openTasks, "مهمة قائمة"],
                [raised, `تذكرة رفعها${raisedResolved ? ` · ${raisedResolved} حُلّت` : ""}`],
                ...(closedFor !== null ? ([[closedFor, "تذكرة أغلقها"]] as [number, string][]) : []),
              ].map(([v, l]) => (
                <div key={l as string} className="rounded-xl bg-black/[0.03] p-3">
                  <p className={`text-xl font-bold ${l === "مهمة متأخرة" && (v as number) > 0 ? "text-red-800" : ""}`}>{v}</p>
                  <p className="text-xs text-black/50">{l}</p>
                </div>
              ))}
            </div>
            <p className="mt-3 text-[11px] text-black/45">من الالتزامات الأسبوعية والتذاكر المسجّلة — لا تقدير.</p>
          </Card>

          <Card className="p-4 sm:p-5">
            <h2 className="text-base font-bold">التواصل</h2>
            {comms.length === 0 ? (
              <p className="py-6 text-center text-sm text-black/40">لا رسائل مسجّلة بعد</p>
            ) : (
              <ul className="mt-2">
                {comms.map((c) => (
                  <li key={c.id} className="border-b border-hairline py-2 last:border-0">
                    <p className="text-sm font-bold">{c.kind}</p>
                    <p className="text-xs text-black/50">
                      {commStatus(c.status)} · {formatDate(c.createdAt)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-[11px] text-black/45">من «سجل الرسائل» — «قُبلت» لا تعني «فُتحت».</p>
          </Card>
        </div>

        {member && member.warnings.length > 0 && (
          <Card className="p-4 sm:p-5">
            <h2 className="text-base font-bold">التنبيهات الرسمية</h2>
            <ul className="mt-2">
              {member.warnings.map((w) => (
                <li key={w.id} className="flex gap-4 border-b border-hairline py-2 text-sm last:border-0">
                  <span className="w-24 shrink-0 text-xs text-black/45">{formatDate(w.createdAt)}</span>
                  <span>{w.reason}</span>
                  <span className="ms-auto shrink-0 text-xs text-black/45">
                    {w.acknowledgedAt ? "اطّلع عليه" : "لم يطّلع بعد"}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {/* إدارةُ الحساب — المكوّناتُ القائمة نفسها، وكلُّ زرٍّ يُنادي إجراءً
            يفرض صلاحيته في الخادم. لقائد القسم لا تُعرض: إدارةُ أعضائه في
            لوحة قسمه كما كانت. */}
        {top && (
          <section id="manage" className="scroll-mt-24">
            <h2 className="mb-3 text-base font-bold">إدارة الحساب</h2>
            <div className="flex flex-col gap-3">
              {user && isSelf && isFounder && (
                <MyAccountCard
                  theme={theme}
                  account={{
                    id: user.id,
                    fullName: user.fullName,
                    email: user.email,
                    roleLabel: title,
                    welcomeSentAt: user.welcomeEmailSentAt ? `في ${formatDate(user.welcomeEmailSentAt)}` : null,
                  }}
                />
              )}
              {user && !isSelf && user.role !== "super_admin" && (
                <AccountRow
                  theme={theme}
                  canRemove={isFounder}
                  canAward={canAward(role)}
                  account={{
                    id: user.id,
                    fullName: user.fullName,
                    email: user.email,
                    role: user.role,
                    departmentName: dept?.name ?? null,
                  }}
                />
              )}
              {member && (
                <>
                  <MemberAccountRow
                    theme={theme}
                    canPurge={isFounder}
                    canAward={canAward(role)}
                    assignableDepartments={departments}
                    member={{ id: member.id, fullName: member.fullName, email: member.email, departmentName: dept?.name ?? "—" }}
                  />
                  {isFounder && (
                    <Card className="p-4">
                      <FounderMemberControls
                        memberId={member.id}
                        memberName={member.fullName}
                        orgJoinDate={member.orgJoinDate ? member.orgJoinDate.toISOString().slice(0, 10) : ""}
                        welcomeSentAt={member.welcomeEmailSentAt ? `في ${formatDate(member.welcomeEmailSentAt)}` : null}
                        theme={theme}
                      />
                    </Card>
                  )}
                </>
              )}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
