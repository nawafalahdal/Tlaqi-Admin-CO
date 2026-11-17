import { uniqueTestColor } from "./testColors";
import { prisma } from "@/lib/prisma";
import { deleteDepartment } from "@/lib/departments";

/** **حذفُ لجنة** (عطبُ الإنتاج، 17 نوفمبر 2026: «حدث خطأٌ غير متوقع» عند حذف لجنةٍ لها أعضاء).
 *
 *  كان فحصُ اللجنة لا يعدّ سجلاتِها (العضويات والاجتماعات والمهام…) المقيَّدةَ في القاعدة، فيرفض Postgres الحذفَ ويصل الخطأُ
 *  الخام. والآن: بلا سجلٍّ تُحذف، ولها سجلٌّ تُؤرشَف حافظةً له، ومَن بيتُه اللجنةُ يمنع باسمه — ولا خطأَ خاماً في أيّ حال.
 *
 *  على نسخةٍ مؤقتة من القاعدة الاصطناعية:
 *    createdb -T tlaqi_mk tlaqi_cdel_e2e
 *    DATABASE_URL=…/tlaqi_cdel_e2e npx tsx --tsconfig tsconfig.json scripts/e2e-committee-delete.ts
 *    dropdb tlaqi_cdel_e2e */
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "")) {
  console.error("يُشغَّل على القاعدة المحلية وحدها");
  process.exit(1);
}
const TAG = `e2e-cd-${Date.now()}`;
const checks: string[] = [];
const chk = (n: string, ok: boolean, extra = "") => checks.push(`${ok ? "✓" : "✗ FAIL"} ${n}${!ok && extra ? " — " + extra : ""}`);

(async () => {
  try {
    const founder = await prisma.user.findFirstOrThrow({ where: { role: "super_admin", isActive: true } });
    const track = await prisma.testTrack.findFirstOrThrow();
    const parent = await prisma.department.findFirstOrThrow({ where: { parentId: null, committeeStatus: null, leadershipOnly: false } });
    let n = 0;
    // اللجنةُ العاملة لها قائدٌ دائماً (قيدُ القاعدة `Department_active_committee_has_lead`) — عضوٌ من القسم الأمّ
    const committee = async (status: "approved" | "awaiting_lead" = "approved") => {
      const lead = status === "approved" ? await member(parent.id) : null;
      return prisma.department.create({
        data: { name: `لجنة ${TAG} ${++n}`, slug: `${TAG}-c${n}`, colorHex: await uniqueTestColor(), parentId: parent.id, committeeStatus: status, leadMemberId: lead?.id ?? null } as never,
      });
    };
    async function member(departmentId: string) {
      const email = `${TAG}-m${++n}@example.test`;
      const inv = await prisma.invite.create({ data: { fullName: "نموذج", email, targetRole: "member", departmentId, testTrackId: track.id, invitedById: founder.id, status: "used" } as never });
      return prisma.member.create({
        data: { fullName: `نموذج ${n}`, email, departmentId, inviteId: inv.id, passwordHash: "!", credentialsIssuedAt: new Date(), approvalStatus: "approved", decidedAt: new Date(), isActive: true } as never,
      });
    }
    const del = (id: string, name: string, role = "super_admin") =>
      deleteDepartment({ departmentId: id, confirmName: name, actorRole: role, actorName: founder.fullName, actorId: founder.id });

    // ═══ العطبُ نفسُه: لجنةٌ لها أعضاء (عضويةٌ في CommitteeMembership) ═══
    const withMembers = await committee();
    const m1 = await member(parent.id);
    const m2 = await member(parent.id);
    for (const m of [m1, m2]) await prisma.committeeMembership.create({ data: { committeeId: withMembers.id, memberId: m.id, addedByName: "فحص" } as never });
    let r: Awaited<ReturnType<typeof del>> | null = null;
    let threw: unknown = null;
    try {
      r = await del(withMembers.id, withMembers.name);
    } catch (e) {
      threw = e;
    }
    chk("**لجنةٌ لها أعضاء: لا خطأَ خاماً** (كان: «حدث خطأٌ غير متوقع»)", !threw, threw ? String(threw).slice(0, 160) : "");
    chk("**بل تُؤرشَف** — حذفٌ يحفظ السجل", !!r && r.ok && r.mode === "archive", JSON.stringify(r));
    const archived = await prisma.department.findUniqueOrThrow({ where: { id: withMembers.id } });
    chk("حالتُها «مؤرشفة» ومن أين أُرشفت (عاملة)", archived.committeeStatus === "archived" && archived.archivedFromStatus === "approved");
    chk("وعضوياتُها باقيةٌ كما هي (تُسترجَع بها)", (await prisma.committeeMembership.count({ where: { committeeId: withMembers.id } })) === 2);
    chk("وأعضاؤها باقون في قسمهم (لا يُنقل أحد)", (await prisma.member.count({ where: { id: { in: [m1.id, m2.id] }, departmentId: parent.id, isActive: true } })) === 2);
    const ev = await prisma.orgAuditEvent.findFirst({ where: { entityId: withMembers.id, action: "committee.archive" }, orderBy: { createdAt: "desc" } });
    chk("**ومسجَّلةٌ في سجل التدقيق** باسم المؤسس وسببها", !!ev && ev.actorId === founder.id && ev.scope === "committee" && ev.departmentId === parent.id && !!ev.note?.includes("2 عضوية"));
    const again = await del(withMembers.id, withMembers.name);
    chk("وطلبُ حذفها ثانيةً يقول إنها مؤرشفة (لا خطأ)", !again.ok && again.reason.includes("مؤرشف"));

    // ═══ سجلٌّ تاريخيٌّ فقط: عضويةٌ أُزيلت، واجتماعٌ ومهمة ═══
    const historyOnly = await committee();
    const m3 = await member(parent.id);
    await prisma.committeeMembership.create({ data: { committeeId: historyOnly.id, memberId: m3.id, addedByName: "فحص", active: false, removedAt: new Date(), removedByName: "فحص" } as never });
    await prisma.committeeMeeting.create({ data: { committeeId: historyOnly.id, title: "اجتماع", startsAt: new Date(), createdByName: "فحص" } as never });
    const r2 = await del(historyOnly.id, historyOnly.name);
    chk("**لجنةٌ بلا أعضاءٍ حاليين ولها تاريخ: تُؤرشف** ولا يضيع اجتماعُها", r2.ok && r2.mode === "archive" && (await prisma.committeeMeeting.count({ where: { committeeId: historyOnly.id } })) === 1, JSON.stringify(r2));

    // ═══ لجنةٌ بانتظار قائد ولها تنبيهٌ أو مقترح — تُؤرشف من حالتها ═══
    const awaiting = await committee("awaiting_lead");
    const m4 = await member(parent.id);
    await prisma.committeeMembership.create({ data: { committeeId: awaiting.id, memberId: m4.id, addedByName: "فحص" } as never });
    const r3 = await del(awaiting.id, awaiting.name);
    chk("ولجنةٌ «بانتظار قائد» تُؤرشف وتُحفظ حالتُها للاسترجاع", r3.ok && r3.mode === "archive" && (await prisma.department.findUniqueOrThrow({ where: { id: awaiting.id } })).archivedFromStatus === "awaiting_lead");

    // ═══ بلا أيّ سجلّ: تُحذف نهائياً كما كانت ═══
    const empty = await committee();
    const r4 = await del(empty.id, empty.name);
    chk("**لجنةٌ بلا أيّ سجلّ تُحذف نهائياً**", r4.ok && r4.mode === "delete" && !(await prisma.department.findUnique({ where: { id: empty.id } })), JSON.stringify(r4));

    // ═══ مَن بيتُه اللجنةُ نفسُها يمنع باسمه ═══
    const home = await committee();
    await member(home.id);
    const r5 = await del(home.id, home.name);
    chk("**عضوٌ نشط قسمُه اللجنةُ يمنع** بسببٍ مسمّى (لا يُترك بلا قسم)", !r5.ok && r5.reason.includes("عضو نشط قسمُه هذه اللجنة"), JSON.stringify(r5));
    chk("ولا يتغيّر شيء", (await prisma.department.findUniqueOrThrow({ where: { id: home.id } })).committeeStatus === "approved");

    // ═══ الحدودُ القائمة باقية ═══
    const guarded = await committee();
    const byExec = await del(guarded.id, guarded.name, "executive");
    chk("الحذفُ للمؤسس وحده (التنفيذيُّ يُرفض)", !byExec.ok && byExec.reason.includes("للمؤسس وحده"));
    const wrong = await del(guarded.id, "اسمٌ آخر");
    chk("والاسمُ المكتوب خطأً لا يحذف شيئاً", !wrong.ok && !!(await prisma.department.findUnique({ where: { id: guarded.id } })));
  } catch (e) {
    chk("لم يقع استثناء", false, e instanceof Error ? e.stack?.split("\n").slice(0, 3).join(" ") ?? e.message : String(e));
  } finally {
    console.log(checks.join("\n"));
    await prisma.$disconnect();
    process.exit(checks.some((c) => c.startsWith("✗")) ? 1 : 0);
  }
})();
