/**
 * Top-level project loader for rill-config.
 * Orchestrates config reading, validation, extension loading, and resolver assembly.
 */

import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { ConfigNotFoundError, VariableProviderError } from './errors.js';
import { parseConfig } from './parse.js';
import { extractVariables, interpolate } from './vars.js';
import { envProvider } from './var-providers.js';
import { checkRuntimeVersion, validateContext } from './validate.js';
import { resolveMounts } from './mounts.js';
import { loadExtensions, runDisposes } from './loader.js';
import { buildContextBindings, buildExtensionBindings } from './bindings.js';
import { buildResolvers } from './resolvers.js';
import type { RillValue } from '@rcrsr/rill';
import type { ContextFieldSchema, ProjectResult } from './types.js';
import type { VariableProvider } from './var-providers.js';

// ============================================================
// LOAD PROJECT
// ============================================================

/**
 * Top-level orchestrator that loads and assembles a rill project.
 * Reads config, validates, loads extensions, builds bindings and resolvers.
 * Never calls process.exit(). Propagates sub-function errors unchanged.
 * File read error: wraps ENOENT as ConfigNotFoundError, rethrows others.
 */
export async function loadProject(options: {
  configPath: string;
  rillVersion: string;
  /**
   * Optional parent abort signal. When aborted, cascades into every
   * extension factory's `ctx.signal` so factories that registered
   * cleanup via `signal.addEventListener('abort', ...)` tear down.
   */
  signal?: AbortSignal;
  /**
   * Optional path-resolution anchor forwarded to loadExtensions, used to
   * resolve relative and bare mount specifiers. Defaults to the config
   * file's directory when omitted.
   */
  prefix?: string;
  /**
   * Optional variable provider used to resolve `${VAR}` names during config
   * interpolation. Session `@{VAR}` vars are untouched: loadProject never
   * calls substituteSessionVars, so a supplied provider has no effect on
   * them. A supplied provider fully displaces process.env; defaults to
   * envProvider() when omitted. Names no provider resolves still throw
   * ConfigEnvError from interpolate, the same error class used for the
   * legacy env-only path. That name stays env-specific even when a
   * custom provider never touches the environment.
   */
  varProvider?: VariableProvider;
  /**
   * Optional preloaded extension modules, keyed by mount name exactly as
   * written in `extensions.mounts` in the config. A dot-path mount uses the
   * full dotted path (`"a.b"`), not the first segment. Mounts absent from
   * the map are imported normally via the existing specifier resolution, so
   * this is backward compatible. A key present but whose value is not a
   * non-null object throws ExtensionLoadError; this includes a key
   * explicitly set to `undefined`, which is an error rather than a
   * fall-through to import. A key matching no mount throws
   * ExtensionLoadError. Preloaded modules still undergo manifest presence
   * and semver version validation, unchanged. Motivation: a fully
   * runtime-computed `import()` is opaque to bundlers, so pre-loading lets a
   * host compile a project with relative-path mounts into a single-file
   * artifact and stop depending on `process.cwd()` for mount resolution.
   */
  extensionModules?: ReadonlyMap<string, unknown>;
}): Promise<ProjectResult> {
  const { configPath, rillVersion, signal } = options;
  const prefix = options.prefix ?? dirname(configPath);

  // Step 1: Read config file
  let raw: string;
  try {
    raw = await readFile(configPath, { encoding: 'utf8' });
  } catch (err) {
    const isEnoent =
      err instanceof Error && (err as { code?: string }).code === 'ENOENT';
    if (isEnoent) {
      throw new ConfigNotFoundError(`Config file not found: ${configPath}`);
    }
    throw err;
  }

  // Step 2: Parse and interpolate config
  const config = parseConfig(raw);
  const vars = extractVariables(config);
  const provider = options.varProvider ?? envProvider();
  const resolvedVars = await provider.provide(
    vars.global,
    signal !== undefined ? { signal } : {}
  );
  if (typeof resolvedVars !== 'object' || resolvedVars === null) {
    throw new VariableProviderError(
      'Variable provider did not return an object',
      'varProvider',
      undefined
    );
  }
  for (const [name, value] of Object.entries(resolvedVars)) {
    if (typeof value !== 'string') {
      throw new VariableProviderError(
        `Variable provider returned a non-string value for ${name}`,
        'varProvider',
        undefined
      );
    }
  }
  const interpolatedConfig = interpolate(config, resolvedVars);

  // Step 3: Runtime version check
  if (interpolatedConfig.runtime !== undefined) {
    checkRuntimeVersion(interpolatedConfig.runtime, rillVersion);
  }

  // Step 4: Load extensions
  let extTree: Record<string, RillValue> = {};
  let disposes: ReadonlyArray<() => void | Promise<void>> = [];
  let errorCodes: ReadonlyMap<string, string> = new Map();

  if (interpolatedConfig.extensions !== undefined) {
    const mounts = resolveMounts(interpolatedConfig.extensions.mounts);
    const loaded = await loadExtensions(
      mounts,
      (interpolatedConfig.extensions.config ?? {}) as Record<
        string,
        Record<string, unknown>
      >,
      {
        ...(signal !== undefined ? { signal } : {}),
        ...(prefix !== undefined ? { prefix } : {}),
        ...(options.extensionModules !== undefined
          ? { extensionModules: options.extensionModules }
          : {}),
      }
    );
    extTree = loaded.extTree;
    disposes = loaded.disposes;
    errorCodes = loaded.errorCodes;
  }

  // Steps 5-8 wrapped to ensure extension cleanup on failure
  try {
    // Step 5: Validate context
    let contextSchema: Record<string, ContextFieldSchema> = {};
    let contextValues: Record<string, unknown> = {};

    if (interpolatedConfig.context !== undefined) {
      contextValues = validateContext(interpolatedConfig.context);
      contextSchema = interpolatedConfig.context.schema;
    }

    // Step 6: Build extension bindings
    const extensionBindings = buildExtensionBindings(extTree);

    // Step 7: Build context bindings
    const contextBindings = buildContextBindings(contextSchema, contextValues);

    // Step 8: Build resolvers
    const resolverConfig = buildResolvers({
      extTree,
      contextValues,
      modulesConfig: interpolatedConfig.modules ?? {},
      configDir: dirname(configPath),
    });

    return {
      config: interpolatedConfig,
      extTree,
      disposes,
      errorCodes,
      resolverConfig,
      hostOptions: interpolatedConfig.host ?? {},
      extensionBindings,
      contextBindings,
    };
  } catch (err) {
    await runDisposes(disposes);
    throw err;
  }
}
