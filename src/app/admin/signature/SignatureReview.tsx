"use client";

import { useState, useTransition } from "react";
import { decideSignatureAction, requestSignatureAction } from "./actions";
import { Button, Card } from "@/components/ui";
import type { themeFromColor } from "@/lib/brand";

type Pending = {
  id: string;
  imageData: string | null;
  ownerName: string;
  roleLabel: string;
  departmentName: string | null;
  isSelf: boolean;
};

type Missing = { id: string; fullName: string; roleLabel: string; departmentName: string | null };

/** مراجعة التوقيعات المرفوعة، وطلبُها من من لم يُعتمد له توقيع. */
export function SignatureReview({
  pending,
  missing,
  theme,
}: {
  pending: Pending[];
  missing: Missing[];
  theme: ReturnType<typeof themeFromColor>;
}) {
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, start] = useTransition();

  function decide(id: string, decision: "approve" | "reject") {
    setMsg(null);
    start(async () => {
      const res = await decideSignatureAction(id, decision, notes[id]);
      setMsg(
        res.error
          ? { kind: "err", text: res.error }
          : { kind: "ok", text: decision === "approve" ? "اعتُمد التوقيع" : "رُفض التوقيع" }
      );
    });
  }

  function ask(userId: string) {
    setMsg(null);
    start(async () => {
      const res = await requestSignatureAction(userId);
      setMsg(
        res.error ? { kind: "err", text: res.error } : { kind: "ok", text: "أُرسل طلب التوقيع" }
      );
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {msg && (
        <p
          className={`rounded-lg px-3 py-2 text-xs ${
            msg.kind === "ok" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
          }`}
        >
          {msg.text}
        </p>
      )}

      <section>
        <h2 className="mb-1 text-base font-bold">توقيعات تنتظر القرار ({pending.length})</h2>
        <p className="mb-3 text-xs text-black/40">
          لا يُرسَم توقيعٌ على شهادةٍ قبل اعتماده. والرفض يحتاج سبباً مكتوباً يُقرأ لصاحبه.
        </p>
        {pending.length === 0 ? (
          <Card className="p-6 text-center text-sm text-black/40">لا توقيعات معلّقة</Card>
        ) : (
          <div className="flex flex-col gap-3">
            {pending.map((p) => (
              <Card key={p.id} className="p-4">
                <p className="text-sm font-bold">
                  {p.ownerName}{" "}
                  <span className="font-normal text-black/45">
                    — {p.roleLabel}
                    {p.departmentName ? ` · ${p.departmentName}` : ""}
                  </span>
                </p>
                {p.imageData && (
                  <div className="mt-3 rounded-xl border border-black/10 bg-white p-3">
                    {/* صورةٌ بـdata URL من القاعدة — `next/image` لا يلزمها */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={p.imageData}
                      alt={`توقيع ${p.ownerName}`}
                      style={{ maxHeight: 110, maxWidth: "100%", objectFit: "contain" }}
                    />
                  </div>
                )}
                <input
                  type="text"
                  value={notes[p.id] ?? ""}
                  onChange={(e) => setNotes((n) => ({ ...n, [p.id]: e.target.value }))}
                  placeholder="سبب الرفض (مطلوب عند الرفض)"
                  className="mt-3 min-h-9 w-full rounded-lg border border-black/10 px-2.5 py-1.5 text-xs"
                />
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button theme={theme} disabled={busy} onClick={() => decide(p.id, "approve")}>
                    اعتماد
                  </Button>
                  <Button
                    theme={theme}
                    variant="outline"
                    disabled={busy}
                    onClick={() => decide(p.id, "reject")}
                  >
                    رفض
                  </Button>
                </div>
                {p.isSelf && (
                  <p className="mt-2 text-xs text-black/40">
                    هذا توقيعك. ولا مراجع أعلى من المؤسس، فاعتمادُك له يُسجَّل باسمك.
                  </p>
                )}
              </Card>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-1 text-base font-bold">قادة بلا توقيع معتمَد ({missing.length})</h2>
        <p className="mb-3 text-xs text-black/40">
          الشهادات التي يُوقّعونها تصدر بسطرٍ فارغ واسمٍ مطبوع. ولا يُستعار توقيع قائدٍ سابق
          مكانه — فالشهادة تحمل توقيع من عمل صاحبُها تحته فعلاً أو لا توقيع.
        </p>
        {missing.length === 0 ? (
          <Card className="p-6 text-center text-sm text-black/40">كل القادة لهم توقيع معتمَد</Card>
        ) : (
          <div className="flex flex-col gap-2">
            {missing.map((m) => (
              <Card key={m.id} className="flex flex-wrap items-center justify-between gap-3 p-3.5">
                <span className="text-sm">
                  {m.fullName}{" "}
                  <span className="text-black/45">
                    — {m.roleLabel}
                    {m.departmentName ? ` · ${m.departmentName}` : ""}
                  </span>
                </span>
                <Button theme={theme} variant="outline" disabled={busy} onClick={() => ask(m.id)}>
                  اطلب توقيعه
                </Button>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
