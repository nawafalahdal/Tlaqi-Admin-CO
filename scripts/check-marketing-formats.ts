import { existsSync } from "node:fs";
import sharp from "sharp";
import { prisma } from "@/lib/prisma";
import { inspectDesign, fitsFormat } from "@/lib/marketing/design";
import { aiStatus } from "@/lib/marketing/ai/registry";

/** المقاساتُ وفحصُ التصميم — على ملفّاتٍ حقيقيةٍ تُولَّد هنا، وقراءةٍ من القاعدة المحلية وحدها.
 *
 *  ١) المقاساتُ الأربعة في القاعدة كما في المواصفة (الأبعاد والنسبة ومنطقة الأمان).
 *  ٢) لكلٍّ منها: المطابقُ يمرّ، والأكبرُ بالنسبة نفسها تنبيه، والأصغرُ والنسبةُ الأخرى
 *     تُمنعان — من أبعاد الملف الفعلية لا من اسمه.
 *  ٣) التالفُ والمقطوعُ وما ليس صورةً تُرفض، والفارغُ تنبيه.
 *  ٤) لا توليدَ صورٍ مُدّعى، وملفّاتُ الهوية التي يُحال إليها موجودة. */

if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "")) {
  console.error("يُشغَّل على القاعدة المحلية وحدها");
  process.exit(1);
}

const checks: string[] = [];
const chk = (n: string, ok: boolean, extra = "") => checks.push(`${ok ? "✓" : "✗ FAIL"} ${n}${extra ? " — " + extra : ""}`);
const img = async (w: number, h: number, kind: "png" | "jpeg" | "webp" = "png", flat = false) => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#341D2B"/>${flat ? "" : `<circle cx="${w / 2}" cy="${h / 2}" r="${Math.min(w, h) / 3}" fill="#C34900"/>`}</svg>`;
  const s = sharp(Buffer.from(svg));
  return new Uint8Array(await (kind === "png" ? s.png() : kind === "jpeg" ? s.jpeg() : s.webp()).toBuffer());
};
const keys = (r: Awaited<ReturnType<typeof inspectDesign>>) => (r.ok ? r.checks.map((c) => `${c.key}:${c.level}`).join(",") : r.code);
const hasFail = (r: Awaited<ReturnType<typeof inspectDesign>>) => !r.ok || r.checks.some((c) => c.level === "fail");

const SPEC = [
  { key: "story", width: 1080, height: 1920, ratio: "9:16" },
  { key: "portrait", width: 1080, height: 1350, ratio: "4:5" },
  { key: "square", width: 1080, height: 1080, ratio: "1:1" },
  { key: "landscape", width: 1920, height: 1080, ratio: "16:9" },
];

(async () => {
  const rows = await prisma.marketingFormat.findMany({ where: { key: { in: SPEC.map((s) => s.key) } } });
  for (const s of SPEC) {
    const f = rows.find((r) => r.key === s.key);
    const [a, b] = s.ratio.split(":").map(Number);
    chk(`«${s.key}» ${s.width}×${s.height} (${s.ratio}) في القاعدة`, !!f && f.width === s.width && f.height === s.height && f.width * b === f.height * a && f.active, f ? `${f.width}×${f.height}` : "مفقود");
    if (!f) continue;
    const inside = f.safeTop + f.safeBottom < f.height && f.safeLeft + f.safeRight < f.width && [f.safeTop, f.safeRight, f.safeBottom, f.safeLeft].every((x) => x >= 0);
    chk(`  ومنطقةُ أمانه داخل الإطار`, inside, `${f.safeTop}/${f.safeRight}/${f.safeBottom}/${f.safeLeft}`);

    const t = { width: f.width, height: f.height };
    const exact = await inspectDesign(await img(f.width, f.height), t);
    chk(`  المطابقُ تماماً يمرّ`, exact.ok && exact.checks[0].key === "dimensions_exact" && !hasFail(exact) && fitsFormat(exact, t), keys(exact));
    const big = await inspectDesign(await img(f.width * 2, f.height * 2, "jpeg"), t);
    chk(`  ضعفُه بالنسبة نفسها (JPEG) يمرّ بتنبيه «مُكبَّر»`, big.ok && big.checks[0].key === "dimensions_scaled" && big.checks[0].level === "warn" && !hasFail(big) && fitsFormat(big, t), keys(big));
    const small = await inspectDesign(await img(f.width / 2, f.height / 2, "webp"), t);
    chk(`  نصفُه (WebP) يُمنع: «دقةٌ أقلّ»`, small.ok && small.checks[0].key === "resolution_low" && hasFail(small) && !fitsFormat(small, t), keys(small));
    const other = SPEC.find((x) => x.key !== s.key && x.width * f.height !== x.height * f.width)!;
    const wrong = await inspectDesign(await img(other.width, other.height), t);
    chk(`  مقاسُ «${other.key}» يُمنع: «نسبةٌ غيرُ مطابقة»`, wrong.ok && wrong.checks[0].key === "aspect_mismatch" && hasFail(wrong) && !fitsFormat(wrong, t), keys(wrong));
  }

  const story = { width: 1080, height: 1920 };
  // الاسمُ لا يُصدَّق: ملفٌّ مربّعٌ اسمُه «ستوري» يُقرأ من أبعاده
  const named = await inspectDesign(await img(1080, 1080), story);
  chk("الأبعادُ من الملف لا من اسمه (مربّعٌ مقدَّمٌ لستوري يُمنع)", named.ok && named.width === 1080 && named.height === 1080 && hasFail(named), keys(named));
  const near = await inspectDesign(await img(1080, 1921), story);
  chk("فرقُ بكسلٍ داخل حدّ النسبة (٠٫٥٪) تنبيهٌ لا منع", near.ok && near.checks[0].key === "dimensions_scaled" && !hasFail(near), keys(near));
  const far = await inspectDesign(await img(1080, 1940), story);
  chk("وفرقٌ أكبر من الحدّ يُمنع", far.ok && far.checks[0].key === "aspect_mismatch", keys(far));
  const blank = await inspectDesign(await img(1080, 1920, "png", true), story);
  chk("صورةٌ بلونٍ واحد: تنبيه «تبدو فارغة»", blank.ok && blank.checks.some((c) => c.key === "image_blank" && c.level === "warn"), keys(blank));
  const full = await img(1080, 1920);
  chk("ملفٌّ مقطوعٌ يُرفض «تالفاً»", keys(await inspectDesign(full.slice(0, Math.floor(full.length / 2)), story)) === "file_corrupt");
  chk("وملفٌّ ليس صورةً (HTML باسم PNG) يُرفض", ["file_corrupt", "file_type"].includes(keys(await inspectDesign(new TextEncoder().encode("<html><script>alert(1)</script></html>"), story))));
  const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920"><rect width="100%" height="100%"/></svg>');
  chk("وSVG لا يُقبل تصميماً (نوعُه من محتواه)", keys(await inspectDesign(svg, story)) === "file_type");
  const gif = new Uint8Array(await sharp(await img(1080, 1920)).gif().toBuffer());
  chk("وGIF لا يُقبل", keys(await inspectDesign(gif, story)) === "file_type");

  chk("توليدُ الصور «غيرُ مهيّأ» — فلا صورةَ تُنسب إلى الوكيل", aiStatus({}).image.state === "not_configured" && aiStatus({ MARKETING_AI_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "x", MARKETING_AI_ENABLED: "1" }).image.state === "not_configured");
  const brand = ["logo-full.png", "lockup-on-light.png", "lockup-on-dark.png", "symbol.png", "brand-guide.webp"];
  chk("ملفّاتُ الهوية التي يُحال إليها المصمّمُ موجودة", brand.every((f) => existsSync(`public/brand/${f}`)));

  console.log(checks.join("\n"));
  const failed = checks.filter((x) => x.startsWith("✗")).length;
  console.log(failed ? `\nFAILED (${failed})` : `\nALL PASS (${checks.length})`);
  await prisma.$disconnect();
  process.exit(failed ? 1 : 0);
})().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
