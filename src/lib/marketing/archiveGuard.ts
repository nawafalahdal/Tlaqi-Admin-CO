import type { MarketingArchiveStatus, Prisma } from "@prisma/client";
import type { prisma } from "@/lib/prisma";
import { abort } from "./result";

/** تجميدُ الحملة أثناء أرشفتها — في وحدةٍ خفيفةٍ بلا تكامل Google، فتُستورد في مسارات الكتابة كلِّها
 *  وتُستدعى داخل معاملاتها دون أن يُحمَّل في المعاملة ما يُبطئها حتى تنقضي مهلتُها. */

export const ACTIVE_ARCHIVE: MarketingArchiveStatus[] = ["pending", "writing", "verified", "deleting"];

/** لا يُعدَّل ما يُؤرشف أثناء أرشفته — وإلا اختلف الشيتُ عن مصدره */
export async function assertNotArchiving(db: Prisma.TransactionClient | typeof prisma, campaignId: string) {
  if (await db.marketingArchiveRun.count({ where: { campaignId, status: { in: ACTIVE_ARCHIVE } } })) abort("archive_active");
}
