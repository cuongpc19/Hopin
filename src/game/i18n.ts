// Tiny i18n for Hop In! — Vietnamese (default) + English.
// Usage: t("key") → current-language string; tf("key", {n: 5}) fills {n} templates.
// The choice persists in localStorage("pf_lang"); switch via the Settings modal.

import { platform } from "../platform";

export type Lang = "vi" | "en";

// Default language, in priority order:
//   0. a language the HOST locks the build to — nothing overrides it, not even a saved
//      choice (CrazyGames is English-only, user 2026-08-08)
//   1. what the player explicitly chose before (pf_lang)
//   2. what the host suggests, from the SDK locale or the browser
//   3. Vietnamese, the user's choice for the self-hosted and Android builds
//      (user 2026-08-02)
let lang: Lang = platform.forcedLang ?? platform.preferredLang() ?? "vi";
if (!platform.forcedLang) {
  try {
    const saved = platform.storage.getItem("pf_lang");
    if (saved === "en" || saved === "vi") lang = saved;
  } catch {
    /* storage unavailable — stay on the default */
  }
}

export function getLang(): Lang {
  return lang;
}

/**
 * The host learned the player's language after boot — CrazyGames' SDK init is
 * asynchronous, so its locale arrives later than this module's first evaluation.
 *
 * Only applies when the player has never chosen for themselves; an explicit pick
 * saved in pf_lang always wins. Text already drawn is not re-rendered, so call this
 * before building a screen (SplashScene does, while Home is still 3 seconds away).
 */
export function applyHostLang(l: Lang) {
  if (platform.forcedLang) return; // build is locked to one language
  try {
    if (platform.storage.getItem("pf_lang")) return; // player chose — leave them alone
  } catch {
    /* no storage — treat as "never chose" */
  }
  lang = l;
}

/** True when the build is locked to one language — the switcher hides itself. */
export function langLocked(): boolean {
  return platform.forcedLang != null;
}

export function setLang(l: Lang) {
  if (platform.forcedLang) return; // locked build — ignore, and don't persist a choice
  lang = l;
  try {
    platform.storage.setItem("pf_lang", l);
  } catch {
    /* ignore */
  }
}

// One entry per player-facing string. \n inside a value is a real line break
// (multi-line tutorial bubbles). Keep BOTH languages the same rough length so
// buttons/panels laid out for one fit the other.
const S: Record<string, { vi: string; en: string }> = {
  // ---- generic buttons ----
  cancel: { vi: "HUỶ", en: "CANCEL" },
  use: { vi: "DÙNG", en: "USE" },
  buy: { vi: "MUA", en: "BUY" },
  close: { vi: "Đóng", en: "Close" },
  closeCaps: { vi: "ĐÓNG", en: "CLOSE" },
  gotIt: { vi: "HIỂU RỒI!", en: "GOT IT!" },
  showMe: { vi: "XEM NGAY!", en: "SHOW ME!" },
  on: { vi: "BẬT", en: "ON" },
  off: { vi: "TẮT", en: "OFF" },
  home: { vi: "Home", en: "Home" },
  replay: { vi: "Chơi lại", en: "Replay" },
  loading: { vi: "Loading", en: "Loading" },

  // ---- toasts ----
  needGold: { vi: "Cần {n} Coin", en: "Need {n} Coin" },
  purchased: { vi: "Đã mua {name}! Bấm để dùng.", en: "{name} purchased! Tap to use." },
  tapToBuy: { vi: "Bấm {name} để mua ({n} 🪙)", en: "Tap {name} to buy one ({n} 🪙)" },
  max6: { vi: "Tối đa 6 ô chờ", en: "Max 6 bays" },
  plusBay: { vi: "+1 ô chờ!", en: "+1 waiting bay!" },
  queueEmptyT: { vi: "Hàng xe trống rồi", en: "Queue is empty" },
  grabHint: { vi: "Bốc xe bất kỳ — nên chọn xe hàng dưới!", en: "Grab any car — a back-row one is best!" },
  grabPickTitle: { vi: "Chọn xe để bốc", en: "Pick a car to grab" },
  grabPickHint: { vi: "Xem được 5 hàng — bấm xe bạn cần", en: "All 5 rows — tap the car you need" },
  twinGrabAll: {
    vi: "Xe nối dây: cả nhóm phải ở 2 hàng đầu mới bốc cùng được",
    en: "Linked cars: all must be in the first 2 rows to grab them together",
  },
  carSent: { vi: "Xe xuất phát!", en: "Car sent!" },
  cancelled: { vi: "Đã huỷ", en: "Cancelled" },
  recolored: { vi: "Đã đổi màu xe!", en: "Cars recolored!" },
  noSlimes: { vi: "Hết slime rồi", en: "No slimes left" },
  waitCars: { vi: "Chờ các xe đang chạy xong đã nhé!", en: "Wait for the running cars to finish!" },
  slimesGone: { vi: "Cụm slime đó không còn nữa", en: "Those slimes are gone" },
  noColorSlimes: { vi: "Không còn slime màu đó", en: "No slimes of that color" },
  vipIncoming: { vi: "Xe VIP đang tới!", en: "VIP car incoming!" },
  slotsLocked: { vi: "Các ô chờ đều đang khoá!", en: "All waiting slots are locked!" },

  // ---- magnet picker ----
  magnetTitle: { vi: "Magnet: chọn một cụm slime", en: "Magnet: tap a slime cluster" },
  magnetHint: { vi: "Bấm một slime trên bảng phóng to", en: "Tap any slime on the zoomed board" },
  magnetCount: { vi: "{n} slime sẽ lên xe VIP", en: "{n} slime(s) will board the VIP car" },

  // ---- booster buy modal ----
  buyTitle: { vi: "Mua {name}?", en: "Buy {name}?" },

  // ---- boosters (name / tutorial title / tutorial body) ----
  boost_add_label: { vi: "Add", en: "Add" },
  boost_hand_label: { vi: "Grab", en: "Grab" },
  boost_refresh_label: { vi: "Shuffle", en: "Shuffle" },
  boost_magnet_label: { vi: "Magnet", en: "Magnet" },
  boost_add_title: { vi: "Booster mới: Add!", en: "New Booster: Add!" },
  boost_hand_title: { vi: "Booster mới: Grab!", en: "New Booster: Grab!" },
  boost_refresh_title: { vi: "Booster mới: Shuffle!", en: "New Booster: Shuffle!" },
  boost_magnet_title: { vi: "Booster mới: Magnet!", en: "New Booster: Magnet!" },
  boost_add_desc: {
    vi: "Thêm 1 ô chờ — đỗ được thêm 1 xe cùng lúc.",
    en: "Adds an extra waiting bay, so one more car can park at a time.",
  },
  boost_hand_desc: {
    vi: "Phóng NGAY một xe bất kỳ trong hàng — khỏi cần chờ tới lượt.",
    en: "Instantly send out ANY car from the queue — skip the front-only rule.",
  },
  boost_refresh_desc: {
    vi: "Đổi ngẫu nhiên màu các xe trong hàng — dễ ra màu bạn đang cần.",
    en: "Re-rolls the colors of the queued cars, bringing up a color you need.",
  },
  boost_magnet_desc: {
    vi: "Chạm một slime, xe VIP sẽ hút cả cụm liền mạch cùng màu đó.",
    en: "Tap a slime and a VIP car reels in the whole connected cluster of that color.",
  },
  giftFree: { vi: "🎁 Tặng bạn {n} cái miễn phí!", en: "🎁 You got {n} free!" },

  // ---- tutorials ----
  tutTapCarSlam: { vi: "Bấm xe — nó chiếm 1 Ô CHỜ\nrồi lao ra đường chạy!", en: "Tap the car — it grabs a\nwaiting slot & rolls out!" },
  tutTapCar: { vi: "Bấm xe để\ncho nó chạy!", en: "Tap the car to\nsend it out!" },
  tutBayLocked: { vi: "Ô này bị KHOÁ khi\nxe của nó đang chạy!", en: "This bay stays LOCKED\nwhile its car is out!" },
  tutCameBack: {
    vi: "Chưa đầy nên nó quay về!\nBấm để chạy tiếp. KHÔNG xe\nnào đi được là thua đó!",
    en: "Not full yet, so it came back!\nTap it to run again. If NO car\ncan move, you lose!",
  },
  tutTapParked: { vi: "Bấm xe đang đỗ\nđể nó chạy tiếp!", en: "Tap the parked car\nto send it out again!" },
  tutTwinLaunch: { vi: "Bấm để cả cặp xe\ncùng xuất phát!", en: "Tap to send the\nlinked cars out together!" },
  tutBooster: { vi: "Bấm booster này\nđể dùng thử!", en: "Tap this booster\nto use it!" },

  // ---- twin intro ----
  twinTitle: { vi: "Xe Đôi!", en: "Twin Cars!" },
  twinDesc: {
    vi: "Hai bạn này dính nhau như hình với bóng — cùng xuất phát, cùng đỗ, cùng rời đi, luôn kề vai sát cánh. Bấm một xe là CẢ HAI cùng chạy!",
    en: "These two are best buddies — they set off, park, and leave TOGETHER, always side by side. Tap one and BOTH roll out!",
  },

  rockTitle: { vi: "Đá Cứng!", en: "Hard Rock!" },
  rockDesc: {
    vi: "Mấy tảng đá này KHÔNG ăn được — xe nào tới cũng phải chịu. Chúng còn CHẶN đường bắn, nên ô nào nấp sau đá thì phải dọn lối khác mà tới. Nhìn kỹ trước khi bấm nhé!",
    en: "These rocks can NEVER be collected — no car can take them. They also BLOCK the line of fire, so anything hiding behind one has to be reached another way. Look before you tap!",
  },

  // ---- tier banner + Home tags ----
  hardLevel: { vi: "🔥 HARD LEVEL", en: "🔥 HARD LEVEL" },
  superHardLevel: { vi: "💀 SUPER HARD", en: "💀 SUPER HARD" },
  tagHard: { vi: "🔥 HARD", en: "🔥 HARD" },
  tagSuper: { vi: "💀 SUPER HARD", en: "💀 SUPER HARD" },

  // ---- board obstacle labels ----
  hardRockTile: { vi: "ĐÁ\nCỨNG", en: "HARD\nROCK" },
  woodTile: { vi: "GỖ", en: "WOOD" },

  // ---- win / lose ----
  levelComplete: { vi: "LEVEL COMPLETE!", en: "LEVEL COMPLETE!" },
  claim: { vi: "CLAIM", en: "CLAIM" },
  queueFull: { vi: "HẾT CHỖ RỒI! 😵", en: "QUEUE FULL! 😵" },
  reviveBtn: { vi: "REVIVE   {n} 🪙", en: "REVIVE   {n} 🪙" },
  reviveNeed: { vi: "Cần {n} 🪙 để Revive", en: "Need {n} 🪙 to revive" },
  // "|"-joined praise words for the rare big slime — split before use.
  niceWords: { vi: "Nice!|Great!|Wow!|Cool!", en: "Nice!|Great!|Wow!|Cool!" },
  // ---- confirm before walking out of a live level (costs a heart) ----
  quitTitle: { vi: "Về Home?", en: "Go Home?" },
  quitBody: { vi: "Bỏ dở level này sẽ mất 1", en: "Quitting this level costs 1" },
  quitStay: { vi: "Ở LẠI", en: "STAY" },
  quitLeave: { vi: "Về Home", en: "Leave" },
  retryTitle: { vi: "Chơi lại?", en: "Play again?" },
  // Shown on the lose screen, where the heart pays for the attempt just failed.
  attemptCostBody: { vi: "Ván thua này sẽ tính 1", en: "This failed attempt costs 1" },

  // ---- hearts (lives) ----
  heartsTitle: { vi: 'Tim của bạn', en: 'Your Hearts' },
  heartsOut: { vi: 'Hết tim rồi!', en: 'Out of Hearts!' },
  heartsFull: { vi: 'Tim đã đầy — chơi thoải mái!', en: 'Hearts are full — play on!' },
  heartsNext: { vi: 'Tim tiếp theo sau {t}', en: 'Next heart in {t}' },
  heartsFree: { vi: 'Chơi thả ga — còn {t}', en: 'Free play — {t} left' },
  heartsBuy1: { vi: 'Mua 1 tim — {n} Coin', en: 'Buy 1 heart — {n} Coin' },
  heartsBuyFull: { vi: 'Đầy 5 tim — {n} Coin', en: 'Refill 5 hearts — {n} Coin' },

  // ---- nhật ký chơi (chép log) ----
  logBtn: { vi: '📋 Nhật ký chơi', en: '📋 Play log' },
  logTitle: { vi: 'NHẬT KÝ CHƠI', en: 'PLAY LOG' },
  logDevice: { vi: 'Thiết bị này: {d}', en: 'This device: {d}' },
  logRuns: { vi: '{n} ván · thắng {w}', en: '{n} games · {w} won' },
  logNone: { vi: 'Chưa có ván nào được ghi.', en: 'No games recorded yet.' },
  logCopyAll: { vi: 'Chép tất cả', en: 'Copy all' },
  logAll: { vi: 'tất cả', en: 'all' },
  logClear: { vi: 'Xoá log', en: 'Clear log' },
  logClearConfirm: { vi: 'Bấm lần nữa để xoá hết', en: 'Tap again to erase' },
  logCleared: { vi: 'Đã xoá nhật ký.', en: 'Log cleared.' },
  logCopied: { vi: 'Đã chép {n} dòng ({what})', en: 'Copied {n} lines ({what})' },
  logCopyFail: { vi: 'Không chép được — thử trình duyệt khác', en: 'Copy failed — try another browser' },
  logEmpty: { vi: 'Không có dữ liệu để chép', en: 'Nothing to copy' },

  // ---- in-game settings ----
  settings: { vi: "CÀI ĐẶT", en: "SETTINGS" },
  sfx: { vi: "🔊 Âm thanh", en: "🔊 Sound FX" },
  guide: { vi: "🧭 Chỉ dẫn từng bước", en: "🧭 Step-by-step guide" },
  resetBtn: { vi: "🔄 Chơi lại từ đầu", en: "🔄 Restart from Level 1" },
  resetConfirm: { vi: "⚠ Xoá tiến trình? Bấm lần nữa", en: "⚠ Erase progress? Tap again" },
  levelsBtn: { vi: "🏠 Home", en: "🏠 Home" },
  language: { vi: "🌐 Ngôn ngữ: Tiếng Việt", en: "🌐 Language: English" },

  // ---- Home (level select) ----
  selSettings: { vi: "Cài đặt", en: "Settings" },
  selMode: { vi: "Chọn Level", en: "Level Select" },
  selModeSub: { vi: "Cách chọn Level để chơi", en: "How you choose which level to play" },
  seqTitle: { vi: "Tuần tự", en: "Sequential" },
  seqSub: { vi: "Theo thứ tự", en: "In order" },
  anyTitle: { vi: "Tuỳ chọn", en: "Any Level" },
  anySub: { vi: "Level bất kỳ", en: "Free pick" },
  jump: { vi: "Nhảy tới Level", en: "Jump to Level" },
  jumpSub: { vi: "Gõ số Level (1–{n}) để vào thẳng", en: "Type a number (1–{n}) to start there" },
  jumpPrompt: { vi: "Vào Level số mấy? (1–{n})", en: "Start at which level? (1–{n})" },
  jumpRange: { vi: "Nhập số từ 1 đến {n}", en: "Enter a number from 1 to {n}" },
  nextReward: { vi: "Tiếp: {r}", en: "Next: {r}" },
  enterLevel: { vi: "✏  Nhập số Level", en: "✏  Enter Level Number" },

  // ---- Lucky Clover overlay ----
  cloverTitle: { vi: "LUCKY CLOVER", en: "LUCKY CLOVER" },
  claimed: { vi: "Đã nhận", en: "Claimed" },
  done: { vi: "XONG", en: "DONE" },
  allClaimed: { vi: "Đã nhận hết quà!", en: "All rewards claimed!" },
};

// Current-language string for `key`. Unknown keys return the key itself so a
// missing entry is visible in play, never a crash.
export function t(key: string): string {
  const e = S[key];
  return e ? e[lang] : key;
}

// t() + {placeholder} filling: tf("needGold", { n: 450 }) → "Cần 450 vàng".
export function tf(key: string, vars: Record<string, string | number>): string {
  return t(key).replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? ""));
}
