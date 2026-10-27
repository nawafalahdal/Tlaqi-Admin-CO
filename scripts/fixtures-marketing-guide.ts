import sharp from "sharp";
import type { Session } from "next-auth";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/credentials";
import { marketingActor, type MkActor } from "@/lib/marketing/access";
import { addTeamMember } from "@/lib/marketing/team";
import { createCampaign, updateBrief, addCampaignMember, transitionCampaign } from "@/lib/marketing/campaigns";
import { createDeliverable } from "@/lib/marketing/deliverables";
import { saveDraft, submitContent, decideContent } from "@/lib/marketing/content";
import { uploadDesign, submitDesign, decideDesign } from "@/lib/marketing/design";
import { sendToQuality, recordQuality, recordPublication, recordResults, QUALITY_ITEMS } from "@/lib/marketing/review";
import { createTask, addComment } from "@/lib/marketing/tasks";
import { submitPlan, decidePlan } from "@/lib/marketing/plan";
import { updatePieceSchedule } from "@/lib/marketing/schedule";
import { recordFinalCheck, FINAL_ITEMS } from "@/lib/marketing/review";
import { completePlanForTest, finalCheckForTest } from "./marketing-plan-fixture";

/** بياناتُ صور دليل القيادة — على القاعدة المحلية وحدها، بحساباتٍ تجريبيةٍ مؤقّتة.
 *
 *  **حسابٌ لكل مسؤولية** (لا يجمع أحدٌ دورين) حتى تُظهر كلُّ صورةٍ ما يراه صاحبُ الدور
 *  وحده: قائدُ التسويق (قائدُ قسم التسويق)، وكاتبان (الثاني يعتمد نصَّ الأول)، ومصمّمان،
 *  ومراجعُ جودة، ومسؤولُ نشر — كلُّهم `@guide.example.test`. ومرحلتا الخطة التاليتان
 *  بحسابَي `fixtures-roles` (مسؤول التشغيل والرئيس التنفيذي) بلا أيّ مسؤوليةٍ في الفريق.
 *
 *  - «حملة الإطلاق»: قيد التنفيذ، بستة مخرجاتٍ في مراحل مختلفة ومهامَّ بعضُها بلا مسنَد.
 *  - «حملة المعرض»: خطتُها تنتظر مسؤولَ التشغيل. «حملة التطوع»: تنتظر الرئيسَ التنفيذي.
 *  - «حملة الأسبوع الأول»: ردّها مسؤولُ التشغيل بسبب. «حملة داخلية»: موجزٌ ناقص.
 *  - «حملة رمضان»: جاهزةٌ للتخطيط وخطتُها ناقصة (تُعرض نواقصُها ولا تُقدَّم).
 *  - «حملة اليوم الوطني»: نُشرت قطعتُها فصارت «منشورة» — قسمُ الأرشفة بما يمنعها بعد.
 *  وفي «حملة الإطلاق» بعد الاعتماد: تعديلُ موعدٍ بسببٍ مكتوب (سجلُّ التقويم)، وقطعةٌ ردّها فحصُ
 *  الناشر الأخير إلى المصمّم. وقيمُ الخطة هنا واقعيةٌ للصور لا قيمُ `completePlanForTest`.
 *  والنشرُ المسجَّل والنتائجُ بياناتُ فحصٍ محلية — لا منشورَ حقيقيّ ولا أرقامَ حقيقية.
 *
 *    npx tsx --env-file=.env scripts/fixtures-marketing-guide.ts setup <totpSecret> | teardown */

if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "")) {
  console.error("يُشغَّل على القاعدة المحلية وحدها");
  process.exit(1);
}

const PASSWORD = "Fixture#2026aa";
const DOMAIN = "@guide.example.test";
const SUFFIX = " (تجريبية)";
const asRole = (id: string, role: string, name: string): Session =>
  ({ user: { id, role, name, email: "probe@example.test" }, expires: new Date(Date.now() + 3600_000).toISOString() } as unknown as Session);
const actorOf = async (s: Session): Promise<MkActor> => (await marketingActor(s))!;
const must = <T extends { ok: boolean }>(r: T, what: string): T & { ok: true } => {
  if (!r.ok) throw new Error(`${what}: ${JSON.stringify(r)}`);
  return r as T & { ok: true };
};
const DAY = 86400_000;
const PLAN_APPROVERS = ["ops@fixture.test", "exec@fixture.test"];

async function art(width: number, height: number, label: string, tone = "#C34900") {
  const s = Math.min(width, height);
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#341D2B"/>` +
      `<circle cx="${width / 2}" cy="${height * 0.45}" r="${s / 3.2}" fill="${tone}"/>` +
      `<rect x="${width * 0.12}" y="${height * 0.78}" width="${width * 0.76}" height="${s * 0.08}" rx="${s * 0.04}" fill="#EEF6DF"/>` +
      `<text x="50%" y="${height * 0.12}" font-size="${Math.round(s / 14)}" text-anchor="middle" fill="#EEF6DF" font-family="sans-serif">${label}</text></svg>`
  );
  return new Uint8Array(await sharp(svg).png().toBuffer());
}

async function teardown() {
  const users = await prisma.user.findMany({ where: { email: { endsWith: DOMAIN } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  const owners = await prisma.marketingMember.findMany({ where: { userId: { in: ids } }, select: { id: true } });
  const campaigns = await prisma.marketingCampaign.findMany({
    where: { name: { endsWith: SUFFIX }, ownerId: { in: owners.map((o) => o.id) } },
    select: { id: true },
  });
  for (const c of campaigns) await prisma.marketingCampaign.delete({ where: { id: c.id } });
  await prisma.marketingEvent.deleteMany({ where: { actorId: { in: ids } } });
  await prisma.marketingGenerationJob.deleteMany({ where: { requestedById: { in: owners.map((o) => o.id) } } });
  await prisma.marketingMember.deleteMany({ where: { userId: { in: ids } } });
  await prisma.leaderSignature.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  // حسابا `fixtures-roles` يُنشآن بلا صيغة مخاطبة — يعودان كما كانا
  await prisma.user.updateMany({ where: { email: { in: PLAN_APPROVERS } }, data: { gender: null } });
}

async function setup(totpSecret: string) {
  if (!totpSecret) throw new Error("setup <totpSecret>");
  await teardown();
  if (await prisma.marketingCampaign.count()) throw new Error("في القاعدة حملاتٌ أخرى — شغّل teardown لبقية البيانات أولاً حتى لا تظهر في الصور");
  // صيغةُ المخاطبة مختارةٌ سلفاً، فلا يظهر سؤالُها فوق كل صورة (يُعاد عند teardown)
  await prisma.user.updateMany({ where: { email: { in: PLAN_APPROVERS }, gender: null }, data: { gender: "male" } });
  const opsU = await prisma.user.findFirstOrThrow({ where: { email: "ops@fixture.test" } });
  const marketing = await prisma.department.findFirstOrThrow({ where: { slug: "marketing", parentId: null } });
  const hr = await prisma.department.findFirstOrThrow({ where: { slug: "hr" } });
  const tech = await prisma.department.findFirstOrThrow({ where: { slug: "tech" } });
  const passwordHash = await hashPassword(PASSWORD);
  const mk = (key: string, fullName: string, departmentId: string) =>
    prisma.user.create({
      data: {
        fullName, email: `${key}${DOMAIN}`, passwordHash, role: "department_admin", departmentId, isActive: true,
        totpEnabled: true, totpSecret, profileCompletedAt: new Date(), passwordChangedAt: new Date(), jobTitle: "حساب تجريبي", gender: "male",
      },
    });
  const U = {
    lead: await mk("lead", "قائد التسويق · تجريبي", marketing.id),
    writer: await mk("writer", "كاتب المحتوى · تجريبي", hr.id),
    writer2: await mk("writer2", "كاتب ثانٍ · تجريبي", hr.id),
    designer: await mk("designer", "المصمّم · تجريبي", tech.id),
    designer2: await mk("designer2", "مصمّم ثانٍ · تجريبي", tech.id),
    reviewer: await mk("reviewer", "مراجع الجودة · تجريبي", hr.id),
    publisher: await mk("publisher", "مسؤول النشر · تجريبي", tech.id),
  };
  const A = async (key: keyof typeof U) => actorOf(asRole(U[key].id, "department_admin", U[key].fullName));
  const lead = await A("lead");
  const ops = await actorOf(asRole(opsU.id, "operations_officer", opsU.fullName));

  const caps = { writer: ["writer"], writer2: ["writer"], designer: ["designer"], designer2: ["designer"], reviewer: ["reviewer"], publisher: ["publisher"] } as const;
  const M: Record<string, string> = {};
  for (const [k, c] of Object.entries(caps)) {
    M[k] = must(await addTeamMember(lead, { kind: "user", id: U[k as keyof typeof U].id, capabilities: [...c] }), `team ${k}`).memberId;
  }
  const writer = await A("writer");
  const writer2 = await A("writer2");
  const designer = await A("designer");
  const designer2 = await A("designer2");
  const reviewer = await A("reviewer");
  const publisher = await A("publisher");

  async function brief(id: string, name: string, extra: Partial<Parameters<typeof updateBrief>[2]> = {}) {
    await transitionCampaign(lead, id, "briefing");
    must(
      await updateBrief(lead, id, {
        name,
        objective: "تعريف طلاب الجامعات بمنصة تَـــلاقِ وفتح باب الانضمام",
        audience: "طلاب الجامعات في الرياض",
        keyMessage: "نلتقي · نفكّر · نصنع",
        deadline: new Date(Date.now() + 14 * DAY),
        startDate: new Date(Date.now() - 2 * DAY),
        channels: ["instagram"],
        description: "حملةٌ قصيرةٌ للتعريف بالمنصة وأنشطتها.",
        outcomes: "تسجيلاتُ اهتمامٍ جديدة، وزيارةُ صفحة الانضمام",
        audienceSegments: "طلابُ السنة الأولى، وأعضاءُ الأندية الطلابية",
        kpis: [
          { name: "الوصول", target: "5000", unit: "حساب", source: "Instagram Insights" },
          { name: "تسجيلات الاهتمام", target: "150", unit: "تسجيل", source: "نموذج الانضمام" },
        ],
        measurement: "أرقامُ المنصات بعد أسبوعٍ من آخر منشور، ونموذجُ الانضمام",
        risks: "تزامنُ الحملة مع الاختبارات — تُخفَّف بمنشوراتٍ قصيرة",
        budgetNote: "بلا ميزانيةٍ مدفوعة — نشرٌ عضوي",
        ...extra,
      }),
      `brief ${name}`
    );
  }
  // سلسلةُ الاعتماد: القسم ثم التشغيل — والرئيسُ التنفيذي يطّلع ولا يعتمد
  const stages = [[lead, "department"], [ops, "operations"]] as const;
  /** فريقُ الحملة: لا تُقدَّم خطةٌ بلا كاتبٍ ومصمّمٍ لكل قطعة (`plan_incomplete`) */
  async function team(id: string, keys: (keyof typeof caps)[] = ["writer", "writer2", "designer", "designer2", "reviewer", "publisher"]) {
    for (const k of keys) must(await addCampaignMember(lead, id, { marketingMemberId: M[k], role: caps[k][0] }), `team ${id} ${k}`);
  }
  async function plan(id: string, upTo: number, note = "خطة الحملة") {
    // الخطةُ تُقدَّم مكتملةً وإلا رُدّت (`plan_incomplete`) — يُكمل الفحصُ ناقصَها بقيمٍ للفحص
    await completePlanForTest(lead, id);
    const p = must(await submitPlan(lead, id, { note }), "plan");
    for (const [a, stage] of stages.slice(0, upTo)) must(await decidePlan(a, id, { planVersionId: p.planVersionId, stage, decision: "approved" }), `plan ${stage}`);
    return p.planVersionId;
  }

  // ── «حملة الإطلاق» قيد التنفيذ
  const L = `حملة الإطلاق${SUFFIX}`;
  const c1 = must(await createCampaign(lead, { name: L, channels: ["instagram", "x", "linkedin"], priority: "high" }), "c1").campaignId;
  await brief(c1, L, { channels: ["instagram", "x", "linkedin"], priority: "high", description: "حملة تعريفية بالمنصة مع بداية الفصل الدراسي." });
  const del = async (title: string, platform: string, formatKey: string) => must(await createDeliverable(lead, c1, { title, platform, formatKey }), title).deliverableId;
  const d = {
    story: await del("ستوري الإطلاق", "instagram", "story"),
    square: await del("منشور التعريف", "instagram", "square"),
    portrait: await del("منشور طولي", "instagram", "portrait"),
    linkedin: await del("إعلان لينكدإن", "linkedin", "landscape"),
    tweet: await del("تغريدة الإعلان", "x", "landscape"),
    week: await del("منشور الأسبوع الأول", "instagram", "square"),
    faq: await del("منشور الأسئلة الشائعة", "instagram", "portrait"),
  };
  must(await transitionCampaign(lead, c1, "ready_for_planning"), "c1 planning");
  await team(c1);
  const topics: [string, string, string, string][] = [
    [d.story, "story", "تعريفٌ بالمنصة في ١٥ ثانية", "اسحب للأعلى"],
    [d.square, "post", "ما هي تَـــلاقِ؟", "تابع الحساب"],
    [d.portrait, "post", "فكرةٌ واحدة تكفي لتبدأ", "سجّل اهتمامك"],
    [d.linkedin, "announcement", "فتحُ باب التطوع", "سجّل من الرابط"],
    [d.tweet, "announcement", "إعلانُ الانضمام", "الرابط في الحساب"],
    [d.week, "post", "حصادُ الأسبوع الأول", "شاركنا رأيك"],
    [d.faq, "carousel", "أسئلةُ المنضمّين الجدد", "اسأل في التعليقات"],
  ];
  for (const [id, contentType, topic, cta] of topics) must(await updatePieceSchedule(lead, id, { contentType, topic, cta }), `topic ${topic}`);
  await plan(c1, 2, "الخطة الأولى للإطلاق");
  must(await transitionCampaign(lead, c1, "in_progress"), "c1 go");

  /** نصٌّ يكتبه الكاتب ويعتمده الثاني، وتصميمٌ يرفعه المصمّم ويعتمده الثاني */
  async function copy(id: string, body: string, approve = true) {
    const v = must(await submitContent(writer, id, { body, sources: "صفحة المنصة الرسمية", changeNote: "صياغة أولى" }), "copy");
    if (approve) must(await decideContent(writer2, id, { versionId: v.versionId, decision: "approved", note: "واضح ومناسب للجمهور" }), "copy ok");
    return v.versionId;
  }
  async function design(id: string, w: number, h: number, label: string, approve = true) {
    const v = must(await uploadDesign(designer, id, { file: { name: `${label}.png`, type: "image/png", bytes: await art(w, h, label) }, changeNote: "النسخة الأولى" }), "design");
    must(await submitDesign(designer, id, v.versionId), "design submit");
    if (approve) must(await decideDesign(designer2, id, { designVersionId: v.versionId, decision: "approved" }), "design ok");
    return v.versionId;
  }
  const allPass = QUALITY_ITEMS.map((key) => ({ key, passed: true }));

  // ستوري: نصٌّ بانتظار اعتماد الكاتب الثاني
  await copy(d.story, "نلتقي لنفكّر معاً، ونصنع ما يبقى.\nانضم إلى تَـــلاقِ — الرابط في الحساب.", false);
  // منشور التعريف: تصميمٌ بانتظار المصمّم الثاني — نسختان، الثانية مقدَّمة
  await copy(d.square, "تَـــلاقِ مجتمعٌ طلابيٌّ يلتقي فيه من يفكّر ومن يصنع.");
  must(await uploadDesign(designer, d.square, { file: { name: "square-v1.png", type: "image/png", bytes: await art(1080, 1080, "v1", "#7A3E2B") }, changeNote: "النسخة الأولى" }), "sq v1");
  const sq2 = must(await uploadDesign(designer, d.square, { file: { name: "square-v2.png", type: "image/png", bytes: await art(1080, 1080, "v2") }, changeNote: "تكبير الشعار وإبعاده عن الحافة" }), "sq v2");
  must(await submitDesign(designer, d.square, sq2.versionId), "sq submit");
  // منشور طولي: بانتظار فحص الجودة
  await copy(d.portrait, "فكرةٌ واحدة تكفي لتبدأ. نلتقي في تَـــلاقِ.");
  await design(d.portrait, 1080, 1350, "portrait");
  must(await sendToQuality(designer, d.portrait), "portrait quality");
  // لينكدإن: جاهزٌ للنشر
  const lv = await copy(d.linkedin, "تَـــلاقِ تفتح باب التطوع لطلاب الجامعات — سجّل اهتمامك من رابط الحساب.");
  const ld = await design(d.linkedin, 1920, 1080, "linkedin");
  must(await sendToQuality(designer, d.linkedin), "li quality");
  must(await recordQuality(reviewer, d.linkedin, { contentVersionId: lv, designVersionId: ld, items: allPass }), "li pass");
  // تغريدة: مسودةٌ فيها تنبيهات (رقمٌ بلا مصدر ورابطٌ غيرُ آمن)
  must(await saveDraft(writer, d.tweet, "انضم ٣٠٠ طالب في أسبوع — كن التالي http://example.com"), "tweet draft");
  // منشور الأسبوع الأول: نُشر (بيانات فحص) وسُجّلت نتائجه
  const wv = await copy(d.week, "أسبوعنا الأول في تَـــلاقِ: شكراً لكل من التقى وفكّر وصنع.");
  const wd = await design(d.week, 1080, 1080, "week");
  must(await sendToQuality(designer, d.week), "week quality");
  must(await recordQuality(reviewer, d.week, { contentVersionId: wv, designVersionId: wd, items: allPass }), "week pass");
  // النشرُ لا يُسجَّل قبل فحص الناشر الأخير للنص والتصميم معاً (`final_check_missing`)
  await finalCheckForTest(publisher, d.week);
  const pub = must(
    await recordPublication(publisher, d.week, { url: "https://www.instagram.com/p/TLAQI-guide-test/", publishedAt: new Date(), confirmedLive: true, requestId: "guide-week" }),
    "publish"
  );
  must(await recordResults(publisher, pub.publicationId, { metrics: { reach: 1200, impressions: 1850, engagements: 140, saves: 22 }, asOf: new Date(Date.now() + 1_000), source: "لوحة إحصاءات الحساب — بيانات فحص محلية" }), "results");

  // منشور الأسئلة: اجتاز الجودة، وردّه فحصُ الناشر الأخير إلى المصمّم (التصميمُ لا يطابق النص)
  const fv = await copy(d.faq, "أسئلتكم عن الانضمام إلى تَـــلاقِ — في خمس بطاقات.");
  const fd = await design(d.faq, 1080, 1350, "faq");
  must(await sendToQuality(designer, d.faq), "faq quality");
  must(await recordQuality(reviewer, d.faq, { contentVersionId: fv, designVersionId: fd, items: allPass }), "faq pass");
  const fail = must(
    await recordFinalCheck(publisher, d.faq, {
      contentVersionId: fv, designVersionId: fd,
      items: FINAL_ITEMS.map((key) => (key === "design_matches_text" ? { key, passed: false, note: "عنوانُ البطاقة الأولى في التصميم غيرُ عنوان النص المعتمد" } : { key, passed: true })),
      note: "يُعاد إلى المصمّم لتوحيد العنوان",
    }),
    "faq final"
  );
  if (fail.passed || fail.returnedTo !== "design") throw new Error(`faq final: ${JSON.stringify(fail)}`);

  // تعديلُ موعدٍ تحت التنفيذ: لقائد التسويق وحده، بسببٍ مكتوبٍ يُسجَّل بأصله وجديده
  const li = await prisma.marketingDeliverable.findUniqueOrThrow({ where: { id: d.linkedin }, select: { publishAt: true } });
  must(
    await updatePieceSchedule(lead, d.linkedin, { publishAt: new Date((li.publishAt ?? new Date()).getTime() + DAY), reason: "تأجيلُ يومٍ ليتزامن الإعلانُ مع افتتاح التسجيل" }),
    "li reschedule"
  );

  // مهامّ: بعضُها مسنَد، وبعضُها بلا مسنَد (يظهر لها اقتراح)، وواحدةٌ متأخرة، وأخرى تنتظر غيرها
  const t1 = must(await createTask(lead, c1, { title: "نص ستوري الإطلاق", kind: "content", deliverableId: d.story, assigneeId: M.writer, dueAt: new Date(Date.now() + 2 * DAY), priority: "high" }), "t1").taskId;
  must(await createTask(lead, c1, { title: "تصميم ستوري الإطلاق", kind: "design", deliverableId: d.story, dependsOn: [t1], dueAt: new Date(Date.now() + 4 * DAY) }), "t2");
  must(await createTask(lead, c1, { title: "فحص جودة المنشور الطولي", kind: "quality", deliverableId: d.portrait, dueAt: new Date(Date.now() - DAY), priority: "high" }), "t3");
  must(await createTask(lead, c1, { title: "جدولة نشر إعلان لينكدإن", kind: "publishing", deliverableId: d.linkedin, dueAt: new Date(Date.now() + DAY) }), "t4");
  must(await createTask(lead, c1, { title: "مراجعة تقويم المحتوى الشهري", kind: "general", assigneeId: M.writer2, dueAt: new Date(Date.now() + 6 * DAY) }), "t5");
  must(await addComment(writer, c1, { body: "هل نذكر موعد المعرض في الستوري أم نؤجله؟", deliverableId: d.story }), "comment");
  must(await addComment(lead, c1, { body: "نؤجله — الستوري للتعريف فقط.", deliverableId: d.story }), "comment 2");

  // «حملة المعرض»: تنتظر مسؤولَ التشغيل
  const E = `حملة المعرض${SUFFIX}`;
  const c2 = must(await createCampaign(lead, { name: E }), "c2").campaignId;
  await brief(c2, E, { objective: "دعوة الطلاب إلى معرض الأندية", audience: "طلاب السنة الأولى", keyMessage: "تعال واصنع", deadline: new Date(Date.now() + 30 * DAY) });
  must(await createDeliverable(lead, c2, { title: "منشور الدعوة", platform: "instagram", formatKey: "square" }), "c2 d");
  must(await createDeliverable(lead, c2, { title: "ستوري العدّ التنازلي", platform: "instagram", formatKey: "story" }), "c2 d2");
  must(await transitionCampaign(lead, c2, "ready_for_planning"), "c2 planning");
  await team(c2, ["writer", "designer"]);
  await plan(c2, 1, "منشوران قبل المعرض بأسبوع");

  // «حملة التطوع»: تنتظر الرئيسَ التنفيذي
  const V = `حملة التطوع${SUFFIX}`;
  const c3 = must(await createCampaign(lead, { name: V }), "c3").campaignId;
  await brief(c3, V, { objective: "استقطاب متطوعين لفريق التنظيم", audience: "طلاب السنتين الثانية والثالثة", keyMessage: "نصنع الحدث معاً", channels: ["instagram", "linkedin"] });
  must(await createDeliverable(lead, c3, { title: "إعلان التطوع", platform: "linkedin", formatKey: "landscape" }), "c3 d");
  must(await transitionCampaign(lead, c3, "ready_for_planning"), "c3 planning");
  await team(c3, ["writer", "designer"]);
  await plan(c3, 1, "إعلانٌ واحدٌ على لينكدإن"); // بانتظار مسؤول التشغيل

  // «حملة الأسبوع الأول»: ردّها مسؤولُ التشغيل بسبب
  const W = `حملة الأسبوع الأول${SUFFIX}`;
  const c4 = must(await createCampaign(lead, { name: W }), "c4").campaignId;
  await brief(c4, W, { objective: "تعريف المنضمّين الجدد بالأنشطة", deadline: new Date(Date.now() + 5 * DAY) });
  must(await createDeliverable(lead, c4, { title: "منشور الترحيب", platform: "instagram", formatKey: "portrait" }), "c4 d");
  must(await transitionCampaign(lead, c4, "ready_for_planning"), "c4 planning");
  await team(c4, ["writer", "designer"]);
  const pv = await plan(c4, 1, "منشور ترحيبٍ واحد");
  must(await decidePlan(ops, c4, { planVersionId: pv, stage: "operations", decision: "changes_requested", note: "الموعد قريبٌ جداً — أضيفوا أسبوعاً للتصميم والمراجعة." }), "c4 return");

  // «حملة داخلية»: فكرةٌ موجزُها ناقص
  const I = `حملة داخلية${SUFFIX}`;
  const c5 = must(await createCampaign(lead, { name: I }), "c5").campaignId;
  await transitionCampaign(lead, c5, "briefing");

  // «حملة رمضان»: جاهزةٌ للتخطيط وخطتُها ناقصة — لا كاتبَ ولا مواعيد لقطعتها الثانية
  const R = `حملة رمضان${SUFFIX}`;
  const c6 = must(await createCampaign(lead, { name: R }), "c6").campaignId;
  await brief(c6, R, { objective: "محتوى يوميٌّ قصيرٌ في رمضان", keyMessage: "نلتقي على الخير", deadline: new Date(Date.now() + 40 * DAY), kpis: [], risks: undefined, measurement: undefined });
  const r1 = must(await createDeliverable(lead, c6, { title: "بطاقة اليوم", platform: "instagram", formatKey: "square" }), "c6 d1").deliverableId;
  must(await createDeliverable(lead, c6, { title: "ستوري السحور", platform: "instagram", formatKey: "story" }), "c6 d2");
  must(await transitionCampaign(lead, c6, "ready_for_planning"), "c6 planning");
  await team(c6, ["writer", "designer"]);
  must(await updatePieceSchedule(lead, r1, { contentType: "post", topic: "رسالة اليوم", message: "نلتقي على الخير", writerId: M.writer, designerId: M.designer }), "c6 piece");

  // «حملة اليوم الوطني»: قطعةٌ واحدة مرّت بالدورة كلها فنُشرت — فصارت الحملةُ «منشورة».
  // وهي آخرُ ما يُعتمد، فتحكم دورةَ التخطيط: موعدُها بعد أكثر من سبعة أيام يُبقي التخطيطَ مغلقاً
  // (موعدُ الفتح = النهاية − ٧ أيام)، فتُصوَّر رسالةُ الإغلاق ثم الفتحُ المبكر.
  const N = `حملة اليوم الوطني${SUFFIX}`;
  const c7 = must(await createCampaign(lead, { name: N }), "c7").campaignId;
  await brief(c7, N, { objective: "تهنئةُ اليوم الوطني", keyMessage: "نعتزّ ونصنع", deadline: new Date(Date.now() + 12 * DAY) });
  const n1 = must(await createDeliverable(lead, c7, { title: "تهنئة اليوم الوطني", platform: "instagram", formatKey: "square" }), "c7 d").deliverableId;
  must(await transitionCampaign(lead, c7, "ready_for_planning"), "c7 planning");
  await team(c7);
  await plan(c7, 2, "تهنئةٌ واحدة");
  must(await transitionCampaign(lead, c7, "in_progress"), "c7 go");
  const nv = await copy(n1, "كل عامٍ والوطنُ بخير — نعتزّ ونصنع.");
  const nd = await design(n1, 1080, 1080, "national");
  must(await sendToQuality(designer, n1), "c7 quality");
  must(await recordQuality(reviewer, n1, { contentVersionId: nv, designVersionId: nd, items: allPass }), "c7 pass");
  await finalCheckForTest(publisher, n1);
  must(await recordPublication(publisher, n1, { url: "https://www.instagram.com/p/TLAQI-national-test/", publishedAt: new Date(), confirmedLive: true, requestId: "guide-national" }), "c7 publish");

  console.log(JSON.stringify({ c1, c2, c3, c4, c5, c6, c7, ...d, national: n1 }));
}

const cmd = process.argv[2];
(cmd === "setup" ? setup(process.argv[3] ?? "") : cmd === "teardown" ? teardown().then(() => console.log("ok")) : Promise.reject(new Error("setup | teardown")))
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
