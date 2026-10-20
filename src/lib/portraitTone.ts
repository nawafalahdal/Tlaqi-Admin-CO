import { BRAND } from "@/lib/brand";
import { ORG_SENIOR_COLOR, needsOutline, outlineFor } from "@/lib/orgChart";

/** خلفيةُ الصورة الشخصية — لونُ قسم صاحبها، في موضعٍ واحد.
 *
 *  الصورُ تُحفَظ بشفافيتها (`normalizeAvatar`)، فالخلفيةُ التي تحت الصورة
 *  هي التي تُرى حول الشخص. وكانت كلُّ بطاقةٍ ترسم تحته أبيضَ، فيضيع لونُ
 *  القسم عن أكثر ما يُنظَر إليه.
 *
 *  - **الإدارة العليا** (المؤسس والرئيس التنفيذي): بنفسجيُّ تَـــلاقِ.
 *    لونُ مستواها في الهيكل يكاد يكون أسود، فيُرفَع إلى البنفسجي هنا وحده.
 *  - **القسمُ الفاتح جداً** (الأبيض): يبقى لونَه، ويُحاط بحدٍّ يُرى.
 *  - **من لا يُعرَف قسمُه**: رماديٌّ محايد — لا يُخترَع له لون.
 *
 *  ولا تُزال خلفيةٌ من صورةٍ ليست شفّافة: الصورةُ المعتمة تُغطّي اللونَ
 *  كلَّه فتُرى كما رُفعت. فلا يُقال عن صورةٍ إنها صارت شفّافة. */
export function portraitTone(color: string | null | undefined): { background: string; ring: string | null } {
  if (!color) return { background: "#E7E5E0", ring: null };
  if (color.toLowerCase() === ORG_SENIOR_COLOR.toLowerCase()) {
    return { background: BRAND.temptress, ring: null };
  }
  return { background: color, ring: needsOutline(color) ? outlineFor(color) : null };
}
