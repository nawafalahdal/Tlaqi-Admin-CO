import { prisma } from "@/lib/prisma";
import { permanentlyDeleteAccount } from "@/lib/founderActions";
import { purgeCandidate } from "@/lib/workflow";

/** **الحذفُ النهائي لمن شغل منصباً في الإدارة العليا** (عطبُ الإنتاج، 18 نوفمبر 2026: «حدث خطأٌ غير متوقع»).
 *
 *  السبب: `SeniorPosition.holderMemberId` يشير إلى صاحبه بقيدٍ `Restrict`، والحذفُ لا يفكّه — فيرفض Postgres محوَ الصفّ (23001)
 *  بعد أن كان الحذفُ قد كتب ما قبله (الشاهدة، ومحوَ محاولات الاختبار والتنبيهات). والآن: يُنهى التكليفُ ويُفَكّ في معاملة
 *  الحذف نفسِها، وأيُّ رفضٍ يردّ كلَّ شيء.
 *
 *  على نسخةٍ مؤقتة من القاعدة الاصطناعية:
 *    createdb -T tlaqi_mk tlaqi_erase_e2e
 *    DATABASE_URL=…/tlaqi_erase_e2e npx tsx --tsconfig tsconfig.json scripts/e2e-erase-senior.ts
 *    dropdb tlaqi_erase_e2e */
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "")) {
  console.error("يُشغَّل على القاعدة المحلية وحدها");
  process.exit(1);
}
const TAG = `e2e-es-${Date.now()}`;
const checks: string[] = [];
const chk = (n: string, ok: boolean, extra = "") => checks.push(`${ok ? "✓" : "✗ FAIL"} ${n}${!ok && extra ? " — " + extra : ""}`);
const why = (r: { ok: boolean; reason?: string }) => (r.ok ? "" : (r as { reason?: string }).reason ?? "");

(async () => {
  try {
    const founder = await prisma.user.findFirstOrThrow({ where: { role: "super_admin", isActive: true } });
    const track = await prisma.testTrack.findFirstOrThrow();
    const dept = await prisma.department.findFirstOrThrow({ where: { parentId: null, committeeStatus: null, leadershipOnly: false } });
    const senior = (await prisma.department.findFirst({ where: { leadershipOnly: true } })) ?? dept;
    let n = 0;
    async function member(extra: Record<string, unknown> = {}) {
      const email = `${TAG}-m${++n}@example.test`;
      const inv = await prisma.invite.create({ data: { fullName: "نموذج", email, targetRole: "member", departmentId: dept.id, testTrackId: track.id, invitedById: founder.id, status: "used" } as never });
      return prisma.member.create({
        data: { fullName: `نموذج ${n}`, email, departmentId: dept.id, inviteId: inv.id, passwordHash: "!", credentialsIssuedAt: new Date(), approvalStatus: "approved", decidedAt: new Date(), isActive: true, ...extra } as never,
      });
    }
    const position = (holder: { holderMemberId?: string; holderUserId?: string }, email: string, status: "active" | "ended" | "pending" = "ended") =>
      prisma.seniorPosition.create({
        data: {
          departmentId: senior.id, titleAr: `مستشار ${++n}`, inviteName: "نموذج", inviteEmail: email, invitedById: founder.id, invitedByName: founder.fullName,
          inviteState: "accepted", acceptedAt: new Date(), status, ...(status === "ended" ? { endedAt: new Date(), endedByName: "فحص", endReason: "انتهى" } : {}), ...holder,
        } as never,
      });
    const del = (kind: "member" | "user", id: string, email: string, force = false) =>
      permanentlyDeleteAccount({ kind, id, confirmEmail: email, reason: "إعادة إضافة مرة أخرى", force, actorRole: "super_admin", actorId: founder.id, actorName: founder.fullName });

    // ═══ العطبُ نفسُه: متوقفٌ شغل منصباً انتهى ═══
    const stopped = await member({ isActive: false, terminatedAt: new Date(), exitReason: "إنهاء عضوية", testScore: 80, warningsCount: 1 });
    const oldPos = await position({ holderMemberId: stopped.id }, stopped.email, "ended");
    await prisma.testAttempt.create({ data: { memberId: stopped.id, score: 80, passed: true, answers: {} } });
    let threw: unknown = null;
    let r: Awaited<ReturnType<typeof del>> | null = null;
    try {
      r = await del("member", stopped.id, stopped.email);
    } catch (e) {
      threw = e;
    }
    chk("**متوقفٌ شغل منصباً في الإدارة العليا يُحذف** (كان: «حدث خطأٌ غير متوقع»)", !threw && !!r?.ok, threw ? String(threw).slice(0, 200) : JSON.stringify(r));
    chk("فلا يبقى صفُّه ولا دعوتُه — البريدُ حرّ", !(await prisma.member.findUnique({ where: { id: stopped.id } })) && !(await prisma.invite.findFirst({ where: { email: stopped.email } })));
    const oldAfter = await prisma.seniorPosition.findUniqueOrThrow({ where: { id: oldPos.id } });
    chk("**والتكليفُ القديم باقٍ تاريخاً للمقعد**، مفكوكاً عنه", oldAfter.holderMemberId === null && oldAfter.status === "ended" && oldAfter.endReason === "انتهى");
    chk("وبريدُه ممحوٌّ من صفّ التكليف (لا أثرَ للبريد)", oldAfter.inviteEmail !== stopped.email && !oldAfter.inviteEmail.includes("@"));
    chk("وفي سجل التدقيق حدثٌ بيد المؤسس", (await prisma.orgAuditEvent.count({ where: { entityId: oldPos.id, action: "senior.position.erased", actorId: founder.id } })) === 1);

    // ═══ صاحبُ تكليفٍ قائم (عضوٌ نشط، بإقرار الحذف المباشر) ═══
    const holder = await member();
    const livePos = await position({ holderMemberId: holder.id }, holder.email, "active");
    const r2 = await del("member", holder.id, holder.email, true);
    const liveAfter = await prisma.seniorPosition.findUniqueOrThrow({ where: { id: livePos.id } });
    chk("**تكليفٌ قائم يُنهى مع الحذف** بسببٍ مسمّى وبيد المؤسس", r2.ok && liveAfter.status === "ended" && liveAfter.holderMemberId === null && liveAfter.endedByName === founder.fullName && !!liveAfter.endReason?.includes("حذفٌ نهائيٌّ"), why(r2));

    // ═══ حسابٌ قياديٌّ شغل منصباً (طريقُ الحساب الإداري) ═══
    const uEmail = `${TAG}-u@example.test`;
    const u = await prisma.user.create({ data: { fullName: "قائد سابق", email: uEmail, passwordHash: "!", role: "department_admin", departmentId: dept.id, isActive: false, removedAt: new Date(), removalReason: "تنحية" } as never });
    const uPos = await position({ holderUserId: u.id }, uEmail, "ended");
    let r3: Awaited<ReturnType<typeof del>> | null = null;
    try {
      r3 = await del("user", u.id, uEmail);
    } catch (e) {
      chk("حسابٌ قياديٌّ شغل منصباً يُحذف", false, String(e).slice(0, 200));
    }
    if (r3) chk("**وحسابٌ قياديٌّ شغل منصباً يُحذف كذلك**", r3.ok && !(await prisma.user.findUnique({ where: { id: u.id } })) && (await prisma.seniorPosition.findUniqueOrThrow({ where: { id: uPos.id } })).holderUserId === null, why(r3));

    // ═══ مرشّحٌ عالق قبِل دعوةً إلى منصب (طريقُ «المرشّحون العالقون») ═══
    const cand = await member({ approvalStatus: "pending_review", testStatus: "not_started", firstLoginAt: null });
    const candPos = await position({ holderMemberId: cand.id }, cand.email, "pending");
    let candErr: unknown = null;
    try {
      await purgeCandidate({ memberId: cand.id, confirmEmail: cand.email, reason: "مرشح عالق", performedByName: founder.fullName, actor: { id: founder.id, role: "super_admin" } });
    } catch (e) {
      candErr = e;
    }
    const candPosAfter = await prisma.seniorPosition.findUniqueOrThrow({ where: { id: candPos.id } });
    chk("**ومرشّحٌ عالق قبِل دعوةً إلى منصب يُحذف** ويُنهى منصبُه المنتظر", !candErr && !(await prisma.member.findUnique({ where: { id: cand.id } })) && candPosAfter.status === "ended" && candPosAfter.holderMemberId === null, String(candErr ?? ""));

    // ═══ الذرّية: رفضٌ في آخر خطوة لا يترك شيئاً نصفَ محذوف ═══
    const victim = await member({ isActive: false, terminatedAt: new Date() });
    const vPos = await position({ holderMemberId: victim.id }, victim.email, "active");
    // ما ضاع في الإنتاج: محاولاتُ الاختبار والتنبيهات كانت تُحذف قبل أن يُرفض محوُ الصفّ
    await prisma.memberWarning.create({ data: { memberId: victim.id, reason: "تنبيه", issuedByUserId: founder.id } });
    await prisma.testAttempt.create({ data: { memberId: victim.id, score: 70, passed: true, answers: {} } });
    // قيدٌ لم يُحسب في الحذف (يحاكي جدولاً يُضاف لاحقاً) — يرفض محوَ الصفّ
    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "_e2e_hold" ("mid" text REFERENCES "Member"("id") ON DELETE RESTRICT)`);
    await prisma.$executeRawUnsafe(`INSERT INTO "_e2e_hold" VALUES ($1)`, victim.id);
    let r4: Awaited<ReturnType<typeof del>> | null = null;
    let threw4: unknown = null;
    try {
      r4 = await del("member", victim.id, victim.email);
    } catch (e) {
      threw4 = e;
    }
    chk("**رفضُ القاعدة يصل سبباً مسمّى** لا «حدث خطأ غير متوقع»", !threw4 && !!r4 && !r4.ok && why(r4).includes("لم يُحذف شيء"), threw4 ? String(threw4).slice(0, 160) : JSON.stringify(r4));
    const vPosAfter = await prisma.seniorPosition.findUniqueOrThrow({ where: { id: vPos.id } });
    chk(
      "**ولا يقع شيءٌ نصفَ محذوف:** الصفُّ ودعوتُه وتنبيهُه ومحاولةُ اختباره ومنصبُه كما كانت",
      !!(await prisma.member.findUnique({ where: { id: victim.id } })) &&
        !!(await prisma.invite.findFirst({ where: { email: victim.email } })) &&
        (await prisma.memberWarning.count({ where: { memberId: victim.id } })) === 1 &&
        (await prisma.testAttempt.count({ where: { memberId: victim.id } })) === 1 &&
        vPosAfter.status === "active" && vPosAfter.holderMemberId === victim.id && vPosAfter.inviteEmail === victim.email
    );
    await prisma.$executeRawUnsafe(`DROP TABLE "_e2e_hold"`);
    const r5 = await del("member", victim.id, victim.email);
    chk("وبعد زوال المانع يُحذف كاملاً", r5.ok && !(await prisma.member.findUnique({ where: { id: victim.id } })), why(r5));

    // ═══ الرئيسُ التنفيذيُّ يحذف سجلّات الأعضاء والمرشّحين (24 نوفمبر 2026) — لا الحساباتِ القيادية ═══
    const ceoDel = (kind: "member" | "user", id: string, email: string, extra: Record<string, unknown> = {}) =>
      permanentlyDeleteAccount({ kind, id, confirmEmail: email, reason: "حذف بيد الرئيس", force: false, actorRole: "executive", actorId: founder.id, actorName: "الرئيس التنفيذي", ...extra });
    const st2 = await member({ isActive: false, terminatedAt: new Date() });
    const rc1 = await ceoDel("member", st2.id, st2.email);
    chk("**الرئيسُ التنفيذيُّ يحذف متوقفاً نهائياً**", rc1.ok && !(await prisma.member.findUnique({ where: { id: st2.id } })), why(rc1));
    const uEmail2 = `${TAG}-u2@example.test`;
    const u2 = await prisma.user.create({ data: { fullName: "قائد سابق 2", email: uEmail2, passwordHash: "!", role: "department_admin", departmentId: dept.id, isActive: false } as never });
    const rc2 = await ceoDel("user", u2.id, uEmail2);
    chk("ولا يحذف حساباً قيادياً (للمؤسس وحده)", !rc2.ok && why(rc2).includes("للمؤسس وحده") && !!(await prisma.user.findUnique({ where: { id: u2.id } })), why(rc2));
    const twinM = await member({ isActive: false, terminatedAt: new Date() });
    await prisma.user.create({ data: { fullName: "توأم", email: twinM.email, passwordHash: "!", role: "department_admin", departmentId: dept.id, isActive: false } as never });
    const rc3 = await ceoDel("member", twinM.id, twinM.email);
    chk("ولا سجلَّ عضويةٍ له حسابٌ قياديٌّ بالبريد نفسه", !rc3.ok && why(rc3).includes("حسابٌ قياديٌّ") && !!(await prisma.member.findUnique({ where: { id: twinM.id } })), why(rc3));
    const leadDel = await permanentlyDeleteAccount({ kind: "member", id: twinM.id, confirmEmail: twinM.email, reason: "محاولة قائد", force: false, actorRole: "department_admin", actorId: founder.id, actorName: "قائد" });
    chk("وقائدُ القسم لا يحذف", !leadDel.ok && why(leadDel).includes("للمؤسس والرئيس التنفيذي"), why(leadDel));

    // ═══ مرشّحٌ لم يجتز وينتظر الحسم: لا يُحذف إلا بإقرارٍ صريح، ويُسجَّل ═══
    const und = await member({ approvalStatus: "pending_review", testStatus: "failed", testScore: 30 });
    const noAck = await ceoDel("member", und.id, und.email);
    chk("**بلا إقرار: رسالةٌ تقول ما العمل** (علّم «أحذفه قبل حسم أمره»)", !noAck.ok && why(noAck).includes("أحذفه قبل حسم أمره") && !!(await prisma.member.findUnique({ where: { id: und.id } })), why(noAck));
    const withAck = await ceoDel("member", und.id, und.email, { acknowledgeUndecided: true });
    chk("**وبالإقرار يُحذف**", withAck.ok && !(await prisma.member.findUnique({ where: { id: und.id } })), why(withAck));
    chk("ويُسجَّل «حذفُ مرشّحٍ قبل حسم أمره» بالسبب والدور", (await prisma.orgAuditEvent.count({ where: { entityId: und.id, action: "candidate.purged_undecided", actorRole: "executive", note: "حذف بيد الرئيس" } })) === 1);
    const und2 = await member({ approvalStatus: "pending_review", testStatus: "failed", testScore: 20 });
    let pcErr = "";
    try {
      await purgeCandidate({ memberId: und2.id, confirmEmail: und2.email, reason: "عالق", performedByName: "الرئيس التنفيذي", actor: { id: founder.id, role: "executive" } });
    } catch (e) {
      pcErr = String(e);
    }
    chk("وطريقُ «المرشّحون العالقون» كذلك: بلا إقرار لا يحذف", pcErr.includes("أحذفه قبل حسم أمره") && !!(await prisma.member.findUnique({ where: { id: und2.id } })), pcErr.slice(0, 120));
    await purgeCandidate({ memberId: und2.id, confirmEmail: und2.email, reason: "عالق", performedByName: "الرئيس التنفيذي", actor: { id: founder.id, role: "executive" }, acknowledgeUndecided: true });
    chk("وبالإقرار يحذف ويُسجَّل", !(await prisma.member.findUnique({ where: { id: und2.id } })) && (await prisma.orgAuditEvent.count({ where: { entityId: und2.id, action: "candidate.purged_undecided" } })) === 1);
  } catch (e) {
    chk("لم يقع استثناء", false, e instanceof Error ? e.stack?.split("\n").slice(0, 3).join(" ") ?? e.message : String(e));
  } finally {
    await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "_e2e_hold"`).catch(() => null);
    console.log(checks.join("\n"));
    await prisma.$disconnect();
    process.exit(checks.some((c) => c.startsWith("✗")) ? 1 : 0);
  }
})();
