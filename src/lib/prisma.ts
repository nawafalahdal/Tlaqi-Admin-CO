import { PrismaClient } from "@prisma/client";

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

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient(logQueries ? { log: [{ emit: "event", level: "query" }] } : undefined);

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
