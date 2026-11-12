# حزمة الهوية البصرية · تلاق (TLAQI)

**هوية تلاق 2026 · الإصدار 1.0 · نوفمبر 2026**
Talent Link Advancing Quality Innovation

هذه الحزمة مبنية على ملف "هوية تلاق 2026" المرفق في `06_Reference`. أي قيمة أو قاعدة لم ترد في ذلك الملف تُذكر صراحةً في قسم "ما لم يحدده ملف الهوية" أدناه ولا تُعتمد هنا.

---

## 1. محتويات الحزمة

| المجلد | المحتوى |
|---|---|
| `01_Logos` | الشعار الكامل بأربع نسخ حسب لون الخلفية، والعلامة وحدها بثلاث نسخ. الملفات SVG (متجهة) وPNG (شفافة). |
| `02_Colors` | الألوان الأربعة بصيغ JSON وCSS ونص عادي، مع أزواج التباين. |
| `03_Patterns` | الأنماط الثلاثة (موهبة، ابتكار، ربط) بمقاسي L وM وبالألوان الأربعة، كبلاطات SVG قابلة للتكرار. |
| `04_Icons` | 30 أيقونة مستخدمة في الأدلة، مع نص رخصة lucide. |
| `05_Typography` | خط The Year of The Camel بالأوزان المعتمدة الأربعة، وملف CSS جاهز. |
| `06_Reference` | ملف الهوية الأصلي (PDF). |

## 2. قواعد الاستخدام

من ملف الهوية:

1. **لا نمط خلف نص.** النص يقف على لون صلب، ويُوضع النمط في شريط أو لوحة منفصلة عن العنوان.
2. **مقاس ثابت.** L للأغلفة واللوحات، وM للبطاقات والمساحات الصغيرة. لا تدوير ولا تمديد.
3. **أربعة ألوان فقط.** Beige وMahogany وTemptress وGreen Sheen. لا أزرق، ولا شفافية تصنع لوناً خامساً.
4. **الحد الأدنى للشعار.** الشعار الكامل لا يقل عرضه عن 70 مم. إذا قل العرض عن ذلك استعمل العلامة وحدها.
5. **الخط المعتمد.** اتبع الخط المعتمد لكل النصوص العربية والإنجليزية، ولا تستخدم خطوطاً بديلة في المواد الرسمية.

## 3. الشعار

الملفات مرجعية؛ لا تُعدَّل ألوانها أو أبعادها أو ترتيبها.

| الملف | الخلفية المقصودة | ملاحظة |
|---|---|---|
| `TLAQI-logo-full_on-beige` | Beige | النسخة الافتراضية، الشعار بلونين: Mahogany للعلامة وTemptress للكلمة |
| `TLAQI-logo-full_on-temptress` | Temptress | الكلمة بلون Beige، والعلامة بلون Mahogany |
| `TLAQI-logo-full_on-mahogany` | Mahogany | لون واحد: كل الشعار بلون Beige |
| `TLAQI-logo-full_on-green-sheen` | Green Sheen | لون واحد: كل الشعار بلون Temptress. **غير معروضة في ملف الهوية**؛ مشتقة من زوج Temptress / Green Sheen (7.0:1) |
| `TLAQI-mark_mahogany` | Beige أو Temptress | العلامة وحدها، حين يقل عرض الشعار عن 70 مم |
| `TLAQI-mark_beige` | Mahogany | العلامة وحدها بلون Beige |
| `TLAQI-mark_temptress` | Green Sheen | العلامة وحدها بلون Temptress |

## 4. الألوان

| الاسم | HEX | RGB | الدور |
|---|---|---|---|
| Beige | `#EEF6DF` | 238, 246, 223 | الخلفية الأساسية |
| Temptress | `#341D2B` | 52, 29, 43 | النص والخلفيات الداكنة |
| Mahogany | `#C34900` | 195, 73, 0 | العناوين والنمط على الفاتح |
| Green Sheen | `#67C090` | 103, 192, 144 | أغلفة كاملة مع Temptress |

**أزواج التباين** (WCAG، كما في ملف الهوية):

| الزوج | التباين | الاستخدام |
|---|---|---|
| Beige / Temptress | 13.9:1 | أعلى تباين؛ مناسب لكل النصوص |
| Temptress / Green Sheen | 7.0:1 | مناسب للنصوص |
| Mahogany / Beige | 4.4:1 | للعناوين الكبيرة والعناصر غير النصية؛ دون 4.5:1 للنص الصغير |
| Green Sheen / Beige | 2.0:1 | **لا للنص**؛ للكتل والأنماط الزخرفية فقط |

Mahogany على Temptress (3.2:1) غير مدرج في ملف الهوية؛ استعمله للعلامة والنمط فقط، لا للنص.

## 5. الأنماط

| النمط | المعنى (من ملف الهوية) | الدورة (L / M) |
|---|---|---|
| **موهبة** · TALENT | ثماني قطرات متساوية تنطلق من مركز واحد، صغيرة ومتزنة في كل اتجاه. | 25.4 مم / 12.7 مم |
| **ابتكار** · INNOVATION | أربع قطرات تتجه من مركز واحد إلى الخارج، كزهرة تنمو. | 25.4 مم / 12.7 مم |
| **ربط** · LINK | قوس يصل بين نقطتين، تمثّل الصلة بين الموهبة والجهة. | 25.4 مم / 12.7 مم |

- **الموهبة** هو النمط الأساسي.
- **L** للأغلفة واللوحات، و**M** للبطاقات والمساحات الصغيرة (نصف حجم L).
- كما في ملف الهوية: على Beige يُستعمل النمط بلون Mahogany، وعلى Temptress بلون Beige.
- الملفات بالألوان الأربعة كلها للتجريب والتطبيق، لكن الاستعمالات المعروضة في الهوية هي التي ذكرتها أعلاه.
- النمط يُوضع في شريط أو لوحة منفصلة، لا خلف النص.

## 6. الحروف المختصرة

الحروف T وL وA وQ وI تُعرض في ملف الهوية كحروف مختصرة:

| الحرف | الكلمة | الترجمة |
|---|---|---|
| T | TALENT | موهبة |
| L | LINK | ربط |
| A | ADVANCING | تقدّم |
| Q | QUALITY | جودة |
| I | INNOVATION | ابتكار |

تُستعمل للمساحات الصغيرة والأيقونات والإشارات المختصرة. الشعار الكامل يبقى المرجع في المواد الرسمية. الحروف تُكتب بالخط المعتمد، ولا تُوفَّر كملفات منفصلة في هذه الحزمة.

## 7. الخط

- **The Year of The Camel**، بالأوزان: 400 Regular، 500 Medium، 700 Bold، 800 ExtraBold.
- يغطي العربية والإنجليزية. الأرقام في نماذج الهوية أرقام غربية: `0123456789`.
- لتضمين الخط في موقع أو تطبيق استخدم `05_Typography/typography.css`.

**تنبيه الترخيص:** ملفات الخط الواردة لا تتضمن نص رخصة. تأكد من شروط الترخيص قبل مشاركة ملفات الخط خارج الفريق أو مع الموردين، ومن أن الترخيص يسمح بتضمين الخط في المواد المطبوعة والرقمية.

الأوزان Thin وExtraLight وLight موجودة في الملفات الأصلية لكنها خارج أوزان الهوية المعتمدة، فلم تُدرج هنا.

ملاحظة تقنية: أسماء الأوزان داخل ملفات OTF غير متطابقة في بعض الملفات (مثلاً ملف Regular يحمل الاسم الداخلي ExLight). اعتمد اسم الملف والوزن المذكور أعلاه عند التثبيت.

## 8. الأيقونات

- 30 أيقونة من مكتبة lucide (الإصدار 0.460.0)، وهي تُستعمل في الأدلة.
- الرخصة: ISC، ونصها في `04_Icons/LICENSE-lucide-ISC.txt`.
- سماكة الخط في النسخ المرفقة 1.6، كما في الأدلة (الأصل 2). اللون الافتراضي Temptress، ويمكن تغييره إلى أي لون من الأربعة.

## 9. ما لم يحدده ملف الهوية

- قيم CMYK وPantone، تحددها المطبعة بعد اختبار الطباعة.
- مساحة الأمان حول الشعار.
- نسخة الشعار على Green Sheen (مذكورة أعلاه كنسخة مشتقة).
- ملفات الحروف المختصرة كملفات منفصلة.
- ترخيص الخط (انظر تنبيه الترخيص).

---

# TLAQI Brand Identity Kit (English summary)

**Identity 2026 · Version 1.0 · November 2026**

Built from the identity sheet in `06_Reference`. Anything not stated there is listed under "Not defined by the identity sheet" and is not treated as a rule.

**Logos.** Full lockup on Beige (default), Temptress, Mahogany (single colour, Beige) and Green Sheen (single colour, Temptress; derived, not shown on the sheet). Mark-only files for Beige/Temptress (Mahogany), Mahogany (Beige) and Green Sheen (Temptress). Use the mark alone when the full lockup would be narrower than 70 mm. Do not alter logo files.

**Colours.** Beige `#EEF6DF` (primary background), Temptress `#341D2B` (text and dark backgrounds), Mahogany `#C34900` (headings and pattern on light), Green Sheen `#67C090` (full covers with Temptress). Four colours only: no blue, and no transparency that creates a fifth colour. Green Sheen on Beige (2.0:1) is not for text.

**Patterns.** Talent (eight drops from one centre; the primary pattern), Innovation (four drops growing outward), Link (an arc joining two points). Size L for covers and panels, M for cards and small areas (half of L). No pattern behind text: place it on a separate strip or panel. No rotation or stretching.

**Typography.** The Year of The Camel, weights 400, 500, 700, 800. Use the approved typeface for all Arabic and English text; no substitute fonts in official material. The font files carry no licence text here, so confirm the licence before sharing them outside the team.

**Icons.** 30 Lucide icons (ISC licence), as used in the guides.

**Not defined by the identity sheet:** CMYK and Pantone values, clear space around the logo, a separate file for the letter marks, and the font licence.
