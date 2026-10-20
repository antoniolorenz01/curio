import { timingSafeEqual } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { z } from 'zod';

export function bearerAuth(token: string): MiddlewareHandler {
  const expected = Buffer.from(token);
  return async (c, next) => {
    const header = c.req.header('Authorization') ?? '';
    const given = Buffer.from(header.startsWith('Bearer ') ? header.slice(7) : '');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      return c.json({ error: 'unauthorized' }, 401);
    }
    await next();
  };
}

/**
 * Browsers attach Origin to cross-site requests. Only the extension may call the API,
 * so no web page can use a local, token-less API (and its OpenAI credits).
 */
export function extensionOriginOnly(): MiddlewareHandler {
  return async (c, next) => {
    const origin = c.req.header('Origin');
    if (origin && !origin.startsWith('chrome-extension://')) return c.json({ error: 'forbidden_origin' }, 403);
    await next();
  };
}

/** Fixed-window limiter, in memory. Enough for a single user on a single instance. */
export function rateLimit(limit: number, windowMs: number, key = 'global'): MiddlewareHandler {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return async (c, next) => {
    const now = Date.now();
    const entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
    } else if (++entry.count > limit) {
      c.header('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
      return c.json({ error: 'rate_limited' }, 429);
    }
    await next();
  };
}

export async function parseBody<T>(
  schema: z.ZodType<T>,
  req: { json(): Promise<unknown>; header(name: string): string | undefined },
): Promise<T> {
  // JSON-only forces a CORS preflight, which blocks "simple" cross-site form posts.
  if (!req.header('Content-Type')?.includes('application/json')) {
    throw new HTTPException(415, { res: Response.json({ error: 'json_required' }, { status: 415 }) });
  }
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    raw = {};
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new HTTPException(400, {
      res: Response.json({ error: 'invalid_body', details: result.error.issues }, { status: 400 }),
    });
  }
  return result.data;
}
