import { ILogger } from '@wallandshadow/shared';

export const logger: ILogger = {
  logError(message: string, ...optionalParams: unknown[]): void {
    console.error('[ERROR]', message, ...optionalParams);
  },
  logInfo(message: string, ...optionalParams: unknown[]): void {
    console.info('[INFO]', message, ...optionalParams);
  },
  logWarning(message: string, ...optionalParams: unknown[]): void {
    console.warn('[WARN]', message, ...optionalParams);
  },
};
