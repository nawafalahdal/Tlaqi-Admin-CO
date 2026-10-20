/** القائمة الجانبية — لكل دورٍ ما يملكه، بترتيبٍ واحد.
 *
 *  **هذه القائمة مرآةٌ لحرّاس الصفحات لا بديلٌ عنها.** كل رابطٍ هنا
 *  يطابق شرطَ الصفحة التي يفتحها (`redirect` في رأسها)، فلا يُعرض لدورٍ
 *  رابطٌ تردّه الصفحة. وإخفاءُ الرابط ليس حماية: الحمايةُ في الصفحة
 *  وفي إجرائها على الخادم، وهذه تُطابقها فقط.
 *
 *  **والترتيبُ المشترك ثابت** — الأعضاء، الاعتمادات، الأقسام، التنفيذ
 *  والأهداف، التقويم والاجتماعات، التقارير والملفات — ثم ما يخصّ كلَّ
 *  دور في مواضعه بعدها. ودورٌ لا يملك بنداً مشتركاً يسقط عنه البند
 *  ويبقى ترتيبُ الباقي.
 *
 *  ولا «تحسين» هنا: له زرٌّ عائمٌ واحد في كل شاشة، وتكرارُه في القائمة
 *  بابٌ ثانٍ للشيء نفسه. */

export type NavIcon =
  | "members"
  | "approvals"
  | "departments"
  | "execution"
  | "calendar"
  | "reports"
  | "plans"
  | "tickets"
  | "structure"
  | "invites"
  | "messages"
  | "signature"
  | "terminations"
  | "sheet"
  | "home"
  | "operations";

export type NavItem = {
  id: string;
  label: string;
  href: string;
  icon: NavIcon;
  /** المسارات التي تُضيء هذا البند — المسارُ نفسه وما تحته */
  match: string[];
  /** مجموعتُه في القائمة — انظر `NAV_GROUPS` */
  group: NavGroup;
  /** عددٌ مع كلمته («٣ متأخرة») — يُحسب على الخادم من بياناتٍ فعلية.
   *  `action` لما يحتاج فعلك، و`info` للعلم. ولا يُرسم بلا عدد. */
  badge?: { text: string; tone: "action" | "info" };
};

/** مجموعاتُ القائمة بترتيبها. والترتيبُ المشتركُ الستّيُّ محفوظٌ عبرها:
 *  الأعضاء (الأفراد) ← الاعتمادات ← الأقسام (الأقسام والهيكل) ← التنفيذ ←
 *  التقويم (الاجتماعات) ← التقارير — كلٌّ في مجموعةٍ بعد التي قبلها. */
// التذاكرُ ثانيةً بعد «نظرة عامة»: هي قناةُ العمل اليومي وأوّلُ ما يُستعمل
export const NAV_GROUPS = ["overview", "tickets", "people", "approvals", "org", "execution", "meetings", "reports"] as const;
export type NavGroup = (typeof NAV_GROUPS)[number];

/** أسماءُ البنود — من القاموس (`shell.nav`)، لا مكتوبةً هنا */
export type NavLabels = Record<
  "home" | "opsHome" | "members" | "myDeptMembers" | "approvals" | "departments" | "execution" | "calendar" |
  "reports" | "plans" | "tickets" | "structure" | "invites" | "messages" | "terminations" | "signature" | "welcomeCards" | "sheet",
  string
>;

export type NavViewer = {
  role: "super_admin" | "executive" | "operations_officer" | "department_admin" | "member";
  departmentSlug?: string | null;
  /** يُحسب على الخادم (`isSigningRole`) ويُمرَّر — فلا يَسحب هذا الملفُّ
   *  وحدةً خادميةً إلى حزمة المتصفّح، وهو يُستورد في مكوّنٍ عميل */
  canSign?: boolean;
  /** يُحسب على الخادم — مسؤول التشغيل يُعيد البطاقات، وقيادة التسويق تطلبها */
  canWelcomeCards?: boolean;
};

/** صفحةُ رفع التذكرة لكل دور — تحت مساره المحروس (`/admin` أو `/member`) */
export function raiseTicketHref(v: NavViewer): string {
  return v.role === "member" ? "/member/tickets/new" : "/admin/tickets/new";
}

/** بيتُ كل دور — حيث يُرسله `/admin` أصلاً */
export function homeFor(v: NavViewer): string {
  if (v.role === "member") return "/member";
  if (v.role === "operations_officer") return "/admin/operations";
  if (v.role === "department_admin" && v.departmentSlug) return `/admin/departments/${v.departmentSlug}`;
  return "/admin";
}

export function navFor(v: NavViewer, L: NavLabels): NavItem[] {
  const r = v.role;
  const top = r === "super_admin" || r === "executive";
  const admin = r !== "member";
  const ownDept = r === "department_admin" && v.departmentSlug ? `/admin/departments/${v.departmentSlug}` : null;
  const items: (NavItem | false)[] = [];

  // ── نظرةٌ عامة: بيتُ الدور، أوّلاً. التصميمُ وضعها آخراً، فوقعت تحت حافّة
  //    الشاشة بخمسة عشر بنداً — والبندُ المُضاءُ على الصفحة الرئيسية لا يُرى.
  //    والترتيبُ المشتركُ بعدها كما هو.
  const home = homeFor(v);
  // قائدُ القسم بيتُه لوحةُ قسمه، وهي نفسُها بند «أعضاء قسمي» — فلا يتكرّر
  if (home !== ownDept) {
    items.push({
      id: "home",
      label: r === "operations_officer" ? L.opsHome : L.home,
      group: "overview",
      href: home,
      icon: r === "operations_officer" ? "operations" : "home",
      match: [home],
    });
  }

  // ── ١) الأعضاء: صفحة الأعضاء للمؤسس والتنفيذي (`/admin/people`)، وأعضاءُ
  //       قسمه لقائد القسم في لوحة قسمه
  if (top) items.push({ id: "members", label: L.members, href: "/admin/people", icon: "members", match: ["/admin/people"], group: "people" });
  else if (ownDept) items.push({ id: "members", label: L.myDeptMembers, href: ownDept, icon: "members", match: [ownDept], group: "people" });

  // ── ٢) الاعتمادات — لكل إداري
  if (admin) items.push({ id: "approvals", label: L.approvals, href: "/admin/approvals", icon: "approvals", match: ["/admin/approvals"], group: "approvals" });

  // ── ٣) الأقسام — من يرى كل الأقسام؛ وقائدُ القسم لا يدخل غير قسمه
  if (top || r === "operations_officer") {
    items.push({ id: "departments", label: L.departments, href: "/admin/departments", icon: "departments", match: ["/admin/departments"], group: "org" });
  }

  // ── ٤) التنفيذ والأهداف — لكل إداري (الصفحة تردّ العضو)
  if (admin) items.push({ id: "execution", label: L.execution, href: "/admin/execution", icon: "execution", match: ["/admin/execution"], group: "execution" });

  // ── ٥) التقويم والاجتماعات — للجميع
  items.push({ id: "calendar", label: L.calendar, href: "/calendar", icon: "calendar", match: ["/calendar"], group: "meetings" });

  // ── ٦) التقارير والملفات — التقارير للإداري، والملفات (الخطط) للعضو
  if (admin) items.push({ id: "reports", label: L.reports, href: "/admin/reports", icon: "reports", match: ["/admin/reports"], group: "reports" });

  // ── ما بعد المشترك
  items.push({ id: "plans", label: L.plans, href: "/plans", icon: "plans", match: ["/plans"], group: "reports" });
  if (admin) items.push({ id: "tickets", label: L.tickets, href: "/admin/tickets", icon: "tickets", match: ["/admin/tickets"], group: "tickets" });
  items.push({ id: "structure", label: L.structure, href: "/structure", icon: "structure", match: ["/structure"], group: "org" });
  if (top) {
    items.push({ id: "invites", label: L.invites, href: "/admin/invites", icon: "invites", match: ["/admin/invites", "/admin/tests"], group: "people" });
  }
  // سجلُّ التنبيهات — لكلِّ أحد، وفيه تنبيهاتُه هو وحده
  items.push({ id: "messages", label: L.messages, href: "/notifications", icon: "messages", match: ["/notifications", "/admin/messages"], group: "meetings" });
  if (top || r === "department_admin") {
    items.push({ id: "terminations", label: L.terminations, href: "/admin/terminations", icon: "terminations", match: ["/admin/terminations"], group: "people" });
  }
  if (v.canWelcomeCards) {
    items.push({ id: "welcomeCards", label: L.welcomeCards, href: "/admin/welcome-cards", icon: "invites", match: ["/admin/welcome-cards"], group: "people" });
  }
  if (top || v.canSign) {
    items.push({ id: "signature", label: L.signature, href: "/admin/signature", icon: "signature", match: ["/admin/signature"], group: "people" });
  }
  // «السجل الحي» ليس وجهةً يومية: انتقل إلى قائمة حساب المؤسس (`AppSidebar`)،
  // وحرسُه في الخادم (`/admin/sheet` للمؤسس وحده) باقٍ كما هو

  // تُرتَّب بالمجموعة ترتيباً مستقرّاً: داخل كل مجموعةٍ يبقى ترتيبُ الإضافة
  // أعلاه، فلا يتبدّل الترتيبُ المشتركُ ولا ما بعده
  const rank = (g: NavGroup) => NAV_GROUPS.indexOf(g);
  return items
    .filter((i): i is NavItem => Boolean(i))
    .map((it, i) => ({ it, i }))
    .sort((a, b) => rank(a.it.group) - rank(b.it.group) || a.i - b.i)
    .map(({ it }) => it);
}

/** أيُّ بندٍ يُضاء — أطولُ مطابقةٍ تغلب، فلا يُضيء `/admin` مع كلّ ما تحته */
export function activeNavId(items: NavItem[], pathname: string): string | null {
  let best: { id: string; len: number } | null = null;
  for (const it of items) {
    for (const m of it.match) {
      const hit = m === "/admin" ? pathname === "/admin" : pathname === m || pathname.startsWith(m + "/");
      if (hit && (!best || m.length > best.len)) best = { id: it.id, len: m.length };
    }
  }
  return best?.id ?? null;
}
