/**
 * Bindings generators for rill-config.
 * Produces rill source strings for extension and context module bindings.
 */

import {
  formatStructure,
  isApplicationCallable,
  isTuple,
  isVector,
} from '@rcrsr/rill';
import type { RillParam, RillValue } from '@rcrsr/rill';
import type { ContextFieldSchema } from './types.js';

// ============================================================
// EXTENSION BINDINGS
// ============================================================

function mapParamType(param: RillParam): string {
  if (param.type === undefined) {
    return 'any';
  }
  return formatStructure(param.type);
}

function serializeParam(param: RillParam): string {
  return `${param.name}: ${mapParamType(param)}`;
}

/**
 * Map a leaf RillValue to its `use<ext:...>` type-suffix. Returns
 * `undefined` for nested dicts (which need recursion) and any value
 * shape we don't bind.
 */
function leafTypeSuffix(child: RillValue): string | undefined {
  if (isApplicationCallable(child)) {
    const returnSuffix = ` :${formatStructure(child.returnType.structure)}`;
    const params = child.params;
    const paramStr =
      params === undefined || params.length === 0
        ? ''
        : params.map(serializeParam).join(', ');
    return `|${paramStr}|${returnSuffix}`;
  }
  if (typeof child === 'string') return 'string';
  if (typeof child === 'number') return 'number';
  if (typeof child === 'boolean') return 'bool';
  if (Array.isArray(child)) return 'list';
  if (isTuple(child)) return 'tuple';
  if (isVector(child)) return 'vector';
  return undefined;
}

function buildNestedDict(
  node: Record<string, RillValue>,
  path: string,
  indent: string
): string {
  const entries: string[] = [];
  const childIndent = indent + '  ';

  for (const [key, child] of Object.entries(node)) {
    const childPath = path.length > 0 ? `${path}.${key}` : key;

    const suffix = leafTypeSuffix(child);
    if (suffix !== undefined) {
      entries.push(`${childIndent}${key}: use<ext:${childPath}>:${suffix}`);
    } else if (typeof child === 'object' && child !== null) {
      const nested = buildNestedDict(
        child as Record<string, RillValue>,
        childPath,
        childIndent
      );
      entries.push(`${childIndent}${key}: ${nested}`);
    }
  }

  if (entries.length === 0) {
    return '[:]';
  }

  return `[\n${entries.join(',\n')}\n${indent}]`;
}

/**
 * Generate rill source for extension bindings.
 * Returns a rill dict literal suitable for use as module:ext source.
 */
export function buildExtensionBindings(
  extTree: Record<string, RillValue>,
  basePath?: string
): string {
  return buildNestedDict(extTree, basePath ?? '', '');
}

// ============================================================
// CONTEXT BINDINGS
// ============================================================

/**
 * Generate rill source for context bindings.
 * Returns a rill dict literal that declares each context key with its type.
 * Scripts import this via use<module:context>.
 * Pure function. No errors.
 */
export function buildContextBindings(
  schema: Record<string, ContextFieldSchema>,
  values: Record<string, unknown>
): string {
  const entries: string[] = [];

  for (const [key, fieldSchema] of Object.entries(schema)) {
    const value = values[key];
    const rillType = fieldSchema.type;

    let rillLiteral: string;
    if (rillType === 'string') {
      // JSON.stringify covers \, ", \n, \r, \t, \b, \f, and U+0000-U+001F.
      // Rill string literals accept JSON-compatible escapes.
      rillLiteral = JSON.stringify(String(value));
    } else if (rillType === 'number') {
      rillLiteral = String(value);
    } else {
      // bool
      rillLiteral = value ? 'true' : 'false';
    }

    entries.push(`  ${key}: ${rillLiteral}`);
  }

  if (entries.length === 0) {
    return '[:]';
  }

  return `[\n${entries.join(',\n')}\n]`;
}
