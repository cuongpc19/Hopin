import Phaser from "phaser";
import { GAME_W, GAME_H, setPageBackground } from "./GameScene";
import { Audio } from "../game/audio";
import { t as tr, applyHostLang } from "../game/i18n";
import { platform } from "../platform";
import { abAssign, abApplyUrlOverride } from "../game/ab";
import { startSession } from "../game/telemetry";

// Fade out and remove the pre-boot loading screen baked into index.html.
function hideBootScreen() {
  const el = document.getElementById("boot");
  if (!el) return;
  el.classList.add("hide");
  setTimeout(() => el.remove(), 350);
}

// First screen on launch: the "Hop In!" poster, full-screen, tap to play.
export class SplashScene extends Phaser.Scene {
  constructor() {
    super("splash");
  }

  preload() {
    // Cut from the same render as the store covers, so the first screen a player sees is
    // the picture they just clicked on CrazyGames. The old hopin2.jpg also spelled the name
    // "Hop-in" straight into the artwork, which no longer matched anything else.
    // It stays in public/art untouched if this ever needs reverting.
    this.load.image("splash", "art/splash-hopin.jpg");
  }

  create() {
    // The instant HTML boot screen (index.html #boot) has done its job now that
    // the engine is up and the poster is decoded — fade it out.
    hideBootScreen();

    // `?ab=` phải chạy TRƯỚC lối tắt ?level bên dưới — lối tắt đó bỏ qua toàn bộ phần còn lại
    // của hàm này, tức bỏ qua cả chỗ gán nhánh. Xem chú thích ở abApplyUrlOverride().
    abApplyUrlOverride();

    // Dev convenience: ?level=N jumps straight into the game, skipping the splash.
    if (new URLSearchParams(location.search).has("level")) {
      this.scene.start("game");
      return;
    }

    // Match GameScene's camera setup so world coords stay 480x854 at any DPR.
    const dpr = this.scale.gameSize.width / GAME_W;
    this.cameras.main.setZoom(dpr);
    this.cameras.main.centerOn(GAME_W / 2, GAME_H / 2);
    this.cameras.main.setBackgroundColor(0xf4efe0); // cream, matches poster top
    setPageBackground(0xf4efe0); // …and the bands outside the canvas, so the poster floats on cream

    // Poster, scaled to COVER the screen (crop overflow, no stretch).
    const img = this.add.image(GAME_W / 2, GAME_H / 2, "splash");
    img.setScale(Math.max(GAME_W / img.width, GAME_H / img.height));

    // "Loading…" — CHỈ chữ (bỏ nền button/pill), đặt THẤP hơn (user 2026-08-02).
    const y = Math.round(GAME_H * 0.78);
    const label = this.add
      .text(GAME_W / 2, y, tr("loading") + "…", {
        fontFamily: "Arial, sans-serif",
        fontStyle: "bold",
        fontSize: "24px", // +20% (user 2026-08-02)
        color: "#ffffff",
        stroke: "#5a3a12",
        strokeThickness: 6,
      })
      .setOrigin(0.5)
      .setDepth(1);
    // animated dots so it reads as "working"
    this.time.addEvent({
      delay: 420, loop: true,
      callback: () => { const n = ((label.text.match(/\./g)?.length ?? 0) % 3) + 1; label.setText(tr("loading") + ".".repeat(n)); },
    });
    this.tweens.add({
      targets: label,
      scale: 1.06,
      alpha: 0.85,
      duration: 700,
      yoyo: true,
      repeat: -1,
      ease: "Sine.inOut",
    });

    // Build version (bottom, small) — so you can confirm a fresh deploy loaded.
    this.add
      .text(GAME_W / 2, GAME_H - 16, `v${__APP_VERSION__} · ${__APP_BUILD__}`, {
        fontFamily: "Arial, sans-serif",
        fontStyle: "bold",
        fontSize: "12px",
        color: "#ffffff",
        stroke: "#5a3a12",
        strokeThickness: 3,
      })
      .setOrigin(0.5, 1)
      .setAlpha(0.85);

    // Auto-advance to Home. No tap required (user 2026-08-01).
    //
    // On the web host the poster is pure cost: CrazyGames measures time-to-gameplay all
    // the way to the gameplayStart call, and average session length and conversion are
    // two of the three KPIs Basic Launch is graded on. A fixed 3s of poster buys nothing
    // there — unlike the APK, where it hides real engine start-up — so that build leaves
    // as soon as the Home art is actually ready (user 2026-08-08: "cho thấp nhất có thể").
    //
    // FLOOR là thời gian TỐI THIỂU tấm poster được phép nằm đó. Bằng 0 trên web/CrazyGames
    // (user 2026-08-13: "vừa vào game cũng k cần Loading giả") — đi ngay khi thật sự tải xong,
    // không giữ lại một mili-giây nào để làm dáng. Bản APK vẫn giữ 3s vì ở đó poster che
    // đúng lúc engine khởi động thật.
    const FLOOR_MS = __TARGET__ === "android" ? 3000 : 0;
    // Hard stop, so a slow network cannot strand the player on the poster. Matches the old
    // behaviour exactly — 3s and then go, ready or not.
    // ⚠ Kept ABOVE the host's whole handshake budget (crazy.ts READY_BUDGET_MS = 2200) so
    // init always settles first; see the note there for what breaks if that ordering flips.
    const CAP_MS = 3000;
    const t0 = this.time.now;
    let went = false;
    let loadDone = false;

    // Thanh PROGRESS (chuyên nghiệp hơn dấu "…"): track bo tròn + fill vàng chạy mượt theo
    // thời gian tối thiểu; đầy 100% ngay trước khi fade sang Home (user 2026-08-02).
    const barW = 264, barH = 15, barX = GAME_W / 2 - barW / 2, barY = y + 40; // +20% (user 2026-08-02)
    const track = this.add.graphics().setDepth(1);
    track.fillStyle(0x2a1c0a, 0.35); track.fillRoundedRect(barX, barY, barW, barH, barH / 2);
    track.lineStyle(2, 0xffffff, 0.55); track.strokeRoundedRect(barX, barY, barW, barH, barH / 2);
    const barFill = this.add.graphics().setDepth(2);
    const prog = { v: 0 };
    const drawBar = () => {
      barFill.clear();
      const w = Phaser.Math.Clamp(prog.v, 0, 1) * (barW - 4);
      if (w > 0.5) { barFill.fillStyle(0xffd95e, 1); barFill.fillRoundedRect(barX + 2, barY + 2, w, barH - 4, (barH - 4) / 2); }
    };
    // The bar creeps across the LONGEST the wait can be, not the shortest. Tweening it over
    // FLOOR_MS made it fill in 300ms and then sit frozen while we waited on the host SDK —
    // which reads as a hang, and is what "sao đoạn đầu load lâu thế" was actually about
    // (user 2026-08-08). goHome snaps it to full, so leaving early still looks finished.
    this.tweens.add({ targets: prog, v: 0.92, duration: CAP_MS, ease: "Sine.out", onUpdate: drawBar });

    // Bring the host SDK up while the poster is on screen. Its init is asynchronous
    // and nothing may call into it before that resolves, so the loading screen is the
    // only sane place for it. Never throws and never blocks: if an adblocker eats the
    // script we simply carry on with a no-op host (CRAZYGAMES.md §2).
    platform.loadingStart();
    let storageReady = __TARGET__ !== "crazy"; // only the SDK host has anything to wait for
    void platform.init().then(() => {
      // Refine the language from the SDK's locale. This is only ever a refinement: i18n
      // already picked a language synchronously at module load from navigator.language,
      // so every screen is drawn in the right one from the first frame.
      //
      // It genuinely may land after Home is built now that the poster can be as short as
      // 300ms — fetching their script takes longer than that. Text already drawn is not
      // re-rendered, so on the rare boot where the SDK disagrees with the browser, Home
      // stays in the browser's language until the next screen. Not worth holding up the
      // game for: time-to-gameplay is a graded KPI and this is a cosmetic edge case.
      const l = platform.preferredLang();
      if (l) applyHostLang(l);

      // Saved progress is only readable now: their SDK preloads the player's data during
      // init, so anything read before this is the local copy. Home shows gold, hearts and
      // level progress the moment it opens — showing the local copy and then writing over
      // it would cost a player their real save, so Home waits.
      storageReady = true;
      maybeGo();
    });

    // NGƯỜI CHƠI MỚI VÀO THẲNG LEVEL 1, không nhìn thấy Home (user 2026-08-13). Chỉ đọc được
    // sau khi `init()` xong trên bản CrazyGames — kho dữ liệu của họ nạp lúc đó; đọc sớm hơn
    // là đọc bản cục bộ và có thể ghi đè mất tiến độ thật.
    const isNewPlayer = () => {
      try {
        const p = platform.storage.getItem("pf_progress");
        const c = platform.storage.getItem("pf_current");
        return (!p || p === "1") && (!c || c === "1");
      } catch {
        return false; // không đọc được kho → cứ về Home như cũ, an toàn hơn
      }
    };

    const go = () => {
      if (went) return;
      went = true;
      prog.v = 1; drawBar(); // đầy 100% trước khi chuyển
      platform.loadingStop();
      const straightToPlay = isNewPlayer();
      // PHÉP THỬ A/B 15 màn đầu (src/game/ab.ts). Gán ĐÚNG MỘT LẦN cho mỗi máy, ngay tại đây
      // vì đây là chỗ duy nhất biết chắc "người này mới hay cũ".
      //
      // ⚠ CHỈ GÁN KHI ĐỌC ĐƯỢC KHO. `go()` còn được gọi bởi lưới an toàn 3 giây, và lúc đó
      // `platform.init()` có thể chưa xong — kho của CrazyGames chưa nạp, một người chơi cũ
      // trông y hệt người mới. Gán trong tình huống ấy là ném họ vào phép thử và đổi luôn 15
      // bàn đầu của họ. Không gán thì lần mở sau gán, chẳng mất gì.
      if (storageReady) abAssign(straightToPlay);
      // Mở phiên SAU khi gán, để dòng `start` mang đúng nhãn nhánh (xem chú thích ở startSession).
      startSession();
      this.cameras.main.fadeOut(350, 244, 239, 224);
      this.cameras.main.once("camerafadeoutcomplete", () =>
        straightToPlay ? this.scene.start("game", { level: 1 }) : this.scene.start("select"));
    };
    const goHome = go; // các chỗ gọi cũ (backstop, chạm màn hình) giữ nguyên tên

    // Art của Home. `star-icon` và bốn icon booster thì GameScene cũng cần nên nạp luôn;
    // ba tấm CHỈ Home dùng (nền + hai mascot, ~190 KB) để `maybeGo` quyết sau, vì người chơi
    // mới đi thẳng vào màn chơi thì tải chúng là tải phí đúng vào lúc mạng eo hẹp nhất.
    this.load.image("star-icon", "art/star.png");
    for (const b of ["add", "hand", "refresh", "magnet"]) this.load.image(`booster-${b}`, `art/booster-${b}.png`);
    let homeArtQueued = false;
    const queueHomeArt = () => {
      if (homeArtQueued) return;
      homeArtQueued = true;
      this.load.image("background2", "art/background2.jpg");
      this.load.image("avatar", "art/slime-3.png");
      this.load.image("start-slime", "art/slime-3.png");
      this.load.start(); // Phaser cho phép nối thêm vào hàng đợi rồi chạy tiếp
    };
    // Leave as soon as BOTH the Home art and the saved progress are ready, but never
    // before FLOOR_MS. On a warm cache with a healthy SDK that is a few hundred ms, versus
    // the old flat 3 seconds.
    const maybeGo = () => {
      if (went || !loadDone || !storageReady) return;
      // Giờ mới đọc được kho: người chơi cũ thì phải có art của Home trước khi sang, người
      // chơi mới thì bỏ qua hẳn — `loadDone` sẽ được bật lại khi mẻ art đó xong.
      if (!isNewPlayer() && !homeArtQueued) { loadDone = false; queueHomeArt(); return; }
      const left = FLOOR_MS - (this.time.now - t0);
      if (left <= 0) go();
      else this.time.delayedCall(left, go);
    };
    // `on`, KHÔNG phải `once`: hàng đợi được khởi động hai lần khi người chơi cũ cần thêm art
    // của Home, và với `once` thì mẻ thứ hai không ai nghe → kẹt tới tận backstop 3 giây.
    this.load.on("complete", () => {
      loadDone = true;
      maybeGo();
    });
    this.load.start();
    // Backstop: go anyway at CAP_MS even if the art never finished — same as the old
    // fixed-3s behaviour, so a slow network is no worse off than before.
    this.time.delayedCall(CAP_MS, goHome);

    // A tap only skips ahead once loading is DONE (so Home never shows unloaded art); it
    // also serves as the audio-unlock gesture browsers require.
    this.input.on("pointerdown", () => { Audio.unlock(); if (loadDone) goHome(); });
  }
}
