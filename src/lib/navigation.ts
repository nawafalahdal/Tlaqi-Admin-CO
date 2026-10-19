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
};

export type NavViewer = {
  role: "super_admin" | "executive" | "operations_officer" | "department_admin" | "member";
  departmentSlug?: string | null;
  /** يُحسب على الخادم (`isSigningRole`) ويُمرَّر — فلا يَسحب هذا الملفُّ
   *  وحدةً خادميةً إلى حزمة المتصفّح، وهو يُستورد في مكوّنٍ عميل */
  canSign?: boolean;
};

/** بيتُ كل دور — حيث يُرسله `/admin` أصلاً */
export function homeFor(v: NavViewer): string {
  if (v.role === "member") return "/member";
  if (v.role === "operations_officer") return "/admin/operations";
  if (v.role === "department_admin" && v.departmentSlug) return `/admin/departments/${v.departmentSlug}`;
  return "/admin";
}

export function navFor(v: NavViewer): NavItem[] {
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
      label: r === "operations_officer" ? "مساحة التشغيل" : "نظرة عامة",
      href: home,
      icon: r === "operations_officer" ? "operations" : "home",
      match: [home],
    });
  }

  // ── ١) الأعضاء: صفحة الأعضاء للمؤسس والتنفيذي (`/admin/people`)، وأعضاءُ
  //       قسمه لقائد القسم في لوحة قسمه
  if (top) items.push({ id: "members", label: "الأعضاء", href: "/admin/people", icon: "members", match: ["/admin/people"] });
  else if (ownDept) items.push({ id: "members", label: "أعضاء قسمي", href: ownDept, icon: "members", match: [ownDept] });

  // ── ٢) الاعتمادات — لكل إداري
  if (admin) items.push({ id: "approvals", label: "الاعتمادات", href: "/admin/approvals", icon: "approvals", match: ["/admin/approvals"] });

  // ── ٣) الأقسام — من يرى كل الأقسام؛ وقائدُ القسم لا يدخل غير قسمه
  if (top || r === "operations_officer") {
    items.push({ id: "departments", label: "الأقسام", href: "/admin/departments", icon: "departments", match: ["/admin/departments"] });
  }

  // ── ٤) التنفيذ والأهداف — لكل إداري (الصفحة تردّ العضو)
  if (admin) items.push({ id: "execution", label: "التنفيذ والأهداف", href: "/admin/execution", icon: "execution", match: ["/admin/execution"] });

  // ── ٥) التقويم والاجتماعات — للجميع
  items.push({ id: "calendar", label: "التقويم والاجتماعات", href: "/calendar", icon: "calendar", match: ["/calendar"] });

  // ── ٦) التقارير والملفات — التقارير للإداري، والملفات (الخطط) للعضو
  if (admin) items.push({ id: "reports", label: "التقارير والملفات", href: "/admin/reports", icon: "reports", match: ["/admin/reports"] });

  // ── ما بعد المشترك
  items.push({ id: "plans", label: "الخطط والوثائق", href: "/plans", icon: "plans", match: ["/plans"] });
  if (admin) items.push({ id: "tickets", label: "التذاكر", href: "/admin/tickets", icon: "tickets", match: ["/admin/tickets"] });
  items.push({ id: "structure", label: "الهيكل التنظيمي", href: "/structure", icon: "structure", match: ["/structure"] });
  if (top) {
    items.push({ id: "invites", label: "الدعوات", href: "/admin/invites", icon: "invites", match: ["/admin/invites", "/admin/tests"] });
    items.push({ id: "messages", label: "سجل الرسائل", href: "/admin/messages", icon: "messages", match: ["/admin/messages"] });
  }
  if (top || r === "department_admin") {
    items.push({ id: "terminations", label: "طلبات الإنهاء", href: "/admin/terminations", icon: "terminations", match: ["/admin/terminations"] });
  }
  if (top || v.canSign) {
    items.push({ id: "signature", label: "التوقيعات", href: "/admin/signature", icon: "signature", match: ["/admin/signature"] });
  }
  if (r === "super_admin") items.push({ id: "sheet", label: "السجل الحي", href: "/admin/sheet", icon: "sheet", match: ["/admin/sheet"] });

  return items.filter((i): i is NavItem => Boolean(i));
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
