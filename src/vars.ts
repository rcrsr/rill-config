import type { RillConfigFile } from './types.js';
import { ConfigEnvError } from './errors.js';

// ============================================================
// VARIABLE PATTERNS
// ============================================================

const ENV_VAR_PATTERN = /\$\{([A-Z_][A-Z0-9_]*)\}/g;
const SESSION_VAR_PATTERN = /@\{([A-Z_][A-Z0-9_]*)\}/g;

// ============================================================
// DATA MODEL
// ============================================================

export interface ConfigVariables {
  global: string[]; // Names from ${VAR} patterns
  session: string[]; // Names from @{VAR} patterns
}

// ============================================================
// INTERNAL HELPERS
// ============================================================

function collectFromString(
  value: string,
  global: Set<string>,
  session: Set<string>
): void {
  let match: RegExpExecArray | null;

  ENV_VAR_PATTERN.lastIndex = 0;
  while ((match = ENV_VAR_PATTERN.exec(value)) !== null) {
    const name = match[1];
    if (name !== undefined) global.add(name);
  }

  SESSION_VAR_PATTERN.lastIndex = 0;
  while ((match = SESSION_VAR_PATTERN.exec(value)) !== null) {
    const name = match[1];
    if (name !== undefined) session.add(name);
  }
}

function collectFromValue(
  value: unknown,
  global: Set<string>,
  session: Set<string>
): void {
  if (typeof value === 'string') {
    collectFromString(value, global, session);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectFromValue(item, global, session);
    }
    return;
  }
  if (typeof value === 'object' && value !== null) {
    for (const key of Object.keys(value)) {
      collectFromValue(
        (value as Record<string, unknown>)[key],
        global,
        session
      );
    }
  }
}

function collectSessionFromString(value: string, session: Set<string>): void {
  SESSION_VAR_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SESSION_VAR_PATTERN.exec(value)) !== null) {
    const name = match[1];
    if (name !== undefined) session.add(name);
  }
}

function collectSessionFromValue(value: unknown, session: Set<string>): void {
  if (typeof value === 'string') {
    collectSessionFromString(value, session);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectSessionFromValue(item, session);
    }
    return;
  }
  if (typeof value === 'object' && value !== null) {
    for (const key of Object.keys(value)) {
      collectSessionFromValue((value as Record<string, unknown>)[key], session);
    }
  }
}

function substituteString(
  value: string,
  vars: Record<string, string>,
  missing: Set<string>,
  replaceEnv: boolean,
  replaceSession: boolean
): string {
  let result = value;

  if (replaceEnv) {
    ENV_VAR_PATTERN.lastIndex = 0;
    result = result.replace(ENV_VAR_PATTERN, (_match, name: string) => {
      if (name in vars) {
        return vars[name] as string;
      }
      missing.add(name);
      return _match;
    });
  }

  if (replaceSession) {
    SESSION_VAR_PATTERN.lastIndex = 0;
    result = result.replace(SESSION_VAR_PATTERN, (_match, name: string) => {
      if (name in vars) {
        return vars[name] as string;
      }
      missing.add(name);
      return _match;
    });
  }

  return result;
}

function substituteValue(
  value: unknown,
  vars: Record<string, string>,
  missing: Set<string>,
  replaceEnv: boolean,
  replaceSession: boolean
): unknown {
  if (typeof value === 'string') {
    return substituteString(value, vars, missing, replaceEnv, replaceSession);
  }
  if (Array.isArray(value)) {
    return value.map((item) =>
      substituteValue(item, vars, missing, replaceEnv, replaceSession)
    );
  }
  if (typeof value === 'object' && value !== null) {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      result[key] = substituteValue(
        (value as Record<string, unknown>)[key],
        vars,
        missing,
        replaceEnv,
        replaceSession
      );
    }
    return result;
  }
  return value;
}

// ============================================================
// PUBLIC API
// ============================================================

export function extractVariables(config: RillConfigFile): ConfigVariables {
  const global = new Set<string>();
  const session = new Set<string>();
  collectFromValue(config, global, session);
  return {
    global: [...global].sort(),
    session: [...session].sort(),
  };
}

export function validateVarScope(config: RillConfigFile): string[] {
  const violations: string[] = [];

  function checkValue(value: unknown, path: string): void {
    if (typeof value === 'string') {
      SESSION_VAR_PATTERN.lastIndex = 0;
      if (SESSION_VAR_PATTERN.test(value)) {
        violations.push(path);
      }
      return;
    }
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        checkValue(value[i], `${path}[${i}]`);
      }
      return;
    }
    if (typeof value === 'object' && value !== null) {
      for (const key of Object.keys(value)) {
        checkValue((value as Record<string, unknown>)[key], `${path}.${key}`);
      }
    }
  }

  // Walk top-level keys and check session vars outside permitted paths
  for (const topKey of Object.keys(config)) {
    const topValue = (config as Record<string, unknown>)[topKey];
    if (topKey === 'extensions') {
      // Walk extensions sub-keys; only extensions.config.* is permitted
      if (typeof topValue === 'object' && topValue !== null) {
        for (const extKey of Object.keys(topValue)) {
          const extValue = (topValue as Record<string, unknown>)[extKey];
          if (extKey === 'config') {
            // extensions.config.* is permitted - skip session var check
            continue;
          }
          // extensions.mounts.* and anything else is not permitted
          checkValue(extValue, `extensions.${extKey}`);
        }
      }
    } else if (topKey === 'context') {
      // Walk context sub-keys; only context.values.* is permitted
      if (typeof topValue === 'object' && topValue !== null) {
        for (const ctxKey of Object.keys(topValue)) {
          const ctxValue = (topValue as Record<string, unknown>)[ctxKey];
          if (ctxKey === 'values') {
            // context.values.* is permitted - skip session var check
            continue;
          }
          // context.schema.* and anything else is not permitted
          checkValue(ctxValue, `context.${ctxKey}`);
        }
      }
    } else {
      checkValue(topValue, topKey);
    }
  }

  // Deduplicate and sort violations
  return [...new Set(violations)].sort();
}

export function interpolate(
  config: RillConfigFile,
  vars: Record<string, string>
): RillConfigFile {
  const missing = new Set<string>();
  const result = substituteValue(config, vars, missing, true, true);

  if (missing.size > 0) {
    const names = [...missing].sort().join(', ');
    throw new ConfigEnvError(`Missing environment variables: ${names}`);
  }

  return result as RillConfigFile;
}

export function hasSessionVars(config: RillConfigFile): boolean {
  const session = new Set<string>();
  collectSessionFromValue(config, session);
  return session.size > 0;
}

export function extractSessionVarNames(config: RillConfigFile): string[] {
  const session = new Set<string>();
  collectSessionFromValue(config, session);
  return [...session].sort();
}

export function substituteSessionVars(
  config: RillConfigFile,
  vars: Record<string, string>
): RillConfigFile {
  const missing = new Set<string>();
  const result = substituteValue(config, vars, missing, false, true);

  if (missing.size > 0) {
    const names = [...missing].sort().join(', ');
    throw new ConfigEnvError(`Missing environment variables: ${names}`);
  }

  return result as RillConfigFile;
}
