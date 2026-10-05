const TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_ID = process.env.WHATSAPP_PHONE_ID;

/** يرسل رسالة واتساب عبر WhatsApp Cloud API — بدون بيانات اعتماد يسجّل الرسالة فقط
 *  في الـ console دون كسر أي تدفق، بنفس أسلوب lib/email.ts و lib/googleSheets.ts */
export async function sendWhatsAppMessage(opts: { to: string; text: string }) {
  if (!TOKEN || !PHONE_ID) {
    console.warn(
      "[whatsapp:disabled] لم تُضبط WHATSAPP_TOKEN/WHATSAPP_PHONE_ID — سيُطبع هنا فقط."
    );
    console.warn(`→ إلى: ${opts.to}\n${opts.text}`);
    return { skipped: true };
  }

  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/${PHONE_ID}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: opts.to,
        type: "text",
        text: { body: opts.text },
      }),
    });
    if (!res.ok) throw new Error(await res.text());
    return { skipped: false };
  } catch (err) {
    console.error("فشل إرسال رسالة واتساب:", err);
    return { skipped: true, error: true };
  }
}
