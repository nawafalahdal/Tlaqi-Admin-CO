/** مسارٌ داخليٌّ نسبيّ وحده (يبدأ بـ«/» لا «//» ولا «/\») — يمنع التحويل المفتوح (Open Redirect) لما يأتي من الرابط */
export function safeRedirectPath(input: string, fallback = "/"): string {
  return /^\/(?!\/|\\)/.test(input) ? input : fallback;
}
