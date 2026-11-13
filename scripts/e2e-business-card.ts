/** البطاقةُ الرسمية (Business Card): بياناتُها من السجلّ، وصورتُها أو الهيئةُ الافتراضية بجنسه،
 *  وإرفاقُها برسالة الترحيب للعضو والقائد، ورابطُ «بطاقتي» الموقَّع.
 *
 *  تشغيل: DATABASE_URL=… npx tsx --tsconfig tsconfig.json scripts/e2e-business-card.ts */
import sharp from "sharp";
import { prisma } from "@/lib/prisma";
import { captureEmails } from "@/lib/emailCapture";
import { BRAND } from "@/lib/brand";

const TAG = `e2e-biz-${Date.now()}`;
const EMAIL = `${TAG}@example.test`;
const checks: string[] = [];
const chk = (n: string, ok: boolean, extra = "") => checks.push(`${ok ? "✓" : "✗ FAIL"} ${n}${!ok && extra ? " — " + extra : ""}`);

(async () => {
  const { businessCardData, businessCardAttachment, businessCardFileName } = await import("@/lib/businessCardData");
  const { defaultPortrait } = await import("@/lib/defaultPortraits");
  const { renderBusinessCard } = await import("@/lib/shareCards");
  const { sendWelcomePack } = await import("@/lib/welcome");
  const { signBannerToken } = await import("@/lib/bannerToken");
  const { GET } = await import("@/app/api/cards/[type]/[token]/route");

  const marketing = await prisma.department.findFirstOrThrow({ where: { colorHex: { equals: BRAND.mahogany, mode: "insensitive" }, parentId: null } });
  const founder = await prisma.user.findFirstOrThrow({ where: { role: "super_admin", isActive: true } });
  const track = await prisma.testTrack.findFirstOrThrow({ where: { scope: "department_member" } });
  const inv = await prisma.invite.create({ data: { fullName: "ريم الاختبارية", email: EMAIL, targetRole: "member", departmentId: marketing.id, testTrackId: track.id, invitedById: founder.id, status: "used" } });
  const member = await prisma.member.create({
    data: { fullName: "ريم الاختبارية", email: EMAIL, departmentId: marketing.id, inviteId: inv.id, passwordHash: "x", jobTitle: "أخصائية محتوى", gender: "female", approvalStatus: "approved", testStatus: "passed", isActive: true, decidedAt: new Date() },
  });

  try {
    // ── البيانات من السجلّ
    const card = await businessCardData({ kind: "member", id: member.id });
    chk("بياناتُ البطاقة من السجلّ", !!card);
    chk("الاسمُ والمهمّةُ كما سُجّلا", card?.data.fullName === "ريم الاختبارية" && card?.data.task === "أخصائية محتوى");
    chk("والمنصبُ بجنسها («عضوة»)", card?.data.position === "عضوة", card?.data.position);
    chk("والقسمُ ولونُه", card?.data.departmentName === marketing.name && card?.data.colorHex?.toUpperCase() === BRAND.mahogany.toUpperCase(), `${card?.data.departmentName} ${card?.data.colorHex}`);

    // ── بلا صورة: الهيئةُ الافتراضية بجنسها (أو الحرفُ الأول إن لم تُضَف صورتُها بعد)
    const female = defaultPortrait("female");
    chk("بلا صورةٍ مرفوعة تُستعمل الهيئةُ الافتراضية لجنسها", card?.data.photo === female, female ? "buffer" : "null");
    chk("ومن لم يُحدَّد جنسُه لا هيئةَ له (الحرفُ الأول)", defaultPortrait(null) === null && defaultPortrait("x") === null);

    // ── بصورةٍ مرفوعة: صورتُه هي لا الافتراضية
    const tiny = await sharp({ create: { width: 40, height: 50, channels: 3, background: "#808080" } }).png().toBuffer();
    await prisma.member.update({ where: { id: member.id }, data: { avatarData: `data:image/png;base64,${tiny.toString("base64")}`, avatarVersion: new Date() } });
    const withPhoto = await businessCardData({ kind: "member", id: member.id });
    chk("وبصورةٍ مرفوعة تُستعمل صورتُه", !!withPhoto?.data.photo && withPhoto.data.photo.equals(tiny));
    chk("وتغييرُ الصورة يُجدّد رابطَ البطاقة", withPhoto?.version !== card?.version);

    // ── الرسم: مقاسُ CR80 بدقّة الطباعة
    const png = await renderBusinessCard(withPhoto!.data);
    const meta = await sharp(png).metadata();
    chk("البطاقةُ مرسومةٌ بمقاس CR80 (١٢٧٦×٢٠٢٢)", meta.width === 1276 && meta.height === 2022, `${meta.width}×${meta.height}`);

    // ── رسالة الترحيب: البطاقةُ مرفقة، وسطرٌ واحدٌ يذكرها، وجسمُ الرسالة نصٌّ كما هو
    const mails = await captureEmails(() => sendWelcomePack({ kind: "member", id: member.id }, "approved"));
    const welcome = mails.find((m) => m.to.includes(EMAIL));
    chk("رسالةُ الترحيب تصل العضو", !!welcome, JSON.stringify(mails.map((m) => m.subject)));
    const att = welcome?.attachments?.[0];
    chk("**ومعها البطاقةُ الرسمية مرفقة**", !!att && att.filename === businessCardFileName("ريم الاختبارية"), att?.filename ?? "لا مرفق");
    const attMeta = att ? await sharp(att.content).metadata() : null;
    chk("والمرفقُ صورةُ البطاقة نفسها", attMeta?.format === "png" && attMeta.width === 1276, `${attMeta?.format} ${attMeta?.width}`);
    chk("وسطرٌ في الرسالة يذكرها بجنسها", (welcome?.content.paragraphs ?? []).some((p) => p.includes("ومرفقةٌ بهذه الرسالة بطاقتُكِ الرسمية")));
    chk("وجسمُ الرسالة بلا صورة (نصٌّ كما اعتُمد)", !welcome?.content.image);

    // ── القائد/الإدارة العليا: بطاقتُه بقسم انتمائه، ومرفقةٌ بترحيبه
    const exec = await prisma.user.findFirst({ where: { role: "executive", isActive: true } });
    if (exec) {
      const ec = await businessCardData({ kind: "user", id: exec.id });
      const senior = await prisma.department.findFirst({ where: { leadershipOnly: true, parentId: null }, orderBy: { createdAt: "asc" } });
      chk("التنفيذيُّ بطاقتُه في الإدارة العليا", ec?.data.departmentName === (senior?.name ?? exec.departmentId), `${ec?.data.departmentName}`);
      const a = await businessCardAttachment({ kind: "user", id: exec.id });
      chk("وتُرسم له بطاقةٌ مرفقة", !!a && a.content.length > 0);
    } else {
      chk("التنفيذيُّ بطاقتُه في الإدارة العليا (لا تنفيذيَّ في هذه القاعدة — تُخطّى)", true);
    }

    // ── رابطُ «بطاقتي»: موقَّعٌ لصاحبه، والمعبوثُ به لا يُرسم
    const token = signBannerToken({ kind: "member", id: member.id });
    const call = (type: string, tok: string) =>
      GET(new Request(`http://local/api/cards/${type}/${tok}?v=1`), { params: Promise.resolve({ type, token: tok }) });
    const ok = await call("business", token);
    chk("رابطُ «بطاقتي» الموقَّع يُعيد البطاقة", ok.status === 200 && ok.headers.get("content-type") === "image/png", String(ok.status));
    const bad = await call("business", token.slice(0, -3) + "xyz");
    chk("والتوقيعُ المعبوثُ به لا يُعيد شيئاً", bad.status === 404, String(bad.status));
    const dl = await GET(new Request(`http://local/api/cards/business/${token}?v=1&download=TLAQI-ريم`), { params: Promise.resolve({ type: "business", token }) });
    chk("وزرُّ الحفظ يحفظها باسمها", (dl.headers.get("content-disposition") ?? "").includes("attachment"), dl.headers.get("content-disposition") ?? "");
  } finally {
    await prisma.member.delete({ where: { id: member.id } }).catch(() => {});
    await prisma.invite.delete({ where: { id: inv.id } }).catch(() => {});
    for (const c of checks) console.log(c);
    const failedN = checks.filter((c) => c.startsWith("✗")).length;
    console.log(`\n${checks.length - failedN}/${checks.length}`);
    await prisma.$disconnect();
    process.exit(failedN ? 1 : 0);
  }
})();
