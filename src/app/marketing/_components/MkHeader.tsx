import type { ReactNode } from "react";
import type { Dictionary } from "@/i18n";
import { PageHeader } from "@/components/PageHeader";
import { Tabs } from "./bits";
import { MkNotices } from "./MkNotices";
import type { MkNotice } from "@/lib/marketing/postArchive";

/** رأسُ صفحات الوكيل: العنوانُ ثم أقسامُه. وصفحاتُ العمل (المحتوى، التصميم، الاعتماد والنشر) لمن يعمل في
 *  الحملات، و«الإعدادات» لمدير الفريق، و«الأرشيف» لقائد التسويق ومعتمدي الخطط — والصفحاتُ تردّ غيرَهم في
 *  الخادم على كل حال. */
export function MkHeader({
  mk,
  current,
  isManager,
  canArchive = false,
  work = null,
  notices = [],
  title,
  description,
  actions,
  back,
}: {
  mk: Dictionary["mk"];
  current: "dashboard" | "campaigns" | "content" | "design" | "publishing" | "reviews" | "settings" | "archive" | null;
  isManager: boolean;
  canArchive?: boolean;
  /** صفحاتُ العمل الثلاث لمن يعمل في الحملات — وأعدادُها إن عُرفت */
  work?: { content: number; design: number; publishing: number } | null;
  /** إشعاراتٌ لم تُعرض بعد — تظهر مرّةً واحدة */
  notices?: MkNotice[];
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  back?: ReactNode;
}) {
  const items = [
    { key: "dashboard", label: mk.tabs.dashboard, href: "/marketing" },
    { key: "campaigns", label: mk.tabs.campaigns, href: "/marketing/campaigns" },
    ...(work
      ? [
          { key: "content", label: mk.tabs.content, href: "/marketing/content", count: work.content },
          { key: "design", label: mk.tabs.design, href: "/marketing/design", count: work.design },
          { key: "publishing", label: mk.tabs.publishing, href: "/marketing/publishing", count: work.publishing },
        ]
      : []),
    { key: "reviews", label: mk.tabs.reviews, href: "/marketing/reviews" },
    ...(canArchive ? [{ key: "archive", label: mk.tabs.archive, href: "/marketing/archive" }] : []),
    ...(isManager ? [{ key: "settings", label: mk.tabs.settings, href: "/marketing/settings" }] : []),
  ];
  return (
    <div className="flex flex-col gap-4">
      {notices.length > 0 && <MkNotices notices={notices.map((n) => ({ id: n.id, kind: n.kind, params: n.params }))} />}
      <PageHeader title={title} description={description} actions={actions} back={back} />
      {current && <Tabs items={items} current={current} label={mk.title} />}
    </div>
  );
}
