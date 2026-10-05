import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const DEPARTMENTS = [
  { name: "التسويق", slug: "marketing", colorHex: "#C34900" },
  { name: "الموارد البشرية", slug: "hr", colorHex: "#EEF6DF" },
  { name: "التقنية", slug: "tech", colorHex: "#67C090" },
];

async function main() {
  const departments = new Map<string, string>();

  for (const dept of DEPARTMENTS) {
    const record = await prisma.department.upsert({
      where: { slug: dept.slug },
      update: { name: dept.name, colorHex: dept.colorHex },
      create: dept,
    });
    departments.set(dept.slug, record.id);
  }

  const superAdminPassword = await bcrypt.hash("Tlaqi@2026", 10);
  await prisma.user.upsert({
    where: { email: "super.admin@tlaqi.co" },
    update: {},
    create: {
      fullName: "الإدارة العليا",
      email: "super.admin@tlaqi.co",
      passwordHash: superAdminPassword,
      role: "super_admin",
    },
  });

  const deptAdminPassword = await bcrypt.hash("Tlaqi@2026", 10);
  const deptAdmins = [
    { email: "marketing.admin@tlaqi.co", name: "أدمن التسويق", slug: "marketing" },
    { email: "hr.admin@tlaqi.co", name: "أدمن الموارد البشرية", slug: "hr" },
    { email: "tech.admin@tlaqi.co", name: "أدمن التقنية", slug: "tech" },
  ];

  for (const admin of deptAdmins) {
    await prisma.user.upsert({
      where: { email: admin.email },
      update: {},
      create: {
        fullName: admin.name,
        email: admin.email,
        passwordHash: deptAdminPassword,
        role: "department_admin",
        departmentId: departments.get(admin.slug),
      },
    });
  }

  console.log("Seed complete. Default password for all accounts: Tlaqi@2026");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
