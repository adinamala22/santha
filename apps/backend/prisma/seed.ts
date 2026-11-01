/**
 * Local/dev seed. Idempotent — safe to run repeatedly.
 * M0 seeds identities only (2 test consumers, 3 riders, 12 merchant owners, 1 ops admin).
 * M1 adds Nellore city, the four micro-markets and the 12 demo merchants; M2 adds ~200 items.
 * The people list lives in src/dev/seed-data.ts so the in-memory fake store (DATA_STORE=memory) matches.
 */
import { PrismaClient } from '@prisma/client';
import { SEED_PEOPLE } from '../src/dev/seed-data';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  for (const p of SEED_PEOPLE) {
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
  console.log(`Seeded ${SEED_PEOPLE.length} users.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
