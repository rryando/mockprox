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

Example usage:
```bash
# Start mock server with documentation
mockprox-cli start --data ./api.json --port 3000 --doc
# This will serve:
# - Mock API on port 3000
# - ReDoc UI and types on port 3001

# Start with proxy-first mode
mockprox-cli start --data ./api.json --proxy-url https://api.example.com --proxy-first
```

[Additional command details and examples removed for brevity...]

