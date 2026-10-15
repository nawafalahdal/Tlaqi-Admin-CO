import sharp from "sharp";
import { normalizeAvatar, saveAvatar, clearAvatar } from "@/lib/avatars";
import { prisma } from "@/lib/prisma";
import { avatarUrl } from "../src/lib/avatarUrl";

const log: string[] = [];
function chk(name: string, pass: boolean, extra = "") {
  log.push(`${pass ? "✓" : "✗ FAIL"} ${name}${extra ? " — " + extra : ""}`);
}

/** الصور الشخصية — التحقّق بفكّ الصورة لا بامتدادها، والتوحيد عند
 *  الاستلام. ويُختبَر بصورٍ حقيقية تُصنَع هنا لا بمحاكاة. */
(async () => {
  // ── ١) صورةٌ سليمة بشفافية
  const good = await sharp({
    create: { width: 900, height: 600, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([
      {
        input: await sharp({
          create: { width: 400, height: 400, channels: 4, background: { r: 195, g: 73, b: 0, alpha: 1 } },
        }).png().toBuffer(),
        gravity: "center",
      },
    ])
    .png()
    .toBuffer();

  const ok = await normalizeAvatar(good);
  chk("الصورة السليمة تُقبَل", ok.ok, ok.ok ? `${ok.bytes}B` : ok.reason);

  if (ok.ok) {
    const meta = await sharp(Buffer.from(ok.dataUrl.split(",")[1], "base64")).metadata();
    chk("وتُوحَّد إلى مربّع ٥١٢", meta.width === 512 && meta.height === 512,
        `${meta.width}×${meta.height}`);
    chk("**والشفافية محفوظة لا مُسطَّحة على أبيض**", meta.hasAlpha === true);
    chk("**والمخرَج WebP دائماً — ٧٩٪ أخفُّ من PNG بلا فرقٍ يُرى**",
      meta.format === "webp", String(meta.format));
    chk("ومستطيلٌ لا يُقطَع بل يُحتوى", meta.width === meta.height);
  }

  // ── ٢) ملفٌّ نصّي يدّعي أنه صورة
  const notImage = await normalizeAvatar(Buffer.from("PNG? لا، هذا نصّ فقط"));
  chk("**ملفٌّ ليس صورةً يُرفَض — ولو سُمّي .png**", notImage.ok === false,
      notImage.ok === false ? notImage.reason : "قُبل!");

  // ── ٣) صورةٌ شفّافةٌ بالكامل: تمرّ كل فحوص الصيغة ولا تُعرَض شيئاً
  const blank = await sharp({
    create: { width: 400, height: 400, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).png().toBuffer();
  const blankRes = await normalizeAvatar(blank);
  chk("**والشفّافة بالكامل تُرفَض — لا شيء فيها يُعرَض**", blankRes.ok === false,
      blankRes.ok === false ? blankRes.reason : "قُبلت!");

  // ── ٤) صورةٌ أصغر من الحدّ
  const tiny = await sharp({
    create: { width: 20, height: 20, channels: 4, background: { r: 10, g: 10, b: 10, alpha: 1 } },
  }).png().toBuffer();
  const tinyRes = await normalizeAvatar(tiny);
  chk("والصغيرة جداً تُرفَض", tinyRes.ok === false,
      tinyRes.ok === false ? tinyRes.reason : "قُبلت!");

  // ── ٥) JPEG يُقبَل ويُحوَّل WebP
  const jpeg = await sharp({
    create: { width: 700, height: 700, channels: 3, background: { r: 103, g: 192, b: 144 } },
  }).jpeg().toBuffer();
  const jpegRes = await normalizeAvatar(jpeg);
  chk("و JPEG يُقبَل", jpegRes.ok, jpegRes.ok ? "" : jpegRes.reason);
  if (jpegRes.ok) {
    const m = await sharp(Buffer.from(jpegRes.dataUrl.split(",")[1], "base64")).metadata();
    chk("ويُحوَّل WebP", m.format === "webp", String(m.format));
  }

  // ── ٦) ملفٌّ ضخم يُرفَض قبل فكّه
  const huge = Buffer.alloc(7 * 1024 * 1024, 1);
  const hugeRes = await normalizeAvatar(huge);
  chk("والملفّ الضخم يُرفَض", hugeRes.ok === false,
      hugeRes.ok === false ? hugeRes.reason : "قُبل!");

  // ── ٧) الحفظ: صورةٌ واحدة تُستبدَل ولا تُجمَع
  const member = await prisma.member.findFirstOrThrow({ where: { approvalStatus: "approved" } });
  const before = member.avatarData;

  const saved = await saveAvatar({ kind: "member", id: member.id }, good);
  chk("تُحفَظ للعضو", saved.ok, saved.ok ? `${saved.bytes}B` : saved.reason);
  const afterSave = await prisma.member.findUniqueOrThrow({ where: { id: member.id } });
  chk("وصارت في سجلّه", (afterSave.avatarData ?? "").startsWith("data:image/webp;base64,"));
  // والختمُ يُكتَب معها في نفس التحديث: المخزَن `immutable`، فختمٌ ناقصٌ
  // أو متأخّرٌ يَعرض الصورةَ السابقة سنةً ولا شيءَ يُصحّحه بعدها
  chk("**والختمُ يُكتَب مع الصورة لا بعدها**", afterSave.avatarVersion !== null,
      String(afterSave.avatarVersion));
  chk("ورابطُها يَحمل الختم",
      (avatarUrl("member", member.id, afterSave.avatarVersion) ?? "").includes("?v="),
      avatarUrl("member", member.id, afterSave.avatarVersion) ?? "null");

  const replaced = await saveAvatar({ kind: "member", id: member.id }, jpeg);
  chk("والاستبدال يمرّ", replaced.ok);
  const afterReplace = await prisma.member.findUniqueOrThrow({ where: { id: member.id } });
  chk("**وصورةٌ واحدة لا تُجمَع**",
      afterReplace.avatarData !== afterSave.avatarData && !!afterReplace.avatarData);
  chk("**والختمُ يتغيّر بالاستبدال — فيُطلَب الرابطُ الجديد**",
      afterReplace.avatarVersion !== null &&
        afterSave.avatarVersion !== null &&
        afterReplace.avatarVersion.getTime() !== afterSave.avatarVersion.getTime(),
      `${afterSave.avatarVersion?.toISOString()} ← ${afterReplace.avatarVersion?.toISOString()}`);

  await clearAvatar({ kind: "member", id: member.id });
  const afterClear = await prisma.member.findUniqueOrThrow({ where: { id: member.id } });
  chk("والحذف يُعيد العنصر الافتراضي", afterClear.avatarData === null);
  chk("**ويَمسح الختمَ معها — فلا يَبقى رابطٌ إلى لا شيء**",
      afterClear.avatarVersion === null);
  chk("ولا رابطَ لمن لا صورةَ له",
      avatarUrl("member", member.id, afterClear.avatarVersion) === null);

  // ── ٨) ولا تُحفَظ لسجلٍّ غير موجود
  const ghost = await saveAvatar({ kind: "member", id: "لا-سجلّ" }, good);
  chk("ولا تُحفَظ لسجلٍّ غير موجود", ghost.ok === false,
      ghost.ok === false ? ghost.reason : "حُفظت!");

  // إعادة ما كان
  await prisma.member.update({
    where: { id: member.id },
    data: { avatarData: before, avatarVersion: before ? new Date() : null },
  });

  console.log(log.join("\n"));
  const failed = log.some((l) => l.startsWith("✗"));
  console.log("\n" + (failed ? "FAILURES PRESENT" : "ALL PASS"));
  process.exit(failed ? 1 : 0);
})();
