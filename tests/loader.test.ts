/**
 * Tests for loadExtensions
 * Covers: HP-7, HP-8, EC-5, EC-6, EC-7, EC-10, EC-11, BC-1
 * (AC-7, AC-8, AC-13, AC-14, AC-16, AC-20, AC-21, AC-23)
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { resolve } from 'node:path';
import {
  loadExtensions,
  loadProject,
  ExtensionLoadError,
  ExtensionVersionError,
  NamespaceCollisionError,
  ConfigValidationError,
} from '@rcrsr/rill-config';
import type { ResolvedMount } from '@rcrsr/rill-config';

// ============================================================
// HOISTED CAPTURES (referenced by top-level vi.mock factories)
// ============================================================

const ctxCaptured = vi.hoisted(() => ({
  ctx: undefined as { signal: AbortSignal } | undefined,
}));

const cascadeCaptured = vi.hoisted(() => ({
  ctx: undefined as { signal: AbortSignal } | undefined,
}));

const preabortCaptured = vi.hoisted(() => ({
  ctx: undefined as { signal: AbortSignal } | undefined,
}));

const partialCaptured = vi.hoisted(() => ({
  ctx: undefined as { signal: AbortSignal } | undefined,
  disposeCalls: 0,
}));

// ============================================================
// TOP-LEVEL VIRTUAL MODULE MOCKS
// Each path is unique to a single test; lifting here avoids
// vitest's "not at top level of module" deprecation warning.
// ============================================================

// EC-7: no extensionManifest export
vi.mock('/fake/ext/no-manifest', () => ({ someOtherExport: 42 }), {
  virtual: true,
});
vi.mock('/fake/ext/no-manifest-msg', () => ({ irrelevant: true }), {
  virtual: true,
});

// EC-7: factory throws
vi.mock(
  '/fake/ext/factory-throws',
  () => ({
    extensionManifest: {
      factory: () => {
        throw new Error('api_key is required');
      },
    },
  }),
  { virtual: true }
);
vi.mock(
  '/fake/ext/factory-throws-msg',
  () => ({
    extensionManifest: {
      factory: () => {
        throw new Error('connection refused');
      },
    },
  }),
  { virtual: true }
);

// EC-9: cross-package collision
vi.mock(
  '/fake/ext/coll-pkg-a',
  () => ({
    extensionManifest: {
      factory: () => ({}),
    },
  }),
  { virtual: true }
);
vi.mock(
  '/fake/ext/coll-pkg-b',
  () => ({
    extensionManifest: {
      factory: () => ({}),
    },
  }),
  { virtual: true }
);

// EC-10: version
vi.mock(
  '/fake/ext/version-mismatch',
  () => ({
    extensionManifest: {
      version: '1.0.0',
      factory: () => ({}),
    },
  }),
  { virtual: true }
);
vi.mock(
  '/fake/ext/version-ok',
  () => ({
    extensionManifest: {
      version: '1.5.0',
      factory: () => ({ value: 'ok' }),
    },
  }),
  { virtual: true }
);

// EC-11: orphaned config keys
vi.mock(
  '/fake/ext/orphan-base',
  () => ({
    extensionManifest: {
      factory: () => ({}),
    },
  }),
  { virtual: true }
);
vi.mock(
  '/fake/ext/orphan-msg',
  () => ({
    extensionManifest: {
      factory: () => ({}),
    },
  }),
  { virtual: true }
);

// EC-5: factory result missing value property
vi.mock(
  '/fake/ext/no-value-prop',
  () => ({
    extensionManifest: {
      factory: () => ({}),
    },
  }),
  { virtual: true }
);

// EC-6: factory result with undefined value
vi.mock(
  '/fake/ext/undef-value',
  () => ({
    extensionManifest: {
      factory: () => ({ value: undefined }),
    },
  }),
  { virtual: true }
);

// HP-8: validates manifest and invokes factory
vi.mock(
  '/fake/ext/valid-factory',
  () => ({
    extensionManifest: {
      factory: (_cfg: Record<string, unknown>) => ({
        value: { run: { fn: async () => 'ok', params: [] } },
      }),
    },
  }),
  { virtual: true }
);
vi.mock(
  '/fake/ext/with-dispose',
  () => ({
    extensionManifest: {
      factory: () => ({
        value: 'placeholder',
        dispose: () => undefined,
      }),
    },
  }),
  { virtual: true }
);
vi.mock(
  '/fake/ext/ctx-capture',
  () => ({
    extensionManifest: {
      factory: (
        _cfg: Record<string, unknown>,
        ctx: {
          signal: AbortSignal;
          registerErrorCode: (n: string, k: string) => void;
        }
      ) => {
        ctxCaptured.ctx = ctx;
        ctx.registerErrorCode('MY_CODE', 'http');
        return { value: 'ok' };
      },
    },
  }),
  { virtual: true }
);
vi.mock(
  '/fake/ext/codes-single',
  () => ({
    extensionManifest: {
      factory: (
        _cfg: Record<string, unknown>,
        ctx: { registerErrorCode: (n: string, k: string) => void }
      ) => {
        ctx.registerErrorCode('FOO', 'http');
        ctx.registerErrorCode('BAR', 'protocol');
        return { value: 'ok' };
      },
    },
  }),
  { virtual: true }
);
vi.mock(
  '/fake/ext/codes-conflict-a',
  () => ({
    extensionManifest: {
      factory: (
        _cfg: Record<string, unknown>,
        ctx: { registerErrorCode: (n: string, k: string) => void }
      ) => {
        ctx.registerErrorCode('SHARED', 'http');
        return { value: 'a' };
      },
    },
  }),
  { virtual: true }
);
vi.mock(
  '/fake/ext/codes-conflict-b',
  () => ({
    extensionManifest: {
      factory: (
        _cfg: Record<string, unknown>,
        ctx: { registerErrorCode: (n: string, k: string) => void }
      ) => {
        ctx.registerErrorCode('SHARED', 'protocol');
        return { value: 'b' };
      },
    },
  }),
  { virtual: true }
);
vi.mock(
  '/fake/ext/parent-signal',
  () => ({
    extensionManifest: {
      factory: (
        _cfg: Record<string, unknown>,
        ctx: { signal: AbortSignal }
      ) => {
        cascadeCaptured.ctx = ctx;
        return { value: 'ok' };
      },
    },
  }),
  { virtual: true }
);
vi.mock(
  '/fake/ext/preaborted',
  () => ({
    extensionManifest: {
      factory: (
        _cfg: Record<string, unknown>,
        ctx: { signal: AbortSignal }
      ) => {
        preabortCaptured.ctx = ctx;
        return { value: 'ok' };
      },
    },
  }),
  { virtual: true }
);
vi.mock(
  '/fake/ext/partial-good',
  () => ({
    extensionManifest: {
      factory: (
        _cfg: Record<string, unknown>,
        ctx: { signal: AbortSignal }
      ) => {
        partialCaptured.ctx = ctx;
        return {
          value: 'good',
          dispose: () => {
            partialCaptured.disposeCalls++;
          },
        };
      },
    },
  }),
  { virtual: true }
);
vi.mock(
  '/fake/ext/partial-bad',
  () => ({
    extensionManifest: {
      factory: () => {
        throw new Error('boom');
      },
    },
  }),
  { virtual: true }
);

// HP-7: same package at two mount paths
vi.mock(
  '/fake/ext/dual-mount',
  () => ({
    extensionManifest: {
      factory: (_cfg: Record<string, unknown>) => ({
        value: { fn1: { fn: async () => 'v', params: [] } },
      }),
    },
  }),
  { virtual: true }
);

// ============================================================
// TEST HELPERS
// ============================================================

function makeMount(
  mountPath: string,
  packageSpecifier: string,
  versionConstraint?: string
): ResolvedMount {
  return versionConstraint !== undefined
    ? { mountPath, packageSpecifier, versionConstraint }
    : { mountPath, packageSpecifier };
}

// ============================================================
// BC-1: Empty extensions
// ============================================================

describe('loadExtensions', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  describe('BC-1: empty mounts', () => {
    it('returns empty extTree when no mounts are provided', async () => {
      // AC-23: empty mounts succeeds and returns empty extTree
      const result = await loadExtensions([], {});
      expect(result.extTree).toEqual({});
      expect(result.disposes).toHaveLength(0);
      expect(result.manifests.size).toBe(0);
    });
  });

  // ============================================================
  // EC-7: Package not found / no manifest / factory failure
  // ============================================================

  describe('EC-7: missing package throws ExtensionLoadError', () => {
    it('throws ExtensionLoadError for a non-existent package specifier', async () => {
      // AC-21: import() of unknown package triggers ExtensionLoadError
      const mounts = [
        makeMount('pkg', '@nonexistent/rill-ext-loader-test-99999'),
      ];
      await expect(loadExtensions(mounts, {})).rejects.toThrow(
        ExtensionLoadError
      );
    });

    it('collects all missing packages before throwing', async () => {
      // AC-21: errors are collected into a single throw
      const mounts = [
        makeMount('a', '@nonexistent/rill-ext-aaa-loader-99999'),
        makeMount('b', '@nonexistent/rill-ext-bbb-loader-99999'),
      ];
      await expect(loadExtensions(mounts, {})).rejects.toThrow(
        ExtensionLoadError
      );
    });

    it('includes the missing package name in the error message', async () => {
      const mounts = [
        makeMount('pkg', '@nonexistent/rill-ext-named-loader-99999'),
      ];
      await expect(loadExtensions(mounts, {})).rejects.toThrow(
        '@nonexistent/rill-ext-named-loader-99999'
      );
    });

    it('EC-8: error message uses "Cannot find packages: {list}" format', async () => {
      const mounts = [makeMount('a', '@nonexistent/rill-ext-ec8-format-99999')];
      await expect(loadExtensions(mounts, {})).rejects.toThrow(
        'Cannot find packages: @nonexistent/rill-ext-ec8-format-99999'
      );
    });

    it('EC-8: lists all missing packages in a single message', async () => {
      const mounts = [
        makeMount('a', '@nonexistent/rill-ext-ec8-a-99999'),
        makeMount('b', '@nonexistent/rill-ext-ec8-b-99999'),
      ];
      await expect(loadExtensions(mounts, {})).rejects.toThrow(
        'Cannot find packages: @nonexistent/rill-ext-ec8-a-99999, @nonexistent/rill-ext-ec8-b-99999'
      );
    });
  });

  describe('EC-7: no extensionManifest export throws ExtensionLoadError', () => {
    it('throws ExtensionLoadError when module exports no extensionManifest', async () => {
      // AC-21: package found but no manifest export
      const mounts = [makeMount('pkg', '/fake/ext/no-manifest')];
      await expect(loadExtensions(mounts, {})).rejects.toThrow(
        ExtensionLoadError
      );
    });

    it('includes the package name in the "no manifest" error message', async () => {
      const mounts = [makeMount('pkg', '/fake/ext/no-manifest-msg')];
      await expect(loadExtensions(mounts, {})).rejects.toThrow(
        '/fake/ext/no-manifest-msg'
      );
    });
  });

  describe('EC-7: factory throws ExtensionLoadError', () => {
    it('throws ExtensionLoadError when factory function throws', async () => {
      // AC-21: factory invocation failure
      const mounts = [makeMount('pkg', '/fake/ext/factory-throws')];
      await expect(loadExtensions(mounts, {})).rejects.toThrow(
        ExtensionLoadError
      );
    });

    it('EC-7: error message uses "Factory for {pkg} threw: {reason}" format', async () => {
      const mounts = [makeMount('pkg', '/fake/ext/factory-throws-msg')];
      await expect(loadExtensions(mounts, {})).rejects.toThrow(
        'Factory for /fake/ext/factory-throws-msg threw: connection refused'
      );
    });
  });

  // ============================================================
  // EC-9: Cross-package collision
  // ============================================================

  describe('EC-9: cross-package mount collision throws NamespaceCollisionError', () => {
    it('throws NamespaceCollisionError when mount paths from different packages overlap', async () => {
      const mounts = [
        makeMount('shared', '/fake/ext/coll-pkg-a'),
        makeMount('shared.sub', '/fake/ext/coll-pkg-b'),
      ];
      await expect(loadExtensions(mounts, {})).rejects.toThrow(
        NamespaceCollisionError
      );
    });
  });

  // ============================================================
  // EC-10: Version mismatch
  // ============================================================

  describe('EC-10: version mismatch throws ExtensionVersionError', () => {
    it('throws ExtensionVersionError when installed version does not satisfy constraint', async () => {
      // AC-16: package is v1.0.0 but constraint is ^2.0.0
      const mounts = [
        makeMount('vext', '/fake/ext/version-mismatch', '^2.0.0'),
      ];
      await expect(loadExtensions(mounts, {})).rejects.toThrow(
        ExtensionVersionError
      );
    });

    it('does not throw when installed version satisfies constraint', async () => {
      const mounts = [makeMount('vok', '/fake/ext/version-ok', '^1.0.0')];
      await expect(loadExtensions(mounts, {})).resolves.toBeDefined();
    });
  });

  // ============================================================
  // EC-11: Orphaned config key
  // ============================================================

  describe('EC-11: orphaned config key throws ConfigValidationError', () => {
    it('throws ConfigValidationError for a config key that has no matching mount', async () => {
      // AC-20: 'orphan' key in config has no corresponding mount path
      const mounts = [makeMount('real', '/fake/ext/orphan-base')];
      const config = { orphan: { setting: 'value' } };
      await expect(loadExtensions(mounts, config)).rejects.toThrow(
        ConfigValidationError
      );
    });

    it('includes the orphaned key in the error message', async () => {
      const mounts = [makeMount('base', '/fake/ext/orphan-msg')];
      await expect(
        loadExtensions(mounts, { staleKey: { x: 1 } })
      ).rejects.toThrow('staleKey');
    });
  });

  // ============================================================
  // EC-5: Factory returns result without value property
  // ============================================================

  describe('EC-5: factory result missing value property throws ExtensionLoadError', () => {
    it('throws ExtensionLoadError when factory returns object without value property', async () => {
      // AC-13: factory returns {} (no value property)
      const mounts = [makeMount('nv', '/fake/ext/no-value-prop')];
      await expect(loadExtensions(mounts, {})).rejects.toThrow(
        ExtensionLoadError
      );
      await expect(loadExtensions(mounts, {})).rejects.toThrow(
        'Factory for /fake/ext/no-value-prop returned result without value property'
      );
    });
  });

  // ============================================================
  // EC-6: Factory returns undefined value
  // ============================================================

  describe('EC-6: factory result with undefined value throws ExtensionLoadError', () => {
    it('throws ExtensionLoadError when factory returns { value: undefined }', async () => {
      // AC-14: factory returns { value: undefined }
      const mounts = [makeMount('uv', '/fake/ext/undef-value')];
      await expect(loadExtensions(mounts, {})).rejects.toThrow(
        ExtensionLoadError
      );
      await expect(loadExtensions(mounts, {})).rejects.toThrow(
        'Factory for /fake/ext/undef-value returned undefined value'
      );
    });
  });

  // ============================================================
  // HP-8: Manifest validation and factory invocation
  // ============================================================

  describe('HP-8: validates manifest and invokes factory', () => {
    it('calls factory with the matching config block and populates extTree', async () => {
      const mounts = [makeMount('tools', '/fake/ext/valid-factory')];
      const result = await loadExtensions(mounts, {});
      expect(result.extTree).toBeDefined();
      expect(result.manifests.size).toBe(1);
      expect(result.manifests.has('tools')).toBe(true);
    });

    it('collects dispose function from factory result', async () => {
      const mounts = [makeMount('disp', '/fake/ext/with-dispose')];
      const result = await loadExtensions(mounts, {});
      // One dispose for the AbortController, one returned by the factory
      expect(result.disposes).toHaveLength(2);
      expect(typeof result.disposes[0]).toBe('function');
      expect(typeof result.disposes[1]).toBe('function');
    });

    it('forwards ExtensionFactoryCtx and aborts signal on dispose', async () => {
      const mounts = [makeMount('cap', '/fake/ext/ctx-capture')];
      const result = await loadExtensions(mounts, {});
      expect(ctxCaptured.ctx).toBeDefined();
      expect(ctxCaptured.ctx!.signal).toBeInstanceOf(AbortSignal);
      expect(ctxCaptured.ctx!.signal.aborted).toBe(false);
      for (const dispose of result.disposes) {
        await dispose();
      }
      expect(ctxCaptured.ctx!.signal.aborted).toBe(true);
    });

    it('surfaces registered error codes on LoadedProject.errorCodes', async () => {
      const mounts = [makeMount('codes', '/fake/ext/codes-single')];
      const result = await loadExtensions(mounts, {});
      expect(result.errorCodes.get('FOO')).toBe('http');
      expect(result.errorCodes.get('BAR')).toBe('protocol');
    });

    it('throws when two extensions register the same atom with different kinds', async () => {
      const mounts = [
        makeMount('a', '/fake/ext/codes-conflict-a'),
        makeMount('b', '/fake/ext/codes-conflict-b'),
      ];
      await expect(loadExtensions(mounts, {})).rejects.toThrow(
        ExtensionLoadError
      );
      await expect(loadExtensions(mounts, {})).rejects.toThrow(
        'Error code SHARED already registered with kind http'
      );
    });

    it('cascades parent signal abort into per-extension ctx.signal', async () => {
      const parent = new AbortController();
      const mounts = [makeMount('ps', '/fake/ext/parent-signal')];
      await loadExtensions(mounts, {}, { signal: parent.signal });
      expect(cascadeCaptured.ctx!.signal.aborted).toBe(false);
      parent.abort();
      expect(cascadeCaptured.ctx!.signal.aborted).toBe(true);
    });

    it('aborts ctx.signal immediately when parent signal is already aborted', async () => {
      const parent = new AbortController();
      parent.abort();
      const mounts = [makeMount('pa', '/fake/ext/preaborted')];
      await loadExtensions(mounts, {}, { signal: parent.signal });
      expect(preabortCaptured.ctx!.signal.aborted).toBe(true);
    });

    it('disposes already-built extensions when a later factory throws', async () => {
      const mounts = [
        makeMount('good', '/fake/ext/partial-good'),
        makeMount('bad', '/fake/ext/partial-bad'),
      ];
      await expect(loadExtensions(mounts, {})).rejects.toThrow(
        ExtensionLoadError
      );
      expect(partialCaptured.disposeCalls).toBe(1);
      expect(partialCaptured.ctx!.signal.aborted).toBe(true);
    });
  });

  // ============================================================
  // HP-7: Same package at two mount paths
  // ============================================================

  describe('HP-7: same package at two mount paths', () => {
    it('creates independent entries in extTree for each mount', async () => {
      const mounts = [
        makeMount('dual.a', '/fake/ext/dual-mount'),
        makeMount('dual.b', '/fake/ext/dual-mount'),
      ];
      const result = await loadExtensions(mounts, {});
      expect(result.manifests.has('dual.a')).toBe(true);
      expect(result.manifests.has('dual.b')).toBe(true);
    });
  });

  // ============================================================
  // prefix option: real bare-specifier resolution
  // ============================================================

  describe('prefix option', () => {
    const prefix = resolve(process.cwd(), 'tests/fixtures/prefix-resolution');

    it('resolves bare specifier when prefix points to fixture node_modules', async () => {
      // NOTES case #3: loadExtensions with prefix succeeds
      const mounts = [makeMount('test-ext', '@rcrsr/test-ext')];
      const result = await loadExtensions(mounts, {}, { prefix });
      expect(result.manifests.has('test-ext')).toBe(true);
    });

    it('throws ExtensionLoadError for bare specifier without prefix', async () => {
      // NOTES case #4: @rcrsr/test-ext is not in project root node_modules
      const mounts = [makeMount('test-ext', '@rcrsr/test-ext')];
      await expect(loadExtensions(mounts, {})).rejects.toThrow(
        ExtensionLoadError
      );
    });

    it('loadProject end-to-end resolves extension via prefix', async () => {
      // NOTES case #5: full project load with prefix option
      const configPath = resolve(
        process.cwd(),
        'tests/fixtures/prefix-resolution/rill-config.json'
      );
      const result = await loadProject({
        configPath,
        rillVersion: '999.0.0',
        prefix,
      });
      expect(result.extTree).toHaveProperty('test-ext');
    });
  });
});
