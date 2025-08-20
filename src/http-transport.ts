// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Transport, TransportSendOptions } from "@modelcontextprotocol/sdk/shared/transport.js";
import { JSONRPCMessage, MessageExtraInfo } from "@modelcontextprotocol/sdk/types.js";
import { Request, Response } from "express";

export interface HttpTransportOptions {
  request: Request;
  response: Response;
}

export class HttpTransport implements Transport {
  private _request: Request;
  private _response: Response;
  private _closed = false;
  
  // Transport interface callbacks
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage, extra?: MessageExtraInfo) => void;
  sessionId?: string;
  setProtocolVersion?: (version: string) => void;

  constructor(options: HttpTransportOptions) {
    this._request = options.request;
    this._response = options.response;
    this.sessionId = Math.random().toString(36).substring(2);

    // Set headers for SSE
    this._response.setHeader('Content-Type', 'text/event-stream');
    this._response.setHeader('Cache-Control', 'no-cache');
    this._response.setHeader('Connection', 'keep-alive');
    this._response.setHeader('Access-Control-Allow-Origin', '*');
    this._response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    this._response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

    // Handle client disconnect
    this._request.on('close', () => {
      this.close();
    });

    this._request.on('error', (error) => {
      this.onerror?.(error);
    });
  }

  start(): Promise<void> {
    return Promise.resolve();
  }

  async send(message: JSONRPCMessage, _options?: TransportSendOptions): Promise<void> {
    if (this._closed) {
      throw new Error('Transport is closed');
    }

    try {
      const data = JSON.stringify(message);
      this._response.write(`data: ${data}\n\n`);
    } catch (error) {
      this.onerror?.(error as Error);
      throw error;
    }
  }

  async close(): Promise<void> {
    if (this._closed) {
      return;
    }

    this._closed = true;
    
    try {
      this._response.end();
    } catch (error) {
      // Ignore errors when closing
    }

    this.onclose?.();
  }
}