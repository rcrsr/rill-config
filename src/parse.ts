import type { RillConfigFile } from './types.js';
import { ConfigParseError, ConfigValidationError } from './errors.js';

function assertOptionalString(field: string, value: unknown): void {
  if (value !== undefined && typeof value !== 'string') {
    throw new ConfigValidationError(
      `Field ${field}: expected string, got ${typeof value}`
    );
  }
}

function assertOptionalObject(field: string, value: unknown): void {
  if (
    value !== undefined &&
    (typeof value !== 'object' || value === null || Array.isArray(value))
  ) {
    throw new ConfigValidationError(
      `Field ${field}: expected object, got ${Array.isArray(value) ? 'array' : typeof value}`
    );
  }
}

function assertOptionalNumber(field: string, value: unknown): void {
  if (value !== undefined && typeof value !== 'number') {
    throw new ConfigValidationError(
      `Field ${field}: expected number, got ${typeof value}`
    );
  }
}

function assertRequiredObject(field: string, value: unknown): void {
  if (value === undefined) {
    throw new ConfigValidationError(`Field ${field}: is required`);
  }
  assertOptionalObject(field, value);
}

function assertObjectOfStrings(field: string, value: unknown): void {
  assertRequiredObject(field, value);
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    const entry = record[key];
    if (typeof entry !== 'string') {
      throw new ConfigValidationError(
        `Field ${field}.${key}: expected string, got ${typeof entry}`
      );
    }
  }
}

function assertSchemaEntry(field: string, value: unknown): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ConfigValidationError(
      `Field ${field}: expected object, got ${Array.isArray(value) ? 'array' : typeof value}`
    );
  }
  const entry = value as Record<string, unknown>;
  const type = entry['type'];
  if (type !== 'string' && type !== 'number' && type !== 'bool') {
    throw new ConfigValidationError(
      `Field ${field}.type: expected "string" | "number" | "bool", got ${JSON.stringify(type)}`
    );
  }
}

/**
 * Parse a JSON config string into a RillConfigFile.
 *
 * Validation covers top-level field types plus the nested shapes of
 * `extensions`, `context`, `host`, and `modules`. `context.values` is
 * only checked for object shape here; its entries are checked against
 * `context.schema` downstream by `validateContext` after interpolation.
 */
export function parseConfig(raw: string): RillConfigFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    throw new ConfigParseError(`Failed to parse config: ${reason}`);
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ConfigParseError(
      `Failed to parse config: expected a JSON object`
    );
  }

  const obj = parsed as Record<string, unknown>;

  assertOptionalString('name', obj['name']);
  assertOptionalString('version', obj['version']);
  assertOptionalString('description', obj['description']);
  assertOptionalString('runtime', obj['runtime']);
  assertOptionalString('main', obj['main']);
  assertOptionalObject('extensions', obj['extensions']);
  assertOptionalObject('context', obj['context']);
  assertOptionalObject('host', obj['host']);
  assertOptionalObject('modules', obj['modules']);

  const extensions = obj['extensions'];
  if (extensions !== undefined) {
    const extensionsObj = extensions as Record<string, unknown>;
    assertObjectOfStrings('extensions.mounts', extensionsObj['mounts']);
    assertOptionalObject('extensions.config', extensionsObj['config']);
  }

  const context = obj['context'];
  if (context !== undefined) {
    const contextObj = context as Record<string, unknown>;
    assertRequiredObject('context.schema', contextObj['schema']);
    const schema = contextObj['schema'] as Record<string, unknown>;
    for (const key of Object.keys(schema)) {
      assertSchemaEntry(`context.schema.${key}`, schema[key]);
    }
    assertRequiredObject('context.values', contextObj['values']);
  }

  const modules = obj['modules'];
  if (modules !== undefined) {
    assertObjectOfStrings('modules', modules);
  }

  const host = obj['host'];
  if (host !== undefined) {
    const hostObj = host as Record<string, unknown>;
    assertOptionalNumber('host.timeout', hostObj['timeout']);
    assertOptionalNumber(
      'host.maxCallStackDepth',
      hostObj['maxCallStackDepth']
    );
    assertOptionalNumber('host.setupTimeout', hostObj['setupTimeout']);
  }

  return obj as unknown as RillConfigFile;
}
