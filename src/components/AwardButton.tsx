"use client";

import { useState, useTransition } from "react";
import { sendAwardAction } from "@/app/admin/people/actions";
import { Button } from "@/components/ui";
import type { themeFromColor } from "@/lib/brand";

/** زرّ التكريم — إنجازٌ وجائزةٌ وكلمة.
 *
 *  والإنجاز إلزامي: تكريمٌ بلا سببٍ مكتوب يصل رسالةً عامّة لا تكريماً،
 *  والخادم يرفضه أيضاً. والجائزة والكلمة اختياريتان — قد يكون التكريم
 *  كلمةً وحدها.
 */
export function AwardButton({
  target,
  personName,
  theme,
}: {
  target: { kind: "member" | "user"; id: string };
  personName: string;
  theme: ReturnType<typeof themeFromColor>;
}) {
  const [open, setOpen] = useState(false);
  const [achievement, setAchievement] = useState("");
  const [award, setAward] = useState("");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  if (msg?.kind === "ok") {
    return (
      <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">
        {msg.text}
      </p>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-11 items-center rounded-xl bg-[var(--accent-soft)] px-4 text-sm font-semibold text-[var(--accent-soft-ink)] ring-1 ring-[var(--accent-soft-line)]"
      >
        كرِّمه على إنجاز
      </button>
    );
  }

  return (
    <div className="mt-3 flex flex-col gap-3 rounded-2xl bg-[var(--accent-soft)] p-4 ring-1 ring-[var(--accent-soft-line)]">
      <p className="text-xs font-bold text-[var(--accent-soft-ink)]">تكريم {personName}</p>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-black/70">الإنجاز (يصل كما تكتبه)</span>
        <input
          value={achievement}
          onChange={(e) => setAchievement(e.target.value)}
          placeholder="أنجز حملة الإطلاق قبل موعدها بأسبوع"
          className="min-h-11 rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-black/30"
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-black/70">الجائزة المرافقة (اختياري)</span>
        <input
          value={award}
          onChange={(e) => setAward(e.target.value)}
          placeholder="بطاقة شكر + مكافأة"
          className="min-h-11 rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-black/30"
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-black/70">كلمتك (اختياري)</span>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          className="rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-black/30"
        />
      </label>
      {msg?.kind === "err" && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{msg.text}</p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          theme={theme}
          disabled={pending || achievement.trim().length < 5}
          onClick={() => {
            setMsg(null);
            startTransition(async () => {
              const res = await sendAwardAction(target.kind, target.id, achievement, award, note);
              if (res.error) {
                setMsg({ kind: "err", text: res.error });
                return;
              }
              setMsg({ kind: "ok", text: `وصل التكريم إلى ${res.to}` });
              setOpen(false);
            });
          }}
        >
          {pending ? "يُرسَل..." : "أرسل التكريم"}
        </Button>
        <Button theme={theme} variant="ghost" onClick={() => setOpen(false)}>
          إلغاء
        </Button>
      </div>
    </div>
  );
}
