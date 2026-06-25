const https = require("https");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execSync } = require("child_process");

const binDir = path.join(__dirname, "..", "bin");
if (!fs.existsSync(binDir)) fs.mkdirSync(binDir, { recursive: true });

const ytDlpPath = path.join(binDir, "yt-dlp");

function download(url, dest, cb) {
  const file = fs.createWriteStream(dest);
  https.get(url, (res) => {
    if (res.statusCode === 301 || res.statusCode === 302) {
      file.close();
      fs.unlinkSync(dest);
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
    bundleFFmpeg();
  }
);

function bundleFFmpeg() {
  // 1. Check if already on system
  try {
    const ff = execSync("which ffmpeg 2>/dev/null").toString().trim();
    const fp = execSync("which ffprobe 2>/dev/null").toString().trim();
    if (ff && fp) {
      fs.copyFileSync(ff, path.join(binDir, "ffmpeg"));
      fs.copyFileSync(fp, path.join(binDir, "ffprobe"));
      fs.chmodSync(path.join(binDir, "ffmpeg"), "755");
      fs.chmodSync(path.join(binDir, "ffprobe"), "755");
      console.log("ffmpeg bundled from system.");
      return;
    }
  } catch (_) {}

  // 2. Try apt-get (Netlify Ubuntu build image)
  console.log("Installing ffmpeg via apt...");
  try {
    execSync("apt-get update -qq 2>&1 | tail -1 && apt-get install -y ffmpeg 2>&1 | tail -5", { stdio: "inherit" });
    const ff = execSync("which ffmpeg").toString().trim();
    const fp = execSync("which ffprobe").toString().trim();
    fs.copyFileSync(ff, path.join(binDir, "ffmpeg"));
    fs.copyFileSync(fp, path.join(binDir, "ffprobe"));
    fs.chmodSync(path.join(binDir, "ffmpeg"), "755");
    fs.chmodSync(path.join(binDir, "ffprobe"), "755");
    console.log("ffmpeg installed and bundled.");
    return;
  } catch (e) {
    console.log("apt failed:", e.message);
  }

  // 3. Download static build
  console.log("Downloading static ffmpeg...");
  try {
    const tmpTar = path.join(os.tmpdir(), "ffmpeg.tar.xz");
    const extractDir = path.join(os.tmpdir(), "ffmpeg-static");
    execSync(
      `curl -L "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz" -o "${tmpTar}"`,
      { stdio: "inherit", timeout: 120000 }
    );
    fs.mkdirSync(extractDir, { recursive: true });
    execSync(`tar -xf "${tmpTar}" -C "${extractDir}" --strip-components=1`, { stdio: "inherit" });
    fs.copyFileSync(path.join(extractDir, "ffmpeg"), path.join(binDir, "ffmpeg"));
    fs.copyFileSync(path.join(extractDir, "ffprobe"), path.join(binDir, "ffprobe"));
    fs.chmodSync(path.join(binDir, "ffmpeg"), "755");
    fs.chmodSync(path.join(binDir, "ffprobe"), "755");
    console.log("Static ffmpeg bundled.");
  } catch (e) {
    console.error("Could not obtain ffmpeg:", e.message);
    process.exit(1);
  }
}
