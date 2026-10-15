/** قائمةُ سماح الروابط — تُفحَص بما يُهاجَم به لا بما يُرجى منها.
 *
 *  **وهذا هو الفحصُ الذي يَستحقّ أن يُكتَب:** أن يَقبل رابطَ درايف
 *  الصحيحَ أمرٌ يُرى بالعين. وأن يَرفض `drive.google.com.evil.co` لا
 *  يُرى إلا بفحصٍ يُجرّبه — وهو عينُ ما يَسقط فيه الفحصُ بالنصّ.
 */
import { checkExternalLink, linkSourceLabel, sourceOfSavedLink } from "../src/lib/externalLinks";

const log: string[] = [];
const chk = (name: string, ok: boolean, detail = "") =>
  log.push(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);

const accepts = (url: string, source: string, name: string) => {
  const r = checkExternalLink(url);
  chk(name, r.ok && r.source === source, r.ok ? r.source : r.reason);
};
const rejects = (url: string, name: string) => {
  const r = checkExternalLink(url);
  chk(name, r.ok === false, r.ok ? `قُبل! (${r.source})` : r.reason);
};

// ── ١) ما يُقبَل: المصادر الأربعة بنطاقاتها الرسمية
accepts("https://drive.google.com/file/d/1AbC/view", "drive", "رابطُ درايف يُقبَل");
accepts("https://docs.google.com/document/d/1AbC/edit", "docs", "ومستندُ جوجل");
accepts("https://docs.google.com/spreadsheets/d/1AbC/edit", "docs", "وجدولُ جوجل");
accepts("https://docs.google.com/presentation/d/1AbC/edit", "docs", "وشرائحُ جوجل");
accepts("https://www.canva.com/design/DAF123/view", "canva", "وتصميمُ كانفا");
accepts("https://canva.com/design/DAF123/view", "canva", "وكانفا بلا www");
accepts("https://meet.google.com/abc-defg-hij", "meet", "ورابطُ ميت");

// ── ٢) البروتوكول: ما يُنفَّذ أو يُكشَف
rejects("javascript:alert(document.cookie)", "**`javascript:` يُرفَض — بابُ تنفيذٍ في أصل المنصة**");
rejects("JavaScript:alert(1)", "وبأحرفٍ مختلطةٍ كذلك");
rejects("data:text/html;base64,PHNjcmlwdD4=", "**و`data:` — صفحةٌ تُرسَم من نصٍّ وضعه غيرُنا**");
rejects("http://drive.google.com/file/d/1/view", "وhttp مكشوفٌ ولو كان النطاقُ صحيحاً");
rejects("file:///etc/passwd", "و`file:`");
rejects("vbscript:msgbox(1)", "و`vbscript:`");

// ── ٣) النطاقاتُ المُشبِهة — وهذا ما يَسقط فيه الفحصُ بالنصّ
rejects("https://drive.google.com.evil.co/file/d/1/view",
        "**`drive.google.com.evil.co` يُرفَض — اللاحقةُ ليست المضيف**");
rejects("https://evil.co/?u=https://drive.google.com/file/d/1",
        "**ونطاقٌ يَحمل درايف في استعلامه**");
rejects("https://evil.co/#drive.google.com", "ونطاقٌ يَحمله في مِرساته");
rejects("https://notcanva.com/design/DAF123", "**و`notcanva.com` — اللاحقةُ بلا نقطةٍ لا تُقبل**");
rejects("https://canva.com.phish.io/design/x", "و`canva.com.phish.io`");
rejects("https://meet.google.com.attacker.net/abc", "و`meet.google.com.attacker.net`");
rejects("https://googledrive.com/file/d/1", "و`googledrive.com` ليس درايف");
rejects("https://google.com/search?q=x", "**و`google.com` وحدَه ليس درايف ولا مستندات**");

// ── ٤) نطاقاتٌ فرعيةٌ تحت المسموح تُقبَل
accepts("https://a.canva.com/design/x", "canva", "ونطاقٌ فرعيٌّ تحت كانفا يُقبَل");

// ── ٥) بياناتُ دخولٍ في الرابط: تُخفي المضيفَ عن العين
rejects("https://user:pass@drive.google.com/file/d/1/view",
        "**ورابطٌ يَحمل بيانات دخول — يُخفي المضيفَ ويَنقل سرّاً**");
rejects("https://drive.google.com@evil.co/x",
        "**و`drive.google.com@evil.co` — ما قبل @ اسمُ مستعمِلٍ لا مضيف**");

// ── ٦) الفارغُ والمعطوب
rejects("", "والفارغُ يُرفَض");
rejects("   ", "والفراغُ وحده");
rejects("ليس رابطاً", "وما ليس رابطاً أصلاً");
rejects("drive.google.com/file/d/1", "وبلا بروتوكولٍ لا يُقبَل");

// ── ٧) حصرُ المصادر: اجتماعٌ لا يُقبَل مكانَ وثيقة
{
  const r = checkExternalLink("https://meet.google.com/abc-defg-hij", ["drive", "docs"]);
  chk("**ورابطُ ميت يُرفَض حيث تُطلَب وثيقة**", r.ok === false,
      r.ok ? "قُبل!" : r.reason);
  const d = checkExternalLink("https://drive.google.com/file/d/1/view", ["meet"]);
  chk("ورابطُ درايف يُرفَض حيث يُطلَب اجتماع", d.ok === false,
      d.ok ? "قُبل!" : d.reason);
}

// ── ٨) السببُ يُسمّى بعينه لا يُقال «غير مقبول»
{
  const r = checkExternalLink("https://dropbox.com/s/x/file.pdf");
  chk("**والسببُ يُسمّي النطاقَ المرفوضَ والمقبولَ**",
      r.ok === false && r.reason.includes("dropbox.com") && r.reason.includes("درايف"),
      r.ok ? "قُبل!" : r.reason);
}

// ── ٩) الوسمُ يُقرأ، والمحفوظُ سلفاً يُستنتَج ولا يُحذَف
chk("ووسمُ المصدر عربيٌّ يُقرأ", linkSourceLabel("drive") === "جوجل درايف",
    linkSourceLabel("drive"));
chk("والمحفوظُ سلفاً يُستنتَج مصدرُه",
    sourceOfSavedLink("https://drive.google.com/file/d/1/view") === "drive");
chk("**وما حُفظ قبل القائمة يُعاد `null` ولا يُتلَف**",
    sourceOfSavedLink("https://dropbox.com/s/x") === null);

// ── ١٠) الرابطُ المُعاد هو المُحلَّل لا النصُّ الخام
{
  const r = checkExternalLink("  https://drive.google.com/file/d/1AbC/view  ");
  chk("والمُعادُ منزوعُ الفراغ", r.ok && !/^\s|\s$/.test(r.url), r.ok ? r.url : r.reason);
}

console.log(log.join("\n"));
const failed = log.some((l) => l.startsWith("✗"));
console.log("\n" + (failed ? "FAILURES PRESENT" : "ALL PASS"));
process.exit(failed ? 1 : 0);
