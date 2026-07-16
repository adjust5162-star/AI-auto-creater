import { handleApi } from "../server.mjs";

export default async function handler(req, res) {
  try {
    const host = req.headers.host || "localhost";
    const url = new URL(req.url || "/", `https://${host}`);
    if (!url.pathname.startsWith("/api/")) {
      res.statusCode = 404;
      res.end("Not found");
      return;
    }
    await handleApi(req, res, url);
  } catch (error) {
    const body = JSON.stringify({
      error: error instanceof Error ? error.message : "Internal server error."
    });
    res.writeHead(500, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": Buffer.byteLength(body)
    });
    res.end(body);
  }
}
