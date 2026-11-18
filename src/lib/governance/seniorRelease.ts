import type { Prisma } from "@prisma/client";
import { recordOrgEvent } from "@/lib/org/audit";

/** ما يُكتب مكانَ البريد حين يُحذف صاحبُه نهائياً — «لا يبقى للبريد أثرٌ في المنصة» (قرار المؤسس) */
export const REDACTED_EMAIL = "— (حُرِّر البريد لإعادة الدعوة)";

/** **مناصبُ الإدارة العليا لمن يُحذف نهائياً** — كانت تمنع حذفَه (عطبُ الإنتاج، 18 نوفمبر 2026: «حدث خطأٌ غير متوقع»).
 *
 *  المنصبُ صفٌّ لكل تكليف يبقى بعد انتهائه سجلّاً (`SeniorPosition`)، ويشير إلى صاحبه بقيدٍ `Restrict` — فمن شغل منصباً
 *  يوماً، أو قبِل دعوةً إليه، ما كان صفُّه يُحذف ولو انتهى تكليفُه. والآن، **في معاملة الحذف نفسِها** (`db`):
 *  - **القائمُ من تكاليفه يُنهى** (نشطاً أو موقوفاً أو بانتظار البدء) بسببٍ مسمّى وبيد من حذف — لا يبقى مقعدٌ بمن لم يعد.
 *  - **ويُفَكّ عنه كلُّ تكليف** ويبقى الصفُّ تاريخاً للمقعد — كالتذاكر: تُفَكّ ولا تُحذف.
 *  - **وبريدُه يُمحى من الصفّ**، والاسمُ باقٍ كما في الشاهدة.
 *  وكلُّ ذلك حدثٌ في سجل التدقيق (`senior.position.erased`). */
export async function releaseSeniorPositions(
  db: Prisma.TransactionClient,
  who: { holderMemberId: string } | { holderUserId: string },
  ctx: { actor: { id: string; name: string; role: string }; reason: string; stamp: Date }
): Promise<number> {
  const rows = await db.seniorPosition.findMany({ where: who, select: { id: true, status: true, departmentId: true } });
  for (const p of rows) {
    const ending = p.status !== "ended";
    await db.seniorPosition.update({
      where: { id: p.id },
      data: {
        holderMemberId: null,
        holderUserId: null,
        inviteEmail: REDACTED_EMAIL,
        inviteTokenHash: null,
        ...(ending
          ? { status: "ended" as const, endedAt: ctx.stamp, endedByName: ctx.actor.name, endReason: `حذفٌ نهائيٌّ لحساب صاحبه — ${ctx.reason}`.slice(0, 400) }
          : {}),
      },
    });
    await recordOrgEvent(db, {
      scope: "senior",
      entityId: p.id,
      departmentId: p.departmentId,
      action: "senior.position.erased",
      actor: { kind: "user", id: ctx.actor.id, name: ctx.actor.name, role: ctx.actor.role },
      before: { status: p.status },
      after: { status: "ended", holder: null },
      note: ctx.reason,
    });
  }
  return rows.length;
}

/** خطأُ القاعدة حين يرفض المحوَ قيدٌ لم يُحسب — يُسمّى للمؤسس ولا يصل خامّاً («حدث خطأ غير متوقع») */
export function eraseRefusal(err: unknown): string | null {
  const code = (err as { code?: string }).code;
  const raw = String((err as Error)?.message ?? "");
  if (code === "P2003" || raw.includes("23001") || raw.includes("23503")) {
    return "ما زال في القاعدة سجلٌّ مرتبطٌ بهذا الشخص يمنع حذفه — لم يُحذف شيء، وسجلُّه على حاله";
  }
  return null;
}
