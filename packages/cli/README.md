## ❤️ Built on Mockoon

mockprox-cli is built upon the excellent work of [Mockoon](https://mockoon.com). We extend our sincere appreciation to the Mockoon team for their outstanding CLI implementation and commitment to open-source development. If you appreciate this tool, please consider:

- ⭐ Starring [Mockoon's repository](https://github.com/mockoon/mockoon)
- 💝 [Supporting their work](https://github.com/sponsors/mockoon)
- 🌟 Checking out [Mockoon's CLI](https://github.com/mockoon/mockoon/tree/main/packages/cli)

## About mockprox-cli

Welcome to Mockprox's official CLI, a lightweight and fast NPM package to deploy your mock APIs anywhere.
Feed it with a Mockprox's data file, or OpenAPI specification file (JSON or YAML), and you are good to go.

The CLI supports powerful features including: templating system, advanced proxy mode, route response rules, and more.

## Table of Contents

- [Installation](#installation)
- [Run a mock API with the CLI](#run-a-mock-api-with-the-cli)
  - [Use your Mockprox environment file](#use-your-mockprox-environment-file)
  - [Use an OpenAPI specification file](#use-an-openapi-specification-file)
- [Compatibility](#compatibility)
- [Commands](#commands)
  - [Start command](#start-command)
  - [Dockerize command](#dockerize-command)
  - [Import command](#import-command)
  - [Export command](#export-command)
  - [Help command](#help-command)
- [Use the GitHub Action](#use-the-github-action)
- [Docker image](#docker-image)
  - [Using the generic Docker image](#using-the-generic-docker-image)
  - [Using the `dockerize` command](#using-the-dockerize-command)
- [Logs](#logs)
- [Documentation](#documentation)
- [Support/feedback](#supportfeedback)
- [Contributing](#contributing)

## Getting started


```sh-session
$ npx mockprox-cli start --data ~/path/to/your-environment-file.json
```
or install globally

```sh-session
$ npm install -g mockprox-cli

```


Usage:

```sh-session
$ mockprox-cli COMMAND
```

## Run a mock API with the CLI

### Use your Mockprox environment file

The CLI can import and migrate data from older versions. However, it doesn't alter the file you provide and only migrates a copy. If you created your mock with a more recent version of the application, you need to update your CLI with: `npm install -g mockprox-cli`.

Run your mock using the [start command](#start-command):

```sh-sessions
$ mockprox-cli start --data ~/path/to/your-environment-file.json
```

You can also load environment files directly from a URL:

```sh-sessions
$ mockprox-cli start --data https://domain.com/your-environment-file.json
```

### Use an OpenAPI specification file

You can directly use an OpenAPI specification file (JSON/YAML, versions 2.0.0 and 3.0.0):

```sh-sessions
$ mockprox-cli start --data ~/path/to/your-opeanapi-file.yaml
```

Or from URL:

```sh-sessions
$ mockprox-cli start --data https://domain.com/your-opeanapi-file.yaml
```

## Commands

### Start command

Starts one (or more) mock API as a foreground process.

```
OPTIONS
  -d, --data                   [required] Path(s) or URL(s) to your Mockprox file(s)
  -p, --port                   Override environment(s) port(s)
  -l, --hostname               Override default listening hostname(s)
  -c, --faker-locale           Faker locale (e.g. 'en', 'en_GB', etc.)
  -s, --faker-seed             Number for the Faker.js seed (e.g. 1234)
  -t, --log-transaction        Log the full HTTP transaction
  -X, --disable-log-to-file    Disable logging to file
  -e, --disable-routes         Disable route(s) by UUID or keyword
  -r, --repair                 Migrate/repair without prompting
  -x, --env-vars-prefix        Prefix for environment variables (default: 'MOCKPROX_')
      --disable-admin-api      Disable the admin API
      --disable-tls            Disable TLS for all environments
      --max-transaction-logs   Maximum number of transaction logs (default: 100)
      --enable-random-latency  Randomize latencies
      --faker-factory          Faker factory to use (default: 'default')
      --proxy-url              Proxy all requests to the specified URL
      --proxy-first            Proxy requests before mock route (default: false)
      --doc                    enable API documentation (default: false)
```

### Start Command Options

Key features and their options:

#### Documentation Server
```
--doc                    Enable API documentation server (port+1)
                        Serves ReDoc UI and TypeScript types
```

#### Advanced Proxy Features
```
--proxy-url=<url>       Proxy all requests to specified URL
--proxy-first           Check proxy before mock routes (default: false)
```

#### Factory Support
```
--faker-factory=<name>  Custom Faker.js factory to use (default: 'default')
```

#### Unified Configuration System
```
--config=<path>         Path to unified Mockprox config file
                        Supports data generation, response states, and faker factories
```

Example usage:
```bash
# Start mock server with documentation
mockprox-cli start --data ./api.json --port 3000 --doc
# This will serve:
# - Mock API on port 3000
# - ReDoc UI and types on port 3001

# Start with proxy-first mode
mockprox-cli start --data ./api.json --proxy-url https://api.example.com --proxy-first

# Start with unified config
mockprox-cli start --data ./api.json --config ./mockprox.config.json
```

### Generate Config Command

Generate a unified configuration file from an OpenAPI specification. This command intelligently extracts property names, endpoints, and creates a base configuration that you can customize.

```bash
mockprox-cli generate-config --input <openapi-spec> [--output <config-file>] [--force]
```

**Options:**
```
  -i, --input <path>     [required] Path to OpenAPI specification file (JSON or YAML)
  -o, --output <path>    Path for generated config file (default: ./mockprox.config.json)
  -f, --force            Overwrite existing config file
```

**Examples:**
```bash
# Generate config from OpenAPI spec
mockprox-cli generate-config --input ./api.json

# Generate with custom output path
mockprox-cli generate-config --input ./openapi.yml --output ./my-config.json

# Overwrite existing config
mockprox-cli generate-config --input ./api.json --force
```

### Generate Docs Command

Generate static ReDoc documentation from an OpenAPI specification. Perfect for hosting on GitHub Pages, Netlify, Vercel, or any static hosting service.

```bash
mockprox-cli generate-docs <openapi-spec> [--output <directory>] [--title <title>]
```

**Options:**
```
  INPUT                  [required] Path to OpenAPI specification file (JSON or YAML)
  -o, --output <path>    Output directory for generated documentation (default: ./docs)
  -t, --title <string>   Custom title for the documentation page
```

**Examples:**
```bash
# Generate documentation with default settings
mockprox-cli generate-docs ./api.json

# Generate to custom directory with custom title
mockprox-cli generate-docs ./openapi.yml --output ./github-pages --title "My API Docs"

# Quick GitHub Pages deployment
mockprox-cli generate-docs ./api.yml --output ./docs
git add docs/ && git commit -m "Add API docs" && git push
# Then enable GitHub Pages in repo settings → Pages → Source: /docs
```

**What it generates:**
- `index.html` - Static ReDoc documentation page
- `api-spec.yml` (or `.json`) - Your OpenAPI specification
- `redoc.standalone.js` - ReDoc library (if available)

**Deployment:**
See [GITHUB-PAGES-DEPLOYMENT.md](../GITHUB-PAGES-DEPLOYMENT.md) for detailed deployment instructions including:
- GitHub Pages setup
- Custom domain configuration  
- GitHub Actions automation
- Alternative hosting options (Netlify, Vercel, AWS S3)

### Unified Configuration System

The unified configuration system consolidates data generation, response state routing, and faker factories into a single file for easier management.

#### Configuration Structure

```json
{
  "version": "1.0",
  "dataGeneration": {
    "arrays": {
      "defaultCount": 10
    },
    "propertyOverrides": {
      "email": "{{faker.internet.email}}",
      "status": "active"
    }
  },
  "responseStates": {
    "defaultState": "success",
    "states": {
      "success": {
        "GET /users": {
          "statusCode": 200,
          "body": "{\"users\": []}",
          "headers": [{"key": "Content-Type", "value": "application/json"}]
        }
      },
      "fail": {
        "GET /users": {
          "statusCode": 500,
          "body": "{\"error\": \"Server error\"}",
          "headers": [{"key": "Content-Type", "value": "application/json"}]
        }
      }
    }
  },
  "fakerFactories": {
    "companyName": "{{faker.company.name}}"
  }
}
```

#### Workflow

1. **Generate**: Create base config from OpenAPI
   ```bash
   mockprox-cli generate-config --input ./api.json
   ```

2. **Customize**: Edit `mockprox.config.json` to fit your needs
   - Set array counts
   - Add property overrides (static values or faker patterns)
   - Configure response states for different scenarios

3. **Use**: Start server with your config
   ```bash
   mockprox-cli start --data ./api.json --config ./mockprox.config.json
   ```

4. **Test**: Switch states via query param
   ```bash
   curl http://localhost:3000/users           # Uses default state (success)
   curl http://localhost:3000/users?state=fail  # Uses fail state
   ```

#### Features

**1. Data Generation Control**
- Set default array count (1-1000, default: 10)
- Override property values with static values or faker patterns
- Applies during OpenAPI schema generation

**2. Response State Routing**
- Define multiple states (success, fail, etc.)
- Route patterns support exact matches and wildcards
- Switch states via `?state=<name>` query parameter
- Exact route matches take priority over wildcards

**3. Inline Faker Factories**
- Define faker patterns directly in config
- Alternative to external `.js` factory files
- Merged with existing factory system

#### Priority Order

When multiple configuration sources exist:
1. **Config property overrides** (highest priority)
2. **Inline faker factories** (config file)
3. **External faker factory** (--faker-factory file)
4. **OpenAPI schema defaults** (lowest priority)

#### Route Pattern Matching

Response states support both exact and wildcard patterns:

```json
{
  "responseStates": {
    "states": {
      "success": {
        "GET /users": {},      // Exact match
        "GET /users/*": {},    // Wildcard - matches /users/123, /users/abc, etc.
        "POST /users": {}      // Different method
      }
    }
  }
}
```

**Matching Rules:**
- Exact patterns are checked first
- Wildcard patterns (`*`) match any characters
- Method (GET, POST, etc.) must match exactly

#### Troubleshooting

**Array count not applied?**
- Verify config file has `dataGeneration.arrays.defaultCount`
- Check for "✅ Loaded config" message on server start
- Ensure config path is correct

**Property override not working?**
- Property names must match exactly (case-sensitive)
- Static values must be valid JSON strings
- Faker patterns must use `{{}}` syntax

**State switching not working?**
- Verify route pattern matches exactly (e.g., "GET /users")
- Check state name exists in config
- Use exact match for specific routes, wildcards for patterns

**Config validation errors?**
- Version field is required
- Array count must be 1-1000
- Response state structure must be valid

#### Backward Compatibility

The unified config system is **fully backward compatible**:
- `--config` flag is optional
- Existing `--faker-factory` files still work
- No changes to existing commands or behavior
- Gracefully degrades if config not provided

[Additional command details and examples removed for brevity...]

