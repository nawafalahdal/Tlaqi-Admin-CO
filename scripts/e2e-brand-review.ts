import type { Session } from "next-auth";

/** **مركزُ مراجعة الهوية — سير الاعتماد وصلاحياته** (على نسخةٍ مؤقتة من القاعدة الاصطناعية):
 *    createdb -O tlaqi -T tlaqi_mk tlaqi_brand_e2e
 *    DATABASE_URL=…/tlaqi_brand_e2e npx tsx --tsconfig tsconfig.json scripts/e2e-brand-review.ts */
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "") || !/tlaqi_brand_e2e/.test(process.env.DATABASE_URL ?? "")) {
  console.error("يُشغَّل على النسخة المؤقتة tlaqi_brand_e2e وحدها");
  process.exit(1);
}
if (process.env.VERCEL || process.env.RESEND_API_KEY) {
  console.error("فحصٌ محليٌّ فقط والبريد معطّل");
  process.exit(1);
}

const checks: string[] = [];
const chk = (n: string, ok: boolean, extra = "") => checks.push(`${ok ? "✓" : "✗ FAIL"} ${n}${!ok && extra ? " — " + extra : ""}`);

(async () => {
  const { prisma } = await import("@/lib/prisma");
  const R = await import("@/lib/brandReview");
  const REG = await import("@/lib/brandReview/registry");
  const TAG = `e2e-brand-${Date.now()}`;
  const sess = (u: { id: string; role: string; fullName: string }) => ({ user: { id: u.id, role: u.role, name: u.fullName, email: `${u.id}@x` } } as unknown as Session);

  const founder = await prisma.user.findFirstOrThrow({ where: { role: "super_admin", isActive: true } });
  await prisma.user.updateMany({ where: { role: "executive", isActive: true }, data: { isActive: false } });
  const ceo = await prisma.user.create({ data: { fullName: `رئيس ${TAG}`, email: `${TAG}-ceo@example.test`, passwordHash: "!", role: "executive", isActive: true } });
  const deptLead = await prisma.user.findFirst({ where: { role: "department_admin", isActive: true } });

  const fCtx = await R.brandContext(sess(founder));
  const cCtx = await R.brandContext(sess(ceo));
  chk("المؤسس: يعتمد ويُعدّ؛ الرئيس التنفيذي: يُعدّ ولا يعتمد", fCtx.canApprove && fCtx.canPrepare && cCtx.canPrepare && !cCtx.canApprove);
  if (deptLead) {
    const dCtx = await R.brandContext(sess(deptLead));
    chk("قائدُ القسم بلا تكليف «إعداد الهوية»: لا يدخل المركز", !dCtx.canView && !dCtx.canPrepare && !dCtx.canApprove);
  }

  const v = await R.ensureBrandVersion(cCtx);
  const items = await prisma.brandItem.findMany({ where: { versionId: v!.id } });
  chk("الإصدارُ يُنشأ مسودّةً بكل عناصر السجل", v?.status === "draft" && items.length === REG.BRAND_ITEMS.length && items.every((i) => i.status === "draft"), `${items.length}/${REG.BRAND_ITEMS.length}`);
  const again = await R.ensureBrandVersion(fCtx);
  chk("وتكرارُ الفتح لا يكرّر الإصدار ولا العناصر", again?.id === v!.id && (await prisma.brandItem.count({ where: { versionId: v!.id } })) === items.length);

  // معاينةُ بريدٍ بالدالة الحقيقية — بلا إرسالٍ ولا سجل
  const logsBefore = await prisma.emailLog?.count?.().catch(() => null);
  const ep = await REG.emailPreview(REG.itemDef("email.login-code")!, "/brand-review/asset", null);
  chk("معاينةُ البريد تبني الرسالة بدالتها الحقيقية (رمز الدخول ظاهر) بالقالبين", !!ep && ep.next.includes("482913") && ep.current.includes("482913") && ep.next.includes("#341D2B"));
  chk("والقالبُ الجديد بالألوان الأربعة وحدها (لا أبيض ولا رمادي ولا شفافية)", !!ep && !/#fff(fff)?\b|#ffffff|rgba\(|#[0-9a-f]{6}/i.test(ep.next.replace(/#(EEF6DF|341D2B|C34900|67C090)/gi, "")));
  const logsAfter = await prisma.emailLog?.count?.().catch(() => null);
  chk("والمعاينةُ لا تُسجَّل بريداً مرسلاً", logsBefore === logsAfter);

  const logo = items.find((i) => i.key === "identity.logo")!;
  const tr = (ctx: typeof fCtx, a: Parameters<typeof R.transitionItem>[2], note?: string) => R.transitionItem(ctx, logo.id, a, note);

  const earlyApprove = await tr(fCtx, "approve");
  chk("لا يُعتمد عنصرٌ لم يُرسَل للمراجعة", !earlyApprove.ok);
  chk("المُعِدّ يرسل للمراجعة", (await tr(cCtx, "submit")).ok);
  const ceoApprove = await tr(cCtx, "approve");
  chk("الرئيسُ التنفيذي لا يعتمد — والمحاولةُ مسجَّلةٌ «مرفوضة»", !ceoApprove.ok && (await prisma.orgAuditEvent.count({ where: { action: "brand.approve", result: "denied", actorId: ceo.id } })) === 1);
  chk("المؤسسُ يبدأ المراجعة", (await tr(fCtx, "start_review")).ok);
  chk("وطلبُ التعديل بلا ملاحظات يُرفض", !(await tr(fCtx, "request_changes", "")).ok);
  chk("وطلبُ التعديل بملاحظات", (await tr(fCtx, "request_changes", "كبّر العلامة على الجوال")).ok);
  chk("المُعِدّ يعيد الإعداد بوصف ما عُدّل — فتزيد المراجعة", (await tr(cCtx, "revise", "كُبّرت العلامة")).ok && (await prisma.brandItem.findUniqueOrThrow({ where: { id: logo.id } })).revision === 2);
  await tr(cCtx, "submit");
  chk("المؤسسُ يعتمد — بمن ومتى ورقم المراجعة والبصمة", (await tr(fCtx, "approve")).ok);
  const approved = await prisma.brandItem.findUniqueOrThrow({ where: { id: logo.id } });
  chk("وتُحفظ بيانات الاعتماد", approved.status === "approved" && approved.approvedByName === founder.fullName && approved.approvedRevision === 2 && !!approved.approvedHash && !!approved.approvedAt);
  const pub = await tr(fCtx, "publish");
  chk("ولا يُنشر عنصرٌ لم يُطبَّق في المنصة بعد", !pub.ok && /لم يُطبَّق/.test(pub.ok ? "" : pub.reason), pub.ok ? "" : pub.reason);
  await prisma.brandItem.update({ where: { id: logo.id }, data: { approvedHash: "0".repeat(64) } });
  const pub2 = await tr(fCtx, "publish");
  chk("ولا يُنشر ما تغيّرت بصمتُه بعد الاعتماد", !pub2.ok && /تغيّر العنصرُ بعد اعتماده/.test(pub2.ok ? "" : pub2.reason));
  const cPub = await tr(cCtx, "publish");
  chk("والنشرُ للمؤسس وحده", !cPub.ok);
  const race = await Promise.all([R.transitionItem(fCtx, items[1].id, "submit"), R.transitionItem(cCtx, items[1].id, "submit")]);
  chk("قراران متزامنان على العنصر نفسه: يقع واحدٌ وحده", race.filter((r) => r.ok).length === 1);
  chk("الملاحظاتُ تُضاف ولا تغيّر الحالة", (await R.commentItem(fCtx, logo.id, "ملاحظة عامة")).ok && (await prisma.brandItem.findUniqueOrThrow({ where: { id: logo.id } })).status === "approved");
  const evs = await prisma.brandReviewEvent.findMany({ where: { itemId: logo.id }, orderBy: { createdAt: "asc" } });
  chk("السجلُّ يحفظ كل خطوة بمن نفّذها ورقم مراجعتها", ["item.create", "submit", "start_review", "request_changes", "revise", "submit", "approve", "comment"].every((a) => evs.some((e) => e.action === a)) && evs.every((e) => !!e.actorName));
  const upd = await prisma.brandReviewEvent.update({ where: { id: evs[0].id }, data: { note: "عبث" } }).then(() => "ok").catch((e) => String(e));
  const del = await prisma.brandItem.delete({ where: { id: logo.id } }).then(() => "ok").catch((e) => String(e));
  chk("سجلُّ المراجعة لا يُعدَّل، والعنصرُ لا يُحذف (في القاعدة)", upd.includes("APPEND_ONLY") && del.includes("BRAND_ITEM_KEPT"));
  const act = await R.activateVersion(fCtx, v!.id);
  chk("ولا تُفعَّل الهويةُ قبل نشر كل عناصرها", !act.ok);
  const cAct = await R.activateVersion(cCtx, v!.id);
  chk("والتفعيلُ للمؤسس وحده", !cAct.ok);
  const v2 = await prisma.brandVersion.create({ data: { version: 99, name: "اختبار", createdByName: "فحص", status: "active" } });
  const second = await prisma.brandVersion.create({ data: { version: 98, name: "اختبار٢", createdByName: "فحص", status: "active" } }).then(() => "ok").catch((e) => String(e));
  const back = await prisma.brandVersion.update({ where: { id: v2.id }, data: { status: "draft" } }).then(() => "ok").catch((e) => String(e));
  chk("إصدارٌ سارٍ واحد، والسارى لا يعود مسودّة (قيودٌ في القاعدة)", second.includes("BRAND_ACTIVE_EXISTS") && back.includes("BRAND_VERSION_FLOW"));

  console.log(checks.join("\n"));
  const failed = checks.filter((x) => x.startsWith("✗")).length;
  console.log(`\n${checks.length - failed}/${checks.length} ✓${failed ? ` — ${failed} فشل` : ""}`);
  await prisma.$disconnect();
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.log(checks.join("\n"));
  console.error(e);
  process.exit(1);
});
