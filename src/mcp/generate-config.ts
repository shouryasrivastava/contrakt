import { join } from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";
import type { Contract, Endpoint, JSONSchema } from "../inference/types.js";

export interface McpGenerateOptions {
  cwd: string;
  baseUrl: string;
  outputDir?: string;
}

export interface McpArtifacts {
  configPath: string;
  serverPath: string;
}

export function generateMcpArtifacts(
  contract: Contract,
  options: McpGenerateOptions,
): McpArtifacts {
  // Output to .contrakt/ by default so the generated .ts file doesn't
  // pollute the host project's TypeScript compilation scope.
  const outDir = options.outputDir ?? join(options.cwd, ".contrakt");
  const configPath = join(outDir, "mcp.json");
  const serverPath = join(outDir, "contrakt-mcp-server.ts");

  mkdirSync(outDir, { recursive: true });

  const mcpConfig = buildMcpConfig(contract, serverPath, options.baseUrl);
  writeFileSync(configPath, JSON.stringify(mcpConfig, null, 2) + "\n", "utf8");

  const serverSource = buildServerStub(contract, options.baseUrl);
  writeFileSync(serverPath, serverSource, "utf8");

  return { configPath, serverPath };
}

function buildMcpConfig(
  contract: Contract,
  serverPath: string,
  defaultBaseUrl: string,
): Record<string, unknown> {
  return {
    mcpServers: {
      [deriveProjectName(contract.projectRoot)]: {
        command: "tsx",
        args: [serverPath],
        env: {
          CONTRAKT_BASE_URL: defaultBaseUrl,
        },
      },
    },
  };
}

function deriveProjectName(projectRoot: string): string {
  return projectRoot.split("/").filter(Boolean).pop() ?? "contrakt-app";
}

function buildServerStub(contract: Contract, defaultBaseUrl: string): string {
  const toolDefs = contract.endpoints.map((ep) => buildToolDef(ep));
  const toolRegistrations = contract.endpoints.map((ep) => buildToolRegistration(ep));

  return `#!/usr/bin/env tsx
/**
 * Auto-generated MCP server stub by Contrakt v${contract.schemaSyncVersion}
 * Generated at: ${contract.generatedAt}
 *
 * Run with: tsx contrakt-mcp-server.ts
 * Your app must be running locally for this server to proxy calls.
 * Override the base URL at runtime: CONTRAKT_BASE_URL=https://staging.myapp.com tsx contrakt-mcp-server.ts
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const BASE_URL = process.env.CONTRAKT_BASE_URL ?? ${JSON.stringify(defaultBaseUrl)};

const server = new Server(
  { name: ${JSON.stringify(deriveProjectName(contract.projectRoot))}, version: ${JSON.stringify(contract.schemaSyncVersion)} },
  { capabilities: { tools: {} } },
);

const TOOLS = [
${toolDefs.map((t) => "  " + t).join(",\n")}
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

${toolRegistrations.join("\n\n")}

  return {
    content: [{ type: "text", text: \`Unknown tool: \${name}\` }],
    isError: true,
  };
});

const transport = new StdioServerTransport();
await server.connect(transport);
`;
}

function toolName(ep: Endpoint): string {
  // e.g. GET /api/users/[id] → get_api_users_id
  const pathPart = ep.path
    .replace(/\//g, "_")
    .replace(/[\[\]]/g, "")
    .replace(/^_/, "")
    .replace(/_+/g, "_");
  return `${ep.method.toLowerCase()}_${pathPart}`;
}

function buildToolDef(ep: Endpoint): string {
  const inputSchema = buildInputSchema(ep);
  const description = ep.description ?? `${ep.method} ${ep.path}`;

  return JSON.stringify({
    name: toolName(ep),
    description,
    inputSchema,
  }, null, 4);
}

function buildInputSchema(ep: Endpoint): JSONSchema {
  const properties: Record<string, JSONSchema> = {};
  const required: string[] = [];

  // Path params
  if (ep.pathParams?.["properties"]) {
    const pathProps = ep.pathParams["properties"] as Record<string, JSONSchema>;
    for (const [k, v] of Object.entries(pathProps)) {
      properties[k] = v;
      required.push(k);
    }
  }

  // Query params
  if (ep.querySchema?.["properties"]) {
    const queryProps = ep.querySchema["properties"] as Record<string, JSONSchema>;
    for (const [k, v] of Object.entries(queryProps)) {
      properties[k] = v;
    }
  }

  // Request body
  if (ep.requestSchema && ep.requestSchema["type"] !== "unknown") {
    if (ep.requestSchema["properties"]) {
      const bodyProps = ep.requestSchema["properties"] as Record<string, JSONSchema>;
      for (const [k, v] of Object.entries(bodyProps)) {
        properties[k] = v;
      }
      const bodyRequired = (ep.requestSchema["required"] ?? []) as string[];
      required.push(...bodyRequired);
    }
  }

  return {
    type: "object",
    properties,
    ...(required.length > 0 ? { required: [...new Set(required)] } : {}),
  };
}

function buildToolRegistration(ep: Endpoint): string {
  const name = toolName(ep);
  const pathTemplate = ep.path;
  const method = ep.method;

  // Determine which params are path params
  const pathParamNames = ep.pathParams?.["properties"]
    ? Object.keys(ep.pathParams["properties"] as Record<string, unknown>)
    : [];

  // Query param names
  const queryParamNames = ep.querySchema?.["properties"]
    ? Object.keys(ep.querySchema["properties"] as Record<string, unknown>)
    : [];

  const hasBody = method !== "GET" && method !== "DELETE" && !!ep.requestSchema;

  return `  if (name === ${JSON.stringify(name)}) {
    const a = args as Record<string, unknown>;
    let path = ${JSON.stringify(pathTemplate)};
    ${pathParamNames.map((p) => `path = path.replace("[${p}]", String(a[${JSON.stringify(p)}] ?? ""));`).join("\n    ")}
    const query = new URLSearchParams();
    ${queryParamNames.map((p) => `if (a[${JSON.stringify(p)}] !== undefined) query.set(${JSON.stringify(p)}, String(a[${JSON.stringify(p)}]));`).join("\n    ")}
    const queryStr = query.toString();
    const url = \`\${BASE_URL}\${path}\${queryStr ? "?" + queryStr : ""}\`;
    const res = await fetch(url, {
      method: ${JSON.stringify(method)},
      ${hasBody ? `headers: { "Content-Type": "application/json" },\n      body: JSON.stringify(${buildBodyObject(ep)}),` : ""}
    });
    const data = await res.json();
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }`;
}

function buildBodyObject(ep: Endpoint): string {
  if (!ep.requestSchema?.["properties"]) return "a";
  const props = Object.keys(ep.requestSchema["properties"] as Record<string, unknown>);
  if (props.length === 0) return "a";
  const entries = props.map((p) => `${JSON.stringify(p)}: a[${JSON.stringify(p)}]`).join(", ");
  return `{ ${entries} }`;
}
