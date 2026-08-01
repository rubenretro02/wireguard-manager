// Stale-while-revalidate cache for read-only router queries (peer/interface
// dumps). The dashboard and the /tg Mini App poll every ~3s, possibly from
// many clients at once: within the TTL window all of them share ONE live
// router query (concurrent callers also share the in-flight promise), and the
// last good result is kept indefinitely so an unreachable router degrades to
// stale data instead of an error. Module-level state, same convention as the
// SSH connection pool in linux-wireguard.ts.

const TTL_MS = 2500;

const cache = new Map<string, { data: unknown; at: number }>();
const inflight = new Map<string, Promise<unknown>>();

export interface CachedRead<T> {
  data: T;
  /** true when the fetch failed and `data` is the last known good result */
  stale: boolean;
  /** epoch ms of when `data` was actually read from the router */
  fetchedAt: number;
}

/**
 * Runs `fn` at most once per TTL window per key. If `fn` throws and a previous
 * result exists, that result is returned flagged `stale` instead of throwing.
 * `bypassTtl` (force refresh) skips the freshness check but keeps the
 * stale-on-error fallback.
 */
export async function cachedRouterRead<T>(
  key: string,
  fn: () => Promise<T>,
  opts?: { bypassTtl?: boolean }
): Promise<CachedRead<T>> {
  const hit = cache.get(key);
  if (hit && !opts?.bypassTtl && Date.now() - hit.at < TTL_MS) {
    return { data: hit.data as T, stale: false, fetchedAt: hit.at };
  }
  let promise = inflight.get(key) as Promise<T> | undefined;
  if (!promise) {
    promise = fn().finally(() => inflight.delete(key));
    inflight.set(key, promise);
  }
  try {
    const data = await promise;
    const at = Date.now();
    cache.set(key, { data, at });
    return { data, stale: false, fetchedAt: at };
  } catch (err) {
    if (hit) return { data: hit.data as T, stale: true, fetchedAt: hit.at };
    throw err;
  }
}

/** Drops every cached read of a router (call before mutating it). */
export function invalidateRouterReadCache(routerId: string) {
  for (const key of cache.keys()) {
    if (key.includes(`:${routerId}`)) cache.delete(key);
  }
}
