/** روابط تقويم جوجل.
 *
 *  تعامل الفريق مع جوجل دائم، فالزرّ المباشر إلى تقويم جوجل أقصر طريق:
 *  يفتح نموذج الحدث جاهزاً فيضغط صاحبه «حفظ». ويبقى ملفّ .ics إلى جانبه
 *  لمن يستعمل تقويم آبل أو أوتلوك — ولأن الرابط يحتاج متصفحاً مسجّلاً
 *  دخوله في جوجل، والملفّ لا يحتاج شيئاً.
 *
 *  ولا أحدهما يطلب ربط حساب ولا يمنح المنصة وصولاً إلى تقويم أحد: كلاهما
 *  حدثٌ واحد يُضاف بيد صاحبه، لا مزامنة دائمة.
 */

/** صيغة جوجل للوقت: UTC مضغوطة بلا فواصل — 20261008T153000Z */
function stamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

export function googleCalendarUrl(opts: {
  title: string;
  details?: string;
  location?: string;
  start: Date;
  end: Date;
}): string {
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: opts.title,
    dates: `${stamp(opts.start)}/${stamp(opts.end)}`,
  });
  if (opts.details) params.set("details", opts.details);
  if (opts.location) params.set("location", opts.location);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/** هل الرابط اجتماعٌ نعرفه؟
 *
 *  يُستعمل لعرض الاجتماع بوسمه الصحيح، ولرفض ما ليس رابطاً أصلاً. لا
 *  يُقصد به حصر الاجتماعات في جوجل — زووم وتيمز مقبولان — بل منع إدراج
 *  نصٍّ ليس رابطاً في موضع يُنقر. */
export function isSafeHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}
