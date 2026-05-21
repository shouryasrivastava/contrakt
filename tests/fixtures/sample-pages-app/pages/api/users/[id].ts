interface User {
  id: string;
  name: string;
  email: string;
}

/**
 * Get or delete a user by ID.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query as { id: string };

  if (req.method === "GET") {
    const user: User = { id, name: "Alice", email: "alice@example.com" };
    res.status(200).json({ user });
    return;
  }

  if (req.method === "DELETE") {
    res.status(200).json({ deleted: true, id });
    return;
  }

  res.status(405).json({ error: "Method not allowed" });
}
