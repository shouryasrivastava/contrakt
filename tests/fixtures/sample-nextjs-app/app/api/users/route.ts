interface User {
  id: string;
  name: string;
  email: string;
  createdAt: string;
}

interface CreateUserInput {
  name: string;
  email: string;
}

/**
 * List all users.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url);
  const page = url.searchParams.get("page");
  const limit = url.searchParams.get("limit");

  const users: User[] = [];
  return NextResponse.json({ users, page, limit }, { status: 200 });
}

/**
 * Create a new user.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json()) as CreateUserInput;

  if (!body.name || !body.email) {
    return NextResponse.json({ error: "name and email are required" }, { status: 400 });
  }

  const user: User = {
    id: crypto.randomUUID(),
    name: body.name,
    email: body.email,
    createdAt: new Date().toISOString(),
  };

  return NextResponse.json({ user }, { status: 201 });
}
