export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface Endpoint {
  path: string;
  method: HttpMethod;
  sourceFile: string;
  routerType?: "app" | "pages";
  requestSchema?: JSONSchema;
  querySchema?: JSONSchema;
  pathParams?: JSONSchema;
  responseSchema?: JSONSchema;
  statusCodes: number[];
  description?: string;
}

export interface Contract {
  schemaSyncVersion: string;
  generatedAt: string;
  projectRoot: string;
  stack: "nextjs-app-router" | "nextjs-pages-router" | "nextjs-hybrid";
  endpoints: Endpoint[];
}

export type JSONSchema = Record<string, unknown>;

export interface SchemaConfig {
  baseUrl: string;
  stack: string;
}

export interface DiffResult {
  type: "breaking" | "non-breaking" | "additive";
  message: string;
  path?: string;
  method?: string;
  field?: string;
}

export interface DiffReport {
  breaking: DiffResult[];
  nonBreaking: DiffResult[];
  additive: DiffResult[];
}
