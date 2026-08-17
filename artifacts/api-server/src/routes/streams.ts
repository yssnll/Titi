import { Readable } from "node:stream";
import { Router, type IRouter, type Response } from "express";

const router: IRouter = Router();
const FETCH_TIMEOUT_MS = 30_000;

function isPrivateHost(hostname: string) {
  const normalized = hostname.toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "::1" ||
    normalized === "127.0.0.1" ||
    normalized.startsWith("127.") ||
    normalized.startsWith("10.") ||
    normalized.startsWith("192.168.") ||
    normalized.startsWith("169.254.") ||
    normalized.endsWith(".internal")
  );
}

function parsePublicUrl(value: unknown): URL | null {
  if (typeof value !== "string" || value.length > 8192) return null;

  try {
    const parsed = new URL(value);
    if (
      (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
      isPrivateHost(parsed.hostname)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function getSourceHeaders(sourceUrl: URL): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "*/*",
    "User-Agent":
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148",
  };

  if (sourceUrl.hostname === "video.sibnet.ru" || sourceUrl.hostname.endsWith(".sibnet.ru")) {
    headers.Referer = "https://video.sibnet.ru/";
    headers.Origin = "https://video.sibnet.ru";
    headers["Accept-Language"] = "fr-FR,fr;q=0.9,en;q=0.8";
  }

  if (sourceUrl.hostname === "uqload.vc" || sourceUrl.hostname.endsWith(".uqload.vc")) {
    headers.Referer = "https://uqload.to/";
    headers.Origin = "https://uqload.to";
    headers["Accept-Language"] = "fr-FR,fr;q=0.9,en;q=0.8";
  }

  if (sourceUrl.hostname === "vmpx.online" || sourceUrl.hostname.endsWith(".vmpx.online")) {
    headers.Referer = "https://vmpx.online/";
    headers.Origin = "https://vmpx.online";
    headers["Accept-Language"] = "fr-FR,fr;q=0.9,en;q=0.8";
  }

  return headers;
}

function proxyUrlFor(sourceUrl: URL) {
  const params = new URLSearchParams({ url: sourceUrl.toString() });
  return `/api/streams/proxy?${params.toString()}`;
}

function rewritePlaylist(playlist: string, sourceUrl: URL) {
  return playlist
    .split(/\r?\n/)
    .map((line) => {
      if (line.startsWith("#")) {
        return line.replace(/URI="([^"]+)"/g, (_match, uri: string) => {
          return `URI="${proxyUrlFor(new URL(uri, sourceUrl))}"`;
        });
      }

      const trimmed = line.trim();
      if (!trimmed) return line;
      return proxyUrlFor(new URL(trimmed, sourceUrl));
    })
    .join("\n");
}

function sendProxyError(res: Response, status: number, detail: string) {
  if (!res.headersSent) {
    res.status(status).json({
      error: "Flux HLS inaccessible",
      detail,
    });
  }
}

router.get("/streams/proxy", async (req, res) => {
  const sourceUrl = parsePublicUrl(req.query.url);
  if (!sourceUrl) {
    sendProxyError(res, 400, "Utilisez une adresse HTTP(S) publique vers un flux HLS.");
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const sourceResponse = await fetch(sourceUrl, {
      headers: getSourceHeaders(sourceUrl),
      signal: controller.signal,
    });

    if (!sourceResponse.ok) {
      sendProxyError(
        res,
        502,
        sourceResponse.status === 403
          ? "Le serveur source a refusé ce lien. Il est peut-être lié à une page, une adresse IP ou une signature temporaire."
          : `Le serveur source a répondu HTTP ${sourceResponse.status}.`,
      );
      return;
    }

    const contentType = sourceResponse.headers.get("content-type")?.toLowerCase() ?? "";
    const isPlaylist =
      contentType.includes("mpegurl") ||
      contentType.includes("m3u8") ||
      sourceUrl.pathname.toLowerCase().endsWith(".m3u8");

    if (isPlaylist) {
      const playlist = await sourceResponse.text();
      res.setHeader("Content-Type", contentType.includes("mpegurl") ? contentType : "application/vnd.apple.mpegurl");
      res.setHeader("Cache-Control", "no-store");
      res.send(rewritePlaylist(playlist, sourceUrl));
      return;
    }

    if (sourceResponse.body) {
      const passthroughHeaders = ["content-length", "content-range", "accept-ranges", "etag", "last-modified"];
      for (const header of passthroughHeaders) {
        const value = sourceResponse.headers.get(header);
        if (value) res.setHeader(header, value);
      }
      res.setHeader("Content-Type", contentType || "application/octet-stream");
      res.setHeader("Cache-Control", "no-store");
      Readable.fromWeb(sourceResponse.body as never).pipe(res);
      return;
    }

    const body = Buffer.from(await sourceResponse.arrayBuffer());
    res.setHeader("Content-Type", contentType || "application/octet-stream");
    res.setHeader("Content-Length", body.length);
    res.send(body);
  } catch (error) {
    const detail =
      error instanceof Error && error.name === "AbortError"
        ? "Le serveur source met trop de temps à répondre."
        : error instanceof Error
          ? error.message
          : "Le serveur source n’a pas pu être contacté.";
    req.log.warn({ err: error, sourceHost: sourceUrl.hostname }, "HLS proxy request failed");
    sendProxyError(res, 502, detail);
  } finally {
    clearTimeout(timeout);
  }
});

export default router;