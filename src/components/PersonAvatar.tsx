import { readableTextOn } from "@/lib/colors";
import { portraitTone } from "@/lib/portraitTone";

/** صورةُ الشخص — عرضٌ واحدٌ في القائمة الجانبية والسجلّ والملفّ.
 *
 *  كانت كلُّ شاشةٍ ترسمها بطريقتها: القائمةُ تقصّها (`cover`) فوق برتقاليٍّ
 *  ثابت، والهيكلُ يعرضها كاملةً (`contain`) فوق لون القسم — فتبدو صورةُ
 *  الشخص الواحد مختلفةً بين موضعين. وهنا الطريقةُ الواحدة: الصورةُ كاملةً
 *  بلا قصّ، فوق لون انتمائه (`portraitColorFor`).
 *
 *  **ولا تُزال خلفيةٌ بـCSS.** الصورةُ الشفّافة يظهر لونُ القسم حول صاحبها،
 *  والمعتمةُ تُغطّيه فتُرى كما رُفعت — ولا يُدّعى أنها صارت شفّافة. */
export function PersonAvatar({
  src,
  name,
  color,
  className = "h-10 w-10",
  textClassName = "text-sm",
}: {
  src: string | null;
  name: string;
  /** لونُ الانتماء — `null` لمن لا قسم له فيُرسَم محايداً */
  color: string | null;
  className?: string;
  textClassName?: string;
}) {
  const tone = portraitTone(color);
  const ring = tone.ring ? { boxShadow: `inset 0 0 0 1px ${tone.ring}` } : undefined;
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- مسارٌ داخليٌّ مخزَّن (`/api/avatar`)
      <img
        src={src}
        alt=""
        loading="lazy"
        decoding="async"
        className={`${className} shrink-0 rounded-full object-contain`}
        style={{ background: tone.background, ...ring }}
      />
    );
  }
  const initials = name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("");
  return (
    <span
      aria-hidden="true"
      className={`${className} ${textClassName} flex shrink-0 items-center justify-center rounded-full font-bold`}
      style={{ background: tone.background, color: readableTextOn(tone.background.startsWith("#") ? tone.background : "#E7E5E0"), ...ring }}
    >
      {initials}
    </span>
  );
}
