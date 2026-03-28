import { ILogger } from './interfaces';

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