import pino from 'pino';
import { config } from '../config/index.js';

export const logger = pino({
  level: config.nodeEnv === 'production' ? 'info' : 'debug',
  transport: config.nodeEnv !== 'production'
    ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } }
    : undefined,
  redact: ['req.headers.authorization', 'password', 'passwordHash', 'mfaSecret'],
});