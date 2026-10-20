"use client";

import { useState, useTransition } from "react";
import { correctOrgJoinDateAction } from "@/app/admin/actions";
import { Button } from "@/components/ui";
import type { themeFromColor } from "@/lib/brand";

/** تصرّفان للمؤسس على عضوٍ بعينه: تصحيح تاريخ انضمامه، وإرسال بطاقته.
 *
 *  وكلاهما يُظهر نتيجته لا يكتفي بـ«تمّ»: إرسالٌ قيل عنه «تمّ» ولم يصل
 *  يُغلق باب الإعادة على من يظنّها وصلت. فيُسمّى المستلم عند النجاح،
 *  ويُسمّى السبب عند الفشل.
 *
 *  والزرّان يُعطَّلان أثناء التنفيذ: الضغطة الثانية على زرٍّ بطيء كانت
 *  تُرسل رسالتين. والخادم يحرس أيضاً — هذا يمنع الخطأ لا الخبث. */
export function FounderMemberControls({
  memberId,
  memberName,
  orgJoinDate,
  welcomeSentAt,
  theme,
}: {
  memberId: string;
  memberName: string;
  /** `yyyy-mm-dd` أو فراغ لمن لا تاريخ مُسجَّل له */
  orgJoinDate: string;
  /** متى وصلت بطاقته — جملةٌ جاهزة («في 12/10/2026» أو «سابقاً»)، و
   *  `null` لمن لم تصله. فإن وصلت انتهت صلاحية الإرسال ولا زرّ.
   *
   *  وبقاءُ زرٍّ سيُرفض وعدٌ كاذب: البطاقة مرّةٌ واحدة، والخادم يرفض
   *  الثانية بشرطٍ في `where`. فتُقال القاعدة في الشاشة أيضاً.
   *
   *  وجملةٌ لا تاريخٌ لأن بعض من وصلته لم يُكتب حقلُه — وصولُه ثابتٌ في
   *  سجلّ الرسائل بلا تاريخٍ في سجلّه. ووضعُ تاريخ اليوم مكانه كذب. */
  welcomeSentAt: string | null;
  theme: ReturnType<typeof themeFromColor>;
}) {
  const [date, setDate] = useState(orgJoinDate);
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [pendingDate, startDate] = useTransition();

  function saveDate() {
    setMsg(null);
    startDate(async () => {
      const res = await correctOrgJoinDateAction(memberId, date || null, note || undefined);
      setMsg(
        res.error
          ? { kind: "err", text: res.error }
          : { kind: "ok", text: date ? `سُجِّل تاريخ الانضمام: ${date}` : "أُفرِغ تاريخ الانضمام" }
      );
      if (!res.error) setNote("");
    });
  }


  return (
    <div className="mt-3 border-t border-black/5 pt-3">
      <p className="text-xs font-bold text-black/60">إجراءات المؤسس — {memberName}</p>

      <div className="mt-2 flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-black/55">تاريخ الانضمام لتَـــلاقِ</span>
          <input
            type="date"
            value={date}
            max={new Date().toISOString().slice(0, 10)}
            onChange={(e) => setDate(e.target.value)}
            className="min-h-9 rounded-lg border border-black/10 px-2.5 py-1.5 text-xs"
          />
        </label>
        <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs">
          <span className="text-black/55">سبب التصحيح (اختياري)</span>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="انضمّ قبل وجود المنصة"
            className="min-h-9 rounded-lg border border-black/10 px-2.5 py-1.5 text-xs"
          />
        </label>
        <Button theme={theme} variant="outline" disabled={pendingDate} onClick={saveDate}>
          {pendingDate ? "يُحفَظ..." : "حفظ التاريخ"}
        </Button>
      </div>

      <p className="mt-2 text-xs leading-relaxed text-black/40">
        هذا تاريخ انضمامه للمنظمة، لا تاريخ إنشاء حسابه ولا بداية تكليفه الإداري. وتغييره لا
        يُقدّم استحقاق شهادة الثلاثة أشهر ولا يُؤخّره — فهي تُقاس ببداية التكليف.
      </p>

      <div className="mt-3">
        {welcomeSentAt && (
          <p className="mb-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs leading-relaxed text-emerald-800">
            ✓ آخر بطاقة انضمام قُبلت عند مزوّد البريد {welcomeSentAt}.
          </p>
        )}
        <p className="text-xs leading-relaxed text-black/45">
          إعادةُ بطاقة الانضمام بيد مسؤول المتابعة والتشغيل وحده، من صفحة «بطاقات الانضمام» —
          ولكل شخصٍ إعادةٌ واحدة بعد بطاقة الاعتماد.
        </p>
      </div>

      {msg && (
        <p
          className={`mt-3 rounded-lg px-3 py-2 text-xs ${
            msg.kind === "ok" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
          }`}
        >
          {msg.text}
        </p>
      )}
    </div>
  );
}
