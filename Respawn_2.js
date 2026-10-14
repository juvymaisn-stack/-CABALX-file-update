"auto";
// Cabal auto-respawn + return to spot - Redfinger (AutoX.js) - with interface
// Small floating panel (drag it by the top bar):
//   run/stop | status | collapse
//   X / Y inputs + TEST. Tap an input to type, press the keyboard Done to release focus.

// ===== VERSION =====
var APP_VERSION = 4;          // bump this on every release you publish (whole number)

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
var IDS = ["inX", "inY", "inDX", "inDY", "inCheck", "inWait"];

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
  loadCfgToUi();
}
function releaseFocus() { try { fw.disableFocus(); } catch (e) {} }

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
        <text id="st" text="Idle" textSize="12sp" textColor="#94a3b8" w="0" layout_weight="1" gravity="center" maxLines="1"/>
        <text id="btnMin" text="&#9650;" textSize="13sp" textColor="#e2e8f0" bg="#2d2d3a" w="32" h="32" gravity="center"/>
      </horizontal>
      <vertical id="body" padding="6 1">
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
          <button id="btnLogout" text="LOGOUT" textSize="9sp" w="0" layout_weight="1" h="32" padding="0" bg="#2d2d3a" textColor="#e2e8f0"/>
          <button id="btnUpd" text="UPDATE" textSize="9sp" w="0" layout_weight="1" h="32" padding="0" bg="#2d2d3a" textColor="#e2e8f0"/>
          <button id="btnOwner" text="OWNER" textSize="9sp" w="0" layout_weight="1" h="32" padding="0" bg="#8a5a1a" textColor="#ffffff" visibility="gone"/>
        </horizontal>
        <text text="LOG" textSize="10sp" textColor="#64a8ff" textStyle="bold" marginTop="3"/>
        <text id="lg" text="" textSize="9sp" textColor="#9ca3af" bg="#0b0b14" padding="4" minHeight="50" maxLines="4" ellipsize="end"/>
      </vertical>
    </vertical>
  );
  fw.setPosition(10, 200);
  loadCfgToUi();

  // drag by the top bar
  var ox = 0, oy = 0, wx = 0, wy = 0;
  fw.hdr.setOnTouchListener(function (v, e) {
    var act = e.getAction();
    if (act == 0) { ox = e.getRawX(); oy = e.getRawY(); wx = fw.getX(); wy = fw.getY(); }
    else if (act == 2) { fw.setPosition(wx + (e.getRawX() - ox), wy + (e.getRawY() - oy)); }
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
  fw.btnTest.click(function () { releaseFocus(); startBot(true); });
  fw.btnSave.click(function () { releaseFocus(); readCfgFromUi(); toast("Saved"); });
  fw.btnQuit.click(function () { running = false; exit(); });
  fw.btnSavePos.click(function () { releaseFocus(); autoSaveSpot(); });
  fw.btnLogout.click(function () { releaseFocus(); doLogout(); });
  fw.btnUpd.click(function () { releaseFocus(); toast("Checking for update (you have v" + APP_VERSION + ")..."); threads.start(function () { checkUpdate(true); }); });
  fw.btnOwner.click(function () { releaseFocus(); openOwner(); });
  if (acctAdmin) fw.btnOwner.setVisibility(0);
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
  nap(ENTER_WORLD_WAIT);
  return true;
}

// ===== LOG / STATUS =====
function log(msg) {
  console.log(msg);
  ui.run(function () { if (fw) fw.lg.setText(String(msg)); });
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
var hasRoot = false, capMode = "none", capReady = false;
var W = 0, H = 0, LAND = true;
var METHODS = [], method = 0;

function nap(ms) {            // sleep that can be interrupted by STOP
  var end = Date.now() + ms;
  while (Date.now() < end) {
    if (!running) throw "STOP";
    sleep(Math.max(1, Math.min(100, end - Date.now())));
  }
  if (!running) throw "STOP";
}

function refreshButtons() {
  ui.run(function () {
    if (!fw) return;
    fw.btnRun.setText(running ? "\u25A0" : "\u25B6");
    fw.btnRun.setTextColor(colors.parseColor(running ? "#f87171" : "#4ade80"));
    fw.btnTest.setEnabled(!running);
  });
  if (!running) setStatus("Idle", "#94a3b8");
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

function botMain(testOnly) {
  if (CFG.SHOW_CONSOLE) console.show();
  log("== Respawn + Return (Redfinger) ==");
  setStatus("Starting...", "#fbbf24");
  try { auto.waitFor(); } catch (e) { log("auto.waitFor: " + e); }

  try { hasRoot = (shell("id", true).code === 0); } catch (e) { hasRoot = false; }
  log("root: " + hasRoot);
  setupCapture();
  buildMethods();

  setStatus("Opening Cabal", "#fbbf24");
  var pkg = openCabal();
  waitForApp(pkg, 40000);
  if (capMode !== "none") { tapToStart(); tapGameStart(); }

  if (testOnly) {
    if (capMode === "none") { log("no capture available - allow screen capture for AutoX.js"); return; }
    log("TEST: running return-to-spot once");
    grab();
    returnToSpot();
    return;
  }

  setStatus("Watching for death", "#4ade80");
  while (running) {
    try {
      if (capMode === "none") {
        log("no capture available - allow screen capture for AutoX.js");
        nap(3000);
      } else if (dialogVisible()) {
        respawn();
        if (running) setStatus("Watching for death", "#4ade80");
      }
    } catch (e) {
      if (String(e) === "STOP") break;
      log("loop err: " + e);
    }
    nap(CFG.CHECK_EVERY);
  }
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


// =====================================================================================================
// ===== ACCOUNT: LOGIN + AUTO SIGN-IN (Firebase - same accounts / keys / device lock as the main script) =====
// =====================================================================================================
// New accounts are created with REGISTER in the main script; here you log in with the same username / password / key.
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
function fbDeviceCheck() {              // "OK" (allowed / now bound), "OTHER" (locked to another device) or "NETWORK"
  var me = myDeviceId(), a = fbPullAccount();
  if (!a) return "NETWORK";
  acctExp = a.exp; acctAdmin = a.admin;
  if (a.admin) return "OK";
  if (a.bound) return a.bound === me ? "OK" : "OTHER";
  try {
    var r = fbCommit([fsDoc("users/" + fbAuth.uid, { deviceId: me }, [])]);
    return (r && r.statusCode < 300) ? "OK" : "NETWORK";
  } catch (e) { return "NETWORK"; }
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
  if (FB.requireKey && !acctAdmin) {              // owner (admin) accounts need no key
    if (!ki) { fbDrop(); toast("Enter your access key first"); return false; }
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
  if (!silent) toast("Welcome, " + name);
  return true;
}

// ----- session: expiry / device lock / owner kick re-checked, and the update check -----
function kickOut(msg) {                 // expired / wrong device while running: stop everything and show the login again
  toast(msg);
  try { stopBot(); } catch (e) {}
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
          if (!a.admin && a.bound && a.bound !== myDeviceId()) { kickOut("Account locked to another device"); return; }
          if (!a.admin && a.cmd === "kick") {
            try { fbCommit([fsDoc("users/" + fbAuth.uid, { cmd: "" })]); } catch (e1) {}
            kickOut("Logged out by the owner"); return;
          }
        }
        if (!acctAdmin && acctExp && nowMs() >= acctExp) { kickOut("Account expired - enter a new key to log in"); return; }
      } catch (e) {}
      for (var w8 = 0; w8 < FB.checkEvery && fbAuth; w8 += 1000) sleep(1000);
    }
  });
}
function doLogout() {
  var who = currentUser;
  try { stopBot(); } catch (e) {}
  if (!acctAdmin) forgetLogin();          // a user who logs out on purpose is not signed in again at the next start
  threads.start(function () { fbSignOut(who); });
  currentUser = "";
  closeOwner(); closePanel(); showLogin();
}
function closePanel() { try { if (fw) fw.close(); } catch (e) {} fw = null; }

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
      <input id="ikey" hint="access key" inputType="text" textColor="#f8fafc" textSize="13sp" padding="3"/>
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
// It never updates while the respawn script is running.
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
    if (running || (worker && worker.isAlive())) { say("v" + ver + " is ready - stop the script first, then press UPDATE"); return; }
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
  w.swAuto.setChecked(!!store.get("auto_login", false));
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
  running = false;
  try { if (fw) fw.close(); } catch (e) {}
  try { if (lw) lw.close(); } catch (e) {}
  try { if (ow) ow.close(); } catch (e) {}
});
try {                                    // ask for "draw over other apps" once, before any window is built
  if (!floaty.checkPermission()) {
    toast("Allow 'draw over other apps'");
    floaty.requestPermission();
    while (!floaty.checkPermission()) sleep(500);
  }
} catch (e) {}
// AUTO SIGN-IN: a saved login signs in silently; the owner account only with "Auto sign in (owner)" (OWNER window).
// Anything else (no saved login / it failed / expired key) shows the login window.
var autoSaved = loadLogin();
if (autoSaved && (autoSaved.a ? !!store.get("auto_login", false) : true)) {
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
