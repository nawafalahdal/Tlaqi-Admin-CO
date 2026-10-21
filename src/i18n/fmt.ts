/** يملأ `{0}` و`{1}`… في نصّ القاموس بقيمها بالترتيب.
 *
 *  وما لا يرسمه React (`null` و`undefined` والقيم المنطقية) لا يُرسم هنا
 *  أيضاً — فيبقى النصُّ كما كان يُرسم قبل نقله إلى القاموس. */
export function fmt(s: string, ...values: unknown[]): string {
  return s.replace(/\{(\d+)\}/g, (_, i) => {
    const v = values[Number(i)];
    return v === null || v === undefined || typeof v === "boolean" ? "" : String(v);
  });
}
