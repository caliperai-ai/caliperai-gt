
/// <reference types="vite/client" />

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LoggerConfig {
  enabled: boolean;
  minLevel: LogLevel;
  prefix?: string;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const isProduction = typeof __PROD__ !== 'undefined'
  ? __PROD__
  : (import.meta.env?.PROD ?? false);

const defaultConfig: LoggerConfig = {
  enabled: !isProduction || (import.meta.env?.VITE_ENABLE_LOGS === 'true'),
  minLevel: isProduction ? 'error' : 'debug',
  prefix: '[App]',
};

class Logger {
  private config: LoggerConfig;

  constructor(config: Partial<LoggerConfig> = {}) {
    this.config = { ...defaultConfig, ...config };
  }

  private shouldLog(level: LogLevel): boolean {
    if (!this.config.enabled) return false;
    return LOG_LEVELS[level] >= LOG_LEVELS[this.config.minLevel];
  }

  private formatMessage(prefix: string, ...args: unknown[]): unknown[] {
    const timestamp = new Date().toISOString();
    return isProduction
      ? [`${prefix}`, ...args]  // Minimal in prod
      : [`[${timestamp}]`, prefix, ...args];  // Full in dev
  }

  /**
   * Debug level - verbose information for development
   * Stripped in production builds by Terser
   */
  debug(prefix: string, ...args: unknown[]): void {
    if (this.shouldLog('debug')) {
      console.debug(...this.formatMessage(prefix, ...args));
    }
  }

  /**
   * Info level - general information
   * Stripped in production builds by Terser
   */
  info(prefix: string, ...args: unknown[]): void {
    if (this.shouldLog('info')) {
      console.info(...this.formatMessage(prefix, ...args));
    }
  }

  /**
   * Warning level - potential issues
   * Stripped in production builds by Terser
   */
  warn(prefix: string, ...args: unknown[]): void {
    if (this.shouldLog('warn')) {
      console.warn(...this.formatMessage(prefix, ...args));
    }
  }

  /**
   * Error level - actual errors
   * These may be sent to error monitoring in production
   */
  error(prefix: string, ...args: unknown[]): void {
    if (this.shouldLog('error')) {
      console.error(...this.formatMessage(prefix, ...args));

      // Future: Send to error monitoring service (Sentry, etc.)
      // if (isProduction) {
      //   this.sendToMonitoring(prefix, args);
      // }
    }
  }

  /**
   * Create a scoped logger with a specific prefix
   */
  scope(prefix: string): ScopedLogger {
    return new ScopedLogger(this, prefix);
  }
}

class ScopedLogger {
  constructor(
    private logger: Logger,
    private prefix: string
  ) {}

  debug(...args: unknown[]): void {
    this.logger.debug(this.prefix, ...args);
  }

  info(...args: unknown[]): void {
    this.logger.info(this.prefix, ...args);
  }

  warn(...args: unknown[]): void {
    this.logger.warn(this.prefix, ...args);
  }

  error(...args: unknown[]): void {
    this.logger.error(this.prefix, ...args);
  }
}

// Export singleton instance
export const logger = new Logger();

// Export for creating scoped loggers
export const createLogger = (prefix: string) => logger.scope(prefix);

// Export types for external use
export type { Logger, ScopedLogger, LoggerConfig, LogLevel };

// Declare global type for __PROD__ variable defined in vite.config.ts
declare global {
  const __PROD__: boolean;
  const __DEV__: boolean;
}
