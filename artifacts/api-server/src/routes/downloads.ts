import { createReadStream } from "node:fs";
import { stat, unlink } from "node:fs/promises";
import { spawn } from "node:child_process";
import { Router, type IRouter } from "express";
import { join } from "node:path";
import { tmpdir } from "node:os";

const router: IRouter = Router();
const DOWNLOAD_TIMEOUT_MS = 20 * 60 * 1000;
const PLAYLIST_TIMEOUT_MS = 30 * 1000;
const QUALITY_HEIGHTS = {
  "360": 360,
  "480": 480,
  "720": 720,
  "1080": 1080,
} as const;
type DownloadQuality = "original" | keyof typeof QUALITY_HEIGHTS;

type HlsVariant = {
  url: URL;
  height: number | null;
  bandwidth: number;
};

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
    return "Le serveur source a refusé la requête (HTTP 403). Le lien peut être lié à sa page d’origine, à une adresse IP ou à une signature temporaire.";
  }
  if (cleaned.length > 0) return cleaned.slice(-500);
  return "Le serveur vidéo n’a pas pu être converti en MP4.";
}

function parseDownloadQuality(value: unknown): DownloadQuality {
  if (value === "360" || value === "480" || value === "720" || value === "1080") {
    return value;
  }
  return "original";
}

function parseAttributeNumber(attributes: string, name: string) {
  const match = attributes.match(new RegExp(`${name}=(\\d+)`));
  return match ? Number(match[1]) : 0;
}

function parseHlsVariants(playlist: string, sourceUrl: URL): HlsVariant[] {
  const lines = playlist.split(/\r?\n/);
  const variants: HlsVariant[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim() ?? "";
    if (!line.startsWith("#EXT-X-STREAM-INF:")) continue;

    let uri = "";
    for (let nextIndex = index + 1; nextIndex < lines.length; nextIndex += 1) {
      const candidate = lines[nextIndex]?.trim() ?? "";
      if (!candidate || candidate.startsWith("#")) continue;
      uri = candidate;
      break;
    }
    if (!uri) continue;

    variants.push({
      url: new URL(uri, sourceUrl),
      height: line.match(/RESOLUTION=\d+x(\d+)/)?.[1] ? Number(line.match(/RESOLUTION=\d+x(\d+)/)?.[1]) : null,
      bandwidth: parseAttributeNumber(line, "BANDWIDTH"),
    });
  }

  return variants;
}

function compareVariants(left: HlsVariant, right: HlsVariant) {
  const leftHeight = left.height ?? 0;
  const rightHeight = right.height ?? 0;
  return leftHeight - rightHeight || left.bandwidth - right.bandwidth;
}

async function selectHlsQuality(
  sourceUrl: URL,
  quality: DownloadQuality,
  headers: Record<string, string>,
): Promise<{ inputUrl: string; scaleHeight: number | null; selectedHeight: number | null }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PLAYLIST_TIMEOUT_MS);

  try {
    const response = await fetch(sourceUrl, { headers, signal: controller.signal });
    if (!response.ok) {
      throw new Error(
        response.status === 403
          ? "Le serveur source a refusé le lien signé (HTTP 403)."
          : `Le serveur source a répondu HTTP ${response.status}.`,
      );
    }

    const playlist = await response.text();
    const variants = parseHlsVariants(playlist, sourceUrl);
    if (variants.length === 0) {
      return {
        inputUrl: sourceUrl.toString(),
        scaleHeight: quality === "original" ? null : QUALITY_HEIGHTS[quality],
        selectedHeight: null,
      };
    }

    const knownVariants = variants.filter((variant) => variant.height !== null);
    if (knownVariants.length === 0) {
      const bestVariant = [...variants].sort((left, right) => right.bandwidth - left.bandwidth)[0];
      return { inputUrl: bestVariant.url.toString(), scaleHeight: null, selectedHeight: null };
    }

    const sortedVariants = [...knownVariants].sort(compareVariants);
    if (quality === "original") {
      const bestVariant = sortedVariants[sortedVariants.length - 1];
      return { inputUrl: bestVariant.url.toString(), scaleHeight: null, selectedHeight: bestVariant.height };
    }

    const targetHeight = QUALITY_HEIGHTS[quality];
    const atOrAboveTarget = sortedVariants.filter((variant) => (variant.height ?? 0) >= targetHeight);
    const selectedVariant = atOrAboveTarget.length > 0 ? atOrAboveTarget[0] : sortedVariants[sortedVariants.length - 1];

    return {
      inputUrl: selectedVariant.url.toString(),
      scaleHeight: (selectedVariant.height ?? targetHeight) > targetHeight ? targetHeight : null,
      selectedHeight: selectedVariant.height,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function removeTempFile(filePath: string) {
  await unlink(filePath).catch(() => undefined);
}

router.get("/downloads/mp4", async (req, res) => {
  const sourceValue = req.query.url;
  const mode = req.query.mode === "fast" ? "fast" : "compatible";
  const quality = parseDownloadQuality(req.query.quality);

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

  let qualitySelection: { inputUrl: string; scaleHeight: number | null; selectedHeight: number | null };
  try {
    qualitySelection = await selectHlsQuality(sourceUrl, quality, headers);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "La playlist HLS n’a pas pu être analysée.";
    req.log.warn({ err: error, sourceHost: sourceUrl.hostname, quality }, "HLS quality selection failed");
    res.status(502).json({ error: "Qualité vidéo indisponible", detail });
    return;
  }

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
    qualitySelection.inputUrl,
    "-map",
    "0:v:0?",
    "-map",
    "0:a:0?",
  ];
  const shouldResize = qualitySelection.scaleHeight !== null;
  const codecArgs =
    mode === "fast" && !shouldResize
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
  const scaleArgs =
    qualitySelection.scaleHeight
      ? ["-vf", `scale=-2:min(${qualitySelection.scaleHeight},ih)`]
      : [];
  const ffmpeg = spawn("ffmpeg", [
    ...inputArgs,
    ...scaleArgs,
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

    req.log.info(
      { sourceHost: sourceUrl.hostname, mode, quality, selectedHeight: qualitySelection.selectedHeight },
      "HLS stream converted to MP4",
    );
    let outputSize: number;
    try {
      outputSize = (await stat(outputPath)).size;
    } catch (error) {
      await removeTempFile(outputPath);
      req.log.error({ err: error }, "MP4 output could not be inspected");
      if (!res.headersSent) {
        res.status(502).json({ error: "Fichier MP4 indisponible" });
      }
      return;
    }

    res.status(200);
    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Content-Length", outputSize);
    const qualityLabel = quality === "original" ? "original" : `${quality}p`;
    res.setHeader("Content-Disposition", `attachment; filename="video-${qualityLabel}-${Date.now()}.mp4"`);
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