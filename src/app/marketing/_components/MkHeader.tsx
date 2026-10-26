import type { ReactNode } from "react";
import type { Dictionary } from "@/i18n";
import { PageHeader } from "@/components/PageHeader";
import { Tabs } from "./bits";

/** رأسُ صفحات الوكيل: العنوانُ ثم أقسامُه. و«الإعدادات» لا تُعرض إلا لمدير الفريق —
 *  وهي تردّ غيرَه في الخادم على كل حال. */
export function MkHeader({
  mk,
  current,
  isManager,
  title,
  description,
  actions,
  back,
}: {
  mk: Dictionary["mk"];
  current: "dashboard" | "campaigns" | "reviews" | "settings" | null;
  isManager: boolean;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  back?: ReactNode;
}) {
  const items = [
    { key: "dashboard", label: mk.tabs.dashboard, href: "/marketing" },
    { key: "campaigns", label: mk.tabs.campaigns, href: "/marketing/campaigns" },
    { key: "reviews", label: mk.tabs.reviews, href: "/marketing/reviews" },
    ...(isManager ? [{ key: "settings", label: mk.tabs.settings, href: "/marketing/settings" }] : []),
  ];
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={title} description={description} actions={actions} back={back} />
      {current && <Tabs items={items} current={current} label={mk.title} />}
    </div>
  );
}
