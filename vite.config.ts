import { defineConfig, type Plugin } from "vite";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const root = fileURLToPath(new URL(".", import.meta.url));
const LEVELS = root + "src/levels/designed.json";

// Auto build version shown on the start screen. Derived from git so it increases by
// itself every commit/deploy (no manual bump): version = 0.0.<commit count>, plus the
// short commit hash as a guaranteed-unique build stamp. Falls back to package.json if
// git isn't available (e.g. a stripped tarball build).
function buildVersion(): { version: string; build: string } {
  try {
    const count = execSync("git rev-list --count HEAD", { cwd: root }).toString().trim();
    const hash = execSync("git rev-parse --short HEAD", { cwd: root }).toString().trim();
    return { version: `0.0.${count}`, build: hash };
  } catch {
    try {
      const pkg = JSON.parse(readFileSync(root + "package.json", "utf8"));
      return { version: String(pkg.version ?? "0.0.0"), build: "local" };
    } catch {
      return { version: "0.0.0", build: "local" };
    }
  }
}
const VERSION = buildVersion();
const EDITOR = root + "tools/level-editor.html";

// Dev-only bridge so tools/level-editor.html (opened at /editor) can save levels
// straight into designed.json — no copy-paste. Inactive in production builds.
function levelEditorApi(): Plugin {
  const readLevels = () => (existsSync(LEVELS) ? JSON.parse(readFileSync(LEVELS, "utf8")) : {});
  const send = (res: any, code: number, obj: unknown) => {
    res.statusCode = code;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(obj));
  };
  const readBody = (req: any) =>
    new Promise<string>((resolve) => {
      let b = "";
      req.on("data", (c: Buffer) => (b += c));
      req.on("end", () => resolve(b));
    });

  return {
    name: "level-editor-api",
    apply: "serve",
    // A JSON data change doesn't reliably hot-swap through the import graph, so force
    // a full page reload of every open game tab whenever a level is saved.
    handleHotUpdate({ file, server }) {
      if (file.replace(/\\/g, "/").endsWith("src/levels/designed.json")) {
        server.ws.send({ type: "full-reload" });
        return [];
      }
    },
    configureServer(server) {
      server.middlewares.use("/editor", (req, res, next) => {
        if (req.method !== "GET") return next();
        try {
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          res.setHeader("Cache-Control", "no-store, must-revalidate"); // always serve the latest editor
          res.end(readFileSync(EDITOR));
        } catch {
          next();
        }
      });

      server.middlewares.use("/api/levels", (req, res, next) => {
        if (req.method !== "GET") return next();
        try {
          send(res, 200, readLevels());
        } catch (e) {
          send(res, 500, { ok: false, error: String(e) });
        }
      });

      server.middlewares.use("/api/save-level", async (req, res, next) => {
        if (req.method !== "POST") return next();
        try {
          const { number, level } = JSON.parse(await readBody(req));
          const n = parseInt(number, 10);
          if (!Number.isFinite(n) || n < 1) throw new Error("invalid level number");
          if (!level || !Array.isArray(level.board)) throw new Error("missing level data");
          const data = readLevels();
          data[n] = level;
          // keep numeric keys sorted so the file stays tidy
          const sorted: Record<string, unknown> = {};
          for (const k of Object.keys(data).map(Number).sort((a, b) => a - b)) sorted[k] = data[k];
          writeFileSync(LEVELS, JSON.stringify(sorted, null, 2) + "\n");
          send(res, 200, { ok: true, number: n });
        } catch (e) {
          send(res, 400, { ok: false, error: String(e) });
        }
      });

      server.middlewares.use("/api/delete-level", async (req, res, next) => {
        if (req.method !== "POST") return next();
        try {
          const { number } = JSON.parse(await readBody(req));
          const n = parseInt(number, 10);
          const data = readLevels();
          delete data[n];
          writeFileSync(LEVELS, JSON.stringify(data, null, 2) + "\n");
          send(res, 200, { ok: true });
        } catch (e) {
          send(res, 400, { ok: false, error: String(e) });
        }
      });
    },
  };
}

// base: "./" makes asset paths relative — required so the built app works
// both on the web and when wrapped by Capacitor (loaded from file://).
export default defineConfig({
  base: "./",
  plugins: [levelEditorApi()],
  // Bake the version into the bundle so the start screen can display it.
  define: {
    __APP_VERSION__: JSON.stringify(VERSION.version),
    __APP_BUILD__: JSON.stringify(VERSION.build),
  },
  server: {
    host: true,
    port: 5173,
    // Allow temporary Cloudflare Quick Tunnel URLs (cloudflared --url) to reach the
    // dev server so the game is playable off-network without a wifi IP.
    allowedHosts: [".trycloudflare.com"],
  },
  build: {
    outDir: "dist",
    assetsInlineLimit: 0,
  },
});
