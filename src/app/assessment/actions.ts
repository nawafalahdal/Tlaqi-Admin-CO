"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { assertNotCandidate } from "@/lib/candidateGate";
import { safeErrorMessage } from "@/lib/safeError";
import {
  assignAssessment,
  cancelAssessment,
  decideSeniorPositionAssessment,
  submitAssessment,
} from "@/lib/assessments";

/** أبوابُ «اختبار العضو القائم» — الصلاحيةُ والتحقّقُ كلُّه في `lib/assessments`، وما يأتي من النموذج مُدخَلٌ يُفحص */

const s = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : "";
};

async function session() {
  const ses = await auth();
  if (!ses) throw new Error("سجّل الدخول");
  assertNotCandidate(ses);
  return ses;
}

function refresh() {
  revalidatePath("/member");
  revalidatePath("/admin/profile");
  revalidatePath("/senior/assessments");
  revalidatePath("/senior/approvals");
}

export async function submitAssessmentAction(
  assignmentId: string,
  answers: Record<string, number>
): Promise<{ ok: boolean; score: number; passed: boolean; error?: string | null }> {
  try {
    const res = await submitAssessment({ session: await session(), assignmentId, answers });
    if (!res.ok) return { ok: false, score: 0, passed: false, error: res.reason };
    refresh();
    return { ok: true, score: res.score, passed: res.passed };
  } catch (err) {
    return { ok: false, score: 0, passed: false, error: safeErrorMessage(err) };
  }
}

export type AssignState = { error: string | null; success: boolean };

export async function assignAssessmentAction(_prev: AssignState, fd: FormData): Promise<AssignState> {
  try {
    const [kind, id] = s(fd, "owner").split(":");
    if ((kind !== "member" && kind !== "user") || !id) return { error: "اختر صاحبَ الاختبار", success: false };
    const res = await assignAssessment({
      session: await session(),
      owner: { kind, id },
      trackId: s(fd, "trackId"),
      reason: s(fd, "reason"),
    });
    if (!res.ok) return { error: res.reason, success: false };
    refresh();
    return { error: null, success: true };
  } catch (err) {
    return { error: safeErrorMessage(err), success: false };
  }
}

export async function cancelAssessmentAction(assignmentId: string, reason: string): Promise<{ error: string | null }> {
  try {
    const res = await cancelAssessment({ session: await session(), assignmentId, reason });
    if (!res.ok) return { error: res.reason };
    refresh();
    return { error: null };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}

export async function decideSeniorPositionAction(
  assignmentId: string,
  decision: "approved" | "rejected",
  note: string
): Promise<{ error: string | null }> {
  try {
    if (decision !== "approved" && decision !== "rejected") return { error: "قرارٌ غير معروف" };
    const res = await decideSeniorPositionAssessment({ session: await session(), assignmentId, decision, note });
    if (!res.ok) return { error: res.reason };
    refresh();
    revalidatePath("/senior");
    return { error: null };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}
