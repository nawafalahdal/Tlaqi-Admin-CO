"use client";

import { useState } from "react";
import { useTranslations } from "@/i18n/LocaleProvider";
import { fmt } from "@/i18n/fmt";

/** معاينةُ التصميم بنسبة المقاس المطلوب — لا بنسبة الملف.
 *
 *  الإطارُ بنسبة المخرج، والصورةُ داخله `contain`: فإن خالفت نسبتُها المقاسَ
 *  ظهر الفراغُ حولها بدل أن يُقصّ ما يُخفي الخطأ. ومنطقةُ الأمان بأبعادها
 *  الفعلية من المقاس (بكسلاتٌ ← نِسَب)، على جهاتها الحقيقية — الصورةُ لا
 *  تنعكس في الواجهة العربية فلا تنعكس حدودُها. */

export type PreviewVersion = { id: string; number: number; url: string; width: number; height: number };
type Target = { width: number; height: number; safeTop: number; safeRight: number; safeBottom: number; safeLeft: number };

function Frame({ v, target, safe, phone, square, label }: { v: PreviewVersion; target: Target; safe: boolean; phone: boolean; square: boolean; label: string }) {
  const ratio = square ? 1 : target.width / target.height;
  const pct = (n: number, of: number) => `${(n / of) * 100}%`;
  const box = (
    <div
      className="relative mx-auto overflow-hidden bg-black/[0.06]"
      style={{ aspectRatio: String(ratio), width: "100%", maxWidth: `calc(62vh * ${ratio})` }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- ملفٌّ خلف الجلسة؛ مُحسِّنُ الصور لا يمرّر الكعكة */}
      <img src={v.url} alt={label} className={`absolute inset-0 h-full w-full ${square ? "object-cover" : "object-contain"}`} />
      {safe && !square && (
        <>
          <div className="pointer-events-none absolute inset-x-0 top-0 bg-red-500/25" style={{ height: pct(target.safeTop, target.height) }} />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-red-500/25" style={{ height: pct(target.safeBottom, target.height) }} />
          <div className="pointer-events-none absolute inset-y-0 left-0 bg-red-500/25" style={{ width: pct(target.safeLeft, target.width) }} />
          <div className="pointer-events-none absolute inset-y-0 right-0 bg-red-500/25" style={{ width: pct(target.safeRight, target.width) }} />
          <div
            className="pointer-events-none absolute border-2 border-dashed border-white/90 mix-blend-difference"
            style={{
              top: pct(target.safeTop, target.height),
              bottom: pct(target.safeBottom, target.height),
              left: pct(target.safeLeft, target.width),
              right: pct(target.safeRight, target.width),
            }}
          />
        </>
      )}
    </div>
  );
  return phone ? (
    <div className="mx-auto w-full rounded-[2.2rem] border-[10px] border-neutral-800 bg-neutral-800 p-0.5 shadow-lg" style={{ maxWidth: `calc(62vh * ${ratio} + 24px)` }}>
      <div className="mx-auto mb-1.5 h-1.5 w-16 rounded-full bg-neutral-600" />
      <div className="overflow-hidden rounded-[1.6rem]">{box}</div>
    </div>
  ) : (
    box
  );
}

export function DesignPreview({ versions, target }: { versions: PreviewVersion[]; target: Target }) {
  const L = useTranslations().mk.design;
  const common = useTranslations().mk.common;
  const [selected, setSelected] = useState(versions[0]?.id ?? "");
  const [compare, setCompare] = useState("");
  const [safe, setSafe] = useState(true);
  const [phone, setPhone] = useState(false);
  const [square, setSquare] = useState(false);
  const a = versions.find((v) => v.id === selected) ?? versions[0];
  const b = versions.find((v) => v.id === compare && v.id !== a?.id);
  if (!a) return null;

  const toggle = (on: boolean, set: (v: boolean) => void, label: string) => (
    <label className="inline-flex items-center gap-1.5 text-xs font-semibold text-black/70">
      <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} />
      {label}
    </label>
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <select value={a.id} onChange={(e) => setSelected(e.target.value)} aria-label={L.preview} className="min-h-9 rounded-lg border border-black/10 bg-white px-2 text-xs">
          {versions.map((v) => (
            <option key={v.id} value={v.id}>{fmt(common.version, v.number)}</option>
          ))}
        </select>
        {toggle(safe, setSafe, L.safeArea)}
        {toggle(phone, setPhone, L.phoneFrame)}
        {toggle(square, setSquare, L.gridCrop)}
        {versions.length > 1 && (
          <label className="inline-flex items-center gap-1.5 text-xs font-semibold text-black/70">
            {L.compare}
            <select value={compare} onChange={(e) => setCompare(e.target.value)} className="min-h-9 rounded-lg border border-black/10 bg-white px-2 text-xs">
              <option value="">{L.compareNone}</option>
              {versions.filter((v) => v.id !== a.id).map((v) => (
                <option key={v.id} value={v.id}>{fmt(common.version, v.number)}</option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div className={`grid gap-4 ${b ? "grid-cols-2" : "grid-cols-1"}`}>
        {[a, ...(b ? [b] : [])].map((v) => (
          <figure key={v.id} className="flex min-w-0 flex-col gap-1.5">
            <Frame v={v} target={target} safe={safe} phone={phone} square={square} label={fmt(common.version, v.number)} />
            <figcaption className="text-center text-[11px] text-black/55" dir="ltr">
              {fmt(common.version, v.number)} · {fmt(L.actual, v.width, v.height)} · {fmt(L.target, target.width, target.height)}
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}
