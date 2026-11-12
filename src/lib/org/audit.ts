import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { OrgActor } from "./actor";

type Db = Prisma.TransactionClient | typeof prisma;

/** نتيجةُ إجراءٍ في الهيكل واللجان — نجاحٌ بقيمته، أو رفضٌ بسببه المكتوب */
export type OrgResult<T extends object = object> = ({ ok: true } & T) | { ok: false; reason: string };

export const fail = (reason: string): { ok: false; reason: string } => ({ ok: false, reason });

/** يكتب حدثاً في سجلّ التدقيق — داخل معاملة الإجراء نفسِه.
 *
 *  **والسجلُّ إلحاقٌ فقط:** لا يُعدَّل صفٌّ فيه ولا يُحذف — قادحٌ في القاعدة (`OrgAuditEvent_append_only`)
 *  يرفض ذلك من أي طريق، ولو من شيفرة المنصة نفسها.
 *
 *  **ولا يُكتب الحدثُ بعد المعاملة:** إجراءٌ نجح ولم يُسجَّل يُخفي من فعل،
 *  وسجلٌّ كُتب لإجراءٍ فشل يكذب. فكلاهما في المعاملة نفسِها: يقعان معاً أو
 *  لا يقعان. والقيمُ قبل وبعد ما تغيّر وحده — لا الصفُّ كلُّه. */
export async function recordOrgEvent(
  db: Db,
  e: {
    scope: "committee" | "department" | "member" | "senior" | "agreement" | "account";
    entityId: string;
    departmentId: string;
    action: string;
    /** ومعه دورُه **وقتَ التنفيذ** — يُحفَظ في الحدث فلا يتبدّل بتبدّل دوره لاحقاً */
    actor: Pick<OrgActor, "id" | "name"> & { kind: OrgActor["kind"] | "system"; role?: string | null };
    before?: Prisma.InputJsonValue | null;
    after?: Prisma.InputJsonValue | null;
    note?: string | null;
    /** `denied` لمحاولةٍ مرفوضة في إجراءٍ حساس — تُسجَّل كما يُسجَّل النجاح */
    result?: "success" | "denied";
  }
) {
  await db.orgAuditEvent.create({
    data: {
      scope: e.scope,
      entityId: e.entityId,
      departmentId: e.departmentId,
      action: e.action,
      actorKind: e.actor.kind,
      actorId: e.actor.id,
      actorName: e.actor.name,
      actorRole: e.actor.role ?? (e.actor.kind === "system" ? "system" : null),
      result: e.result ?? "success",
      before: e.before ?? undefined,
      after: e.after ?? undefined,
      note: e.note ?? null,
    },
  });
}

/** ما تغيّر بين صفّين — `{before, after}` بالحقول المتغيّرة وحدها، أو `null` إن لم يتغيّر شيء */
export function diffFields<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>
): { before: Record<string, unknown>; after: Record<string, unknown> } | null {
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  for (const key of Object.keys(after)) {
    const prev = norm(before[key]);
    const next = norm(after[key]);
    if (prev !== next) {
      b[key] = prev;
      a[key] = next;
    }
  }
  return Object.keys(a).length ? { before: b, after: a } : null;
}

function norm(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (v === undefined || v === "") return null;
  return v;
}
