import type { IncomingMessage, ServerResponse } from "node:http";
import { createApp } from "./app.ts";
import { DataSource } from "./data.ts";

// One DataSource per warm instance, so caches and the Explorer rate-limit
// queue survive between requests. The static site is served by Vercel.
const handler = createApp(new DataSource(process.env));

/**
 * Vercel routes /api/<path> here as /api?__path=<path>. Put the original
 * path back so the app's router sees /api/<path>.
 */
export function restoreUrl(url = "/"): string {
  const u = new URL(url, "http://localhost");
  const path = u.searchParams.get("__path");
  if (path === null || u.pathname.startsWith("/api/")) return url;
  u.searchParams.delete("__path");
  return `/api/${path}${u.search}`;
}

export default function crowdline(req: IncomingMessage, res: ServerResponse): void {
  req.url = restoreUrl(req.url);
  handler(req, res);
}
