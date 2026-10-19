/** يُطبّق السمة قبل أول رسمٍ على الشاشة.
 *
 *  **وهذا سببُ وجوده الوحيد: الومضة.** لو انتُظر React ليقرأ التفضيل
 *  لرُسمت الصفحة فاتحةً جزءاً من الثانية ثم قُلبت داكنة — ومضةٌ بيضاء
 *  في وجه من يفتح المنصة ليلاً، وهي أسوأ من ألّا يكون هناك وضعٌ داكن.
 *
 *  فيُحقَن نصٌّ متزامنٌ في `<head>`: يقرأ اختيار صاحبه، وإلّا فتفضيل
 *  نظامه، ويضع `data-theme` على `<html>` قبل أن يُرسَم شيء. وهو ثابتٌ
 *  مكتوبٌ بيدنا لا مُركَّبٌ من مدخلات، فلا حقنَ فيه.
 *
 *  ويضع معها حالَ القائمة الجانبية (مطويّة/موسَّعة) للسبب نفسه: لا تنقلب بعد ظهورها.
 */
export function ThemeScript() {
  const code = `(function(){try{
    var k="tlaqi-theme",c=localStorage.getItem(k);
    var d=c?c==="dark":window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.dataset.theme=d?"dark":"light";
    document.documentElement.dataset.sidebar=localStorage.getItem("tlaqi-sidebar")==="collapsed"?"collapsed":"expanded";
  }catch(e){document.documentElement.dataset.theme="light";}})();`;
  return <script dangerouslySetInnerHTML={{ __html: code }} />;
}
