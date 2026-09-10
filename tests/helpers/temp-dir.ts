/**
 * Shared test helper for temp-directory lifecycle.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export async function withTempDir(
  fn: (dir: string) => Promise<void> | void
): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'rill-config-test-'));
  try {
    await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
