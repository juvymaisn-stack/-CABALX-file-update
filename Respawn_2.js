"auto";
// Cabal auto-respawn + return to spot - Redfinger (AutoX.js) - with interface
// Small floating panel (drag it by the top bar):
//   run/stop | status | collapse
//   X / Y inputs + TEST. Tap an input to type, press the keyboard Done to release focus.

// ===== VERSION =====
var APP_VERSION = 21;          // bump this on every release you publish (whole number)

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
var P_TAP_SCREEN = [Math.round(GW / 2), Math.round(GH / 2)];   // "Please Tap the Screen": the screen centre (anywhere works)
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
    try { swSync = true; fw.swResp.setChecked(!!respawnOn); } catch (e) {} finally { swSync = false; }
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
        var hdrH = (w.hdr.getHeight() > 0 ? w.hdr.getHeight() : Math.round(40 * sc.d)) + (w.lg.getHeight() > 0 ? w.lg.getHeight() : Math.round(40 * sc.d));
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
        <text id="st" text="Idle" textSize="12sp" textColor="#94a3b8" w="0" layout_weight="1" gravity="center" maxLines="1"/>
        <text id="btnMin" text="&#9650;" textSize="13sp" textColor="#e2e8f0" bg="#2d2d3a" w="32" h="32" gravity="center"/>
      </horizontal>
      <text id="lg" text="" textSize="9sp" textColor="#9ca3af" bg="#0b0b14" padding="4" minHeight="34" maxLines="3" ellipsize="end"/>
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
        <Switch id="swResp" text="Respawn watch (ON/OFF)" textSize="11sp" textColor="#e2e8f0" marginTop="3"/>
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
          <button id="btnDg" text="DUNGEON" textSize="10sp" w="0" layout_weight="1" h="32" padding="0" bg="#4c1d95" textColor="#ffffff"/>
        </horizontal>
        <horizontal marginTop="2">
          <button id="btnLogout" text="LOGOUT" textSize="9sp" w="0" layout_weight="1" h="32" padding="0" bg="#2d2d3a" textColor="#e2e8f0"/>
          <button id="btnUpd" text="UPDATE" textSize="9sp" w="0" layout_weight="1" h="32" padding="0" bg="#2d2d3a" textColor="#e2e8f0"/>
          <button id="btnOwner" text="OWNER" textSize="9sp" w="0" layout_weight="1" h="32" padding="0" bg="#8a5a1a" textColor="#ffffff" visibility="gone"/>
        </horizontal>
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
  fw.swResp.setOnCheckedChangeListener(new android.widget.CompoundButton.OnCheckedChangeListener({
    onCheckedChanged: function (b, on) {
      if (swSync) return;
      releaseFocus();
      if (on) startRespawn(); else stopRespawn();
    }
  }));
  fw.btnTest.click(function () { releaseFocus(); startBot(true); });
  fw.btnSave.click(function () { releaseFocus(); readCfgFromUi(); toast("Saved"); });
  fw.btnQuit.click(function () { running = false; respawnOn = false; exit(); });
  fw.btnSavePos.click(function () { releaseFocus(); autoSaveSpot(); });
  fw.btnDg.click(function () { releaseFocus(); openDungeon(); });
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
// Templates are the image files /storage/emulated/0/脚本/btn/rf_tpl_tap.png and /storage/emulated/0/脚本/btn/rf_tpl_start.png.
var TPL = {
  tap:   { file: "/storage/emulated/0/脚本/btn/rf_tpl_tap.png",   cx: 1046, cy: 1000, hw: 300, hh: 40, img: null },  // "Please Tap the Screen" text area
  start: { file: "/storage/emulated/0/脚本/btn/rf_tpl_start.png", cx: 1796, cy: 1099, hw: 110, hh: 40, img: null }   // "Game start" button
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
// Login title screen = the bottom bar under "Please Tap the Screen": blue server name ("Eclipse Channel 43") + white "Change Server".
// Detected by colour (no template image needed); regions in game space.
var R_TITLE_SERVER = [753, 925, 953, 1000], R_TITLE_CHANGE = [1203, 925, 1343, 1000];
function titleVisible() {
  var img = grab();
  if (!img) return false;
  try {
    return fracIn(img, R_TITLE_SERVER, isBtnBlue, 3) >= 0.12 && fracIn(img, R_TITLE_CHANGE, isTitleWhite, 3) >= 0.10;
  } finally { img.recycle(); }
}
function tapToStart() {                  // whenever the login title screen shows, tap the screen centre until it is gone
  setStatus("Waiting: tap screen", "#fbbf24");
  if (findGameStartColor()) return true;   // already on the character select screen
  if (!waitUntil(function () { return titleVisible() || !!findGameStartColor(); }, 45000, "login title screen")) {
    log("title screen not recognised - tapping the centre anyway");
    for (var b = 0; b < 2; b++) { tapGame(P_TAP_SCREEN, "Tap the Screen (centre, blind)"); nap(1500); }
    return false;
  }
  if (!titleVisible()) return true;        // the character select screen came first
  setStatus("Tap the screen", "#fbbf24");
  for (var i = 0; i < 8; i++) {
    tapGame(P_TAP_SCREEN, "Please Tap the Screen (centre)");
    nap(1500);
    if (!titleVisible()) break;           // title gone = it worked
    log("title screen still visible, tapping the centre again");
  }
  nap(1000);
  return true;
}
// "Game start" button (character select, bottom right) = a royal-blue gradient button. Found by colour, no template image needed:
// scans R_GSTART (game space) for blue pixels and returns the screen-px centre of them when the button fills enough of the box.
var R_GSTART = [1818, 1030, 2319, 1170];
function isGsBlue(r, g, b) { return b >= 120 && g > r && (b - r) >= 50 && (b - g) >= 30 && r <= 130; }
function findGameStartColor() {
  var img = grab();
  if (!img) return null;
  try {
    var p1 = toScreen([R_GSTART[0], R_GSTART[1]]), p2 = toScreen([R_GSTART[2], R_GSTART[3]]);
    var x0 = Math.max(0, Math.min(p1[0], p2[0])), x1 = Math.min(img.getWidth() - 1, Math.max(p1[0], p2[0]));
    var y0 = Math.max(0, Math.min(p1[1], p2[1])), y1 = Math.min(img.getHeight() - 1, Math.max(p1[1], p2[1]));
    var n = 0, t = 0, sx = 0, sy = 0;
    for (var y = y0; y <= y1; y += 4) {
      for (var x = x0; x <= x1; x += 4) {
        t++;
        var c = images.pixel(img, x, y);
        if (isGsBlue(colors.red(c), colors.green(c), colors.blue(c))) { n++; sx += x; sy += y; }
      }
    }
    return (t && n / t >= 0.2) ? [Math.round(sx / n), Math.round(sy / n)] : null;
  } finally { img.recycle(); }
}
function gameStartPos() { return findGameStartColor() || findTpl("start"); }   // colour first; the saved template is only a fallback
function tapGameStart() {                // whenever the Game start button shows, tap it until it is gone
  setStatus("Waiting: Game start", "#fbbf24");
  var pos = null;
  if (!waitUntil(function () {
    pos = gameStartPos();
    if (pos) return true;
    if (titleVisible()) { tapGame(P_TAP_SCREEN, "Please Tap the Screen (centre)"); nap(1200); }   // title shows again -> tap the centre
    return false;
  }, 45000, "Game start button")) return false;
  setStatus("Game start", "#fbbf24");
  for (var i = 0; i < 5; i++) {
    tapPx(pos, "Game start");
    nap(2500);
    pos = gameStartPos();
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
// Whenever the "Enter Sub-Password" dialog is on screen, type the sub-password saved in the panel (digits are read from the shuffled keypad).
// Tries at most once per 20 s and never again after a failure (pinBlocked), so a wrong PIN is not spammed.
var lastPinTry = 0, PIN_WATCH_WAIT = 25000;     // PIN_WATCH_WAIT = how long after Game start the dialog is waited for
function autoPin() {
  if (pinBlocked || !getSubPass()) return false;
  if (Date.now() - lastPinTry < 20000) return false;
  if (!pinShowing()) return false;
  lastPinTry = Date.now();
  setStatus("Sub-password", "#fbbf24");
  log("sub-password dialog appeared - typing the PIN");
  return pinOnce();
}
// Used after "Game start": watch for the dialog for up to PIN_WATCH_WAIT, type the PIN, then wait for the world to load.
function waitEnterWorld() {
  if (!getSubPass()) { nap(ENTER_WORLD_WAIT); return; }      // blank sub-password = skip
  setStatus("Waiting: sub-password", "#fbbf24");
  var end = Date.now() + Math.max(ENTER_WORLD_WAIT, PIN_WATCH_WAIT);
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

// ===== "Periodical Item Expired" popup -> tap OK =====
// The popup has ONE wide blue OK button (game space ~x 640-1350, y 887-967). Checked by colour, no template image needed.
// Never fires on the sub-password dialog (its blue Reset button is much narrower) or on the death dialog.
var R_EXP_OK = [680, 900, 1300, 955];   // inside the OK button
var P_EXP_OK = [1046, 927];             // centre of the OK button
var lastExpTap = 0;
function expiredShowing() {
  var img = grab();
  if (!img) return false;
  try { return fracIn(img, R_EXP_OK, isBtnBlue, 4) >= 0.8; } finally { img.recycle(); }
}
function autoExpired() {                // true = the popup was there and OK was tapped
  if (Date.now() - lastExpTap < 1000) return false;
  if (!expiredShowing()) return false;
  nap(250);                             // must still be there a moment later (no taps on transitions)
  if (!expiredShowing() || pinShowing() || dialogVisible()) return false;
  lastExpTap = Date.now();
  setStatus("Item expired: OK", "#fbbf24");
  log("Periodical Item Expired popup -> tap OK");
  tapGame(P_EXP_OK, "expired OK");
  nap(800);
  return true;
}

// ===== "Unlimited Warp" popup (600 gems / Cancel) -> tap Cancel, then tap the X beside GPS =====
// Checked by colour: blue "600" button on the left + slate-grey Cancel button on the right, both at the bottom of the dialog.
// Never matches the expired popup (one wide OK button lower down), the sub-password dialog or the death dialog (other positions).
var R_UW_BLUE = [700, 745, 1030, 795];    // inside the blue 600-gem button
var R_UW_CANCEL = [1085, 745, 1415, 795]; // inside the Cancel button
var P_UW_CANCEL = [1250, 771];            // centre of Cancel
var lastUwTap = 0;
function isSlateBtn(c) {
  var r = colors.red(c), g = colors.green(c), b = colors.blue(c);
  return r >= 70 && r <= 150 && g >= 80 && g <= 160 && b >= 100 && b <= 190 && (b - r) >= 10 && (b - r) < 70 && Math.abs(g - r) < 30;
}
function warpPopupShowing() {
  var img = grab();
  if (!img) return false;
  try { return fracIn(img, R_UW_BLUE, isBtnBlue, 4) >= 0.6 && fracIn(img, R_UW_CANCEL, isSlateBtn, 4) >= 0.45; } finally { img.recycle(); }
}
function autoWarpPopup() {               // true = the popup was there: Cancel tapped, then the GPS X tapped
  if (Date.now() - lastUwTap < 1000) return false;
  if (!warpPopupShowing()) return false;
  nap(250);                              // must still be there a moment later (no taps on transitions)
  if (!warpPopupShowing()) return false;
  lastUwTap = Date.now();
  setStatus("Unlimited Warp: Cancel", "#fbbf24");
  log("Unlimited Warp popup -> Cancel, then close GPS (X)");
  tapGame(P_UW_CANCEL, "warp popup Cancel");
  nap(700);
  tapGame(P_GPS_CLOSE, "close GPS (X)");
  nap(800);
  return true;
}

// ===== LOG / STATUS =====
// Every log line is also saved to a text file (timestamped). When it passes ~500 KB it is moved to cabal_log_old.txt and a new one starts.
var LOG_DIR = "/storage/emulated/0/脚本/logs/", LOG_FILE = LOG_DIR + "cabal_log.txt", LOG_MAX = 500 * 1024, logN = 0;
function saveLog(msg) {
  try {
    var d = new Date(), pad = function (n) { return (n < 10 ? "0" : "") + n; };
    var ts = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
    if (logN++ % 200 === 0) {
      files.ensureDir(LOG_DIR);
      if (files.exists(LOG_FILE) && new java.io.File(LOG_FILE).length() > LOG_MAX) { files.remove(LOG_DIR + "cabal_log_old.txt"); files.move(LOG_FILE, LOG_DIR + "cabal_log_old.txt"); }
    }
    files.append(LOG_FILE, ts + "  " + String(msg) + "\n");
  } catch (e) {}
}
function log(msg) {
  console.log(msg);
  saveLog(msg);
  ui.run(function () {
    if (fw) fw.lg.setText(String(msg));
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
var swSync = false;
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
    fw.btnRun.setTextColor(colors.parseColor(running ? "#f87171" : "#4ade80"));
    fw.btnTest.setEnabled(!running);
    try { swSync = true; fw.swResp.setChecked(!!respawnOn); } catch (e) {} finally { swSync = false; }
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
  nap(1500);
  autoWarpPopup();                       // the 600-gem popup showed up -> Cancel + close GPS
  nap(2500);

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
// ===== DUNGEON LIST + IMAGE TEMPLATES =====
// (Non-premium DG run logic removed. Kept: dungeon names/ids, template folders, template loading/finding.)
var DG_DIR = "/storage/emulated/0/脚本/btn/";
var DG_ICON_DIR = "/storage/emulated/0/脚本/dg_exact/";
// In front of a dungeon entrance? If the dungeon's icon is not on screen (Select Dungeon window closed), the screen centre (where the
// character stands) is tapped to open the window. Not done when dg_select.png (the "Select Dungeon" header, saved once in DG_DIR) is already visible.
var DG_CENTER = [Math.round(GW / 2), Math.round(GH / 2)];
var DG_OPEN_WAIT = 3500;                  // ms to wait for the window after the centre tap
// Dungeons (names/entry items from the bag tab VII tooltips).
var DG_NAMES = [
  ["ic_underworld",    "Illusion Castle Underworld"],        // Copy of the Illusive Apocalypse
  ["ic_underworld_ap", "Illusion Castle Underworld Apocrypha"],           // Illusive Apocalypse (Apocrypha)
  ["ic_radiant",       "Illusion Castle Radiant Hall"],      // Apocalypse of Other Dimension
  ["ic_radiant_ap",    "Illusion Castle Radiant Hall Apocrypha"],         // Apocalypse of Other Dimension (Apocrypha)
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
  ["tou_b1",           "Frozen Tower of Undead (B1F)"],        // Copy of Epaulet of Undead
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
var DG_LIST = [];
DG_NAMES.forEach(function (n) { DG_LIST.push({ id: n[0], name: n[1] }); });
// ===== DUNGEON ICONS + INFO (cropped from your inventory screenshots; embedded so the script can write them to the phone) =====
// Each icon is written to DG_ICON_DIR + <id>.png the first time the dungeon panel opens (an icon you already cropped yourself is never overwritten).
// DG_INFO = entry item name, level requirement, recommended combat power, DP and entrance, shown under each dungeon in both panels.
var DG_INFO = {
  "ic_underworld": {
   "name": "Illusion Castle Underworld",
   "item": "Copy of the Illusive Apocalypse",
   "cp": 0,
   "lv": "",
   "dp": "",
   "loc": "",
   "dur": 1
  },
  "ic_underworld_ap": {
   "name": "Illusion Castle Underworld Apocrypha",
   "item": "Illusive Apocalypse (Apocrypha)",
   "cp": 709000,
   "lv": "190+",
   "dp": "7",
   "loc": ""
  },
  "ic_radiant": {
   "name": "Illusion Castle Radiant Hall",
   "item": "Apocalypse of Other Dimension",
   "cp": 0,
   "lv": "",
   "dp": "",
   "loc": "",
   "dur": 1
  },
  "ic_radiant_ap": {
   "name": "Illusion Castle Radiant Hall Apocrypha",
   "item": "Apocalypse of Other Dimension (Apocrypha)",
   "cp": 713000,
   "lv": "190+",
   "dp": "7",
   "loc": ""
  },
  "volcanic": {
   "name": "Volcanic Citadel",
   "item": "Seal of the Darkness",
   "cp": 0,
   "lv": "",
   "dp": "",
   "loc": "",
   "dur": 1
  },
  "abandoned": {
   "name": "Abandoned City",
   "item": "Strange Liquid",
   "cp": 1105000,
   "lv": "180+",
   "dp": "12",
   "loc": "Arcane Trace (126,157)"
  },
  "catacomb": {
   "name": "Catacomb Frost (Awakened)",
   "item": "Frozen Clue (Awakened)",
   "cp": 382000,
   "lv": "150+",
   "dp": "5",
   "loc": ""
  },
  "purifier": {
   "name": "Purifier of the Forest",
   "item": "Mountain Radar",
   "cp": 1809000,
   "lv": "190+",
   "dp": "22",
   "loc": "Green Despair (21,248)"
  },
  "celestia": {
   "name": "Celestia",
   "item": "Dimensional Ship's Key",
   "cp": 1657000,
   "lv": "190+",
   "dp": "21",
   "loc": "Pontus Ferrum (92,128)"
  },
  "siena_b1": {
   "name": "Altar of Siena B1F",
   "item": "Siena's Crest B1F",
   "cp": 0,
   "lv": "",
   "dp": "",
   "loc": "",
   "dur": 1
  },
  "siena_b2": {
   "name": "Altar of Siena B2F",
   "item": "Siena's Crest B2F",
   "cp": 0,
   "lv": "",
   "dp": "",
   "loc": "",
   "dur": 1
  },
  "garden": {
   "name": "Garden of Dust",
   "item": "Contaminated cactus",
   "cp": 999000,
   "lv": "190+",
   "dp": "10",
   "loc": "Forgotten Ruins (234,78)"
  },
  "ruina_weak": {
   "name": "Weakened Ruina Station",
   "item": "Copy of Muster Card",
   "cp": 73000,
   "lv": "45-200",
   "dp": "",
   "loc": "4th gate in warp center (149,232)"
  },
  "ruina": {
   "name": "Ruina Station",
   "item": "Muster Card : Ruina Station",
   "cp": 0,
   "lv": "",
   "dp": "",
   "loc": "",
   "dur": 1
  },
  "tou_b1": {
   "name": "Frozen Tower of Undead (B1F)",
   "item": "Copy of Epaulet of Undead",
   "cp": 75000,
   "lv": "55-200",
   "dp": "",
   "loc": ""
  },
  "phantom": {
   "name": "Edge of Phantom",
   "item": "Broken Epaulet of Undead",
   "cp": 749000,
   "lv": "190+",
   "dp": "7",
   "loc": "Undead Ground (146,244)"
  },
  "forgotten_b1": {
   "name": "Forgotten Temple B1F",
   "item": "Muster Card : Forgotten Temple B1F",
   "cp": 0,
   "lv": "",
   "dp": "",
   "loc": "",
   "dur": 1
  },
  "forbidden": {
   "name": "Forbidden Island",
   "item": "Lost Island Compass",
   "cp": 0,
   "lv": "",
   "dp": "",
   "loc": "",
   "dur": 1
  },
  "tou_b3": {
   "name": "Tower of the Dead B3F",
   "item": "Epaulet of Undead B3F",
   "cp": 938000,
   "lv": "155+",
   "dp": "11",
   "loc": "Undead Ground (111,131)"
  },
  "tou_b3_p2": {
   "name": "Tower of the Dead B3F (Part2)",
   "item": "Epaulet of Undead B3F (Part2)",
   "cp": 673000,
   "lv": "160+",
   "dp": "7",
   "loc": ""
  },
  "panic": {
   "name": "Panic Cave",
   "item": "Explorer's Journal",
   "cp": 194000,
   "lv": "110+",
   "dp": "1-3",
   "loc": "Desert Scream (126,109)"
  },
  "panic_aw": {
   "name": "Panic Cave (Awakened)",
   "item": "Explorer's Journal (Awakened)",
   "cp": 382000,
   "lv": "150+",
   "dp": "5",
   "loc": "Desert Scream (126,109)"
  },
  "frozen_canyon": {
   "name": "Frozen Canyon",
   "item": "Lamp that illuminates the Soul",
   "cp": 964000,
   "lv": "190+",
   "dp": "",
   "loc": "Bloody Ice (219,184)"
  },
  "catacomb_n": {
   "name": "Catacomb Frost",
   "item": "Frozen Clue",
   "cp": 200000,
   "lv": "110+",
   "dp": "1-3",
   "loc": "Bloody Ice (219,184)"
  },
  "steamer": {
   "name": "Steamer Crazy",
   "item": "Defected Train Card",
   "cp": 193000,
   "lv": "110+",
   "dp": "1-3",
   "loc": "Port Ruina (40,175)"
  },
  "steamer_aw": {
   "name": "Steamer Crazy (Awakened)",
   "item": "Defected Train Card (Awakened)",
   "cp": 382000,
   "lv": "150+",
   "dp": "5",
   "loc": "Fort. Ruina (40,175)"
  },
  "hazard": {
   "name": "Hazardous Valley",
   "item": "Nearly-hatching Egg",
   "cp": 292000,
   "lv": "155+",
   "dp": "2-4",
   "loc": "Green Despair (21,248)"
  },
  "hazard_aw": {
   "name": "Hazardous Valley (Awakened)",
   "item": "Nearly Hatched Egg (Awakened)",
   "cp": 567000,
   "lv": "160+",
   "dp": "5",
   "loc": ""
  },
  "lava": {
   "name": "Lava Hellfire",
   "item": "Ever-heated Lava Stone",
   "cp": 200000,
   "lv": "110+",
   "dp": "1-3",
   "loc": "Port Lux (228,60)"
  },
  "lava_aw": {
   "name": "Lava Hellfire (Awakened)",
   "item": "Ever-Heated Lava Stone (Awakened)",
   "cp": 382000,
   "lv": "150+",
   "dp": "5",
   "loc": "Port Lux (228,60)"
  },
  "flame_nest": {
   "name": "Flame Nest",
   "item": "Broken Devil's Horn",
   "cp": 964000,
   "lv": "190+",
   "dp": "8",
   "loc": "Port Lux (229,62)"
  },
  "turminos": {
   "name": "Turminos Maquina",
   "item": "Broken Circuit Chip",
   "cp": 964000,
   "lv": "190+",
   "dp": "8",
   "loc": "Fort Luina (40,175)"
  },
  "ancient_tomb": {
   "name": "Ancient Tomb",
   "item": "Hidden Tomb Key",
   "cp": 964000,
   "lv": "190+",
   "dp": "8",
   "loc": "Desert Scream (126,109)"
  },
  "chaos1": {
   "name": "Chaos Arena Lv.1",
   "item": "Key of Chaos Lv. 1",
   "cp": 123000,
   "lv": "30-200",
   "dp": "1",
   "loc": "Bloody Ice (64,14)"
  },
  "chaos2": {
   "name": "Chaos Arena Lv.2",
   "item": "Key of Chaos Lv. 2",
   "cp": 193000,
   "lv": "65-200",
   "dp": "2",
   "loc": "Bloody Ice (64,14)"
  },
  "chaos3": {
   "name": "Chaos Arena Lv.3",
   "item": "Key of Chaos Lv. 3",
   "cp": 272000,
   "lv": "95-200",
   "dp": "3",
   "loc": "Bloody Ice (64,14)"
  },
  "chaos4": {
   "name": "Chaos Arena Lv.4",
   "item": "Key of Chaos Lv. 4",
   "cp": 353000,
   "lv": "125-200",
   "dp": "4",
   "loc": "Bloody Ice (64,14)"
  },
  "chaos5": {
   "name": "Chaos Arena Lv.5",
   "item": "Key of Chaos Lv. 5",
   "cp": 371000,
   "lv": "145-200",
   "dp": "5",
   "loc": "Bloody Ice (64,14)"
  },
  "chaos6": {
   "name": "Chaos Arena Lv.6",
   "item": "Key of Chaos Lv. 6",
   "cp": 431000,
   "lv": "165-200",
   "dp": "6",
   "loc": "Bloody Ice (64,14)"
  },
  "chaos7": {
   "name": "Chaos Arena Lv.7",
   "item": "Key of Chaos Lv. 7",
   "cp": 643000,
   "lv": "185-200",
   "dp": "7",
   "loc": "Bloody Ice (64,14)"
  }
};
var DG_ICON_B64 = {
  "ic_underworld": "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",
  "ic_underworld_ap": "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",
  "ic_radiant": "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",
  "ic_radiant_ap": "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",
  "volcanic": "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",
  "abandoned": "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",
  "catacomb": "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",
  "purifier": "iVBORw0KGgoAAAANSUhEUgAAAEAAAABQCAIAAAAm3eQSAAAf0klEQVR42rV7SZMkV3Keu7/3Yo/MrOqq6upCN4AG0Fg5AKkxkzRcTCbJZEajSOogXSgzXnQm+YckHXSRfoQO0kEiR8PBLMBggAEGS69VXUsukbG+xV2HyKyuXgByZFRYWVRUZlakv+fb55974O/+3j8DAEQcz+MBAIRy9XUAeP7imXd/o4NDIEUAEEIQYa01kQohVOuq67o0ybI8I9J93xdF+f7737tz581PPvnk448/rqrKGKO1FhFh1s+IcrmAUar/fwtQihApMDPzeIMQfNs2IYQ8z/O8DCE456Ioura3d/Pmy7PZ7JVXXqnr+u69e23ThhDGr9YoiAggG8EREAS2q/h7reH/aQGCQIAAwERIRCDQ9/0wWCTSWvV9D4Df++CD73//+4o0CJwcn6RJevv2befc8fFx13Uigoj66b3/u7f5H04JIsIAoLVWRIO13nsWBi/aRHlexlGklPrm7t3guCjzIkmtt/P54vTxab2utdFE5L3XRAiwsZkr9oNI8httP6L8JtIjCHgnKECIPvi+77z3ilQ5mbLwuqrKo6NXXn01ieMvv/jq9PSkLIo0Sep67UNQisavNkoTwGhAT0m/FY4QkWjz6WcuLv986oAnZwL8jkORAmHh4J3r267v+xCC0kpppbTJiuLwxtHR4Q0BXDeV8365XDrvi6I42N8rihIRgw+oSCMKoOBGA3RFenneSK6ayjNKQBFCcs5FSeQGa6LIWYeELGJiEwJ750gpRBQAhaIBOzvk5aRumhCC0aZp2xsvvcRBfPCHhzfefvfdR6ePP/nlJ0TkvCeQ09OTvu/ni0Xf9VqrKNbOefqOjXqh9N+mBABEIiIa44FSKo6iJE7SJAmOmUOSxEmSjhFDadP2XZLnQULbNXXTCMDO7o51FhAn0+krt2/HceydS6NYmAEkigwgMjMRGaOVUoioiPSlxgFha0cvDqPPbvnTZ5YAhCrSSAiBGISBfWBm8ey11iLg3KCUUqDqplFKidJ1XTMqIWSQcjJBxOBl79re4f5e06y7dVVmKXIgjoN3fde1bcchEJEIAAiMUWgj+1PSP4lIz/vxCxegjWYBz0wieVns7e3t7OzEcfzxzz9KktgFX1c1gxijmIP3QaVR1TarugIB0kobI4DCXBTljcNDYTk7OanX6zRNp+WkU92jk0d12w5DP36dCIsIEeltUMBnIgwRfUe8f34N1nnSKs0yRGSRb7755uNf/KKuawT4pz/4QaT1Y3mMgNbZel1ppYJAbx2Q8j4UWb472yUiJHzjzmu3bh61dROsjYgw+ERHle3tMLD3iKiVAgAvIoCkSCMSwhhI4e+0/u9YQFEUvbPO2rZtQwht27H3IqKIPv7oIzvY2XT6zjvvjO7hgj9bL5u2DSFkWTaZTkkRId566ebbd97KsqxerYsi90PUNHXrmuVyGXxARK00EYkwAAIwiFz6wCZufofoL8wJl2c7WA7BaK2VRgDvLABopQF4GAYUXK1WP/3xh5PJ5Natlw9uHP73//k/br308nq9VgB5nKUmPri+99rt1yZFsa4qa4fgA4MP4perVdPUAoBEKCIgIkKEzCgiml6Agr411z6duZ76vNEkzIoIAKx1q2ptjE6SBAD7vkuSJFJ63TbW2nVdf/izn5SznT/6wz88OT7+9JNPp0X59ltv/9Z77wDLqlrO53PbD9W6EmAQabuOgQGJAAVAmBFRa83MzKzuvPHmGP634ZE2wZHghUGTiDgEEFBaEZEwiwghCYc8TR+fPD442LtxdOOLzz9fLJdnZ6enp6d7e9cGOwhAHBsBtm5gFu/8N19/vVwsV4vF0fVDCNzU9bqqQFgb3Q9913UeeLlaLVcVgyjSITCAENGIghAxhKDhif08G4VeGDcBYMxHI5oBREWkSCHAuqryPJ/t7P713/zw/sP73rOOjYmiL775CoGiKNq7thcZA8JFUShS1apq142z9t439/q+K7L0+uH1JIvLotSRyfLcBbtYLDx7RcYOdkTR1lrvPSJprYlI3bnz1iYNbTMxogDImCle4NMiSqlxG8a9J0WExN6H4A8ODqpq9YtPP3HMrCEpciehr9deU1tXtR8Gdo0dUKsQPAePikgTAFd1tVwt26771WefVdU6SpKbt24eHd2MkpSULidlkRd919d1rUnFcQQCwqyUVm++8dYTC9pcwZPLF6XnMcIKb6QHAO/d2dnZtb29bhh+9OHfdt7duv1yYweVRJ3rgYMYBcghNjpLPMqqrparlQueURhEEOM4YpHgQ15k/dCfn589Pj2bLxbeu/2D/bfeejsyURxHwsIiY+RkZgFQb955+7kFENE2uj4HH7Z5RBBxdAPvfd/3iLB7sP/xJ7+4//gRRfrGK68cn586gCABIgOGDu7cefXtO9duXI+KvO5bL75umnpou6GzwQXhwCFOIhEEJBHomvbs7Oz4+GR+sVjMF8GH127fPjg4WK6Wi8VSKVJahxA0okLk5zwBvqVM214AjA4vIsF7H8JkZ+f47PTx8iKblGL0/dNjnaWoMdorkyyfzCY/+L3fn0wn9+7fOz8/T6a5rerju/f9YGvnhrq6WCzyOAEAjdporUkzBxZhHtq2e3x8Uk4mcRyXZamVjiKDQCBijNEjtgXgZ6Qf7eR5P0YEZkEiNWZE50IIiHg2n3/x1RfL9UonCWlYLi7KvVkcxwdHN9Ky2Lu+n12bNM49mJ8tVouj6wcuS1BjkaTz8/N20Zw/OrHroW9aDTqN4jzN0zRLoiiJUhJwHPq2+/yzz0gpH3yapNbafhjiJNGIdEX6EcPJiOa3IONqKpBNtYNEROPeCwAZ/ejhvUW99gKd7ZDtZH/Xg+zOpnuHBy74YRh+8qO/bdvu7jdfdXVXkJ5MyqPbL7/+yu3z45Ozh6cSwvpiUa1rsBIpvW6a1MRpnMym053pbDYpGKF3rr6Ye+92r13TmyAuerPT2zIJL7GQCAAisOBYLgAgoLBS0dD3qLTRsR1s1/eBZd03q7qJy4L7QVDQUGOdEL//8s0kjvr5+qvPf33v88/Ry7Qo4yD1l/f84bXZ3l4UJ5Od3bZq113b2wEAwCg7eISh79pa6XJSRFlsYtN0w6pe9l1PRCFIUeQCaO2gR2sHeKogVAAosClUNkU4IvCYO/I8J1JD3zdtk6QpKfXg/PF5Xb321p2Hj0+KSGNivFYHNw/iIgsS7t29e/LJp9D0IuSdRKSK/b2qrhv2u/fuHuztt97uHh6c+eCaxxiXcZwGOzgXirKcXtuZzCbDYAc7hBCQUECGYei6joWjKNLjxm6dGK6UAyhjTtgoBEbQwSG4YUCliUhHEQMMw2Al5Ae7+6+/OpfBBm/ytMii2Y0DMfTlr359cvoYhh60As8M3LXD3fv3Gu5gWt64dev6S0eDMGg1vbZ73rZGJ7NyNj89NQle29+fzXaiJLlYLLquYxEACIHruvbem0gVRaEvDR/hqQWMK5KtJ9PoIQJxkghzZ4cojuM0ffD4+Oz8vPa23Jmu28YxV4tFjHxjb6fu+nSaO2QAD7EGRixzMJEp0mpoIYshjSmN5nXVBTdfr/YmO5Pr++QwK4pquZjs7t64eYSK2q5r2taHsEX40ve9tTaKjDGR3oo7uoFcOu6mTAZ4UnOKKERrhzRNfdM67nSStEN3Ua1UGvdNd/+ru9ZbcJ4DZ3lOidk/unG2nMPpMczKo/2DN19/w7ZdmaXroQ9p2lqHcXRWrRrbDSKd90hGR2C9U8ZcPzzcvXatWa997b1nIgUgiGPoZma2zlpr9RbhCDyTBxBHpYxqIdimO5G+7X1wSVYMwZ3NL+arZaF2wmADok6jbLqr4ySO49nBtd29gxuv1tPD/cmkmBTF9f39uqr2dmfOSzPYofef//IzrbFzVkV6WS1pYMPC6MrJZG9vTys1DHZoe0AQZmYeEQwRMTOIOOeu+MBzJgSX3IRsazaBMs0vVgutjdb63oPj5WoV5SkqUl6AUXwgRX3b9n0fRO4/fLh34/p0d9bath/6L8+PmX3fU57kTW3Z+7ZvUzLWBQEkoCjStmqyLL5546U8zdumc4PzzgcOHBhG+CCjHghQiHBrQiDwbL0Fl6etUgQA58t5VddJnp+ent27d//wpaM333lnsa7u339UtW0AHpxzzIq0t/7Bg/sz2y6q5flycfuNV+MsEZK6a5MkD8HPzy+q5WptAwZBluv7B9wOq6af5sX1vQMMXC1X7Lwwswuk1YY9YB7LOiQwxqj33vneKB5doUgREZUOHIiIlAKRESc556uqss4hUdO1xXS6u79X1ZVlMVmW7+7Mrl9zBN3QVn23XC1PTo5v3bwZnEUW23WzvAy9i4Rs089PLr754svQ2WZVh7aX3r/96uuhG8DyK0c3I1LtuhEX3GCDc1prDgwIhKS1HgXMszRNU/0U33cV97OMQINFxiLHDkPXdc6HfrBN16k0SdKEGLIk6zmsq3UXXDEt92YzAW6HYVGfwtD97G9+rCPV9M0H/+iDX5/NAeGVV1797NNftcv64mwe2uH6zjXE6NrhzfViuTq/uL6zF5MJ1tuud8PAzksQUIIjlETw3qNAHMfamG0eALk0pK1PI7PXEI8cPGgSoCDMIC+9/PJ7771z9NJNRvjRz3/61z/8IWiVluVBOXHMaZbVfTvvnR5snmfZ3sGDr78CjdB3P16toeviw/17X9x1/dCs6tB7JcBRUS9Xaj1Up/Npku/t7EaoXDdwCDASJxoQFUpA2gQWrVWSJGmaKKX0lcpry2YBIIJCpQD8WLKQZg4mScrJ5PDwpbffefv27dfboa/b7vzs7Muvv7l4eEykkjQ1ylxPiuuvvysGjs/OHpw8unHtUDQFJWeLOSybgYxd9WWeh1ULgxUV1bBAy2fz41j0q2/cikD5rqvXazcMAiAiIiDsx1gjKIooSZKiKKIoEhH13rsfPElluKk1CVCjQkAGJq0ZpOlapdXB4fWDg32jo7pa37t/z2hzdHjU1s3y9CIJiIPtV3W7qnQIkzTLdFwkSVOt2XmNuizKDtRkZ+eP/tUfFmne1e0kn/jB9uumX7f9onrt1iu3X3410bpvu7ZpfQgiADg2i5DUJv5ro4u8KIpCKQrBv1ADiAAoAiJKERL1Q7eqKpYwOHd6fu6cy5JstaySNBFm13WxUkPXKiQTRyxQL1fNutaxme7uqL3Dumt1kS2bKpntCeD9T798fHry9u3XmeXz+hNSsVP22uHNm0dH6+Xy5tFRvVqjImIKLIKgtEIRFGHmkarRWl9GxRf4wCUMIiAmCBystc67ztl26GMTA2DXduK97221rvqmDSGk07wZunZokDCJY2993zSu60mbCHF3lmv0k50ZAHz+yy8E+IH7+vDo6IPvvb9TTn76fz7cKSZ5mu+Uk3VVrauqHwYA8MIiEBiFg0FCxCiK8iJPkmRT015Sixui60oDKIigAh+kt33f9yQYq0ixOrxx43D/+qOHj9ph4K6rlnNFIBKWdRcnWTbNhq5nHotS0UDE7EN49NWXRV7O1/ens53v33ln7frpjf2//dmHfdPdOjoix9ems65p+nUtgVfrynsfJYkRCcJE6BmYWRNlSTopyjiOQwiBGZG0UhhYxtUgjkaHQuQFQGtgds53i7qzQ0xRk6wp0DD4k9Oz07PTNFbHJw/Pz048WNIGSfVdD4CRie3QkyJEdtamWYyo7FA5z4uL0FTrgEgcXp1cm97aOTo6epg/IsR6qKtqHbwPDKTNppOJiCwawA12urezM5sYTcFbRNSkQgiaWcbgiYSj0wMICAQk5wbf267vAjOGYLthXVWIqq7rfnBN167W3ePzk7aryslUie7aTmsd6bhZ14SYZqmzDZE4O7RN85d/9Ze/+/v/LI7TH//4p//xP/3nk7sPCSXX8cnd+0PXh8Bt19uuF0AWQQAOQtuMBAJlkadxsrX+K6XLu++8jwhEhAij9OMnlNbD0NfVqm3WztoQ2HnfDcPHv/zFp7/67Kt736zb6varL//jH/yTW6/cKiY5A1jf/8Vf/cVytVytVkYrEXYuEKkg4U//9N/cevnl2Wzno5//zDl+77337n791WK5GKxb17XREQLYwTOI92HsGBESqc2eaq13d3byPIui6JI2H4OSeved7235Ermk7JCQFPVdU6/XfdcjA6KwiOMAiubV0sQ6LSKmsFjNT04fAkEgN5lmP/3Jh1W1+pf/4p8vFkthERYg+J3f+e0yKw4ObzRN9+DhiXV+sVh88P77x4+OATHPCxPFgx3WTS3MAkA07qAiRO+9IiqKfHdnJ46jS0Ltcg36SdOTBXAEeigIbbPuutYOg3DYpHEBVOBC//5vv3P7zduPz06qepnNkmxmAH0s6EO4drBz8Xjx67tf/Pl/+PP/9l/+q/e+qetyMlt3/WeffS4gIKSNOT09fXDfPXj0cDqdKaJ+6Nu2FRGtlAQRYQRBEAAI3kdJnOdFHEcjH3Up/Yh61G+9+8GGaQNGBEVKQIIP8/m871s/uLGaZxFBoAgxApOppDDlbpZNIi/d4FtlWJRNEt12bZpmilSRl199effiYh5FsTGmLCZt3xEpRKrrdnCu71pA2d87AMKmbruuVUoH75FImMdqhENAgKLIZzs7ZpwteHoBIkLbKmzTFRYA733X90PfO+uFEUEBAEsAYqXl8Obem++8nO+oVXu8ao8xHnYOkrgAk4pORSeiExp8f3x6/O///M+Obr4UAmd5UdX1H/z+H1jrFosFEiLB119/k0Zp03Tz+bztWkQSEFQEwgCCIhyYQ0iSpCynUaQvRd+WVRuDJ9jije0b7Jwb+t6HMfEBgAgQIimtokTdvLVf7kSe13Euu9fTfIpJKXHGk52k9zWgF3FA0rbNT3/+88Vi0fXDMLg//uM/eeXV1wBpsVg+On70ox/+qO+7NM+6vtVKIxEADG2/pZ0QiQCEkLIsLSe5VvpbZy7e/95vM/PYEhABIrJ2qNaVdS540aSBFAgIMhBfP9q78fIeGst6yEqVl2qyk17bL8tpJsxdbyEQCMU6JzGnx+fz8zmiOn38uKkb6wYEOj09+9XnvwKBoxuHy1XV1E3XdcwcQgAiASEkrZQIC8vObHb98CBLM+/spmHx3KGZR10oAQ7BWRu6ruUQCDUQBwEFqFCJBESJY5MkSkzQEEyMWR5f25vu7+8rMj//yaepiSuxCo1RBjw655AwiaK6Xv/4ww8/+vijvu8R0UQmTmNrnbPWex+YRWAD2wAJMYTAPihNxiilSCQIwguHMcZhDxABFiZCZmnbtqrWzIERgUgc2xCyNDEKVcSTaam0YhQUlsDOwmq19NbagV3PBhMDYHQcY1K1Q71csfUslERJCN5ZK8JambIsBaDr+r4fvPcs8qTFCECE3gcBSJI0zzOttIiMyO0yhV31Yz02jZgDADGHruustWmeRnGcZYUbeHGx8IE5eGTf1L1RRqJEZIgSUBqG1nWrebO2Q6fEmTQpUj3xHdXVvK5qDgzMeZ4PQz/ORxBhmqTOubpbO+fCxs820FIAhAUQk8RMJ5M8z4mI2RPCFZmf8PsiopkZkQDFOde2Xdd1URS99NLRH/3JvzbaPLh7/L//1w8f3n80WJfkxAEQolQbCDY4zz70vQNGsRF5YyhJkwlBslhW9WJtB6sQdaTLPA12aPpWaZNmpTHGWuucY+EruGBkkcF7b4wpy7KclFEUMYexqydXQueogfGsvfdxHLGEvu+bpnbOTSblrZs3v/zq8zTLhyGkaVaUk8hGQG45X7f1kBRZFE8H17hu8IMnjEioSHMM2lDSVsPifFWvagmB0HjvqnVlvU0ik0+miLhcLJq29T4IM1w2JrZGFMQlcVyWeZLEAGNHRrbS0tUcvMnEI1HR9X3TNM65LaHLZVlczOfnJ8vj44fL+RoVxSm5gR89OI3zl3aul0mcttAaxbFJXRdW87qt10O/bFfd6aOzrukUKAicJsb2gwTWSZymqXd+tVwSITNvR8PwKpFjtE6zLE0zROQw9p9AWABQrhyXqtBE6JxrmrrrOkRUSltr5/MlxfTgwYOu9spQUWY+sHP9fN67z3sTKZQjZaipAwBhrOpVf/JoXs1Xy0UzdEO3HhRppRVLCEFAYawjYQCAKIoBpLfuqcm2JyFGtDFJbIzRIMzsRz7Q80js4lUr2uS1f/dv/2xdVdW6CiEgjjOEoDWyBIExJ245OhEBLxiUwjiNy+mkzAtCHAbX971Suqmatu+D5+CCIqWUDswIQApBcHdvR6toPp9f8sxaa+e9MEfGBA4sITLm8PAwTeMkjgFROIgIAIsAM8rTStj4wFgChBCctUopHHE1w0inI214RRABYADiIM6Lt7avF0tdAwIHDiHEcdL1ffA+juI4S7z3znkiYhCjDCAGLyGMvjsOCkDwgRBVFImI9yGKVJ7neZqYKCJCFhYYM4Rsmi3ygrE7DYBKkbAM1hqtoyhCxMAswCOsvSStxztprUeOkpn7oR+7l0or5/xsOptNp8WkBJFHjx7N5wsTGTvYNEmRiIWH3jrnAIRZCJXzPjLaaD1YCyBpms6mszhJEEGAR/oWNlbA21z3rAlpEYmiKMuyfuidc4BotNkw0rRBSpdNPmb23m/rByQCBCRFRBREbt28+dbbbx8eHnrvPvr4o49+/nHTNkmSZHkWAjdNY4dhBAthDKAIY8uHQ4jjeDqdZnk2tjBE/FiXXQmg9EI0qllYG1NOSufsfGyERJ7U2I2nzS+iMViFsIF42zgAAsKOBSSOk8BhuVyEEFi4XjfMrJUuikIb0w+NdXakepDGrpsoRSzsBoeIZVmWZTnmVGYWBkQaJyfHVwCfkvuKBphRURzHWZ6v67ptG2tFKd2xM8ZEYxskisYZYTtYpdUVAAuENHJntrcAqLUZhuHi4uLx48dd1xFRlmUhcNu2zrqNSSAYo4MPilTgEITzJJuUk5FreDL8SIS4Wc6IJl6sAQEJ3pOiJIkmZckSRj5eRJxzIQRr7TAMRMQi3nvlNxMtWwKGx443alyv1ycnx30/PHz48GJ+YYyZFBPvvbV2GPoQAikap314Y9wCLJHWk2mR5Ylcvvhkn5EDjLia5Vs0gAiBA6DEcTzbmSFCVVXOeVIIAIE5WOucG9vaI9URx/HoyiEEufKV9+/ff/Tokdbae5+maZ7ncRxX6zUCjLsoAgg4NvcVbmqpKI6Lohjnfzalegij4432s2nFX1nXM3CaiUgAmDlNUnOgEeni4hyJnPcIoJ6u5RDReX95l3H2SESU0gICiIIgCMaYKI6V0TBA0zQ+eCJiYSRkRA5BafAhxHG8uzvLxkm7cfQIkEiLhM00DNFVw7mag7d5ADZE0PiLkOIkzrK86eqxNr20lnGHvPfMHEaFiCilxtjqgwAAAXoRBEziJEkSZnbOee8380nMCICEgBh8iOKoKIqRJ7xEFiDwjJVvzoICz/rAGEZhM4MJIMJElKYJwFQZGobBWhtCGH1rjEWjxOOg1iawhqCcEyCllDGanWitSdEIZjYcICER+eABUQEGEBbOsmw2m6VpiiNpA4LbXAuCW8FwDBcifIk4ns0DGx8HYWECiiJDRFme9X3f9/0wDH3fjxs/WuSo1sssMRrS+BwDhyAAPvimaUa9qsvxrst0CCAskTFZlmVZNg7sjGmKmcd9BnkWNl81nmfyQECRTYeAhWGc7SVEHHH5GIjGxbRtOwzDtlW4YeWVUkopFvA+BGAiCiFUVWWtS5LYGGOM8d5z4LHXOf5vURRpEhEBs2f2iIhCzEyCzxv6M69cPbYOupnfBuAAAEgYhAlRKaW1NsZkWeacs9au12vn3LiecVQlhEBKEW1upRSJwDAMIiLCSqlog3b8OCTIzHESlUVhtOHAPvgxkIzkmrzIU0drkueWAADqzht3EJ6M1Iyf23RVt6l3NBhjTGSiJE3SNI3jeJzAVoiAGEJAUjDuw9P9WhaJ4ggBmRkJgw9INJ1OJmU55kSWLXsDOEaSF2w/bs7wXF2mR6EZhJ60tDf453IIcORRRycYFZKmaVmW1tqu65qm6bpu6J3SmkNgZiQaaWTnnA8+zzJttPMeAFisAsjS3BgzThdeIQwFUISfxZvf7QYaYNQdMAripvoMIdB2InYT3AQQUSEBh7EQibQyKkvjZFpOgrCzYVWtqqpy1okI+4CExhhmbuo6TdLYmLppQGQ6mUyKAkWER4QLIOMQ51Oyy7b3vpF7G/dkmxSvRqEXPUAiCBu5N/p4mlXdBN8xsJJQXCYmMpPJ1Fnb9V1d113XOeuyPJvNZlrrpmmKLJ9MJ2VZXm7lt+3rCx33+TS8ceInkH/76qjWS7bj8t2RvbtEclcn6pRScRxFkUHMnSvSJFnXtbVDCKFpag7c9X1RFFmaaqWatk3j6O8TJf9eUeiZBVwa5eVKXsgoXR1oRERr7fhEmFLaGDOZTtI0DewHa9u6td5laVoUOYD4EOIoeobmv3q93b4XLOMFC3jh41GXt7iU/vLi6t2fNEQQBTeINwQ3vm8iFaGZTid1uh4GF8eRMREzix+MMSPYeWZfnrGT5xf5G2iAn974S1VcstvP7BBpuvInbJg2CV0XtI6MGbd8xJs8DIPeNkhfaPrPvPIdx7f6ABCOyX870LhlALex4imAACDeIyE+ofBH4M/ee601KTUGSq2UgAohhA1j9Zz+4UXGAyJbdHT1BwBHanHTILucbL9c0VUWcqOZLZ329EMpsiUHSYRl+6CjCMRx5HwIbtPp8SGMU7XPBvwXaeDp+PPi/KAFQTYNqY1hjCavr/DxzzvWM8X+OFp32RHZAisBAOfDFXVtZvOex/fPGPDzvsH8lB9fVj/0lPbgN3qc8B/suNr6fd6hX2hpl//yfwHqjadzT8CGkQAAAABJRU5ErkJggg==",
  "celestia": "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",
  "siena_b1": "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",
  "siena_b2": "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",
  "garden": "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",
  "ruina_weak": "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",
  "ruina": "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",
  "tou_b1": "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",
  "phantom": "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",
  "forgotten_b1": "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",
  "forbidden": "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",
  "tou_b3": "iVBORw0KGgoAAAANSUhEUgAAAEAAAABQCAIAAAAm3eQSAAAWHElEQVR42u17W3MkV3Lel3nOqaruRl8wAGZIDi+r1a5kibu2wrIf5FdH2D/aT/aD/KAnKbwOSaG9kLFL7gzmAqDR1VXnnMzPD9UNYIacJXcZYa9DrOgA0NXVVXm/fJmQpx//GN/iEBH8UR7xWxLK35N+4f8lBhT/nx/fM/D/3Af+aL3zexP6noHvGfhXEoXezrjku2qJ7zXwPQP/KnzgndXoHzcD/js1o29cwAcfib+j8r6Tgn+T5v3b0elfkaROT4kOO9TvBAQKeSBt5USxAPTj1/ShXkQIOEgApIiEiUMRJQgcLpiCm4iSAopCHxDl9/xSIQ4q4IcORKYLCTjEgeml4g0QJg0o4KAAPJIu00W4e3cnb+pXwu50d4IT86QAFJJmRlYNVBURuLuZh5Ae3PGhgPVepYefd1Kb3ij4UHVyrEYZAIXwoB0BwAM/cDmSzoMYKqACnYQEAZwQUCAinBigC5RgSlFDIKu7k64aYlQzgUz3h8AB50TunWgOZulCQu5aQQWUh2sEIGGTCuOBlYmgA3/2hgZQj5bnED1IZWKQThER0amD5F2+c7o7SaO7u1cREXESk94BJwiQMslFHjjbncsJOAUVBRVUQSBUqJDqPBhevOMJDMe/5YHB3SnMv8alBHJ4thwzOAkHEGJweqmVZEoppUTznEsI0/cnmz6qHXzrcQ/ENzmVQBQ8EEdARCddhdX69GHT/kYYvbcrJwRvG6/cVxiEw0lOcoWwlJra1HUdRKxWMwc0hnDgU/zr2n7ea2MiGiIHjU0kUuAQExjFDj6gkzigx1gwaZaH24nLgQmdxHvkdZKZTEI5XCAUhapSpW3Dcrlqm3YYxtvtrpRSnAqqyjGqTD9UDjHD73wDUAiUAohQIDx4oBiOdAvCRFI8iO9gGI6Jijs9HrxZgBYExI6XHZ+vwTnZvlBFg4QYJOinn/6kmpWxlsL3PwhW6osXl88vn0WIAqTK4f4KBMJFxgfO8NBKw9Ge+SafB81EAi4EKJOGHKpyCBsSSQERUyxZKRCpKTilkAWc4q775G0xLVcnbZdURGJ48eoqxrbf7/tt36R2sThZbh61XXezvRr6vlZTCeIRHpxBlY4gMMIAE7qoGyjievTpKUsRKn6XtjhpIIhM5ntwGkEjCEAM6IzqVcaqbdM4S/U+cxQUgjGKiOZcGGIKTWraMZd+HEUlpjA36Rah7U5mi3WQMI5jv9u5u0NchNRag0iKMgcbuoCVkiGuoYgW5wCMhAMVgkPwAYRBqFS5SxERMsleACUj0Jh1NSd6F9ImhYUhOC3vd5V9rnm5SqvNGjLSht1+tzndZGPJ7lAziykt1sumbVLsQowxNPP5SZPavr8NTQyCftfmsfS3w/aqWGlDWCoWXkMT58UG8951r+FWgkoQ0ew+QCBwQoRKBjCKA1IPeYBQuhJKNmQLn4WwbOOySZt5d0Gfj16Gcax+KbiezdLF+cmf/vi8nRkxXL54XnK5vh1evLg2iIb29Pzxex88SU3z/PJlHvMotZ1L6hadqNFJ++QHP6Tj1cv9s3g1bKNgGXhShraN64jKsDNcF75g7Whbah80QQwCEsIoCFPIFpVjLUQhZ8BceKJYqC4X3fsn8/fm84uAxc1V3o1Xw7ANLdpmLvHGyN3eGTw1slwvnz9/CdFqroK2m6d2ZtD+Zr/rc63unonbYXTS8jh4LSGqIEFjajd1iChL2lq56Ldt28wWc0Xcm78u9izbK/Mr2C10cI6QSqjIFDHszssjsAiyUj1L4VzlVLjqmos2XkRsrDKPu1xqEE0hxKbt5h19u99XQ69h0EgElahQydWTYZ9rfn613e1KrlAVxCHfXF6+ErEQEQKvbq6aOI84gW9UZ/vc+hDV2tnsgzLUV5e7djZbr5eLxfvD+OL1zWeCGwm9c+uyo2ZoBippd+EqCk8UZ4kftHhf9IKli/I46kbRFCvFBpHUNE2pDXOMqYmzmdnOqVevrhDKenlKxNS2dXAzG4esalYxFmoIbWpjUmNfs02JM2koZk5vQ0xpMWpTpYHMReJsPu9mi7EfLp8PIFL7qI1zyBZybXxW+RK8JivEgCJTeQeEk+UnwFKwUqzETmazJ2enH1ycvX+6vmi6Jo9l39+OeUyJzr1qbls/Wepq3eyHW/fqkFp9t8ukusRK5mqU1KWVWXB3EvTqXmJU1VBqtOK1giZexbLbqDQZ9xZDSlEBmoEeaA29WZ2cxTCHJ3gAIkREKsRFdAqj4WT1FIxBY9t0TTs/XZ2vlqvZbFG93G5v89gDJQaM/esYSgh74PbjTy7mJ00z01JyGev165uuWziDk003c1EyeFl4DQFC9UWLSC97a7t5KY2j0SDkWIcreN+lGIK7DR5uzXdAbRLaJnXdfDFfhThrmpMY16vVRyme5jFWHyEuh3QuYbW5ACASVYIIYoz7XX99fXN787rv9/shj4PVWtVNUChj9a3h5nb/bByvQaul3O76qG0MKaZUzCQGUm1UemlmKXUIkumFIgkhNHMiBDXxUssW1tPMPAMGH0MsTeOzJnWLtusWKbVunjNqifPZI6BJKcZQiu+AQcSmPDBAUImh1mJ9TKx5nocTlZOka/eOJqitYuPurH2B/eaLLxieN90+dUEs1VKqzqoTIbp7SnCUkBwIzaxZtE0dx6ZJsyQMiaoILia0CikGo7ym7BFvYa35LOe5dntYgVIxD00jMQlbQaJF1XmTNhwa0QARgGG1WUOMzM7ROLjnWge34lNB76ArPbRxFoJ6GAzbaq8pO/P9uN/WcRQonNvdThQIAmGx3M1C22J10sU2RqlJGQOapkkhSUAAyep5T8+iDskimTIQO/eh1n2p+2pGMDUxaGjbE9Vmt9sNw9Z9GPMrCbdT+RRWp2sRU60iGZJr2RlHsrgbHYQLqCIhtCEE6Fitp44xIkVVIZxCGXMGSkhpvVmUWk1yQCFKCIGl+Lin7atnYpRAegHNa7UykKNIIfYqGTqoDsTgPhIGQQxqXt3opjn7MJSc9y7ZeQt5LboHGNbrRyIUEEIRJyrg7tV9IC0lT9FDgBU3VoSaGmmalMex5hpDE0UAjmUE/Pzx+b/5y5+KhqDBWYdhb2Ptt9ux35rnEEsU7na7YtWL093yKHAJVVCAUaRAi2gVGKSqONVJG4uNua3VQ2ihBPJYXmh8JdoDElbrC1COdTk1QJWQQuSgI3QfwhY6ODwEzuZhs3n0wQd/EmRmJXiBBg0B1Uq28Sf/9q8+/elfvbraUpumm+e+KJUwlbI6aVerharQiBAikrmbFYGrKmlwg1SRKnCgOsxY3asEAXU2W23W52ePHqcmOPe5voI8E90dmnqKTqWGQMyrwCSUoNV8b/bSfBb0peoupsdpfr5cr3/8o0/fe3zxy1+d/ObL4IxmmqIXj0+e/HDWnl1fcSjhyXs/2N9KZA2aVYb1ctbNuuubm9W8qZbqaNwPNWd3ATM8hAhadlYRR4AK3MUpY5HlfHm6iaeb5cnJpt9Jun6NtHl9c+iEw2b9WKACJcIRLhIBRKpK0ZBFR8dQfGfcxYj1ZtV1XUqNiqpqiqlWV533+6DxnProH/7hN5TV6fl7Nze3FxeP27a9ePLefLkeaxyKnp597LEtJjc3vVWJMblV0Yg6tRcmnAhQiJCsLqenFyoLuJpZ1+H88ULj1YtXP4P0kw9cHLAUeYhXHZtuqaIGNQ2o3g/j9ra/ur296vvrUgZVjynGtOgHbHfhty/98iVHW11vpTtZG2lm3XJZlIvlxWz9NJfZxz/6SbUZmlk7OynmY84CSarVKkjARQQSACUE1BBi265LDmZUrblu9/m3ly/+adf/CjIADMvTDYH7JvgeJ5tAuCAIEEAqJTt3Q359u3++3T3fj6/H0tfqREfZpO6p89zk/MnH/25z+vTs/ElM3dXu9dNPfrAdQoknQ1zdlG7EIqNr18s0W2f3/nYn1XLOCqrYAd1DBAKpZHCKIAnS8mTWdnLbf/ny1T9fvvpH0RtIARiPXeZbQO6Edk1YnwAgc4xBW3f3Wve7fDWMc5XlYv7UfNV2F0EWszBntxKcffLJR81Zf3U7u33xxZdX8eVtaNG2cZWle/6sz0OvYk8vNt3pR+Hl9X4culknI8WNXoRyxAogYu51v38Z55vU7Mcy3uw+v7r+Za6XbZMFBBiWm83BZqYXRCAHBg4vAURFOAVZKaI1hBobaAwSoklCOvFmNnjqc9D1iYX05E8+DPPZDepnX77eSTr76Meb9/68vXj06PHHr273z6/79eP3nzz9sNTS37yEjYEQ1ClzwuUOxVGFmc+6k/ls9uLl51fXnxufdV0Fyl1PrEc0T0A5IGH3MPAdgKNicHcqQ2QIUdUhudhtN1u6bFdnT2RIHRZ/85/+/Rev+r/7+5/PHrWP3/80rs6Xj8/mp4/YJMV+s1j/8HRx8XJ7tpi/f9699/jsFwv/57/776GUAKGQJIVyACAEXlMKswX2w4vb/kvHdQwDkTlJloyOAIQDViMIB18+0n3wDSVFEFQCNAjFTUlCcmwz0rYyVFzqyaOz1fnTP0P+9Xw7/2jIZUQ42ayaxXKnuQQu18vL3XZ2dh7X57vnr794aR9tzh49/rA9Wfk4UAIPwWOqAIygEyk2Qcs4jvAxBqMUszFIyyMuJEr60eR5wMOOiB9cBKCLHGAiN3WREEIIQVMTkhjyYp2q7NtGivf/83/842+e7Uc5py7yIm7eXzVPcHrS6iMAODnfbF/h83+5/uxnn+n+9efrPl/+bOzHhhNKGSl2hCkJMsZgdXe7e7bdDqXsY6ySLEgAOcFsccKu9G4KecAW5fgmTL/dAZhIADj104SaCzykZs6SGpl3WAhPrn/9Il9qHmufx91suPzFLvwv+ejP3vv0P2A+wy//N37z898++5cvsLuJcXv77AutrxdIJoSIMIgn0I64IklXxW3/JVRTC4iBQugdHB7lDqU9AsIPEdApquFwtcohyamqqgZohCokxdS0s/lyvtK4GLb7zWz16jrMSlMHcIf+5fiL159f/rKbK4ahH29vUq6LJs5iFEeBVKt6gC0DYBNCrFTABQEK0kTqETx+OAH6mhnZ10/MZJpSCAAVVdEomiQEERVMoMNubG/EdbvdNaldr9f7bei3vi+AdgTHUqwt1KEVLk60DR5sT+7gQ0QZCYq4CGSSkgruQiLxAEy9h3C/loF3HxN4p0fmDz7eNm1IqelS080XJ918cdbNHtV+nl91/bzdLfX2in1xHwpaSrQPL06bOAS95Xhd+p3pgAhKqqZuElwpQdwBmSBE3PnDt57UP5T/NDA6eDMPdiZgEGKadg3jGJA9jwi7fryN3S61za9//fOPn/xEDLjpLMXQh6pYbbrzp6dhdhWrw/aZO7VMslKq3Y05pvAhbyTVO9T+eIo40vItTWi6591HhJACKqCzbhnbeWjapm0E1X2PqDf982y/Bhfd4pG07dAHLensg3BymmczqUPZ3vTGm2K9MWerpdo0Vpu6QLgTVCffKhGOhvSQxrDanL1BsqrcHw+4OsQ2hahIgCbVRqQpLo5GNIUwS+2imS26ptWIv/3b//Z6+9swq/NN7GI5fSRpdQN77nzpeE25sbKrZSi1mFWKed7Ds7vTbfLjyRjkDZneRch3a4B+b0RyP5RxEhQjVNwoVMCEIj6bNTEERTSvNLNipuX8bJ2a3fUXnxe/msXhfP1h7F7k7X7bX/785z87O1uePzqNIjoNPh00UVU6VI5DTkAgx/nfm7OhQ0b6VlHogRFOZdIUrUVEJQSFBjrMPYAKpXstYwjzmPDexfpXzz7rP/unv798FjRQaHWYL9r1Zj0Pi87FauVgWj2S7pVu4BQoHHQeQ8998HngAw9nkN82ChE8TLWFoAscdAHpDhJeay0hjyEV+hgk/eTPf3p1ebm96rsuzudLZ6kFy83Jh+8/nc0XSYLZCC9kcWYwEzbNkXhoaPxtut+x9vAVH/i6XYkpmAlERAVBJImqhqgSRAM0iCaIAklDSrGNIa3X6x/+4EfL1dnl8+vN6dl//i//9a//49+cP3oS04mGOI7W77e53Dpuql9V37IOcHMz0oQOofAhrW+X+/c+IIdy/3dvc6iKU1SgAkBM6PBKLWYDTaW0lCQ61DKUPKqqagd0n/zpT3/8F3/dzZta/ctnz+hSgXGsu2GXS28cnINxTx9JA+8mi5O8+JWshfuh8DvzwNctAhyxR53yl5BAJTNNFOJVXXv1hhzdxpy35p5p85NTStjdZrktUOuzWbZh3Oeyz9YbRsdQbKg+EkWmhYtD3hH5hvWYr5QSInJQAh/M29+2o8nCZAKOVHSKGEIhWzDDs9lQxlCqpxDqdhvUg2oQpdZqVmw/lFsvO+dADl5H1oLiYuBk/8fQyePw/etEKm9v7n6T/RzC66HchhEiSvcMIUWEAczuQy17Q3SHBAnNvtYM9jG2qoFenP2+f+X5hnWLvOfYS96HUqSqe7BanEY6p4G2HIX1TaTFd603vT2Ud7qIHDyLJJVCGlnJQhT3vZcUCAGiYLetMcXULH0cx5JFkJrs47WXLevOc++5Zx3ETZyolV7plawHjJCQadvjm4T7thO/ZTzH81QRFT/sBlFAdbjQVVQgrOYcITfCDCkuReLccoPaCxV0Yyn7Ao42bN0Gr73bntbTsvsIFGEOYgRJh09Rm99g/m9pYLKld5mTHEtxwbRf4xMoQDdYdeRpL8DhNu0yWRVtRHRqS5yVNHihjbSRdXQb4Nl9JAtZAAdNDvXk77Hgdr+9zsme38EA76OXPDhDp8GqYDxOfWgibqS6aAo6gRrudNBAq6V333sd3TIs0wu90KvQ5eDGv996Xnwrf7n716czHvriu25AnBPU4lJBpWZ1OMU4SnCKiUaqTn0hOXXr5rZ3G91G2gjPk+mDRvLYcvz+S3+T4O96x3cs3ekDK5pU4e6iYhA/VElhchGjVdcqQSFhMj6nC12UrCM8wzN9hFewgAZO9c8fshoZH1IPQFVJfjU3y10XcSgUJzzSDjt8qFASDjdKIJQx0gWiB8b92F9NUrd8pN6FRtp3Wrt8GIgeauAhD5RjEXK/YeiAghUSIIRH0ik2TUoEESIuKgInSBdCxAnCjXZwXKFNYyyI/uEM/I4y7gEP8pYzkxAxUgUmgMAEJCsQCAhsWuybchLcSVIgSprTJ+qnXUInD3K5e9q3XzV/OxNP1f4bsj+kd77VNR+67im10Q5hDEKYiMCNd0UsZWoOhXAjps0x+vQtmYLfH7oiH98ohL6+jPvGWmMqouwBPiZ0n1q/w0KqUCguVAqnZPhGqazfyQfeRffD/PDO9WFOiNoEJxt5aFv9gB3osRo4bIFS9G7Td6qfCZlq3O/EwFcN6S2f/qZ/jJjshwei7lccDXyjgj/WvOQ9uOB/MPVv+MBdPH1QF91HWPIBMvOV5x0XGe+3JoEw1WKQNxqS432ms/fr0fIdw+hDeT/k5E3jkW/qMORYyQjo8pUi5Dhq4APGv4P1fGNT/2ah6l/7DxM8nPE3LIpvkPlGr/Rg7/2uffouPPwfFlNnougeiMoAAAAASUVORK5CYII=",
  "tou_b3_p2": "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",
  "panic": "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",
  "panic_aw": "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",
  "frozen_canyon": "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",
  "catacomb_n": "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",
  "steamer": "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",
  "steamer_aw": "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",
  "hazard": "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",
  "hazard_aw": "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",
  "lava": "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",
  "lava_aw": "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",
  "flame_nest": "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",
  "turminos": "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",
  "ancient_tomb": "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",
  "chaos1": "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",
  "chaos2": "iVBORw0KGgoAAAANSUhEUgAAAEAAAABQCAIAAAAm3eQSAAAZvElEQVR42tV7WZNdx3FmZlbVWe7a3bd3AI2FAEgCpLiJtDQyJXsclseSNaLfxoqZJ0fMv3P4wTExEzHSaBdJabjIGpEgQIAAe9/veraqypyHc87txkZKNEnb5wF991NZmd+XmV8WcG3tMgAwCAAwAAIIASIKEiEAIiIKAoIAAQIAACICASICACKQUs5Z1MpZ93c/+Luf/vSnmxubQaQFGBARMM3SdqttiwJR/e33v/9P//Q/vPfsWURAyluKCIAAAAKACAADQPUvsoiICIoIcLkEKG8OABoeuhCpehexXiUCAiIgcvWsfAcREEQYiRQiaXV4uL+2dnY8HmZ55pijKLJFEUSBF68CfXZldZJNgATL5TCXvw8giCiCINVTQBQRRBEBIRABZAQQwMpkABARACAoLa9tFiw3GKcXUGku0HTdBEDEpIRICBi9MsgiJoh+/KOfz/cWz6yuoBGM/Rj6CQ1NGwtO5+d7Vy49+frP3gABQWH0QgLV7UiqPapfQSlvivWOA8jJjp66iIFYUIAQiQiRCMuNKHcJBQmQypdZmEkBabJIjogNSYAqwsyOgzBwVkLdzHM7vzAXdiiJ+r1nm8svzY7jQ2rJ2oU1LSEUBkkxslPWk9WhRqWcCBkFhEIgKIKMJIAiJICCiIRABESAJEhAICCMKIhCpZWCAOVnsXRCbS0JYPmOkFJKEaB4YQAUQM9SuCJ3aWem5ZwlMp3u3GScrq4tYVhIN3321cvf+M5Lfia1QTo73ykKu7ywzN6TwqgRBZFm70FEac0AQIiEiIBUYqsK1toRZVxXHpj6QZeRhXCyaEFAKJ0A1S8gACCDoAJBQEJDGhUJWGaljXHWEoXnz529cPGKDqHTa0GDh3nq2gXNF0U40XHYWWxYjxf1eR8X24ebw+RYoY6UEVSIIAKCFgCAQKQGKZbArtZYmiIAgCK1Aarb7ZVfK8OdEKfwrbFbPRAQUgQEAKB0gIDCrBQHGntzc09dvXb+4sXu3EzQpq3Du3eO3ut9pbH09OyQB+IkOUrbQaepZ0Mw7cV20DBREDrrbSqKCFF59oAn+4rToJ+aUu36AxAA1e7OISIiYxlrgEAlZgVLaFRuQVRIRtU8oZzNQVyzEVy/fvXPv/mt1XNrk3R80D8sTP7uB79eTz98/ntXwzXNJl9cXnzv7ZvHu+PZcE4YLRdPXHri2vVrsYkO9w9tXpBB6xxS5fySlaRe7qklI4AI1NsvcJpGy68iEgpIbSzKCesy1xRASAQoSDOd1oWLZ/7mO/9pvjf/+m/eXd9eP5gMcOL3JluuBX6Wj/AoiFVThdyG/vhgZ7Spk2NNenZh5traldX5Bc3qrbfeGaWTMNLOeZATXgUUwSqMEAQEpIrsqU0CAKo904MSrkQleqY0X/qkJDUgFARQIMCKSCsdaH3+7JlXXn7hicuXjvr779+8+fH+1vbx7tZoMzP9819d6D7fsvEkVRkKqswMd9L0wA0Px8aYVjOem+325nuRjo6PDw76B6RQuNosmYb6KbxKhYeKIQFAGBCqcKnMEagAUH0P6yBERESlNJECAZGSY6HVaq6unjnY393Z3Y9brdzlmaQc2IzS8185b8OsaCQZDaEhl5+7JKHNIcGQUpc1O03r/e7ennNuaWmp3YkLa6tbQUVFpy/AE4Cc/MEqhKRKtgilq4S9CYzzjAjGaGstkSrjzltuxFGeZgJy6fKlM6tn9g8PoxCc+KXVxZebf3Lk+6rnfvTOPxYmlaDIJYMQCz9BjKiBf/3975hBw0B0fvWceEhGySTJgiA4d/bCKLkBDth5pRQgehGWks8rjpzmaDmpGBBkigGs3IYlHyOiImEprBVhQkVEpLTzRZ5mjSh+/tmXrj973eZ5OkqK3OuGaXVmrq7MB4shzuf3st9phY6YkIs096YJvrhw9cJXv/Zizy0Pj1JO+WBrtxgWYGWmM9fsdueXlt968/9a69IkYQBDGgCYGYnET6uFh6se0FNfQF1lIKD3TKpMhKi0ISIEdEVhNL36Z//xua88E1BLiHc3twbDUXe2AQ7H45RIFwnTICMtCUxCS7ExQI4sTpKRWBkN+uTDPOViVNjCiyjOnRB1up0zZ1afunh1Y3Pjl7/41e7ejom0qqojrigVS/KXao1SpauTYk6qEAJCdN4ZpYkQFZFS1loAiMLw61//kx/84L8sLy699Zt3bt647XzR6cx4dr7wdpIDFp7GRTrIkiQei/IYWrKiNEtR5D71x4dH3oXF2HMmPvcBRiYMh8NhFvmuiv70m1/LkiQK4x/+8H8fHBwRodLaWkenox+xLOJKYICAas/OARISEBEiI4LSikWUVl4qxnWu6LTb/+FrX//vf//3iwsL7/72nfW7G+NxMtOZfeqpJxcXFlHrwnkVhWBcysd7R3fjOau0OM45ywIbFiNtxs2zrUsxdggMOOy2Zi6evXhm6ZxRZjgejIYjm2VPPnn5woULtii2t7fTZBKakD1X8JX7Aglr2lHt2R7VdDmtggCAjGLPSEhIQRQ8/dST/+0H//WlF58/Ot67+d6N8TAJTby0tDLX6y0u9nLrkix34CwWE3s0LPYwdtYPvfXeenIBDoMwm52jJeXCUDXB4crCytrKWrfR8VaG44FzVsStrC6snbmwsLg4GAw2Nzas9XBSPtepuWbRkln1SVTV/MnMVUAhaqUFxBi9urK6vLi4u7WRJ8mZ1eVk4vf3jg8PDgeDvjYwStPUW9XRKqAAg9nZlmM3zkJncwiBNQai5rpzBkPNJpmM8qHdKnCw3VcZpVnuinym21lZXRgNkkGjPzvXWVldjoIwS0fT+lkAAQWrXDHNxqDxFIrLXK2U4qreFCS0eZECe5b1nfXlxcU0c2me5kV22N/d3F43QaC0eJFMOGzrqKeomTfj7sglcdAAERzbWLUobcbctklxPDmaDLLkODtU+8or7QIUyL3tJO3lMwu5tQfHByLcPzourA0CY627n3fqOKr7Al11MDX/AIKIiLBUaV1MGAjwcDzsHw8CrQ+ODt98880Pb94hUvML80FDCpunecZK9rZHwdi0OmFrrtWaWaBGO55TVChMG8mAddIcHybjnUM7YfRIsXSa3TA0ztqjrd3bd28yFN949VWlaDQcORHUyhbWiyfQ09gX4apGEiAiEdZ4ij8FquqzTG4i4tkzCxGAyHgyHgyHtz+89e47vzs6Pnzl5Veee+ErSTo5Oj4+Hh6NxiMAHu7vJ6OgmHSbFKQ7x6OhoyTqqkj6OD5KJ3v5ZGTRYkM3ZtsdHZluuzs32yVNG1u/+j8//kma59euX1taWiTCLM8IQUexzeyjPFA9oIezg9SVHRGV5ZA2ASI5z2+9/dYbv35jd2+31W5fvHz56WtP9+bn0yzTWgNRFAZaGwLM0sKNeSZeWo6Xl5pLM9SOqGUTN+yPfWKDIGBy/dGxtUVvvvPsc89effoKaTGBfuvtt15//fXd7V0RMMZY55I0gU+8VHu2d1/JUVVLSAoAkBQhoFLUajcPD/c/vHVraWXpP//N9779V391/fo1a4sPb9+J44hB9vcP9g8PkiRDrXoL8zrAjzfuFP0i3U937w2UCxVH2bgYjZP+cT8I43Nnz872ZgGBCC5fvfzCiy+srJ5JxpP19XXHfjQc7e/vl+3kSbd+qowoG0gQUd2ZhWnjMm2oiVRVdCACiHfeWru3uzsaD2Zn55aWFwBwd297e2fHexaUe/fWN7e2JklS2IKIOt0uk/c2bWBDSzvrc9vMgjcHe/3JKBHgrMhGyajdagNIf3SYJamzhfc46A9uf3RnY319f/9gOBx6x8KMZZiUBghVJb4IAoGIfih+qnZAav5FJBY/HA6EXdyIg0CPRmNb2EmaZnlmjNnY2rz78b00TdrdlmOXpNloOOpvHAFOgpWo0zRpv7813CEdDQdj61kHxjm7t78XxcG51bOusKPDvlKh0pEAhEEwGo4oVEEQsBcAEHcquB+6HqEL1SqTEBIBIABpI+J1YJid94wohbdZlu0fHAxHw+2dnTiOlTJplpHWIphlVlgYaXiQJAMpEmuRwjgETUpUZnNkNlrfvPnhwe5hb2ZmaWHhiYtXGMl5V1jnPGNROO+BUUTKLhYfU9Dp05ahoEDlmpKSnGcRMYEGEGEovA1C02i18sI6a9MkPdg/INTPv/DCxubm3Y/vEolC1e/30/GQiDn0ShdewNoi9lK4wosIy8L84trZsx+8/0GR5thGmzEBah0wi9EmCIwtLAAEYZhn+WPQizWIZ3onGaBseqhKYWVqIKqYihR4748Oj1vt9vLSQr8/youi2Whaa9fOnVs5c2Y0Go/GYyTpdtoWXKfT+tNvfPPM+ZVxXozTdGZutmCeTNI4jl989oWFhYXt9e35zlxkwqX5pd7c/NFg8LOf/Xw0GiGidxyGUZE7BARBkbo2ONEqgD2DgOrM9GoGoroxBgSqZRmYioggTFpHUbi8uLy6eq7VaQHDYDCcjJONzc240ejNzaZJlmbZaDSemZnpzfc+uHXj43ubcwvzYRxt7W73B8P5+d6z166Dhp//+Jcud8sLq+1m+8rlK4tLS/fWN7a2t4iQSLFjACjyAgDpBMRlRSdloAMDAqhOt0dQ64d4qlurZYHahLL9lNFw3B/047i1OL8YRaGzPDM389r3X1tdOXvcH2zvbGVFEceReDexaZZMPHoBxeLTLCckX/jlhdVLZy+/9t3XbGqV4FNPPT032/vo7t1fvP6rre0t55y1llkIiVniKPLOT+O8bswqARgrbVRKtWJq3CnIi5SlBQCIZyTVaDS8l+OjY2tdFLXOXzh/9erTwri4vLi7u3N8eEQiyWSsTZQniTFBGDZ9YZnFewYGsbJxb/PS2qUsyVeWV89dvNSbWbDejZPk6OhIaaW1BgBFSkS898xc8YpAvY66/iwx0Jnp1Zod1hpYlQBqVW7abAMDoFCWF1mW2MLGUTQ/vxAGUZokNz64+eGtW2mR5nnWaDbjMMDCs6hQhwq1UcGgPwSHCrRY4dwTYrfdPXf23N7h3q07t3704x95YWMMomIWIhQRb32p9E9DqF7/9A9okUq1K63EUteuxeupMgSCRNqxB0JFeHzUfy9/P00LrYMgDJqNJnufZ7l47nZmRpOhRrCZJaWEJHFJm3SsIwHIJgWzj8MYRQ+Go9Fksru//T9/+L+CMJiMJ1opZmBmrTQCaGPK9ZSTBBGp87GcVuZqECPdn49riagMPATnvQAaZUwQKtR5nmdpOknGWmkASNLk+Ph4OBoUNmf2Z8+cSyYTlzthCpWZ7faODo5sakMdNcLG3Nx8nuVxGH68uf6TX/wEtAxHwziOtVIAqEihgGdGJO8cIZ3ywKnuTB4z4CjfJDn5MAKAoNaKma2zRZFpFZggmEySOx/dU8p4kSAyjBxGxjpLmkb5oe64QOlmMy4K64McNROTc7ZUuZVSt+7cfvu3b+U2L3zWaMU+877cfq0de/ZiDAkqACiHHFgOaQRQQIRKO3TF/yIgXmoNVSoZoLaYUVDAudIdhApAvPeoyHn3wa2bH9y+cfWpKyvnFsf5UTJKiKC9snDlG088+exFQ8399eP33rn5/sfH6EwUty8+eeHjzfXd3b3BYGBdgUoCFXjL5cCFEL1jEEQktoxCwIJlHihHNjydNwHe74GyUcOpugKCUuutKCUcGFHVhFwlPgZJk8nNWzdVAIVLWby3DMZxVHzU/0ClUZYyhM5rh4RJNnnr3be5ALYsAlopAe+8Z+8RNExnZUAoUqawGsQEIFhqpEIi5bwLNJ5wpqCUgsup0KkXOtVc5YQJploZR2Gc59amaRhqVEhKNxrtfJQnaQbFJFZdl4oSYibxMk5GGgJFuiwTvXgRQURgAUBhBAFgmcq5Vc9eA7keR05roZNVwpSLKmVapvMElAeFDakcgOicDeMwIATHBGCdF+8Ot48vXr8W9FCxCX3r5m/uuYwh95qMCUISDYLee+e9gCCBJm29P0lK06wrgFP2rxMWPljM4XS+We++CFZTp1q0FwYQQCqtQiTBUi1jrUyaZkgAJEJIoJz1926t/9m3X7ly5hKJGRymB5uHkBF7RCRbFFjWmCiKkBk9s3cWhUolXaQKEuBaTS+LyxM+fWw5XcGj3v/TgYQwVfYEpcQ1CgCQVsioCAHJWyeExkRFOv7wd3c7cS+OGtsbe/3tIXqlWDlmhUYYvPiSugEAWNgzAZ2EbJl4qxq52vpq9fdPafRJKE9bZGFAQC4TQzVCqxu6qfpFUrssS3PSREjOO8/M4gmCgMKt2/vLc1uRaW2ub4M1ihWi9gxExCjCwsLlHhMikWZ/UrEhV54+Vc5UKJiKKqdW/EBL/0Cug5PZWsU7p8Y8KEKImoyz3hU+NrFWgVj2ObZUJ5JOLG1JqG06Phe2gEK2cMJCSJoUIYkIOymxcF9b+MiVnRamaw888EbZLCNWIK7FRipPImDJDVgjuESPd05ENKksLYJQMztv7VxnUTINpOKwYxOnwQgTM6AgMDIwCFeHDRBRkKUuXEoVTupI8lzT6MmYe2qhflyzc98kDQEY66HnaXxUuCEgrZVzzhidp4XRqhE1i5Q1G7CEjggNcI0gqapHEQLmuuwSPMUu1Usij5sMnGDg9Drvn2FW660zBgOpEuBSF+Zl34kI7JlQiWMdBKn14IUEoUCXI6IjVMDIjlkElarRWRdpUimdCNOBe71DZagKPmK8Wm+xfmQlNK0kRKo2GWspA07cUPmRiLzzTpiInPWhCQXYFk4FxonzGQGZ8mgKIkEpW5ZelHqP5ZSkVp5Mqe0TEXzE4k+dlXgAqeVpCxAEBmBABmBBrjZDGKo7lqWtAIqwZwAuMTAZTQgxNAEixo1YAFCrMI4EQGlFhM45KRnIMzOX4Y4luQli6ZHp0qUsDj7JAv242dMDpFSldwRkmc5qpyAoK17rnNYqz/MiB0BwIKSVDgLrrBfO8lxEtDYIICxl7Ybl6LeMeGZ5EAPwqRc99JQeJC6se+QqHZaeEajOIQmAlDBg71/+6lcXevPAEgahZ/bgC1tMsjQIA+tsq9V84YXnldJUH16o9kWQvQgDMAqLsFSx8IjjNVCfDeKyWaHHqy7Tox6nps1SJ4Jy6SzAwl6ExbPX2vzFX/7ltWeuzfZm5xbmSJUlsCiteosLrU774sVL3/3uX5Oi8jRYnXRRuByqVLT5qcxzmnA04Wny4sd8+tSJsPqR1KgjQps7HepJOlk5u/q9v31NSApvSatLVy53m503f/PrtXNnZ2Y63/7zv7j4xBMlgjwzMngWAhLGwBgvDk5QfWoc9ggn0CMeyadF3H0/I4RCJfic84iY53nUiJyz5y+de+aF51qtZpJlK8srC0vz7L0OzMuvvPz8yy+Fcdhpt0bjkXMOCI0JiDQKWld8Ilb/UAx80nVabTkRjkoJBAAAvvWtb3W73WF/wN56cUbpzY2N9fWNIAxYuCjsaDSy1r76zW82m02jDbNnzwKMCsvG+os14CE/VB0/i9Oaoih85trTzO7Gjffv3r17dHC8trbW7x/v7e3MzMwI88bG+u9//16R5y+99GKzGWtFLOK99ewJSx2ZvwwD5BQPlLdUShXWJmmitB6NB9u7W2mWNJphFAVRGCJgq9HQxoj3e3vbpSaQpmluC0WktUYUBrZF8dk9ULPhH7T5eHK6qBRNhRSB+Faz4b31tui0Wgvz83EU7+zsZFkmIHsHez7PW81Gu9lm75Ik7c50qzkiIQIS4WeK//Jc1h+y9IfyXJWEQQAwS5Mgip+5fr3IsqywZ8+tPXHl6kcffbR+716RFXmafnDj5u3bd3rz8ysry8w+CMyTV6+EYQTM3nsBRgKt6UvCwENOkSAMvbWLy6vGmDyZoECAOBwO3vv9+1maAuOdD2/du/tRFIZRFB/sH3rr5nvzURQgISEIMzN7z59tBfoTNxofpleZFnX1aVnvmRQWWXJ4eGQC5UlprdjLaDR21jsHx8cDo4Mis8l4Ym0x6A9EuDx6LAhKa2FPhPyoWHhMJv7cPFAdoXPWMUtoQgDKJwmxiANkdM4HWsVRnGcFM+/v7ytl9vb3f/vPv5tMxoTE3iN+QgL9l3ngURXI9OgX1vaz0UZA/vm3/y9uxKgoCM321o7RASIp1M5yNskQcNgfRXHM7iAw4cb6JjDpQFvnynPI8KXR6MO/MB4nwrK7s0eC7ClLip//7JdbG9sIVORFmqRx1DQ6/Id/+Mej3cNmFDUaTfFcltbl/Epp9amh8jkacFKfExACRVEzChtRGDvHgTJ55tJxGgWxTQujAmBJJxObFwHpuNkcDEfb27vNRsvogFmU0uyFGfizglh1ZnqfDOL7AIynj9dWHb8inCQTYdna2m40m++8/fbB/mFR2DiMb9x4//33bxSFBUDr7M7Ozuzc3K/feGPYHxS2QECjA2ZWpGoR4Y8G8Wcw4ERZKttwx6KUCgJjC9dud7Z3djwLArLnIisAMQhNkedGmyIv4ii+ffs2syhUQRB66xUp5gcOJP4RBuDZ81f/QBqVCsQngUdC5TFhEPECAhxFYZZl5bFPYVBELAzCZJR3zgTG2kJr46xDoCAMJ6NJs9ly1iIAI3/OBny2a2rwA/euRcrp6WL47PXDqdpGw5d1nRRR8sgOA740FvrUQgnhS7zoC9nsR9lwcirp374BX6Yf6EsCwBdmj/73uOh/BQ98cZf+F27yH0WGItX/pvj36oEvIqY+Nwycbtwe3uNy708/+NcwAOFxJcCDbacI3qdYPvzavyUPPFLXEBF4rJ2fpx3/HwuxIvN66dwIAAAAAElFTkSuQmCC",
  "chaos3": "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",
  "chaos4": "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",
  "chaos5": "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",
  "chaos6": "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",
  "chaos7": "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"
};
var dgImgs = {};

function dgImg(name) {                    // cached template; a missing file is retried next time (so you can add it while running)
  if (!dgImgs[name]) {
    var p = name.charAt(0) === "/" ? name : DG_DIR + name;   // absolute path = icon from DG_ICON_DIR
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
    if (!dgWarned[name]) { dgWarned[name] = 1; log("template not found: " + (name.charAt(0) === "/" ? name : DG_DIR + name)); }
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
// --- window helpers (also used by the main panel) ---
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
      if (running) {                                 // PLAY / DG / TEST is using the screen right now: only watch for the "Periodical Item Expired" popup
        if (autoExpired()) log("expired popup cleared during run");
        else if (autoWarpPopup()) log("warp popup cleared during run");
        nap(1000); continue;
      }
      if (dialogVisible()) {
        respBusy = true;
        try { respawn(); } finally { respBusy = false; }
        if (respawnOn && !running) setStatus("Watching for death", "#4ade80");
      } else if (autoPin()) {                        // sub-password dialog on screen -> type the saved PIN
        if (respawnOn && !running) setStatus("Watching for death", "#4ade80");
      } else if (autoExpired()) {                    // "Periodical Item Expired" popup -> tap OK
        if (respawnOn && !running) setStatus("Watching for death", "#4ade80");
      } else if (autoWarpPopup()) {                  // "Unlimited Warp" popup -> Cancel, then X beside GPS
        if (respawnOn && !running) setStatus("Watching for death", "#4ade80");
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
// ===== DUNGEON PANELS: FREE (non-premium) + PREMIUM =====
// =====================================================================================================
// Which panel opens depends on the account: premium = owner account OR a Firestore field  users/<uid>.premium = true  (boolean).
//   FREE    : tick any dungeons (queue), runs each (0 = endless), delay, loop the queue.
//   PREMIUM : every dungeon in DG_LIST, tick as many as you want (runs in list order), runs per dungeon (0 = endless),
//             loop the whole queue, stop-on-fail switch, search box, select all / clear.
// Entering a dungeon = find its icon (DG_ICON_DIR + <id>.png) on screen, tap it, then tap the optional confirm button (DG_DIR + dg_enter.png).
var DG_FREE = DG_LIST.map(function (d) { return d.id; });   // non-premium can pick ANY dungeon (one at a time); premium adds queue / loop / endless
var DG_FREE_MAX_RUNS = 0, DG_FREE_MIN_DELAY = 500;   // 0 = no run cap
var dgw = null, dgSel = {}, dgFreePick = "", dgFreeBoxes = [];
var DG_IDS = ["dgRuns", "dgDelay", "dgSearch"];

// ----- icon install, thumbnails, colour-checked icon search -----
var DG_COLOR_TOL = 60;                                  // max colour difference between the icon and what is found (keys of different levels look alike)
var dgThumbs = {}, dgChromaCache = {};
function dgInstallIcons() {
  try { files.ensureDir(DG_ICON_DIR); } catch (e) {}
  var n = 0;
  for (var id in DG_ICON_B64) {
    var p = DG_ICON_DIR + id + ".png";
    try {
      if (files.exists(p)) continue;
      var bytes = android.util.Base64.decode(DG_ICON_B64[id], 0);
      var fos = new java.io.FileOutputStream(p);
      try { fos.write(bytes); } finally { fos.close(); }
      n++;
    } catch (e) { log("DG icon write err " + id + ": " + e); }
  }
  if (n) log("DG: wrote " + n + " icon file(s) to " + DG_ICON_DIR);
}
function dgThumb(id) {
  if (dgThumbs[id] !== undefined) return dgThumbs[id];
  var bm = null;
  try {
    if (DG_ICON_B64[id]) { var b = android.util.Base64.decode(DG_ICON_B64[id], 0); bm = android.graphics.BitmapFactory.decodeByteArray(b, 0, b.length); }
  } catch (e) { bm = null; }
  dgThumbs[id] = bm;
  return bm;
}
function dgInfoText(id) {
  var i = DG_INFO[id];
  if (!i) return "";
  var l2 = [];
  if (i.lv) l2.push("Lv" + i.lv);
  if (i.cp) l2.push("CP " + (i.cp >= 1000000 ? String(Math.round(i.cp / 10000) / 100) + "M" : Math.round(i.cp / 1000) + "k"));
  if (i.dp) l2.push("DP " + i.dp);
  if (i.dur) l2.push("1-day item");
  return i.item + (l2.length ? "\n" + l2.join(" \u00B7 ") : "");
}
function dgChroma(image, x0, y0, w, h) {                // average colour of the strongly coloured pixels in a box; [0,0,0,0] = none
  var sr = 0, sg = 0, sb = 0, n = 0, W = image.getWidth(), Hh = image.getHeight();
  for (var y = y0; y < y0 + h; y += 3) {
    for (var x = x0; x < x0 + w; x += 3) {
      if (x < 0 || y < 0 || x >= W || y >= Hh) continue;
      var c = images.pixel(image, x, y), r = colors.red(c), g = colors.green(c), b = colors.blue(c);
      if (Math.max(r, g, b) - Math.min(r, g, b) > 70) { sr += r; sg += g; sb += b; n++; }
    }
  }
  return n >= 3 ? [sr / n, sg / n, sb / n, n] : [0, 0, 0, 0];
}
function dgChromaDist(a, b) {
  if (!a[3] && !b[3]) return 0;
  if (!a[3] || !b[3]) return 999;
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
}
function dgArr(l) {                                     // Java list or JS array -> JS array
  var out = [];
  if (!l) return out;
  var n = (l.length !== undefined) ? l.length : l.size();
  for (var i = 0; i < n; i++) out.push(l[i] !== undefined ? l[i] : l.get(i));
  return out;
}
function dgFindIcon(img, id) {                          // [x, y] of the dungeon's icon, only when its gem colour matches too
  var name = DG_ICON_DIR + id + ".png", t = dgImg(name);
  if (!t) return dgFind(img, name);                     // logs "template not found"
  var vs = [t], sc = dgScaledImg(name, t);
  if (sc) vs = (dgPref[name] === 1) ? [sc, t] : [t, sc];
  for (var i = 0; i < vs.length; i++) {
    var v = vs[i], ms = null;
    try { ms = dgArr(images.matchTemplate(img, v, { threshold: 0.7, max: 8 }).matches); }
    catch (e) { return dgFind(img, name); }             // matchTemplate not available: plain search
    ms.sort(function (a, b) { return b.similarity - a.similarity; });
    var ck = name + "@" + i;
    if (!dgChromaCache[ck]) dgChromaCache[ck] = dgChroma(v, 0, 0, v.getWidth(), v.getHeight());
    for (var k = 0; k < ms.length; k++) {
      var x = Math.round(ms[k].point.x), y = Math.round(ms[k].point.y);
      var dist = dgChromaDist(dgChromaCache[ck], dgChroma(img, x, y, v.getWidth(), v.getHeight()));
      if (dist <= DG_COLOR_TOL) { dgPref[name] = (v === t) ? 0 : 1; return [x + Math.round(v.getWidth() / 2), y + Math.round(v.getHeight() / 2)]; }
    }
  }
  return null;
}


function isPremium() { return !!(acctAdmin || acctPremium); }
function closeDg() { try { if (dgw) dgw.close(); } catch (e) {} dgw = null; try { if (dgsel) dgsel.close(); } catch (e) {} dgsel = null; }
function dgSay(t, color) {
  ui.run(function () { try { if (dgw) { dgw.dgst.setText(String(t)); dgw.dgst.setTextColor(colors.parseColor(color || "#94a3b8")); } } catch (e) {} });
  setStatus(t, color);
}
function dgBtnSync() {
  ui.run(function () {
    try {
      if (!dgw) return;
      dgw.btnGo.setText(running ? "\u25A0" : "\u25B6");
      dgw.btnGo.setTextColor(colors.parseColor(running ? "#f87171" : "#4ade80"));
      if (dgw.btnStartDg) {
        dgw.btnStartDg.setText(running ? "STOP" : "START");
        dgw.btnStartDg.setBackgroundColor(colors.parseColor(running ? "#7a2a2a" : "#2e7d32"));
      }
    } catch (e) {}
  });
}
function dgRelease() { try { dgw.disableFocus(); } catch (e) {} }

function dgCheckBox(text, checked, onChange, color) {
  var cb = new android.widget.CheckBox(context);
  cb.setText(text); cb.setTextSize(11); cb.setTextColor(colors.parseColor(color || "#e2e8f0"));
  cb.setChecked(!!checked);
  cb.setOnCheckedChangeListener(new android.widget.CompoundButton.OnCheckedChangeListener({
    onCheckedChanged: function (b, on) { onChange(b, on); }
  }));
  return cb;
}
var dgFillBusy = false;
function dgRow(d) {                                       // one list row: icon thumbnail + checkbox name + item / level / CP / DP line
  var dens = dgScreen().d, LP = android.widget.LinearLayout.LayoutParams;
  var row = new android.widget.LinearLayout(context);
  row.setOrientation(0); row.setGravity(16);
  var cb = dgCheckBox(d.name, dgSel[d.id], function (b, on) { if (on) dgSel[d.id] = 1; else delete dgSel[d.id]; });
  var th = dgThumb(d.id);
  if (th) {
    var iv = new android.widget.ImageView(context), sz = Math.round(36 * dens);
    iv.setImageBitmap(th); iv.setScaleType(android.widget.ImageView.ScaleType.FIT_CENTER);
    iv.setLayoutParams(new LP(sz, sz));
    iv.setOnClickListener(new android.view.View.OnClickListener({ onClick: function () { cb.toggle(); } }));
    row.addView(iv);
  }
  var col = new android.widget.LinearLayout(context);
  col.setOrientation(1);
  col.setLayoutParams(new LP(0, -2, 1));
  col.addView(cb);
  var it = dgInfoText(d.id);
  if (it) {
    var tv = new android.widget.TextView(context);
    tv.setText(it); tv.setTextSize(9); tv.setTextColor(colors.parseColor("#94a3b8")); tv.setPadding(Math.round(30 * dens), 0, 0, Math.round(3 * dens));
    tv.setOnClickListener(new android.view.View.OnClickListener({ onClick: function () { cb.toggle(); } }));
    col.addView(tv);
  }
  row.addView(col);
  return row;
}
function dgFillPremium(filter) {                          // both panels: multi-select list, optional search (name or entry item)
  var f = String(filter || "").toLowerCase().trim();
  ui.run(function () {
    dgw.dgList.removeAllViews();
    DG_LIST.forEach(function (d) {
      var i = DG_INFO[d.id];
      if (f && d.name.toLowerCase().indexOf(f) < 0 && !(i && i.item.toLowerCase().indexOf(f) >= 0)) return;
      dgw.dgList.addView(dgRow(d));
    });
  });
}

// ----- run: icon -> tap -> optional confirm, then wait, repeat -----
function dgSelectOpen() {                 // is the Select Dungeon window on screen?
  var img = grab();
  if (!img) return false;
  try { return !!dgFind(img, "dg_select.png"); } finally { img.recycle(); }
}
function dgOpenSelect() {                 // tap the screen centre (character in front of the dungeon) -> Select Dungeon window; true = it is open now
  if (dgSelectOpen()) return true;        // already open: do not tap into it
  log("DG: Select Dungeon not open - tapping the centre");
  tapGame(DG_CENTER, "Centre (open Select Dungeon)");
  var end = Date.now() + DG_OPEN_WAIT;
  nap(1200);
  while (Date.now() < end) {
    if (dgSelectOpen()) return true;
    nap(400);
  }
  return false;
}
function dgFindOnScreen(id) {
  var img = grab();
  if (!img) return null;
  try { return dgFindIcon(img, id); } finally { img.recycle(); }
}
function dgEnterOne(d) {
  var p = dgFindOnScreen(d.id);
  if (!p) {                                           // icon not visible -> maybe the window is closed: open it from the centre, look again
    dgOpenSelect();
    p = dgFindOnScreen(d.id);
  }
  if (!p) { log("DG icon not found: " + d.name + "  (" + DG_ICON_DIR + d.id + ".png)"); return false; }
  tapPx(p, d.name);
  nap(1500);
  var img2 = grab();                                      // optional confirm / Enter button
  if (img2) {
    var q = null;
    try { q = dgFind(img2, "dg_enter.png"); } finally { img2.recycle(); }
    if (q) { tapPx(q, "Enter"); nap(1000); }
  }
  return true;
}
function dgMain(ids, runs, delay, loop, stopFail) {
  ensureReady();
  if (capMode === "none") { log("no capture available - allow screen capture for AutoX.js"); return; }
  var byId = {};
  DG_LIST.forEach(function (d) { byId[d.id] = d; });
  var round = 0;
  do {
    round++;
    for (var i = 0; i < ids.length; i++) {
      var d = byId[ids[i]];
      for (var r = 1; runs === 0 || r <= runs; r++) {
        dgSay(d.name + " " + r + (runs ? "/" + runs : ""), "#fbbf24");
        var ok = dgEnterOne(d);
        if (!ok && stopFail) { dgSay("Stopped: " + d.name + " not found", "#f87171"); return; }
        nap(delay);
        if (!ok) break;                                   // not found and not stopping: go to the next dungeon
      }
    }
  } while (loop && alive());
  dgSay("DG done", "#4ade80");
}
function dgSave(quiet) {                                  // SAVE: keeps the ticked dungeons + settings, does not start
  var ids = [];
  DG_LIST.forEach(function (d) { if (dgSel[d.id]) ids.push(d.id); });
  store.put("dg_sel", ids.join(","));
  store.put("dg_loop", dgw.swLoop.isChecked());
  store.put("dg_fail", dgw.swFail.isChecked());
  store.put("dg_runs", Math.max(0, Math.round(num(txt(dgw.dgRuns), 1))));
  store.put("dg_delay", Math.max(500, Math.round(num(txt(dgw.dgDelay), 5000))));
  if (!quiet) toast("Saved (" + ids.length + " dungeons)");
}
function dgStart() {
  if (running) { toast("Stop the running task first"); return; }
  var ids = [];
  DG_LIST.forEach(function (d) { if (dgSel[d.id]) ids.push(d.id); });      // both panels: multi-select, list order
  if (!ids.length) { toast("Tick at least one dungeon"); return; }
  var runs = Math.max(0, Math.round(num(txt(dgw.dgRuns), 1)));
  var delay = Math.max(500, Math.round(num(txt(dgw.dgDelay), 5000)));
  var loop = dgw.swLoop.isChecked();
  var stopFail = dgw.swFail ? dgw.swFail.isChecked() : true;               // the switch exists in the premium panel only
  store.put("dg_sel", ids.join(",")); store.put("dg_loop", loop); store.put("dg_runs", runs); store.put("dg_delay", delay);
  if (dgw.swFail) store.put("dg_fail", stopFail);
  var prem = !dgIsFree;
  readCfgFromUi();
  running = true; refreshButtons(); dgBtnSync();
  worker = threads.start(function () {
    try { dgMain(ids, runs, delay, loop, stopFail); }
    catch (e) { if (String(e) !== "STOP") log("DG fatal: " + e); }
    running = false;
    log("DG stopped");
    refreshButtons(); dgBtnSync(); dgSay(prem ? "DUNGEON - PREMIUM" : "DUNGEON - FREE", prem ? "#fbbf24" : "#94a3b8");
  });
}

// ----- windows -----
function dgWire(prem) {
  var me = dgw, ox = 0, oy = 0, wx = 0, wy = 0;
  me.hdr.setOnTouchListener(function (v, e) {
    var act = e.getAction();
    if (act == 0) { ox = e.getRawX(); oy = e.getRawY(); wx = me.getX(); wy = me.getY(); }
    else if (act == 2) { dgPlace(me, wx + (e.getRawX() - ox), wy + (e.getRawY() - oy)); }
    return true;
  });
  DG_IDS.forEach(function (id) {
    var v = me[id];
    if (!v) return;
    v.on("touch_down", function () { me.requestFocus(); v.requestFocus(); });
    v.setOnEditorActionListener(new android.widget.TextView.OnEditorActionListener({
      onEditorAction: function (tv, action, ev) { dgRelease(); return false; }
    }));
  });
  me.btnGo.click(function () { dgRelease(); if (running) stopBot(); else dgStart(); });
  me.btnX.click(function () { dgRelease(); closeDg(); });
  me.btnSaveDg.click(function () { dgRelease(); dgSave(false); });
  me.btnStartDg.click(function () { dgRelease(); if (running) stopBot(); else dgStart(); });
  me.dgRuns.setText(String(prem ? store.get("dg_runs", 1) : Math.max(0, store.get("dg_runs", 1))));
  me.dgDelay.setText(String(Math.max(prem ? 500 : DG_FREE_MIN_DELAY, store.get("dg_delay", 5000))));
  dgBtnSync();
}
var dgIsFree = false;
function buildDgFree() { buildDgPremium(true); }       // non-premium now has every premium feature - same panel, only the title differs
function buildDgPremium(asFree) {
  dgIsFree = !!asFree;
  dgSel = {};
  String(store.get("dg_sel", "")).split(",").forEach(function (s) { if (s) dgSel[s] = 1; });
  dgw = floaty.window(
    <vertical w="260" bg="#f01a1a24">
      <horizontal id="hdr" bg="#1a1a24" padding="3 3" gravity="center_vertical">
        <text id="btnGo" text="&#9654;" textSize="16sp" textColor="#4ade80" bg="#2d2d3a" w="32" h="32" gravity="center"/>
        <text id="dgst" text="DUNGEON - PREMIUM" textSize="11sp" textColor="#fbbf24" w="0" layout_weight="1" gravity="center" maxLines="1"/>
        <text id="btnX" text="&#10005;" textSize="13sp" textColor="#e2e8f0" bg="#2d2d3a" w="32" h="32" gravity="center"/>
      </horizontal>
      <input id="dgSearch" hint="search dungeon" textColor="#f8fafc" textSize="11sp" padding="3" maxLines="1"/>
      <horizontal>
        <button id="btnAll" text="SELECT ALL" textSize="9sp" w="0" layout_weight="1" h="30" padding="0" bg="#2d2d3a" textColor="#e2e8f0"/>
        <button id="btnNone" text="CLEAR" textSize="9sp" w="0" layout_weight="1" h="30" padding="0" bg="#2d2d3a" textColor="#e2e8f0"/>
      </horizontal>
      <scroll h="210"><vertical id="dgList" padding="4"/></scroll>
      <horizontal padding="6 0">
        <vertical w="0" layout_weight="1">
          <text text="Runs each (0 = endless)" textSize="9sp" textColor="#94a3b8"/>
          <input id="dgRuns" inputType="number" textColor="#f8fafc" textSize="12sp" padding="2" text="1"/>
        </vertical>
        <vertical w="0" layout_weight="1">
          <text text="Delay ms" textSize="9sp" textColor="#94a3b8"/>
          <input id="dgDelay" inputType="number" textColor="#f8fafc" textSize="12sp" padding="2" text="5000"/>
        </vertical>
      </horizontal>
      <Switch id="swLoop" text="Loop the queue" textSize="11sp" textColor="#e2e8f0" padding="6 0"/>
      <Switch id="swFail" text="Stop if dungeon not found" textSize="11sp" textColor="#e2e8f0" padding="6 0"/>
      <horizontal marginTop="2">
        <button id="btnSaveDg" text="SAVE" textSize="10sp" w="0" layout_weight="1" h="34" padding="0" bg="#2d2d3a" textColor="#ffffff"/>
        <button id="btnStartDg" text="START" textSize="10sp" w="0" layout_weight="1" h="34" padding="0" bg="#2e7d32" textColor="#ffffff"/>
      </horizontal>
    </vertical>
  );
  dgw.setPosition(230, 200);
  dgWire(true);
  dgw.swLoop.setChecked(!!store.get("dg_loop", false));
  dgw.swFail.setChecked(!!store.get("dg_fail", true));
  dgw.btnAll.click(function () { dgRelease(); DG_LIST.forEach(function (d) { dgSel[d.id] = 1; }); dgFillPremium(txt(dgw.dgSearch)); });
  dgw.btnNone.click(function () { dgRelease(); dgSel = {}; dgFillPremium(txt(dgw.dgSearch)); });
  dgw.dgSearch.addTextChangedListener(new android.text.TextWatcher({
    beforeTextChanged: function () {}, onTextChanged: function () {},
    afterTextChanged: function (s) { dgFillPremium(String(s)); }
  }));
  dgFillPremium("");
  if (dgIsFree) { dgw.dgst.setText("DUNGEON - FREE"); dgw.dgst.setTextColor(colors.parseColor("#94a3b8")); }
}
var dgsel = null;
function closeDgSel() { try { if (dgsel) dgsel.close(); } catch (e) {} dgsel = null; }
function openDgPanel(prem) {
  closeDgSel(); closeDg();
  threads.start(function () { try { dgInstallIcons(); } catch (e) { log("DG icons err: " + e); } });
  ui.run(function () {
    try { if (prem) buildDgPremium(); else buildDgFree(); }
    catch (e) { log("dungeon panel err: " + e); closeDg(); }
  });
}
function openDungeon() {                                  // DUNGEON button: choose NON-PREMIUM or PREMIUM
  if (dgw || dgsel) { closeDgSel(); closeDg(); return; }  // button toggles
  ui.run(function () {
    try {
      var prem = isPremium();
      dgsel = floaty.window(
        <vertical w="170" bg="#f01a1a24" padding="4">
          <text id="selHdr" text="DUNGEON - SELECT" textSize="11sp" textColor="#e2e8f0" gravity="center" bg="#1a1a24" padding="6"/>
          <button id="btnFree" text="NON-PREMIUM" textSize="11sp" h="38" padding="0" bg="#2f5fb3" textColor="#ffffff"/>
          <button id="btnPrem" text="PREMIUM" textSize="11sp" h="38" padding="0" bg="#8a5a1a" textColor="#ffffff"/>
          <button id="btnSelX" text="CLOSE" textSize="10sp" h="30" padding="0" bg="#2d2d3a" textColor="#e2e8f0"/>
        </vertical>
      );
      dgsel.setPosition(230, 200);
      var me = dgsel, ox = 0, oy = 0, wx = 0, wy = 0;
      me.selHdr.setOnTouchListener(function (v, e) {
        var act = e.getAction();
        if (act == 0) { ox = e.getRawX(); oy = e.getRawY(); wx = me.getX(); wy = me.getY(); }
        else if (act == 2) { dgPlace(me, wx + (e.getRawX() - ox), wy + (e.getRawY() - oy)); }
        return true;
      });
      if (!prem) me.btnPrem.setText("\uD83D\uDD12 PREMIUM");
      me.btnFree.click(function () { openDgPanel(false); });
      me.btnPrem.click(function () {
        if (!isPremium()) { toast("Premium account required"); return; }
        openDgPanel(true);
      });
      me.btnSelX.click(function () { closeDgSel(); });
    } catch (e) { log("dungeon select err: " + e); closeDgSel(); }
  });
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
var fbAuth = null, srvSkew = 0, acctExp = 0, acctAdmin = false, acctPremium = false, currentUser = "", badTries = 0, lockUntil = 0, sessThread = null, updBusy = false;
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
    if (res.statusCode === 404) return { bound: "", exp: 0, admin: false, premium: false };
    if (res.statusCode !== 200) return null;
    var f = fbBody(res).fields || {};
    var ts = (f.expiresAt && f.expiresAt.timestampValue) ? Date.parse(String(f.expiresAt.timestampValue).replace(/\.\d+Z$/, "Z")) : 0;
    return { bound: (f.deviceId && f.deviceId.stringValue) || "", exp: ts || 0, admin: !!(f.admin && f.admin.booleanValue === true), premium: !!(f.premium && f.premium.booleanValue === true), cmd: (f.cmd && f.cmd.stringValue) || "" };
  } catch (e) { return null; }
}
function fbDeviceCheck() {              // "OK" or "NETWORK". The respawn script NEVER binds / locks a device (the main script does that).
  var a = fbPullAccount();
  if (!a) return "NETWORK";
  acctExp = a.exp; acctAdmin = a.admin; acctPremium = !!a.premium;
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
          acctExp = a.exp; acctAdmin = a.admin; acctPremium = !!a.premium;
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
function closePanel() { closeDg(); try { if (fw) fw.close(); } catch (e) {} fw = null; }

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
  try { if (dgw) dgw.close(); } catch (e) {}
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
