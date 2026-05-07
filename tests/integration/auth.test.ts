/**
 * Integration tests for auth endpoints.
 * These use supertest to fire real HTTP requests against the Express app.
 * Requires a test database (DATABASE_URL pointing to test DB).
 *
 * Run with: jest tests/integration
 *
 * NOTE: In CI these tests run against a real PostgreSQL container.
 * For local development set TEST_DATABASE_URL in your .env.test file.
 */

import request from 'supertest';
import app from '../../src/app';
import { prisma } from '../../src/config/database';

// Clean up test users before/after each test
const TEST_EMAIL = `test-${Date.now()}@example.kz`;
const TEST_PASSWORD = 'SecurePass123!';

afterAll(async () => {
  await prisma.refreshToken.deleteMany({ where: { user: { email: TEST_EMAIL } } });
  await prisma.user.deleteMany({ where: { email: TEST_EMAIL } });
  await prisma.$disconnect();
});

describe('POST /v1/auth/register', () => {
  it('registers a new user and returns tokens', async () => {
    const res = await request(app)
      .post('/v1/auth/register')
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD, role: 'GUEST' });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('accessToken');
    expect(res.body).toHaveProperty('refreshToken');
    expect(res.body.user.email).toBe(TEST_EMAIL);
    expect(res.body.user).not.toHaveProperty('passwordHash');
  });

  it('rejects duplicate email with 409', async () => {
    const res = await request(app)
      .post('/v1/auth/register')
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('rejects weak password with 422', async () => {
    const res = await request(app)
      .post('/v1/auth/register')
      .send({ email: `other-${Date.now()}@example.kz`, password: 'weak' });

    expect(res.status).toBe(422);
  });

  it('rejects request with neither email nor phone with 422', async () => {
    const res = await request(app)
      .post('/v1/auth/register')
      .send({ password: TEST_PASSWORD });

    expect(res.status).toBe(422);
  });
});

describe('POST /v1/auth/login', () => {
  it('logs in with correct credentials', async () => {
    const res = await request(app)
      .post('/v1/auth/login')
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('accessToken');
    expect(res.body).toHaveProperty('refreshToken');
  });

  it('rejects wrong password with 401', async () => {
    const res = await request(app)
      .post('/v1/auth/login')
      .send({ email: TEST_EMAIL, password: 'WrongPass999!' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects unknown email with 401 (no user enumeration)', async () => {
    const res = await request(app)
      .post('/v1/auth/login')
      .send({ email: 'nobody@example.kz', password: TEST_PASSWORD });

    expect(res.status).toBe(401);
  });
});

describe('Token refresh and logout flow', () => {
  let accessToken: string;
  let refreshToken: string;

  beforeAll(async () => {
    const res = await request(app)
      .post('/v1/auth/login')
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD });
    accessToken = res.body.accessToken as string;
    refreshToken = res.body.refreshToken as string;
  });

  it('refreshes access token with valid refresh token', async () => {
    const res = await request(app)
      .post('/v1/auth/refresh')
      .send({ refreshToken });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('accessToken');
    // Old refresh token is rotated — save the new one
    refreshToken = res.body.refreshToken as string;
  });

  it('GET /auth/me returns user profile with valid token', async () => {
    const loginRes = await request(app)
      .post('/v1/auth/login')
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD });
    const token = loginRes.body.accessToken as string;

    const res = await request(app)
      .get('/v1/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(TEST_EMAIL);
  });

  it('GET /auth/me returns 401 without token', async () => {
    const res = await request(app).get('/v1/auth/me');
    expect(res.status).toBe(401);
  });

  it('logs out and invalidates refresh token', async () => {
    const loginRes = await request(app)
      .post('/v1/auth/login')
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD });
    const at = loginRes.body.accessToken as string;
    const rt = loginRes.body.refreshToken as string;

    const logoutRes = await request(app)
      .post('/v1/auth/logout')
      .set('Authorization', `Bearer ${at}`)
      .send({ refreshToken: rt });

    expect(logoutRes.status).toBe(200);

    // Revoked refresh token should now fail
    const refreshRes = await request(app)
      .post('/v1/auth/refresh')
      .send({ refreshToken: rt });

    expect(refreshRes.status).toBe(401);
  });
});

describe('RBAC enforcement', () => {
  it('returns 403 (not 401) when authenticated user lacks required role', async () => {
    // Register as GUEST, try to access COUPLE-only endpoint
    const email = `guest-${Date.now()}@example.kz`;
    const reg = await request(app)
      .post('/v1/auth/register')
      .send({ email, password: TEST_PASSWORD, role: 'GUEST' });

    const token = reg.body.accessToken as string;

    // Attempt to create a registry (requires COUPLE role)
    const res = await request(app)
      .post('/v1/registries')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Test Wedding', weddingDate: '2027-06-15' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });
});
