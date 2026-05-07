import {
  encodeCursor,
  decodeCursor,
  buildPageResult,
  parsePaginationParams,
} from '../../src/utils/pagination';

describe('encodeCursor / decodeCursor', () => {
  it('encodes and decodes a cursor round-trip', () => {
    const payload = { id: 'clabcdef123', createdAt: '2026-04-01T00:00:00.000Z' };
    const encoded = encodeCursor(payload);
    const decoded = decodeCursor(encoded);
    expect(decoded).toEqual(payload);
  });

  it('throws on invalid base64 cursor', () => {
    expect(() => decodeCursor('notvalidbase64!!!')).toThrow();
  });

  it('throws on cursor missing id field', () => {
    const bad = Buffer.from(JSON.stringify({ createdAt: '2026-01-01' })).toString('base64');
    expect(() => decodeCursor(bad)).toThrow('Invalid cursor shape');
  });
});

describe('buildPageResult', () => {
  const makeItems = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `id${i}`,
      createdAt: new Date(2026, 0, i + 1),
    }));

  it('returns hasMore=false when items <= limit', () => {
    const items = makeItems(5);
    const result = buildPageResult(items, 10);
    expect(result.hasMore).toBe(false);
    expect(result.nextCursor).toBeNull();
    expect(result.data).toHaveLength(5);
  });

  it('returns hasMore=true and nextCursor when items > limit', () => {
    // Fetch limit+1 to detect more
    const items = makeItems(11); // 10 limit, 11 fetched
    const result = buildPageResult(items, 10);
    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).not.toBeNull();
    expect(result.data).toHaveLength(10); // only limit items returned
  });
});

describe('parsePaginationParams', () => {
  it('defaults to limit=20, sort=desc', () => {
    const params = parsePaginationParams({});
    expect(params.limit).toBe(20);
    expect(params.sort).toBe('desc');
    expect(params.cursor).toBeUndefined();
  });

  it('clamps limit to 100 max', () => {
    const params = parsePaginationParams({ limit: '999' });
    expect(params.limit).toBe(100);
  });

  it('clamps limit to 1 min', () => {
    const params = parsePaginationParams({ limit: '0' });
    expect(params.limit).toBe(1);
  });
});
