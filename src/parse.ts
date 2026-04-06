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

  return obj as unknown as RillConfigFile;
}
