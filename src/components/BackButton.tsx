"use client";

import { useRouter } from "next/navigation";

/** زر رجوع عام يعتمد على سجل تصفح المتصفح (history) بدل رابط ثابت — يعمل
 *  بشكل صحيح بصرف النظر عن دور المستخدم أو من أين فتح الصفحة الفرعية. */
export function BackButton({ fallbackHref = "/admin" }: { fallbackHref?: string }) {
  const router = useRouter();

  function handleClick() {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
    } else {
      router.push(fallbackHref);
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className="mb-4 inline-flex items-center gap-1 text-sm font-semibold text-black/50 hover:text-black/80"
    >
      ← رجوع
    </button>
  );
}
