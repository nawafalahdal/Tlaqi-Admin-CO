import Link from "next/link";

/** تنقّلٌ بين صفحات قائمةٍ طويلة — «السابق · صفحة ٢ من ٦ · التالي». لا يظهر لصفحةٍ واحدة.
 *  بلا حالةٍ ولا خطّافات، فيُرسم في الخادم وفي مكوّنات العميل معاً. */
export function Pager({ page, pages, href, labels }: { page: number; pages: number; href: (p: number) => string; labels: { pageOf: string; prevPage: string; nextPage: string } }) {
  if (pages <= 1) return null;
  const cls = "inline-flex min-h-9 items-center rounded-xl border border-black/10 px-3 text-xs font-bold hover:bg-black/[0.04]";
  const of = labels.pageOf.replace("{0}", String(page)).replace("{1}", String(pages));
  return (
    <nav className="flex flex-wrap items-center justify-center gap-3 text-xs" aria-label={of}>
      {page > 1 && <Link href={href(page - 1)} className={cls} prefetch={false}>{labels.prevPage}</Link>}
      <span className="text-black/55">{of}</span>
      {page < pages && <Link href={href(page + 1)} className={cls} prefetch={false}>{labels.nextPage}</Link>}
    </nav>
  );
}

/** رقمُ الصفحة من الرابط — مقيّدٌ بين ١ وآخر صفحة، وما لا يُقرأ رقماً فهو ١ */
export function pageParam(raw: string | undefined, total: number, size: number): { page: number; pages: number } {
  const pages = Math.max(1, Math.ceil(total / size));
  return { pages, page: Math.min(pages, Math.max(1, Number.parseInt(raw ?? "1", 10) || 1)) };
}
