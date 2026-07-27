// ============================================================
// VARIABLE PROVIDER INTERFACE
// ============================================================

export interface VariableProvider {
  provide(
    names: string[],
    options?: { signal?: AbortSignal }
  ): Promise<Record<string, string>>;
}

// ============================================================
// ENV PROVIDER
// ============================================================

/**
 * Returns a provider that reads variable values from `process.env`.
 * Names absent from the environment are omitted (partial-match contract).
 * Reads `process.env` at provide time, not at construction time.
 */
export function envProvider(): VariableProvider {
  return {
    async provide(names: string[]): Promise<Record<string, string>> {
      const result: Record<string, string> = Object.create(null) as Record<
        string,
        string
      >;
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
// LITERAL PROVIDER
// ============================================================

/**
 * Returns a provider that looks up names in a caller-supplied map.
 * The `values` map is held by reference; later mutations are visible to the provider.
 * Names absent from the map are omitted (partial-match contract).
 */
export function literalProvider(
  values: Record<string, string>
): VariableProvider {
  return {
    async provide(names: string[]): Promise<Record<string, string>> {
      const result: Record<string, string> = Object.create(null) as Record<
        string,
        string
      >;
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
// CHAIN PROVIDERS
// ============================================================

/**
 * Returns a provider that tries each provider in order.
 * Each provider handles the names it can; unresolved names pass to the next.
 * Any error a provider throws halts the chain immediately and propagates
 * unwrapped, regardless of the error's type.
 * Unresolved names after all providers are exhausted are omitted (no error).
 * An empty provider list returns an empty map for any input.
 */
export function chainProviders(
  providers: VariableProvider[]
): VariableProvider {
  return {
    async provide(
      names: string[],
      options?: { signal?: AbortSignal }
    ): Promise<Record<string, string>> {
      const result: Record<string, string> = Object.create(null) as Record<
        string,
        string
      >;
      let remaining = names;

      for (const provider of providers) {
        if (remaining.length === 0) break;

        // Any error thrown here propagates immediately without catch.
        const resolved = await provider.provide(remaining, options);

        for (const [name, value] of Object.entries(resolved)) {
          result[name] = value;
        }

        remaining = remaining.filter((name) => !Object.hasOwn(resolved, name));
      }

      return result;
    },
  };
}
