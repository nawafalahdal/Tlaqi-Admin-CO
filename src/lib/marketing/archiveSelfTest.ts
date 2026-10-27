import { randomBytes } from "node:crypto";
import type { ArchiveStore } from "./archiveSheet";
import { ARCHIVE_TABS, COL, tabOf } from "./archiveLayout";
import { writeAndVerify, campaignRowsInSheet, searchIndex } from "./archive";

/** فحصُ التكامل الحقيقي لملف الأرشيف — على ملف الاختبار وحده (المعاينة)، ببياناتٍ مصطنعةٍ موسومة.
 *
 *  يمرّ بالمسار الذي تمرّ به الأرشفةُ نفسُها (`writeAndVerify`، `campaignRowsInSheet`، `searchIndex`)
 *  على Google Sheets الحقيقي وبحساب خدمة المنصة، بلا قاعدةٍ ولا حملةٍ حقيقية ولا حذف:
 *    ضمانُ التبويبات ← كتابةٌ ثم قراءةٌ ومطابقة ← إعادةٌ لا تكرّر صفّاً ← كشفُ صفٍّ لا يطابق ←
 *    بحثٌ في الفهرس وتصفّح ← استرجاعُ الحملة تبويباً تبويباً ← حملةٌ غيرُ موجودة.
 *  والصفوفُ تبقى في ملف الاختبار موسومةً «اختبار تكامل — لا تُنشر». ولا يُعاد معرّفُ الملف ولا شيءٌ من
 *  بيانات الاعتماد في النتيجة. */
export async function runArchiveSelfTest(store: ArchiveStore) {
  const stamp = new Date();
  const campaignId = `selftest-${stamp.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${randomBytes(2).toString("hex")}`;
  const runId = `${campaignId}-run`;
  const at = stamp.toISOString();
  const name = "اختبار تكامل — لا تُنشر";
  const row = (key: string, type: string, o: Partial<Record<"platform" | "contentType" | "item" | "status" | "planned" | "actual" | "person" | "result" | "link", string>>, details: unknown = {}) => {
    tabOf(type);
    return [`${campaignId}:${key}`, campaignId, type, name, "2026-12-01", "2026-12-30", o.platform ?? "", o.contentType ?? "", o.item ?? "", o.status ?? "",
      o.planned ?? "", o.actual ?? "", o.person ?? "", o.result ?? "", o.link ?? "", JSON.stringify(details), at, runId];
  };
  const expected = [
    row("campaign", "campaign", { platform: "instagram", contentType: "post", item: name, status: "archived", planned: "1", actual: "1", person: "فحص آلي", result: "خطة نسخة 1" }, { selfTest: true }),
    row("brief:objective", "brief", { item: "الهدف", result: "التحقق من الكتابة والقراءة والمطابقة" }),
    row("brief:budget", "brief", { item: "الميزانية", result: "غير محدّدة" }),
    row("piece:p1", "piece", { platform: "instagram", contentType: "post", item: "قطعة اختبار", status: "published", planned: "2026-12-10T17:30:00.000Z", actual: "2026-12-10T17:31:00.000Z", link: "https://www.instagram.com/p/selftest/" }, { finalText: { version: 1, body: "نصٌّ للاختبار — لا يُنشر" } }),
    row("calendar:p1:publish", "calendar", { item: "قطعة اختبار — النشر", status: "done", planned: "2026-12-10T17:30:00.000Z", actual: "2026-12-10T17:31:00.000Z" }),
    row("task:t1", "task", { item: "نشر قطعة الاختبار", status: "done", result: "publishing" }),
    row("content:v1", "content_version", { item: "قطعة اختبار — نص 1", status: "الحالية", actual: at, person: "فحص آلي" }, { body: "نصٌّ للاختبار" }),
    row("approval:a1", "approval", { item: "قطعة اختبار — content 1", status: "قائم", actual: at, result: "approved" }),
    row("quality:q1", "quality", { item: "قطعة اختبار — نص 1 / تصميم 1", status: "قائم", actual: at, result: "اجتاز" }),
    row("publication:pub1", "publication", { platform: "instagram", item: "قطعة اختبار", status: "منشور", actual: "2026-12-10T17:31:00.000Z", result: "لا نتائج مسجّلة", link: "https://www.instagram.com/p/selftest/" }, { timezone: "Asia/Riyadh" }),
    row("file:f1", "file", { item: "design.png", status: "design", actual: at, result: "1024 بايت" }, { fileArchived: false }),
    row("event:e1", "event", { item: "archive.selftest", actual: at, person: "فحص آلي (system)" }),
    row(`run:${runId}`, "run", { item: `أرشفة «${name}»`, status: "طُلبت", actual: at, person: "فحص آلي" }, { runId }),
  ];

  const steps: { name: string; ok: boolean; ms: number; detail?: unknown }[] = [];
  const step = async (label: string, fn: () => Promise<{ ok: boolean; detail?: unknown }>) => {
    const t0 = Date.now();
    try {
      const r = await fn();
      steps.push({ name: label, ok: r.ok, ms: Date.now() - t0, detail: r.detail });
    } catch (e) {
      steps.push({ name: label, ok: false, ms: Date.now() - t0, detail: { error: e instanceof Error ? e.name : "unknown" } });
    }
  };

  await step("ensure_tabs", async () => {
    const r = await store.ensure();
    return { ok: true, detail: r };
  });
  await step("write_read_verify", async () => {
    const r = await writeAndVerify(store, campaignId, expected);
    return { ok: r.ok && r.appended === expected.length && r.verified === expected.length, detail: r };
  });
  await step("retry_no_duplicates", async () => {
    const r = await writeAndVerify(store, campaignId, expected);
    return { ok: r.ok && r.appended === 0 && r.verified === expected.length, detail: r };
  });
  await step("mismatch_detected", async () => {
    const tampered = expected.map((r, i) => (i === 3 ? r.map((v, j) => (j === COL.item ? `${v} (مختلف)` : v)) : r));
    const r = await writeAndVerify(store, campaignId, tampered);
    return { ok: !r.ok && r.code === "sheet_mismatch:1" && r.retryable, detail: r };
  });
  await step("search_index", async () => {
    const r = await searchIndex(store, { text: campaignId });
    const hit = r.results[0];
    return { ok: r.total === 1 && hit?.campaignId === campaignId && hit.pieces === 1 && hit.published === 1 && hit.platforms.includes("instagram"), detail: { total: r.total, pages: r.pages, hit } };
  });
  await step("browse_paged", async () => {
    const r = await searchIndex(store, { page: 1 });
    return { ok: r.total >= 1 && r.results.length <= 20 && r.page === 1, detail: { total: r.total, pages: r.pages, onPage: r.results.length } };
  });
  await step("retrieve_by_tab", async () => {
    const byTab = await campaignRowsInSheet(store, campaignId);
    const placed = expected.every((e) => (byTab[tabOf(e[COL.type]).name] ?? []).some((r) => r[COL.key] === e[COL.key]));
    const count = Object.values(byTab).reduce((n, rs) => n + rs.length, 0);
    return { ok: placed && count === expected.length, detail: { rows: count, tabs: Object.fromEntries(Object.entries(byTab).map(([t, rs]) => [t, rs.length])) } };
  });
  await step("missing_campaign", async () => {
    const byTab = await campaignRowsInSheet(store, `${campaignId}-none`);
    return { ok: Object.keys(byTab).length === 0 };
  });
  return { ok: steps.every((s) => s.ok), campaignId, tabs: ARCHIVE_TABS.map((t) => t.name), rows: expected.length, steps, at };
}
