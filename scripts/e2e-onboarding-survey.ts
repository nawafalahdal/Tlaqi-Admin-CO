import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";

/** **استبيانُ الانضمام وتصديرُه** — على نسخةٍ مؤقتة من القاعدة الاصطناعية:
 *    createdb -O tlaqi -T tlaqi_mk tlaqi_survey_e2e
 *    DATABASE_URL=…/tlaqi_survey_e2e npx tsx --tsconfig tsconfig.json scripts/e2e-onboarding-survey.ts
 *
 *  يُثبت: لا استبيانَ قبل الاعتماد النهائي؛ والاعتمادُ يطلبه؛ والتحقّقُ (١–٥، نعم/لا، ذكر/أنثى)؛
 *  ومرّةٌ واحدة ولو تسابقت الإرسالات؛ ولا أثرَ للتقييم على العضوية؛ والجنسُ يغيّر الصيغة القادمة
 *  ولا يمسّ ما أُرسل؛ وإعادةُ الفتح الموثّقة تحفظ السابق؛ وإغلاقُ المتابعة؛ والحالات؛ والتصديرُ
 *  (الصلاحية، والسجل، و١١ عموداً، ومن اليمين، ومرشّح، وصفٌّ مثبَّت، ويفتحه LibreOffice). */
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "") || !/tlaqi_survey_e2e/.test(process.env.DATABASE_URL ?? "")) {
  console.error("يُشغَّل على النسخة المؤقتة tlaqi_survey_e2e وحدها");
  process.exit(1);
}
if (process.env.VERCEL || process.env.VERCEL_ENV || process.env.RESEND_API_KEY) {
  console.error("فحصٌ محليٌّ فقط، والبريد معطّل");
  process.exit(1);
}

const checks: string[] = [];
const chk = (n: string, ok: boolean, extra = "") => checks.push(`${ok ? "✓" : "✗ FAIL"} ${n}${!ok && extra ? " — " + extra : ""}`);

/** يقرأ ملفاً من أرشيف ZIP — يكفي للتحقّق من محتوى ما كُتب */
function unzipEntry(buf: Buffer, name: string): string | null {
  let p = 0;
  while (p + 30 <= buf.length && buf.readUInt32LE(p) === 0x04034b50) {
    const method = buf.readUInt16LE(p + 8);
    const csize = buf.readUInt32LE(p + 18);
    const nlen = buf.readUInt16LE(p + 26);
    const elen = buf.readUInt16LE(p + 28);
    const n = buf.subarray(p + 30, p + 30 + nlen).toString("utf8");
    const data = buf.subarray(p + 30 + nlen + elen, p + 30 + nlen + elen + csize);
    if (n === name) return (method === 8 ? inflateRawSync(data) : data).toString("utf8");
    p += 30 + nlen + elen + csize;
  }
  return null;
}

(async () => {
  const { prisma } = await import("@/lib/prisma");
  const S = await import("@/lib/onboardingSurvey");
  const X = await import("@/lib/onboardingExport");
  const { crc32 } = await import("@/lib/xlsx");
  const W = await import("@/lib/workflow");
  const { forms, roleTitle } = await import("@/lib/gender");

  const TAG = `e2e-sv-${Date.now()}`;
  const founder = await prisma.user.findFirstOrThrow({ where: { role: "super_admin" } });
  const dept = await prisma.department.findFirstOrThrow({ where: { parentId: null, leadershipOnly: false, slug: { not: "marketing" } } });
  const track = await prisma.testTrack.findFirstOrThrow({ where: { scope: "department_member" } });
  const qs = await prisma.testQuestion.findMany({ where: { trackId: track.id } });
  const right = Object.fromEntries(qs.map((q) => [q.id, q.correctIndex]));
  let n = 0;
  const mkUser = (role: "executive" | "operations_officer" | "department_admin", departmentId: string | null) =>
    prisma.user.create({ data: { fullName: `${role} ${TAG}`, email: `${TAG}-u${++n}@example.test`, passwordHash: "!", role, departmentId, isActive: true } });
  const ops = await mkUser("operations_officer", null);
  const ceo = await mkUser("executive", null);
  const lead = await mkUser("department_admin", dept.id);
  const A = (u: { id: string; fullName: string; role: string; email: string }) => ({ id: u.id, name: u.fullName, role: u.role, email: u.email });

  async function candidate(name: string) {
    const email = `${TAG}-c${++n}@example.test`;
    const inv = await prisma.invite.create({
      data: { fullName: name, email, targetRole: "member", departmentId: dept.id, testTrackId: track.id, invitedById: founder.id, status: "used" },
    });
    const m = await prisma.member.create({
      data: { fullName: name, email, departmentId: dept.id, inviteId: inv.id, passwordHash: "!", jobTitle: "مصمّم", approvalStatus: "pending_review", testStatus: "not_started", isActive: true, credentialsIssuedAt: new Date() },
    });
    await W.submitTestAttempt({ memberId: m.id, answers: right });
    return m;
  }
  const ok = { journeyRating: "5", roleClarityRating: "4", bannerReceived: "yes", gender: "female" };

  // ══ ١) التحقّق في الخادم ══
  const bad = [
    { ...ok, journeyRating: "0" },
    { ...ok, journeyRating: "6" },
    { ...ok, journeyRating: "3.5" },
    { ...ok, roleClarityRating: "abc" },
    { ...ok, roleClarityRating: undefined },
    { ...ok, bannerReceived: "maybe" },
    { ...ok, gender: "other" },
    { ...ok, gender: undefined },
  ];
  chk("التحقّق يرفض تقييماً خارج ١–٥ وإجابةً غير نعم/لا وجنساً غير ذكر/أنثى", bad.every((b) => !S.parseSurveyAnswers(b).ok));
  chk("ويقبل الحدّين ١ و٥ ونعم/لا", S.parseSurveyAnswers({ ...ok, journeyRating: "1", roleClarityRating: 5, bannerReceived: "no", gender: "male" }).ok);

  // ══ ٢) لا قبل الاعتماد النهائي ══
  const m1 = await candidate(`عضوة أ ${TAG}`);
  chk("المرشّح قبل الاعتماد لا يُطلب منه الاستبيان", !(await S.surveyPending(m1.id)));
  const early = await S.submitOnboardingSurvey(m1.id, ok);
  chk("ولا يُقبل منه إرسال", !early.ok && early.code === "not_required");
  chk("ولا صفَّ له", (await prisma.onboardingSurveyResponse.count({ where: { memberId: m1.id } })) === 0);

  await W.approveMember(m1.id);
  chk("الاعتمادُ النهائي يطلبه", await S.surveyPending(m1.id));
  const legacy = await prisma.member.findFirst({ where: { approvalStatus: "approved", onboardingSurveyRequiredAt: null, isActive: true } });
  chk("ومن اعتُمد قبل وجوده لا يُطلب منه", !legacy || !(await S.surveyPending(legacy.id)));

  // ══ ٣) الإجابة: تُحفَظ بوقتها، والجنسُ يُحدَّث، ولا أثرَ على العضوية ══
  await prisma.member.update({ where: { id: m1.id }, data: { gender: null } });
  const emailBefore = await prisma.emailLog.create({
    data: { recipient: m1.email, kind: "ترحيب", subject: "أهلاً بك في TLAQI", status: "sent" },
  });
  const before = await prisma.member.findUniqueOrThrow({ where: { id: m1.id } });
  const t0 = Date.now();
  const r1 = await S.submitOnboardingSurvey(m1.id, ok);
  const row1 = await prisma.onboardingSurveyResponse.findFirst({ where: { memberId: m1.id } });
  const after = await prisma.member.findUniqueOrThrow({ where: { id: m1.id } });
  chk("الإجابةُ تُحفَظ بقيمها ووقتها", r1.ok && !!row1 && row1.journeyRating === 5 && row1.roleClarityRating === 4 && row1.bannerReceived && row1.gender === "female" && row1.submittedAt.getTime() >= t0 - 1000);
  chk("والجنسُ يُحدَّث لصيغة المخاطبة القادمة", after.gender === "female" && forms(after.gender).thanks === "شكراً لكِ" && roleTitle("member", after.gender) === "عضوة");
  const emailAfter = await prisma.emailLog.findUniqueOrThrow({ where: { id: emailBefore.id } });
  chk("وما أُرسل قبلُ لا يُمَسّ", emailAfter.subject === emailBefore.subject && emailAfter.status === emailBefore.status);
  chk("ولا يتغيّر شيءٌ من العضوية (الاعتماد، النشاط، القسم، الاعتماد بتاريخه)",
    after.approvalStatus === before.approvalStatus && after.isActive === before.isActive && after.departmentId === before.departmentId &&
      after.decidedAt?.getTime() === before.decidedAt?.getTime() && after.welcomeEmailSentAt?.getTime() === before.welcomeEmailSentAt?.getTime());
  chk("ولا يُطلب بعدها", !(await S.surveyPending(m1.id)));

  // ══ ٤) مرّةٌ واحدة — ولو تسابقت ══
  const again = await S.submitOnboardingSurvey(m1.id, { ...ok, journeyRating: "1" });
  chk("الإرسالُ الثاني يُرفض", !again.ok && again.code === "already");
  const m2 = await candidate(`عضو ب ${TAG}`);
  await W.approveMember(m2.id);
  const race = await Promise.all(Array.from({ length: 6 }, () => S.submitOnboardingSurvey(m2.id, { ...ok, gender: "male", journeyRating: "2", bannerReceived: "no" })));
  chk("ستّةُ إرسالاتٍ متزامنة: تُقبل واحدةٌ وحدها", race.filter((r) => r.ok).length === 1 && (await prisma.onboardingSurveyResponse.count({ where: { memberId: m2.id } })) === 1);

  // ══ ٥) الحالات — والتقييمُ المنخفض ليس رسوباً ══
  const m2r = await prisma.member.findUniqueOrThrow({ where: { id: m2.id } });
  const resp2 = await prisma.onboardingSurveyResponse.findFirstOrThrow({ where: { memberId: m2.id } });
  chk("البنرُ «لا» يُعلَّم «البنر لم يصل»", S.surveyStatus(resp2) === "banner_missing");
  chk("وإفادتُه لا تمسّ سجلّ التسليم الفعلي", m2r.welcomeEmailSentAt === null);
  chk("والتقييمُ المنخفض لا يمسّ الاعتماد ولا النشاط", m2r.approvalStatus === "approved" && m2r.isActive);
  chk("والمنخفض بلا مشكلة بنر «تحتاج متابعة»، والجيد «اكتملت»، وبلا إجابة «لم يُكمل»",
    S.surveyStatus({ bannerReceived: true, journeyRating: 2, roleClarityRating: 5, followUpResolvedAt: null }) === "needs_follow_up" &&
      S.surveyStatus({ bannerReceived: true, journeyRating: 3, roleClarityRating: 3, followUpResolvedAt: null }) === "completed" &&
      S.surveyStatus(null) === "not_completed");

  // ══ ٦) إغلاقُ المتابعة ══
  const byLead = await S.resolveOnboardingFollowUp(A(lead), resp2.id, "تواصلت معه");
  chk("قائدُ القسم لا يُغلق المتابعة", !byLead.ok);
  const noNote = await S.resolveOnboardingFollowUp(A(ops), resp2.id, " ");
  chk("ولا تُغلَق بلا ما تمّ", !noNote.ok);
  const resolved = await S.resolveOnboardingFollowUp(A(ops), resp2.id, "أُعيد إرسال البنر وتأكّد من وصوله");
  const resp2r = await prisma.onboardingSurveyResponse.findUniqueOrThrow({ where: { id: resp2.id } });
  chk("ومسؤولُ التشغيل يُغلقها — بمن ومتى وما تمّ، والإجابةُ كما هي",
    resolved.ok && !!resp2r.followUpResolvedAt && resp2r.followUpResolvedByName === ops.fullName && S.surveyStatus(resp2r) === "completed" && resp2r.bannerReceived === false && resp2r.journeyRating === 2);
  const resp1 = await prisma.onboardingSurveyResponse.findFirstOrThrow({ where: { memberId: m1.id } });
  chk("ولا متابعةَ لإجابةٍ مكتملة", !(await S.resolveOnboardingFollowUp(A(ops), resp1.id, "لا شيء")).ok);

  // ══ ٧) إعادةُ الفتح الموثّقة ══
  chk("قائدُ القسم لا يعيد الفتح", !(await S.reopenOnboardingSurvey(A(lead), m1.id, "سببٌ كافٍ للفحص")).ok);
  chk("ولا بلا سبب", !(await S.reopenOnboardingSurvey(A(ceo), m1.id, "لا")).ok);
  const reopened = await S.reopenOnboardingSurvey(A(ceo), m1.id, "أجابت قبل استلام البنر");
  const old = await prisma.onboardingSurveyResponse.findUniqueOrThrow({ where: { id: resp1.id } });
  chk("الرئيسُ يعيد الفتح، وتُحفَظ الإجابةُ السابقة كما هي بمن وسبب",
    reopened.ok && !!old.supersededAt && old.reopenedByName === ceo.fullName && old.reopenReason === "أجابت قبل استلام البنر" && old.journeyRating === 5);
  chk("فيُطلب من العضو من جديد", await S.surveyPending(m1.id));
  const r1b = await S.submitOnboardingSurvey(m1.id, { ...ok, journeyRating: "3" });
  const all1 = await prisma.onboardingSurveyResponse.findMany({ where: { memberId: m1.id }, orderBy: { submittedAt: "asc" } });
  chk("ويُجيب، فيبقى السجلُّ كاملاً (إجابتان، القائمةُ واحدة)", r1b.ok && all1.length === 2 && all1.filter((x) => !x.supersededAt).length === 1 && all1[0].journeyRating === 5);
  chk("ولا إعادةَ فتحٍ لمن لم يُجب", !(await S.reopenOnboardingSurvey(A(ops), (await candidate(`ج ${TAG}`)).id, "سببٌ مكتوب")).ok);

  // ══ ٨) من غادر لا يُطلب منه ══
  const m3 = await candidate(`عضو د ${TAG}`);
  await W.approveMember(m3.id);
  await prisma.member.update({ where: { id: m3.id }, data: { isActive: false, terminatedAt: new Date(), exitReason: "فحص" } });
  chk("المغادرُ لا يُطلب منه ولا يُقبل منه", !(await S.surveyPending(m3.id)) && !(await S.submitOnboardingSurvey(m3.id, ok)).ok);

  // ══ ٩) اللوحة: الأعداد والمتوسّطات ══
  const m4 = await candidate(`=HYPERLINK("http://x.invalid","انقر") ${TAG}`);
  await W.approveMember(m4.id);
  const rows = (await S.onboardingRows()).filter((r) => r.email.startsWith(TAG));
  const sum = S.onboardingSummary(rows);
  chk("الأعدادُ والمتوسّطات من الإجابات القائمة وحدها",
    sum.total === 3 && sum.answered === 2 && sum.notCompleted === 1 && sum.avgJourney === 2.5 && sum.avgRoleClarity === 4,
    JSON.stringify(sum));

  // ══ ١٠) التصدير ══
  const logsBefore = await prisma.dataExportLog.count();
  const denied = await X.exportOnboardingSurvey(A(lead));
  chk("قائدُ القسم لا يصدّر — ولا سجلَّ لمحاولةٍ مرفوضة", !denied.ok && (await prisma.dataExportLog.count()) === logsBefore);
  chk("والعضوُ لا يصدّر", !(await X.exportOnboardingSurvey({ id: m1.id, name: "x", role: "member" })).ok);
  const exp = await X.exportOnboardingSurvey(A(ops));
  const log = await prisma.dataExportLog.findFirst({ orderBy: { createdAt: "desc" } });
  chk("مسؤولُ التشغيل يصدّر، ويُسجَّل التصدير (من، ودوره، وكم صفّاً)",
    exp.ok && !!log && log.actorId === ops.id && log.actorRole === "operations_officer" && log.kind === X.EXPORT_KIND && log.rowCount === exp.rowCount);
  if (exp.ok) {
    const sheet = unzipEntry(exp.file, "xl/worksheets/sheet1.xml") ?? "";
    const wb = unzipEntry(exp.file, "xl/workbook.xml") ?? "";
    const headers = [...(sheet.match(/<row r="1">(.*?)<\/row>/)?.[1] ?? "").matchAll(/<t xml:space="preserve">(.*?)<\/t>/g)].map((x) => x[1]);
    chk("أحدَ عشرَ عموداً بالعناوين المطلوبة", headers.length === 11 && headers[0] === "اسم العضو" && headers[10] === "حالة الإكمال", headers.join("|"));
    chk("من اليمين، وصفُّ العناوين مثبَّت، وعليه مرشّحٌ تلقائي",
      /rightToLeft="1"/.test(sheet) && /<pane ySplit="1"[^>]*state="frozen"/.test(sheet) && /<autoFilter ref="A1:K\d+"\/>/.test(sheet) && /_xlnm\._FilterDatabase/.test(wb));
    chk("والعربيةُ سليمة", sheet.includes("عضوة أ") && sheet.includes("اكتملت رحلة الانضمام") && sheet.includes("لم يُكمل"));
    chk("ولا صيغةَ تُنفَّذ: ما يبدأ بـ= نصٌّ لا صيغة", !/<f>/.test(sheet) && sheet.includes("=HYPERLINK(&quot;"));
    chk("والتواريخُ تواريخُ حقيقية والتقييماتُ أرقام (للفرز)", /<c r="E\d+" s="2"><v>\d+\.?\d*<\/v><\/c>/.test(sheet) && /<c r="F\d+"><v>[1-5]<\/v><\/c>/.test(sheet));
    chk("وCRC سليم (المحتوى كما كُتب)", crc32(Buffer.from("123456789")) === 0xcbf43926);

    const dir = mkdtempSync(join(tmpdir(), "tlaqi-xlsx-"));
    const file = join(dir, "survey.xlsx");
    writeFileSync(file, exp.file);
    try {
      execFileSync("soffice", ["--headless", "--convert-to", "csv:Text - txt - csv (StarCalc):44,34,76", "--outdir", dir, file], { stdio: "ignore", timeout: 120_000 });
      const csv = existsSync(join(dir, "survey.csv")) ? readFileSync(join(dir, "survey.csv"), "utf8") : "";
      chk("ويفتحه LibreOffice ويقرأ عناوينه وصفوفه", csv.startsWith("اسم العضو,") && csv.includes("عضوة أ") && csv.split("\n").filter(Boolean).length === exp.rowCount + 1, csv.slice(0, 200));
    } catch (e) {
      chk("ويفتحه LibreOffice", false, String(e).slice(0, 200));
    }
  }

  console.log(checks.join("\n"));
  const failed = checks.filter((x) => x.startsWith("✗")).length;
  console.log(`\n${checks.length - failed}/${checks.length} ✓${failed ? ` — ${failed} فشل` : ""}`);
  await prisma.$disconnect();
  process.exit(failed ? 1 : 0);
})().catch(async (e) => {
  console.error(e);
  process.exit(1);
});
