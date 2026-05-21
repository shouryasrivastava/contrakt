interface User {
  id: string;
  name: string;
  email: string;
  createdAt: string;
}

/**
 * Get a single user by ID.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: { id: string } },
): Promise<NextResponse> {
  const { id } = ctx.params;

  const user: User = {
    id,
    name: "Alice",
    email: "alice@example.com",
    createdAt: new Date().toISOString(),
  };

  return NextResponse.json({ user }, { status: 200 });
}

/**
 * Delete a user by ID.
 */
export async function DELETE(
  req: NextRequest,
  ctx: { params: { id: string } },
): Promise<NextResponse> {
  const { id } = ctx.params;
  return NextResponse.json({ deleted: true, id }, { status: 200 });
}
