import type { RillConfigFile } from './types.js';
import { ConfigEnvError } from './errors.js';

// ============================================================
// VARIABLE PATTERNS
// ============================================================

const ENV_VAR_PATTERN = /\$\{([A-Z_][A-Z0-9_]*)\}/g;
const SESSION_VAR_PATTERN = /@\{([A-Z_][A-Z0-9_]*)\}/g;
// Non-global probe for stateless `.test()` checks.
const SESSION_VAR_PROBE = /@\{[A-Z_][A-Z0-9_]*\}/;

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

type StringVisitor = (value: string, path: string) => void;

/**
 * Recursive descent over an arbitrary value tree, invoking `visit` for
 * every string leaf with its dot-path. Array indices use `[i]` notation.
 */
function walkStrings(value: unknown, path: string, visit: StringVisitor): void {
  if (typeof value === 'string') {
    visit(value, path);
    return;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      walkStrings(value[i], `${path}[${i}]`, visit);
    }
    return;
  }
  if (typeof value === 'object' && value !== null) {
    for (const key of Object.keys(value)) {
      const childPath = path.length === 0 ? key : `${path}.${key}`;
      walkStrings((value as Record<string, unknown>)[key], childPath, visit);
    }
  }
}

interface CollectSinks {
  global?: Set<string>;
  session?: Set<string>;
}

function collectFromString(value: string, sinks: CollectSinks): void {
  if (sinks.global !== undefined) {
    for (const match of value.matchAll(ENV_VAR_PATTERN)) {
      sinks.global.add(match[1]!);
    }
  }
  if (sinks.session !== undefined) {
    for (const match of value.matchAll(SESSION_VAR_PATTERN)) {
      sinks.session.add(match[1]!);
    }
  }
}

function collect(value: unknown, sinks: CollectSinks): void {
  walkStrings(value, '', (str) => collectFromString(str, sinks));
}

function substituteString(
  value: string,
  vars: Record<string, string>,
  missing: Set<string>,
  replaceEnv: boolean,
  replaceSession: boolean
): string {
  const replacer = (match: string, name: string): string => {
    if (name in vars) return vars[name] as string;
    missing.add(name);
    return match;
  };

  let result = value;
  if (replaceEnv) result = result.replace(ENV_VAR_PATTERN, replacer);
  if (replaceSession) result = result.replace(SESSION_VAR_PATTERN, replacer);
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
  collect(config, { global, session });
  return {
    global: [...global].sort(),
    session: [...session].sort(),
  };
}

/**
 * Top-level config dot-path subtrees under which session vars (`@{VAR}`)
 * are permitted. A string's dot-path is allowed when it sits at, or
 * underneath, one of these prefixes.
 */
const SESSION_VAR_ALLOWED_SUBTREES: readonly string[] = [
  'extensions.config',
  'context.values',
];

function isPathAllowed(path: string): boolean {
  for (const prefix of SESSION_VAR_ALLOWED_SUBTREES) {
    if (path === prefix || path.startsWith(prefix + '.')) return true;
  }
  return false;
}

export function validateVarScope(config: RillConfigFile): string[] {
  const violations = new Set<string>();

  walkStrings(config, '', (value, path) => {
    if (!SESSION_VAR_PROBE.test(value)) return;
    if (isPathAllowed(path)) return;
    violations.add(path);
  });

  return [...violations].sort();
}

export function interpolate(
  config: RillConfigFile,
  vars: Record<string, string>
): RillConfigFile {
  const missing = new Set<string>();
  const result = substituteValue(config, vars, missing, true, false);

  if (missing.size > 0) {
    const names = [...missing].sort().join(', ');
    throw new ConfigEnvError(`Missing environment variables: ${names}`);
  }

  return result as RillConfigFile;
}

export function hasSessionVars(config: RillConfigFile): boolean {
  const session = new Set<string>();
  collect(config, { session });
  return session.size > 0;
}

export function extractSessionVarNames(config: RillConfigFile): string[] {
  const session = new Set<string>();
  collect(config, { session });
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
    throw new ConfigEnvError(`Missing session variables: ${names}`);
  }

  return result as RillConfigFile;
}
