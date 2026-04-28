import { MountValidationError, NamespaceCollisionError } from './errors.js';
import type { ResolvedMount } from './types.js';

// ============================================================
// MOUNT PATH VALIDATION
// ============================================================

const SEGMENT_PATTERN = /^[a-zA-Z0-9_-]+$/;

function validateMountPath(mountPath: string): void {
  if (!mountPath) {
    throw new MountValidationError('Mount path is empty');
  }
  const segments = mountPath.split('.');
  for (const segment of segments) {
    if (!SEGMENT_PATTERN.test(segment)) {
      throw new MountValidationError(
        `Invalid segment: ${segment} in ${mountPath}`
      );
    }
  }
}

// ============================================================
// SPECIFIER PARSING
// ============================================================

function parseSpecifier(raw: string): {
  packageSpecifier: string;
  versionConstraint: string | undefined;
} {
  // Local paths have no version constraint
  if (raw.startsWith('./') || raw.startsWith('../')) {
    return { packageSpecifier: raw, versionConstraint: undefined };
  }

  // Scoped packages: @scope/name or @scope/name@version
  if (raw.startsWith('@')) {
    // Find the last '@' after position 1 (skip the leading scope '@')
    const lastAt = raw.lastIndexOf('@');
    if (lastAt > 0 && lastAt < raw.length - 1) {
      return {
        packageSpecifier: raw.slice(0, lastAt),
        versionConstraint: raw.slice(lastAt + 1),
      };
    }
    return { packageSpecifier: raw, versionConstraint: undefined };
  }

  // Unscoped packages: name or name@version
  const atIndex = raw.indexOf('@');
  if (atIndex > 0 && atIndex < raw.length - 1) {
    return {
      packageSpecifier: raw.slice(0, atIndex),
      versionConstraint: raw.slice(atIndex + 1),
    };
  }

  return { packageSpecifier: raw, versionConstraint: undefined };
}

// ============================================================
// RESOLVE MOUNTS
// ============================================================

export function resolveMounts(mounts: Record<string, string>): ResolvedMount[] {
  const resolved: ResolvedMount[] = [];

  // Track version constraints per package specifier for conflict detection
  const versionsBySpecifier = new Map<string, string | undefined>();

  for (const [mountPath, rawSpecifier] of Object.entries(mounts)) {
    validateMountPath(mountPath);

    const { packageSpecifier, versionConstraint } =
      parseSpecifier(rawSpecifier);

    // Detect conflicting versions for the same package
    if (versionsBySpecifier.has(packageSpecifier)) {
      const existing = versionsBySpecifier.get(packageSpecifier);
      if (existing !== versionConstraint) {
        const v1 = existing ?? 'unspecified';
        const v2 = versionConstraint ?? 'unspecified';
        throw new MountValidationError(
          `Package ${packageSpecifier} has conflicting versions: ${v1} vs ${v2}`
        );
      }
    } else {
      versionsBySpecifier.set(packageSpecifier, versionConstraint);
    }

    const mount: ResolvedMount =
      versionConstraint !== undefined
        ? { mountPath, packageSpecifier, versionConstraint }
        : { mountPath, packageSpecifier };
    resolved.push(mount);
  }

  return resolved;
}

// ============================================================
// DETECT NAMESPACE COLLISIONS
// ============================================================

export function detectNamespaceCollisions(mounts: ResolvedMount[]): void {
  for (let i = 0; i < mounts.length; i++) {
    const mountA = mounts[i]!;

    for (let j = i + 1; j < mounts.length; j++) {
      const mountB = mounts[j]!;

      // Same-package overlaps are allowed; intra-package nested-mount
      // collisions are caught later by mountValue.
      if (mountA.packageSpecifier === mountB.packageSpecifier) continue;

      if (mountA.mountPath === mountB.mountPath) {
        throw new NamespaceCollisionError(
          `${mountA.mountPath} mounted by ${mountA.packageSpecifier} and ${mountB.packageSpecifier}`
        );
      }

      // Order the pair so `outer` is the prefix candidate; emit one branch.
      const [outer, inner] =
        mountA.mountPath.length < mountB.mountPath.length
          ? [mountA, mountB]
          : [mountB, mountA];

      if (inner.mountPath.startsWith(outer.mountPath + '.')) {
        throw new NamespaceCollisionError(
          `${outer.mountPath} (${outer.packageSpecifier}) is prefix of ${inner.mountPath} (${inner.packageSpecifier})`
        );
      }
    }
  }
}
