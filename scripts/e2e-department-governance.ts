import { prisma } from "@/lib/prisma";
import {
  createDepartment,
  decideDepartmentRequest,
  deleteDepartment,
  deleteBlockers,
  pendingDepartmentRequests,
} from "@/lib/departments";
import { decideCommittee, pendingCommittees } from "@/lib/committees";
import { createCandidateAccount } from "@/lib/workflow";
import { seniorDepartment } from "@/lib/seniorAffiliation";
import type { Session } from "next-auth";

/** حوكمةُ الأقسام — على أقسامٍ تُنشأ وتُحذف في القاعدة المحلية وحدها.
 *
 *  ١. طلبُ التنفيذي لا يُبنى: يُكتب «بانتظار الاعتماد» ولا يُدعى إليه أحد.
 *  ٢. اعتمادُه للمؤسس وحده — لا من باب اللجان ولا بيد التنفيذي.
 *  ٣. لا يُحذف قسمٌ فيه أحد، ولا الإدارةُ العليا. */

if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "")) {
  console.error("يُشغَّل على القاعدة المحلية وحدها");
  process.exit(1);
}

const asRole = (id: string, role: string, name = "فحص"): Session =>
  ({ user: { id, role, name, email: "probe@example.test" },
     expires: new Date(Date.now() + 3600_000).toISOString() } as unknown as Session);

const checks: string[] = [];
const chk = (n: string, ok: boolean, extra = "") =>
  checks.push(`${ok ? "✓" : "✗ FAIL"} ${n}${extra ? " — " + extra : ""}`);

const MARK = `e2e-dg-${Date.now()}`;
const NAMES = [`طلب ${MARK}`, `مردود ${MARK}`, `مؤسس ${MARK}`, `إدارة عليا ${MARK}`];

async function cleanup() {
  // لو مرّت الدعوةُ خطأً فلا يبقى أثرُها
  await prisma.member.deleteMany({ where: { email: `invite-${MARK}@example.test` } });
  await prisma.invite.deleteMany({ where: { email: `invite-${MARK}@example.test` } });
  const rows = await prisma.department.findMany({
    // department-scope: all — أقسامُ هذا الفحص وحدها، بأسمائها
    where: { name: { in: NAMES } },
    select: { id: true },
  });
  const ids = rows.map((r) => r.id);
  await prisma.testTrack.deleteMany({ where: { departmentId: { in: ids } } });
  await prisma.department.deleteMany({ where: { id: { in: ids } } });
}

(async () => {
  const founder = await prisma.user.findFirstOrThrow({ where: { role: "super_admin", isActive: true } });
  const exec = await prisma.user.findFirstOrThrow({ where: { role: "executive", isActive: true } });
  const F = asRole(founder.id, "super_admin", "المؤسس");
  const X = asRole(exec.id, "executive", "التنفيذي");

  // ١ — الطلب
  const req = await createDepartment({
    name: NAMES[0],
    colorHex: "#1F6F8B",
    createdByName: "التنفيذي",
    request: { byId: exec.id, byName: "التنفيذي" },
  });
  chk("طلبُ التنفيذي يُكتب بانتظار الاعتماد", req.committeeStatus === "pending_review" && req.parentId === null);
  chk("ولا بنكَ أسئلةٍ قبل الاعتماد", (await prisma.testTrack.count({ where: { departmentId: req.id } })) === 0);
  chk("ويظهر في طابور المؤسس", (await pendingDepartmentRequests()).some((d) => d.id === req.id));
  chk("ولا يظهر في طابور اللجان", !(await pendingCommittees()).some((d) => d.id === req.id));

  const track = await prisma.testTrack.findFirst({ where: { scope: "department_admin" }, select: { id: true } });
  let inviteRefused = false;
  try {
    await createCandidateAccount({
      fullName: "مدعوّ فحص",
      email: `invite-${MARK}@example.test`,
      targetRole: "department_admin",
      departmentId: req.id,
      testTrackId: track?.id ?? "none",
      invitedById: exec.id,
    });
  } catch (e) {
    inviteRefused = /لم يُعتمد/.test(String(e));
  }
  chk("ولا يُدعى إليه أحدٌ قبل اعتماده — ولو تجاوز القائمة", inviteRefused);

  // ٢ — القرار
  const viaCommittee = await decideCommittee({ committeeId: req.id, decision: "approved", session: X });
  chk("التنفيذي لا يعتمده من باب اللجان", !viaCommittee.ok);
  const byExec = await decideDepartmentRequest({ departmentId: req.id, decision: "approved", session: X });
  chk("ولا يعتمده التنفيذي من بابه", !byExec.ok);
  const noReason = await decideDepartmentRequest({ departmentId: req.id, decision: "rejected", note: " ", session: F });
  chk("والردُّ لا يقع بلا سبب", !noReason.ok);
  const approved = await decideDepartmentRequest({ departmentId: req.id, decision: "approved", session: F });
  const after = await prisma.department.findUniqueOrThrow({ where: { id: req.id } });
  chk("المؤسس يعتمده فيُبنى قسماً أصيلاً", approved.ok && after.committeeStatus === null && after.decidedByName === "المؤسس");
  chk("ويُنشأ بنكُ أسئلته عند الاعتماد", (await prisma.testTrack.count({ where: { departmentId: req.id } })) === 1);
  const twice = await decideDepartmentRequest({ departmentId: req.id, decision: "rejected", note: "متأخّر", session: F });
  chk("ولا يُنقَض القرار بضغطةٍ متأخّرة", !twice.ok);

  const rej = await createDepartment({
    name: NAMES[1],
    colorHex: "#7A4EAB",
    createdByName: "التنفيذي",
    request: { byId: exec.id, byName: "التنفيذي" },
  });
  const rejected = await decideDepartmentRequest({ departmentId: rej.id, decision: "rejected", note: "يدخل في قسمٍ قائم", session: F });
  const rejRow = await prisma.department.findUniqueOrThrow({ where: { id: rej.id } });
  chk("والردُّ يبقى مكتوباً بسببه", rejected.ok && rejRow.committeeStatus === "rejected" && rejRow.decisionNote === "يدخل في قسمٍ قائم");

  const direct = await createDepartment({ name: NAMES[2], colorHex: "#3F7D20", createdByName: "المؤسس" });
  chk("وما يُنشئه المؤسس يُبنى مباشرةً", direct.committeeStatus === null);

  // ٣ — الحذف
  // قاعدةٌ محليةٌ بلا قسم إدارةٍ عليا: يُنشأ مؤقتاً كما في فحص الهيكل (`e2e-org-chart`)
  // ويُحذف في التنظيف باسمه — فيُفحص الحرسُ نفسه لا غيابُ البيانات
  const senior =
    (await seniorDepartment()) ??
    (await prisma.department.create({
      data: { name: NAMES[3], slug: `senior-dg-${Date.now()}`, colorHex: "#1A0E1C", leadershipOnly: true },
      select: { id: true, name: true },
    }));
  const s = await deleteDepartment({ departmentId: senior.id, confirmName: senior.name, actorRole: "super_admin", actorName: "المؤسس" });
  chk("الإدارة العليا لا تُحذف", !s.ok && /الإدارة العليا/.test((s as { reason: string }).reason));
  const busy = await prisma.department.findFirst({
    where: { parentId: null, admins: { some: {} } },
    select: { id: true, name: true },
  });
  if (busy) {
    const b = await deleteDepartment({ departmentId: busy.id, confirmName: busy.name, actorRole: "super_admin", actorName: "المؤسس" });
    chk(`قسمٌ فيه قائد لا يُحذف (${busy.name})`, !b.ok);
  }
  chk("واللجنةُ وحدها تمنع الحذف", deleteBlockers({ admins: 0, members: 0, invites: 0, tickets: 0, requests: 0, signatures: 0, committees: 1 }).length === 1);
  const emptyByExec = await deleteDepartment({ departmentId: direct.id, confirmName: direct.name, actorRole: "executive", actorName: "التنفيذي" });
  chk("التنفيذي لا يحذف", !emptyByExec.ok);
  const empty = await deleteDepartment({ departmentId: direct.id, confirmName: direct.name, actorRole: "super_admin", actorName: "المؤسس" });
  chk("والقسمُ الفارغ تماماً يحذفه المؤسس", empty.ok);

  await cleanup();
  console.log(checks.join("\n"));
  const failed = checks.some((c) => c.startsWith("✗"));
  console.log("\n" + (failed ? "FAILURES PRESENT" : "ALL PASS"));
  process.exit(failed ? 1 : 0);
})().catch(async (e) => { console.error(e); await cleanup(); process.exit(1); });
