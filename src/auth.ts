// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import * as azdev from "azure-devops-node-api";

export interface AuthConfig {
  patEnabled: boolean;
  oauthEnabled: boolean;
  jwtSecret?: string;
  azureClientId?: string;
  azureClientSecret?: string;
  azureTenantId?: string;
  allowedOrigins?: string[];
}

export interface AuthenticatedRequest extends Request {
  auth?: {
    type: 'pat' | 'oauth';
    token: string;
    organization: string;
    userId?: string;
    claims?: any;
  };
}

export interface AzureTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
}

export class AuthService {
  private config: AuthConfig;

  constructor(config: AuthConfig) {
    this.config = config;
  }

  // PAT Authentication Middleware
  authenticateWithPAT = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!this.config.patEnabled) {
      return res.status(501).json({ error: 'PAT authentication is not enabled' });
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid Authorization header. Expected: Bearer <PAT_TOKEN>' });
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix
    const organization = req.headers['x-ado-organization'] as string;

    if (!organization) {
      return res.status(400).json({ error: 'Missing x-ado-organization header' });
    }

    try {
      // Validate PAT by making a test call to Azure DevOps
      const isValid = await this.validatePAT(token, organization);
      if (!isValid) {
        return res.status(401).json({ error: 'Invalid Personal Access Token' });
      }

      req.auth = {
        type: 'pat',
        token,
        organization
      };

      next();
    } catch (error) {
      console.error('PAT authentication error:', error);
      return res.status(401).json({ error: 'Authentication failed' });
    }
  };

  // OAuth Authentication Middleware
  authenticateWithOAuth = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!this.config.oauthEnabled) {
      return res.status(501).json({ error: 'OAuth authentication is not enabled' });
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid Authorization header. Expected: Bearer <JWT_TOKEN>' });
    }

    const token = authHeader.substring(7);

    try {
      if (!this.config.jwtSecret) {
        throw new Error('JWT secret not configured');
      }

      const decoded = jwt.verify(token, this.config.jwtSecret) as jwt.JwtPayload & { organization?: string; accessToken?: string };
      const organization = decoded.organization || req.headers['x-ado-organization'] as string;

      if (!organization) {
        return res.status(400).json({ error: 'Organization not found in token or headers' });
      }

      req.auth = {
        type: 'oauth',
        token: decoded.accessToken || '',
        organization,
        userId: decoded.sub,
        claims: decoded
      };

      next();
    } catch (error) {
      console.error('OAuth authentication error:', error);
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
  };

  // Flexible authentication middleware (supports both PAT and OAuth)
  authenticate = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    console.log('=== Authentication Debug ===');
    console.log('Request URL:', req.url);
    console.log('Request Method:', req.method);
    console.log('Authorization header:', req.headers.authorization ? 'Present' : 'Missing');
    console.log('x-ado-organization header:', req.headers['x-ado-organization'] || 'Missing');
    
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.log('AUTH ERROR: Missing or invalid authorization header format');
      console.log('Auth header value:', authHeader || 'undefined');
      return res.status(401).json({ error: 'Missing or invalid Authorization header' });
    }

    const token = authHeader.substring(7);

    // Try to determine if this is a JWT token (OAuth) or PAT token
    try {
      // If it's a valid JWT, treat as OAuth
      if (this.config.oauthEnabled && this.config.jwtSecret) {
        jwt.verify(token, this.config.jwtSecret);
        return this.authenticateWithOAuth(req, res, next);
      }
    } catch {
      // Not a JWT, might be PAT
    }

    // If not JWT or JWT verification failed, try PAT
    if (this.config.patEnabled) {
      return this.authenticateWithPAT(req, res, next);
    }

    return res.status(401).json({ error: 'No valid authentication method found' });
  };

  // OAuth Authorization Flow
  async initiateOAuthFlow(req: Request, res: Response) {
    if (!this.config.oauthEnabled || !this.config.azureClientId) {
      return res.status(501).json({ error: 'OAuth is not configured' });
    }

    const organization = req.query.organization as string;
    const redirectUri = req.query.redirect_uri as string || `${req.protocol}://${req.get('host')}/auth/callback`;

    if (!organization) {
      return res.status(400).json({ error: 'organization parameter is required' });
    }

    const scopes = [
      'https://app.vssps.visualstudio.com/user_profile',
      'https://dev.azure.com/user_profile',
      'vso.work_write',
      'vso.code_write',
      'vso.build_execute',
      'vso.release_execute'
    ].join(' ');

    const authUrl = `https://app.vssps.visualstudio.com/oauth2/authorize` +
      `?client_id=${this.config.azureClientId}` +
      `&response_type=code` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&scope=${encodeURIComponent(scopes)}` +
      `&state=${encodeURIComponent(JSON.stringify({ organization }))}`;

    res.json({ authUrl });
  }

  // OAuth Callback Handler
  async handleOAuthCallback(req: Request, res: Response) {
    if (!this.config.oauthEnabled || !this.config.azureClientSecret || !this.config.azureClientId) {
      return res.status(501).json({ error: 'OAuth is not configured' });
    }

    const { code, state } = req.query;
    const redirectUri = `${req.protocol}://${req.get('host')}/auth/callback`;

    if (!code) {
      return res.status(400).json({ error: 'Authorization code not provided' });
    }

    try {
      const stateData = state ? JSON.parse(state as string) : {};
      const organization = stateData.organization;

      const tokenResponse = await this.exchangeCodeForToken(
        code as string,
        redirectUri,
        this.config.azureClientId,
        this.config.azureClientSecret
      );

      if (!this.config.jwtSecret) {
        throw new Error('JWT secret not configured');
      }

      // Create JWT token with Azure DevOps access token
      const jwtToken = jwt.sign({
        sub: tokenResponse.access_token.split('.')[0], // Use part of token as user ID
        accessToken: tokenResponse.access_token,
        organization,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + tokenResponse.expires_in
      }, this.config.jwtSecret);

      res.json({ 
        token: jwtToken,
        expires_in: tokenResponse.expires_in,
        organization 
      });
    } catch (error) {
      console.error('OAuth callback error:', error);
      res.status(400).json({ error: 'Failed to exchange authorization code' });
    }
  }

  // Validate PAT token by testing with Azure DevOps API
  private async validatePAT(token: string, organization: string): Promise<boolean> {
    try {
      const orgUrl = `https://dev.azure.com/${organization}`;
      const authHandler = azdev.getBearerHandler(token);
      const connection = new azdev.WebApi(orgUrl, authHandler);
      
      // Try to get core client and make a simple API call
      const coreApi = await connection.getCoreApi();
      await coreApi.getProjects();
      return true;
    } catch (error) {
      console.error('PAT validation error:', error);
      return false;
    }
  }

  // Exchange authorization code for access token
  private async exchangeCodeForToken(
    code: string,
    redirectUri: string,
    clientId: string,
    clientSecret: string
  ): Promise<AzureTokenResponse> {
    const response = await fetch('https://app.vssps.visualstudio.com/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:client-secret-basic',
        client_assertion: `${clientId}:${clientSecret}`,
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }).toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Token exchange failed: ${response.status} ${errorText}`);
    }

    return response.json();
  }
}

// Helper function to create Azure DevOps client with authenticated token
export function createAzureDevOpsClient(auth: AuthenticatedRequest['auth'], userAgent?: string): azdev.WebApi {
  if (!auth) {
    throw new Error('Authentication required');
  }

  const orgUrl = `https://dev.azure.com/${auth.organization}`;
  const authHandler = azdev.getBearerHandler(auth.token);
  
  return new azdev.WebApi(orgUrl, authHandler, undefined, {
    productName: "AzureDevOps.MCP.Remote",
    productVersion: "1.0.0",
    userAgent: userAgent || "AzureDevOps-MCP-Server/1.0.0"
  });
}