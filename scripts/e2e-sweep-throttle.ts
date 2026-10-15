/** تقنينُ الكنس — الادّعاءُ واحدٌ ولو تسابق عليه اثنان.
 *
 *  **وهذا هو الفحصُ الذي يَستحقّ أن يُكتَب:** «لا يُكنَس إلا مرّةً كلَّ
 *  ربع ساعة» دعوى يُصدّقها عدّادٌ في ذاكرة لامبدا واحدة ويُكذّبها
 *  واقعُ لامبدا تَين. فالفحصُ يُشغّل النداءَين **معاً** ويَعدّ كم مرّةً
 *  جرى العمل.
 */
import { PrismaClient } from "@prisma/client";
import { runDueSweeps, claimDueSweeps, SWEEP_WINDOW_MS } from "../src/lib/sweepThrottle";

const prisma = new PrismaClient();
const log: string[] = [];
const chk = (name: string, ok: boolean, detail = "") =>
  log.push(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);

const KEY = "ticket_escalation" as const;
const LONG_AGO = new Date("1970-01-01T00:00:00Z");

async function rewind(to: Date) {
  await prisma.sweepRun.upsert({
    where: { key: KEY },
    update: { lastRunAt: to },
    create: { key: KEY, lastRunAt: to },
  });
}

async function main() {
  const before = await prisma.sweepRun.findUnique({ where: { key: KEY } });

  // ── ١) الصفوفُ مزروعةٌ في الترحيل، فالادّعاءُ تحديثٌ لا إنشاء
  const seeded = await prisma.sweepRun.findMany({ select: { key: true } });
  const keys = seeded.map((r) => r.key).sort();
  chk(
    "**مفاتيحُ الكنوس الثلاثة مزروعةٌ في الترحيل**",
    ["candidate_expiry", "overdue_requests", "ticket_escalation"].every((k) => keys.includes(k)),
    keys.join("، ")
  );

  // ── ٢) متسابقان على صفٍّ واحد: واحدٌ يَكنس لا اثنان
  await rewind(LONG_AGO);
  let runs = 0;
  const work = async () => {
    runs += 1;
  };
  const [a, b] = await Promise.all([
    runDueSweeps({ [KEY]: work }),
    runDueSweeps({ [KEY]: work }),
  ]);
  chk("**متسابقان معاً — والعملُ يجري مرّةً واحدة**", runs === 1, `جرى ${runs} مرّة`);
  chk("وواحدٌ منهما وحده يُقرّ بأنه كَنَس",
      a.length + b.length === 1, `[${a.join()}] / [${b.join()}]`);

  // ── ٣) ومن جاء بعدهما في المهلة لا يَكنس
  runs = 0;
  const third = await runDueSweeps({ [KEY]: work });
  chk("ومن جاء في المهلة يَمضي بلا كنس", third.length === 0 && runs === 0,
      `جرى ${runs} مرّة`);

  // ── ٤) ومتى انقضت المهلة عاد الكنس
  await rewind(new Date(Date.now() - SWEEP_WINDOW_MS - 1000));
  runs = 0;
  const after = await runDueSweeps({ [KEY]: work });
  chk("**ومتى انقضت المهلة عاد الكنس — فلا يُعطَّل بالتقنين**",
      after.length === 1 && runs === 1, `جرى ${runs} مرّة`);

  // ── ٥) والختمُ يُكتَب وقتَ الادّعاء لا بعد انتهاء العمل
  const stamped = await prisma.sweepRun.findUniqueOrThrow({ where: { key: KEY } });
  chk("والختمُ محدَّثٌ إلى الآن", Date.now() - stamped.lastRunAt.getTime() < 60_000,
      stamped.lastRunAt.toISOString());

  // ── ٦) ومهلةٌ صفرٌ تَكنس دائماً — الكنسُ المجدول لا يُقنَّن
  //
  //     والمجدولُ (`/api/cron/sweep`) لا يمرّ بـ`sweepIfDue` أصلاً: يُنادي
  //     الكنوسَ عارية. وهذا الفحصُ يُثبت أن التقنين نفسه لا يَحبس من
  //     لا مهلةَ عليه.
  runs = 0;
  await runDueSweeps({ [KEY]: work }, 0);
  chk("ومن لا مهلةَ عليه يَكنس دائماً", runs === 1, `جرى ${runs} مرّة`);

  // ── ٧) والمفاتيحُ الثلاثةُ تُدَّعى بجملةٍ واحدة لا بثلاث
  //
  //     (هذا ما سقط في أوّل تطبيق: كلُّ مفتاحٍ بـ`updateMany` خاصّة،
  //      فلفّها Prisma في معاملةٍ لكلٍّ — تسعُ جُملٍ بدل خمس. فصار
  //      التقنينُ يَزيد الرحلاتِ بدل أن يُنقصها.)
  await rewind(LONG_AGO);
  await prisma.sweepRun.updateMany({
    where: { key: { in: ["overdue_requests", "candidate_expiry"] } },
    data: { lastRunAt: LONG_AGO },
  });
  const allThree = await claimDueSweeps(
    ["overdue_requests", "ticket_escalation", "candidate_expiry"]
  );
  chk("**ثلاثةُ مفاتيحَ تُدَّعى معاً في جملةٍ واحدة**", allThree.size === 3,
      [...allThree].sort().join("، "));
  const again = await claimDueSweeps(
    ["overdue_requests", "ticket_escalation", "candidate_expiry"]
  );
  chk("ولا يُدَّعى شيءٌ منها مرّتين في المهلة", again.size === 0, String(again.size));

  // إعادةُ ما كان
  if (before) await rewind(before.lastRunAt);

  console.log(log.join("\n"));
  const failed = log.some((l) => l.startsWith("✗"));
  console.log("\n" + (failed ? "FAILURES PRESENT" : "ALL PASS"));
  process.exitCode = failed ? 1 : 0;
}

main().finally(() => prisma.$disconnect());
