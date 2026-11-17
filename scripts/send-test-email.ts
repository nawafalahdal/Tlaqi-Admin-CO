/** **رسالةٌ تجريبية لبريد المؤسس وحده** (موافقته، نوفمبر 2026) — رسائلُ النموذج الأولي الأربع كما تبنيها المنصة، ببياناتٍ
 *  اصطناعية من قاعدةٍ محلية، تُرسَل إلى **عنوانٍ واحد** لا غير.
 *
 *  ضماناتٌ لا تُتجاوز:
 *  - **بلا `--send` لا يُرسَل شيء:** تجربةٌ جافّة تطبع المستلمَ والعناوينَ والأحجام فقط.
 *  - **مستلمٌ واحد** يُكتب مرّتين ويجب أن يتطابقا: `--to=<بريد>` و`TEST_EMAIL_TO` في البيئة — فلا يُرسَل لعنوانٍ بالخطأ.
 *  - المستلمون الأصليون في الرسائل الملتقطة (حساباتٌ اصطناعية) **لا يُراسَلون أبداً**: الرسالةُ تُلتقط ولا تُرسَل، ثم تُبنى
 *    بـ`composeEmail` (الدالةِ نفسِها التي يرسل بها المسار) وتُرسَل إلى المستلم الواحد وحده، وعنوانُها يبدأ بـ«[تجربة]».
 *  - قاعدةٌ محليةٌ اصطناعيةٌ وحدها، ولا يعمل على Vercel، ولا يكتب في سجلّ البريد ولا في الشيت.
 *
 *  تشغيل: DATABASE_URL=<محلية> APP_BASE_URL=https://www.tlaqiteam.site TEST_EMAIL_TO=<بريد> npx tsx --tsconfig tsconfig.json \
 *          scripts/send-test-email.ts --to=<البريد نفسه> [--send] [--only=approval,invitation,login-code,committee-lead]
 *          (حسابٌ اصطناعيٌّ للبطاقة: --account=member.ui@example.test) */
import { Resend } from "resend";

const args = process.argv.slice(2);
const arg = (k: string) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? null;
const SEND = args.includes("--send");
const to = (arg("to") ?? "").trim().toLowerCase();
const confirmTo = (process.env.TEST_EMAIL_TO ?? "").trim().toLowerCase();
const account = arg("account") ?? "member.ui@example.test";
const only = (arg("only") ?? "approval,invitation,login-code,committee-lead").split(",").filter(Boolean);

function stop(msg: string): never {
  console.error(msg);
  process.exit(1);
}
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "")) stop("يُشغَّل على قاعدةٍ محلية اصطناعية وحدها");
if (process.env.VERCEL) stop("محلياً فقط — لا يعمل على Vercel");
if (!/^[^\s@,;]+@[^\s@,;]+\.[a-z]{2,}$/i.test(to)) stop("مستلمٌ واحد صالح مطلوب: --to=<بريد>");
if (to !== confirmTo) stop("المستلم يُكتب مرّتين ويجب أن يتطابقا: --to و TEST_EMAIL_TO");

const FROM = process.env.EMAIL_FROM || "تلاق <hello@tlaqiteam.site>";
const U = "https://www.tlaqiteam.site/";
const D = new Date("2026-11-20T09:00:00+03:00");

(async () => {
  const { prisma } = await import("@/lib/prisma");
  const E = await import("@/lib/email");
  const { captureEmails } = await import("@/lib/emailCapture");
  
  const { composeEmailWithHeader } = await import("@/lib/emailHeader");
  const { sendWelcomePack } = await import("@/lib/welcome");
  const sharp = (await import("sharp")).default;
  const { renderInviteCard } = await import("@/lib/shareCards");
  const { INVITE_CONTENT_ID, INVITE_INLINE_WIDTH } = await import("@/lib/inviteCard");

  const member = await prisma.member.findFirst({ where: { email: account }, select: { id: true, email: true } });
  if (!member) stop(`لا حسابَ اصطناعيَّ بالبريد ${account} في القاعدة المحلية`);
  const synth = member.email; // يُقرأ منه الجنسُ والقسم للمخاطبة — ولا يُراسَل
  const poster = async () => ({
    filename: "TLAQI-invitation.png",
    content: await sharp(await renderInviteCard({ fullName: "سارة أحمد", position: "عضوية قسم التسويق", jobTitle: "صانعة محتوى", departmentName: "التسويق", colorHex: "#C34900", invitedByName: "نورة سعد", issuedAt: D }))
      .resize({ width: INVITE_INLINE_WIDTH * 2 })
      .png({ compressionLevel: 9 })
      .toBuffer(),
    contentId: INVITE_CONTENT_ID,
  });
  const defs: Record<string, () => Promise<unknown>> = {
    approval: () => sendWelcomePack({ kind: "member", id: member.id }, "approved"),
    invitation: async () => E.sendCredentialsEmail({ to: "candidate@example.invalid", fullName: "سارة أحمد", tempPassword: "Tq-Preview-0000", loginUrl: U + "login", occasion: "invitation", targetRole: "member", departmentName: "التسويق", jobTitle: "صانعة محتوى", invitedByName: "نورة سعد", hoursValid: 72, inviteCard: await poster() }),
    "login-code": () => E.sendLoginCodeEmail({ to: synth, fullName: "سارة أحمد", code: "482913", minutesValid: 10 }),
    "committee-lead": () => E.sendCommitteeLeadAppointedEmail({ to: synth, fullName: "سارة أحمد", committeeName: "لجنة المحتوى الرقمي", parentName: "التسويق", appointedByName: "نورة سعد", appointedByTitle: "قيادة قسم التسويق", url: U + "committees", appointedAt: D }),
  };

  const resend = SEND ? new Resend(process.env.RESEND_API_KEY || stop("RESEND_API_KEY غير مضبوط")) : null;
  console.log(`${SEND ? "إرسالٌ فعلي" : "تجربةٌ جافّة (لا إرسال)"} — المستلمُ الوحيد: ${to}\nالمُرسِل: ${FROM}`);
  for (const key of only) {
    const fn = defs[key];
    if (!fn) stop(`نوعٌ غير معروف: ${key}`);
    const mails = await captureEmails(fn);
    const mail = key === "approval" ? mails.find((m) => m.kind === "ترحيب") : mails[0];
    if (!mail) stop(`لم تُبنَ رسالة: ${key}`);
    const c = await composeEmailWithHeader({ subject: mail.subject, content: mail.content, kind: mail.kind, theme: mail.theme, attachments: mail.attachments });
    const subject = `[تجربة] ${mail.subject}`;
    const size = Buffer.byteLength(c.html) + c.attachments.reduce((n, a) => n + a.content.length, 0);
    console.log(`- ${key}: «${subject}» — ${Math.round(size / 1024)} ك.ب، مرفقات: ${c.attachments.map((a) => a.contentId ?? a.filename).join("، ")}`);
    if (!resend) continue;
    const res = await resend.emails.send({
      from: FROM,
      to: [to],
      subject,
      html: c.html,
      text: c.text,
      attachments: c.attachments.map((a) => ({ filename: a.filename, content: a.content, ...(a.contentId ? { contentId: a.contentId } : {}) })),
      headers: { "X-Entity-Ref-ID": `tlaqi-test-${key}-${Date.now()}`, "X-TLAQI-Test": "prototype" },
    });
    if (res.error) stop(`رفض المزوّد (${key}): ${res.error.name ?? ""} ${res.error.message ?? ""}`);
    console.log(`  أُرسلت — معرّفُ المزوّد: ${res.data?.id ?? "—"}`);
  }
  await prisma.$disconnect();
})().catch((e) => stop(e instanceof Error ? e.message : String(e)));
