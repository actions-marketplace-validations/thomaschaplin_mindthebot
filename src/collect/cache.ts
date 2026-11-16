import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * A tiny on-disk JSON cache for API responses. Re-runs are cheap, and cached
 * responses double as test fixtures.
 */
export class Cache {
  // Plain fields (not parameter properties) so the source runs under Node's type stripping.
  private readonly dir: string;
  private readonly enabled: boolean;

  constructor(dir: string, enabled: boolean) {
    this.dir = dir;
    this.enabled = enabled;
  }

  private pathFor(key: unknown): string {
    const hash = createHash("sha256").update(JSON.stringify(key)).digest("hex").slice(0, 24);
    return join(this.dir, `${hash}.json`);
  }

  async wrap<T>(key: unknown, fetcher: () => Promise<T>): Promise<T> {
    if (!this.enabled) return fetcher();
    const path = this.pathFor(key);
    try {
      return JSON.parse(await readFile(path, "utf8")) as T;
    } catch {
      const value = await fetcher();
      await mkdir(this.dir, { recursive: true });
      await writeFile(path, JSON.stringify(value));
      return value;
    }
  }
}
