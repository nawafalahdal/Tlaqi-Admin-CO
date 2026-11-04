import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/credentials";
import { issueLoginCode } from "@/lib/loginCodes";
import { sweepThreeMonthAppreciation } from "@/lib/appreciation";
import { markCertificateShared } from "@/lib/offboarding";
import {
  departmentCode,
  numberPrefix,
  recipientDetails,
  issueCertificate,
  resendIssued,
  issuedCertificateView,
  listIssued,
  type IssueActor,
} from "@/lib/certificateRegistry";
import { signRegistryToken, verifyRegistryToken, verifyCertificateToken, signCertificateToken } from "@/lib/certificate";
import { applyDerived, defaultFields, fieldEdits, occasionFor } from "@/lib/certificateTypes";

/** **سجلُّ الشهادات الصادرة ونموذجُ الإصدار** — على بياناتٍ اختباريةٍ تُنشأ وتُحذف، والقاعدةُ محليةٌ وحدها.
 *
 *  لا بريدَ حقيقيّ: مزوّدُ البريد غيرُ مضبوطٍ محلياً، فكلُّ إرسالٍ «لم يصل» — وهذا نفسُه
 *  يُختبر (الصفُّ يبقى بلا `sentAt`، والإعادةُ لا تُصدر ثانية).
 *
 *    npx tsx --tsconfig tsconfig.json scripts/e2e-certificate-registry.ts   (والخادمُ على :3000 للجزء الأخير) */
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "")) {
  console.error("يُشغَّل على القاعدة المحلية وحدها");
  process.exit(1);
}
if (process.env.RESEND_API_KEY) {
  console.error("مزوّدُ البريد مضبوط — لا يُشغَّل هذا الفحص حيث قد يخرج بريدٌ حقيقي");
  process.exit(1);
}
const BASE = process.env.CHECK_BASE_URL ?? "http://localhost:3000";
const TAG = `e2e-creg-${Date.now()}`;
const PASS = "CertReg#2026aa";
const DAY = 86_400_000;

const checks: string[] = [];
const chk = (n: string, ok: boolean, extra = "") => checks.push(`${ok ? "✓" : "✗ FAIL"} ${n}${!ok && extra ? " — " + extra : ""}`);

async function cleanup() {
  const ms = await prisma.member.findMany({ where: { email: { startsWith: "e2e-creg-" } }, select: { id: true, inviteId: true } });
  for (const m of ms) {
    await prisma.member.delete({ where: { id: m.id } }).catch(() => {});
    await prisma.invite.delete({ where: { id: m.inviteId } }).catch(() => {});
  }
  await prisma.loginCode.deleteMany({ where: { email: { startsWith: "e2e-creg-" } } }).catch(() => {});
  await prisma.user.deleteMany({ where: { email: { startsWith: "e2e-creg-" } } }).catch(() => {});
}

async function signIn(email: string) {
  const jar = new Map<string, string>();
  const keep = (r: Response) => { for (const c of r.headers.getSetCookie()) { const [pair] = c.split(";"); const i = pair.indexOf("="); jar.set(pair.slice(0, i), pair.slice(i + 1)); } };
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  const csrf = await fetch(`${BASE}/api/auth/csrf`); keep(csrf);
  const { csrfToken } = (await csrf.json()) as { csrfToken: string };
  const code = await issueLoginCode(email);
  keep(await fetch(`${BASE}/api/auth/callback/credentials`, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookie() }, body: new URLSearchParams({ csrfToken, email, password: PASS, loginCode: String(code), callbackUrl: "/" }) }));
  return cookie();
}

(async () => {
  await cleanup();
  const dept =
    (await prisma.department.findFirst({ where: { slug: "marketing", parentId: null } })) ??
    (await prisma.department.findFirstOrThrow({ where: { parentId: null, leadershipOnly: false } }));
  const code = departmentCode(dept);
  const track = await prisma.testTrack.findFirstOrThrow();
  const founder = await prisma.user.findFirstOrThrow({ where: { role: "super_admin" } });
  const year = new Date().getFullYear();

  let n = 0;
  async function mkMember(o: { role?: "member" | "department_admin" | "operations_officer"; decidedDaysAgo: number; stepDown?: boolean; gender?: "male" | "female" }) {
    n += 1;
    const email = `${TAG}-${n}@example.test`;
    const invite = await prisma.invite.create({
      data: { fullName: `مُكرَّم ${n}`, email, targetRole: o.role ?? "member", departmentId: dept.id, testTrackId: track.id, invitedById: founder.id, status: "used" },
    });
    const decidedAt = new Date(Date.now() - o.decidedDaysAgo * DAY);
    return prisma.member.create({
      data: {
        fullName: `نموذج ${TAG.slice(-5)} ${n}`, email, departmentId: dept.id, inviteId: invite.id, jobTitle: "كاتبة محتوى",
        gender: o.gender ?? "female", decidedAt, joinDate: decidedAt, approvalStatus: "approved", isActive: true,
        ...(o.stepDown ? { stepDownAt: new Date(), exitReason: "فحص" } : {}),
      },
    });
  }
  const ops: IssueActor = { id: "e2e-ops", name: "مسؤول التشغيل (فحص)", role: "operations_officer" };
  const ceo: IssueActor = { id: "e2e-ceo", name: "الرئيس التنفيذي (فحص)", role: "executive" };

  // ١ — الرقم: رمزُ القسم، والسنة، وحرفُ النوع
  chk("رمز القسم: التسويق MKT والتقنية TEC والموارد HR، واللجنة برمز قسمها",
    departmentCode({ slug: "marketing" }) === "MKT" && departmentCode({ slug: "tech" }) === "TEC" && departmentCode({ slug: "hr" }) === "HR" &&
    departmentCode({ slug: "content-committee", parent: { slug: "marketing" } }) === "MKT" && departmentCode(null) === "GEN" && departmentCode({ slug: "قسم" }) === "GEN");
  chk("البادئة: TLAQI-رمز-سنة- ثم L- للقيادة وA- للتعيين",
    numberPrefix("MKT", "appreciation").startsWith("TLAQI-MKT-") && /^TLAQI-MKT-\d{4}-L-$/.test(numberPrefix("MKT", "leadership")) && /^TLAQI-MKT-\d{4}-A-$/.test(numberPrefix("MKT", "appointment")));

  const m3 = await mkMember({ decidedDaysAgo: 120 });
  const mEarly = await mkMember({ decidedDaysAgo: 72 });
  const lead = await mkMember({ role: "department_admin", decidedDaysAgo: 200 });
  const closing = await mkMember({ decidedDaysAgo: 60, stepDown: true });
  const shortStay = await mkMember({ decidedDaysAgo: 5, stepDown: true });
  const opsMember = await mkMember({ role: "operations_officer", decidedDaysAgo: 100, gender: "male" });
  const swept = await mkMember({ decidedDaysAgo: 100 });

  // ٢ — بيانات المستلِم بالسلسلة
  const d = await recipientDetails("operations_officer", m3.id);
  chk("مسؤول التشغيل يقرأ بيانات عضوٍ في عهدته", d.ok);
  const dx = await recipientDetails("executive", m3.id);
  chk("والرئيس التنفيذي لا يقرأ بيانات عضو (ليس في عهدته)", !dx.ok);
  const dops = await recipientDetails("operations_officer", opsMember.id);
  chk("ولا يقرأ مسؤولُ التشغيل بياناتِ مسؤول تشغيل", !dops.ok);
  if (d.ok) {
    chk("الأرقام التالية بالصيغة المعتمدة لكل نوع", /^TLAQI-[A-Z]{2,3}-\d{4}-\d{4}$/.test(d.nextNumbers.appreciation) && /-L-\d{4}$/.test(d.nextNumbers.leadership) && /-A-\d{4}$/.test(d.nextNumbers.appointment), JSON.stringify(d.nextNumbers));
    chk("شهادة الختام ممنوعة لمن لم يتنحَّ، والتقدير متاح", !!d.blocked.final && !d.blocked.appreciation);
    chk("أكمل ثلاثة أشهر — والمدة المطبوعة «٣ أشهر»", d.facts.completedThreeMonths && d.defaults.appreciation.duration === "٣ أشهر", d.defaults.appreciation.duration);
    chk("البريد مُقنَّع في الفحوص", /^n•••@example\.test$/.test(d.recipient.emailMasked) || d.recipient.emailMasked.includes("•••@"), d.recipient.emailMasked);
    chk("العضو يوقّع له الرئيس التنفيذي ومن يمثّل جهته، والقيادة المؤسسُ والتنفيذي",
      d.signers.other.pair[1].seat === "executive" && d.signers.leadership.pair[0].seat === "founder" && d.signers.leadership.pair[1].seat === "executive");
  }

  // ٣ — الإنجاز: الحقول المطلوبة، والرقم، ولا تكرار
  const missing = await issueCertificate(ops, { memberId: m3.id, type: "achievement", fields: { printedName: m3.fullName } });
  chk("الإنجاز بلا اسمِ إنجاز يُرَد (أكمل)", !missing.ok && missing.reason.includes("أكمل"), JSON.stringify(missing));
  const baseAch = d.ok ? d.defaults.achievement : ({} as never);
  const achFields = applyDerived("achievement", { ...baseAch, achievement: "نظام الحجز الداخلي" }, "female");
  const a1 = await issueCertificate(ops, { memberId: m3.id, type: "achievement", fields: achFields });
  chk("يصدر الإنجاز برقمٍ بالصيغة المعتمدة", a1.ok && new RegExp(`^TLAQI-${code}-\\d{4}-\\d{4}$`).test(a1.number), JSON.stringify(a1));
  chk("ومحلياً لا بريد — فيُقال «لم يصل» صراحةً ولا يُدّعى الإرسال", a1.ok && a1.delivered === false);
  if (a1.ok) {
    const row = await prisma.issuedCertificate.findUniqueOrThrow({ where: { id: a1.id } });
    chk("السجل باسم من أصدرها ووقته، وبلا تعديلاتٍ يدوية (الإنجاز إدخال لا تعديل)", row.issuedByName === ops.name && row.issuedById === ops.id && row.edits === null && row.sentAt === null);
    chk("والنصُّ اشتُقّ من الإنجاز بجنس صاحبتها", String((row.data as { fields: { sentence: string } }).fields.sentence).includes("لإنجازها نظام الحجز الداخلي"));
  }
  const a1dup = await issueCertificate(ops, { memberId: m3.id, type: "achievement", fields: achFields });
  chk("الإنجازُ نفسه ثانيةً يُرَد — لا تكرار لمناسبةٍ واحدة", !a1dup.ok && a1dup.reason.includes("تكرار"), JSON.stringify(a1dup));
  const a2 = await issueCertificate(ops, { memberId: m3.id, type: "achievement", fields: { ...achFields, achievement: "حملة صوت الطلاب", sentence: "" } });
  chk("إنجازٌ آخر يُقبل — بنصٍّ مكتوبٍ يدوياً مطلوب (الفارغ يُرَد)", !a2.ok && a2.reason.includes("أكمل"));
  const a3 = await issueCertificate(ops, { memberId: m3.id, type: "achievement", fields: applyDerived("achievement", { ...achFields, achievement: "حملة صوت الطلاب" }, "female") });
  chk("والرقمُ التالي بعد آخر رقم", a1.ok && a3.ok && Number(a3.number.slice(-4)) === Number(a1.number.slice(-4)) + 1, a3.ok ? a3.number : JSON.stringify(a3));

  // ٤ — السلسلة في الإصدار نفسه
  const notChain = await issueCertificate(ceo, { memberId: m3.id, type: "membership", fields: d.ok ? d.defaults.membership : {} });
  chk("الرئيس التنفيذي لا يُصدر لعضو", !notChain.ok && notChain.reason.includes("عهدتك"));
  const opsSelf = await issueCertificate(ops, { memberId: opsMember.id, type: "membership", fields: {} });
  chk("ولا مسؤولُ التشغيل لمسؤول تشغيل", !opsSelf.ok && opsSelf.reason.includes("عهدتك"));
  const dOpsByCeo = await recipientDetails("executive", opsMember.id);
  const ceoOk = dOpsByCeo.ok ? await issueCertificate(ceo, { memberId: opsMember.id, type: "membership", fields: dOpsByCeo.defaults.membership }) : null;
  chk("والرئيس التنفيذي يُصدر لمسؤول التشغيل", !!ceoOk?.ok, JSON.stringify(ceoOk));

  // ٥ — التقدير في موعده — ثم لا يُصدر الكنسُ ثانية
  const ap = d.ok ? await issueCertificate(ops, { memberId: m3.id, type: "appreciation", fields: d.defaults.appreciation }) : null;
  chk("التقدير في موعده يصدر بلا قرارٍ مبكر", !!ap?.ok, JSON.stringify(ap));
  const stamped = await prisma.member.findUniqueOrThrow({ where: { id: m3.id } });
  chk("ويُختم ملفُّ العضو (فلا يُصدرها الكنس)", !!stamped.appreciationIssuedAt);
  await sweepThreeMonthAppreciation();
  const apRows = await prisma.issuedCertificate.count({ where: { memberId: m3.id, occasion: "appreciation" } });
  chk("والكنسُ بعدها لا يُنشئ شهادةً ثانية", apRows === 1, String(apRows));
  const apAgain = d.ok ? await issueCertificate(ops, { memberId: m3.id, type: "appreciation", fields: d.defaults.appreciation }) : null;
  chk("ولا تصدر يدوياً ثانية", !!apAgain && !apAgain.ok && apAgain.reason.includes("سابقاً"));

  // ٦ — الإصدار المبكر: سببٌ ومرجعٌ مطلوبان، والمدّةُ المعدّلة تُسجَّل
  const de = await recipientDetails("operations_officer", mEarly.id);
  if (de.ok) {
    chk("لم يُكمل ثلاثة أشهر — والمدّة الفعلية بالأشهر والأيام", !de.facts.completedThreeMonths && /شهران و/.test(de.defaults.appreciation.duration ?? ""), de.defaults.appreciation.duration);
    const f = de.defaults.appreciation;
    const noEarly = await issueCertificate(ops, { memberId: mEarly.id, type: "appreciation", fields: f });
    chk("المبكرة بلا قرارٍ تُرَد", !noEarly.ok && noEarly.reason.includes("مبكر"));
    const shortReason = await issueCertificate(ops, { memberId: mEarly.id, type: "appreciation", fields: f, early: { reason: "لا", reference: "طلب ٢١٤" } });
    chk("وبسببٍ قصيرٍ تُرَد", !shortReason.ok && shortReason.reason.includes("سبب"));
    const noRef = await issueCertificate(ops, { memberId: mEarly.id, type: "appreciation", fields: f, early: { reason: "تكريمٌ مبكر بعد إطلاق الحملة", reference: " " } });
    chk("وبلا مرجعٍ تُرَد", !noRef.ok && noRef.reason.includes("مرجع"));
    const edited = { ...f, duration: "٣ أشهر" };
    const ok = await issueCertificate(ops, { memberId: mEarly.id, type: "appreciation", fields: edited, early: { reason: "تكريمٌ مبكر بعد إطلاق الحملة", reference: "طلب اعتماد رقم ٢١٤ — معتمد" } });
    chk("وبسببه ومرجعه تصدر", ok.ok, JSON.stringify(ok));
    if (ok.ok) {
      const row = await prisma.issuedCertificate.findUniqueOrThrow({ where: { id: ok.id } });
      const edits = (row.edits ?? []) as Array<{ key: string; from: string; to: string }>;
      chk("ويُسجَّل السببُ والمرجعُ مع الشهادة", row.early && row.earlyReason === "تكريمٌ مبكر بعد إطلاق الحملة" && row.earlyReference === "طلب اعتماد رقم ٢١٤ — معتمد");
      chk("والمدّةُ المعدّلة يدوياً تُسجَّل بأصلها", edits.some((e) => e.key === "duration" && e.to === "٣ أشهر" && /شهران/.test(e.from)), JSON.stringify(edits));
      const mm = await prisma.member.findUniqueOrThrow({ where: { id: mEarly.id } });
      chk("ويوم استحقاقها يومُ إصدارها — فلا يُصدر الكنسُ التلقائية بعدها", !!mm.appreciationIssuedAt && mm.appreciationDueAt?.getTime() === mm.appreciationIssuedAt.getTime());
    }
  }

  // ٧ — الكنسُ الآلي يُسجَّل «آلياً» برقم — مرّةً واحدة
  await sweepThreeMonthAppreciation();
  await sweepThreeMonthAppreciation();
  const auto = await prisma.issuedCertificate.findMany({ where: { memberId: swept.id } });
  chk("الكنسُ يُسجّل التقدير الآلي في السجل «آلياً» برقم، مرّةً واحدة", auto.length === 1 && auto[0].issuedByName === "آلياً" && auto[0].issuedById === null && /^TLAQI-/.test(auto[0].number), JSON.stringify(auto.map((a) => [a.issuedByName, a.number])));

  // ٨ — الختام: بالنموذج، وحوكمة الأسبوعين، ومسارُ الختام لا يُكرّر
  const dc = await recipientDetails("operations_officer", closing.id);
  const fin = dc.ok ? await issueCertificate(ops, { memberId: closing.id, type: "final", fields: dc.defaults.final }) : null;
  chk("شهادة الشكر والخبرة تصدر لمن تنحّى", !!fin?.ok, JSON.stringify(fin));
  await markCertificateShared(closing.id, "خطوة الختام (فحص)");
  const finRows = await prisma.issuedCertificate.count({ where: { memberId: closing.id, occasion: "final" } });
  chk("ومسارُ الختام بعدها لا يُصدر ثانية", finRows === 1, String(finRows));
  const ds = await recipientDetails("operations_officer", shortStay.id);
  chk("ومن خرج خلال أسبوعين لا شهادة له", ds.ok && !!ds.blocked.final && ds.blocked.final.includes("أسبوعين"));
  const shortTry = ds.ok ? await issueCertificate(ops, { memberId: shortStay.id, type: "final", fields: ds.defaults.final }) : null;
  chk("والخادمُ يرفضها ولو نُوديت مباشرة", !!shortTry && !shortTry.ok);

  // ٩ — القيادة والتعيين: القالب والحرف والموقِّعون
  const dl = await recipientDetails("operations_officer", lead.id);
  if (dl.ok) {
    const L = await issueCertificate(ops, { memberId: lead.id, type: "leadership", fields: dl.defaults.leadership });
    chk("شهادة القيادة برقم L", L.ok && /-L-\d{4}$/.test(L.number), JSON.stringify(L));
    const appointment = applyDerived("appointment", { ...dl.defaults.appointment, committee: "لجنة المحتوى الرقمي" }, "female");
    chk("صفةُ التعيين تُشتقّ من اللجنة بجنس صاحبتها", appointment.role === "قائدةً للجنة المحتوى الرقمي", appointment.role);
    const A = await issueCertificate(ops, { memberId: lead.id, type: "appointment", fields: appointment });
    chk("شهادة التعيين برقم A", A.ok && /-A-\d{4}$/.test(A.number), JSON.stringify(A));
    if (A.ok && L.ok) {
      const va = await issuedCertificateView(A.id);
      const vl = await issuedCertificateView(L.id);
      chk("التعيين بالترويسة التحريرية، والقيادة بالإطار الكلاسيكي", va?.template === "editorial" && vl?.template === "classic");
      chk("والجدولُ أربعة أعمدة للتعيين، والرقمُ في بيانات الكلاسيكي", va?.facts.length === 4 && !!vl?.facts.some(([k, v]) => k === "رقم الشهادة" && v === L.number));
      chk("وموقِّعا القيادة: المؤسس والتنفيذي", vl?.signers[0].title.includes("المؤسس") === true && vl?.signers[1].title.includes("التنفيذي") === true, JSON.stringify(vl?.signers.map((s) => s.title)));
    }
  }

  // ١٠ — تنقيةُ الحقول
  const dm = await recipientDetails("operations_officer", swept.id);
  if (dm.ok) {
    const long = "س".repeat(500);
    const r = await issueCertificate(ops, {
      memberId: swept.id,
      type: "membership",
      fields: { ...dm.defaults.membership, printedName: long, achievement: "حقلٌ غريب", joinDate: dm.defaults.membership.joinDate } as never,
    });
    if (r.ok) {
      const row = await prisma.issuedCertificate.findUniqueOrThrow({ where: { id: r.id } });
      const fields = (row.data as { fields: Record<string, unknown> }).fields;
      chk("النصوصُ تُقصّ، وما ليس من حقول النوع لا يُحفظ", String(fields.printedName).length === 120 && !("achievement" in fields) && "joinDate" in fields);
      // بعد أن صدرت أرقام L- وA- بالبادئة نفسها: الرقمُ العاديّ يتبع آخر رقمٍ عاديّ لا «L-0001»
      const plain = await prisma.issuedCertificate.findMany({ where: { number: { startsWith: numberPrefix(code, "membership") } }, select: { number: true } });
      const plainMax = Math.max(...plain.map((p) => p.number).filter((x) => /-\d{4}-\d{4}$/.test(x) && x !== r.number).map((x) => Number(x.slice(-4))));
      chk("أرقامُ القيادة والتعيين لا تُربك تسلسل الأرقام العادية", /^TLAQI-[A-Z]{2,3}-\d{4}-\d{4}$/.test(r.number) && Number(r.number.slice(-4)) === plainMax + 1, r.number);
    } else chk("النصوصُ تُقصّ، وما ليس من حقول النوع لا يُحفظ", false, JSON.stringify(r));
    const badDate = await issueCertificate(ops, { memberId: swept.id, type: "achievement", fields: { ...dm.defaults.achievement, achievement: "x", achievementDate: "2026-13-99'); drop" } });
    chk("والتاريخُ بغير صيغته يُعامل فارغاً (يُرَد)", !badDate.ok && badDate.reason.includes("أكمل"));
  }

  // ١١ — التزامن: نقرتان متزامنتان لمناسبةٍ واحدة = شهادةٌ واحدة، ولمناسبتين = رقمان مختلفان
  const dz = await recipientDetails("operations_officer", mEarly.id);
  if (dz.ok) {
    const f1 = applyDerived("achievement", { ...dz.defaults.achievement, achievement: "تزامن ١" }, "female");
    const [x, y] = await Promise.all([
      issueCertificate(ops, { memberId: mEarly.id, type: "achievement", fields: f1 }),
      issueCertificate(ops, { memberId: mEarly.id, type: "achievement", fields: f1 }),
    ]);
    const cnt = await prisma.issuedCertificate.count({ where: { memberId: mEarly.id, occasion: occasionFor("achievement", f1) } });
    chk("نقرتان متزامنتان للمناسبة نفسها = شهادةٌ واحدة", cnt === 1 && [x, y].filter((r) => r.ok).length === 1, JSON.stringify([x, y]));
    const [p, q] = await Promise.all([
      issueCertificate(ops, { memberId: mEarly.id, type: "achievement", fields: applyDerived("achievement", { ...f1, achievement: "تزامن ٢" }, "female") }),
      issueCertificate(ops, { memberId: mEarly.id, type: "achievement", fields: applyDerived("achievement", { ...f1, achievement: "تزامن ٣" }, "female") }),
    ]);
    chk("ولمناسبتين متزامنتين رقمان مختلفان", p.ok && q.ok && p.number !== q.number, JSON.stringify([p, q]));
  }

  // ١٢ — الرابط الموقَّع والإعادة
  if (a1.ok) {
    const tok = signRegistryToken(a1.id);
    chk("رابط السجل يُتحقَّق منه، والمعدَّل يُرفض", verifyRegistryToken(tok) === a1.id && verifyRegistryToken(tok.slice(0, -2) + "xx") === null && verifyRegistryToken(`r.${a1.id}.`) === null);
    chk("ولا يُقرأ رابطُ السجل رابطَ عضو، ولا العكس", verifyCertificateToken(tok) === null && verifyRegistryToken(signCertificateToken(m3.id)) === null);
    const re = await resendIssued(ops, a1.id);
    const rows = await prisma.issuedCertificate.count({ where: { memberId: m3.id, occasion: occasionFor("achievement", achFields) } });
    chk("الإعادةُ لا تُصدر شهادةً ثانية، وتقول «لم يصل» محلياً", !re.ok && rows === 1);
    const reCeo = await resendIssued(ceo, a1.id);
    chk("والإعادةُ بالسلسلة أيضاً", !reCeo.ok && reCeo.reason.includes("عهدتك"));
  }

  // ١٣ — التعديلات: الاشتقاقُ ليس تعديلاً، والكتابةُ اليدوية تُسجَّل
  if (d.ok) {
    const base = d.defaults.membership;
    chk("لا تعديل في البيانات الأصلية", fieldEdits("membership", base, base, "female").length === 0);
    chk("وتغييرُ الاسم المطبوع تعديلٌ يُسجَّل", fieldEdits("membership", base, { ...base, printedName: "اسمٌ آخر" }, "female").some((e) => e.key === "printedName"));
    const df = defaultFields("membership", d.facts);
    chk("ونصُّ العضوية يُشتقّ من تاريخ الانضمام بجنسها", df.sentence.includes("شاركت") && df.sentence.includes("منذ"));
  }

  // ١٤ — السجل بالسلسلة
  const opsLog = await listIssued(["member", "department_admin"], TAG.slice(-5), 50);
  const ceoLog = await listIssued(["operations_officer"], TAG.slice(-5), 50);
  chk("سجلُّ مسؤول التشغيل فيه شهاداتُ الأعضاء والقادة وحدهم", opsLog.length > 0 && opsLog.every((r) => r.member.fullName !== opsMember.fullName));
  chk("وسجلُّ التنفيذي فيه مسؤول التشغيل وحده", ceoLog.length === 1 && ceoLog[0].member.fullName === opsMember.fullName);
  chk("و«آلياً» ظاهرٌ في السجل", opsLog.some((r) => r.issuedById === null && r.issuedByName === "آلياً"));

  // ١٥ — عبر HTTP بدخولٍ حقيقي
  const up = await fetch(`${BASE}/api/auth/csrf`).then((r) => r.ok).catch(() => false);
  if (up) {
    const hash = await hashPassword(PASS);
    const opsUser = await prisma.user.create({ data: { fullName: "مسؤول تشغيل (فحص)", email: `${TAG}-ops@example.test`, passwordHash: hash, role: "operations_officer", isActive: true } });
    const cookie = await signIn(opsUser.email);
    const page = (await (await fetch(`${BASE}/admin/welcome-cards?tab=certificates&q=${encodeURIComponent(TAG.slice(-5))}`, { headers: { cookie } })).text()).replaceAll("<!-- -->", "");
    chk("HTTP: مسؤول التشغيل يرى «إصدار شهادة يدوياً» والسجل", page.includes("إصدار شهادة يدوياً") && page.includes("سجل الشهادات الصادرة"));
    chk("HTTP: والسجل يعرض أرقام شهاداته و«آلياً»", a1.ok && page.includes(a1.number) && page.includes("آلياً"));
    chk("HTTP: ولا يُعرض في النموذج من ليس في عهدته", !page.includes(opsMember.fullName));
    if (a1.ok) {
      const cert = await fetch(`${BASE}/certificate/${signRegistryToken(a1.id)}`);
      const html = (await cert.text()).replaceAll("<!-- -->", "");
      chk("HTTP: الشهادة الصادرة تُفتح برابطها وفيها رقمها ونوعها", cert.status === 200 && html.includes(a1.number) && html.includes("شهادة إنجاز"));
      const bad = await fetch(`${BASE}/certificate/${signRegistryToken(a1.id).slice(0, -3)}abc`);
      chk("HTTP: والرابط المعدَّل 404", bad.status === 404);
    }
    const legacy = await fetch(`${BASE}/certificate/${signCertificateToken(m3.id, "appreciation")}`);
    chk("HTTP: والرابطُ القديم بمعرّف العضو ما زال يعمل", legacy.status === 200);
  } else {
    checks.push("… الخادم غير مشغَّل على :3000 — تُخطّى جزء HTTP");
  }

  await cleanup();
  const left = await prisma.issuedCertificate.count({ where: { member: { email: { startsWith: "e2e-creg-" } } } });
  chk("التنظيف: حذفُ العضو يمحو صفوفه (Cascade) ولا يبقى أثر", left === 0);

  console.log(checks.join("\n"));
  const failed = checks.filter((c) => c.startsWith("✗")).length;
  const total = checks.filter((c) => c.startsWith("✓") || c.startsWith("✗")).length;
  console.log(`\n${total - failed}/${total} ✓${failed ? ` — ${failed} فشل` : ""}`);
  await prisma.$disconnect();
  process.exit(failed ? 1 : 0);
})().catch(async (e) => {
  console.error(e);
  await cleanup().catch(() => {});
  await prisma.$disconnect();
  process.exit(1);
});
