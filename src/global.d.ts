// Build-time constants injected by Vite's `define` (see vite.config.ts).
declare const __APP_VERSION__: string; // e.g. "0.0.7" (0.0.<git commit count>)
declare const __APP_BUILD__: string; //   short git commit hash, or "local"

// Which host this bundle is built for (VITE_TARGET, default "web"). A literal at
// build time, so `if (__TARGET__ === "crazy")` is dead-code-eliminated in the other
// builds — that is what guarantees the CrazyGames bundle carries no third-party ad
// code, which their rules forbid outright. See CRAZYGAMES.md.
declare const __TARGET__: "web" | "crazy" | "android";
