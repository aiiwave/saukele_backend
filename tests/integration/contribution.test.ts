/**
 * Integration test: Pool contribution atomicity.
 * Proves that overselling is impossible even under concurrent requests.
 */

import request from 'supertest';
import app from '../../src/app';
import { prisma } from '../../src/config/database';

const PASSWORD = 'SecurePass123!';

async function createUser(email: string, role: 'GUEST' | 'COUPLE' = 'GUEST') {
  const res = await request(app)
    .post('/v1/auth/register')
    .send({ email, password: PASSWORD, role });
  return res.body as { accessToken: string; user: { id: string } };
}

describe('Pool contribution atomicity', () => {
  let coupleToken: string;
  let registryId: string;
  let poolGiftId: string;
  const ts = Date.now();

  beforeAll(async () => {
    // Create couple
    const couple = await createUser(`couple-pool-${ts}@example.kz`, 'COUPLE');
    coupleToken = couple.accessToken;

    // Create registry
    const regRes = await request(app)
      .post('/v1/registries')
      .set('Authorization', `Bearer ${coupleToken}`)
      .send({ title: 'Pool Test Wedding', weddingDate: '2027-08-01' });
    registryId = regRes.body.registry.id as string;

    // Add pool gift with target of 100,000 tiyn (1,000 KZT)
    const giftRes = await request(app)
      .post(`/v1/registries/${registryId}/gifts`)
      .set('Authorization', `Bearer ${coupleToken}`)
      .send({
        title: 'Pool Gift',
        priceKzt: 100000,
        isPool: true,
        poolTargetKzt: 100000,
      });
    poolGiftId = giftRes.body.gift.id as string;
  });

  afterAll(async () => {
    await prisma.contribution.deleteMany({ where: { giftItemId: poolGiftId } });
    await prisma.giftItem.deleteMany({ where: { registryId } });
    await prisma.registry.deleteMany({ where: { id: registryId } });
    await prisma.user.deleteMany({ where: { email: { contains: `pool-${ts}` } } });
    await prisma.$disconnect();
  });

  it('prevents overselling: concurrent contributions cannot exceed pool target', async () => {
    // Create 3 guests
    const guest1 = await createUser(`guest1-pool-${ts}@example.kz`);
    const guest2 = await createUser(`guest2-pool-${ts}@example.kz`);
    const guest3 = await createUser(`guest3-pool-${ts}@example.kz`);

    // Pool target = 100,000 tiyn
    // Each contributes 60,000 tiyn — only 2 of 3 should succeed (total would be 180k > 100k)
    const contributions = await Promise.allSettled([
      request(app)
        .post('/v1/contributions/pool')
        .set('Authorization', `Bearer ${guest1.accessToken}`)
        .send({ giftItemId: poolGiftId, amountKzt: 60000 }),
      request(app)
        .post('/v1/contributions/pool')
        .set('Authorization', `Bearer ${guest2.accessToken}`)
        .send({ giftItemId: poolGiftId, amountKzt: 60000 }),
      request(app)
        .post('/v1/contributions/pool')
        .set('Authorization', `Bearer ${guest3.accessToken}`)
        .send({ giftItemId: poolGiftId, amountKzt: 60000 }),
    ]);

    // Exactly one should fail (over the limit)
    const results = contributions.filter((c) => c.status === 'fulfilled') as Array<
      PromiseFulfilledResult<{ status: number }>
    >;

    const successes = results.filter((r) => r.value.status === 201).length;
    const failures = results.filter((r) => r.value.status === 422 || r.value.status === 409).length;

    // At most 1 contribution of 60k can succeed after the first fills up to 60k remaining
    // (60k + 60k = 120k > 100k, so 3rd must fail)
    expect(successes).toBeLessThanOrEqual(2);
    expect(failures).toBeGreaterThanOrEqual(1);

    // Verify DB: poolCollectedKzt never exceeds target
    const gift = await prisma.giftItem.findUnique({ where: { id: poolGiftId } });
    expect(gift!.poolCollectedKzt!).toBeLessThanOrEqual(100000);
  });
});
