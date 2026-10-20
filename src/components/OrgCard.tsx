import { readableTextOn } from "@/lib/colors";
import { outlineFor, needsOutline } from "@/lib/orgChart";
import { portraitTone } from "@/lib/portraitTone";
import type { OrgPerson, OrgSeat } from "@/lib/orgChart";

/** بطاقة شخصٍ في الهيكل — أربعة حقولٍ فقط، ولا إجراء.
 *
 *  صورةٌ واسمٌ ومسمّى وقسمٌ عند الحاجة. ولا بريد ولا جوّال: الهيكل
 *  يُعرَض لكل الأعضاء، فعرضُ بُرُد الجميع على الجميع نشرٌ لبياناتهم.
 *
 *  وهي مكوّنٌ خادمي بلا `"use client"` وبلا `onClick`: لا تُسحَب ولا
 *  تُنقَل ولا تُعدَّل، لأنه لا يوجد ما يفعل ذلك — لا زرٌّ مخفيّ ولا
 *  إجراءٌ يُنادى من طرف العميل. */
export function OrgCard({
  person,
  color,
  size = "md",
  highlight = false,
  committee = null,
}: {
  person: OrgPerson;
  /** لون المستوى أو القسم — يُحمَل شريطاً وحدّاً لا سطحاً كاملاً */
  color: string;
  size?: "lg" | "md" | "sm";
  /** اسمُ اللجنة إن كان صاحبُ البطاقة فيها — قائداً أو عضواً.
   *
   *  **واللجنةُ تُعرَف بشكلها لا بلونها:** لونُها لونُ قسمها، فلو لم
   *  تُوسَم بطاقاتُها لقُرئ أهلُها أعضاءَ القسم مباشرةً. فيُرسَم على
   *  البطاقة حدٌّ متقطّعٌ ووسمٌ باسم اللجنة — فيُعرَف أنه منها، ويبقى
   *  لونُه لونَ قسمه فيُعرَف أنه من القسم أيضاً. */
  committee?: string | null;
  /** بطاقةُ من يُشاهد — تُميَّز ليعرف موضعه من الهيكل.
   *
   *  والهيكل يُقرأ بعشرات البطاقات، فالعضو يبحث عن نفسه فيها بعينه.
   *  فتُحاط بطاقتُه بحلقةٍ ويُكتَب عليها «أنت هنا» — ولا يُغيَّر ترتيبُها
   *  ولا لونُ قسمها: التمييز للعين لا للهيكل. */
  highlight?: boolean;
}) {
  const dims =
    size === "lg"
      ? { box: "w-[220px]", photo: "h-20 w-20", name: "text-base", title: "text-xs", band: "h-14", lift: "-mt-10" }
      : size === "md"
        ? { box: "w-[184px]", photo: "h-16 w-16", name: "text-sm", title: "text-[11px]", band: "h-11", lift: "-mt-8" }
        : { box: "w-[150px]", photo: "h-12 w-12", name: "text-xs", title: "text-[10px]", band: "h-9", lift: "-mt-6" };

  return (
    <div
      className={`${dims.box} relative shrink-0 overflow-hidden rounded-2xl bg-white shadow-sm ${
        highlight
          ? "ring-2 ring-offset-2 ring-offset-page shadow-md"
          : committee
            ? "border border-dashed"
            : "ring-1 ring-black/[0.07]"
      }`}
      style={
        highlight
          ? { ["--tw-ring-color" as string]: "#C34900" }
          : committee
            ? { borderColor: `${outlineFor(color)}80` }
            : undefined
      }
    >
      {highlight && (
        <span className="absolute start-0 top-0 z-10 rounded-ee-lg bg-[#C34900] px-1.5 py-0.5 text-[9px] font-bold text-on-brand print:bg-[#C34900]">
          أنت هنا
        </span>
      )}
      {/* الشريط يُرسَم بحدِّ العرض لا باللون الخام: الأبيض على أبيض
          لا يُرى، فيُحمَل بحدٍّ رماديٍّ داكن يُبقيه أبيضَ مقصوداً */}
      {/* شريطُ اللون عريضٌ تعلو عليه الصورة — هويةُ القسم أوّلُ ما يُقرأ */}
      <div
        className={`${dims.band} w-full`}
        style={{
          background: color,
          borderBottom: needsOutline(color) ? `1px solid ${outlineFor(color)}` : undefined,
        }}
        aria-hidden
      />
      <div className={`flex flex-col items-center px-3 pb-3.5 text-center ${dims.lift}`}>
        <Portrait src={person.avatarUrl} name={person.fullName} color={color} className={`${dims.photo} border-4 border-white`} />
        <p className={`mt-2 font-bold leading-tight text-black/85 ${dims.name}`}>{person.fullName}</p>
        <p className={`mt-0.5 leading-snug text-black/55 ${dims.title}`}>{person.title}</p>
        {person.scope && (
          <p className={`mt-0.5 leading-snug text-black/35 ${dims.title}`}>{person.scope}</p>
        )}
        {committee && (
          <span
            className="mt-1.5 rounded-full border border-dashed px-2 py-0.5 text-[9px] font-bold"
            style={{
              borderColor: `${outlineFor(color)}99`,
              // حبرُ الوسم يتبع السمة: لونُ القسم قد يكون داكناً جداً أو
              // فاتحاً جداً، وكلاهما يَعمى على سطحٍ من جنسه
              color: `light-dark(${outlineFor(color)}, var(--ink))`,
              background: `${color}12`,
            }}
          >
            لجنة {committee}
          </span>
        )}
      </div>
    </div>
  );
}

/** الصورة — أو عنصرٌ افتراضيٌّ أنيق يقول إنها لم تُضَف بعد.
 *
 *  والافتراضي ليس مربّعاً رمادياً فارغاً: حرفُ الاسم الأول على لون
 *  المستوى. فالهيكل يبقى مقروءاً متناسقاً قبل أن يرفع أحدٌ صورته،
 *  ويبقى واضحاً أن الصورة ناقصة. */
function Portrait({
  src,
  name,
  color,
  className,
}: {
  src: string | null;
  name: string;
  color: string;
  className: string;
}) {
  if (src) {
    return (
      // الصورة مُوحَّدةٌ عند الاستلام إلى مربّع ٥١٢ شفّاف الخلفية، فـ
      // `object-contain` يُظهرها كاملةً ولا يقطع رأساً
      // eslint-disable-next-line @next/next/no-img-element -- مسارٌ داخليٌّ خلف الجلسة، لا يمرّ بمُحسِّن الصور
      <img
        src={src}
        loading="lazy"
        decoding="async"
        alt={name}
        className={`${className} rounded-full object-contain`}
        // لونُ القسم تحت الصورة: يُرى حول الشخص إن كانت شفّافة — انظر `portraitTone`
        style={{
          background: portraitTone(color).background,
          boxShadow: portraitTone(color).ring ? `inset 0 0 0 1px ${portraitTone(color).ring}` : undefined,
        }}
      />
    );
  }
  const initial = name.trim().charAt(0) || "؟";
  const ink = readableTextOn(color);
  return (
    <span
      aria-label={`${name} — لم تُضَف صورته بعد`}
      className={`${className} flex items-center justify-center rounded-full border border-dashed text-lg font-bold`}
      // خلفيةٌ معتمة لا شفّافة: الدائرةُ تعلو شريطَ اللون، والشفّافةُ يَظهر
      // الشريطُ من خلالها فيُقصّ الحرفُ نصفين
      style={{
        background: `color-mix(in oklab, ${color} 14%, white)`,
        borderColor: `${color}66`,
        color: ink === "#1A1023" ? `color-mix(in oklab, ${color} 55%, #1A1023)` : color,
      }}
    >
      {initial}
    </span>
  );
}

/** مقعدٌ شاغر — يُعلَن شاغراً ولا يُسنَد إلى أحد */
export function VacantCard({
  title,
  color,
  committee = null,
}: {
  title: string;
  color: string;
  committee?: string | null;
}) {
  return (
    <div
      className="w-[152px] shrink-0 overflow-hidden rounded-2xl border border-dashed bg-black/[0.02]"
      style={{ borderColor: committee ? `${outlineFor(color)}80` : "color-mix(in oklab, var(--ink) 20%, transparent)" }}
    >
      <div className="h-1.5 w-full opacity-40" style={{ background: color }} aria-hidden />
      <div className="flex flex-col items-center px-3 pb-3 pt-3 text-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-full border border-dashed border-black/20 text-xl text-black/25">
          —
        </span>
        <p className="mt-2 text-[13px] font-bold leading-tight text-black/45">{title}</p>
        <p className="mt-0.5 text-[10.5px] font-semibold text-amber-700">منصب شاغر</p>
      </div>
    </div>
  );
}

export function SeatCard({
  seat,
  color,
  size,
  viewerId,
  committee = null,
}: {
  seat: OrgSeat;
  color: string;
  size?: "lg" | "md" | "sm";
  /** معرّف من يُشاهد — تُميَّز به بطاقتُه أينما وقعت */
  viewerId?: string;
  /** اسمُ اللجنة إن كان المقعدُ فيها */
  committee?: string | null;
}) {
  return seat.kind === "filled" ? (
    <OrgCard
      person={seat.person}
      color={color}
      size={size}
      highlight={Boolean(viewerId) && seat.person.id === viewerId}
      committee={committee}
    />
  ) : (
    <VacantCard title={seat.title} color={color} committee={committee} />
  );
}
