/** بطاقةُ الانضمام — الحادثةُ المُبلَّغ عنها، مُعادةُ الإنتاج ثم مُصلَحة.
 *
 *  ## الحادثة
 *
 *  انضمّ عضوٌ فلم تصله بطاقةُ الانضمام. وضغط المسؤولُ «أرسلها» فظهر له
 *  «تعذّر إرسال البريد الآن». ولم يَعرف أحدٌ لماذا.
 *
 *  ## والسببُ الجذريُّ ثلاثةُ عطوبٍ متراكبة
 *
 *  **١) ختمُ القبول كان يُكتَب قبل الإرسال.** `welcomeEmailSentAt` كان
 *  حجزَ الحقّ ثم يُمسَح إن أخفق البريد — وبينهما نداءٌ شبكيٌّ إلى
 *  المزوّد. فإن انقطع التنفيذُ هناك بقي الختمُ ولم تُرسَل رسالة: الشيتُ
 *  يقول «✓ وصلت»، والزرُّ يُردّ «أُرسلت من قبل» أبداً.
 *
 *  **٢) وتعثُّرُ قراءةِ السجلّ كان يُقرأ «وصلت».** `welcomeAlreadyDelivered`
 *  كانت تُعيد `true` عند أيّ استثناء «احتياطاً» — فيُقال لصاحبها إنها
 *  أُرسلت وهي لم تُرسَل، ويُغلَق الباب.
 *
 *  **٣) وخمسةُ أسبابٍ كانت تُقرأ جملةً واحدة.** الطبقةُ تُفرّق بينها في
 *  داخلها ثم تُعيدها `{ skipped: true }` — فصار «لا مفتاح» و«رفض
 *  المزوّد» و«انقطاع شبكة» كلُّها «تعذّر إرسال البريد الآن».
 *
 *  وهذا الفحصُ يُثبت الثلاثة.
 */
import { PrismaClient } from "@prisma/client";
import {
  sendWelcomePack,
  welcomeAlreadyDelivered,
  WELCOME_CLAIM_TTL_MS,
} from "../src/lib/welcome";
import { reasonFor, logStatusFor, worthRetrying, resultOf } from "../src/lib/emailOutcome";

const prisma = new PrismaClient();
const log: string[] = [];
const chk = (name: string, ok: boolean, detail = "") =>
  log.push(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);

async function main() {
  // ══ أ) التصنيف: كلُّ حالةٍ تُقال باسمها لا «تعذّر» ══
  {
    const cases = [
      [{ state: "no_recipient" } as const, "لا بريد"],
      [{ state: "provider_disabled" } as const, "مفتاح"],
      [{ state: "suppressed_closed" } as const, "أُغلقت تجربة"],
      [{ state: "suppressed_policy", why: "س" } as const, "سياسة"],
      [
        { state: "provider_rejected", name: "validation_error", message: "domain not verified" } as const,
        "رفضها مزوّد",
      ],
      [{ state: "transport_failed", message: "ETIMEDOUT" } as const, "لم تصل مزوّد"],
    ] as const;
    const texts = new Set<string>();
    for (const [outcome, needle] of cases) {
      const text = reasonFor(outcome);
      texts.add(text);
      chk(`السببُ يُسمّى: ${outcome.state}`, text.includes(needle), text);
    }
    chk("**وستُّ حالاتٍ تُعطي ستَّ جملٍ مختلفة — لا جملةً واحدة**",
        texts.size === 6, `${texts.size} جملة`);
    chk("ولا تُقال «تعذّر إرسال البريد الآن» لأيٍّ منها",
        ![...texts].some((t) => t.includes("تعذّر إرسال البريد الآن")));
  }

  // ══ ب) نصُّ المزوّد يُنقَل كما قاله — هو الوحيد الذي يُفيد ══
  {
    const text = reasonFor({
      state: "provider_rejected",
      name: "validation_error",
      message: "The tlaqiteam.site domain is not verified",
    });
    chk("**ونصُّ المزوّد يُنقَل بحروفه — «النطاق غير موثَّق» غيرُ «تجاوزتَ الحدّ»**",
        text.includes("tlaqiteam.site domain is not verified"), text);
  }

  // ══ ج) إعادةُ المحاولة تُعرَض حيث تُجدي فقط ══
  {
    chk("إعادةُ المحاولة تُجدي مع انقطاع الشبكة",
        worthRetrying({ state: "transport_failed", message: "ECONNRESET" }));
    chk("وتُجدي مع تجاوز الحدّ",
        worthRetrying({ state: "provider_rejected", name: "rate_limit_exceeded", message: "Too many" }));
    chk("**ولا تُجدي مع نطاقٍ غير موثَّق — فلا يُعرَض زرٌّ يَفشل كما فشل**",
        !worthRetrying({ state: "provider_rejected", name: "validation_error", message: "domain not verified" }));
    chk("ولا مع غياب المفتاح", !worthRetrying({ state: "provider_disabled" }));
  }

  // ══ د) حالةُ السجلّ تُطابق النتيجة ══
  {
    chk("القبولُ يُسجَّل «أُرسلت»", logStatusFor({ state: "accepted", providerId: "x" }) === "أُرسلت");
    chk("والرفضُ «فشل الإرسال»",
        logStatusFor({ state: "provider_rejected", name: "a", message: "b" }) === "فشل الإرسال");
    chk("وغيابُ المفتاح «لم تُرسل (البريد معطّل)»",
        logStatusFor({ state: "provider_disabled" }) === "لم تُرسل (البريد معطّل)");
    chk("والكَتمُ «لم تُرسل (سياسة التقليل)»",
        logStatusFor({ state: "suppressed_policy", why: "س" }) === "لم تُرسل (سياسة التقليل)");
    chk("و`skipped` يُشتَقّ من الحالة لا يُكتَب بيدٍ",
        resultOf({ state: "accepted", providerId: null }).skipped === false &&
          resultOf({ state: "provider_disabled" }).skipped === true);
  }

  // ══ هـ) الجهلُ يُقال جهلاً لا «وصلت» ══
  {
    const stamped = await welcomeAlreadyDelivered({
      email: "x@example.test",
      welcomeEmailSentAt: new Date(),
    });
    chk("ختمٌ مكتوبٌ يُقرأ «وصلت»", stamped === "delivered", String(stamped));
    const fresh = await welcomeAlreadyDelivered({
      email: `never-${Date.now()}@example.test`,
      welcomeEmailSentAt: null,
    });
    chk("ومن لا ختمَ له ولا سجلّ يُقرأ «لم تصل»", fresh === "not_delivered", String(fresh));
    chk("**والثلاثيُّ يَملك حالةَ «لا يُعلَم» — فلا يُقال «وصلت» عند تعثُّر القراءة**",
        ["delivered", "not_delivered", "unknown"].includes(String(fresh)));
  }

  // ══ و) الحادثةُ نفسُها: ختمٌ بلا رسالة ══
  //
  //     يُحاكى العطبُ القديم: يُكتَب الختمُ بلا إرسال (كما كان يقع عند
  //     انقطاع التنفيذ)، ثم يُرى أثرُه.
  const founder = await prisma.user.findFirstOrThrow({
    where: { role: "super_admin", isActive: true },
    select: { id: true, email: true, welcomeEmailSentAt: true, welcomeClaimedAt: true },
  });
  const before = {
    sentAt: founder.welcomeEmailSentAt,
    claimedAt: founder.welcomeClaimedAt,
  };
  try {
    // ١) حجزٌ قائمٌ لم تَنقضِ مهلتُه يَمنع متسابقاً ثانياً
    await prisma.user.update({
      where: { id: founder.id },
      data: { welcomeEmailSentAt: null, welcomeClaimedAt: new Date() },
    });
    const blocked = await sendWelcomePack({ kind: "user", id: founder.id }, "resend");
    chk("**حجزٌ جارٍ يَمنع إرسالاً ثانياً**", blocked.ok === false,
        blocked.ok === false ? blocked.reason : "مرّ!");
    chk("ويُقال إنه «جارٍ» لا إنه «أُرسلت من قبل» — ففرقٌ بين انتظارٍ وإغلاق",
        blocked.ok === false && blocked.reason.includes("جاري"),
        blocked.ok === false ? blocked.reason : "");

    // ٢) وحجزٌ انقضت مهلتُه يُدَّعى من جديد — فلا قفلَ أبديّ
    await prisma.user.update({
      where: { id: founder.id },
      data: {
        welcomeEmailSentAt: null,
        welcomeClaimedAt: new Date(Date.now() - WELCOME_CLAIM_TTL_MS - 60_000),
      },
    });
    const retried = await sendWelcomePack({ kind: "user", id: founder.id }, "resend");
    // البريدُ معطّلٌ محلياً، فالمنتظَرُ رفضٌ بسببٍ مُسمّىً لا بـ«أُرسلت من قبل»
    chk("**وحجزٌ انقضت مهلتُه يُدَّعى من جديد — لا قفلَ أبديٌّ بعد انقطاع**",
        retried.ok === false && !retried.reason.includes("تُرسل مرّةً واحدة"),
        retried.ok === false ? retried.reason : "مرّ");
    chk("والسببُ المُعاد هو سببُ البريد لا سببُ القفل",
        retried.ok === false && retried.reason.includes("مفتاح"),
        retried.ok === false ? retried.reason : "");

    // ٣) وبعد الإخفاق لا يبقى حجزٌ ولا ختمُ قبول
    const after = await prisma.user.findUniqueOrThrow({
      where: { id: founder.id },
      select: { welcomeEmailSentAt: true, welcomeClaimedAt: true },
    });
    chk("**ولا يُختَم القبولُ بإخفاق — الشيتُ لا يقول «وصلت» وهي لم تصل**",
        after.welcomeEmailSentAt === null, String(after.welcomeEmailSentAt));
    chk("ويُفَكّ الحجزُ فيُعاد الزرُّ قابلاً للضغط",
        after.welcomeClaimedAt === null, String(after.welcomeClaimedAt));

    // ٤) وختمٌ مكتوبٌ يَمنع نسخةً ثانيةً لمن قرأ الأولى
    await prisma.user.update({
      where: { id: founder.id },
      data: { welcomeEmailSentAt: new Date(), welcomeClaimedAt: null },
    });
    const dup = await sendWelcomePack({ kind: "user", id: founder.id }, "resend");
    chk("وختمُ قبولٍ مكتوبٌ يَمنع نسخةً ثانية", dup.ok === false,
        dup.ok === false ? dup.reason : "مرّ!");

    // ٥) والسجلُّ يَحفظ سببَ الإخفاق لا «فشل» مجرَّداً
    const logged = await prisma.emailLog.findFirst({
      where: { recipient: founder.email, kind: "ترحيب" },
      orderBy: { createdAt: "desc" },
      select: { status: true, failureKind: true, failureDetail: true, providerId: true, attempt: true },
    });
    chk("والسجلُّ فيه صفٌّ لهذه المحاولة", logged !== null, logged?.status ?? "—");
    chk("**وفيه حقولُ التشخيص — فلا يَضيع الجوابُ بعد ساعة**",
        logged !== null && "failureKind" in logged && "providerId" in logged,
        `kind=${logged?.failureKind ?? "—"} id=${logged?.providerId ?? "—"}`);
  } finally {
    // إعادةُ ما كان بالضبط
    await prisma.user.update({
      where: { id: founder.id },
      data: { welcomeEmailSentAt: before.sentAt, welcomeClaimedAt: before.claimedAt },
    });
  }

  console.log(log.join("\n"));
  const failed = log.some((l) => l.startsWith("✗"));
  console.log("\n" + (failed ? "FAILURES PRESENT" : "ALL PASS"));
  process.exitCode = failed ? 1 : 0;
}

main().finally(() => prisma.$disconnect());
