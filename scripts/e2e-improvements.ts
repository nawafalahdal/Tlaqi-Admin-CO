/** مركزُ التحسين — المسارُ لا يُقفَز، ولا يُغلَق بإقرار من أصلحه.
 *
 *  **وما يُفحَص هنا هو الأحكامُ لا الحقول:** أن يُحفَظ نصٌّ في عمودٍ أمرٌ
 *  لا يَستحقّ فحصاً. وأن يَقف المسارُ عند `awaiting_user` حتى يَشهد
 *  صاحبُه، وأن تُستثنى التحسيناتُ من ساعة التصعيد — تلك أحكامٌ لو
 *  انكسرت لانكسر معها معنى المركز كلِّه.
 */
import { PrismaClient } from "@prisma/client";
import type { Session } from "next-auth";
import {
  submitImprovement,
  advanceImprovement,
  confirmImprovementFix,
  improvementInbox,
  improvementCounts,
  canTriage,
} from "../src/lib/improvements";
import { sweepTicketEscalation } from "../src/lib/tickets";

const prisma = new PrismaClient();
const log: string[] = [];
const chk = (name: string, ok: boolean, detail = "") =>
  log.push(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);

const sess = (id: string, role: string, name: string): Session =>
  ({ user: { id, role, name } }) as unknown as Session;

async function main() {
  const founder = await prisma.user.findFirstOrThrow({
    where: { role: "super_admin", isActive: true },
    select: { id: true, fullName: true },
  });
  const lead = await prisma.user.findFirstOrThrow({
    where: { role: "department_admin", isActive: true },
    select: { id: true, fullName: true },
  });

  const F = sess(founder.id, "super_admin", founder.fullName);
  const L = sess(lead.id, "department_admin", lead.fullName);

  const made: string[] = [];
  const findByNumber = async (n: number) =>
    prisma.ticket.findFirstOrThrow({ where: { ticketNumber: n } });

  // ── ١) الرفعُ يُنشئ تذكرةً حقيقية بنوعٍ وحالة
  const first = await submitImprovement({
    kind: "bug",
    title: "زرُّ الحفظ لا يُرى على الجوّال",
    note: "فتحتُ لوحةَ التنفيذ على جوّالي فلم أجد زرَّ الحفظ أسفل النموذج.",
    context: { path: "/admin/execution", viewport: "390×844", theme: "dark", locale: "ar" },
    session: L,
  });
  chk("الرفعُ يُقبَل من قائد قسم", first.ok, first.ok ? `#${first.ticketNumber}` : first.reason);
  if (!first.ok) throw new Error("لا يُكمَل الفحصُ بلا ملاحظة");
  const t1 = await findByNumber(first.ticketNumber);
  made.push(t1.id);

  chk("**وهي تذكرةٌ في جدول التذاكر لا جدولٌ ثانٍ**", !!t1.ticketNumber, `#${t1.ticketNumber}`);
  chk("ونوعُها عطب", t1.improvementKind === "bug", String(t1.improvementKind));
  chk("وحالتُها جديد", t1.improvementState === "new", String(t1.improvementState));
  chk("وحالةُ التذكرة الخشنةُ مفتوحة — والاثنتان تُكتَبان معاً",
      t1.status === "open", t1.status);
  chk("ووجهتُها المؤسس — صندوقُه هو", t1.targetUserId === founder.id);

  // ── ٢) السياقُ يُلتقَط ولا يَحمل غيرَ المُعلَن
  {
    const ctx = JSON.parse(t1.pageContext ?? "{}");
    chk("**وسياقُ الصفحة ملتقَطٌ — المسارُ أهمُّه**", ctx.path === "/admin/execution", ctx.path);
    chk("ومعه المقاسُ والسمةُ واللغة",
        ctx.viewport === "390×844" && ctx.theme === "dark" && ctx.locale === "ar");
    const keys = Object.keys(ctx).sort().join(",");
    chk("**ولا يَحمل حقلاً غيرَ المُعلَن**",
        keys.split(",").every((k) => ["path", "viewport", "theme", "locale", "agent"].includes(k)),
        keys);
  }
  // وما دُسّ فيه من حقولٍ زائدة يُطرَح
  {
    const sneaky = await submitImprovement({
      kind: "idea",
      title: "فكرةٌ بسياقٍ محشوّ",
      note: "نصٌّ كافٍ للقبول",
      context: { path: "/x", secret: "لا يُحفَظ", cookies: "ولا هذه" },
      session: L,
    });
    if (sneaky.ok) {
      const row = await findByNumber(sneaky.ticketNumber);
      made.push(row.id);
      chk("**وحقلٌ لم يُعلَن يُطرَح ولا يُحفَظ**",
          !(row.pageContext ?? "").includes("secret") && !(row.pageContext ?? "").includes("cookies"),
          row.pageContext ?? "");
    }
  }

  // ── ٣) المسارُ لا يُقفَز: لا يُقال «أُصلح» وهي لم تُبدأ
  {
    const jump = await advanceImprovement({ ticketId: t1.id, to: "awaiting_user", session: F });
    chk("**ولا يُقفَز من «جديد» إلى «ينتظر تجربتك»**", jump.ok === false,
        jump.ok === false ? jump.reason : "مرّ!");
    const resolved = await advanceImprovement({ ticketId: t1.id, to: "resolved", session: F });
    chk("ولا إلى «تمّ» رأساً", resolved.ok === false,
        resolved.ok === false ? resolved.reason : "مرّ!");
  }

  // ── ٤) ولا يُقرّر فيها إلا من يَملك الصندوق
  {
    const byLead = await advanceImprovement({ ticketId: t1.id, to: "triaged", session: L });
    chk("**ولا يُصنِّفها قائدُ قسم — الصندوقُ للمؤسس والتنفيذي**",
        byLead.ok === false, byLead.ok === false ? byLead.reason : "مرّ!");
    chk("و`canTriage` يقول ذلك صراحةً",
        canTriage("super_admin") && canTriage("executive") &&
          !canTriage("department_admin") && !canTriage("member"));
  }

  // ── ٥) المسارُ الصحيح: تصنيفٌ ثم عملٌ ثم انتظارُ صاحبه
  for (const to of ["triaged", "in_progress", "awaiting_user"] as const) {
    const step = await advanceImprovement({ ticketId: t1.id, to, session: F });
    chk(`المسارُ يَقبل «${to}»`, step.ok, step.ok ? "" : step.reason);
  }
  {
    const row = await findByNumber(first.ticketNumber);
    chk("وحالةُ التذكرة الخشنةُ تَتبعها — قيد المعالجة",
        row.status === "in_progress" && row.improvementState === "awaiting_user",
        `${row.status} / ${row.improvementState}`);
  }

  // ── ٦) ولا يَشهد بالإصلاح إلا صاحبُها
  {
    const byFounder = await confirmImprovementFix({ ticketId: t1.id, verified: true, session: F });
    chk("**ولا يَشهد المؤسسُ بزوال عطبٍ لم يَره — الشهادةُ لصاحبها**",
        byFounder.ok === false, byFounder.ok === false ? byFounder.reason : "مرّ!");
  }

  // ── ٧) وصاحبُها إن وجدها كما كانت أعادها إلى العمل
  {
    const rejected = await confirmImprovementFix({
      ticketId: t1.id, verified: false, note: "ما زال الزرُّ مخفيّاً", session: L,
    });
    chk("صاحبُها يقول «ما زالت كما هي»", rejected.ok, rejected.ok ? rejected.state : rejected.reason);
    const row = await findByNumber(first.ticketNumber);
    chk("**فتعود إلى العمل لا تُغلَق**", row.improvementState === "in_progress",
        String(row.improvementState));
    chk("ويُسجَّل أنه جرّبها فردّها", row.userRejectedAt !== null);
    chk("ولا يبقى عليها ختمُ حلٍّ", row.resolvedAt === null);
  }

  // ── ٨) ثم أُصلحت فشهد بزوالها
  await advanceImprovement({ ticketId: t1.id, to: "awaiting_user", session: F });
  {
    const ok = await confirmImprovementFix({ ticketId: t1.id, verified: true, session: L });
    chk("وبعد إصلاحٍ ثانٍ يَشهد بزوالها", ok.ok, ok.ok ? ok.state : ok.reason);
    const row = await findByNumber(first.ticketNumber);
    chk("**فتصير «تمّ وأُقِرّ» — لا قبلَ شهادته**",
        row.improvementState === "resolved" && row.userVerifiedAt !== null,
        String(row.improvementState));
    chk("وحالةُ التذكرة الخشنةُ محلولة", row.status === "resolved", row.status);
  }

  // ── ٩) والإغلاقُ يُسمّي سببَه
  {
    const second = await submitImprovement({
      kind: "idea", title: "فكرةٌ لن تُنفَّذ", note: "اقتراحٌ خارج نطاق المنصة", session: L,
    });
    if (second.ok) {
      const row = await findByNumber(second.ticketNumber);
      made.push(row.id);
      const bare = await advanceImprovement({ ticketId: row.id, to: "closed", session: F });
      chk("**ولا تُغلَق ملاحظةٌ بلا سبب — السكوتُ يُقرأ تجاهلاً**",
          bare.ok === false, bare.ok === false ? bare.reason : "مرّ!");
      const withWhy = await advanceImprovement({
        ticketId: row.id, to: "closed", note: "خارج نطاق المنصة الآن", session: F,
      });
      chk("وبسببٍ مكتوبٍ تُغلَق", withWhy.ok, withWhy.ok ? "" : withWhy.reason);
      const after = await findByNumber(second.ticketNumber);
      chk("والسببُ محفوظٌ يقرؤه صاحبُها",
          (after.resolutionNote ?? "").includes("خارج نطاق"), after.resolutionNote ?? "");
    }
  }

  // ── ١٠) وضغطتان متسارعتان تَمرّان مرّةً واحدة
  {
    const race = await submitImprovement({
      kind: "bug", title: "ملاحظةُ تسابق", note: "نصٌّ كافٍ للقبول", session: L,
    });
    if (race.ok) {
      const row = await findByNumber(race.ticketNumber);
      made.push(row.id);
      const [a, b] = await Promise.all([
        advanceImprovement({ ticketId: row.id, to: "triaged", session: F }),
        advanceImprovement({ ticketId: row.id, to: "triaged", session: F }),
      ]);
      // إحداهما تَنجح والأخرى إمّا تُردّ أو تَقرأ الحالةَ الجديدةَ فتَمضي —
      // والمهمُّ ألّا تُكتَب الحالةُ مرّتين ولا تُسقِط الصفحة
      chk("**وضغطتان متسارعتان لا تَكسران الحالة**",
          [a.ok, b.ok].some(Boolean), `${a.ok} / ${b.ok}`);
      const fin = await findByNumber(race.ticketNumber);
      chk("والحالةُ واحدةٌ بعدهما", fin.improvementState === "triaged",
          String(fin.improvementState));
    }
  }

  // ── ١١) **والتحسيناتُ خارج ساعة التصعيد**
  //
  //     وهذا أهمُّ حكمٍ في الملفّ: لو مرّت على مسار التذاكر لبلغت
  //     المؤسسَ في يومين ومعها بريدٌ في كل مرحلة.
  {
    const old = await submitImprovement({
      kind: "confusing", title: "ملاحظةٌ قديمة", note: "نصٌّ كافٍ للقبول", session: L,
    });
    if (old.ok) {
      const row = await findByNumber(old.ticketNumber);
      made.push(row.id);
      // تُرجَع مهلتُها إلى الماضي: لو كانت تذكرةً عاديةً لصُعِّدت الآن
      await prisma.ticket.update({
        where: { id: row.id },
        data: { stageDueAt: new Date(Date.now() - 3 * 86_400_000) },
      });
      await sweepTicketEscalation();
      const after = await findByNumber(old.ticketNumber);
      chk("**ولا يُصعِّدها الكنسُ ولو انقضت مهلتُها**",
          after.stage === "department", after.stage);
      chk("وحالتُها كما كانت", after.improvementState === "new", String(after.improvementState));
    }
  }

  // ── ١٢) الصندوقُ والعدّادات
  {
    const inbox = await improvementInbox();
    chk("الصندوقُ يُعيد القائمةَ لمن يُقرّر", inbox.length > 0, `${inbox.length} ملاحظة`);
    chk("**والمُغلَقُ مطويٌّ عنه — الصندوقُ موضعُ عملٍ لا أرشيف**",
        inbox.every((t) => t.improvementState !== "closed"));
    const withClosed = await improvementInbox({ includeClosed: true });
    chk("ويُفتَح بطلبٍ صريح", withClosed.length >= inbox.length,
        `${inbox.length} ← ${withClosed.length}`);

    const counts = await improvementCounts(F);
    chk("وعدّادُ الصندوق يُقال للمؤسس", counts.inbox >= 0, String(counts.inbox));
    const leadCounts = await improvementCounts(L);
    chk("**ولا يُقال لمن لا يَملكه — صفرٌ لا رقمٌ يُغريه**",
        leadCounts.inbox === 0, String(leadCounts.inbox));
  }

  // ── تنظيف
  for (const id of made) await prisma.ticket.deleteMany({ where: { id } });

  console.log(log.join("\n"));
  const failed = log.some((l) => l.startsWith("✗"));
  console.log("\n" + (failed ? "FAILURES PRESENT" : "ALL PASS"));
  process.exitCode = failed ? 1 : 0;
}

main().finally(() => prisma.$disconnect());
