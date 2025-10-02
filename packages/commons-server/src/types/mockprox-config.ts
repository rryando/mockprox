/**
 * Mockprox unified configuration types
 */

/**
 * Main configuration interface for Mockprox
 */
export interface MockproxConfig {
  version: string;
  dataGeneration?: DataGenerationConfig;
  urlStates?: UrlStatesConfig;
  fakerFactories?: Record<string, string>;
}

/**
 * Data generation configuration
 */
export interface DataGenerationConfig {
  arrays?: {
    defaultCount?: number;
  };
  propertyOverrides?: Record<string, string>;
}

/**
 * URL states configuration - maps route patterns to their state and optional overrides
 */
export type UrlStatesConfig = Record<string, UrlStateConfig>;

/**
 * State configuration for a specific URL/route
 */
export interface UrlStateConfig {
  state: string; // "random", "success", "fail", or custom state name
  statusCode?: number;
  body?: string;
  headers?: { key: string; value: string }[];
}

/**
 * Validation errors
 */
export class ConfigValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigValidationError';
  }
}
