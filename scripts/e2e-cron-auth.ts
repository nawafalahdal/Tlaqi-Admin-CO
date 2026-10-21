import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { cronAuthorization } from "@/lib/cronAuth";
import { GET } from "@/app/api/cron/sweep/route";

/** حمايةُ الكنس المجدول — يُغلق عند الشكّ.
 *
 *  كان المسار يفحص `CRON_SECRET` إن وُجد ويُشغّل الكنسَ إن غاب. وهذا يفحص
 *  الحالات الثلاث (مفتاحٌ غائب، وترويسةٌ خاطئة، وترويسةٌ صحيحة) على الدالّة
 *  ثم على المسار نفسه — ويُثبت أن العمل لم يقع بأثرٍ في القاعدة لا بالردّ
 *  وحده: تذكرةٌ مؤرشفة يمحوها الكنسُ إن جرى، وتبقى إن لم يجرِ.
 *
 *  على القاعدة المحلية وحدها، والمفتاحُ عشوائيٌّ يُولَّد هنا ولا يُطبع. */

if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "")) {
  console.error("يُشغَّل على القاعدة المحلية وحدها");
  process.exit(1);
}

const checks: string[] = [];
const chk = (n: string, ok: boolean, extra = "") =>
  checks.push(`${ok ? "✓" : "✗ FAIL"} ${n}${extra ? " — " + extra : ""}`);

const SECRET = randomBytes(32).toString("hex");
const STAMP = Date.now();
const call = (authorization?: string) =>
  GET(new Request("http://localhost/api/cron/sweep", { headers: authorization ? { authorization } : {} }));

async function sentinel() {
  const founder = await prisma.user.findFirstOrThrow({ where: { role: "super_admin" } });
  const dept = await prisma.department.findFirstOrThrow({ where: { parentId: null } });
  return prisma.ticket.create({
    data: {
      subject: `فحص الكنس ${STAMP}`, description: "يمحوها الكنسُ إن جرى",
      raisedByUserId: founder.id, targetDepartmentId: dept.id, stage: "department",
      status: "resolved", resolvedAt: new Date("2020-01-01"),
      stageDueAt: new Date("2020-01-02"), firstDueAt: new Date("2020-01-02"),
      sheetRow: 1,
    },
  });
}
const alive = async (id: string) => (await prisma.ticket.findUnique({ where: { id } })) !== null;
const cleanup = () => prisma.ticket.deleteMany({ where: { subject: `فحص الكنس ${STAMP}` } });

(async () => {
  const saved = process.env.CRON_SECRET;

  // ١ — الدالّة
  chk("بلا مفتاح: «غير مُعَدّ» ولو جاءت ترويسة", cronAuthorization(`Bearer ${SECRET}`, undefined) === "unconfigured");
  chk("بلا مفتاح: «Bearer undefined» لا تفتح", cronAuthorization("Bearer undefined", undefined) === "unconfigured");
  chk("مفتاحٌ فارغ أو مسافات: «غير مُعَدّ»",
      cronAuthorization("Bearer ", "") === "unconfigured" && cronAuthorization("Bearer    ", "   ") === "unconfigured");
  chk("بلا ترويسة: مرفوض", cronAuthorization(null, SECRET) === "unauthorized");
  chk("مفتاحٌ خاطئ: مرفوض", cronAuthorization(`Bearer ${randomBytes(32).toString("hex")}`, SECRET) === "unauthorized");
  chk("جزءٌ من المفتاح أو زيادةٌ عليه: مرفوض",
      cronAuthorization(`Bearer ${SECRET.slice(0, -1)}`, SECRET) === "unauthorized" &&
      cronAuthorization(`Bearer ${SECRET}x`, SECRET) === "unauthorized");
  chk("المفتاح بلا «Bearer» أو بمخطّطٍ آخر: مرفوض",
      cronAuthorization(SECRET, SECRET) === "unauthorized" &&
      cronAuthorization(`Basic ${SECRET}`, SECRET) === "unauthorized" &&
      cronAuthorization(`bearer ${SECRET}`, SECRET) === "unauthorized");
  chk("الترويسةُ الصحيحة: مقبول", cronAuthorization(`Bearer ${SECRET}`, SECRET) === "ok");

  // ٢ — المسار: مفتاحٌ غائب من البيئة
  const t1 = await sentinel();
  delete process.env.CRON_SECRET;
  const errs: string[] = [];
  const origError = console.error;
  console.error = (...a: unknown[]) => { errs.push(a.map(String).join(" ")); };
  const r1 = await call();
  const r1b = await call("Bearer undefined");
  console.error = origError;
  chk("المسار بلا مفتاحٍ في البيئة: 401", r1.status === 401 && r1b.status === 401, `${r1.status}/${r1b.status}`);
  chk("ولم يجرِ الكنس", await alive(t1.id));
  chk("ويُسجَّل الإعدادُ الناقص بلا قيمة", errs.some((e) => e.includes("CRON_SECRET is not configured")) && errs.every((e) => !e.includes("Bearer")));
  chk("والسائلُ لا يُخبَر بالسبب", JSON.stringify(await r1.json()) === '{"error":"unauthorized"}');

  // ٣ — المسار: مفتاحٌ مُعَدّ وترويسةٌ خاطئة أو غائبة
  process.env.CRON_SECRET = SECRET;
  const r2 = await call();
  const r3 = await call(`Bearer ${randomBytes(32).toString("hex")}`);
  chk("بلا ترويسة: 401", r2.status === 401, String(r2.status));
  chk("بترويسةٍ خاطئة: 401", r3.status === 401, String(r3.status));
  chk("ولم يجرِ الكنس", await alive(t1.id));

  // ٤ — المسار: الترويسةُ الصحيحة
  const r4 = await call(`Bearer ${SECRET}`);
  const body = (await r4.json()) as { ok?: boolean; archivedTickets?: number };
  chk("بالترويسة الصحيحة: 200 ويجري الكنس", r4.status === 200 && body.ok === true, String(r4.status));
  chk("وأثرُه في القاعدة: مُحيت التذكرةُ المؤرشفة", !(await alive(t1.id)) && (body.archivedTickets ?? 0) >= 1);

  if (saved === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = saved;
  await cleanup();
  console.log(checks.join("\n"));
  const failed = checks.some((c) => c.startsWith("✗"));
  console.log("\n" + (failed ? "FAILURES PRESENT" : "ALL PASS"));
  process.exit(failed ? 1 : 0);
})().catch(async (e) => { console.error(e); await cleanup(); process.exit(1); });
