"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canEditTrack } from "@/lib/testTracks";
import { revalidatePath } from "next/cache";

async function authorizeTrack(trackId: string) {
  const session = await auth();
  if (!session) throw new Error("يجب تسجيل الدخول");
  const track = await prisma.testTrack.findUniqueOrThrow({ where: { id: trackId } });
  if (!canEditTrack(session, track)) throw new Error("غير مصرح لك بتعديل هذا الاختبار");
  return track;
}

function parseOptions(formData: FormData) {
  const options = [0, 1, 2, 3].map((i) => String(formData.get(`option${i}`) ?? "").trim());
  if (options.some((o) => !o)) throw new Error("الخيارات الأربعة مطلوبة كلها");
  return options;
}

export async function addQuestionAction(
  _prevState: { error: string | null },
  formData: FormData
): Promise<{ error: string | null }> {
  try {
    const trackId = String(formData.get("trackId") ?? "");
    await authorizeTrack(trackId);

    const prompt = String(formData.get("prompt") ?? "").trim();
    const correctIndex = Number(formData.get("correctIndex") ?? -1);
    if (!prompt) return { error: "نص السؤال مطلوب" };
    if (![0, 1, 2, 3].includes(correctIndex)) return { error: "حدّد الإجابة الصحيحة" };
    const options = parseOptions(formData);

    const count = await prisma.testQuestion.count({ where: { trackId } });
    await prisma.testQuestion.create({
      data: { trackId, prompt, options, correctIndex, order: count },
    });

    revalidatePath("/admin");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "حدث خطأ غير متوقع" };
  }
}

export async function updateQuestionAction(
  _prevState: { error: string | null },
  formData: FormData
): Promise<{ error: string | null }> {
  try {
    const questionId = String(formData.get("questionId") ?? "");
    const question = await prisma.testQuestion.findUniqueOrThrow({ where: { id: questionId } });
    await authorizeTrack(question.trackId);

    const prompt = String(formData.get("prompt") ?? "").trim();
    const correctIndex = Number(formData.get("correctIndex") ?? -1);
    if (!prompt) return { error: "نص السؤال مطلوب" };
    if (![0, 1, 2, 3].includes(correctIndex)) return { error: "حدّد الإجابة الصحيحة" };
    const options = parseOptions(formData);

    await prisma.testQuestion.update({
      where: { id: questionId },
      data: { prompt, options, correctIndex },
    });

    revalidatePath("/admin");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "حدث خطأ غير متوقع" };
  }
}

export async function deleteQuestionAction(questionId: string) {
  const question = await prisma.testQuestion.findUniqueOrThrow({ where: { id: questionId } });
  await authorizeTrack(question.trackId);
  await prisma.testQuestion.delete({ where: { id: questionId } });
  revalidatePath("/admin");
}
