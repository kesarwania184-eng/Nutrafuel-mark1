import type { NextFunction, Request, Response } from "express";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Blocks cross-origin browser writes before they can reach account/data APIs. */
export function sameOriginMutationGuard(
  req: Request,
  res: Response,
  next: NextFunction
) {
  if (SAFE_METHODS.has(req.method.toUpperCase())) return next();

  if (req.get("sec-fetch-site")?.toLowerCase() === "cross-site") {
    return res
      .status(403)
      .json({ error: "Cross-site requests are not allowed." });
  }

  const origin = req.get("origin");
  if (!origin) return next(); // Non-browser clients may omit Origin.

  try {
    const parsed = new URL(origin);
    const requestHost = req.get("host")?.toLowerCase();
    if (
      !requestHost ||
      parsed.host.toLowerCase() !== requestHost ||
      (process.env.NODE_ENV === "production" && parsed.protocol !== "https:")
    ) {
      return res
        .status(403)
        .json({ error: "Cross-origin requests are not allowed." });
    }
  } catch {
    return res.status(403).json({ error: "Invalid request origin." });
  }

  return next();
}
