import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/credentials";
import { issueLoginCode } from "@/lib/loginCodes";
import { issueAppreciation, appreciationState, sweepThreeMonthAppreciation } from "@/lib/appreciation";
import { markCertificateShared } from "@/lib/offboarding";
import { canIssueCertificates, finalState, loadCertificateDesk } from "@/lib/recognitionDesk";
import { certificateFor, certificateBody, certificateHeading, appreciationFullTerm } from "@/lib/certificate";
import { anniversaryDate } from "@/lib/anniversary";

/** **الترحيب والتكريم** — الشهادات من صفحة بطاقات الانضمام.
 *
 *  على بياناتٍ اختباريةٍ تُنشأ وتُحذف، والقاعدةُ محليةٌ وحدها:
 *  - الصلاحية: مسؤول المتابعة والتشغيل والتنفيذي والمؤسس — لا قائد القسم ولا العضو.
 *  - التقدير في موعده، والمبكرُ بقرارٍ مكتوب وبمدّته الفعلية، ولا شهادةَ ثانية.
 *  - لا تقديرَ لصفِّ قيادة، والختامُ بحوكمة الأسبوعين.
 *  - (اختياري) عبر HTTP بدخولٍ حقيقي: مسؤول التشغيل يرى التبويب، وقائد القسم يُعاد.
 *
 *    npx tsx --tsconfig tsconfig.json scripts/e2e-recognition-desk.ts   (والخادمُ على :3000 للجزء الأخير) */
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "")) {
  console.error("يُشغَّل على القاعدة المحلية وحدها");
  process.exit(1);
}
const BASE = process.env.CHECK_BASE_URL ?? "http://localhost:3000";
const TAG = `e2e-rdesk-${Date.now()}`;
const PASS = "RecDesk#2026aa";
const DAY = 86_400_000;

const checks: string[] = [];
const chk = (n: string, ok: boolean, extra = "") => checks.push(`${ok ? "✓" : "✗ FAIL"} ${n}${!ok && extra ? " — " + extra : ""}`);

async function cleanup() {
  const ms = await prisma.member.findMany({ where: { email: { startsWith: "e2e-rdesk-" } }, select: { id: true, inviteId: true } });
  for (const m of ms) {
    await prisma.member.delete({ where: { id: m.id } }).catch(() => {});
    await prisma.invite.delete({ where: { id: m.inviteId } }).catch(() => {});
  }
  await prisma.loginCode.deleteMany({ where: { email: { startsWith: "e2e-rdesk-" } } }).catch(() => {});
  await prisma.user.deleteMany({ where: { email: { startsWith: "e2e-rdesk-" } } }).catch(() => {});
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
  const dept = await prisma.department.findFirstOrThrow({ where: { parentId: null, leadershipOnly: false } });
  const track = await prisma.testTrack.findFirstOrThrow();
  const founder = await prisma.user.findFirstOrThrow({ where: { role: "super_admin" } });

  let n = 0;
  async function mkMember(o: { role?: "member" | "department_admin"; decidedDaysAgo: number; stepDown?: boolean }) {
    n += 1;
    const email = `${TAG}-${n}@example.test`;
    const invite = await prisma.invite.create({
      data: { fullName: `مكرَّم ${n}`, email, targetRole: o.role ?? "member", departmentId: dept.id, testTrackId: track.id, invitedById: founder.id, status: "used" },
    });
    const decidedAt = new Date(Date.now() - o.decidedDaysAgo * DAY);
    return prisma.member.create({
      data: {
        fullName: `مكرَّم ${TAG.slice(-5)} ${n}`, email, departmentId: dept.id, inviteId: invite.id,
        decidedAt, joinDate: decidedAt, approvalStatus: "approved", isActive: true,
        ...(o.stepDown ? { stepDownAt: new Date(), exitReason: "فحص" } : {}),
      },
    });
  }

  // ١ — الصلاحية
  chk("مسؤول المتابعة والتشغيل يُصدر", canIssueCertificates("operations_officer"));
  chk("والرئيس التنفيذي والمؤسس", canIssueCertificates("executive") && canIssueCertificates("super_admin"));
  chk("ولا قائد القسم ولا العضو", !canIssueCertificates("department_admin") && !canIssueCertificates("member") && !canIssueCertificates(undefined));

  const due = await mkMember({ decidedDaysAgo: 120 });
  const early = await mkMember({ decidedDaysAgo: 30 });
  const lead = await mkMember({ role: "department_admin", decidedDaysAgo: 120 });
  const closing = await mkMember({ decidedDaysAgo: 60, stepDown: true });
  const shortStay = await mkMember({ decidedDaysAgo: 5, stepDown: true });
  const by = { name: "مسؤول التشغيل (فحص)" };

  // ٢ — الحالات قبل الإصدار
  const st = async (id: string) => appreciationState(await prisma.member.findUniqueOrThrow({ where: { id } }));
  chk("من أكمل ثلاثة أشهر: مستحقّة الآن", (await st(due.id)).kind === "due");
  chk("ومن لم يُكملها: موعدها قادم", (await st(early.id)).kind === "upcoming");

  // ٣ — في موعدها
  const r1 = await issueAppreciation(due.id, by);
  const d1 = await prisma.member.findUniqueOrThrow({ where: { id: due.id } });
  chk("صدرت في موعدها (خُتمت)", d1.appreciationIssuedAt !== null, JSON.stringify(r1));
  chk("وتاريخ استحقاقها ذكرى الثلاثة أشهر", d1.appreciationDueAt?.getTime() === anniversaryDate(d1.decidedAt!, 3).getTime());
  const r1b = await issueAppreciation(due.id, by);
  const d1b = await prisma.member.findUniqueOrThrow({ where: { id: due.id } });
  chk("والضغطةُ الثانية لا تُصدر شهادةً ثانية", d1b.appreciationIssuedAt?.getTime() === d1.appreciationIssuedAt?.getTime(), JSON.stringify(r1b));
  const c1 = await certificateFor(due.id, "appreciation");
  chk("شهادةُ الموعد تقول «ثلاثة أشهر»", !!c1 && appreciationFullTerm(c1.period) && certificateHeading("appreciation", appreciationFullTerm(c1.period)).ar.includes("ثلاثة أشهر") && certificateBody(c1).includes("ثلاثة أشهر"));

  // ٤ — المبكرة: لا تصدر إلا بقرارٍ مكتوب
  const r2a = await issueAppreciation(early.id, by);
  chk("المبكرةُ بلا قرارٍ تُرفض", r2a.ok === false && r2a.reason.includes("لم يُكمل"), JSON.stringify(r2a));
  const r2b = await issueAppreciation(early.id, { ...by, earlyReason: "قر" });
  chk("وبقرارٍ أقصر من الحدّ تُرفض", r2b.ok === false, JSON.stringify(r2b));
  chk("ولم تُختم بعد الرفض", (await prisma.member.findUniqueOrThrow({ where: { id: early.id } })).appreciationIssuedAt === null);
  const r2c = await issueAppreciation(early.id, { ...by, earlyReason: "تكريمٌ مبكر على إنجاز حملة الإطلاق" });
  const e2 = await prisma.member.findUniqueOrThrow({ where: { id: early.id } });
  chk("وبقرارٍ مكتوب تصدر", e2.appreciationIssuedAt !== null, JSON.stringify(r2c));
  chk("ومدّتُها تُختم بيوم إصدارها لا بموعدٍ لم يأتِ", e2.appreciationDueAt?.getTime() === e2.appreciationIssuedAt?.getTime());
  const c2 = await certificateFor(early.id, "appreciation");
  chk(
    "والشهادةُ المبكرة لا تقول «ثلاثة أشهر»",
    !!c2 && !appreciationFullTerm(c2.period) && certificateHeading("appreciation", false).ar === "شهادة تقدير" && !certificateBody(c2).includes("ثلاثة أشهر"),
    c2 ? certificateBody(c2) : "لا شهادة"
  );
  // الكنسُ يوم استحقاقها لا يُصدر ثانية (يُعيد البريد فقط إن لم يصل)
  await sweepThreeMonthAppreciation();
  chk("والكنسُ اليومي لا يختم ثانيةً", (await prisma.member.findUniqueOrThrow({ where: { id: early.id } })).appreciationIssuedAt?.getTime() === e2.appreciationIssuedAt?.getTime());

  // ٥ — صفُّ القيادة لا يُكرَّم بشهادة الأعضاء
  const r3 = await issueAppreciation(lead.id, { ...by, earlyReason: "قرارٌ إداريٌّ للفحص" });
  chk("لا شهادةَ تقدير لصفِّ قيادة", r3.ok === false && r3.reason.includes("للأعضاء"), JSON.stringify(r3));

  // ٦ — الختام وحوكمة الأسبوعين
  const fs = async (id: string) => finalState(await prisma.member.findUniqueOrThrow({ where: { id } }));
  chk("الختامُ بعد شهرين: جاهزة", (await fs(closing.id)).kind === "ready");
  chk("والختامُ بعد خمسة أيام: لا تصدر", (await fs(shortStay.id)).kind === "ineligible");
  await markCertificateShared(closing.id, by.name);
  const f1 = await fs(closing.id);
  chk("أُصدرت شهادة الختام", f1.kind === "sent" || f1.kind === "undelivered", f1.kind);
  const r4 = await markCertificateShared(shortStay.id, by.name);
  chk("وحوكمةُ الأسبوعين تمنع الأخرى", r4.ok === false && (await prisma.member.findUniqueOrThrow({ where: { id: shortStay.id } })).certificateIssuedAt === null);

  // ٧ — ما تعرضه الصفحة
  const desk = await loadCertificateDesk(TAG.slice(-5));
  const ids = new Set(desk.appreciation.map((r) => r.id));
  chk("تبويب الشهادات يعرض الأعضاء", ids.has(due.id) && ids.has(early.id));
  chk("ولا يعرض صفَّ القيادة في التقدير", !ids.has(lead.id));
  chk("وختامُ التجربة في قسمه", desk.final.some((r) => r.id === closing.id) && desk.final.some((r) => r.id === shortStay.id));
  chk("وما يحتاج يداً الآن أولاً", desk.appreciation[0]?.state.kind === "undelivered" || desk.appreciation[0]?.state.kind === "due");

  // ٨ — عبر HTTP بدخولٍ حقيقي (إن كان الخادم يعمل)
  const up = await fetch(`${BASE}/login`).then((r) => r.ok).catch(() => false);
  if (up) {
    const hash = await hashPassword(PASS);
    const ops = await prisma.user.create({ data: { fullName: "مسؤول تشغيل (فحص)", email: `${TAG}-ops@example.test`, passwordHash: hash, role: "operations_officer", isActive: true } });
    const dl = await prisma.user.create({ data: { fullName: "قائد قسم (فحص)", email: `${TAG}-dl@example.test`, passwordHash: hash, role: "department_admin", departmentId: dept.id, isActive: true } });
    const opsCookie = await signIn(ops.email);
    const page = (await (await fetch(`${BASE}/admin/welcome-cards?tab=certificates&q=${encodeURIComponent(TAG.slice(-5))}`, { headers: { cookie: opsCookie } })).text()).replaceAll("<!-- -->", "");
    chk("مسؤول التشغيل يرى «الترحيب والتكريم» وتبويب الشهادات", page.includes("الترحيب والتكريم") && page.includes("شهادة التقدير — ثلاثة أشهر") && page.includes("شهادة الشكر والخبرة — ختام التجربة"));
    chk("ويرى زرّ الإصدار المبكر لمن لم يحن موعده", page.includes("إصدار مبكر") || page.includes("عرض الشهادة"));
    const home = (await (await fetch(`${BASE}/admin`, { headers: { cookie: opsCookie } })).text());
    chk("والقائمة باسمها الجديد", home.includes("الترحيب والتكريم") && !home.includes(">بطاقات الانضمام<"));
    const dlCookie = await signIn(dl.email);
    const dlRes = await fetch(`${BASE}/admin/welcome-cards?tab=certificates`, { headers: { cookie: dlCookie }, redirect: "manual" });
    const dlHtml = dlRes.status === 200 ? await dlRes.text() : "";
    chk("وقائد القسم لا يصل الصفحة", dlRes.status !== 200 || !dlHtml.includes("شهادة التقدير — ثلاثة أشهر"), `status ${dlRes.status}`);
  } else {
    checks.push("… الخادمُ لا يعمل على " + BASE + " — تُرك فحصُ HTTP");
  }

  await cleanup();
  console.log(checks.join("\n"));
  const failed = checks.filter((c) => c.startsWith("✗")).length;
  console.log(failed ? `\n✗ ${failed} فشل` : `\nALL PASS (${checks.filter((c) => c.startsWith("✓")).length})`);
  process.exit(failed ? 1 : 0);
})().catch(async (e) => {
  console.error(e);
  await cleanup().catch(() => {});
  process.exit(1);
});
