import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const REGISTRY_URL =
  process.env.CONTRAKT_REGISTRY_URL ?? "https://contrakt-registry.vercel.app";

const TOOLS = [
  {
    name: "search_registry",
    description:
      "Search the Contrakt public registry for published API contracts. Returns matching apps with endpoint counts, stack info, and URLs to fetch full schemas.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search term — matches app name or owner/app slug",
        },
        stack: {
          type: "string",
          description:
            "Filter by framework (e.g. 'nextjs-app-router', 'nextjs-pages-router')",
        },
        limit: {
          type: "number",
          description: "Max results (default 10, max 50)",
        },
      },
    },
  },
  {
    name: "get_contract",
    description:
      "Fetch the full API contract for a specific app. Returns all endpoints with their request schemas, response schemas, path params, query params, and status codes.",
    inputSchema: {
      type: "object",
      properties: {
        username: { type: "string", description: "GitHub username of the publisher" },
        app: { type: "string", description: "App name as it appears in the registry" },
      },
      required: ["username", "app"],
    },
  },
  {
    name: "get_mcp_config",
    description:
      "Get a Claude Desktop MCP config snippet for a registered app. Paste the returned JSON into claude_desktop_config.json to call that app's endpoints as MCP tools.",
    inputSchema: {
      type: "object",
      properties: {
        username: { type: "string", description: "GitHub username of the publisher" },
        app: { type: "string", description: "App name as it appears in the registry" },
        base_url: {
          type: "string",
          description:
            "URL where the app is running (e.g. https://myapp.com or http://localhost:3000)",
        },
      },
      required: ["username", "app"],
    },
  },
];

async function callTool(
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  if (name === "search_registry") {
    const params = new URLSearchParams();
    if (args.query) params.set("q", String(args.query));
    if (args.stack) params.set("stack", String(args.stack));
    params.set("limit", String(Math.min(Number(args.limit ?? 10), 50)));

    const res = await fetch(`${REGISTRY_URL}/api/registry/search?${params}`);
    if (!res.ok) throw new Error(`Registry returned ${res.status}`);
    return JSON.stringify(await res.json(), null, 2);
  }

  if (name === "get_contract") {
    const slug = `${args.username}/${args.app}`;
    const res = await fetch(`${REGISTRY_URL}/api/registry/contracts/${slug}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(`Registry returned ${res.status}: ${JSON.stringify(err)}`);
    }
    return JSON.stringify(await res.json(), null, 2);
  }

  if (name === "get_mcp_config") {
    const slug = `${args.username}/${args.app}`;
    const qs = args.base_url
      ? `?base_url=${encodeURIComponent(String(args.base_url))}`
      : "";
    const res = await fetch(
      `${REGISTRY_URL}/api/registry/contracts/${slug}/mcp${qs}`
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(`Registry returned ${res.status}: ${JSON.stringify(err)}`);
    }
    return JSON.stringify(await res.json(), null, 2);
  }

  throw new Error(`Unknown tool: ${name}`);
}

export async function runRegistryMcp(): Promise<void> {
  const server = new Server(
    { name: "contrakt-registry", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      const text = await callTool(name, (args ?? {}) as Record<string, unknown>);
      return { content: [{ type: "text", text }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
