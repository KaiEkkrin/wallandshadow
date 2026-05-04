import { ILogger } from '@wallandshadow/shared';

// Warnings collapse Error args to .message in production so a routine
// expired-JWT doesn't burn 50 lines of stack in journald. Dev keeps full
// Error rendering for diagnosis.
const verboseWarn = process.env.NODE_ENV !== 'production';

export const logger: ILogger = {
  logError(message: string, ...optionalParams: unknown[]): void {
    console.error('[ERROR]', message, ...optionalParams);
  },
  logInfo(message: string, ...optionalParams: unknown[]): void {
    console.info('[INFO]', message, ...optionalParams);
  },
  logWarning(message: string, ...optionalParams: unknown[]): void {
    const params = verboseWarn
      ? optionalParams
      : optionalParams.map(p => (p instanceof Error ? p.message : p));
    console.warn('[WARN]', message, ...params);
  },
};
