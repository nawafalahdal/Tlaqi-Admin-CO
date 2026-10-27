/** سطرٌ في سجلّ البناء يقول حالَ Claude في هذه البيئة — بلا قيمة: أيُّ شرطٍ ناقصٌ بالضبط إن نقص.
 *  لا يُفشل البناءَ أبداً (الإعدادُ قرارُ المالك، لا شرطُ بناء)، ولا يطبع من المفتاح ولا من أي متغيّرٍ حرفاً. */
import { aiDiagnostics } from "../src/lib/marketing/ai/registry";

try {
  const d = aiDiagnostics();
  const s = d.status;
  const verdict = s.state === "ready" ? `جاهز (${d.model})` : `${s.state === "disabled" ? "معطّل" : "غير مهيّأ"}: ${s.reason}`;
  console.log(`Claude (وكيل التسويق) — ${d.deployment}: ${verdict}`);
  console.log(
    `  المزوّد: ${d.provider}${d.providerWasAlias ? " (اسمٌ بديل)" : ""} · المفتاح: ${d.keyPresent ? "موجود" : "غائب"}${d.keyHadWhitespace ? " (بمسافاتٍ أُزيلت)" : ""}${d.keyPresent && !d.keyLooksLikeAnthropic ? " (لا يشبه مفتاح Anthropic)" : ""} · التفعيل: ${d.enabledFlag} · النموذج: ${d.modelOverride ? "مضبوط" : "الافتراضي"}`
  );
} catch {
  console.log("Claude (وكيل التسويق): تعذّر التشخيص — لا أثر على البناء");
}
