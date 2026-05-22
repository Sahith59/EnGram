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

// ── CLI auth ──────────────────────────────────────────────
router.post("/auth/cli", (req, res) =>
  proxyToNextJs(req, res, "/api/auth/cli"),
);

// ── Health / status (extension popup + CLI) ───────────────
router.get("/health", (req, res) => proxyToNextJs(req, res, "/api/health"));

// ── User / identity ───────────────────────────────────────
router.get("/me", (req, res) => proxyToNextJs(req, res, "/api/me"));

// ── Contexts (CLI) ────────────────────────────────────────
router.get("/contexts", (req, res) => proxyToNextJs(req, res, "/api/contexts"));
// Sub-paths must come BEFORE the generic /:id route
router.get("/contexts/:id/export", (req, res) =>
  proxyToNextJs(req, res, `/api/contexts/${req.params.id}/export`),
);
router.get("/contexts/:id", (req, res) =>
  proxyToNextJs(req, res, `/api/contexts/${req.params.id}`),
);
router.patch("/contexts/:id", (req, res) =>
  proxyToNextJs(req, res, `/api/contexts/${req.params.id}`),
);
router.delete("/contexts/:id", (req, res) =>
  proxyToNextJs(req, res, `/api/contexts/${req.params.id}`),
);

// ── Ask / AI (CLI + extension) ────────────────────────────
router.post("/ask", (req, res) => proxyToNextJs(req, res, "/api/ask"));

// ── Extension endpoints ───────────────────────────────────
router.post("/capture/reassign", (req, res) =>
  proxyToNextJs(req, res, "/api/capture/reassign"),
);
router.post("/capture", (req, res) => proxyToNextJs(req, res, "/api/capture"));
router.post("/checkpoint", (req, res) =>
  proxyToNextJs(req, res, "/api/checkpoint"),
);
router.get("/projects", (req, res) => proxyToNextJs(req, res, "/api/projects"));
router.get("/projects/:id/brief", (req, res) =>
  proxyToNextJs(req, res, `/api/projects/${req.params.id}/brief`),
);
router.get("/teams", (req, res) => proxyToNextJs(req, res, "/api/teams"));
router.get("/resume", (req, res) => proxyToNextJs(req, res, "/api/resume"));

export default router;
