import type { Session } from "next-auth";

/** **اتفاقياتُ السرية — السيناريوهاتُ الأربعة عشر** (على نسخةٍ مؤقتة من القاعدة الاصطناعية؛ الخادمُ لا الواجهة):
 *    createdb -O tlaqi -T tlaqi_mk tlaqi_agr_e2e
 *    DATABASE_URL=…/tlaqi_agr_e2e npx tsx --tsconfig tsconfig.json scripts/e2e-agreements.ts
 *
 *   1  عضو تسويق جديد لم يوقّع         8  طلب إعادة التوقيع
 *   2  عضو تسويق وقّع                  9  إلغاء عضوية شخصٍ موقّع
 *   3  عضو تقني لم يوقّع               10 سحب صلاحيات شخصٍ موقّع
 *   4  عضو تقني وقّع                   11 محاولة تعديل سجل التوقيع
 *   5  الوصول إلى مستودعٍ تقني قبل التوقيع  12 محاولة حذف الاتفاقية الموقّعة
 *   6  الوصول إلى حسابٍ تسويقي قبل التوقيع 13 عرض النسخة التي وافق عليها العضو
 *   7  إصدار اتفاقيةٍ جديدة               14 التحقق من سجل التوقيع وبصمة الوثيقة */
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "") || !/tlaqi_agr_e2e/.test(process.env.DATABASE_URL ?? "")) {
  console.error("يُشغَّل على النسخة المؤقتة tlaqi_agr_e2e وحدها");
  process.exit(1);
}
if (process.env.VERCEL || process.env.RESEND_API_KEY) {
  console.error("فحصٌ محليٌّ فقط والبريد معطّل");
  process.exit(1);
}

const checks: string[] = [];
let scenario = "";
const chk = (n: string, ok: boolean, extra = "") => checks.push(`${ok ? "✓" : "✗ FAIL"} [${scenario}] ${n}${!ok && extra ? " — " + extra : ""}`);

// رموزُ التوقيع تُطبع محلياً حين يتعذّر البريد — نلتقطها
const codes = new Map<string, string>();
const warn = console.warn;
console.warn = (...a: unknown[]) => {
  const m = String(a[0] ?? "").match(/رمز توقيع الاتفاقية (\S+): (\d{6})/);
  if (m) codes.set(m[1], m[2]);
  else if (!String(a[0] ?? "").startsWith("[email") && !String(a[0] ?? "").startsWith("[google-sheets")) warn(...a);
};

(async () => {
  const { prisma } = await import("@/lib/prisma");
  const AG = await import("@/lib/governance/agreements");
  const { DEFAULT_AGREEMENTS, clauseCount } = await import("@/lib/governance/agreementTexts");
  const { marketingActor, canEnterMarketing, hasCapability } = await import("@/lib/marketing/access");
  const { terminateMembership, suspendMember } = await import("@/lib/org/membership");

  const TAG = `e2e-agr-${Date.now()}`;
  const sess = (u: { id: string; role: string; fullName: string; email: string }) => ({ user: { id: u.id, role: u.role, name: u.fullName, email: u.email } } as unknown as Session);
  const founder = await prisma.user.findFirstOrThrow({ where: { role: "super_admin", isActive: true }, orderBy: { createdAt: "asc" } });
  await prisma.user.updateMany({ where: { role: "executive", isActive: true }, data: { isActive: false } });
  const ceo = await prisma.user.create({ data: { fullName: `رئيس ${TAG}`, email: `${TAG}-ceo@example.test`, passwordHash: "!", role: "executive", isActive: true } });
  const track = await prisma.testTrack.findFirstOrThrow({ where: { scope: "department_member" } });
  const mkt = await prisma.department.findFirstOrThrow({ where: { slug: "marketing" } });
  const tech = await prisma.department.findFirst({ where: { slug: { in: ["tech", "technical"] } } }) ?? (await prisma.department.findFirstOrThrow({ where: { parentId: null, leadershipOnly: false, id: { not: mkt.id } } }));
  let n = 0;
  const mkMember = async (departmentId: string, name: string) => {
    const email = `${TAG}-m${++n}@example.test`;
    const inv = await prisma.invite.create({ data: { fullName: name, email, targetRole: "member", departmentId, testTrackId: track.id, invitedById: founder.id, status: "used" } });
    return prisma.member.create({ data: { fullName: name, email, departmentId, inviteId: inv.id, passwordHash: "!", approvalStatus: "approved", decidedAt: new Date(), isActive: true } });
  };
  const ctxOf = async (u: { id: string; role: string; fullName: string; email: string }) => AG.agreementContext(sess(u));
  const asMember = (m: { id: string; fullName: string; email: string }) => ({ id: m.id, role: "member", fullName: m.fullName, email: m.email });
  const sign = async (m: { id: string; fullName: string; email: string }, kind: "marketing" | "technical", typedName?: string) => {
    const ctx = await ctxOf(asMember(m));
    const otp = await AG.requestSigningOtp(ctx, kind);
    const t = (await AG.activeTemplate(kind))!;
    const code = codes.get(m.email.toLowerCase()) ?? codes.get(m.email) ?? "";
    return { otp, res: await AG.signAgreement(ctx, { kind, templateId: t.id, documentHash: t.bodyHash, typedName: typedName ?? m.fullName, otp: code, readAll: true, consent: true, userAgent: "e2e" }), code };
  };

  const fCtx = await ctxOf({ id: founder.id, role: "super_admin", fullName: founder.fullName, email: founder.email });
  chk("النصّان المقترحان: 12 بنداً للتسويق و18 للتقنية، ومعلَّمان للمراجعة القانونية", clauseCount(DEFAULT_AGREEMENTS.marketing.body) === 12 && clauseCount(DEFAULT_AGREEMENTS.technical.body) === 18 && DEFAULT_AGREEMENTS.technical.body.includes("لا تتضمن أي شرط لعدم المنافسة"));
  scenario = "تهيئة";
  for (const k of ["marketing", "technical"] as const) {
    const d = await AG.createDraftTemplate(fCtx, { kind: k, titleAr: DEFAULT_AGREEMENTS[k].titleAr, body: DEFAULT_AGREEMENTS[k].body });
    const p = d.ok ? await AG.publishTemplate(fCtx, d.id, "الإصدار الأول") : d;
    chk(`نشرُ الإصدار الأول (${k})`, p.ok, p.ok ? "" : p.reason);
  }
  const otherCtx = await ctxOf({ id: ceo.id, role: "executive", fullName: ceo.fullName, email: ceo.email });
  chk("الرئيسُ التنفيذي (جهةٌ مُصدِرة) لا يوقّع بصفة مستلم", !(await AG.requestSigningOtp(otherCtx, "marketing")).ok);

  // ══ ١) عضو تسويق جديد لم يوقّع ══
  scenario = "1";
  const mm = await mkMember(mkt.id, `عضوة تسويق ${TAG}`);
  await prisma.marketingMember.create({ data: { memberId: mm.id, capabilities: ["writer"], nameSnapshot: mm.fullName, addedByName: "فحص", active: true } });
  const mmSess = sess(asMember(mm));
  const a1 = await marketingActor(mmSess);
  chk("الوكيلُ مغلقٌ عليه: «لم يوقّع» يمنع الدخول والصلاحيات (في الخادم)", !!a1?.agreementPending && !canEnterMarketing(a1) && !hasCapability(a1, "writer"));
  chk("وحالتُه «لم تُرسل» قبل أي طلب", (await AG.statusOf({ kind: "member", id: mm.id }, "marketing")).status === "not_sent");

  // ══ ٦) الوصول إلى حسابٍ تسويقي قبل التوقيع ══
  scenario = "6";
  const g6 = await AG.grantAsset(fCtx, { category: "marketing", assetKey: "social_accounts", holder: { kind: "member", id: mm.id } });
  chk("منحُ حسابات التواصل قبل التوقيع يُرفض — ويُسجَّل «مرفوضاً»", !g6.ok && (await prisma.orgAuditEvent.count({ where: { action: "agreement.asset.grant", result: "denied", entityId: `member:${mm.id}` } })) === 1);

  // ══ ٢) عضو تسويق وقّع ══
  scenario = "2";
  const rq = await AG.requestSignature(fCtx, { kind: "member", id: mm.id }, "marketing", "عضو فريق التسويق");
  chk("طلبُ التوقيع: «بانتظار التوقيع»", rq.ok && (await AG.statusOf({ kind: "member", id: mm.id }, "marketing")).status === "pending");
  const wrongName = await sign(mm, "marketing", "اسمٌ آخر");
  chk("الاسمُ المكتوب المخالف لاسم الحساب يُرفض", !wrongName.res.ok);
  const mmCtx = await ctxOf(asMember(mm));
  const t1 = (await AG.activeTemplate("marketing"))!;
  await new Promise((r) => setTimeout(r, 0));
  await prisma.agreementOtp.updateMany({ where: { signerId: mm.id }, data: { createdAt: new Date(Date.now() - 120_000) } });
  await AG.requestSigningOtp(mmCtx, "marketing");
  const badOtp = await AG.signAgreement(mmCtx, { kind: "marketing", templateId: t1.id, documentHash: t1.bodyHash, typedName: mm.fullName, otp: "000000", readAll: true, consent: true });
  chk("والرمزُ الخاطئ يُرفض ويُحتسب محاولة", !badOtp.ok && ((await prisma.agreementOtp.findFirst({ where: { signerId: mm.id, usedAt: null } }))?.attempts ?? 0) === 1);
  const noRead = await AG.signAgreement(mmCtx, { kind: "marketing", templateId: t1.id, documentHash: t1.bodyHash, typedName: mm.fullName, otp: codes.get(mm.email) ?? "", readAll: false, consent: true });
  const noConsent = await AG.signAgreement(mmCtx, { kind: "marketing", templateId: t1.id, documentHash: t1.bodyHash, typedName: mm.fullName, otp: codes.get(mm.email) ?? "", readAll: true, consent: false });
  chk("ولا توقيعَ بلا تأكيد القراءة ولا بلا الموافقة الصريحة", !noRead.ok && !noConsent.ok);
  const s2 = await AG.signAgreement(mmCtx, { kind: "marketing", templateId: t1.id, documentHash: t1.bodyHash, typedName: `  ${mm.fullName} `, otp: codes.get(mm.email) ?? "", readAll: true, consent: true, userAgent: "e2e" });
  chk("التوقيعُ الصحيح يقع", s2.ok, s2.ok ? "" : s2.reason);
  const sig1 = s2.ok ? await prisma.agreementSignature.findUniqueOrThrow({ where: { id: s2.signatureId } }) : null;
  chk("ويوثّق الاسمَ الكامل والوقت والإصدار والصفة ووسيلة الإثبات", !!sig1 && sig1.typedName === mm.fullName && sig1.version === 1 && sig1.roleLabel.length > 0 && sig1.method === AG.SIGN_METHOD && !!sig1.otpVerifiedAt && !!sig1.signedAt);
  const a2 = await marketingActor(mmSess);
  chk("وتنفتح البوابة: يدخل الوكيلَ بصلاحياته", !!a2 && !a2.agreementPending && canEnterMarketing(a2) && hasCapability(a2, "writer"));
  const replay = await AG.signAgreement(mmCtx, { kind: "marketing", templateId: t1.id, documentHash: t1.bodyHash, typedName: mm.fullName, otp: codes.get(mm.email) ?? "", readAll: true, consent: true });
  chk("ولا يُعاد استعمالُ الرمز، ولا يوقَّع الإصدارُ نفسه مرّتين", !replay.ok);
  const g2 = await AG.grantAsset(fCtx, { category: "marketing", assetKey: "social_accounts", holder: { kind: "member", id: mm.id } });
  chk("وبعد التوقيع يُمنح الوصولُ إلى حسابات التواصل ويُسجَّل", g2.ok && (await prisma.orgAuditEvent.count({ where: { action: "agreement.asset.grant", result: "success" } })) >= 1);

  // ══ ٣ و٥) عضو تقني لم يوقّع — والوصول إلى المستودع قبل التوقيع ══
  scenario = "3·5";
  const tm = await mkMember(tech.id, `عضو تقني ${TAG}`);
  chk("العضو التقني بلا توقيع: «لم تُرسل»", (await AG.statusOf({ kind: "member", id: tm.id }, "technical")).status === "not_sent");
  const g5 = await AG.grantAsset(fCtx, { category: "technical", assetKey: "source_repository", holder: { kind: "member", id: tm.id } });
  chk("منحُ المستودع البرمجي قبل التوقيع يُرفض في الخادم ويُسجَّل", !g5.ok && /قبل التوقيع/.test(g5.ok ? "" : g5.reason) && (await prisma.orgAuditEvent.count({ where: { action: "agreement.asset.grant", result: "denied", entityId: `member:${tm.id}` } })) === 1);
  const nonManager = await AG.grantAsset(mmCtx, { category: "technical", assetKey: "source_repository", holder: { kind: "member", id: tm.id } });
  chk("ولا يمنح الوصولَ إلا من له إدارةُ الاتفاقيات", !nonManager.ok);

  // ══ ٤) عضو تقني وقّع ══
  scenario = "4";
  const s4 = await sign(tm, "technical");
  chk("يوقّع الاتفاقية التقنية", s4.res.ok, s4.res.ok ? "" : s4.res.reason);
  const g4 = await AG.grantAsset(fCtx, { category: "technical", assetKey: "source_repository", holder: { kind: "member", id: tm.id } });
  chk("ثم يُمنح المستودعُ البرمجي", g4.ok);

  // ══ ٧) إصدار اتفاقيةٍ جديدة ══
  scenario = "7";
  const d2 = await AG.createDraftTemplate(fCtx, { kind: "marketing", titleAr: DEFAULT_AGREEMENTS.marketing.titleAr, body: DEFAULT_AGREEMENTS.marketing.body + "\n\nتعديل: يشمل البند 2 حسابات المنصات الجديدة." });
  const p2 = d2.ok ? await AG.publishTemplate(fCtx, d2.id, "إضافة المنصات الجديدة") : d2;
  const v1 = await prisma.agreementTemplate.findUniqueOrThrow({ where: { id: t1.id } });
  chk("الإصدار الثاني سارٍ والأول متقاعدٌ محفوظ", p2.ok && v1.status === "retired" && (await AG.activeTemplate("marketing"))?.version === 2);
  chk("ومن وقّع الأول «يحتاج تحديثاً» — وتوقيعُه القديم باقٍ", (await AG.statusOf({ kind: "member", id: mm.id }, "marketing")).status === "needs_update" && (await prisma.agreementSignature.count({ where: { signerId: mm.id, version: 1 } })) === 1);
  chk("والبوابةُ تُغلق حتى يوقّع الجديد", !!(await marketingActor(mmSess))?.agreementPending);
  const edit = await prisma.agreementTemplate.update({ where: { id: t1.id }, data: { body: "عبث" } }).then(() => "ok").catch((e) => String(e));
  chk("ونصُّ الإصدار المنشور مجمَّد (قيدٌ في القاعدة)", edit.includes("AGREEMENT_FROZEN"));
  const twoActive = await prisma.agreementTemplate.update({ where: { id: t1.id }, data: { status: "active" } }).then(() => "ok").catch((e) => String(e));
  chk("ولا يعود متقاعدٌ سارياً ولا يجتمع إصداران ساريان", twoActive.includes("AGREEMENT_FROZEN") || twoActive.includes("AGREEMENT_ACTIVE_EXISTS"));

  // ══ ٨) طلب إعادة التوقيع ══
  scenario = "8";
  const r8 = await AG.requestSignature(fCtx, { kind: "member", id: mm.id }, "marketing", "صدر إصدارٌ جديد");
  chk("طلبُ إعادة التوقيع يُرسل ويُسجَّل بإجرائه", r8.ok && (await prisma.orgAuditEvent.count({ where: { action: "agreement.resign.request" } })) === 1);
  await prisma.agreementOtp.updateMany({ where: { signerId: mm.id }, data: { createdAt: new Date(Date.now() - 3_700_000) } });
  const s8 = await sign(mm, "marketing");
  chk("ويوقّع الإصدارَ الثاني فتنفتح البوابة", s8.res.ok && (await AG.statusOf({ kind: "member", id: mm.id }, "marketing")).status === "signed" && !(await marketingActor(mmSess))?.agreementPending, s8.res.ok ? "" : s8.res.reason);

  // ══ ١٠) سحب صلاحيات شخصٍ موقّع ══
  scenario = "10";
  const grant4 = await prisma.assetAccessGrant.findFirstOrThrow({ where: { holderId: tm.id, revokedAt: null } });
  const rv = await AG.revokeAsset(fCtx, grant4.id, "انتهاء التكليف بالمستودع");
  chk("سحبُ الوصول يقع ويُسجَّل بسببه — والتوقيعُ باقٍ", rv.ok && !!(await prisma.assetAccessGrant.findUniqueOrThrow({ where: { id: grant4.id } })).revokedAt && (await prisma.agreementSignature.count({ where: { signerId: tm.id } })) === 1);
  await AG.grantAsset(fCtx, { category: "technical", assetKey: "technical_docs", holder: { kind: "member", id: tm.id } });
  const sus = await suspendMember(founder.id, tm.id, "إيقافٌ مؤقت للفحص");
  chk("والإيقافُ المؤقت يسحب كلَّ وصولٍ ممنوح تلقائياً ويُسجَّل", sus.ok && (await prisma.assetAccessGrant.count({ where: { holderId: tm.id, revokedAt: null } })) === 0 && (await prisma.orgAuditEvent.count({ where: { action: "agreement.access.suspended", entityId: `member:${tm.id}` } })) === 1, sus.ok ? "" : sus.reason);

  // ══ ٩) إلغاء عضوية شخصٍ موقّع ══
  scenario = "9";
  const term = await terminateMembership(founder.id, mm.id, { reason: "انتهاء العضوية للفحص", confirm: true });
  const st9 = await AG.statusOf({ kind: "member", id: mm.id }, "marketing");
  chk("إنهاءُ العضوية: يُسحب الوصول، وتصير الاتفاقيةُ «منتهية»، وتبقى التوقيعات", term.ok && (await prisma.assetAccessGrant.count({ where: { holderId: mm.id, revokedAt: null } })) === 0 && st9.status === "ended" && (await prisma.agreementSignature.count({ where: { signerId: mm.id } })) === 2, term.ok ? JSON.stringify(st9) : term.reason);
  chk("ويُسجَّل الإنهاءُ في سجل الحوكمة", (await prisma.orgAuditEvent.count({ where: { action: "agreement.access.ended", entityId: `member:${mm.id}` } })) === 1);
  chk("ولا يدخل الوكيلَ بعد إنهاء عضويته", !canEnterMarketing(await marketingActor(mmSess)));

  // ══ ١١ و١٢) محاولة تعديل سجل التوقيع أو حذف الاتفاقية الموقّعة ══
  scenario = "11·12";
  const anySig = await prisma.agreementSignature.findFirstOrThrow({ where: { signerId: mm.id } });
  const upd = await prisma.agreementSignature.update({ where: { id: anySig.id }, data: { typedName: "مزوَّر" } }).then(() => "ok").catch((e) => String(e));
  chk("تعديلُ سجل التوقيع مرفوضٌ في القاعدة", upd.includes("APPEND_ONLY"));
  const del = await prisma.agreementSignature.delete({ where: { id: anySig.id } }).then(() => "ok").catch((e) => String(e));
  const delAll = await prisma.$executeRawUnsafe('TRUNCATE "AgreementSignature"').then(() => "ok").catch((e) => String(e));
  const delTpl = await prisma.agreementTemplate.delete({ where: { id: t1.id } }).then(() => "ok").catch((e) => String(e));
  chk("وحذفُ التوقيع أو تفريغُ الجدول أو حذفُ الإصدار الموقَّع مرفوض", del.includes("APPEND_ONLY") && delAll.includes("APPEND_ONLY") && (delTpl.includes("AGREEMENT_FROZEN") || delTpl.includes("Foreign key")));

  // ══ ١٣) عرض النسخة التي وافق عليها العضو ══
  scenario = "13";
  // موقِّعٌ نشط (العضو التقني السابق موقوفٌ — والموقوفُ لا يدخل شيئاً، وهذا صحيح)
  const tm2 = await mkMember(tech.id, `عضوة تقنية ${TAG}`);
  const s13 = await sign(tm2, "technical");
  const sigId = s13.res.ok ? s13.res.signatureId : "";
  const ownCopy = await AG.signedCopyAccess(await ctxOf(asMember(tm2)), sigId);
  const strangerCopy = await AG.signedCopyAccess(await ctxOf(asMember(await mkMember(tech.id, `غريب ${TAG}`))), sigId);
  const adminCopy = await AG.signedCopyAccess(fCtx, sigId);
  const suspendedCopy = await AG.signedCopyAccess(await ctxOf(asMember(tm)), s4.res.ok ? s4.res.signatureId : "");
  chk("صاحبُ التوقيع يرى نسخته، والإدارةُ تراها، وغيرُهما لا (ولا الموقوفُ حسابُه)", !!ownCopy && !!adminCopy && strangerCopy === null && suspendedCopy === null);
  const html = ownCopy ? AG.signedCopyHtml(ownCopy) : "";
  chk("والنسخةُ هي النصُّ الموقَّع بإصداره واسمه ووقته وبصمته", html.includes("البند 18") && html.includes(tm2.fullName) && html.includes(ownCopy?.signature.documentHash ?? "∅") && html.includes("الإصدار 1"));
  const xss = ownCopy ? AG.signedCopyHtml({ ...ownCopy, signature: { ...ownCopy.signature, typedName: '<script>alert(1)</script>' } }) : "<script>alert";
  chk("وكلُّ حقلٍ مُهرَّب في النسخة (لا حقن)", !xss.includes("<script>alert") && xss.includes("&lt;script&gt;"));

  // ══ ١٤) التحقق من سجل التوقيع وبصمة الوثيقة ══
  scenario = "14";
  const all = await prisma.agreementSignature.findMany({ orderBy: [{ signedAt: "asc" }, { id: "asc" }] });
  const verified = await Promise.all(all.map((s) => AG.verifySignature(s.id)));
  chk(`كلُّ التوقيعات (${all.length}) سليمة: بصمةُ الوثيقة، وبصمةُ الدليل، والسلسلة`, verified.every((v) => v?.valid), JSON.stringify(verified.map((v) => [v?.documentOk, v?.evidenceOk, v?.chainOk])));
  chk("والسلسلةُ موصولة: كلُّ توقيعٍ يحمل بصمةَ ما قبله", all.every((s, i) => (i === 0 ? s.prevEvidenceHash === null : s.prevEvidenceHash === all[i - 1].evidenceHash)));
  // عبثٌ مباشر في القاعدة (بتعطيل الحارس على هذه النسخة المؤقتة وحدها) — يكشفه التحقق
  const target = all[all.length - 1];
  await prisma.$executeRawUnsafe('ALTER TABLE "AgreementSignature" DISABLE TRIGGER "AgreementSignature_append_only"');
  await prisma.$executeRawUnsafe(`UPDATE "AgreementSignature" SET "typedName" = 'مزوَّر' WHERE "id" = '${target.id}'`);
  const tampered = await AG.verifySignature(target.id);
  await prisma.$executeRawUnsafe(`UPDATE "AgreementSignature" SET "typedName" = $1 WHERE "id" = $2`, target.typedName, target.id);
  await prisma.$executeRawUnsafe('ALTER TABLE "AgreementSignature" ENABLE TRIGGER "AgreementSignature_append_only"');
  chk("والعبثُ بحقلٍ واحد يكسر بصمةَ الدليل فيُكشف", tampered?.evidenceOk === false && tampered.valid === false);
  chk("ويعود سليماً بعد إرجاع القيمة", (await AG.verifySignature(target.id))?.valid === true);
  chk("والحارسُ عاد يعمل", (await prisma.agreementSignature.update({ where: { id: target.id }, data: { typedName: "x" } }).then(() => "ok").catch((e) => String(e))).includes("APPEND_ONLY"));

  console.warn = warn;
  console.log(checks.join("\n"));
  const failed = checks.filter((x) => x.startsWith("✗")).length;
  console.log(`\n${checks.length - failed}/${checks.length} ✓${failed ? ` — ${failed} فشل` : ""}`);
  await prisma.$disconnect();
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.warn = warn;
  console.log(checks.join("\n"));
  console.error(e);
  process.exit(1);
});
