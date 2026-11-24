/** **تنبيهاتُ قائد اللجنة وتغييرُه، وإدارةُ أعضائها** (قرارات المؤسس ٣.٢ و٣.٣ و٣.٤ وق٤):
 *  - ثلاثةُ تنبيهاتٍ في فترة القيادة الحالية، بين كلٍّ منها ٢٤ ساعةً على الأقل، يُصدرها قائدُ القسم وحده (لا نائبُه).
 *  - لا يُعدّ التنبيهُ مقروءاً إلا بتأكيد القائد داخل المنصة — البريدُ إبلاغٌ لا قراءة.
 *  - بعد الثلاثة يصير التغييرُ متاحاً لقائد القسم بقرارٍ مسبَّب — بلا تغييرٍ تلقائي، والسابقُ يبقى عضواً.
 *  - أعضاءُ اللجنة لقائدها؛ وقائدُ القسم لا يُخرجهم. ونظامُ تنبيهات الأعضاء لا يُمسّ.
 *  تشغيل: DATABASE_URL=… npx tsx --tsconfig tsconfig.json scripts/e2e-committee-lead-warnings.ts */
import type { Session } from "next-auth";
import { prisma } from "@/lib/prisma";

if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "")) {
  console.error("يُشغَّل على قاعدةٍ محلية وحدها");
  process.exit(1);
}
const TAG = `e2e-clw-${Date.now()}`;
const checks: string[] = [];
const chk = (n: string, ok: boolean, extra = "") => checks.push(`${ok ? "✓" : "✗ FAIL"} ${n}${!ok && extra ? " — " + extra : ""}`);
const sess = (role: string, id: string, name = "فحص"): Session => ({ user: { id, role, name } }) as unknown as Session;
const why = (r: { ok: boolean; reason?: string }) => (r.ok ? "" : r.reason ?? "");
const H = 3600_000;

(async () => {
  try {
    const { orgActor, committeeRoleFor } = await import("@/lib/org/actor");
    const C = await import("@/lib/org/committeeService");
    const { committeeDetail } = await import("@/lib/org/queries");
    const founder = await prisma.user.findFirstOrThrow({ where: { role: "super_admin", isActive: true } });
    const ceo = await prisma.user.findFirst({ where: { role: "executive", isActive: true } });
    const track = await prisma.testTrack.findFirstOrThrow({ where: { scope: "department_member" } });

    const P = await prisma.department.create({ data: { name: `قسم ${TAG}`, slug: TAG, colorHex: "#3366CC" } });
    const Q = await prisma.department.create({ data: { name: `قسم آخر ${TAG}`, slug: `${TAG}-q`, colorHex: "#2F7D32" } });
    let n = 0;
    const mk = async (key: string, departmentId = P.id) => {
      const email = `${TAG}-${key}-${++n}@example.test`;
      const inv = await prisma.invite.create({ data: { fullName: key, email, targetRole: "member", departmentId, testTrackId: track.id, invitedById: founder.id, status: "used" } });
      return prisma.member.create({ data: { fullName: `${key} ${TAG}`, email, departmentId, inviteId: inv.id, passwordHash: "!", approvalStatus: "approved", decidedAt: new Date(), isActive: true } });
    };
    const L = await prisma.user.create({ data: { fullName: `قائد قسم ${TAG}`, email: `${TAG}-lead@example.test`, passwordHash: "!", role: "department_admin", departmentId: P.id, isActive: true } });
    const LQ = await prisma.user.create({ data: { fullName: `قائد قسم آخر ${TAG}`, email: `${TAG}-leadq@example.test`, passwordHash: "!", role: "department_admin", departmentId: Q.id, isActive: true } });
    const A = await mk("a"), B = await mk("b"), Cm = await mk("c"), DP = await mk("deputy"), X = await mk("x", Q.id);
    await prisma.department.update({ where: { id: P.id }, data: { deputyMemberId: DP.id, deputyPermissions: ["committees_manage", "members_view"] } });

    const mkCommittee = async (key: string, lead: string, members: string[]) => {
      const c = await prisma.department.create({
        data: { name: `لجنة ${key} ${TAG}`, slug: `${TAG}-${key}`, colorHex: "#3366CC", parentId: P.id, committeeStatus: "approved", purpose: "غرض", committeeKind: "permanent", leadMemberId: lead },
      });
      for (const m of [lead, ...members]) await prisma.committeeMembership.create({ data: { committeeId: c.id, memberId: m, addedByName: "فحص" } });
      return c;
    };
    const C1 = await mkCommittee("c1", A.id, [B.id]);

    const aL = await orgActor(sess("department_admin", L.id, L.fullName));
    const aLQ = await orgActor(sess("department_admin", LQ.id, LQ.fullName));
    const aF = await orgActor(sess("super_admin", founder.id, founder.fullName));
    const aCEO = ceo ? await orgActor(sess("executive", ceo.id, ceo.fullName)) : null;
    const aA = await orgActor(sess("member", A.id, A.fullName));
    const aB = await orgActor(sess("member", B.id, B.fullName));
    const aDP = await orgActor(sess("member", DP.id, DP.fullName));

    // ═══ الصلاحيات (٣.٢، والأعضاءُ لقائد القسم — 24 نوفمبر 2026، يحلّ محلَّ ٣.٣) ═══
    const row = { ...C1, leadActive: true, actingLeadUserId: null };
    chk("**قائدُ القسم: ينبّه ويغيّر، ويدير الأعضاء**", committeeRoleFor(aL, row, false).warnLead && committeeRoleFor(aL, row, false).members);
    chk("**قائدُ اللجنة: لا يدير الأعضاء** ولا ينبّه — يقود عملها ويقترح", !committeeRoleFor(aA, row, true).members && !committeeRoleFor(aA, row, true).warnLead);
    chk("نائبُ قائد القسم المفوَّض: لا ينبّه ولا يغيّر قائدَ اللجنة (ق٤) — ويدير أعضاءها بتفويضه", !committeeRoleFor(aDP, row, false).warnLead && committeeRoleFor(aDP, row, false).members);
    chk("المؤسس: لا ينبّه ولا يدير الأعضاء بصفته", !committeeRoleFor(aF, row, false).warnLead && !committeeRoleFor(aF, row, false).members);

    // ═══ إصدارُ التنبيه ═══
    const t0 = new Date();
    chk("النائبُ لا يُصدر تنبيهاً", !(await C.issueCommitteeLeadWarning(aDP, C1.id, "سببٌ واضح", t0)).ok);
    chk("ولا المؤسس", !(await C.issueCommitteeLeadWarning(aF, C1.id, "سببٌ واضح", t0)).ok);
    if (aCEO) chk("ولا الرئيس التنفيذي على لجنة قسمٍ عادي", !(await C.issueCommitteeLeadWarning(aCEO, C1.id, "سببٌ واضح", t0)).ok);
    chk("ولا قائدُ قسمٍ آخر", !(await C.issueCommitteeLeadWarning(aLQ, C1.id, "سببٌ واضح", t0)).ok);
    chk("ولا عضوٌ في اللجنة", !(await C.issueCommitteeLeadWarning(aB, C1.id, "سببٌ واضح", t0)).ok);
    chk("ولا قائدُ اللجنة على نفسه", !(await C.issueCommitteeLeadWarning(aA, C1.id, "سببٌ واضح", t0)).ok);
    const noReason = await C.issueCommitteeLeadWarning(aL, C1.id, "  ", t0);
    chk("ولا تنبيهَ بلا سببٍ مكتوب", !noReason.ok, why(noReason));
    const w1 = await C.issueCommitteeLeadWarning(aL, C1.id, "تأخّر تقرير اللجنة الشهري", t0);
    chk("**قائدُ القسم يُصدر التنبيهَ الأول**", w1.ok && w1.ordinal === 1 && !w1.canReplace, why(w1));
    const r1 = await prisma.committeeLeadWarning.findFirstOrThrow({ where: { committeeId: C1.id }, orderBy: { createdAt: "asc" } });
    chk("يُسجَّل بسببه ومُصدِره، وحالةُ بريده", r1.reason === "تأخّر تقرير اللجنة الشهري" && r1.issuedById === L.id && !!r1.emailStatus, JSON.stringify(r1));
    chk("**والبريدُ لا يُعدّ قراءة**", r1.acknowledgedAt === null);
    chk("وفي سجلّ التدقيق", (await prisma.orgAuditEvent.count({ where: { entityId: C1.id, action: "committee.lead.warned" } })) === 1);
    const now2 = await C.issueCommitteeLeadWarning(aL, C1.id, "تكرارٌ فوري", t0);
    chk("**لا تنبيهَ ثانٍ قبل ٢٤ ساعة**", !now2.ok && why(now2).includes("٢٤"), why(now2));
    chk("ولا بعد ٢٣ ساعة", !(await C.issueCommitteeLeadWarning(aL, C1.id, "بعد ٢٣ ساعة", new Date(t0.getTime() + 23 * H))).ok);
    const w2 = await C.issueCommitteeLeadWarning(aL, C1.id, "غيابٌ عن اجتماعين", new Date(t0.getTime() + 25 * H));
    chk("وبعد ٢٥ ساعة يصدر الثاني", w2.ok && w2.ordinal === 2, why(w2));
    const earlyReplace = await C.replaceWarnedCommitteeLead(aL, C1.id, B.id, "تغييرٌ مبكّر");
    chk("**ولا تغييرَ قبل الثالث**", !earlyReplace.ok, why(earlyReplace));
    const w3 = await C.issueCommitteeLeadWarning(aL, C1.id, "لم تُوزَّع المهامّ", new Date(t0.getTime() + 50 * H));
    chk("والثالث يُتيح التغيير", w3.ok && w3.ordinal === 3 && w3.canReplace, why(w3));
    chk("**ولا تغييرَ تلقائي**", (await prisma.department.findUniqueOrThrow({ where: { id: C1.id } })).leadMemberId === A.id);
    chk("ولا رابعَ في الفترة نفسها", !(await C.issueCommitteeLeadWarning(aL, C1.id, "رابع", new Date(t0.getTime() + 80 * H))).ok);

    // ═══ نظامُ تنبيهات الأعضاء لا يُمسّ (ق٤) ═══
    const aRow = await prisma.member.findUniqueOrThrow({ where: { id: A.id } });
    chk("**تنبيهاتُ العضوية لم تُستعمل**: لا `MemberWarning` ولا عدّاد", (await prisma.memberWarning.count({ where: { memberId: A.id } })) === 0 && aRow.warningsCount === 0 && aRow.isActive);

    // ═══ تأكيدُ القراءة داخل المنصة ═══
    chk("عضوٌ آخر لا يؤكّد عن القائد", !(await C.acknowledgeCommitteeLeadWarning(aB, r1.id)).ok);
    chk("ولا قائدُ القسم", !(await C.acknowledgeCommitteeLeadWarning(aL, r1.id)).ok);
    const ack = await C.acknowledgeCommitteeLeadWarning(aA, r1.id);
    chk("**القائدُ يؤكّد اطّلاعه فيُعدّ مقروءاً**", ack.ok && !!(await prisma.committeeLeadWarning.findUniqueOrThrow({ where: { id: r1.id } })).acknowledgedAt);
    await C.acknowledgeCommitteeLeadWarning(aA, r1.id);
    chk("والتأكيدُ مرّةً واحدة في السجلّ", (await prisma.orgAuditEvent.count({ where: { entityId: C1.id, action: "committee.lead.warning_acknowledged" } })) === 1);

    // ═══ ما تعرضه صفحةُ اللجنة ═══
    const dL = await committeeDetail(aL, C1.id);
    chk("قائدُ القسم يرى التنبيهات الثلاثة وزرَّ التغيير", dL?.leadWarnings.length === 3 && dL.canReplaceLead && !dL.canWarnLead, JSON.stringify({ n: dL?.leadWarnings.length, r: dL?.canReplaceLead }));
    const dA = await committeeDetail(aA, C1.id);
    chk("والقائدُ يرى تنبيهاتِه ولا يملك التغيير", dA?.leadWarnings.length === 3 && !dA.canReplaceLead && !dA.canWarnLead);
    const dB = await committeeDetail(aB, C1.id);
    chk("وبقيةُ الأعضاء لا يرونها", !!dB && dB.leadWarnings.length === 0);

    // ═══ التغيير: لقائد القسم وحده، بسبب، والسابقُ يبقى عضواً ═══
    chk("النائبُ لا يغيّر (ق٤)", !(await C.replaceWarnedCommitteeLead(aDP, C1.id, B.id, "سببٌ واضح")).ok);
    chk("ولا المؤسس", !(await C.replaceWarnedCommitteeLead(aF, C1.id, B.id, "سببٌ واضح")).ok);
    chk("ولا تغييرَ بلا سبب", !(await C.replaceWarnedCommitteeLead(aL, C1.id, B.id, "")).ok);
    chk("ولا بقائدٍ من قسمٍ آخر", !(await C.replaceWarnedCommitteeLead(aL, C1.id, X.id, "سببٌ واضح")).ok);
    chk("ولا بالقائد نفسه", !(await C.replaceWarnedCommitteeLead(aL, C1.id, A.id, "سببٌ واضح")).ok);
    // تغييران متزامنان: يقع أحدُهما وحده
    const [x1, x2] = await Promise.all([
      C.replaceWarnedCommitteeLead(aL, C1.id, B.id, "بعد ثلاثة تنبيهات لم يتحسّن الأداء"),
      C.replaceWarnedCommitteeLead(aL, C1.id, Cm.id, "بعد ثلاثة تنبيهات — بديلٌ آخر"),
    ]);
    chk("**قائدُ القسم يغيّر بعد الثلاثة — ويقع تغييرٌ واحد من متزامنَين**", [x1.ok, x2.ok].filter(Boolean).length === 1, JSON.stringify([why(x1), why(x2)]));
    const newLeadId = x1.ok ? B.id : Cm.id;
    const after = await prisma.department.findUniqueOrThrow({ where: { id: C1.id } });
    chk("القائدُ الجديد مكتوبٌ، وبدأت فترتُه", after.leadMemberId === newLeadId && !!after.leadAssignedAt && after.leadAssignedByName === L.fullName);
    chk("**والقائدُ السابق يبقى عضواً عادياً**", (await prisma.committeeMembership.findUniqueOrThrow({ where: { committeeId_memberId: { committeeId: C1.id, memberId: A.id } } })).active);
    const ev = await prisma.orgAuditEvent.findFirst({ where: { entityId: C1.id, action: "committee.lead.replaced" } });
    chk("**ويُوثَّق كاملاً:** السببُ والتنبيهاتُ ومن قرّر",
      !!ev && !!ev.note?.includes("ثلاثة تنبيهات") && ev.actorName === L.fullName && JSON.stringify(ev.before).includes(r1.id) && JSON.stringify(ev.after).includes('"previousLeadStaysMember":true'));
    chk("والتنبيهاتُ السابقة محفوظة", (await prisma.committeeLeadWarning.count({ where: { committeeId: C1.id, leadMemberId: A.id } })) === 3);
    const dL2 = await committeeDetail(aL, C1.id);
    chk("**فترةُ القائد الجديد تبدأ بلا تنبيهات** (لا يرث تنبيهاتِ سلفه)", dL2?.leadWarnings.length === 0 && !dL2.canReplaceLead && dL2.canWarnLead);

    // ═══ الأعضاء بعد التغيير — لقائد القسم (24 نوفمبر 2026) ═══
    const aNew = await orgActor(sess("member", newLeadId));
    chk("السابقُ لا يدير الأعضاء", !(await C.addCommitteeMembers(aA, C1.id, [DP.id])).ok);
    chk("ولا القائدُ الجديد — يقترح على قائد القسم", !(await C.removeCommitteeMember(aNew, C1.id, A.id, "x")).ok);
    const rmOld = await C.removeCommitteeMember(aL, C1.id, A.id, "بعد تغيير القيادة");
    chk("**وقائدُ القسم يُخرج السابق إن شاء**", rmOld.ok, why(rmOld));

    // ═══ فترةُ القيادة: ما قبل التعيين لا يُحسب ═══
    const C2 = await mkCommittee("c2", Cm.id === newLeadId ? B.id : Cm.id, []);
    const lead2 = (await prisma.department.findUniqueOrThrow({ where: { id: C2.id } })).leadMemberId!;
    const t2 = new Date(Date.now() - 100 * H);
    await C.issueCommitteeLeadWarning(aL, C2.id, "تنبيهٌ في فترةٍ سابقة", t2);
    await prisma.department.update({ where: { id: C2.id }, data: { leadAssignedAt: new Date(t2.getTime() + H) } });
    chk("**تنبيهاتُ فترةٍ سابقة لا تُحسب في الحالية**", (await C.currentLeadWarnings(prisma, { id: C2.id, leadMemberId: lead2, leadAssignedAt: new Date(t2.getTime() + H) })).length === 0);
    // متزامنان على اللجنة نفسها
    const [y1, y2] = await Promise.all([
      C.issueCommitteeLeadWarning(aL, C2.id, "متزامن أ"),
      C.issueCommitteeLeadWarning(aL, C2.id, "متزامن ب"),
    ]);
    chk("تنبيهان متزامنان: يصدر أحدُهما وحده", [y1.ok, y2.ok].filter(Boolean).length === 1, JSON.stringify([why(y1), why(y2)]));

    // ═══ لا تنبيهَ على القائم بالخلافة ═══
    const C3 = await mkCommittee("c3", DP.id, []);
    await prisma.member.update({ where: { id: DP.id }, data: { isActive: false } });
    const w4 = await C.issueCommitteeLeadWarning(aL, C3.id, "بعد المغادرة");
    chk("لجنةٌ غادر قائدُها: لا تنبيهَ (يُعيَّن قائدٌ بمساره)", !w4.ok, why(w4));
    await prisma.member.update({ where: { id: DP.id }, data: { isActive: true } });

    // ═══ لجانُ الإدارة العليا: لقائدها الفعلي ═══
    let senior = await prisma.department.findFirst({ where: { leadershipOnly: true, parentId: null } });
    if (!senior) {
      const { createDepartment } = await import("@/lib/departments");
      await createDepartment({ name: "الإدارة العليا", colorHex: "#341D2B", createdByName: "فحص", leadershipOnly: true });
      senior = await prisma.department.findFirstOrThrow({ where: { leadershipOnly: true, parentId: null } });
    }
    {
      // يُعاد حسابُ الصفة بعد وجود الإدارة العليا — قائدُها الفعلي: الرئيسُ التنفيذي النشط، وإلا المؤسس
      const tops = [await orgActor(sess("super_admin", founder.id, founder.fullName)), ceo ? await orgActor(sess("executive", ceo.id, ceo.fullName)) : null];
      const S = await mk("senior", senior.id);
      const SC = await prisma.department.create({
        data: { name: `لجنة عليا ${TAG}`, slug: `${TAG}-sc`, colorHex: "#341D2B", parentId: senior.id, committeeStatus: "approved", purpose: "غرض", committeeKind: "permanent", leadMemberId: S.id },
      });
      await prisma.committeeMembership.create({ data: { committeeId: SC.id, memberId: S.id, addedByName: "فحص" } });
      const leaderActor = tops.find((a) => a?.seniorDepartmentId === senior!.id) ?? null;
      const otherTop = tops.find((a) => a && a !== leaderActor) ?? null;
      if (leaderActor) {
        const sw = await C.issueCommitteeLeadWarning(leaderActor, SC.id, "تنبيهٌ من قائد الإدارة العليا");
        chk("لجنةُ الإدارة العليا: قائدُها الفعلي ينبّه", sw.ok, why(sw));
        if (otherTop) chk("والآخرُ لا", !(await C.issueCommitteeLeadWarning(otherTop, SC.id, "تنبيه")).ok);
      } else {
        chk("لجنةُ الإدارة العليا (لا قائدَ فعلياً في هذه القاعدة — يُخطّى)", true);
      }
    }

    // ═══ الحذفُ النهائي للشخص لا يتعطّل بتنبيهاته (قرار «بلا أثر») ═══
    const Z = await mk("z");
    await prisma.committeeLeadWarning.create({ data: { committeeId: C1.id, leadMemberId: Z.id, issuedById: L.id, issuedByName: L.fullName, reason: "فحص الحذف" } });
    await prisma.member.delete({ where: { id: Z.id } });
    chk("حذفُ صاحب التنبيه نهائياً يقع، وتزول تنبيهاتُه معه", (await prisma.committeeLeadWarning.count({ where: { leadMemberId: Z.id } })) === 0);
  } catch (e) {
    chk("لم يقع استثناء", false, e instanceof Error ? e.stack?.split("\n").slice(0, 3).join(" ") ?? e.message : String(e));
  } finally {
    for (const c of checks) console.log(c);
    const failedN = checks.filter((c) => c.startsWith("✗")).length;
    console.log(`\n${checks.length - failedN}/${checks.length}`);
    await prisma.$disconnect();
    process.exit(failedN ? 1 : 0);
  }
})();
