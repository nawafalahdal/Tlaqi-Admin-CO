import { PageSkeleton } from "@/components/PageStates";
import { getLocale, getDictionary } from "@/i18n/server";

export default async function Loading() {
  const t = getDictionary(await getLocale());
  return <PageSkeleton label={t.shell.loading} />;
}
