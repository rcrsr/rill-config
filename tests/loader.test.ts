/**
 * Tests for loadExtensions
 * Covers: HP-7, HP-8, HP-9, HP-10, EC-5, EC-6, EC-7, EC-10, EC-11, EC-12,
 *   EC-13, EC-14, EC-15, EC-16, EC-17, EC-18, BC-1
 * (AC-7, AC-8, AC-13, AC-14, AC-16, AC-20, AC-21, AC-23)
 * GH bugs: #30, #31, #35, #36, #37, #39
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { resolve } from 'node:path';
import {
  loadExtensions,
  loadProject,
  runDisposes,
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

// #37: captures the config block a dot-path mount's factory actually
// receives.
const dotpathConfigCaptured = vi.hoisted(() => ({
  cfg: undefined as Record<string, unknown> | undefined,
}));

// ============================================================
// TOP-LEVEL VIRTUAL MODULE MOCKS
// Each path is unique to a single test; lifting here avoids
// vitest's "not at top level of module" deprecation warning.
// ============================================================

// EC-7: no extensionManifest export
vi.mock('/fake/ext/no-manifest', () => ({ someOtherExport: 42 }));
vi.mock('/fake/ext/no-manifest-msg', () => ({ irrelevant: true }));

// EC-7: factory throws
vi.mock('/fake/ext/factory-throws', () => ({
  extensionManifest: {
    factory: () => {
      throw new Error('api_key is required');
    },
  },
}));
vi.mock('/fake/ext/factory-throws-msg', () => ({
  extensionManifest: {
    factory: () => {
      throw new Error('connection refused');
    },
  },
}));

// EC-9: cross-package collision
vi.mock('/fake/ext/coll-pkg-a', () => ({
  extensionManifest: {
    factory: () => ({}),
  },
}));
vi.mock('/fake/ext/coll-pkg-b', () => ({
  extensionManifest: {
    factory: () => ({}),
  },
}));

// EC-10: version
vi.mock('/fake/ext/version-mismatch', () => ({
  extensionManifest: {
    version: '1.0.0',
    factory: () => ({}),
  },
}));
vi.mock('/fake/ext/version-ok', () => ({
  extensionManifest: {
    version: '1.5.0',
    factory: () => ({ value: 'ok' }),
  },
}));

// EC-11: orphaned config keys
vi.mock('/fake/ext/orphan-base', () => ({
  extensionManifest: {
    factory: () => ({}),
  },
}));
vi.mock('/fake/ext/orphan-msg', () => ({
  extensionManifest: {
    factory: () => ({}),
  },
}));

// EC-5: factory result missing value property
vi.mock('/fake/ext/no-value-prop', () => ({
  extensionManifest: {
    factory: () => ({}),
  },
}));

// EC-6: factory result with undefined value
vi.mock('/fake/ext/undef-value', () => ({
  extensionManifest: {
    factory: () => ({ value: undefined }),
  },
}));

// HP-8: validates manifest and invokes factory
vi.mock('/fake/ext/valid-factory', () => ({
  extensionManifest: {
    factory: (_cfg: Record<string, unknown>) => ({
      value: { run: { fn: async () => 'ok', params: [] } },
    }),
  },
}));
vi.mock('/fake/ext/with-dispose', () => ({
  extensionManifest: {
    factory: () => ({
      value: 'placeholder',
      dispose: () => undefined,
    }),
  },
}));
vi.mock('/fake/ext/ctx-capture', () => ({
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
}));
vi.mock('/fake/ext/codes-single', () => ({
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
}));
vi.mock('/fake/ext/codes-conflict-a', () => ({
  extensionManifest: {
    factory: (
      _cfg: Record<string, unknown>,
      ctx: { registerErrorCode: (n: string, k: string) => void }
    ) => {
      ctx.registerErrorCode('SHARED', 'http');
      return { value: 'a' };
    },
  },
}));
vi.mock('/fake/ext/codes-conflict-b', () => ({
  extensionManifest: {
    factory: (
      _cfg: Record<string, unknown>,
      ctx: { registerErrorCode: (n: string, k: string) => void }
    ) => {
      ctx.registerErrorCode('SHARED', 'protocol');
      return { value: 'b' };
    },
  },
}));
vi.mock('/fake/ext/parent-signal', () => ({
  extensionManifest: {
    factory: (_cfg: Record<string, unknown>, ctx: { signal: AbortSignal }) => {
      cascadeCaptured.ctx = ctx;
      return { value: 'ok' };
    },
  },
}));
vi.mock('/fake/ext/preaborted', () => ({
  extensionManifest: {
    factory: (_cfg: Record<string, unknown>, ctx: { signal: AbortSignal }) => {
      preabortCaptured.ctx = ctx;
      return { value: 'ok' };
    },
  },
}));
vi.mock('/fake/ext/partial-good', () => ({
  extensionManifest: {
    factory: (_cfg: Record<string, unknown>, ctx: { signal: AbortSignal }) => {
      partialCaptured.ctx = ctx;
      return {
        value: 'good',
        dispose: () => {
          partialCaptured.disposeCalls++;
        },
      };
    },
  },
}));
vi.mock('/fake/ext/partial-bad', () => ({
  extensionManifest: {
    factory: () => {
      throw new Error('boom');
    },
  },
}));

// #30: mount "a" registers a code synchronously; mount "b" defers a
// conflicting registration into its dispose callback, so the conflict
// surfaces only when a caller invokes that dispose function directly.
vi.mock('/fake/ext/deferred-code-a', () => ({
  extensionManifest: {
    factory: (
      _cfg: Record<string, unknown>,
      ctx: { registerErrorCode: (n: string, k: string) => void }
    ) => {
      ctx.registerErrorCode('DEFERRED', 'http');
      return { value: 'a' };
    },
  },
}));
vi.mock('/fake/ext/deferred-code-b', () => ({
  extensionManifest: {
    factory: (
      _cfg: Record<string, unknown>,
      ctx: { registerErrorCode: (n: string, k: string) => void }
    ) => ({
      value: 'b',
      dispose: () => {
        ctx.registerErrorCode('DEFERRED', 'protocol');
      },
    }),
  },
}));

// #31: factories returning a non-object result.
vi.mock('/fake/ext/factory-returns-null', () => ({
  extensionManifest: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    factory: (): any => null,
  },
}));
vi.mock('/fake/ext/factory-returns-undefined', () => ({
  extensionManifest: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    factory: (): any => undefined,
  },
}));
vi.mock('/fake/ext/factory-returns-number', () => ({
  extensionManifest: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    factory: (): any => 42,
  },
}));
vi.mock('/fake/ext/factory-returns-string', () => ({
  extensionManifest: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    factory: (): any => 'x',
  },
}));

// #36: factory returns a plain object value (not a scalar), so mounting
// a nested path underneath it must be treated as a collision with an
// extension-returned object rather than an intermediate the loader owns.
vi.mock('/fake/ext/mount-obj', () => ({
  extensionManifest: {
    factory: () => ({ value: { k: 'obj' } }),
  },
}));

// #37: captures the config block passed to a dot-path mount's factory.
vi.mock('/fake/ext/dotpath-config-capture', () => ({
  extensionManifest: {
    factory: (cfg: Record<string, unknown>) => {
      dotpathConfigCaptured.cfg = cfg;
      return { value: 'ok' };
    },
  },
}));

// HP-7: same package at two mount paths
vi.mock('/fake/ext/dual-mount', () => ({
  extensionManifest: {
    factory: (_cfg: Record<string, unknown>) => ({
      value: { fn1: { fn: async () => 'v', params: [] } },
    }),
  },
}));

// Ordering provenance: validation must run before any mount module is
// imported. The side effect fires inside the vi.mock factory itself,
// which vitest invokes at dynamic-import time, so it stands in for an
// observable import side effect of a real module.
const validationOrderCaptured = vi.hoisted(() => ({ imported: false }));
vi.mock('/fake/ext/validation-order-side-effect', () => {
  validationOrderCaptured.imported = true;
  return {
    extensionManifest: {
      factory: () => ({ value: 'should-not-run' }),
    },
  };
});

// Prototype-pollution regression: factory returns a plain string value to
// be mounted under a "__proto__"-prefixed dot-path.
vi.mock('/fake/ext/proto-pollution', () => ({
  extensionManifest: {
    factory: () => ({ value: 'PWNED' }),
  },
}));

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

    it('error message includes mount path, versions, and stale-VERSION hint', async () => {
      const mounts = [
        makeMount('vext', '/fake/ext/version-mismatch', '^2.0.0'),
      ];
      try {
        await loadExtensions(mounts, {});
        throw new Error('expected loadExtensions to reject');
      } catch (err) {
        expect(err).toBeInstanceOf(ExtensionVersionError);
        const msg = (err as Error).message;
        expect(msg).toContain('/fake/ext/version-mismatch');
        expect(msg).toContain('"vext"');
        expect(msg).toContain('"1.0.0"');
        expect(msg).toContain('"^2.0.0"');
        expect(msg).toContain('published VERSION constant is stale');
      }
    });
  });

  // ============================================================
  // EC-7 (transitive): missing transitive dep is reported
  // separately from a missing entrypoint package
  // ============================================================

  describe('EC-7 (transitive dependency): ERR_MODULE_NOT_FOUND surfaces underlying specifier', () => {
    const transitiveFixture = resolve(
      process.cwd(),
      'tests/fixtures/transitive-miss.mjs'
    );

    it('throws ExtensionLoadError naming the missing transitive specifier', async () => {
      const mounts = [makeMount('tm', transitiveFixture)];
      await expect(loadExtensions(mounts, {})).rejects.toThrow(
        ExtensionLoadError
      );
    });

    it('error message names the transitive dep and the importing file', async () => {
      const mounts = [makeMount('tm', transitiveFixture)];
      try {
        await loadExtensions(mounts, {});
        throw new Error('expected loadExtensions to reject');
      } catch (err) {
        expect(err).toBeInstanceOf(ExtensionLoadError);
        const msg = (err as Error).message;
        expect(msg).toContain('fake-transitive-dep-rcrsr-test');
        expect(msg).toContain('transitive-miss.mjs');
        expect(msg).toContain('cannot find transitive dependency');
        // Regression guard: must not be misclassified as the entrypoint.
        expect(msg).not.toContain(`Cannot find packages: ${transitiveFixture}`);
      }
    });

    it('error message includes rill-npm hint when dep directory exists under .rill/npm/node_modules', async () => {
      // findRillNpmRoot walks up from the importing file's directory and
      // finds .rill/npm/node_modules/fake-hinted-dep at tests/fixtures/
      // rill-npm-hint/. The walk is independent of the loadExtensions
      // `prefix` option (which anchors createRequire for bare entrypoints,
      // not the hint search), so the test does not pass prefix at all.
      const hintedFixture = resolve(
        process.cwd(),
        'tests/fixtures/rill-npm-hint/extensions/hinted-dep.mjs'
      );
      const mounts = [makeMount('hm', hintedFixture)];
      try {
        await loadExtensions(mounts, {});
        throw new Error('expected loadExtensions to reject');
      } catch (err) {
        expect(err).toBeInstanceOf(ExtensionLoadError);
        const msg = (err as Error).message;
        expect(msg).toContain('Hint:');
        expect(msg).toContain('.rill/npm/node_modules');
      }
    });

    it('aggregates entrypoint and transitive misses into a single error', async () => {
      // Regression guard for the previous behavior of throwing on the
      // first transitive miss while silently dropping any pending
      // entrypoint misses.
      const mounts = [
        makeMount('a', '@nonexistent/rill-ext-aggregate-99999'),
        makeMount('tm', transitiveFixture),
      ];
      try {
        await loadExtensions(mounts, {});
        throw new Error('expected loadExtensions to reject');
      } catch (err) {
        expect(err).toBeInstanceOf(ExtensionLoadError);
        const msg = (err as Error).message;
        expect(msg).toContain('@nonexistent/rill-ext-aggregate-99999');
        expect(msg).toContain('fake-transitive-dep-rcrsr-test');
      }
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

  // ============================================================
  // Ordering provenance: cheap validation runs before module imports
  // ============================================================

  describe('validation ordering: collisions/orphans checked before module import', () => {
    it('throws NamespaceCollisionError without importing the colliding mount module', async () => {
      validationOrderCaptured.imported = false;
      const mounts = [
        makeMount('shared', '/fake/ext/coll-pkg-a'),
        makeMount('shared.sub', '/fake/ext/validation-order-side-effect'),
      ];
      await expect(loadExtensions(mounts, {})).rejects.toThrow(
        NamespaceCollisionError
      );
      expect(validationOrderCaptured.imported).toBe(false);
    });

    it('throws ConfigValidationError without importing any mount module', async () => {
      validationOrderCaptured.imported = false;
      const mounts = [
        makeMount('real', '/fake/ext/validation-order-side-effect'),
      ];
      const config = { orphan: { setting: 'value' } };
      await expect(loadExtensions(mounts, config)).rejects.toThrow(
        ConfigValidationError
      );
      expect(validationOrderCaptured.imported).toBe(false);
    });
  });

  // ============================================================
  // Aggregation ordering: two mount failures report in mount order
  // ============================================================

  describe('aggregation ordering: two mount failures report in mount order', () => {
    it('lists two missing packages in mount order', async () => {
      const mounts = [
        makeMount('a', '@nonexistent/rill-ext-order-a-99999'),
        makeMount('b', '@nonexistent/rill-ext-order-b-99999'),
      ];
      try {
        await loadExtensions(mounts, {});
        throw new Error('expected loadExtensions to reject');
      } catch (err) {
        expect(err).toBeInstanceOf(ExtensionLoadError);
        const msg = (err as Error).message;
        expect(msg).toBe(
          'Cannot find packages: @nonexistent/rill-ext-order-a-99999, @nonexistent/rill-ext-order-b-99999'
        );
      }
    });
  });

  // ============================================================
  // Prototype-pollution defense in depth: mountValue never writes
  // through a "__proto__" segment, even when a mount path bypasses
  // resolveMounts's segment validation.
  // ============================================================

  describe('mountValue: null-prototype intermediates block prototype pollution', () => {
    it('does not pollute Object.prototype for a "__proto__"-prefixed mount path', async () => {
      const mounts: ResolvedMount[] = [
        {
          mountPath: '__proto__.polluted',
          packageSpecifier: '/fake/ext/proto-pollution',
        },
      ];
      await loadExtensions(mounts, {});
      expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    });

    it('does not pollute Object.prototype when "__proto__" is an intermediate segment', async () => {
      // 3+ segments, "__proto__" NOT at position 0: this walks through an
      // intermediate dict node created inside mountValue's loop, exercising
      // that node's Object.create(null) hardening specifically (distinct
      // from the root-tree case above).
      const mounts: ResolvedMount[] = [
        {
          mountPath: 'a.__proto__.polluted',
          packageSpecifier: '/fake/ext/proto-pollution',
        },
      ];
      await loadExtensions(mounts, {});
      expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
      expect(
        (Object.prototype as unknown as Record<string, unknown>)['polluted']
      ).toBeUndefined();
    });
  });

  // ============================================================
  // HP-9, HP-10, EC-12..EC-18: extensionModules preload option
  // ============================================================

  describe('loadExtensions with extensionModules', () => {
    it('HP-9: loads a mount via extensionModules without importing its package specifier', async () => {
      // The specifier below intentionally resolves to nothing on disk and
      // has no vi.mock() registered for it. If loadModules ever imported
      // first and overwrote second, this import attempt would throw
      // "Cannot find packages" before the preloaded value could be used.
      // Do not "fix" this by pointing it at a real fixture; an
      // unresolvable specifier is the point of the test.
      const mounts = [makeMount('pkg', './__not-on-disk__.js')];
      const extensionModules = new Map<string, unknown>([
        [
          'pkg',
          { extensionManifest: { factory: () => ({ value: 'preloaded' }) } },
        ],
      ]);
      const result = await loadExtensions(mounts, {}, { extensionModules });
      expect(result.extTree['pkg']).toBe('preloaded');
    });

    it('HP-10: loads one preloaded mount alongside one dynamically-imported mount', async () => {
      const mounts = [
        makeMount('pre', './__not-on-disk-mixed__.js'),
        makeMount('tools', '/fake/ext/valid-factory'),
      ];
      const extensionModules = new Map<string, unknown>([
        [
          'pre',
          { extensionManifest: { factory: () => ({ value: 'preloaded' }) } },
        ],
      ]);
      const result = await loadExtensions(mounts, {}, { extensionModules });
      expect(result.extTree['pre']).toBe('preloaded');
      expect(result.manifests.has('tools')).toBe(true);
    });

    it('EC-12: throws ExtensionLoadError when a preloaded module has no extensionManifest', async () => {
      const mounts = [makeMount('noman', './__not-on-disk-noman__.js')];
      const extensionModules = new Map<string, unknown>([
        ['noman', { someOtherExport: 42 }],
      ]);
      try {
        await loadExtensions(mounts, {}, { extensionModules });
        throw new Error('expected loadExtensions to reject');
      } catch (err) {
        expect(err).toBeInstanceOf(ExtensionLoadError);
        expect((err as Error).message).toContain('mounted at "noman"');
      }
    });

    it('EC-13: throws ExtensionVersionError when a preloaded manifest version violates the mount constraint', async () => {
      const mounts = [makeMount('vext', './__not-on-disk-vext__.js', '^2.0.0')];
      const extensionModules = new Map<string, unknown>([
        [
          'vext',
          {
            extensionManifest: {
              version: '1.0.0',
              factory: () => ({ value: 'x' }),
            },
          },
        ],
      ]);
      await expect(
        loadExtensions(mounts, {}, { extensionModules })
      ).rejects.toThrow(ExtensionVersionError);
    });

    it('EC-14: throws ExtensionLoadError with the actual type name for non-object preloaded values', async () => {
      const cases: Array<[unknown, string]> = [
        ['str', 'string'],
        [42, 'number'],
        [null, 'null'],
        [true, 'boolean'],
        [['a', 'b'], 'array'],
      ];
      for (const [value, expectedType] of cases) {
        const mounts = [makeMount('bad', './__not-on-disk-bad__.js')];
        const extensionModules = new Map<string, unknown>([['bad', value]]);
        try {
          await loadExtensions(mounts, {}, { extensionModules });
          throw new Error('expected loadExtensions to reject');
        } catch (err) {
          expect(err).toBeInstanceOf(ExtensionLoadError);
          expect((err as Error).message).toContain(
            `must be an object, got ${expectedType}`
          );
        }
      }
    });

    it('EC-15: throws when a preloaded entry is explicitly undefined instead of falling back to import', async () => {
      // Pins the `.has()`-over-`??` decision in loadModules: a `??`
      // fallback would treat this explicit `undefined` as "not preloaded"
      // and silently attempt the dynamic import instead.
      const mounts = [makeMount('undef', './__not-on-disk-undef__.js')];
      const extensionModules = new Map<string, unknown>([['undef', undefined]]);
      await expect(
        loadExtensions(mounts, {}, { extensionModules })
      ).rejects.toThrow('must be an object, got undefined');
    });

    it('EC-16: throws ExtensionLoadError when a preloaded module key matches no mount', async () => {
      const mounts = [makeMount('real', '/fake/ext/orphan-base')];
      const extensionModules = new Map<string, unknown>([
        ['typo', { extensionManifest: { factory: () => ({ value: 'x' }) } }],
      ]);
      try {
        await loadExtensions(mounts, {}, { extensionModules });
        throw new Error('expected loadExtensions to reject');
      } catch (err) {
        expect(err).toBeInstanceOf(ExtensionLoadError);
        expect((err as Error).message).toContain(
          'Preloaded module key "typo" does not match any mount'
        );
      }
    });

    it('EC-17: throws for an orphan preloaded key before importing any mount module', async () => {
      validationOrderCaptured.imported = false;
      const mounts = [
        makeMount('real', '/fake/ext/validation-order-side-effect'),
      ];
      const extensionModules = new Map<string, unknown>([
        ['typo', { extensionManifest: { factory: () => ({ value: 'x' }) } }],
      ]);
      await expect(
        loadExtensions(mounts, {}, { extensionModules })
      ).rejects.toThrow(ExtensionLoadError);
      expect(validationOrderCaptured.imported).toBe(false);
    });

    it('EC-18: keys a dot-path mount "a.b" by the full string, not just the first segment', async () => {
      const mounts = [makeMount('a.b', './__not-on-disk-dotpath__.js')];
      const extensionModules = new Map<string, unknown>([
        [
          'a.b',
          { extensionManifest: { factory: () => ({ value: 'nested' }) } },
        ],
      ]);
      const result = await loadExtensions(mounts, {}, { extensionModules });
      expect((result.extTree['a'] as Record<string, unknown>)['b']).toBe(
        'nested'
      );
    });
  });

  // ============================================================
  // #30: registerErrorCode conflict raised from a deferred callback
  // ============================================================

  describe('#30: registerErrorCode conflict from a deferred/dispose callback', () => {
    it('rejects with ExtensionLoadError, not a plain Error', async () => {
      const mounts = [
        makeMount('a', '/fake/ext/deferred-code-a'),
        makeMount('b', '/fake/ext/deferred-code-b'),
      ];
      const result = await loadExtensions(mounts, {});
      const deferredDispose = result.disposes[result.disposes.length - 1]!;
      await expect(
        Promise.resolve().then(() => deferredDispose())
      ).rejects.toThrow(ExtensionLoadError);
    });
  });

  // ============================================================
  // #31: factory returning a non-object result
  // ============================================================

  describe('#31: factory returns a non-object result', () => {
    it.each([
      ['null', '/fake/ext/factory-returns-null'],
      ['undefined', '/fake/ext/factory-returns-undefined'],
      ['a number', '/fake/ext/factory-returns-number'],
      ['a string', '/fake/ext/factory-returns-string'],
    ])(
      'rejects with ExtensionLoadError when the factory returns %s',
      async (_label, specifier) => {
        const mounts = [makeMount('bad', specifier)];
        await expect(loadExtensions(mounts, {})).rejects.toThrow(
          ExtensionLoadError
        );
        await expect(loadExtensions(mounts, {})).rejects.toThrow(
          /returned a non-object/
        );
      }
    );
  });

  // ============================================================
  // #35: isEntrypointMiss honors `prefix` for relative specifiers
  // ============================================================

  describe('#35: prefix-aware entrypoint-miss classification', () => {
    it('classifies a missing relative entrypoint under a non-cwd prefix as "Cannot find packages"', async () => {
      const prefix = resolve(process.cwd(), 'tests/fixtures/prefix-resolution');
      const mounts = [
        makeMount('missing', './__does-not-exist-relative-entry__.js'),
      ];
      try {
        await loadExtensions(mounts, {}, { prefix });
        throw new Error('expected loadExtensions to reject');
      } catch (err) {
        expect(err).toBeInstanceOf(ExtensionLoadError);
        const msg = (err as Error).message;
        expect(msg).toContain('Cannot find packages:');
        expect(msg).toContain('__does-not-exist-relative-entry__.js');
        expect(msg).not.toContain('cannot find transitive dependency');
      }
    });
  });

  // ============================================================
  // #36: mounting into an extension-returned object is a collision,
  // not a reference mutation; loader-created intermediates still merge.
  // ============================================================

  describe('#36: mount collision against an extension-returned object', () => {
    it('rejects with "Mount collision" when the leaf mount is registered first', async () => {
      const mounts = [
        makeMount('coll1', '/fake/ext/mount-obj'),
        makeMount('coll1.sub', '/fake/ext/mount-obj'),
      ];
      await expect(loadExtensions(mounts, {})).rejects.toThrow(
        /Mount collision/
      );
    });

    it('rejects with "Mount collision" when the nested mount is registered first', async () => {
      const mounts = [
        makeMount('coll2.sub', '/fake/ext/mount-obj'),
        makeMount('coll2', '/fake/ext/mount-obj'),
      ];
      await expect(loadExtensions(mounts, {})).rejects.toThrow(
        /Mount collision/
      );
    });

    it('control: two nested mounts sharing a loader-created intermediate both resolve', async () => {
      const mounts = [
        makeMount('ctrl.b', '/fake/ext/mount-obj'),
        makeMount('ctrl.c', '/fake/ext/mount-obj'),
      ];
      const result = await loadExtensions(mounts, {});
      const ctrl = result.extTree['ctrl'] as Record<string, unknown>;
      expect(ctrl['b']).toEqual({ k: 'obj' });
      expect(ctrl['c']).toEqual({ k: 'obj' });
    });
  });

  // ============================================================
  // #37: orphan-config-key check accepts only exact mount paths
  // ============================================================

  describe('#37: dot-path mounts require an exact config key match', () => {
    it('rejects a config key that names only the first segment of a dot-path mount', async () => {
      const mounts = [makeMount('a.b', '/fake/ext/dotpath-config-capture')];
      const config = { a: { setting: 1 } };
      await expect(loadExtensions(mounts, config)).rejects.toThrow(
        ConfigValidationError
      );
      await expect(loadExtensions(mounts, config)).rejects.toThrow(
        /does not match any mount/
      );
    });

    it('control: a config key matching the full dotted mount path reaches the factory', async () => {
      const mounts = [makeMount('a.b', '/fake/ext/dotpath-config-capture')];
      const config = { 'a.b': { setting: 1 } };
      await loadExtensions(mounts, config);
      expect(dotpathConfigCaptured.cfg).toEqual({ setting: 1 });
    });
  });

  // ============================================================
  // #39: runDisposes is exported from the public barrel
  // ============================================================

  describe('#39: runDisposes public export', () => {
    it('runs dispose callbacks in reverse order and swallows their errors', async () => {
      const order: number[] = [];
      const disposes = [
        () => {
          order.push(1);
        },
        () => {
          throw new Error('boom');
        },
        () => {
          order.push(3);
        },
      ];
      await expect(runDisposes(disposes)).resolves.toBeUndefined();
      expect(order).toEqual([3, 1]);
    });
  });
});
