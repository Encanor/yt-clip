const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

function findBin(name) {
  const candidates = [
    path.join(__dirname, "..", "..", "bin", name),
    `/usr/bin/${name}`,
    `/usr/local/bin/${name}`,
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return name;
}

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };
}

function err(msg, code = 400) {
  return { statusCode: code, headers: cors(), body: JSON.stringify({ error: msg }) };
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors(), body: "" };
  if (event.httpMethod !== "POST") return err("POST only", 405);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ytclip-"));

  try {
    const { url } = JSON.parse(event.body || "{}");
    if (!url) return err("Missing url");

    const ytDlp = findBin("yt-dlp");
    const ffmpeg = findBin("ffmpeg");

    // Step 1: get video duration
    const infoResult = spawnSync(ytDlp, [
      "--no-playlist",
      "--print", "duration",
      "--no-warnings",
      url,
    ], { timeout: 30000, encoding: "utf8" });

    if (infoResult.status !== 0) {
      return err("Could not fetch video info. Check the URL.");
    }

    const duration = parseFloat(infoResult.stdout.trim());
    if (!duration || duration < 30) {
      return err("Video is too short (must be at least 30 seconds).");
    }

    // Step 2: pick a random start point (leave 30s buffer at end)
    const maxStart = Math.floor(duration) - 30;
    const clipDuration = Math.floor(Math.random() * 11) + 20; // 20–30s
    const startSec = Math.floor(Math.random() * maxStart);

    // Step 3: download just that section (fast — no full download)
    const rawPath = path.join(tmpDir, "raw.mp4");
    const dlResult = spawnSync(ytDlp, [
      "--no-playlist",
      "-f", "bestvideo[ext=mp4][height<=720]+bestaudio[ext=m4a]/best[ext=mp4][height<=720]/best[height<=720]/best",
      "--merge-output-format", "mp4",
      "--download-sections", `*${startSec}-${startSec + clipDuration}`,
      "--force-keyframes-at-cuts",
      "--no-warnings",
      "-o", rawPath,
      url,
    ], { timeout: 180000, encoding: "utf8" });

    if (dlResult.status !== 0 || !fs.existsSync(rawPath)) {
      // Fallback: full download then cut
      const fullPath = path.join(tmpDir, "full.%(ext)s");
      spawnSync(ytDlp, [
        "--no-playlist",
        "-f", "bestvideo[ext=mp4][height<=720]+bestaudio[ext=m4a]/best[ext=mp4][height<=720]/best",
        "--merge-output-format", "mp4",
        "--no-warnings",
        "-o", fullPath,
        url,
      ], { timeout: 180000, encoding: "utf8" });

      const files = fs.readdirSync(tmpDir).filter(f => f.startsWith("full"));
      if (!files.length) return err("Failed to download video.");

      const inputFile = path.join(tmpDir, files[0]);
      const clippedPath = path.join(tmpDir, "clip.mp4");

      const ff = spawnSync(ffmpeg, [
        "-ss", String(startSec),
        "-i", inputFile,
        "-t", String(clipDuration),
        "-c:v", "libx264", "-preset", "fast", "-crf", "23",
        "-c:a", "aac", "-b:a", "128k",
        "-movflags", "+faststart",
        "-y", clippedPath,
      ], { timeout: 120000 });

      if (ff.status !== 0) return err("Failed to cut clip.");

      const buf = fs.readFileSync(clippedPath);
      cleanup(tmpDir);
      return respond(buf, startSec, clipDuration);
    }

    // Re-encode for compatibility
    const outPath = path.join(tmpDir, "clip.mp4");
    const ffResult = spawnSync(ffmpeg, [
      "-i", rawPath,
      "-c:v", "libx264", "-preset", "fast", "-crf", "23",
      "-c:a", "aac", "-b:a", "128k",
      "-movflags", "+faststart",
      "-y", outPath,
    ], { timeout: 120000 });

    if (ffResult.status !== 0 || !fs.existsSync(outPath)) {
      // rawPath might already be fine, just serve it
      const buf = fs.readFileSync(rawPath);
      cleanup(tmpDir);
      return respond(buf, startSec, clipDuration);
    }

    const buf = fs.readFileSync(outPath);
    cleanup(tmpDir);
    return respond(buf, startSec, clipDuration);

  } catch (e) {
    cleanup(tmpDir);
    console.error(e);
    return err(e.message);
  }
};

function respond(buf, startSec, clipDuration) {
  return {
    statusCode: 200,
    headers: {
      ...cors(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      clip: buf.toString("base64"),
      size: buf.length,
      startSec,
      clipDuration,
    }),
  };
}

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
}
