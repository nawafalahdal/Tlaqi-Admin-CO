"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { SeniorPositionStatus } from "@prisma/client";
import { auth } from "@/auth";
import { safeErrorMessage } from "@/lib/safeError";
import {
  seniorContext,
  createSeniorInvitation,
  sendSeniorInvitation,
  cancelSeniorInvitation,
  updateSeniorPosition,
  setSeniorPositionStatus,
  acceptSeniorInvitation,
  type PositionInput,
} from "@/lib/governance/senior";
import { queueGovernanceSync } from "@/lib/governance/sheets";
import type { FormState } from "../committees/actions";

/** أبوابُ صفحة الإدارة العليا — لا يُقرَّر هنا شيء: صاحبُ الطلب وصلاحيتُه من القاعدة (`seniorContext`)،
 *  والقرارُ والسجلُّ في `lib/governance/senior`. وما يأتي من النموذج مُدخَلٌ يُفحص، لا إذن. */

const s = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : "";
};

function position(fd: FormData): PositionInput {
  return {
    titleAr: s(fd, "titleAr"),
    titleEn: s(fd, "titleEn"),
    description: s(fd, "description"),
    responsibilities: s(fd, "responsibilities"),
    capabilities: fd.getAll("capabilities").map(String),
    startDate: s(fd, "startDate") || null,
    notes: s(fd, "notes"),
  };
}

async function run(fn: (ctx: Awaited<ReturnType<typeof seniorContext>>) => Promise<{ ok: true } | { ok: false; reason: string }>, message: string): Promise<FormState> {
  try {
    const ctx = await seniorContext(await auth());
    const res = await fn(ctx);
    if (!res.ok) return { error: res.reason, success: false };
    revalidatePath("/senior");
    await queueGovernanceSync(message);
    return { error: null, success: true, message };
  } catch (err) {
    return { error: safeErrorMessage(err), success: false };
  }
}

export async function createInviteAction(_p: FormState, fd: FormData): Promise<FormState> {
  const send = s(fd, "intent") === "send";
  return run(
    (ctx) => createSeniorInvitation(ctx, { ...position(fd), inviteName: s(fd, "inviteName"), inviteEmail: s(fd, "inviteEmail"), send }),
    send ? "أُنشئت الدعوة وأُرسلت" : "حُفظت الدعوة مسودّة"
  );
}

export async function sendInviteAction(_p: FormState, fd: FormData): Promise<FormState> {
  return run((ctx) => sendSeniorInvitation(ctx, s(fd, "positionId")), "أُرسلت الدعوة برابطٍ جديد");
}

export async function cancelInviteAction(_p: FormState, fd: FormData): Promise<FormState> {
  return run((ctx) => cancelSeniorInvitation(ctx, s(fd, "positionId"), s(fd, "reason")), "أُلغيت الدعوة");
}

export async function updatePositionAction(_p: FormState, fd: FormData): Promise<FormState> {
  return run((ctx) => updateSeniorPosition(ctx, s(fd, "positionId"), position(fd)), "حُفظ التكليف");
}

export async function setPositionStatusAction(_p: FormState, fd: FormData): Promise<FormState> {
  const to = s(fd, "to");
  if (!["active", "suspended", "ended"].includes(to)) return { error: "حالةٌ غير معروفة", success: false };
  return run((ctx) => setSeniorPositionStatus(ctx, s(fd, "positionId"), to as SeniorPositionStatus, s(fd, "reason")), "تغيّرت حالةُ التكليف");
}

/** قبولُ الدعوة — بلا جلسةٍ لمدعوٍّ جديد، وبجلسة صاحب البريد لمن له حساب */
export async function acceptInviteAction(_p: FormState, fd: FormData): Promise<FormState> {
  const token = s(fd, "token");
  let mode: "linked" | "created";
  try {
    const res = await acceptSeniorInvitation(token, { session: await auth(), password: s(fd, "password") });
    if (!res.ok) return { error: res.reason, success: false };
    mode = res.mode;
  } catch (err) {
    return { error: safeErrorMessage(err), success: false };
  }
  revalidatePath("/senior");
  await queueGovernanceSync("قبول دعوة الإدارة العليا");
  redirect(mode === "created" ? "/login?callbackUrl=%2Fsenior" : "/senior");
}

/** مزامنةُ تبويبات الحوكمة الآن — للمؤسس والرئيس التنفيذي (والنتيجةُ في سجل المزامنة) */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- توقيعُ useActionState يفرض المعاملين
export async function syncGovernanceNowAction(_p: FormState, _fd: FormData): Promise<FormState> {
  try {
    const ctx = await seniorContext(await auth());
    if (!ctx.account || !["super_admin", "executive"].includes(ctx.account.role)) return { error: "المزامنةُ اليدوية للمؤسس والرئيس التنفيذي", success: false };
    const { syncGovernanceSheets } = await import("@/lib/governance/sheets");
    const r = await syncGovernanceSheets(`يدوياً — ${ctx.account.name}`);
    revalidatePath("/senior/log");
    if (r.skipped === "running") return { error: "مزامنةٌ جارية الآن — أعد المحاولة بعد دقيقة", success: false };
    if (r.skipped === "disabled") return { error: "تكامل Google Sheets غير مضبوط في هذه البيئة", success: false };
    return r.ok ? { error: null, success: true, message: `زُومنت ${r.rows} صفّاً` } : { error: `تعذّرت المزامنة (${r.error}) — البياناتُ سليمة في المنصة`, success: false };
  } catch (err) {
    return { error: safeErrorMessage(err), success: false };
  }
}
