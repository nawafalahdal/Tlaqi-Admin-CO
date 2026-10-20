"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import Link from "next/link";

export type MenuItem =
  | { kind: "link"; label: string; href: string }
  | { kind: "action"; label: string; onSelect: () => void; danger?: boolean; disabled?: boolean }
  | { kind: "separator" };

/** قائمةُ الإجراءات المختصرة «⋯» — لصفوف الجداول.
 *
 *  كان كلُّ صفٍّ يحمل أزراره كلَّها ظاهرةً كبيرة، فصار الجدولُ أزراراً لا
 *  أسماء. فبقي في الصفّ زرٌّ واحدٌ ظاهر («عرض الملف»)، والباقي هنا.
 *
 *  تُفتح بالزرّ أو بلوحة المفاتيح، وتُغلَق بـEscape أو بالنقر خارجها،
 *  ويعود التركيزُ إلى زرّها. وما فيها لا يمنح صلاحية: كلُّ إجراءٍ يُنادي
 *  إجراءً خادمياً يفرض شرطه بنفسه. */
export function ActionsMenu({ label, items, trigger }: { label: string; items: MenuItem[]; trigger?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    // أوّلُ بندٍ يأخذ التركيز — فالقائمةُ تُستعمل بلوحة المفاتيح وحدها
    root.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function onMenuKey(e: React.KeyboardEvent) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const list = Array.from(root.current?.querySelectorAll<HTMLElement>("[role=menuitem]:not([aria-disabled=true])") ?? []);
    const i = list.indexOf(document.activeElement as HTMLElement);
    const next = e.key === "ArrowDown" ? (i + 1) % list.length : (i - 1 + list.length) % list.length;
    list[next]?.focus();
  }

  return (
    <div ref={root} className="actions-menu">
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        aria-label={label}
        title={label}
        onClick={() => setOpen((o) => !o)}
        className="actions-menu__trigger"
      >
        {trigger ?? "⋯"}
      </button>
      {open && (
        <div id={id} role="menu" aria-label={label} className="actions-menu__panel" onKeyDown={onMenuKey}>
          {items.map((it, i) =>
            it.kind === "separator" ? (
              <div key={i} role="separator" className="actions-menu__sep" />
            ) : it.kind === "link" ? (
              <Link key={i} role="menuitem" href={it.href} className="actions-menu__item" onClick={() => setOpen(false)}>
                {it.label}
              </Link>
            ) : (
              <button
                key={i}
                type="button"
                role="menuitem"
                aria-disabled={it.disabled || undefined}
                disabled={it.disabled}
                onClick={() => {
                  setOpen(false);
                  it.onSelect();
                }}
                className={`actions-menu__item ${it.danger ? "actions-menu__item--danger" : ""}`}
              >
                {it.label}
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}
