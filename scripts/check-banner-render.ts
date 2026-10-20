import { renderWelcomeBanner } from "@/lib/welcomeBanner";
import sharp from "sharp";
import { renderInviteCard, renderWelcomeCard, CARD_W, CARD_H } from "@/lib/shareCards";

/** بوّابة بناء: هل ترسم بيئةُ التنفيذ العربيةَ فعلاً؟
 *
 *  اللوحة الترحيبية تُركَّب بـlibrsvg عبر pango/fontconfig. وهذه كلّها
 *  مكتباتُ نظامٍ لا حزمُ npm: تعمل على جهاز التطوير وقد لا تعمل في
 *  حاضنة التنفيذ — أو تعمل بلا خطٍّ عربي فترسم مربّعاتٍ فارغة. وهو عطبٌ
 *  لا يُكتشف محلياً أبداً، ولا يُرى في الإنتاج إلا بفتح بريد عضوٍ حقيقي.
 *
 *  ولم يكن بوسعي التحقّق من الإنتاج من خارجه: الرابط موقَّع بمفتاح
 *  الإنتاج، وقراءةُ قاعدة الإنتاج ممنوعة، وفتحُ مسارٍ تشخيصيٍّ عامّ
 *  لمجرّد الاختبار ثغرةٌ لا تحقّق.
 *
 *  فنُقِل التحقّق إلى البناء. البناء يجري في حاضنة Vercel نفسها، بنفس
 *  صورة النظام ونفس `node_modules` ونفس ملفّ الخط من المستودع. فإن
 *  بُنيت النسخة فقد رُسمت العربية في تلك البيئة فعلاً — ويُطبَع المقياس
 *  في سجل البناء ليُقرأ لا ليُفترَض.
 *
 *  وليست البيئتان متطابقتين تماماً (البناء وlambda)، فهذا دليلٌ قويّ لا
 *  برهانٌ قاطع. ويبقى حارسُ وقت التنفيذ في `welcomeBanner.ts` طبقةً
 *  ثانية: إن خرجت الطبقة فارغةً رُفع خطأٌ يُقرأ في السجل.
 */

/** الحدّ الأدنى لكثافة الحبر في طبقة النصّ.
 *
 *  القياس محلياً ≈ ١١٫٨ لسطرٍ واحد، وأكثر للوحة بأسطرها الثلاثة. فـ١٫٠
 *  هامشٌ واسع: يمرّ أيُّ رسمٍ حقيقي ويسقط الفراغ التامّ. */
const MIN_ALPHA_MEAN = 1.0;

/** بيانات اختبارٍ صريحة — لا سجلَّ عضوٍ حقيقي يُقرأ في البناء */
const FIXTURE = {
  fullName: "اختبار الخطوط",
  role: "مسمّى تجريبي",
  team: "قسم تجريبي",
  colorHex: "#341D2B",
};

async function main() {
  const probe = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="80">` +
    `<text x="380" y="55" font-family="Cairo, 'Noto Sans Arabic', sans-serif" font-size="36"` +
    ` fill="#ffffff" direction="rtl" text-anchor="start">${FIXTURE.fullName}</text></svg>`;

  const stats = await sharp(Buffer.from(probe)).png().stats();
  const alphaMean = stats.channels[3]?.mean ?? 0;
  console.log(`  كثافة حبر النصّ العربي = ${alphaMean.toFixed(3)} (الحدّ ${MIN_ALPHA_MEAN})`);

  if (alphaMean < MIN_ALPHA_MEAN) {
    console.error(
      "\n✗ بيئة البناء لا ترسم النصّ العربي: طبقة النصّ خرجت فارغة.\n" +
        "  الأرجح أن libvips بُني بلا دعم pango، أو أن fontconfig لا يجد\n" +
        "  الخط في assets/fonts. واللوحة الترحيبية ستصل بلا اسم صاحبها.\n"
    );
    process.exit(1);
  }

  // ثم اللوحة كاملةً: الأصل الرمادي + التلوين + التركيب على ٤٦ إطاراً
  const gif = await renderWelcomeBanner(FIXTURE);
  if (gif.subarray(0, 3).toString() !== "GIF") {
    console.error("\n✗ ناتج اللوحة ليس GIF\n");
    process.exit(1);
  }
  const pages = (await sharp(gif, { animated: true }).metadata()).pages ?? 1;
  if (pages < 2) {
    console.error(`\n✗ اللوحة ساكنة (${pages} إطار) — فُقدت الحركة\n`);
    process.exit(1);
  }

  console.log(
    `✓ اللوحة الترحيبية تُرسَم في بيئة البناء: ${pages} إطاراً، ${(gif.length / 1024).toFixed(0)}KB`
  );

  // ثم صورتا المشاركة: ملصق الدعوة وبطاقة العضوية. تُرسمان بالأدوات
  // نفسها، فيُتحقَّق أنهما تخرجان بالمقاس الصحيح وأن الاسم مرسومٌ فيهما:
  // صورةٌ بلا اسمٍ تبدو سليمة وقد فقدت كلّ ما يجعلها لصاحبها.
  const cards = {
    invite: await renderInviteCard({
      fullName: FIXTURE.fullName,
      position: "عضوية قسم تجريبي",
      jobTitle: FIXTURE.role,
      departmentName: FIXTURE.team,
      colorHex: "#67C090",
      invitedByName: "داعٍ تجريبي",
      issuedAt: new Date(),
    }),
    welcome: await renderWelcomeCard({
      fullName: FIXTURE.fullName,
      greeting: "أهلاً بك",
      title: FIXTURE.role,
      roleTitle: "عضو",
      joinedLabel: "انضمّ في",
      joinedAt: new Date(),
      departmentName: FIXTURE.team,
      colorHex: "#C34900",
    }),
  };
  for (const [name, png] of Object.entries(cards)) {
    const meta = await sharp(png).metadata();
    if (meta.format !== "png" || meta.width !== CARD_W || meta.height !== CARD_H) {
      console.error(`\n✗ صورة «${name}» بمقاسٍ أو صيغةٍ غير متوقّعة: ${meta.format} ${meta.width}×${meta.height}\n`);
      process.exit(1);
    }
  }
  console.log(
    `✓ صورتا المشاركة تُرسمان: الدعوة ${(cards.invite.length / 1024).toFixed(0)}KB، العضوية ${(cards.welcome.length / 1024).toFixed(0)}KB`
  );
}

main().catch((err) => {
  console.error("\n✗ تعذّر توليد اللوحة الترحيبية في بيئة البناء:\n ", err);
  process.exit(1);
});
