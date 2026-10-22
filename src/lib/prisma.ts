import { PrismaClient } from "@prisma/client";
import { databaseBlocked, BLOCKED_DATABASE_URL } from "@/lib/deploymentEnv";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/** تسجيلُ الاستعلامات — يُفتَح بمتغيّرِ بيئةٍ ولا يُفتَح في الإنتاج.
 *
 *  **ولماذا هو جزءٌ من الملفّ لا رقعةٌ مؤقّتة:** قياسُ الأداء يَحتاج أن
 *  يَعرف **كم استعلاماً** يُطلَق في مسارٍ لا كم ثانيةً استغرق — فالثانيةُ
 *  تُخبر أن ثَمَّ بطئاً، وعددُ الاستعلامات يُخبر **أين**. وقد قِستُ به
 *  فوجدتُ عرضَ صفحةٍ واحدةٍ يُطلق خمسةَ استعلاماتِ كنسٍ زائدة، و
 *  `alertsForUser` أربعةَ عشر، و`buildOrgChart` عشرة — ولولا العدّ ما
 *  عُرف موضعُ أيٍّ منها.
 *
 *  فبقي مفتوحاً بـ`PRISMA_LOG_QUERIES=1` ليُعاد القياسُ متى لزم، ولا
 *  أثرَ له إن لم يُضبَط: الخيارُ نفسُه لا يُمرَّر.
 */
const logQueries = process.env.PRISMA_LOG_QUERIES === "1";

/** معاينةٌ لم تُعزَل قاعدتُها لا تتّصل بقاعدة الإنتاج أبداً: يُعطى العميلُ
 *  عنواناً لا يُحَلّ، فيفشل كلُّ استعلامٍ قبل أن يبلغ أيَّ قاعدة —
 *  قراءةً وكتابةً، من صفحةٍ أو إجراءٍ أو مسار API (`deploymentEnv.ts`). */
const blocked = databaseBlocked();

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    ...(logQueries ? { log: [{ emit: "event" as const, level: "query" as const }] } : {}),
    ...(blocked ? { datasourceUrl: BLOCKED_DATABASE_URL } : {}),
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
