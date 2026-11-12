"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { AgreementKind } from "@prisma/client";
import { auth } from "@/auth";
import { safeErrorMessage } from "@/lib/safeError";
import { safeRedirectPath } from "@/lib/safeRedirect";
import {
  agreementContext,
  requestSigningOtp,
  signAgreement,
  createDraftTemplate,
  updateDraftTemplate,
  publishTemplate,
  requestSignature,
  cancelRequirement,
  grantAsset,
  revokeAsset,
  reportIncident,
  reviewIncident,
  subjectByEmail,
  parseSubject,
} from "@/lib/governance/agreements";
import { DEFAULT_AGREEMENTS } from "@/lib/governance/agreementTexts";
import { queueGovernanceSync } from "@/lib/governance/sheets";
import type { FormState } from "../committees/actions";

/** أبوابُ الاتفاقيات — الصلاحيةُ والتحقّقُ كلُّه في `lib/governance/agreements`؛ وما يأتي من النموذج مُدخَلٌ يُفحص */
const s = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : "";
};
const kindOf = (fd: FormData): AgreementKind | null => (s(fd, "kind") === "marketing" || s(fd, "kind") === "technical" ? (s(fd, "kind") as AgreementKind) : null);
const ctx = async () => agreementContext(await auth());

async function run(fn: () => Promise<{ ok: true } | { ok: false; reason: string }>, message: string): Promise<FormState> {
  try {
    const res = await fn();
    if (!res.ok) return { error: res.reason, success: false };
    revalidatePath("/agreements");
    revalidatePath("/agreements/manage");
    await queueGovernanceSync(message);
    return { error: null, success: true, message };
  } catch (err) {
    return { error: safeErrorMessage(err), success: false };
  }
}

export async function requestOtpAction(_p: FormState, fd: FormData): Promise<FormState> {
  const kind = kindOf(fd);
  if (!kind) return { error: "نوعٌ غير معروف", success: false };
  try {
    const res = await requestSigningOtp(await ctx(), kind);
    if (!res.ok) return { error: res.reason, success: false };
    return { error: null, success: true, message: res.delivered ? "أُرسل رمز التحقّق إلى بريدك — صالحٌ عشر دقائق" : "أُنشئ الرمز (البريد معطّل في هذه البيئة)" };
  } catch (err) {
    return { error: safeErrorMessage(err), success: false };
  }
}

export async function signAction(_p: FormState, fd: FormData): Promise<FormState> {
  const kind = kindOf(fd);
  if (!kind) return { error: "نوعٌ غير معروف", success: false };
  let id: string;
  try {
    const res = await signAgreement(await ctx(), {
      kind,
      templateId: s(fd, "templateId"),
      documentHash: s(fd, "documentHash"),
      typedName: s(fd, "typedName"),
      otp: s(fd, "otp"),
      readAll: s(fd, "readAll") === "on",
      consent: s(fd, "consent") === "on",
      userAgent: (await headers()).get("user-agent"),
    });
    if (!res.ok) return { error: res.reason, success: false };
    id = res.signatureId;
  } catch (err) {
    return { error: safeErrorMessage(err), success: false };
  }
  revalidatePath("/agreements");
  await queueGovernanceSync("توقيع اتفاقية");
  const next = s(fd, "next");
  redirect(next ? safeRedirectPath(next) : `/agreements/signed/${id}`);
}

export async function draftFromDefaultAction(_p: FormState, fd: FormData): Promise<FormState> {
  const kind = kindOf(fd);
  if (!kind) return { error: "نوعٌ غير معروف", success: false };
  const d = DEFAULT_AGREEMENTS[kind];
  return run(async () => createDraftTemplate(await ctx(), { kind, titleAr: d.titleAr, titleEn: d.titleEn, body: d.body, changeNote: "النص المقترح — للمراجعة القانونية" }), "أُنشئت مسودّةٌ من النص المقترح");
}

export async function saveDraftAction(_p: FormState, fd: FormData): Promise<FormState> {
  return run(async () => updateDraftTemplate(await ctx(), s(fd, "templateId"), { titleAr: s(fd, "titleAr"), titleEn: s(fd, "titleEn"), body: s(fd, "body"), changeNote: s(fd, "changeNote") }), "حُفظت المسودّة");
}

export async function publishAction(_p: FormState, fd: FormData): Promise<FormState> {
  return run(async () => publishTemplate(await ctx(), s(fd, "templateId"), s(fd, "note")), "نُشر الإصدار — ومن وقّع السابق يُطلب منه التوقيع على الجديد");
}

export async function requestSignatureAction(_p: FormState, fd: FormData): Promise<FormState> {
  const kind = kindOf(fd);
  if (!kind) return { error: "نوعٌ غير معروف", success: false };
  return run(async () => {
    const subject = s(fd, "subject") ? parseSubject(s(fd, "subject")) : await subjectByEmail(s(fd, "email"));
    if (!subject) return { ok: false as const, reason: "لا حسابَ نشطاً بهذا البريد" };
    return requestSignature(await ctx(), subject, kind, s(fd, "reason"));
  }, "أُرسل طلب التوقيع");
}

export async function cancelRequirementAction(_p: FormState, fd: FormData): Promise<FormState> {
  return run(async () => cancelRequirement(await ctx(), s(fd, "requirementId"), s(fd, "reason")), "أُلغي طلب التوقيع");
}

export async function grantAssetAction(_p: FormState, fd: FormData): Promise<FormState> {
  const kind = kindOf(fd);
  if (!kind) return { error: "نوعٌ غير معروف", success: false };
  return run(async () => {
    const holder = await subjectByEmail(s(fd, "email"));
    if (!holder) return { ok: false as const, reason: "لا حسابَ نشطاً بهذا البريد" };
    return grantAsset(await ctx(), { category: kind, assetKey: s(fd, "asset"), holder });
  }, "مُنح الوصول");
}

export async function revokeAssetAction(_p: FormState, fd: FormData): Promise<FormState> {
  return run(async () => revokeAsset(await ctx(), s(fd, "grantId"), s(fd, "reason")), "سُحب الوصول");
}

export async function reportIncidentAction(_p: FormState, fd: FormData): Promise<FormState> {
  const kind = kindOf(fd);
  if (!kind) return { error: "نوعٌ غير معروف", success: false };
  return run(async () => {
    const subject = await subjectByEmail(s(fd, "email"));
    if (!subject) return { ok: false as const, reason: "لا حسابَ نشطاً بهذا البريد" };
    return reportIncident(await ctx(), { kind, subject, description: s(fd, "description"), evidence: s(fd, "evidence") });
  }, "سُجّل البلاغ — يُراجَع بشرياً");
}

export async function reviewIncidentAction(_p: FormState, fd: FormData): Promise<FormState> {
  const to = s(fd, "to");
  if (to !== "under_review" && to !== "closed") return { error: "حالةٌ غير معروفة", success: false };
  return run(async () => reviewIncident(await ctx(), s(fd, "incidentId"), { to, note: s(fd, "note"), outcome: s(fd, "outcome") }), "حُدّث البلاغ");
}
