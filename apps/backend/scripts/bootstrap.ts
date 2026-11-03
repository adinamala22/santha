/**
 * First-run setup of a staging or production database, where the demo seed is never run:
 * creates the city and the first ops admin, idempotently.
 *
 *   BOOTSTRAP_ADMIN_EMAIL=you@santha.app BOOTSTRAP_ADMIN_PHONE=+9198xxxxxxxx BOOTSTRAP_ADMIN_NAME="Your Name" \
 *   BOOTSTRAP_ADMIN_PASSWORD='a long passphrase' pnpm --filter backend bootstrap
 *
 * On a server: `infra/deploy/santha.sh bootstrap` (runs this in the tools image with the server's .env).
 * After this, everything else is done in the ops console. The admin signs in with email + password, then a
 * one-time code by SMS to BOOTSTRAP_ADMIN_PHONE. From the console you can create micro-markets, more ops
 * staff, merchants and so on. Re-running only updates the admin's name, password and role. It writes an
 * audit row each time.
 */
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/modules/identity-kyc/domain/secrets';

const CITY = { slug: 'nellore', name: 'Nellore', nameTe: 'నెల్లూరు', state: 'Andhra Pradesh' };

function required(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`${name} is required`);
  return v;
}

async function main() {
  const email = required('BOOTSTRAP_ADMIN_EMAIL').toLowerCase();
  const phone = required('BOOTSTRAP_ADMIN_PHONE').replace(/\s/g, '');
  const name = required('BOOTSTRAP_ADMIN_NAME');
  const password = required('BOOTSTRAP_ADMIN_PASSWORD');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('BOOTSTRAP_ADMIN_EMAIL is not an email address');
  if (!/^\+91[6-9]\d{9}$/.test(phone)) throw new Error('BOOTSTRAP_ADMIN_PHONE must look like +919876543210');
  if (password.length < 14) throw new Error('BOOTSTRAP_ADMIN_PASSWORD must be at least 14 characters');
  if (process.env.APP_ENV === 'dev') console.warn('APP_ENV=dev: for local data use `pnpm --filter backend seed` instead.');

  const prisma = new PrismaClient();
  try {
    const city = await prisma.city.upsert({ where: { slug: CITY.slug }, create: CITY, update: {} });

    const byEmail = await prisma.user.findFirst({ where: { email } });
    const byPhone = await prisma.user.findUnique({ where: { phone } });
    if (byEmail && byPhone && byEmail.id !== byPhone.id) throw new Error('That email and that phone belong to two different accounts');
    const existing = byEmail ?? byPhone;
    const data = { name, email, phone, passwordHash: hashPassword(password) };
    const user = existing ? await prisma.user.update({ where: { id: existing.id }, data }) : await prisma.user.create({ data });
    await prisma.userRole.createMany({ data: [{ userId: user.id, role: 'admin' }], skipDuplicates: true });
    await prisma.auditEvent.create({
      data: { entity: 'user', entityId: user.id, action: existing ? 'ops_admin.bootstrap_updated' : 'ops_admin.bootstrapped', actorId: null, after: { email, roles: ['admin'] } },
    });

    console.log(`City: ${city.name} (${city.slug})`);
    console.log(`Admin: ${email} (${existing ? 'updated' : 'created'}). Sign in at <web>/admin/login; the code goes by SMS to ${phone.slice(0, 5)}******${phone.slice(-2)}.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
