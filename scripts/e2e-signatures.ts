import { prisma } from "@/lib/prisma";
import {
  requestSignature, submitSignature, decideSignature,
  approvedSignatureFor, supersedeSignatures, leadersMissingSignature,
} from "@/lib/signatures";
import { certificateFor } from "@/lib/certificate";

/** دورة التوقيع كاملةً — والقاعدة الحاكمة: لا يُورَّث توقيعٌ لخَلَف. */

const checks: string[] = [];
const chk = (n: string, ok: boolean, extra = "") =>
  checks.push(`${ok ? "✓" : "✗ FAIL"} ${n}${extra ? " — " + extra : ""}`);

/** توقيعٌ اختباريٌّ حقيقي: ٢٤٠×٨٠ فيه خطٌّ أسود — يُولَّد لا يُلصَق،
 *  فالملصوق الصغير لا يُشبه توقيعاً ولا يختبر فكَّ الصورة. */
async function makeSignaturePng(): Promise<string> {
  const sharp = (await import("sharp")).default;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="80">
    <path d="M12 56 C40 18, 70 70, 100 40 S160 10, 228 48" stroke="#1A1023"
          stroke-width="3" fill="none" stroke-linecap="round"/></svg>`;
  const buf = await sharp(Buffer.from(svg)).png().toBuffer();
  return `data:image/png;base64,${buf.toString("base64")}`;
}

/** صورة فارغة تماماً — يجب أن تُرفض */
async function makeBlankPng(): Promise<string> {
  const sharp = (await import("sharp")).default;
  const buf = await sharp({
    create: { width: 240, height: 80, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).png().toBuffer();
  return `data:image/png;base64,${buf.toString("base64")}`;
}
const BIG = "data:image/png;base64," + "A".repeat(600_000);
const SVG = "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=";

const MARK = `e2e-sig-${Date.now()}`;
async function cleanup() {
  const m = await prisma.member.findUnique({ where: { email: `cert-${MARK}@example.test` } });
  if (m) await prisma.member.delete({ where: { id: m.id } });
  await prisma.invite.deleteMany({ where: { email: `cert-${MARK}@example.test` } });
  const users = await prisma.user.findMany({ where: { email: { contains: MARK } } });
  for (const u of users) {
    await prisma.leaderSignature.deleteMany({ where: { userId: u.id } });
    await prisma.user.delete({ where: { id: u.id } });
  }
}

(async () => {
  await cleanup();
  const PNG = await makeSignaturePng();
  const BLANK = await makeBlankPng();
  const dept = await prisma.department.findFirstOrThrow({ where: { name: "التسويق" } });
  const founder = await prisma.user.findFirstOrThrow({ where: { role: "super_admin" } });

  const oldLead = await prisma.user.create({
    data: { fullName: "القائد السابق", email: `old-${MARK}@example.test`, passwordHash: "x",
            role: "department_admin", departmentId: dept.id, isActive: true },
  });

  // ١ — الطلب
  const r1 = await requestSignature({ userId: oldLead.id, reason: "اختبار" });
  chk("طُلب التوقيع", r1.ok && r1.created === true);
  const r2 = await requestSignature({ userId: oldLead.id, reason: "اختبار مكرر" });
  chk("لا طلب ثانٍ لمن له طلبٌ حيّ", r2.ok && r2.created === false);

  // ٢ — الرفع: النوع والحجم يُفرَضان في الخادم
  const bad1 = await submitSignature({ userId: oldLead.id, imageData: SVG });
  chk("SVG مرفوض (قد يحمل سكربتاً ويُعرض في الشهادة)", bad1.ok === false,
      bad1.ok === false ? bad1.reason : "قُبل!");
  const bad2 = await submitSignature({ userId: oldLead.id, imageData: BIG });
  chk("صورةٌ ضخمة مرفوضة", bad2.ok === false, bad2.ok === false ? bad2.reason : "قُبلت!");
  const bad2b = await submitSignature({ userId: oldLead.id, imageData: BLANK });
  chk("صورةٌ فارغة مرفوضة — السطر الفارغ يُقرأ توقيعاً", bad2b.ok === false,
      bad2b.ok === false ? bad2b.reason : "قُبلت!");
  const bad2c = await submitSignature({
    userId: oldLead.id,
    imageData: "data:image/png;base64," + Buffer.from("not a png at all").toString("base64"),
  });
  chk("ملفٌّ يدّعي أنه PNG مرفوض", bad2c.ok === false, bad2c.ok === false ? bad2c.reason : "قُبل!");
  const ok1 = await submitSignature({ userId: oldLead.id, imageData: PNG });
  chk("PNG صالح يُقبل", ok1.ok, ok1.ok ? "" : (ok1 as {reason:string}).reason);

  // ٣ — لا يُرسَم قبل الاعتماد
  chk("لا توقيع معتمَد قبل القرار", (await approvedSignatureFor(oldLead.id)) === null);

  // ٤ — من لا يُراجع يُرفض
  const bad3 = await decideSignature({
    signatureId: (await prisma.leaderSignature.findFirstOrThrow({ where: { userId: oldLead.id } })).id,
    decision: "approve", actorId: oldLead.id, actorRole: "department_admin", actorName: "قائد",
  });
  chk("قائد القسم لا يعتمد التوقيعات", bad3.ok === false, bad3.ok === false ? bad3.reason : "اعتمد!");

  // ٥ — الرفض يحتاج سبباً
  const sigId = (await prisma.leaderSignature.findFirstOrThrow({ where: { userId: oldLead.id } })).id;
  const bad4 = await decideSignature({ signatureId: sigId, decision: "reject",
    actorId: founder.id, actorRole: "super_admin", actorName: founder.fullName });
  chk("الرفض بلا سبب مرفوض", bad4.ok === false, bad4.ok === false ? bad4.reason : "مرّ!");

  // ٦ — الاعتماد
  const ok2 = await decideSignature({ signatureId: sigId, decision: "approve",
    actorId: founder.id, actorRole: "super_admin", actorName: founder.fullName });
  chk("اعتُمد التوقيع", ok2.ok);
  // **لا يُقارَن بالمُدخَل:** التوقيع يُوحَّد عند الاستلام إلى PNG شفّافٍ
  // معتم الحبر، فالمخزون يختلف عن المرفوع بالضرورة. فيُتحقَّق أنه PNG
  // صالحٌ فيه حبرٌ وورقُه شفاف — وهو المطلوب لا تطابق البايتات.
  const stored = await approvedSignatureFor(oldLead.id);
  chk("صار له توقيع معتمَد", stored !== null);
  chk("وهو PNG مُوحَّد لا المُدخَل كما هو",
      stored !== null && stored.startsWith("data:image/png;base64,") && stored !== PNG);
  if (stored) {
    const sharp = (await import("sharp")).default;
    const buf = Buffer.from(stored.split(",")[1], "base64");
    const st = await sharp(buf).stats();
    const alphaMean = st.channels[3]?.mean ?? 255;
    chk("ورقُه شفاف وحبرُه قليل (قابلٌ للتلوين بحبر الشهادة)",
        alphaMean > 1 && alphaMean < 120, `شفافية ${alphaMean.toFixed(1)}`);
  }

  // ٧ — قرارٌ ثانٍ على نفس التوقيع لا يمرّ
  const dup = await decideSignature({ signatureId: sigId, decision: "approve",
    actorId: founder.id, actorRole: "super_admin", actorName: founder.fullName });
  chk("قرارٌ ثانٍ لا يمرّ", dup.ok === false, dup.ok === false ? dup.reason : "مرّ!");

  // ٨ — **القاعدة الحاكمة**: خَلَفُه لا يرث توقيعه
  await supersedeSignatures(oldLead.id, "خرج من منصبه");
  await prisma.user.update({ where: { id: oldLead.id }, data: { isActive: false } });
  chk("توقيع من خرج بطل", (await approvedSignatureFor(oldLead.id)) === null);

  const newLead = await prisma.user.create({
    data: { fullName: "القائد الجديد", email: `new-${MARK}@example.test`, passwordHash: "x",
            role: "department_admin", departmentId: dept.id, isActive: true },
  });
  chk("الخَلَف لا توقيع له", (await approvedSignatureFor(newLead.id)) === null);
  const missing = await leadersMissingSignature();
  chk("ويظهر في «قادة بلا توقيع»", missing.some((m) => m.id === newLead.id));

  // ٩ — الشهادة: النقص مُعلَن لا صامت.
  //
  //     يُبنى عضوٌ في قسمٍ قائدُه هو قائدُنا الاختباري، فيكون المُوقّعان
  //     معلومين — ولا يعتمد التحقّق على توقيعاتٍ قائمةٍ في القاعدة.
  const certMember = await prisma.member.create({
    data: {
      fullName: "عضو شهادة الاختبار",
      email: `cert-${MARK}@example.test`,
      departmentId: dept.id,
      inviteId: (await prisma.invite.create({
        data: {
          fullName: "عضو شهادة الاختبار", email: `cert-${MARK}@example.test`,
          targetRole: "member", departmentId: dept.id,
          testTrackId: (await prisma.testTrack.findFirstOrThrow({ where: { departmentId: dept.id } })).id,
          invitedById: founder.id, status: "used",
        },
      })).id,
      certificateIssuedAt: new Date(),
      decidedAt: new Date("2026-01-01"),
    },
  });

  // القائد الجديد (بلا توقيع) هو قائد القسم الآن
  const dataMissing = await certificateFor(certMember.id, "final");
  const leadEntry = dataMissing?.signers.find((sg) => sg.title.includes(dept.name));
  chk("الشهادة تُصدَر باسم المُوقّع وصفته", Boolean(leadEntry?.name));
  chk("ولا صورة توقيعٍ منتحلة للقائد الجديد", leadEntry?.signatureImage === null);
  chk("والنقص مُعلَن لا صامت",
      (dataMissing?.missingSignatures ?? []).some((x) => x.includes(dept.name)),
      (dataMissing?.missingSignatures ?? []).join("، ") || "لا نقص");

  await prisma.member.delete({ where: { id: certMember.id } });
  await prisma.invite.deleteMany({ where: { email: `cert-${MARK}@example.test` } });

  // ١٠ — السجل التاريخي يبقى
  const history = await prisma.leaderSignature.findMany({ where: { userId: oldLead.id } });
  chk("سجلّ التوقيع الباطل محفوظ لا محذوف", history.length === 1 && history[0].status === "superseded");
  chk("وتاريخ بطلانه مُسجَّل", history[0]?.supersededAt !== null);

  await cleanup();
  console.log(checks.join("\n"));
  const failed = checks.some((c) => c.startsWith("✗"));
  console.log("\n" + (failed ? "FAILURES PRESENT" : "ALL PASS"));
  process.exit(failed ? 1 : 0);
})().catch(async (e) => { console.error(e); await cleanup(); process.exit(1); });
