import { marketingPage } from "@/lib/marketing/page";
import { workQueue } from "@/lib/marketing/workQueue";
import { MkHeader } from "../_components/MkHeader";
import { WorkQueueView } from "../_components/WorkQueueView";
import { Muted } from "../_components/bits";

export const dynamic = "force-dynamic";

/** صفحةُ عملٍ لمرحلة «الاعتماد والنشر» — منشوراتُ الحملات التي يعمل فيها صاحبُ الطلب، قيد العمل وحده (ما أُرشف
 *  لا يظهر)، بصفحاتٍ من عشرين. لا تقرأ ملفَّ Google Sheets، ولا تكتب شيئاً. */
export default async function WorkPage({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  const { actor, mk, isManager, canArchive, work, notices } = await marketingPage("/marketing/publishing");
  const { p } = await searchParams;
  const queue = work ? await workQueue(actor, "publishing", { page: Number.parseInt(p ?? "1", 10) || 1 }) : null;
  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-6 sm:px-5 sm:py-8">
      <MkHeader mk={mk} current="publishing" isManager={isManager} canArchive={canArchive} work={work} notices={notices} title={mk.work.titles.publishing} description={mk.work.hints.publishing} />
      {queue ? <WorkQueueView mk={mk} stage="publishing" {...queue} /> : <Muted>{mk.work.noAccess}</Muted>}
    </main>
  );
}
