/** **عيّناتُ كلِّ رسائل المنصة كما تُرسَل — بلا إرسال.** كلُّ دالة إرسالٍ في `lib/email.ts` تُستدعى بمتغيّراتٍ اصطناعية داخل وضع
 *  الالتقاط (`captureEmails`: لا مزوّدَ ولا سجلّ)، ثم تُبنى بـ`composeEmail` — الدالةِ نفسِها التي يستعملها الإرسال — فلا تختلف
 *  العيّنةُ عمّا يصل. ولكل رسالة:
 *  - `<key>.html`: معاينةٌ تُفتح في أي متصفحٍ أو عارض (صورُ `cid:` مضمّنةٌ بياناتٍ مباشرة — لا شيءَ من الشبكة)؛
 *  - `<key>.eml`: رسالة MIME كاملة كما تصل (multipart/related بصورٍ مضمّنة) — تُفتح في Apple Mail وOutlook.
 *  والمستلِمُ عنوانٌ محجوز (`.invalid`). رسالةُ الاعتماد تُبنى من حسابٍ اصطناعيٍّ في القاعدة المحلية (لبطاقته الحقيقية).
 *
 *  تشغيل: DATABASE_URL=<محلية> APP_BASE_URL=https://www.tlaqiteam.site npx tsx --tsconfig tsconfig.json \
 *          scripts/email-samples.ts <مجلّد الخرج> [بريد حسابٍ اصطناعيٍّ معتمد لرسالة الاعتماد] */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "")) {
  console.error("يُشغَّل على قاعدةٍ محلية وحدها");
  process.exit(1);
}
if (process.env.VERCEL || process.env.RESEND_API_KEY) {
  console.error("محلياً فقط والبريد معطّل");
  process.exit(1);
}
const [outDir, welcomeEmail] = process.argv.slice(2);
if (!outDir) {
  console.error("الاستعمال: email-samples.ts <مجلّد الخرج> [بريد حسابٍ اصطناعي]");
  process.exit(1);
}
const TO = "tlaqi-test-recipient@example.invalid";
const D = new Date("2026-11-20T09:00:00+03:00");
const U = "https://www.tlaqiteam.site/";
const P = { to: TO, fullName: "سارة أحمد" };
const b64 = (b: Buffer | string) => (typeof b === "string" ? Buffer.from(b, "utf8") : b).toString("base64").replace(/(.{76})/g, "$1\r\n");
const encWord = (s: string) => `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`;

(async () => {
  const { prisma } = await import("@/lib/prisma");
  const E = await import("@/lib/email");
  const { captureEmails } = await import("@/lib/emailCapture");
  const { composeEmail, inlineForPreview } = await import("@/lib/emailBrand");
  const { sendWelcomePack } = await import("@/lib/welcome");

  const samples: [string, string, () => Promise<unknown>][] = [
    ["01-invitation", "دعوة الانضمام", () => E.sendCredentialsEmail({ ...P, tempPassword: "Tq-Preview-0000", loginUrl: U + "login", occasion: "invitation", departmentName: "التسويق", jobTitle: "صانعة محتوى", invitedByName: "الإدارة", hoursValid: 72 })],
    ["02-login-code", "رمز الدخول", () => E.sendLoginCodeEmail({ ...P, code: "482913", minutesValid: 10 })],
    ["03-password-reset", "استعادة كلمة المرور", () => E.sendPasswordResetEmail({ ...P, resetUrl: U + "reset-password/preview", minutesValid: 30 })],
    ["04-test-reopened", "إعادة فتح الاختبار", () => E.sendTestReopenedEmail({ ...P, roleLabel: "عضوة", loginUrl: U + "login", hoursValid: 48 })],
    ["05-awaiting-approval", "مرشّح ينتظر الاعتماد", () => E.sendAwaitingApprovalEmail({ to: TO, candidateName: "سارة أحمد", candidateEmail: "candidate@example.invalid", score: 86, scopeLabel: "قسم التقنية", portalUrl: U + "admin/approvals" })],
    ["06-test-failed", "لم يجتز التقييم", () => E.sendTestFailedEmail({ ...P, score: 54, departmentName: "التقنية", dueDate: D })],
    ["07-meeting-owner", "اجتماعٌ بعد التقييم", () => E.sendMeetingOwnerEmail({ to: [TO], candidateName: "سارة أحمد", candidateEmail: "candidate@example.invalid", score: 54, departmentName: "التقنية", dueDate: D })],
    ["08-senior-invitation", "دعوة الإدارة العليا", () => E.sendSeniorInvitationEmail({ to: TO, fullName: P.fullName, titleAr: "المستشار القانوني", inviterName: "الرئيس التنفيذي", acceptUrl: U + "senior/invite/preview", expiresAt: D })],
    ["09-warning", "تنبيه عضو", () => E.sendWarningEmail({ ...P, reason: "التأخر في تسليم مهام الأسبوع دون إشعار.", warningsCount: 1, loginUrl: U + "login" })],
    ["10-exit", "إنهاء العضوية", () => E.sendExitEmail({ ...P, reason: "انتهاء مدة التكليف." })],
    ["11-certificate", "شهادة المشاركة", () => E.sendCertificateEmail({ ...P, roleLabel: "عضوة", departmentName: "التسويق", mission: "حملة الإطلاق", period: { start: new Date("2026-09-01"), end: D }, certificateUrl: U + "certificate/preview" })],
    ["12-appreciation", "شهادة شكر", () => E.sendAppreciationEmail({ ...P, jobTitle: "صانعة محتوى", departmentName: "التسويق", certificateUrl: U + "certificate/preview", fullTerm: true })],
    ["13-issued-certificate", "إصدار شهادة", () => E.sendIssuedCertificateEmail({ ...P, heading: "شهادة إنجاز", sentence: "تشهد تلاق بإتمام سارة أحمد مهامّها في حملة الإطلاق بكفاءة.", number: "TLQ-2026-0042", departmentName: "التسويق", certificateUrl: U + "certificate/preview" })],
    ["14-award", "تكريم", () => E.sendAwardEmail({ ...P, achievement: "قيادة حملة الإطلاق بنجاح", award: "وسام الأثر", note: "شكراً على التزامك.", fromName: "نورة سعد", fromRole: "قائدة قسم التسويق", portalUrl: U })],
    ["15-signature-request", "طلب توقيع القائد", () => E.sendSignatureRequestEmail({ ...P, roleLabel: "قائدة القسم", departmentName: "التسويق", uploadUrl: U + "admin/signature" })],
    ["16-termination-request", "طلب إنهاء تكليف", () => E.sendTerminationRequestEmail({ to: TO, memberName: "سارة أحمد", memberEmail: "member@example.invalid", assignmentLabel: "عضوة في التسويق", reason: "ظروفٌ دراسية.", requestedEndDate: D, portalUrl: U + "admin/terminations" })],
    ["17-termination-decision", "قرار طلب الإنهاء", () => E.sendTerminationDecisionEmail({ to: TO, memberName: "سارة أحمد", assignmentLabel: "عضوة في التسويق", decision: "approve", note: "نشكركِ على ما قدّمتِ.", endDate: D, byName: "نورة سعد" })],
    ["18-ticket-created", "تذكرة جديدة", () => E.sendTicketCreatedEmail({ to: TO, subject: "طلب صلاحية لأداة التصميم", description: "أحتاج صلاحية لملفات الهوية لتجهيز منشورات الحملة.", memberName: "سارة أحمد", dueDate: D, portalUrl: U })],
    ["19-ticket-escalated", "تصعيد تذكرة", () => E.sendTicketEscalatedEmail({ to: TO, subject: "طلب صلاحية لأداة التصميم", memberName: "سارة أحمد", description: "لم يُعالَج الطلب في موعده.", stageLabel: "بانتظار القائد", dueDate: D, portalUrl: U })],
    ["20-ticket-resolved", "حلّ تذكرة", () => E.sendTicketResolvedEmail({ to: TO, subject: "طلب صلاحية لأداة التصميم", resolutionNote: "مُنحت الصلاحية لمدة شهر." })],
    ["21-ticket-withdrawn", "سحب تذكرة", () => E.sendTicketWithdrawnEmail({ to: TO, ticketNumber: 1042, subject: "طلب صلاحية لأداة التصميم", reason: "لم تعد الحاجة قائمة.", byName: "سارة أحمد" })],
    ["22-approval-request", "طلب اعتماد", () => E.sendApprovalRequestEmail({ to: TO, ticketNumber: 1042, subject: "طلب شهادة إنجاز", kindLabel: "شهادة", requesterName: "سارة أحمد", requesterRole: "عضوة", stepsTotal: 2, url: U })],
    ["23-approval-decision", "قرار طلب", () => E.sendApprovalDecisionEmail({ to: TO, ticketNumber: 1042, subject: "طلب شهادة إنجاز", stateLabel: "اعتُمد", note: "اعتُمد الطلب وتُصدر الشهادة خلال يومين.", byName: "قائدة القسم", url: U })],
    ["24-ticket-reminder", "تذكير بموعد", () => E.sendTicketReminderEmail({ to: TO, subject: "تسليم خطة الحملة", memberName: "سارة أحمد", stageLabel: "بانتظار التنفيذ", dueDate: D, fromName: "المنصة", portalUrl: U })],
    ["25-request-reminder", "تذكير بطلب", () => E.sendRequestReminderEmail({ to: TO, typeLabel: "طلب إجازة", memberName: "سارة أحمد", note: "يرجى البتّ قبل نهاية الأسبوع.", dueDate: D, fromName: "المنصة" })],
    ["26-agreement-request", "طلب توقيع اتفاقية", () => E.sendAgreementRequestEmail({ to: TO, fullName: P.fullName, agreementTitle: "اتفاقية السرية وحماية أصول التسويق", signUrl: U + "agreements/marketing" })],
    ["27-agreement-otp", "رمز توقيع الاتفاقية", () => E.sendAgreementOtpEmail({ to: TO, fullName: P.fullName, agreementTitle: "اتفاقية السرية وحماية أصول التسويق", code: "730154", minutesValid: 10 })],
    ["28-agreement-signed", "تأكيد التوقيع", () => E.sendAgreementSignedEmail({ to: TO, fullName: P.fullName, agreementTitle: "اتفاقية السرية وحماية أصول التسويق", version: 1, signedAt: D, documentHash: "3f9a6c0d2b8e4f1a9c7d5e3b1a0f8e6d4c2b0a9e8d7c6b5a4f3e2d1c0b9ac21e", copyUrl: U + "agreements/signed/preview" })],
    ["29-announcement", "إعلان", () => E.sendAnnouncementEmail({ recipients: [TO], title: "اجتماع الفريق الشهري", body: "يسعدنا لقاؤكم في اجتماع الفريق الشهري لمراجعة إنجازات الشهر وخطة الشهر القادم.", authorName: "نورة سعد", audienceLabel: "قسم التسويق", portalUrl: U, meetingUrl: "https://meet.example.invalid/tlaqi" })],
    ["30-farewell", "ختام التجربة", () => E.sendFarewellEmail({ ...P, roleLabel: "عضوة", departmentName: "التسويق", joinDate: new Date("2026-03-01"), endDate: D, withCertificate: true })],
    ["31-committee-request", "طلب لجنة", () => E.sendCommitteeRequestEmail({ to: TO, approverName: "الرئيس التنفيذي", committeeName: "لجنة المحتوى الرقمي", parentName: "التسويق", leadTitle: "قائدة اللجنة", requestedByName: "نورة سعد", reviewUrl: U + "senior" })],
    ["32-committee-decision", "قرار لجنة", () => E.sendCommitteeDecisionEmail({ to: TO, fullName: P.fullName, committeeName: "لجنة المحتوى الرقمي", parentName: "التسويق", approved: true, note: "اعتُمدت اللجنة.", decidedByName: "الرئيس التنفيذي", boardUrl: U + "committees" })],
    ["33-committee-lead", "تعيين قائد لجنة", () => E.sendCommitteeLeadAppointedEmail({ ...P, committeeName: "لجنة المحتوى الرقمي", parentName: "التسويق", appointedByName: "نورة سعد", appointedByTitle: "قيادة قسم التسويق", url: U + "committees", appointedAt: D })],
    ["34-committee-lead-warning", "تنبيه قائد لجنة", () => E.sendCommitteeLeadWarningEmail({ ...P, committeeName: "لجنة المحتوى الرقمي", parentName: "التسويق", issuedByName: "نورة سعد", reason: "تأخّر محضر الاجتماع الأسبوعي.", ordinal: 1, url: U + "committees" })],
    ["35-committee-member", "الانضمام إلى لجنة", () => E.sendCommitteeMemberAddedEmail({ ...P, committeeName: "لجنة المحتوى الرقمي", url: U + "committees" })],
    ["36-deputy", "تعيين نائب", () => E.sendDeputyAppointedEmail({ ...P, departmentName: "التسويق", permissions: ["متابعة خطط الأسبوع", "مراجعة التسليمات"], appointedByName: "نورة سعد", url: U })],
    ["37-work-returned", "إعادة عمل للتعديل", () => E.sendWorkReturnedEmail({ ...P, taskTitle: "تصميم منشور الإطلاق", reason: "يحتاج المنشور إلى اعتماد ألوان الهوية.", dueLabel: "الخميس", taskUrl: U })],
  ];
  if (welcomeEmail) {
    const member = await prisma.member.findFirstOrThrow({ where: { email: welcomeEmail }, select: { id: true } });
    samples.unshift(["00-approval", "رسالة الاعتماد (بالبطاقة)", () => sendWelcomePack({ kind: "member", id: member.id }, "approved")]);
  }

  mkdirSync(outDir, { recursive: true });
  const report: Record<string, unknown>[] = [];
  for (const [key, title, fn] of samples) {
    const mails = await captureEmails(fn);
    const mail = key === "00-approval" ? mails.find((m) => m.kind === "ترحيب") : mails[0];
    if (!mail) {
      report.push({ key, title, error: "لم تُلتقط رسالة (قد تكون محجوبةً بسياسة الإشعارات)" });
      continue;
    }
    const c = composeEmail({ subject: mail.subject, content: mail.content, kind: mail.kind, theme: mail.theme, attachments: mail.attachments });
    writeFileSync(join(outDir, `${key}.html`), inlineForPreview(c.html, c.attachments));
    const inline = c.attachments.filter((a) => a.contentId);
    const files = c.attachments.filter((a) => !a.contentId);
    const Bd = { mixed: "=_tlaqi_mixed", related: "=_tlaqi_related", alt: "=_tlaqi_alt" };
    const eml = [
      `From: ${encWord("تلاق")} <hello@tlaqiteam.site>`,
      `To: ${TO}`,
      `Subject: ${encWord(mail.subject)}`,
      `Date: ${new Date().toUTCString()}`,
      "MIME-Version: 1.0",
      "X-TLAQI-Test: not-sent; built for review only",
      `Content-Type: multipart/mixed; boundary="${Bd.mixed}"`,
      "",
      `--${Bd.mixed}`,
      `Content-Type: multipart/related; boundary="${Bd.related}"; type="multipart/alternative"`,
      "",
      `--${Bd.related}`,
      `Content-Type: multipart/alternative; boundary="${Bd.alt}"`,
      "",
      `--${Bd.alt}`,
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      b64(c.text),
      `--${Bd.alt}`,
      "Content-Type: text/html; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      b64(c.html),
      `--${Bd.alt}--`,
      ...inline.flatMap((a) => [
        `--${Bd.related}`,
        `Content-Type: image/png; name="${encWord(a.filename)}"`,
        "Content-Transfer-Encoding: base64",
        `Content-ID: <${a.contentId}>`,
        `Content-Disposition: inline; filename*=UTF-8''${encodeURIComponent(a.filename)}`,
        "",
        b64(a.content),
      ]),
      `--${Bd.related}--`,
      ...files.flatMap((a) => [
        `--${Bd.mixed}`,
        `Content-Type: image/png; name="${encWord(a.filename)}"`,
        "Content-Transfer-Encoding: base64",
        `Content-Disposition: attachment; filename*=UTF-8''${encodeURIComponent(a.filename)}`,
        "",
        b64(a.content),
      ]),
      `--${Bd.mixed}--`,
      "",
    ].join("\r\n");
    writeFileSync(join(outDir, `${key}.eml`), eml);
    const cids = [...c.html.matchAll(/src="cid:([^"]+)"/g)].map((m) => m[1]);
    report.push({
      key,
      title,
      subject: mail.subject,
      kind: mail.kind,
      htmlBytes: Buffer.byteLength(c.html),
      remoteImages: [...c.html.matchAll(/<img[^>]+src="(https?:[^"]+)"/g)].map((m) => m[1]),
      cidsReferenced: cids,
      cidsMissing: cids.filter((id) => !inline.some((a) => a.contentId === id)),
      attachments: c.attachments.map((a) => ({ file: a.filename, cid: a.contentId ?? null, bytes: a.content.length })),
    });
  }
  writeFileSync(join(outDir, "manifest.json"), JSON.stringify({ sent: false, to: TO, generatedAt: new Date().toISOString(), emails: report }, null, 2));
  const bad = report.filter((r) => r.error || (r.cidsMissing as string[] | undefined)?.length || (r.remoteImages as string[] | undefined)?.length);
  console.log(`${report.length} رسالة → ${outDir}${bad.length ? `\nمشكلات: ${JSON.stringify(bad, null, 1)}` : "\nلا صورةَ خارجية ولا معرّفَ cid بلا مرفق"}`);
  await prisma.$disconnect();
})().catch((e) => {
  console.error(e instanceof Error ? e.stack : e);
  process.exit(1);
});
