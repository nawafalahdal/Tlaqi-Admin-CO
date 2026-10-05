import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { themeFromColor, BRAND } from "@/lib/brand";
import { AppHeader, Card } from "@/components/ui";
import { HeaderActions } from "@/components/HeaderActions";
import { LogoLockup } from "@/components/Logo";
import { WarningCard } from "./WarningCard";
import { MyTicketCard } from "./MyTicketCard";
import { RaiseTicketForm } from "./RaiseTicketForm";
import { sweepTicketEscalation } from "@/lib/tickets";

export default async function MemberPortalPage() {
  const session = await auth();
  if (!session) redirect("/login");
  if (session.user.role !== "member") redirect("/admin");

  const member = await prisma.member.findUniqueOrThrow({
    where: { id: session.user.id },
    include: { department: true, warnings: { orderBy: { createdAt: "desc" } } },
  });

  const theme = themeFromColor(member.department?.colorHex ?? BRAND.temptress);

  await sweepTicketEscalation();

  if (!member.isActive) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-4" style={{ background: BRAND.temptress }}>
        <LogoLockup size={24} color={BRAND.beige} dotColor={BRAND.mahogany} />
        <div className="w-full max-w-md rounded-3xl bg-white p-8 text-center shadow-xl">
          <h1 className="mb-2 text-lg font-bold text-red-700">تم إنهاء العضوية</h1>
          <p className="text-sm text-black/60">
            نظراً لتجاوز عدد التنبيهات المسموح (3/3)، تم إنهاء عضويتك في منصة تَـــلاقِ. للاستفسار يرجى التواصل مع
            قسمك مباشرة.
          </p>
        </div>
      </main>
    );
  }

  const unacknowledged = member.warnings.filter((w) => !w.acknowledgedAt).length;

  const [departments, tickets] = await Promise.all([
    prisma.department.findMany({ orderBy: { name: "asc" } }),
    prisma.ticket.findMany({ where: { memberId: member.id }, orderBy: { createdAt: "desc" } }),
  ]);

  return (
    <div className="min-h-screen bg-[#FAF8F4]">
      <AppHeader theme={theme} roleName={member.department?.name ?? "عضو"} userName={member.fullName}>
        <HeaderActions color={theme.text} />
      </AppHeader>

      <main className="mx-auto max-w-2xl px-5 py-8 flex flex-col gap-8">
        <section>
          <Card className="p-6">
            <p className="text-xs text-black/40">عضو في</p>
            <p className="text-lg font-bold">{member.department?.name ?? "—"}</p>
            {member.jobTitle && <p className="text-sm text-black/50">{member.jobTitle}</p>}
          </Card>
        </section>

        <section>
          <h2 className="mb-4 text-lg font-bold">
            التنبيهات {unacknowledged > 0 && <span className="text-sm font-normal text-black/40">({unacknowledged} بانتظار الاطلاع)</span>}
          </h2>
          {member.warnings.length === 0 ? (
            <Card className="p-8 text-center text-sm text-black/40">لا توجد أي تنبيهات — استمر بهذا الأداء</Card>
          ) : (
            <div className="flex flex-col gap-3">
              {member.warnings.map((w) => (
                <WarningCard
                  key={w.id}
                  theme={theme}
                  warning={{
                    id: w.id,
                    reason: w.reason,
                    createdAt: w.createdAt.toISOString(),
                    acknowledgedAt: w.acknowledgedAt ? w.acknowledgedAt.toISOString() : null,
                  }}
                />
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 className="mb-4 text-lg font-bold">رفع تذكرة جديدة</h2>
          <p className="mb-4 -mt-3 text-xs text-black/40">
            مثال: لم يصلك البانر الترحيبي، أو أي مشكلة تحتاج متابعة من قسم معيّن
          </p>
          <Card className="p-6">
            <RaiseTicketForm departments={departments} theme={theme} />
          </Card>
        </section>

        <section>
          <h2 className="mb-4 text-lg font-bold">تذاكري {tickets.length > 0 && `(${tickets.length})`}</h2>
          {tickets.length === 0 ? (
            <Card className="p-8 text-center text-sm text-black/40">لا توجد تذاكر مرفوعة بعد</Card>
          ) : (
            <div className="flex flex-col gap-3">
              {tickets.map((t) => (
                <MyTicketCard
                  key={t.id}
                  theme={theme}
                  ticket={{
                    id: t.id,
                    ticketNumber: t.ticketNumber,
                    subject: t.subject,
                    description: t.description,
                    status: t.status,
                    stage: t.stage,
                    stageDueAt: t.stageDueAt.toISOString(),
                    resolutionNote: t.resolutionNote,
                  }}
                />
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
