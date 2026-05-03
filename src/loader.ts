/**
 * Extension loader for rill-config.
 * Validates manifests, checks versions, detects collisions, invokes factories,
 * and builds the nested extension config tree.
 */

import { createRequire } from 'node:module';
import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import semver from 'semver';
import {
  isApplicationCallable,
  isTuple,
  isVector,
  type ExtensionFactoryCtx,
  type ExtensionFactoryResult,
  type RillValue,
} from '@rcrsr/rill';
import {
  ConfigValidationError,
  ExtensionLoadError,
  ExtensionVersionError,
} from './errors.js';
import { detectNamespaceCollisions } from './mounts.js';
import type {
  ExtensionManifest,
  LoadedProject,
  ResolvedMount,
} from './types.js';

// ============================================================
// HELPERS
// ============================================================

/**
 * Resolve a package specifier for dynamic import.
 * Relative paths are resolved against CWD and converted to file URLs.
 * Bare specifiers resolve from the project directory via createRequire.
 * @internal
 */
export function resolveSpecifier(specifier: string, prefix?: string): string {
  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    return pathToFileURL(resolve(process.cwd(), specifier)).href;
  }
  if (isAbsolute(specifier) || specifier.startsWith('file://')) {
    return specifier;
  }
  // Bare specifiers: resolve from project directory, not from this file's location
  const projectRequire = createRequire(
    pathToFileURL(resolve(prefix ?? process.cwd(), 'package.json')).href
  );
  return pathToFileURL(projectRequire.resolve(specifier)).href;
}

function isModuleNotFoundError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as { code?: string }).code;
  return code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND';
}

/**
 * Run dispose callbacks in reverse order, swallowing errors. Used for
 * cleanup paths where a partial-init failure must tear down whatever
 * was already initialized without masking the original error.
 */
export async function runDisposes(
  disposes: ReadonlyArray<() => void | Promise<void>>
): Promise<void> {
  for (let i = disposes.length - 1; i >= 0; i--) {
    try {
      await disposes[i]!();
    } catch {
      // Ignore dispose errors during cleanup
    }
  }
}

/**
 * Mount a RillValue into the tree at a dot-path.
 * Single-segment: tree[name] = value.
 * Dot-path: creates intermediate dicts, places value at leaf (GAP-7).
 * Detects intra-package nested-mount collisions; cross-package collisions
 * are caught earlier by detectNamespaceCollisions.
 */
function mountValue(
  tree: Record<string, RillValue>,
  mountPath: string,
  value: RillValue
): void {
  const parts = mountPath.split('.');

  if (parts.length === 1) {
    tree[mountPath] = value;
    return;
  }

  // Dot-path: create intermediate dict nodes
  let node: Record<string, RillValue> = tree;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!;
    const existing = node[part];
    if (existing === undefined) {
      const intermediate: Record<string, RillValue> = {};
      node[part] = intermediate as unknown as RillValue;
    } else if (
      typeof existing !== 'object' ||
      existing === null ||
      Array.isArray(existing) ||
      isApplicationCallable(existing) ||
      isTuple(existing) ||
      isVector(existing)
    ) {
      const prefix = parts.slice(0, i + 1).join('.');
      throw new ExtensionLoadError(
        `Mount collision at "${prefix}": existing value is not a plain dict`
      );
    }
    node = node[part] as unknown as Record<string, RillValue>;
  }

  node[parts[parts.length - 1]!] = value;
}

/**
 * Create a child AbortController linked to an optional parent signal.
 * The returned `dispose` removes the parent listener and aborts the
 * controller — call it whether the factory succeeds or fails.
 */
function linkSignal(parentSignal: AbortSignal | undefined): {
  signal: AbortSignal;
  dispose: () => void;
} {
  const controller = new AbortController();
  let parentListener: (() => void) | undefined;

  if (parentSignal !== undefined) {
    if (parentSignal.aborted) {
      controller.abort();
    } else {
      parentListener = () => controller.abort();
      parentSignal.addEventListener('abort', parentListener, { once: true });
    }
  }

  return {
    signal: controller.signal,
    dispose: () => {
      if (parentSignal !== undefined && parentListener !== undefined) {
        parentSignal.removeEventListener('abort', parentListener);
      }
      controller.abort();
    },
  };
}

// ============================================================
// PHASES
// ============================================================

/**
 * Phase 1: dynamically import each mount's package. Aggregates missing
 * packages into a single error message; rethrows other import failures.
 */
async function loadModules(
  mounts: ResolvedMount[],
  prefix?: string
): Promise<Map<string, Record<string, unknown>>> {
  const modules = new Map<string, Record<string, unknown>>();
  const missingPackages: string[] = [];

  for (const mount of mounts) {
    const pkg = mount.packageSpecifier;
    try {
      const mod = (await import(resolveSpecifier(pkg, prefix))) as Record<
        string,
        unknown
      >;
      modules.set(mount.mountPath, mod);
    } catch (err) {
      if (isModuleNotFoundError(err)) {
        missingPackages.push(pkg);
        continue;
      }
      const reason = err instanceof Error ? err.message : String(err);
      throw new ExtensionLoadError(`Failed to load ${pkg}: ${reason}`);
    }
  }

  if (missingPackages.length > 0) {
    throw new ExtensionLoadError(
      `Cannot find packages: ${missingPackages.join(', ')}`
    );
  }

  return modules;
}

/**
 * Phase 2: assert each module exports `extensionManifest` and that its
 * version satisfies the mount's version constraint.
 */
function validateManifests(
  mounts: ResolvedMount[],
  modules: ReadonlyMap<string, Record<string, unknown>>
): Map<string, ExtensionManifest> {
  const manifests = new Map<string, ExtensionManifest>();

  for (const mount of mounts) {
    const pkg = mount.packageSpecifier;
    const mod = modules.get(mount.mountPath)!;

    if (
      !('extensionManifest' in mod) ||
      mod['extensionManifest'] === null ||
      typeof mod['extensionManifest'] !== 'object'
    ) {
      throw new ExtensionLoadError(`${pkg} does not export extensionManifest`);
    }

    const manifest = mod['extensionManifest'] as ExtensionManifest;

    if (mount.versionConstraint !== undefined) {
      const installedVersion = manifest.version;
      if (
        installedVersion !== undefined &&
        !semver.satisfies(installedVersion, mount.versionConstraint)
      ) {
        throw new ExtensionVersionError(
          `${pkg} v${installedVersion} does not satisfy ${mount.versionConstraint}`
        );
      }
    }

    manifests.set(mount.mountPath, manifest);
  }

  return manifests;
}

/**
 * Phase 3: every top-level config key must correspond to a known mount
 * (either as a full mountPath, or as the first segment of one).
 */
function assertNoOrphanConfigKeys(
  config: Record<string, unknown>,
  mounts: ResolvedMount[]
): void {
  const mountFirstSegments = new Set<string>();
  const mountPaths = new Set<string>();
  for (const mount of mounts) {
    mountPaths.add(mount.mountPath);
    mountFirstSegments.add(mount.mountPath.split('.')[0]!);
  }

  for (const key of Object.keys(config)) {
    if (!mountFirstSegments.has(key) && !mountPaths.has(key)) {
      throw new ConfigValidationError(
        `Config key ${key} does not match any mount`
      );
    }
  }
}

type FactoryFn = (
  cfg: Record<string, unknown>,
  ctx: ExtensionFactoryCtx
) => ExtensionFactoryResult | Promise<ExtensionFactoryResult>;

interface FactoryRunResult {
  tree: Record<string, RillValue>;
  disposes: Array<() => void | Promise<void>>;
  errorCodes: Map<string, string>;
}

/**
 * Phase 4: invoke each factory in mount order. On any failure, runs the
 * disposes already registered (in reverse order) and rethrows. Each
 * factory gets a child AbortSignal that cascades from `parentSignal`.
 */
async function invokeFactories(
  mounts: ResolvedMount[],
  manifests: ReadonlyMap<string, ExtensionManifest>,
  config: Record<string, Record<string, unknown>>,
  parentSignal: AbortSignal | undefined
): Promise<FactoryRunResult> {
  const tree: Record<string, RillValue> = {};
  const disposes: Array<() => void | Promise<void>> = [];
  const errorCodes = new Map<string, string>();

  try {
    for (const mount of mounts) {
      const pkg = mount.packageSpecifier;
      const manifest = manifests.get(mount.mountPath)!;

      const factory = manifest.factory;
      if (typeof factory !== 'function') {
        throw new ExtensionLoadError(
          `${pkg} extensionManifest has no factory function`
        );
      }

      const link = linkSignal(parentSignal);

      const ctx: ExtensionFactoryCtx = {
        signal: link.signal,
        registerErrorCode(name: string, kind: string): void {
          const existing = errorCodes.get(name);
          if (existing !== undefined && existing !== kind) {
            throw new Error(
              `Error code ${name} already registered with kind ${existing}`
            );
          }
          errorCodes.set(name, kind);
        },
      };

      // Push signal cleanup before invoking the factory so partial-init
      // teardown removes the parent listener and aborts even if the
      // factory throws.
      disposes.push(link.dispose);

      let result: ExtensionFactoryResult;
      try {
        result = await (factory as FactoryFn)(
          config[mount.mountPath] ?? {},
          ctx
        );
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        throw new ExtensionLoadError(`Factory for ${pkg} threw: ${reason}`);
      }

      // EC-5 / AC-13: factory must return an object with a value property
      if (!('value' in result)) {
        throw new ExtensionLoadError(
          `Factory for ${pkg} returned result without value property`
        );
      }

      // EC-6 / AC-14: value must not be undefined
      if (result.value === undefined) {
        throw new ExtensionLoadError(
          `Factory for ${pkg} returned undefined value`
        );
      }

      if (result.dispose !== undefined) {
        disposes.push(result.dispose);
      }

      // DD-2: store value at mount path by reference
      mountValue(tree, mount.mountPath, result.value);
    }
  } catch (err) {
    await runDisposes(disposes);
    throw err;
  }

  return { tree, disposes, errorCodes };
}

// ============================================================
// LOADER
// ============================================================

export async function loadExtensions(
  mounts: ResolvedMount[],
  config: Record<string, Record<string, unknown>>,
  options?: { signal?: AbortSignal; prefix?: string }
): Promise<LoadedProject> {
  const modules = await loadModules(mounts, options?.prefix);
  const manifests = validateManifests(mounts, modules);
  detectNamespaceCollisions(mounts);
  assertNoOrphanConfigKeys(config, mounts);

  const { tree, disposes, errorCodes } = await invokeFactories(
    mounts,
    manifests,
    config,
    options?.signal
  );

  return { extTree: tree, disposes, manifests, errorCodes };
}
