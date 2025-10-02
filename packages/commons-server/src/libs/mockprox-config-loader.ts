import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import {
    ConfigValidationError,
    MockproxConfig,
    UrlStateConfig
} from '../types/mockprox-config';

/**
 * Loads and provides access to Mockprox configuration
 */
export class MockproxConfigLoader {
  private config: MockproxConfig | null = null;

  /**
   * Load configuration from file
   * @param configPath Path to config file (absolute or relative to cwd)
   */
  public loadConfig(configPath: string): void {
    const resolvedPath = resolve(process.cwd(), configPath);

    if (!existsSync(resolvedPath)) {
      throw new ConfigValidationError(
        `Config file not found: ${resolvedPath}`
      );
    }

    try {
      const content = readFileSync(resolvedPath, 'utf-8');
      this.config = JSON.parse(content) as MockproxConfig;
      this.validateConfig();
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new ConfigValidationError(
          `Invalid JSON in config file: ${error.message}`
        );
      }
      throw error;
    }
  }

  /**
   * Check if config is loaded
   */
  public isLoaded(): boolean {
    return this.config !== null;
  }

  /**
   * Get array default count (returns 10 if not configured)
   */
  public getArrayCount(): number {
    return this.config?.dataGeneration?.arrays?.defaultCount ?? 10;
  }

  /**
   * Get property override value
   * @param propertyName Property name to look up
   * @returns Override value or undefined
   */
  public getPropertyOverride(propertyName: string): string | undefined {
    return this.config?.dataGeneration?.propertyOverrides?.[propertyName];
  }

  /**
   * Get all property overrides
   */
  public getPropertyOverrides(): Record<string, string> {
    return this.config?.dataGeneration?.propertyOverrides ?? {};
  }

  /**
   * Get URL state configuration for a route pattern
   * @param routePattern Route pattern (e.g., "GET /users" or "GET /users/*")
   * @param requestState Optional state override from query parameter
   * @returns UrlStateConfig or undefined
   */
  public getUrlState(
    routePattern: string,
    requestState?: string
  ): UrlStateConfig | undefined {
    if (!this.config?.urlStates) {
      return undefined;
    }

    // Try exact match first
    let urlState = this.config.urlStates[routePattern];

    // Try wildcard patterns if no exact match
    if (!urlState) {
      for (const [pattern, state] of Object.entries(this.config.urlStates)) {
        if (pattern.includes('*')) {
          const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
          if (regex.test(routePattern)) {
            urlState = state;
            break;
          }
        }
      }
    }

    if (!urlState) {
      return undefined;
    }

    // If request has state override (query param), check if it matches
    // If state is "random" and no override, return config for fallback
    // If state matches request or no request state, return the config
    if (
      requestState &&
      urlState.state !== 'random' &&
      urlState.state !== requestState
    ) {
      return undefined;
    }

    return urlState;
  }

  /**
   * Get inline faker factories
   */
  public getFakerFactories(): Record<string, string> {
    return this.config?.fakerFactories ?? {};
  }

  /**
   * Get all configured route patterns
   */
  public getConfiguredRoutes(): string[] {
    if (!this.config?.urlStates) {
      return [];
    }

    return Object.keys(this.config.urlStates);
  }

  /**
   * Validate loaded configuration
   */
  private validateConfig(): void {
    if (!this.config) {
      throw new ConfigValidationError('No config loaded');
    }

    // Version is required
    if (!this.config.version) {
      throw new ConfigValidationError('Config must have a version field');
    }

    // Validate array count (1-1000)
    const arrayCount = this.config.dataGeneration?.arrays?.defaultCount;
    if (arrayCount !== undefined) {
      if (
        !Number.isInteger(arrayCount) ||
        arrayCount < 1 ||
        arrayCount > 1000
      ) {
        throw new ConfigValidationError(
          'Array defaultCount must be an integer between 1 and 1000'
        );
      }
    }

    // Validate urlStates
    if (this.config.urlStates) {
      for (const [routePattern, urlState] of Object.entries(
        this.config.urlStates
      )) {
        if (typeof routePattern !== 'string' || routePattern.trim() === '') {
          throw new ConfigValidationError(
            'Route patterns must be non-empty strings'
          );
        }

        if (typeof urlState !== 'object' || urlState === null) {
          throw new ConfigValidationError(
            `Route "${routePattern}" must map to a urlState object`
          );
        }

        if (!urlState.state || typeof urlState.state !== 'string') {
          throw new ConfigValidationError(
            `Route "${routePattern}" must have a valid state field`
          );
        }

        if (
          urlState.statusCode !== undefined &&
          !Number.isInteger(urlState.statusCode)
        ) {
          throw new ConfigValidationError(
            `Route "${routePattern}" statusCode must be an integer`
          );
        }
      }
    }
  }
}
