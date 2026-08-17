import { createReadStream } from "node:fs";
import { unlink } from "node:fs/promises";
import { spawn } from "node:child_process";
import { Router, type IRouter } from "express";
import { join } from "node:path";
import { tmpdir } from "node:os";

const router: IRouter = Router();
const DOWNLOAD_TIMEOUT_MS = 20 * 60 * 1000;

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

  return headers;
}

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

function isValidSourceUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 8192) return false;
  try {
    const parsed = new URL(value);
    return (parsed.protocol === "https:" || parsed.protocol === "http:") && !isPrivateHost(parsed.hostname);
  } catch {
    return false;
  }
}

function getErrorDetail(stderr: string) {
  const cleaned = stderr.replace(/\s+/g, " ").trim();
  if (cleaned.includes("403") || cleaned.includes("Forbidden")) {
    return "Le lien HLS est refusé ou sa signature temporaire a expiré. Générez un nouveau lien depuis le site source.";
  }
  if (cleaned.length > 0) return cleaned.slice(-500);
  return "Le serveur vidéo n’a pas pu être converti en MP4.";
}

async function removeTempFile(filePath: string) {
  await unlink(filePath).catch(() => undefined);
}

router.get("/downloads/mp4", async (req, res) => {
  const sourceValue = req.query.url;
  const mode = req.query.mode === "fast" ? "fast" : "compatible";

  if (!isValidSourceUrl(sourceValue)) {
    res.status(400).json({
      error: "URL de flux invalide",
      detail: "Utilisez une adresse HTTP(S) publique vers une playlist HLS .m3u8.",
    });
    return;
  }

  const sourceUrl = new URL(sourceValue);
  const headers = getSourceHeaders(sourceUrl);
  const outputPath = join(tmpdir(), `hls-video-${Date.now()}-${Math.random().toString(36).slice(2)}.mp4`);
  const ffmpegHeaders = Object.entries(headers)
    .filter(([name]) => name !== "User-Agent")
    .map(([name, value]) => `${name}: ${value}\r\n`)
    .join("");

  const inputArgs = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-protocol_whitelist",
    "file,http,https,tcp,tls,crypto",
    "-user_agent",
    headers["User-Agent"],
    ...(ffmpegHeaders ? ["-headers", ffmpegHeaders] : []),
    "-i",
    sourceValue,
    "-map",
    "0:v:0?",
    "-map",
    "0:a:0?",
  ];
  const codecArgs =
    mode === "fast"
      ? ["-c", "copy"]
      : [
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-crf",
          "23",
          "-c:a",
          "aac",
          "-b:a",
          "128k",
        ];
  const ffmpeg = spawn("ffmpeg", [
    ...inputArgs,
    ...codecArgs,
    "-movflags",
    "+faststart",
    "-f",
    "mp4",
    "-y",
    outputPath,
  ]);

  let stderr = "";
  let settled = false;
  const timeout = setTimeout(() => {
    ffmpeg.kill("SIGTERM");
  }, DOWNLOAD_TIMEOUT_MS);

  ffmpeg.stderr.on("data", (chunk: Buffer) => {
    stderr = `${stderr}${chunk.toString()}`.slice(-5000);
  });

  req.on("aborted", () => {
    if (!settled) ffmpeg.kill("SIGTERM");
  });

  res.on("close", () => {
    if (!res.writableEnded && !settled) ffmpeg.kill("SIGTERM");
  });

  ffmpeg.once("error", async (error) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    await removeTempFile(outputPath);
    req.log.error({ err: error, sourceHost: sourceUrl.hostname }, "MP4 conversion process failed");
    if (!res.headersSent) {
      res.status(502).json({ error: "Conversion MP4 impossible", detail: error.message });
    }
  });

  ffmpeg.once("close", async (code) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);

    if (code !== 0) {
      await removeTempFile(outputPath);
      req.log.warn({ code, sourceHost: sourceUrl.hostname, detail: getErrorDetail(stderr) }, "HLS conversion rejected");
      if (!res.headersSent) {
        res.status(502).json({
          error: "Conversion MP4 impossible",
          detail: getErrorDetail(stderr),
        });
      }
      return;
    }

    req.log.info({ sourceHost: sourceUrl.hostname, mode }, "HLS stream converted to MP4");
    res.status(200);
    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Content-Disposition", `attachment; filename="video-${Date.now()}.mp4"`);
    const output = createReadStream(outputPath);
    output.once("error", async (error) => {
      req.log.error({ err: error }, "MP4 file could not be sent");
      await removeTempFile(outputPath);
      if (!res.headersSent) res.status(502).json({ error: "Fichier MP4 indisponible" });
    });
    output.once("close", () => {
      void removeTempFile(outputPath);
    });
    output.pipe(res);
  });
});

export default router;