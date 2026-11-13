import http from "node:http";
import type { AddressInfo } from "node:net";

/** **دورةُ حياة طلبَي البنر الترحيبي واجتماع الشرح** — ومعهما تذاكرُ «أعيدوا البطاقة».
 *
 *  يُثبت: من يُغلق (ومسؤولُ التشغيل منهم)، وأن البنر لا يُغلَق قبل وصوله، وأنه يُغلَق آلياً حين
 *  يصل، وأن الاجتماع لا يُغلَق بلا نتيجة ويُغلَق آلياً حين يُبَتّ في المرشّح (إعادة فتح/رفض/اعتماد/
 *  الكنس)، وأن الطلب لا يتكرّر، وأن الإغلاق يُسجَّل (متى ومن ولماذا)، وأن تذاكر البطاقة تُغلَق
 *  بوسمها، وأن من وُجِّهت إليه التذكرة يُغلقها بعد التصعيد.
 *
 *  **البريد:** مزوّدٌ وهميٌّ على 127.0.0.1 داخل هذه العملية (`RESEND_BASE_URL`) — يَقبل أو يرفض
 *  بأمر الفحص، ولا يخرج شيءٌ من الجهاز. والعناوينُ كلها `@example.test`.
 *
 *  على نسخةٍ مؤقتة من القاعدة الاصطناعية:
 *    createdb -O tlaqi -T tlaqi_mk tlaqi_req_e2e
 *    DATABASE_URL=…/tlaqi_req_e2e npx tsx --tsconfig tsconfig.json scripts/e2e-request-lifecycle.ts */
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "") || !/tlaqi_req_e2e/.test(process.env.DATABASE_URL ?? "")) {
  console.error("يُشغَّل على النسخة المؤقتة tlaqi_req_e2e وحدها");
  process.exit(1);
}
if (process.env.VERCEL || process.env.VERCEL_ENV) {
  console.error("فحصٌ محليٌّ فقط");
  process.exit(1);
}

// ── المزوّد الوهمي: `accept` يقرّر القبول، و`sent` يحصي ما وصله
let accept = false;
const sent: string[] = [];
const fake = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const to = (() => {
      try {
        return ([] as string[]).concat(JSON.parse(body).to ?? []).join(",");
      } catch {
        return "";
      }
    })();
    if (!to.split(",").every((x) => x.endsWith("@example.test"))) {
      res.writeHead(422, { "content-type": "application/json" });
      res.end(JSON.stringify({ statusCode: 422, name: "validation_error", message: "non-test recipient" }));
      return;
    }
    if (accept) {
      sent.push(to);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: `fake-${sent.length}` }));
    } else {
      res.writeHead(422, { "content-type": "application/json" });
      res.end(JSON.stringify({ statusCode: 422, name: "validation_error", message: "fake provider: rejected" }));
    }
  });
});

const checks: string[] = [];
const chk = (n: string, ok: boolean, extra = "") => checks.push(`${ok ? "✓" : "✗ FAIL"} ${n}${!ok && extra ? " — " + extra : ""}`);

(async () => {
  await new Promise<void>((r) => fake.listen(0, "127.0.0.1", () => r()));
  const port = (fake.address() as AddressInfo).port;
  process.env.RESEND_API_KEY = "re_fake_local_only";
  process.env.RESEND_BASE_URL = `http://127.0.0.1:${port}`;

  const { prisma } = await import("@/lib/prisma");
  const R = await import("@/lib/requests");
  const W = await import("@/lib/workflow");
  const { sendWelcomePack } = await import("@/lib/welcome");
  const { raiseTicket, canRespondToTicket } = await import("@/lib/tickets");

  const TAG = `e2e-rq-${Date.now()}`;
  const founder = await prisma.user.findFirstOrThrow({ where: { role: "super_admin" } });
  const marketing = await prisma.department.findUniqueOrThrow({ where: { slug: "marketing" } });
  const tech = await prisma.department.findFirstOrThrow({ where: { parentId: null, leadershipOnly: false, id: { not: marketing.id } } });
  const other = await prisma.department.findFirstOrThrow({ where: { parentId: null, leadershipOnly: false, id: { notIn: [marketing.id, tech.id] } } });
  const track = await prisma.testTrack.findFirstOrThrow({ where: { scope: "department_member" } });

  let n = 0;
  const mkUser = (role: "executive" | "operations_officer" | "department_admin", departmentId: string | null, label: string) =>
    prisma.user.create({ data: { fullName: `${label} ${TAG}`, email: `${TAG}-u${++n}@example.test`, passwordHash: "!", role, departmentId, isActive: true } });
  const actor = (u: { id: string; fullName: string; role: string; departmentId: string | null }) => ({ id: u.id, name: u.fullName, role: u.role, departmentId: u.departmentId });
  async function mkCandidate(label: string) {
    const email = `${TAG}-c${++n}@example.test`;
    const inv = await prisma.invite.create({
      data: { fullName: `${label} ${TAG}`, email, targetRole: "member", departmentId: tech.id, testTrackId: track.id, invitedById: founder.id, status: "used" },
    });
    return prisma.member.create({
      data: {
        fullName: `${label} ${TAG}`, email, departmentId: tech.id, inviteId: inv.id, passwordHash: "!",
        approvalStatus: "pending_review", testStatus: "not_started", isActive: true, credentialsIssuedAt: new Date(),
      },
    });
  }
  const openOf = (memberId: string, type: "meeting" | "welcome_banner") =>
    prisma.request.findMany({ where: { linkedMemberId: memberId, type, status: { not: "done" } } });
  const allOf = (memberId: string, type: "meeting" | "welcome_banner") =>
    prisma.request.findMany({ where: { linkedMemberId: memberId, type }, orderBy: { createdAt: "asc" } });

  const ops = await mkUser("operations_officer", null, "مسؤول التشغيل");
  const ceo = await mkUser("executive", null, "الرئيس التنفيذي");
  const techLead = await mkUser("department_admin", tech.id, "قائد التقنية");
  const mktLead = await mkUser("department_admin", marketing.id, "قائد التسويق");
  const otherLead = await mkUser("department_admin", other.id, "قائد قسم آخر");

  // ══ ١) من يعمل على الطلب ══
  chk("مسؤول التشغيل والرئيس والمؤسس يعملون على طلبات كل الأقسام",
    R.canWorkOnRequest(ops, tech.id) && R.canWorkOnRequest(ceo, marketing.id) && R.canWorkOnRequest(founder, other.id));
  chk("وقائدُ القسم على طلبات قسمه وحده",
    R.canWorkOnRequest(techLead, tech.id) && !R.canWorkOnRequest(techLead, marketing.id) && !R.canWorkOnRequest(otherLead, tech.id));
  chk("والعضو لا يعمل على طلب", !R.canWorkOnRequest({ role: "member", departmentId: tech.id }, tech.id));

  // ══ ٢) اجتماع الشرح بعد عدم الاجتياز ══
  const c1 = await mkCandidate("مرشّح أ");
  await W.submitTestAttempt({ memberId: c1.id, answers: {} });
  const m1 = await openOf(c1.id, "meeting");
  chk("عدمُ الاجتياز يفتح طلب اجتماع شرح لقسم المرشّح", m1.length === 1 && m1[0].targetDepartmentId === tech.id, JSON.stringify(m1.map((x) => x.status)));
  // محاولةٌ ثانية (اختبارٌ أُعيد يدوياً ورسب) والطلب ما يزال مفتوحاً — لا يتكرّر
  await prisma.member.update({ where: { id: c1.id }, data: { testStatus: "not_started" } });
  await W.submitTestAttempt({ memberId: c1.id, answers: {} });
  chk("ولا يتكرّر الطلب وطلبٌ مفتوحٌ للمرشّح نفسه قائم", (await allOf(c1.id, "meeting")).length === 1);

  const st = await R.startRequest(actor(ops), m1[0].id);
  chk("مسؤول التشغيل يبدأ العمل عليه", st.ok && (await prisma.request.findUniqueOrThrow({ where: { id: m1[0].id } })).status === "in_progress");
  const byOther = await R.closeRequest(actor(otherLead), m1[0].id, "عُقد الاجتماع وتقرّر إعادة الفتح");
  chk("وقائدُ قسمٍ آخر لا يُغلقه", !byOther.ok);
  const noOutcome = await R.closeRequest(actor(ops), m1[0].id, "تم");
  chk("ولا يُغلَق بلا نتيجة الاجتماع مكتوبة", !noOutcome.ok && noOutcome.reason.includes("نتيجة"));
  const blank = await R.closeRequest(actor(ops), m1[0].id, "   \n  ");
  chk("ولا بنصٍّ فارغ", !blank.ok);
  const before = Date.now();
  const closed = await R.closeRequest(actor(ops), m1[0].id, "عُقد الاجتماع يوم الأحد وتقرّر منحه محاولة ثانية");
  const m1r = await prisma.request.findUniqueOrThrow({ where: { id: m1[0].id } });
  chk("ومسؤول التشغيل يُغلقه بنتيجته", closed.ok && m1r.status === "done");
  chk("ويُسجَّل الإغلاق: متى ومن ولماذا ويدوياً",
    !!m1r.closedAt && m1r.closedAt.getTime() >= before - 1000 && m1r.closedById === ops.id && m1r.closedByName === ops.fullName &&
      m1r.closeNote === "عُقد الاجتماع يوم الأحد وتقرّر منحه محاولة ثانية" && m1r.closedAutomatically === false,
    JSON.stringify({ by: m1r.closedByName, note: m1r.closeNote, auto: m1r.closedAutomatically }));
  const twice = await R.closeRequest(actor(ceo), m1[0].id, "إغلاق ثانٍ للطلب نفسه");
  const m1rr = await prisma.request.findUniqueOrThrow({ where: { id: m1[0].id } });
  chk("والإغلاق الثاني يُرفض ولا يمسّ السجلّ الأول", !twice.ok && m1rr.closedById === ops.id && m1rr.closedAt!.getTime() === m1r.closedAt!.getTime());
  chk("والطلب لا يُحذف (يبقى في السجل)", (await allOf(c1.id, "meeting")).length === 1);
  const reopenSilently = await R.startRequest(actor(ops), m1[0].id);
  chk("ولا يُعاد فتحُ المغلق ضمناً", !reopenSilently.ok && (await prisma.request.findUniqueOrThrow({ where: { id: m1[0].id } })).status === "done");

  // ── الإغلاقُ الآلي حين يُبَتّ في المرشّح
  const c2 = await mkCandidate("مرشّح ب");
  await W.submitTestAttempt({ memberId: c2.id, answers: {} });
  await W.reopenCandidateTest({ memberId: c2.id, meetingHeld: true, note: "شُرحت له الأسئلة", performedByName: ops.fullName }).catch((e) => {
    // إعادةُ الفتح تُراسِل المرشّح: والمزوّدُ الوهمي يرفض الآن — فلا يعني ذلك فشل الإغلاق
    if (!String(e).includes("بريد")) throw e;
  });
  const m2 = (await allOf(c2.id, "meeting"))[0];
  chk("إعادةُ فتح الاختبار بعد الاجتماع تُغلق طلبه آلياً بنتيجته ومن نفّذ",
    m2?.status === "done" && m2.closedAutomatically && m2.closedByName === R.AUTO_CLOSER && !!m2.closedAt &&
      (m2.closeNote ?? "").includes("شُرحت له الأسئلة") && (m2.closeNote ?? "").includes(ops.fullName),
    JSON.stringify(m2 && { s: m2.status, n: m2.closeNote }));

  const c3 = await mkCandidate("مرشّح ج");
  await W.submitTestAttempt({ memberId: c3.id, answers: {} });
  await W.rejectMember(c3.id);
  const m3 = (await allOf(c3.id, "meeting"))[0];
  chk("والرفضُ يُغلقه آلياً", m3?.status === "done" && m3.closedAutomatically && (m3.closeNote ?? "").includes("رُفض"));

  const c4 = await mkCandidate("مرشّح د");
  await W.submitTestAttempt({ memberId: c4.id, answers: {} });
  // إعادةُ الدعوة هي إعادةُ فتح الاختبار (`reopenCandidateTest`) — أُزيلت `reopenInviteForMember` التي كانت تقلب
  // حالةَ الدعوة وحدها فلا يُعاد شيء. والتوقّعُ نفسُه: إعادةُ الفتح تُغلق طلبَ الاجتماع آلياً
  await W.reopenCandidateTest({ memberId: c4.id, meetingHeld: true, note: "شُرح له", performedByName: "فحص" });
  const m4 = (await allOf(c4.id, "meeting"))[0];
  chk("وإعادةُ فتح الدعوة تُغلقه آلياً", m4?.status === "done" && m4.closedAutomatically);

  // ── الكنس: مسارٌ لم ينادِ الإغلاق (تعديلٌ مباشر) — والمعلَّق لا يُغلَق قبل أوانه
  const c5 = await mkCandidate("مرشّح هـ");
  await W.submitTestAttempt({ memberId: c5.id, answers: {} });
  const c6 = await mkCandidate("مرشّح و");
  await W.submitTestAttempt({ memberId: c6.id, answers: {} });
  await prisma.member.update({ where: { id: c5.id }, data: { approvalStatus: "rejected", decidedAt: new Date() } });
  await W.sweepOverdueRequests();
  const m5 = (await allOf(c5.id, "meeting"))[0];
  const m6 = (await allOf(c6.id, "meeting"))[0];
  chk("الكنسُ اليومي يُغلق اجتماعَ مرشّحٍ بُتّ فيه بمسارٍ آخر", m5?.status === "done" && m5.closedAutomatically);
  chk("ولا يُغلق اجتماعَ مرشّحٍ ما يزال ينتظره (لا إغلاق قبل التنفيذ)", m6?.status !== "done" && !m6.closedAt);

  // ══ ٣) البنر الترحيبي ══
  // المرشّح ب أُعيد فتحُ اختباره — يجتازه الآن بإجاباتٍ صحيحة ثم يُعتمَد والبريدُ يرفض
  const qs = await prisma.testQuestion.findMany({ where: { trackId: track.id } });
  const right: Record<string, number> = Object.fromEntries(qs.map((q) => [q.id, q.correctIndex]));
  await prisma.member.update({ where: { id: c2.id }, data: { testStatus: "not_started" } });
  await W.submitTestAttempt({ memberId: c2.id, answers: right });
  accept = false;
  await W.approveMember(c2.id);
  const b1 = await openOf(c2.id, "welcome_banner");
  const c2a = await prisma.member.findUniqueOrThrow({ where: { id: c2.id } });
  chk("الاعتمادُ النهائي يفتح طلب البنر للتسويق (والبريد تعثّر)", b1.length === 1 && b1[0].targetDepartmentId === marketing.id && !c2a.welcomeEmailSentAt);
  chk("والاعتمادُ يُطلق استبيان الانضمام", !!c2a.onboardingSurveyRequiredAt);
  await W.approveMember(c2.id);
  chk("واعتمادٌ مكرَّر لا يكرّر طلب البنر", (await allOf(c2.id, "welcome_banner")).length === 1);

  const early = await R.closeRequest(actor(ops), b1[0].id, "تم إرسال البنر");
  chk("ولا يُغلَق قبل وصول البنر — ولو كتب المُغلق «تم»", !early.ok && early.reason.includes("لم يصل"));
  const earlyLead = await R.closeRequest(actor(mktLead), b1[0].id, "تم التصميم");
  chk("ولا لقائد التسويق", !earlyLead.ok && (await prisma.request.findUniqueOrThrow({ where: { id: b1[0].id } })).status !== "done");
  const wrongLead = await R.closeRequest(actor(techLead), b1[0].id, "تم");
  chk("وقائدُ التقنية لا يملكه أصلاً", !wrongLead.ok && wrongLead.reason.includes("ليس لك"));

  // تذاكرُ البطاقة: بالوسم، وبالموضوع القديم، وتذكرةٌ لشخصٍ آخر لا تُمَسّ
  const tMarked = await raiseTicket({
    raisedByUserId: founder.id, targetUserId: ops.id,
    subject: `طلب إعادة بطاقة الانضمام — ${c2.fullName}`, description: "لم تصله",
    linkUrl: `http://localhost:3000/admin/welcome-cards?q=x&for=member:${c2.id}`,
  });
  const tLegacy = await raiseTicket({
    memberId: c2.id, targetUserId: ops.id,
    subject: `لم تصلني بطاقة الانضمام — ${c2.fullName}`, description: "لم تصلني",
    linkUrl: `http://localhost:3000/admin/welcome-cards?q=${encodeURIComponent(c2.fullName)}`,
  });
  const tOther = await raiseTicket({
    raisedByUserId: founder.id, targetUserId: ops.id,
    subject: `طلب إعادة بطاقة الانضمام — ${c6.fullName}`, description: "شخصٌ آخر",
    linkUrl: `http://localhost:3000/admin/welcome-cards?q=y&for=member:${c6.id}`,
  });
  // **سميٌّ بالاسم نفسه حرفياً:** تذكرةُ «طلب إعادة» القديمة (بالاسم وحده) لا تُغلَق آلياً — قد تكون له —
  // وتذكرةُ «لم تصلني» التي رفعها السميُّ لنفسه لا تُغلَق بوصول بطاقة غيره
  const twin = await mkCandidate("مرشّح ب");
  chk("(تهيئة) سميٌّ بالاسم نفسه", twin.fullName === c2.fullName && twin.id !== c2.id);
  const tAmbiguous = await raiseTicket({
    raisedByUserId: founder.id, targetUserId: ops.id,
    subject: `طلب إعادة بطاقة الانضمام — ${c2.fullName}`, description: "قديمة بلا وسم",
    linkUrl: `http://localhost:3000/admin/welcome-cards?q=${encodeURIComponent(c2.fullName)}`,
  });
  const tTwinOwn = await raiseTicket({
    memberId: twin.id, targetUserId: ops.id,
    subject: `لم تصلني بطاقة الانضمام — ${twin.fullName}`, description: "السميُّ نفسه",
    linkUrl: `http://localhost:3000/admin/welcome-cards?q=${encodeURIComponent(twin.fullName)}`,
  });
  // التصعيد لا يسلب من وُجِّهت إليه حقَّ الإغلاق
  await prisma.ticket.update({ where: { id: tMarked.id }, data: { stage: "ceo_escalation" } });
  const esc = await prisma.ticket.findUniqueOrThrow({ where: { id: tMarked.id } });
  chk("مسؤولُ التشغيل الموجَّهة إليه يُغلق تذكرتها بعد تصعيدها",
    canRespondToTicket(esc, { user: { id: ops.id, role: ops.role, departmentId: null } }));
  chk("ويُغلقها الرئيسُ في مرحلته، ولا يُغلقها قائدُ قسمٍ آخر",
    canRespondToTicket(esc, { user: { id: ceo.id, role: "executive", departmentId: null } }) &&
      !canRespondToTicket(esc, { user: { id: otherLead.id, role: "department_admin", departmentId: other.id } }));
  chk("وصاحبُها لا يُغلقها لنفسه", !canRespondToTicket(esc, { user: { id: founder.id, role: "super_admin", departmentId: null } }));

  // يصل البنر فعلاً (المزوّد يقبل الآن) — من «الترحيب والتكريم»
  accept = true;
  const delivered = await sendWelcomePack({ kind: "member", id: c2.id }, "resend", true);
  chk("إعادةُ البطاقة تصل (المزوّد الوهمي قبلها)", delivered.ok && sent.some((x) => x.includes(c2.email)), JSON.stringify(delivered));
  const b1r = await prisma.request.findUniqueOrThrow({ where: { id: b1[0].id } });
  chk("فيُغلَق طلبُ البنر آلياً لحظة وصولها",
    b1r.status === "done" && b1r.closedAutomatically && b1r.closedByName === R.AUTO_CLOSER && b1r.closedById === null &&
      !!b1r.closedAt && (b1r.closeNote ?? "").includes("وصلت"),
    JSON.stringify({ s: b1r.status, n: b1r.closeNote }));
  const [tm, tl, to] = await Promise.all([tMarked, tLegacy, tOther].map((t) => prisma.ticket.findUniqueOrThrow({ where: { id: t.id } })));
  chk("وتُغلَق تذكرةُ «أعيدوا البطاقة» بوسمها", tm.status === "resolved" && !!tm.resolvedAt && (tm.resolutionNote ?? "").includes("آلياً"));
  chk("وتذكرةُ «لم تصلني» القديمة بموضوعها", tl.status === "resolved");
  chk("ولا تُمَسّ تذكرةُ شخصٍ آخر", to.status !== "resolved");
  const [ta, tt] = await Promise.all([tAmbiguous, tTwinOwn].map((t) => prisma.ticket.findUniqueOrThrow({ where: { id: t.id } })));
  chk("وتذكرةُ «طلب إعادة» القديمة باسمٍ يحمله شخصان تبقى مفتوحةً (لا تُغلَق تذكرةُ أحدهما بوصول بطاقة الآخر)", ta.status !== "resolved");
  chk("وتذكرةُ «لم تصلني» التي رفعها السميُّ لنفسه تبقى مفتوحة", tt.status !== "resolved");

  // وباسمٍ لا يحمله غيرُ صاحبه: «طلب إعادة» القديمة تُغلَق بوصول بطاقته
  const solo = await mkCandidate("مرشّح منفرد");
  await W.submitTestAttempt({ memberId: solo.id, answers: right });
  accept = false;
  await W.approveMember(solo.id);
  const tSolo = await raiseTicket({
    raisedByUserId: founder.id, targetUserId: ops.id,
    subject: `طلب إعادة بطاقة الانضمام — ${solo.fullName}`, description: "قديمة بلا وسم",
    linkUrl: `http://localhost:3000/admin/welcome-cards?q=${encodeURIComponent(solo.fullName)}`,
  });
  accept = true;
  const soloSent = await sendWelcomePack({ kind: "member", id: solo.id }, "resend", true);
  const tSoloR = await prisma.ticket.findUniqueOrThrow({ where: { id: tSolo.id } });
  chk("وتذكرةُ «طلب إعادة» القديمة باسمٍ فريد تُغلَق آلياً بوصول بطاقته", soloSent.ok && tSoloR.status === "resolved", JSON.stringify(soloSent));
  const lateManual = await R.closeRequest(actor(ops), b1[0].id, "تم");
  chk("والإغلاقُ اليدوي بعده يُرفض (مغلقٌ من قبل)", !lateManual.ok);

  // البنرُ الذي وصل خارج المنصة قبل الإصلاح: يُغلقه الكنس — ويدوياً يُكتب السبب آلياً
  const c7 = await mkCandidate("مرشّح ز");
  await W.submitTestAttempt({ memberId: c7.id, answers: right });
  accept = false;
  await W.approveMember(c7.id);
  const b7 = (await openOf(c7.id, "welcome_banner"))[0];
  await prisma.member.update({ where: { id: c7.id }, data: { welcomeEmailSentAt: new Date() } });
  const manual7 = await R.closeRequest(actor(mktLead), b7.id, "");
  const b7r = await prisma.request.findUniqueOrThrow({ where: { id: b7.id } });
  chk("وصل البنر فيُغلقه قائدُ التسويق يدوياً — ويُكتب سببُه من الواقع إن لم يكتبه",
    manual7.ok && b7r.closedById === mktLead.id && !b7r.closedAutomatically && (b7r.closeNote ?? "").includes("وصل"));

  const c8 = await mkCandidate("مرشّح ح");
  await W.submitTestAttempt({ memberId: c8.id, answers: right });
  await W.approveMember(c8.id);
  const b8 = (await openOf(c8.id, "welcome_banner"))[0];
  await prisma.member.update({ where: { id: c8.id }, data: { isActive: false, terminatedAt: new Date(), exitReason: "فحص" } });
  await W.sweepOverdueRequests();
  const b8r = await prisma.request.findUniqueOrThrow({ where: { id: b8.id } });
  chk("وبنرُ من غادر قبل وصوله يُغلقه الكنس — لا يبقى معلَّقاً", b8r.status === "done" && b8r.closedAutomatically && (b8r.closeNote ?? "").includes("غادر"));

  // ══ ٤) سائر الطلبات: بسببٍ مكتوب ══
  const gen = await prisma.request.create({ data: { type: "tech_support", targetDepartmentId: tech.id, status: "new", note: "دعم" } });
  const g0 = await R.closeRequest(actor(techLead), gen.id, "");
  const g1 = await R.closeRequest(actor(techLead), gen.id, "حُلّت المشكلة");
  chk("سائرُ الطلبات لا تُغلَق بلا سبب، وتُغلَق به", !g0.ok && g1.ok);

  console.log(checks.join("\n"));
  const failed = checks.filter((x) => x.startsWith("✗")).length;
  console.log(`\n${checks.length - failed}/${checks.length} ✓${failed ? ` — ${failed} فشل` : ""}`);
  await prisma.$disconnect();
  fake.close();
  process.exit(failed ? 1 : 0);
})().catch(async (e) => {
  console.error(e);
  fake.close();
  process.exit(1);
});
