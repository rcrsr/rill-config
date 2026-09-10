/**
 * Tests for the ConfigError subclasses.
 * Covers: HP-41, HP-42
 * (AC-41, AC-42)
 */

import {
  BundleRestrictionError,
  ConfigEnvError,
  ConfigError,
  ConfigNotFoundError,
  ConfigParseError,
  ConfigValidationError,
  ContextValidationError,
  ExtensionBindingError,
  ExtensionLoadError,
  ExtensionVersionError,
  HandlerArgError,
  MountValidationError,
  NamespaceCollisionError,
  ResolverError,
  RuntimeVersionError,
  VariableProviderError,
} from '@rcrsr/rill-config';
import { describe, expect, it } from 'vitest';

// ============================================================
// simple subclasses: (message, options?) only
// ============================================================

const simpleSubclasses = [
  { ErrorClass: ConfigNotFoundError, expectedCode: 'CONFIG_NOT_FOUND' },
  { ErrorClass: ConfigParseError, expectedCode: 'CONFIG_PARSE' },
  { ErrorClass: ConfigEnvError, expectedCode: 'CONFIG_ENV' },
  { ErrorClass: ConfigValidationError, expectedCode: 'CONFIG_VALIDATION' },
  { ErrorClass: RuntimeVersionError, expectedCode: 'RUNTIME_VERSION' },
  { ErrorClass: MountValidationError, expectedCode: 'MOUNT_VALIDATION' },
  { ErrorClass: ExtensionLoadError, expectedCode: 'EXTENSION_LOAD' },
  { ErrorClass: ExtensionVersionError, expectedCode: 'EXTENSION_VERSION' },
  { ErrorClass: ExtensionBindingError, expectedCode: 'EXTENSION_BINDING' },
  { ErrorClass: NamespaceCollisionError, expectedCode: 'NAMESPACE_COLLISION' },
  { ErrorClass: ContextValidationError, expectedCode: 'CONTEXT_VALIDATION' },
  { ErrorClass: BundleRestrictionError, expectedCode: 'BUNDLE_RESTRICTION' },
  { ErrorClass: HandlerArgError, expectedCode: 'HANDLER_ARG' },
] as const;

describe('ConfigError subclasses with (message, options?) constructors', () => {
  describe('HP-41: name and code match the class for every simple subclass', () => {
    it.each(simpleSubclasses)(
      'sets .code to $expectedCode and .name to $ErrorClass.name',
      ({ ErrorClass, expectedCode }) => {
        const error = new ErrorClass('boom');

        expect(error.code).toBe(expectedCode);
        expect(error.name).toBe(ErrorClass.name);
        expect(error).toBeInstanceOf(ConfigError);
        expect(error).toBeInstanceOf(ErrorClass);
      }
    );
  });
});

// ============================================================
// special-constructor subclasses: (message, name, cause) beyond message
// ============================================================

describe('ResolverError', () => {
  describe('HP-42: sets code, name, resolverName, and cause', () => {
    it('sets .code to RESOLVER and preserves resolverName and cause', () => {
      const cause = new Error('underlying failure');
      const error = new ResolverError('resolver failed', 'ext:', cause);

      expect(error.code).toBe('RESOLVER');
      expect(error.name).toBe(ResolverError.name);
      expect(error.resolverName).toBe('ext:');
      expect(error.cause).toBe(cause);
      expect(error).toBeInstanceOf(ConfigError);
    });
  });
});

describe('VariableProviderError', () => {
  describe('HP-42: sets code, name, providerName, and cause', () => {
    it('sets .code to VARIABLE_PROVIDER and preserves providerName and cause', () => {
      const cause = new Error('underlying failure');
      const error = new VariableProviderError(
        'provider failed',
        'envProvider',
        cause
      );

      expect(error.code).toBe('VARIABLE_PROVIDER');
      expect(error.name).toBe(VariableProviderError.name);
      expect(error.providerName).toBe('envProvider');
      expect(error.cause).toBe(cause);
      expect(error).toBeInstanceOf(ConfigError);
    });
  });
});
