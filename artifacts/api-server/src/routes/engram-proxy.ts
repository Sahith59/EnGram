import { Router } from "express";
import type { Request, Response } from "express";

const router = Router();
const NEXTJS_BASE = "http://localhost:3000";

async function proxyToNextJs(
  req: Request,
  res: Response,
  targetPath: string,
): Promise<void> {
  const queryString = req.url.includes("?")
    ? req.url.substring(req.url.indexOf("?"))
    : "";
  const url = `${NEXTJS_BASE}${targetPath}${queryString}`;

  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (req.headers.authorization) {
    headers["authorization"] = req.headers.authorization;
  }
  if (req.headers.cookie) {
    headers["cookie"] = req.headers.cookie as string;
  }

  const fetchOptions: RequestInit = { method: req.method, headers };
  if (req.method !== "GET" && req.method !== "HEAD") {
    fetchOptions.body = JSON.stringify(req.body);
  }

  try {
    const upstream = await fetch(url, fetchOptions);
    const contentType =
      upstream.headers.get("content-type") ?? "application/json";

    const setCookie = upstream.headers.get("set-cookie");
    if (setCookie) res.setHeader("set-cookie", setCookie);

    res.status(upstream.status).contentType(contentType);
    res.send(await upstream.text());
  } catch (err) {
    res
      .status(502)
      .json({ error: "ENGRAM app is not reachable. Make sure it is running." });
  }
}

router.post("/auth/cli", (req, res) =>
  proxyToNextJs(req, res, "/api/auth/cli"),
);
router.get("/me", (req, res) => proxyToNextJs(req, res, "/api/me"));
router.get("/contexts", (req, res) => proxyToNextJs(req, res, "/api/contexts"));
// More-specific sub-path must come BEFORE the generic /:id route
router.get("/contexts/:id/export", (req, res) =>
  proxyToNextJs(req, res, `/api/contexts/${req.params.id}/export`),
);
router.get("/contexts/:id", (req, res) =>
  proxyToNextJs(req, res, `/api/contexts/${req.params.id}`),
);
router.post("/ask", (req, res) => proxyToNextJs(req, res, "/api/ask"));

export default router;
