/**
 * Test helper: installs an in-memory localStorage/sessionStorage on a fake
 * `window` so storage-backed utilities can be tested under Node.
 */

class MemoryStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string): string | null {
    return this.values.has(key) ? (this.values.get(key) as string) : null;
  }
  setItem(key: string, value: string): void {
    this.values.set(key, String(value));
  }
  removeItem(key: string): void {
    this.values.delete(key);
  }
}

export function installMemoryStorage(): void {
  (globalThis as unknown as { window: unknown }).window = {
    localStorage: new MemoryStorage(),
    sessionStorage: new MemoryStorage(),
  };
}
