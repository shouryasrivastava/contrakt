// Minimal Next.js Pages Router type stubs

interface NextApiRequest {
  method?: string;
  body: unknown;
  query: Record<string, string | string[]>;
  headers: Record<string, string>;
  url?: string;
}

interface NextApiResponse<T = unknown> {
  status(code: number): NextApiResponse<T>;
  json(body: T): void;
  send(body: T): void;
  end(): void;
  setHeader(name: string, value: string): void;
}
