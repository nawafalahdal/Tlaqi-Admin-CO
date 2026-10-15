/** عدّادُ الاستعلامات لكل مسار — يُقاس ولا يُخمَّن.
 *
 *  **ولماذا عددُ الاستعلامات لا الزمنُ وحده:** الزمنُ يقول إن ثَمَّ بطئاً،
 *  والعددُ يقول أين. وبه عُرف أن عرضَ صفحةِ إدارةٍ واحدةٍ كان يُطلق
 *  خمسةَ استعلاماتِ كنسٍ زائدةٍ قبل أن يَرسم حرفاً.
 *
 *  التشغيل: PRISMA_LOG_QUERIES=1 npx tsx scripts/measure-queries.ts
 */
import { prisma } from "../src/lib/prisma";
import { runDueSweeps } from "../src/lib/sweepThrottle";
import { sweepOverdueRequests, sweepExpiredCandidateAccounts } from "../src/lib/workflow";
import { sweepTicketEscalation } from "../src/lib/tickets";
import { buildOrgChart } from "../src/lib/orgChart";

if (process.env.PRISMA_LOG_QUERIES !== "1") {
  console.error("شغّله بـ PRISMA_LOG_QUERIES=1 وإلا فلا أحداثَ تُسجَّل");
  process.exit(1);
}

// **والمُنصِتُ على العميل نفسِه الذي تَستعمله المكتبات.**
// (أوّلُ قياسٍ أعطى صفراً في كل مسار: كنتُ أُنشئ عميلاً ثانياً وأُنصِت
//  إليه، والمكتباتُ تَستعمل عميلَ `@/lib/prisma` — فكان العدّادُ يَعدّ
//  استعلاماتِ عميلٍ لا أحدَ يَستعمله. والصفرُ كان خطأَ القياس لا نتيجتَه.)
let count = 0;
const tables = new Map<string, number>();
// @ts-expect-error — حدثُ `query` موجودٌ متى فُتح السجلّ حدثاً
prisma.$on("query", (e: { query: string }) => {
  count += 1;
  const m = /(?:from|into|update|join)\s+"public"\."([A-Za-z]+)"/i.exec(e.query);
  const t = m?.[1] ?? "—";
  tables.set(t, (tables.get(t) ?? 0) + 1);
});

async function measure(name: string, fn: () => Promise<unknown>) {
  count = 0;
  tables.clear();
  const t0 = Date.now();
  await fn();
  const detail = [...tables.entries()].map(([t, n]) => `${t}×${n}`).join(" ");
  console.log(`${String(count).padStart(3)} استعلاماً  ${String(Date.now() - t0).padStart(5)}ms  ${name}${detail ? `  [${detail}]` : ""}`);
  return count;
}

async function main() {
  // الكنوسُ عارية — كما كانت تُنادى من كل عَرْضِ صفحة
  const bare =
    (await measure("ثلاثةُ كنوسٍ عارية (ما كان يجري في كل عَرْض)", async () => {
      await sweepOverdueRequests();
      await sweepTicketEscalation();
      await sweepExpiredCandidateAccounts();
    }));

  // ومُقنَّنةً — بعد أن كُنست للتوّ أعلاه، فالمهلةُ قائمة
  const throttled = await measure("الثلاثةُ مُقنَّنةً وقد كُنست للتوّ", async () => {
    await runDueSweeps({
      overdue_requests: () => sweepOverdueRequests(),
      ticket_escalation: () => sweepTicketEscalation(),
      candidate_expiry: () => sweepExpiredCandidateAccounts(),
    });
  });

  await measure("buildOrgChart — بالختم لا بالبيانات", () => buildOrgChart());

  console.log(
    `\nالكنسُ من العَرْض: ${bare} ← ${throttled} استعلاماً (${bare - throttled} أقلّ في العَرْض المعتاد)`
  );
}

main().finally(() => prisma.$disconnect());
