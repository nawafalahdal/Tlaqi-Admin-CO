import type { Dictionary } from "@/i18n";
import type { MkFail } from "./result";

/** رموزُ الخادم ← جملٌ بلغة صاحب الواجهة. لا يمرّ نصٌّ عربيٌّ ثابتٌ إلى واجهةٍ إنجليزية.
 *  ويُستورد في الخادم والمتصفّح معاً، فلا يسحب وحدةً خادمية. */

type Mk = Dictionary["mk"];

/** يملأ `{name}` بقيمها — أسماءٌ لا أرقام، فتختلف مواضعُها بين اللغتين */
export function fill(s: string, params?: Record<string, string | number | null | undefined>): string {
  return s.replace(/\{([a-zA-Z]+)\}/g, (_, k: string) => {
    const v = params?.[k];
    return v === null || v === undefined ? "" : String(v);
  });
}

const pick = <T extends Record<string, string>>(map: T, key: string | number | undefined) =>
  key !== undefined && key in map ? map[key as keyof T] : key === undefined ? "" : String(key);

/** قائمةٌ مفصولةٌ بفواصل («objective,audience») ← أسماؤها مترجمة */
const list = (map: Record<string, string>, raw: string | number | undefined, sep: string) =>
  String(raw ?? "")
    .split(",")
    .filter(Boolean)
    .map((k) => pick(map, k))
    .join(sep);

export function mkMessage(mk: Mk, f: Pick<MkFail, "code" | "params">, locale: "ar" | "en"): string {
  const p = f.params ?? {};
  const sep = locale === "ar" ? "، " : ", ";
  const roleNames: Record<string, string> = {
    ...mk.capability,
    founder: mk.common.founderRole,
    campaign: mk.common.campaignMemberRole,
    assignee: mk.common.assigneeRole,
    plan_department: mk.plan.owner.department,
    plan_operations: mk.plan.owner.operations,
    plan_executive: mk.plan.owner.executive,
  };
  const missingMap: Record<string, string> = { ...mk.briefField, ...mk.capability, ...mk.blockers, ...mk.gaps, ...mk.designBrief.fields, ...mk.archive.blockers };
  const template = (mk.errors as Record<string, string>)[f.code] ?? mk.errors.unknown;
  return fill(template, {
    role: pick(roleNames, p.role),
    field: pick(mk.fields, p.field),
    missing: list(missingMap, p.missing, sep),
    reason: pick({ ...mk.ai.reasons, ...mk.chat.reasons }, p.reason),
    limit: p.limit,
    platform: p.platform,
    tasks: p.tasks,
  });
}
