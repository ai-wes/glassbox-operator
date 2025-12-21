import type { Request, Response, NextFunction } from "express";

export function requireBearerToken(apiKey: string | undefined) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!apiKey) return next();

    const auth = req.header("authorization") || "";
    const expected = `Bearer ${apiKey}`;
    if (auth !== expected) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    next();
  };
}
