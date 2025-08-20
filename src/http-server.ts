#!/usr/bin/env node

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { JSONRPCMessage, MessageExtraInfo } from "@modelcontextprotocol/sdk/types.js";

import { configurePrompts } from "./prompts.js";
import { configureAllTools } from "./tools.js";
import { UserAgentComposer } from "./useragent.js";
import { packageVersion } from "./version.js";
import { loadConfig, ServerConfig } from "./config.js";
import { AuthService, AuthenticatedRequest, createAzureDevOpsClient } from "./auth.js";
import { HttpTransport } from "./http-transport.js";

class AzureDevOpsMcpHttpServer {
  private app: express.Application;
  private config: ServerConfig;
  private authService: AuthService;

  constructor() {
    this.config = loadConfig();
    this.app = express();
    this.authService = new AuthService(this.config.auth);
    this.setupMiddleware();
    this.setupRoutes();
  }

  private setupMiddleware() {
    // Security middleware
    this.app.use(helmet({
      contentSecurityPolicy: false, // Disabled for SSE
      crossOriginEmbedderPolicy: false
    }));

    // CORS
    if (this.config.cors.enabled) {
      this.app.use(cors({
        origin: this.config.cors.origins,
        credentials: true,
        methods: ['GET', 'POST', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'x-ado-organization']
      }));
    }

    // Rate limiting
    const limiter = rateLimit({
      windowMs: this.config.rateLimit.windowMs,
      max: this.config.rateLimit.maxRequests,
      message: { error: 'Too many requests, please try again later.' },
      standardHeaders: true,
      legacyHeaders: false
    });
    this.app.use(limiter);

    // Body parsing
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true }));
    this.app.use(cookieParser());

    // Logging
    this.app.use((req, res, next) => {
      console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
      next();
    });
  }

  private setupRoutes() {
    // Health check
    this.app.get('/health', (req, res) => {
      res.json({ 
        status: 'healthy', 
        version: packageVersion,
        timestamp: new Date().toISOString()
      });
    });

    // Server info
    this.app.get('/info', (req, res) => {
      res.json({
        name: 'Azure DevOps MCP Server',
        version: packageVersion,
        authentication: {
          pat: this.config.auth.patEnabled,
          oauth: this.config.auth.oauthEnabled
        },
        endpoints: {
          mcp: '/mcp',
          auth: '/auth',
          oauth_init: '/auth/oauth',
          oauth_callback: '/auth/callback'
        }
      });
    });

    // OAuth authentication routes
    if (this.config.auth.oauthEnabled) {
      this.app.get('/auth/oauth', (req, res) => {
        this.authService.initiateOAuthFlow(req, res);
      });

      this.app.get('/auth/callback', (req, res) => {
        this.authService.handleOAuthCallback(req, res);
      });
    }

    // Main MCP endpoint - supports both GET (for SSE) and POST (for regular HTTP)
    this.app.get('/mcp', this.authService.authenticate, this.handleMcpConnection.bind(this));
    this.app.post('/mcp', this.authService.authenticate, this.handleMcpRequest.bind(this));

    // 404 handler
    this.app.use((_req, res) => {
      res.status(404).json({ error: 'Endpoint not found' });
    });

    // Error handler
    this.app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      console.error('Server error:', error);
      res.status(500).json({ 
        error: 'Internal server error',
        message: this.config.logging.level === 'debug' ? error.message : 'An error occurred'
      });
    });
  }

  // Handle MCP connection via SSE (GET request)
  private async handleMcpConnection(req: AuthenticatedRequest, res: express.Response) {
    try {
      const server = new McpServer({
        name: "Azure DevOps MCP Server (HTTP)",
        version: packageVersion,
      });

      const userAgentComposer = new UserAgentComposer(packageVersion);
      server.server.oninitialized = () => {
        userAgentComposer.appendMcpClientInfo(server.server.getClientVersion());
      };

      // Configure server with authenticated client
      configurePrompts(server);

      const getAzureDevOpsClient = () => {
        return Promise.resolve(createAzureDevOpsClient(req.auth, userAgentComposer.userAgent));
      };

      const getAzureDevOpsToken = async () => {
        return {
          token: req.auth!.token,
          expiresOnTimestamp: Date.now() + (3600 * 1000) // 1 hour from now
        };
      };

      configureAllTools(
        server,
        getAzureDevOpsToken,
        getAzureDevOpsClient,
        () => userAgentComposer.userAgent
      );

      // Use HTTP transport
      const transport = new HttpTransport({ request: req, response: res });
      await server.connect(transport);

      // Keep connection alive
      req.on('close', () => {
        transport.close();
      });

    } catch (error) {
      console.error('MCP connection error:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to establish MCP connection' });
      }
    }
  }

  // Handle single MCP request (POST) - Streamable HTTP
  private async handleMcpRequest(req: AuthenticatedRequest, res: express.Response) {
    try {
      console.log('=== Streamable HTTP MCP Request ===');
      console.log('Method:', req.method);
      console.log('Content-Type:', req.headers['content-type']);
      console.log('Authorization:', req.headers.authorization ? 'Present' : 'Missing');
      
      // Check if this should upgrade to SSE
      // For POST requests, we should NOT upgrade to SSE automatically
      // Only upgrade if explicitly requested via Upgrade header
      const shouldUpgradeToSSE = req.method === 'POST' ? 
        req.headers.upgrade === 'sse' : 
        (req.headers.accept || '').includes('text/event-stream') || req.headers.upgrade === 'sse';
      
      if (shouldUpgradeToSSE) {
        console.log('Upgrading to SSE connection...');
        return this.handleMcpConnection(req, res);
      }
      
      // Handle single Streamable HTTP request
      console.log('Processing Streamable HTTP request...');
      
      const server = new McpServer({
        name: "Azure DevOps MCP Server (HTTP)",
        version: packageVersion,
      });

      const userAgentComposer = new UserAgentComposer(packageVersion);
      server.server.oninitialized = () => {
        userAgentComposer.appendMcpClientInfo(server.server.getClientVersion());
      };

      // Configure server with authenticated client
      configurePrompts(server);

      const getAzureDevOpsClient = () => {
        return Promise.resolve(createAzureDevOpsClient(req.auth, userAgentComposer.userAgent));
      };

      const getAzureDevOpsToken = async () => {
        return {
          token: req.auth!.token,
          expiresOnTimestamp: Date.now() + (3600 * 1000) // 1 hour from now
        };
      };

      configureAllTools(
        server,
        getAzureDevOpsToken,
        getAzureDevOpsClient,
        () => userAgentComposer.userAgent
      );

      // For Streamable HTTP, use Express parsed body
      console.log('Processing request body...');
      console.log('Request body type:', typeof req.body);
      console.log('Request body content:', req.body);
      
      try {
        let message: any;
        
        if (!req.body || Object.keys(req.body).length === 0) {
          // If no body, this might be an initialization request
          console.log('Empty request body - treating as initialization');
          res.setHeader('Content-Type', 'application/json');
          res.json({
            jsonrpc: "2.0",
            id: 1,
            result: {
              protocolVersion: "2024-11-05",
              capabilities: {
                tools: {},
                resources: {},
                prompts: {}
              },
              serverInfo: {
                name: "Azure DevOps MCP Server",
                version: packageVersion
              }
            }
          });
          return;
        }
        
        message = req.body;
        console.log('Using parsed JSON-RPC message:', message);
        
        // Handle MCP protocol messages directly
        const response = await this.handleMcpMessage(message, server, getAzureDevOpsClient);
        
        // Send response (handle notifications that return null)
        if (response !== null) {
          res.setHeader('Content-Type', 'application/json');
          res.json(response);
        } else {
          // For notifications, return 204 No Content
          res.status(204).end();
        }
        
      } catch (parseError) {
        console.error('Error processing request:', parseError);
        res.status(400).json({
          jsonrpc: "2.0",
          id: null,
          error: {
            code: -32700,
            message: "Parse error",
            data: parseError
          }
        });
      }
      
    } catch (error) {
      console.error('Streamable HTTP MCP request error:', error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          id: null, 
          error: {
            code: -32603,
            message: "Internal error",
            data: error
          }
        });
      }
    }
  }

  // Handle MCP protocol messages directly
  private async handleMcpMessage(message: any, server: McpServer, getAzureDevOpsClient: () => Promise<any>): Promise<any> {
    console.log('Handling MCP message:', message.method);
    
    try {
      switch (message.method) {
        case 'initialize':
          console.log('Handling initialize request');
          return {
            jsonrpc: "2.0",
            id: message.id,
            result: {
              protocolVersion: "2024-11-05",
              capabilities: {
                tools: {},
                resources: {},
                prompts: {},
                logging: {}
              },
              serverInfo: {
                name: "Azure DevOps MCP Server",
                version: packageVersion
              }
            }
          };

        case 'notifications/initialized':
          console.log('Handling initialized notification');
          // Notifications don't require responses - return null to indicate no response needed
          return null;

        case 'tools/list':
          console.log('Handling list_tools request - delegating to MCP server');
          
          // Create a temporary transport to get the tools from the actual server
          const tempResponseData: any[] = [];
          const tempTransport = {
            start: () => Promise.resolve(),
            close: () => Promise.resolve(),
            send: (msg: any) => {
              console.log('Server response:', msg);
              tempResponseData.push(msg);
              return Promise.resolve();
            },
            onclose: undefined as (() => void) | undefined,
            onerror: undefined as ((error: Error) => void) | undefined,
            onmessage: undefined as ((message: JSONRPCMessage, extra?: MessageExtraInfo) => void) | undefined
          };
          
          try {
            // Connect the server with the temporary transport
            await server.connect(tempTransport);
            
            // Send the tools/list request to the server
            if (tempTransport.onmessage) {
              tempTransport.onmessage(message);
            }
            
            // Wait for the response
            await new Promise(resolve => setTimeout(resolve, 500));
            
            // Return the server's response
            if (tempResponseData.length > 0) {
              return tempResponseData[0];
            } else {
              console.warn('No response received from MCP server for tools/list');
              return {
                jsonrpc: "2.0",
                id: message.id,
                result: {
                  tools: []
                }
              };
            }
          } catch (error) {
            console.error('Error listing tools:', error);
            return {
              jsonrpc: "2.0", 
              id: message.id,
              error: {
                code: -32603,
                message: "Failed to list tools",
                data: error
              }
            };
          }

        case 'tools/call':
          console.log('Handling tool call request:', message.params?.name, 'with arguments:', message.params?.arguments);
          
          // Delegate tool calls to the actual MCP server
          const callResponseData: any[] = [];
          const callTransport = {
            start: () => Promise.resolve(),
            close: () => Promise.resolve(),
            send: (msg: any) => {
              console.log('Tool call server response:', msg);
              callResponseData.push(msg);
              return Promise.resolve();
            },
            onclose: undefined as (() => void) | undefined,
            onerror: undefined as ((error: Error) => void) | undefined,
            onmessage: undefined as ((message: JSONRPCMessage, extra?: MessageExtraInfo) => void) | undefined
          };
          
          try {
            // Connect the server with the transport
            await server.connect(callTransport);
            
            // Send the tools/call request to the server
            if (callTransport.onmessage) {
              callTransport.onmessage(message);
            }
            
            // Wait for the response (longer timeout for tool execution)
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // Return the server's response
            if (callResponseData.length > 0) {
              return callResponseData[0];
            } else {
              console.warn('No response received from MCP server for tools/call');
              return {
                jsonrpc: "2.0",
                id: message.id,
                error: {
                  code: -32603,
                  message: "Tool execution timeout - no response from server"
                }
              };
            }
          } catch (error) {
            console.error('Error calling tool:', error);
            return {
              jsonrpc: "2.0", 
              id: message.id,
              error: {
                code: -32603,
                message: "Failed to call tool",
                data: error
              }
            };
          }

        default:
          console.warn('Unknown MCP method:', message.method);
          return {
            jsonrpc: "2.0",
            id: message.id,
            error: {
              code: -32601,
              message: `Method not found: ${message.method}`
            }
          };
      }
    } catch (error) {
      console.error('Error handling MCP message:', error);
      return {
        jsonrpc: "2.0",
        id: message.id,
        error: {
          code: -32603,
          message: "Internal error",
          data: error
        }
      };
    }
  }

  // Legacy handler - kept for compatibility
  private async handleMcpRequestLegacy(_req: AuthenticatedRequest, res: express.Response) {
    try {
      // For now, just redirect to SSE endpoint or provide error
      res.status(400).json({
        error: 'Single request mode not implemented yet',
        message: 'Please use GET /mcp for MCP Server-Sent Events connection',
        endpoints: {
          sse_connection: 'GET /mcp',
          health: 'GET /health',
          info: 'GET /info'
        }
      });

    } catch (error) {
      console.error('MCP request error:', error);
      res.status(500).json({ 
        error: 'Failed to process MCP request',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  public async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const server = this.app.listen(this.config.port, this.config.host, () => {
          console.log(`Azure DevOps MCP HTTP Server started`);
          console.log(`Server: http://${this.config.host}:${this.config.port}`);
          console.log(`Version: ${packageVersion}`);
          console.log(`Authentication: PAT=${this.config.auth.patEnabled}, OAuth=${this.config.auth.oauthEnabled}`);
          console.log(`MCP Endpoint: http://${this.config.host}:${this.config.port}/mcp`);
          resolve();
        });

        server.on('error', (error) => {
          console.error('Server error:', error);
          reject(error);
        });

        // Graceful shutdown
        process.on('SIGTERM', () => {
          console.log('Received SIGTERM, shutting down gracefully');
          server.close(() => {
            process.exit(0);
          });
        });

        process.on('SIGINT', () => {
          console.log('Received SIGINT, shutting down gracefully');
          server.close(() => {
            process.exit(0);
          });
        });

      } catch (error) {
        reject(error);
      }
    });
  }
}

async function main() {
  try {
    const server = new AzureDevOpsMcpHttpServer();
    await server.start();
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

// Check if this is the main module (ES module compatible)
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main().catch((error) => {
    console.error("Fatal error in main():", error);
    process.exit(1);
  });
}

export { AzureDevOpsMcpHttpServer };