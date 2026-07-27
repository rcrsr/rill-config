/**
 * Tests for envProvider, literalProvider, and chainProviders.
 * Covers: IR-4, IR-5, IR-6, IR-7, EC-2, EC-3
 * (AC-10, AC-11, AC-12, AC-23, AC-24, AC-29, AC-30, AC-31, AC-32)
 */

import type { VariableProvider } from '@rcrsr/rill-config';
import {
  chainProviders,
  ConfigError,
  envProvider,
  literalProvider,
  VariableProviderError,
} from '@rcrsr/rill-config';
import { afterEach, describe, expect, it, vi } from 'vitest';

// ============================================================
// envProvider
// ============================================================

describe('envProvider', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('AC-10: reads matching process.env values', () => {
    it('returns values for names present in process.env', async () => {
      vi.stubEnv('APP_TOKEN', 'abc123');
      vi.stubEnv('DB_HOST', 'localhost');

      const provider = envProvider();
      const result = await provider.provide(['APP_TOKEN', 'DB_HOST']);

      expect(result['APP_TOKEN']).toBe('abc123');
      expect(result['DB_HOST']).toBe('localhost');
    });

    it('reads process.env at provide time, not at construction time', async () => {
      const provider = envProvider();

      vi.stubEnv('LATE_VAR', 'set-after-construct');

      const result = await provider.provide(['LATE_VAR']);

      expect(result['LATE_VAR']).toBe('set-after-construct');
    });
  });

  describe('AC-29: empty name list returns empty map', () => {
    it('returns an empty map when given an empty name list', async () => {
      const provider = envProvider();
      const result = await provider.provide([]);

      expect(result).toEqual({});
    });
  });

  describe('AC-31: env provider with no matches returns empty map', () => {
    it('omits names not present in process.env', async () => {
      const provider = envProvider();
      const result = await provider.provide(['DEFINITELY_NOT_SET_VAR_XYZ_123']);

      expect(result).toEqual({});
    });

    it('returns only matched names when some are absent', async () => {
      vi.stubEnv('PRESENT_VAR', 'yes');

      const provider = envProvider();
      const result = await provider.provide(['PRESENT_VAR', 'ABSENT_VAR']);

      expect(result).toEqual({ PRESENT_VAR: 'yes' });
    });
  });
});

// ============================================================
// literalProvider
// ============================================================

describe('literalProvider', () => {
  describe('AC-11: reads matching static map values', () => {
    it('returns values for names present in the static map', async () => {
      const provider = literalProvider({ FOO: 'bar', BAZ: 'qux' });
      const result = await provider.provide(['FOO', 'BAZ']);

      expect(result['FOO']).toBe('bar');
      expect(result['BAZ']).toBe('qux');
    });

    it('reflects mutations to the original values map', async () => {
      const values: Record<string, string> = { KEY: 'original' };
      const provider = literalProvider(values);

      values['KEY'] = 'mutated';

      const result = await provider.provide(['KEY']);

      expect(result['KEY']).toBe('mutated');
    });
  });

  describe('AC-29: empty name list returns empty map', () => {
    it('returns an empty map when given an empty name list', async () => {
      const provider = literalProvider({ FOO: 'bar' });
      const result = await provider.provide([]);

      expect(result).toEqual({});
    });
  });

  describe('AC-32: literal provider with empty map returns empty map', () => {
    it('returns an empty map when constructed with an empty values map', async () => {
      const provider = literalProvider({});
      const result = await provider.provide(['ANY_NAME']);

      expect(result).toEqual({});
    });

    it('returns an empty map for empty name list and empty values map', async () => {
      const provider = literalProvider({});
      const result = await provider.provide([]);

      expect(result).toEqual({});
    });
  });
});

// ============================================================
// chainProviders
// ============================================================

describe('chainProviders', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('AC-12: composes env and literal providers', () => {
    it('resolves names from env provider first, then literal provider', async () => {
      vi.stubEnv('ENV_VAR', 'from-env');

      const chain = chainProviders([
        envProvider(),
        literalProvider({ LITERAL_VAR: 'from-literal' }),
      ]);

      const result = await chain.provide(['ENV_VAR', 'LITERAL_VAR']);

      expect(result['ENV_VAR']).toBe('from-env');
      expect(result['LITERAL_VAR']).toBe('from-literal');
    });

    it('passes unresolved names to subsequent providers', async () => {
      const first = literalProvider({ A: 'alpha' });
      const second = literalProvider({ B: 'beta' });

      const chain = chainProviders([first, second]);
      const result = await chain.provide(['A', 'B']);

      expect(result['A']).toBe('alpha');
      expect(result['B']).toBe('beta');
    });

    it('first provider wins when both providers have the same name', async () => {
      const first = literalProvider({ X: 'first' });
      const second = literalProvider({ X: 'second' });

      const chain = chainProviders([first, second]);
      const result = await chain.provide(['X']);

      expect(result['X']).toBe('first');
    });
  });

  describe('AC-30: chain with zero providers returns empty map', () => {
    it('returns an empty map for any names when provider list is empty', async () => {
      const chain = chainProviders([]);
      const result = await chain.provide(['ANY']);

      expect(result).toEqual({});
    });

    it('returns an empty map for empty names when provider list is empty', async () => {
      const chain = chainProviders([]);
      const result = await chain.provide([]);

      expect(result).toEqual({});
    });
  });

  describe('AC-29: empty name list returns empty map', () => {
    it('returns an empty map when names list is empty', async () => {
      const chain = chainProviders([literalProvider({ FOO: 'bar' })]);
      const result = await chain.provide([]);

      expect(result).toEqual({});
    });
  });

  describe('AC-23: infrastructure failure produces VariableProviderError with providerName and cause [EC-2]', () => {
    it('throws VariableProviderError with providerName property', async () => {
      const cause = new Error('network timeout');
      const failing: VariableProvider = {
        async provide(_names: string[]): Promise<Record<string, string>> {
          throw new VariableProviderError(
            'Provider failed',
            'my-provider',
            cause
          );
        },
      };

      const chain = chainProviders([failing]);

      await expect(chain.provide(['VAR'])).rejects.toThrow(
        VariableProviderError
      );
    });

    it('propagated VariableProviderError carries the correct providerName', async () => {
      const cause = new Error('connection refused');
      const failing: VariableProvider = {
        async provide(_names: string[]): Promise<Record<string, string>> {
          throw new VariableProviderError(
            'Provider failed',
            'vault-provider',
            cause
          );
        },
      };

      const chain = chainProviders([failing]);

      const error = await chain
        .provide(['VAR'])
        .catch((e: unknown) => e as VariableProviderError);

      expect(error.providerName).toBe('vault-provider');
    });

    it('propagated VariableProviderError carries the original cause', async () => {
      const cause = new Error('upstream error');
      const failing: VariableProvider = {
        async provide(_names: string[]): Promise<Record<string, string>> {
          throw new VariableProviderError(
            'Provider failed',
            'infra-provider',
            cause
          );
        },
      };

      const chain = chainProviders([failing]);

      const error = await chain
        .provide(['VAR'])
        .catch((e: unknown) => e as VariableProviderError);

      expect(error.cause).toBe(cause);
    });
  });

  describe('AC-24: chain halts on first VariableProviderError, second provider not called [EC-3]', () => {
    it('does not call the second provider when the first throws VariableProviderError', async () => {
      let secondCalled = false;

      const cause = new Error('failure');
      const failing: VariableProvider = {
        async provide(_names: string[]): Promise<Record<string, string>> {
          throw new VariableProviderError(
            'First failed',
            'first-provider',
            cause
          );
        },
      };

      const second: VariableProvider = {
        async provide(_names: string[]): Promise<Record<string, string>> {
          secondCalled = true;
          return { VAR: 'from-second' };
        },
      };

      const chain = chainProviders([failing, second]);

      await expect(chain.provide(['VAR'])).rejects.toThrow(
        VariableProviderError
      );
      expect(secondCalled).toBe(false);
    });

    it('propagates the VariableProviderError from the first provider unchanged', async () => {
      const cause = new Error('infra down');
      const expected = new VariableProviderError(
        'First failed',
        'first-provider',
        cause
      );

      const failing: VariableProvider = {
        async provide(_names: string[]): Promise<Record<string, string>> {
          throw expected;
        },
      };

      const second = literalProvider({ VAR: 'fallback' });
      const chain = chainProviders([failing, second]);

      const actual = await chain
        .provide(['VAR'])
        .catch((e: unknown) => e as VariableProviderError);

      expect(actual).toBe(expected);
    });

    it('surfaces the halt error as a ConfigError with the VARIABLE_PROVIDER code for host dispatch', async () => {
      const cause = new Error('infra down');
      const failing: VariableProvider = {
        async provide(_names: string[]): Promise<Record<string, string>> {
          throw new VariableProviderError(
            'Provider failed',
            'first-provider',
            cause
          );
        },
      };

      const chain = chainProviders([failing]);

      const error = await chain
        .provide(['VAR'])
        .catch((e: unknown) => e as VariableProviderError);

      expect(error).toBeInstanceOf(ConfigError);
      expect(error.code).toBe('VARIABLE_PROVIDER');
    });
  });

  describe('prototype pollution resistance', () => {
    it('does not let a provider-supplied __proto__ own key poison the merged accumulator', async () => {
      // Reproduces the reviewer's PoC: JSON.parse of untrusted upstream
      // output produces a real own "__proto__" key. Object.entries
      // enumerates it, so a naive `result[name] = value` assignment on a
      // plain-object accumulator sets the accumulator's actual prototype.
      const malicious = JSON.parse(
        '{"__proto__": {"API_ENDPOINT": "https://attacker.example"}}'
      ) as Record<string, string>;
      const provider: VariableProvider = {
        async provide(): Promise<Record<string, string>> {
          return malicious;
        },
      };

      const chain = chainProviders([provider]);
      const result = await chain.provide(['API_ENDPOINT']);

      expect(Object.hasOwn(result, 'API_ENDPOINT')).toBe(false);
      expect(Object.getPrototypeOf(result)).toBe(null);
    });
  });
});
