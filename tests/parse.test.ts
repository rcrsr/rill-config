/**
 * Tests for parseConfig and parseMainField
 * Covers: AC-13, AC-21, AC-22, EC-4, EC-5
 */

import {
  ConfigParseError,
  ConfigValidationError,
  parseConfig,
  parseMainField,
} from '@rcrsr/rill-config';
import { describe, expect, it } from 'vitest';

// ============================================================
// parseConfig
// ============================================================

describe('parseConfig', () => {
  describe('HP-4: preserves all metadata fields', () => {
    it('returns all populated metadata fields unchanged', () => {
      const raw = JSON.stringify({
        name: 'my-app',
        version: '1.2.3',
        description: 'A test app',
        runtime: '>=0.10.0',
        main: 'index.rill',
      });

      const result = parseConfig(raw);

      expect(result.name).toBe('my-app');
      expect(result.version).toBe('1.2.3');
      expect(result.description).toBe('A test app');
      expect(result.runtime).toBe('>=0.10.0');
      expect(result.main).toBe('index.rill');
    });

    it('returns extensions, context, host, and modules blocks', () => {
      const raw = JSON.stringify({
        extensions: { mounts: { 'ext/http': 'rill-http@1.0.0' } },
        context: {
          schema: { token: { type: 'string' } },
          values: { token: 'abc' },
        },
        host: { timeout: 5000 },
        modules: { math: './math.rill' },
      });

      const result = parseConfig(raw);

      expect(result.extensions).toEqual({
        mounts: { 'ext/http': 'rill-http@1.0.0' },
      });
      expect(result.context).toEqual({
        schema: { token: { type: 'string' } },
        values: { token: 'abc' },
      });
      expect(result.host).toEqual({ timeout: 5000 });
      expect(result.modules).toEqual({ math: './math.rill' });
    });
  });

  describe('AC-13: placeholder preservation', () => {
    it('returns config with ${VAR} placeholders intact', () => {
      const raw = JSON.stringify({
        name: '${APP_NAME}',
        description: 'ver ${VERSION}',
      });

      const result = parseConfig(raw);

      expect(result.name).toBe('${APP_NAME}');
      expect(result.description).toBe('ver ${VERSION}');
    });
  });

  describe('BC-3: bare minimum config', () => {
    it('returns a config with all optional fields undefined when given empty object JSON', () => {
      const result = parseConfig('{}');

      expect(result.name).toBeUndefined();
      expect(result.version).toBeUndefined();
      expect(result.description).toBeUndefined();
      expect(result.runtime).toBeUndefined();
      expect(result.main).toBeUndefined();
      expect(result.extensions).toBeUndefined();
      expect(result.context).toBeUndefined();
      expect(result.host).toBeUndefined();
      expect(result.modules).toBeUndefined();
    });
  });

  describe('EC-2: invalid JSON', () => {
    it('throws ConfigParseError for malformed JSON', () => {
      expect(() => parseConfig('not json')).toThrow(ConfigParseError);
    });

    it('throws ConfigParseError with message starting with "Failed to parse config:"', () => {
      expect(() => parseConfig('{broken')).toThrow(/^Failed to parse config:/);
    });

    it('throws ConfigParseError when JSON is a top-level array', () => {
      expect(() => parseConfig('[]')).toThrow(ConfigParseError);
    });

    it('throws ConfigParseError when JSON is a top-level string', () => {
      expect(() => parseConfig('"hello"')).toThrow(ConfigParseError);
    });
  });

  describe('EC-4: invalid field type', () => {
    it('throws ConfigValidationError when a string field receives a number', () => {
      const raw = JSON.stringify({ name: 42 });

      expect(() => parseConfig(raw)).toThrow(ConfigValidationError);
    });

    it('throws ConfigValidationError with message showing field name and types', () => {
      const raw = JSON.stringify({ version: false });

      expect(() => parseConfig(raw)).toThrow(
        'Field version: expected string, got boolean'
      );
    });

    it('throws ConfigValidationError when extensions field receives an array', () => {
      const raw = JSON.stringify({ extensions: [] });

      expect(() => parseConfig(raw)).toThrow(ConfigValidationError);
    });

    it('throws ConfigValidationError when host field receives a string', () => {
      const raw = JSON.stringify({ host: 'invalid' });

      expect(() => parseConfig(raw)).toThrow(
        'Field host: expected object, got string'
      );
    });
  });
});

// ============================================================
// parseMainField
// ============================================================

describe('parseMainField', () => {
  describe('HP-5: module mode (no colon)', () => {
    it('returns filePath and undefined handlerName for a plain file path', () => {
      const result = parseMainField('script.rill');

      expect(result.filePath).toBe('script.rill');
      expect(result.handlerName).toBeUndefined();
    });

    it('returns filePath for a nested path with no colon', () => {
      const result = parseMainField('handlers/main.rill');

      expect(result.filePath).toBe('handlers/main.rill');
      expect(result.handlerName).toBeUndefined();
    });
  });

  describe('HP-6: handler mode (with colon)', () => {
    it('splits on the first colon to extract filePath and handlerName', () => {
      const result = parseMainField('handler.rill:run');

      expect(result.filePath).toBe('handler.rill');
      expect(result.handlerName).toBe('run');
    });

    it('uses only the text before the first colon as filePath', () => {
      const result = parseMainField('path/to/file.rill:execute');

      expect(result.filePath).toBe('path/to/file.rill');
      expect(result.handlerName).toBe('execute');
    });
  });

  describe('EC-15: empty file path or handler name', () => {
    it('throws ConfigValidationError for an empty string', () => {
      expect(() => parseMainField('')).toThrow(ConfigValidationError);
    });

    it('throws ConfigValidationError with "empty file path" message for empty string', () => {
      expect(() => parseMainField('')).toThrow(
        'main field has empty file path'
      );
    });

    it('throws ConfigValidationError when colon is the first character (empty file path)', () => {
      expect(() => parseMainField(':run')).toThrow(ConfigValidationError);
    });

    it('throws ConfigValidationError with "empty file path" message when colon is first', () => {
      expect(() => parseMainField(':run')).toThrow(
        'main field has empty file path'
      );
    });

    it('throws ConfigValidationError when nothing follows the colon (empty handler name)', () => {
      expect(() => parseMainField('handler.rill:')).toThrow(
        ConfigValidationError
      );
    });

    it('throws ConfigValidationError with "empty handler name" message when handler is empty', () => {
      expect(() => parseMainField('handler.rill:')).toThrow(
        'main field has empty handler name'
      );
    });
  });
});
