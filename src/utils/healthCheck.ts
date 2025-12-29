import { getFirstAvailableTokens } from '../auth/tokens.js';
import { setupOAuthClient, listAlbums } from '../api/photos.js';
import fs from 'fs/promises';
import config from './config.js';

/**
 * Health status for individual checks
 */
export interface HealthStatus {
  status: 'pass' | 'fail';
  message?: string;
  responseTime?: number;
}

/**
 * Overall health check result
 */
export interface HealthCheckResult {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  checks: {
    authentication: HealthStatus;
    googleAPI: HealthStatus;
    storage: HealthStatus;
  };
  metrics?: {
    uptime: number;
    memoryUsage: NodeJS.MemoryUsage;
  };
}

/**
 * Performs health checks on system components
 */
export class HealthChecker {
  private startTime = Date.now();

  /**
   * Performs comprehensive health check
   *
   * @param options - Health check options
   * @returns Health check result with status and component checks
   */
  async check(options: { detailed?: boolean } = {}): Promise<HealthCheckResult> {
    const [authentication, googleAPI, storage] = await Promise.all([
      this.checkAuthentication(),
      this.checkGoogleAPI(),
      this.checkStorage(),
    ]);

    const allPassing = [authentication, googleAPI, storage].every(c => c.status === 'pass');
    const anyFailing = [authentication, googleAPI, storage].some(c => c.status === 'fail');

    const result: HealthCheckResult = {
      status: anyFailing ? 'unhealthy' : allPassing ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      checks: { authentication, googleAPI, storage },
    };

    if (options.detailed) {
      result.metrics = {
        uptime: Date.now() - this.startTime,
        memoryUsage: process.memoryUsage(),
      };
    }

    return result;
  }

  /**
   * Checks authentication status
   */
  private async checkAuthentication(): Promise<HealthStatus> {
    const start = Date.now();

    try {
      const tokens = await getFirstAvailableTokens();
      const responseTime = Date.now() - start;

      if (!tokens) {
        return {
          status: 'fail',
          message: 'No authentication tokens available',
          responseTime,
        };
      }

      // Check if tokens are expired
      if (tokens.expiry_date < Date.now()) {
        return {
          status: 'fail',
          message: 'Authentication tokens expired',
          responseTime,
        };
      }

      return {
        status: 'pass',
        message: 'Authentication tokens valid',
        responseTime,
      };
    } catch (error) {
      return {
        status: 'fail',
        message: `Authentication check failed: ${error instanceof Error ? error.message : String(error)}`,
        responseTime: Date.now() - start,
      };
    }
  }

  /**
   * Checks Google Photos API connectivity
   */
  private async checkGoogleAPI(): Promise<HealthStatus> {
    const start = Date.now();

    try {
      const tokens = await getFirstAvailableTokens();

      if (!tokens) {
        return {
          status: 'fail',
          message: 'Cannot check Google API: no tokens',
          responseTime: Date.now() - start,
        };
      }

      // Make a lightweight API call (list 1 album)
      const oauth2Client = setupOAuthClient(tokens);
      await listAlbums(oauth2Client, 1);

      return {
        status: 'pass',
        message: 'Google Photos API accessible',
        responseTime: Date.now() - start,
      };
    } catch (error) {
      return {
        status: 'fail',
        message: `Google API check failed: ${error instanceof Error ? error.message : String(error)}`,
        responseTime: Date.now() - start,
      };
    }
  }

  /**
   * Checks token storage accessibility
   */
  private async checkStorage(): Promise<HealthStatus> {
    const start = Date.now();

    try {
      // Check if tokens file is accessible
      await fs.access(config.tokens.path, fs.constants.R_OK | fs.constants.W_OK);

      return {
        status: 'pass',
        message: 'Token storage accessible',
        responseTime: Date.now() - start,
      };
    } catch (error) {
      return {
        status: 'fail',
        message: `Storage check failed: ${error instanceof Error ? error.message : String(error)}`,
        responseTime: Date.now() - start,
      };
    }
  }
}

/**
 * Singleton instance for health checks
 */
export const healthChecker = new HealthChecker();
