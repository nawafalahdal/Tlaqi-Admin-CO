/** **رسالةُ بريدٍ تجريبيةٌ حقيقية — لا تُرسَل** (طلب المؤسس: اختبارُ القالب الموحّد والبطاقة المضمّنة قبل أي إرسال).
 *
 *  تبني رسالةَ الاعتماد كما تبنيها المنصةُ فعلاً (`sendWelcomePack` في وضع الالتقاط — لا مزوّدَ ولا سجلّ ولا إرسال)
 *  لحسابٍ اصطناعيٍّ في قاعدةٍ محلية، ثم تكتبها:
 *  - `test-email.eml`: رسالة MIME كاملة (multipart/related + مرفق) — تُفتح في Apple Mail وOutlook كما تصل؛
 *  - `test-email-preview.html`: معاينةٌ للمتصفح (صورةُ `cid:` مضمّنةٌ فيها بياناتٍ مباشرة)؛
 *  - `manifest.json`: الأحجامُ والمعرّفاتُ للفحص.
 *  المستلِمُ عنوانٌ وهميٌّ محجوز (`.invalid`) — فلا يصل شيءٌ لأحدٍ ولو أُرسل الملفُّ بالخطأ.
 *
 *  تشغيل: DATABASE_URL=<قاعدة محلية> APP_BASE_URL=https://www.tlaqiteam.site npx tsx --tsconfig tsconfig.json \
 *          scripts/build-test-email.ts <مجلّد الخرج> <بريد الحساب الاصطناعي> */
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { prisma } from "@/lib/prisma";

if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "")) {
  console.error("تُبنى من قاعدةٍ محلية اصطناعية وحدها");
  process.exit(1);
}
const [outDir, email] = process.argv.slice(2);
if (!outDir || !email) {
  console.error("الاستعمال: build-test-email.ts <مجلّد الخرج> <بريد الحساب الاصطناعي>");
  process.exit(1);
}
const TO = "tlaqi-test-recipient@example.invalid";
const b64 = (b: Buffer | string) => (typeof b === "string" ? Buffer.from(b, "utf8") : b).toString("base64").replace(/(.{76})/g, "$1\r\n");
const encWord = (s: string) => `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`;

(async () => {
  const { captureEmails } = await import("@/lib/emailCapture");
  const { sendWelcomePack } = await import("@/lib/welcome");
  const { renderEmail, htmlToText, toneForVariant, variantForKind } = await import("@/lib/emailBrand");
  const member = await prisma.member.findFirstOrThrow({ where: { email }, select: { id: true, fullName: true } });
  const mails = await captureEmails(() => sendWelcomePack({ kind: "member", id: member.id }, "approved"));
  const mail = mails.find((m) => m.kind === "ترحيب");
  if (!mail) throw new Error("لم تُبنَ رسالةُ الاعتماد");
  const { html, bodyHtml } = renderEmail({
    subject: mail.subject,
    content: { ...mail.content, tone: mail.content.tone ?? toneForVariant(variantForKind(mail.kind)) },
    theme: mail.theme,
    preheader: mail.subject,
  });
  const atts = mail.attachments ?? [];
  const inline = atts.filter((a) => a.contentId);
  const files = atts.filter((a) => !a.contentId);
  const B = { mixed: "=_tlaqi_mixed", related: "=_tlaqi_related", alt: "=_tlaqi_alt" };
  const from = process.env.EMAIL_FROM || "تلاق <hello@tlaqiteam.site>";
  const fromHdr = from.replace(/^([^<]+)</, (_, name: string) => `${encWord(name.trim())} <`);
  const lines = [
    `From: ${fromHdr}`,
    `To: ${TO}`,
    `Subject: ${encWord(mail.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    "MIME-Version: 1.0",
    "X-TLAQI-Test: not-sent; built for review only",
    `Content-Type: multipart/mixed; boundary="${B.mixed}"`,
    "",
    `--${B.mixed}`,
    `Content-Type: multipart/related; boundary="${B.related}"; type="multipart/alternative"`,
    "",
    `--${B.related}`,
    `Content-Type: multipart/alternative; boundary="${B.alt}"`,
    "",
    `--${B.alt}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    b64(htmlToText(bodyHtml)),
    `--${B.alt}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    b64(html),
    `--${B.alt}--`,
    ...inline.flatMap((a) => [
      `--${B.related}`,
      `Content-Type: image/png; name="${encWord(a.filename)}"`,
      "Content-Transfer-Encoding: base64",
      `Content-ID: <${a.contentId}>`,
      `Content-Disposition: inline; filename*=UTF-8''${encodeURIComponent(a.filename)}`,
      "",
      b64(a.content),
    ]),
    `--${B.related}--`,
    ...files.flatMap((a) => [
      `--${B.mixed}`,
      `Content-Type: image/png; name="${encWord(a.filename)}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename*=UTF-8''${encodeURIComponent(a.filename)}`,
      "",
      b64(a.content),
    ]),
    `--${B.mixed}--`,
    "",
  ];
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "test-email.eml"), lines.join("\r\n"));
  const preview = inline.reduce((h, a) => h.split(`cid:${a.contentId}`).join(`data:image/png;base64,${a.content.toString("base64")}`), html);
  writeFileSync(join(outDir, "test-email-preview.html"), preview);
  const manifest = {
    sent: false,
    to: TO,
    subject: mail.subject,
    kind: mail.kind,
    htmlBytes: Buffer.byteLength(html),
    inline: inline.map((a) => ({ cid: a.contentId, file: a.filename, bytes: a.content.length })),
    attachments: files.map((a) => ({ file: a.filename, bytes: a.content.length })),
    imageInBody: mail.content.image?.src ?? null,
    tagline: html.includes("نلتقي • نفكر • نصنع"),
    mahoganyMark: html.includes("email/mark-mahogany.png"),
    headerLtr: /<table[^>]*dir="ltr"/.test(html),
  };
  writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(JSON.stringify(manifest, null, 2));
  await prisma.$disconnect();
})().catch(async (e) => {
  console.error(e instanceof Error ? e.message : e);
  await prisma.$disconnect();
  process.exit(1);
});
