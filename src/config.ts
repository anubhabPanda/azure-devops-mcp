// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AuthConfig } from "./auth.js";

export interface ServerConfig {
  port: number;
  host: string;
  auth: AuthConfig;
  cors: {
    enabled: boolean;
    origins: string[];
  };
  rateLimit: {
    windowMs: number;
    maxRequests: number;
  };
  logging: {
    level: 'debug' | 'info' | 'warn' | 'error';
  };
}

export function loadConfig(): ServerConfig {
  // Default configuration
  const config: ServerConfig = {
    port: parseInt(process.env.PORT || '3000', 10),
    host: process.env.HOST || '0.0.0.0',
    auth: {
      patEnabled: process.env.AUTH_PAT_ENABLED !== 'false', // Enabled by default
      oauthEnabled: process.env.AUTH_OAUTH_ENABLED === 'true', // Disabled by default
      jwtSecret: process.env.JWT_SECRET,
      azureClientId: process.env.AZURE_CLIENT_ID,
      azureClientSecret: process.env.AZURE_CLIENT_SECRET,
      azureTenantId: process.env.AZURE_TENANT_ID,
      allowedOrigins: process.env.ALLOWED_ORIGINS?.split(',') || ['*']
    },
    cors: {
      enabled: process.env.CORS_ENABLED !== 'false', // Enabled by default
      origins: process.env.CORS_ORIGINS?.split(',') || ['*']
    },
    rateLimit: {
      windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10), // 15 minutes
      maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10)
    },
    logging: {
      level: (process.env.LOG_LEVEL as any) || 'info'
    }
  };

  // Validation
  if (config.auth.oauthEnabled) {
    if (!config.auth.jwtSecret) {
      throw new Error('JWT_SECRET is required when OAuth is enabled');
    }
    if (!config.auth.azureClientId || !config.auth.azureClientSecret) {
      throw new Error('AZURE_CLIENT_ID and AZURE_CLIENT_SECRET are required when OAuth is enabled');
    }
  }

  if (!config.auth.patEnabled && !config.auth.oauthEnabled) {
    throw new Error('At least one authentication method must be enabled');
  }

  return config;
}

export function getEnvironmentExample(): string {
  return `
# Server Configuration
PORT=3000
HOST=0.0.0.0

# Authentication Configuration
AUTH_PAT_ENABLED=true
AUTH_OAUTH_ENABLED=false

# OAuth Configuration (required if AUTH_OAUTH_ENABLED=true)
JWT_SECRET=your-jwt-secret-key
AZURE_CLIENT_ID=your-azure-app-client-id
AZURE_CLIENT_SECRET=your-azure-app-client-secret
AZURE_TENANT_ID=your-azure-tenant-id

# CORS Configuration
CORS_ENABLED=true
CORS_ORIGINS=*
ALLOWED_ORIGINS=*

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100

# Logging
LOG_LEVEL=info
`.trim();
}