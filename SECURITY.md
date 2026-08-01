# Security Policy

`@rcrsr/rill-config` reads a project's `rill-config.json`, resolves the extension specifiers it names, and dynamically imports them. Deciding which code a host loads is the whole job of this package, so specifier resolution scope and load-time cleanup are first-class concerns rather than a subcategory of bugs. This policy describes what counts as a vulnerability, how to report one, and what to expect afterwards.

## Supported versions

Only the latest published release is supported. Fixes land there, and there are no backports to earlier releases.

Reproduce on the current release before reporting. If you cannot upgrade, say so in the report and give the version you tested. A defect that is already fixed still tells us the fix needs a clearer changelog entry.

The current version is on the [npm package page](https://www.npmjs.com/package/@rcrsr/rill-config) and in [CHANGELOG.md](CHANGELOG.md).

This policy covers `@rcrsr/rill-config`, the only package published from this repository. The runtime, the extensions, the agent framework, and the CLI are separate repositories with their own policies.

## Reporting a vulnerability

Report privately through GitHub, on the [Security tab](https://github.com/rcrsr/rill-config/security/advisories/new) of this repository. That opens a private advisory visible only to you and the maintainers.

Do not open a public issue for a vulnerability in a published release.

Include:

- The version you tested, and whether you reproduced it on the current release
- A minimal reproduction: the smallest `rill-config.json` and `loadProject()` call that shows the behaviour
- What a host embedding this library loses as a result, stated concretely
- Any host option, `prefix` value, or on-disk layout the reproduction depends on

**Do not post working exploit payloads against a live host.** Describe the class of issue and give a minimal reproduction against a local project directory instead.

## What to expect

| Stage | Target |
|-------|--------|
| Acknowledgement | 5 days |
| Initial assessment | 14 days |
| Fix or mitigation plan for a confirmed report | 30 days |

This package is maintained by a small team, so these are targets rather than guarantees. If a report goes quiet past acknowledgement, a nudge on the advisory thread is welcome.

On a confirmed report, the maintainers publish a GitHub Security Advisory, release a patched version, and credit you by name or handle unless you ask otherwise.

## Threat model

The premise is that a host calls `loadProject()` against a project directory it may not fully control, and that `rill-config.json` names the extension modules to import. The host chooses the config path and the resolution `prefix`. The config file chooses what to load within those bounds.

### In scope

- **Specifier resolution escape.** A bare specifier resolving outside the `prefix` the host supplied, or a relative, absolute, or `file://` specifier reaching a module the host's layout did not intend to expose.
- **Enforcement bypass.** Any mechanism that gates, filters, or validates being defeated by a different specifier form, an unhandled input shape, or an unlisted default. Defaults that fail open are a defect in this class.
- **Load-time cleanup failure.** A failed load leaving extension handles, timers, or subscriptions live because a step that can throw sits outside `loadProject()`'s dispose-on-failure block. An error path that leaks a handle is a defect here, not merely untidy.
- **Manifest and validation bypass.** An extension whose manifest fails validation still contributing bindings, resolvers, or values to the returned tree.
- **Variable interpolation.** Config interpolation reading host state a `VariableProvider` did not expose, or a crafted config value escaping interpolation into an unintended position.
- **Resource exhaustion.** Unbounded allocation, a hang, or a crash on an adversarial `rill-config.json`, including deeply nested or self-referential structures.
- **Supply chain.** Anything in the published package contents or the release pipeline that lets a third party alter what consumers install.

### Out of scope

- **A host pointing `prefix` at a directory containing hostile modules.** Choosing the resolution root is the host's decision, and this package's job is to resolve within it.
- **A hostile extension misbehaving once loaded.** This package imports the module and calls its factory; what that code then does is the runtime's boundary, not this one's. See the `@rcrsr/rill` policy.
- **Anything requiring the attacker to control the host's own code or its `loadProject()` arguments.** That is already full control.
- **Findings from a scanner with no demonstrated impact on a real `loadProject()` call.**

If you are unsure which side a finding falls on, report it. A borderline report that turns out to be by-design costs less than an unreported bypass.

## Hardening guidance for hosts

The guarantees end at the boundary the host supplies. Two practices carry the most weight:

- **Set `prefix` explicitly, and set it narrowly.** It defaults to the config directory. Hosts that keep extensions in a dedicated directory should say so rather than inheriting the default.
- **Treat `rill-config.json` as untrusted input whenever the project directory is.** Every specifier in it names code that will be imported into the host process.

See the API tables in [README.md](README.md) for the options these decisions run through.
