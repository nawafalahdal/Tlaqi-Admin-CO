"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import type { OrgGraph, OrgPersonView, OrgUnitView, OrgCommitteeView } from "@/lib/org/orgGraph";
import type { Dictionary } from "@/i18n";
import { fmt } from "@/i18n/fmt";
import { OrgPortrait, OrgFace, VacantPortrait, type PortraitSize } from "@/components/org/OrgPortrait";

/** **الهيكلُ التنظيمي — الأشخاصُ محوره** (طلب المؤسس، نوفمبر 2026).
 *
 *  عمودٌ قياديٌّ في الوسط (المؤسس ← التنفيذي ← القيادة التنفيذية والإدارة العليا)، ثم الأقسامُ وحداتٍ هادئة بلا حدودٍ ثقيلة،
 *  في كلٍّ منها قائدُه ثم لجانُه صفوفاً أصغر (قائدُها ووجوهُ أعضائها)، ثم أعضاؤه. **كلُّ شخصٍ بطاقةٌ واحدة في موضعه الأساسي**
 *  (`buildOrgGraph`) وما سواه إشارةٌ إلى ملفّه. والتفاصيلُ في لوحةٍ جانبية عند الطلب — لا كلُّ شيءٍ دفعةً واحدة.
 *
 *  **الأداء:** الحالةُ الوحيدة في الأعلى هي «ما المفتوح في اللوحة»، ومكوّناتُ الشجرة `memo` بنداءٍ ثابت — ففتحُ لجنةٍ لا يعيد
 *  بناءَ الشجرة. وتوسيعُ قسمٍ حالتُه في القسم نفسه. والصورُ كسولة إلا القمة. */

type L = Dictionary["rOrgExplorer"];
type Sel = { kind: "person" | "committee" | "department"; id: string } | null;
type Open = (s: Sel) => void;

/** **أرضٌ بيضاء** (طلب المؤسس، نوفمبر 2026 — الأبيضُ بدل البنفسجي): سطحُ المنصة نفسُه (`--surface`) وعليه غمزتان من
 *  الهوية — بيجٌ في القمة ومهوجنيٌّ خافتٌ في الزاوية. وكلُّها متغيّراتُ السمة، فتتبع المنصةَ في الوضع الداكن ولا تُجمَّد. */
const BG =
  "radial-gradient(1100px 520px at 50% -8%, var(--accent-soft), transparent 62%), radial-gradient(900px 480px at 88% 14%, rgba(195,73,0,0.06), transparent 60%), var(--surface)";
const PANEL = "rounded-[26px] bg-white shadow-[0_20px_44px_-30px_rgba(52,29,43,0.32)] ring-1 ring-black/[0.07]";

export function OrgExplorer({ graph, L, pdf, download }: { graph: OrgGraph; L: L; pdf: { ready: boolean; href: string }; download?: string | null }) {
  const [sel, setSel] = useState<Sel>(null);
  const open = useCallback<Open>((s) => setSel(s), []);
  const P = graph.people;
  const committees = useMemo(() => {
    const m = new Map<string, OrgCommitteeView>();
    for (const u of [...(graph.senior ? [graph.senior] : []), ...graph.departments]) for (const c of u.committees) m.set(c.id, c);
    return m;
  }, [graph]);
  const units = useMemo(() => new Map([...(graph.senior ? [graph.senior] : []), ...graph.departments].map((u) => [u.id, u])), [graph]);
  const founder = graph.founderKey ? P[graph.founderKey] : null;
  const ceo = graph.ceoKey ? P[graph.ceoKey] : null;
  const exec = [...graph.operations.map((o) => o.key), ...graph.extraLeaders];

  return (
    <div className="relative overflow-hidden rounded-[30px] text-black shadow-[0_30px_60px_-44px_rgba(52,29,43,0.4)] ring-1 ring-black/[0.06]" style={{ background: BG }}>
      <div className="relative mx-auto max-w-[1180px] px-4 pb-16 pt-8 sm:px-8 sm:pt-10">
        {/* ── الترويسة */}
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-2xl">
            <p className="text-[11px] font-bold tracking-[0.3em] text-[var(--ink-muted)]" dir="ltr">
              {L.eyebrow}
            </p>
            <h1 className="mt-1 text-3xl text-[var(--brand-primary)] font-extrabold leading-tight sm:text-4xl">{L.title}</h1>
            <p className="mt-2 text-sm leading-relaxed text-[var(--ink-muted)]">{L.subtitle}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Stat value={graph.counts.people} label={L.people} />
            <Stat value={graph.counts.departments} label={L.departments} />
            <Stat value={graph.counts.committees} label={L.committees} />
            {/* تنزيلُ الهيكل بالموجود (ولو ناقصاً) — للمؤسس وحده، والخادمُ يفرضه (`/structure/download`). بلا سمة `download`:
                الخادمُ يقول «مرفق» باسم الملف (Content-Disposition)، والسمةُ كانت تغلبه باسم الرابط */}
            {download && (
              <a href={download} className="inline-flex min-h-10 items-center gap-1.5 rounded-full bg-[#341D2B] px-4 font-bold text-on-brand transition hover:bg-[#4a2a3e] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C34900]">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M12 4v11m0 0-4-4m4 4 4-4M5 20h14" />
                </svg>
                {L.downloadPdf}
              </a>
            )}
            {pdf.ready ? (
              <Link href={pdf.href} className="inline-flex min-h-10 items-center rounded-full bg-[#C34900] px-4 font-bold text-on-brand transition hover:bg-[#a83f00] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C34900]">
                {L.officialPdf}
              </Link>
            ) : (
              <span className="rounded-full px-3 py-2 text-[11px] text-[var(--ink-muted)]">{L.pdfNotReady}</span>
            )}
          </div>
        </header>

        {/* ── العمودُ القيادي */}
        <section aria-label={L.leadership} className="mt-10 flex flex-col items-center">
          {founder ? <Figure person={founder} size="xl" onOpen={open} L={L} eager tier="top" /> : <Vacant size="xl" label={L.vacantSeat} />}
          <Spine />
          {ceo ? <Figure person={ceo} size="lg" onOpen={open} L={L} eager tier="top" /> : <Vacant size="lg" label={L.vacantSeat} />}
          {(exec.length > 0 || graph.senior) && <Spine />}
          {exec.length > 0 && (
            <div className="w-full">
              <TierLabel>{L.executive}</TierLabel>
              <Bus count={exec.length} />
              <div className="flex flex-wrap justify-center gap-x-8 gap-y-6">
                {graph.operations.map((o) => (
                  <div key={o.key} className="flex flex-col items-center">
                    <Figure person={P[o.key]} size="md" onOpen={open} L={L} />
                    {o.unitId && units.get(o.unitId) && (
                      <button type="button" onClick={() => open({ kind: "department", id: o.unitId! })} className="mt-1 rounded-full bg-black/[0.04] px-3 py-1 text-[11px] text-black/80 transition hover:bg-black/[0.07]">
                        {L.oversight}: {units.get(o.unitId)!.name}
                      </button>
                    )}
                  </div>
                ))}
                {graph.extraLeaders.map((k) => (
                  <Figure key={k} person={P[k]} size="md" onOpen={open} L={L} />
                ))}
              </div>
            </div>
          )}
          {graph.senior && (
            <div className="mt-10 w-full">
              <SeniorBand unit={graph.senior} positions={graph.seniorPositions} P={P} onOpen={open} L={L} />
            </div>
          )}
        </section>

        {/* ── الأقسام */}
        {graph.departments.length > 0 && (
          <section aria-labelledby="org-depts" className="mt-14">
            <div className="flex flex-col items-center">
              <Spine />
              <h2 id="org-depts" className="mt-1 text-center text-lg font-extrabold">
                {L.departmentsHeading}
              </h2>
            </div>
            <div className="relative mt-6">
              <div aria-hidden className="pointer-events-none absolute inset-x-[8%] -top-3 hidden h-px bg-gradient-to-l from-transparent via-black/15 to-transparent md:block" />
              <div className="grid items-start gap-5 md:grid-cols-2 xl:grid-cols-3">
                {graph.departments.map((d) => (
                  <Department key={d.id} unit={d} P={P} onOpen={open} L={L} />
                ))}
              </div>
            </div>
          </section>
        )}

        {graph.unassignedKeys.length > 0 && (
          <section className="mt-12">
            <TierLabel>{L.unassigned}</TierLabel>
            <div className="mt-4 flex flex-wrap justify-center gap-5">
              {graph.unassignedKeys.map((k) => (
                <Figure key={k} person={P[k]} size="sm" onOpen={open} L={L} />
              ))}
            </div>
          </section>
        )}

        {graph.issues.length > 0 && (
          <details className="mt-12 rounded-2xl bg-[#C34900]/[0.06] px-4 py-3 text-sm ring-1 ring-[#C34900]/25">
            <summary className="cursor-pointer font-bold">{fmt(L.issuesTitle, graph.issues.length)}</summary>
            <p className="mt-2 text-xs text-black/80">{L.issuesNote}</p>
            <ul className="mt-2 grid gap-1 text-xs text-black/80">
              {graph.issues.map((i, n) => (
                <li key={n}>• {i.detail}</li>
              ))}
            </ul>
          </details>
        )}
      </div>

      <Sheet sel={sel} onClose={() => setSel(null)} L={L}>
        {sel?.kind === "person" && P[sel.id] && <PersonSheet p={P[sel.id]} L={L} onOpen={open} committees={committees} units={units} />}
        {sel?.kind === "committee" && committees.get(sel.id) && <CommitteeSheet c={committees.get(sel.id)!} P={P} L={L} onOpen={open} />}
        {sel?.kind === "department" && units.get(sel.id) && <DepartmentSheet u={units.get(sel.id)!} P={P} L={L} onOpen={open} />}
      </Sheet>
    </div>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <span className="rounded-full bg-[var(--accent-soft)] px-3 py-2 text-[var(--accent-soft-ink)] ring-1 ring-[var(--accent-soft-line)]">
      <b className="text-sm">{value}</b> <span className="opacity-75">{label}</span>
    </span>
  );
}
const Spine = () => <span aria-hidden className="my-2 block h-9 w-px bg-gradient-to-b from-[#C34900]/80 to-black/10" />;
const TierLabel = ({ children }: { children: ReactNode }) => (
  <p className="text-center text-[11px] font-bold tracking-wide text-[var(--ink-muted)]">{children}</p>
);
/** خطُّ الوصل الأفقي فوق صفٍّ من الأشخاص — على الشاشات العريضة وحدها */
const Bus = ({ count }: { count: number }) =>
  count > 1 ? <span aria-hidden className="mx-auto mb-4 mt-3 hidden h-px w-[min(70%,640px)] bg-gradient-to-l from-transparent via-black/15 to-transparent sm:block" /> : <span className="block h-4" />;

function Vacant({ size, label }: { size: PortraitSize; label: string }) {
  return (
    <div className="flex flex-col items-center text-center">
      <VacantPortrait size={size} />
      <p className="mt-1 text-sm font-semibold text-[var(--ink-muted)]">{label}</p>
    </div>
  );
}

/** **بطاقةُ الشخص — تُرسم في موضعه الأساسي وحده.** زرٌّ حقيقيٌّ يفتح ملفّه (لوحة المفاتيح واللمس). */
const Figure = memo(function Figure({ person, size, onOpen, L, eager, tier }: { person: OrgPersonView; size: PortraitSize; onOpen: Open; L: L; eager?: boolean; tier?: "top" }) {
  return (
    <button
      type="button"
      data-person={person.key}
      data-primary="1"
      onClick={() => onOpen({ kind: "person", id: person.key })}
      aria-label={fmt(L.openProfile, person.name)}
      className="group flex max-w-[220px] flex-col items-center rounded-3xl px-2 pb-2 text-center outline-none transition focus-visible:ring-2 focus-visible:ring-[#C34900]"
    >
      <span className="transition duration-300 motion-safe:group-hover:-translate-y-0.5">
        <OrgPortrait portrait={person.portrait} size={size} eager={eager} highlight={person.isViewer} />
      </span>
      <span className={`-mt-1 block font-extrabold leading-snug ${tier === "top" ? "text-lg" : size === "sm" ? "text-[13px]" : "text-[15px]"}`}>{person.name}</span>
      <span className={`mt-0.5 block leading-snug text-black/80 ${size === "sm" ? "text-[11px]" : "text-[12.5px]"}`}>{person.title}</span>
      {(person.etid || person.isViewer) && (
        <span className="mt-1 flex items-center gap-1.5 text-[10.5px] text-[var(--ink-muted)]">
          {person.etid && <span dir="ltr" className="font-mono tracking-wide">{person.etid}</span>}
          {person.isViewer && <span className="rounded-full bg-[#C34900] px-2 py-px font-bold text-on-brand">{L.you}</span>}
        </span>
      )}
    </button>
  );
});

/** إشارةٌ إلى ملفٍّ أساسيٍّ في موضعٍ آخر — اسمٌ يفتح الملف، بلا صورةٍ ثانية */
function RefChip({ person, onOpen, L, note }: { person: OrgPersonView; onOpen: Open; L: L; note?: string }) {
  return (
    <button
      type="button"
      data-person-ref={person.key}
      onClick={() => onOpen({ kind: "person", id: person.key })}
      title={L.reference}
      className="inline-flex items-center gap-1.5 rounded-full bg-black/[0.04] px-3 py-1.5 text-[12px] font-semibold ring-1 ring-black/[0.07] transition hover:bg-black/[0.07]"
    >
      <span aria-hidden className="text-[#C34900]">↗</span>
      {person.name}
      {note && <span className="font-normal text-[var(--ink-muted)]">· {note}</span>}
    </button>
  );
}

function SeniorBand({ unit, positions, P, onOpen, L }: { unit: OrgUnitView; positions: OrgGraph["seniorPositions"]; P: OrgGraph["people"]; onOpen: Open; L: L }) {
  const holders = positions.filter((s) => P[s.key]?.roles[0]?.kind === "senior_position").map((s) => s.key);
  const people = [...holders, ...unit.memberKeys.filter((k) => !holders.includes(k))];
  return (
    <div className={`${PANEL} px-4 py-6 sm:px-8`}>
      <button type="button" onClick={() => onOpen({ kind: "department", id: unit.id })} className="mx-auto block text-center">
        <span className="text-[11px] font-bold tracking-wide text-[var(--ink-muted)]">{unit.name}</span>
      </button>
      {people.length > 0 && (
        <div className="mt-4 flex flex-wrap justify-center gap-x-8 gap-y-6">
          {people.map((k) => (
            <Figure key={k} person={P[k]} size="md" onOpen={onOpen} L={L} />
          ))}
        </div>
      )}
      {unit.committees.length > 0 && (
        <div className="mx-auto mt-6 grid max-w-3xl gap-2 sm:grid-cols-2">
          {unit.committees.map((c) => (
            <CommitteeRow key={c.id} c={c} P={P} onOpen={onOpen} L={L} />
          ))}
        </div>
      )}
    </div>
  );
}

// خصائصُه ثابتةٌ بين فتح اللوحة وإغلاقها (الوحدةُ والأشخاصُ والنداءُ نفسُها) — فلا يُعاد رسمُه بفتح لجنة
const Department = memo(function Department({ unit, P, onOpen, L }: { unit: OrgUnitView; P: OrgGraph["people"]; onOpen: Open; L: L }) {
  const overseers = useMemo(() => unit.overseerKeys.map((k) => P[k]?.name).filter(Boolean) as string[], [unit, P]);
  const viewerHere = useMemo(
    () => [unit.leadKey, unit.deputyKey, ...unit.memberKeys, ...unit.committees.flatMap((c) => [c.leadKey, ...c.memberKeys, ...c.referenceKeys])].some((k) => k && P[k]?.isViewer),
    [unit, P]
  );
  const [open, setOpen] = useState(viewerHere);
  const [allCommittees, setAllCommittees] = useState(false);
  const [allMembers, setAllMembers] = useState(false);
  const bodyId = `dept-${unit.id}`;
  const lead = unit.leadKey ? P[unit.leadKey] : null;
  const shownCommittees = allCommittees ? unit.committees : unit.committees.slice(0, 4);
  const MEMBERS_PREVIEW = 8;
  const shownMembers = allMembers ? unit.memberKeys : unit.memberKeys.slice(0, MEMBERS_PREVIEW);
  return (
    <article className={`${PANEL} relative overflow-hidden`}>
      <span aria-hidden className="absolute inset-x-8 top-0 h-[2px] rounded-full bg-gradient-to-l from-transparent via-[#C34900] to-transparent" />
      <div className="flex items-start gap-3 px-5 pt-5">
        <span aria-hidden className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-[#C34900]/10 text-[#C34900]">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3 3 8l9 5 9-5-9-5Z" />
            <path d="m3 13 9 5 9-5" />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <button type="button" onClick={() => onOpen({ kind: "department", id: unit.id })} aria-label={fmt(L.openDepartment, unit.name)} className="text-start text-lg font-extrabold leading-snug hover:underline">
            {unit.name}
          </button>
          <p className="mt-0.5 text-[12px] text-[var(--ink-muted)]">
            {fmt(L.membersCount, unit.memberCount)} · {unit.committeeCount > 0 ? fmt(L.committeesCount, unit.committeeCount) : L.noCommittees}
          </p>
          {overseers.length > 0 && <p className="mt-0.5 text-[11.5px] text-[var(--ink-muted)]">{fmt(L.followsOps, overseers.join("، "))}</p>}
        </div>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          aria-label={open ? L.collapse : L.expand}
          onClick={() => setOpen((v) => !v)}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-black/[0.04] md:hidden"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`transition ${open ? "rotate-180" : ""}`}>
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
      </div>

      {/* القائدُ ظاهرٌ دائماً — والطيُّ للجان والأعضاء على الجوال، وعلى الشاشات العريضة كلُّه ظاهر */}
      <div className="mt-3 flex flex-col items-center px-5">
        {lead && !unit.leadIsReference ? (
          <Figure person={lead} size="md" onOpen={onOpen} L={L} />
        ) : lead ? (
          <div className="py-3">
            <RefChip person={lead} onOpen={onOpen} L={L} note={L.lead} />
          </div>
        ) : (
          <Vacant size="sm" label={L.vacantLead} />
        )}
        {unit.coLeadKeys.map((k) => (
          <RefChip key={k} person={P[k]} onOpen={onOpen} L={L} note={L.lead} />
        ))}
      </div>

      <div id={bodyId} className={`${open ? "block" : "hidden"} px-5 pb-5 md:block`}>
        {unit.deputyKey && (
          <div className="mt-2 flex justify-center">
            <Figure person={P[unit.deputyKey]} size="sm" onOpen={onOpen} L={L} />
          </div>
        )}
        {unit.committees.length > 0 && (
          <div className="mt-4">
            <p className="mb-2 text-[11px] font-bold tracking-wide text-[var(--ink-muted)]">{fmt(L.committeesCount, unit.committees.length)}</p>
            <div className="grid gap-2">
              {shownCommittees.map((c) => (
                <CommitteeRow key={c.id} c={c} P={P} onOpen={onOpen} L={L} />
              ))}
            </div>
            {unit.committees.length > 4 && (
              <button type="button" onClick={() => setAllCommittees((v) => !v)} className="mt-2 min-h-10 w-full rounded-xl text-[12px] font-bold text-black/80 hover:bg-black/[0.035]">
                {allCommittees ? L.showLess : fmt(L.seeAll, unit.committees.length)}
              </button>
            )}
          </div>
        )}
        {unit.memberKeys.length > 0 && (
          <div className="mt-5">
            <p className="mb-2 text-[11px] font-bold tracking-wide text-[var(--ink-muted)]">
              {L.departmentMembers} ({unit.memberKeys.length})
            </p>
            <div className="grid grid-cols-3 gap-x-1 gap-y-3 sm:grid-cols-4 md:grid-cols-3">
              {shownMembers.map((k) => (
                <Figure key={k} person={P[k]} size="sm" onOpen={onOpen} L={L} />
              ))}
            </div>
            {unit.memberKeys.length > MEMBERS_PREVIEW && (
              <button type="button" onClick={() => setAllMembers((v) => !v)} className="mt-2 min-h-10 w-full rounded-xl text-[12px] font-bold text-black/80 hover:bg-black/[0.035]">
                {allMembers ? L.showLess : fmt(L.seeAll, unit.memberKeys.length)}
              </button>
            )}
          </div>
        )}
      </div>
    </article>
  );
});

/** **صفُّ لجنة:** قائدُها ووجوهُ أعضائها — أصغرُ من القسم، ويفتح تفاصيلَها.
 *
 *  **ولا صورةَ لشخصٍ مرّتين:** الوجوهُ لمن موضعُه الأساسيُّ هذه اللجنة وحدهم (وكلُّ وجهٍ موسومٌ بهوية صاحبه)، ومن ارتبط
 *  بها وملفُّه في موضعٍ آخر يُعدّ «+N مرتبطاً» بلا صورة. وقائدٌ ملفُّه في موضعٍ آخر يُذكر باسمه وحده. */
const CommitteeRow = memo(function CommitteeRow({ c, P, onOpen, L }: { c: OrgCommitteeView; P: OrgGraph["people"]; onOpen: Open; L: L }) {
  const lead = c.leadKey ? P[c.leadKey] : null;
  const faces = c.memberKeys.map((k) => P[k]).filter(Boolean);
  const viewerHere = !!(lead?.isViewer && !c.leadIsReference) || faces.some((p) => p.isViewer);
  return (
    <button
      type="button"
      data-committee={c.id}
      onClick={() => onOpen({ kind: "committee", id: c.id })}
      aria-label={fmt(L.openCommittee, c.name)}
      className={`flex w-full items-center gap-3 rounded-2xl p-2.5 text-start ring-1 transition hover:bg-black/[0.05] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#C34900] ${viewerHere ? "bg-[#C34900]/[0.07] ring-[#C34900]/35" : "bg-black/[0.025] ring-black/[0.07]"}`}
    >
      {lead && !c.leadIsReference ? (
        <span data-person={lead.key} data-face="1" className="shrink-0">
          <OrgFace portrait={lead.portrait} px={44} />
        </span>
      ) : (
        <span aria-hidden className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-dashed ${lead ? "border-[#C34900]/60 text-[#C34900]" : "border-black/25"}`}>
          {lead ? "↗" : ""}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] font-bold">{c.name}</span>
        <span className="block truncate text-[11.5px] text-[var(--ink-muted)]">{lead ? `${L.lead}: ${lead.name}` : L.vacantCommitteeLead}</span>
      </span>
      {viewerHere && <span className="shrink-0 rounded-full bg-[#C34900] px-2 py-px text-[10.5px] font-bold text-on-brand">{L.you}</span>}
      {faces.length > 0 && (
        <span className="flex shrink-0 items-center -space-x-2 rtl:space-x-reverse">
          {faces.slice(0, 4).map((p) => (
            <span key={p.key} data-person={p.key} data-face="1">
              <OrgFace portrait={p.portrait} px={26} />
            </span>
          ))}
          {faces.length > 4 && (
            <span data-overflow={faces.length - 4} className="ms-1 text-[11px] font-bold text-black/80">
              +{faces.length - 4}
            </span>
          )}
        </span>
      )}
      {c.referenceKeys.length > 0 && (
        <span className="shrink-0 text-[11px] text-[var(--ink-muted)]" title={L.reference}>
          ↗{c.referenceKeys.length}
        </span>
      )}
      <span className="shrink-0 rounded-full bg-black/[0.045] px-2 py-0.5 text-[11px] font-bold">{c.memberCount}</span>
    </button>
  );
});

/* ═══ اللوحةُ الجانبية: ملفٌّ أو لجنةٌ أو قسم ═══ */

function Sheet({ sel, onClose, L, children }: { sel: Sel; onClose: () => void; L: L; children: ReactNode }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const back = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!sel) return;
    back.current = (document.activeElement as HTMLElement) ?? null;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
      back.current?.focus?.();
    };
  }, [sel, onClose]);
  if (!sel) return null;
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-[#1A1023]/45 backdrop-blur-[2px] motion-safe:animate-[org-fade_.18s_ease-out]" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="org-sheet-title"
        className="absolute inset-x-0 bottom-0 max-h-[88vh] overflow-y-auto rounded-t-[28px] motion-safe:animate-[org-rise_.22s_ease-out] bg-white text-black shadow-2xl ring-1 ring-black/[0.06] sm:inset-y-0 sm:end-0 sm:start-auto sm:max-h-none sm:w-[440px] sm:rounded-none sm:rounded-s-[28px]"
      >
        <div className="sticky top-0 z-10 flex justify-end bg-gradient-to-b from-white via-white/90 to-transparent p-3">
          <button ref={closeRef} type="button" onClick={onClose} className="flex h-10 items-center gap-1 rounded-full bg-black/[0.05] px-4 text-sm font-bold hover:bg-black/[0.09] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#C34900]">
            {L.close} <span aria-hidden>✕</span>
          </button>
        </div>
        <div className="px-6 pb-10">{children}</div>
      </div>
    </div>
  );
}

function PersonSheet({ p, L, onOpen, committees, units }: { p: OrgPersonView; L: L; onOpen: Open; committees: Map<string, OrgCommitteeView>; units: Map<string, OrgUnitView> }) {
  return (
    <div className="flex flex-col items-center text-center">
      <OrgPortrait portrait={p.portrait} size="lg" eager highlight={p.isViewer} />
      <h2 id="org-sheet-title" className="mt-0 text-2xl font-extrabold">
        {p.name}
      </h2>
      <p className="mt-1 text-sm text-black/80">{p.title}</p>
      {p.unitName && <p className="text-xs text-[var(--ink-muted)]">{p.unitName}</p>}
      {p.etid && (
        <p className="mt-3 rounded-full bg-black/[0.045] px-3 py-1 text-xs">
          {L.etid}: <span dir="ltr" className="font-mono tracking-wide">{p.etid}</span>
        </p>
      )}
      {p.roles.length > 0 && (
        <div className="mt-6 w-full text-start">
          <p className="mb-2 text-[11px] font-bold tracking-wide text-[var(--ink-muted)]">{L.roles}</p>
          <ul className="grid gap-2">
            {p.roles.map((r, i) => {
              const target = r.unitId ? (committees.has(r.unitId) ? { kind: "committee" as const, id: r.unitId } : units.has(r.unitId) ? { kind: "department" as const, id: r.unitId } : null) : null;
              const body = (
                <>
                  <span className="block text-[13.5px] font-bold">{r.label}</span>
                  <span className="block text-[11.5px] text-[var(--ink-muted)]">
                    {i === 0 ? L.primaryRole : L.alsoLinked}
                    {r.unitName ? ` · ${r.unitName}` : ""}
                  </span>
                </>
              );
              return (
                <li key={`${r.kind}-${r.unitId}-${i}`}>
                  {target ? (
                    <button type="button" onClick={() => onOpen(target)} className="w-full rounded-2xl bg-black/[0.035] px-4 py-2.5 text-start ring-1 ring-black/[0.07] hover:bg-black/[0.06]">
                      {body}
                    </button>
                  ) : (
                    <div className="rounded-2xl bg-black/[0.035] px-4 py-2.5 ring-1 ring-black/[0.07]">{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function MemberLine({ p, note, onOpen, isRef, L }: { p: OrgPersonView; note: string; onOpen: Open; isRef?: boolean; L: L }) {
  return (
    <li>
      <button type="button" onClick={() => onOpen({ kind: "person", id: p.key })} className="flex w-full items-center gap-3 rounded-2xl px-2 py-2 text-start hover:bg-black/[0.04]">
        <OrgFace portrait={p.portrait} px={44} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-bold">{p.name}</span>
          <span className="block truncate text-[11.5px] text-[var(--ink-muted)]">
            {note}
            {isRef ? ` · ${L.reference}` : ""}
          </span>
        </span>
        {p.etid && (
          <span dir="ltr" className="shrink-0 font-mono text-[10.5px] text-[var(--ink-muted)]">
            {p.etid}
          </span>
        )}
      </button>
    </li>
  );
}

function CommitteeSheet({ c, P, L, onOpen }: { c: OrgCommitteeView; P: OrgGraph["people"]; L: L; onOpen: Open }) {
  const lead = c.leadKey ? P[c.leadKey] : null;
  const status = c.status === "approved" ? L.statusApproved : c.status === "awaiting_lead" ? L.statusAwaitingLead : L.statusOther;
  const all = [...c.memberKeys.map((k) => ({ k, ref: false })), ...c.referenceKeys.map((k) => ({ k, ref: true }))];
  return (
    <div>
      <p className="text-[11px] font-bold tracking-wide text-[var(--ink-muted)]">
        {L.parentDepartment}: {c.parentName}
      </p>
      <h2 id="org-sheet-title" className="mt-1 text-2xl font-extrabold">
        {c.name}
      </h2>
      <p className="mt-2">
        <span className="rounded-full bg-black/[0.05] px-3 py-1 text-[11px] font-bold">
          {L.status}: {status}
        </span>
      </p>
      {c.description && <p className="mt-3 text-sm leading-relaxed text-black/80">{c.description}</p>}
      <div className="mt-6 flex flex-col items-center">
        {lead ? <Figure person={lead} size="md" onOpen={onOpen} L={L} /> : <Vacant size="sm" label={L.vacantCommitteeLead} />}
        {lead && <p className="text-[11px] text-[var(--ink-muted)]">{L.committeeLead}</p>}
      </div>
      <p className="mb-2 mt-6 text-[11px] font-bold tracking-wide text-[var(--ink-muted)]">
        {L.committeeMembers} ({all.length})
      </p>
      {all.length === 0 ? (
        <p className="text-sm text-[var(--ink-muted)]">{L.noMembersYet}</p>
      ) : (
        <ul className="grid gap-1">
          {all.map(({ k, ref }) => (
            <MemberLine key={k} p={P[k]} note={c.responsibilities[k] ?? P[k].title} onOpen={onOpen} isRef={ref} L={L} />
          ))}
        </ul>
      )}
    </div>
  );
}

function DepartmentSheet({ u, P, L, onOpen }: { u: OrgUnitView; P: OrgGraph["people"]; L: L; onOpen: Open }) {
  const lead = u.leadKey ? P[u.leadKey] : null;
  return (
    <div>
      <h2 id="org-sheet-title" className="text-2xl font-extrabold">
        {u.name}
      </h2>
      <p className="mt-1 text-[12px] text-[var(--ink-muted)]">
        {fmt(L.membersCount, u.memberCount)} · {u.committeeCount > 0 ? fmt(L.committeesCount, u.committeeCount) : L.noCommittees}
      </p>
      {u.description && <p className="mt-3 text-sm leading-relaxed text-black/80">{u.description}</p>}
      <div className="mt-6 flex flex-col items-center">
        {lead ? <Figure person={lead} size="md" onOpen={onOpen} L={L} /> : u.kind === "department" ? <Vacant size="sm" label={L.vacantLead} /> : null}
      </div>
      {u.overseerKeys.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-[11px] font-bold tracking-wide text-[var(--ink-muted)]">{L.oversight}</p>
          <ul className="grid gap-1">
            {u.overseerKeys.map((k) => (
              <MemberLine key={k} p={P[k]} note={P[k].title} onOpen={onOpen} L={L} />
            ))}
          </ul>
        </div>
      )}
      {u.committees.length > 0 && (
        <div className="mt-5">
          <p className="mb-2 text-[11px] font-bold tracking-wide text-[var(--ink-muted)]">{fmt(L.committeesCount, u.committees.length)}</p>
          <div className="grid gap-2">
            {u.committees.map((c) => (
              <CommitteeRow key={c.id} c={c} P={P} onOpen={onOpen} L={L} />
            ))}
          </div>
        </div>
      )}
      {(u.deputyKey || u.memberKeys.length > 0) && (
        <div className="mt-5">
          <p className="mb-2 text-[11px] font-bold tracking-wide text-[var(--ink-muted)]">{L.departmentMembers}</p>
          <ul className="grid gap-1">
            {u.deputyKey && <MemberLine p={P[u.deputyKey]} note={P[u.deputyKey].title} onOpen={onOpen} L={L} />}
            {u.memberKeys.map((k) => (
              <MemberLine key={k} p={P[k]} note={P[k].title} onOpen={onOpen} L={L} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
