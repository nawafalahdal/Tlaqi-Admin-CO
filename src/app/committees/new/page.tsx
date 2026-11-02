import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { PageHeader } from "@/components/PageHeader";
import { Card } from "@/components/ui";
import { themeFromColor } from "@/lib/brand";
import { orgActor } from "@/lib/org/actor";
import { departmentsForCreation, departmentPeople } from "@/lib/org/queries";
import { getLocale, getDictionary } from "@/i18n/server";
import { createCommitteeAction } from "../actions";
import { ActionForm, PeoplePicker } from "../_components/ActionForm";
import { CommitteeFields } from "../_components/CommitteeFields";
import { Field, inputCls } from "../_components/bits";

export const dynamic = "force-dynamic";

/** إنشاءُ لجنة — في قسمٍ يملك صاحبُ الطلب إدارةَ لجانه وحده.
 *  من لا قسمَ له يُنشئ فيه يُعاد إلى القائمة: الصفحةُ لا تعرض نموذجاً سيُرفض. */
export default async function NewCommitteePage({ searchParams }: { searchParams: Promise<{ dept?: string }> }) {
  const session = await auth();
  if (!session) redirect("/login");
  const actor = await orgActor(session);
  const depts = await departmentsForCreation(actor);
  if (!depts.length) redirect("/committees");
  const { dept } = await searchParams;
  const current = depts.find((d) => d.id === dept) ?? depts[0];
  const people = await departmentPeople(current.id);
  const L = getDictionary(await getLocale()).org;
  const F = L.form;
  const theme = themeFromColor(current.colorHex);

  return (
    <div className="min-h-screen bg-page">
      <main className="mx-auto flex max-w-3xl flex-col gap-5 px-4 py-6 sm:px-5 sm:py-8">
        <PageHeader
          title={F.newTitle}
          description={F.newDesc}
          back={
            <Link href="/committees" className="mb-2 inline-flex text-xs font-bold text-black/55 hover:underline">
              ← {L.backToList}
            </Link>
          }
        />

        {depts.length > 1 && (
          <nav aria-label={F.department} className="flex flex-wrap gap-2">
            {depts.map((d) => (
              <Link
                key={d.id}
                href={`/committees/new?dept=${d.id}`}
                aria-current={d.id === current.id ? "page" : undefined}
                className={`inline-flex min-h-10 items-center gap-2 rounded-xl border px-3 text-sm font-semibold ${
                  d.id === current.id ? "border-black/30 bg-black/[0.05]" : "border-black/10 hover:bg-black/[0.03]"
                }`}
              >
                <span className="h-3 w-3 rounded-sm" style={{ background: d.colorHex }} aria-hidden />
                {d.name}
              </Link>
            ))}
          </nav>
        )}

        <Card className="p-5 sm:p-6">
          <ActionForm
            action={createCommitteeAction}
            theme={theme}
            pendingLabel={F.saving}
            submits={[
              { label: F.saveSubmit, name: "intent", value: "submit" },
              { label: F.saveDraft, name: "intent", value: "draft", variant: "outline" },
            ]}
            className="flex flex-col gap-5"
          >
            <input type="hidden" name="departmentId" value={current.id} />
            <p className="text-sm">
              {F.department}: <strong>{current.name}</strong>
            </p>
            <CommitteeFields L={L} />
            <Field label={F.lead} required>
              <select name="leadMemberId" required defaultValue="" className={inputCls}>
                <option value="" disabled>
                  {F.leadChoose}
                </option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.fullName}
                    {p.jobTitle ? ` — ${p.jobTitle}` : ""}
                  </option>
                ))}
              </select>
            </Field>
            <div className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium text-black/70">
                {F.members}
                <span className="text-red-600" aria-hidden> *</span>
              </span>
              <span className="text-xs text-black/45">{F.membersHint}</span>
              <PeoplePicker name="memberIds" people={people} searchLabel={F.searchPeople} emptyLabel={F.noPeople} />
            </div>
          </ActionForm>
        </Card>
      </main>
    </div>
  );
}
