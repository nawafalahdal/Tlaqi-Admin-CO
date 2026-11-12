import type { BrandItemStatus } from "@prisma/client";

/** شاراتُ الحالة في مركز الهوية — بالواجهة الحالية (الهويةُ الجديدة لم تُعتمد بعد) */
export const STATUS_CLS: Record<BrandItemStatus, string> = {
  draft: "border border-black/30",
  ready_for_review: "bg-sky-100 text-sky-900",
  pending_approval: "bg-amber-100 text-amber-900",
  changes_requested: "bg-red-50 text-red-800",
  approved: "bg-emerald-100 text-emerald-900",
  published: "bg-black text-white",
};
