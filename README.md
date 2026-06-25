# YT Clip Cutter

Paste a YouTube URL → get a random 20–30 second clip → download to your phone.

## Deploy to Netlify via GitHub (required — drag & drop won't work)

Netlify's drag-and-drop skips the build step, so yt-dlp never gets downloaded and functions never deploy. You need to connect via GitHub instead.

### Steps

1. **Create a GitHub account** at github.com if you don't have one

2. **Create a new repo** — go to github.com/new, name it `yt-clip-app`, set it to Public, click Create

3. **Upload these files** — on the repo page click "uploading an existing file", then drag everything from this zip into the upload box and commit

4. **Connect to Netlify** — go to netlify.com → Add new site → Import an existing project → GitHub → pick your repo

5. **Build settings** (Netlify should auto-detect from netlify.toml, but confirm):
   - Build command: `node scripts/setup.js`
   - Publish directory: `public`

6. **Deploy** — click Deploy. Build takes ~60 seconds (downloads yt-dlp).

7. **Done** — open the URL on your phone and install as an app via "Add to Home Screen"

## Notes

- Only works on public YouTube videos
- Netlify free plan has a 26s function timeout. If clips time out, upgrade to Netlify Pro ($19/mo) for 300s.
