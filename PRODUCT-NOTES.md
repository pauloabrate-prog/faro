# Faro — project fork notes

Faro is the public name of this independent editor project. Review applicable trademark and domain considerations before a commercial launch.

## Build and release

- Windows installer: `npm run dist` (NSIS x64).
- Linux packages: `npm run dist:linux` (AppImage and deb).
- macOS packages: `npm run dist:mac` (DMG and ZIP; build on macOS).
- `npm run dist:all` produces Windows and Linux artifacts on the current host; macOS must be built on macOS.
- `.github/workflows/release-builds.yml` builds all three platforms when manually run or when a `v*` tag is pushed. It creates build artifacts only and does not publish a release.
- Updates are disabled unless `FARO_UPDATE_URL` is deliberately configured. This prevents this fork from polling the upstream Lumen GitHub Releases feed.

## Commercial readiness gate

The upstream tree includes GSAP and exposes a visual motion-graphics template editor. The current GSAP Standard License has a prohibited-use clause for certain no-code visual-animation tools competing with Webflow's builder. This appears relevant enough to require review before selling. Keep the templates only after obtaining written licensing guidance or replace GSAP and its uses with a permissively licensed implementation.

The upstream Lumen base is MIT-licensed; preserve its attribution and notices. Review the bundled dependency notices and platform-specific behavior before each public release.
