"use client";

import { useTransition } from "react";
import { deleteAnnouncementAction } from "./actions";
import { Card } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { useTranslations } from "@/i18n/LocaleProvider";

type Announcement = {
  id: string;
  title: string;
  body: string;
  audience: string;
  departmentName: string | null;
  authorId: string;
  authorName: string;
  createdAt: string;
  meetingUrl?: string | null;
  linkUrl?: string | null;
  linkLabel?: string | null;
};

/** الحذف يتبع نفس قاعدة الخادم: المؤسس يحذف أي إعلان، وغيره يحذف
 *  إعلانه وحده. وكان يُمرَّر علماً واحداً للقائمة كلها، فيظهر الزرّ على
 *  إعلانات غيره ثم يُرفض — وعدٌ كاذب يتكرّر مع كل ضغطة. */
export function AnnouncementList({
  announcements,
  viewerId,
  viewerIsFounder = false,
}: {
  announcements: Announcement[];
  /** معرّف القارئ — null للعضو: لا يحذف شيئاً أصلاً */
  viewerId: string | null;
  viewerIsFounder?: boolean;
}) {
  const t = useTranslations().hub;
  const [pending, startTransition] = useTransition();
  const audienceLabels: Record<string, string> = {
    everyone: t.audEveryone,
    leadership: t.audLeadership,
    department: t.audDept,
  };

  if (announcements.length === 0) {
    return (
      <Card className="p-6 text-center text-sm text-black/40">{t.announcementsEmpty}</Card>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {announcements.map((a) => (
        <Card key={a.id} className="p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h3 className="text-sm font-bold leading-relaxed sm:text-base">{a.title}</h3>
            <span className="shrink-0 rounded-full bg-black/5 px-2.5 py-0.5 text-[11px] font-semibold text-black/50">
              {a.audience === "department" && a.departmentName
                ? a.departmentName
                : audienceLabels[a.audience]}
            </span>
          </div>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-black/70">{a.body}</p>

          {/* الرابط زرٌّ لا سطرٌ يُنسخ: من يقرأ إعلان اجتماع يريد الدخول
              إليه، ومن يقرأ طلب تفاعل يريد فتح المنشور */}
          {(a.meetingUrl || a.linkUrl) && (
            <div className="mt-3 flex flex-wrap gap-2">
              {a.meetingUrl && (
                <a
                  href={a.meetingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-11 items-center rounded-xl bg-[#341D2B] px-4 text-sm font-semibold text-[#EEF6DF]"
                >
                  {t.joinMeeting}
                </a>
              )}
              {a.linkUrl && (
                <a
                  href={a.linkUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-11 items-center rounded-xl border border-black/10 px-4 text-sm font-semibold text-black/70 hover:bg-black/[0.03]"
                >
                  {a.linkLabel?.trim() || t.openLink}
                </a>
              )}
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-black/40">
            <span>{a.authorName}</span>
            <span aria-hidden>•</span>
            <span>{formatDate(new Date(a.createdAt))}</span>
            {(viewerIsFounder || (viewerId !== null && a.authorId === viewerId)) && (
              <button
                type="button"
                disabled={pending}
                onClick={() => startTransition(() => void deleteAnnouncementAction(a.id))}
                className="ms-auto font-semibold text-red-600 disabled:opacity-50"
              >
                {t.delete}
              </button>
            )}
          </div>
        </Card>
      ))}
    </div>
  );
}
