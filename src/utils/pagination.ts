/**
 * Cursor-based (keyset) pagination utilities.
 * Cursor = base64( JSON.stringify({ id, createdAt }) ) of the last item in the page.
 * This avoids O(n) OFFSET scans and uses indexes for O(log n) performance.
 */

export interface CursorPayload {
  id: string;
  createdAt: string; // ISO string
}

export interface PaginationParams {
  cursor?: string;
  limit: number;
  sort: 'asc' | 'desc';
}

export interface PageResult<T> {
  data: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

/** Encode a cursor payload to base64 */
export function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64');
}

/** Decode a base64 cursor back to its payload */
export function decodeCursor(cursor: string): CursorPayload {
  try {
    const raw = Buffer.from(cursor, 'base64').toString('utf-8');
    const parsed = JSON.parse(raw) as CursorPayload;
    if (!parsed.id || !parsed.createdAt) throw new Error('Invalid cursor shape');
    return parsed;
  } catch {
    throw new Error('Invalid or corrupted pagination cursor');
  }
}

/**
 * Builds a Prisma `where` clause for keyset pagination.
 * Supports forward pagination only (after cursor).
 */
export function buildCursorWhere(cursor?: string, sort: 'asc' | 'desc' = 'desc') {
  if (!cursor) return undefined;

  const { id, createdAt } = decodeCursor(cursor);

  if (sort === 'desc') {
    // Items created BEFORE the cursor item (older)
    return {
      OR: [
        { createdAt: { lt: new Date(createdAt) } },
        { createdAt: new Date(createdAt), id: { lt: id } },
      ],
    };
  } else {
    // Items created AFTER the cursor item (newer)
    return {
      OR: [
        { createdAt: { gt: new Date(createdAt) } },
        { createdAt: new Date(createdAt), id: { gt: id } },
      ],
    };
  }
}

/**
 * Given a list of results (fetched with limit + 1), build the page result.
 * The extra item is used to detect if there is a next page — it is not returned.
 */
export function buildPageResult<T extends { id: string; createdAt: Date }>(
  items: T[],
  limit: number,
): PageResult<T> {
  const hasMore = items.length > limit;
  const data = hasMore ? items.slice(0, limit) : items;

  const lastItem = data[data.length - 1];
  const nextCursor =
    lastItem && hasMore
      ? encodeCursor({ id: lastItem.id, createdAt: lastItem.createdAt.toISOString() })
      : null;

  return { data, nextCursor, hasMore };
}

/** Parse and validate pagination query params */
export function parsePaginationParams(query: {
  cursor?: string;
  limit?: string;
  sort?: string;
}): PaginationParams {
  const limit = Math.min(Math.max(parseInt(query.limit ?? '20', 10) || 20, 1), 100);
  const sort = query.sort === 'asc' ? 'asc' : 'desc';
  return { cursor: query.cursor, limit, sort };
}
