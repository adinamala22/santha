import { opsFile } from '@/lib/ops/server';

/** Downloads: /admin/payouts/files/settlements/{runId}/payouts.csv and /admin/payouts/files/payouts/{id}/statement.pdf. */
export async function GET(_req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const allowed = /^(settlements\/[0-9a-f-]{36}\/payouts\.csv|payouts\/[0-9a-f-]{36}\/statement\.pdf)$/;
  const p = path.join('/');
  if (!allowed.test(p)) return new Response('Not found', { status: 404 });
  return opsFile(`/v1/ops/${p}`);
}
