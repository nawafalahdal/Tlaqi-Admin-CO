import { randomBytes } from "node:crypto";
import type { ArchiveStore } from "./archiveSheet";
import { ARCHIVE_TABS, COL, INDEX_TAB, POSTS_TAB, rowOf, tabOf } from "./archiveLayout";
import { writeAndVerify, campaignRowsInSheet, searchIndex } from "./archive";

/** فحصُ التكامل الحقيقي لملف الأرشيف — على ملف الاختبار وحده (المعاينة)، ببياناتٍ مصطنعةٍ موسومة.
 *
 *  يمرّ بالمسار الذي تمرّ به الأرشفةُ نفسُها (`writeAndVerify`، `campaignRowsInSheet`، `searchIndex`)
 *  على Google Sheets الحقيقي وبحساب خدمة المنصة، بلا قاعدةٍ ولا حملةٍ حقيقية ولا حذف:
 *    ضمانُ التبويبات وتنسيقها ← أرشفةُ منشورٍ وحده (صفوفُه فقط) ← أرشفةُ منشورٍ ثانٍ لا تعدّ الأولَ
 *    «زائداً» ← أرشفةُ الحملة كلِّها بما كُتب قبلها ← إعادةٌ لا تكرّر صفّاً ← كشفُ صفٍّ لا يطابق ←
 *    بحثٌ وتصفّح ← استرجاعُ الحملة تبويباً تبويباً ← حملةٌ غيرُ موجودة.
 *  والصفوفُ تبقى في ملف الاختبار موسومةً «اختبار تكامل — لا تُنشر». ولا يُعاد معرّفُ الملف ولا شيءٌ من
 *  بيانات الاعتماد في النتيجة. */
export async function runArchiveSelfTest(store: ArchiveStore) {
  const stamp = new Date();
  const campaignId = `selftest-${stamp.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${randomBytes(2).toString("hex")}`;
  const runId = `${campaignId}-run`;
  const at = stamp.toISOString();
  const name = "اختبار تكامل — لا تُنشر";
  const std = (rid: string) => (key: string, type: string, o: Partial<Record<"platform" | "contentType" | "item" | "status" | "planned" | "actual" | "person" | "result" | "link", string>>, details: unknown = {}) => {
    tabOf(type);
    return [`${campaignId}:${key}`, campaignId, type, name, "2026-12-01", "2026-12-30", o.platform ?? "", o.contentType ?? "", o.item ?? "", o.status ?? "",
      o.planned ?? "", o.actual ?? "", o.person ?? "", o.result ?? "", o.link ?? "", JSON.stringify(details), at, rid];
  };
  const post = (n: number) => {
    const rid = `${campaignId}-post${n}`;
    const row = std(rid);
    return [
      rowOf(POSTS_TAB, {
        key: `${campaignId}:post:p${n}`, campaignId, type: "post", campaign: name, seq: String(n), title: `منشور اختبار ${n}`, platform: "instagram", contentType: "post",
        size: "1080×1350", status: "منشور", finalText: `نصٌّ للاختبار ${n} — لا يُنشر`, contentVersion: "1", writer: "فحص آلي", contentApproval: "فحص آلي · 2026-12-09 10:00",
        designLink: "https://www.canva.com/design/selftest/view", designDescription: "خلفية بيج وشعار تَـــلاقِ أعلى اليمين", designVersion: "1", designer: "فحص آلي",
        designApproval: "فحص آلي · 2026-12-09 12:00", quality: "اجتاز · فحص آلي · 2026-12-09 14:00", finalCheck: "فحص آلي · 2026-12-10 17:00",
        plannedAt: "2026-12-10 20:30", publishedAt: "2026-12-10 20:31", timezone: "Asia/Riyadh", publisher: "فحص آلي", postUrl: `https://www.instagram.com/p/selftest${n}/`,
        notes: "", details: JSON.stringify({ selfTest: true }), archivedAt: at, runId: rid,
      }),
      row(`content:c${n}`, "content_version", { platform: "instagram", item: `${n}. منشور اختبار ${n} — نص 1`, status: "الحالية", actual: at, person: "فحص آلي" }, { body: `نصٌّ للاختبار ${n}` }),
      row(`design:d${n}`, "design_version", { platform: "instagram", item: `${n}. منشور اختبار ${n} — تصميم 1`, status: "الحالية", actual: at, person: "فحص آلي", result: "نص 1 · المقاس يُفحص يدوياً (رابط)", link: "https://www.canva.com/design/selftest/view" }),
      row(`approval:a${n}`, "approval", { platform: "instagram", item: `${n}. منشور اختبار ${n} — نص 1`, status: "قائم", actual: at, person: "فحص آلي", result: "approved" }),
      row(`publication:pub${n}`, "publication", { platform: "instagram", item: `${n}. منشور اختبار ${n} — نُشر`, status: "منشور", actual: "2026-12-10T17:31:00.000Z", person: "فحص آلي", link: `https://www.instagram.com/p/selftest${n}/` }, { timezone: "Asia/Riyadh" }),
      row(`post_run:${rid}`, "post_run", { platform: "instagram", item: `أرشفة المنشور ${n} «منشور اختبار ${n}»`, status: "طُلبت تلقائياً بعد النشر", actual: at, person: "فحص آلي" }, { postArchiveId: rid }),
    ];
  };
  const row = std(runId);
  const post1 = post(1);
  const post2 = post(2);
  const campaign = [
    rowOf(INDEX_TAB, {
      key: `${campaignId}:campaign`, campaignId, type: "campaign", name, objective: "التحقق من الكتابة والقراءة والمطابقة", start: "2026-12-01", end: "2026-12-30",
      owner: "فحص آلي", team: "فحص آلي (coordinator)", platforms: "instagram", contentTypes: "post", status: "مؤرشفة", pieces: "2", published: "2",
      plan: "خطة نسخة 1", approvers: "فحص آلي · department · 2026-11-30 10:00؛ فحص آلي · operations · 2026-11-30 12:00", details: JSON.stringify({ selfTest: true }), archivedAt: at, runId,
    }),
    row("brief:objective", "brief", { item: "الهدف", result: "التحقق من الكتابة والقراءة والمطابقة" }),
    row("brief:budget", "brief", { item: "الميزانية", result: "غير محدّدة" }),
    ...post1,
    ...post2,
    row("calendar:p1:publish", "calendar", { item: "1. منشور اختبار 1 — النشر", status: "done", planned: "2026-12-10T17:30:00.000Z", actual: "2026-12-10T17:31:00.000Z" }),
    row("task:t1", "task", { item: "نشر منشور الاختبار", status: "done", result: "publishing" }),
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

  await step("ensure_tabs_styled", async () => {
    const r = await store.ensure();
    return { ok: true, detail: r };
  });
  await step("post_archive_one", async () => {
    const r = await writeAndVerify(store, campaignId, post1, { onlyExpectedKeys: true });
    return { ok: r.ok && r.appended === post1.length && r.verified === post1.length, detail: r };
  });
  await step("post_archive_second_scoped", async () => {
    // المنشورُ الأول في الملف لا يُعدّ «زائداً» على أرشفة الثاني
    const r = await writeAndVerify(store, campaignId, post2, { onlyExpectedKeys: true });
    return { ok: r.ok && r.appended === post2.length && r.verified === post2.length, detail: r };
  });
  await step("campaign_archive_reuses_posts", async () => {
    // أرشفةُ الحملة تُلحق ما سوى المنشورين (المكتوبين قبلها) — ولا تكرّرهما
    const r = await writeAndVerify(store, campaignId, campaign);
    return { ok: r.ok && r.appended === campaign.length - post1.length - post2.length && r.verified === campaign.length, detail: r };
  });
  await step("retry_no_duplicates", async () => {
    const r = await writeAndVerify(store, campaignId, campaign);
    return { ok: r.ok && r.appended === 0 && r.verified === campaign.length, detail: r };
  });
  await step("mismatch_detected", async () => {
    const at0 = campaign.findIndex((r) => r[COL.type] === "post");
    const tampered = campaign.map((r, i) => (i === at0 ? r.map((v, j) => (j === POSTS_TAB.at.title ? `${v} (مختلف)` : v)) : r));
    const r = await writeAndVerify(store, campaignId, tampered);
    return { ok: !r.ok && r.code === "sheet_mismatch:1" && r.retryable, detail: r };
  });
  await step("search_index", async () => {
    const r = await searchIndex(store, { text: campaignId });
    const hit = r.results[0];
    return { ok: r.total === 1 && hit?.campaignId === campaignId && hit.pieces === 2 && hit.published === 2 && hit.platforms.includes("instagram"), detail: { total: r.total, pages: r.pages, hit } };
  });
  await step("browse_paged", async () => {
    const r = await searchIndex(store, { page: 1 });
    return { ok: r.total >= 1 && r.results.length <= 20 && r.page === 1, detail: { total: r.total, pages: r.pages, onPage: r.results.length } };
  });
  await step("retrieve_by_tab", async () => {
    const byTab = await campaignRowsInSheet(store, campaignId);
    const placed = campaign.every((e) => (byTab[tabOf(e[COL.type]).name] ?? []).some((r) => r[COL.key] === e[COL.key]));
    const count = Object.values(byTab).reduce((n, rs) => n + rs.length, 0);
    return { ok: placed && count === campaign.length, detail: { rows: count, tabs: Object.fromEntries(Object.entries(byTab).map(([t, rs]) => [t, rs.length])) } };
  });
  await step("missing_campaign", async () => {
    const byTab = await campaignRowsInSheet(store, `${campaignId}-none`);
    return { ok: Object.keys(byTab).length === 0 };
  });
  return { ok: steps.every((s) => s.ok), campaignId, tabs: ARCHIVE_TABS.map((t) => t.name), rows: campaign.length, steps, at };
}
