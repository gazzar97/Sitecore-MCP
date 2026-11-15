/** Caps the number of concurrent async operations (e.g. HTTP requests to one Sitecore instance). */
export class Semaphore {
  private active = 0;
  private readonly waiters: (() => void)[] = [];

  constructor(private readonly max: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) await new Promise<void>((resolve) => this.waiters.push(resolve));
    else this.active++;
    try {
      return await fn();
    } finally {
      const next = this.waiters.shift();
      if (next) next(); // hand the slot over directly
      else this.active--;
    }
  }
}

/** Like Promise.all(items.map(fn)) but with at most `limit` in flight; preserves order. */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!, i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
