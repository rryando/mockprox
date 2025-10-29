import appendField from 'append-field';
import busboy from 'busboy';
import cookieParser from 'cookie-parser';
import { EventEmitter } from 'events';
import express, { Application, NextFunction, Request, Response } from 'express';
import { createReadStream, mkdirSync, readFile, readFileSync, statSync } from 'fs';
import {
  createServer as httpCreateServer,
  Server as httpServer
} from 'http';
import type {
  ClientRequest,
  IncomingMessage,
  OutgoingHttpHeaders,
  RequestListener
} from 'http';
import { createProxyMiddleware } from 'http-proxy-middleware';
import {
  createServer as httpsCreateServer,
  Server as httpsServer
} from 'https';
import killable from 'killable';
import { lookup as mimeTypeLookup } from 'mime-types';
import {
  BINARY_BODY,
  BodyTypes,
  CORSHeaders,
  Callback,
  CallbackInvocation,
  Environment,
  FileExtensionsWithTemplating,
  GetContentType,
  GetRouteResponseContentType,
  Header,
  IsValidURL,
  Methods,
  MimeTypesWithTemplating,
  ParsedJSONBodyMimeTypes,
  ParsedXMLBodyMimeTypes,
  ProcessedDatabucket,
  Route,
  RouteResponse,
  RouteType,
  ServerErrorCodes,
  ServerEvents,
  ServerOptions,
  StreamingMode,
  Transaction,
  ProxyLogBody,
  ProxyLogEntry,
  defaultEnvironmentVariablesPrefix,
  defaultMaxTransactionLogs,
  generateUUID,
  getLatency,
  stringIncludesArrayItems
} from 'mockprox-commons';
import { basename, extname, join } from 'path';
import { match } from 'path-to-regexp';
import { parse as qsParse } from 'qs';
import rangeParser from 'range-parser';
import { Readable } from 'stream';
import { SecureContextOptions } from 'tls';
import TypedEmitter from 'typed-emitter';
import { parse as parseUrl } from 'url';
import { format } from 'util';
import { WebSocket, WebSocketServer } from 'ws';
import { xml2js } from 'xml-js';
import { ServerMessages } from '../../constants/server-messages.constants';
import { DefaultTLSOptions } from '../../constants/ssl.constants';
import { SetFakerLocale, SetFakerSeed } from '../faker';
import { MockproxConfigLoader } from '../mockprox-config-loader';
import { ServerRequest, fromExpressRequest, fromWsRequest } from '../requests';
import { ResponseRulesInterpreter } from '../response-rules-interpreter';
import { TemplateParser } from '../template-parser';
import { requestHelperNames } from '../templating-helpers/request-helpers';
import {
  CreateCallbackInvocation,
  CreateInFlightRequest,
  CreateTransaction,
  TransformHeaders,
  dedupSlashes,
  isBodySupportingMethod,
  preparePath,
  resolvePathFromEnvironment,
  routesFromFolder,
} from '../utils';
import { createAdminEndpoint } from './admin-api';
import { CrudRouteIds, crudRoutesBuilder, databucketActions } from './crud';
import {
  BroadcastContext,
  DelegatedBroadcastHandler,
  getSafeStreamingInterval,
  isWebSocketOpen,
  messageToString,
  serveFileContentInWs
} from './ws';

type ProxyRequestMeta = {
  startedAt: number;
  mode: ProxyLogEntry['mode'];
  targetUrl: string;
  request: ProxyLogEntry['request'];
};

/**
 * Create a server instance from an Environment object.
 *
 * Extends EventEmitter.
 */
export class MockproxServer extends (EventEmitter as new () => TypedEmitter<ServerEvents>) {
  private serverInstance: httpServer | httpsServer;
  private docServerInstance: httpServer | httpsServer;
  private webSocketServers: WebSocketServer[] = [];
  private tlsOptions: SecureContextOptions = {};
  private processedDatabuckets: ProcessedDatabucket[] = [];
  // store the request number for each route
  private requestNumbers: Record<string, number> = {};
  // templating global variables
  private globalVariables: Record<string, any> = {};
  private options: ServerOptions = {
    disabledRoutes: [],
    envVarsPrefix: defaultEnvironmentVariablesPrefix,
    enableAdminApi: true,
    disableTls: false,
    maxTransactionLogs: defaultMaxTransactionLogs,
    enableRandomLatency: false,
    maxFileUploads: 10,
    maxFileSize: 10 * 1024 * 1024, // 10MB
    doc: false,
    docOutputPath: undefined
  };
  private transactionLogs: Transaction[] = [];
  private configLoader?: MockproxConfigLoader;
  private proxyRequestMeta = new WeakMap<Request, ProxyRequestMeta>();

  constructor(
    private environment: Environment,
    options: Partial<ServerOptions> = {},
    configLoader?: MockproxConfigLoader
  ) {
    super();

    this.configLoader = configLoader;
    this.options = {
      ...this.options,
      ...options,
      envVarsPrefix: options.envVarsPrefix ?? defaultEnvironmentVariablesPrefix
    };
  }

  /**
   * Start a server
   */
  public start(): void {
    const requestListener = this.createRequestListener();

    // Create and start documentation server if enabled
    if (this.options.doc) {
      const docApp = express();
      // Use custom output path if provided, otherwise use built-in public directory
      const publicPath = this.options.docOutputPath || join(__dirname, '../../../cjs/public');
      
      // Ensure public directory exists
      mkdirSync(publicPath, { recursive: true });
      
      docApp.use('/', express.static(publicPath));
      
      // Serve index.html at root endpoint with absolute path
      docApp.get('/', (req, res) => {
        res.sendFile(join(publicPath, 'index.html'));
      });

      // Serve the API spec
      docApp.get('/types.ts', (req, res) => {
        res.sendFile(join(publicPath, 'model/types.ts'));
      });

      docApp.get('/type', (req, res) => {
        res.type('text/plain').sendFile(join(publicPath, 'model/types.ts'));
      });

      // Create doc server on port + 1
      this.docServerInstance = httpCreateServer(docApp);
      this.docServerInstance = killable(this.docServerInstance);

      this.docServerInstance.listen(
        { port: this.environment.port + 1, host: this.environment.hostname },
        () => {
          this.emit('doc-server-started');
        }
      );

      this.docServerInstance.on('error', (error: NodeJS.ErrnoException) => {
        this.emit('error', ServerErrorCodes.UNKNOWN_SERVER_ERROR, error);
      });
    }

    const routes = this.getRoutesOfEnvironment();
    const webSocketRoutes = routes.filter((route) => {
      const routePath = preparePath(
        this.environment.endpointPrefix,
        route.endpoint
      );

      return (
        route.type === RouteType.WS &&
        !this.options.disabledRoutes?.some(
          (disabledRoute) =>
            route.uuid === disabledRoute || routePath.includes(disabledRoute)
        )
      );
    });

    // create https or http server instance
    if (this.environment.tlsOptions.enabled && !this.options.disableTls) {
      try {
        this.tlsOptions = this.buildTLSOptions(this.environment);

        this.serverInstance = httpsCreateServer(this.tlsOptions);
      } catch (error: any) {
        if (error.code === 'ENOENT') {
          this.emit('error', ServerErrorCodes.CERT_FILE_NOT_FOUND, error);
        } else {
          this.emit('error', ServerErrorCodes.UNKNOWN_SERVER_ERROR, error);
        }
      }
    } else {
      this.serverInstance = httpCreateServer();
    }

    // make serverInstance killable
    this.serverInstance = killable(this.serverInstance);

    // set timeout long enough to allow long latencies
    this.serverInstance.setTimeout(3_600_000);

    // handle server errors
    this.serverInstance.on('error', (error: NodeJS.ErrnoException) => {
      let errorCode: ServerErrorCodes;

      switch (error.code) {
        case 'EADDRINUSE':
          errorCode = ServerErrorCodes.PORT_ALREADY_USED;
          break;
        case 'EACCES':
          errorCode = ServerErrorCodes.PORT_INVALID;
          break;
        case 'EADDRNOTAVAIL':
          errorCode = ServerErrorCodes.HOSTNAME_UNAVAILABLE;
          break;
        case 'ENOTFOUND':
          errorCode = ServerErrorCodes.HOSTNAME_UNKNOWN;
          break;
        default:
          errorCode = ServerErrorCodes.UNKNOWN_SERVER_ERROR;
      }
      this.emit('error', errorCode, error);
    });

    this.serverInstance.on('request', requestListener);

    if (webSocketRoutes.length > 0) {
      this.createWSRoutes(webSocketRoutes);
    }

    try {
      this.serverInstance.listen(
        { port: this.environment.port, host: this.environment.hostname },
        () => {
          this.emit('started');
        }
      );
    } catch (error: any) {
      if (error.code === 'ERR_SOCKET_BAD_PORT') {
        this.emit('error', ServerErrorCodes.PORT_INVALID, error);
      }
    }
  }

  /**
   * Kill the server
   */
  public stop(): void {
    if (this.webSocketServers.length > 0) {
      this.webSocketServers.forEach((wss) => wss.close());
    }
    BroadcastContext.getInstance().closeAll();
    
    // Stop doc server if it exists
    if (this.docServerInstance) {
      this.docServerInstance.kill(() => {
        this.emit('doc-server-stopped');
      });
    }

    if (this.serverInstance) {
      this.serverInstance.kill(() => {
        this.emit('stopped');
      });
    }
  }

  /**
   * Create a request listener
   */
  public createRequestListener(): RequestListener {
    /**
     * Apply faker.js settings at each server start.
     * Locale must be set before seed.
     * We do this in the request listener to allow changing the locale and seed from the serverless package too, which is not using the start/stop methods.
     */
    SetFakerLocale(this.options.fakerOptions?.locale ?? 'en');
    SetFakerSeed(this.options.fakerOptions?.seed ?? undefined);

    const app = express();
    app.disable('x-powered-by');
    app.disable('etag');

    this.generateDatabuckets(this.environment);

    // This middleware is required to parse the body for createAdminEndpoint requests
    app.use(this.parseBody);

    if (this.options.enableAdminApi) {
      // admin endpoint must be created before all other routes to avoid conflicts
      createAdminEndpoint(app, {
        statePurgeCallback: () => {
          // reset request numbers
          Object.keys(this.requestNumbers).forEach((routeUUID) => {
            this.requestNumbers[routeUUID] = 1;
          });
        },
        getGlobalVariables: (key: string) => this.globalVariables[key],
        setGlobalVariables: (key: string, value: any) => {
          this.globalVariables[key] = value;
        },
        purgeGlobalVariables: () => {
          this.globalVariables = {};
        },
        getDataBuckets: (nameOrId: string) =>
          this.processedDatabuckets.find(
            (processedDatabucket) =>
              processedDatabucket.name === nameOrId ||
              processedDatabucket.id === nameOrId
          ),
        purgeDataBuckets: () => {
          this.processedDatabuckets = [];
          this.generateDatabuckets(this.environment);
        },
        getLogs: () => this.transactionLogs,
        purgeLogs: () => {
          this.transactionLogs = [];
        },
        envVarsPrefix: this.options.envVarsPrefix
      });
    }

    app.use(this.emitEvent);
    app.use(this.delayResponse);
    app.use(this.deduplicateRequestSlashes);
    app.use(cookieParser());
    app.use(this.logRequest);
    app.use(this.setResponseHeaders);

    // Add state selection middleware if config is loaded
    if (this.configLoader?.isLoaded()) {
      app.use(this.createStateMiddleware());
    }

    this.setCors(app);
    this.setRoutes(app);
    this.enableProxy(app);
    app.use(this.errorHandler);

    return app;
  }

  /**
   * ### Middleware ###
   * Emit the SERVER_ENTERING_REQUEST event
   *
   * @param request
   * @param response
   * @param next
   */
  private emitEvent = (
    request: Request,
    response: Response,
    next: NextFunction
  ) => {
    this.emit('entering-request');
    next();
  };

  /**
   * ### Middleware ###
   * Add global latency to the mock server
   *
   * @param request
   * @param response
   * @param next
   */
  private delayResponse = (
    request: Request,
    response: Response,
    next: NextFunction
  ) => {
    this.refreshEnvironment();

    setTimeout(
      next,
      getLatency(this.environment.latency, this.options.enableRandomLatency)
    );
  };

  /**
   * ### Middleware ###
   * Remove duplicate slashes in entering call paths
   *
   * @param request
   * @param response
   * @param next
   */
  private deduplicateRequestSlashes(
    request: Request,
    response: Response,
    next: NextFunction
  ) {
    request.url = dedupSlashes(request.url);

    next();
  }

  /**
   * Process the raw body and parse it if needed
   *
   * @param request
   * @param next
   * @param rawBody
   * @param requestContentType
   */
  private processRawBody(request, next, rawBody, requestContentType) {
    request.rawBody = Buffer.concat(rawBody);
    request.stringBody = request.rawBody.toString('utf8');

    try {
      if (requestContentType) {
        if (
          stringIncludesArrayItems(ParsedJSONBodyMimeTypes, requestContentType)
        ) {
          request.body = JSON.parse(request.stringBody);
          next();
        } else if (
          requestContentType.includes('application/x-www-form-urlencoded')
        ) {
          request.body = qsParse(request.stringBody, {
            depth: 10
          });
          next();
        } else if (requestContentType.includes('multipart/form-data')) {
          const busboyParse = busboy({
            headers: request.headers,
            limits: {
              fieldNameSize: 1000,
              files: this.options.maxFileUploads,
              fileSize: this.options.maxFileSize
            }
          });

          busboyParse.on('field', (name, value, info) => {
            if (request.body === undefined) {
              request.body = {};
            }

            if (name != null && !info.nameTruncated && !info.valueTruncated) {
              appendField(request.body, name, value);
            }
          });

          busboyParse.on(
            'file',
            (
              name: string,
              stream: Readable,
              info: { filename: string; encoding: string; mimeType: string }
            ) => {
              if (request.body === undefined) {
                request.body = {};
              }

              const file = {
                filename: info.filename,
                mimetype: info.mimeType,
                size: 0
              };

              stream.on('data', (data) => {
                file.size += data.length;
              });

              stream.on('close', () => {
                appendField(request.body, name, file);
              });
            }
          );

          busboyParse.on('error', (error: any) => {
            this.emit('error', ServerErrorCodes.REQUEST_BODY_PARSE, error);
            // we want to continue answering the call despite the parsing errors
            next();
          });

          busboyParse.on('finish', () => {
            next();
          });

          busboyParse.end(request.rawBody);
        } else if (
          stringIncludesArrayItems(ParsedXMLBodyMimeTypes, requestContentType)
        ) {
          request.body = xml2js(request.stringBody, {
            compact: true
          });
          next();
        } else {
          next();
        }
      } else {
        next();
      }
    } catch (error: any) {
      this.emit('error', ServerErrorCodes.REQUEST_BODY_PARSE, error);
      next();
    }
  }

  /**
   * ### Middleware ###
   * Parse entering request body
   *
   * @param request
   * @param response
   * @param next
   */

  private parseBody = (
    request: Request,
    response: Response,
    next: NextFunction
  ) => {
    // Parse body as a raw string and JSON/form if applicable
    const requestContentType: string | undefined =
      request.header('Content-Type');

    // body was already parsed (e.g. by firebase), 'data' event will not be emitted (⚠️ request.body will always be an empty object in Firebase Functions, we have to check rawBody too)
    if (!!request.body && request.rawBody) {
      this.processRawBody(request, next, [request.rawBody], requestContentType);
    } else {
      const rawBody: Buffer[] = [];

      request.on('data', (chunk) => {
        rawBody.push(Buffer.from(chunk, 'binary'));
      });

      request.on('end', () => {
        this.processRawBody(request, next, rawBody, requestContentType);
      });
    }
  };

  /**
   * ### Middleware ###
   * Emit an event when response emit the 'close' event
   *
   * @param request
   * @param response
   * @param next
   */
  private logRequest = (
    request: Request,
    response: Response,
    next: NextFunction
  ) => {
    response.on('close', () => {
      this.emit('transaction-complete', CreateTransaction(request, response));

      // store the transaction logs at beginning of the array
      this.transactionLogs.unshift(CreateTransaction(request, response));

      // keep only the last n transactions
      if (this.transactionLogs.length > this.options.maxTransactionLogs) {
        this.transactionLogs.pop();
      }
      if (this.transactionLogs.length > this.options.maxTransactionLogs) {
        this.transactionLogs = this.transactionLogs.slice(
          0,
          this.options.maxTransactionLogs
        );
      }
    });

    next();
  };

  /**
   * ### Middleware ###
   * Add environment headers & proxy headers to the response
   *
   * @param request
   * @param response
   * @param next
   */
  private setResponseHeaders = (
    request: Request,
    response: Response,
    next: NextFunction
  ) => {
    // Always add CORS headers to all responses (hardcoded for maximum compatibility)
    this.setHeaders([...CORSHeaders, ...this.environment.headers], response, request);

    next();
  };

  /**
   * Returns all defined routes in the setup environment.
   */
  private getRoutesOfEnvironment(): Route[] {
    if (
      !this.environment.rootChildren ||
      this.environment.rootChildren.length < 1
    ) {
      return [];
    }

    return routesFromFolder(
      this.environment.rootChildren,
      this.environment.folders,
      this.environment.routes
    );
  }

  /**
   * Generate an environment routes and attach to running server
   *
   * @param server - server on which attach routes
   */
  private setRoutes(server: Application) {
    if (
      !this.environment.rootChildren ||
      this.environment.rootChildren.length < 1
    ) {
      return;
    }

    const routes = routesFromFolder(
      this.environment.rootChildren,
      this.environment.folders,
      this.environment.routes,
      this.options.disabledRoutes
    );

    routes.forEach((declaredRoute: Route) => {
      const routePath = preparePath(
        this.environment.endpointPrefix,
        declaredRoute.endpoint
      );

      try {
        this.requestNumbers[declaredRoute.uuid] = 1;

        if (declaredRoute.type === RouteType.CRUD) {
          this.createCRUDRoute(server, declaredRoute, routePath);
        } else {
          this.createRESTRoute(server, declaredRoute, routePath);
        }
      } catch (error: any) {
        let errorCode = ServerErrorCodes.ROUTE_CREATION_ERROR;

        // if invalid regex defined
        if (error.message.indexOf('Invalid regular expression') > -1) {
          errorCode = ServerErrorCodes.ROUTE_CREATION_ERROR_REGEX;
        }

        this.emit('error', errorCode, error, {
          routePath: declaredRoute.endpoint,
          routeUUID: declaredRoute.uuid
        });
      }
    });
  }

  /**
   * Creates websocket routes from the given set of routes.
   *
   * @param wsRoutes
   */
  private createWSRoutes(wsRoutes: Route[]) {
    const envPath = this.environment.endpointPrefix
      ? `/${this.environment.endpointPrefix}`
      : '';

    wsRoutes.forEach((wsRoute) => {
      const webSocketServer = new WebSocket.Server({
        noServer: true,
        path: `${envPath}`
      });

      this.webSocketServers.push(webSocketServer);

      webSocketServer.on(
        'connection',
        this.createWebSocketConnectionHandler(webSocketServer, wsRoute)
      );

      const pathMatcherFn = match(
        wsRoute.endpoint.startsWith('/')
          ? wsRoute.endpoint
          : '/' + wsRoute.endpoint
      );

      this.serverInstance.on('upgrade', (req, socket, head) => {
        const urlParsed = parseUrl(req.url || '', true);
        if (pathMatcherFn(urlParsed.pathname || '')) {
          webSocketServer.handleUpgrade(req, socket, head, (client) => {
            webSocketServer.emit('connection', client, req);
          });
        }
      });
    });
  }

  /**
   * Creates a handler for a web socket connection recieved, if only any
   * of route is matched.
   *
   * @param webSocketServer
   * @param routeFor
   * @returns
   */
  private createWebSocketConnectionHandler(
    webSocketServer: WebSocketServer,
    routeFor: Route
  ) {
    return (socket: WebSocket, request: IncomingMessage) => {
      // Refresh the environment when a new client is connected.
      this.refreshEnvironment();
      const route = this.getRefreshedRoute(routeFor);

      if (!route) {
        this.emit('error', ServerErrorCodes.ROUTE_NO_LONGER_EXISTS, null, {
          routePath: routeFor.endpoint,
          routeUUID: routeFor.uuid
        });

        return;
      }

      const websocketId = generateUUID();
      const baseErrorMeta = {
        websocketId,
        routeUUID: route.uuid,
        routePath: route.endpoint
      };

      const inflightRequest = CreateInFlightRequest(
        websocketId,
        request,
        route
      );
      this.emit('ws-new-connection', inflightRequest);

      let responseNumber = 1;

      // handle error event
      socket.on('error', (err) => {
        this.emit(
          'error',
          ServerErrorCodes.WS_SERVING_ERROR,
          err,
          baseErrorMeta
        );
      });

      // handle common close method.
      // There would be more close methods registered, if the route is in streaming mode.
      socket.on('close', (code, reason) => {
        this.emit(
          'ws-closed',
          inflightRequest,
          code,
          reason ? reason.toString('utf8') : null
        );
      });

      const serverRequest = fromWsRequest(request, route);

      // This is not waiting until a messge from client. But will push messages as a stream.
      if (route.streamingMode === StreamingMode.BROADCAST) {
        this.handleBroadcastResponse(
          webSocketServer,
          socket,
          route,
          serverRequest,
          baseErrorMeta
        );

        return;
      } else if (route.streamingMode === StreamingMode.UNICAST) {
        this.handleOneToOneStreamingResponses(
          socket,
          route,
          request,
          baseErrorMeta
        );

        return;
      }

      socket.on('message', (data, isBinary) => {
        if (isBinary) {
          this.emit(
            'error',
            ServerErrorCodes.WS_UNSUPPORTED_CONTENT,
            null,
            baseErrorMeta
          );

          return;
        }

        // Refresh the environment when a new message is recieved.
        this.refreshEnvironment();
        const routeInMessage = this.getRefreshedRoute(route);

        // the route is not found. Skip reacting.
        if (!routeInMessage) {
          this.emit(
            'error',
            ServerErrorCodes.WS_UNKNOWN_ROUTE,
            null,
            baseErrorMeta
          );

          return;
        }

        // get the incoming message as string...
        const messageData = messageToString(data);
        this.emit('ws-message-received', inflightRequest, messageData);

        const enabledRouteResponse = new ResponseRulesInterpreter(
          routeInMessage.responses,
          serverRequest,
          routeInMessage.responseMode,
          this.environment,
          this.processedDatabuckets,
          this.globalVariables,
          this.options.envVarsPrefix
        ).chooseResponse(responseNumber, messageData);

        if (!enabledRouteResponse) {
          // Do nothing?
          return;
        }

        responseNumber += 1;

        setTimeout(() => {
          const content = this.deriveFinalResponseContentForWebSockets(
            socket,
            routeInMessage,
            enabledRouteResponse,
            request,
            messageData
          );

          if (content) {
            socket.send(content || '', (err) => {
              if (err) {
                this.emit('error', ServerErrorCodes.WS_SERVING_ERROR, err, {
                  ...baseErrorMeta,
                  selectedResponseUUID: enabledRouteResponse.uuid,
                  selectedResponseLabel: enabledRouteResponse.label
                });
              }
            });
          }
        }, enabledRouteResponse.latency);
      });
    };
  }

  /**
   * Derive final delivery content for websocket response.
   *
   * If no content is returned, that means the relevant content has been served,
   * or a failure has occurred. These scenarios can happen with file body type
   * and should be handled properly by the callers.
   *
   * @param socket
   * @param route
   * @param enabledRouteResponse
   * @param request
   * @param data
   */
  private deriveFinalResponseContentForWebSockets(
    socket: WebSocket,
    route: Route,
    enabledRouteResponse: RouteResponse,
    request?: IncomingMessage,
    data?: string,
    connectedRequest?: ServerRequest
  ): string | undefined {
    let content: any = enabledRouteResponse.body;
    let finalRequest = connectedRequest;
    if (!finalRequest) {
      finalRequest = request ? fromWsRequest(request, route, data) : undefined;
    }

    if (
      enabledRouteResponse.bodyType === BodyTypes.DATABUCKET &&
      enabledRouteResponse.databucketID
    ) {
      const servedDatabucket = this.processedDatabuckets.find(
        (processedDatabucket) =>
          processedDatabucket.id === enabledRouteResponse.databucketID
      );

      if (servedDatabucket) {
        content = servedDatabucket.value;

        if (
          Array.isArray(content) ||
          typeof content === 'object' ||
          typeof content === 'boolean' ||
          typeof content === 'number'
        ) {
          content = JSON.stringify(content);
        }
      }
    } else if (
      enabledRouteResponse.bodyType === BodyTypes.FILE &&
      enabledRouteResponse.filePath
    ) {
      const templateParser = (contentData: string) =>
        TemplateParser({
          shouldOmitDataHelper: false,
          content: contentData,
          environment: this.environment,
          processedDatabuckets: this.processedDatabuckets,
          globalVariables: this.globalVariables,
          request: finalRequest,
          envVarsPrefix: this.options.envVarsPrefix
        });

      // resolve file location
      let filePath = templateParser(
        enabledRouteResponse.filePath.replace(/\\/g, '/')
      );
      filePath = resolvePathFromEnvironment(
        filePath,
        this.options.environmentDirectory
      );

      serveFileContentInWs(
        socket,
        route,
        enabledRouteResponse,
        this,
        filePath,
        templateParser
      );

      return;
    }

    if (!enabledRouteResponse.disableTemplating) {
      content = TemplateParser({
        shouldOmitDataHelper: false,
        content: content || '',
        environment: this.environment,
        processedDatabuckets: this.processedDatabuckets,
        globalVariables: this.globalVariables,
        request: finalRequest,
        envVarsPrefix: this.options.envVarsPrefix
      });
    }

    return content;
  }

  private handleBroadcastResponse(
    webSocketServer: WebSocketServer,
    socket: WebSocket,
    route: Route,
    request: ServerRequest,
    baseErrorMeta: any
  ) {
    const broadcastContext = BroadcastContext.getInstance();
    const handler: DelegatedBroadcastHandler = (
      _: number,
      enabledRouteResponse: RouteResponse
    ) => {
      // todo: do we need to take params from initial connection at all?
      const content =
        this.deriveFinalResponseContentForWebSockets(
          socket,
          route,
          enabledRouteResponse,
          undefined,
          undefined,
          request
        ) || '';

      if (!content) {
        return;
      }

      const errorMetaData = {
        ...baseErrorMeta,
        selectedResponseUUID: enabledRouteResponse.uuid,
        selectedResponseLabel: enabledRouteResponse.label
      };

      webSocketServer.clients.forEach((client) => {
        if (isWebSocketOpen(client)) {
          this.serveWsResponse(client, content, errorMetaData);
        }
      });
    };

    broadcastContext.registerRoute(
      route,
      {
        environment: this.environment,
        processedDatabuckets: this.processedDatabuckets,
        globalVariables: this.globalVariables,
        envVarPrefix: this.options.envVarsPrefix
      },
      request,
      handler
    );
  }

  /**
   * Handle streaming websocket responses.
   *
   * @param socket
   * @param route
   * @param request
   * @param baseErrorMeta
   */
  private handleOneToOneStreamingResponses(
    socket: WebSocket,
    route: Route,
    request: IncomingMessage,
    baseErrorMeta: any
  ) {
    let responseNumber = 1;

    const intervalRef = setInterval(() => {
      const enabledRouteResponse = new ResponseRulesInterpreter(
        route.responses,
        fromWsRequest(request, route),
        route.responseMode,
        this.environment,
        this.processedDatabuckets,
        this.globalVariables,
        this.options.envVarsPrefix
      ).chooseResponse(responseNumber);

      if (!enabledRouteResponse) {
        return;
      }

      const content =
        this.deriveFinalResponseContentForWebSockets(
          socket,
          route,
          enabledRouteResponse,
          request
        ) || '';

      responseNumber += 1;

      if (!content) {
        return;
      }

      const errorMetaData = {
        ...baseErrorMeta,
        selectedResponseUUID: enabledRouteResponse.uuid,
        selectedResponseLabel: enabledRouteResponse.label
      };

      if (route.streamingMode === StreamingMode.UNICAST) {
        if (isWebSocketOpen(socket)) {
          this.serveWsResponse(socket, content, errorMetaData);
        }
      }
    }, getSafeStreamingInterval(route.streamingInterval));

    socket.on('close', () => {
      // close any interval data pushes
      if (intervalRef) {
        clearInterval(intervalRef);
      }
    });
  }

  /**
   * Sends given response data to the socket client.
   *
   * @param client
   * @param content
   * @param errorMetaData
   */
  private serveWsResponse(
    client: WebSocket,
    content: string,
    errorMetaData: any
  ) {
    client.send(content, (err) => {
      if (err) {
        this.emit(
          'error',
          ServerErrorCodes.WS_SERVING_ERROR,
          err,
          errorMetaData
        );
      }
    });
  }

  /**
   * Create a regular REST route (GET, POST, etc.)
   *
   * @param server
   * @param route
   * @param routePath
   */
  private createRESTRoute(
    server: Application,
    route: Route,
    routePath: string
  ) {
    server[route.method](routePath, this.createRouteHandler(route));
  }

  /**
   * Create a CRUD route: GET, POST, PUT, PATCH, DELETE
   *
   * @param server
   * @param route
   * @param routePath
   */
  private createCRUDRoute(
    server: Application,
    route: Route,
    routePath: string
  ) {
    const crudRoutes = crudRoutesBuilder(routePath);

    for (const crudRoute of crudRoutes) {
      server[crudRoute.method](
        crudRoute.path,
        this.createRouteHandler(route, crudRoute.id)
      );
    }
  }


  private createRouteHandler(route: Route, crudId?: CrudRouteIds) {
    return async (request: Request, response: Response, next: NextFunction) => {
      // Handle proxy first if enabled
      if (
        this.environment.proxyFirst &&
        this.environment.proxyMode &&
        IsValidURL(this.environment.proxyHost)
      ) {
        const proxyTargetUrl = this.buildProxyTargetUrlFromRequest(request);
        const proxyMeta = this.createProxyRequestMeta(
          request,
          'proxy-first',
          proxyTargetUrl
        );

        try {
          request.proxied = true;

          const proxyOptions: RequestInit = {
            method: request.method,
            headers: this.headersFromIncoming(request.headers)
          };

          const forwardedRequestHeaders = this.headersFromHeadersInit(
            proxyOptions.headers
          );

          if (Object.keys(forwardedRequestHeaders).length > 0) {
            proxyMeta.request.forwardedHeaders = forwardedRequestHeaders;
          }

          const requestBodyForProxy = this.extractProxyRequestBody(request);

          if (
            requestBodyForProxy !== undefined &&
            isBodySupportingMethod(request.method.toLowerCase() as Methods)
          ) {
            proxyOptions.body = requestBodyForProxy;
          }

          const proxyResponse = await fetch(proxyTargetUrl, proxyOptions);
          const responseHeaders = this.headersFromFetch(proxyResponse.headers);
          const responseHeaderArray: Header[] = Object.entries(
            responseHeaders
          ).map(([key, value]) => ({ key, value }));
          const corsHeaders = CORSHeaders.map((header) => ({
            key: header.key,
            value: header.value
          }));
          const finalHeaders = [...corsHeaders, ...responseHeaderArray];

          const hasBody = Boolean(proxyResponse.body);
          let responseBodyContent: string | object | undefined;
          let responseBodyLog: ProxyLogBody | undefined;

          if (hasBody) {
            const parsedBody = await this.parseProxyResponseBody(proxyResponse);
            responseBodyContent = parsedBody.content;
            responseBodyLog = parsedBody.bodyLog;
          }

          const responseSnapshot: ProxyLogEntry['response'] = {
            status: proxyResponse.status,
            statusText: proxyResponse.statusText,
            headers: responseHeaders,
            forwardedHeaders: this.headersFromArray(finalHeaders)
          };

          if (responseBodyLog) {
            responseSnapshot.body = responseBodyLog;
          }

          const proxyLogBase: Omit<ProxyLogEntry, 'id' | 'timestamp'> = {
            level: this.determineProxyLogLevel(proxyResponse.status),
            mode: proxyMeta.mode,
            targetUrl: proxyMeta.targetUrl,
            durationMs: Date.now() - proxyMeta.startedAt,
            request: proxyMeta.request,
            response: responseSnapshot
          };

          if (
            proxyResponse.status < 400 &&
            hasBody &&
            responseBodyContent !== undefined
          ) {
            this.emitProxyLog(proxyLogBase);

            this.serveBody(
              responseBodyContent as any,
              route,
              {
                ...route.responses[0],
                statusCode: proxyResponse.status,
                headers: finalHeaders,
                bodyType: BodyTypes.INLINE,
                disableTemplating: true
              },
              request,
              response,
              false
            );

            if (responseBodyContent) {
              response.end();
            }

            return;
          }

          const noteParts: string[] = [];

          if (!hasBody) {
            noteParts.push('Upstream response did not include a body.');
          }

          if (proxyResponse.status >= 400) {
            noteParts.push(
              `Upstream returned status ${proxyResponse.status}; falling back to mock response.`
            );
          }

          this.emitProxyLog({
            ...proxyLogBase,
            note: noteParts.length ? noteParts.join(' ') : undefined
          });
        } catch (error) {
          this.emitProxyLog({
            level: 'error',
            mode: proxyMeta.mode,
            targetUrl: proxyMeta.targetUrl,
            durationMs: Date.now() - proxyMeta.startedAt,
            request: proxyMeta.request,
            error: error instanceof Error ? error.message : String(error),
            errorStack: error instanceof Error ? error.stack : undefined
          });

          // Log proxy error but continue to mock route
          this.emit(
            'error',
            ServerErrorCodes.PROXY_ERROR,
            error instanceof Error ? error : new Error(String(error))
          );
        }
      }
      
      this.generateRequestDatabuckets(route, this.environment, request);

      // refresh environment data to get route changes that do not require a restart (headers, body, etc)
      this.refreshEnvironment();
      const currentRoute = this.getRefreshedRoute(route);

      if (!currentRoute) {
        this.emit('error', ServerErrorCodes.ROUTE_NO_LONGER_EXISTS, null, {
          routePath: route.endpoint,
          routeUUID: route.uuid
        });

        this.sendError(response, ServerMessages.ROUTE_NO_LONGER_EXISTS, 404);

        return;
      }

      let enabledRouteResponse: RouteResponse | undefined;

      // Check config for URL state override
      if (this.configLoader?.isLoaded()) {
        const requestState = (request as any).mockproxState;
        const routePattern = `${request.method} ${route.endpoint}`;

        const urlState = this.configLoader.getUrlState(
          routePattern,
          requestState
        );

        if (urlState) {
          // Check if there are explicit overrides
          const hasOverrides = urlState.statusCode || urlState.body || urlState.headers;
          
          if (hasOverrides) {
            // Explicit overrides provided - use them
            enabledRouteResponse = {
              ...currentRoute.responses[0], // Start with first route response as base
              statusCode: urlState.statusCode ?? 200,
              body: urlState.body ?? currentRoute.responses[0]?.body ?? '',
              headers:
                urlState.headers ?? currentRoute.responses[0]?.headers ?? []
            };
          } else if (urlState.state !== 'random') {
            // State without overrides - intelligently select from available responses
            // "success" -> 2xx, "fail" -> 4xx/5xx, custom -> try to match
            enabledRouteResponse = this.selectResponseByState(
              currentRoute.responses,
              urlState.state
            );
          }
          // If state is "random" with no overrides, fall through to normal selection
        }
      }

      // Fall back to route's own response selection if no config override
      if (!enabledRouteResponse) {
        const chosenResponse = new ResponseRulesInterpreter(
          currentRoute.responses,
          fromExpressRequest(request),
          currentRoute.responseMode,
          this.environment,
          this.processedDatabuckets,
          this.globalVariables,
          this.options.envVarsPrefix
        ).chooseResponse(this.requestNumbers[route.uuid]);

        enabledRouteResponse = chosenResponse ?? undefined;
      }

      if (!enabledRouteResponse) {
        return next();
      }

      this.requestNumbers[route.uuid] += 1;

      // save route and response UUIDs for logs (only in desktop app)
      if (route.uuid && enabledRouteResponse.uuid) {
        response.routeUUID = route.uuid;
        response.routeResponseUUID = enabledRouteResponse.uuid;
      }

      const latency = getLatency(
        enabledRouteResponse.latency,
        this.options.enableRandomLatency
      );

      // add route latency if any
      setTimeout(() => {
        const contentType = GetRouteResponseContentType(
          this.environment,
          enabledRouteResponse
        );
        const routeContentType = GetContentType(enabledRouteResponse.headers);

        // set http code
        response.status(enabledRouteResponse.statusCode);

        this.setHeaders(enabledRouteResponse.headers, response, request);

        // send the file
        if (
          enabledRouteResponse.bodyType === BodyTypes.FILE &&
          enabledRouteResponse.filePath
        ) {
          this.sendFile(
            route,
            enabledRouteResponse,
            routeContentType,
            request,
            response
          );

          // serve inline body or databucket
        } else {
          let templateParse = true;

          if (contentType.includes('application/json')) {
            response.set('Content-Type', 'application/json');
          }

          // serve inline body as default
          let content: any = enabledRouteResponse.body;

          if (
            enabledRouteResponse.bodyType === BodyTypes.DATABUCKET &&
            enabledRouteResponse.databucketID
          ) {
            // databuckets are parsed at the server start or beginning of first request execution (no need to parse templating again)
            templateParse = false;

            const servedDatabucket = this.processedDatabuckets.find(
              (processedDatabucket) =>
                processedDatabucket.id === enabledRouteResponse.databucketID
            );

            if (servedDatabucket) {
              content = servedDatabucket.value;

              if (route.type === RouteType.CRUD && crudId) {
                content = databucketActions(
                  crudId,
                  servedDatabucket,
                  request,
                  response,
                  currentRoute.responses[0].crudKey
                );
              }

              // if returned content is an array or object we need to stringify it for some values (array, object, booleans and numbers (bool and nb because expressjs cannot serve this as is))
              if (
                Array.isArray(content) ||
                typeof content === 'object' ||
                typeof content === 'boolean' ||
                typeof content === 'number'
              ) {
                content = JSON.stringify(content);
              }
            }
          }

          this.serveBody(
            content || '',
            route,
            enabledRouteResponse,
            request,
            response,
            templateParse
          );
        }
      }, latency);
    };
  }

  private makeCallbacks(
    routeResponse: RouteResponse,
    request: Request,
    response: Response
  ) {
    if (routeResponse.callbacks && routeResponse.callbacks.length > 0) {
      const serverRequest = fromExpressRequest(request);
      for (const invocation of routeResponse.callbacks) {
        const cb = this.environment.callbacks.find(
          (ref) => ref.uuid === invocation.uuid
        );

        if (!cb) {
          continue;
        }

        try {
          const url = TemplateParser({
            shouldOmitDataHelper: false,
            content: cb.uri,
            environment: this.environment,
            processedDatabuckets: this.processedDatabuckets,
            globalVariables: this.globalVariables,
            request: serverRequest,
            response,
            envVarsPrefix: this.options.envVarsPrefix
          });

          let content = cb.body;
          let templateParse = true;

          if (cb.bodyType === BodyTypes.DATABUCKET && cb.databucketID) {
            templateParse = false;

            const servedDatabucket = this.processedDatabuckets.find(
              (processedDatabucket) =>
                processedDatabucket.id === cb.databucketID
            );

            if (servedDatabucket) {
              content = servedDatabucket.value;

              // if returned content is an array or object we need to stringify it for some values (array, object, booleans and numbers (bool and nb because expressjs cannot serve this as is))
              if (
                Array.isArray(content) ||
                typeof content === 'object' ||
                typeof content === 'boolean' ||
                typeof content === 'number'
              ) {
                content = JSON.stringify(content);
              }
            }
          } else if (cb.bodyType === BodyTypes.FILE && cb.filePath) {
            this.sendFileWithCallback(
              routeResponse,
              cb,
              invocation,
              request,
              response
            );

            continue;
          }

          const sendingHeaders = {
            headers: {}
          };
          this.setHeaders(cb.headers || [], sendingHeaders, request);

          // apply templating if specified
          if (!routeResponse.disableTemplating && templateParse) {
            content = TemplateParser({
              shouldOmitDataHelper: false,
              content: content || '',
              environment: this.environment,
              processedDatabuckets: this.processedDatabuckets,
              globalVariables: this.globalVariables,
              request: serverRequest,
              response,
              envVarsPrefix: this.options.envVarsPrefix
            });
          }

          setTimeout(() => {
            fetch(url, {
              // uppercase even if most methods will work in lower case, but PACTH has to be uppercase or could be rejected by some servers (Node.js)
              method: cb.method.toUpperCase(),
              headers: sendingHeaders.headers,
              body: isBodySupportingMethod(cb.method) ? content : undefined
            })
              .then((res) => {
                this.emitCallbackInvoked(
                  res,
                  cb,
                  url,
                  content,
                  sendingHeaders.headers
                );
              })
              .catch((e) =>
                this.emit('error', ServerErrorCodes.CALLBACK_ERROR, e, {
                  callbackName: cb.name
                })
              );
          }, invocation.latency);
        } catch (error: any) {
          this.emit('error', ServerErrorCodes.CALLBACK_ERROR, error, {
            callbackName: cb.name
          });
        }
      }
    }
  }

  /**
   * Parse the body templating and send it as the response body
   *
   * @param routeResponse
   * @param request
   * @param response
   */
  private serveBody(
    content: string,
    route: Route,
    routeResponse: RouteResponse,
    request: Request,
    response: Response,
    templateParse = true
  ) {
    try {
      if (!routeResponse.disableTemplating && templateParse) {
        content = TemplateParser({
          shouldOmitDataHelper: false,
          content: content || '',
          environment: this.environment,
          processedDatabuckets: this.processedDatabuckets,
          globalVariables: this.globalVariables,
          request: fromExpressRequest(request),
          response,
          envVarsPrefix: this.options.envVarsPrefix
        });
      }

      this.applyResponseLocals(response);

      response.body = content;

      // execute callbacks after generating the template, to be able to use the eventual templating variables in the callback
      this.makeCallbacks(routeResponse, request, response);

      response.send(content);
    } catch (error: any) {
      this.emit('error', ServerErrorCodes.ROUTE_SERVING_ERROR, error, {
        routePath: route.endpoint,
        routeUUID: route.uuid
      });

      this.sendError(
        response,
        format(ServerMessages.ROUTE_SERVING_ERROR, error.message)
      );
    }
  }

  private sendFileWithCallback(
    routeResponse: RouteResponse,
    callback: Callback,
    invocation: CallbackInvocation,
    request: Request,
    response: Response
  ) {
    if (!callback.filePath) {
      return;
    }

    const fileServingError = (error) => {
      this.emit('error', ServerErrorCodes.CALLBACK_FILE_ERROR, error, {
        callbackName: callback.name
      });
    };

    const serverRequest = fromExpressRequest(request);
    try {
      const url = TemplateParser({
        shouldOmitDataHelper: false,
        content: callback.uri,
        environment: this.environment,
        processedDatabuckets: this.processedDatabuckets,
        globalVariables: this.globalVariables,
        request: serverRequest,
        response,
        envVarsPrefix: this.options.envVarsPrefix
      });

      let filePath = TemplateParser({
        shouldOmitDataHelper: false,
        content: callback.filePath.replace(/\\/g, '/'),
        environment: this.environment,
        processedDatabuckets: this.processedDatabuckets,
        globalVariables: this.globalVariables,
        request: serverRequest,
        envVarsPrefix: this.options.envVarsPrefix
      });

      filePath = resolvePathFromEnvironment(
        filePath,
        this.options.environmentDirectory
      );

      const fileMimeType = mimeTypeLookup(filePath) || '';

      const sendingHeaders = {
        headers: {}
      };
      this.setHeaders(callback.headers || [], sendingHeaders, request);

      const definedContentType = sendingHeaders.headers['Content-Type'];

      // parse templating for a limited list of mime types

      try {
        if (!callback.sendFileAsBody) {
          const buffer = readFileSync(filePath);
          const form = new FormData();
          form.append('file', new Blob([buffer]));

          setTimeout(() => {
            fetch(url, {
              // uppercase even if most methods will work in lower case, but PACTH has to be uppercase or could be rejected by some servers (Node.js)
              method: callback.method.toUpperCase(),
              body: form,
              headers: sendingHeaders.headers
            })
              .then((res) => {
                this.emitCallbackInvoked(
                  res,
                  callback,
                  url,
                  `<buffer of ${filePath}`,
                  sendingHeaders.headers
                );
              })
              .catch((e) =>
                this.emit('error', ServerErrorCodes.CALLBACK_ERROR, e, {
                  callbackName: callback.name
                })
              );
          }, invocation.latency);
        } else {
          const data = readFileSync(filePath);
          let fileContent;
          if (
            MimeTypesWithTemplating.includes(fileMimeType) &&
            !routeResponse.disableTemplating
          ) {
            fileContent = TemplateParser({
              shouldOmitDataHelper: false,
              content: data.toString(),
              environment: this.environment,
              processedDatabuckets: this.processedDatabuckets,
              globalVariables: this.globalVariables,
              request: serverRequest,
              response,
              envVarsPrefix: this.options.envVarsPrefix
            });
          } else {
            fileContent = data.toString();
          }

          // set content-type the detected mime type if any
          if (!definedContentType && fileMimeType) {
            sendingHeaders.headers['Content-Type'] = fileMimeType;
          }

          setTimeout(() => {
            fetch(url, {
              // uppercase even if most methods will work in lower case, but PACTH has to be uppercase or could be rejected by some servers (Node.js)
              method: callback.method.toUpperCase(),
              headers: sendingHeaders.headers,
              body: fileContent
            })
              .then((res) => {
                this.emitCallbackInvoked(
                  res,
                  callback,
                  url,
                  fileContent,
                  sendingHeaders.headers
                );
              })
              .catch((e) =>
                this.emit('error', ServerErrorCodes.CALLBACK_ERROR, e, {
                  callbackName: callback.name
                })
              );
          }, invocation.latency);
        }
      } catch (error: any) {
        fileServingError(error);
      }
    } catch (error: any) {
      fileServingError(error);
    }
  }

  /**
   * Send a file as response body.
   * Revert to sendBody if file is not found.
   *
   * @param routeResponse
   * @param routeContentType
   * @param request
   * @param response
   */
  private sendFile(
    route: Route,
    routeResponse: RouteResponse,
    routeContentType: string | null,
    request: Request,
    response: Response
  ) {
    const fileServingError = (error) => {
      this.emit('error', ServerErrorCodes.ROUTE_FILE_SERVING_ERROR, error, {
        routePath: route.endpoint,
        routeUUID: route.uuid
      });
      this.sendError(
        response,
        format(ServerMessages.ROUTE_FILE_SERVING_ERROR, error.message)
      );
    };

    const errorThrowOrFallback = (error) => {
      if (routeResponse.fallbackTo404) {
        response.status(404);
        const content = routeResponse.body ? routeResponse.body : '';
        this.serveBody(content, route, routeResponse, request, response);
      } else {
        fileServingError(error);
      }
    };

    const serverRequest = fromExpressRequest(request);
    try {
      let filePath = TemplateParser({
        shouldOmitDataHelper: false,
        content: routeResponse.filePath.replace(/\\/g, '/'),
        environment: this.environment,
        processedDatabuckets: this.processedDatabuckets,
        globalVariables: this.globalVariables,
        request: serverRequest,
        envVarsPrefix: this.options.envVarsPrefix
      });

      filePath = resolvePathFromEnvironment(
        filePath,
        this.options.environmentDirectory
      );

      const fileMimeType = mimeTypeLookup(filePath) || '';

      // set content-type the detected mime type if any
      if (!routeContentType && fileMimeType) {
        response.set('Content-Type', fileMimeType);
      }

      if (!routeResponse.sendFileAsBody) {
        response.set(
          'Content-Disposition',
          `attachment; filename="${basename(filePath)}"`
        );
      }

      // parse templating for a limited list of mime types
      if (
        (MimeTypesWithTemplating.includes(fileMimeType) ||
          FileExtensionsWithTemplating.includes(extname(filePath))) &&
          !routeResponse.disableTemplating
      ) {
        readFile(filePath, (readError, data) => {
          if (readError) {
            errorThrowOrFallback(readError);

            return;
          }

          try {
            const fileContent = TemplateParser({
              shouldOmitDataHelper: false,
              content: data.toString(),
              environment: this.environment,
              processedDatabuckets: this.processedDatabuckets,
              globalVariables: this.globalVariables,
              request: serverRequest,
              response,
              envVarsPrefix: this.options.envVarsPrefix
            });

            this.applyResponseLocals(response);

            response.body = fileContent;

            // execute callbacks after generating the file content, to be able to use the eventual templating variables in the callback
            this.makeCallbacks(routeResponse, request, response);

            response.send(fileContent);
          } catch (error: any) {
            fileServingError(error);
          }
        });
      } else {
        try {
          const rangeHeader = request.headers.range;
          const { size } = statSync(filePath);
          response.body = BINARY_BODY;
          let stream = createReadStream(filePath);

          this.setHeaders(
            [
              {
                key: 'Content-Length',
                value: size.toString()
              }
            ],
            response,
            request
          );

          if (rangeHeader) {
            const parsedRange = rangeParser(size, rangeHeader);

            // unsatisfiable range
            if (parsedRange === -1) {
              this.sendError(response, 'Requested range not satisfiable', 416);

              return;
            } else if (parsedRange === -2) {
              // malformed header
              this.sendError(response, 'Malformed range header', 400);

              return;
            } else if (parsedRange) {
              const start = parsedRange[0].start;
              const end = parsedRange[0].end;
              const chunksize = end - start + 1;
              stream = createReadStream(filePath, { start, end });

              this.setHeaders(
                [
                  {
                    key: 'Content-Range',
                    value: `bytes ${start}-${end}/${size}`
                  },
                  {
                    key: 'Accept-Ranges',
                    value: 'bytes'
                  },
                  {
                    key: 'Content-Length',
                    value: chunksize.toString()
                  },
                  {
                    key: 'Content-Type',
                    value: fileMimeType
                  }
                ],
                response,
                request
              );

              response.status(206);
              stream = createReadStream(filePath, { start, end });
            }
          }

          this.makeCallbacks(routeResponse, request, response);

          stream.pipe(response);
        } catch (error: any) {
          errorThrowOrFallback(error);
        }
      }
    } catch (error: any) {
      this.emit('error', ServerErrorCodes.ROUTE_SERVING_ERROR, error, {
        routePath: route.endpoint,
        routeUUID: route.uuid
      });

      this.sendError(
        response,
        format(ServerMessages.ROUTE_SERVING_ERROR, error.message)
      );
    }
  }

  /**
   * Create middleware to handle state selection via query param
   */
  private createStateMiddleware() {
    return (req: Request, res: Response, next: NextFunction) => {
      // Check for ?state=<stateName> query param
      const stateParam = req.query.state as string | undefined;
      
      if (stateParam && this.configLoader) {
        // Store state in request for later use
        (req as any).mockproxState = stateParam;
      }
      
      next();
    };
  }

  /**
   * Always answer with status 200 to CORS pre flight OPTIONS requests.
   * /!\ Must be called after the routes creation otherwise it will intercept all user defined OPTIONS routes.
   *
   * @param server - express instance
   */
  private setCors(server: Application) {
    // Always handle CORS preflight requests (hardcoded for maximum compatibility)
    server.options('/*', (req, res) => {
      this.refreshEnvironment();

      // override default CORS headers with environment's headers
      this.setHeaders(
        [...CORSHeaders, ...this.environment.headers],
        res,
        req
      );

      res.status(200).end();
    });
  }

  /**
   * Add catch-all proxy if enabled.
   * Restream the body to the proxied API because it already has been
   * intercepted by the body parser.
   *
   * @param server - server on which to launch the proxy
   */
  private enableProxy(server: Application) {
    if (
      this.environment.proxyMode &&
      this.environment.proxyHost &&
      IsValidURL(this.environment.proxyHost)
    ) {
      this.emit('creating-proxy');

      server.use(
        createProxyMiddleware({
          cookieDomainRewrite: { '*': '' },
          target: this.environment.proxyHost,
          secure: false,
          changeOrigin: true,
          pathRewrite: (path) => {
            if (
              this.environment.proxyRemovePrefix === true &&
              this.environment.endpointPrefix.length > 0
            ) {
              const regExp = new RegExp(`^/${this.environment.endpointPrefix}`);

              return path.replace(regExp, '');
            }

            return path;
          },
          ssl: { ...this.tlsOptions, agent: false },
          on: {
            proxyReq: (proxyReq, request) => {
              this.refreshEnvironment();

              const expressRequest = request as Request;
              expressRequest.proxied = true;

              const proxyMeta = this.createProxyRequestMeta(
                expressRequest,
                'proxy-middleware',
                this.buildProxyMiddlewareTargetUrl(proxyReq)
              );

              this.proxyRequestMeta.set(expressRequest, proxyMeta);

              this.setHeaders(
                this.environment.proxyReqHeaders,
                proxyReq,
                expressRequest
              );

              proxyMeta.request.forwardedHeaders = this.headersFromOutgoing(
                proxyReq.getHeaders()
              );

              const rawBody = this.extractProxyRequestBody(expressRequest);

              if (rawBody instanceof Buffer && rawBody.length > 0) {
                proxyReq.write(rawBody);
              }
            },
            proxyRes: (proxyRes, request, response) => {
              this.refreshEnvironment();

              const expressRequest = request as Request;
              const meta = this.proxyRequestMeta.get(expressRequest);

              const upstreamHeadersRecord = this.headersFromArray(
                TransformHeaders(proxyRes.headers)
              );

              const buffers: Buffer[] = [];
              proxyRes.on('data', (chunk) => {
                buffers.push(chunk);
              });
              proxyRes.on('end', () => {
                response.body = Buffer.concat(buffers);

                const forwardedHeadersRecord = this.headersFromArray(
                  TransformHeaders(proxyRes.headers)
                );

                const responseSnapshot: ProxyLogEntry['response'] = {
                  status: proxyRes.statusCode ?? 0,
                  statusText: proxyRes.statusMessage ?? '',
                  headers: upstreamHeadersRecord,
                  forwardedHeaders: forwardedHeadersRecord
                };

                const responseBodyLog = this.createProxyLogBody(response.body);

                if (responseBodyLog) {
                  responseSnapshot.body = responseBodyLog;
                }

                const expressForwardedHeaders = this.headersFromOutgoing(
                  response.getHeaders() as OutgoingHttpHeaders
                );

                if (Object.keys(expressForwardedHeaders).length > 0) {
                  responseSnapshot.forwardedHeaders = {
                    ...responseSnapshot.forwardedHeaders,
                    ...expressForwardedHeaders
                  };
                }

                const targetUrl =
                  meta?.targetUrl ??
                  this.buildProxyTargetUrlFromRequest(expressRequest);

                const requestLog =
                  meta?.request ??
                  this.buildProxyRequestSnapshot(expressRequest, targetUrl);

                this.emitProxyLog({
                  level: this.determineProxyLogLevel(responseSnapshot.status),
                  mode: meta?.mode ?? 'proxy-middleware',
                  targetUrl,
                  durationMs: meta ? Date.now() - meta.startedAt : undefined,
                  request: requestLog,
                  response: responseSnapshot
                });

                this.proxyRequestMeta.delete(expressRequest);
              });

              this.setHeaders(
                this.environment.proxyResHeaders,
                proxyRes,
                expressRequest
              );
            },
            error: (error, request, response) => {
              const expressRequest = request as Request;
              const meta = this.proxyRequestMeta.get(expressRequest);
              const targetUrl =
                meta?.targetUrl ??
                this.buildProxyTargetUrlFromRequest(expressRequest);

              this.emitProxyLog({
                level: 'error',
                mode: meta?.mode ?? 'proxy-middleware',
                targetUrl,
                durationMs: meta ? Date.now() - meta.startedAt : undefined,
                request:
                  meta?.request ??
                  this.buildProxyRequestSnapshot(expressRequest, targetUrl),
                error: error instanceof Error ? error.message : String(error),
                errorStack: error instanceof Error ? error.stack : undefined
              });

              this.proxyRequestMeta.delete(expressRequest);

              this.emit(
                'error',
                ServerErrorCodes.PROXY_ERROR,
                error instanceof Error ? error : new Error(String(error))
              );

              this.sendError(
                response as Response,
                `${format(
                  ServerMessages.PROXY_ERROR,
                  this.environment.proxyHost
                )} ${request.url}: ${error}`,
                504
              );
            }
          }
        })
      );
    }
  }

  /**
   * ### Middleware ###
   * Catch all error handler
   * http://expressjs.com/en/guide/error-handling.html#catching-errors
   *
   * @param server - server on which to log the response
   */
  private errorHandler = (
    error: any,
    request: Request,
    response: Response,
    _next: NextFunction
  ) => {
    this.sendError(response, error, 500);
  };

  /**
   * Select a response from available responses based on state name
   * @param responses Available route responses
   * @param state State name ("success", "fail", or custom)
   * @returns Selected RouteResponse or undefined
   */
  private selectResponseByState(
    responses: RouteResponse[],
    state: string
  ): RouteResponse | undefined {
    if (!responses || responses.length === 0) {
      return undefined;
    }

    // State matching logic
    if (state === 'success') {
      // Find first 2xx response
      return responses.find((r) => r.statusCode >= 200 && r.statusCode < 300);
    } else if (state === 'fail') {
      // Find first 4xx or 5xx response
      return responses.find((r) => r.statusCode >= 400);
    } else {
      // Custom state - try to find response with matching label
      const matchingResponse = responses.find(
        (r) => r.label?.toLowerCase() === state.toLowerCase()
      );
      if (matchingResponse) {
        return matchingResponse;
      }

      // Fallback to first response if no label match
      return responses[0];
    }
  }

  private buildProxyTargetUrlFromRequest(request: Request): string {
    try {
      const relativeUrl = request.originalUrl || request.url || '/';

      return new URL(relativeUrl, this.environment.proxyHost).toString();
    } catch (_error) {
      return this.environment.proxyHost;
    }
  }

  private buildProxyMiddlewareTargetUrl(proxyReq: ClientRequest): string {
    try {
      const baseUrl = new URL(this.environment.proxyHost);
      const path = ((proxyReq as any).path as string | undefined) ?? '/';

      return new URL(path, baseUrl).toString();
    } catch (_error) {
      return this.environment.proxyHost;
    }
  }

  private createProxyRequestMeta(
    request: Request,
    mode: ProxyLogEntry['mode'],
    targetUrl: string
  ): ProxyRequestMeta {
    return {
      startedAt: Date.now(),
      mode,
      targetUrl,
      request: this.buildProxyRequestSnapshot(request, targetUrl)
    };
  }

  private buildProxyRequestSnapshot(
    request: Request,
    targetUrl: string
  ): ProxyLogEntry['request'] {
    const headers = this.headersFromIncoming(request.headers);
    const bodyForLog = this.createProxyLogBody(
      this.extractRequestBodyForLog(request)
    );

    const snapshot: ProxyLogEntry['request'] = {
      method: (request.method || 'GET').toUpperCase(),
      url: targetUrl,
      clientIp: request.ip,
      headers
    };

    if (bodyForLog) {
      snapshot.body = bodyForLog;
    }

    return snapshot;
  }

  private extractRequestBodyForLog(request: Request): unknown {
    const extendedRequest = request as Request & {
      rawBody?: Buffer;
      stringBody?: string;
    };

    if (extendedRequest.rawBody instanceof Buffer) {
      if (extendedRequest.rawBody.length === 0) {
        return undefined;
      }

      return extendedRequest.rawBody;
    }

    if (
      typeof extendedRequest.stringBody === 'string' &&
      extendedRequest.stringBody.length > 0
    ) {
      return extendedRequest.stringBody;
    }

    if (request.body !== undefined && request.body !== null) {
      return request.body;
    }

    return undefined;
  }

  private extractProxyRequestBody(
    request: Request
  ): Buffer | string | undefined {
    const extendedRequest = request as Request & {
      rawBody?: Buffer;
      stringBody?: string;
    };

    if (extendedRequest.rawBody instanceof Buffer) {
      return extendedRequest.rawBody.length > 0
        ? extendedRequest.rawBody
        : undefined;
    }

    if (
      typeof extendedRequest.stringBody === 'string' &&
      extendedRequest.stringBody.length > 0
    ) {
      return extendedRequest.stringBody;
    }

    return undefined;
  }

  private headersFromIncoming(
    headers: Request['headers']
  ): Record<string, string> {
    return Object.entries(headers).reduce<Record<string, string>>(function (
      acc,
      [key, value]
    ) {
      if (value === undefined) {
        return acc;
      }

      acc[key] = Array.isArray(value) ? value.join(',') : String(value);

      return acc;
    }, {});
  }

  private headersFromOutgoing(
    headers: OutgoingHttpHeaders
  ): Record<string, string> {
    return Object.entries(headers).reduce<Record<string, string>>(function (
      acc,
      [key, value]
    ) {
      if (value === undefined) {
        return acc;
      }

      if (Array.isArray(value)) {
        acc[key] = value.join(',');
      } else {
        acc[key] = String(value);
      }

      return acc;
    }, {});
  }

  private headersFromArray(headers: Header[]): Record<string, string> {
    return headers.reduce<Record<string, string>>((acc, header) => {
      acc[header.key] = header.value;
      return acc;
    }, {});
  }

  private headersFromFetch(headers: Headers): Record<string, string> {
    const record: Record<string, string> = {};
    headers.forEach((value, key) => {
      record[key] = value;
    });
    return record;
  }

  private headersFromHeadersInit(headers?: HeadersInit): Record<string, string> {
    if (!headers) {
      return {};
    }

    if (Array.isArray(headers)) {
      return headers.reduce<Record<string, string>>((acc, [key, value]) => {
        acc[key] = value;
        return acc;
      }, {});
    }

    if (headers instanceof Headers) {
      return this.headersFromFetch(headers);
    }

    return Object.entries(headers as Record<string, string | string[]>).reduce<
      Record<string, string>
    >((acc, [key, value]) => {
      acc[key] = Array.isArray(value) ? value.join(',') : String(value);
      return acc;
    }, {});
  }

  private createProxyLogBody(value: unknown): ProxyLogBody | undefined {
    if (value === undefined || value === null) {
      return undefined;
    }

    if (value instanceof Buffer) {
      if (value.length === 0) {
        return { value: '', encoding: 'utf8', bytes: 0 };
      }

      const asString = value.toString('utf8');

      if (asString.includes('\uFFFD')) {
        return {
          value: value.toString('base64'),
          encoding: 'base64',
          bytes: value.length
        };
      }

      return {
        value: asString,
        encoding: 'utf8',
        bytes: value.length
      };
    }

    if (typeof value === 'string') {
      const bytes = Buffer.byteLength(value);

      try {
        if (value.trim().length > 0) {
          const parsed = JSON.parse(value);
          const pretty = JSON.stringify(parsed, null, 2);

          return { value: pretty, encoding: 'json', bytes };
        }
      } catch (_error) {
        // fall through to raw string
      }

      return { value, encoding: 'utf8', bytes };
    }

    try {
      const json = JSON.stringify(value, null, 2);
      return {
        value: json,
        encoding: 'json',
        bytes: Buffer.byteLength(json)
      };
    } catch (_error) {
      const fallback = String(value);
      return {
        value: fallback,
        encoding: 'utf8',
        bytes: Buffer.byteLength(fallback)
      };
    }
  }

  private determineProxyLogLevel(status?: number): 'info' | 'warn' | 'error' {
    if (status === undefined || status === null) {
      return 'info';
    }

    if (status >= 500) {
      return 'error';
    }

    if (status >= 400) {
      return 'warn';
    }

    return 'info';
  }

  private emitProxyLog(entry: Omit<ProxyLogEntry, 'id' | 'timestamp'>) {
    this.emit('proxy-log', {
      id: generateUUID(),
      timestamp: new Date().toISOString(),
      ...entry
    });
  }

  private async parseProxyResponseBody(
    proxyResponse: globalThis.Response
  ): Promise<{ content?: string | object; bodyLog?: ProxyLogBody }> {
    if (!proxyResponse.body) {
      return {};
    }

    const contentType = proxyResponse.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
      const text = await proxyResponse.text();

      try {
        const parsed = JSON.parse(text);
        return {
          content: parsed,
          bodyLog: this.createProxyLogBody(parsed)
        };
      } catch (_error) {
        return {
          content: text,
          bodyLog: this.createProxyLogBody(text)
        };
      }
    }

    if (
      contentType.startsWith('text/') ||
      contentType.includes('xml') ||
      contentType.includes('html') ||
      contentType.includes('javascript')
    ) {
      const text = await proxyResponse.text();

      return {
        content: text,
        bodyLog: this.createProxyLogBody(text)
      };
    }

    const arrayBuffer = await proxyResponse.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    return {
      content: buffer.toString(),
      bodyLog: this.createProxyLogBody(buffer)
    };
  }

  /**
   * Set the provided headers on the target. Use different headers accessors
   * depending on the type of target:
   * express.Response/http.OutgoingMessage/http.IncomingMessage
   * Use the source in the template parsing of each header value.
   *
   * @param headers
   * @param target
   * @param request
   */
  private setHeaders(headers: Header[], target: any, request: Request) {
    headers.forEach((header: Header) => {
      try {
        const isSetCookie = header.key.toLowerCase() === 'set-cookie';
        let parsedHeaderValue = this.parseHeader(header, request);

        if (parsedHeaderValue === null) {
          return;
        }

        if (target.set) {
          // for express.Response
          if (isSetCookie) {
            target.append(header.key, parsedHeaderValue);
          } else {
            target.set(header.key, parsedHeaderValue);
          }
        } else if (target.setHeader) {
          // for proxy http.OutgoingMessage | ClientRequest
          target.setHeader(header.key, parsedHeaderValue);
        } else {
          // for http.IncomingMessage
          if (isSetCookie) {
            // Remove the secure flag
            parsedHeaderValue = parsedHeaderValue.replace(/; secure/gi, '');
            target.headers[header.key] = this.appendHeaderValue(
              target.headers[header.key],
              parsedHeaderValue
            );
          } else {
            target.headers[header.key] = parsedHeaderValue;
          }
        }
      } catch (_error) {}
    });
  }

  /**
   * If header already has a value, concatenate the values into an array
   *
   * @param currentValue
   * @param newValue
   * @returns
   */
  private appendHeaderValue(
    currentValue: string | string[],
    newValue: string
  ): string | string[] {
    let headerValue: string | string[] = newValue;

    if (currentValue) {
      headerValue = Array.isArray(currentValue)
        ? currentValue.concat(headerValue)
        : [currentValue, headerValue];
    }

    return headerValue;
  }

  /**
   * Verify a header validity and parse its content, if templating is used
   *
   * @param header
   * @param request
   * @returns
   */
  private parseHeader(header: Header, request: Request): string | null {
    let parsedHeaderValue: string | null = null;

    if (header.key && header.value) {
      try {
        parsedHeaderValue = TemplateParser({
          shouldOmitDataHelper: false,
          content: header.value,
          environment: this.environment,
          processedDatabuckets: this.processedDatabuckets,
          globalVariables: this.globalVariables,
          request: fromExpressRequest(request),
          envVarsPrefix: this.options.envVarsPrefix
        });
      } catch (error: any) {
        this.emit('error', ServerErrorCodes.HEADER_PARSING_ERROR, error, {
          headerKey: header.key,
          headerValue: header.value
        });

        parsedHeaderValue = ServerMessages.HEADER_PARSING_ERROR_LIGHT;
      }
    }

    return parsedHeaderValue;
  }

  /**
   * Send an error with text/plain content type, the provided message and status code.
   * Status is optional. No status will default to the one defined by the user, allowing for maximum customization.
   *
   * @param response
   * @param errorMessage
   * @param status
   */
  private sendError(
    response: Response,
    errorMessage: string | Error,
    status?: number
  ) {
    response.set('Content-Type', 'text/plain');
    response.body = errorMessage;

    if (errorMessage instanceof Error) {
      errorMessage = errorMessage.message;
    }

    if (status !== undefined) {
      response.status(status);
    }

    response.send(errorMessage);
  }

  /**
   * Emit callback invoked event.
   *
   * @param res
   * @param callback
   * @param url
   * @param requestBody
   * @param requestHeaders
   */
  private emitCallbackInvoked(
    res: globalThis.Response,
    callback: Callback,
    url: string,
    requestBody: string | null | undefined,
    requestHeaders: Record<string, any>
  ) {
    res.text().then((respText) => {
      const reqHeaders = Object.keys(requestHeaders).map(
        (k) => ({ key: k, value: requestHeaders[k] }) as Header
      );
      this.emit(
        'callback-invoked',
        CreateCallbackInvocation(
          callback,
          url,
          requestBody,
          reqHeaders,
          res,
          respText
        )
      );
    });
  }

  /**
   * Request an updated environment to allow
   * modification of some parameters without a restart (latency, headers, etc)
   */
  private refreshEnvironment() {
    if (this.options.refreshEnvironmentFunction && this.environment.uuid) {
      const updatedEnvironment = this.options.refreshEnvironmentFunction(
        this.environment.uuid
      );

      if (updatedEnvironment) {
        this.environment = updatedEnvironment;
      }
    }
  }

  /**
   * Request an updated route to allow
   * modification of some parameters without a restart (latency, headers, etc)
   * This only makes sense if the refreshEnvironmentFunction has been provided.
   *
   * @param routeUUID
   */
  private getRefreshedRoute(currentRoute: Route): Route | undefined {
    if (this.options.refreshEnvironmentFunction && this.environment.uuid) {
      return this.environment.routes.find(
        (route) => route.uuid === currentRoute.uuid
      );
    }

    return currentRoute;
  }

  /**
   * Build the secure context options
   * - if custom cert are provided load them
   * - if not, use default TLS cert (self-signed)
   *
   * @returns
   */
  private buildTLSOptions(environment: Environment): SecureContextOptions {
    let tlsOptions: SecureContextOptions = {};
    const processTemplating = (content: string) =>
      TemplateParser({
        content,
        shouldOmitDataHelper: false,
        environment,
        processedDatabuckets: this.processedDatabuckets,
        globalVariables: this.globalVariables,
        envVarsPrefix: this.options.envVarsPrefix
      });

    if (
      environment.tlsOptions?.pfxPath ||
      (environment.tlsOptions?.certPath && environment.tlsOptions?.keyPath)
    ) {
      if (
        environment.tlsOptions?.type === 'PFX' &&
        environment.tlsOptions?.pfxPath
      ) {
        tlsOptions.pfx = readFileSync(
          resolvePathFromEnvironment(
            processTemplating(environment.tlsOptions?.pfxPath),
            this.options.environmentDirectory
          )
        );
      } else if (
        environment.tlsOptions?.type === 'CERT' &&
        environment.tlsOptions?.certPath &&
        environment.tlsOptions?.keyPath
      ) {
        tlsOptions.cert = readFileSync(
          resolvePathFromEnvironment(
            processTemplating(environment.tlsOptions?.certPath),
            this.options.environmentDirectory
          )
        );
        tlsOptions.key = readFileSync(
          resolvePathFromEnvironment(
            processTemplating(environment.tlsOptions?.keyPath),
            this.options.environmentDirectory
          )
        );
      }

      if (environment.tlsOptions?.caPath) {
        tlsOptions.ca = readFileSync(
          resolvePathFromEnvironment(
            processTemplating(environment.tlsOptions?.caPath),
            this.options.environmentDirectory
          )
        );
      }

      if (environment.tlsOptions?.passphrase) {
        tlsOptions.passphrase = processTemplating(
          environment.tlsOptions?.passphrase
        );
      }
    } else {
      tlsOptions = { ...DefaultTLSOptions };
    }

    return tlsOptions;
  }

  /**
   * Parse all databuckets in the environment and set their parsed value to true except if they contain request helpers
   * @param environment
   */
  private generateDatabuckets(environment: Environment) {
    if (environment.data.length > 0) {
      environment.data.forEach((databucket) => {
        let newProcessedDatabucket: ProcessedDatabucket;

        if (
          new RegExp(`{{2,3}[#(\\s\\w]*(${requestHelperNames.join('|')})`).exec(
            databucket.value
          )
        ) {
          // a request helper was found
          newProcessedDatabucket = {
            id: databucket.id,
            name: databucket.name,
            value: databucket.value,
            parsed: false
          };
        } else {
          let templateParsedContent;

          try {
            templateParsedContent = TemplateParser({
              shouldOmitDataHelper: false,
              content: databucket.value,
              environment,
              processedDatabuckets: this.processedDatabuckets,
              globalVariables: this.globalVariables,
              envVarsPrefix: this.options.envVarsPrefix
            });

            const JSONParsedContent = JSON.parse(templateParsedContent);
            newProcessedDatabucket = {
              id: databucket.id,
              name: databucket.name,
              value: JSONParsedContent,
              parsed: true
            };
          } catch (error: any) {
            if (error instanceof SyntaxError) {
              newProcessedDatabucket = {
                id: databucket.id,
                name: databucket.name,
                value: templateParsedContent,
                parsed: true
              };
            } else {
              newProcessedDatabucket = {
                id: databucket.id,
                name: databucket.name,
                value: error.message,
                parsed: true
              };
            }
          }
        }
        this.processedDatabuckets.push(newProcessedDatabucket);
      });
    }
  }

  /**
   * Returns list of matched databucket ids in the given text.
   *
   * @param data text to be searched for possible databucket ids
   */
  private extractDatabucketIdsFromString(text?: string): string[] {
    const matches = text?.matchAll(
      new RegExp('data(?:Raw)? +[\'|"]{1}([^(\'|")]*)', 'g')
    );

    return [...(matches ?? [])].map((mtc) => mtc[1]);
  }

  /**
   * Find and returns all unique databucket ids specified in callbacks
   * of the given response.
   * To achieve null safety, this will always return an empty set if no callbacks
   * have been defined.
   *
   * @param response
   * @param environment
   */
  private findDatabucketIdsInCallbacks(
    response: RouteResponse,
    environment: Environment
  ): string[] {
    let dataBucketIds: string[] = [];

    if (response.callbacks && response.callbacks.length > 0) {
      for (const invocation of response.callbacks) {
        const callback = environment.callbacks.find(
          (envCallback) => envCallback.uuid === invocation.uuid
        );

        if (!callback) {
          continue;
        }

        dataBucketIds = [
          ...dataBucketIds,
          ...this.extractDatabucketIdsFromString(callback.uri),
          ...this.extractDatabucketIdsFromString(callback.body),
          ...this.extractDatabucketIdsFromString(callback.filePath),
          ...this.findDatabucketIdsInHeaders(callback.headers)
        ];

        if (callback.databucketID) {
          dataBucketIds.push(callback.databucketID);
        }
      }
    }

    return dataBucketIds;
  }

  /**
   * Find data buckets referenced in the provided headers
   *
   * @param headers
   */
  private findDatabucketIdsInHeaders(headers: Header[]): string[] {
    return headers.reduce<string[]>(
      (acc, header) => [
        ...acc,
        ...this.extractDatabucketIdsFromString(header.value)
      ],
      []
    );
  }

  /**
   * Find databucket ids in the rules target and value of the given response
   *
   * @param response
   */
  private findDatabucketIdsInRules(response: RouteResponse): string[] {
    let dataBucketIds: string[] = [];

    response.rules.forEach((rule) => {
      const splitRules = rule.modifier.split('.');
      if (rule.target === 'data_bucket') {
        dataBucketIds = [
          ...dataBucketIds,
          // split by dots, take first section, or second if first is a dollar
          splitRules[0].startsWith('$') ? splitRules[1] : splitRules[0],
          ...this.extractDatabucketIdsFromString(rule.value)
        ];
      }
    });

    return dataBucketIds;
  }

  /**
   * Generate the databuckets that were not parsed at the server start
   *
   * @param route
   * @param environment
   * @param request
   */
  private generateRequestDatabuckets(
    route: Route,
    environment: Environment,
    request: Request
  ) {
    // do not continue if all the buckets were previously parsed
    if (
      !this.processedDatabuckets.some(
        (processedDatabucket) => !processedDatabucket.parsed
      )
    ) {
      return;
    }

    let databucketIdsToParse = new Set<string>();

    // find databucket ids in environment headers
    this.findDatabucketIdsInHeaders(environment.headers).forEach(
      (dataBucketId) => databucketIdsToParse.add(dataBucketId)
    );

    route.responses.forEach((response) => {
      // capture databucket ids in body and relevant callback definitions
      [
        ...this.findDatabucketIdsInHeaders(response.headers),
        ...this.extractDatabucketIdsFromString(response.body),
        ...this.extractDatabucketIdsFromString(response.filePath),
        ...this.findDatabucketIdsInCallbacks(response, environment),
        ...this.findDatabucketIdsInRules(response)
      ].forEach((dataBucketId) => databucketIdsToParse.add(dataBucketId));

      if (response.databucketID) {
        databucketIdsToParse.add(response.databucketID);
      }
    });

    // capture databucket ids in found databuckets to allow for nested databucket parsing
    let nestedDatabucketIds: string[] = [];

    environment.data.forEach((databucket) => {
      if (
        databucketIdsToParse.has(databucket.id) ||
        [...databucketIdsToParse.keys()].some((id) =>
          databucket.name.toLowerCase().includes(id.toLowerCase())
        )
      ) {
        nestedDatabucketIds = [
          ...this.extractDatabucketIdsFromString(databucket.value)
        ];
      }
    });

    // add nested databucket ids at the beginning of the set to ensure they are parsed first
    databucketIdsToParse = new Set([
      ...nestedDatabucketIds,
      ...databucketIdsToParse
    ]);

    if (databucketIdsToParse.size > 0) {
      let targetDatabucket: ProcessedDatabucket | undefined;

      for (const databucketIdToParse of databucketIdsToParse) {
        targetDatabucket = this.processedDatabuckets.find(
          (databucket) =>
            databucket.id === databucketIdToParse ||
            databucket.name
              .toLowerCase()
              .includes(databucketIdToParse.toLowerCase())
        );

        if (targetDatabucket && !targetDatabucket?.parsed) {
          let content = targetDatabucket.value;
          try {
            content = TemplateParser({
              shouldOmitDataHelper: false,
              content: targetDatabucket.value,
              environment,
              processedDatabuckets: this.processedDatabuckets,
              globalVariables: this.globalVariables,
              request: fromExpressRequest(request),
              envVarsPrefix: this.options.envVarsPrefix
            });
            const JSONParsedcontent = JSON.parse(content);
            targetDatabucket.value = JSONParsedcontent;
            targetDatabucket.parsed = true;
          } catch (error: any) {
            if (error instanceof SyntaxError) {
              targetDatabucket.value = content;
            } else {
              targetDatabucket.value = error.message;
            }
            targetDatabucket.parsed = true;
          }
        }
      }
    }
  }

  /**
   * Set response properties from the locals object.
   * Currently supports the statusCode that can be set using templating helper.
   *
   * @param response
   */
  private applyResponseLocals(response: Response) {
    if (response.locals.statusCode !== undefined) {
      response.status(response.locals.statusCode);
    }
  }
}
