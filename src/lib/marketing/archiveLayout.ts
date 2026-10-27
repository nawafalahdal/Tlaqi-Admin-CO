/** شكلُ ملف أرشيف التسويق: تبويباتُه، وما يُكتب في كلٍّ منها، وأعمدتُه.
 *
 *  ملفٌّ مستقلٌّ عن شيت المنصة المشترك (`marketingArchiveSpreadsheetId`)، وهذا الوصفُ وحده مصدرُ
 *  شكله: تبنيه منه `archiveSheet.ts` (التكامل الحقيقي) ويقرؤه الفحصُ المحلي كما هو.
 *
 *  **ثمانيةَ عشرَ عموداً في كل تبويب، بالمواضع نفسها** — فيُكتب كلُّ صفٍّ ويُقرأ ويُطابَق بطريقةٍ
 *  واحدة أيّاً كان تبويبه، وتختلف عناوينُ الأعمدة بما يناسب التبويب (المنصات في الفهرس، الموعد
 *  في التقويم…). أوّلُها مفتاحٌ ثابت للصف (`معرّف الحملة:النوع:المعرّف`) وآخرُها معرّفُ عملية
 *  الأرشفة — فإعادةُ المحاولة لا تكرّر صفّاً، وكلُّ صفٍّ يُنسب إلى عمليته.
 *
 *  ولا يُستورد هنا ما يتصل بـ Google — فيبقى الوصفُ صالحاً للفحص بلا شبكة. */

/** مواضعُ الأعمدة — مشتركةٌ بين التبويبات */
export const COL = {
  key: 0, campaignId: 1, type: 2, campaign: 3, start: 4, end: 5, platform: 6, contentType: 7,
  item: 8, status: 9, planned: 10, actual: 11, person: 12, result: 13, link: 14, details: 15, archivedAt: 16, runId: 17,
} as const;
export const ARCHIVE_COLS = 18;

const BASE_HEADERS = [
  "مفتاح الصف", "معرّف الحملة", "النوع", "الحملة", "بداية الحملة", "نهاية الحملة", "المنصة", "نوع المحتوى",
  "العنصر", "الحالة", "الموعد المخطط", "الموعد الفعلي", "المسؤول", "القرار / النتيجة", "الرابط", "التفاصيل (JSON)", "وقت الأرشفة", "معرّف عملية الأرشفة",
];
const BASE_WIDTHS = [230, 200, 110, 200, 105, 105, 100, 110, 240, 130, 160, 160, 170, 220, 230, 380, 160, 200];

export type ArchiveTabId =
  | "index" | "brief" | "pieces" | "calendar" | "tasks" | "versions" | "approvals" | "quality" | "publishing" | "files" | "audit" | "runs";

export type ArchiveTab = { id: ArchiveTabId; name: string; title: string; types: readonly string[]; headers: string[]; widths: number[] };

const tab = (id: ArchiveTabId, name: string, title: string, types: string[], over: Partial<Record<keyof typeof COL, string>> = {}): ArchiveTab => {
  const headers = [...BASE_HEADERS];
  for (const [k, v] of Object.entries(over)) headers[COL[k as keyof typeof COL]] = v;
  return { id, name, title, types, headers, widths: [...BASE_WIDTHS] };
};

/** التبويباتُ بترتيبها في الملف. كلُّ نوعِ صفٍّ في تبويبٍ واحدٍ لا غير */
export const ARCHIVE_TABS: readonly ArchiveTab[] = [
  tab("index", "فهرس الحملات", "تَـــلاقِ — فهرس الحملات المؤرشفة (صفٌّ لكل حملة — ومنه وحده يجري البحث)", ["campaign"], {
    platform: "المنصات", contentType: "أنواع المحتوى", item: "اسم الحملة", planned: "عدد القطع", actual: "المنشور منها", person: "المسؤول", result: "الخطة المعتمدة", details: "الموجز المختصر (JSON)",
  }),
  tab("brief", "الموجز والخطة", "تَـــلاقِ — الموجز والخطة حقلاً حقلاً، ومؤشرات الأداء، والنواقص الموثّقة", ["brief", "gap"], {
    item: "الحقل", result: "القيمة",
  }),
  tab("pieces", "القطع", "تَـــلاقِ — قطع الحملة: المنصة والمقاس والنص النهائي وموجز التصميم ووصف ملف التصميم", ["piece"], {
    item: "القطعة", planned: "موعد النشر المخطط", actual: "وقت النشر الفعلي", person: "الكاتب والمصمّم",
  }),
  tab("calendar", "التقويم", "تَـــلاقِ — مواعيد القطع (النص، التصميم، المراجعة، النشر) وسجلّ تغييرها بعد الاعتماد", ["calendar", "schedule_change"], {
    item: "القطعة — الموعد", planned: "الموعد", actual: "الإنجاز / وقت التغيير", result: "التغيير (من ← إلى)",
  }),
  tab("tasks", "المهام", "تَـــلاقِ — مهامّ الحملة بمسؤوليها ومواعيدها وإنجازها", ["task"], {
    item: "المهمّة", planned: "الموعد", actual: "الإنجاز", person: "المسنَد إليه", result: "نوع المهمّة",
  }),
  tab("versions", "نسخ المحتوى والتصميم", "تَـــلاقِ — كل نسخة نصٍّ وتصميمٍ برقمها وصاحبها ووقتها", ["content_version", "design_version"], {
    item: "النسخة", actual: "وقت النسخة", person: "صاحبها", result: "ما تغيّر / المقاس",
  }),
  tab("approvals", "الاعتمادات", "تَـــلاقِ — قرارات اعتماد الخطة بمراحلها، واعتمادات النص والتصميم", ["plan_decision", "approval"], {
    item: "ما اعتُمد", actual: "وقت القرار", person: "صاحب القرار", result: "القرار",
  }),
  tab("quality", "الجودة والفحص الأخير", "تَـــلاقِ — فحوص الجودة وفحص الناشر الأخير ببنودها", ["quality", "final_check"], {
    item: "ما فُحص", actual: "وقت الفحص", person: "الفاحص", result: "النتيجة",
  }),
  tab("publishing", "النشر والنتائج", "تَـــلاقِ — كل منشور: الرابط والوقت والمنطقة الزمنية والنتائج بمصدرها", ["publication"], {
    item: "القطعة", planned: "الموعد المخطط", actual: "وقت النشر", person: "الناشر", result: "النتائج", link: "رابط المنشور",
  }),
  tab("files", "الملفات والتعليقات", "تَـــلاقِ — وصف الملفات (لا محتواها)، والتعليقات، وعدد رسائل المحادثات (لا نصوصها)", ["file", "comment", "chat"], {
    item: "العنصر", actual: "الوقت", person: "صاحبه",
  }),
  tab("audit", "سجل التدقيق", "تَـــلاقِ — أحداث الحملة بصاحبها ووقتها حتى طلب الأرشفة", ["event"], {
    item: "الحدث", actual: "الوقت", person: "الفاعل",
  }),
  tab("runs", "عمليات الأرشفة", "تَـــلاقِ — صفٌّ لكل عملية أرشفة بمعرّفها الثابت", ["run"], {
    item: "العملية", actual: "وقت الطلب", person: "من طلبها",
  }),
];

/** تبويبُ «اقرأني» — يكتبه صاحبُ الملف، ولا تكتب فيه المنصة */
export const ARCHIVE_README_TAB = "اقرأني";
export const ARCHIVE_FILE_LABEL = "TLAQI Marketing Campaign Archive";

const byType = new Map(ARCHIVE_TABS.flatMap((t) => t.types.map((ty) => [ty, t] as const)));
export const INDEX_TAB = ARCHIVE_TABS[0];

/** تبويبُ نوعِ الصف — ونوعٌ غيرُ معروف خطأٌ في الكود لا يُكتب في مكانٍ مخمَّن */
export function tabOf(type: string): ArchiveTab {
  const t = byType.get(type);
  if (!t) throw new Error(`archive: no tab for row type "${type}"`);
  return t;
}
export const tabById = (id: string) => ARCHIVE_TABS.find((t) => t.id === id) ?? null;

/** الصفُّ بطوله الكامل (Sheets لا يعيد الخلايا الفارغة في آخر الصف) */
export function normRow(r: string[]): string[] {
  const out = r.slice(0, ARCHIVE_COLS).map((v) => v ?? "");
  while (out.length < ARCHIVE_COLS) out.push("");
  return out;
}
