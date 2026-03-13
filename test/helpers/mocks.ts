/**
 * Shared mock factories for external dependencies.
 */

import { AxiosError, AxiosHeaders, InternalAxiosRequestConfig } from 'axios';

/**
 * Creates a mock Axios error with configurable status and message.
 */
export function createMockAxiosError(
  status: number,
  message: string,
  errorData?: { error?: { message?: string } },
): AxiosError {
  const headers = new AxiosHeaders();
  const config = { headers } as InternalAxiosRequestConfig;

  const error = new AxiosError(
    message,
    status >= 500 ? 'ERR_BAD_RESPONSE' : 'ERR_BAD_REQUEST',
    config,
    {},
    {
      status,
      statusText: message,
      headers: {},
      config,
      data: errorData ?? { error: { message } },
    },
  );

  return error;
}

/**
 * Creates a mock Axios network error (no response).
 */
export function createMockNetworkError(): AxiosError {
  const headers = new AxiosHeaders();
  const config = { headers } as AxiosError['config'];

  return new AxiosError(
    'Network Error',
    'ERR_NETWORK',
    config,
    {},
    undefined, // no response for network errors
  );
}
