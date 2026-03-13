/**
 * Unit tests for src/api/client.ts — toError function
 * Tests error normalization for Axios errors, API scope deprecation, and generic errors.
 */

import { describe, it, expect } from 'vitest';
import { toError } from '../../src/api/client.js';
import { createMockAxiosError, createMockNetworkError } from '../helpers/mocks.js';

describe('toError', () => {
  it('wraps Axios 500 error with status code and context', () => {
    const axiosErr = createMockAxiosError(500, 'Internal Server Error');
    const result = toError(axiosErr, 'list albums');

    expect(result).toBeInstanceOf(Error);
    expect(result.message).toContain('list albums');
    expect(result.message).toContain('500');
  });

  it('wraps Axios 403 PERMISSION_DENIED with scope deprecation notice', () => {
    const axiosErr = createMockAxiosError(403, 'PERMISSION_DENIED', {
      error: { message: 'PERMISSION_DENIED: Request had insufficient scopes' },
    });
    const result = toError(axiosErr, 'search photos');

    expect(result.message).toContain('PERMISSION_DENIED');
    expect(result.message).toContain('March 31, 2025');
    expect(result.message).toContain('Picker API');
  });

  it('wraps Axios 404 error without scope deprecation notice', () => {
    const axiosErr = createMockAxiosError(404, 'Not Found');
    const result = toError(axiosErr, 'get photo');

    expect(result.message).toContain('get photo');
    expect(result.message).toContain('404');
    expect(result.message).not.toContain('Picker API');
  });

  it('wraps Axios network error (no response)', () => {
    const axiosErr = createMockNetworkError();
    const result = toError(axiosErr, 'search');

    expect(result.message).toContain('search');
    expect(result.message).toContain('Network Error');
  });

  it('wraps generic Error', () => {
    const error = new Error('Something broke');
    const result = toError(error, 'operation');

    expect(result.message).toContain('operation');
    expect(result.message).toContain('Something broke');
  });

  it('wraps string error', () => {
    const result = toError('string error', 'test');

    expect(result).toBeInstanceOf(Error);
    expect(result.message).toContain('string error');
  });

  it('wraps null/undefined errors', () => {
    const result = toError(null, 'test');
    expect(result).toBeInstanceOf(Error);

    const result2 = toError(undefined, 'test');
    expect(result2).toBeInstanceOf(Error);
  });

  it('uses API response message when available', () => {
    const axiosErr = createMockAxiosError(400, 'Bad Request', {
      error: { message: 'Invalid filter format' },
    });
    const result = toError(axiosErr, 'search');

    expect(result.message).toContain('Invalid filter format');
  });
});
