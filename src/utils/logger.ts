import winston from 'winston';
import config from './config.js';

/**
 * Flag indicating if the application is running in STDIO mode.
 * This is determined by checking the command line arguments for '--stdio'.
 */
const useStdio = process.argv.includes('--stdio');

/**
 * Custom log format combining timestamp and message.
 * Format: `YYYY-MM-DDTHH:mm:ss.sssZ [LEVEL]: message`
 */
const logFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.printf(({ level, message, timestamp }) => {
    return `${timestamp} [${level.toUpperCase()}]: ${message}`;
  })
);

/**
 * List of Winston transports (outputs) for the logger.
 * - Always includes file transports for 'error.log' (error level) and 'combined.log' (all levels).
 * - Includes Console transport:
 *   - In STDIO mode: writes to stderr to avoid interfering with MCP protocol on stdout.
 *   - In HTTP mode: writes to stdout as normal.
 */
const transports: winston.transport[] = [
  new winston.transports.File({ filename: 'error.log', level: 'error' }),
  new winston.transports.File({ filename: 'combined.log' }),
];

// In STDIO mode, send console output to stderr to avoid interfering with MCP protocol
if (useStdio) {
  transports.push(new winston.transports.Console({
    stderrLevels: ['error', 'warn', 'info', 'debug', 'verbose', 'silly']
  }));
} else {
  // In HTTP mode, use normal console output
  transports.push(new winston.transports.Console());
}

/**
 * Application logger instance configured with timestamped format and multiple transports.
 * The log level is determined by the configuration (defaulting to 'info').
 */
const logger = winston.createLogger({
  level: config.logger.level,
  format: logFormat,
  transports: transports,
});

// Add a stream for using with express-winston
logger.stream = {
  // @ts-expect-error - express-winston expects a stream-compatible interface
  write: (message: string) => {
    logger.info(message.trim());
  },
};

export default logger;
