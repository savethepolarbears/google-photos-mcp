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

// Only add Console transport if not in STDIO mode
if (!useStdio) {
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
  // @ts-ignore
  write: (message: string) => {
    logger.info(message.trim());
  },
};

export default logger;