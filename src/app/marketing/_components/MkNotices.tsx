"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "@/i18n/LocaleProvider";
import { fmt } from "@/i18n/fmt";
import { markMarketingNoticesSeen } from "../actions";

type Notice = { id: string; kind: string; params: { campaign?: string; seq?: number; title?: string; url?: string } };

/** إشعاراتُ الفريق — «تم نشر المنشور الأول في الحملة» — تظهر مرّةً واحدة: تُعلَّم مقروءةً من المتصفح
 *  لحظةَ ظهورها (لا في رسم الصفحة)، فلا تعود في الصفحة التالية ولا عند التحديث. */
export function MkNotices({ notices }: { notices: Notice[] }) {
  const t = useTranslations();
  const L = t.mk.notices;
  const [open, setOpen] = useState(notices);
  useEffect(() => {
    markMarketingNoticesSeen(notices.map((n) => n.id)).catch(() => undefined);
    // يُعلَّم ما وصل مع الصفحة مرّةً واحدة
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (open.length === 0) return null;
  const postName = (seq?: number) => (seq && seq >= 1 && seq <= L.ordinals.length ? L.ordinals[seq - 1] : fmt(L.postNumber, seq ?? "—"));
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-2" data-mk-notices>
      {open.map((n) => (
        <div key={n.id} className="flex items-start gap-3 rounded-xl border border-[#c34900]/30 bg-[#EEF6DF] px-4 py-3 text-sm text-[#1a0e1c]">
          <span aria-hidden className="mt-0.5 text-[#c34900]">●</span>
          <p className="flex-1 leading-relaxed">
            {n.kind === "post_archived" ? fmt(L.post_archived, postName(n.params.seq), n.params.campaign ?? "—") : n.kind}
            {n.params.url && (
              <>
                {" "}
                <a href={n.params.url} target="_blank" rel="noopener noreferrer" className="font-bold underline-offset-2 hover:underline">{L.viewPost}</a>
              </>
            )}
          </p>
          <button type="button" onClick={() => setOpen((xs) => xs.filter((x) => x.id !== n.id))} className="text-xs font-bold text-black/50 hover:text-black/80">
            {L.dismiss}
          </button>
        </div>
      ))}
    </div>
  );
}
