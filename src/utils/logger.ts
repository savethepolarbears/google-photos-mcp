import winston from 'winston';
import config from './config';

// Define log format
const logFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.printf(({ level, message, timestamp }) => {
    return `${timestamp} [${level.toUpperCase()}]: ${message}`;
  })
);

// Create the logger
const logger = winston.createLogger({
  level: config.logger.level,
  format: logFormat,
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' }),
  ],
});

// Add a stream for using with express-winston
logger.stream = {
  // @ts-ignore
  write: (message: string) => {
    logger.info(message.trim());
  },
};

export default logger;