"use client";

import { useState, useTransition } from "react";
import { requestApprovalAction } from "./actions";
import { Card, Button } from "@/components/ui";

/** تعليق طلبِ اعتمادٍ على تذكرةٍ قائمة.
 *
 *  **والاعتماد اختياري لا لازم:** هذا النموذج لا يظهر في رفع التذكرة،
 *  بل على تذاكره القائمة — فالتذكرة العادية تُرفَع كما كانت، ومن أراد
 *  اعتماداً عليها طلبه. ولو جُعل حقلاً في كل رفعٍ لصار سؤالاً يُجاب
 *  عنه في كل مرّة بلا داعٍ.
 *
 *  والمسار المتسلسل اختياريٌّ أيضاً: معتمِدٌ واحد افتراضاً، ويُضاف من
 *  بعده عند الحاجة.
 */
const KINDS = [
  { value: "marketing_plan", label: "خطة تسويقية" },
  { value: "financial_plan", label: "خطة مالية" },
  { value: "initiative", label: "مبادرة أو مشروع" },
  { value: "resources", label: "تخصيص موارد أو ميزانية" },
  { value: "operational", label: "مقترح تشغيلي" },
  { value: "other", label: "طلب آخر" },
];

export function RequestApproval({
  tickets,
  approvers,
  theme,
}: {
  tickets: { id: string; ticketNumber: number; subject: string }[];
  approvers: { id: string; label: string }[];
  theme: Parameters<typeof Button>[0]["theme"];
}) {
  const [open, setOpen] = useState(false);
  const [ticketId, setTicketId] = useState("");
  const [kind, setKind] = useState("");
  const [approver, setApprover] = useState("");
  const [second, setSecond] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (tickets.length === 0) {
    return (
      <Card className="p-4 text-xs leading-relaxed text-black/50">
        لا تذاكر مفتوحة لك بلا طلبِ اعتماد. ارفع تذكرةً أولاً من صفحة التذاكر، ثم علّق عليها
        طلبَ اعتمادٍ من هنا إن احتاجت موافقة.
      </Card>
    );
  }

  return (
    <Card className="p-4 sm:p-5">
      <h2 className="text-sm font-bold">اطلب اعتماداً على تذكرة</h2>
      <p className="mt-1 text-xs leading-relaxed text-black/50">
        الاعتماد اختياري: التذكرة العادية لا تحتاجه. وما لا يبدأ تنفيذه إلا بموافقة مسؤولٍ أعلى
        — خطةٌ أو ميزانيةٌ أو مبادرة — يُعلَّق عليه طلبُ اعتماد.
      </p>

      {done && (
        <p className="mt-3 rounded-lg bg-green-50 px-3 py-2 text-xs font-semibold text-green-800">
          {done}
        </p>
      )}

      {!open ? (
        <Button theme={theme} variant="outline" className="mt-3" onClick={() => setOpen(true)}>
          طلب اعتماد جديد
        </Button>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          <Field label="التذكرة">
            <select
              value={ticketId}
              onChange={(e) => setTicketId(e.target.value)}
              className="min-h-11 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:border-black/30"
            >
              <option value="">—</option>
              {tickets.map((t) => (
                <option key={t.id} value={t.id}>
                  #{t.ticketNumber} — {t.subject}
                </option>
              ))}
            </select>
          </Field>

          <Field label="نوع الطلب">
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value)}
              className="min-h-11 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:border-black/30"
            >
              <option value="">—</option>
              {KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="المعتمِد">
            <select
              value={approver}
              onChange={(e) => setApprover(e.target.value)}
              className="min-h-11 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:border-black/30"
            >
              <option value="">—</option>
              {approvers.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="معتمِدٌ ثانٍ بعده (اختياري)">
            <select
              value={second}
              onChange={(e) => setSecond(e.target.value)}
              className="min-h-11 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:border-black/30"
            >
              <option value="">لا — موافقةٌ واحدة تكفي</option>
              {approvers
                .filter((a) => a.id !== approver)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
            </select>
          </Field>
          <p className="-mt-1 text-[11px] leading-relaxed text-black/40">
            إن أضفتَ ثانياً فلا يصير الطلب «معتمداً نهائياً» إلا بعد موافقتهما معاً، بالترتيب.
          </p>

          {error && <p className="text-sm font-semibold leading-relaxed text-red-700">{error}</p>}

          <div className="flex flex-wrap gap-2">
            <Button
              theme={theme}
              disabled={pending || !ticketId || !kind || !approver}
              onClick={() => {
                setError(null);
                startTransition(async () => {
                  const res = await requestApprovalAction(
                    ticketId,
                    kind,
                    approver,
                    second ? [second] : []
                  );
                  if (res.error) {
                    setError(res.error);
                    return;
                  }
                  setDone("أُرسل الطلب إلى المعتمِد، وينتظر قراره");
                  setOpen(false);
                  setTicketId("");
                  setKind("");
                  setApprover("");
                  setSecond("");
                });
              }}
            >
              {pending ? "جارِ الإرسال..." : "أرسل الطلب"}
            </Button>
            <Button theme={theme} variant="ghost" onClick={() => setOpen(false)}>
              إلغاء
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium text-black/70">{label}</span>
      {children}
    </label>
  );
}
