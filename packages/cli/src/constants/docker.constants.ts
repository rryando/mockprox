export const DOCKER_TEMPLATE = `FROM node:18-alpine

RUN npm install -g @mockprox/cli@{{{version}}}
{{#filePaths}}
COPY {{{.}}} {{{.}}}
{{/filePaths}}

# Install curl for healthcheck and tzdata for timezone support.
RUN apk --no-cache add curl tzdata

# Do not run as root.
RUN adduser --shell /bin/sh --disabled-password --gecos "" mockprox
{{#filePaths}}
RUN chown -R mockprox {{{.}}}
{{/filePaths}}
USER mockprox

EXPOSE {{{ports}}}

ENTRYPOINT {{{entrypoint}}}

# Usage: docker run -p <host_port>:<container_port> mockprox-test`;
