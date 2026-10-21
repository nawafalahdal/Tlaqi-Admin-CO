"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canEditTrack } from "@/lib/testTracks";
import { safeErrorMessage } from "@/lib/safeError";
import { revalidatePath } from "next/cache";

import { getLocale, getDictionary } from "@/i18n/server";
async function authorizeTrack(trackId: string) {
  const L = getDictionary(await getLocale()).rTestsActions;
  const session = await auth();
  if (!session) throw new Error(L.youNeedToSign);
  const track = await prisma.testTrack.findUniqueOrThrow({ where: { id: trackId } });
  if (!canEditTrack(session, track)) throw new Error(L.youAreNotAllowed);
  return track;
}

function parseOptions(formData: FormData, missing: string) {
  const options = [0, 1, 2, 3].map((i) => String(formData.get(`option${i}`) ?? "").trim());
  if (options.some((o) => !o)) throw new Error(missing);
  return options;
}

export async function addQuestionAction(
  _prevState: { error: string | null },
  formData: FormData
): Promise<{ error: string | null }> {
  const L = getDictionary(await getLocale()).rTestsActions;
  try {
    const trackId = String(formData.get("trackId") ?? "");
    await authorizeTrack(trackId);

    const prompt = String(formData.get("prompt") ?? "").trim();
    const correctIndex = Number(formData.get("correctIndex") ?? -1);
    if (!prompt) return { error: L.theQuestionTextIs };
    if (![0, 1, 2, 3].includes(correctIndex)) return { error: L.chooseTheCorrectAnswer };
    const options = parseOptions(formData, L.allFourOptions);

    const count = await prisma.testQuestion.count({ where: { trackId } });
    await prisma.testQuestion.create({
      data: { trackId, prompt, options, correctIndex, order: count },
    });

    revalidatePath("/admin");
    return { error: null };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}

export async function updateQuestionAction(
  _prevState: { error: string | null },
  formData: FormData
): Promise<{ error: string | null }> {
  const L = getDictionary(await getLocale()).rTestsActions;
  try {
    const questionId = String(formData.get("questionId") ?? "");
    const question = await prisma.testQuestion.findUniqueOrThrow({ where: { id: questionId } });
    await authorizeTrack(question.trackId);

    const prompt = String(formData.get("prompt") ?? "").trim();
    const correctIndex = Number(formData.get("correctIndex") ?? -1);
    if (!prompt) return { error: L.theQuestionTextIs };
    if (![0, 1, 2, 3].includes(correctIndex)) return { error: L.chooseTheCorrectAnswer };
    const options = parseOptions(formData, L.allFourOptions);

    await prisma.testQuestion.update({
      where: { id: questionId },
      data: { prompt, options, correctIndex },
    });

    revalidatePath("/admin");
    return { error: null };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}

export async function deleteQuestionAction(questionId: string) {
  const question = await prisma.testQuestion.findUniqueOrThrow({ where: { id: questionId } });
  await authorizeTrack(question.trackId);
  await prisma.testQuestion.delete({ where: { id: questionId } });
  revalidatePath("/admin");
}
