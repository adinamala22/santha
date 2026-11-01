'use server';

import type { MicroMarketDetail, MicroMarketVersion } from '@santha/shared-types';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { fromLocalInput, rupeeInputToPaise } from '@/lib/format';
import { opsApi } from '@/lib/ops/server';

export interface EditorState {
  ok: boolean;
  code?: string;
  message?: string;
  version?: number;
}

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
const FEES = ['deliveryBasePaise', 'deliveryPerKmPaise', 'freeDeliveryAbovePaise', 'smallOrderThresholdPaise', 'smallOrderFeePaise', 'platformFeePaise', 'packagingFeeCapPaise'] as const;
const RIDER = ['basePaise', 'perKmPaise', 'waitPerMinPaise', 'batchBonusPaise'] as const;
const SLA = ['merchantAcceptSec', 'etaBufferMin', 'riderFallbackMin', 'staleCatalogueHours'] as const;

type Config = Pick<MicroMarketVersion, 'polygon' | 'hours' | 'fees' | 'cod' | 'sla' | 'riderPay'>;

/** Form → config (money fields are entered in rupees and sent as integer paise). */
function parseConfig(form: FormData): Config {
  const s = (k: string) => String(form.get(k) ?? '');
  const ring = JSON.parse(s('polygon') || '[]') as Array<[number, number]>;
  return {
    polygon: { type: 'Polygon', coordinates: [ring] },
    hours: Object.fromEntries(
      DAYS.map((d) => [d, form.get(`hours.${d}.closed`) ? [] : [{ open: s(`hours.${d}.open`), close: s(`hours.${d}.close`) }]]),
    ) as Config['hours'],
    fees: Object.fromEntries(FEES.map((k) => [k, rupeeInputToPaise(s(`fees.${k}`))])) as Config['fees'],
    cod: {
      enabled: form.get('cod.enabled') === 'on',
      maxOrderPaise: rupeeInputToPaise(s('cod.maxOrderPaise')),
      allowedTypes: (['retail', 'fashion'] as const).filter((t) => form.get(`cod.type.${t}`) === 'on'),
    },
    sla: Object.fromEntries(SLA.map((k) => [k, Number(s(`sla.${k}`))])) as Config['sla'],
    riderPay: Object.fromEntries(RIDER.map((k) => [k, rupeeInputToPaise(s(`riderPay.${k}`))])) as Config['riderPay'],
  };
}

export async function publishVersion(id: string, _prev: EditorState, form: FormData): Promise<EditorState> {
  const r = await opsApi<MicroMarketVersion>(`/v1/ops/micro-markets/${id}/versions`, {
    method: 'POST',
    body: { config: parseConfig(form), effectiveFrom: fromLocalInput(String(form.get('effectiveFrom') ?? '')), note: String(form.get('note') ?? '').trim() || undefined },
  });
  if (!r.ok) return { ok: false, code: r.code, message: r.message };
  revalidatePath(`/admin/micro-markets/${id}`);
  revalidatePath('/admin/micro-markets');
  return { ok: true, version: r.data.version };
}

export async function createMarket(_prev: EditorState, form: FormData): Promise<EditorState> {
  const r = await opsApi<MicroMarketDetail>('/v1/ops/micro-markets', {
    method: 'POST',
    body: {
      citySlug: String(form.get('citySlug') ?? 'nellore'),
      slug: String(form.get('slug') ?? '').trim(),
      name: String(form.get('name') ?? '').trim(),
      nameTe: String(form.get('nameTe') ?? '').trim(),
      config: parseConfig(form),
      effectiveFrom: fromLocalInput(String(form.get('effectiveFrom') ?? '')),
      note: String(form.get('note') ?? '').trim() || undefined,
    },
  });
  if (!r.ok) return { ok: false, code: r.code, message: r.message };
  revalidatePath('/admin/micro-markets');
  redirect(`/admin/micro-markets/${r.data.id}`);
}
