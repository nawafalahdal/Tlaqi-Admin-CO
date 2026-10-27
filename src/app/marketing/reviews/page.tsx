import Link from "next/link";
import { actionItems } from "@/lib/marketing/inbox";
import { marketingPage } from "@/lib/marketing/page";
import { MkHeader } from "../_components/MkHeader";
import { Pill, Section, deliverableTone, when } from "../_components/bits";

export const dynamic = "force-dynamic";

const REVIEW_KINDS = ["approve_content", "approve_design", "quality"];

/** ما ينتظر قرارك — من «ما ينتظرني» نفسه، مقصوراً على القرارات.
 *  ومن كتب نسخةً لا تُعرض عليه لاعتمادها ما دامت سياسةُ الفصل قائمة (`actionItems`). */
export default async function ReviewsPage() {
  const { actor, mk, isManager, canArchive, work, notices } = await marketingPage("/marketing/reviews");
  const { items } = await actionItems(actor);
  const reviews = items.filter((i) => REVIEW_KINDS.includes(i.kind));

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-6 sm:px-5 sm:py-8">
      <MkHeader mk={mk} current="reviews" isManager={isManager} canArchive={canArchive} work={work} notices={notices} title={mk.reviews.title} description={mk.reviews.hint} />
      <Section title={mk.reviews.title}>
        {reviews.length === 0 ? (
          <p className="text-sm text-black/50">{mk.reviews.empty}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-black/[0.06]">
            {reviews.map((d) => (
              <li key={d.id}>
                <Link
                  href={`/marketing/campaigns/${d.campaignId}/deliverables/${d.id}#${d.kind === "quality" ? "quality" : d.kind === "approve_design" ? "design" : "content"}`}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3 hover:bg-black/[0.02]"
                >
                  <span className="text-sm font-bold">{mk.inboxKind[d.kind as keyof typeof mk.inboxKind]}</span>
                  <span className="text-sm text-black/75">{d.title}</span>
                  <span className="text-xs text-black/50">{d.campaign.name}</span>
                  <Pill tone={deliverableTone(d.status)}>{mk.deliverableStatus[d.status]}</Pill>
                  <span className="text-[11px] text-black/45">{when(d.updatedAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </main>
  );
}
