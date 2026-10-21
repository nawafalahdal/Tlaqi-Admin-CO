"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import {
  canCreateDepartment,
  createDepartment,
  deleteDepartment,
  assignMemberDepartment,
  departmentNeedsApproval,
  decideDepartmentRequest,
} from "@/lib/departments";
import { decideCommittee } from "@/lib/committees";
import { prisma } from "@/lib/prisma";
import { appendMemberEvent } from "@/lib/googleSheets";
import { safeErrorMessage } from "@/lib/safeError";

import { getLocale, getDictionary } from "@/i18n/server";
import { fmt } from "@/i18n/fmt";
export async function createDepartmentAction(
  _prev: { error: string | null; success: boolean; requested?: boolean },
  formData: FormData
): Promise<{ error: string | null; success: boolean; requested?: boolean }> {
  const L = getDictionary(await getLocale()).rDepartmentsActions;
  const session = await auth();
  if (!session) return { error: L.youNeedToSign, success: false };
  if (!canCreateDepartment(session.user.role)) {
    return { error: L.creatingDepartmentsIsFor, success: false };
  }

  const name = String(formData.get("name") ?? "");
  const colorHex = String(formData.get("colorHex") ?? "");
  const leadershipOnly = formData.get("leadershipOnly") === "on";

  // القسم الاستثنائي يتبع الإدارة العليا، فإنشاؤه بيدها وحدها —
  // ومسؤول التشغيل خارجها هنا
  if (leadershipOnly && session.user.role !== "super_admin" && session.user.role !== "executive") {
    return { error: L.anExceptionalDepartmentIs, success: false };
  }

  // المدير التنفيذي يرفع طلباً يعتمده المؤسس — والقرارُ هنا في الخادم لا في الواجهة
  const requested = departmentNeedsApproval(session.user.role);
  try {
    await createDepartment({
      name,
      colorHex,
      leadershipOnly,
      createdByName: session.user.name ?? "—",
      request: requested ? { byId: session.user.id, byName: session.user.name ?? "—" } : undefined,
    });
    revalidatePath("/admin/departments");
    revalidatePath("/admin");
    return { error: null, success: true, requested };
  } catch (err) {
    return { error: safeErrorMessage(err), success: false };
  }
}

/** تغيير لون قسم.
 *
 *  اللون جزء من الهيكل لا من عمل القسم اليومي، فيبقى بيد من يملك الهيكل:
 *  المؤسس والتنفيذي. ولا يُغيَّر اسم القسم من هنا — الاسم يحمله كل سجلّ
 *  سابق في الشيت، وتغييره يفصل السجلّ عن صاحبه. */
export async function updateDepartmentColorAction(
  departmentId: string,
  colorHex: string
): Promise<{ error: string | null }> {
  const L = getDictionary(await getLocale()).rDepartmentsActions;
  const session = await auth();
  if (!session) return { error: L.youNeedToSign };
  if (!canCreateDepartment(session.user.role)) {
    return { error: L.changingDepartmentColoursIs };
  }
  if (!/^#[0-9a-fA-F]{6}$/.test(colorHex)) {
    return { error: L.theColourMustBe };
  }

  try {
    const dept = await prisma.department.update({
      where: { id: departmentId },
      data: { colorHex },
    });
    await appendMemberEvent({
      fullName: session.user.name ?? "—",
      email: "",
      roleOrDepartment: dept.name,
      event: "تغيير لون قسم",
      details: `اللون الجديد: ${colorHex}`,
      at: new Date(),
    });
    revalidatePath("/admin/departments");
    revalidatePath("/admin");
    return { error: null };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}

/** حذف قسم — للمؤسس وحده، والتصريح يُفرض في `deleteDepartment` نفسها */
export async function deleteDepartmentAction(
  departmentId: string,
  confirmName: string
): Promise<{ error: string | null; done?: boolean; name?: string }> {
  const L = getDictionary(await getLocale()).rDepartmentsActions;
  const session = await auth();
  if (!session) return { error: L.youNeedToSign };

  try {
    const res = await deleteDepartment({
      departmentId,
      confirmName,
      actorRole: session.user.role,
      actorName: session.user.name ?? "—",
    });
    if (!res.ok) return { error: res.reason };
    revalidatePath("/admin/departments");
    revalidatePath("/admin");
    return { error: null, done: true, name: res.name };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}

/** تصنيف عضوٍ غير مصنّف في قسم — للمؤسس وحده، ولا يُعيد تصنيف من صُنِّف */
export async function assignMemberDepartmentAction(
  memberId: string,
  departmentId: string
): Promise<{ error: string | null; done?: boolean; departmentName?: string }> {
  const L = getDictionary(await getLocale()).rDepartmentsActions;
  const session = await auth();
  if (!session) return { error: L.youNeedToSign };

  try {
    const res = await assignMemberDepartment({
      memberId,
      departmentId,
      actorRole: session.user.role,
      actorName: session.user.name ?? "—",
    });
    if (!res.ok) return { error: res.reason };
    revalidatePath("/admin/people");
    revalidatePath("/admin/departments");
    revalidatePath("/admin");
    return { error: null, done: true, departmentName: res.departmentName };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}

/** قرارُ المدير التنفيذي في لجنةٍ مقترحة: فتحاً أو ردّاً بسببٍ مكتوب */
export async function decideCommitteeAction(
  committeeId: string,
  decision: "approved" | "rejected",
  note: string
): Promise<{ error: string | null; done?: boolean; message?: string }> {
  const L = getDictionary(await getLocale()).rDepartmentsActions;
  const session = await auth();
  if (!session) return { error: L.youNeedToSign };

  try {
    const res = await decideCommittee({ committeeId, decision, note, session });
    if (!res.ok) return { error: res.reason };
    revalidatePath("/admin/departments");
    revalidatePath("/admin");
    revalidatePath("/structure");
    return {
      error: null,
      done: true,
      message:
        res.decision === "approved"
          ? fmt(L.theCommitteeWasOpened, res.name, res.parentName)
          : fmt(L.theProposalWasReturned, res.name),
    };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}

/** قرارُ المؤسس في طلب إنشاء قسم — والتصريحُ يُفرض في `decideDepartmentRequest` */
export async function decideDepartmentRequestAction(
  departmentId: string,
  decision: "approved" | "rejected",
  note: string
): Promise<{ error: string | null; done?: boolean; message?: string }> {
  const L = getDictionary(await getLocale()).rDepartmentsActions;
  const session = await auth();
  if (!session) return { error: L.youNeedToSign };

  try {
    const res = await decideDepartmentRequest({ departmentId, decision, note, session });
    if (!res.ok) return { error: res.reason };
    revalidatePath("/admin/departments");
    revalidatePath("/admin");
    revalidatePath("/structure");
    return {
      error: null,
      done: true,
      message:
        res.decision === "approved"
          ? fmt(L.theDepartmentWasCreated, res.name)
          : fmt(L.theRequestWasReturned, res.name),
    };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}
