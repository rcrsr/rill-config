# @rcrsr/rill-config

Config resolution, validation, and project loading for [rill](https://rill.run). Parses `rill-config.json`, loads extensions, resolves mounts, and generates bindings.

> **Experimental.** Breaking changes will occur before stabilization.

## Install

```bash
npm install @rcrsr/rill-config
```

Requires `@rcrsr/rill` as a peer dependency.

## API

### Config Resolution

```typescript
import { resolveConfigPath, parseConfig } from '@rcrsr/rill-config';

const configPath = resolveConfigPath('/path/to/project');
const config = parseConfig(configPath);
```

| Export | Purpose |
|--------|---------|
| `resolveConfigPath(dir)` | Find `rill-config.json` from a directory |
| `parseConfig(path)` | Parse and interpolate env vars |

### Validation

```typescript
import { checkRuntimeVersion, validateContext } from '@rcrsr/rill-config';

checkRuntimeVersion(config, '0.12.0');
validateContext(config.context, providedValues);
```

| Export | Purpose |
|--------|---------|
| `checkRuntimeVersion(config, version)` | Verify runtime satisfies semver range |
| `validateContext(context, values)` | Validate context values against schema |
| `validateBundleRestrictions(config)` | Check bundle-time field restrictions |

### Extension Loading

```typescript
import { resolveMounts, loadExtensions } from '@rcrsr/rill-config';

const mounts = resolveMounts(config.extensions.mounts);
const loaded = await loadExtensions(
  mounts,
  config.extensions.config ?? {},
  { prefix: '/path/to/project/.rill/npm' },
);
```

**Signature:**

```typescript
loadExtensions(
  mounts: ResolvedMount[],
  config: Record<string, Record<string, unknown>>,
  options?: {
    prefix?: string;      // optional: absolute path to npm prefix directory; defaults to process.cwd()
    signal?: AbortSignal;
    extensionModules?: ReadonlyMap<string, unknown>; // optional: preloaded modules, keyed by mount path
  }
): Promise<LoadedProject>
```

**`prefix` parameter:** An absolute filesystem path to the directory acting as the npm prefix. Node resolves bare specifiers from `<prefix>/node_modules/`, and relative specifiers (`./`, `../`) resolve against `<prefix>` as well. When omitted, resolution anchors at `process.cwd()` (existing behavior). When provided, callers compute this as `path.join(projectDir, '.rill/npm')`. Absolute and `file://` specifiers are unaffected by `prefix`.

**`extensionModules` parameter:** A map of preloaded extension modules, keyed by mount name exactly as written in `extensions.mounts`. A dot-path mount uses the full dotted path (`"a.b"`), not its first segment. A mount present in the map skips `resolveSpecifier` and `import()` entirely; mounts absent from the map keep today's behavior, so this option is backward compatible. This exists because `resolveSpecifier` computes its `import()` argument fully at runtime, which no bundler can see through. A project mounting a local extension by relative path cannot compile into a single-file artifact. A static `import` statement that a host writes by hand, passed through this map, lets a bundler follow it instead. A host that preloads every mount also stops depending on `process.cwd()` for mount resolution. A key present whose value is not a non-null object throws `ExtensionLoadError`. This includes a key explicitly set to `undefined`, which is treated as an error rather than a fall-through to import. A key that matches no mount also throws `ExtensionLoadError`. Preloaded modules still undergo the same manifest presence and semver version validation as imported ones.

| Export | Purpose |
|--------|---------|
| `resolveMounts(mounts)` | Parse mount paths and package specifiers |
| `detectNamespaceCollisions(mounts)` | Find conflicting mount paths |
| `loadExtensions(mounts, config, options)` | Load and initialize extensions |

### Bindings Generation

```typescript
import { buildExtensionBindings, buildContextBindings } from '@rcrsr/rill-config';

const extBindings = buildExtensionBindings(extTree);
const ctxBindings = buildContextBindings(config.context);
```

| Export | Purpose |
|--------|---------|
| `buildExtensionBindings(extTree, basePath?)` | Generate `use:` bindings for extensions |
| `buildContextBindings(context)` | Generate `use:` bindings for context vars |

### Project Loading

```typescript
import { loadProject } from '@rcrsr/rill-config';

const project = await loadProject({
  configPath: '/path/to/project/rill-config.json',
  rillVersion: '0.19.0',
  prefix: '/path/to/project/.rill/npm',
});
// project.config, project.extTree, project.resolverConfig, ...
```

**Signature:**

```typescript
loadProject(options: {
  configPath: string;   // absolute path to rill-config.json
  rillVersion: string;  // semver version of the rill runtime
  prefix?: string;      // optional: absolute path to npm prefix directory; defaults to the config file's directory
  signal?: AbortSignal;
  varProvider?: VariableProvider; // optional: resolves `${VAR}` names during interpolation; defaults to envProvider()
  extensionModules?: ReadonlyMap<string, unknown>; // optional: preloaded modules, keyed by mount path
}): Promise<ProjectResult>
```

**`prefix` parameter:** An absolute filesystem path to the directory acting as the npm prefix. Node resolves bare specifiers from `<prefix>/node_modules/`, and relative specifiers (`./`, `../`) resolve against `<prefix>` as well. When omitted, `loadProject` defaults `prefix` to the directory containing `configPath`, matching `modules` resolution. When provided, callers compute this as `path.join(projectDir, '.rill/npm')`. Absolute and `file://` specifiers are unaffected by `prefix`.

**`varProvider` parameter:** A `VariableProvider` used to resolve `${VAR}` names during config interpolation. When supplied, it displaces `process.env` entirely; when omitted, `loadProject` defaults to `envProvider()`. It applies to `${VAR}` interpolation only; session `@{VAR}` vars pass through unaffected, since `loadProject` never calls `substituteSessionVars`. Names no provider resolves still throw `ConfigEnvError` from `interpolate`, unchanged from current behavior. `loadProject` forwards its own `signal` option into the provider call as `{ signal }`. It also validates the resolved result at runtime: a non-object return, a `null` return, or any non-string value throws `VariableProviderError`.

**`extensionModules` parameter:** Forwarded to `loadExtensions` unchanged; see the `extensionModules` description under Extension Loading above for its keying, guards, and bundling motivation.

`loadProject` combines all steps: resolve config, validate, load extensions, build resolvers, and generate bindings.

A host that wants a project bundled into a single file passes `extensionModules` alongside a static import. This lets the bundler follow the import instead of the runtime-computed specifier `loadExtensions` would otherwise pass to `import()`:

```typescript
import { loadProject } from '@rcrsr/rill-config';
import * as myext from './extensions/my-ext/index.ts';

const project = await loadProject({
  configPath: '/path/to/project/rill-config.json',
  rillVersion: '0.19.0',
  extensionModules: new Map([['myext', myext]]),
});
```

### Variable Providers

```typescript
import { envProvider, literalProvider, chainProviders } from '@rcrsr/rill-config';

const project = await loadProject({
  configPath: '/path/to/project/rill-config.json',
  rillVersion: '0.19.0',
  varProvider: literalProvider({ RILL_MODEL: 'gemini-2.5-flash' }),
});
```

| Export | Purpose |
|--------|---------|
| `VariableProvider` | Interface: `provide(names, options?)` resolves `${VAR}` names to values |
| `envProvider()` | Reads variable values from `process.env` |
| `literalProvider(values)` | Reads variable values from a caller-supplied map |
| `chainProviders(providers)` | Tries each provider in order; halts and propagates on any thrown error |

`VariableProvider.provide` accepts an optional second argument, `options?: { signal?: AbortSignal }`. `loadProject` forwards its own `signal` option through to the configured provider, and `chainProviders` forwards `options` unchanged to each wrapped provider in turn. A provider that ignores `signal` still works, but cannot be cancelled mid-resolution.

A host composing multiple sources implements its own provider and chains it with the built-in ones. Nothing filesystem-specific ships in this package; the host owns file semantics:

```typescript
import { readFile } from 'node:fs/promises';
import { chainProviders, envProvider, type VariableProvider } from '@rcrsr/rill-config';

function fileProvider(dir: string): VariableProvider {
  return {
    async provide(names, options) {
      const result: Record<string, string> = {};
      for (const name of names) {
        options?.signal?.throwIfAborted();
        try {
          result[name] = (
            await readFile(`${dir}/${name}`, {
              encoding: 'utf8',
              ...(options?.signal !== undefined ? { signal: options.signal } : {}),
            })
          ).trimEnd();
        } catch (err) {
          if (options?.signal?.aborted) throw err;
          // ENOENT: name stays absent, per the partial-match contract
        }
      }
      return result;
    },
  };
}

const project = await loadProject({
  configPath: '/path/to/project/rill-config.json',
  rillVersion: '0.19.0',
  varProvider: chainProviders([fileProvider('/run/secrets'), envProvider()]),
});
```

### Handler Introspection

```typescript
import { parseMainField, introspectHandler, marshalCliArgs } from '@rcrsr/rill-config';

const { file, handler } = parseMainField('script.rill:handleRequest');
const meta = introspectHandler(closure);
const args = marshalCliArgs(meta, ['--name', 'alice']);
```

| Export | Purpose |
|--------|---------|
| `parseMainField(main)` | Split `file:handler` syntax |
| `introspectHandler(closure)` | Extract parameter metadata from a closure |
| `marshalCliArgs(meta, argv)` | Convert CLI arguments to handler parameters |

### Resolvers

| Export | Purpose |
|--------|---------|
| `buildResolvers(config)` | Build `use<scheme:resource>` resolvers from config |

### Error Classes

All errors extend `ConfigError`:

| Error | Cause |
|-------|-------|
| `ConfigNotFoundError` | No `rill-config.json` found |
| `ConfigParseError` | Invalid JSON or structure |
| `ConfigEnvError` | Missing environment variables |
| `ConfigValidationError` | Invalid field values |
| `RuntimeVersionError` | Runtime version mismatch |
| `MountValidationError` | Invalid mount path or specifier |
| `ExtensionLoadError` | Extension failed to load |
| `ExtensionVersionError` | Extension version incompatible |
| `ExtensionBindingError` | Extension binding generation failed |
| `NamespaceCollisionError` | Two mounts from different packages conflict |
| `ContextValidationError` | Context value fails schema check |
| `BundleRestrictionError` | Prohibited field present during bundle |
| `HandlerArgError` | Invalid handler arguments |
| `ResolverError` | A `use<scheme:resource>` resolver failed |
| `VariableProviderError` | A `${VAR}` variable provider failed |

## Documentation

| Document | Description |
|----------|-------------|
| [Config Reference](https://github.com/rcrsr/rill/blob/main/docs/ref-config.md) | `rill-config.json` field documentation |
| [Config API Reference](https://github.com/rcrsr/rill/blob/main/docs/ref-config-api.md) | TypeScript API details |
| [Extensions](https://github.com/rcrsr/rill/blob/main/docs/integration-extensions.md) | Writing extensions |
| [Resolver Registration](https://github.com/rcrsr/rill/blob/main/docs/integration-resolvers.md) | `use<scheme:resource>` setup |

## License

MIT
