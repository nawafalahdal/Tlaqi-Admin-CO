import { prisma } from "@/lib/prisma";
import { hasCapability, type MkActor } from "./access";
import { logEvent } from "./audit";
import { fail, guarded, type MkResult } from "./result";

/** المقاسات: قوالبُ أبعادٍ ومناطقِ أمانٍ تُدار ولا تُكتب في الكود.
 *
 *  تعديلُ المقاس يرفع رقمَ مراجعته ولا يمسّ مخرجاً قائماً — فالمخرجُ نسخ
 *  أبعادَه عند إنشائه، ومن أراد المقاسَ الجديد غيّر مقاسَ المخرج صراحةً
 *  (فيسقط تصميمُه واعتمادُه). */

const MIN_SIDE = 200;
const MAX_SIDE = 8000;

export async function listFormats(includeInactive = false) {
  return prisma.marketingFormat.findMany({ where: includeInactive ? {} : { active: true }, orderBy: [{ active: "desc" }, { createdAt: "asc" }] });
}

type FormatInput = {
  key?: string;
  nameAr: string;
  nameEn: string;
  width: number | string;
  height: number | string;
  safeTop?: number | string;
  safeRight?: number | string;
  safeBottom?: number | string;
  safeLeft?: number | string;
  platforms?: string[];
  active?: boolean;
};

function parse(input: FormatInput) {
  const int = (v: unknown) => Math.round(Number(v ?? 0));
  const width = int(input.width);
  const height = int(input.height);
  if (!Number.isFinite(width) || width < MIN_SIDE || width > MAX_SIDE) return null;
  if (!Number.isFinite(height) || height < MIN_SIDE || height > MAX_SIDE) return null;
  const safe = [input.safeTop, input.safeRight, input.safeBottom, input.safeLeft].map(int);
  if (safe.some((s) => !Number.isFinite(s) || s < 0)) return null;
  // منطقةُ أمانٍ تأكل المقاسَ كلَّه ليست منطقةَ أمان
  if (safe[0] + safe[2] >= height * 0.8 || safe[1] + safe[3] >= width * 0.8) return null;
  const nameAr = input.nameAr?.trim().slice(0, 60);
  const nameEn = input.nameEn?.trim().slice(0, 60);
  if (!nameAr || !nameEn) return null;
  return {
    nameAr,
    nameEn,
    width,
    height,
    safeTop: safe[0],
    safeRight: safe[1],
    safeBottom: safe[2],
    safeLeft: safe[3],
    platforms: [...new Set((input.platforms ?? []).map((p) => p.trim().toLowerCase().slice(0, 30)).filter(Boolean))].slice(0, 12),
  };
}

export async function createFormat(actor: MkActor, input: FormatInput): Promise<MkResult<{ formatId: string }>> {
  return guarded(async () => {
    if (!hasCapability(actor, "manager")) return fail("forbidden", { role: "manager" });
    const key = input.key?.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 40);
    if (!key) return fail("invalid_input", { field: "key" });
    const data = parse(input);
    if (!data) return fail("invalid_input", { field: "dimensions" });
    if (await prisma.marketingFormat.count({ where: { key } })) return fail("invalid_input", { field: "key" });
    return prisma.$transaction(async (tx) => {
      const f = await tx.marketingFormat.create({ data: { ...data, key, updatedByName: actor.name }, select: { id: true } });
      await logEvent(tx, actor, { action: "format.created", details: { key, width: data.width, height: data.height } });
      return { ok: true as const, formatId: f.id };
    });
  });
}

export async function updateFormat(actor: MkActor, formatId: string, input: FormatInput): Promise<MkResult> {
  return guarded(async () => {
    if (!hasCapability(actor, "manager")) return fail("forbidden", { role: "manager" });
    const before = await prisma.marketingFormat.findUnique({ where: { id: formatId } });
    if (!before) return fail("not_found");
    const data = parse(input);
    if (!data) return fail("invalid_input", { field: "dimensions" });
    const geometryChanged =
      data.width !== before.width || data.height !== before.height ||
      data.safeTop !== before.safeTop || data.safeRight !== before.safeRight || data.safeBottom !== before.safeBottom || data.safeLeft !== before.safeLeft;
    await prisma.$transaction(async (tx) => {
      await tx.marketingFormat.update({
        where: { id: formatId },
        data: { ...data, active: input.active ?? before.active, updatedByName: actor.name, ...(geometryChanged ? { revision: { increment: 1 } } : {}) },
      });
      await logEvent(tx, actor, {
        action: "format.updated",
        details: { key: before.key, from: { width: before.width, height: before.height, active: before.active }, to: { width: data.width, height: data.height, active: input.active ?? before.active }, revisionBumped: geometryChanged },
      });
    });
    return { ok: true };
  });
}
