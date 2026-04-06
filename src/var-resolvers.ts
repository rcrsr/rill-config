// ============================================================
// VARIABLE RESOLVER INTERFACE
// ============================================================

export interface VariableResolver {
  resolve(names: string[]): Promise<Record<string, string>>;
}

// ============================================================
// ENV RESOLVER
// ============================================================

/**
 * Returns a resolver that reads variable values from `process.env`.
 * Names absent from the environment are omitted (partial-match contract).
 * Reads `process.env` at resolve time, not at construction time.
 */
export function envResolver(): VariableResolver {
  return {
    async resolve(names: string[]): Promise<Record<string, string>> {
      const result: Record<string, string> = {};
      for (const name of names) {
        const value = process.env[name];
        if (value !== undefined) {
          result[name] = value;
        }
      }
      return result;
    },
  };
}

// ============================================================
// LITERAL RESOLVER
// ============================================================

/**
 * Returns a resolver that looks up names in a caller-supplied map.
 * The `values` map is held by reference; later mutations are visible to the resolver.
 * Names absent from the map are omitted (partial-match contract).
 */
export function literalResolver(
  values: Record<string, string>
): VariableResolver {
  return {
    async resolve(names: string[]): Promise<Record<string, string>> {
      const result: Record<string, string> = {};
      for (const name of names) {
        const value = values[name];
        if (value !== undefined) {
          result[name] = value;
        }
      }
      return result;
    },
  };
}

// ============================================================
// CHAIN RESOLVERS
// ============================================================

/**
 * Returns a resolver that tries each resolver in order.
 * Each resolver handles the names it can; unresolved names pass to the next.
 * Halts immediately on `ResolverError` from any resolver and propagates it.
 * Unresolved names after all resolvers are exhausted are omitted (no error).
 * An empty resolver list returns an empty map for any input.
 */
export function chainResolvers(
  resolvers: VariableResolver[]
): VariableResolver {
  return {
    async resolve(names: string[]): Promise<Record<string, string>> {
      const result: Record<string, string> = {};
      let remaining = names;

      for (const resolver of resolvers) {
        if (remaining.length === 0) break;

        // ResolverError propagates immediately without catch (EC-2, EC-3)
        const resolved = await resolver.resolve(remaining);

        for (const [name, value] of Object.entries(resolved)) {
          result[name] = value;
        }

        remaining = remaining.filter((name) => !(name in resolved));
      }

      return result;
    },
  };
}
