import { redirect } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { auth } from "@/auth";
import { themeFromColor, SUPER_ADMIN_THEME } from "@/lib/brand";
import { AppHeader } from "@/components/ui";
import { HeaderActions } from "@/components/HeaderActions";
import { accountRoleLabel } from "@/lib/testTracks";
import { requestsAwaiting } from "@/lib/termination";
import { formatDate } from "@/lib/format";
import { TerminationDecision } from "./TerminationDecision";

export const dynamic = "force-dynamic";

/** طلبات إنهاء فترة الإدارة — كلٌّ يرى ما يخصّه.
 *
 *  قائد القسم يرى طلبات قسمه، والتنفيذي والمؤسس يريان الكلّ. والحصر في
 *  `requestsAwaiting` لا في الصفحة: الصفحة تعرض ما أعطيَت. */
export default async function TerminationsPage() {
  const session = await auth();
  if (!session) redirect("/login");

  const allowed = ["super_admin", "executive", "department_admin"];
  if (!allowed.includes(session.user.role)) redirect("/admin");

  const theme = themeFromColor(SUPER_ADMIN_THEME.colorHex);
  const requests = await requestsAwaiting(session);

  return (
    <div className="min-h-screen bg-page">
      <AppHeader
        theme={theme}
        roleName={accountRoleLabel(session.user.role)}
        userName={session.user.name ?? ""}
      >
        <HeaderActions color={theme.text} />
      </AppHeader>

      <main className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-6 sm:px-5">
        <PageHeader title="طلبات إنهاء فترة الإدارة" description={<>يرفعها أصحابها. ولم يتوقّف عمل أحدهم بالرفع — يبقى على تكليفه حتى تقرّر وتحلّ
            المهلة. وعند الموافقة يُنفَّذ الخروج في تاريخه، وتصدر شهادة الشكر عند الختام.</>} />

        <TerminationDecision
          theme={theme}
          requests={requests.map((r) => ({
            id: r.id,
            status: r.status,
            memberName: r.member.fullName,
            memberEmail: r.member.email,
            assignmentLabel: r.assignmentLabel,
            reason: r.reason,
            submittedAt: formatDate(r.submittedAt),
            requestedEndDate: r.requestedEndDate ? formatDate(r.requestedEndDate) : null,
            requestedEndIso: r.requestedEndDate
              ? r.requestedEndDate.toISOString().slice(0, 10)
              : "",
            meetingNote: r.meetingNote,
          }))}
        />
      </main>
    </div>
  );
}
