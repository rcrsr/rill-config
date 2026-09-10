/**
 * Tests for buildResolvers
 *
 * Covers: HP-1, HP-2, HP-3, HP-4, HP-5, HP-6, EC-1, EC-2, EC-3, EC-4, EC-5,
 * BC-1, BC-2, #32
 */

import { buildResolvers, ResolverError } from '@rcrsr/rill-config';
import {
  isApplicationCallable,
  structureToTypeValue,
  toCallable,
} from '@rcrsr/rill';
import type { ApplicationCallable, RillValue } from '@rcrsr/rill';
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { withTempDir } from './helpers/temp-dir.js';

// ============================================================
// buildResolvers
// ============================================================

describe('buildResolvers', () => {
  const emptyTree: Record<string, RillValue> = {};

  function makeOptions(
    overrides: Partial<Parameters<typeof buildResolvers>[0]> = {}
  ): Parameters<typeof buildResolvers>[0] {
    return {
      extTree: emptyTree,
      contextValues: {},
      modulesConfig: {},
      configDir: '/tmp',
      ...overrides,
    };
  }

  describe('resolver keys', () => {
    it('returns resolvers with ext, context, and module keys', () => {
      const result = buildResolvers(makeOptions());
      expect(result.resolvers).toHaveProperty('ext');
      expect(result.resolvers).toHaveProperty('context');
      expect(result.resolvers).toHaveProperty('module');
    });

    it('returns configurations with resolvers key', () => {
      const result = buildResolvers(makeOptions());
      expect(result.configurations).toHaveProperty('resolvers');
    });
  });

  describe('module folder aliasing', () => {
    it('resolves dot-path to file within aliased directory', async () => {
      await withTempDir(async (dir) => {
        fs.writeFileSync(path.join(dir, 'ext.rill'), '"extension bindings"');
        const result = buildResolvers(
          makeOptions({ modulesConfig: { bindings: dir }, configDir: '/tmp' })
        );
        const moduleResolver = result.resolvers['module'];
        const resolution = await moduleResolver!('bindings.ext');
        expect(resolution).toEqual(
          expect.objectContaining({
            kind: 'source',
            text: '"extension bindings"',
          })
        );
      });
    });

    it('resolves nested dot-path to nested file path', async () => {
      await withTempDir(async (dir) => {
        fs.mkdirSync(path.join(dir, 'sub'));
        fs.writeFileSync(path.join(dir, 'sub', 'deep.rill'), '"deep value"');
        const result = buildResolvers(
          makeOptions({ modulesConfig: { lib: dir }, configDir: '/tmp' })
        );
        const moduleResolver = result.resolvers['module'];
        const resolution = await moduleResolver!('lib.sub.deep');
        expect(resolution).toEqual(
          expect.objectContaining({ kind: 'source', text: '"deep value"' })
        );
      });
    });

    it('resolves a well-formed multi-segment dot-path to the expected file path', async () => {
      await withTempDir(async (dir) => {
        fs.mkdirSync(path.join(dir, 'etc'), { recursive: true });
        fs.writeFileSync(
          path.join(dir, 'etc', 'passwd.rill'),
          '"safe passwd module"'
        );
        const result = buildResolvers(
          makeOptions({ modulesConfig: { lib: dir }, configDir: '/tmp' })
        );
        const moduleResolver = result.resolvers['module'];
        const resolution = await moduleResolver!('lib.etc.passwd');
        expect(resolution).toEqual(
          expect.objectContaining({
            kind: 'source',
            text: '"safe passwd module"',
          })
        );
      });
    });

    it('resolves bare alias to index.rill', async () => {
      await withTempDir(async (dir) => {
        fs.writeFileSync(path.join(dir, 'index.rill'), '"index content"');
        const result = buildResolvers(
          makeOptions({ modulesConfig: { utils: dir }, configDir: '/tmp' })
        );
        const moduleResolver = result.resolvers['module'];
        const resolution = await moduleResolver!('utils');
        expect(resolution).toEqual(
          expect.objectContaining({ kind: 'source', text: '"index content"' })
        );
      });
    });

    it('throws ResolverError for a dot-path with an empty segment', async () => {
      await withTempDir((dir) => {
        const result = buildResolvers(
          makeOptions({ modulesConfig: { lib: dir }, configDir: '/tmp' })
        );
        const moduleResolver = result.resolvers['module'];
        expect(() => moduleResolver!('lib..etc.passwd')).toThrow(ResolverError);
        expect(() => moduleResolver!('lib..etc.passwd')).toThrow(
          /lib\.\.etc\.passwd/
        );
      });
    });

    it('throws ResolverError for a trailing-dot resource', async () => {
      await withTempDir((dir) => {
        const result = buildResolvers(
          makeOptions({ modulesConfig: { lib: dir }, configDir: '/tmp' })
        );
        const moduleResolver = result.resolvers['module'];
        expect(() => moduleResolver!('lib.')).toThrow(ResolverError);
        expect(() => moduleResolver!('lib.')).toThrow(/lib\./);
      });
    });

    it('throws ResolverError for a segment containing an absolute path', async () => {
      await withTempDir((dir) => {
        const result = buildResolvers(
          makeOptions({ modulesConfig: { lib: dir }, configDir: '/tmp' })
        );
        const moduleResolver = result.resolvers['module'];
        expect(() => moduleResolver!('lib./etc/passwd')).toThrow(ResolverError);
        expect(() => moduleResolver!('lib./etc/passwd')).toThrow(
          /escapes module directory/
        );
      });
    });

    it('throws ResolverError for a ..-based traversal segment', async () => {
      await withTempDir((dir) => {
        const result = buildResolvers(
          makeOptions({ modulesConfig: { lib: dir }, configDir: '/tmp' })
        );
        const moduleResolver = result.resolvers['module'];
        // A literal ".." can never survive as a segment: splitting on "."
        // always yields an empty segment wherever ".." appears, so the
        // pre-existing empty-segment guard rejects this before the
        // containment check ever runs. Both defenses agree: reject.
        const resource = 'lib.sub/../../../etc/passwd';
        expect(() => moduleResolver!(resource)).toThrow(ResolverError);
      });
    });

    it('resolves a legitimate nested dot-path within the module directory', async () => {
      await withTempDir(async (dir) => {
        fs.mkdirSync(path.join(dir, 'sub'));
        fs.writeFileSync(path.join(dir, 'sub', 'mod.rill'), '"nested module"');
        const result = buildResolvers(
          makeOptions({ modulesConfig: { lib: dir }, configDir: '/tmp' })
        );
        const moduleResolver = result.resolvers['module'];
        const resolution = await moduleResolver!('lib.sub.mod');
        expect(resolution).toEqual(
          expect.objectContaining({ kind: 'source', text: '"nested module"' })
        );
      });
    });

    it('throws RILL-R050 for unknown module alias', async () => {
      const result = buildResolvers(makeOptions());
      const moduleResolver = result.resolvers['module'];
      await expect(moduleResolver!('unknown')).rejects.toThrow(
        /not found in resolver config/
      );
    });

    it('resolves module paths relative to configDir', async () => {
      await withTempDir(async (dir) => {
        const subDir = path.join(dir, 'modules');
        fs.mkdirSync(subDir);
        fs.writeFileSync(path.join(subDir, 'index.rill'), '"from modules"');
        const result = buildResolvers(
          makeOptions({ modulesConfig: { lib: './modules' }, configDir: dir })
        );
        const moduleResolver = result.resolvers['module'];
        const resolution = await moduleResolver!('lib');
        expect(resolution).toEqual(
          expect.objectContaining({ kind: 'source', text: '"from modules"' })
        );
      });
    });

    it('does not reserve ext or context as module names', async () => {
      await withTempDir(async (dir) => {
        fs.writeFileSync(path.join(dir, 'index.rill'), '"ext folder"');
        const result = buildResolvers(
          makeOptions({ modulesConfig: { ext: dir }, configDir: '/tmp' })
        );
        const moduleResolver = result.resolvers['module'];
        const resolution = await moduleResolver!('ext');
        expect(resolution).toEqual(
          expect.objectContaining({ kind: 'source', text: '"ext folder"' })
        );
      });
    });
  });

  describe('prototype-name aliases do not shadow the lookup', () => {
    it('does not resolve "constructor" as a directory when unconfigured', async () => {
      const result = buildResolvers(
        makeOptions({ modulesConfig: { lib: '/tmp' } })
      );
      const moduleResolver = result.resolvers['module'];
      await expect(moduleResolver!('constructor')).rejects.toThrow(
        /not found in resolver config/
      );
    });

    it('does not resolve "toString.sub" as a directory when unconfigured', async () => {
      const result = buildResolvers(
        makeOptions({ modulesConfig: { lib: '/tmp' } })
      );
      const moduleResolver = result.resolvers['module'];
      await expect(moduleResolver!('toString.sub')).rejects.toThrow(
        /not found in resolver config/
      );
    });

    it('still resolves a configured alias to a nested file (control)', async () => {
      await withTempDir(async (dir) => {
        fs.mkdirSync(path.join(dir, 'sub'));
        fs.writeFileSync(path.join(dir, 'sub', 'path.rill'), '"control value"');
        const result = buildResolvers(
          makeOptions({ modulesConfig: { constructor: dir } })
        );
        const moduleResolver = result.resolvers['module'];
        const resolution = await moduleResolver!('constructor.sub.path');
        expect(resolution).toEqual(
          expect.objectContaining({ kind: 'source', text: '"control value"' })
        );
      });
    });
  });

  describe('configurations.resolvers content', () => {
    it('configurations.resolvers.ext reflects the ext tree as rillvalues', () => {
      const result = buildResolvers(makeOptions());
      const resolverConfigs = result.configurations.resolvers;
      expect(resolverConfigs).toHaveProperty('ext');
      expect(resolverConfigs).toHaveProperty('context');
    });

    it('passes contextValues into configurations.resolvers.context', () => {
      const contextValues = { userId: 'abc123', count: 42 };
      const result = buildResolvers(makeOptions({ contextValues }));
      expect(result.configurations.resolvers['context']).toEqual(contextValues);
    });
  });

  describe('extTree passthrough preserves returnType and description', () => {
    it('ApplicationCallable in extTree carries returnType through to configurations', () => {
      const tree: Record<string, RillValue> = {
        tools: {
          greet: toCallable({
            fn: async () => 'hello',
            params: [
              {
                name: 'name',
                type: { kind: 'string' },
                defaultValue: undefined,
                annotations: {},
              },
            ],
            returnType: structureToTypeValue({ kind: 'string' }),
            annotations: { description: 'Greets by name' },
          }),
        },
      };
      const result = buildResolvers(makeOptions({ extTree: tree }));
      const extConfig = result.configurations.resolvers['ext'] as Record<
        string,
        RillValue
      >;
      const toolsDict = extConfig['tools'] as Record<string, RillValue>;
      const greetCallable = toolsDict['greet']!;

      expect(isApplicationCallable(greetCallable)).toBe(true);
      const ac = greetCallable as unknown as ApplicationCallable;
      expect(ac.returnType).toBeDefined();
      expect(ac.annotations['description']).toBe('Greets by name');
    });
  });
});
