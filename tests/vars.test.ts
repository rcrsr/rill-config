/**
 * Tests for extractVariables, validateVarScope, interpolate, and session functions.
 * Covers: IR-1, IR-2, IR-3, IR-9, EC-1, EC-6
 * (AC-1..AC-9, AC-15..AC-20, AC-25..AC-28, AC-33..AC-34)
 */

import type { RillConfigFile } from '@rcrsr/rill-config';
import {
  ConfigEnvError,
  extractSessionVarNames,
  extractVariables,
  hasSessionVars,
  interpolate,
  substituteSessionVars,
  validateVarScope,
} from '@rcrsr/rill-config';
import { describe, expect, it } from 'vitest';

// ============================================================
// extractVariables
// ============================================================

describe('extractVariables', () => {
  it('AC-1: returns global name for ${A} and session name for @{B}', () => {
    const config = { name: '${A}', description: '@{B}' } as RillConfigFile;
    const result = extractVariables(config);
    expect(result.global).toEqual(['A']);
    expect(result.session).toEqual(['B']);
  });

  it('AC-2: returns empty lists for config with no patterns', () => {
    const config = { name: 'plain-value', version: '1.0.0' } as RillConfigFile;
    const result = extractVariables(config);
    expect(result.global).toEqual([]);
    expect(result.session).toEqual([]);
  });

  it('AC-3: same name X appears in both global and session', () => {
    const config = { name: '${X}', description: '@{X}' } as RillConfigFile;
    const result = extractVariables(config);
    expect(result.global).toContain('X');
    expect(result.session).toContain('X');
  });

  it('AC-27: empty config {} returns empty global and session lists', () => {
    const config = {} as RillConfigFile;
    const result = extractVariables(config);
    expect(result.global).toEqual([]);
    expect(result.session).toEqual([]);
  });

  it('AC-33: boundary names ${_} and ${A0} are matched by the regex', () => {
    const config = { name: '${_}', description: '${A0}' } as RillConfigFile;
    const result = extractVariables(config);
    expect(result.global).toContain('_');
    expect(result.global).toContain('A0');
  });

  it('deduplicates repeated variable names', () => {
    const config = {
      name: '${API} ${API}',
      description: '@{TOKEN} @{TOKEN}',
    } as RillConfigFile;
    const result = extractVariables(config);
    expect(result.global).toEqual(['API']);
    expect(result.session).toEqual(['TOKEN']);
  });

  it('sorts variable names alphabetically', () => {
    const config = { name: '${Z} ${A} ${M}' } as RillConfigFile;
    const result = extractVariables(config);
    expect(result.global).toEqual(['A', 'M', 'Z']);
  });
});

// ============================================================
// validateVarScope
// ============================================================

describe('validateVarScope', () => {
  it('AC-4: @{VAR} in extensions.config and context.values returns no violations', () => {
    const config = {
      extensions: { mounts: {}, config: { key: '@{SESSION_VAR}' } },
      context: { schema: {}, values: { field: '@{OTHER_VAR}' } },
    } as RillConfigFile;
    const violations = validateVarScope(config);
    expect(violations).toEqual([]);
  });

  it('AC-5: ${VAR} in name field produces no violations', () => {
    const config = { name: '${GLOBAL_VAR}' } as RillConfigFile;
    const violations = validateVarScope(config);
    expect(violations).toEqual([]);
  });

  it('AC-25: @{VAR} in name field returns violation path "name"', () => {
    const config = { name: '@{SESSION_VAR}' } as RillConfigFile;
    const violations = validateVarScope(config);
    expect(violations).toContain('name');
  });

  it('AC-26: @{VAR} in host returns violation path "host"', () => {
    const config = {
      host: { timeout: '@{TIMEOUT}' },
    } as unknown as RillConfigFile;
    const violations = validateVarScope(config);
    expect(violations.some((v) => v.startsWith('host'))).toBe(true);
  });

  it('AC-26: @{VAR} in main field returns violation path "main"', () => {
    const config = { main: '@{MAIN_FILE}' } as RillConfigFile;
    const violations = validateVarScope(config);
    expect(violations).toContain('main');
  });

  it('AC-26: @{VAR} in extensions.mounts returns a violation path', () => {
    const config = {
      extensions: { mounts: { ns: '@{MOUNT_PATH}' } },
    } as unknown as RillConfigFile;
    const violations = validateVarScope(config);
    expect(violations.some((v) => v.startsWith('extensions.mounts'))).toBe(
      true
    );
  });

  it('AC-26: @{VAR} in modules returns a violation path', () => {
    const config = {
      modules: { mod: '@{MOD_PATH}' },
    } as unknown as RillConfigFile;
    const violations = validateVarScope(config);
    expect(violations.some((v) => v.startsWith('modules'))).toBe(true);
  });

  it('returns empty array for empty config', () => {
    const config = {} as RillConfigFile;
    expect(validateVarScope(config)).toEqual([]);
  });
});

// ============================================================
// interpolate
// ============================================================

describe('interpolate', () => {
  it('AC-6: substitutes ${API_KEY} with provided value', () => {
    const config = { name: '${API_KEY}' } as RillConfigFile;
    const result = interpolate(config, { API_KEY: 'secret-123' });
    expect(result.name).toBe('secret-123');
  });

  it('AC-7: substitutes @{TOKEN} with provided value', () => {
    const config = { name: '@{TOKEN}' } as RillConfigFile;
    const result = interpolate(config, { TOKEN: 'bearer-abc' });
    expect(result.name).toBe('bearer-abc');
  });

  it('AC-8: returns config with original values when no placeholders present', () => {
    const config = { name: 'plain', version: '1.0.0' } as RillConfigFile;
    const result = interpolate(config, {});
    expect(result.name).toBe('plain');
    expect(result.version).toBe('1.0.0');
  });

  it('AC-9: substitutes both ${A} and @{B} in a single call', () => {
    const config = { name: '${A}', description: '@{B}' } as RillConfigFile;
    const result = interpolate(config, { A: 'alpha', B: 'beta' });
    expect(result.name).toBe('alpha');
    expect(result.description).toBe('beta');
  });

  it('AC-19 [EC-1]: throws ConfigEnvError for missing variables with sorted names', () => {
    const config = {
      name: '${Z_VAR}',
      description: '${A_VAR}',
    } as RillConfigFile;
    expect(() => interpolate(config, {})).toThrow(ConfigEnvError);
    expect(() => interpolate(config, {})).toThrow(
      'Missing environment variables: A_VAR, Z_VAR'
    );
  });

  it('AC-34: non-string values in nested objects are left untouched', () => {
    const config = {
      host: { timeout: 5000, maxCallStackDepth: 100 },
    } as RillConfigFile;
    const result = interpolate(config, {});
    expect(result.host?.timeout).toBe(5000);
    expect(result.host?.maxCallStackDepth).toBe(100);
  });
});

// ============================================================
// session functions
// ============================================================

describe('hasSessionVars', () => {
  it('AC-15: returns true for config containing @{VAR}', () => {
    const config = { name: '@{SESSION_VAR}' } as RillConfigFile;
    expect(hasSessionVars(config)).toBe(true);
  });

  it('AC-16: returns false for config with no @{VAR} patterns', () => {
    const config = {
      name: '${GLOBAL_ONLY}',
      version: '1.0.0',
    } as RillConfigFile;
    expect(hasSessionVars(config)).toBe(false);
  });

  it('returns false for empty config', () => {
    const config = {} as RillConfigFile;
    expect(hasSessionVars(config)).toBe(false);
  });
});

describe('extractSessionVarNames', () => {
  it('AC-17: returns only session names, ignores ${A}', () => {
    const config = { name: '${A}', description: '@{B}' } as RillConfigFile;
    const names = extractSessionVarNames(config);
    expect(names).toEqual(['B']);
    expect(names).not.toContain('A');
  });

  it('returns deduplicated sorted names', () => {
    const config = { name: '@{Z_VAR} @{A_VAR} @{Z_VAR}' } as RillConfigFile;
    const names = extractSessionVarNames(config);
    expect(names).toEqual(['A_VAR', 'Z_VAR']);
  });
});

describe('substituteSessionVars', () => {
  it('AC-18: replaces @{B} and leaves ${A} intact', () => {
    const config = { name: '${A}', description: '@{B}' } as RillConfigFile;
    const result = substituteSessionVars(config, { B: 'session-value' });
    expect(result.name).toBe('${A}');
    expect(result.description).toBe('session-value');
  });

  it('AC-20 [EC-6]: throws ConfigEnvError for missing session variable', () => {
    const config = { name: '@{MISSING_VAR}' } as RillConfigFile;
    expect(() => substituteSessionVars(config, {})).toThrow(ConfigEnvError);
    expect(() => substituteSessionVars(config, {})).toThrow(
      'Missing environment variables: MISSING_VAR'
    );
  });

  it('sorts missing names in the error message', () => {
    const config = { name: '@{Z_VAR} @{A_VAR}' } as RillConfigFile;
    expect(() => substituteSessionVars(config, {})).toThrow(
      'Missing environment variables: A_VAR, Z_VAR'
    );
  });
});

// ============================================================
// performance
// ============================================================

describe('performance', () => {
  it('AC-28: extracts and interpolates 50 variables in under 10ms', () => {
    const vars: Record<string, string> = {};
    const parts: string[] = [];
    for (let i = 0; i < 50; i++) {
      const name = `VAR_${String(i).padStart(3, '0')}`;
      vars[name] = `value-${i}`;
      parts.push(`\${${name}}`);
    }
    const config = { name: parts.join(' ') } as RillConfigFile;

    const start = performance.now();
    extractVariables(config);
    interpolate(config, vars);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(10);
  });
});
