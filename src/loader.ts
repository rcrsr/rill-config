/**
 * Extension loader for rill-config.
 * Validates manifests, checks versions, detects collisions, invokes factories,
 * and builds the nested extension config tree.
 */

import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
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
 * Relative paths are resolved against `prefix` (falling back to CWD when
 * absent) and converted to file URLs.
 * Bare specifiers resolve from the project directory via createRequire.
 * @internal
 */
export function resolveSpecifier(specifier: string, prefix?: string): string {
  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    return pathToFileURL(resolve(prefix ?? process.cwd(), specifier)).href;
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
 * Extract the missing specifier and (when present) the importing parent
 * from a Node `ERR_MODULE_NOT_FOUND` / `MODULE_NOT_FOUND` error message.
 * Both ESM and CJS forms are accepted:
 *   - ESM:  Cannot find package 'X' imported from /abs/parent.js
 *   - ESM:  Cannot find module '/abs/X.js' imported from /abs/parent.js
 *   - CJS:  Cannot find module 'X'
 */
function parseModuleNotFoundError(
  err: Error
): { specifier: string; parent: string | undefined } | undefined {
  const match =
    /Cannot find (?:package|module) ['"]([^'"]+)['"](?:\s+imported from\s+(\S+))?/.exec(
      err.message
    );
  if (match === null) return undefined;
  return { specifier: match[1]!, parent: match[2] };
}

/**
 * True when a parsed missing specifier refers to the same module as the
 * mount's `packageSpecifier` (the entrypoint we tried to load), accounting
 * for relative-vs-absolute and file:// vs path forms.
 *
 * Known limitation: if a bare `pkg` resolves successfully via `createRequire`
 * but the resolved file itself is missing on disk, the parsed specifier is
 * an absolute path while `pkg` is the bare name. This case is misclassified
 * as transitive. Rare in practice (broken install) and surfaces a still-useful
 * message; a real fix needs the resolved URL alongside the bare specifier.
 */
function isEntrypointMiss(pkg: string, parsedSpecifier: string): boolean {
  if (parsedSpecifier === pkg) return true;
  const pkgIsPath =
    pkg.startsWith('./') ||
    pkg.startsWith('../') ||
    isAbsolute(pkg) ||
    pkg.startsWith('file://');
  if (!pkgIsPath) return false;
  const pkgAbs = pkg.startsWith('file://')
    ? fileURLToPath(pkg)
    : resolve(process.cwd(), pkg);
  let specAbs = parsedSpecifier;
  if (specAbs.startsWith('file://')) specAbs = fileURLToPath(specAbs);
  if (!isAbsolute(specAbs)) return false;
  return resolve(specAbs) === pkgAbs;
}

/**
 * Walk up from `start` looking for a directory containing
 * `.rill/npm/node_modules/<specifier-root>`. Returns that directory (the
 * project root) or undefined. Walks to the filesystem root; bounded
 * naturally by directory depth (≈20 iters in any realistic tree).
 *
 * Returns undefined for non-bare specifiers (relative paths, absolute
 * paths, file:// URLs). Those are missing local files, not missing npm
 * deps, and pointing the user at .rill/npm/ would be misleading.
 */
function findRillNpmRoot(start: string, specifier: string): string | undefined {
  if (
    specifier.startsWith('.') ||
    specifier.startsWith('/') ||
    specifier.startsWith('file://')
  ) {
    return undefined;
  }
  // Resolve the install root for scoped (@scope/name) and unscoped names.
  const segments = specifier.split('/');
  const installRoot = specifier.startsWith('@')
    ? segments.slice(0, 2).join('/')
    : segments[0]!;
  if (installRoot === '') return undefined;

  let current = resolve(start);
  while (true) {
    const candidate = join(
      current,
      '.rill',
      'npm',
      'node_modules',
      installRoot
    );
    if (existsSync(candidate)) return current;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
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
  // NOTE: imports are intentionally sequential, not concurrent. A
  // Promise.all-based rewrite was attempted and reverted: concurrent
  // `import()` calls resolving to the same specifier race against each
  // other's module-registry registration and can spuriously report one of
  // the two as not-found. Aggregation stays mount-order-stable as a
  // consequence of the sequential loop, with no reordering logic needed.
  const modules = new Map<string, Record<string, unknown>>();
  const missingPackages: string[] = [];
  const transitiveMisses: string[] = [];

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
        const parsed = parseModuleNotFoundError(err as Error);
        if (parsed === undefined || isEntrypointMiss(pkg, parsed.specifier)) {
          missingPackages.push(pkg);
          continue;
        }
        // Transitive miss: a dependency of the loaded extension is missing.
        // Surface the real specifier and importing file so users do not
        // mistake this for the entrypoint itself being unavailable.
        transitiveMisses.push(buildTransitiveMissMessage(pkg, parsed));
        continue;
      }
      const reason = err instanceof Error ? err.message : String(err);
      throw new ExtensionLoadError(`Failed to load ${pkg}: ${reason}`);
    }
  }

  if (missingPackages.length > 0 || transitiveMisses.length > 0) {
    const parts: string[] = [];
    if (missingPackages.length > 0) {
      parts.push(`Cannot find packages: ${missingPackages.join(', ')}`);
    }
    parts.push(...transitiveMisses);
    throw new ExtensionLoadError(parts.join('\n'));
  }

  return modules;
}

/**
 * Build the per-mount message for a transitive `ERR_MODULE_NOT_FOUND`.
 * The missing specifier is interpolated only into prose — never into a
 * shell snippet — to avoid producing a copy-pastable command that runs
 * something different from what is suggested.
 */
function buildTransitiveMissMessage(
  pkg: string,
  parsed: { specifier: string; parent: string | undefined }
): string {
  const parentPath =
    parsed.parent !== undefined && parsed.parent.startsWith('file://')
      ? fileURLToPath(parsed.parent)
      : parsed.parent;
  const hintRoot =
    parentPath !== undefined
      ? findRillNpmRoot(dirname(parentPath), parsed.specifier)
      : undefined;
  const where =
    parentPath !== undefined ? ` (imported from ${parentPath})` : '';
  const hint =
    hintRoot !== undefined
      ? ` Hint: that dep is installed under ${join(hintRoot, '.rill', 'npm', 'node_modules')}/. Symlink node_modules at the project root (\`ln -sfn .rill/npm/node_modules node_modules\`) or install it under .rill/npm/.`
      : '';
  return `Failed to load ${pkg}: cannot find transitive dependency '${parsed.specifier}'${where}.${hint}`;
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
          `Extension ${pkg} (mounted at "${mount.mountPath}") reports manifest.version "${installedVersion}", which does not satisfy install range "${mount.versionConstraint}". If the on-disk package version differs from manifest.version, the published VERSION constant is stale; widen this mount's install range (e.g., "*") to bypass, or report the stale VERSION upstream.`
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
  // Cheap, side-effect-free validation runs before any arbitrary imported
  // module code executes (loadModules dynamically imports mount packages).
  detectNamespaceCollisions(mounts);
  assertNoOrphanConfigKeys(config, mounts);

  const modules = await loadModules(mounts, options?.prefix);
  const manifests = validateManifests(mounts, modules);

  const { tree, disposes, errorCodes } = await invokeFactories(
    mounts,
    manifests,
    config,
    options?.signal
  );

  return { extTree: tree, disposes, manifests, errorCodes };
}
