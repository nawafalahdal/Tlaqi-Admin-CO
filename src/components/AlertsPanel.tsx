import Link from "next/link";
import type { Alert } from "@/lib/alerts";

/** لوحةُ «ما ينتظرك» — أولُ ما يُقرأ في الصفحة الرئيسية.
 *
 *  **وترتفع كلُّها عند السلامة.** لوحةٌ تقول «لا تنبيهات» تُعلِّم العينَ
 *  أن تتخطّى هذا الموضع، فإذا جاء تنبيهٌ حقيقيٌّ يوماً لم يُرَ. فمن لا
 *  شيء عليه لا يرى شيئاً، ومن عليه شيءٌ يراه في مكانٍ تعوّدت عينُه أنه
 *  لا يمتلئ إلا بما يَلزم.
 *
 *  والألوانُ ثلاثةٌ لا أكثر: أحمرُ لما يُخِلّ (كلمةُ مرورٍ مؤقتة،
 *  تذكرةٌ متأخّرة)، وكهرمانيٌّ لما ينتظر فعلَه، ورماديٌّ للخبر. وكلُّها
 *  تتبع السمة الداكنة بخرطٍ مركزيٍّ في `globals.css`، فلا تَصرخ لوحةٌ
 *  كريميّةٌ في شاشةٍ داكنة.
 */
export function AlertsPanel({ alerts }: { alerts: Alert[] }) {
  if (alerts.length === 0) return null;

  return (
    <section className="flex flex-col gap-2.5" aria-label="ما ينتظرك">
      <h2 className="text-sm font-bold">
        ما ينتظرك <span className="font-medium text-black/40">({alerts.length})</span>
      </h2>
      <ul className="flex flex-col gap-2">
        {alerts.map((a) => (
          <li key={a.id}>
            <div
              className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl px-4 py-3 ${
                a.tone === "danger"
                  ? "bg-red-50 ring-1 ring-red-200"
                  : a.tone === "warn"
                    ? "bg-amber-50 ring-1 ring-amber-200"
                    : "bg-black/[0.03] ring-1 ring-hairline"
              }`}
            >
              <div className="min-w-0 flex-1">
                <p
                  className={`text-sm font-bold ${
                    a.tone === "danger"
                      ? "text-red-800"
                      : a.tone === "warn"
                        ? "text-amber-900"
                        : "text-black/80"
                  }`}
                >
                  {a.title}
                </p>
                <p className="mt-0.5 text-xs leading-relaxed text-black/55">{a.body}</p>
              </div>
              {/* الرابطُ جزءٌ من التنبيه لا تاليه: لا يُقال «عندك نقص»
                  ويُترك صاحبُه يبحث عن موضع إصلاحه */}
              <Link
                href={a.href}
                className="shrink-0 rounded-xl border border-black/10 bg-white px-3.5 py-2 text-xs font-bold text-black/75 transition-opacity hover:opacity-80"
              >
                {a.cta} ←
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
