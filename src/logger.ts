import process from 'node:process';
import pino from 'pino';

function readLogLevel(): string {
  return process.env['LOG_LEVEL'] ?? 'info';
}

export const logger = pino(
  {
    level: readLogLevel(),
    base: { app: 'local-openfinance' },
  },
  pino.destination(2),
);

export type LogLevel = pino.Level;
