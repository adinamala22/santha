/** AddressRepository contract — in-memory (test:unit) and Prisma + PostGIS (test:int). */
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { AddressRepository } from '../../src/modules/identity-kyc/addresses.repository';

export function addressRepositoryContract(name: string, make: () => Promise<{ repo: AddressRepository; userId: () => Promise<string> }>) {
  describe(`AddressRepository contract · ${name}`, () => {
    const base = (userId: string, extra = {}) => ({
      userId,
      label: 'home' as const,
      name: null,
      line: '4-12, Dargamitta 2nd Lane',
      landmark: null,
      pincode: '524003',
      location: { lat: 14.4535, lng: 79.996 },
      microMarketId: null,
      isDefault: false,
      ...extra,
    });

    it('stores the pin as geography and lists the default first, then newest', async () => {
      const { repo, userId } = await make();
      const u = await userId();
      const a = await repo.transaction((tx) => tx.create(base(u)));
      const b = await repo.transaction((tx) => tx.create(base(u, { label: 'work', line: 'Magunta Towers, 2nd floor' })));
      expect(a.location.lat).toBeCloseTo(14.4535, 6);
      expect(a.location.lng).toBeCloseTo(79.996, 6);
      expect((await repo.list(u)).map((x) => x.id)).toEqual([b.id, a.id]); // newest first when none is default
      await repo.transaction((tx) => tx.setDefault(u, a.id));
      expect((await repo.list(u)).map((x) => [x.id, x.isDefault])).toEqual([
        [a.id, true],
        [b.id, false],
      ]);
    });

    it('updates fields and the pin; removes; other users never see them', async () => {
      const { repo, userId } = await make();
      const [u, other] = [await userId(), await userId()];
      const a = await repo.transaction((tx) => tx.create(base(u)));
      const mm = randomUUID();
      const moved = await repo.transaction((tx) => tx.update(a.id, { location: { lat: 14.4351, lng: 79.9952 }, microMarketId: mm, landmark: 'Water tank' }));
      expect(moved).toMatchObject({ microMarketId: mm, landmark: 'Water tank' });
      expect(moved.location.lat).toBeCloseTo(14.4351, 6);
      expect(await repo.list(other)).toEqual([]);
      await repo.transaction((tx) => tx.remove(a.id));
      expect(await repo.get(a.id)).toBeNull();
    });
  });
}
