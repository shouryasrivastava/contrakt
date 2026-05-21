interface User {
  id: string;
  name: string;
  email: string;
}

interface CreateUserInput {
  name: string;
  email: string;
}

/**
 * List or create users.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === "GET") {
    const page = req.query.page as string;
    const users: User[] = [];
    res.status(200).json({ users, page });
    return;
  }

  if (req.method === "POST") {
    const body = req.body as CreateUserInput;
    if (!body.name || !body.email) {
      res.status(400).json({ error: "name and email are required" });
      return;
    }
    const user: User = { id: "new-id", name: body.name, email: body.email };
    res.status(201).json({ user });
    return;
  }

  res.status(405).json({ error: "Method not allowed" });
}
