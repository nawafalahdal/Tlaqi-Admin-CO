"use client";

import { useRef, useState, useTransition } from "react";
import { uploadMyAvatarAction, clearMyAvatarAction } from "@/app/structure/actions";
import { Card, Button } from "@/components/ui";
import type { themeFromColor } from "@/lib/brand";

/** رفع الصورة الشخصية — معاينةٌ قبل الحفظ، وصورةٌ واحدة.
 *
 *  المعاينة محلّيةٌ قبل الإرسال (`URL.createObjectURL`): يرى الشخص ما
 *  سيُحفَظ قبل أن يُحفَظ، فلا يكتشف الخطأ في الهيكل أمام الفريق.
 *
 *  والإرشاد مكتوبٌ لا مُفترَض: الشفافية وحدها لا تجعل الصورة لائقة،
 *  فيُقال ما هو المطلوب — وجهٌ واضح، خلفيةٌ مفرَّغة، PNG.
 */
/** حدُّ الضلع الذي تُرسَل الصورة فيه — والخادم يُوحّدها بعده إلى ٥١٢.
 *
 *  التصغير في المتصفّح لا في الخادم وحده: صورة الجوّال الحديث ٣–٨
 *  ميجابايت، وطلبُ Server Action له حدٌّ أصغر من ذلك افتراضاً — فكان
 *  الطلب يُرفَض قبل أن يبلغ الإجراء، فلا رسالةَ خطأٍ مفهومة بل حاجزُ
 *  الأخطاء العام: «تعذّر إتمام العملية».
 *
 *  والصيغة PNG لا JPEG: الخلفية الشفّافة هي المطلوب، وJPEG لا يحمل
 *  شفافيةً — فيُمتلئ المفرَّغ أسودَ ثم يظهر مربّعاً في الهيكل. */
const MAX_EDGE = 1024;

/** يُصغّر الصورة في المتصفّح مع الحفاظ على الشفافية.
 *
 *  وإن تعذّر شيءٌ من ذلك — متصفّحٌ لا يُفكّ الصيغة، أو `canvas` مُقيَّد —
 *  يُرسَل الملف كما هو: الخادم يتحقّق ويُوحّد على كل حال، والتصغير
 *  تخفيفٌ لا شرطُ صحّة. */
async function shrinkForUpload(file: File): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size <= 900_000) {
      bitmap.close();
      return file;
    }
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return file;
    }
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) =>
      // WebP في الرفع كما في التخزين: نصفُ الحِمل صعوداً، والخادمُ يُعيد
      // الترميزَ على كل حال فلا فرقَ في المخرَج
      canvas.toBlob((b) => resolve(b), "image/webp", 0.92)
    );
    if (!blob) return file;
    return new File([blob], "avatar.webp", { type: "image/webp" });
  } catch {
    return file;
  }
}

export function AvatarUpload({
  current,
  theme,
  opaque = false,
}: {
  current: string | null;
  theme: ReturnType<typeof themeFromColor>;
  /** الصورةُ المحفوظة معتمةٌ بخلفيتها (`avatarHasTransparency`) — يُقال لصاحبها */
  opaque?: boolean;
}) {
  const [preview, setPreview] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(current);
  const [msg, setMsg] = useState<{ kind: "ok" | "err" | "warn"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  const shown = preview ?? saved;

  return (
    <Card className="p-4 sm:p-5">
      <h2 className="text-sm font-bold">صورتك في الهيكل التنظيمي</h2>
      <p className="mt-1 text-xs leading-relaxed text-black/50">
        صورةٌ واحدة لكل شخص، تظهر في بطاقتك داخل هيكل تَـــلاقِ. والمطلوب: وجهٌ واضح على
        <strong> خلفية مفرَّغة (شفّافة)</strong> بصيغة PNG. وتُوحَّد أبعادُها عند الرفع فيبقى
        الهيكل متناسقاً.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-4">
        <div className="shrink-0">
          {shown ? (
            // eslint-disable-next-line @next/next/no-img-element -- data URL أو معاينة محلّية
            <img
              src={shown}
              alt="معاينة صورتك"
              className="h-24 w-24 rounded-full object-contain ring-1 ring-black/10"
              style={{ background: theme.surface }}
            />
          ) : (
            <span
              className="flex h-24 w-24 items-center justify-center rounded-full border border-dashed border-black/20 text-xs text-black/35"
              style={{ background: theme.surface }}
            >
              لا صورة
            </span>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <input
            ref={inputRef}
            type="file"
            name="avatar"
            accept="image/png,image/jpeg,image/webp,image/avif"
            onChange={(e) => {
              const f = e.target.files?.[0];
              setMsg(null);
              setPreview(f ? URL.createObjectURL(f) : null);
            }}
            className="block w-full cursor-pointer rounded-xl border border-black/10 bg-white p-2 text-xs file:me-3 file:rounded-lg file:border-0 file:bg-black/[0.06] file:px-3 file:py-2 file:text-xs file:font-semibold"
          />
          <div className="flex flex-wrap gap-2">
            <Button
              theme={theme}
              disabled={pending || !preview}
              onClick={() => {
                const f = inputRef.current?.files?.[0];
                if (!f) return;
                setMsg(null);
                startTransition(async () => {
                  const fd = new FormData();
                  fd.set("avatar", await shrinkForUpload(f));
                  // الإجراء يُعيد خطأه نصّاً. وما يبقى بعده — انقطاعُ
                  // شبكةٍ أو طلبٌ مرفوض — يُقال هنا بدل أن يُسقط الصفحة
                  // في حاجز الأخطاء العام.
                  let res: Awaited<ReturnType<typeof uploadMyAvatarAction>>;
                  try {
                    res = await uploadMyAvatarAction(fd);
                  } catch {
                    setMsg({
                      kind: "err",
                      text: "تعذّر إرسال الصورة — تحقّق من الاتصال وأعد المحاولة بصورة أصغر.",
                    });
                    return;
                  }
                  if (res.error) {
                    setMsg({ kind: "err", text: res.error });
                    return;
                  }
                  // ما حُفِظ هو ما عُوحِّد في الخادم، فتُقرأ الصفحة من
                  // جديد لتُعرَض الصورة المعتمدة لا المعاينة المحلّية
                  setSaved(preview);
                  setPreview(null);
                  if (inputRef.current) inputRef.current.value = "";
                  setMsg(
                    res.transparent === false
                      ? {
                          kind: "warn",
                          text: "حُفظت صورتك — لكنها ليست مفرَّغة الخلفية، فتظهر بخلفيتها لا بلون قسمك. ليظهر لونُ قسمك حولك ارفع صورة PNG مفرَّغة.",
                        }
                      : { kind: "ok", text: "حُفظت صورتك وستظهر في الهيكل بلون قسمك" }
                  );
                });
              }}
            >
              {pending ? "جارِ الحفظ..." : saved ? "استبدال الصورة" : "حفظ الصورة"}
            </Button>
            {saved && !preview && (
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  setMsg(null);
                  startTransition(async () => {
                    const res = await clearMyAvatarAction();
                    if (res.error) {
                      setMsg({ kind: "err", text: res.error });
                      return;
                    }
                    setSaved(null);
                    setMsg({ kind: "ok", text: "حُذفت صورتك" });
                  });
                }}
                className="inline-flex min-h-11 items-center rounded-xl border border-black/10 px-4 text-sm font-semibold text-black/55 disabled:opacity-50"
              >
                حذف الصورة
              </button>
            )}
            {preview && (
              <Button
                theme={theme}
                variant="ghost"
                onClick={() => {
                  setPreview(null);
                  if (inputRef.current) inputRef.current.value = "";
                }}
              >
                إلغاء
              </Button>
            )}
          </div>
        </div>
      </div>

      {opaque && !msg && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
          صورتك الحالية ليست مفرَّغة الخلفية، فتظهر في الهيكل بخلفيتها لا بلون قسمك. ليظهر لونُ قسمك
          حولك، ارفع صورة PNG مفرَّغة الخلفية.
        </p>
      )}

      {msg && (
        <p
          className={`mt-3 rounded-lg px-3 py-2 text-xs leading-relaxed ${
            msg.kind === "ok"
              ? "bg-green-50 text-green-800"
              : msg.kind === "warn"
                ? "bg-amber-50 text-amber-900"
                : "bg-red-50 text-red-800"
          }`}
        >
          {msg.text}
        </p>
      )}
    </Card>
  );
}
