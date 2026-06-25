const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

// bin/ lives two levels up from netlify/functions/clip.js
const BIN_DIR = path.resolve(__dirname, "..", "..", "bin");

function findBin(name) {
  const local = path.join(BIN_DIR, name);
  if (fs.existsSync(local)) return local;
  // fallback to PATH
  for (const dir of ["/usr/bin", "/usr/local/bin", "/bin"]) {
    const p = path.join(dir, name);
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

function fail(msg, extra = {}) {
  console.error("CLIP ERROR:", msg, extra);
  return {
    statusCode: 400,
    headers: cors(),
    body: JSON.stringify({ error: msg }),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors(), body: "" };
  if (event.httpMethod !== "POST") return fail("POST only");

  // Parse body
  let url;
  try {
    ({ url } = JSON.parse(event.body || "{}"));
  } catch (_) {
    return fail("Invalid JSON body");
  }
  if (!url) return fail("Missing url");

  const ytDlp = findBin("yt-dlp");
  const ffmpeg = findBin("ffmpeg");

  console.log("ytDlp:", ytDlp, "exists:", fs.existsSync(ytDlp));
  console.log("ffmpeg:", ffmpeg, "exists:", fs.existsSync(ffmpeg));
  console.log("BIN_DIR contents:", fs.existsSync(BIN_DIR) ? fs.readdirSync(BIN_DIR) : "missing");

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ytclip-"));

  try {
    // Step 1: get duration
    const info = spawnSync(ytDlp, [
      "--no-playlist", "--print", "duration", "--no-warnings", url,
    ], { timeout: 30000, encoding: "utf8" });

    console.log("yt-dlp info stdout:", info.stdout?.trim());
    console.log("yt-dlp info stderr:", info.stderr?.trim()?.slice(0, 500));

    if (info.status !== 0 || !info.stdout?.trim()) {
      return fail("Could not get video info: " + (info.stderr?.trim()?.slice(0, 200) || "unknown error"));
    }

    const duration = parseFloat(info.stdout.trim());
    if (!duration || isNaN(duration) || duration < 25) {
      return fail(`Video too short or unreadable (duration: ${info.stdout.trim()})`);
    }

    // Step 2: random clip params
    const clipDuration = Math.floor(Math.random() * 11) + 20; // 20–30s
    const maxStart = Math.max(0, Math.floor(duration) - clipDuration - 5);
    const startSec = Math.floor(Math.random() * maxStart);

    console.log(`Duration: ${duration}s, clip: ${startSec}s → ${startSec + clipDuration}s`);

    // Step 3: download only the needed section
    const rawPath = path.join(tmpDir, "raw.mp4");
    const dl = spawnSync(ytDlp, [
      "--no-playlist",
      "-f", "bestvideo[ext=mp4][height<=720]+bestaudio[ext=m4a]/best[ext=mp4][height<=720]/best",
      "--merge-output-format", "mp4",
      "--download-sections", `*${startSec}-${startSec + clipDuration}`,
      "--force-keyframes-at-cuts",
      "--no-warnings",
      "-o", rawPath,
      url,
    ], { timeout: 200000, encoding: "utf8" });

    console.log("yt-dlp download status:", dl.status);
    console.log("yt-dlp download stderr:", dl.stderr?.trim()?.slice(0, 500));

    const rawExists = fs.existsSync(rawPath);
    console.log("raw.mp4 exists:", rawExists, rawExists ? fs.statSync(rawPath).size + " bytes" : "");

    let inputFile = rawPath;

    if (dl.status !== 0 || !rawExists || fs.statSync(rawPath).size < 1000) {
      // Fallback: download best single-file format
      console.log("Section download failed, trying single-file fallback...");
      const fallbackPath = path.join(tmpDir, "fallback.mp4");
      const dl2 = spawnSync(ytDlp, [
        "--no-playlist",
        "-f", "best[ext=mp4][height<=480]/best[height<=480]/best",
        "--no-warnings",
        "-o", fallbackPath,
        url,
      ], { timeout: 200000, encoding: "utf8" });

      console.log("fallback dl status:", dl2.status);
      if (dl2.status !== 0 || !fs.existsSync(fallbackPath)) {
        return fail("Failed to download video: " + dl2.stderr?.trim()?.slice(0, 200));
      }
      inputFile = fallbackPath;
    }

    // Step 4: cut with ffmpeg
    const outPath = path.join(tmpDir, "clip.mp4");
    const ff = spawnSync(ffmpeg, [
      "-ss", String(startSec),
      "-i", inputFile,
      "-t", String(clipDuration),
      "-c:v", "libx264", "-preset", "ultrafast", "-crf", "28",
      "-c:a", "aac", "-b:a", "96k",
      "-movflags", "+faststart",
      "-y", outPath,
    ], { timeout: 120000 });

    console.log("ffmpeg status:", ff.status);
    if (ff.stderr) console.log("ffmpeg stderr:", ff.stderr.toString().slice(-300));

    let finalFile = outPath;
    if (ff.status !== 0 || !fs.existsSync(outPath) || fs.statSync(outPath).size < 1000) {
      // Just serve the raw file if ffmpeg fails
      if (rawExists) {
        finalFile = inputFile;
      } else {
        return fail("Failed to encode clip");
      }
    }

    const buf = fs.readFileSync(finalFile);
    cleanup(tmpDir);

    return {
      statusCode: 200,
      headers: cors(),
      body: JSON.stringify({
        clip: buf.toString("base64"),
        size: buf.length,
        startSec,
        clipDuration,
      }),
    };

  } catch (e) {
    cleanup(tmpDir);
    console.error("Unhandled error:", e);
    return fail(e.message);
  }
};

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
}
