import $RefParser from '@apidevtools/json-schema-ref-parser';
import { MockproxConfig } from '../types/mockprox-config';

/**
 * Generates Mockprox configuration from OpenAPI specifications
 */
export class MockproxConfigGenerator {
  /**
   * Generate config from OpenAPI spec
   * @param specPath Path to OpenAPI spec file
   * @returns Generated MockproxConfig
   */
  public async generateFromOpenAPI(
    specPath: string
  ): Promise<MockproxConfig> {
    const spec = (await $RefParser.bundle(specPath)) as any;

    return {
      version: '1.0',
      dataGeneration: this.generateDataConfig(spec),
      urlStates: this.generateUrlStates(spec),
      fakerFactories: this.generateFakerFactories(spec)
    };
  }

  /**
   * Generate data generation config from spec
   */
  private generateDataConfig(spec: any): {
    arrays: { defaultCount: number };
    propertyOverrides: Record<string, string>;
  } {
    const propertyNames = this.extractPropertyNames(spec);
    const overrides: Record<string, string> = {};

    // Add placeholder for common property names
    for (const prop of propertyNames) {
      overrides[prop] = '{{faker.string.sample}}';
    }

    return {
      arrays: {
        defaultCount: 10
      },
      propertyOverrides: overrides
    };
  }

  /**
   * Generate URL states from spec - one state per endpoint
   */
  private generateUrlStates(spec: any): Record<
    string,
    {
      state: string;
      statusCode?: number;
      body?: string;
      headers?: { key: string; value: string }[];
    }
  > {
    const endpoints = this.extractEndpoints(spec);
    const urlStates: Record<
      string,
      {
        state: string;
        statusCode?: number;
        body?: string;
        headers?: { key: string; value: string }[];
      }
    > = {};

    for (const endpoint of endpoints) {
      // Remove leading slash from path to match Mockoon route format
      const path = endpoint.path.startsWith('/')
        ? endpoint.path.substring(1)
        : endpoint.path;
      const routePattern = `${endpoint.method.toUpperCase()} ${path}`;

      // All endpoints default to "random" state (use auto-generated mock)
      // Users can customize to "success", "fail", or custom states
      urlStates[routePattern] = {
        state: 'random'
        // No statusCode, body, or headers = use default mock generation
      };
    }

    return urlStates;
  }

  /**
   * Generate inline faker factories
   */
  private generateFakerFactories(spec: any): Record<string, string> {
    const propertyNames = this.extractPropertyNames(spec);
    const factories: Record<string, string> = {};

    // Common patterns for property names
    const patterns: Record<string, string> = {
      email: '{{faker.internet.email}}',
      firstName: '{{faker.person.firstName}}',
      lastName: '{{faker.person.lastName}}',
      phone: '{{faker.phone.number}}',
      address: '{{faker.location.streetAddress}}',
      city: '{{faker.location.city}}',
      zipCode: '{{faker.location.zipCode}}',
      country: '{{faker.location.country}}',
      companyName: '{{faker.company.name}}',
      jobTitle: '{{faker.person.jobTitle}}',
      description: '{{faker.lorem.paragraph}}',
      avatar: '{{faker.image.avatar}}',
      url: '{{faker.internet.url}}'
    };

    // Match property names to patterns
    for (const prop of propertyNames) {
      const lowerProp = prop.toLowerCase();
      for (const [key, value] of Object.entries(patterns)) {
        if (lowerProp.includes(key.toLowerCase())) {
          factories[prop] = value;
          break;
        }
      }
    }

    return factories;
  }

  /**
   * Extract property names from OpenAPI schemas
   */
  private extractPropertyNames(spec: any): string[] {
    const properties = new Set<string>();

    const walkSchema = (schema: any) => {
      if (!schema || typeof schema !== 'object') return;

      if (schema.properties) {
        for (const prop of Object.keys(schema.properties)) {
          properties.add(prop);
          walkSchema(schema.properties[prop]);
        }
      }

      if (schema.items) {
        walkSchema(schema.items);
      }

      if (schema.allOf) {
        schema.allOf.forEach(walkSchema);
      }

      if (schema.oneOf) {
        schema.oneOf.forEach(walkSchema);
      }

      if (schema.anyOf) {
        schema.anyOf.forEach(walkSchema);
      }
    };

    // Walk through all schemas in components
    if (spec.components?.schemas) {
      for (const schema of Object.values(spec.components.schemas)) {
        walkSchema(schema);
      }
    }

    // Walk through request/response bodies in paths
    if (spec.paths) {
      for (const path of Object.values(spec.paths) as any[]) {
        for (const operation of Object.values(path) as any[]) {
          if (typeof operation !== 'object') continue;

          // Request body
          if (operation.requestBody?.content) {
            for (const content of Object.values(
              operation.requestBody.content
            )) {
              walkSchema((content as any).schema);
            }
          }

          // Responses
          if (operation.responses) {
            for (const response of Object.values(operation.responses)) {
              if ((response as any).content) {
                for (const content of Object.values(
                  (response as any).content
                )) {
                  walkSchema((content as any).schema);
                }
              }
            }
          }
        }
      }
    }

    return Array.from(properties).sort();
  }

  /**
   * Extract endpoints from OpenAPI spec
   */
  private extractEndpoints(spec: any): {
    method: string;
    path: string;
    responses: Record<string, any>;
  }[] {
    const endpoints: {
      method: string;
      path: string;
      responses: Record<string, any>;
    }[] = [];

    if (!spec.paths) return endpoints;

    for (const [path, pathItem] of Object.entries(spec.paths)) {
      const methods = [
        'get',
        'post',
        'put',
        'patch',
        'delete',
        'options',
        'head'
      ];

      for (const method of methods) {
        if ((pathItem as any)[method]) {
          endpoints.push({
            method,
            path,
            responses: (pathItem as any)[method].responses || {}
          });
        }
      }
    }

    return endpoints;
  }
}
