import { CAPABILITIES, eligiblePeople, listTeam, marketingSettings } from "@/lib/marketing/team";
import { listFormats } from "@/lib/marketing/formats";
import { aiStatus } from "@/lib/marketing/ai/registry";
import { marketingPage } from "@/lib/marketing/page";
import { MkHeader } from "../_components/MkHeader";
import { ActionForm } from "../_components/ActionForm";
import { Pill, Section, Field, inputCls, Muted } from "../_components/bits";

export const dynamic = "force-dynamic";

/** إعداداتُ الوكيل — لمدير الفريق (والمؤسس ضمناً).
 *
 *  - **الفريق:** المنحُ صريحٌ مسؤوليةً مسؤولية. «إدارة الفريق» لا تُعرض خانتُها
 *    إلا للمؤسس، ولا يعدّل مديرٌ مسؤولياتِ نفسه (الخادمُ يفرض الأمرين).
 *  - **المقاسات:** تعديلُها لا يمسّ المخرجات القائمة — كلٌّ يحفظ مقاسه.
 *  - **السياسة:** لقائد التسويق.
 *  - **التكاملات:** حالتُها من الإعدادات الفعلية، لا ادّعاء. */
export default async function MarketingSettingsPage() {
  const { actor, mk, isManager, locale } = await marketingPage("/marketing/settings");
  if (!isManager) {
    return (
      <main className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-6 sm:px-5 sm:py-8">
        <MkHeader mk={mk} current={null} isManager={false} title={mk.settings.title} />
        <Muted>{mk.settings.notManager}</Muted>
      </main>
    );
  }
  const [team, people, formats, settings] = await Promise.all([listTeam(actor), eligiblePeople(actor), listFormats(true), marketingSettings()]);
  const ai = aiStatus();
  const L = mk.settings;
  // «قائد التسويق» من هيكل المنصة لا يُمنح — فلا خانةَ له
  const grantable = CAPABILITIES;
  const textReason = ai.text.reason ? (mk.ai.reasons as Record<string, string>)[ai.text.reason] ?? ai.text.reason : null;

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-6 sm:px-5 sm:py-8">
      <MkHeader mk={mk} current="settings" isManager title={L.title} />

      <Section title={L.team} hint={L.teamHint}>
        <ul className="flex flex-col gap-3">
          {(team ?? []).map((m) => {
            // كما في `grantAllowed`: لا يعدّل أحدٌ مسؤولياته هو
            const locked = actor.member?.id === m.id;
            return (
              <li key={m.id} className="rounded-xl border border-black/[0.08] p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-bold">{m.fullName}</span>
                  <span className="text-xs text-black/45" dir="ltr">{m.email}</span>
                  {!m.active && <Pill tone="bad">{mk.campaign.inactive}</Pill>}
                  {!m.accountLive && <Pill tone="review">{L.accountInactive}</Pill>}
                </div>
                {locked ? (
                  <p className="mt-2 flex flex-wrap gap-1.5">
                    {m.capabilities.map((c) => (
                      <Pill key={c} tone="progress">{mk.capability[c]}</Pill>
                    ))}
                  </p>
                ) : (
                  <div className="mt-2 flex flex-col gap-2">
                    <ActionForm op="team.caps" submit={L.saveCapabilities} variant="outline">
                      <input type="hidden" name="memberId" value={m.id} />
                      <div className="flex flex-wrap gap-x-4 gap-y-2">
                        {grantable.map((c) => (
                          <label key={c} className="flex items-center gap-1.5 text-xs" title={mk.capabilityHint[c]}>
                            <input type="checkbox" name="capabilities" value={c} defaultChecked={m.capabilities.includes(c)} />
                            {mk.capability[c]}
                          </label>
                        ))}
                      </div>
                    </ActionForm>
                    <ActionForm op="team.active" submit={m.active ? L.deactivate : L.reactivate} variant={m.active ? "ghost" : "outline"}>
                      <input type="hidden" name="memberId" value={m.id} />
                      <input type="hidden" name="active" value={m.active ? "0" : "1"} />
                    </ActionForm>
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        <details className="mt-4 border-t border-black/5 pt-3">
          <summary className="cursor-pointer text-sm font-bold">{L.addPerson}</summary>
          <div className="mt-3">
            {(people ?? []).length === 0 ? (
              <Muted>{L.noEligible}</Muted>
            ) : (
              <ActionForm op="team.add" submit={L.add} resetOnSuccess>
                <Field label={L.person}>
                  <select name="person" required className={inputCls}>
                    {(people ?? []).map((p) => (
                      <option key={`${p.kind}:${p.id}`} value={`${p.kind}:${p.id}`}>
                        {p.fullName}{p.department ? ` — ${p.department}` : ""}
                      </option>
                    ))}
                  </select>
                </Field>
                <div className="flex flex-col gap-1.5">
                  {grantable.map((c) => (
                    <label key={c} className="flex items-start gap-2 text-sm">
                      <input type="checkbox" name="capabilities" value={c} className="mt-1" />
                      <span>
                        <span className="font-bold">{mk.capability[c]}</span>
                        <span className="block text-xs text-black/55">{mk.capabilityHint[c]}</span>
                      </span>
                    </label>
                  ))}
                  <p className="text-[11px] text-black/50">{L.leadFromOrg}</p>
                </div>
              </ActionForm>
            )}
          </div>
        </details>
      </Section>

      <Section title={L.formats} hint={L.formatsHint}>
        <ul className="flex flex-col gap-3">
          {formats.map((f) => (
            <li key={f.id} className="rounded-xl border border-black/[0.08] p-3">
              <details>
                <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm">
                  <span className="font-bold">{locale === "en" ? f.nameEn : f.nameAr}</span>
                  <span className="text-xs text-black/55" dir="ltr">{f.key} · {f.width}×{f.height} · {f.platforms.join(", ")}</span>
                  {!f.active && <Pill>{mk.campaign.inactive}</Pill>}
                </summary>
                <div className="mt-3">
                  <ActionForm op="format.update" submit={L.saveFormat} variant="outline">
                    <input type="hidden" name="formatId" value={f.id} />
                    <FormatFields mk={mk} value={f} />
                    <input type="hidden" name="activeField" value="1" />
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" name="active" defaultChecked={f.active} />
                      {L.active}
                    </label>
                  </ActionForm>
                </div>
              </details>
            </li>
          ))}
        </ul>
        <details className="mt-4 border-t border-black/5 pt-3">
          <summary className="cursor-pointer text-sm font-bold">{L.createFormat}</summary>
          <div className="mt-3">
            <ActionForm op="format.create" submit={L.createFormat} resetOnSuccess>
              <Field label={L.formatKey}>
                <input name="key" required pattern="[a-z0-9_-]+" maxLength={40} dir="ltr" className={inputCls} />
              </Field>
              <FormatFields mk={mk} />
            </ActionForm>
          </div>
        </details>
      </Section>

      <Section title={L.policy} hint={actor.isMarketingLead ? undefined : L.policyLead}>
        {actor.isMarketingLead ? (
          <ActionForm op="settings.policy" submit={L.savePolicy} variant="outline">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="requireSeparateApprover" defaultChecked={settings.requireSeparateApprover} />
              {L.separateApprover}
            </label>
          </ActionForm>
        ) : (
          <p className="flex items-center gap-2 text-sm">
            <Pill tone={settings.requireSeparateApprover ? "good" : "review"}>{settings.requireSeparateApprover ? "✓" : "✕"}</Pill>
            {L.separateApprover}
          </p>
        )}
      </Section>

      <Section title={L.integrations} hint={L.integrationsHint}>
        <dl className="flex flex-col divide-y divide-black/[0.06] text-sm">
          <div className="flex flex-wrap items-center gap-2 py-2">
            <dt className="font-bold">{L.textAi}</dt>
            <dd className="flex flex-wrap items-center gap-2">
              <Pill tone={ai.text.state === "ready" ? "good" : "neutral"}>{mk.ai.states[ai.text.state]}</Pill>
              {textReason && <span className="text-xs text-black/55">{textReason}</span>}
              {ai.text.simulated && <Pill tone="review">{mk.ai.simulated}</Pill>}
              {ai.text.state === "ready" && ai.text.model && <span className="text-xs text-black/45" dir="ltr">{ai.text.model}</span>}
            </dd>
          </div>
          <div className="flex flex-wrap items-center gap-2 py-2">
            <dt className="font-bold">{L.imageAi}</dt>
            <dd className="text-xs text-black/60">{mk.ai.imageState}</dd>
          </div>
          <div className="flex flex-wrap items-center gap-2 py-2">
            <dt className="font-bold">{L.drive}</dt>
            <dd className="text-xs text-black/60">{L.driveState}</dd>
          </div>
          <div className="flex flex-wrap items-center gap-2 py-2">
            <dt className="font-bold">{L.social}</dt>
            <dd className="text-xs text-black/60">{L.socialState}</dd>
          </div>
        </dl>
        {ai.text.state !== "ready" && <p className="mt-2 text-[11px] leading-relaxed text-black/50" dir="auto">{L.enableHow}</p>}
      </Section>
    </main>
  );
}

function FormatFields({ mk, value }: { mk: Parameters<typeof MkHeader>[0]["mk"]; value?: { nameAr: string; nameEn: string; width: number; height: number; safeTop: number; safeRight: number; safeBottom: number; safeLeft: number; platforms: string[] } }) {
  const L = mk.settings;
  const num = (name: string, v: number | undefined, label: string) => (
    <Field label={label}>
      <input name={name} type="number" min={0} step={1} required defaultValue={v} className={inputCls} />
    </Field>
  );
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label={L.nameAr}>
        <input name="nameAr" required maxLength={60} defaultValue={value?.nameAr} className={inputCls} />
      </Field>
      <Field label={L.nameEn}>
        <input name="nameEn" required maxLength={60} defaultValue={value?.nameEn} dir="ltr" className={inputCls} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        {num("width", value?.width, L.width)}
        {num("height", value?.height, L.height)}
      </div>
      <Field label={L.platforms}>
        <input name="platforms" defaultValue={value?.platforms.join(", ")} dir="ltr" className={inputCls} />
      </Field>
      <fieldset className="sm:col-span-2">
        <legend className="mb-1.5 text-xs font-bold text-black/70">{L.safe}</legend>
        <div className="grid grid-cols-4 gap-2">
          {(["safeTop", "safeRight", "safeBottom", "safeLeft"] as const).map((k) => (
            <input key={k} name={k} type="number" min={0} step={1} required defaultValue={value?.[k] ?? 0} aria-label={L.safeSides[k]} placeholder={L.safeSides[k]} className={inputCls} />
          ))}
        </div>
      </fieldset>
    </div>
  );
}
