import type { Session } from "next-auth";

/** **إعادةُ هيكلة الحوكمة — الفحصُ المركزي** (على نسخةٍ مؤقتة من القاعدة الاصطناعية):
 *    createdb -O tlaqi -T tlaqi_mk tlaqi_gov_e2e
 *    DATABASE_URL=…/tlaqi_gov_e2e npx tsx --tsconfig tsconfig.json scripts/e2e-governance-restructure.ts
 *
 *  القيادة (الرئيس التنفيذي ثم المؤسس، وانتقالٌ مسجَّل)، ومقعدُ الرئيس التنفيذي الواحد (في القاعدة، ولو تزامنت
 *  المحاولات)، والمناصبُ الديناميكية بدعواتها وحالاتها وصلاحياتها وحدودها، ودورةُ حياة اللجنة (بلا قائد، أرشفة،
 *  استرجاع، قائدٌ لاحقاً، تزامن)، وسجلُّ التدقيق الذي لا يُعدَّل. */
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "") || !/tlaqi_gov_e2e/.test(process.env.DATABASE_URL ?? "")) {
  console.error("يُشغَّل على النسخة المؤقتة tlaqi_gov_e2e وحدها");
  process.exit(1);
}
if (process.env.VERCEL || process.env.RESEND_API_KEY) {
  console.error("فحصٌ محليٌّ فقط والبريد معطّل");
  process.exit(1);
}

const checks: string[] = [];
const chk = (n: string, ok: boolean, extra = "") => checks.push(`${ok ? "✓" : "✗ FAIL"} ${n}${!ok && extra ? " — " + extra : ""}`);

// روابطُ الدعوات تُطبع محلياً حين يتعذّر البريد — نلتقطها
const inviteUrls: string[] = [];
const warn = console.warn;
console.warn = (...a: unknown[]) => {
  const m = String(a[0] ?? "").match(/رابط دعوة الإدارة العليا [^:]+: (\S+)/);
  if (m) inviteUrls.push(m[1]);
  else warn(...a);
};
const lastToken = () => inviteUrls[inviteUrls.length - 1]?.split("/").pop() ?? "";

(async () => {
  const { prisma } = await import("@/lib/prisma");
  const L = await import("@/lib/governance/leadership");
  const G = await import("@/lib/governance/senior");
  const { orgActor, canProposeCommitteesOf } = await import("@/lib/org/actor");
  const C = await import("@/lib/org/committeeService");
  const { decideCommittee } = await import("@/lib/committees");
  const { createDepartment } = await import("@/lib/departments");
  const W = await import("@/lib/workflow");

  const TAG = `e2e-gov-${Date.now()}`;
  const sess = (u: { id: string; role: string; fullName: string; email?: string; departmentId?: string | null }) =>
    ({ user: { id: u.id, role: u.role, name: u.fullName, email: u.email ?? `${u.id}@x`, departmentId: u.departmentId ?? null } } as unknown as Session);
  let n = 0;

  // ── تهيئة: إدارةٌ عليا، ومؤسس، ولا رئيسَ تنفيذياً نشطاً
  let senior = await prisma.department.findFirst({ where: { leadershipOnly: true, parentId: null } });
  if (!senior) {
    await createDepartment({ name: `الإدارة العليا ${TAG}`, colorHex: "#341D2B", createdByName: "فحص", leadershipOnly: true });
    senior = await prisma.department.findFirstOrThrow({ where: { leadershipOnly: true, parentId: null } });
  }
  await prisma.user.updateMany({ where: { role: "executive", isActive: true }, data: { isActive: false, removedAt: new Date(), removalReason: "فحص" } });
  const founder = await prisma.user.findFirstOrThrow({ where: { role: "super_admin", isActive: true }, orderBy: { createdAt: "asc" } });
  const track = await prisma.testTrack.findFirstOrThrow({ where: { scope: "department_member" } });
  const mkMember = async (departmentId: string, name = `عضو ${++n}`) => {
    const email = `${TAG}-m${++n}@example.test`;
    const inv = await prisma.invite.create({ data: { fullName: name, email, targetRole: "member", departmentId, testTrackId: track.id, invitedById: founder.id, status: "used" } });
    return prisma.member.create({ data: { fullName: `${name} ${TAG}`, email, departmentId, inviteId: inv.id, passwordHash: "!", approvalStatus: "approved", decidedAt: new Date(), isActive: true } });
  };

  // ══ ١) القيادة ══
  const l0 = await L.reconcileSeniorLeadership("فحص: بلا رئيسٍ تنفيذي");
  chk("بلا رئيسٍ تنفيذيٍّ نشط: يقود المؤسسُ الإدارةَ العليا (بالخلافة)", l0?.leader?.id === founder.id && l0.basis === "founder_fallback", JSON.stringify(l0));
  const ceo = await prisma.user.create({ data: { fullName: `الرئيس التنفيذي ${TAG}`, email: `${TAG}-ceo@example.test`, passwordHash: "!", role: "executive", isActive: true } });
  const l1 = await L.reconcileSeniorLeadership("فحص: تعيين رئيسٍ تنفيذي");
  chk("رئيسٌ تنفيذيٌّ نشط: يقودها هو", l1?.leader?.id === ceo.id && l1.basis === "ceo");
  const ev1 = await prisma.orgAuditEvent.findFirst({ where: { action: "senior.leadership", entityId: senior.id }, orderBy: { createdAt: "desc" } });
  chk("وكلُّ انتقالٍ يُسجَّل في سجل الحوكمة (من، وإلى، ولماذا)", !!ev1 && (ev1.note ?? "").includes("عادت") && (ev1.after as { basis?: string })?.basis === "ceo", ev1?.note ?? "");
  const again = await L.reconcileSeniorLeadership("فحص: تكرار");
  const evCount = await prisma.orgAuditEvent.count({ where: { action: "senior.leadership", entityId: senior.id } });
  const again2 = await L.reconcileSeniorLeadership("فحص: تكرار ثانٍ");
  chk("والمطابقةُ المكرّرة لا تكتب شيئاً (لا انتقالَ وهمي)", again?.leader?.id === ceo.id && again2?.leader?.id === ceo.id && (await prisma.orgAuditEvent.count({ where: { action: "senior.leadership", entityId: senior.id } })) === evCount);
  chk("القائدُ الفعليُّ الرئيس — والمؤسس ليس قائداً معه (لا قائدان)", (await L.isSeniorLeader({ kind: "user", id: ceo.id })) && !(await L.isSeniorLeader({ kind: "user", id: founder.id })));

  // ══ ٢) مقعدُ الرئيس التنفيذي الواحد — في القاعدة ══
  const second = await prisma.user.create({ data: { fullName: `رئيس ثانٍ ${TAG}`, email: `${TAG}-ceo2@example.test`, passwordHash: "!", role: "executive", isActive: true } }).then(() => "created").catch((e) => String(e));
  chk("القاعدةُ ترفض رئيساً تنفيذياً نشطاً ثانياً", second.includes("EXECUTIVE_SEAT_TAKEN"), second.slice(0, 120));
  const dormant = await Promise.all([1, 2].map((i) => prisma.user.create({ data: { fullName: `مرشّح رئاسة ${i} ${TAG}`, email: `${TAG}-cand${i}@example.test`, passwordHash: "!", role: "executive", isActive: false } })));
  await prisma.user.update({ where: { id: ceo.id }, data: { isActive: false } });
  const race = await Promise.allSettled(dormant.map((u) => prisma.user.update({ where: { id: u.id }, data: { isActive: true } })));
  chk("محاولتان متزامنتان لتعيين رئيسٍ تنفيذي: تنجح واحدةٌ وحدها", race.filter((r) => r.status === "fulfilled").length === 1 && (await prisma.user.count({ where: { role: "executive", isActive: true } })) === 1);
  const winner = await prisma.user.findFirstOrThrow({ where: { role: "executive", isActive: true } });
  await W.removeLeadershipUser({ userId: winner.id, reason: "فحص: تنحية الرئيس التنفيذي", performedById: founder.id, performedByName: founder.fullName });
  const lFb = await prisma.department.findUniqueOrThrow({ where: { id: senior.id }, select: { seniorLeaderUserId: true, seniorLeaderBasis: true } });
  chk("تنحيةُ الرئيس التنفيذي تنقل القيادةَ إلى المؤسس فوراً", lFb.seniorLeaderUserId === founder.id && lFb.seniorLeaderBasis === "founder_fallback");
  const evFb = await prisma.orgAuditEvent.findFirst({ where: { action: "senior.leadership", entityId: senior.id }, orderBy: { createdAt: "desc" } });
  chk("ويُسجَّل انتقالُها إلى المؤسس", (evFb?.note ?? "").includes("إلى المؤسس"), evFb?.note ?? "");
  const aFounder = await orgActor(sess(founder));
  chk("والمؤسسُ يقترح لجانَ الإدارة العليا حين يقود", canProposeCommitteesOf(aFounder, senior.id));
  await prisma.user.update({ where: { id: ceo.id }, data: { isActive: true, removedAt: null } });
  const aFounder2 = await orgActor(sess(founder));
  const aCeo = await orgActor(sess(ceo));
  chk("وعودةُ الرئيس التنفيذي تعيد إليه القيادة — فيقترح هو، ولا يقترح المؤسس (يعتمد)", canProposeCommitteesOf(aCeo, senior.id) && !canProposeCommitteesOf(aFounder2, senior.id));
  chk("وعودتُه مسجَّلة", ((await prisma.orgAuditEvent.findFirst({ where: { action: "senior.leadership", entityId: senior.id }, orderBy: { createdAt: "desc" } }))?.note ?? "").includes("عادت"));

  // ══ ٣) المناصبُ الديناميكية والدعوات ══
  const ctxCeo = await G.seniorContext(sess(ceo));
  const ctxFounder = await G.seniorContext(sess(founder));
  chk("سياقُ القيادة: الرئيسُ قائد، والمؤسسُ مشرفٌ لا قائد", ctxCeo.isLeader && !ctxFounder.isLeader && ctxFounder.isFounder);
  const legalEmail = `${TAG}-legal@example.test`;
  const byFounder = await G.createSeniorInvitation(ctxFounder, { inviteName: "مستشارة قانونية", inviteEmail: legalEmail, titleAr: "المستشار القانوني" });
  chk("المؤسسُ (والرئيسُ يقود) لا يُنشئ دعواتها — إدارتُها لقائدها", !byFounder.ok);
  chk("والمحاولةُ المرفوضة تُسجَّل بنتيجة «مرفوضة»", (await prisma.orgAuditEvent.count({ where: { action: "senior.invite.create", result: "denied", actorId: founder.id } })) >= 1);
  const badCap = await G.createSeniorInvitation(ctxCeo, { inviteName: "س", inviteEmail: legalEmail, titleAr: "المستشار", capabilities: ["leadership_override"] });
  chk("ولا صلاحيةَ خارج القائمة المعتمدة (لا تُخترَع صلاحية)", !badCap.ok);
  const topInvite = await G.createSeniorInvitation(ctxCeo, { inviteName: "المؤسس", inviteEmail: founder.email, titleAr: "مستشار" });
  chk("ولا يُدعى المؤسسُ أو الرئيسُ إلى منصب", !topInvite.ok);
  const draft = await G.createSeniorInvitation(ctxCeo, {
    inviteName: "مستشارة قانونية", inviteEmail: legalEmail, titleAr: "المستشار القانوني", titleEn: "Legal Counsel",
    description: "الاستشارات القانونية للمنصة", responsibilities: "مراجعة الاتفاقيات\nالرأي القانوني في القرارات",
    capabilities: ["governance_log_view", "agreements_manage"], notes: "فحص",
  });
  chk("الرئيسُ يُنشئ دعوةً بمسمّى حرٍّ بالعربية والإنجليزية وصلاحياتٍ محدّدة (مسودّة)", draft.ok);
  const pos = draft.ok ? await prisma.seniorPosition.findUniqueOrThrow({ where: { id: draft.id } }) : null;
  chk("وتُحفَظ: المسمّى والوصف والمسؤوليات والصلاحيات (ومعها لوحةُ الإدارة دائماً)", !!pos && pos.titleEn === "Legal Counsel" && pos.inviteState === "draft" && pos.status === "pending" && pos.capabilities.includes("board_view") && pos.capabilities.includes("agreements_manage"));
  const dup = await G.createSeniorInvitation(ctxCeo, { inviteName: "مكرّر", inviteEmail: legalEmail.toUpperCase(), titleAr: "مسمّى آخر" });
  chk("ولا دعوتان قائمتان للبريد نفسه (قيدٌ في القاعدة، ولو اختلفت الحروف)", !dup.ok && !dup.ok && dup.reason.includes("قائم"), dup.ok ? "" : dup.reason);
  const sent = draft.ok ? await G.sendSeniorInvitation(ctxCeo, draft.id) : null;
  const tok1 = lastToken();
  chk("إرسالُها: «مرسلة» برابطٍ لمرّةٍ واحدة لا يُخزَّن (بصمته وحدها)", !!sent?.ok && !!tok1 && (await prisma.seniorPosition.findUniqueOrThrow({ where: { id: pos!.id } })).inviteTokenHash === G.tokenHash(tok1));
  await G.sendSeniorInvitation(ctxCeo, pos!.id);
  const tok2 = lastToken();
  chk("وإعادةُ الإرسال تُبطل الرابطَ السابق", tok2 !== tok1 && (await G.openSeniorInvitation(tok1)) === null);
  const opened = await G.openSeniorInvitation(tok2);
  chk("فتحُ الرابط: «بانتظار القبول»", opened?.inviteState === "opened");
  const weak = await G.acceptSeniorInvitation(tok2, { session: null, password: "short" });
  chk("القبولُ بكلمة مرورٍ ضعيفة يُرفض", !weak.ok);
  const acc = await G.acceptSeniorInvitation(tok2, { session: null, password: "Strong-Pass-2026" });
  const posA = await prisma.seniorPosition.findUniqueOrThrow({ where: { id: pos!.id } });
  const legal = await prisma.member.findFirst({ where: { email: legalEmail } });
  chk("قبولُ مدعوٍّ جديد: يُنشأ حسابُه عضواً في الإدارة العليا ويُربط بتكليفه", acc.ok && acc.mode === "created" && !!legal && legal.departmentId === senior.id && posA.holderMemberId === legal.id && posA.status === "active" && posA.inviteState === "accepted", JSON.stringify(acc));
  chk("والرابطُ لا يُستعمل مرّتين", posA.inviteTokenHash === null && !(await G.acceptSeniorInvitation(tok2, { session: null, password: "Strong-Pass-2026" })).ok);
  chk("والقبولُ مسجَّل", (await prisma.orgAuditEvent.count({ where: { action: "senior.invite.accept", entityId: pos!.id } })) === 1);
  const ctxLegal = await G.seniorContext(sess({ id: legal!.id, role: "member", fullName: legal!.fullName }));
  chk("صلاحياتُ العضو ما مُنح وحده: لوحةٌ وسجلٌّ واتفاقيات — لا قيادة", ctxLegal.capabilities.has("agreements_manage") && ctxLegal.capabilities.has("governance_log_view") && !ctxLegal.capabilities.has("committees_view") && !ctxLegal.isLeader);
  const selfEdit = await G.updateSeniorPosition(ctxLegal, pos!.id, { titleAr: "المستشار القانوني الأول", capabilities: ["board_view", "agreements_manage", "committees_view"] });
  chk("ولا يعدّل العضوُ تكليفَه ولا يرفع صلاحياته", !selfEdit.ok && (await prisma.seniorPosition.findUniqueOrThrow({ where: { id: pos!.id } })).titleAr === "المستشار القانوني");
  const selfInvite = await G.createSeniorInvitation(ctxLegal, { inviteName: "صديق", inviteEmail: `${TAG}-friend@example.test`, titleAr: "مستشار" });
  chk("ولا يدعو أحداً (الدعوةُ للقائد وحده)", !selfInvite.ok);
  const edit = await G.updateSeniorPosition(ctxCeo, pos!.id, { titleAr: "المستشار القانوني", titleEn: "Legal Counsel", description: "الاستشارات القانونية للمنصة", responsibilities: "مراجعة الاتفاقيات", capabilities: ["governance_log_view", "agreements_view"] });
  const evEdit = await prisma.orgAuditEvent.findFirst({ where: { action: "senior.position.permissions", entityId: pos!.id }, orderBy: { createdAt: "desc" } });
  chk("والقائدُ يعدّل الصلاحيات — بقيمتها قبل وبعد في السجل", edit.ok && !!evEdit && String((evEdit.before as Record<string, unknown>).capabilities).includes("agreements_manage") && !String((evEdit.after as Record<string, unknown>).capabilities).includes("agreements_manage"));
  const susp = await G.setSeniorPositionStatus(ctxCeo, pos!.id, "suspended", "فحص الإيقاف");
  const ctxSusp = await G.seniorContext(sess({ id: legal!.id, role: "member", fullName: legal!.fullName }));
  chk("إيقافُ التكليف يسحب صلاحياته فوراً", susp.ok && !ctxSusp.capabilities.has("governance_log_view") && !ctxSusp.position);
  const badFlow = await G.setSeniorPositionStatus(ctxCeo, pos!.id, "pending", "رجوع");
  chk("ولا انتقالَ عشوائيٌّ بين الحالات", !badFlow.ok);
  // مدعوٌّ له حسابٌ قائم: يقبل بعد الدخول به وحده
  const existing = await mkMember(senior.id, "عضو قائم");
  const inv2 = await G.createSeniorInvitation(ctxCeo, { inviteName: existing.fullName, inviteEmail: existing.email, titleAr: "المتحدث الرسمي", titleEn: "Spokesperson", send: true });
  const tok3 = lastToken();
  const anon = await G.acceptSeniorInvitation(tok3, { session: null, password: "Strong-Pass-2026" });
  const other = await G.acceptSeniorInvitation(tok3, { session: sess({ id: legal!.id, role: "member", fullName: legal!.fullName }) });
  const own = await G.acceptSeniorInvitation(tok3, { session: sess({ id: existing.id, role: "member", fullName: existing.fullName }) });
  chk("لحسابٍ قائم: لا يقبلها إلا صاحبُه بعد الدخول (لا مجهول ولا غيرُه)", inv2.ok && !anon.ok && !other.ok && own.ok && own.mode === "linked");
  // انتهاءُ المهلة والإلغاء
  const inv3 = await G.createSeniorInvitation(ctxCeo, { inviteName: "ممثل رسمي", inviteEmail: `${TAG}-rep@example.test`, titleAr: "الممثل الرسمي", send: true });
  const tok4 = lastToken();
  if (inv3.ok) await prisma.seniorPosition.update({ where: { id: inv3.id }, data: { inviteExpiresAt: new Date(Date.now() - 1000) } });
  const exp = await G.openSeniorInvitation(tok4);
  chk("الدعوةُ بعد مهلتها «منتهية» ولا تُقبل", exp?.inviteState === "expired" && !(await G.acceptSeniorInvitation(tok4, { session: null, password: "Strong-Pass-2026" })).ok);
  const inv4 = await G.createSeniorInvitation(ctxCeo, { inviteName: "مستشار إداري", inviteEmail: `${TAG}-adm@example.test`, titleAr: "المستشار الإداري" });
  const noReason = inv4.ok ? await G.cancelSeniorInvitation(ctxCeo, inv4.id, "") : null;
  const cancelled = inv4.ok ? await G.cancelSeniorInvitation(ctxCeo, inv4.id, "تغيّرت الحاجة") : null;
  chk("الإلغاءُ بسببٍ مكتوب: «ملغاة»، ويبقى صفُّها سجلاً", !noReason?.ok && !!cancelled?.ok && (await prisma.seniorPosition.findUniqueOrThrow({ where: { id: (inv4 as { id: string }).id } })).inviteState === "cancelled");

  // ══ ٤) دورةُ حياة اللجنة ══
  const s1 = await mkMember(senior.id, "عضو عليا ١");
  const s2 = await mkMember(senior.id, "عضو عليا ٢");
  const aCeoNow = await orgActor(sess(ceo));
  const base = { purpose: "تنظيم ملفات الحوكمة", kind: "permanent" as const, submit: true };
  const noLead = await C.createCommittee(aCeoNow, senior.id, { name: `لجنة بلا قائد ${TAG}`, ...base });
  chk("إنشاءُ لجنةٍ بلا قائدٍ ولا أعضاء يقع (بانتظار الاعتماد)", noLead.ok && noLead.status === "pending_review", JSON.stringify(noLead));
  const cid = noLead.ok ? noLead.id : "";
  const dec = await decideCommittee({ committeeId: cid, decision: "approved", session: sess(founder) });
  const afterDec = await prisma.department.findUniqueOrThrow({ where: { id: cid } });
  chk("واعتمادُها يجعلها «بانتظار تعيين قائد» لا عاملةً بلا قائد", dec.ok && afterDec.committeeStatus === "awaiting_lead", JSON.stringify(dec));
  const added = await C.addCommitteeMembers(aCeoNow, cid, [s2.id]);
  chk("ويُضاف إليها الأعضاءُ وهي بانتظار قائد", added.ok);
  const toApproved = await C.changeCommitteeStatus(aCeoNow, cid, "approved", "تشغيل يدوي");
  chk("ولا تُشغَّل يدوياً بلا قائد", !toApproved.ok);
  const archNoNote = await C.changeCommitteeStatus(aCeoNow, cid, "archived", "");
  const arch = await C.changeCommitteeStatus(aCeoNow, cid, "archived", "لم يُعيَّن قائد");
  const archived = await prisma.department.findUniqueOrThrow({ where: { id: cid }, include: { committeeMemberships: true } });
  chk("أرشفتُها بلا قائد — بسببٍ مكتوب، وتبقى بأعضائها ومن أين أُرشِفت", !archNoNote.ok && arch.ok && archived.committeeStatus === "archived" && archived.archivedFromStatus === "awaiting_lead" && archived.committeeMemberships.some((m) => m.memberId === s2.id && m.active));
  const restored = await C.restoreCommittee(aCeoNow, cid, "عادت الحاجة إليها");
  chk("واسترجاعُها يعيدها «بانتظار تعيين قائد» بلا فقد", restored.ok && restored.status === "awaiting_lead" && (await prisma.committeeMembership.count({ where: { committeeId: cid, active: true } })) === 1);
  await C.changeCommitteeStatus(aCeoNow, cid, "archived", "أرشفة ثانية");
  const leadWhileArchived = await C.appointCommitteeLead(aCeoNow, cid, s1.id, "تعيين قائد وهي مؤرشفة");
  const la = await prisma.department.findUniqueOrThrow({ where: { id: cid } });
  chk("تعيينُ قائدٍ لها وهي مؤرشفة: يُسجَّل بمن عيّن ومتى، وتبقى مؤرشفة", leadWhileArchived.ok && la.leadMemberId === s1.id && la.committeeStatus === "archived" && la.leadAssignedByName === ceo.fullName && !!la.leadAssignedAt);
  const restored2 = await C.restoreCommittee(aCeoNow, cid, "تُستأنف بقائدها");
  chk("ثم استرجاعُها بقائدها يُطلقها عاملة", restored2.ok && restored2.status === "approved", JSON.stringify(restored2));
  // لجنةٌ في قسمٍ عادي: قائدُ القسم يُنشئها بلا قائد، والرئيسُ يعتمد، ثم يُعيَّن قائدُها فتبدأ
  const dept = await prisma.department.findFirstOrThrow({ where: { parentId: null, leadershipOnly: false, committeeStatus: null } });
  await prisma.user.updateMany({ where: { role: "department_admin", departmentId: dept.id, isActive: true }, data: { isActive: false } });
  const lead = await prisma.user.create({ data: { fullName: `قائد قسم ${TAG}`, email: `${TAG}-lead@example.test`, passwordHash: "!", role: "department_admin", departmentId: dept.id, isActive: true } });
  const d1 = await mkMember(dept.id), d2 = await mkMember(dept.id);
  const aLead = await orgActor(sess(lead));
  const dc = await C.createCommittee(aLead, dept.id, { name: `لجنة قسم ${TAG}`, ...base, memberIds: [d2.id] });
  const ddec = dc.ok ? await decideCommittee({ committeeId: dc.id, decision: "approved", session: sess(ceo) }) : null;
  const ap = dc.ok ? await C.appointCommitteeLead(aLead, dc.id, d1.id, "قائدٌ لاحقاً") : null;
  const dcRow = dc.ok ? await prisma.department.findUniqueOrThrow({ where: { id: dc.id } }) : null;
  chk("في قسمٍ عادي: بلا قائد ⇐ بانتظار قائد ⇐ تعيينُه يُطلقها عاملة", !!ddec?.ok && !!ap?.ok && ap.started && dcRow?.committeeStatus === "approved" && dcRow.leadMemberId === d1.id, JSON.stringify(ap));
  const evStart = dc.ok ? await prisma.orgAuditEvent.findFirst({ where: { entityId: dc.id, action: "committee.lead" }, orderBy: { createdAt: "desc" } }) : null;
  chk("وتعيينُ القائد مسجَّلٌ بحالتها الجديدة", (evStart?.after as { status?: string })?.status === "approved");
  const rmLead = dc.ok ? await C.removeCommitteeMember(aLead, dc.id, d1.id, "إخراج القائد") : null;
  const rmLast = dc.ok ? await C.removeCommitteeMember(aLead, dc.id, d2.id, "آخر عضو") : null;
  chk("إزالةُ آخر عضوٍ تقع وتُسجَّل، والقائدُ لا يُخرَج قبل تعيين بديله", !rmLead?.ok && !!rmLast?.ok);
  // تزامن: أرشفتان معاً على اللجنة نفسها
  const race2 = dc.ok ? await Promise.all([C.changeCommitteeStatus(aLead, dc.id, "archived", "أرشفة أ"), C.changeCommitteeStatus(aLead, dc.id, "archived", "أرشفة ب")]) : [];
  chk("عمليتان متزامنتان على اللجنة نفسها: تقع واحدةٌ وحدها", race2.filter((r) => r.ok).length === 1);
  const otherLead = await orgActor(sess(founder));
  const restoreForeign = dc.ok ? await C.restoreCommittee({ ...otherLead!, isTop: false, leadsDepartmentId: null } as never, dc.id, "استرجاع") : null;
  chk("ولا يسترجعها من لا يملكها", !restoreForeign?.ok);
  // المرجعيةُ الوحيدة: المؤسسُ يقود (لا رئيس) — لجنتُه تُعتمد صراحةً ومسجَّلة
  await prisma.user.update({ where: { id: ceo.id }, data: { isActive: false } });
  const aF = await orgActor(sess(founder));
  const sole = await C.createCommittee(aF, senior.id, { name: `لجنة المرجعية ${TAG}`, ...base });
  const soleEv = sole.ok ? await prisma.orgAuditEvent.findFirst({ where: { entityId: sole.id, action: "committee.decided" } }) : null;
  chk("المؤسسُ يقود ولا معتمِدَ غيرُه: تُعتمد لجنتُه بصفته المرجعية — صراحةً ومسجَّلة", sole.ok && sole.status === "awaiting_lead" && (soleEv?.after as { soleAuthority?: boolean })?.soleAuthority === true, JSON.stringify(sole));
  await prisma.user.update({ where: { id: ceo.id }, data: { isActive: true } });

  // ══ ٥) سجلُّ التدقيق لا يُعدَّل ولا يُحذف ══
  const anyEv = await prisma.orgAuditEvent.findFirstOrThrow();
  const upd = await prisma.orgAuditEvent.update({ where: { id: anyEv.id }, data: { note: "عبث" } }).then(() => "ok").catch((e) => String(e));
  const del = await prisma.orgAuditEvent.delete({ where: { id: anyEv.id } }).then(() => "ok").catch((e) => String(e));
  const trunc = await prisma.$executeRawUnsafe('TRUNCATE "OrgAuditEvent"').then(() => "ok").catch((e) => String(e));
  chk("سجلُّ التدقيق يرفض التعديل والحذف والتفريغ (في القاعدة نفسها)", upd.includes("APPEND_ONLY") && del.includes("APPEND_ONLY") && trunc.includes("APPEND_ONLY"), `${upd.slice(0, 60)} | ${del.slice(0, 60)}`);
  chk("والحدثُ يحمل دورَ فاعله وقتَ التنفيذ", !!(await prisma.orgAuditEvent.findFirst({ where: { action: "senior.invite.create", result: "success", actorRole: "executive" } })));

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
