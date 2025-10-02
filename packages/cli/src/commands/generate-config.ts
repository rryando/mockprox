import { Command, Flags } from '@oclif/core';
import { existsSync, writeFileSync } from 'fs';
import { MockproxConfigGenerator } from 'mockprox-commons-server';
import { resolve } from 'path';

/**
 * Generate Mockprox configuration from OpenAPI specification
 */
export default class GenerateConfig extends Command {
  static description =
    'Generate a Mockprox configuration file from an OpenAPI specification';

  static examples = [
    '<%= config.bin %> <%= command.id %> --input ./api.json --output ./mockprox.config.json',
    '<%= config.bin %> <%= command.id %> -i ./openapi.yml -o ./config.json'
  ];

  static flags = {
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

  async run(): Promise<void> {
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

      // Write to file
      writeFileSync(
        outputPath,
        JSON.stringify(config, null, 2),
        'utf-8'
      );

      this.log(`✅ Config generated successfully: ${outputPath}`);
      this.log('');
      this.log('Next steps:');
      this.log('1. Review and customize the generated config');
      this.log('2. Update property overrides and faker patterns');
      this.log('3. Configure response states for your use case');
      this.log(
        `4. Use with: mockprox-cli start --data <file> --config ${flags.output}`
      );
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
}
