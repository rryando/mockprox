FROM node:18-alpine

ARG version=latest

RUN npm install -g @mockprox/cli@$version

# Install curl for healthcheck and tzdata for timezone support.
RUN apk --no-cache add curl tzdata

# Do not run as root.
RUN adduser --shell /bin/sh --disabled-password --gecos "" mockprox
USER mockprox

EXPOSE 3000

ENTRYPOINT ["mockprox-cli", "start", "--disable-log-to-file"]


