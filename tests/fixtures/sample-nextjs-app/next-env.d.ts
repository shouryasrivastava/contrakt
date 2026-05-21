// Minimal Next.js type stubs for test fixtures

declare class NextRequest {
  readonly url: string;
  readonly nextUrl: URL;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

declare class NextResponse {
  static json(body: unknown, init?: { status?: number; headers?: Record<string, string> }): NextResponse;
}

declare class Response {
  static json(body: unknown, init?: { status?: number; headers?: Record<string, string> }): Response;
}

declare type NextHandler = (req: NextRequest, ctx?: { params: Record<string, string> }) => Promise<NextResponse>;
