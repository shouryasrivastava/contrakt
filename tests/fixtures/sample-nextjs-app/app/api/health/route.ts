/**
 * Health check endpoint. Returns service status.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  return NextResponse.json({ status: "ok" }, { status: 200 });
}
