import winston from 'winston';
import config from './config.js';

// Check if using STDIO mode
const useStdio = process.argv.includes('--stdio');

// Define log format
const logFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.printf(({ level, message, timestamp }) => {
    return `${timestamp} [${level.toUpperCase()}]: ${message}`;
  })
);

// Create transports array based on mode
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

// Create the logger
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