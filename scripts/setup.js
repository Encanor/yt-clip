const https = require("https");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const binDir = path.join(__dirname, "..", "bin");
if (!fs.existsSync(binDir)) fs.mkdirSync(binDir, { recursive: true });

const ytDlpPath = path.join(binDir, "yt-dlp");

function download(url, dest, cb) {
  const file = fs.createWriteStream(dest);
  https.get(url, (res) => {
    if (res.statusCode === 301 || res.statusCode === 302) {
      file.close();
      download(res.headers.location, dest, cb);
      return;
    }
    res.pipe(file);
    file.on("finish", () => { file.close(); cb(null); });
  }).on("error", cb);
}

console.log("Downloading yt-dlp...");
download(
  "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux",
  ytDlpPath,
  (err) => {
    if (err) { console.error("yt-dlp download failed:", err); process.exit(1); }
    fs.chmodSync(ytDlpPath, "755");
    console.log("yt-dlp ready.");

    // Copy ffmpeg into bin/ so it's bundled with the function
    try {
      const ffmpegSrc = execSync("which ffmpeg").toString().trim();
      const ffprobeSrc = execSync("which ffprobe").toString().trim();
      fs.copyFileSync(ffmpegSrc, path.join(binDir, "ffmpeg"));
      fs.copyFileSync(ffprobeSrc, path.join(binDir, "ffprobe"));
      fs.chmodSync(path.join(binDir, "ffmpeg"), "755");
      fs.chmodSync(path.join(binDir, "ffprobe"), "755");
      console.log("ffmpeg bundled.");
    } catch (e) {
      console.log("ffmpeg not found, will rely on system install:", e.message);
    }
  }
);
