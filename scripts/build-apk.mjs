// One command to go from source to an installable APK: build the web bundle, copy it
// into the Android project, re-apply our icons/manifest tweaks, run Gradle, and drop the
// finished APK in the project root named after the git build stamp.
//
// The android/ folder is generated and untracked, so this also creates it on a fresh
// clone (npx cap add android) before building. Full notes: FEATURES.txt §26.
//
// Run: npm run apk            (or: npm run apk -- --release  once signing is set up)
import { execFileSync, execSync } from "node:child_process";
import { existsSync, mkdirSync, copyFileSync, writeFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const isWin = process.platform === "win32";

// Local toolchain (installed outside the repo so it survives a clean checkout). Override
// with JAVA_HOME / ANDROID_HOME if yours lives elsewhere.
const TOOLS = "C:/CuongPC/android-tools";
function findJdk() {
  if (process.env.JAVA_HOME) return process.env.JAVA_HOME;
  const dir = `${TOOLS}/jdk`;
  if (!existsSync(dir)) return null;
  const sub = readdirSync(dir).find((d) => d.startsWith("jdk-"));
  return sub ? `${dir}/${sub}` : null;
}
const JAVA_HOME = findJdk();
const ANDROID_HOME = process.env.ANDROID_HOME ?? `${TOOLS}/android-sdk`;
if (!JAVA_HOME || !existsSync(JAVA_HOME)) {
  console.error(`No JDK found. Install one and set JAVA_HOME, or put it in ${TOOLS}/jdk.`);
  process.exit(1);
}
if (!existsSync(ANDROID_HOME)) {
  console.error(`No Android SDK at ${ANDROID_HOME}. Set ANDROID_HOME. See FEATURES.txt §26.`);
  process.exit(1);
}

const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { cwd: root, stdio: "inherit", shell: isWin, ...opts });

const step = (msg) => console.log(`\n=== ${msg} ===`);

step("Building web bundle");
run("npm", ["run", "build"]);

if (!existsSync(root + "android")) {
  step("Creating the Android project (first run)");
  run("npx", ["cap", "add", "android"]);
} else {
  step("Syncing web assets into the Android project");
  run("npx", ["cap", "sync", "android"]);
}

// sdk.dir must use forward slashes: in a .properties file a backslash is an escape
// character, so "C:\Users\..." silently becomes "C:Users..." and Gradle dies with
// "IOException: The filename, directory name, or volume label syntax is incorrect".
writeFileSync(root + "android/local.properties", `sdk.dir=${ANDROID_HOME.replace(/\\/g, "/")}\n`);

step("Applying icons + portrait lock");
run("node", ["scripts/setup-android.mjs"]);

const release = process.argv.includes("--release");
const task = release ? "assembleRelease" : "assembleDebug";
step(`Gradle ${task}`);
// ".\" is required on Windows: cmd.exe does not resolve programs from the cwd.
run(isWin ? ".\\gradlew.bat" : "./gradlew", [task, "--no-daemon"], {
  cwd: root + "android",
  env: { ...process.env, JAVA_HOME, ANDROID_HOME },
});

// Name the copy after the same git stamp the game shows on its splash screen.
let stamp = "local";
try {
  stamp = "0.0." + execSync("git rev-list --count HEAD", { cwd: root }).toString().trim();
} catch { /* not a git checkout */ }
const built = `${root}android/app/build/outputs/apk/${release ? "release" : "debug"}/app-${release ? "release" : "debug"}.apk`;
if (!existsSync(built)) {
  console.error(`\nGradle finished but ${built} is missing.`);
  process.exit(1);
}
const out = `${root}HopIn-v${stamp}-${release ? "release" : "debug"}.apk`;
mkdirSync(root, { recursive: true });
copyFileSync(built, out);
console.log(`\nAPK ready: ${out}`);
