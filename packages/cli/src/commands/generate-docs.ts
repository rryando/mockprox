import { Args, Command, Flags } from '@oclif/core';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

/**
 * Generate static ReDoc documentation from OpenAPI spec
 * Suitable for hosting on GitHub Pages or any static hosting
 */
export default class GenerateDocs extends Command {
  public static override args = {
    input: Args.string({
      description: 'Path to OpenAPI specification file (JSON or YAML)',
      required: true
    })
  };

  public static override description =
    'Generate static ReDoc documentation HTML from OpenAPI spec';

  public static override examples = [
    '<%= config.bin %> <%= command.id %> ./api.json',
    '<%= config.bin %> <%= command.id %> ./openapi.yml --output ./docs',
    '<%= config.bin %> <%= command.id %> ./api.json --output ./github-pages --title "My API Docs"'
  ];

  public static override flags = {
    output: Flags.string({
      char: 'o',
      default: './docs',
      description: 'Output directory for generated documentation'
    }),
    title: Flags.string({
      char: 't',
      description: 'Custom title for the documentation page'
    })
  };

  public async run(): Promise<void> {
    const { args, flags } = await this.parse(GenerateDocs);

    try {
      // Validate input file exists
      if (!existsSync(args.input)) {
        this.error(`Input file not found: ${args.input}`);
      }

      // Read OpenAPI spec
      const specContent = readFileSync(args.input, 'utf8');
      const fileExtension = args.input.split('.').pop() || 'json';

      // Create output directory
      mkdirSync(flags.output, { recursive: true });

      // Copy spec file to output directory
      const specFileName = `api-spec.${fileExtension}`;
      const specOutputPath = join(flags.output, specFileName);
      writeFileSync(specOutputPath, specContent);

      // Get the template HTML from commons-server
      const templatePath = join(
        __dirname,
        '../../../commons-server/dist/cjs/public/index.html'
      );

      if (!existsSync(templatePath)) {
        this.error(
          `Template not found at: ${templatePath}. Make sure mockprox-commons-server is built.`
        );
      }

      let htmlContent = readFileSync(templatePath, 'utf8');

      // Update the swaggerPath to point to the spec file
      htmlContent = htmlContent.replace(
        /(swaggerPath:\s*['"])[^'"]*(['"])/,
        `$1./${specFileName}$2`
      );

      // Update title if provided
      if (flags.title) {
        htmlContent = htmlContent.replace(
          /<title>[^<]*<\/title>/,
          `<title>${flags.title}</title>`
        );
      }

      // Write the HTML file
      const htmlOutputPath = join(flags.output, 'index.html');
      writeFileSync(htmlOutputPath, htmlContent);

      // Copy redoc standalone JS if it exists
      const redocSourcePath = join(
        __dirname,
        '../../../commons-server/dist/cjs/public/redoc.standalone.js'
      );

      if (existsSync(redocSourcePath)) {
        const redocContent = readFileSync(redocSourcePath);
        const redocOutputPath = join(flags.output, 'redoc.standalone.js');
        writeFileSync(redocOutputPath, redocContent);
      }

      this.log(`✅ Documentation generated successfully: ${flags.output}`);
      this.log('');
      this.log('Files created:');
      this.log(`  - ${htmlOutputPath}`);
      this.log(`  - ${specOutputPath}`);
      if (existsSync(join(flags.output, 'redoc.standalone.js'))) {
        this.log(`  - ${join(flags.output, 'redoc.standalone.js')}`);
      }
      this.log('');
      this.log('Next steps:');
      this.log(`  1. Open ${htmlOutputPath} in a browser to preview`);
      this.log('  2. Deploy the contents of the output directory to:');
      this.log('     - GitHub Pages');
      this.log('     - Netlify');
      this.log('     - Vercel');
      this.log('     - Or any static hosting service');
      this.log('');
      this.log('GitHub Pages example:');
      this.log('  1. Push the output directory to your repo');
      this.log('  2. Go to Settings > Pages');
      this.log('  3. Select the branch and folder containing the docs');
    } catch (error) {
      this.error(
        `Failed to generate documentation: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
