import Link from "next/link";
import { hasCapability } from "@/lib/marketing/access";
import { PRIORITIES } from "@/lib/marketing/campaigns";
import { marketingPage } from "@/lib/marketing/page";
import { MkHeader } from "../../_components/MkHeader";
import { ActionForm } from "../../_components/ActionForm";
import { BriefFields } from "../../_components/BriefFields";

export const dynamic = "force-dynamic";

/** حملةٌ جديدة — للمنسّق. الاسمُ وحده يكفي للبدء؛ والموجزُ يُستكمل قبل التخطيط
 *  (والخادمُ يفرض ذلك عند الانتقال، لا هذا النموذج). */
export default async function NewCampaignPage() {
  const { actor, mk, isManager, work, notices } = await marketingPage("/marketing/campaigns/new");
  const allowed = hasCapability(actor, "coordinator");

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6 sm:px-5 sm:py-8">
      <MkHeader
        mk={mk}
        current={null}
        isManager={isManager}
        work={work}
        notices={notices}
        title={mk.campaigns.newTitle}
        description={mk.campaigns.newHint}
        back={<Link href="/marketing/campaigns" className="text-xs font-bold text-black/55 hover:underline">{mk.campaigns.title}</Link>}
      />
      {allowed ? (
        <div className="rounded-2xl border border-hairline bg-white p-4 sm:p-5">
          <ActionForm op="campaign.create" submit={mk.campaigns.create}>
            <BriefFields mk={mk} priorities={PRIORITIES} />
          </ActionForm>
        </div>
      ) : (
        <p className="rounded-2xl border border-hairline bg-white p-6 text-center text-sm text-black/55">{mk.campaigns.onlyCoordinator}</p>
      )}
    </main>
  );
}
