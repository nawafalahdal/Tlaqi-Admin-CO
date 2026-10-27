/** شكلُ ملف أرشيف التسويق: تبويباتُه، وما يُكتب في كلٍّ منها، وأعمدتُه.
 *
 *  ملفٌّ مستقلٌّ عن شيت المنصة المشترك (`marketingArchiveSpreadsheetId`)، وهذا الوصفُ وحده مصدرُ
 *  شكله: تبنيه منه `archiveSheet.ts` (التكامل الحقيقي) ويقرؤه الفحصُ المحلي كما هو.
 *
 *  **التبويباتُ بفئات العمل:** خطةُ الحملات ← تفاصيلُ الخطة ← المحتوى ← التصاميم ← الاعتمادُ والنشر
 *  ← **الأرشيف (صفٌّ لكل منشور بكل تفاصيله — يُقرأ وحده بلا فتح المنصة)** ← ثم التبويباتُ التقنية
 *  (التقويم، المهام، الملفات والتعليقات، سجل التدقيق، عمليات الأرشفة).
 *
 *  **الأعمدةُ لكل تبويب:** الثلاثةُ الأولى ثابتةٌ في كل تبويب — مفتاحُ الصف (`معرّف الحملة:النوع:المعرّف`)
 *  ومعرّفُ الحملة والنوع — والآخِران وقتُ الأرشفة ومعرّفُ عملية الأرشفة. فيُكتب كلُّ صفٍّ ويُقرأ
 *  ويُطابَق بطريقةٍ واحدة أيّاً كان تبويبه، والإعادةُ لا تكرّر صفّاً. وما بينها: ثمانيةَ عشرَ عموداً
 *  بالمواضع نفسها في التبويبات العامة (`COL`)، وأعمدةٌ مسمّاةٌ مقروءة في «خطة الحملات» و«الأرشيف».
 *
 *  ولا يُستورد هنا ما يتصل بـ Google — فيبقى الوصفُ صالحاً للفحص بلا شبكة. */

/** مواضعُ الأعمدة في التبويبات العامة */
export const COL = {
  key: 0, campaignId: 1, type: 2, campaign: 3, start: 4, end: 5, platform: 6, contentType: 7,
  item: 8, status: 9, planned: 10, actual: 11, person: 12, result: 13, link: 14, details: 15, archivedAt: 16, runId: 17,
} as const;
/** عرضُ التبويبات العامة */
export const ARCHIVE_COLS = 18;

export type ArchiveColumn = { id: string; header: string; width: number; wrap?: boolean };

const STANDARD: ArchiveColumn[] = [
  { id: "key", header: "مفتاح الصف", width: 210 },
  { id: "campaignId", header: "معرّف الحملة", width: 170 },
  { id: "type", header: "النوع", width: 110 },
  { id: "campaign", header: "الحملة", width: 200 },
  { id: "start", header: "بداية الحملة", width: 105 },
  { id: "end", header: "نهاية الحملة", width: 105 },
  { id: "platform", header: "المنصة", width: 100 },
  { id: "contentType", header: "نوع المحتوى", width: 110 },
  { id: "item", header: "العنصر", width: 240, wrap: true },
  { id: "status", header: "الحالة", width: 130 },
  { id: "planned", header: "الموعد المخطط", width: 160 },
  { id: "actual", header: "الموعد الفعلي", width: 160 },
  { id: "person", header: "المسؤول", width: 170, wrap: true },
  { id: "result", header: "القرار / النتيجة", width: 220, wrap: true },
  { id: "link", header: "الرابط", width: 230 },
  { id: "details", header: "التفاصيل (JSON)", width: 320 },
  { id: "archivedAt", header: "وقت الأرشفة", width: 160 },
  { id: "runId", header: "معرّف عملية الأرشفة", width: 200 },
];

export type ArchiveTabId =
  | "campaigns" | "plan" | "content" | "designs" | "approvals" | "posts" | "calendar" | "tasks" | "files" | "audit" | "runs";

export type ArchiveTab = {
  id: ArchiveTabId;
  name: string;
  title: string;
  types: readonly string[];
  columns: readonly ArchiveColumn[];
  headers: string[];
  widths: number[];
  /** عددُ الأعمدة */
  width: number;
  /** موضعُ كلِّ عمودٍ باسمه */
  at: Record<string, number>;
};

const build = (id: ArchiveTabId, name: string, title: string, types: string[], columns: ArchiveColumn[]): ArchiveTab => {
  // الثلاثةُ الأولى والآخِران ثابتةٌ في كل تبويب — عليها تقوم الكتابةُ والمطابقةُ والبحث
  const ids = columns.map((c) => c.id);
  if (ids[0] !== "key" || ids[1] !== "campaignId" || ids[2] !== "type" || ids[ids.length - 2] !== "archivedAt" || ids[ids.length - 1] !== "runId") {
    throw new Error(`archive layout: tab ${id} must start with key/campaignId/type and end with archivedAt/runId`);
  }
  return {
    id, name, title, types, columns,
    headers: columns.map((c) => c.header),
    widths: columns.map((c) => c.width),
    width: columns.length,
    at: Object.fromEntries(columns.map((c, i) => [c.id, i])),
  };
};

/** تبويبٌ عامٌّ بالأعمدة الثمانيةَ عشرَ نفسِها — وعناوينُ بعضها بما يناسبه */
const standard = (id: ArchiveTabId, name: string, title: string, types: string[], over: Partial<Record<keyof typeof COL, string>> = {}) =>
  build(id, name, title, types, STANDARD.map((c) => ({ ...c, header: over[c.id as keyof typeof COL] ?? c.header })));

/** خطةُ الحملات — صفٌّ لكل حملة، ومنه وحده يجري البحث */
const CAMPAIGN_COLUMNS: ArchiveColumn[] = [
  STANDARD[0], STANDARD[1], STANDARD[2],
  { id: "name", header: "اسم الحملة", width: 220, wrap: true },
  { id: "objective", header: "الهدف", width: 300, wrap: true },
  { id: "start", header: "تاريخ البداية", width: 110 },
  { id: "end", header: "تاريخ النهاية", width: 110 },
  { id: "owner", header: "المسؤول (المنسّق)", width: 170 },
  { id: "team", header: "الفريق والمسؤوليات", width: 280, wrap: true },
  { id: "platforms", header: "المنصات", width: 150 },
  { id: "contentTypes", header: "أنواع المحتوى", width: 150 },
  { id: "status", header: "حالة الحملة", width: 120 },
  { id: "pieces", header: "عدد المنشورات", width: 110 },
  { id: "published", header: "المنشور منها", width: 110 },
  { id: "plan", header: "الخطة المعتمدة", width: 140 },
  { id: "approvers", header: "اعتماد الخطة (من · متى)", width: 300, wrap: true },
  { id: "details", header: "الموجز المختصر (JSON)", width: 300 },
  STANDARD[16], STANDARD[17],
];

/** الأرشيف — صفٌّ لكل منشور: كلُّ ما يلزم الرجوعَ إليه دون فتح المنصة */
const POST_COLUMNS: ArchiveColumn[] = [
  STANDARD[0], STANDARD[1], STANDARD[2],
  { id: "campaign", header: "الحملة", width: 200, wrap: true },
  { id: "seq", header: "رقم المنشور", width: 90 },
  { id: "title", header: "عنوان المنشور", width: 220, wrap: true },
  { id: "platform", header: "المنصة", width: 100 },
  { id: "contentType", header: "نوع المنشور", width: 110 },
  { id: "size", header: "المقاس", width: 100 },
  { id: "status", header: "حالة المنشور", width: 110 },
  { id: "finalText", header: "نص المحتوى النهائي", width: 420, wrap: true },
  { id: "contentVersion", header: "نسخة النص", width: 90 },
  { id: "writer", header: "الكاتب", width: 150 },
  { id: "contentApproval", header: "اعتماد النص (من · متى)", width: 220, wrap: true },
  { id: "designLink", header: "رابط التصميم", width: 260 },
  { id: "designDescription", header: "وصف التصميم", width: 320, wrap: true },
  { id: "designVersion", header: "نسخة التصميم", width: 100 },
  { id: "designer", header: "المصمّم", width: 150 },
  { id: "designApproval", header: "اعتماد التصميم (من · متى)", width: 220, wrap: true },
  { id: "quality", header: "فحص الجودة (من · متى · النتيجة)", width: 240, wrap: true },
  { id: "finalCheck", header: "الفحص الأخير (من · متى)", width: 220, wrap: true },
  { id: "plannedAt", header: "موعد النشر المخطط", width: 160 },
  { id: "publishedAt", header: "تاريخ النشر الفعلي", width: 160 },
  { id: "timezone", header: "المنطقة الزمنية", width: 120 },
  { id: "publisher", header: "الناشر", width: 150 },
  { id: "postUrl", header: "رابط المنشور", width: 280 },
  { id: "notes", header: "ملاحظات النشر", width: 240, wrap: true },
  { id: "details", header: "التفاصيل (JSON)", width: 300 },
  STANDARD[16], STANDARD[17],
];

/** التبويباتُ بترتيبها في الملف. كلُّ نوعِ صفٍّ في تبويبٍ واحدٍ لا غير */
export const ARCHIVE_TABS: readonly ArchiveTab[] = [
  build("campaigns", "خطة الحملات", "تَـــلاقِ — خطة الحملات المؤرشفة: الاسم والهدف والمدة والمسؤولون والحالة (صفٌّ لكل حملة — ومنه يجري البحث)", ["campaign"], CAMPAIGN_COLUMNS),
  standard("plan", "تفاصيل الخطة", "تَـــلاقِ — الموجز والخطة حقلاً حقلاً، ومؤشرات الأداء، والنواقص الموثّقة", ["brief", "gap"], {
    item: "الحقل", result: "القيمة",
  }),
  standard("content", "المحتوى", "تَـــلاقِ — نصوص المنشورات: كل نسخةٍ برقمها وكاتبها ووقتها والمنصة المستهدفة", ["content_version"], {
    item: "المنشور — النسخة", actual: "وقت النسخة", person: "الكاتب", result: "ما تغيّر", details: "النص والمصادر (JSON)",
  }),
  standard("designs", "التصاميم", "تَـــلاقِ — التصاميم: روابطها ووصفها ونسخها، وارتباط كل تصميمٍ بنسخة النص والحملة، وموجز التصميم", ["design_version", "design_brief"], {
    item: "المنشور — التصميم", actual: "وقت النسخة", person: "المصمّم", result: "مبنيٌّ على / المقاس", link: "رابط التصميم",
  }),
  standard("approvals", "الاعتماد والنشر", "تَـــلاقِ — اعتماد الخطة بمرحلتيها، واعتمادات النص والتصميم، وفحوص الجودة والفحص الأخير، والنشر ونتائجه", ["plan_decision", "approval", "quality", "final_check", "publication", "result"], {
    item: "ما اعتُمد / نُشر", actual: "الوقت", person: "صاحب القرار", result: "القرار / النتيجة", link: "رابط المنشور",
  }),
  build("posts", "الأرشيف — المنشورات", "تَـــلاقِ — الأرشيف: صفٌّ لكل منشور بنصّه وتصميمه واعتماداته ونشره ورابطه — السجلُّ الدائم", ["post"], POST_COLUMNS),
  standard("calendar", "التقويم", "تَـــلاقِ — مواعيد المنشورات (النص، التصميم، المراجعة، النشر) وسجلّ تغييرها بعد الاعتماد", ["calendar", "schedule_change"], {
    item: "المنشور — الموعد", planned: "الموعد", actual: "الإنجاز / وقت التغيير", result: "التغيير (من ← إلى)",
  }),
  standard("tasks", "المهام", "تَـــلاقِ — مهامّ الحملة بمسؤوليها ومواعيدها وإنجازها", ["task"], {
    item: "المهمّة", planned: "الموعد", actual: "الإنجاز", person: "المسنَد إليه", result: "نوع المهمّة",
  }),
  standard("files", "الملفات والتعليقات", "تَـــلاقِ — وصف الملفات (لا محتواها)، والتعليقات، وعدد رسائل المحادثات (لا نصوصها)", ["file", "comment", "chat"], {
    item: "العنصر", actual: "الوقت", person: "صاحبه",
  }),
  standard("audit", "سجل التدقيق", "تَـــلاقِ — أحداث الحملة بصاحبها ووقتها حتى طلب الأرشفة", ["event"], {
    item: "الحدث", actual: "الوقت", person: "الفاعل",
  }),
  standard("runs", "عمليات الأرشفة", "تَـــلاقِ — صفٌّ لكل عملية أرشفة (منشورٍ أو حملة) بمعرّفها الثابت", ["run", "post_run"], {
    item: "العملية", actual: "وقت الطلب", person: "من طلبها",
  }),
];

/** تبويبُ «اقرأني» — يكتبه صاحبُ الملف، ولا تكتب فيه المنصة */
export const ARCHIVE_README_TAB = "اقرأني";
export const ARCHIVE_FILE_LABEL = "TLAQI Marketing Campaign Archive";

/** ألوانُ الهوية في الملف: البنفسجيُّ الداكن للعنوان، والبرتقاليُّ لرؤوس الأعمدة، والبيجُ لتناوب الصفوف */
export const ARCHIVE_BRAND = { purple: "#1a0e1c", orange: "#c34900", beige: "#EEF6DF", white: "#FFFFFF" } as const;

const byType = new Map(ARCHIVE_TABS.flatMap((t) => t.types.map((ty) => [ty, t] as const)));
export const INDEX_TAB = ARCHIVE_TABS.find((t) => t.id === "campaigns")!;
export const POSTS_TAB = ARCHIVE_TABS.find((t) => t.id === "posts")!;
/** أعرضُ تبويب — لقراءة صفٍّ أيّاً كان تبويبه */
export const MAX_ARCHIVE_COLS = Math.max(...ARCHIVE_TABS.map((t) => t.width));

/** تبويبُ نوعِ الصف — ونوعٌ غيرُ معروف خطأٌ في الكود لا يُكتب في مكانٍ مخمَّن */
export function tabOf(type: string): ArchiveTab {
  const t = byType.get(type);
  if (!t) throw new Error(`archive: no tab for row type "${type}"`);
  return t;
}
export const tabById = (id: string) => ARCHIVE_TABS.find((t) => t.id === id) ?? null;

/** صفٌّ بأعمدة تبويبه من قيمٍ مسمّاة — وما لم يُذكر فارغ */
export function rowOf(tab: ArchiveTab, values: Partial<Record<string, string>>): string[] {
  const out = Array<string>(tab.width).fill("");
  for (const [k, v] of Object.entries(values)) {
    const i = tab.at[k];
    if (i === undefined) throw new Error(`archive: tab ${tab.id} has no column "${k}"`);
    out[i] = v ?? "";
  }
  return out;
}

/** الصفُّ بطوله الكامل في تبويبه (Sheets لا يعيد الخلايا الفارغة في آخر الصف) */
export function normRow(r: string[], width: number = byType.get(r[COL.type] ?? "")?.width ?? r.length): string[] {
  const out = r.slice(0, width).map((v) => v ?? "");
  while (out.length < width) out.push("");
  return out;
}
