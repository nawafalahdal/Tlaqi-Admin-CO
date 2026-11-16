/** **البطاقةُ داخل رسالة الاعتماد** (البند ٢) — ثوابتُ يتشاركها راسمُ المرفق (`businessCardData`) وقالبُ الرسالة (`email`)
 *  بلا أن يستورد أحدُهما الآخر. والنسبةُ نسبةُ البطاقة الرسمية نفسها (`BIZ_MM` في `shareCards`: 54×85.6 مم). */
export const CARD_CONTENT_ID = "tlaqi-card";
/** عرضُها المعروض في الرسالة بالبكسل — والصورةُ المرفقة بضعفه لشاشات الدقّة العالية */
export const CARD_INLINE_WIDTH = 260;
export const CARD_INLINE_HEIGHT = Math.round((CARD_INLINE_WIDTH * 85.6) / 54);
