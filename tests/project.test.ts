/**
 * Tests for loadProject facade
 * Covers: HP-1, HP-2, AC-1, AC-23; varProvider injection, env displacement,
 * default env behavior, VariableProviderError propagation
 */

import {
  loadProject,
  ConfigNotFoundError,
  ConfigEnvError,
  ConfigError,
  VariableProviderError,
  literalProvider,
} from '@rcrsr/rill-config';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
// Imports the src module directly, not the `@rcrsr/rill-config` barrel.
// Vitest's re-export transform gives the barrel's forwarded `loadExtensions`
// export a distinct binding from the one `project.ts` calls internally, so
// spying via the barrel does not intercept that internal call. Spying on
// this binding instead makes the "not called" assertion below meaningful.
import * as loaderModule from '../src/loader.js';
import { withTempDir } from './helpers/temp-dir.js';

function writeConfig(dir: string, content: string): string {
  const configPath = join(dir, 'rill-config.json');
  writeFileSync(configPath, content, 'utf8');
  return configPath;
}

const MINIMAL_CONFIG = JSON.stringify({
  name: 'test-project',
  version: '1.0.0',
});

const CONFIG_WITH_VARS = JSON.stringify({
  name: 'vars-project',
  version: '1.0.0',
  context: {
    schema: {
      apiKey: { type: 'string' },
    },
    values: {
      apiKey: '${X}',
    },
  },
});

const CONFIG_WITH_CONTEXT = JSON.stringify({
  name: 'ctx-project',
  context: {
    schema: {
      apiUrl: { type: 'string' },
      debug: { type: 'bool' },
    },
    values: {
      apiUrl: 'https://example.com',
      debug: false,
    },
  },
});

// ============================================================
// HP-1 / AC-1: loadProject with valid config returns ProjectResult
// ============================================================

describe('loadProject', () => {
  describe('HP-1: valid config with no extensions', () => {
    it('returns a ProjectResult with empty extTree and disposes', async () => {
      // AC-1, AC-23: no extensions block -> empty extTree and disposes
      await withTempDir(async (dir) => {
        const configPath = writeConfig(dir, MINIMAL_CONFIG);
        const result = await loadProject({
          configPath,

          rillVersion: '1.0.0',
        });
        expect(result.extTree).toEqual({});
        expect(result.disposes).toHaveLength(0);
      });
    });

    it('returns the parsed config in result.config', async () => {
      await withTempDir(async (dir) => {
        const configPath = writeConfig(dir, MINIMAL_CONFIG);
        const result = await loadProject({
          configPath,

          rillVersion: '1.0.0',
        });
        expect(result.config.name).toBe('test-project');
        expect(result.config.version).toBe('1.0.0');
      });
    });

    it('returns a resolverConfig with ext, context, and module resolvers', async () => {
      await withTempDir(async (dir) => {
        const configPath = writeConfig(dir, MINIMAL_CONFIG);
        const result = await loadProject({
          configPath,

          rillVersion: '1.0.0',
        });
        expect(result.resolverConfig.resolvers).toHaveProperty('ext');
        expect(result.resolverConfig.resolvers).toHaveProperty('context');
        expect(result.resolverConfig.resolvers).toHaveProperty('module');
      });
    });

    it('returns extensionBindings as rill source string', async () => {
      await withTempDir(async (dir) => {
        const configPath = writeConfig(dir, MINIMAL_CONFIG);
        const result = await loadProject({
          configPath,

          rillVersion: '1.0.0',
        });
        expect(typeof result.extensionBindings).toBe('string');
        expect(result.extensionBindings.length).toBeGreaterThan(0);
      });
    });

    it('returns hostOptions as empty object when host block absent', async () => {
      await withTempDir(async (dir) => {
        const configPath = writeConfig(dir, MINIMAL_CONFIG);
        const result = await loadProject({
          configPath,

          rillVersion: '1.0.0',
        });
        expect(result.hostOptions).toEqual({});
      });
    });
  });

  describe('HP-1: valid config with context block', () => {
    it('builds context bindings from schema and values', async () => {
      await withTempDir(async (dir) => {
        const configPath = writeConfig(dir, CONFIG_WITH_CONTEXT);
        const result = await loadProject({
          configPath,

          rillVersion: '1.0.0',
        });
        expect(result.contextBindings).toContain('apiUrl');
        expect(result.contextBindings).toContain('debug');
      });
    });
  });

  describe('HP-2: extensionModules option', () => {
    it('forwards a preloaded module into loadExtensions, bypassing package resolution', async () => {
      await withTempDir(async (dir) => {
        const config = JSON.stringify({
          name: 'preloaded-mount-project',
          extensions: {
            mounts: {
              preloaded: 'this-specifier-does-not-exist-on-disk',
            },
          },
        });
        const configPath = writeConfig(dir, config);
        // The specifier above is intentionally unresolvable: if loadProject
        // failed to forward extensionModules, loadExtensions would attempt
        // resolveSpecifier + import() for it and throw "Cannot find packages".
        const extensionModules = new Map<string, unknown>([
          [
            'preloaded',
            {
              extensionManifest: { factory: () => ({ value: 'from-preload' }) },
            },
          ],
        ]);
        const result = await loadProject({
          configPath,
          rillVersion: '1.0.0',
          extensionModules,
        });
        expect((result.extTree as Record<string, unknown>)['preloaded']).toBe(
          'from-preload'
        );
      });
    });
  });

  describe('relative mount specifiers resolve against the config directory', () => {
    it('resolves a "./" mount specifier relative to configPath, not cwd', async () => {
      await withTempDir(async (dir) => {
        const extPath = join(dir, 'local-ext.mjs');
        writeFileSync(
          extPath,
          "export const extensionManifest = { factory: () => ({ value: 'from-local-ext' }) };\n",
          'utf8'
        );
        const configPath = writeConfig(
          dir,
          JSON.stringify({
            name: 'relative-mount-project',
            extensions: {
              mounts: {
                local: './local-ext.mjs',
              },
            },
          })
        );

        const result = await loadProject({
          configPath,
          rillVersion: '1.0.0',
        });

        expect(result.extTree).toHaveProperty('local');
        expect((result.extTree as Record<string, unknown>)['local']).toBe(
          'from-local-ext'
        );
      });
    });
  });

  describe('error: config file not found', () => {
    it('throws ConfigNotFoundError when config path does not exist', async () => {
      await expect(
        loadProject({
          configPath: '/nonexistent/path/rill-config.json',

          rillVersion: '1.0.0',
        })
      ).rejects.toThrow(ConfigNotFoundError);
    });

    it('never calls process.exit', async () => {
      const exitSpy = vi.spyOn(process, 'exit');
      await loadProject({
        configPath: '/nonexistent/path/rill-config.json',
        rillVersion: '1.0.0',
      }).catch(() => undefined);
      expect(exitSpy).not.toHaveBeenCalled();
      exitSpy.mockRestore();
    });
  });

  describe('varProvider option', () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('T1: resolves a supplied provider value when the env var is unset', async () => {
      await withTempDir(async (dir) => {
        const configPath = writeConfig(dir, CONFIG_WITH_VARS);
        const result = await loadProject({
          configPath,
          rillVersion: '1.0.0',
          varProvider: literalProvider({ X: 'from-provider' }),
        });
        expect(result.config.context?.values['apiKey']).toBe('from-provider');
      });
    });

    it('T2: a supplied provider value displaces an env value of the same name', async () => {
      vi.stubEnv('X', 'from-env');
      await withTempDir(async (dir) => {
        const configPath = writeConfig(dir, CONFIG_WITH_VARS);
        const result = await loadProject({
          configPath,
          rillVersion: '1.0.0',
          varProvider: literalProvider({ X: 'from-provider' }),
        });
        expect(result.config.context?.values['apiKey']).toBe('from-provider');
      });
    });

    it('T3: a supplied provider that omits a name does not fall back to env', async () => {
      vi.stubEnv('X', 'from-env');
      await withTempDir(async (dir) => {
        const configPath = writeConfig(dir, CONFIG_WITH_VARS);
        const promise = loadProject({
          configPath,
          rillVersion: '1.0.0',
          varProvider: literalProvider({}),
        });
        await expect(promise).rejects.toBeInstanceOf(ConfigEnvError);
        await expect(promise).rejects.toThrow(/X/);
      });
    });

    it('T4: omitting the option falls back to process.env, matching prior behavior', async () => {
      vi.stubEnv('X', 'from-env');
      await withTempDir(async (dir) => {
        const configPath = writeConfig(dir, CONFIG_WITH_VARS);
        const result = await loadProject({
          configPath,
          rillVersion: '1.0.0',
        });
        expect(result.config.context?.values['apiKey']).toBe('from-env');
      });
    });

    it('T5: a provider throw propagates as VariableProviderError before extension loading runs', async () => {
      await withTempDir(async (dir) => {
        const config = JSON.stringify({
          name: 'vars-and-mounts-project',
          version: '1.0.0',
          context: {
            schema: {
              apiKey: { type: 'string' },
            },
            values: {
              apiKey: '${X}',
            },
          },
          extensions: {
            mounts: {
              bogus: 'not-a-real-specifier-and-never-resolves',
            },
          },
        });
        const configPath = writeConfig(dir, config);
        const throwingProvider = {
          provide(): Promise<Record<string, string>> {
            return Promise.reject(
              new VariableProviderError(
                'provider failed',
                'throwing',
                undefined
              )
            );
          },
        };
        const loadExtensionsSpy = vi.spyOn(loaderModule, 'loadExtensions');
        try {
          const promise = loadProject({
            configPath,
            rillVersion: '1.0.0',
            varProvider: throwingProvider,
          });
          await expect(promise).rejects.toBeInstanceOf(VariableProviderError);
          await expect(promise).rejects.toBeInstanceOf(ConfigError);
          expect(loadExtensionsSpy).not.toHaveBeenCalled();
        } finally {
          loadExtensionsSpy.mockRestore();
        }
      });
    });

    it('T6: a supplied provider that returns null throws VariableProviderError', async () => {
      await withTempDir(async (dir) => {
        const configPath = writeConfig(dir, CONFIG_WITH_VARS);
        const nullProvider = {
          provide(): Promise<Record<string, string>> {
            return Promise.resolve(null as unknown as Record<string, string>);
          },
        };
        const promise = loadProject({
          configPath,
          rillVersion: '1.0.0',
          varProvider: nullProvider,
        });
        await expect(promise).rejects.toBeInstanceOf(VariableProviderError);
        await expect(promise).rejects.toBeInstanceOf(ConfigError);
      });
    });

    it('T7: a supplied provider that returns a non-string value throws VariableProviderError', async () => {
      await withTempDir(async (dir) => {
        const configPath = writeConfig(dir, CONFIG_WITH_VARS);
        const badProvider = {
          provide(): Promise<Record<string, string>> {
            return Promise.resolve({
              X: 42,
            } as unknown as Record<string, string>);
          },
        };
        const promise = loadProject({
          configPath,
          rillVersion: '1.0.0',
          varProvider: badProvider,
        });
        await expect(promise).rejects.toBeInstanceOf(VariableProviderError);
        await expect(promise).rejects.toBeInstanceOf(ConfigError);
      });
    });

    it('T8: loadProject forwards its abort signal into the varProvider call', async () => {
      await withTempDir(async (dir) => {
        const configPath = writeConfig(dir, CONFIG_WITH_VARS);
        const controller = new AbortController();
        let receivedSignal: AbortSignal | undefined;
        const observingProvider = {
          provide(
            _names: string[],
            options?: { signal?: AbortSignal }
          ): Promise<Record<string, string>> {
            receivedSignal = options?.signal;
            return Promise.resolve({ X: 'value' });
          },
        };
        await loadProject({
          configPath,
          rillVersion: '1.0.0',
          varProvider: observingProvider,
          signal: controller.signal,
        });
        expect(receivedSignal).toBe(controller.signal);
      });
    });

    it('T9: an aborted signal is observable by the varProvider before it hangs', async () => {
      await withTempDir(async (dir) => {
        const configPath = writeConfig(dir, CONFIG_WITH_VARS);
        const controller = new AbortController();
        controller.abort();
        const abortAwareProvider = {
          provide(
            _names: string[],
            options?: { signal?: AbortSignal }
          ): Promise<Record<string, string>> {
            if (options?.signal?.aborted) {
              return Promise.reject(
                new VariableProviderError(
                  'aborted',
                  'abort-aware-provider',
                  undefined
                )
              );
            }
            return Promise.resolve({ X: 'value' });
          },
        };
        const promise = loadProject({
          configPath,
          rillVersion: '1.0.0',
          varProvider: abortAwareProvider,
          signal: controller.signal,
        });
        await expect(promise).rejects.toBeInstanceOf(VariableProviderError);
      });
    });
  });
});
