import type { Session } from "next-auth";
import { uniqueTestColor } from "./testColors";
import { prisma } from "@/lib/prisma";
import { deleteDepartment } from "@/lib/departments";
import { orgActor } from "@/lib/org/actor";
import { purgeArchivedCommittee } from "@/lib/org/committeeService";
import { permanentlyDeleteAccount } from "@/lib/founderActions";

/** **الحذفُ النهائي: اللجنةُ المؤرشفة والسجلُّ المتوقف** (طلبُ المؤسس، 18 نوفمبر 2026).
 *
 *  - اللجنةُ المؤرشفة تُمحى بكل سجلّاتها — للمؤسس وحده، باسمها وسببٍ، ولا يُمسّ أعضاؤها؛ ويبقى أثرُها في سجل التدقيق.
 *  - السجلُّ المتوقفُ أو المرفوض يُحذف بالطريق الواحد (`permanentlyDeleteAccount`) بلا إقرار «النشط» — وهو ما يناديه زرُّه.
 *
 *  على نسخةٍ مؤقتة من القاعدة الاصطناعية:
 *    createdb -T tlaqi_mk tlaqi_cpurge_e2e
 *    DATABASE_URL=…/tlaqi_cpurge_e2e npx tsx --tsconfig tsconfig.json scripts/e2e-committee-purge.ts
 *    dropdb tlaqi_cpurge_e2e */
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "")) {
  console.error("يُشغَّل على القاعدة المحلية وحدها");
  process.exit(1);
}
const TAG = `e2e-cp-${Date.now()}`;
const checks: string[] = [];
const chk = (n: string, ok: boolean, extra = "") => checks.push(`${ok ? "✓" : "✗ FAIL"} ${n}${!ok && extra ? " — " + extra : ""}`);
const sess = (role: string, id: string, name = "فحص"): Session => ({ user: { id, role, name } }) as unknown as Session;
const why = (r: { ok: boolean; reason?: string }) => (r.ok ? "" : r.reason ?? "");

(async () => {
  try {
    const founder = await prisma.user.findFirstOrThrow({ where: { role: "super_admin", isActive: true } });
    const exec = await prisma.user.findFirst({ where: { role: "executive", isActive: true } });
    const track = await prisma.testTrack.findFirstOrThrow();
    const parent = await prisma.department.findFirstOrThrow({ where: { parentId: null, committeeStatus: null, leadershipOnly: false } });
    const F = await orgActor(sess("super_admin", founder.id, founder.fullName));
    let n = 0;
    async function member(departmentId: string, extra: Record<string, unknown> = {}) {
      const email = `${TAG}-m${++n}@example.test`;
      const inv = await prisma.invite.create({ data: { fullName: "نموذج", email, targetRole: "member", departmentId, testTrackId: track.id, invitedById: founder.id, status: "used" } as never });
      return prisma.member.create({
        data: { fullName: `نموذج ${n}`, email, departmentId, inviteId: inv.id, passwordHash: "!", credentialsIssuedAt: new Date(), approvalStatus: "approved", decidedAt: new Date(), isActive: true, ...extra } as never,
      });
    }
    const committee = async () => {
      const lead = await member(parent.id);
      const c = await prisma.department.create({
        data: { name: `لجنة ${TAG} ${++n}`, slug: `${TAG}-c${n}`, colorHex: await uniqueTestColor(), parentId: parent.id, committeeStatus: "approved", leadMemberId: lead.id } as never,
      });
      return { c, lead };
    };
    const archive = (id: string, name: string) => deleteDepartment({ departmentId: id, confirmName: name, actorRole: "super_admin", actorName: founder.fullName, actorId: founder.id });

    // ═══ لجنةٌ بسجلٍّ كامل تُؤرشف ثم تُمحى ═══
    const { c: full, lead } = await committee();
    const m1 = await member(parent.id);
    const m2 = await member(parent.id);
    for (const m of [lead, m1, m2]) await prisma.committeeMembership.create({ data: { committeeId: full.id, memberId: m.id, addedByName: "فحص" } as never });
    const meeting = await prisma.committeeMeeting.create({ data: { committeeId: full.id, title: "اجتماع", startsAt: new Date(), createdByName: "فحص" } as never });
    await prisma.committeeAttendance.create({ data: { meetingId: meeting.id, memberId: m1.id, status: "present", recordedByName: "فحص" } as never });
    await prisma.committeeDecision.create({ data: { committeeId: full.id, meetingId: meeting.id, kind: "decision", text: "قرار", createdByName: "فحص" } as never });
    await prisma.committeeTask.create({ data: { committeeId: full.id, meetingId: meeting.id, title: "مهمة", assigneeMemberId: m2.id, createdByName: "فحص", status: "todo" } as never });
    await prisma.committeeReport.create({ data: { committeeId: full.id, periodLabel: "نوفمبر", summary: "ملخّص", submittedByName: "فحص" } as never });
    await prisma.committeeProposal.create({ data: { committeeId: full.id, kind: "remove_member", memberId: m2.id, proposedByName: "فحص" } as never });
    await prisma.committeeLeadWarning.create({ data: { committeeId: full.id, leadMemberId: lead.id, issuedById: founder.id, issuedByName: "فحص", reason: "فحص" } as never });

    // لجنةٌ عاملة لا تُمحى — تُؤرشف أولاً
    const notYet = await purgeArchivedCommittee(F, full.id, { confirmName: full.name, reason: "حذف تجريبي" });
    chk("**اللجنةُ العاملة لا تُمحى** — تُؤرشف أولاً", !notYet.ok && why(notYet).includes("مؤرشفة"), why(notYet));
    const arch = await archive(full.id, full.name);
    chk("الحذفُ من الأقسام يؤرشفها (لها سجلّ)", arch.ok && arch.mode === "archive", JSON.stringify(arch));

    // الحدود
    {
      // القاعدةُ الاصطناعية قد تخلو من رئيسٍ تنفيذي — فصاحبُ الطلب بدوره «تنفيذي» (الحارسُ يقرأ الدور)
      const E = exec ? await orgActor(sess("executive", exec.id, exec.fullName)) : { ...F!, role: "executive" as const };
      const byExec = await purgeArchivedCommittee(E, full.id, { confirmName: full.name, reason: "حذف تجريبي" });
      chk("**الرئيسُ التنفيذي يُرفض** — المؤسس وحده", !byExec.ok && why(byExec).includes("للمؤسس وحده"), why(byExec));
    }
    const M = await orgActor(sess("member", lead.id, lead.fullName));
    const byLead = await purgeArchivedCommittee(M, full.id, { confirmName: full.name, reason: "حذف تجريبي" });
    chk("وقائدُ اللجنة يُرفض", !byLead.ok, why(byLead));
    const wrong = await purgeArchivedCommittee(F, full.id, { confirmName: "اسمٌ آخر", reason: "حذف تجريبي" });
    chk("الاسمُ المكتوب خطأً لا يمحو شيئاً", !wrong.ok && !!(await prisma.department.findUnique({ where: { id: full.id } })), why(wrong));
    const noReason = await purgeArchivedCommittee(F, full.id, { confirmName: full.name, reason: "  " });
    chk("ولا يمحو بلا سبب", !noReason.ok && why(noReason).includes("سبب"), why(noReason));

    // المحو
    const r = await purgeArchivedCommittee(F, full.id, { confirmName: `  ${full.name} `, reason: "لجنة تجريبية لا حاجة لها" });
    chk("**المؤسسُ يمحو اللجنةَ المؤرشفة**", r.ok, why(r));
    chk("فلا يبقى صفُّها", !(await prisma.department.findUnique({ where: { id: full.id } })));
    const left = await Promise.all([
      prisma.committeeMembership.count({ where: { committeeId: full.id } }),
      prisma.committeeMeeting.count({ where: { committeeId: full.id } }),
      prisma.committeeAttendance.count({ where: { meetingId: meeting.id } }),
      prisma.committeeDecision.count({ where: { committeeId: full.id } }),
      prisma.committeeTask.count({ where: { committeeId: full.id } }),
      prisma.committeeReport.count({ where: { committeeId: full.id } }),
      prisma.committeeProposal.count({ where: { committeeId: full.id } }),
      prisma.committeeLeadWarning.count({ where: { committeeId: full.id } }),
    ]);
    chk("**ولا سجلَّ من سجلّاتها** (عضويات، اجتماعات، حضور، قرارات، مهام، تقارير، مقترحات، تنبيهات)", left.every((x) => x === 0), left.join(","));
    chk("**والأعضاءُ أنفسُهم باقون في قسمهم**", (await prisma.member.count({ where: { id: { in: [lead.id, m1.id, m2.id] }, departmentId: parent.id, isActive: true } })) === 3);
    const ev = await prisma.orgAuditEvent.findFirst({ where: { entityId: full.id, action: "committee.purge" } });
    const before = (ev?.before ?? {}) as Record<string, unknown>;
    chk(
      "**وأثرُها في سجل التدقيق:** المؤسسُ والاسمُ وأعدادُ ما مُحي والسبب",
      !!ev && ev.actorId === founder.id && ev.departmentId === parent.id && before.name === full.name && before.memberships === 3 && before.meetings === 1 && before.attendance === 1 && ev.note === "لجنة تجريبية لا حاجة لها",
      JSON.stringify(ev)
    );
    chk("وحدثُ الأرشفة قبله باقٍ (السجلُّ لا يُمحى)", (await prisma.orgAuditEvent.count({ where: { entityId: full.id, action: "committee.archive" } })) === 1);
    const again = await purgeArchivedCommittee(F, full.id, { confirmName: full.name, reason: "مرّة ثانية" });
    chk("وطلبُ محوها ثانيةً: غير موجودة (لا خطأ خام)", !again.ok && why(again).includes("غير موجودة"), why(again));

    // ═══ مَن بيتُه اللجنةُ يمنع ═══
    const { c: home } = await committee();
    await prisma.committeeMembership.create({ data: { committeeId: home.id, memberId: (await member(parent.id)).id, addedByName: "فحص" } as never });
    await archive(home.id, home.name);
    const resident = await member(parent.id);
    await prisma.member.update({ where: { id: resident.id }, data: { departmentId: home.id } });
    const blocked = await purgeArchivedCommittee(F, home.id, { confirmName: home.name, reason: "حذف تجريبي" });
    chk("**عضوٌ نشط قسمُه اللجنةُ يمنع المحو** باسمه", !blocked.ok && why(blocked).includes("عضو نشط"), why(blocked));
    chk("ولا يُمحى شيء", (await prisma.department.findUniqueOrThrow({ where: { id: home.id } })).committeeStatus === "archived" && (await prisma.committeeMembership.count({ where: { committeeId: home.id } })) === 1);

    // ═══ السجلُّ المتوقفُ والمرفوض (زرُّ «المتوقفون والمرفوضون») ═══
    const del = (id: string, email: string) =>
      permanentlyDeleteAccount({ kind: "member", id, confirmEmail: email, reason: "سجل متوقف تجريبي", force: false, actorRole: "super_admin", actorId: founder.id, actorName: founder.fullName });
    const stopped = await member(parent.id, { isActive: false, terminatedAt: new Date(), exitReason: "إنهاء عضوية" });
    const rStopped = await del(stopped.id, stopped.email.toUpperCase());
    chk("**المتوقفُ يُحذف نهائياً** بلا إقرار «النشط»", rStopped.ok && !(await prisma.member.findUnique({ where: { id: stopped.id } })), why(rStopped));
    chk("ويتحرّر بريدُه (دعوتُه تُمحى معه)", !(await prisma.invite.findFirst({ where: { email: stopped.email } })));
    const rejected = await member(parent.id, { approvalStatus: "rejected", testStatus: "failed" });
    const rRejected = await del(rejected.id, rejected.email);
    chk("**والمرفوضُ يُحذف نهائياً**", rRejected.ok && !(await prisma.member.findUnique({ where: { id: rejected.id } })), why(rRejected));
    const activeOne = await member(parent.id);
    const rActive = await del(activeOne.id, activeOne.email);
    chk("والعضوُ المعتمدُ النشط لا يُحذف من هذا الطريق (بلا إقرار)", !rActive.ok && !!(await prisma.member.findUnique({ where: { id: activeOne.id } })), why(rActive));
    const stopped2 = await member(parent.id, { isActive: false, terminatedAt: new Date() });
    const rWrong = await del(stopped2.id, "other@example.test");
    chk("والبريدُ المكتوب خطأً لا يحذف شيئاً", !rWrong.ok && !!(await prisma.member.findUnique({ where: { id: stopped2.id } })), why(rWrong));
    const rNotFounder = await permanentlyDeleteAccount({ kind: "member", id: stopped2.id, confirmEmail: stopped2.email, reason: "محاولة", force: false, actorRole: "department_admin", actorId: exec?.id ?? founder.id, actorName: "قائد قسم" }).catch((e: Error) => ({ ok: false as const, reason: e.message }));
    chk("**وغيرُ المؤسس والرئيس التنفيذي يُرفض** (قائدُ قسم)", !rNotFounder.ok && !!(await prisma.member.findUnique({ where: { id: stopped2.id } })), JSON.stringify(rNotFounder));
  } catch (e) {
    chk("لم يقع استثناء", false, e instanceof Error ? e.stack?.split("\n").slice(0, 3).join(" ") ?? e.message : String(e));
  } finally {
    console.log(checks.join("\n"));
    await prisma.$disconnect();
    process.exit(checks.some((c) => c.startsWith("✗")) ? 1 : 0);
  }
})();
