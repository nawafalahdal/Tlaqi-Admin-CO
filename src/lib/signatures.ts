import { prisma } from "@/lib/prisma";
import { appendMemberEvent } from "@/lib/googleSheets";
import { sendSignatureRequestEmail } from "@/lib/email";
import { appBaseUrl } from "@/lib/emailBrand";
import { accountRoleLabel } from "@/lib/testTracks";

/** توقيعات القادة — من طلبها إلى اعتمادها إلى بطلانها.
 *
 *  **القاعدة التي تحكم الملف:** التوقيع مِلكُ صاحبه لا مِلكُ المنصب.
 *  فمن خرج من منصبه بطل توقيعه ولم يُورَّث لخَلَفِه، ومن جاء طُلب منه
 *  توقيعُه هو. وتوريثُه انتحالٌ — شهادةٌ تحمل توقيع من لم يكن في
 *  المنصة يوم صدورها، وهي وثيقةٌ كاذبة لا اختصارٌ إداري.
 *
 *  والشهادات الصادرة تبقى صحيحة: بطلانُ التوقيع اليوم لا يُبطل ما
 *  صدر أمس. فـ`superseded` تمنع الاستعمال القادم ولا تمسّ الماضي.
 */

/** الأدوار التي تُوقِّع الشهادات */
const SIGNING_ROLES = ["super_admin", "executive", "department_admin"] as const;

export function isSigningRole(role: string): boolean {
  return (SIGNING_ROLES as readonly string[]).includes(role);
}

/** التوقيع المعتمَد الحالي لهذا الشخص في دوره وقسمه.
 *
 *  يُقرأ بالشخص لا بالمنصب: لو قُرئ بالمنصب لعاد توقيع من سبقه. */
export async function approvedSignatureFor(userId: string): Promise<string | null> {
  const sig = await prisma.leaderSignature.findFirst({
    where: { userId, status: "approved" },
    orderBy: { approvedAt: "desc" },
    select: { imageData: true },
  });
  return sig?.imageData ?? null;
}

/** التوقيع الحيّ لهذا الشخص أيّاً كانت مرحلته — لعرض حالته له */
export async function currentSignatureFor(userId: string) {
  return prisma.leaderSignature.findFirst({
    where: { userId, status: { in: ["requested", "submitted", "approved", "rejected"] } },
    orderBy: { createdAt: "desc" },
  });
}

/** يُبطل توقيعات من لم يبقَ في منصبه.
 *
 *  يُنادى عند التنحية وتغيير الدور وتعطيل الحساب. ولا يحذف: البطلان
 *  حدثٌ يُسجَّل بتاريخه، والحذف يُخفي أن توقيعاً كان. */
export async function supersedeSignatures(userId: string, reason: string): Promise<number> {
  const live = await prisma.leaderSignature.findMany({
    where: { userId, status: { in: ["requested", "submitted", "approved"] } },
    select: { id: true },
  });
  if (live.length === 0) return 0;

  await prisma.leaderSignature.updateMany({
    where: { id: { in: live.map((s) => s.id) } },
    data: { status: "superseded", supersededAt: new Date() },
  });

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { fullName: true, email: true, role: true },
  });
  if (user) {
    await appendMemberEvent({
      fullName: user.fullName,
      email: user.email,
      event: "إبطال توقيع",
      roleOrDepartment: accountRoleLabel(user.role),
      details: `${reason} — لا يُستعمل توقيعه على شهادةٍ بعد اليوم، والصادر يبقى صحيحاً`,
      at: new Date(),
    });
  }
  return live.length;
}

/** يطلب توقيعاً من قائدٍ جديد.
 *
 *  لا يُنشئ طلباً ثانياً لمن له طلبٌ حيّ: التكرار يُربك صاحبه ويُنتج
 *  توقيعين لا يُعرف أيُّهما المعتمَد. */
export async function requestSignature(opts: {
  userId: string;
  /** سببٌ يُكتب في السجل: تكليفٌ جديد، أو إبطالُ سابقٍ، أو طلبُ الإدارة */
  reason: string;
}): Promise<{ ok: true; created: boolean } | { ok: false; reason: string }> {
  const user = await prisma.user.findUnique({
    where: { id: opts.userId },
    include: { department: true },
  });
  if (!user) return { ok: false, reason: "الحساب غير موجود" };
  if (!user.isActive) return { ok: false, reason: "الحساب غير نشط" };
  if (!isSigningRole(user.role)) return { ok: false, reason: "هذا الدور لا يُوقّع شهادات" };

  const existing = await prisma.leaderSignature.findFirst({
    where: { userId: user.id, status: { in: ["requested", "submitted", "approved"] } },
  });
  if (existing) return { ok: true, created: false };

  await prisma.leaderSignature.create({
    data: { userId: user.id, role: user.role, departmentId: user.departmentId, status: "requested" },
  });

  const sent = await sendSignatureRequestEmail({
    to: user.email,
    fullName: user.fullName,
    roleLabel: accountRoleLabel(user.role),
    departmentName: user.department?.name ?? null,
    uploadUrl: `${appBaseUrl()}/admin/signature`,
  });

  await appendMemberEvent({
    fullName: user.fullName,
    email: user.email,
    event: "طلب توقيع",
    roleOrDepartment: user.department?.name ?? accountRoleLabel(user.role),
    details: `${opts.reason}${sent.skipped ? " — لم يصل بريد الطلب، يُعاد" : ""}`,
    at: new Date(),
  });

  return { ok: true, created: true };
}

/** يستقبل توقيع صاحبه — ولا يعتمده.
 *
 *  الرفع والاعتماد خطوتان: من يرفع توقيعه لا يعتمده لنفسه، وإلا صار
 *  الاعتماد ختماً على بياض. */
export async function submitSignature(opts: {
  userId: string;
  /** data URL لصورة PNG — يُتحقَّق من نوعها وحجمها هنا لا في الواجهة */
  imageData: string;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const sig = await prisma.leaderSignature.findFirst({
    where: { userId: opts.userId, status: { in: ["requested", "rejected"] } },
    orderBy: { createdAt: "desc" },
  });
  if (!sig) return { ok: false, reason: "لا طلب توقيعٍ مفتوحٌ لك" };

  // النوع يُفرَض: ملفٌّ بامتداد صورةٍ قد يكون SVG يحمل سكربتاً، وهو
  // يُعرض داخل صفحة الشهادة. فلا يُقبل إلا PNG أو JPEG.
  const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(opts.imageData.trim());
  if (!match) return { ok: false, reason: "الصورة يجب أن تكون PNG أو JPEG" };

  // الحجم الأعلى يُفرَض: صورةٌ ضخمة تُثقل كل شهادةٍ تُفتح
  const bytes = Math.floor((match[2].length * 3) / 4);
  if (bytes > 400_000) return { ok: false, reason: "حجم التوقيع أكبر من ٤٠٠ كيلوبايت" };

  // **والصورة تُفَكّ لا يُعَدّ حجمها.** كان الحدّ الأدنى بالبايتات،
  // فرفض صوراً صالحةً صغيرة وقبل ملفّاً تالفاً يبلغ الحدّ. وفكُّها
  // يُثبت ثلاثاً معاً: أنها صورةٌ حقاً (لا ملفٌّ يدّعي النوع في ترويسته)،
  // وأن مقاسها معقول، وأن فيها حبراً — فالتوقيع الفارغ يُرسَم سطراً
  // فارغاً على الشهادة ويُقرأ توقيعاً.
  let meta: { width?: number; height?: number };
  let hasInk: boolean;
  try {
    const sharp = (await import("sharp")).default;
    const buf = Buffer.from(match[2], "base64");
    const img = sharp(buf);
    meta = await img.metadata();
    const stats = await img.stats();
    // الحبر يُقاس بالشفافية إن كانت، وإلا بتفاوت القنوات: صورةٌ بلون
    // واحد (بيضاء كلها أو شفّافة كلها) لا توقيع فيها.
    const alpha = stats.channels[3];
    hasInk = alpha
      ? alpha.mean > 0.5
      : stats.channels.slice(0, 3).some((c) => c.max - c.min > 12);
  } catch {
    return { ok: false, reason: "الصورة تالفة أو ليست صورةً حقاً" };
  }

  if (!meta.width || !meta.height) return { ok: false, reason: "الصورة تالفة" };
  if (meta.width < 40 || meta.height < 15) {
    return { ok: false, reason: "الصورة أصغر من أن تكون توقيعاً" };
  }
  if (meta.width > 4000 || meta.height > 4000) {
    return { ok: false, reason: "أبعاد الصورة كبيرة جداً" };
  }
  if (!hasInk) return { ok: false, reason: "الصورة فارغة — لا توقيع فيها" };

  // **يُوحَّد التوقيع عند الاستلام لا عند العرض.**
  //
  // الشهادة أربع خلفيات: بنفسجية وبرتقالية وخضراء وبيج. وتوقيعٌ بحبره
  // الأصلي يصحّ على بعضها ويختفي على بعض — جُرِّب فظهر حبرٌ داكن على
  // خلفيةٍ داكنة فلا يُقرأ. ومن صوّر توقيعه على ورقةٍ بيضاء (JPEG) يصل
  // بمستطيلٍ أبيض يُغطّي الخلفية الملوّنة.
  //
  // فيُحوَّل هنا إلى PNG شفّافٍ حبرُه أسودُ معتم: الورق يصير شفافية،
  // والحبر يصير قناعاً. ثم تُلوّنه الشهادة بحبرها عبر `mask` — فيصحّ
  // على الأربع. والتوحيد مرّةً واحدة أرخص من معالجةٍ عند كل فتحة.
  let normalized: string;
  try {
    const sharp = (await import("sharp")).default;
    const src = Buffer.from(match[2], "base64");

    // الشدّة قناةً واحدة: الورق أسود (٠) والحبر أبيض (٢٥٥).
    const { data: alpha, info } = await sharp(src)
      .flatten({ background: "#ffffff" })
      .greyscale()
      .negate()
      .linear(1.7, -24)
      .toColourspace("b-w")
      .raw()
      .toBuffer({ resolveWithObject: true });

    // **تُضَمّ قناةً رابعة، لا تُركَّب بـ`dest-in`.**
    // `dest-in` يقرأ شفافية المصدر لا شدّته — وقناعُنا صورةٌ معتمةٌ
    // كلّها، فكان يُبقي كل شيء ويُنتج مستطيلاً مصمتاً. جُرِّب فظهر
    // مستطيلٌ أبيض مكان التوقيع. و`joinChannel` يُلحق الشدّة شفافيةً،
    // وهو ما كان مقصوداً.
    const inkPng = await sharp({
      create: {
        width: info.width,
        height: info.height,
        channels: 3,
        background: { r: 20, g: 16, b: 35 },
      },
    })
      .joinChannel(alpha, { raw: { width: info.width, height: info.height, channels: 1 } })
      .png()
      .toBuffer();

    // يُقصّ الفراغ المحيط فيملأ التوقيع مكانه على الشهادة
    const trimmed = await sharp(inkPng).trim({ threshold: 8 }).png().toBuffer();
    normalized = `data:image/png;base64,${trimmed.toString("base64")}`;
  } catch {
    return { ok: false, reason: "تعذّرت معالجة صورة التوقيع" };
  }

  await prisma.leaderSignature.update({
    where: { id: sig.id },
    data: {
      imageData: normalized,
      status: "submitted",
      submittedAt: new Date(),
      rejectedAt: null,
      rejectionNote: null,
    },
  });

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: opts.userId },
    select: { fullName: true, email: true, role: true },
  });
  await appendMemberEvent({
    fullName: user.fullName,
    email: user.email,
    event: "رفع توقيع",
    roleOrDepartment: accountRoleLabel(user.role),
    details: "ينتظر اعتماد الإدارة — ولا يُرسَم على شهادةٍ قبله",
    at: new Date(),
  });
  return { ok: true };
}

/** اعتماد التوقيع أو رفضه — للمؤسس والتنفيذي.
 *
 *  ولا يعتمد أحدٌ توقيعَ نفسه: الاعتماد مراجعةٌ، ومراجعةُ المرء نفسَه
 *  ليست مراجعة. والمؤسس ليس له من يُراجعه، فتوقيعُه يُعتمد بفعله هو —
 *  وهذا حدُّ البنية لا ثغرةٌ فيها، ويُسجَّل أنه اعتمده بنفسه. */
export async function decideSignature(opts: {
  signatureId: string;
  decision: "approve" | "reject";
  note?: string | null;
  actorId: string;
  actorRole: string;
  actorName: string;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (opts.actorRole !== "super_admin" && opts.actorRole !== "executive") {
    return { ok: false, reason: "اعتماد التوقيعات للمؤسس والتنفيذي" };
  }

  const sig = await prisma.leaderSignature.findUnique({
    where: { id: opts.signatureId },
    include: { user: { select: { fullName: true, email: true, role: true, id: true } } },
  });
  if (!sig) return { ok: false, reason: "التوقيع غير موجود" };
  if (sig.status !== "submitted") return { ok: false, reason: "لا توقيع مرفوعٌ ينتظر القرار" };

  if (sig.userId === opts.actorId && opts.actorRole !== "super_admin") {
    return { ok: false, reason: "لا تعتمد توقيعك بنفسك" };
  }

  if (opts.decision === "reject") {
    if (!opts.note?.trim()) return { ok: false, reason: "الرفض يحتاج سبباً مكتوباً" };
    await prisma.leaderSignature.update({
      where: { id: sig.id },
      data: {
        status: "rejected",
        rejectedAt: new Date(),
        rejectionNote: opts.note.trim(),
        imageData: null,
      },
    });
  } else {
    // الشرط في `where`: قراران متسارعان يمرّ أحدهما
    const written = await prisma.leaderSignature.updateMany({
      where: { id: sig.id, status: "submitted" },
      data: { status: "approved", approvedAt: new Date(), approvedById: opts.actorId },
    });
    if (written.count === 0) return { ok: false, reason: "حُسم أمره قبل قليل" };
  }

  await appendMemberEvent({
    fullName: sig.user.fullName,
    email: sig.user.email,
    event: opts.decision === "approve" ? "اعتماد توقيع" : "رفض توقيع",
    roleOrDepartment: accountRoleLabel(sig.user.role),
    details:
      opts.decision === "approve"
        ? `اعتمده ${opts.actorName}${sig.userId === opts.actorId ? " (اعتمد توقيعه بنفسه — لا مراجع أعلى منه)" : ""}`
        : `رفضه ${opts.actorName}: ${opts.note?.trim()}`,
    at: new Date(),
  });

  return { ok: true };
}

/** التوقيعات المرفوعة التي تنتظر قراراً */
export async function pendingSignatures() {
  return prisma.leaderSignature.findMany({
    where: { status: "submitted" },
    include: { user: { select: { fullName: true, email: true, role: true } }, department: true },
    orderBy: { submittedAt: "asc" },
  });
}

/** من يُوقّع ولا توقيع معتمَد له — ليُطلَب منه ولا يُنسى */
export async function leadersMissingSignature() {
  const leaders = await prisma.user.findMany({
    where: { isActive: true, role: { in: [...SIGNING_ROLES] } },
    include: { department: true },
  });
  const out: typeof leaders = [];
  for (const l of leaders) {
    const approved = await prisma.leaderSignature.findFirst({
      where: { userId: l.id, status: "approved" },
      select: { id: true },
    });
    if (!approved) out.push(l);
  }
  return out;
}
