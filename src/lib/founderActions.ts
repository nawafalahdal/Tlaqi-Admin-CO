import { prisma } from "@/lib/prisma";
import { handOver } from "@/lib/succession";
import { appendMemberEvent } from "@/lib/googleSheets";
import { sendWelcomePack } from "@/lib/welcome";
import { syncMemberLifecycleRow, syncAdminAccountRow } from "@/lib/workflow";
import { accountRoleLabel } from "@/lib/testTracks";

/** تصرّفات المؤسس وحده — وتُحرَس في الخادم لا بإخفاء زرّ.
 *
 *  إخفاءُ الزرّ تجميلٌ لا حماية: من يعرف اسم الإجراء يُناديه من طرفه.
 *  فكلّ دالّة هنا تتحقّق من الدور بنفسها، ولا تثق بأن من ناداها فحص.
 */

/** الحقول التي يُسمح بتصحيحها — قائمةٌ بيضاء لا سوداء.
 *
 *  لو أُخِذ اسم الحقل من الواجهة بلا حصر، أمكن تمرير `passwordHash`
 *  أو `isActive` إلى نفس التحديث. فلا يُقبل إلا ما في هذه القائمة. */
const EDITABLE_DATES = {
  orgJoinDate: "تاريخ الانضمام التنظيمي",
} as const;

export type EditableDateField = keyof typeof EDITABLE_DATES;

function assertFounder(role: string) {
  if (role !== "super_admin") throw new Error("هذا الإجراء للمؤسس وحده");
}

/** تصحيح تاريخ انضمامٍ تنظيمي.
 *
 *  **ولا يمسّ بداية التكليف الإداري.** وهذا شرطٌ صريح: من انضمّ
 *  للمنظمة سنة ٢٠٢٤ وتولّى قيادة قسمه سنة ٢٠٢٦ له تاريخان، وتصحيحُ
 *  الأول لا يُقدّم الثاني — ولو خُلطا لاستحقّ شهادة الثلاثة أشهر عن
 *  مدّةٍ لم يكن فيها قائداً. */
export async function correctMemberDate(opts: {
  memberId: string;
  field: EditableDateField;
  /** `null` يُفرِغ التاريخ — لمن سُجِّل له تاريخٌ خاطئ ولا يُعرف الصحيح */
  value: Date | null;
  note?: string | null;
  actorRole: string;
  actorId: string;
  actorName: string;
}): Promise<{ ok: true; previous: Date | null } | { ok: false; reason: string }> {
  assertFounder(opts.actorRole);
  if (!(opts.field in EDITABLE_DATES)) return { ok: false, reason: "حقل غير مسموح" };

  const member = await prisma.member.findUnique({
    where: { id: opts.memberId },
    select: { id: true, fullName: true, email: true, orgJoinDate: true, decidedAt: true },
  });
  if (!member) return { ok: false, reason: "السجل غير موجود" };

  // تاريخٌ في المستقبل ليس تصحيحاً تاريخياً
  if (opts.value && opts.value.getTime() > Date.now()) {
    return { ok: false, reason: "تاريخ الانضمام لا يكون في المستقبل" };
  }

  const previous = member[opts.field] ?? null;
  const same =
    (previous === null && opts.value === null) ||
    (previous !== null && opts.value !== null && previous.getTime() === opts.value.getTime());
  if (same) return { ok: true, previous };

  const assignmentBefore = member.decidedAt;

  await prisma.$transaction([
    prisma.member.update({
      where: { id: opts.memberId },
      // الحقل من القائمة البيضاء وحدها، فلا يُبنى مفتاحٌ من مُدخَل حرّ
      data: { [opts.field]: opts.value } as { orgJoinDate: Date | null },
    }),
    prisma.memberDateEdit.create({
      data: {
        memberId: opts.memberId,
        field: opts.field,
        previous,
        next: opts.value,
        editedById: opts.actorId,
        editedByName: opts.actorName,
        note: opts.note?.trim() || null,
      },
    }),
  ]);

  // حارسٌ صريح: بداية التكليف لم تتحرّك
  const after = await prisma.member.findUniqueOrThrow({
    where: { id: opts.memberId },
    select: { decidedAt: true },
  });
  if ((after.decidedAt?.getTime() ?? null) !== (assignmentBefore?.getTime() ?? null)) {
    throw new Error("تصحيح تاريخ الانضمام حرّك بداية التكليف — أُلغي");
  }

  await appendMemberEvent({
    fullName: member.fullName,
    email: member.email,
    event: "تصحيح تاريخ",
    roleOrDepartment: EDITABLE_DATES[opts.field],
    details:
      `${EDITABLE_DATES[opts.field]}: ` +
      `${previous ? previous.toISOString().slice(0, 10) : "—"} ← ` +
      `${opts.value ? opts.value.toISOString().slice(0, 10) : "—"} — ` +
      `صحّحه ${opts.actorName}${opts.note?.trim() ? ` (${opts.note.trim()})` : ""}`,
    at: new Date(),
  });
  await syncMemberLifecycleRow(opts.memberId);

  return { ok: true, previous };
}

/** إرسال بطاقة الانضمام لعضوٍ بعينه — بقرار المؤسس.
 *
 *  لا تُنشئ حساباً ولا تُغيّر حالة عضوية ولا تُصفّر تاريخاً: ترسل
 *  الرسالة نفسها التي تصل عند الاعتماد، بالقالب نفسه ولون قسمه.
 *
 *  **ولا تُرسَل لمن عُطِّل أو انتهت تجربته:** الرسالة تحمل رابط دخول،
 *  وإرسالُه لحسابٍ مُعطَّل يَعِد بوصولٍ لا يقع — أو أسوأ، يُقرأ دعوةً
 *  للعودة لمن وُدِّع. و`sendWelcomePack` يفرض هذا أيضاً، وهذه طبقةٌ
 *  قبله تُسمّي السبب للمؤسس بدل رفضٍ غامض. */
export async function sendWelcomeToMember(opts: {
  memberId: string;
  actorRole: string;
  actorName: string;
}): Promise<{ ok: true; to: string } | { ok: false; reason: string }> {
  assertFounder(opts.actorRole);

  const member = await prisma.member.findUnique({
    where: { id: opts.memberId },
    select: {
      id: true,
      fullName: true,
      email: true,
      isActive: true,
      noFurtherEmail: true,
      decidedAt: true,
      offboardingClosedAt: true,
    },
  });
  if (!member) return { ok: false, reason: "السجل غير موجود" };
  if (!member.decidedAt) return { ok: false, reason: "لم يُعتمد بعد — البطاقة تصل عند الاعتماد" };
  if (member.noFurtherEmail || member.offboardingClosedAt) {
    return { ok: false, reason: "أُغلقت تجربته — الوداع وعدٌ بألّا نراسله بعده" };
  }
  if (!member.isActive) return { ok: false, reason: "الحساب غير نشط — لا يُرسَل رابط دخول لحسابٍ مُعطَّل" };

  const res = await sendWelcomePack({ kind: "member", id: opts.memberId }, "resend");
  if (!res.ok) return { ok: false, reason: res.reason };

  await appendMemberEvent({
    fullName: member.fullName,
    email: member.email,
    event: "إرسال بطاقة الانضمام يدوياً",
    roleOrDepartment: "بقرار المؤسس",
    details: `أرسلها ${opts.actorName}`,
    at: new Date(),
  });

  return { ok: true, to: res.to };
}

/** إرسال بطاقة الانضمام إلى حسابٍ إداري — ومنها حسابُ المؤسس نفسه.
 *
 *  `sendWelcomeToMember` يقرأ سجلّ `Member`، والمؤسس ليس له سجلُّ ترشّح:
 *  حسابُه `User` أُنشئ مع المنصة لا بدعوةٍ ولا باختبار. فلم يكن له طريق
 *  إلى بطاقته — لا ليراها كما يراها أعضاؤه، ولا ليتحقّق من شكلها قبل
 *  أن تُرسَل إليهم. وهذا هو الطريق.
 *
 *  وهو **لا يُنشئ حساباً ولا يغيّر حالةً ولا يصفّر تاريخاً**: بطاقةٌ
 *  تُرسَل بالقالب نفسه، لا أكثر. والقالب نفسه حرفياً — `sendWelcomePack`
 *  هو هو، فما يراه المؤسس في صندوقه هو ما يصل عضوَه. */
export async function sendWelcomeToUser(opts: {
  userId: string;
  actorRole: string;
  actorName: string;
}): Promise<{ ok: true; to: string } | { ok: false; reason: string }> {
  assertFounder(opts.actorRole);

  const user = await prisma.user.findUnique({
    where: { id: opts.userId },
    select: { id: true, fullName: true, email: true, isActive: true, role: true },
  });
  if (!user) return { ok: false, reason: "الحساب غير موجود" };
  // ولا يُرسَل رابط دخولٍ لحسابٍ مُنحّى — الرابط وعدٌ ببابٍ مفتوح
  if (!user.isActive) {
    return { ok: false, reason: "الحساب مُنحّى — لا يُرسَل رابط دخول لحسابٍ مُعطَّل" };
  }

  const res = await sendWelcomePack({ kind: "user", id: user.id }, "resend");
  if (!res.ok) return { ok: false, reason: res.reason };

  await appendMemberEvent({
    fullName: user.fullName,
    email: user.email,
    event: "إرسال بطاقة الانضمام يدوياً",
    roleOrDepartment: accountRoleLabel(user.role),
    details:
      user.id === opts.userId && opts.actorName
        ? `أرسلها ${opts.actorName}`
        : "بقرار المؤسس",
    at: new Date(),
  });

  return { ok: true, to: res.to };
}

/** الحذف النهائي لحساب — للمؤسس وحده، وهو الملاذ الأخير.
 *
 *  **وهو غير التعطيل وغير التنحية وغير إنهاء التكليف.** تلك ثلاثٌ
 *  تُبقي السجل في القاعدة وتُوقف العمل. وهذا يُزيل الصفّ نفسه ليتحرّر
 *  البريد لدعوةٍ جديدة — ولذلك لا يُستعمل إلا عند الحاجة إليه بعينه.
 *
 *  والمبدأ الحاكم: **لا يُهدَر دليلٌ لتُستعاد خانةُ بريد.** فالسجل
 *  يُختم في الشيت أولاً بشاهدةٍ تقول إنه حُذف ومتى وبيد من، وتُفَكّ
 *  ارتباطاتُ التذاكر ولا تُحذف (هي سجلُّ عملٍ يخصّ أطرافاً أخرى)، ثم
 *  يُحذف الصفّ. فالتاريخ باقٍ والبريد حرّ.
 *
 *  والجلسةُ تبطل من تلقائها: `auth` يُراجع الحساب كل خمس دقائق على
 *  الأكثر، فمن حُذف لا يبقى داخلاً أكثر من ذلك.
 */
export async function permanentlyDeleteAccount(opts: {
  /** `member` لسجلّ مرشّح/عضو، و`user` لحسابٍ إداري */
  kind: "member" | "user";
  id: string;
  /** يُكتب البريد كاملاً: الحذف لا يقع بنقرةٍ في المكان الخطأ */
  confirmEmail: string;
  reason: string;
  /** إقرارٌ ثانٍ صريح لحذف حسابٍ ما يزال نشطاً.
   *
   *  الأصل أن يُنحّى الحساب قبل حذفه — التنحية تُبقي السجل وتُوقف
   *  العمل، والحذف يمحو الصفّ. لكن المؤسس قد يواجه حساباً مكرّراً
   *  أُنشئ خطأً وهو نشط، فإلزامُه بتنحيته أولاً خطوةٌ بلا معنى. فصار
   *  له حذفُه مباشرةً — بإقرارٍ ثانٍ لا بنقرةٍ واحدة. */
  force?: boolean;
  actorRole: string;
  actorId: string;
  actorName: string;
}): Promise<
  | {
      ok: true;
      email: string;
      fullName: string;
      /** هل تحرّر البريد فعلاً؟
       *
       *  القائد له سجلّان: `User` و`Member`. فحذفُ أحدهما لا يُحرّر
       *  البريد ما بقي الآخر يحمله — ولو قيل «حُذف» لظنّ المؤسس أن
       *  البريد صار حرّاً فتفشل دعوتُه بعد أسبوع بلا سببٍ ظاهر. فيُقال
       *  صريحاً: حُرّر أم بقي، وأين بقي. */
      emailFreed: boolean;
      heldBy: string | null;
      /** ما انتقل إلى خَلَفِه — يُقال للمؤسس لا يُخمَّن */
      handover?: string;
    }
  | { ok: false; reason: string }
> {
  assertFounder(opts.actorRole);
  const reason = opts.reason.trim();
  if (reason.length < 5) return { ok: false, reason: "اكتب سبب الحذف" };

  const stamp = new Date();
  const tombstone = `حُذف نهائياً ${stamp.toISOString().slice(0, 10)} — ${opts.actorName}`;

  /** البريد لا يُكتب في الشاهدة.
   *
   *  الشاهدة سجلُّ أن شخصاً كان ثم حُذف: اسمُه ودورُه وتواريخُه وسببُ
   *  حذفه. أما بريدُه فلا يُقيَّد فيها — فلا يبقى له أثرٌ في المنصة ولا
   *  في الشيت، ويُدعى صاحبُه من جديد بنفس بريده وبنفس بياناته كأن
   *  شيئاً لم يكن. وهذا طلبُ المؤسس صريحاً، ولا يُفقِد السجلَّ شيئاً:
   *  الصفّ باقٍ بكل ما فيه إلا خانةَ بريدٍ تحرّرت. */
  const REDACTED = "— (حُرِّر البريد لإعادة الدعوة)";

  if (opts.kind === "user") {
    const user = await prisma.user.findUnique({ where: { id: opts.id } });
    if (!user) return { ok: false, reason: "الحساب غير موجود" };
    if (user.id === opts.actorId) return { ok: false, reason: "لا تحذف حسابك أنت" };
    // حساب المؤسس لا يُحذف بيد أحد — ولا بيده هو.
    //
    // المنصة بلا مؤسسٍ نشط لا يملك أحدٌ فيها الاعتماد النهائي ولا آخر
    // حلقة التصعيد. فهذا ليس تفضيلاً في الواجهة بل شرطُ بقاءٍ يُفرض هنا،
    // في الخادم، قبل أيّ كتابة.
    if (user.role === "super_admin") {
      return { ok: false, reason: "حساب المؤسس لا يُحذف — المنصة لا تبقى بلا مؤسس نشط" };
    }
    if (opts.confirmEmail.trim().toLowerCase() !== user.email.toLowerCase()) {
      return { ok: false, reason: "البريد المكتوب لا يطابق بريد الحساب — لم يُحذف شيء" };
    }
    if (user.isActive && !opts.force) {
      return {
        ok: false,
        reason: "الحساب ما يزال نشطاً — أكّد الحذف المباشر، أو نحِّه أولاً",
      };
    }

    // هل باسمه عملٌ لا يُحذف صفُّه وهو قائم؟ الدعوةُ وحدها تكفي لمنع
    // الحذف في القاعدة، فنعرف قبل أن نكتب شيئاً.
    const transferNeeded =
      (await prisma.invite.count({ where: { invitedById: user.id } })) > 0 ||
      (await prisma.ticket.count({
        where: { approverUserId: user.id, approvalState: { in: ["awaiting", "reviewing"] } },
      })) > 0;

    // ── الخلافة قبل الحذف.
    //
    // **وهذا سببُ «حدث خطأ غير متوقّع» الذي كان يظهر.** الدعوة تحمل
    // `invitedById` إلزامياً، فصفُّ من أرسل دعوةً لا يُحذف ما دامت
    // قائمة: تَرفض القاعدة الحذف فيسقط الإجراء بخطأٍ عام لا يقول
    // شيئاً. فالنقل شرطُ الحذف لا تحسينٌ بعده — وبه أيضاً لا يبقى
    // طلبُ اعتمادٍ معتمِدُه محذوف، ولا تذكرةٌ بلا وجهة.
    const handover = await handOver({
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        departmentId: user.departmentId,
      },
      byName: opts.actorName,
      occasion: "حذف نهائي",
    });
    if (!handover.successor && transferNeeded) {
      return {
        ok: false,
        reason:
          "لا خَلَفَ نشطاً يرث ما باسمه (دعوات أو طلبات مفتوحة) — عيّن بديلاً أولاً، أو نحِّه بدل حذفه",
      };
    }

    // السجل يُختم قبل الحذف: بعده لا يبقى صفٌّ يُقرأ منه
    await syncAdminAccountRow(user.id, tombstone);
    await appendMemberEvent({
      fullName: user.fullName,
      email: REDACTED,
      event: "حذف نهائي لحساب إداري",
      roleOrDepartment: accountRoleLabel(user.role),
      details:
        `${tombstone} — السبب: ${reason}` +
        `${user.isActive ? " — وكان نشطاً، حُذف بإقرار مباشر" : ""}. ` +
        `السجل محفوظ هنا، والبريد لم يُقيَّد فيه ليُدعى صاحبه من جديد.`,
      at: stamp,
    });

    // التوقيعات تُحذف معه (لا معنى لتوقيعٍ بلا صاحب)، والتذاكر تُفَكّ
    // ولا تُحذف — والقيود في القاعدة `SetNull` فتُفَكّ من تلقائها.
    await prisma.leaderSignature.deleteMany({ where: { userId: user.id } });
    await prisma.ticket.updateMany({ where: { raisedByUserId: user.id }, data: { raisedByUserId: null } });
    await prisma.ticket.updateMany({ where: { targetUserId: user.id }, data: { targetUserId: null } });
    try {
      await prisma.user.delete({ where: { id: user.id } });
    } catch (err) {
      // الشاهدة كُتبت وتوقّع الحذفَ ولم يقع: تُعاد الحالة الحيّة، فلا
      // يُقرأ في الشيت «حُذف» وصفُّه قائم. والخطأ يُسمّى لا يُعمَّم.
      await syncAdminAccountRow(user.id);
      const code = (err as { code?: string }).code;
      return {
        ok: false,
        reason:
          code === "P2003"
            ? "ما زال في القاعدة ما يرتبط بهذا الحساب ويمنع حذفه — أعد المحاولة، وإن تكرّر فنحِّه بدل حذفه"
            : "تعذّر حذف الصفّ — لم يُحذف شيء، والسجل على حاله",
      };
    }

    // وهل تحرّر البريد؟ سجلُّ ترشّحه قد يبقى يحمله
    const twinLeft = await prisma.member.findUnique({
      where: { email: user.email },
      select: { fullName: true },
    });
    return {
      ok: true,
      email: user.email,
      fullName: user.fullName,
      emailFreed: twinLeft === null,
      heldBy: twinLeft ? `سجلّ عضوية ${twinLeft.fullName}` : null,
      handover: handover.summary,
    };
  }

  const member = await prisma.member.findUnique({
    where: { id: opts.id },
    include: { department: true, invite: true },
  });
  if (!member) return { ok: false, reason: "السجل غير موجود" };
  if (opts.confirmEmail.trim().toLowerCase() !== member.email.toLowerCase()) {
    return { ok: false, reason: "البريد المكتوب لا يطابق بريد الحساب — لم يُحذف شيء" };
  }
  if (member.isActive && member.approvalStatus === "approved" && !opts.force) {
    return {
      ok: false,
      reason: "هذا عضو معتمد نشط — أنهِ عضويته أولاً، أو أكّد الحذف المباشر",
    };
  }
  // وحسابٌ إداريٌّ قائمٌ بنفس البريد يُحذف أولاً، وإلا بقي البريد محجوزاً
  const twin = await prisma.user.findUnique({ where: { email: member.email } });
  if (twin) {
    return {
      ok: false,
      reason: "لهذا البريد حسابٌ إداريٌّ أيضاً — احذفه أولاً وإلا بقي البريد محجوزاً",
    };
  }

  // الشاهدة تُكتب في الصفّ نفسه، فلا يُقرأ الصفّ عضواً قائماً
  await syncMemberLifecycleRow(member.id, tombstone);
  await appendMemberEvent({
    fullName: member.fullName,
    email: REDACTED,
    event: "حذف نهائي من قاعدة البيانات",
    roleOrDepartment: member.department?.name ?? accountRoleLabel(member.invite.targetRole),
    details:
      `${tombstone} — السبب: ${reason} — التنبيهات: ${member.warningsCount} — ` +
      `نتيجة الاختبار: ${member.testScore === null ? "لم يختبر" : `${member.testScore}%`}. ` +
      `السجل محفوظ هنا، والبريد لم يُقيَّد فيه ليُدعى صاحبه من جديد بنفس بياناته.`,
    at: stamp,
  });

  // التذاكر سجلُّ عملٍ يخصّ أطرافاً أخرى: تُفَكّ ولا تُحذف.
  // والشهادات أثرُ حوكمةٍ مضت، وهي على الصفّ نفسه فتزول معه — ولهذا
  // كُتب كل ما فيها في الشيت قبل الحذف.
  await prisma.ticket.updateMany({ where: { memberId: member.id }, data: { memberId: null } });
  await prisma.ticket.updateMany({ where: { targetMemberId: member.id }, data: { targetMemberId: null } });
  await prisma.request.updateMany({ where: { linkedMemberId: member.id }, data: { linkedMemberId: null } });
  await prisma.testAttempt.deleteMany({ where: { memberId: member.id } });
  await prisma.memberWarning.deleteMany({ where: { memberId: member.id } });
  await prisma.terminationRequest.deleteMany({ where: { memberId: member.id } });
  await prisma.memberDateEdit.deleteMany({ where: { memberId: member.id } });
  await prisma.member.delete({ where: { id: member.id } });
  await prisma.invite.delete({ where: { id: member.inviteId } });

  // الفرع الآخر يرفض الحذف ما بقي للبريد حسابٌ إداري، فوصولُنا هنا
  // يعني أنه لم يبقَ له حاملٌ
  return { ok: true, email: member.email, fullName: member.fullName, emailFreed: true, heldBy: null };
}

/** تغيير بريد حسابٍ قيادي — للمؤسس وحده.
 *
 *  **وينتشر إلى سجلَّي الشخص لا إلى أحدهما.** القائد له سجلّان: حسابٌ
 *  إداري (`User`) وسجلُّ ترشّحه الباقي (`Member`). والوصلُ بينهما
 *  **بالبريد** — هكذا يجد `memberForSession` سجلَّ القائد حين يرفع طلب
 *  إنهاء فترته.
 *
 *  فلو غُيّر بريد `User` وحده انفصل السجلّان بصمت: يبقى القائد داخلاً
 *  ولا يجد النظامُ سجلَّ عضويته — فلا يرفع طلباً ولا تُقرأ تواريخه.
 *  وهذا عطبٌ لا يظهر إلا بعد التغيير بأسابيع.
 *
 *  ولا يُفرَض تغييرُ كلمة المرور معه: تغييرُ البريد تصحيحُ بيانٍ لا
 *  اشتباهُ اختراق، وإقرانُهما يُجبر القائد على تغيير كلمته لأن إدارته
 *  صحّحت حرفاً في عنوانه. ومن أراد الاثنين ناداهما.
 */
export async function changeLeadershipEmail(opts: {
  userId: string;
  newEmail: string;
  actorRole: string;
  actorId: string;
  actorName: string;
}): Promise<{ ok: true; previous: string; next: string } | { ok: false; reason: string }> {
  assertFounder(opts.actorRole);

  const next = opts.newEmail.trim().toLowerCase();
  // تحقّقٌ بسيطٌ مقصود: الأنماط المُسهِبة ترفض عناوين صحيحة، والقبول
  // النهائي عند أول إرسالٍ فعلي.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(next)) {
    return { ok: false, reason: "صيغة البريد غير صحيحة" };
  }

  const user = await prisma.user.findUnique({ where: { id: opts.userId } });
  if (!user) return { ok: false, reason: "الحساب غير موجود" };
  const previous = user.email;
  if (previous.toLowerCase() === next) return { ok: true, previous, next };

  // التفرّد يُفحَص في الجدولين: البريد مفتاحٌ فريدٌ في كلٍّ منهما،
  // وقبولُه في أحدهما ورفضُه في الآخر يترك التغيير نصفَ منفَّذ.
  const [userClash, memberClash] = await Promise.all([
    prisma.user.findUnique({ where: { email: next }, select: { id: true } }),
    prisma.member.findUnique({ where: { email: next }, select: { id: true } }),
  ]);
  if (userClash && userClash.id !== user.id) {
    return { ok: false, reason: "هذا البريد مستخدمٌ في حسابٍ إداريٍّ آخر" };
  }

  const twin = await prisma.member.findUnique({ where: { email: previous } });
  if (memberClash && memberClash.id !== twin?.id) {
    return { ok: false, reason: "هذا البريد مستخدمٌ في سجلّ عضويةٍ آخر" };
  }

  // السجلّان معاً أو لا أحد: معاملةٌ واحدة تمنع الانفصال الصامت
  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { email: next } }),
    ...(twin ? [prisma.member.update({ where: { id: twin.id }, data: { email: next } })] : []),
  ]);

  // أقفال المحاولات الفاشلة تُفرَّغ على العنوانين: قفلٌ على العنوان
  // القديم لا يُفيد، وقفلٌ موروثٌ على الجديد يمنع صاحبه بلا سبب.
  const { clearFailedAttempts } = await import("@/lib/loginAttempts");
  await clearFailedAttempts(previous);
  await clearFailedAttempts(next);

  await appendMemberEvent({
    fullName: user.fullName,
    email: next,
    event: "تغيير بريد حساب قيادي",
    roleOrDepartment: accountRoleLabel(user.role),
    details:
      `${previous} ← ${next} — غيّره ${opts.actorName}` +
      (twin ? " — وانتشر إلى سجلّ العضوية" : " — لا سجلّ عضويةٍ مرتبط"),
    at: new Date(),
  });

  // الصفّان يُحدَّثان ليُقرأ العنوان الجديد في الإكسل لا القديم
  await syncAdminAccountRow(user.id);
  if (twin) await syncMemberLifecycleRow(twin.id);

  return { ok: true, previous, next };
}
