import { readableTextOn } from "@/lib/colors";
import { outlineFor, needsOutline } from "@/lib/orgChart";
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
}: {
  person: OrgPerson;
  /** لون المستوى أو القسم — يُحمَل شريطاً وحدّاً لا سطحاً كاملاً */
  color: string;
  size?: "lg" | "md" | "sm";
}) {
  const dims =
    size === "lg"
      ? { box: "w-[168px]", photo: "h-20 w-20", name: "text-sm", title: "text-[11px]" }
      : size === "md"
        ? { box: "w-[152px]", photo: "h-16 w-16", name: "text-[13px]", title: "text-[10.5px]" }
        : { box: "w-[132px]", photo: "h-12 w-12", name: "text-xs", title: "text-[10px]" };

  return (
    <div
      className={`${dims.box} shrink-0 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-black/[0.07]`}
    >
      {/* الشريط يُرسَم بحدِّ العرض لا باللون الخام: الأبيض على أبيض
          لا يُرى، فيُحمَل بحدٍّ رماديٍّ داكن يُبقيه أبيضَ مقصوداً */}
      <div
        className="h-1.5 w-full"
        style={{
          background: color,
          borderBottom: needsOutline(color) ? `1px solid ${outlineFor(color)}` : undefined,
        }}
        aria-hidden
      />
      <div className="flex flex-col items-center px-3 pb-3 pt-3 text-center">
        <Portrait avatarData={person.avatarData} name={person.fullName} color={color} className={dims.photo} />
        <p className={`mt-2 font-bold leading-tight text-black/85 ${dims.name}`}>{person.fullName}</p>
        <p className={`mt-0.5 leading-snug text-black/55 ${dims.title}`}>{person.title}</p>
        {person.scope && (
          <p className={`mt-0.5 leading-snug text-black/35 ${dims.title}`}>{person.scope}</p>
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
  avatarData,
  name,
  color,
  className,
}: {
  avatarData: string | null;
  name: string;
  color: string;
  className: string;
}) {
  if (avatarData) {
    return (
      // الصورة مُوحَّدةٌ عند الاستلام إلى مربّع ٥١٢ شفّاف الخلفية، فـ
      // `object-contain` يُظهرها كاملةً ولا يقطع رأساً
      // eslint-disable-next-line @next/next/no-img-element -- data URL مخزَّنة، لا مصدر خارجي يُحسَّن
      <img
        src={avatarData}
        alt={name}
        className={`${className} rounded-full object-contain`}
        style={{ background: `${color}14` }}
      />
    );
  }
  const initial = name.trim().charAt(0) || "؟";
  const ink = readableTextOn(color);
  return (
    <span
      aria-label={`${name} — لم تُضَف صورته بعد`}
      className={`${className} flex items-center justify-center rounded-full border border-dashed text-lg font-bold`}
      style={{ background: `${color}1F`, borderColor: `${color}66`, color: ink === "#1A1023" ? color : color }}
    >
      {initial}
    </span>
  );
}

/** مقعدٌ شاغر — يُعلَن شاغراً ولا يُسنَد إلى أحد */
export function VacantCard({ title, color }: { title: string; color: string }) {
  return (
    <div className="w-[152px] shrink-0 overflow-hidden rounded-2xl border border-dashed border-black/20 bg-black/[0.02]">
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
}: {
  seat: OrgSeat;
  color: string;
  size?: "lg" | "md" | "sm";
}) {
  return seat.kind === "filled" ? (
    <OrgCard person={seat.person} color={color} size={size} />
  ) : (
    <VacantCard title={seat.title} color={color} />
  );
}
