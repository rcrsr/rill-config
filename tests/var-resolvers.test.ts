/**
 * Tests for envResolver, literalResolver, and chainResolvers.
 * Covers: IR-4, IR-5, IR-6, IR-7, EC-2, EC-3
 * (AC-10, AC-11, AC-12, AC-23, AC-24, AC-29, AC-30, AC-31, AC-32)
 */

import type { VariableResolver } from '@rcrsr/rill-config';
import {
  chainResolvers,
  envResolver,
  literalResolver,
  ResolverError,
} from '@rcrsr/rill-config';
import { afterEach, describe, expect, it, vi } from 'vitest';

// ============================================================
// envResolver
// ============================================================

describe('envResolver', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('AC-10: reads matching process.env values', () => {
    it('returns values for names present in process.env', async () => {
      vi.stubEnv('APP_TOKEN', 'abc123');
      vi.stubEnv('DB_HOST', 'localhost');

      const resolver = envResolver();
      const result = await resolver.resolve(['APP_TOKEN', 'DB_HOST']);

      expect(result['APP_TOKEN']).toBe('abc123');
      expect(result['DB_HOST']).toBe('localhost');
    });

    it('reads process.env at resolve time, not at construction time', async () => {
      const resolver = envResolver();

      vi.stubEnv('LATE_VAR', 'set-after-construct');

      const result = await resolver.resolve(['LATE_VAR']);

      expect(result['LATE_VAR']).toBe('set-after-construct');
    });
  });

  describe('AC-29: empty name list returns empty map', () => {
    it('returns an empty map when given an empty name list', async () => {
      const resolver = envResolver();
      const result = await resolver.resolve([]);

      expect(result).toEqual({});
    });
  });

  describe('AC-31: env resolver with no matches returns empty map', () => {
    it('omits names not present in process.env', async () => {
      const resolver = envResolver();
      const result = await resolver.resolve(['DEFINITELY_NOT_SET_VAR_XYZ_123']);

      expect(result).toEqual({});
    });

    it('returns only matched names when some are absent', async () => {
      vi.stubEnv('PRESENT_VAR', 'yes');

      const resolver = envResolver();
      const result = await resolver.resolve(['PRESENT_VAR', 'ABSENT_VAR']);

      expect(result).toEqual({ PRESENT_VAR: 'yes' });
    });
  });
});

// ============================================================
// literalResolver
// ============================================================

describe('literalResolver', () => {
  describe('AC-11: reads matching static map values', () => {
    it('returns values for names present in the static map', async () => {
      const resolver = literalResolver({ FOO: 'bar', BAZ: 'qux' });
      const result = await resolver.resolve(['FOO', 'BAZ']);

      expect(result['FOO']).toBe('bar');
      expect(result['BAZ']).toBe('qux');
    });

    it('reflects mutations to the original values map', async () => {
      const values: Record<string, string> = { KEY: 'original' };
      const resolver = literalResolver(values);

      values['KEY'] = 'mutated';

      const result = await resolver.resolve(['KEY']);

      expect(result['KEY']).toBe('mutated');
    });
  });

  describe('AC-29: empty name list returns empty map', () => {
    it('returns an empty map when given an empty name list', async () => {
      const resolver = literalResolver({ FOO: 'bar' });
      const result = await resolver.resolve([]);

      expect(result).toEqual({});
    });
  });

  describe('AC-32: literal resolver with empty map returns empty map', () => {
    it('returns an empty map when constructed with an empty values map', async () => {
      const resolver = literalResolver({});
      const result = await resolver.resolve(['ANY_NAME']);

      expect(result).toEqual({});
    });

    it('returns an empty map for empty name list and empty values map', async () => {
      const resolver = literalResolver({});
      const result = await resolver.resolve([]);

      expect(result).toEqual({});
    });
  });
});

// ============================================================
// chainResolvers
// ============================================================

describe('chainResolvers', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('AC-12: composes env and literal resolvers', () => {
    it('resolves names from env resolver first, then literal resolver', async () => {
      vi.stubEnv('ENV_VAR', 'from-env');

      const chain = chainResolvers([
        envResolver(),
        literalResolver({ LITERAL_VAR: 'from-literal' }),
      ]);

      const result = await chain.resolve(['ENV_VAR', 'LITERAL_VAR']);

      expect(result['ENV_VAR']).toBe('from-env');
      expect(result['LITERAL_VAR']).toBe('from-literal');
    });

    it('passes unresolved names to subsequent resolvers', async () => {
      const first = literalResolver({ A: 'alpha' });
      const second = literalResolver({ B: 'beta' });

      const chain = chainResolvers([first, second]);
      const result = await chain.resolve(['A', 'B']);

      expect(result['A']).toBe('alpha');
      expect(result['B']).toBe('beta');
    });

    it('first resolver wins when both resolvers have the same name', async () => {
      const first = literalResolver({ X: 'first' });
      const second = literalResolver({ X: 'second' });

      const chain = chainResolvers([first, second]);
      const result = await chain.resolve(['X']);

      expect(result['X']).toBe('first');
    });
  });

  describe('AC-30: chain with zero resolvers returns empty map', () => {
    it('returns an empty map for any names when resolver list is empty', async () => {
      const chain = chainResolvers([]);
      const result = await chain.resolve(['ANY']);

      expect(result).toEqual({});
    });

    it('returns an empty map for empty names when resolver list is empty', async () => {
      const chain = chainResolvers([]);
      const result = await chain.resolve([]);

      expect(result).toEqual({});
    });
  });

  describe('AC-29: empty name list returns empty map', () => {
    it('returns an empty map when names list is empty', async () => {
      const chain = chainResolvers([literalResolver({ FOO: 'bar' })]);
      const result = await chain.resolve([]);

      expect(result).toEqual({});
    });
  });

  describe('AC-23: infrastructure failure produces ResolverError with resolverName and cause [EC-2]', () => {
    it('throws ResolverError with resolverName property', async () => {
      const cause = new Error('network timeout');
      const failing: VariableResolver = {
        async resolve(_names: string[]): Promise<Record<string, string>> {
          throw new ResolverError('Resolver failed', 'my-resolver', cause);
        },
      };

      const chain = chainResolvers([failing]);

      await expect(chain.resolve(['VAR'])).rejects.toThrow(ResolverError);
    });

    it('propagated ResolverError carries the correct resolverName', async () => {
      const cause = new Error('connection refused');
      const failing: VariableResolver = {
        async resolve(_names: string[]): Promise<Record<string, string>> {
          throw new ResolverError('Resolver failed', 'vault-resolver', cause);
        },
      };

      const chain = chainResolvers([failing]);

      const error = await chain
        .resolve(['VAR'])
        .catch((e: unknown) => e as ResolverError);

      expect(error.resolverName).toBe('vault-resolver');
    });

    it('propagated ResolverError carries the original cause', async () => {
      const cause = new Error('upstream error');
      const failing: VariableResolver = {
        async resolve(_names: string[]): Promise<Record<string, string>> {
          throw new ResolverError('Resolver failed', 'infra-resolver', cause);
        },
      };

      const chain = chainResolvers([failing]);

      const error = await chain
        .resolve(['VAR'])
        .catch((e: unknown) => e as ResolverError);

      expect(error.cause).toBe(cause);
    });
  });

  describe('AC-24: chain halts on first ResolverError, second resolver not called [EC-3]', () => {
    it('does not call the second resolver when the first throws ResolverError', async () => {
      let secondCalled = false;

      const cause = new Error('failure');
      const failing: VariableResolver = {
        async resolve(_names: string[]): Promise<Record<string, string>> {
          throw new ResolverError('First failed', 'first-resolver', cause);
        },
      };

      const second: VariableResolver = {
        async resolve(_names: string[]): Promise<Record<string, string>> {
          secondCalled = true;
          return { VAR: 'from-second' };
        },
      };

      const chain = chainResolvers([failing, second]);

      await expect(chain.resolve(['VAR'])).rejects.toThrow(ResolverError);
      expect(secondCalled).toBe(false);
    });

    it('propagates the ResolverError from the first resolver unchanged', async () => {
      const cause = new Error('infra down');
      const expected = new ResolverError(
        'First failed',
        'first-resolver',
        cause
      );

      const failing: VariableResolver = {
        async resolve(_names: string[]): Promise<Record<string, string>> {
          throw expected;
        },
      };

      const second = literalResolver({ VAR: 'fallback' });
      const chain = chainResolvers([failing, second]);

      const actual = await chain
        .resolve(['VAR'])
        .catch((e: unknown) => e as ResolverError);

      expect(actual).toBe(expected);
    });
  });
});
