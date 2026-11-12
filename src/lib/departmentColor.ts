import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/** **لونُ القسم — مصدرٌ واحد: صفُّه في القاعدة (`Department.colorHex`).**
 *
 *  **السببُ الجذري لاختلاط الألوان** (تدقيق GA-6): كان لون القسم يُقرأ من خمسة مصادر متعارضة — صفُّه في القاعدة،
 *  وسجلٌّ في `brand.ts` بالمعرّف أو الاسم، وخريطةٌ في الهيكل **بالاسم** (`DEPARTMENT_DISPLAY`)، ونصوصُ الترحيب بالاسم،
 *  ومتغيّراتُ CSS بقيمٍ ثالثة. والأرشفةُ **تغيّر اسم القسم ومعرّفه** («— مؤرشف …»)، فيفقد القسمُ المؤرشفُ لونَه في الهيكل
 *  وصور الأعضاء، ويرث لونَه من يأتي بعده بالاسم نفسه. وفوق ذلك كان القسمُ الجديد يبدأ بأول لونٍ في القائمة — لونِ
 *  التسويق — فيتشارك قسمان لوناً واحداً بعد حذفٍ وإنشاء.
 *
 *  **والعلاج:**
 *  1. اللونُ صفةٌ للقسم نفسه، تُقرأ من صفّه وحده — لا من اسمه ولا من ترتيبه ولا من وجود غيره.
 *  2. اللجنةُ تأخذ لونَ قسمها عند القراءة (لا نسخةً قديمة)، وتغييرُ لون القسم يُحدّث لجانه في المعاملة نفسها.
 *  3. **لونٌ واحدٌ لقسمٍ واحد:** لا يُنشأ قسمٌ ولا يُغيَّر لونُه إلى لونٍ يحمله قسمٌ آخر — ولو مؤرشفاً (فيعود بلونه).
 *     والفحصُ في الخادم بقفلٍ (لا قسمان متزامنان باللون نفسه)، والقسمُ الجديد يبدأ بأول لونٍ غيرِ مستعمل. */

type Db = Prisma.TransactionClient | typeof prisma;

/** ألوانُ التمييز المعتمدة: الأربعةُ الرسمية للأقسام الرسمية، ثم ألوانُ التمييز المعتمدة سابقاً للأقسام الأخرى */
export { DEPARTMENT_SWATCHES } from "./departmentColorSwatches";
import { DEPARTMENT_SWATCHES } from "./departmentColorSwatches";

export const normalizeHex = (hex: string) => hex.trim().toUpperCase();

/** لونُ العرض: لونُ القسم من صفّه؛ واللجنةُ بلون قسمها */
export function departmentColor(d: { colorHex: string; parent?: { colorHex: string } | null }): string {
  return normalizeHex(d.parent?.colorHex ?? d.colorHex);
}

/** من يحمل هذا اللون من الأقسام الأصيلة (مؤرشفةً أو نشطة) — غيرَ القسم المستثنى */
export async function colorHolder(db: Db, colorHex: string, exceptId?: string | null) {
  const rows = await db.$queryRaw<{ id: string; name: string }[]>`
    SELECT "id", "name" FROM "Department"
    WHERE "parentId" IS NULL AND upper("colorHex") = ${normalizeHex(colorHex)}
      AND ("committeeStatus" IS NULL OR "committeeStatus" <> 'rejected')
      ${exceptId ? Prisma.sql`AND "id" <> ${exceptId}` : Prisma.empty}
    LIMIT 1`;
  return rows[0] ?? null;
}

/** أولُ لونٍ معتمدٍ لم يحمله قسمٌ بعد — بدايةُ نموذج القسم الجديد */
export async function firstFreeSwatch(db: Db = prisma): Promise<string> {
  const used = new Set(
    (await db.department.findMany({ where: { parentId: null, OR: [{ committeeStatus: null }, { committeeStatus: { not: "rejected" } }] }, select: { colorHex: true } })).map((d) => normalizeHex(d.colorHex))
  );
  return DEPARTMENT_SWATCHES.find((c) => !used.has(c)) ?? DEPARTMENT_SWATCHES[DEPARTMENT_SWATCHES.length - 1];
}

/** الألوانُ المحجوزة وأصحابُها — لتعطيلها في المنتقي */
export async function takenColors(db: Db = prisma): Promise<Record<string, string>> {
  const rows = await db.department.findMany({ where: { parentId: null, OR: [{ committeeStatus: null }, { committeeStatus: { not: "rejected" } }] }, select: { colorHex: true, name: true } });
  return Object.fromEntries(rows.map((r) => [normalizeHex(r.colorHex), r.name]));
}

/** قفلُ ألوان الأقسام — إنشاءان متزامنان لا يأخذان اللونَ نفسه */
export async function lockDepartmentColors(tx: Prisma.TransactionClient) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('tlaqi:department-colors'))`;
}

/** **تغييرُ لون قسم** — بلونٍ لم يحمله غيرُه، وتتبعه لجانُه في المعاملة نفسها (فلا تبقى نسخةٌ قديمة) */
export async function updateDepartmentColor(departmentId: string, colorHex: string): Promise<{ ok: true; name: string } | { ok: false; reason: string }> {
  if (!/^#[0-9a-fA-F]{6}$/.test(colorHex)) return { ok: false, reason: "اللون يجب أن يكون بصيغة #RRGGBB" };
  const color = normalizeHex(colorHex);
  return prisma.$transaction(async (tx) => {
    await lockDepartmentColors(tx);
    const dept = await tx.department.findUnique({ where: { id: departmentId }, select: { id: true, name: true, parentId: true } });
    if (!dept) return { ok: false as const, reason: "القسم غير موجود" };
    if (dept.parentId) return { ok: false as const, reason: "لونُ اللجنة لونُ قسمها — يُغيَّر من القسم" };
    const holder = await colorHolder(tx, color, dept.id);
    if (holder) return { ok: false as const, reason: `هذا اللونُ لقسم «${holder.name}» — اختر لوناً غيره` };
    await tx.department.update({ where: { id: dept.id }, data: { colorHex: color } });
    // department-scope: all — لجانُ القسم كلُّها (ومنها المؤرشفة) تتبع لونَه
    await tx.department.updateMany({ where: { parentId: dept.id }, data: { colorHex: color } });
    return { ok: true as const, name: dept.name };
  });
}
