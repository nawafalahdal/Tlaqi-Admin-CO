"use client";

import { useActionState, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import type { themeFromColor } from "@/lib/brand";
import type { FormState } from "../actions";

type Theme = ReturnType<typeof themeFromColor>;
type Submit = { label: string; name?: string; value?: string; variant?: "solid" | "outline" | "ghost" };

/** نموذجٌ واحدٌ لكل إجراءٍ في صفحات اللجان.
 *
 *  الحقولُ تُرسم في الخادم (`children`)، وهذا يضيف ما يحتاج المتصفّح:
 *  حالةَ الإرسال، ورسالةَ الخطأ أو النجاح في مكانها، وتأكيداً قبل ما لا
 *  يُتراجَع عنه بنقرة. والقرارُ كلُّه في الخادم — هنا عرضٌ لا إذن. */
export function ActionForm({
  action,
  children,
  submits,
  pendingLabel,
  theme,
  className = "flex flex-col gap-3",
  confirm,
  compact = false,
}: {
  action: (p: FormState, fd: FormData) => Promise<FormState>;
  children?: ReactNode;
  submits: Submit[];
  pendingLabel: string;
  theme: Theme;
  className?: string;
  confirm?: { title: string; body?: string; confirmLabel: string };
  compact?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, { error: null, success: false });
  const ref = useRef<HTMLFormElement>(null);
  const confirmed = useRef(false);
  const submitter = useRef<HTMLButtonElement | null>(null);
  const [asking, setAsking] = useState(false);

  return (
    <form
      ref={ref}
      action={formAction}
      className={className}
      onSubmit={(e) => {
        if (!confirm || confirmed.current) {
          confirmed.current = false;
          return;
        }
        e.preventDefault();
        submitter.current = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
        setAsking(true);
      }}
    >
      {children}
      {/* الزرُّ يحمل قيمتَه (`name=value`)، وبعد التأكيد يُعاد الإرسالُ بالزرّ نفسِه */}
      <div className="flex flex-wrap gap-2">
        {submits.map((b, i) => (
          <Button
            key={i}
            theme={theme}
            type="submit"
            name={b.name}
            value={b.value}
            variant={b.variant ?? (i === 0 ? "solid" : "outline")}
            disabled={pending}
            className={compact ? "!min-h-9 !px-3 !py-1.5 !text-xs" : ""}
          >
            {pending ? pendingLabel : b.label}
          </Button>
        ))}
      </div>
      {state.error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      )}
      {state.success && state.message && !compact && (
        <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {state.message}
        </p>
      )}
      {confirm && (
        <ConfirmDialog
          open={asking}
          title={confirm.title}
          body={confirm.body}
          confirmLabel={confirm.confirmLabel}
          pending={pending}
          onCancel={() => setAsking(false)}
          onConfirm={() => {
            confirmed.current = true;
            setAsking(false);
            ref.current?.requestSubmit(submitter.current ?? undefined);
          }}
        />
      )}
    </form>
  );
}

/** قائمةُ اختيار الأعضاء مع بحثٍ بالاسم — الصفوفُ كلُّها في النموذج، والبحثُ يُخفي ولا يحذف */
export function PeoplePicker({
  name,
  people,
  multiple = true,
  searchLabel,
  emptyLabel,
  defaultSelected = [],
}: {
  name: string;
  people: { id: string; fullName: string; jobTitle?: string | null }[];
  multiple?: boolean;
  searchLabel: string;
  emptyLabel: string;
  defaultSelected?: string[];
}) {
  const [q, setQ] = useState("");
  if (!people.length) return <p className="text-xs text-black/50">{emptyLabel}</p>;
  const needle = q.trim().toLowerCase();
  return (
    <div className="flex flex-col gap-2">
      {people.length > 8 && (
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={searchLabel}
          aria-label={searchLabel}
          className="min-h-10 rounded-xl border border-black/10 bg-white px-3 text-sm outline-none focus:border-black/30"
        />
      )}
      <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto rounded-xl border border-black/10 p-1.5">
        {people.map((p) => {
          const hidden = needle && !p.fullName.toLowerCase().includes(needle);
          return (
            <li key={p.id} className={hidden ? "hidden" : ""}>
              <label className="flex min-h-10 cursor-pointer items-center gap-2.5 rounded-lg px-2 text-sm hover:bg-black/[0.04]">
                <input
                  type={multiple ? "checkbox" : "radio"}
                  name={name}
                  value={p.id}
                  defaultChecked={defaultSelected.includes(p.id)}
                  className="h-4 w-4 shrink-0"
                />
                <span className="min-w-0 flex-1 truncate">{p.fullName}</span>
                {p.jobTitle && <span className="truncate text-xs text-black/45">{p.jobTitle}</span>}
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
