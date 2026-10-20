import Link from "next/link";
import { NavGlyph } from "../icons";

/** بابُ رفع التذكرة في رأس كل لوحة — أوّلُ ما تحت الترحيب.
 *
 *  كان في كل لوحةٍ نموذجٌ مدمَجٌ بشكلٍ مختلف، وفي بوابة العضو آخرَ
 *  الصفحة. فصار بابٌ واحدٌ بشكلٍ واحد، يفتح صفحةَ الرفع نفسها للجميع. */
export function TicketCta({
  href,
  title,
  body,
  cta,
}: {
  href: string;
  title: string;
  body: string;
  cta: string;
}) {
  return (
    <section className="ticket-cta" aria-label={cta}>
      <span className="ticket-cta__icon" aria-hidden="true">
        <NavGlyph name="tickets" />
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="ticket-cta__title">{title}</h2>
        <p className="ticket-cta__body">{body}</p>
      </div>
      <Link href={href} className="btn-brand ticket-cta__btn">
        <NavGlyph name="plus" className="ticket-cta__btn-icon" />
        {cta}
      </Link>
    </section>
  );
}
