/** روابطُ المواد الخارجية — قائمةُ سماحٍ تُفحَص بالتحليل لا بالنصّ.
 *
 *  **القرار:** المنصةُ تَحفظ **روابطَ** المواد لا بايتاتِها. فملفُّ
 *  العمل في درايف، والتصميمُ في كانفا، والاجتماعُ في ميت — والمنصةُ
 *  تَحفظ أين هو ومن وضعه ومتى، لا نسخةً منه. وهذا يُخفّف القاعدة
 *  ويُبقي الملفَّ حيث يُحرَّره صاحبُه بلا نسختين تَفترقان.
 *
 *  **وهذا يَفتح باباً لو تُرك مفتوحاً:** حقلٌ يَقبل رابطاً ويُعرَض لكل
 *  من في المنصة هو موضعُ نقرٍ موثوق. فمن وضع فيه `javascript:` نفّذ
 *  سكربتاً في أصل المنصة نفسِه، ومن وضع نطاقاً يُشبه درايف قاد الناسَ
 *  إلى صفحةٍ تَسألهم كلمةَ مرورهم وهم يَحسبونها جوجل.
 *
 *  ## ثلاثةُ أحكامٍ لا يُتنازَل عنها
 *
 *  **١) الفحصُ بالتحليل لا بالنصّ.** `url.includes("drive.google.com")`
 *  يَقبل `https://drive.google.com.evil.co/x` ويَقبل
 *  `https://evil.co/?u=drive.google.com` — وكلاهما ليس درايف. فالرابطُ
 *  يُحلَّل بـ`new URL`، ويُقرأ `hostname` وحده: إمّا أن يُساوي نطاقاً
 *  مسموحاً أو ينتهي بنقطةٍ ثم نطاقٍ مسموح (`docs.google.com`
 *  لـ`google.com`). واللاحقةُ بلا نقطةٍ لا تُقبل — وهذا ما يُسقِط
 *  `notgoogle.com`.
 *
 *  **٢) البروتوكولُ https وحده.** لا `javascript:` ولا `data:` ولا
 *  `http:` — والأخيرُ ليس تنفيذاً لكنّه نقلٌ مكشوف.
 *
 *  **٣) الخادمُ لا يَطلب رابطَ أحد.** لا تحقّقَ بجلبٍ ولا معاينةً تُبنى
 *  بقراءة الصفحة: ذلك يَجعل الخادمَ ينوب عن واضع الرابط فيَصل إلى ما لا
 *  يَصله هو (SSRF)، ويُتبع تحويلاتٍ إلى حيث لا يُراد. فالتحقّقُ من
 *  **صيغة** الرابط لا من **محتواه**.
 *
 *  **وما لا يُدَّعى:** المنصةُ لا تَعرف من يَملك صلاحيةَ فتح الملفّ في
 *  درايف ولا تَقدر أن تَفحصها — ذلك يَلزمه تكاملٌ مُصرَّحٌ به مع حساب
 *  جوجل. فرؤيةُ **السجلّ** في المنصة شيء، وفتحُ **الملفّ** شيءٌ آخر
 *  يَحكمه درايف. ولا يُقال للمستعمل غيرُ ذلك.
 */

/** ما يُقبَل من مصادر، وما يُعرَض به في الواجهة */
export type LinkSource = "drive" | "docs" | "canva" | "meet";

type SourceSpec = {
  /** النطاقاتُ المسموحة — تُطابَق أو يُطابَق نطاقٌ فرعيٌّ تحتها */
  hosts: readonly string[];
  label: string;
  /** مسارٌ لازمٌ في بعض المصادر: `google.com` وحدَه ليس درايف */
  pathStartsWith?: readonly string[];
};

/** النطاقاتُ الرسمية وحدها. ولا يُضاف إليها نطاقٌ «يُشبه» — الشبهُ هو
 *  عينُ الخطر. */
const SOURCES: Record<LinkSource, SourceSpec> = {
  drive: { hosts: ["drive.google.com"], label: "جوجل درايف" },
  docs: {
    // مستنداتُ وجداولُ وشرائحُ جوجل — كلُّها تحت `docs.google.com`
    hosts: ["docs.google.com"],
    label: "مستندات جوجل",
  },
  canva: { hosts: ["canva.com", "www.canva.com"], label: "كانفا" },
  meet: { hosts: ["meet.google.com"], label: "جوجل ميت" },
};

/** هل هذا المضيفُ هو النطاقَ المسموح أو نطاقاً فرعياً تحته؟
 *
 *  المقارنةُ على الحدّ الصحيح: `x.canva.com` نعم، و`canva.com.evil.co`
 *  لا، و`notcanva.com` لا — لأن اللاحقةَ تُطلَب مسبوقةً بنقطة. */
function hostMatches(hostname: string, allowed: string): boolean {
  const h = hostname.toLowerCase();
  const a = allowed.toLowerCase();
  return h === a || h.endsWith(`.${a}`);
}

export type LinkCheck =
  | { ok: true; url: string; source: LinkSource; label: string }
  | { ok: false; reason: string };

/** يَفحص رابطاً ويُعيد مصدرَه — أو يُسمّي سببَ الرفض.
 *
 *  والسببُ يُسمّى بعينه: «الرابط غير مقبول» تُقرأ عطباً في المنصة،
 *  و«نطاق `example.com` ليس من المصادر المقبولة» تُقرأ حدّاً مفهوماً
 *  يُصلحه صاحبُه بنفسه.
 */
export function checkExternalLink(
  raw: string,
  allowedSources: readonly LinkSource[] = ["drive", "docs", "canva", "meet"]
): LinkCheck {
  const value = raw.trim();
  if (!value) return { ok: false, reason: "الرابط مطلوب" };

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return { ok: false, reason: "الرابط غير صالح — يبدأ بـhttps://" };
  }

  // البروتوكولُ أولاً: `javascript:` في موضعٍ يُنقَر بابُ تنفيذٍ في أصل
  // المنصة، و`data:` بابُ صفحةٍ تُرسَم من نصٍّ وضعه غيرُنا
  if (parsed.protocol !== "https:") {
    return {
      ok: false,
      reason:
        parsed.protocol === "http:"
          ? "الرابط يجب أن يبدأ بـhttps:// — وhttp مكشوفٌ لا يُقبل"
          : "الرابط يجب أن يبدأ بـhttps:// — ولا يُقبل غيره",
    };
  }

  // بياناتُ الدخول داخل الرابط (`https://user:pass@host`) تُخفي المضيفَ
  // الحقيقيَّ عن العين وتَنقل سرّاً في موضعٍ يُعرَض
  if (parsed.username || parsed.password) {
    return { ok: false, reason: "الرابط يحمل بيانات دخول — انسخه من شريط العنوان نظيفاً" };
  }

  for (const source of allowedSources) {
    const spec = SOURCES[source];
    if (!spec.hosts.some((h) => hostMatches(parsed.hostname, h))) continue;
    if (spec.pathStartsWith && !spec.pathStartsWith.some((p) => parsed.pathname.startsWith(p))) {
      continue;
    }
    return { ok: true, url: parsed.toString(), source, label: spec.label };
  }

  const names = allowedSources.map((s) => SOURCES[s].label).join("، ");
  return {
    ok: false,
    reason: `نطاق «${parsed.hostname}» ليس من المصادر المقبولة — المقبول: ${names}`,
  };
}

/** وسمُ المصدر كما يُعرَض على البطاقة */
export function linkSourceLabel(source: LinkSource): string {
  return SOURCES[source].label;
}

/** يَستنتج المصدرَ من رابطٍ محفوظٍ سلفاً — للعرض لا للتحقّق.
 *
 *  والمحفوظُ قد يكون من قبل قائمة السماح (مركزُ الخطط كان يَقبل أيَّ
 *  https)، فيُعاد `null` ولا يُحذَف: حذفُ مادةٍ قائمةٍ لأن قاعدةً
 *  تشدّدت بعدها إتلافُ عملٍ لا إصلاحُ أمان. */
export function sourceOfSavedLink(raw: string): LinkSource | null {
  const checked = checkExternalLink(raw);
  return checked.ok ? checked.source : null;
}

/** قائمةُ النطاقات للعرض في الواجهة — لتُقال للمستعمل قبل أن يُرفَض */
export function allowedHostsFor(sources: readonly LinkSource[]): string[] {
  return sources.flatMap((s) => SOURCES[s].hosts);
}
