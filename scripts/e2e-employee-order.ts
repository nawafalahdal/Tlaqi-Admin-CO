/** **ترتيبُ الأرقام الوظيفية بالقيادة** (الترحيل `20261117060000_employee_numbers_leadership_order`):
 *  المؤسس 001، الرئيس التنفيذي 002، المتابعة والتشغيل 003، ثم الفريقُ بترتيبه الحالي على الأرقام المستعملة نفسِها.
 *
 *  يبني عالماً مبعثراً عن قصد (رئيسٌ رقمُه 5 وتوأمُه، تشغيلٌ 7، موظفٌ سابق، رقمٌ متقاعد 6، رئيسٌ سابقٌ معطَّل)، ثم يطبّق
 *  كتلةَ الترحيل نفسَها من ملفّها ويفحص النتيجة. تشغيل (قاعدةٌ محلية اصطناعية وحدها — تُمسَح أرقامُها في الفحص):
 *    DATABASE_URL=… npx tsx --tsconfig tsconfig.json scripts/e2e-employee-order.ts */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "@/lib/prisma";

const TAG = `e2e-eno-${Date.now()}`;
const checks: string[] = [];
const chk = (n: string, ok: boolean, extra = "") => checks.push(`${ok ? "✓" : "✗ FAIL"} ${n}${!ok && extra ? " — " + extra : ""}`);
const SQL = readFileSync(join(process.cwd(), "prisma/migrations/20261117060000_employee_numbers_leadership_order/migration.sql"), "utf8");

(async () => {
  try {
    if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "")) throw new Error("قاعدةٌ محلية وحدها");
    const founder = await prisma.user.findFirstOrThrow({ where: { role: "super_admin", isActive: true }, orderBy: { createdAt: "asc" } });
    const track = await prisma.testTrack.findFirstOrThrow({ where: { scope: "department_member" } });
    let n = 0;
    const mail = (k: string) => `${TAG}-${k}-${++n}@example.test`;

    // ── عالمٌ نظيف: لا أرقامَ ولا مقاعدَ قياديةَ نشطة سوى المؤسس (قاعدةُ الفحص وحدها)
    await prisma.$executeRawUnsafe(`UPDATE "User" SET "employeeNo" = NULL`);
    await prisma.$executeRawUnsafe(`UPDATE "Member" SET "employeeNo" = NULL`);
    await prisma.user.updateMany({ where: { role: { in: ["executive", "operations_officer"] }, isActive: true }, data: { isActive: false } });

    const user = (name: string, role: "executive" | "operations_officer" | "department_admin", employeeNo: number, isActive = true, email = mail("u")) =>
      prisma.user.create({ data: { fullName: name, email, passwordHash: "!", role, isActive, employeeNo } as never });
    const member = async (name: string, employeeNo: number, o: { email?: string; active?: boolean } = {}) => {
      const email = o.email ?? mail("m");
      const inv = await prisma.invite.create({ data: { fullName: name, email, targetRole: "member", testTrackId: track.id, invitedById: founder.id, status: "used" } as never });
      return prisma.member.create({
        data: {
          fullName: name, email, inviteId: inv.id, passwordHash: "!", approvalStatus: "approved", decidedAt: new Date(), credentialsIssuedAt: new Date(),
          isActive: o.active ?? true, ...(o.active === false ? { terminatedAt: new Date() } : {}), employeeNo,
        } as never,
      });
    };

    // ── قبل: المؤسس 1، فريقٌ 2 و3، سابقٌ 4، الرئيسُ 5 (وتوأمُه)، 6 متقاعد (حُذف صاحبُه)، التشغيلُ 7، فريقٌ 8، رئيسٌ سابقٌ معطَّل 9
    await prisma.user.update({ where: { id: founder.id }, data: { employeeNo: 1 } });
    const a = await member(`أ ${TAG}`, 2);
    const b = await member(`ب ${TAG}`, 3);
    const former = await member(`سابق ${TAG}`, 4, { active: false });
    const ceoMail = mail("ceo");
    const ceo = await user(`الرئيس ${TAG}`, "executive", 5, true, ceoMail);
    const ceoTwin = await member(`الرئيس ${TAG}`, 5, { email: ceoMail });
    const ops = await user(`التشغيل ${TAG}`, "operations_officer", 7);
    const c = await member(`ج ${TAG}`, 8);
    const oldCeo = await user(`رئيسٌ سابق ${TAG}`, "executive", 9, false);
    await prisma.$executeRawUnsafe(`SELECT setval('"User_employeeNo_seq"', 9, true)`);
    const auditBefore = await prisma.orgAuditEvent.count({ where: { action: "employee_no.reordered" } });

    await prisma.$executeRawUnsafe(SQL);

    const no = async (kind: "user" | "member", id: string) =>
      kind === "user" ? (await prisma.user.findUniqueOrThrow({ where: { id } })).employeeNo : (await prisma.member.findUniqueOrThrow({ where: { id } })).employeeNo;
    chk("**المؤسسُ 001**", (await no("user", founder.id)) === 1);
    chk("**الرئيسُ التنفيذي 002** (كان 005)", (await no("user", ceo.id)) === 2, String(await no("user", ceo.id)));
    chk("وسجلُّ عضويته التوأم 002 أيضاً — رقمٌ واحدٌ للشخص", (await no("member", ceoTwin.id)) === 2, String(await no("member", ceoTwin.id)));
    chk("**المتابعةُ والتشغيل 003** (كان 007)", (await no("user", ops.id)) === 3, String(await no("user", ops.id)));
    const rest = [await no("member", a.id), await no("member", b.id), await no("member", former.id), await no("member", c.id), await no("user", oldCeo.id)];
    chk("**الفريقُ بترتيبه الحالي من 004:** أ 004، ب 005، السابق 007، ج 008، الرئيسُ السابقُ المعطَّل 009", JSON.stringify(rest) === JSON.stringify([4, 5, 7, 8, 9]), JSON.stringify(rest));
    const all = [
      ...(await prisma.user.findMany({ where: { employeeNo: { not: null } }, select: { employeeNo: true, email: true } })),
      ...(await prisma.member.findMany({ where: { employeeNo: { not: null } }, select: { employeeNo: true, email: true } })),
    ];
    chk("**الرقمُ المتقاعد 006 لم يُمنح لأحد**", !all.some((r) => r.employeeNo === 6));
    const perNo = new Map<number, Set<string>>();
    for (const r of all) perNo.set(r.employeeNo!, new Set([...(perNo.get(r.employeeNo!) ?? []), r.email.toLowerCase()]));
    chk("ولا رقمَ لشخصين", [...perNo.values()].every((s) => s.size === 1));
    const seqNext = Number((await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT nextval('"User_employeeNo_seq"') AS n`))[0].n);
    chk("**التسلسلُ لا يرجع:** الموظفُ الجديد يأخذ 010", seqNext === 10, String(seqNext));

    // ── التدقيق: كلُّ سجلٍّ تغيّر رقمُه موثَّقٌ بقيمتيه (أ، ب، السابق، الرئيس وتوأمُه، التشغيل = ستة؛ ج والرئيسُ السابق لم يتغيّرا)
    const events = await prisma.orgAuditEvent.findMany({ where: { action: "employee_no.reordered" }, orderBy: { createdAt: "asc" } });
    const fresh = events.slice(auditBefore);
    chk("**كلُّ تغييرٍ مسجَّلٌ في سجل التدقيق** (6 سجلّات)", fresh.length === 6, String(fresh.length));
    const ceoEv = fresh.find((e) => e.entityId === ceo.id);
    chk("بقيمتيه قبل وبعد (الرئيس: 5 ← 2)", (ceoEv?.before as { employeeNo?: number })?.employeeNo === 5 && (ceoEv?.after as { employeeNo?: number })?.employeeNo === 2);
    chk("ومن لم يتغيّر رقمُه لا سجلَّ له", !fresh.some((e) => e.entityId === c.id || e.entityId === oldCeo.id || e.entityId === founder.id));

    // ── البطاقةُ تتبع الرقم الجديد (مفتاحُ الكاش يحمل الرقم)
    const { businessCardData } = await import("@/lib/businessCardData");
    chk("**بطاقةُ الرئيس تحمل TLAQI - 002**", (await businessCardData({ kind: "user", id: ceo.id }))?.data.employeeId === "TLAQI - 002");

    // ── إعادةُ التشغيل لا تغيّر شيئاً (قاعدةٌ مرتّبةٌ أصلاً)
    const snapshot = JSON.stringify(all.map((r) => [r.email, r.employeeNo]).sort());
    await prisma.$executeRawUnsafe(SQL);
    const after2 = [
      ...(await prisma.user.findMany({ where: { employeeNo: { not: null } }, select: { employeeNo: true, email: true } })),
      ...(await prisma.member.findMany({ where: { employeeNo: { not: null } }, select: { employeeNo: true, email: true } })),
    ];
    chk("**التشغيلُ الثاني لا يغيّر شيئاً**", JSON.stringify(after2.map((r) => [r.email, r.employeeNo]).sort()) === snapshot);
    chk("ولا يضيف سجلَّ تدقيق", (await prisma.orgAuditEvent.count({ where: { action: "employee_no.reordered" } })) === auditBefore + 6);

    // ── مقعدٌ شاغر لا يُحجز: بلا رئيسٍ نشط، التشغيلُ يبقى 003 ولا يُمنح 002 لأحدٍ قسراً
    await prisma.user.update({ where: { id: ceo.id }, data: { isActive: false } });
    await prisma.$executeRawUnsafe(SQL);
    chk("**بلا رئيسٍ نشط:** التشغيلُ يبقى 003", (await no("user", ops.id)) === 3, String(await no("user", ops.id)));
    chk("والرئيسُ المعطَّل يُرتَّب مع الفريق بلا تكرار", new Set([
      ...(await prisma.user.findMany({ where: { employeeNo: { not: null } }, select: { employeeNo: true } })).map((r) => r.employeeNo),
    ]).size === (await prisma.user.count({ where: { employeeNo: { not: null } } })));
  } catch (e) {
    chk("EXC", false, String(e));
  } finally {
    console.log(checks.join("\n"));
    await prisma.$disconnect();
    process.exit(checks.some((c) => c.startsWith("✗")) ? 1 : 0);
  }
})();
