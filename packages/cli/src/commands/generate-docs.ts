import { Args, Command, Flags } from '@oclif/core';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { generateModelFromSwagger } from 'mockprox-commons-server';
import { join } from 'path';

/**
 * Generate static ReDoc documentation from OpenAPI spec
 * Suitable for hosting on GitHub Pages or any static hosting
 * Includes TypeScript type generation and optional config generation
 */
export default class GenerateDocs extends Command {
  public static override args = {
    input: Args.string({
      description: 'Path to OpenAPI specification file (JSON or YAML)',
      required: true
    })
  };

  public static override description =
    'Generate static ReDoc documentation with TypeScript types from OpenAPI spec';

  public static override examples = [
    '<%= config.bin %> <%= command.id %> ./api.json',
    '<%= config.bin %> <%= command.id %> ./openapi.yml --output ./docs',
    '<%= config.bin %> <%= command.id %> ./api.json --output ./github-pages --title "My API Docs"',
    '<%= config.bin %> <%= command.id %> ./api.json --with-config'
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
    }),
    'with-config': Flags.boolean({
      char: 'c',
      default: false,
      description: 'Also generate mockprox.config.json in the output directory'
    }),
    'with-types': Flags.boolean({
      default: true,
      description: 'Generate TypeScript type definitions (enabled by default)',
      allowNo: true
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

      // Generate TypeScript types if enabled
      if (flags['with-types']) {
        this.log('📝 Generating TypeScript type definitions...');
        try {
          await generateModelFromSwagger({
            fileName: 'types',
            swaggerFile: specOutputPath,
            ouputDir: join(flags.output, 'model')
          });
          this.log('✅ TypeScript types generated successfully');
        } catch (error) {
          this.warn(
            `Failed to generate TypeScript types: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }

      // Generate config if requested
      if (flags['with-config']) {
        this.log('📝 Generating mockprox.config.json...');
        try {
          // Import GenerateConfig command and run it
          const GenerateConfig = (await import('./generate-config')).default;
          const configOutputPath = join(flags.output, 'mockprox.config.json');
          
          await GenerateConfig.run([
            '--input',
            args.input,
            '--output',
            configOutputPath,
            '--force'
          ]);
          
          this.log('✅ Config file generated successfully');
        } catch (error) {
          this.warn(
            `Failed to generate config: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }

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

      this.log('');
      this.log(`✅ Documentation generated successfully: ${flags.output}`);
      this.log('');
      this.log('📁 Files created:');
      this.log(`  - ${htmlOutputPath}`);
      this.log(`  - ${specOutputPath}`);
      if (flags['with-types'] && existsSync(join(flags.output, 'model/types.ts'))) {
        this.log(`  - ${join(flags.output, 'model/types.ts')}`);
      }
      if (flags['with-config'] && existsSync(join(flags.output, 'mockprox.config.json'))) {
        this.log(`  - ${join(flags.output, 'mockprox.config.json')}`);
      }
      if (existsSync(join(flags.output, 'redoc.standalone.js'))) {
        this.log(`  - ${join(flags.output, 'redoc.standalone.js')}`);
      }
      this.log('');
      this.log('📖 Next steps:');
      this.log(`  1. Open ${htmlOutputPath} in a browser to preview`);
      this.log('  2. Deploy the contents of the output directory to:');
      this.log('     - GitHub Pages');
      this.log('     - Netlify');
      this.log('     - Vercel');
      this.log('     - Or any static hosting service');
      this.log('');
      this.log('🚀 GitHub Pages quick deploy:');
      this.log(`  git add ${flags.output}/`);
      this.log('  git commit -m "Add API documentation"');
      this.log('  git push');
      this.log('  # Then: Settings → Pages → Source: /' + flags.output.replace('./', ''));
    } catch (error) {
      this.error(
        `Failed to generate documentation: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
