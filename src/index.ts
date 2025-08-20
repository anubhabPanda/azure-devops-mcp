#!/usr/bin/env node

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as azdev from "azure-devops-node-api";
import { AccessToken, AzureCliCredential, ChainedTokenCredential, DefaultAzureCredential, TokenCredential } from "@azure/identity";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import { configurePrompts } from "./prompts.js";
import { configureAllTools } from "./tools.js";
import { UserAgentComposer } from "./useragent.js";
import { packageVersion } from "./version.js";
import { AzureDevOpsMcpHttpServer } from "./http-server.js";
import { getEnvironmentExample } from "./config.js";

// Parse command line arguments using yargs
const argv = yargs(hideBin(process.argv))
  .scriptName("mcp-server-azuredevops")
  .usage("Usage: $0 [command] [options]")
  .version(packageVersion)
  .command("stdio <organization>", "Run as stdio server (legacy mode)", (yargs) => {
    yargs.positional("organization", {
      describe: "Azure DevOps organization name",
      type: "string",
    });
  })
  .command("http", "Run as HTTP server", () => {})
  .command("config", "Show environment variable configuration example", () => {})
  .option("tenant", {
    alias: "t",
    describe: "Azure tenant ID (optional, required for multi-tenant scenarios)",
    type: "string",
  })
  .option("port", {
    alias: "p",
    describe: "Port to run HTTP server on (default: 3000)",
    type: "number",
    default: 3000
  })
  .help()
  .parseSync();

// Extract command and arguments
const command = argv._[0] || (argv.organization ? 'stdio' : 'help');
export const orgName = argv.organization as string;
const tenantId = argv.tenant;

async function getAzureDevOpsToken(): Promise<AccessToken> {
  if (process.env.ADO_MCP_AZURE_TOKEN_CREDENTIALS) {
    process.env.AZURE_TOKEN_CREDENTIALS = process.env.ADO_MCP_AZURE_TOKEN_CREDENTIALS;
  } else {
    process.env.AZURE_TOKEN_CREDENTIALS = "dev";
  }
  let credential: TokenCredential = new DefaultAzureCredential(); // CodeQL [SM05138] resolved by explicitly setting AZURE_TOKEN_CREDENTIALS
  if (tenantId) {
    // Use Azure CLI credential if tenantId is provided for multi-tenant scenarios
    const azureCliCredential = new AzureCliCredential({ tenantId });
    credential = new ChainedTokenCredential(azureCliCredential, credential);
  }

  const token = await credential.getToken("499b84ac-1321-427f-aa17-267ca6975798/.default");
  if (!token) {
    throw new Error("Failed to obtain Azure DevOps token. Ensure you have Azure CLI logged in or another token source setup correctly.");
  }
  return token;
}

function getAzureDevOpsClient(userAgentComposer: UserAgentComposer): () => Promise<azdev.WebApi> {
  return async () => {
    if (!orgName) {
      throw new Error("Organization name is required for stdio mode");
    }
    const orgUrl = "https://dev.azure.com/" + orgName;
    const token = await getAzureDevOpsToken();
    const authHandler = azdev.getBearerHandler(token.token);
    const connection = new azdev.WebApi(orgUrl, authHandler, undefined, {
      productName: "AzureDevOps.MCP",
      productVersion: packageVersion,
      userAgent: userAgentComposer.userAgent,
    });
    return connection;
  };
}

async function runStdioServer() {
  if (!orgName) {
    console.error("Organization name is required for stdio mode");
    process.exit(1);
  }

  const server = new McpServer({
    name: "Azure DevOps MCP Server (Stdio)",
    version: packageVersion,
  });

  const userAgentComposer = new UserAgentComposer(packageVersion);
  server.server.oninitialized = () => {
    userAgentComposer.appendMcpClientInfo(server.server.getClientVersion());
  };

  configurePrompts(server);
  configureAllTools(server, getAzureDevOpsToken, getAzureDevOpsClient(userAgentComposer), () => userAgentComposer.userAgent);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

async function runHttpServer() {
  // Set PORT environment variable if provided via CLI
  if (argv.port) {
    process.env.PORT = argv.port.toString();
  }

  const server = new AzureDevOpsMcpHttpServer();
  await server.start();
}

function showConfig() {
  console.log("Environment Variables Configuration Example:");
  console.log("=" .repeat(50));
  console.log(getEnvironmentExample());
  console.log("=" .repeat(50));
  console.log("\nSave this to a .env file or set these environment variables before starting the HTTP server.");
}

async function main() {
  try {
    switch (command) {
      case 'stdio':
        await runStdioServer();
        break;
      case 'http':
        await runHttpServer();
        break;
      case 'config':
        showConfig();
        break;
      default:
        // Backward compatibility: if organization is provided without command, run stdio mode
        if (orgName) {
          await runStdioServer();
        } else {
          console.log("Azure DevOps MCP Server");
          console.log("Usage: mcp-server-azuredevops <command> [options]");
          console.log("");
          console.log("Commands:");
          console.log("  stdio <organization>   Run as stdio server (legacy mode)");
          console.log("  http                   Run as HTTP server (requires environment configuration)");
          console.log("  config                 Show environment variable configuration example");
          console.log("");
          console.log("Options:");
          console.log("  --tenant, -t          Azure tenant ID");
          console.log("  --port, -p            Port for HTTP server (default: 3000)");
          console.log("  --version             Show version number");
          console.log("  --help                Show help");
          process.exit(0);
        }
    }
  } catch (error) {
    console.error("Fatal error:", error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
