"auto";
// Cabal auto-respawn + return to spot - Redfinger (AutoX.js) - with interface
// Small floating panel (drag it by the top bar):
//   run/stop | status | collapse
//   X / Y inputs + TEST. Tap an input to type, press the keyboard Done to release focus.

// ===== VERSION =====
var APP_VERSION = 13;          // bump this on every release you publish (whole number)

// ===== GAME SPACE =====
var GW = 2093, GH = 1177;

// ===== SETTINGS (saved automatically) =====
var store = storages.create("cabal_respawn_ui");
var DEFAULTS = {
  TARGET_X: 194, TARGET_Y: 200,
  CHECK_EVERY: 700, AFTER_RESPAWN_WAIT: 6000,
  MAP_DX: 0, MAP_DY: 0,
  AUTO_CHECK: true, SHOW_CONSOLE: false
};
var CFG = {};
(function () {
  for (var k in DEFAULTS) {
    var v = store.get(k);
    CFG[k] = (v === undefined || v === null) ? DEFAULTS[k] : v;
  }
})();
var GAME_LOAD_WAIT = 8000;   // ms to wait for Cabal to load after opening it
var CHAR_SELECT_WAIT = 5000;  // ms to wait for the character select screen after tapping the screen
var ENTER_WORLD_WAIT = 10000; // ms to wait for the game world to load after Game start
var CAP_FILE = "/sdcard/rf_cap.png";

// ===== POINTS (game space) =====
var P_WARP = [1046, 433];
var P_OK   = [1046, 1030];
var P_A1 = [670, 433], P_A2 = [784, 433];
var P_B  = [759, 1030];
var P_AUTO = [1777, 1027];
var P_AUTO_RING = [[1777, 1084], [1777, 970], [1720, 1027], [1834, 1027]];
var P_TAP_SCREEN = [1046, 700];   // "Please Tap the Screen" (anywhere works)
var P_GAME_START = [1796, 1099];  // "Game start" button on the character select screen
var P_OPEN_GPS  = [1908, 317];
var P_GPS_WARP  = [1623, 1102];
var P_GPS_CLOSE = [2016, 67];
var MAP = { l: 278, r: 918, t: 222, b: 857, max: 255 };

function coordToPoint(X, Y) {
  return [MAP.l + (X / MAP.max) * (MAP.r - MAP.l) + CFG.MAP_DX,
          MAP.b - (Y / MAP.max) * (MAP.b - MAP.t) + CFG.MAP_DY];
}

// ===== COLOR TESTS =====
function isA(c) { var r = colors.red(c), g = colors.green(c), b = colors.blue(c); return r < 70 && g > 50 && b > 65 && (b - r) > 35; }
function isB(c) { var r = colors.red(c), g = colors.green(c), b = colors.blue(c); return b > 110 && (b - r) > 45; }
function isGold(c) { var r = colors.red(c), g = colors.green(c), b = colors.blue(c); return r > 170 && g > 110 && b < 120 && (r - b) > 80; }
function isOrange(c) { var r = colors.red(c), g = colors.green(c), b = colors.blue(c); return r > 120 && g > 70 && g < r && (r - b) > 50; }

// ===== UI (small floating panel) =====
var fw = null;
var IDS = ["inX", "inY", "inDX", "inDY", "inCheck", "inWait", "inSub"];

function num(v, d) { var n = parseFloat(String(v)); return isNaN(n) ? d : n; }
function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

function loadCfgToUi() {
  ui.run(function () {
    if (!fw) return;
    fw.inX.setText(String(CFG.TARGET_X));
    fw.inY.setText(String(CFG.TARGET_Y));
    fw.inDX.setText(String(CFG.MAP_DX));
    fw.inDY.setText(String(CFG.MAP_DY));
    fw.inCheck.setText(String(CFG.CHECK_EVERY));
    fw.inWait.setText(String(CFG.AFTER_RESPAWN_WAIT));
    fw.inSub.setText(getSubPass());
    fw.cbAuto.setChecked(!!CFG.AUTO_CHECK);
    fw.cbConsole.setChecked(!!CFG.SHOW_CONSOLE);
  });
}
function txt(v) { return String(v.getText()); }
function readCfgFromUi() {
  CFG.TARGET_X = clamp(Math.round(num(txt(fw.inX), DEFAULTS.TARGET_X)), 0, 255);
  CFG.TARGET_Y = clamp(Math.round(num(txt(fw.inY), DEFAULTS.TARGET_Y)), 0, 255);
  CFG.MAP_DX = num(txt(fw.inDX), 0);
  CFG.MAP_DY = num(txt(fw.inDY), 0);
  CFG.CHECK_EVERY = Math.max(200, Math.round(num(txt(fw.inCheck), DEFAULTS.CHECK_EVERY)));
  CFG.AFTER_RESPAWN_WAIT = Math.max(0, Math.round(num(txt(fw.inWait), DEFAULTS.AFTER_RESPAWN_WAIT)));
  CFG.AUTO_CHECK = fw.cbAuto.isChecked();
  CFG.SHOW_CONSOLE = fw.cbConsole.isChecked();
  for (var k in CFG) store.put(k, CFG[k]);
  saveSubPass(txt(fw.inSub).trim());      // empty box = clear the saved sub-password
  loadCfgToUi();
}
// Sub-password: kept scrambled with the per-device key (same as the saved login), never in CFG / plain text.
function getSubPass() {
  try { var raw = store.get("sub_pass", ""); return raw ? credDec(raw) : ""; } catch (e) { return ""; }
}
function saveSubPass(v) {
  try { if (v) store.put("sub_pass", credEnc(v)); else store.remove("sub_pass"); } catch (e) { log("sub-password save err: " + e); }
}
function releaseFocus() { try { fw.disableFocus(); } catch (e) {} }

function fwFit(w) {                      // cap the panel body to the screen height (it scrolls inside), keep window on screen
  var sc = dgScreen();
  if (w.body.getVisibility() == 0) {
    ui.run(function () {
      try {
        w.bodyIn.measure(android.view.View.MeasureSpec.makeMeasureSpec(Math.round(190 * sc.d), android.view.View.MeasureSpec.EXACTLY),
                         android.view.View.MeasureSpec.makeMeasureSpec(0, android.view.View.MeasureSpec.UNSPECIFIED));
        var full = w.bodyIn.getMeasuredHeight();
        var hdrH = w.hdr.getHeight() > 0 ? w.hdr.getHeight() : Math.round(40 * sc.d);
        var maxH = sc.h - hdrH - Math.round(24 * sc.d);
        var lp = w.body.getLayoutParams();
        lp.height = full > maxH ? maxH : -2;      // -2 = wrap_content when it fits (portrait)
        w.body.setLayoutParams(lp);
      } catch (e) { log("panel fit err: " + e); }
    });
    sleep(300);
  }
  dgPlace(w, w.getX(), w.getY());
}
function buildPanel() {
  try {
    if (!floaty.checkPermission()) {
      toast("Allow 'draw over other apps'");
      floaty.requestPermission();
      while (!floaty.checkPermission()) sleep(500);
    }
  } catch (e) {}

  fw = floaty.window(
    <vertical w="190" bg="#f01a1a24">
      <horizontal id="hdr" bg="#1a1a24" padding="3 3" gravity="center_vertical">
        <text id="btnRun" text="&#9654;" textSize="16sp" textColor="#ffffff" bg="#2e7d32" w="32" h="32" gravity="center"/>
        <text id="btnResp" text="R" textSize="14sp" textColor="#94a3b8" bg="#2d2d3a" w="32" h="32" gravity="center" marginLeft="3"/>
        <text id="st" text="Idle" textSize="12sp" textColor="#94a3b8" w="0" layout_weight="1" gravity="center" maxLines="1"/>
        <text id="btnMin" text="&#9650;" textSize="13sp" textColor="#e2e8f0" bg="#2d2d3a" w="32" h="32" gravity="center"/>
      </horizontal>
      <scroll id="body">
      <vertical id="bodyIn" padding="6 1">
        <text text="SAVED SPOT" textSize="10sp" textColor="#64a8ff" textStyle="bold"/>
        <horizontal>
          <vertical w="0" layout_weight="1">
            <text text="X (0-255)" textSize="9sp" textColor="#94a3b8"/>
            <input id="inX" inputType="number" textColor="#f8fafc" textSize="12sp" padding="2" text="194"/>
          </vertical>
          <vertical w="0" layout_weight="1">
            <text text="Y (0-255)" textSize="9sp" textColor="#94a3b8"/>
            <input id="inY" inputType="number" textColor="#f8fafc" textSize="12sp" padding="2" text="200"/>
          </vertical>
        </horizontal>
        <text text="TIMING (ms)" textSize="10sp" textColor="#64a8ff" textStyle="bold" marginTop="3"/>
        <horizontal>
          <vertical w="0" layout_weight="1">
            <text text="Check every" textSize="9sp" textColor="#94a3b8"/>
            <input id="inCheck" inputType="number" textColor="#f8fafc" textSize="12sp" padding="2" text="700"/>
          </vertical>
          <vertical w="0" layout_weight="1">
            <text text="Wait after respawn" textSize="9sp" textColor="#94a3b8"/>
            <input id="inWait" inputType="number" textColor="#f8fafc" textSize="12sp" padding="2" text="6000"/>
          </vertical>
        </horizontal>
        <text text="MAP FINE-TUNE (game px)" textSize="10sp" textColor="#64a8ff" textStyle="bold" marginTop="3"/>
        <horizontal>
          <vertical w="0" layout_weight="1">
            <text text="Offset X" textSize="9sp" textColor="#94a3b8"/>
            <input id="inDX" inputType="numberDecimal|numberSigned" textColor="#f8fafc" textSize="12sp" padding="2" text="0"/>
          </vertical>
          <vertical w="0" layout_weight="1">
            <text text="Offset Y" textSize="9sp" textColor="#94a3b8"/>
            <input id="inDY" inputType="numberDecimal|numberSigned" textColor="#f8fafc" textSize="12sp" padding="2" text="0"/>
          </vertical>
        </horizontal>
        <text text="SUB-PASSWORD" textSize="10sp" textColor="#64a8ff" textStyle="bold" marginTop="3"/>
        <input id="inSub" inputType="numberPassword" hint="saved on this phone only" textColor="#f8fafc" textSize="12sp" padding="2"/>
        <Switch id="cbAuto" text="Tap AUTO only if off" textSize="11sp" textColor="#e2e8f0" marginTop="3"/>
        <Switch id="cbConsole" text="Show console" textSize="11sp" textColor="#e2e8f0" marginTop="2"/>
        <horizontal marginTop="2">
          <button id="btnTest" text="TEST" textSize="10sp" w="0" layout_weight="1" h="32" padding="0" bg="#2f5fb3" textColor="#ffffff"/>
          <button id="btnSave" text="SAVE" textSize="10sp" w="0" layout_weight="1" h="32" padding="0" bg="#2d2d3a" textColor="#ffffff"/>
          <button id="btnQuit" text="QUIT" textSize="10sp" w="0" layout_weight="1" h="32" padding="0" bg="#7a2a2a" textColor="#ffffff"/>
        </horizontal>
        <horizontal marginTop="2">
          <button id="btnSavePos" text="AUTO SAVE SPOT" textSize="10sp" w="0" layout_weight="1" h="32" padding="0" bg="#2d2d3a" textColor="#fbbf24"/>
        </horizontal>
        <horizontal marginTop="2">
          <button id="btnDg" text="NON-PREMIUM DG" textSize="10sp" w="0" layout_weight="1" h="32" padding="0" bg="#2d2d3a" textColor="#4ade80"/>
        </horizontal>
        <horizontal marginTop="2">
          <button id="btnLogout" text="LOGOUT" textSize="9sp" w="0" layout_weight="1" h="32" padding="0" bg="#2d2d3a" textColor="#e2e8f0"/>
          <button id="btnUpd" text="UPDATE" textSize="9sp" w="0" layout_weight="1" h="32" padding="0" bg="#2d2d3a" textColor="#e2e8f0"/>
          <button id="btnOwner" text="OWNER" textSize="9sp" w="0" layout_weight="1" h="32" padding="0" bg="#8a5a1a" textColor="#ffffff" visibility="gone"/>
        </horizontal>
        <text text="LOG" textSize="10sp" textColor="#64a8ff" textStyle="bold" marginTop="3"/>
        <text id="lg" text="" textSize="9sp" textColor="#9ca3af" bg="#0b0b14" padding="4" minHeight="50" maxLines="4" ellipsize="end"/>
      </vertical>
      </scroll>
    </vertical>
  );
  fw.setPosition(10, 200);
  loadCfgToUi();

  // drag by the top bar
  var ox = 0, oy = 0, wx = 0, wy = 0;
  fw.hdr.setOnTouchListener(function (v, e) {
    var act = e.getAction();
    if (act == 0) { ox = e.getRawX(); oy = e.getRawY(); wx = fw.getX(); wy = fw.getY(); }
    else if (act == 2) { dgPlace(fw, wx + (e.getRawX() - ox), wy + (e.getRawY() - oy)); }
    return true;
  });

  // keyboard focus for inputs (floating windows can't type unless focus is requested)
  IDS.forEach(function (id) {
    var v = fw[id];
    v.on("touch_down", function () { fw.requestFocus(); v.requestFocus(); });
    v.setOnEditorActionListener(new android.widget.TextView.OnEditorActionListener({
      onEditorAction: function (tv, action, ev) { releaseFocus(); return false; }
    }));
  });

  fw.btnRun.click(function () { releaseFocus(); if (running) stopBot(); else startBot(false); });
  fw.btnResp.click(function () { releaseFocus(); if (respawnOn) stopRespawn(); else startRespawn(); });
  fw.btnTest.click(function () { releaseFocus(); startBot(true); });
  fw.btnSave.click(function () { releaseFocus(); readCfgFromUi(); toast("Saved"); });
  fw.btnQuit.click(function () { running = false; respawnOn = false; exit(); });
  fw.btnSavePos.click(function () { releaseFocus(); autoSaveSpot(); });
  fw.btnDg.click(function () { releaseFocus(); openDG(); });
  fw.btnLogout.click(function () { releaseFocus(); doLogout(); });
  fw.btnUpd.click(function () { releaseFocus(); toast("Checking for update (you have v" + APP_VERSION + ")..."); threads.start(function () { checkUpdate(true); }); });
  fw.btnOwner.click(function () { releaseFocus(); openOwner(); });
  if (acctAdmin) fw.btnOwner.setVisibility(0);
  // fit to screen height now, and again on rotate / expand, so the panel scrolls in landscape
  var me = fw;
  threads.start(function () {
    var last = "";
    while (fw === me) {
      try {
        var sc = dgScreen(), key = sc.w + "x" + sc.h + "/" + me.body.getVisibility();
        if (key !== last) { last = key; fwFit(me); }
      } catch (e) { log("panel watch err: " + e); }
      sleep(700);
    }
  });
  fw.btnMin.click(function () {
    releaseFocus();
    var b = fw.body;
    var open = (b.getVisibility() == 0);
    b.setVisibility(open ? 8 : 0);
    fw.btnMin.setText(open ? "\u25BC" : "\u25B2");
  });
}

// ===== OPEN CABAL =====
function findCabalPkg() {
  try {
    var pm = context.getPackageManager();
    var apps = pm.getInstalledApplications(0);
    for (var i = 0; i < apps.size(); i++) {
      var ai = apps.get(i);
      var label = String(pm.getApplicationLabel(ai));
      if (/cabal/i.test(label) || /cabal/i.test(String(ai.packageName))) return String(ai.packageName);
    }
  } catch (e) { log("pkg scan err: " + e); }
  return null;
}
function openCabal() {
  var pkg = findCabalPkg();
  try { if (pkg && currentPackage() === pkg) { log("Cabal already open"); return pkg; } } catch (e) {}
  if (pkg) {
    log("opening " + pkg);
    try { if (app.launchPackage(pkg)) return pkg; } catch (e) { log("launch err: " + e); }
  }
  // fallback: go home and tap the Cabal icon (top-right of the home screen)
  log("tapping Cabal icon on home screen");
  home();
  sleep(1000);
  var x = Math.round(device.width * 0.856), y = Math.round(device.height * 0.108);
  try { if (hasRoot) shell("input tap " + x + " " + y, true); else click(x, y); } catch (e) { click(x, y); }
  return null;
}

// ===== STARTUP: image detection - taps ONLY when the screen image is found =====
// Templates are saved by the SNAP TAP / SNAP BTN buttons while that screen is showing.
var TPL = {
  tap:   { file: "/sdcard/rf_tpl_tap.png",   cx: 1046, cy: 1000, hw: 300, hh: 40, img: null },  // "Please Tap the Screen" text area
  start: { file: "/sdcard/rf_tpl_start.png", cx: 1796, cy: 1099, hw: 110, hh: 40, img: null }   // "Game start" button
};
var TPL_THRESHOLD = 0.8;

function getTpl(key) {
  var t = TPL[key];
  if (!t.img) { try { if (files.exists(t.file)) t.img = images.read(t.file); } catch (e) { log("tpl read err: " + e); } }
  return t.img;
}
function findTpl(key) {                 // returns [x, y] screen-px center of the match, or null
  var tpl = getTpl(key);
  if (!tpl) return null;
  var img = grab();
  if (!img) return null;
  var pt = null;
  try { pt = images.findImage(img, tpl, { threshold: TPL_THRESHOLD }); } catch (e) { log("find err: " + e); }
  img.recycle();
  return pt ? [Math.round(pt.x + tpl.getWidth() / 2), Math.round(pt.y + tpl.getHeight() / 2)] : null;
}
function tapPx(m, label) {
  log("tap " + label + " m" + method + " " + m[0] + "," + m[1]);
  METHODS[method](m[0], m[1]);
}

// Save a template from the current screen (run while that screen is visible)
function snapTemplate(key) {
  threads.start(function () {
    try {
      if (!capReady) { try { hasRoot = (shell("id", true).code === 0); } catch (e) { hasRoot = false; } setupCapture(); }
      if (!capReady) { log("snap: no screen capture"); return; }
      ui.run(function () { fw.body.setVisibility(8); fw.btnMin.setText("\u25BC"); });  // hide panel so it isn't captured
      sleep(1200);
      var img = grab();
      if (!img) { log("snap: no image"); return; }
      var t = TPL[key], s = H / GH;
      var c = toScreen([t.cx, t.cy]);
      var w = Math.round(2 * t.hw * s), h = Math.round(2 * t.hh * s);
      if (!LAND) { var tmp = w; w = h; h = tmp; }
      var x = clamp(c[0] - Math.round(w / 2), 0, img.getWidth() - w);
      var y = clamp(c[1] - Math.round(h / 2), 0, img.getHeight() - h);
      var crop = images.clip(img, x, y, w, h);
      images.save(crop, t.file);
      crop.recycle(); img.recycle();
      t.img = null;
      log("saved " + key + " template " + w + "x" + h);
      toast("Saved " + key + " template");
    } catch (e) { log("snap err: " + e); }
  });
}

// ===== AUTO SAVE SPOT =====
// Opens the GPS map, finds the character marker, converts it to X/Y (inverse of coordToPoint),
// fills the SAVED SPOT boxes and saves. Tune isMarker() if it picks the wrong thing (see the log).
function isMarker(c) { var r = colors.red(c), g = colors.green(c), b = colors.blue(c); return r > 200 && g > 180 && b < 130; }
function autoSaveSpot() {
  if (running) { toast("Press STOP first, then AUTO SAVE SPOT"); return; }
  if (respawnOn) { toast("Turn R (respawn) off first, then AUTO SAVE SPOT"); return; }
  threads.start(function () {
    var hid = false;
    try {
      if (!capReady) { try { hasRoot = (shell("id", true).code === 0); } catch (e) { hasRoot = false; } setupCapture(); }
      if (!capReady) { log("save spot: no screen capture"); toast("Allow screen capture first"); return; }
      if (!METHODS.length) buildMethods();
      ui.run(function () { fw.body.setVisibility(8); fw.btnMin.setText("\u25BC"); });   // hide panel so it doesn't cover the map
      hid = true;
      var opened = false;
      for (var i = 0; i < 3 && !opened; i++) {
        if (gpsOpen()) { opened = true; break; }
        tapGame(P_OPEN_GPS, "open GPS");
        sleep(1800);
        opened = gpsOpen();
      }
      if (!opened) { log("save spot: GPS did not open"); toast("GPS did not open"); return; }
      sleep(500);
      var img = grab();
      if (!img) { log("save spot: no image"); return; }
      var sx = 0, sy = 0, n = 0;
      for (var gx = MAP.l; gx <= MAP.r; gx += 3) {
        for (var gy = MAP.t; gy <= MAP.b; gy += 3) {
          if (isMarker(pix(img, [gx, gy]))) { sx += gx; sy += gy; n++; }
        }
      }
      img.recycle();
      if (n < 2 || n > 400) {
        log("save spot: marker not found (" + n + " hits) - nothing changed");
        toast("Marker not found - spot not changed");
      } else {
        var mx = sx / n, my = sy / n;
        var X = clamp(Math.round((mx - CFG.MAP_DX - MAP.l) / (MAP.r - MAP.l) * MAP.max), 0, 255);
        var Y = clamp(Math.round((MAP.b + CFG.MAP_DY - my) / (MAP.b - MAP.t) * MAP.max), 0, 255);
        CFG.TARGET_X = X; CFG.TARGET_Y = Y;
        for (var k in CFG) store.put(k, CFG[k]);
        ui.run(function () { fw.inX.setText(String(X)); fw.inY.setText(String(Y)); });
        log("save spot: saved X" + X + " Y" + Y + " (" + n + " hits)");
        toast("Saved spot X" + X + " Y" + Y);
      }
      if (gpsOpen()) { tapGame(P_GPS_CLOSE, "close GPS"); sleep(600); }
    } catch (e) { log("save spot err: " + e); }
    if (hid) ui.run(function () { fw.body.setVisibility(0); fw.btnMin.setText("\u25B2"); });
  });
}

function waitUntil(fn, timeout, label) {
  var end = Date.now() + timeout;
  while (Date.now() < end) {
    if (fn()) return true;
    nap(500);
  }
  log("timed out waiting for " + label);
  return false;
}
function waitForApp(pkg, timeout) {
  if (!pkg) { nap(GAME_LOAD_WAIT); return; }
  setStatus("Waiting for Cabal", "#fbbf24");
  waitUntil(function () { try { return currentPackage() === pkg; } catch (e) { return false; } }, timeout, "Cabal to open");
  nap(1500);
}
function tapToStart() {
  if (!getTpl("tap")) { log("no 'Please Tap' template - press SNAP TAP while that screen shows"); return false; }
  setStatus("Waiting: tap screen", "#fbbf24");
  if (!waitUntil(function () { return !!findTpl("tap"); }, 45000, "Please Tap the Screen image")) return false;
  setStatus("Tap the screen", "#fbbf24");
  tapGame(P_TAP_SCREEN, "Please Tap the Screen");
  nap(1000);
  return true;
}
function tapGameStart() {
  if (!getTpl("start")) { log("no 'Game start' template - press SNAP BTN while that screen shows"); return false; }
  setStatus("Waiting: Game start", "#fbbf24");
  var pos = null;
  if (!waitUntil(function () { pos = findTpl("start"); return !!pos; }, 45000, "Game start image")) return false;
  setStatus("Game start", "#fbbf24");
  for (var i = 0; i < 3; i++) {
    tapPx(pos, "Game start");
    nap(2500);
    pos = findTpl("start");
    if (!pos) break;                     // button gone = it worked
    log("Game start still visible, tapping again");
  }
  waitEnterWorld();
  return true;
}

// ===== SUB-PASSWORD (PIN) - ported from the main script =====
// Reads the keypad digits from the screen (the order can be shuffled), then taps your saved sub-password and OK.
function fracIn(img, r, test, step, an) {
  var n = 0, t = 0, st = step || 4;
  for (var y = r[1]; y < r[3]; y += st) {
    for (var x = r[0]; x < r[2]; x += st) {
      t++;
      if (test(pix(img, [x, y, an]))) n++;
    }
  }
  return t ? n / t : 0;
}
function isBtnBlue(c) {
  var r = colors.red(c), g = colors.green(c), b = colors.blue(c);
  return b > 110 && (b - r) > 30 && (b - g) > 5 && r < 110;
}
function isTitleWhite(c) {
  var r = colors.red(c), g = colors.green(c), b = colors.blue(c);
  var mn = Math.min(r, g, b), mx = Math.max(r, g, b);
  return mn > 130 && (mx - mn) < 40;
}
// ----- sub-password (PIN) dialog -----
var R_PIN_RESET = [900, 864, 1195, 939];       // blue "Reset" button
var R_PIN_TITLE = [875, 252, 1225, 287];       // "Enter Sub-Password" title text
var P_PIN_OK = [735, 902], P_PIN_RESET = [1045, 902];
// the 10 digit keys (game space). The keypad order can be shuffled, so digits are recognised from the image.
var PIN_KEYS = [[689, 759], [689, 636], [831, 759], [831, 636], [973, 759], [973, 636],
                [1115, 759], [1115, 636], [1258, 759], [1258, 636]];
var PIN_TPL = {
  "0": "0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000111110000000000000000011111110000000000000000111011100000000000000001100011100000000000000111000111000000000000001110001110000000000000011100011100000000000000111000111000000000000001110001110000000000000011100011100000000000000011000111000000000000000111111100000000000000000111110000000000000000000111000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
  "1": "0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000111000000000000000000011110000000000000000001111100000000000000000111111000000000000000000001110000000000000000000011100000000000000000000111000000000000000000001110000000000000000000011100000000000000000000111000000000000000000001110000000000000000000011100000000000000000000111000000000000000000000100000000000000000000000000000000000000000000000000000000000000000000000000000000",
  "2": "0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001100000000000000000001111110000000000000000111111110000000000000000100011100000000000000000000011000000000000000000001110000000000000000000011100000000000000000001110000000000000000000111000000000000000000011110000000000000000000111000000000000000000011100000000000000000001111111100000000000000011111111000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
  "3": "0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001111110000000000000000111111110000000000000000100011100000000000000000000111000000000000000000001110000000000000000011111000000000000000000111100000000000000000001111110000000000000000000011100000000000000000000011000000000000000000001110000000000000001111111100000000000000011111110000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
  "4": "0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000111000000000000000000001110000000000000000000111100000000000000000001111000000000000000000111110000000000000000011011100000000000000000110111000000000000000011001110000000000000000110011100000000000000011111111100000000000000111111111000000000000000000011100000000000000000000111000000000000000000000110000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
  "5": "0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001111111000000000000000011111110000000000000000111000000000000000000001100000000000000000000011000000000000000000000111111000000000000000001111111000000000000000000001111000000000000000000001110000000000000000000011100000000000000000000111000000000000001111111100000000000000011111110000000000000000001111000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
  "6": "0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000111100000000000000000111111000000000000000011111000000000000000000111000000000000000000001100000000000000000000111011100000000000000001111111100000000000000011110111100000000000000111000111000000000000001110001110000000000000011100011100000000000000011101110000000000000000111111100000000000000000011110000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
  "7": "0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000111111111000000000000001111111110000000000000000000111100000000000000000000110000000000000000000011100000000000000000000110000000000000000000011100000000000000000000111000000000000000000001100000000000000000000111000000000000000000001100000000000000000000111000000000000000000001110000000000000000000011000000000000000000000000000000000000000000000000000000000000000000000000000000000",
  "8": "0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000111110000000000000000011111110000000000000000110011100000000000000001100011000000000000000011001110000000000000000011111000000000000000000111110000000000000000011111110000000000000001110011100000000000000011100011100000000000000111000111000000000000001111111100000000000000001111111000000000000000000111000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
  "9": "0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000011100000000000000000011111100000000000000001111111100000000000000011100011000000000000000111000111000000000000001110001110000000000000011100111100000000000000011111111000000000000000011101100000000000000000000011000000000000000000001110000000000000000000111100000000000000001111110000000000000000011110000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000"
};
var pinBlocked = false;   // set when the game did not accept the PIN, so we never spam wrong attempts
function isKeyWhite(c) { return Math.min(colors.red(c), colors.green(c), colors.blue(c)) > 150; }
function keyGrid(img, cx, cy) {
  var xs = 0, ys = 0, n = 0, x, y;
  for (y = cy - 34; y <= cy + 34; y += 2)
    for (x = cx - 34; x <= cx + 34; x += 2)
      if (isKeyWhite(pix(img, [x, y]))) { xs += x; ys += y; n++; }
  if (n < 15) return null;
  var gx = Math.round(xs / n), gy = Math.round(ys / n), rows = [];
  for (y = gy - 22; y <= gy + 22; y += 2) {
    var row = [];
    for (x = gx - 22; x <= gx + 22; x += 2) row.push(isKeyWhite(pix(img, [x, y])) ? 1 : 0);
    rows.push(row);
  }
  return rows;   // 23 x 23
}
function tplRows(d) {
  var str = PIN_TPL[d], rows = [];
  for (var y = 0; y < 23; y++) {
    var row = [];
    for (var x = 0; x < 23; x++) row.push(str.charAt(y * 23 + x) === "1" ? 1 : 0);
    rows.push(row);
  }
  return rows;
}
function iouShift(a, b) {
  var best = 0;
  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      var inter = 0, uni = 0;
      for (var y = 0; y < 23; y++) {
        for (var x = 0; x < 23; x++) {
          var A = a[y][x] === 1, yy = y + dy, xx = x + dx;
          var B = yy >= 0 && yy < 23 && xx >= 0 && xx < 23 && b[yy][xx] === 1;
          if (A && B) inter++;
          if (A || B) uni++;
        }
      }
      var v = uni ? inter / uni : 0;
      if (v > best) best = v;
    }
  }
  return best;
}
// returns { "0": [x,y], ... } for the digits it could read with confidence
function readKeypad(img) {
  var tpls = {};
  for (var d = 0; d <= 9; d++) tpls[d] = tplRows(d);
  var found = {};
  for (var i = 0; i < PIN_KEYS.length; i++) {
    var g = keyGrid(img, PIN_KEYS[i][0], PIN_KEYS[i][1]);
    if (!g) continue;
    var b1 = 0, b1d = -1, b2 = 0;
    for (var dd = 0; dd <= 9; dd++) {
      var sc = iouShift(g, tpls[dd]);
      if (sc > b1) { b2 = b1; b1 = sc; b1d = dd; } else if (sc > b2) { b2 = sc; }
    }
    if (b1 >= 0.6 && (b1 - b2) >= 0.04) found[b1d] = PIN_KEYS[i];
    else log("key " + i + " unclear (" + b1.toFixed(2) + " / " + b2.toFixed(2) + ")");
  }
  return found;
}
function enterPin() {
  var pin = String(getSubPass() || "");
  if (!/^[0-9]{4,10}$/.test(pin)) { log("sub-password screen but no valid PIN set (4-10 digits)"); pinBlocked = true; return false; }
  var img = grab();
  if (!img) return false;
  var keys = readKeypad(img);
  img.recycle();
  for (var i = 0; i < pin.length; i++) {
    if (!keys[pin.charAt(i)]) {
      log("could not read a keypad digit - not typing anything");
      pinBlocked = true;
      return false;
    }
  }
  log("sub-password: typing PIN");
  // NOTE: never tap the blue "Reset" button here - it is not "clear" and it changes the keypad / starts a reset,
  // so the digit positions read above would be wrong. The dialog opens with an empty field.
  for (var j = 0; j < pin.length; j++) {
    var k = keys[pin.charAt(j)];
    tapGame(k, "pin key");
    nap(450);
  }
  tapGame(P_PIN_OK, "pin OK");
  nap(3500);
  return true;
}

function pinShowing() {                  // true while the "Enter Sub-Password" dialog is on screen
  var img = grab();
  if (!img) return false;
  var ok = fracIn(img, R_PIN_RESET, isBtnBlue) > 0.5 && fracIn(img, R_PIN_TITLE, isTitleWhite) > 0.1;
  img.recycle();
  return ok;
}
function pinOnce() {                     // enter the PIN if the dialog is showing right now; true = handled
  if (pinBlocked || !getSubPass() || !pinShowing()) return false;
  if (enterPin() && !pinShowing()) return true;
  pinBlocked = true;
  log("sub-password dialog still open after OK - stopped to avoid wrong attempts");
  return false;
}
// Used after "Game start": watch for the dialog for up to ENTER_WORLD_WAIT, type the PIN, then wait for the world to load.
function waitEnterWorld() {
  if (!getSubPass()) { nap(ENTER_WORLD_WAIT); return; }      // blank sub-password = skip
  setStatus("Waiting: sub-password", "#fbbf24");
  var end = Date.now() + ENTER_WORLD_WAIT;
  while (Date.now() < end) {
    if (pinShowing()) {
      if (pinBlocked) { log("sub-password already failed this run - enter it by hand"); return; }
      setStatus("Sub-password", "#fbbf24");
      if (pinOnce()) nap(ENTER_WORLD_WAIT);                  // accepted: give the world time to load
      return;
    }
    nap(700);
  }
}

// ===== LOG / STATUS =====
function log(msg) {
  console.log(msg);
  ui.run(function () {
    if (fw) fw.lg.setText(String(msg));
    try { if (dw) dw.dgLog.setText(String(msg)); } catch (e) {}
  });
}
function setStatus(t, color) {
  ui.run(function () {
    if (!fw) return;
    fw.st.setText(t);
    fw.st.setTextColor(colors.parseColor(color || "#94a3b8"));
  });
}

// ===== RUN CONTROL =====
var running = false, worker = null;
var respawnOn = false, rworker = null, respBusy = false;   // respawn watch = its own switch (R button), not part of PLAY
var hasRoot = false, capMode = "none", capReady = false;
var W = 0, H = 0, LAND = true;
var METHODS = [], method = 0;

var tlRole = new java.lang.ThreadLocal();      // "resp" on the respawn thread; every other thread follows `running`
function alive() { return String(tlRole.get()) === "resp" ? respawnOn : running; }
function nap(ms) {            // sleep that can be interrupted by STOP
  var end = Date.now() + ms;
  while (Date.now() < end) {
    if (!alive()) throw "STOP";
    sleep(Math.max(1, Math.min(100, end - Date.now())));
  }
  if (!alive()) throw "STOP";
}

function refreshButtons() {
  ui.run(function () {
    if (!fw) return;
    fw.btnRun.setText(running ? "\u25A0" : "\u25B6");
    try { if (dw) { dw.btnDgGo.setText(running ? "STOP" : "START DG"); dw.btnDgGo.setBackgroundColor(colors.parseColor(running ? "#7a2a2a" : "#2e7d32")); } } catch (e) {}
    fw.btnRun.setTextColor(colors.parseColor(running ? "#f87171" : "#4ade80"));
    fw.btnTest.setEnabled(!running);
    try {
      fw.btnResp.setBackgroundColor(colors.parseColor(respawnOn ? "#2e7d32" : "#2d2d3a"));
      fw.btnResp.setTextColor(colors.parseColor(respawnOn ? "#ffffff" : "#94a3b8"));
    } catch (e) {}
  });
  if (!running) { if (respawnOn) setStatus("Watching for death", "#4ade80"); else setStatus("Idle", "#94a3b8"); }
}

// ===== SCREEN HELPERS =====
function grab() {
  var img = null;
  if (capMode === "projection") img = captureScreen();
  else if (capMode === "screencap") { shell("screencap -p " + CAP_FILE, true); img = images.read(CAP_FILE); }
  if (img) {
    var w = img.getWidth(), h = img.getHeight();
    W = Math.max(w, h); H = Math.min(w, h);
    LAND = (w >= h);
  }
  return img;
}
function toScreen(p) {
  var s = H / GH;
  if (LAND) return [Math.round(W / 2 + (p[0] - GW / 2) * s), Math.round(p[1] * s)];
  return [Math.round(H - p[1] * s), Math.round(W / 2 + (p[0] - GW / 2) * s)];
}
function pix(img, p) {
  var m = toScreen(p);
  return images.pixel(img, m[0], m[1]);
}

function tapGame(p, label) {
  var m = toScreen(p);
  log("tap " + label + " m" + method + " " + m[0] + "," + m[1]);
  METHODS[method](m[0], m[1]);
}

// ===== DETECTION =====
var tick = 0;
function dialogVisible() {
  var img = grab();
  if (!img) { log("no image"); return false; }
  var a1 = pix(img, P_A1), a2 = pix(img, P_A2), b = pix(img, P_B);
  img.recycle();
  var okA = isA(a1) || isA(a2), okB = isB(b);
  tick++;
  if (okA || okB || tick % 15 === 0) {
    log(W + "x" + H + " A " + colors.toString(a1) + "/" + colors.toString(a2) + (okA ? " Y" : " n") +
        " | B " + colors.toString(b) + (okB ? " Y" : " n"));
  }
  return okA && okB;
}

function gpsOpen() {
  var img = grab();
  if (!img) return false;
  var c = pix(img, P_GPS_WARP);
  img.recycle();
  var ok = isOrange(c);
  log("GPS bar " + colors.toString(c) + (ok ? " Y" : " n"));
  return ok;
}

// ===== AUTO ATTACK =====
function autoOn() {
  var img = grab();
  if (!img) return false;
  var n = 0, cols = [];
  for (var i = 0; i < P_AUTO_RING.length; i++) {
    var c = pix(img, P_AUTO_RING[i]);
    cols.push(colors.toString(c));
    if (isGold(c)) n++;
  }
  img.recycle();
  log("AUTO ring " + cols.join(" ") + " gold=" + n);
  return n >= 2;
}
function ensureAuto() {
  nap(1500);
  if (CFG.AUTO_CHECK && autoOn()) { log("auto attack already ON"); return; }
  tapGame(P_AUTO, "AUTO attack");
  nap(800);
  if (CFG.AUTO_CHECK) log(autoOn() ? "auto attack ON" : "auto still looks off - check P_AUTO / ring points");
}

// ===== RETURN TO SPOT =====
function returnToSpot() {
  setStatus("Returning to X" + CFG.TARGET_X + " Y" + CFG.TARGET_Y, "#38bdf8");
  log("RETURN -> X" + CFG.TARGET_X + " Y" + CFG.TARGET_Y);
  var opened = false;
  for (var i = 0; i < 3 && !opened; i++) {
    if (gpsOpen()) { opened = true; break; }
    tapGame(P_OPEN_GPS, "open GPS");
    nap(1800);
    opened = gpsOpen();
  }
  if (!opened) { log("GPS did not open - change P_OPEN_GPS to the button that opens it"); return false; }

  var pt = coordToPoint(CFG.TARGET_X, CFG.TARGET_Y);
  log("map point (game space) " + Math.round(pt[0]) + "," + Math.round(pt[1]));
  tapGame(pt, "map X" + CFG.TARGET_X + " Y" + CFG.TARGET_Y);
  nap(900);

  tapGame(P_GPS_WARP, "Unlimited Warp");
  nap(4000);

  if (gpsOpen()) {
    tapGame(P_GPS_CLOSE, "close GPS");
    nap(800);
  }
  log("arrived at spot");
  ensureAuto();
  log("return done");
  return true;
}

// ===== RESPAWN =====
function respawn() {
  setStatus("Dead - respawning", "#f87171");
  log("DEAD -> respawn");
  nap(600);
  tapGame(P_WARP, "warp");
  nap(700);
  tapGame(P_OK, "ok");
  nap(2500);
  if (dialogVisible()) {
    method = (method + 1) % METHODS.length;
    log("still dead, switching tap method -> " + method);
    return;
  }
  log("respawned OK");
  nap(CFG.AFTER_RESPAWN_WAIT);
  returnToSpot();
}

// =====================================================================================================
// ===== NON-PREMIUM DUNGEON MODE =====
// Floating DG window: one ON/OFF switch per dungeon + START DG. Each dungeon is a list of STEPS that look for a
// template image (PNG in DG_DIR) on screen and tap it. Death during a run -> respawn, abort that run, go on.
// To add a dungeon: add [id, "Name"] to DG_NAMES (standard steps) or copy the Roa entry for a custom step list.
// Step types:
//   {t:"tap",  img:"x.png", label, timeout, after, optional}   wait for the image, then tap its center
//   {t:"until",img:"x.png", label, timeout}                    wait for the image (e.g. "dungeon cleared"), no tap
//   {t:"pt",   p:[gameX,gameY], label, after}                  tap a fixed game-space point
//   {t:"auto"}                                                 turn AUTO attack on (only if off)
//   {t:"wait", ms}                                             plain wait
// =====================================================================================================
var DG_DIR = "/storage/emulated/0/脚本/btn/";
// Opening the Select Dungeon window (every dungeon starts with these two steps):
//   1) OPTIONAL: tap the key's "Move" button (template dg_move.png, saved once in DG_DIR) -> the character walks to the
//      dungeon entrance; waits DG_MOVE_WAIT ms for the trip. Skipped when the button is not on screen.
//   2) tap the center of the screen -> opens the Select Dungeon window (character stands at the entrance).
var DG_MOVE_WAIT = 15000;                 // ms to wait after "Move" for the character to arrive
var DG_CENTER = [Math.round(GW / 2), Math.round(GH / 2)];
// Bag steps (run before Move): open the bag -> tab IV (dungeon tickets) -> find THIS dungeon's entry item and tap it.
// Templates saved once in DG_DIR:  dg_bag.png (bag button), dg_tab.png (ticket tab, optional), dg_bag_close.png (optional), <id>_item.png (entry item icon).
// If an icon is missing from the first page of the tab, the bag list is swiped DG_BAG_SWIPE and searched again.
var P_DG_BAG = [2039, 50];                        // bag icon in the top-right HUD (game space) - used when dg_bag.png is not saved
var P_DG_TAB = [1486, 457];                       // inventory tab IV (left edge of the bag window) where the dungeon tickets are - used when dg_tab.png is not saved
var DG_BAG_SWIPE = [[1300, 850], [1300, 450]];   // game-space [from, to] swipe inside the bag grid - tune if your bag layout differs
var DG_BAG_PAGES = 5;                            // max swipes while searching for the item
function dgOpen(name, id) {
  return [
    { t: "tap", img: "dg_bag.png",  fallback: P_DG_BAG, label: "Open bag", timeout: 2000, after: 1500 },
    { t: "tap", img: "dg_tab.png", fallback: P_DG_TAB, label: "Bag tab IV (dungeon tickets)", timeout: 1500, after: 900 },
    { t: "tap", img: id + "_item.png", label: "Find " + name + " in bag", timeout: 6000, after: 1200, scroll: true },
    { t: "tap", img: "dg_move.png", label: "Move to " + name + " entrance", timeout: 3000, after: DG_MOVE_WAIT, optional: true },
    { t: "tap", img: "dg_bag_close.png", label: "Close bag", timeout: 1500, after: 800, optional: true },
    { t: "pt",  p: DG_CENTER,        label: "Open Select Dungeon", after: 1500 },
    { t: "snap", id: id, name: name }
  ];
}
// Standard step list. Template names are <id>_enter / _confirm / _clear / _exit .png in DG_DIR.
function dgStd(id, name) {
  return dgOpen(name, id).concat([
    { t: "tap",   img: id + "_enter.png",   alt: "dg_item_enter.png", label: "Enter " + name,   timeout: 30000 },
    { t: "tap",   img: id + "_confirm.png", label: "Confirm",         timeout: 12000, optional: true },
    { t: "wait",  ms: 8000 },
    { t: "auto" },
    { t: "until", img: id + "_clear.png",   label: name + " cleared", timeout: 900000 },
    { t: "tap",   img: id + "_exit.png",    label: "Leave " + name,   timeout: 20000, optional: true }
  ]);
}
// Dungeons (names/entry items from the bag tab VII tooltips). Roa stays ON by default; the rest start OFF.
var DG_NAMES = [
  ["ic_underworld",    "Illusion Castle Underworld"],        // Copy of the Illusive Apocalypse
  ["ic_underworld_ap", "IC Underworld Apocrypha"],           // Illusive Apocalypse (Apocrypha)
  ["ic_radiant",       "Illusion Castle Radiant Hall"],      // Apocalypse of Other Dimension
  ["ic_radiant_ap",    "IC Radiant Hall Apocrypha"],         // Apocalypse of Other Dimension (Apocrypha)
  ["volcanic",         "Volcanic Citadel"],                  // Seal of the Darkness
  ["abandoned",        "Abandoned City"],                    // Strange Liquid
  ["catacomb",         "Catacomb Frost (Awakened)"],         // Frozen Clue (Awakened)
  ["purifier",         "Purifier of the Forest"],            // Mountain Radar
  ["celestia",         "Celestia"],                          // Dimensional Ship's Key
  ["siena_b1",         "Altar of Siena B1F"],                // Siena's Crest B1F
  ["siena_b2",         "Altar of Siena B2F"],                // Siena's Crest B2F
  ["garden",           "Garden of Dust"],                    // Contaminated cactus
  ["maquinas",         "Maquinas Outpost"],                  // Hacked Code Disk
  ["ruina_weak",       "Weakened Ruina Station"],            // Copy of Muster Card
  ["ruina",            "Ruina Station"],                     // Muster Card : Ruina Station
  ["tou_b1",           "Frozen Tower of Undead B1F"],        // Copy of Epaulet of Undead
  ["tou_b2",           "Tower of the Dead B2F"],             // Epaulet of Undead (B2F) Part1
  ["phantom",          "Edge of Phantom"],                   // Broken Epaulet of Undead
  ["forgotten_b1",     "Forgotten Temple B1F"],              // Muster Card : Forgotten Temple B1F
  ["forbidden",        "Forbidden Island"],                  // Lost Island Compass
  ["tou_b3",           "Tower of the Dead B3F"],             // Epaulet of Undead B3F
  ["tou_b3_p2",        "Tower of the Dead B3F (Part2)"],     // Epaulet of Undead B3F (Part2)
  ["panic",            "Panic Cave"],                        // Explorer's Journal
  ["panic_aw",         "Panic Cave (Awakened)"],             // Explorer's Journal (Awakened)
  ["frozen_canyon",    "Frozen Canyon"],                     // Lamp that illuminates the Soul
  ["catacomb_n",       "Catacomb Frost"],                    // Frozen Clue
  ["steamer",          "Steamer Crazy"],                     // Defected Train Card
  ["steamer_aw",       "Steamer Crazy (Awakened)"],          // Defected Train Card (Awakened)
  ["hazard",           "Hazardous Valley"],                  // Nearly-hatching Egg
  ["hazard_aw",        "Hazardous Valley (Awakened)"],       // Nearly Hatched Egg (Awakened)
  ["lava",             "Lava Hellfire"],                     // Ever-heated Lava Stone
  ["lava_aw",          "Lava Hellfire (Awakened)"],          // Ever-Heated Lava Stone (Awakened)
  ["flame_nest",       "Flame Nest"],                        // Broken Devil's Horn
  ["turminos",         "Turminos Maquina"],                  // Broken Circuit Chip
  ["ancient_tomb",     "Ancient Tomb"],                      // Hidden Tomb Key
  ["chaos1",           "Chaos Arena Lv.1"],                  // Key of Chaos Lv. 1
  ["chaos2",           "Chaos Arena Lv.2"],                  // Key of Chaos Lv. 2
  ["chaos3",           "Chaos Arena Lv.3"],                  // Key of Chaos Lv. 3
  ["chaos4",           "Chaos Arena Lv.4"],                  // Key of Chaos Lv. 4
  ["chaos5",           "Chaos Arena Lv.5"],                  // Key of Chaos Lv. 5
  ["chaos6",           "Chaos Arena Lv.6"],                  // Key of Chaos Lv. 6
  ["chaos7",           "Chaos Arena Lv.7"]                   // Key of Chaos Lv. 7
];
var DG_LIST = [
  { id: "roa", name: "Roa", steps: dgOpen("Roa", "roa").concat([
    // EDIT these file names to the templates you saved in the btn folder (screens are not known to the script yet)
    { t: "tap",   img: "roa_enter.png",   label: "Enter Roa",   timeout: 30000 },
    { t: "tap",   img: "roa_confirm.png", label: "Confirm",     timeout: 12000, optional: true },
    { t: "wait",  ms: 8000 },
    { t: "auto" },
    { t: "until", img: "roa_clear.png",   label: "Roa cleared", timeout: 900000 },
    { t: "tap",   img: "roa_exit.png",    label: "Leave Roa",   timeout: 20000, optional: true }
  ]) }
];
DG_NAMES.forEach(function (n) { DG_LIST.push({ id: n[0], name: n[1], off: true, steps: dgStd(n[0], n[1]) }); });
var dw = null, dgImgs = {};

function dgGetOn() {
  var m = {};
  try { m = JSON.parse(store.get("dg_on", "{}")) || {}; } catch (e) { m = {}; }
  for (var i = 0; i < DG_LIST.length; i++) if (m[DG_LIST[i].id] === undefined) m[DG_LIST[i].id] = !DG_LIST[i].off;
  return m;
}
function dgImg(name) {                    // cached template; a missing file is retried next time (so you can add it while running)
  if (!dgImgs[name]) {
    var p = DG_DIR + name;
    try { if (files.exists(p)) dgImgs[name] = images.read(p); } catch (e) { log("DG tpl err: " + e); }
  }
  return dgImgs[name] || null;
}
// Templates cropped from a 1177-px-high screen (the ones I make for you) are scaled down on smaller captures such as Redfinger 1280x720;
// templates you cropped on this very device match as they are. Both versions are tried, the one that matched last time first.
var TPL_REF_H = 1177, dgScaled = {}, dgPref = {}, dgWarned = {};
function dgScaledImg(name, t) {
  if (!H || Math.abs(H - TPL_REF_H) < 8) return null;
  var k = H / TPL_REF_H, key = name + "@" + Math.round(k * 1000);
  if (!dgScaled[key]) { try { dgScaled[key] = images.scale(t, k, k); } catch (e) { log("DG scale err: " + e); } }
  return dgScaled[key] || null;
}
function dgFind(img, name) {              // [x, y] screen-px center of the match, or null
  var t = dgImg(name);
  if (!t) {
    if (!dgWarned[name]) { dgWarned[name] = 1; log("template not found: " + DG_DIR + name); }
    return null;
  }
  var vs = [t], sc = dgScaledImg(name, t);
  if (sc) { if (dgPref[name] === 1) vs = [sc, t]; else vs = [t, sc]; }
  for (var i = 0; i < vs.length; i++) {
    var v = vs[i], pt = null;
    try { pt = images.findImage(img, v, { threshold: TPL_THRESHOLD }); } catch (e) { log("DG find err: " + e); }
    if (pt) { dgPref[name] = (v === t) ? 0 : 1; return [Math.round(pt.x + v.getWidth() / 2), Math.round(pt.y + v.getHeight() / 2)]; }
  }
  return null;
}
function deadOn(img) {                    // same death-dialog test as dialogVisible(), on an image we already grabbed
  var a1 = pix(img, P_A1), a2 = pix(img, P_A2), b = pix(img, P_B);
  return (isA(a1) || isA(a2)) && isB(b);
}
function respawnDG() {                    // respawn in town only - no return-to-spot (that spot is outside the dungeon)
  setStatus("DG: dead - respawning", "#f87171");
  log("DG: DEAD -> respawn");
  nap(600);
  tapGame(P_WARP, "warp");
  nap(700);
  tapGame(P_OK, "ok");
  nap(2500);
  if (dialogVisible()) { method = (method + 1) % METHODS.length; log("still dead, switching tap method -> " + method); return; }
  nap(CFG.AFTER_RESPAWN_WAIT);
}
// Select Dungeon popup = which dungeon is this?  The bottom-left title ("Forbidden Island", "Volcanic Citadel"...) is saved ONCE per
// dungeon as <id>_title.png (first time that dungeon is opened by the script), plus the full popup as popup_<id>.png.
// Next runs compare the popup title with it, so the script never enters the wrong dungeon (e.g. B1F vs B2F, normal vs Awakened).
// Wrong one saved? delete <id>_title.png in DG_DIR and it is saved again on the next run. Every result is appended to dg_record.txt.
var DG_TITLE_BOX = [69, 806, 450, 46];    // game-space [x, y, w, h] of the dungeon name line in the popup's bottom-left panel
function dgRecord(id, name, what) {
  try { files.ensureDir(DG_DIR); files.append(DG_DIR + "dg_record.txt", new Date().toLocaleString() + "  " + id + "  " + name + "  " + what + "\n"); } catch (e) {}
}
function dgSnap(st) {
  var tplName = st.id + "_title.png", end = Date.now() + 4000;
  while (true) {
    if (!running) throw "STOP";
    var img = grab();
    if (!img) { nap(500); continue; }
    if (deadOn(img)) { img.recycle(); respawnDG(); return "dead"; }
    if (!dgImg(tplName)) {                                   // first time: save whose dungeon this popup is
      var p1 = toScreen([DG_TITLE_BOX[0], DG_TITLE_BOX[1]]), p2 = toScreen([DG_TITLE_BOX[0] + DG_TITLE_BOX[2], DG_TITLE_BOX[1] + DG_TITLE_BOX[3]]);
      var rx = Math.max(0, Math.min(p1[0], p2[0])), ry = Math.max(0, Math.min(p1[1], p2[1]));
      var rw = Math.min(img.getWidth() - rx, Math.abs(p2[0] - p1[0])), rh = Math.min(img.getHeight() - ry, Math.abs(p2[1] - p1[1]));
      try {
        files.ensureDir(DG_DIR);
        var crop = images.clip(img, rx, ry, rw, rh);
        images.save(crop, DG_DIR + tplName);
        crop.recycle();
        images.save(img, DG_DIR + "popup_" + st.id + ".png");
        log("DG: popup saved as " + st.name + " (" + tplName + ")");
        dgRecord(st.id, st.name, "SAVED popup");
      } catch (e) { log("DG: popup save err: " + e); }
      img.recycle();
      return "ok";
    }
    var pos = dgFind(img, tplName);
    img.recycle();
    if (pos) { log("DG: popup is " + st.name + " - OK"); dgRecord(st.id, st.name, "popup OK"); return "ok"; }
    if (Date.now() > end) break;
    nap(500);
  }
  log("DG: popup is NOT " + st.name + " - skipped (delete " + tplName + " in " + DG_DIR + " if that one is wrong)");
  dgRecord(st.id, st.name, "popup MISMATCH");
  return "fail";
}
// Auto-OK for the pop-ups that follow a dungeon clear. Templates (DG_DIR): dg_clear_exit.png (Dungeon Clear -> Exit),
// dg_challenge.png (Enter Dungeon -> Challenge = starts the run), dg_gained.png (Guild Treasure -> Gained), dg_roll.png (Bonus SP -> Roll), dg_bonus_exit.png (Earned SP -> Exit). A missing file is just skipped.
var DG_POPUPS = [
  { img: "dg_challenge.png",   label: "Challenge (Enter Dungeon)", auto: true },
  { img: "dg_gained.png",     label: "Gained (guild treasure)" },
  { img: "dg_roll.png",       label: "Roll (bonus SP)" },
  { img: "dg_bonus_exit.png", label: "Exit (bonus SP)" },
  { img: "dg_clear_exit.png", label: "Exit (dungeon clear)" }
];
// General pop-ups (also checked while idle in the main loop): Periodical Item Expired -> OK, Character Penalty -> OK,
// Daily Login Reward -> tap today's reward, then close. Templates in DG_DIR: dg_expired_ok.png, dg_penalty_ok.png, dg_login_title.png.
var GEN_POPUPS = [
  { img: "dg_expired_ok.png", label: "OK (periodical item expired)" },
  { img: "dg_penalty_ok.png", label: "OK (character penalty)" }
];
var lastLogin = 0, lastGen = 0;
// Daily Login grid is laid out relative to the "Daily Login Reward" title: 7 columns x 4 rows (day 1..28, row by row)
var LOGIN_DX = [-526, -373, -220, -67, 87, 240, 442], LOGIN_DY = [160, 320, 478, 638], LOGIN_CLOSE = [540, 2];
function loginCellFree(img, cx, cy) {     // true = the cell still shows a coloured reward icon (a claimed day is dark grey "Complete")
  var n = 0, w = img.getWidth(), h = img.getHeight();
  for (var y = cy - 50; y <= cy + 50; y += 6) {
    for (var x = cx - 50; x <= cx + 50; x += 6) {
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      var c = images.pixel(img, x, y), r = colors.red(c), g = colors.green(c), b = colors.blue(c);
      var mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      if (mx > 90 && mx - mn > 70) n++;
    }
  }
  return n >= 12;
}
function claimLogin(img, t) {             // t = screen-px centre of the title template
  var pick = null;
  for (var r = 0; r < 4 && !pick; r++) {
    for (var c = 0; c < 7 && !pick; c++) {
      var cx = t[0] + LOGIN_DX[c], cy = t[1] + LOGIN_DY[r];
      if (loginCellFree(img, cx, cy)) pick = [cx, cy, r * 7 + c + 1];
    }
  }
  if (pick) { log("Daily Login: today's reward = day " + pick[2]); tapPx([pick[0], pick[1]], "Daily Login reward day " + pick[2]); nap(1800); }
  else log("Daily Login: all days already claimed");
  tapPx([t[0] + LOGIN_CLOSE[0], t[1] + LOGIN_CLOSE[1]], "Close Daily Login");
  nap(1000);
}
function genPopups(img) {                 // -> label of the pop-up handled, or null
  for (var i = 0; i < GEN_POPUPS.length; i++) {
    var pu = GEN_POPUPS[i];
    var pos = dgFind(img, pu.img);
    if (pos) { tapPx(pos, pu.label); log("auto " + pu.label); return pu.label; }
  }
  if (Date.now() - lastLogin > 120000) {
    var t = dgFind(img, "dg_login_title.png");
    if (t) { lastLogin = Date.now(); claimLogin(img, t); return "Daily Login Reward"; }
  }
  return null;
}
function dgPopups(img) {                  // taps the first pop-up button found on an already grabbed image -> label or null
  for (var i = 0; i < DG_POPUPS.length; i++) {
    var pu = DG_POPUPS[i];
    var pos = dgFind(img, pu.img);
    if (pos) {
      tapPx(pos, pu.label); log("DG: auto " + pu.label);
      if (pu.auto) { nap(1500); try { ensureAuto(); } catch (e) {} }     // run started -> make sure AUTO is on
      return pu.label;
    }
  }
  return genPopups(img);
}
function dgDrain(maxMs) {                 // after a run: keep clicking pop-ups until none shows up for a few seconds
  var t0 = Date.now(), last = 0;
  while (running && Date.now() - t0 < (maxMs || 40000)) {
    var img = grab();
    if (!img) { nap(500); continue; }
    var hit = deadOn(img) ? null : dgPopups(img);
    img.recycle();
    if (hit) { last = Date.now(); nap(1200); continue; }
    if (last ? Date.now() - last > 6000 : Date.now() - t0 > 8000) break;
    nap(700);
  }
}
var dgWhy = "";
function dgStep(st, dname) {              // -> "ok" | "skip" | "fail" | "dead"
  if (st.t === "snap") return dgSnap(st);
  if (st.alt && !dgImg(st.img) && dgImg(st.alt)) { var c2 = {}; for (var k in st) c2[k] = st[k]; c2.img = st.alt; st = c2; }   // shared fallback template
  if (st.t === "wait") {                  // plain wait, but pop-ups (Enter Dungeon -> Challenge ...) are clicked while waiting
    var wEnd = Date.now() + (st.ms || 1000);
    while (Date.now() < wEnd) {
      if (!running) throw "STOP";
      var wi = grab();
      if (wi) { var wh = deadOn(wi) ? null : dgPopups(wi); wi.recycle(); if (wh) { nap(1200); continue; } }
      nap(700);
    }
    return "ok";
  }
  if (st.t === "auto") { ensureAuto(); return "ok"; }
  if (st.t === "pt")   { tapGame(st.p, st.label || "point"); nap(st.after || 800); return "ok"; }
  var label = st.label || st.img;
  if (!dgImg(st.img)) {
    log("DG: template missing: " + DG_DIR + st.img);
    if (st.fallback) { tapGame(st.fallback, label + " (fixed point)"); nap(st.after || 1200); return "ok"; }
    if (!st.optional) dgWhy = "missing " + st.img;
    return st.optional ? "skip" : "fail";
  }
  setStatus("DG " + dname + ": " + label, "#38bdf8");
  var swipes = 0, lastSwipe = 0;
  var end = Date.now() + (st.timeout || 20000) + (st.scroll ? DG_BAG_PAGES * 2500 : 0);
  while (Date.now() < end) {
    if (!running) throw "STOP";
    var img = grab();
    if (!img) { nap(500); continue; }
    var dead = deadOn(img);
    var pos = dead ? null : dgFind(img, st.img);
    var hit = (dead || pos) ? null : dgPopups(img);      // the step's own target always wins in the same frame
    img.recycle();
    if (dead) { respawnDG(); return "dead"; }
    if (pos) {
      if (st.t === "tap") { tapPx(pos, label); nap(st.after || 1200); }
      else log("DG: " + label);
      return "ok";
    }
    if (hit) { nap(900); continue; }
    if (st.scroll && swipes < DG_BAG_PAGES && Date.now() - lastSwipe > 1500) {   // not on this page of the bag -> next page
      var f = toScreen(DG_BAG_SWIPE[0]), t2 = toScreen(DG_BAG_SWIPE[1]);
      log("DG: " + label + " - scrolling bag (" + (swipes + 1) + "/" + DG_BAG_PAGES + ")");
      try { swipe(f[0], f[1], t2[0], t2[1], 500); } catch (e) { log("DG swipe err: " + e); }
      swipes++; lastSwipe = Date.now(); nap(900);
      continue;
    }
    nap(st.t === "until" ? CFG.CHECK_EVERY : 600);
  }
  if (st.fallback) { tapGame(st.fallback, label + " (fixed point)"); nap(st.after || 1200); return "ok"; }
  if (!st.optional) dgWhy = "not found: " + st.img;
  log("DG: timed out: " + label + (st.scroll ? " (no ticket in bag tab IV, or " + st.img + " not saved)" : ""));
  return st.optional ? "skip" : "fail";
}
function runDungeon(d) {                  // -> "done" | "dead" | "fail"
  log("DG: start " + d.name);
  for (var i = 0; i < d.steps.length; i++) {
    var r = dgStep(d.steps[i], d.name);
    if (r === "dead") return "dead";
    if (r === "fail") return "fail";
  }
  return "done";
}
function dgMain() {
  if (CFG.SHOW_CONSOLE) console.show();
  log("== Non-premium DG ==");
  setStatus("DG starting...", "#fbbf24");
  try { auto.waitFor(); } catch (e) { log("auto.waitFor: " + e); }
  try { hasRoot = (shell("id", true).code === 0); } catch (e) { hasRoot = false; }
  setupCapture();
  buildMethods();
  if (capMode === "none") { log("no capture available - allow screen capture for AutoX.js"); return; }
  var pkg = findCabalPkg(), already = false;
  try { already = !!pkg && currentPackage() === pkg; } catch (e) {}
  if (!already) { pkg = openCabal(); waitForApp(pkg, 40000); tapToStart(); tapGameStart(); }
  while (running) {
    var on = dgGetOn(), ran = 0, done = 0;
    for (var i = 0; i < DG_LIST.length && running; i++) {
      var d = DG_LIST[i];
      if (!on[d.id]) continue;
      ran++;
      var r = runDungeon(d);
      if (r === "done" || r === "fail") dgDrain(40000);
      log("DG " + d.name + ": " + r + (r === "fail" && dgWhy ? " - " + dgWhy : ""));
      if (r === "fail" && dgWhy) setStatus("DG fail: " + dgWhy, "#f87171");
      dgWhy = "";
      if (r === "done") done++;
      nap(2000);
    }
    if (!ran) { log("DG: switch at least one dungeon ON"); toast("Switch a dungeon ON first"); break; }
    if (!done) { log("DG: nothing could run (entry used up / template missing) - stopped"); break; }
    if (!store.get("dg_repeat", true)) break;
  }
  setStatus("DG finished", "#94a3b8");
}
function startDG() {
  if (running) { toast("Already running"); return; }
  readCfgFromUi();
  running = true;
  refreshButtons();
  worker = threads.start(function () {
    try { dgMain(); }
    catch (e) { if (String(e) !== "STOP") log("DG fatal: " + e); }
    running = false;
    log("stopped");
    refreshButtons();
  });
}
// --- DG window must stay on screen in portrait AND landscape (screen height differs, window was cut off) ---
function dgScreen() {                     // real screen size in px for the CURRENT orientation
  var dm = new android.util.DisplayMetrics();
  context.getSystemService(android.content.Context.WINDOW_SERVICE).getDefaultDisplay().getRealMetrics(dm);
  return { w: dm.widthPixels, h: dm.heightPixels, d: dm.density };
}
function dgPlace(w, x, y) {               // setPosition, kept fully inside the screen
  var s = dgScreen(), ww = w.getWidth() > 0 ? w.getWidth() : Math.round(190 * s.d), wh = w.getHeight() > 0 ? w.getHeight() : Math.round(300 * s.d);
  x = Math.max(0, Math.min(x, s.w - ww));
  y = Math.max(0, Math.min(y, s.h - wh));
  w.setPosition(Math.round(x), Math.round(y));
}
function dgFit(w) {                       // shrink the dungeon list to the screen height, then re-place the window
  var s = dgScreen();
  var sh = Math.max(70, Math.min(260, Math.round(s.h / s.d - 190)));   // 190dp = header + switch + buttons + log + margins
  ui.run(function () {
    try { var lp = w.dgScroll.getLayoutParams(); lp.height = Math.round(sh * s.d); w.dgScroll.setLayoutParams(lp); } catch (e) { log("DG fit err: " + e); }
  });
  sleep(300);                             // let the layout settle so getHeight() is right (plain sleep: nap() throws when the bot is stopped)
  dgPlace(w, w.getX(), w.getY());
}
function closeDG() { try { if (dw) dw.close(); } catch (e) {} dw = null; }
function openDG() {
  if (dw) { closeDG(); return; }
  dw = floaty.window(
    <vertical w="190" bg="#f01a1a24">
      <text id="dgHdr" text="NON-PREMIUM DG (drag here)" textSize="11sp" textColor="#e0b84a" textStyle="bold" bg="#1a1a24" padding="5"/>
      <scroll id="dgScroll" h="260"><vertical id="dgList" padding="6 2"/></scroll>
      <Switch id="dgRep" text="Repeat rounds" textSize="11sp" textColor="#e2e8f0" padding="6 2"/>
      <horizontal marginTop="2">
        <button id="btnDgGo" text="START DG" textSize="10sp" w="0" layout_weight="1" h="34" padding="0" bg="#2e7d32" textColor="#ffffff"/>
        <button id="btnDgClose" text="CLOSE" textSize="10sp" w="0" layout_weight="1" h="34" padding="0" bg="#2d2d3a" textColor="#e2e8f0"/>
      </horizontal>
      <text id="dgLog" text="" textSize="9sp" textColor="#9ca3af" bg="#0b0b14" padding="4" minHeight="40" maxLines="3" ellipsize="end"/>
    </vertical>
  );
  var w = dw;
  w.setPosition(30, 260);
  var ox = 0, oy = 0, wx = 0, wy = 0;
  w.dgHdr.setOnTouchListener(function (v, e) {
    var act = e.getAction();
    if (act == 0) { ox = e.getRawX(); oy = e.getRawY(); wx = w.getX(); wy = w.getY(); }
    else if (act == 2) { dgPlace(w, wx + (e.getRawX() - ox), wy + (e.getRawY() - oy)); }
    return true;
  });
  var on = dgGetOn();
  ui.run(function () {
    DG_LIST.forEach(function (d) {
      var sw = new android.widget.Switch(context);
      sw.setText(d.name); sw.setTextSize(11); sw.setTextColor(colors.parseColor("#e2e8f0"));
      sw.setChecked(!!on[d.id]);
      sw.setOnCheckedChangeListener(new android.widget.CompoundButton.OnCheckedChangeListener({
        onCheckedChanged: function (b, v) { try { var m = dgGetOn(); m[d.id] = !!v; store.put("dg_on", JSON.stringify(m)); } catch (e) {} }
      }));
      w.dgList.addView(sw);
    });
    w.dgRep.setChecked(!!store.get("dg_repeat", true));
    w.dgRep.setOnCheckedChangeListener(new android.widget.CompoundButton.OnCheckedChangeListener({
      onCheckedChanged: function (b, v) { try { store.put("dg_repeat", !!v); } catch (e) {} }
    }));
    w.btnDgGo.setText(running ? "STOP" : "START DG");
  });
  w.btnDgGo.click(function () { if (running) stopBot(); else startDG(); });
  w.btnDgClose.click(function () { closeDG(); });
  // fit now, and again whenever the screen is rotated
  threads.start(function () {
    var last = "";
    while (dw === w) {
      try {
        var sc = dgScreen(), key = sc.w + "x" + sc.h;
        if (key !== last) { last = key; dgFit(w); }
      } catch (e) { log("DG watch err: " + e); }
      sleep(1000);
    }
  });
}

// ===== SETUP (runs in worker thread) =====
function setupCapture() {
  if (capReady) return;
  threads.start(function () {
    var b = textMatches(/(Start now|START NOW|Allow|ALLOW|\u7acb\u5373\u5f00\u59cb|\u5141\u8bb8)/).findOne(8000);
    if (b) b.click();
  });
  var okCap = false;
  var th = threads.start(function () {
    try { okCap = requestScreenCapture(true); } catch (e) { log("cap err: " + e); }
    if (!okCap) { try { okCap = requestScreenCapture(false); } catch (e2) { log("cap2 err: " + e2); } }
  });
  th.join(15000);
  if (okCap) capMode = "projection"; else if (hasRoot) capMode = "screencap";
  else capMode = "none";
  capReady = (capMode !== "none");
  log("capture mode: " + capMode);
  nap(1500);
}

function buildMethods() {
  METHODS = [];
  if (hasRoot) METHODS.push(function (x, y) { shell("input tap " + x + " " + y, true); });
  METHODS.push(function (x, y) { press(x, y, 150); });
  METHODS.push(function (x, y) { click(x, y); });
  METHODS.push(function (x, y) { swipe(x, y, x + 1, y + 1, 150); });
  method = 0;
}

// one-time setup shared by PLAY and the respawn watch
var initDone = false, initBusy = false;
function ensureReady() {
  while (initBusy) nap(300);
  if (initDone) return;
  initBusy = true;
  try {
    try { auto.waitFor(); } catch (e) { log("auto.waitFor: " + e); }
    try { hasRoot = (shell("id", true).code === 0); } catch (e) { hasRoot = false; }
    log("root: " + hasRoot);
    setupCapture();
    buildMethods();
    initDone = (capMode !== "none");
  } finally { initBusy = false; }
}

// "other" entry pop-ups (Hot Item, Daily Login...) - closes them until none shows up for a few seconds
function startupPopups(maxMs) {
  setStatus("Closing popups", "#fbbf24");
  var t0 = Date.now(), last = Date.now();
  while (Date.now() - t0 < maxMs) {
    var img = grab();
    if (!img) { nap(500); continue; }
    var hit = null;
    try { hit = genPopups(img); } finally { img.recycle(); }
    if (hit) { last = Date.now(); nap(1200); continue; }
    if (Date.now() - last > 6000) break;
    nap(700);
  }
}

// ===== PLAY button: open app -> "Please Tap the Screen" -> Game start -> sub-password -> other popups. Then it ENDS. =====
// The respawn watch is NOT started from here - it has its own switch (the R button).
function botMain(testOnly) {
  if (CFG.SHOW_CONSOLE) console.show();
  log("== Login: open app, tap, Game start, sub-password ==");
  setStatus("Starting...", "#fbbf24");
  ensureReady();
  while (respBusy) nap(300);               // a respawn already in progress finishes first
  setStatus("Opening Cabal", "#fbbf24");
  var pkg = openCabal();
  waitForApp(pkg, 40000);
  if (capMode === "none") { log("no capture available - allow screen capture for AutoX.js"); return; }
  pinBlocked = false;
  tapToStart(); tapGameStart(); pinOnce();

  if (testOnly) {
    log("TEST: running return-to-spot once");
    grab();
    returnToSpot();
    return;
  }
  startupPopups(20000);
  setStatus("Login done", "#4ade80");
  log("login done" + (respawnOn ? "" : " - press R to watch for death"));
}

function startBot(testOnly) {
  if (running) { toast("Already running"); return; }
  readCfgFromUi();
  running = true;
  refreshButtons();
  worker = threads.start(function () {
    try { botMain(testOnly); }
    catch (e) { if (String(e) !== "STOP") log("fatal: " + e); }
    running = false;
    log("stopped");
    refreshButtons();
  });
}

function stopBot() {
  if (!running) return;
  running = false;
  setStatus("Stopping...", "#fbbf24");
}

// ===== R button: respawn watch (own thread, own on/off) =====
function respawnLoop() {
  tlRole.set("resp");
  ensureReady();
  if (capMode === "none") { log("no capture available - allow screen capture for AutoX.js"); respawnOn = false; return; }
  log("== Respawn watch ON ==");
  setStatus("Watching for death", "#4ade80");
  while (respawnOn) {
    try {
      if (running) { nap(1000); continue; }          // PLAY / DG / TEST is using the screen right now
      if (dialogVisible()) {
        respBusy = true;
        try { respawn(); } finally { respBusy = false; }
        if (respawnOn && !running) setStatus("Watching for death", "#4ade80");
      }
      if (Date.now() - lastGen > 2500) {
        lastGen = Date.now();
        var gi = grab();
        if (gi) { try { genPopups(gi); } finally { gi.recycle(); } }
      }
    } catch (e) {
      if (String(e) === "STOP") break;
      log("loop err: " + e);
    }
    nap(CFG.CHECK_EVERY);
  }
}
function startRespawn() {
  if (respawnOn) return;
  readCfgFromUi();
  respawnOn = true;
  refreshButtons();
  rworker = threads.start(function () {
    try { respawnLoop(); }
    catch (e) { if (String(e) !== "STOP") log("respawn fatal: " + e); }
    respawnOn = false; respBusy = false;
    log("respawn watch off");
    refreshButtons();
  });
}
function stopRespawn() {
  if (!respawnOn) return;
  respawnOn = false;
  refreshButtons();
}


// =====================================================================================================
// ===== ACCOUNT: LOGIN + AUTO SIGN-IN (Firebase - same accounts / keys / device lock as the main script) =====
// =====================================================================================================
// New accounts are created with REGISTER in the main script; here you log in with username + password (the access key is only asked when the account is expired / has none).
// A saved login signs in silently at the next start (the owner account only when "Auto sign in (owner)" is switched on).
var FB = {
  apiKey: "AIzaSyBvUhQiUtxs7TADYZxaSaVE6oeNiYmPoy4",
  projectId: "nstp-tup",
  requireKey: true,          // non-owner accounts need an expiring access key (same as the main script)
  domain: "cabal.local",     // username "james" signs in as james@cabal.local
  checkEvery: 90000          // re-check expiry / device lock every 90 s
};
var FS_DOC = "projects/" + FB.projectId + "/databases/(default)/documents";
var REL_DOC = "config/respawn";   // release info of THIS script (the main script keeps config/script - never mixed up)
var fbAuth = null, srvSkew = 0, acctExp = 0, acctAdmin = false, currentUser = "", badTries = 0, lockUntil = 0, sessThread = null, updBusy = false;
var lw = null, ow = null;
var needKeyBox = false;          // the access-key box in the login window stays hidden unless this account has no valid licence (expired / never had a key)

function fbBody(res) { try { return JSON.parse(res.body.string()); } catch (e) { return {}; } }
function nowMs() { return Date.now() + srvSkew; }
function noteSrv(res) {
  try {
    var h = res.headers, d = h && (h["Date"] || h["date"] || (h.get && h.get("Date")));
    if (d) { var t = Date.parse(String(d)); if (t) srvSkew = t - Date.now(); }
  } catch (e) {}
}
function hashPw(str) {
  var md = java.security.MessageDigest.getInstance("SHA-256");
  var b = md.digest(new java.lang.String("cabal_ui:" + str).getBytes("UTF-8"));
  var out = "";
  for (var i = 0; i < b.length; i++) out += ("0" + (b[i] & 0xff).toString(16)).slice(-2);
  return out;
}
function sha256Hex(bytes) {
  var md = java.security.MessageDigest.getInstance("SHA-256"), d = md.digest(bytes), out = "";
  for (var i = 0; i < d.length; i++) out += ("0" + (d[i] & 0xff).toString(16)).slice(-2);
  return out;
}
function fbSignIn(email, pw) {          // returns "" on success, else an error code
  var res = http.postJson("https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=" + FB.apiKey,
                          { email: email, password: pw, returnSecureToken: true });
  var j = fbBody(res);
  if (res.statusCode === 200 && j.idToken) {
    fbAuth = { idToken: j.idToken, refreshToken: j.refreshToken, uid: j.localId, email: email,
               exp: Date.now() + (parseInt(j.expiresIn, 10) || 3600) * 1000 - 120000 };
    return "";
  }
  return (j.error && j.error.message) || ("HTTP " + res.statusCode);
}
function fbRefresh() {
  if (!fbAuth) return false;
  try {
    var res = http.post("https://securetoken.googleapis.com/v1/token?key=" + FB.apiKey,
                        { grant_type: "refresh_token", refresh_token: fbAuth.refreshToken });
    var j = fbBody(res);
    if (res.statusCode === 200 && j.id_token) {
      fbAuth.idToken = j.id_token;
      fbAuth.refreshToken = j.refresh_token || fbAuth.refreshToken;
      fbAuth.exp = Date.now() + (parseInt(j.expires_in, 10) || 3600) * 1000 - 120000;
      return true;
    }
  } catch (e) {}
  return false;
}
function fbCommit(writes) {             // Firestore REST commit, auto-refreshes the token
  if (!fbAuth) return null;
  if (Date.now() > fbAuth.exp && !fbRefresh()) return null;
  for (var attempt = 0; attempt < 2; attempt++) {
    var res = http.request("https://firestore.googleapis.com/v1/" + FS_DOC + ":commit",
                           { method: "POST", contentType: "application/json",
                             headers: { "Authorization": "Bearer " + fbAuth.idToken },
                             body: JSON.stringify({ writes: writes }) });
    noteSrv(res);
    if (res.statusCode !== 401) return res;
    if (!fbRefresh()) return res;
  }
  return null;
}
function fsDoc(path, fields, times, mustNotExist, onlyIfUpdateTime) {   // one Firestore write
  var f = {}, mask = [];
  for (var k in fields) { f[k] = (fields[k] && fields[k].ts) ? { timestampValue: fields[k].ts } : (fields[k] && fields[k].int !== undefined) ? { integerValue: String(fields[k].int) } : { stringValue: String(fields[k]) }; mask.push(k); }
  var wr = { update: { name: FS_DOC + "/" + path, fields: f }, updateMask: { fieldPaths: mask } };
  if (mustNotExist) wr.currentDocument = { exists: false };
  else if (onlyIfUpdateTime) wr.currentDocument = { updateTime: onlyIfUpdateTime };
  if (times && times.length) wr.updateTransforms = times.map(function (t) { return { fieldPath: t, setToServerValue: "REQUEST_TIME" }; });
  return wr;
}

// ----- device lock (one account = one device; the id is the same one the main script uses) -----
function myDeviceId() {
  var id = "";
  try { id = String(android.provider.Settings.Secure.getString(context.getContentResolver(), "android_id") || ""); } catch (e) {}
  var raw = id;
  try { var BD = android.os.Build; raw += "|" + BD.BRAND + "|" + BD.MODEL + "|" + BD.DEVICE + "|" + BD.HARDWARE; } catch (e) {}
  return hashPw("device:" + raw).slice(0, 32);
}
function fbPullAccount() {              // {bound, exp, admin} or null when it can't be read
  if (!fbAuth) return null;
  try {
    if (Date.now() > fbAuth.exp && !fbRefresh()) return null;
    var res = http.get("https://firestore.googleapis.com/v1/" + FS_DOC + "/users/" + fbAuth.uid,
                       { headers: { "Authorization": "Bearer " + fbAuth.idToken } });
    noteSrv(res);
    if (res.statusCode === 404) return { bound: "", exp: 0, admin: false };
    if (res.statusCode !== 200) return null;
    var f = fbBody(res).fields || {};
    var ts = (f.expiresAt && f.expiresAt.timestampValue) ? Date.parse(String(f.expiresAt.timestampValue).replace(/\.\d+Z$/, "Z")) : 0;
    return { bound: (f.deviceId && f.deviceId.stringValue) || "", exp: ts || 0, admin: !!(f.admin && f.admin.booleanValue === true), cmd: (f.cmd && f.cmd.stringValue) || "" };
  } catch (e) { return null; }
}
function fbDeviceCheck() {              // "OK" or "NETWORK". The respawn script NEVER binds / locks a device (the main script does that).
  var a = fbPullAccount();
  if (!a) return "NETWORK";
  acctExp = a.exp; acctAdmin = a.admin;
  return "OK";                          // no device write, no "locked to another device" rejection
}

// ----- access keys -----
function keyMsg(e) {
  return e === "BADKEY" ? "Invalid key" : e === "USED" ? "Key already used" : e === "NETWORK" ? "Can't verify key - check connection" : "Key could not be redeemed";
}
function fbReadKey(code, peek) {        // returns {code, days, usedBy, ...} or {err}; peek = also accept used keys
  code = String(code).trim().toUpperCase();
  if (!/^[A-Z0-9-]{6,40}$/.test(code)) return { err: "BADKEY" };
  try {
    var res = http.get("https://firestore.googleapis.com/v1/" + FS_DOC + "/keys/" + code);
    if (res.statusCode === 404 || res.statusCode === 403) return { err: "BADKEY" };
    if (res.statusCode !== 200) return { err: "NETWORK" };
    var kb = fbBody(res), f = kb.fields || {};
    var owner = (f.usedBy && f.usedBy.stringValue) || "";
    if (owner && !peek) return { err: "USED" };
    var d = f.days ? parseInt(f.days.integerValue || f.days.doubleValue, 10) : 0;
    if (!(d > 0 && d <= 3650)) return { err: "BADKEY" };
    var mx = f.maxUses ? (parseInt(f.maxUses.integerValue || f.maxUses.doubleValue, 10) || 1) : 1;
    var us = f.uses ? (parseInt(f.uses.integerValue || f.uses.doubleValue, 10) || 0) : 0;
    var ul = (f.usedList && f.usedList.stringValue) || "";
    if (mx > 1 && us >= mx && !peek) return { err: "USED" };
    return { code: code, days: d, usedBy: owner, max: mx, uses: us, list: ul, multi: mx > 1, ut: kb.updateTime || "" };
  } catch (e) { return { err: "NETWORK" }; }
}
function fbRedeemKey(code, tryN) {      // burn the key and set the new expiry in ONE atomic write (renews the account)
  var k = fbReadKey(code);
  if (k.err) return k;
  var exp = Math.max(nowMs(), acctExp || 0) + k.days * 86400000;
  var uf = { expiresAt: { ts: new Date(exp).toISOString() }, keyCode: k.code };
  var r;
  try {
    var keyWrite = k.multi
      ? fsDoc("keys/" + k.code, { uses: { int: k.uses + 1 }, usedList: k.list ? k.list + "," + fbAuth.uid : fbAuth.uid }, ["usedAt"], false, k.ut)
      : fsDoc("keys/" + k.code, { usedBy: fbAuth.uid }, ["usedAt"], false, k.ut);
    r = fbCommit([keyWrite, fsDoc("users/" + fbAuth.uid, uf, [])]);
  } catch (e) { return { err: "NETWORK" }; }
  if (!r) return { err: "NETWORK" };
  if (r.statusCode < 200 || r.statusCode >= 300) {
    var rj = fbBody(r), rs = (rj.error && rj.error.status) || "";
    if (r.statusCode === 409 || /FAILED_PRECONDITION|ABORTED|ALREADY_EXISTS/.test(rs)) {
      if (k.multi && (tryN || 0) < 3) return fbRedeemKey(code, (tryN || 0) + 1);
      return { err: "USED" };
    }
    return { err: "FAILED" };
  }
  acctExp = exp;
  return { ok: true, exp: exp };
}
function fbDrop() {                     // forget the session without touching the account's online state
  var t = sessThread; sessThread = null; fbAuth = null;
  if (t) { try { t.interrupt(); } catch (e) {} }
}
function fbSignOut(who) {               // best effort: mark offline, stop the session check
  try { if (fbAuth) fbCommit([fsDoc("users/" + fbAuth.uid, { state: "offline", user: who || currentUser }, ["lastSeen"])]); } catch (e) {}
  var t = sessThread; sessThread = null; fbAuth = null;
  if (t) { try { t.interrupt(); } catch (e) {} }
}

// ----- SAVED LOGIN (username / password / key, scrambled with a per-device key) -----
function credXor(b) {
  var K = myDeviceId() + "|cabal";
  for (var i = 0; i < b.length; i++) b[i] = ((b[i] ^ K.charCodeAt(i % K.length)) << 24) >> 24;
  return b;
}
function credEnc(str) { return String(android.util.Base64.encodeToString(credXor(new java.lang.String(String(str)).getBytes("UTF-8")), 2)); }
function credDec(str) { return String(new java.lang.String(credXor(android.util.Base64.decode(String(str), 0)), "UTF-8")); }
function saveLogin(u, p, k, adm) {
  try { store.put("saved_login", JSON.stringify({ u: credEnc(u), p: credEnc(p), k: credEnc(adm ? "" : (k || "")), a: adm ? 1 : 0 })); } catch (e) {}
}
function loadLogin() {
  try {
    var raw = store.get("saved_login", "");
    if (!raw) return null;
    var o = JSON.parse(raw), c = { u: credDec(o.u), p: credDec(o.p), k: credDec(o.k || ""), a: o.a === 1 };
    return (c.u && c.p) ? c : null;
  } catch (e) { return null; }
}
function forgetLogin() { try { store.remove("saved_login"); } catch (e) {} }

// ----- login itself (worker thread). silent = auto sign-in at the start: no "welcome" noise, failures just open the login window -----
function loginWith(name, pw, keyIn, silent) {
  var ki = null;
  if (FB.requireKey && keyIn) {
    ki = fbReadKey(keyIn, true);
    if (ki.err) { toast(keyMsg(ki.err)); return false; }
  }
  var email = name.indexOf("@") >= 0 ? name : name + "@" + FB.domain, err;
  try { err = fbSignIn(email, pw); } catch (e) { err = "NETWORK"; }
  if (err) {
    if (/INVALID_LOGIN|INVALID_PASSWORD|EMAIL_NOT_FOUND|INVALID_EMAIL/.test(err)) {
      if (!silent) {
        badTries++;
        if (badTries >= 5) { badTries = 0; lockUntil = Date.now() + 30000; toast("Too many tries - wait 30s"); }
        else toast("Wrong username or password");
      } else toast("Saved login no longer works - log in again");
    }
    else if (/USER_DISABLED/.test(err)) toast("Account disabled");
    else if (/TOO_MANY/.test(err)) toast("Too many tries - try later");
    else if (err === "NETWORK") toast("No connection to Firebase");
    else toast("Login failed: " + err);
    return false;
  }
  var dev = fbDeviceCheck();
  if (dev !== "OK") {
    fbDrop();
    toast(dev === "OTHER" ? "This account is locked to another device" : "Can't verify device - check connection");
    return false;
  }
  if (FB.requireKey && !acctAdmin && !ki) {       // no key typed: fine for a registered account whose licence is still running
    if (!(acctExp && nowMs() < acctExp)) {        // no licence yet / expired -> a key is needed (the key box appears)
      fbDrop(); needKeyBox = true;
      ui.run(function () { try { if (lw) lw.ikey.setVisibility(0); } catch (e) {} });
      toast(acctExp ? "Account expired - enter a NEW key, then LOGIN" : "This account has no access key yet - enter one, then LOGIN");
      return false;
    }
  }
  if (FB.requireKey && !acctAdmin && ki) {        // a key was typed: check it / redeem it (renews the account)
    var mineShared = ki.multi && ki.list.split(",").indexOf(fbAuth.uid) >= 0;
    if (ki.multi ? mineShared : !!ki.usedBy) {    // used key: must be one of THIS account's keys
      if (!ki.multi && ki.usedBy !== fbAuth.uid) { fbDrop(); toast("This key belongs to another account"); return false; }
    } else {                                      // fresh key: redeem it (renews / extends the account)
      var rr = fbRedeemKey(keyIn);
      if (rr.err) { fbDrop(); toast(keyMsg(rr.err)); return false; }
      toast("New key added");
    }
  }
  if (!acctAdmin && acctExp && nowMs() >= acctExp) {
    fbDrop();
    toast("Account expired - enter a NEW key, then LOGIN");
    return false;
  }
  badTries = 0; currentUser = name;
  saveLogin(name, pw, keyIn, acctAdmin);
  try { fbCommit([fsDoc("users/" + fbAuth.uid, { name: name, email: email }, ["lastLogin"])]); } catch (e) {}
  startSession();
  ui.run(function () { closeLogin(); buildPanel(); refreshButtons(); });
  try {                                    // an auto-update restarted us while the bot was running: start it again
    var rr = store.get("resume_run", 0);
    if (rr) {
      store.remove("resume_run");
      if (Date.now() - rr < 180000) {
        threads.start(function () { sleep(2500); toast("Updated to v" + APP_VERSION + " - resuming"); startBot(false); });
      }
    }
    var rr2 = store.get("resume_resp", 0);
    if (rr2) {
      store.remove("resume_resp");
      if (Date.now() - rr2 < 180000) {
        threads.start(function () { sleep(3500); toast("Updated to v" + APP_VERSION + " - respawn back on"); startRespawn(); });
      }
    }
  } catch (e5) {}
  if (!silent) toast("Welcome, " + name);
  return true;
}

// ----- session: expiry / device lock / owner kick re-checked, and the update check -----
function kickOut(msg) {                 // expired / wrong device while running: stop everything and show the login again
  toast(msg);
  try { stopBot(); } catch (e) {}
  try { stopRespawn(); } catch (e) {}
  var who = currentUser;
  try { fbSignOut(who); } catch (e) {}
  currentUser = "";
  ui.run(function () { closeOwner(); closePanel(); showLogin(); });
}
function startSession() {
  if (sessThread) { try { sessThread.interrupt(); } catch (e) {} }
  sessThread = threads.start(function () {
    var n = 0;
    while (fbAuth) {
      try {
        if (n % 4 === 0) checkUpdate();             // right after login, then about every 6 minutes
        n++;
        var a = fbPullAccount();
        if (a) {
          acctExp = a.exp; acctAdmin = a.admin;
          if (!a.admin && a.cmd === "kick") {
            try { fbCommit([fsDoc("users/" + fbAuth.uid, { cmd: "" })]); } catch (e1) {}
            kickOut("Logged out by the owner"); return;
          }
        }
        if (!acctAdmin && acctExp && nowMs() >= acctExp) { needKeyBox = true; kickOut("Account expired - enter a new key to log in"); return; }
      } catch (e) {}
      for (var w8 = 0; w8 < FB.checkEvery && fbAuth; w8 += 1000) sleep(1000);
    }
  });
}
function doLogout() {
  var who = currentUser;
  try { stopBot(); } catch (e) {}
  try { stopRespawn(); } catch (e) {}
  if (!acctAdmin) forgetLogin();          // a user who logs out on purpose is not signed in again at the next start
  threads.start(function () { fbSignOut(who); });
  currentUser = "";
  closeOwner(); closePanel(); showLogin();
}
function closePanel() { closeDG(); try { if (fw) fw.close(); } catch (e) {} fw = null; }

// ----- clipboard (a floating window has no normal paste bubble: every owner field has a PASTE button) -----
function getClipText() {
  var t = "";
  try { t = String(getClip() || ""); } catch (e) {}
  if (!t) {
    try {
      var cm = context.getSystemService(android.content.Context.CLIPBOARD_SERVICE);
      var c = cm.getPrimaryClip();
      if (c && c.getItemCount() > 0) t = String(c.getItemAt(0).coerceToText(context) || "");
    } catch (e) {}
  }
  return String(t).replace(/[\r\n]+/g, "").trim();     // all these fields are one line
}

// ----- login window -----
function closeLogin() { try { if (lw) lw.close(); } catch (e) {} lw = null; }
function showLogin() {
  if (lw) return;
  lw = floaty.window(
    <vertical w="210" bg="#f01a1a24" padding="6">
      <text id="lwTitle" text="LOGIN (drag here)" textSize="12sp" textColor="#64a8ff" textStyle="bold" bg="#1a1a24" padding="5"/>
      <input id="iuser" hint="username" inputType="text" textColor="#f8fafc" textSize="13sp" padding="3"/>
      <input id="ipass" hint="password" inputType="textPassword" textColor="#f8fafc" textSize="13sp" padding="3"/>
      <input id="ikey" visibility="gone" hint="access key (expired account only)" inputType="text" textColor="#f8fafc" textSize="13sp" padding="3"/>
      <button id="btnLogin" text="LOGIN" textSize="11sp" h="34" padding="0" bg="#2e7d32" textColor="#ffffff" marginTop="3"/>
      <horizontal marginTop="2">
        <button id="btnForget" text="FORGET SAVED" textSize="9sp" w="0" layout_weight="1" h="30" padding="0" bg="#2d2d3a" textColor="#e2e8f0"/>
        <button id="btnLQuit" text="QUIT" textSize="9sp" w="0" layout_weight="1" h="30" padding="0" bg="#7a2a2a" textColor="#ffffff"/>
      </horizontal>
    </vertical>
  );
  lw.setPosition(10, 200);
  var w = lw;
  var c = loadLogin();
  if (c) { w.iuser.setText(c.u); w.ipass.setText(c.p); if (c.k) w.ikey.setText(c.k); }
  if (needKeyBox) w.ikey.setVisibility(0);
  var ox = 0, oy = 0, wx = 0, wy = 0;
  w.lwTitle.setOnTouchListener(function (v, e) {
    var act = e.getAction();
    if (act == 0) { ox = e.getRawX(); oy = e.getRawY(); wx = w.getX(); wy = w.getY(); }
    else if (act == 2) { w.setPosition(wx + (e.getRawX() - ox), wy + (e.getRawY() - oy)); }
    return true;
  });
  ["iuser", "ipass", "ikey"].forEach(function (id) {
    var v = w[id];
    v.on("touch_down", function () { w.requestFocus(); v.requestFocus(); });
    v.setOnEditorActionListener(new android.widget.TextView.OnEditorActionListener({
      onEditorAction: function (tv, action, ev) { try { w.disableFocus(); } catch (e) {} return false; }
    }));
  });
  w.btnLogin.click(function () {
    try { w.disableFocus(); } catch (e) {}
    var now = Date.now();
    if (now < lockUntil) { toast("Wait " + Math.ceil((lockUntil - now) / 1000) + "s"); return; }
    var name = String(w.iuser.getText()).trim().toLowerCase(), pw = String(w.ipass.getText()), key = String(w.ikey.getText()).trim();
    if (!name || !pw) { toast("Enter username and password"); return; }
    toast("Signing in...");
    threads.start(function () {
      var ok = false;
      try { ok = loginWith(name, pw, key, false); } catch (e) { toast("Login error: " + e); }
      if (!ok) ui.run(function () { try { if (lw) lw.ipass.setText(""); } catch (e) {} });
    });
  });
  w.btnForget.click(function () { forgetLogin(); w.iuser.setText(""); w.ipass.setText(""); w.ikey.setText(""); toast("Saved login removed"); });
  w.btnLQuit.click(function () { exit(); });
}

// =====================================================================================================
// ===== AUTO UPDATE (reads config/respawn, written by OWNER - PUBLISH below) =====
// =====================================================================================================
// A download is rejected (nothing changes) when the hash or the APP_VERSION inside the file does not match.
// It installs even while the respawn script is running: the bot is stopped just before the restart and starts itself again.
function checkUpdate(manual) {
  function say(m) { log("update: " + m); if (manual) toast(m); }
  if (updBusy) { if (manual) toast("Update check already running"); return; }
  if (!fbAuth) { if (manual) toast("Log in first"); return; }
  updBusy = true;
  try {
    if (Date.now() > fbAuth.exp && !fbRefresh()) { say("can't reach the server"); return; }
    var res = http.get("https://firestore.googleapis.com/v1/" + FS_DOC + "/" + REL_DOC, { headers: { "Authorization": "Bearer " + fbAuth.idToken } });
    if (res.statusCode !== 200) { say(res.statusCode === 404 ? "no update published yet" : "update check failed (HTTP " + res.statusCode + ")"); return; }
    var f = fbBody(res).fields || {};
    var ver = f.version ? parseInt(f.version.integerValue || f.version.stringValue, 10) : 0;
    var url = (f.url && f.url.stringValue) || "", want = ((f.sha256 && f.sha256.stringValue) || "").toLowerCase();
    if (!ver || !url || want.length !== 64) { say("no valid update published (v" + APP_VERSION + ")"); return; }
    if (ver <= APP_VERSION) { say("already up to date (v" + APP_VERSION + ")"); return; }
    log("update: downloading v" + ver + " (you have v" + APP_VERSION + ")");
    var dl = http.get(url);
    if (dl.statusCode !== 200) { say("download failed (HTTP " + dl.statusCode + ")"); return; }
    var bytes = dl.body.bytes();
    if (bytes.length < 5000 || sha256Hex(bytes) !== want) { say("file rejected (hash / size mismatch) - keeping v" + APP_VERSION); return; }
    var text = String(new java.lang.String(bytes, "UTF-8"));
    var m = /var APP_VERSION = (\d+);/.exec(text);
    if (!m || parseInt(m[1], 10) !== ver) { say("file rejected (APP_VERSION inside the file is not " + ver + ")"); return; }
    var path = String(engines.myEngine().source);
    if (!/\.js$/.test(path)) { say("can't find this script's own file (" + path + ")"); return; }
    var tmp = path + ".new", bak = path + ".v" + APP_VERSION + ".bak";   // every old version is kept: <script>.js.v1.bak ...
    try {
      files.writeBytes(tmp, bytes);
      var back = files.readBytes(tmp);
      if (!back || back.length !== bytes.length || sha256Hex(back) !== want) { files.remove(tmp); say("write check failed - keeping v" + APP_VERSION); return; }
      if (files.copy(path, bak) !== true || !files.exists(bak)) { files.remove(tmp); say("can't make a backup - update cancelled, keeping v" + APP_VERSION); return; }
      if (files.move(tmp, path) !== true) {
        files.writeBytes(path, bytes);
        try { files.remove(tmp); } catch (e2) {}
      }
    } catch (e) { try { files.remove(tmp); } catch (e3) {} say("install failed (" + e + ") - keeping v" + APP_VERSION); return; }
    var wasRunning = running || (worker && worker.isAlive());
    if (wasRunning) {                      // stop the bot cleanly, remember to start it again after the restart
      try { store.put("resume_run", Date.now()); } catch (e4) {}
      running = false;
      for (var w1 = 0; w1 < 50 && worker && worker.isAlive(); w1++) sleep(100);
    }
    if (respawnOn) {                       // the respawn watch comes back by itself too
      try { store.put("resume_resp", Date.now()); } catch (e4) {}
      respawnOn = false;
      for (var w2 = 0; w2 < 50 && rworker && rworker.isAlive(); w2++) sleep(100);
    }
    log("update: v" + ver + " installed - restarting");
    toast("Script updated to v" + ver + " - restarting");
    engines.execScriptFile(path, { delay: 2500 });
    sleep(300);
    exit();
  } catch (e) { say("update check error: " + e); }
  finally { updBusy = false; }
}

// =====================================================================================================
// ===== OWNER: PUBLISH A NEW VERSION TO GITHUB + FIRESTORE (owner account only) =====
// =====================================================================================================
// Uploads this script's file from the phone to a PUBLIC GitHub repo (commit-pinned raw link), checks the link serves the
// same bytes, then writes config/respawn (version / url / sha256) so every copy of this script updates itself.
function closeOwner() { closeFp(); try { if (ow) ow.close(); } catch (e) {} ow = null; }
function ghPublish(repo, branch, rpath, file, tok) {      // returns a message for the owner
  if (!fbAuth) return "Log in first";
  if (!acctAdmin) return "Owner only";
  var bytes;
  try {
    if (!files.exists(file)) return "File not found: " + file;
    bytes = files.readBytes(file);
  } catch (e) { return "Can't read the file: " + e; }
  if (bytes.length < 5000 || bytes.length > 900000) return "File size looks wrong (" + bytes.length + " bytes)";
  var text = String(new java.lang.String(bytes, "UTF-8"));
  var m = /var APP_VERSION = (\d+);/.exec(text);
  if (!m) return "No 'var APP_VERSION = n;' line in that file";
  var ver = parseInt(m[1], 10), cur = 0;
  try {
    if (Date.now() > fbAuth.exp && !fbRefresh()) return "Session expired - log in again";
    var cr = http.get("https://firestore.googleapis.com/v1/" + FS_DOC + "/" + REL_DOC, { headers: { "Authorization": "Bearer " + fbAuth.idToken } });
    if (cr.statusCode === 200) { var cf = fbBody(cr).fields || {}; cur = cf.version ? (parseInt(cf.version.integerValue || cf.version.stringValue, 10) || 0) : 0; }
    else if (cr.statusCode !== 404) return "Can't read " + REL_DOC + " (HTTP " + cr.statusCode + ")";
  } catch (e) { return "No connection to Firebase"; }
  if (ver <= cur) return "That file is v" + ver + " but v" + cur + " is already published - raise APP_VERSION first";
  var hash = sha256Hex(bytes);
  var api = "https://api.github.com/repos/" + repo + "/contents/" + rpath;
  var H = { "Authorization": "Bearer " + tok, "Accept": "application/vnd.github+json", "User-Agent": "cabal-publisher", "X-GitHub-Api-Version": "2022-11-28" };
  var oldSha = null, p;
  try {
    var g = http.get(api + "?ref=" + encodeURIComponent(branch), { headers: H });
    if (g.statusCode === 200) oldSha = fbBody(g).sha || null;
    else if (g.statusCode === 401) return "GitHub rejected the token";
    else if (g.statusCode !== 404) return "GitHub check failed (HTTP " + g.statusCode + ") - repo / branch name right?";
    var body = { message: "Release v" + ver, content: String(android.util.Base64.encodeToString(bytes, 2)), branch: branch };
    if (oldSha) body.sha = oldSha;
    p = http.request(api, { method: "PUT", contentType: "application/json", headers: H, body: JSON.stringify(body) });
  } catch (e) { return "No connection to GitHub"; }
  if (p.statusCode !== 200 && p.statusCode !== 201) return "GitHub upload failed (HTTP " + p.statusCode + ") - token needs Contents: write on this repo";
  var pj = fbBody(p), csha = pj.commit && pj.commit.sha;
  if (!csha) return "GitHub answered without a commit id";
  var url = "https://raw.githubusercontent.com/" + repo + "/" + csha + "/" + rpath;     // pinned to the commit: no stale cache
  var ok = false;
  for (var t = 0; t < 4 && !ok; t++) {
    try { var dl = http.get(url); ok = dl.statusCode === 200 && sha256Hex(dl.body.bytes()) === hash; } catch (e) {}
    if (!ok) sleep(2500);
  }
  if (!ok) return "Uploaded, but the raw link can't be read back (repo must be PUBLIC). Users were NOT updated.";
  var r = fbCommit([fsDoc(REL_DOC, { version: { int: ver }, url: url, sha256: hash }, ["updatedAt"])]);
  if (!r || r.statusCode < 200 || r.statusCode >= 300) return "On GitHub, but writing " + REL_DOC + " failed" + (r ? " (HTTP " + r.statusCode + ")" : "") + " - are the admin rules set?";
  return "Published v" + ver + " - copies update within ~6 min";
}
// ----- file picker (UPLOAD button: fills "File on this phone") -----
var fpw = null, fpDir = "/sdcard";
function closeFp() { try { if (fpw) fpw.close(); } catch (e) {} fpw = null; }
function fpRender() {
  if (!fpw) return;
  var box = fpw.fpItems, d = context.getResources().getDisplayMetrics().density, Color = android.graphics.Color;
  function add(label, color, fn) {
    var tv = new android.widget.TextView(context);
    tv.setText(label); tv.setTextColor(Color.parseColor(color)); tv.setTextSize(12);
    tv.setPadding(Math.round(8 * d), Math.round(9 * d), Math.round(8 * d), Math.round(9 * d));
    tv.setOnClickListener(fn);
    box.addView(tv);
  }
  box.removeAllViews();
  try { fpw.fpPath.setText(fpDir); } catch (e) {}
  var names = [], dirs = [], js = [];
  try { names = files.listDir(fpDir) || []; } catch (e) {}
  var base = (fpDir === "/" ? "" : fpDir) + "/";
  for (var i = 0; i < names.length; i++) {
    var n = String(names[i]), full = base + n;
    try {
      if (files.isDir(full)) dirs.push(n);
      else if (/\.js$/i.test(n)) { var jf = new java.io.File(full); js.push({ n: n, full: full, kb: Math.round(jf.length() / 1024), t: jf.lastModified() }); }
    } catch (e) {}
  }
  dirs.sort(function (a, b) { return a.toLowerCase() < b.toLowerCase() ? -1 : 1; });
  js.sort(function (a, b) { return b.t - a.t; });                      // newest file first
  if (fpDir !== "/") add("\u2191  .. (up)", "#6ea8ff", function () {
    var pf = null; try { pf = new java.io.File(fpDir).getParent(); } catch (e) {}
    fpDir = pf ? String(pf) : "/"; fpRender();
  });
  dirs.forEach(function (n) { add("\u25B8 " + n, "#e0b84a", function () { fpDir = base + n; fpRender(); }); });
  js.forEach(function (f) {
    add(f.n + "   " + f.kb + " KB   " + new Date(f.t).toLocaleDateString(), "#ffffff", function () {
      try { if (ow) ow.ghfile.setText(f.full); } catch (e) {}
      toast("Selected: " + f.n);
      closeFp();
    });
  });
  if (!dirs.length && !js.length) add("no folders or .js files here (or storage access is off)", "#6f778a", function () {});
}
function openFp() {
  fpw = floaty.window(
    <vertical w="300" bg="#F2111722" padding="4">
      <horizontal gravity="center_vertical">
        <text id="fpHdr" text="PICK SCRIPT FILE (drag here)" textColor="#6ea8ff" textSize="12sp" textStyle="bold" layout_weight="1" padding="6"/>
        <text id="fpClose" text="X" textColor="#ffffff" textSize="16sp" textStyle="bold" padding="8"/>
      </horizontal>
      <text id="fpPath" text="" textColor="#8b93a7" textSize="10sp" padding="4"/>
      <ScrollView h="280" bg="#0b0e13" marginTop="2"><vertical id="fpItems"/></ScrollView>
      <text text="tap a .js file to select it (newest first)" textColor="#6f778a" textSize="9sp" padding="4"/>
    </vertical>
  );
  fpw.setPosition(40, 120);
  try { fpw.disableFocus(); } catch (e) {}
  var fx0 = 0, fy0 = 0, fwx = 0, fwy = 0;
  fpw.fpHdr.setOnTouchListener(function (view, event) {
    switch (event.getAction()) {
      case 0: fx0 = event.getRawX(); fy0 = event.getRawY(); fwx = fpw.getX(); fwy = fpw.getY(); return true;
      case 2: fpw.setPosition(fwx + (event.getRawX() - fx0), fwy + (event.getRawY() - fy0)); return true;
    }
    return true;
  });
  fpw.fpClose.on("click", closeFp);
  fpRender();
}
function openOwner() {
  if (!acctAdmin) { toast("Owner only - log in with the owner account first"); return; }
  if (ow) { closeOwner(); return; }
  ow = floaty.window(
    <vertical w="260" bg="#f01a1a24" padding="6">
      <text id="owHdr" text="OWNER - PUBLISH UPDATE (drag here)" textSize="11sp" textColor="#e0b84a" textStyle="bold" bg="#1a1a24" padding="5"/>
      <horizontal gravity="center_vertical">
        <input id="ghrepo" hint="Repo (owner/name)" inputType="text" textColor="#f8fafc" textSize="12sp" padding="3" w="0" layout_weight="1"/>
        <button id="pgRepo" text="PASTE" textSize="9sp" w="52" h="30" padding="0" bg="#2f5fb3" textColor="#ffffff"/>
      </horizontal>
      <horizontal gravity="center_vertical">
        <input id="ghbranch" hint="Branch" inputType="text" textColor="#f8fafc" textSize="12sp" padding="3" w="0" layout_weight="1"/>
        <button id="pgBranch" text="PASTE" textSize="9sp" w="52" h="30" padding="0" bg="#2f5fb3" textColor="#ffffff"/>
      </horizontal>
      <horizontal gravity="center_vertical">
        <input id="ghpath" hint="Path in repo (Respawn_2.js)" inputType="text" textColor="#f8fafc" textSize="12sp" padding="3" w="0" layout_weight="1"/>
        <button id="pgPath" text="PASTE" textSize="9sp" w="52" h="30" padding="0" bg="#2f5fb3" textColor="#ffffff"/>
      </horizontal>
      <horizontal gravity="center_vertical">
        <input id="ghfile" hint="File on this phone" inputType="text" textColor="#f8fafc" textSize="12sp" padding="3" w="0" layout_weight="1"/>
        <button id="pgFile" text="UPLOAD" textSize="9sp" w="52" h="30" padding="0" bg="#3a4a6b" textColor="#ffffff"/>
      </horizontal>
      <horizontal gravity="center_vertical">
        <input id="ghtok" hint="GitHub token (Contents: write)" inputType="textPassword" textColor="#f8fafc" textSize="12sp" padding="3" w="0" layout_weight="1"/>
        <button id="pgTok" text="PASTE" textSize="9sp" w="52" h="30" padding="0" bg="#2f5fb3" textColor="#ffffff"/>
      </horizontal>
      <Switch id="swAuto" text="Auto sign in (owner)" textSize="11sp" textColor="#e2e8f0" marginTop="2"/>
      <button id="btnGhSave" text="SAVE" textSize="10sp" h="32" padding="0" bg="#2f7d4a" textColor="#ffffff" marginTop="3"/>
      <button id="btnGhPub" text="PUBLISH TO GITHUB" textSize="10sp" h="34" padding="0" bg="#24292f" textColor="#ffffff" marginTop="3"/>
      <button id="btnGhRel" text="RELEASE LATEST PATCH" textSize="10sp" h="34" padding="0" bg="#7a5a1a" textColor="#ffffff" marginTop="2"/>
      <button id="btnOwClose" text="CLOSE" textSize="10sp" h="30" padding="0" bg="#2d2d3a" textColor="#e2e8f0" marginTop="2"/>
      <text id="ghOut" text="" textSize="10sp" textColor="#cfe3ff" padding="2"/>
    </vertical>
  );
  ow.setPosition(30, 120);
  var w = ow;
  try {
    var o = JSON.parse(store.get("gh_cfg", "{}"));
    w.ghrepo.setText(o.repo || ""); w.ghbranch.setText(o.branch || "main");
    w.ghpath.setText(o.path || "Respawn_2.js"); w.ghfile.setText(o.file || "/sdcard/Respawn_2.js");
    w.ghtok.setText(o.tok ? credDec(o.tok) : "");
  } catch (e) {}
  w.swAuto.setChecked(!!store.get("auto_login", true));
  w.swAuto.setOnCheckedChangeListener(new android.widget.CompoundButton.OnCheckedChangeListener({
    onCheckedChanged: function (b, on) { try { store.put("auto_login", !!on); } catch (e) {} }
  }));
  var ox = 0, oy = 0, wx = 0, wy = 0;
  w.owHdr.setOnTouchListener(function (v, e) {
    var act = e.getAction();
    if (act == 0) { ox = e.getRawX(); oy = e.getRawY(); wx = w.getX(); wy = w.getY(); }
    else if (act == 2) { w.setPosition(wx + (e.getRawX() - ox), wy + (e.getRawY() - oy)); }
    return true;
  });
  ["ghrepo", "ghbranch", "ghpath", "ghfile", "ghtok"].forEach(function (id) {
    var v = w[id];
    v.on("touch_down", function () { w.requestFocus(); v.requestFocus(); });
    v.setOnEditorActionListener(new android.widget.TextView.OnEditorActionListener({
      onEditorAction: function (tv, action, ev) { try { w.disableFocus(); } catch (e) {} return false; }
    }));
  });
  function pasteInto(id) {                  // take focus for a moment (Android only lets a focused window read the clipboard), paste, release
    try { w.requestFocus(); } catch (e) {}
    setTimeout(function () {
      var t = getClipText();
      try { w.disableFocus(); } catch (e) {}
      if (!t) { toast("Clipboard is empty"); return; }
      ui.run(function () { try { w[id].setText(t); w[id].setSelection(w[id].getText().length()); toast("Pasted"); } catch (e) {} });
    }, 200);
  }
  w.pgRepo.click(function () { pasteInto("ghrepo"); });
  w.pgBranch.click(function () { pasteInto("ghbranch"); });
  w.pgPath.click(function () { pasteInto("ghpath"); });
  w.pgFile.click(function () {              // UPLOAD = pick the script file from this phone
    try { w.disableFocus(); } catch (e) {}
    if (fpw) { closeFp(); return; }         // the button toggles the picker
    try { var pf = new java.io.File(String(w.ghfile.getText()).trim()).getParentFile(); if (pf && pf.isDirectory()) fpDir = String(pf.getAbsolutePath()); } catch (e) {}
    openFp();
  });
  w.pgTok.click(function () { pasteInto("ghtok"); });
  function out(msg) { toast(msg); ui.run(function () { try { if (ow) ow.ghOut.setText(msg); } catch (e) {} }); }
  w.btnGhSave.click(function () {           // SAVE: keep repo / branch / path / file / token for next time (no publish)
    try { w.disableFocus(); } catch (e) {}
    var repo = String(w.ghrepo.getText()).trim(), branch = String(w.ghbranch.getText()).trim() || "main",
        rpath = String(w.ghpath.getText()).trim().replace(/^\/+/, ""), file = String(w.ghfile.getText()).trim(),
        tok = String(w.ghtok.getText()).trim();
    if (repo && !/^[\w.-]+\/[\w.-]+$/.test(repo)) { toast("Repo must look like owner/name"); return; }
    if (!/^[\w.\/-]+$/.test(branch)) { toast("Branch name has odd characters"); return; }
    if (rpath && (!/^[\w.\/-]+\.js$/.test(rpath) || rpath.indexOf("..") >= 0)) { toast("Path in repo must be like Respawn_2.js"); return; }
    var old = {}; try { old = JSON.parse(store.get("gh_cfg", "{}")); } catch (e) {}
    var enc = tok ? credEnc(tok) : (old.tok || "");        // an empty token box keeps the token saved before
    try {
      store.put("gh_cfg", JSON.stringify({ repo: repo, branch: branch, path: rpath, file: file, tok: enc }));
      toast("Saved" + (tok ? "" : (enc ? " (token kept)" : " (no token yet)")));
    } catch (e) { toast("Save failed: " + e); }
  });
  w.btnGhPub.click(function () {
    try { w.disableFocus(); } catch (e) {}
    if (!acctAdmin) { toast("Owner only - log in with the owner account first"); return; }
    var repo = String(w.ghrepo.getText()).trim(), branch = String(w.ghbranch.getText()).trim() || "main",
        rpath = String(w.ghpath.getText()).trim().replace(/^\/+/, ""), file = String(w.ghfile.getText()).trim(),
        tok = String(w.ghtok.getText()).trim();
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) { toast("Repo must look like owner/name"); return; }
    if (!/^[\w.\/-]+$/.test(branch)) { toast("Branch name has odd characters"); return; }
    if (!/^[\w.\/-]+\.js$/.test(rpath) || rpath.indexOf("..") >= 0) { toast("Path in repo must be like Respawn_2.js"); return; }
    if (!file) { toast("Type the file path on this phone"); return; }
    if (tok.length < 20) { toast("Paste your GitHub token"); return; }
    try { store.put("gh_cfg", JSON.stringify({ repo: repo, branch: branch, path: rpath, file: file, tok: credEnc(tok) })); } catch (e) {}
    toast("Publishing...");
    threads.start(function () {
      var msg;
      try { msg = ghPublish(repo, branch, rpath, file, tok); } catch (e) { msg = "Publish error: " + e; }
      out(msg);
    });
  });
  var relArm = 0, relBusy = false;      // one-tap release: the first tap only arms it (a release reaches every copy)
  w.btnGhRel.click(function () {
    try { w.disableFocus(); } catch (e) {}
    if (!acctAdmin) { toast("Owner only"); return; }
    if (relBusy) { toast("Release already running"); return; }
    var o2 = {};
    try { o2 = JSON.parse(store.get("gh_cfg", "{}")); } catch (e) {}
    var tok = ""; try { tok = o2.tok ? credDec(o2.tok) : ""; } catch (e) {}
    if (!o2.repo || !o2.path || !o2.file || tok.length < 20) { toast("Fill the boxes and press PUBLISH TO GITHUB once first"); return; }
    if (Date.now() - relArm > 6000) { relArm = Date.now(); toast("Tap again within 6s to release " + o2.file.split("/").pop() + " to ALL copies"); return; }
    relArm = 0; relBusy = true;
    toast("Releasing...");
    threads.start(function () {
      var msg;
      try { msg = ghPublish(o2.repo, o2.branch || "main", o2.path, o2.file, tok); } catch (e) { msg = "Release error: " + e; }
      relBusy = false;
      out(msg);
    });
  });
  w.btnOwClose.click(function () { closeOwner(); });
}

// ===== GO =====
events.on("exit", function () {
  running = false; respawnOn = false;
  try { if (fw) fw.close(); } catch (e) {}
  try { if (lw) lw.close(); } catch (e) {}
  try { if (ow) ow.close(); } catch (e) {}
  try { if (dw) dw.close(); } catch (e) {}
});
try {                                    // ask for "draw over other apps" once, before any window is built
  if (!floaty.checkPermission()) {
    toast("Allow 'draw over other apps'");
    floaty.requestPermission();
    while (!floaty.checkPermission()) sleep(500);
  }
} catch (e) {}
// AUTO SIGN-IN: a saved login signs in silently, owner account too (ON by default; the "Auto sign in (owner)" switch in the OWNER window turns it off).
// Anything else (no saved login / it failed / expired key) shows the login window.
var autoSaved = loadLogin();
if (autoSaved && (autoSaved.a ? !!store.get("auto_login", true) : true)) {
  toast("Signing in...");
  threads.start(function () {
    var ok = false;
    try { ok = loginWith(autoSaved.u, autoSaved.p, autoSaved.k, true); } catch (e) { log("auto sign-in err: " + e); }
    if (!ok) ui.run(function () { showLogin(); });
  });
} else {
  showLogin();
}
setInterval(function () {}, 1000);   // keep the script alive
