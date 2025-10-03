import { Command, Flags } from '@oclif/core';
import { existsSync, writeFileSync } from 'fs';
import { MockproxConfigGenerator } from 'mockprox-commons-server';
import { resolve } from 'path';

/**
 * Generate Mockprox configuration from OpenAPI specification
 */
export default class GenerateConfig extends Command {
  public static override description =
    'Generate a Mockprox configuration file from an OpenAPI specification';

  public static override examples = [
    '<%= config.bin %> <%= command.id %> --input ./api.json --output ./mockprox.config.json',
    '<%= config.bin %> <%= command.id %> -i ./openapi.yml -o ./config.json'
  ];

  public static override flags = {
    input: Flags.string({
      char: 'i',
      description: 'Path to OpenAPI specification file (JSON or YAML)',
      required: true
    }),
    output: Flags.string({
      char: 'o',
      description: 'Path for generated config file',
      default: './mockprox.config.json'
    }),
    force: Flags.boolean({
      char: 'f',
      description: 'Overwrite existing config file',
      default: false
    })
  };

  public async run(): Promise<void> {
    const { flags } = await this.parse(GenerateConfig);

    // Resolve paths
    const inputPath = resolve(process.cwd(), flags.input);
    const outputPath = resolve(process.cwd(), flags.output);

    // Check input exists
    if (!existsSync(inputPath)) {
      this.error(`Input file not found: ${inputPath}`, { exit: 1 });
    }

    // Check output doesn't exist (unless --force)
    if (existsSync(outputPath) && !flags.force) {
      this.error(
        `Output file already exists: ${outputPath}\nUse --force to overwrite`,
        { exit: 1 }
      );
    }

    try {
      this.log(`Generating config from: ${inputPath}`);

      // Generate config
      const generator = new MockproxConfigGenerator();
      const config = await generator.generateFromOpenAPI(inputPath);

      // Write config to file
      writeFileSync(outputPath, JSON.stringify(config, null, 2), 'utf-8');

      // Generate documentation file with examples
      const docsPath = outputPath.replace(/\.json$/, '.examples.txt');
      const docsContent = this.generateDocumentation();
      writeFileSync(docsPath, docsContent, 'utf-8');

      this.log(`✅ Config generated successfully: ${outputPath}`);
      this.log(`📖 Examples documentation: ${docsPath}`);
      this.log('');
      this.log('Key points:');
      this.log('  • propertyOverrides and fakerFactories are EMPTY by default');
      this.log('  • The mock will use OpenAPI spec defaults automatically');
      this.log('  • Add overrides ONLY for properties you want to customize');
      this.log(
        '  • Check the .examples.txt file for available customization patterns'
      );
      this.log('');
      this.log('Next steps:');
      this.log(
        `  1. Use as-is: mockprox-cli start --data <file> --config ${flags.output}`
      );
      this.log(
        '  2. Or customize: Edit config to override specific properties'
      );
      this.log('  3. Configure: Update urlStates to control response behavior');
    } catch (error) {
      if (error instanceof Error) {
        this.error(`Failed to generate config: ${error.message}`, {
          exit: 1
        });
      } else {
        this.error('Failed to generate config: Unknown error', {
          exit: 1
        });
      }
    }
  }

  /**
   * Generate documentation with examples
   */
  private generateDocumentation(): string {
    return `Mockprox Configuration Examples
=================================

This file provides examples of how to customize your mockprox.config.json.
By default, propertyOverrides and fakerFactories are EMPTY - the mock server
will use your OpenAPI specification's defaults automatically.

Only add overrides for properties you want to customize!

Property Overrides
------------------
Add custom Faker.js patterns for specific property names across all responses:

"propertyOverrides": {
  "email": "{{faker.internet.email}}",
  "firstName": "{{faker.person.firstName}}",
  "lastName": "{{faker.person.lastName}}",
  "phone": "{{faker.phone.number}}",
  "address": "{{faker.location.streetAddress}}",
  "city": "{{faker.location.city}}",
  "zipCode": "{{faker.location.zipCode}}",
  "country": "{{faker.location.country}}",
  "companyName": "{{faker.company.name}}",
  "description": "{{faker.lorem.paragraph}}",
  "avatar": "{{faker.image.avatar}}",
  "url": "{{faker.internet.url}}",
  "price": "{{faker.commerce.price}}",
  "productName": "{{faker.commerce.productName}}",
  "status": "active"
}

Faker Factories
---------------
Create custom Faker.js functions for more complex logic:

"fakerFactories": {
  "customEmail": "return faker.internet.email({ firstName: 'test', lastName: 'user' });",
  "randomStatus": "return faker.helpers.arrayElement(['active', 'inactive', 'pending']);",
  "futureDate": "return faker.date.future().toISOString();",
  "phoneNumber": "return faker.phone.number('+1-###-###-####');"
}

URL States
----------
Control response behavior per endpoint. States can work in two ways:

1. WITH explicit overrides (statusCode, body, headers) - Uses your custom response
2. WITHOUT overrides - Intelligently selects from available route responses:
   - "success" → Selects first 2xx response (200-299)
   - "fail" → Selects first 4xx/5xx response (400+)
   - "random" → Uses auto-generated mock data from OpenAPI spec
   - Custom name → Tries to match response label, falls back to first response

"urlStates": {
  "GET api/users": {
    "state": "success"  // Selects 2xx response from route if available
  },
  "GET api/users/:id": {
    "state": "fail"      // Selects 4xx/5xx response from route if available
  },
  "POST api/users": {
    "state": "fail",     // Custom state WITH explicit overrides
    "statusCode": 400,
    "body": "{\\"error\\": \\"Validation failed\\"}"
  },
  "DELETE api/users/:id": {
    "state": "random"    // Uses auto-generated mock from OpenAPI spec
  },
  "GET api/profile": {
    "state": "unauthorized",  // Custom state - matches response with label "unauthorized"
    "statusCode": 401,
    "body": "{\\"error\\": \\"Not authenticated\\"}"
  }
}

IMPORTANT: 
- If your route has multiple responses defined (e.g., 200, 400, 500), setting
  "state": "fail" will automatically select the first error response (400+)
- If your route only has success responses, "state": "fail" falls back to the
  first available response
- Explicit overrides (statusCode/body/headers) always take precedence

State Query Parameter
---------------------
Control states at runtime using ?state=<name> query parameter:

  curl http://localhost:3001/api/users?state=success   # Uses 2xx response
  curl http://localhost:3001/api/users?state=fail      # Uses 4xx/5xx response

Available Faker.js Methods
--------------------------
Common faker methods you can use in propertyOverrides and fakerFactories:

Person:
  {{faker.person.firstName}}, {{faker.person.lastName}}, {{faker.person.fullName}}
  {{faker.person.jobTitle}}, {{faker.person.bio}}

Internet:
  {{faker.internet.email}}, {{faker.internet.url}}, {{faker.internet.avatar}}
  {{faker.internet.userName}}, {{faker.internet.password}}

Location:
  {{faker.location.city}}, {{faker.location.country}}, {{faker.location.zipCode}}
  {{faker.location.streetAddress}}, {{faker.location.latitude}}

Commerce:
  {{faker.commerce.productName}}, {{faker.commerce.price}}
  {{faker.commerce.department}}, {{faker.commerce.productDescription}}

Company:
  {{faker.company.name}}, {{faker.company.catchPhrase}}

Date:
  {{faker.date.past}}, {{faker.date.future}}, {{faker.date.recent}}

Lorem:
  {{faker.lorem.word}}, {{faker.lorem.sentence}}, {{faker.lorem.paragraph}}

Number:
  {{faker.number.int}}, {{faker.number.float}}

String:
  {{faker.string.uuid}}, {{faker.string.alphanumeric}}

For full Faker.js documentation, visit: https://fakerjs.dev/api/
`;
  }
}

