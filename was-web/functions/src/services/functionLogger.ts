import { ILogger } from './interfaces';
import * as functions from 'firebase-functions/v1';

// Provides a Firebase Functions logger.
class FunctionLogger implements ILogger {
  logError(message: string, ...optionalParams: any[]) {
    functions.logger.error(message, ...optionalParams);
  }

  logInfo(message: string, ...optionalParams: any[]) {
    functions.logger.info(message, ...optionalParams);
  }

  logWarning(message: string, ...optionalParams: any[]) {
    functions.logger.warn(message, ...optionalParams);
  }
}

const functionLogger = new FunctionLogger();
export default functionLogger;