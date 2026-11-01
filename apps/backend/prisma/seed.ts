/**
 * Local/dev seed. Idempotent — safe to run repeatedly.
 * M0 seeds identities only (2 test consumers, 3 riders, 12 merchant owners, 1 ops admin).
 * M1 adds Nellore city, the four micro-markets and the 12 demo merchants; M2 adds ~200 items.
 * All numbers are in the +91 90000 00xxx test range; with MOCK_OTP_CODE=123456 any of them logs in.
 */
import { PrismaClient, Role } from '@prisma/client';

const prisma = new PrismaClient();

const people: Array<{ phone: string; name: string; roles: Role[] }> = [
  { phone: '+919000000001', name: 'Test Consumer One', roles: ['consumer'] },
  { phone: '+919000000002', name: 'Test Consumer Two', roles: ['consumer'] },
  ...[1, 2, 3].map((i) => ({ phone: `+91900000010${i}`, name: `Demo Rider ${i}`, roles: ['rider'] as Role[] })),
  ...Array.from({ length: 12 }, (_, i) => ({
    phone: `+919000000${(201 + i).toString()}`,
    name: `Demo Merchant Owner ${i + 1}`,
    roles: ['merchant'] as Role[],
  })),
  { phone: '+919000000900', name: 'Ops Admin', roles: ['admin', 'ops'] },
];

async function main(): Promise<void> {
  for (const p of people) {
    const user = await prisma.user.upsert({
      where: { phone: p.phone },
      create: { phone: p.phone, name: p.name },
      update: { name: p.name },
    });
    await prisma.userRole.createMany({
      data: p.roles.map((role) => ({ userId: user.id, role })),
      skipDuplicates: true,
    });
  }
  console.log(`Seeded ${people.length} users.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
