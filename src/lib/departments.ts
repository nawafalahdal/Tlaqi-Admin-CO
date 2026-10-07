import { prisma } from "@/lib/prisma";
import { appendMemberEvent } from "@/lib/googleSheets";

/** من يملك إنشاء قسم: الفاوندر والمدير التنفيذي.
 *  بناء الهيكل قرار تنظيمي، لا إجراء تشغيلي يومي. */
export function canCreateDepartment(role: string) {
  return role === "super_admin" || role === "executive";
}

const HEX = /^#[0-9a-fA-F]{6}$/;

/** يبني معرّفاً لاتينياً صالحاً للرابط من اسم القسم.
 *
 *  أسماء الأقسام عربية، والعربية لا تصلح جزءاً من مسار URL نظيف، فإن لم
 *  يبقَ من الاسم حرف لاتيني واحد نولّد معرّفاً مقروءاً بدل أن نفشل. */
function slugify(name: string) {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return base || `dept-${Date.now().toString(36)}`;
}

/** يضمن تفرّد المعرّف بإضافة لاحقة رقمية عند التعارض */
async function uniqueSlug(base: string) {
  let slug = base;
  let n = 2;
  while (await prisma.department.findUnique({ where: { slug } })) {
    slug = `${base}-${n}`;
    n++;
  }
  return slug;
}

/** ينشئ قسماً جديداً كامل الأهلية.
 *
 *  القسم بلا بنك أسئلة قسمٌ لا يمكن دعوة أحد إليه: دالة اختيار المسار
 *  تبحث عن بنك عضو القسم وتفشل إن لم تجده. فيُنشأ البنك فارغاً مع القسم،
 *  ويملؤه قائده لاحقاً — هكذا يولد القسم مكتملاً لا ناقصاً. */
export async function createDepartment(opts: {
  name: string;
  colorHex: string;
  createdByName: string;
}) {
  const name = opts.name.trim();
  const colorHex = opts.colorHex.trim();

  if (!name) throw new Error("اسم القسم مطلوب");
  if (!HEX.test(colorHex)) throw new Error("اللون يجب أن يكون بصيغة #RRGGBB");

  const existing = await prisma.department.findUnique({ where: { name } });
  if (existing) throw new Error("يوجد قسم بهذا الاسم بالفعل");

  const slug = await uniqueSlug(slugify(name));

  const department = await prisma.department.create({
    data: { name, slug, colorHex },
  });

  await prisma.testTrack.create({
    data: { scope: "department_member", departmentId: department.id },
  });

  await appendMemberEvent({
    fullName: opts.createdByName,
    email: "",
    roleOrDepartment: name,
    event: "إنشاء قسم جديد",
    details: `اللون: ${colorHex} — المعرّف: ${slug} — أُنشئ معه بنك أسئلة فارغ لأعضائه`,
    at: new Date(),
  });

  return department;
}
