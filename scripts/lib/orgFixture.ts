/** **بياناتٌ اصطناعيةٌ للهيكل التنظيمي** — تغطّي حالاته الثماني عشرة (طلب المؤسس، نوفمبر 2026). تُنشأ في قاعدةٍ محلية وحدها،
 *  وأسماؤها وعناوينُها اصطناعية (`@example.test`) — لا بياناتِ أعضاءٍ حقيقية. وتعيد المعرّفاتِ لتُفحص بها النتيجة. */
import type { PrismaClient } from "@prisma/client";
import { assignMemberEmployeeNo } from "@/lib/employeeId";

type Gender = "male" | "female" | null;

/** `names`: لاحقةُ الأسماء — الوسمُ نفسُه افتراضاً (فرادةٌ في الاختبار)، وفارغةٌ لقاعدة المعاينة بأسماءٍ نظيفة */
export async function seedOrgFixture(prisma: PrismaClient, tag: string, opts: { names?: string } = {}) {
  const nameTag = opts.names ?? tag;
  const S = nameTag ? ` ${nameTag}` : "";
  if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "")) throw new Error("قاعدةٌ محلية وحدها");
  const founder = await prisma.user.findFirstOrThrow({ where: { role: "super_admin", isActive: true } });
  const track = await prisma.testTrack.findFirstOrThrow({ where: { scope: "department_member" } });
  const sharp = (await import("sharp")).default;
  let n = 0;
  const mail = (k: string) => `${tag}-${k}-${++n}@example.test`;
  const slug = (k: string) => `${tag}-${k}-${++n}`.toLowerCase();

  const dept = async (name: string, extra: Record<string, unknown> = {}) =>
    (await prisma.department.findFirst({ where: { name } })) ??
    prisma.department.create({ data: { name, slug: slug("d"), colorHex: "#3366CC", ...extra } as never });

  /** صورةٌ شخصيةٌ اصطناعية (لا وجهَ حقيقي): تدرّجٌ بسيط — لتُختبر الصورةُ المرفوعة */
  const photo = async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#67C090"/><stop offset="1" stop-color="#341D2B"/></linearGradient></defs><rect width="512" height="512" fill="url(#g)"/><circle cx="256" cy="200" r="96" fill="#EEF6DF"/><rect x="120" y="320" width="272" height="192" rx="120" fill="#EEF6DF"/></svg>`;
    const webp = await sharp(Buffer.from(svg)).webp({ quality: 82 }).toBuffer();
    return `data:image/webp;base64,${webp.toString("base64")}`;
  };

  const member = async (o: { name: string; gender: Gender; departmentId: string | null; jobTitle?: string; withPhoto?: boolean; role?: "member" | "department_admin"; email?: string; active?: boolean }) => {
    const email = o.email ?? mail("m");
    const inv = await prisma.invite.create({ data: { fullName: o.name, email, targetRole: o.role ?? "member", departmentId: o.departmentId, testTrackId: track.id, invitedById: founder.id, status: "used" } as never });
    const m = await prisma.member.create({
      data: {
        fullName: o.name,
        email,
        departmentId: o.departmentId,
        inviteId: inv.id,
        passwordHash: "!",
        approvalStatus: "approved",
        decidedAt: new Date(),
        isActive: o.active ?? true,
        ...(o.active === false ? { terminatedAt: new Date() } : {}),
        credentialsIssuedAt: new Date(),
        gender: o.gender,
        jobTitle: o.jobTitle ?? null,
        ...(o.withPhoto ? { avatarData: await photo(), avatarVersion: new Date() } : {}),
      } as never,
    });
    if (o.active !== false) await assignMemberEmployeeNo(prisma, m.id);
    return m;
  };

  /** قائدُ قسم: حسابٌ إداري وسجلُّ ترشّحه التوأم بالبريد نفسه — كما تُنشئهما المنصة */
  const lead = async (name: string, gender: Gender, departmentId: string) => {
    const email = mail("lead");
    const u = await prisma.user.create({ data: { fullName: name, email, passwordHash: "!", role: "department_admin", departmentId, isActive: true, gender } as never });
    const twin = await member({ name, gender, departmentId, role: "department_admin", email });
    await prisma.member.update({ where: { id: twin.id }, data: { employeeNo: null } });
    await assignMemberEmployeeNo(prisma, twin.id, u.employeeNo);
    return { user: u, twin };
  };

  const committee = async (parentId: string, name: string, leadMemberId: string | null) =>
    prisma.department.create({
      data: { name, slug: slug("c"), colorHex: "#3366CC", parentId, committeeStatus: leadMemberId ? "approved" : "awaiting_lead", leadMemberId } as never,
    });
  const join = (committeeId: string, memberId: string, responsibility?: string) =>
    prisma.committeeMembership.create({ data: { committeeId, memberId, responsibility: responsibility ?? null, addedByName: "فحص" } as never });

  // ═══ الإدارة العليا ومنصبٌ فيها (١) ═══
  const senior = await dept("الإدارة العليا", { leadershipOnly: true, colorHex: "#341D2B" });
  const counsel = await member({ name: `ريم القانونية${S}`, gender: "female", departmentId: senior.id, jobTitle: "المستشارة القانونية" });
  await prisma.seniorPosition.create({
    data: { departmentId: senior.id, titleAr: `المستشار القانوني${S}`, status: "active", holderMemberId: counsel.id, inviteName: counsel.fullName, inviteEmail: counsel.email, inviteState: "accepted", invitedById: founder.id, invitedByName: founder.fullName, acceptedAt: new Date() } as never,
  });
  const seniorCommittee = await committee(senior.id, `لجنة الاستراتيجية${S}`, counsel.id);

  // ═══ مسؤولُ تشغيلٍ وتحته فريق (٢) ═══
  const opsDept = await dept(`التشغيل والمتابعة${S}`);
  const ops = await prisma.user.create({ data: { fullName: `ماجد المتابعة${S}`, email: mail("ops"), passwordHash: "!", role: "operations_officer", departmentId: opsDept.id, isActive: true, gender: "male" } as never });
  const opsTeam = [];
  for (let i = 0; i < 3; i++) opsTeam.push(await member({ name: `عضو التشغيل ${i + 1}${S}`, gender: i % 2 ? "female" : "male", departmentId: opsDept.id }));

  // ═══ قسمٌ بلجنةٍ واحدة (٣)، ولجنةٌ بقائدٍ فقط (٧) ═══
  const hr = await dept(`شؤون الموظفين${S}`);
  const hrLead = await lead(`هند الموارد${S}`, "female", hr.id);
  const hrCLead = await member({ name: `نوال التوظيف${S}`, gender: "female", departmentId: hr.id });
  const hrCommittee = await committee(hr.id, `لجنة التوظيف والاعتماد${S}`, hrCLead.id);

  // ═══ قسمٌ بثلاث لجان (٤)، ولجنةٌ بقائدٍ وأعضاء (٦)، وشخصٌ بصورةٍ مرفوعة (١٠) ═══
  const media = await dept(`الإعلام الرقمي${S}`);
  const mediaLead = await lead(`فيصل الإعلام${S}`, "male", media.id);
  const withPhoto = await member({ name: `سلمى الصورة${S}`, gender: "female", departmentId: media.id, withPhoto: true, jobTitle: "مصمّمة" });
  const man = await member({ name: `خالد بلا صورة${S}`, gender: "male", departmentId: media.id }); // (١١)
  const woman = await member({ name: `منى بلا صورة${S}`, gender: "female", departmentId: media.id }); // (١٢)
  const unknown = await member({ name: `سامي بلا جنس${S}`, gender: null, departmentId: media.id }); // (١٣)
  const mediaCommittees = [];
  const content = await committee(media.id, `لجنة المحتوى${S}`, withPhoto.id);
  await join(content.id, withPhoto.id);
  await join(content.id, man.id, "منسّق المحتوى");
  await join(content.id, woman.id, "كاتبة");
  mediaCommittees.push(content);
  mediaCommittees.push(await committee(media.id, `لجنة التصميم${S}`, man.id));
  const events = await committee(media.id, `لجنة الفعاليات${S}`, woman.id);
  await join(events.id, unknown.id);
  mediaCommittees.push(events);

  // ═══ قسمٌ بلا قائد (١٤) بستّ لجان (٥)، ولجنةٌ بلا قائد (١٥)، ولجنةٌ مؤرشفة (١٧) ═══
  const gov = await dept(`الحوكمة${S}`);
  const govPeople = [];
  for (let i = 0; i < 6; i++) govPeople.push(await member({ name: `عضو الحوكمة ${i + 1}${S}`, gender: i % 2 ? "female" : "male", departmentId: gov.id }));
  const govNames = ["السياسات والالتزام", "الجودة والتميز", "المخاطر والامتثال", "المراجعة والتطوير", "التدقيق الداخلي"];
  const govCommittees = [];
  for (let i = 0; i < govNames.length; i++) govCommittees.push(await committee(gov.id, `لجنة ${govNames[i]}${S}`, govPeople[i].id));
  const vacantCommittee = await committee(gov.id, `لجنة الأخلاقيات${S}`, null);
  const archived = await prisma.department.create({ data: { name: `لجنة مؤرشفة${S}`, slug: slug("a"), colorHex: "#3366CC", parentId: gov.id, committeeStatus: "archived" } as never });

  // ═══ قائدُ قسمٍ له عضويةٌ في لجنة قسمٍ آخر (٨) — عبر سجلّه التوأم ═══
  await join(govCommittees[0].id, mediaLead.twin.id, "مستشار");
  // ═══ عضوٌ في أكثر من لجنة (٩) ═══
  const multi = await member({ name: `ليان المتعددة${S}`, gender: "female", departmentId: hr.id });
  await join(hrCommittee.id, multi.id, "مقابِلة");
  await join(govCommittees[1].id, multi.id, "مراجِعة");
  await join(govCommittees[2].id, multi.id);

  // ═══ قسمٌ كبير (١٦) وموظفٌ سابق (١٧) ═══
  const rnd = await dept(`البحث والتطوير${S}`);
  const rndLead = await lead(`عمر البحث${S}`, "male", rnd.id);
  const big = [];
  for (let i = 0; i < 28; i++) big.push(await member({ name: `باحث ${i + 1}${S}`, gender: i % 3 === 0 ? "female" : i % 3 === 1 ? "male" : null, departmentId: rnd.id }));
  const former = await member({ name: `موظف سابق${S}`, gender: "male", departmentId: rnd.id, active: false });

  // ═══ تعارضٌ في البيانات: رقمٌ وظيفيٌّ واحد لبريدين مختلفين — يُسجَّل ولا يُدمَج ═══
  const clash = await member({ name: `تعارض الرقم${S}`, gender: "male", departmentId: rnd.id });
  await prisma.member.update({ where: { id: clash.id }, data: { employeeNo: null } });
  await prisma.$executeRawUnsafe(`UPDATE "Member" SET "employeeNo" = $1 WHERE id = $2`, ops.employeeNo, clash.id);

  return {
    senior, counsel, seniorCommittee, opsDept, ops, opsTeam, hr, hrLead, hrCLead, hrCommittee, media, mediaLead, withPhoto, man, woman, unknown,
    mediaCommittees, gov, govPeople, govCommittees, vacantCommittee, archived, multi, rnd, rndLead, big, former, clash,
  };
}
