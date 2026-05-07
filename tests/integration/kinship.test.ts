/**
 * Integration tests for kinship (family tree) endpoints.
 */

import request from 'supertest';
import app from '../../src/app';
import { prisma } from '../../src/config/database';

const PASSWORD = 'SecurePass123!';
const ts = Date.now();

async function registerUser(email: string, role: 'GUEST' | 'COUPLE' = 'GUEST') {
  const res = await request(app)
    .post('/v1/auth/register')
    .send({ email, password: PASSWORD, role });
  return res.body as { accessToken: string; user: { id: string } };
}

describe('Kinship (family tree) endpoints', () => {
  let coupleToken: string;
  let coupleId: string;
  let guestToken: string;
  let guestId: string;
  let registryId: string;

  beforeAll(async () => {
    const couple = await registerUser(`couple-kin-${ts}@example.kz`, 'COUPLE');
    coupleToken = couple.accessToken;
    coupleId = couple.user.id;

    const guest = await registerUser(`guest-kin-${ts}@example.kz`);
    guestToken = guest.accessToken;
    guestId = guest.user.id;

    const regRes = await request(app)
      .post('/v1/registries')
      .set('Authorization', `Bearer ${coupleToken}`)
      .send({ title: 'Kinship Test', weddingDate: '2027-09-01' });
    registryId = regRes.body.registry.id as string;
  });

  afterAll(async () => {
    await prisma.familyMember.deleteMany({ where: { registryId } });
    await prisma.registry.deleteMany({ where: { id: registryId } });
    await prisma.user.deleteMany({
      where: { email: { contains: `-kin-${ts}@` } },
    });
    await prisma.$disconnect();
  });

  it('adds a family member (COUPLE only)', async () => {
    const res = await request(app)
      .post(`/v1/registries/${registryId}/kinship`)
      .set('Authorization', `Bearer ${coupleToken}`)
      .send({
        userId: guestId,
        kinshipTier: 'DOS',
        kinshipLabel: 'дос',
      });

    expect(res.status).toBe(201);
    expect(res.body.member.kinshipTier).toBe('DOS');
    expect(res.body.member.userId).toBe(guestId);
  });

  it('rejects duplicate member for same registry', async () => {
    const res = await request(app)
      .post(`/v1/registries/${registryId}/kinship`)
      .set('Authorization', `Bearer ${coupleToken}`)
      .send({ userId: guestId, kinshipTier: 'DOS' });

    expect(res.status).toBe(409); // unique constraint on (registryId, userId)
  });

  it('gets the kinship tree', async () => {
    const res = await request(app)
      .get(`/v1/registries/${registryId}/kinship`)
      .set('Authorization', `Bearer ${coupleToken}`);

    expect(res.status).toBe(200);
    expect(res.body.tree).toBeInstanceOf(Array);
    expect(res.body.tree.length).toBeGreaterThanOrEqual(1);
    expect(res.body.tree[0]).toHaveProperty('kinshipTier');
    expect(res.body.tree[0]).toHaveProperty('depth');
  });

  it('guest can query their own tier', async () => {
    const res = await request(app)
      .get(`/v1/registries/${registryId}/kinship/my-tier`)
      .set('Authorization', `Bearer ${guestToken}`);

    expect(res.status).toBe(200);
    expect(res.body.tier.kinshipTier).toBe('DOS');
  });

  it('returns 403 when GUEST tries to add a family member', async () => {
    const anotherGuest = await registerUser(`other-kin-${ts}@example.kz`);

    const res = await request(app)
      .post(`/v1/registries/${registryId}/kinship`)
      .set('Authorization', `Bearer ${anotherGuest.accessToken}`)
      .send({ userId: coupleId, kinshipTier: 'ATA_ANA' });

    expect(res.status).toBe(403);
  });
});
