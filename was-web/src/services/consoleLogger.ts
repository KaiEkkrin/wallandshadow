import { ILogger } from '@wallandshadow/shared';

// Provides a console logger.
class ConsoleLogger implements ILogger {
  logError(message: string, ...optionalParams: unknown[]) {
    console.error(message, ...optionalParams);
  }

  logInfo(message: string, ...optionalParams: unknown[]) {
    console.info(message, ...optionalParams);
  }

  logWarning(message: string, ...optionalParams: unknown[]) {
    console.warn(message, ...optionalParams);
  }
}

const consoleLogger = new ConsoleLogger();
export default consoleLogger;

export function logError(message: string, e?: unknown): void {
  consoleLogger.logError(message, e);
}

export function logWarning(message: string, e?: unknown): void {
  consoleLogger.logWarning(message, e);
}