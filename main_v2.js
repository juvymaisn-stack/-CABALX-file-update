"auto";
// Cabal auto-respawn + return to spot - Redfinger (AutoX.js inside the cloud phone)
// The whole settings UI is a FLOATING panel that stays over the game.
//
//  ▶ / ■  = start / stop      ⚙ / ▲ = open / collapse settings
//  Drag the panel by its status text (● IDLE / ● RUNNING).
//  Tap an input to type (keyboard opens), then tap SAVE (or START) to release the keyboard.
//  QUIT closes the panel and ends the script.
//  LOGIN: the panel needs a username + password. First run creates the first account;
//  more users are added in settings (USERS). LOGOUT locks the panel again.
//  DEVICE LOCK: with Firebase on, an account is locked to the device it was created on
//  (older accounts lock to the first device that logs in). Other devices are refused.
//  To move an account: delete the "deviceId" field on users/<uid> in the Firebase console.
//  KEY FIRST: the key box is the first field; login needs one of the account's own keys (or a fresh key).
//  OWNER PANEL: set admin = true (boolean) on your own users/<uid> doc in the console; after login a
//  GENERATE KEYS panel appears in the settings list (makes + copies keys, writes them to Firestore).
//  ACCESS KEYS: create docs in Firestore "keys" (doc id = the key, days = number, usedBy = ""). A key is
//  typed on REGISTER (new account) or on LOGIN (renew) and works once. Expired accounts are locked out.
//  Admin can also set/clear users/<uid>.expiresAt (timestamp) in the console at any time.
//  IP LOCK: only FB.maxPerIp accounts can be created from one public IP (stored hashed in Firestore "ips").

var APP_VERSION = 4;          // bump this on every release you publish (see AUTO UPDATE below)
var GW = 2093, GH = 1177;
var store = storages.create("cabal_respawn_redfinger");

// ===== SETTINGS (saved between runs) =====
var DEF = { x: 194, y: 200, check: 700, wait: 6000, dx: 0, dy: 0, autoCheck: true, showConsole: false, autoOpen: true, autoEnter: true, autoPopup: true, autoLogin: false, autoFit: true, pin: "0708", pkg: "", pkgRA: "", game: "mobile", openWait: 25000, vSlot: 5 };
function loadCfg() {
  var c = {};
  for (var k in DEF) {
    var v = store.get(k);
    c[k] = (v === undefined || v === null) ? DEF[k] : v;
  }
  return c;
}
function saveCfg(c) { for (var k in c) store.put(k, c[k]); }
var C = loadCfg();

// ===== FIREBASE (login + monitoring) =====
// Login = Firebase Authentication. Monitoring = Cloud Firestore (users/<uid> + users/<uid>/events).
// Leave the placeholders and the script falls back to the local login.
var FB = {
  apiKey: "AIzaSyBvUhQiUtxs7TADYZxaSaVE6oeNiYmPoy4",
  projectId: "nstp-tup",
  inviteCode: "",           // optional: if set, REGISTER also asks for this code (stops strangers signing up)
  requireKey: true,          // accounts need an expiring access key (create + renew); replaces inviteCode
  maxPerIpEmu: 10,          // same limit when the device is an emulator / Redfinger cloud phone
  maxPerIp: 1,               // accounts that may be created from one public IP (raise if players share a network)
  domain: "cabal.local",     // username "james" signs in as james@cabal.local (type a full email to override)
  beat:   30000              // heartbeat every 30 s
};
function fbOn() { return FB.apiKey.indexOf("PASTE") < 0 && FB.projectId.indexOf("YOUR") < 0; }
var FS_DOC = "projects/" + FB.projectId + "/databases/(default)/documents";
var fbAuth = null, fbThread = null, fbQueue = [], fbState = "idle";

function fbBody(res) { try { return JSON.parse(res.body.string()); } catch (e) { return {}; } }
function fbSignIn(email, pw, signUp) {  // returns "" on success, else an error code
  var res = http.postJson("https://identitytoolkit.googleapis.com/v1/accounts:" + (signUp ? "signUp" : "signInWithPassword") + "?key=" + FB.apiKey,
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
// one Firestore write: set string fields, plus server-time fields listed in "times"
function fsDoc(path, fields, times, mustNotExist, onlyIfUpdateTime) {
  var f = {}, mask = [];
  for (var k in fields) { f[k] = (fields[k] && fields[k].ts) ? { timestampValue: fields[k].ts } : (fields[k] && fields[k].int !== undefined) ? { integerValue: String(fields[k].int) } : { stringValue: String(fields[k]) }; mask.push(k); }
  var wr = { update: { name: FS_DOC + "/" + path, fields: f }, updateMask: { fieldPaths: mask } };
  if (mustNotExist) wr.currentDocument = { exists: false };
  else if (onlyIfUpdateTime) wr.currentDocument = { updateTime: onlyIfUpdateTime };   // write only if the doc is unchanged since it was read
  if (times && times.length) wr.updateTransforms = times.map(function (t) { return { fieldPath: t, setToServerValue: "REQUEST_TIME" }; });
  return wr;
}
var srvSkew = 0, acctExp = 0, acctAdmin = false;        // server-clock offset (anti clock-tampering) and account expiry in ms (0 = none)
function nowMs() { return Date.now() + srvSkew; }
function noteSrv(res) {
  try {
    var h = res.headers, d = h && (h["Date"] || h["date"] || (h.get && h.get("Date")));
    if (d) { var t = Date.parse(String(d)); if (t) srvSkew = t - Date.now(); }
  } catch (e) {}
}
var fbWarned = false, fbSeq = 0;
function fbPush(state) {
  if (!fbAuth) return;
  var r = fbCommit([fsDoc("users/" + fbAuth.uid, { state: state, user: currentUser }, ["lastSeen"])]);
  if (r && r.statusCode >= 300 && !fbWarned) { fbWarned = true; log("cloud sync HTTP " + r.statusCode + " - check Firestore rules"); }
}
// only high-level events go to the cloud; anything PIN-related or per-tap noise is dropped
function fbLogHook(line) {
  if (!fbAuth) return;
  line = String(line);
  if (/^tap /i.test(line) || /\bpin\b/i.test(line)) return;
  if (!/respawn|reopen|closed|entry screen|sub-password|stopped|popup|daily|err|death|dead|started|finished/i.test(line)) return;
  fbQueue.push({ msg: line.slice(0, 200), at: new Date().toISOString() });
  if (fbQueue.length > 100) fbQueue.shift();
}
// ===== AUTO UPDATE =====
// You publish a release once, every user's copy updates itself:
//   1) raise APP_VERSION at the top of this file, upload the file somewhere with a direct link (GitHub raw, Firebase Storage ...)
//   2) in the Firestore console create / edit the doc  config/script  with:  version (integer, = the new APP_VERSION),
//      url (string, direct link to the file), sha256 (string, lowercase hex of the file: run  sha256sum main_v2.js)
//   3) Firestore rules: let signed-in users READ config/script, let ONLY your admin account WRITE it
//      (whoever can write that doc can run code on every user's phone).
// The script checks at login and then every ~5 min; it never updates while a dungeon / respawn run is active.
// A download is rejected (nothing changes) when the hash or the embedded APP_VERSION does not match.
var updBusy = false;
function sha256Hex(bytes) {
  var md = java.security.MessageDigest.getInstance("SHA-256"), d = md.digest(bytes), out = "";
  for (var i = 0; i < d.length; i++) out += ("0" + (d[i] & 0xff).toString(16)).slice(-2);
  return out;
}
function checkUpdate(manual) {                    // manual = the UPDATE SCRIPT button: always tells the user what happened
  function say(m) { log("update: " + m); if (manual) toast(m); }
  if (updBusy) { if (manual) toast("Update check already running"); return; }
  if (!fbAuth || !fbOn()) { if (manual) toast("Log in first"); return; }
  updBusy = true;
  try {
    if (Date.now() > fbAuth.exp && !fbRefresh()) { say("can't reach the server"); return; }
    var res = http.get("https://firestore.googleapis.com/v1/" + FS_DOC + "/config/script",
                       { headers: { "Authorization": "Bearer " + fbAuth.idToken } });
    if (res.statusCode !== 200) { say(res.statusCode === 404 ? "no update published yet" : "update check failed (HTTP " + res.statusCode + ")"); return; }
    var f = fbBody(res).fields || {};
    var ver = f.version ? parseInt(f.version.integerValue || f.version.stringValue, 10) : 0;
    var url = (f.url && f.url.stringValue) || "", want = ((f.sha256 && f.sha256.stringValue) || "").toLowerCase();
    if (!ver || !url || want.length !== 64) { say("no valid update published (v" + APP_VERSION + ")"); return; }
    if (ver <= APP_VERSION) { say("already up to date (v" + APP_VERSION + ")"); return; }
    if (running || (worker && worker.isAlive()) || respAlive() || dgBusy || dgPending) { say("v" + ver + " is ready - stop the running script / dungeon first, then press UPDATE SCRIPT"); return; }
    log("update: downloading v" + ver + " (you have v" + APP_VERSION + ")");
    var dl = http.get(url);
    if (dl.statusCode !== 200) { say("download failed (HTTP " + dl.statusCode + ")"); return; }
    var bytes = dl.body.bytes();
    if (bytes.length < 50000 || sha256Hex(bytes) !== want) { say("file rejected (hash / size mismatch) - keeping v" + APP_VERSION); return; }
    var text = String(new java.lang.String(bytes, "UTF-8"));
    var m = /var APP_VERSION = (\d+);/.exec(text);
    if (!m || parseInt(m[1], 10) !== ver) { say("file rejected (APP_VERSION inside the file is not " + ver + ")"); return; }
    var path = String(engines.myEngine().source);
    if (!/\.js$/.test(path)) { say("can't find this script's own file (" + path + ")"); return; }
    try { files.copy(path, path + ".bak"); } catch (e) {}              // previous version kept as <script>.js.bak
    files.writeBytes(path, bytes);
    log("update: v" + ver + " installed - restarting");
    toast("Script updated to v" + ver + " - restarting");
    engines.execScriptFile(path, { delay: 2500 });
    sleep(300);
    quitAll();
  } catch (e) { say("update check error: " + e); }
  finally { updBusy = false; }
}
function fbStart() {
  if (fbThread) { try { fbThread.interrupt(); } catch (e) {} }
  fbThread = threads.start(function () {
    var beatN = 0, lastPushed = null;
    while (fbAuth) {
      try {
        beatN++;
        if (beatN === 1 || beatN % 10 === 0) checkUpdate();     // auto update: login, then every ~5 min
        if (beatN % 5 === 0) {                       // pick up admin changes (expiry / device) every ~2.5 min
          var a = fbPullAccount();
          if (a) {
            acctExp = a.exp; acctAdmin = a.admin;
            if (!a.admin && a.bound && a.bound !== myDeviceId()) { kickOut("Account locked to another device"); return; }
          }
        }
        if (!acctAdmin && acctExp && nowMs() >= acctExp) { kickOut("Account expired - enter a new key to log in"); return; }
        if (fbState !== lastPushed || beatN % 4 === 1) { fbPush(fbState); lastPushed = fbState; }   // state changes go out at once, otherwise a heartbeat every ~2 min (keeps Firestore writes ~75% lower)
        if (fbQueue.length && fbAuth) {
          var batch = fbQueue.splice(0, 20);
          var r = fbCommit(batch.map(function (ev) {
            return fsDoc("users/" + fbAuth.uid + "/events/" + Date.now() + "_" + (fbSeq++), { msg: ev.msg, at: ev.at }, ["t"]);
          }));
          if (!r || r.statusCode >= 300) fbQueue = batch.concat(fbQueue).slice(-100);   // retry next beat
        }
      } catch (e) {}
      sleep(FB.beat);
    }
  });
}
function fbSignOut(who) {               // best effort: mark offline, stop heartbeat
  try { if (fbAuth) fbCommit([fsDoc("users/" + fbAuth.uid, { state: "offline", user: who || currentUser }, ["lastSeen"])]); } catch (e) {}
  var t = fbThread; fbThread = null;
  fbAuth = null; fbQueue = [];
  if (t) { try { t.interrupt(); } catch (e) {} }
}

// ===== POINTS (game space) =====
var CAP_FILE = "/sdcard/rf_cap.png";
var P_WARP = [1046, 433];
var P_OK = [1046, 1030];
var P_A1 = [670, 433], P_A2 = [784, 433];
var P_B = [759, 1030];
var P_AUTO = [1777, 1027, "R"];                 // "R" = anchored to the right screen edge
var P_AUTO_RING = [[1777, 1084, "R"], [1777, 970, "R"], [1720, 1027, "R"], [1834, 1027, "R"]];
var P_OPEN_GPS = [1908, 317, "R"];              // minimap, top right
var P_GPS_WARP = [1623, 1102];
var P_GPS_CLOSE = [2016, 67];
var MAP = { l: 278, r: 918, t: 222, b: 857, max: 255 };

function coordToPoint(X, Y) {
  return [MAP.l + (X / MAP.max) * (MAP.r - MAP.l) + C.dx,
          MAP.b - (Y / MAP.max) * (MAP.b - MAP.t) + C.dy];
}

// ===== FLOATING PANEL =====
var needFloaty = false;
try { needFloaty = !floaty.checkPermission(); } catch (e) {}
if (needFloaty) {   // exit() throws, so it must stay OUTSIDE any try/catch
  toast("Allow 'display over other apps' for AutoX.js, then run the script again");
  try { floaty.requestPermission(); } catch (e) {}
  exit();
}

function inRow(idA, labA, idB, labB, typeB) {
  return '<horizontal>' +
    '<vertical layout_weight="1">' +
      '<text text="' + labA + '" textColor="#8b93a7" textSize="10sp"/>' +
      '<input id="' + idA + '" inputType="' + (typeB || "number") + '" textColor="#ffffff" textSize="14sp" padding="4"/>' +
    '</vertical>' +
    '<vertical layout_weight="1" marginLeft="8">' +
      '<text text="' + labB + '" textColor="#8b93a7" textSize="10sp"/>' +
      '<input id="' + idB + '" inputType="' + (typeB || "number") + '" textColor="#ffffff" textSize="14sp" padding="4"/>' +
    '</vertical>' +
  '</horizontal>';
}

// ===== PANEL SIZE: change this one number (1 = original, 0.7 = smaller, 0.55 = tiny) =====
var UI_SCALE = 0.7;
// text scale for a panel scale: shrinks less than the boxes (readable), but never less than the boxes need.
// Below 0.7 text follows the boxes in proportion, so the header (minimize button) and buttons always fit.
function tScale(s) { return s >= 0.7 ? Math.sqrt(s) : Math.sqrt(0.7) * (s / 0.7); }
function sc(xml) {
  var tS = tScale(UI_SCALE);
  xml = xml.replace(/(\d+(?:\.\d+)?)sp/g, function (m, n) { return Math.max(7, Math.round(n * tS)) + "sp"; /* whole numbers only */ });
  return xml.replace(/\b(w|h|padding|marginTop|marginLeft)="([\d ]+)"/g, function (m, a, v) {
    return a + '="' + v.trim().split(/\s+/).map(function (n) { return Math.max(1, Math.round(n * UI_SCALE)); }).join(" ") + '"';
  });
}

var w = floaty.window(sc(
  '<vertical id="rootP" w="290" bg="#F2111722" padding="6">' +
    // ---- login screen (shown until a user logs in) ----
    '<vertical id="lockBox" visibility="gone">' +
      '<text id="lockTitle" text="🔒 LOGIN (drag here)" textColor="#9aa0a6" textSize="13sp" textStyle="bold" gravity="center" padding="10 12"/>' +
      '<input id="icode" visibility="gone" inputType="text" hint="access key" textColor="#ffffff" textColorHint="#6f778a" textSize="14sp" padding="4"/>' +
      '<input id="iuser" inputType="text" hint="username or email" textColor="#ffffff" textColorHint="#6f778a" textSize="14sp" padding="4"/>' +
      '<input id="ilock" inputType="textPassword" hint="password" textColor="#ffffff" textColorHint="#6f778a" textSize="14sp" padding="4"/>' +
      '<input id="ilock2" visibility="gone" inputType="textPassword" hint="confirm password" textColor="#ffffff" textColorHint="#6f778a" textSize="14sp" padding="4"/>' +
      '<button id="btnUnlock" text="LOGIN" h="40" bg="#2f5fb3" textColor="#ffffff" textSize="12sp" padding="0" marginTop="4"/>' +
      '<text id="btnReg" text="No account? Register" textColor="#6ea8ff" textSize="11sp" gravity="center" padding="8"/>' +
      '<text id="btnForgot" text="Forgot password?" textColor="#6ea8ff" textSize="11sp" gravity="center" padding="4"/>' +
      '<text id="btnForget" visibility="gone" text="Forget saved login" textColor="#9aa0a6" textSize="11sp" gravity="center" padding="4"/>' +
      '<button id="btnExitLock" text="EXIT" h="34" bg="#7a2a2a" textColor="#ffffff" textSize="11sp" padding="0" marginTop="4"/>' +
    '</vertical>' +
    // ---- header (hidden while logged out) ----
    '<horizontal id="hdr" gravity="center_vertical">' +
      '<button id="fb" text="▶" w="46" h="46" textSize="16sp" textColor="#ffffff" bg="#2e7d32" padding="0"/>' +
      '<text id="status" text="● IDLE" textColor="#9aa0a6" textSize="14sp" textStyle="bold" layout_weight="1" gravity="center" padding="10 12"/>' +
      '<button id="gear" text="▲" w="46" h="46" textSize="16sp" textColor="#ffffff" bg="#2a3345" padding="0"/>' +
    '</horizontal>' +
    // ---- log (portrait): sits under the header so it stays visible while the settings are collapsed ----
    '<vertical id="logBox"><button id="btnVera" text="USE PROTECTION OF VERADRIX" h="34" bg="#7a3a8a" textColor="#ffffff" textSize="11sp" padding="0" marginTop="4"/><horizontal marginTop="4">' +
      '<text text="LOG" textColor="#6ea8ff" textSize="10sp" textStyle="bold" layout_weight="1"/>' +
      '<text id="btnClear" text="clear" textColor="#8b93a7" textSize="10sp"/>' +
    '</horizontal>' +
    '<ScrollView id="logScroll" h="110" bg="#0b0e13">' +
      '<text id="logv" text="" textColor="#9fe6a0" textSize="9sp" fontFamily="monospace" padding="4"/>' +
    '</ScrollView></vertical>' +
    // ---- body (collapsible) ----
    '<ScrollView id="bodyScroll"><vertical id="body">' +
      '<text text="SAVED SPOT (Porta Inferno)" textColor="#6ea8ff" textSize="10sp" textStyle="bold" marginTop="6"/>' +
      inRow("ix", "X (0-255)", "iy", "Y (0-255)") +
      '<text id="preview" text="" textColor="#6f778a" textSize="10sp"/>' +
      '<button id="btnSetSpot" text="SET SPOT FROM CHARACTER" h="34" bg="#2f5fb3" textColor="#ffffff" textSize="11sp" padding="0" marginTop="2"/>' +
      '<text text="TIMING (ms)" textColor="#6ea8ff" textSize="10sp" textStyle="bold" marginTop="4"/>' +
      inRow("icheck", "Check every", "iwait", "Wait after respawn") +
      '<text text="MAP FINE-TUNE (game px)" textColor="#6ea8ff" textSize="10sp" textStyle="bold" marginTop="4"/>' +
      inRow("idx", "Offset X", "idy", "Offset Y", "numberSigned") +
      '<text text="GAME SCREEN (auto-fit taps)" textColor="#6ea8ff" textSize="10sp" textStyle="bold" marginTop="4"/>' +
      '<Switch id="sFit" text="Auto-detect game display area" textColor="#e8ecf5" textSize="12sp" padding="2"/>' +
      '<horizontal>' +
        '<text id="viewinfo" text="area: not detected yet" textColor="#6f778a" textSize="10sp" layout_weight="1" gravity="center_vertical"/>' +
      '</horizontal>' +
      '<text text="VERADRIX QUICK SLOT (1-8, left to right)" textColor="#6ea8ff" textSize="10sp" textStyle="bold" marginTop="4"/>' +
      '<input id="ivslot" inputType="number" textColor="#ffffff" textSize="14sp" padding="4"/>' +
      '<text id="btnResp" text="RESPAWN: OFF" textColor="#ffffff" textSize="12sp" textStyle="bold" gravity="center" bg="#3a4152" padding="8" marginTop="4"/>' +
      '<text id="btnDG" text="DAILY DG: OFF" textColor="#ffffff" textSize="12sp" textStyle="bold" gravity="center" bg="#3a4152" padding="8" marginTop="4"/>' +
      '<Switch id="sAuto" text="Tap AUTO only if off" textColor="#e8ecf5" textSize="12sp" padding="2"/>' +
      '<Switch id="sConsole" text="Show console" textColor="#e8ecf5" textSize="12sp" padding="2"/>' +
      '<text id="btnGame" text="GAME: CABAL MOBILE  (tap to switch)" textColor="#ffffff" textSize="12sp" textStyle="bold" gravity="center" bg="#2f5fb3" padding="8" marginTop="4"/>' +
      '<Switch id="sOpen" text="Auto open / reopen game" textColor="#e8ecf5" textSize="12sp" padding="2"/>' +
      '<Switch id="sEnter" text="Auto enter game (tap + Game start)" textColor="#e8ecf5" textSize="12sp" padding="2"/>' +
      '<Switch id="sAutoLogin" text="Hide login panel - OWNER only (auto login)" textColor="#e8ecf5" textSize="12sp" padding="2"/>' +
      '<Switch id="sPopup" text="Auto close popups + daily reward" textColor="#e8ecf5" textSize="12sp" padding="2"/>' +
      '<horizontal>' +
        '<vertical layout_weight="1">' +
          '<text text="Game load wait (ms)" textColor="#8b93a7" textSize="10sp"/>' +
          '<input id="iopen" inputType="number" textColor="#ffffff" textSize="14sp" padding="4"/>' +
        '</vertical>' +
        '<vertical layout_weight="1" marginLeft="8">' +
          '<text text="Package of selected game (blank = auto)" textColor="#8b93a7" textSize="10sp"/>' +
          '<input id="ipkg" inputType="text" textColor="#ffffff" textSize="12sp" padding="4"/>' +
        '</vertical>' +
      '</horizontal>' +
      '<text text="Sub-password (blank = skip)" textColor="#8b93a7" textSize="10sp"/>' +
      '<input id="ipin" inputType="numberPassword" textColor="#ffffff" textSize="14sp" padding="4"/>' +
      '<vertical id="keyPanel" visibility="gone">' +
        '<text text="OWNER - GENERATE KEYS" textColor="#e0b84a" textSize="10sp" textStyle="bold" marginTop="6"/>' +
        inRow("kdays", "Days per key", "kcount", "How many (1-20)") +
        inRow("kprefix", "Key prefix", "kcustom", "Custom key (optional)", "text") +
        '<text text="Users per key (1 = single use, up to 100)" textColor="#8b93a7" textSize="10sp"/>' +
        '<input id="kusers" inputType="number" textColor="#ffffff" textSize="14sp" padding="4"/>' +
        '<button id="btnGenKeys" text="GENERATE + COPY" h="36" bg="#2f7d4a" textColor="#ffffff" textSize="11sp" padding="0" marginTop="2"/>' +
        '<text id="keyOut" text="" textColor="#cfe3ff" textSize="11sp" textIsSelectable="true" padding="2"/>' +
        '<text text="OWNER - PUBLISH UPDATE (GitHub)" textColor="#e0b84a" textSize="10sp" textStyle="bold" marginTop="8"/>' +
        inRow("ghrepo", "Repo (owner/name)", "ghbranch", "Branch", "text") +
        inRow("ghpath", "Path in repo", "ghfile", "File on this phone", "text") +
        '<text text="GitHub token (Contents: write)" textColor="#8b93a7" textSize="10sp"/>' +
        '<input id="ghtok" inputType="text" textColor="#ffffff" textSize="14sp" padding="4"/>' +
        '<button id="btnGhPick" text="BROWSE FILE..." h="36" bg="#3a4a6b" textColor="#ffffff" textSize="11sp" padding="0" marginTop="2"/>' +
        '<button id="btnGhPub" text="PUBLISH TO GITHUB" h="36" bg="#24292f" textColor="#ffffff" textSize="11sp" padding="0" marginTop="2"/>' +
        '<text id="ghOut" text="" textColor="#cfe3ff" textSize="11sp" textIsSelectable="true" padding="2"/>' +
      '</vertical>' +
      '<text id="usersLbl" text="USERS" textColor="#6ea8ff" textSize="10sp" textStyle="bold" marginTop="4"/>' +
      inRow("inewuser", "Username", "inewpass", "Password", "text") +
      '<horizontal marginTop="2">' +
        '<button id="btnAddUser" text="ADD USER" layout_weight="1" h="36" bg="#2f7d4a" textColor="#ffffff" textSize="11sp" padding="0"/>' +
        '<button id="btnDelUser" text="DEL USER" layout_weight="1" h="36" bg="#7a2a2a" textColor="#ffffff" textSize="11sp" padding="0" marginLeft="4"/>' +
        '<button id="btnLogout" text="LOGOUT" layout_weight="1" h="36" bg="#5a4a1a" textColor="#ffffff" textSize="11sp" padding="0" marginLeft="4"/>' +
      '</horizontal>' +
      '<button id="btnUpdate" text="UPDATE SCRIPT  (v' + APP_VERSION + ')" w="match_parent" h="36" bg="#6a3fa0" textColor="#ffffff" textSize="11sp" padding="0" marginTop="4"/>' +
      '<horizontal marginTop="4">' +
        '<button id="btnTest" text="TEST" layout_weight="1" h="40" bg="#2f5fb3" textColor="#ffffff" textSize="12sp" padding="0"/>' +
        '<button id="btnSave" text="SAVE" layout_weight="1" h="40" bg="#2a3345" textColor="#ffffff" textSize="12sp" padding="0" marginLeft="4"/>' +
        '<button id="btnQuit" text="QUIT" layout_weight="1" h="40" bg="#7a2a2a" textColor="#ffffff" textSize="12sp" padding="0" marginLeft="4"/>' +
      '</horizontal>' +
      '<horizontal marginTop="4">' +
        '<button id="btnDg" text="DG LIST" layout_weight="1" h="36" bg="#4a3a8a" textColor="#ffffff" textSize="11sp" padding="0"/>' +
        '<button id="btnDaily" text="DAILY DG" layout_weight="1" h="36" bg="#7a5a1a" textColor="#ffffff" textSize="11sp" padding="0" marginLeft="4"/>' +
      '</horizontal>' +
    '</vertical></ScrollView>' +
  '</vertical>'
));
w.setPosition(10, 60);

// ===== LANDSCAPE LOG WINDOW (shown only when the screen is landscape) =====
var lw = floaty.window(sc(
  '<vertical id="lroot" w="300" bg="#E6111722" padding="4">' +
    '<horizontal>' +
      '<text id="lhdr" text="LOG  (drag here)" textColor="#6ea8ff" textSize="10sp" textStyle="bold" layout_weight="1" padding="4"/>' +
      '<text id="lclear" text="clear" textColor="#8b93a7" textSize="10sp" padding="6"/>' +
      '<text id="lmin" text="—" textColor="#ffffff" textSize="14sp" textStyle="bold" padding="6"/>' +
    '</horizontal>' +
    '<ScrollView id="logScroll2" h="230" bg="#0b0e13">' +
      '<text id="logv2" text="" textColor="#9fe6a0" textSize="9sp" fontFamily="monospace" padding="4"/>' +
    '</ScrollView>' +
  '</vertical>'
));
lw.setPosition(10, 10);
try { lw.disableFocus(); } catch (e) {}

function V(id) { var v = w[id]; return (v === undefined || v === null) ? lw[id] : v; }
function releaseFocus() { try { w.disableFocus(); } catch (e) {} }

function fillInputs(c) {
  ui.run(function () {
    V("ix").setText(String(c.x));
    V("iy").setText(String(c.y));
    V("icheck").setText(String(c.check));
    V("iwait").setText(String(c.wait));
    V("idx").setText(String(c.dx));
    V("idy").setText(String(c.dy));
    V("sFit").setChecked(c.autoFit !== false);
    V("sAuto").setChecked(!!c.autoCheck);
    V("sConsole").setChecked(!!c.showConsole);
    V("sOpen").setChecked(!!c.autoOpen);
    V("sEnter").setChecked(!!c.autoEnter);
    V("sPopup").setChecked(!!c.autoPopup);
    V("sAutoLogin").setChecked(!!c.autoLogin);
    V("iopen").setText(String(c.openWait));
    V("ivslot").setText(String(c.vSlot || DEF.vSlot));
    V("ipkg").setText(String((c.game === "ra" ? c.pkgRA : c.pkg) || ""));
    V("ipin").setText(String(c.pin || ""));
    updatePreview();
  });
}
function num(view, fallback, lo, hi) {
  var n = parseInt(String(view.getText()), 10);
  if (isNaN(n)) n = fallback;
  if (lo !== undefined) n = Math.max(lo, n);
  if (hi !== undefined) n = Math.min(hi, n);
  return n;
}
function readInputs() {
  return {
    x: num(V("ix"), DEF.x, 0, 255),
    y: num(V("iy"), DEF.y, 0, 255),
    check: num(V("icheck"), DEF.check, 200, 10000),
    wait: num(V("iwait"), DEF.wait, 0, 60000),
    dx: num(V("idx"), 0, -200, 200),
    dy: num(V("idy"), 0, -200, 200),
    autoFit: V("sFit").isChecked(),
    autoCheck: V("sAuto").isChecked(),
    showConsole: V("sConsole").isChecked(),
    autoOpen: V("sOpen").isChecked(),
    autoEnter: V("sEnter").isChecked(),
    autoPopup: V("sPopup").isChecked(),
    autoLogin: !!(acctAdmin && V("sAutoLogin").isChecked()),
    openWait: num(V("iopen"), DEF.openWait, 0, 120000),
    vSlot: num(V("ivslot"), DEF.vSlot, 1, 8),
    game: C.game || "mobile",
    pkg: (C.game === "ra") ? String(C.pkg || "") : String(V("ipkg").getText()).trim(),
    pkgRA: (C.game === "ra") ? String(V("ipkg").getText()).trim() : String(C.pkgRA || ""),
    pin: String(V("ipin").getText()).trim()
  };
}
function updatePreview() {
  try {
    var x = num(V("ix"), DEF.x, 0, 255), y = num(V("iy"), DEF.y, 0, 255);
    var dx = num(V("idx"), 0, -200, 200), dy = num(V("idy"), 0, -200, 200);
    var p = [MAP.l + (x / MAP.max) * (MAP.r - MAP.l) + dx, MAP.b - (y / MAP.max) * (MAP.b - MAP.t) + dy];
    V("preview").setText("map tap (game space): " + Math.round(p[0]) + ", " + Math.round(p[1]));
  } catch (e) {}
}

// key generator inputs: ask for keyboard focus when touched (needed so they can be typed into)
["kdays", "kcount", "kprefix", "kcustom", "kusers", "ghrepo", "ghbranch", "ghpath", "ghfile", "ghtok"].forEach(function (id) {
  V(id).setOnTouchListener(function (v, e) {
    if (e.getAction() === android.view.MotionEvent.ACTION_DOWN) { w.requestFocus(); v.requestFocus(); }
    return false;
  });
});

// GitHub token: long-press shows a PASTE popup (the normal Android paste bubble does not appear in a floating window)
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
  return String(t).trim();
}
var pastePop = null;
function dismissPaste() { try { if (pastePop) pastePop.dismiss(); } catch (e) {} pastePop = null; }
function attachPaste(id) {
  var et = V(id);
  et.setOnLongClickListener(function (v) {
    var d = context.getResources().getDisplayMetrics().density, Color = android.graphics.Color;
    function doPaste() {
      var t = getClipText();
      if (!t) { toast("Clipboard is empty"); return; }
      try { et.setText(t); et.setSelection(et.getText().length()); } catch (e) {}
      toast("Pasted");
    }
    try {
      var tv = new android.widget.TextView(context);
      tv.setText("PASTE"); tv.setTextColor(Color.WHITE); tv.setTextSize(13);
      tv.setTypeface(null, android.graphics.Typeface.BOLD);
      tv.setBackgroundColor(Color.parseColor("#2f5fb3"));
      tv.setPadding(Math.round(18 * d), Math.round(10 * d), Math.round(18 * d), Math.round(10 * d));
      dismissPaste();
      var pop = new android.widget.PopupWindow(tv, -2, -2);
      pop.setOutsideTouchable(false);
      pop.setFocusable(false);
      pastePop = pop;
      tv.setOnClickListener(function () { dismissPaste(); doPaste(); });
      pop.showAsDropDown(et, Math.round(8 * d), -(et.getHeight() + Math.round(44 * d)));
      setTimeout(function () { ui.run(function () { if (pastePop === pop) dismissPaste(); }); }, 2500);
    } catch (e) { doPaste(); }                 // popup not allowed here -> paste straight away
    return true;
  });
}
attachPaste("ghtok");
attachPaste("ghrepo");
attachPaste("ghpath");

// inputs: ask for keyboard focus when touched, live preview when edited
["ix", "iy", "icheck", "iwait", "idx", "idy", "iopen", "ivslot", "ipkg", "ipin", "iuser", "ilock", "ilock2", "icode", "inewuser", "inewpass"].forEach(function (id) {
  var et = V(id);
  et.setOnTouchListener(function (v, e) {
    if (e.getAction() === android.view.MotionEvent.ACTION_DOWN) {
      w.requestFocus();
      v.requestFocus();
    }
    return false;
  });
  et.addTextChangedListener(new android.text.TextWatcher({
    beforeTextChanged: function () {},
    onTextChanged: function () {},
    afterTextChanged: function () { updatePreview(); }
  }));
});

// ===== LOG + STATUS =====
var logLines = [];
function log(s) {
  console.log(s);
  try { fbLogHook(s); } catch (e) {}
  var t = new Date();
  var hh = ("0" + t.getHours()).slice(-2) + ":" + ("0" + t.getMinutes()).slice(-2) + ":" + ("0" + t.getSeconds()).slice(-2);
  logLines.push(hh + " " + s);
  if (logLines.length > 60) logLines.shift();
  var text = logLines.join("\n");
  ui.run(function () {
    ["logv", "logv2"].forEach(function (id) { try { V(id).setText(text); } catch (e) {} });
    ["logScroll", "logScroll2"].forEach(function (id) {
      try { var sv = V(id); sv.post(function () { sv.fullScroll(android.view.View.FOCUS_DOWN); }); } catch (e) {}
    });
  });
}

var running = false;
var worker = null;

function setStatus(state) {
  fbState = (state === "run" || state === "login") ? "running" : (state === "test" ? "testing" : "idle");
  try { if (fbAuth) threads.start(function () { try { fbPush(fbState); } catch (e) {} }); } catch (e) {}
  var label = "● IDLE", col = "#9aa0a6";
  if (state === "run") { label = "● RUNNING"; col = "#4caf50"; }
  else if (state === "test") { label = "● TESTING"; col = "#ffb300"; }
  else if (state === "login") { label = "● LOGIN"; col = "#6ea8ff"; }
  ui.run(function () {
    V("status").setText(label);
    V("status").setTextColor(colors.parseColor(col));
    var busy = (state === "run" || state === "login");           // play button shows ■ for both
    V("fb").setText(busy ? "■" : "▶");
    V("fb").attr("bg", busy ? "#c62828" : "#2e7d32");
  });
}
// ===== RESPAWN script: its own on/off, its own thread - never touches the play button or its engine =====
var rOn = false, rWorker = null;
function respSync() {
  ui.run(function () {
    try {
      V("btnResp").setText(rOn ? "RESPAWN: ON" : "RESPAWN: OFF");
      V("btnResp").setBackgroundColor(android.graphics.Color.parseColor(rOn ? "#2f7d4a" : "#3a4152"));
    } catch (e) {}
  });
}
function respAlive() { return !!(rWorker && rWorker.isAlive()); }
function startRespawn() {
  if (respAlive()) return;
  if (dgBusy) { toast("Daily DG is running - stop it first"); return; }
  releaseFocus();
  C = readInputs();
  saveCfg(C);
  autoBlindDone = false; autoOffCount = 0; autoLastTap = 0; autoBackoff = 0;
  rOn = true; respSync();
  rWorker = threads.start(function () {
    try {
      log("== Respawn script ON ==");
      try { if (auto.service == null) { log("AutoX accessibility service is OFF - turn it ON, the script continues by itself"); auto.waitFor(); } } catch (e) {}
      if (!ensureCapture()) { log("respawn: no screen capture"); throw "no screen capture"; }
      try { refitView(); } catch (e) { log("detect err: " + e); }
      log("respawn: watching for death...");
      var n = 0;
      while (rOn) {
        try {
          if (dgBusy) { sleep(1000); continue; }                       // Daily DG is tapping: wait
          n++;
          if (n % 150 === 0) { try { runtime.gc(); } catch (eg) {} }          // free screenshot memory on long runs
          if (C.autoFit && (VIEW_OK ? n % 300 === 0 : n % 20 === 0)) needFit = true;
          if (dialogVisible()) respawn();
          else {
            closePenalty(0);                                           // popup left over / appeared later
            try { dqLook(); } catch (eq) {}                            // dungeon only: another quest -> boot button
            if (C.autoCheck) watchAuto();                              // AUTO attack went off -> switch it on again right away
          }
        } catch (e) {
          if (!rOn) break;
          log("respawn loop err: " + e);
        }
        if (!rOn) break;
        sleep(C.check);
      }
    } catch (e) {
      if (rOn) log("respawn stopped: " + e);
    }
    rOn = false; respSync();
    log("== Respawn script OFF ==");
  });
}
function stopRespawn() {
  rOn = false; respSync();
  if (rWorker && rWorker.isAlive()) rWorker.interrupt();
}

// ===== DEVICE DETECTION (what is this script running on?) =====
var DEVICE = null;
function detectDevice() {
  if (DEVICE) return DEVICE;
  var d = { brand: "?", model: "?", android: "?", sdk: 0, type: "phone", label: "Phone", w: 0, h: 0, dpi: 0, ratio: 0 };
  try {
    var BD = android.os.Build, BV = android.os.Build.VERSION;
    d.brand = String(BD.BRAND); d.model = String(BD.MODEL);
    d.android = String(BV.RELEASE); d.sdk = Number(BV.SDK_INT);
    var all = [BD.BRAND, BD.MODEL, BD.MANUFACTURER, BD.PRODUCT, BD.DEVICE, BD.HARDWARE, BD.BOARD, BD.FINGERPRINT].join(" ").toLowerCase();
    var isRF = /redfinger/.test(all);
    if (isRF) { d.type = "redfinger"; d.label = "Redfinger"; }
    else if (/generic|emulator|sdk_gphone|goldfish|ranchu|vbox|nox|ldplayer|bluestacks|memu|genymotion/.test(all)) { d.type = "emulator"; d.label = "Emulator"; }
  } catch (e) {}
  try {
    var dm = context.getResources().getDisplayMetrics();
    d.w = Math.max(dm.widthPixels, dm.heightPixels); d.h = Math.min(dm.widthPixels, dm.heightPixels);
    d.dpi = dm.densityDpi; d.ratio = d.h ? Math.round(d.w / d.h * 100) / 100 : 0;
  } catch (e) {}
  DEVICE = d;
  return d;
}
function logDevice() {
  var d = detectDevice();
  log("device: " + d.brand + " " + d.model + " | Android " + d.android + " (SDK " + d.sdk + ") | " + d.label);
  log("screen: " + d.w + "x" + d.h + " ratio " + d.ratio + " dpi " + d.dpi);
  if (d.ratio && Math.abs(d.ratio - GW / GH) > 0.15)
    log("note: ratio differs from 16:9 - taps are scaled by height and centred");
}

// ===== ENGINE: capture / helpers =====
var W = 0, H = 0, LAND = true;
var hasRoot = false, capMode = "none", capReady = false;

var fgOn = false;
function startForegroundService() {
  if (fgOn) return;
  fgOn = true;                                     // only try once
  if (typeof $settings === "undefined" || !$settings || typeof $settings.setEnabled !== "function") return;  // this app version has no $settings: skip silently
  try { $settings.setEnabled("foreground_service", true); log("foreground service on"); sleep(700); }
  catch (e) { /* ignore - not supported on this version */ }
}
function initCapture() {
  if (capReady) return true;
  try { auto.waitFor(); } catch (e) { log("auto.waitFor: " + e); }
  var rootRes = null;
  var th0 = threads.start(function () { try { rootRes = (shell("id", true).code === 0); } catch (e) { rootRes = false; } });
  th0.join(4000);                                  // a root prompt must never freeze the start
  if (rootRes === null) { log("root check timed out - no root"); try { th0.interrupt(); } catch (e) {} }
  hasRoot = (rootRes === true);
  log("root: " + hasRoot);
  threads.start(function () {
    var b = textMatches(/(Start now|START NOW|Allow|ALLOW|\u7acb\u5373\u5f00\u59cb|\u5141\u8bb8)/).findOne(8000);
    if (b) b.click();
  });
  startForegroundService();                        // Android 14+: screen capture is only allowed while the app runs a foreground service
  var okCap = false;
  var th = threads.start(function () {
    try { okCap = requestScreenCapture(true); } catch (e) { log("cap err: " + e); }
    if (!okCap) { try { okCap = requestScreenCapture(false); } catch (e2) { log("cap2 err: " + e2); } }
  });
  th.join(15000);
  if (okCap) capMode = "projection"; else if (hasRoot) capMode = "screencap"; else capMode = "none";
  log("capture mode: " + capMode);
  buildMethods();
  sleep(1500);
  capReady = (capMode !== "none");
  return capReady;
}

// one entry point for screen capture: respawn, login run, SET SPOT and Daily DG all call this
// (MediaProjection first = "capture mode: projection", root screencap only as a fallback)
function ensureCapture() {
  if (capReady && capMode !== "none") {
    if (!W) { var i0 = grab(); if (i0) i0.recycle(); }      // screen size still unknown -> measure it before any tap
    return true;
  }
  var ok = initCapture();
  if (ok) {                                   // take one picture now: taps need the screen size (W/H) before the first tap
    for (var g = 0; g < 4; g++) { var gi = grab(); if (gi) { gi.recycle(); break; } sleep(500); }
  }
  log(ok ? "screen capture ready (mode: " + capMode + ")" : "no screen capture - allow screen capture for AutoX.js");
  return ok;
}
var capRetries = 0;

// ===== GAME DISPLAY AREA (auto-fit) =====
// Finds the real game picture inside the screen (black bars / cut-outs are skipped), then map()
// scales and centres every tap on that area instead of on the whole screen.
var VIEW = null, VIEW_OK = false, VIEW_KEY = "", needFit = true, viewTxt = "";
function detectView(img, w0, h0) {
  var full = { x: 0, y: 0, w: w0, h: h0, ok: false };
  try {
    var root = auto.root;                      // window of the app on screen = the game window
    if (root) {
      var bd = root.bounds();
      var l = bd.left, t = bd.top, r = Math.min(bd.right, w0), bt = Math.min(bd.bottom, h0);
      if (l >= 0 && t >= 0 && r - l >= w0 * 0.5 && bt - t >= h0 * 0.5) return { x: l, y: t, w: r - l, h: bt - t, ok: true };
    }
  } catch (e) {}
  return full;                                 // unknown -> whole screen
}
function refitView() {                // called by START / TEST: measure the game screen before any tap
  if (!C.autoFit) return;
  VIEW = null; VIEW_OK = false; needFit = true;
  var im = grab();                    // grab() runs the detection
  if (im) im.recycle();
}
function showView(txt) {
  viewTxt = txt;
  ui.run(function () { try { V("viewinfo").setText(txt); } catch (e) {} });
}
function applyView(r) {
  VIEW = r; VIEW_OK = r.ok;
  var sc2 = Math.min(r.w / GW, r.h / GH);
  var txt = "area " + r.x + "," + r.y + "  " + r.w + "x" + r.h + "  scale " + (Math.round(sc2 * 1000) / 1000) + (r.ok ? "" : "  (full screen, retrying)");
  if (txt !== viewTxt) { log("game " + txt); showView(txt); }
}

// captureScreen() returns a SHARED image: the very same object again while the screen has not changed (a static loading
// screen), and the library recycles it by itself when a new frame arrives. Recycling it here - or using it after the popup
// watcher thread recycled it - throws "IllegalStateException: image has been recycled". So every look works on a PRIVATE COPY
// (callers may recycle the copy freely) and the shared original is never touched.
function snap() {
  for (var i = 0; i < 4; i++) {
    var raw = null;
    try { raw = captureScreen(); } catch (e) { raw = null; }
    if (!raw) return null;
    try {
      var cp = null;
      try { cp = raw.clone(); } catch (ec) { if (/recycled/i.test(String(ec))) throw ec; cp = images.clone(raw); }
      if (cp) return cp;
    } catch (e2) {
      if (!/recycled/i.test(String(e2))) return raw;       // no clone() on this AutoX version: old behaviour
      sleep(80);                                           // shared frame was recycled just now: take the next frame
      continue;
    }
    return raw;
  }
  return null;
}
function grab() {
  var img = null;
  if (capMode === "projection") {
    try { img = snap(); } catch (e) { img = null; }
    if (!img && capRetries < 3) {          // projection was lost (screen rotated / app switched): ask again, at most 3 times in a row
      capRetries++;
      log("screen capture lost - requesting it again (" + capRetries + "/3)");
      capReady = false;
      if (initCapture()) { try { img = snap(); } catch (e2) { img = null; } }
    }
    if (img) capRetries = 0;
  }
  else if (capMode === "screencap") { shell("screencap -p " + CAP_FILE, true); img = images.read(CAP_FILE); }
  if (img) {
    var w0 = img.getWidth(), h0 = img.getHeight();
    W = Math.max(w0, h0); H = Math.min(w0, h0);
    LAND = (w0 >= h0);
    var vk = w0 + "x" + h0;
    if (vk !== VIEW_KEY) { VIEW_KEY = vk; VIEW = null; VIEW_OK = false; needFit = true; }   // rotated / resized
    if (needFit && C.autoFit && LAND) {
      needFit = false;
      try { applyView(detectView(img, w0, h0)); } catch (e) { log("fit err: " + e); }
    }
  }
  return img;
}
function map(p) {
  if (LAND) {
    var v = (C.autoFit && VIEW) ? VIEW : { x: 0, y: 0, w: W, h: H };
    var sv = Math.min(v.w / GW, v.h / GH);          // fit the 16:9 reference inside the game area
    var cx;
    if (p[2] === "R") cx = v.x + v.w - (GW - p[0]) * sv;           // edge-anchored UI (right)
    else if (p[2] === "L") cx = v.x + p[0] * sv;                   // edge-anchored UI (left)
    else cx = v.x + v.w / 2 + (p[0] - GW / 2) * sv;                // centred UI
    return [Math.round(cx), Math.round(v.y + v.h / 2 + (p[1] - GH / 2) * sv)];
  }
  var s = H / GH;
  return [Math.round(H - p[1] * s), Math.round(W / 2 + (p[0] - GW / 2) * s)];
}
function pix(img, p) {
  var m = map(p);
  return images.pixel(img, m[0], m[1]);
}

// color tests
function isA(c) { var r = colors.red(c), g = colors.green(c), b = colors.blue(c); return r < 70 && g > 50 && b > 65 && (b - r) > 35; }
function isB(c) { var r = colors.red(c), g = colors.green(c), b = colors.blue(c); return b > 110 && (b - r) > 45; }
function isGold(c) { var r = colors.red(c), g = colors.green(c), b = colors.blue(c); return r > 170 && g > 110 && b < 120 && (r - b) > 80; }
function isOrange(c) { var r = colors.red(c), g = colors.green(c), b = colors.blue(c); return r > 120 && g > 70 && g < r && (r - b) > 50; }

// tapping
var METHODS = [];
var method = 0;
function buildMethods() {
  METHODS = [];
  if (hasRoot) METHODS.push(function (x, y) { shell("input tap " + x + " " + y, true); });
  METHODS.push(function (x, y) { press(x, y, 150); });
  METHODS.push(function (x, y) { click(x, y); });
  METHODS.push(function (x, y) { swipe(x, y, x + 1, y + 1, 150); });
  method = 0;
}
function tapGame(p, label) {
  var m = map(p);
  log("tap " + label + " m" + method + " " + m[0] + "," + m[1]);
  METHODS[method](m[0], m[1]);
}

// detection
var tick = 0;
var R_OKBAR = [700, 1012, 1390, 1048];       // death dialog: wide blue OK button
var R_ROW1 = [668, 385, 1425, 482];          // death dialog: highlighted "Warp to nearest resurrection point" row
function dialogVisible() {
  var img = grab();
  if (!img) { log("no image"); return false; }
  var a1 = pix(img, P_A1), a2 = pix(img, P_A2), b = pix(img, P_B);
  var okB = isB(b) || fracIn(img, R_OKBAR, isBtnBlue, 6) > 0.6;
  var okA = isA(a1) || isA(a2);
  if (okB && !okA) okA = fracIn(img, R_ROW1, isA, 6) > 0.08;   // teal border + icon of the selected row
  img.recycle();
  tick++;
  if (okA || okB || tick % 15 === 0) {
    log(W + "x" + H + " A " + colors.toString(a1) + "/" + colors.toString(a2) + (okA ? " Y" : " n") +
        " | B " + colors.toString(b) + (okB ? " Y" : " n"));
  }
  return okA && okB;
}
// ----- "Character Penalty" popup (shows after a respawn: "death penalty ... HP / MP") -> tap OK -----
var P_PEN_OK = [1046, 773];                   // its wide blue OK button (centre)
var R_PEN_OKBAR = [700, 755, 1390, 790];      // blue band inside that OK button
var R_PEN_GOLD = [728, 620, 850, 700];        // gold "Death Penalty" label (tells it apart from other popups with an OK button)
function isGoldOrange(c) { return isGold(c) || isOrange(c); }
function penaltyVisible() {
  var img = grab();
  if (!img) return false;
  var ok = fracIn(img, R_PEN_OKBAR, isBtnBlue, 6) > 0.6 && fracIn(img, R_PEN_GOLD, isGoldOrange, 3) > 0.03;
  img.recycle();
  return ok;
}
function closePenalty(waitMs) {               // waits up to waitMs for the popup, taps OK; returns true if it was closed
  var t0 = Date.now(), tapped = false, n = 0;
  while (true) {
    if (penaltyVisible()) {
      if (n++ >= 3) break;                    // still there after 3 taps: give up, never spam
      log("Character Penalty popup -> OK");
      tapGame(P_PEN_OK, "penalty ok");
      tapped = true;
      sleep(900);
      continue;
    }
    if (tapped || Date.now() - t0 >= waitMs) break;
    sleep(400);
  }
  return tapped;
}
// ----- "Server connection lost." popup (single wide blue "Confirmation" button, same place as the penalty OK) -----
var R_SRV_BODY = [700, 470, 1390, 700];       // its big dark text panel
function serverPopupVisible() {
  var img = grab();
  if (!img) return false;
  var ok = false;
  if (fracIn(img, R_PIN_RESET, isBtnBlue, 6) <= 0.5)                          // never the sub-password dialog
    ok = fracIn(img, R_PEN_OKBAR, isBtnBlue, 6) > 0.6 &&                      // one wide blue button
         fracIn(img, R_SRV_BODY, isDarkPanel, 8) > 0.55 &&                    // dark text panel above it
         fracIn(img, R_PEN_GOLD, isGoldOrange, 3) <= 0.03;                    // not the gold "Death Penalty" popup
  img.recycle();
  return ok;
}
function closeServerPopup() {                 // taps Confirmation if the popup is showing; true = tapped
  if (!serverPopupVisible()) return false;
  log("Server connection lost popup -> Confirmation");
  tapGame(P_PEN_OK, "server confirmation");
  sleep(1500);
  return true;
}
// ----- "Periodical Item Expired" popup ("The following item's period has expired and will disappear.") -> tap OK at once -----
// A fast watcher (own thread, ~3 looks per second) taps its wide blue OK bar the moment it shows, whatever the script is doing.
var P_EXP_OK = [1046, 927];                   // OK button (centre)
var R_EXP_BAR = [760, 896, 1330, 958];        // blue band inside the OK button
var R_EXP_BODY = [760, 340, 1330, 850];       // dark panel with the item list above it
function expiredPopupVisible(img) {
  return fracIn(img, R_EXP_BAR, isBtnBlue, 6) > 0.6 && fracIn(img, R_EXP_BODY, isDarkPanel, 8) > 0.55;
}
var expWatching = false;
function startExpiredWatcher() {
  if (expWatching) return;
  expWatching = true;
  threads.start(function () {
    var taps = 0, quietUntil = 0;
    while (true) {
      try {
        sleep(300);
        if (Date.now() < quietUntil) continue;
        if (!C.autoPopup || !currentUser || !capReady || capMode !== "projection" || !W || !LAND) { taps = 0; sleep(700); continue; }
        var img = null;                                // passive look: never re-requests the capture permission (grab() does, which can break the capture)
        try { img = snap(); } catch (e) { img = null; }
        if (!img) { sleep(500); continue; }
        var vis = false;
        try { vis = expiredPopupVisible(img); } catch (e) {}
        img.recycle();
        if (!vis) { taps = 0; continue; }
        if (taps >= 3) { quietUntil = Date.now() + 5000; taps = 0; log("Periodical Item Expired popup: still there after 3 taps, pausing"); continue; }
        taps++;
        log("Periodical Item Expired popup -> OK");
        tapGame(P_EXP_OK, "expired ok");
        sleep(500);
      } catch (e) { sleep(1000); }
    }
  });
}
var gpsAnchor = "C";                      // where the orange warp bar was found: "C" centred / "R" right edge
function gpsPt(p) { return [p[0], p[1], gpsAnchor]; }
function gpsMapPt(p) { return [p[0], p[1], gpsAnchor === "R" ? "L" : "C"]; }   // map sits on the left when the bar sticks right
function gpsOpen() {
  var img = grab();
  if (!img) return false;
  var ans = ["C", "R"], ok = false, c = 0;
  for (var i = 0; i < ans.length && !ok; i++) {
    c = pix(img, [P_GPS_WARP[0], P_GPS_WARP[1], ans[i]]);
    if (isOrange(c)) { ok = true; gpsAnchor = ans[i]; }
  }
  img.recycle();
  log("GPS bar " + colors.toString(c) + (ok ? " Y " + gpsAnchor : " n"));
  return ok;
}

// auto attack
var autoBlindDone = false;   // auto-check OFF: the blind tap is done once per activation / re-login
var autoOffCount = 0, autoLastTap = 0, autoBackoff = 0;
// AUTO button: ON = golden/cream ring (+ yellow arrows), OFF = plain grey ring. Looking at only a few pixels
// was unreliable (bright / dark spots on the gold ring), so the whole ring is sampled: 36 angles x 4 radii around the button.
// gold share measured on screenshots: ON 0.26 - 0.34, OFF 0.00 (also on lava / snow backgrounds)
var AUTO_RING_R = [50, 54, 58, 62];
function isRingGold(c) {
  var r = colors.red(c), g = colors.green(c), b = colors.blue(c);
  return r > 150 && g > 0.60 * r && g <= r + 10 && b < 0.80 * r;      // yellow / cream; grey (b ~ r), orange lava (g << r) and blue snow do not match
}
function ringFrac(img) {
  var n = 0, k = 0;
  for (var a = 0; a < 360; a += 10) {
    var cs = Math.cos(a * Math.PI / 180), sn = Math.sin(a * Math.PI / 180);
    for (var i = 0; i < AUTO_RING_R.length; i++) {
      n++;
      if (isRingGold(pix(img, [P_AUTO[0] + AUTO_RING_R[i] * cs, P_AUTO[1] + AUTO_RING_R[i] * sn, "R"]))) k++;
    }
  }
  return n ? k / n : 0;
}
function autoState(img, quiet) {          // "on" (gold ring) / "off" (grey ring) / "?" (in between: never tap)
  var f = ringFrac(img);
  if (!quiet) log("AUTO ring gold=" + Math.round(f * 100) + "%");
  return f >= 0.08 ? "on" : (f < 0.03 ? "off" : "?");
}
function autoOn(quiet) {
  var img = grab();
  if (!img) return false;
  var st = autoState(img, quiet);
  img.recycle();
  return st === "on";
}
// tap AUTO once (at activation / after a return to the spot) - never taps blindly twice
function ensureAuto() {
  sleep(1500);
  autoOffCount = 0;
  if (C.autoCheck) {
    var im0 = grab(), st0 = im0 ? autoState(im0) : "?";
    if (im0) im0.recycle();
    if (st0 !== "off") { log(st0 === "on" ? "auto attack already ON - no tap" : "auto ring unclear - no tap"); return; }
    tapGame(P_AUTO, "AUTO attack");
    var ok = false;
    for (var k = 0; k < 3 && !ok; k++) { sleep(900); ok = autoOn(k > 0); }
    autoLastTap = Date.now();
    autoBackoff = 0;
    log(ok ? "auto attack ON" : "auto ring not seen ON - not tapping again (a 2nd tap would switch it off)");
    return;
  }
  if (autoBlindDone) { log("auto attack: already tapped once, skipping"); return; }
  tapGame(P_AUTO, "AUTO attack");
  autoBlindDone = true;
}
// a dialog / popup / dungeon window covers the screen, or we are inside a dungeon (its AUTO button sits elsewhere
// and the Daily DG code handles it): never tap AUTO blindly there
function autoBlocked(img) {
  try {
    if (fracIn(img, R_OKBAR, isBtnBlue, 6) > 0.6) return true;          // death dialog
    if (fracIn(img, R_PEN_OKBAR, isBtnBlue, 6) > 0.6) return true;      // Character Penalty popup
    if (fracIn(img, R_WARP_OK, isBtnBlue, 4) > 0.5) return true;        // warp Confirmation
    if (fracIn(img, R_BUY_BLUE, isBtnBlue) > 0.5) return true;          // 600-gem prompt
    if (dgOnSelect(img) || dgChalShown(img)) return true;               // Select Dungeon / Enter Dungeon dialog
    if (fracIn(img, R_DG_TIMER, isCyan, 3, "R") > 0.04) return true;    // inside a dungeon
    if (isOrange(pix(img, [P_GPS_WARP[0], P_GPS_WARP[1], "C"])) || isOrange(pix(img, [P_GPS_WARP[0], P_GPS_WARP[1], "R"]))) return true;   // GPS map open
  } catch (e) {}
  return false;
}
function autoLooksOff() {                // one look at the screen: AUTO ring not gold and nothing covering the HUD
  var img = grab();
  if (!img) return false;
  var off = false;
  try { off = autoState(img, true) === "off" && !autoBlocked(img); } catch (e) {}
  img.recycle();
  return off;
}
// called from every watch loop (play engine + RESPAWN script): if AUTO attack is OFF it is switched ON again at once.
// Two looks 250 ms apart (so a flicker never causes a tap), then one tap, then a check that it really turned ON.
var autoWatchBusy = false;
function watchAuto() {
  if (!C.autoCheck || needReturn || autoWatchBusy) return;
  if (Date.now() - autoLastTap < autoBackoff) return;
  autoWatchBusy = true;
  try {
    if (!autoLooksOff()) { autoOffCount = 0; return; }
    sleep(250);
    if (!autoLooksOff()) { autoOffCount = 0; return; }
    autoOffCount = 0;
    log("auto attack is OFF -> tap AUTO");
    tapGame(P_AUTO, "AUTO attack");
    var ok = false;
    for (var k = 0; k < 4 && !ok; k++) { sleep(350); ok = autoOn(true); }
    autoLastTap = Date.now();
    autoBackoff = ok ? 1500 : 20000;       // ON: look again very soon; still off: wait 20 s (a 2nd tap could switch it off again)
    log(ok ? "auto attack ON" : "auto still looks off - pausing the auto check for 20s");
  } finally { autoWatchBusy = false; }
}

// ---- "Unlimited Warp" purchase prompt (600 gems): must NEVER be confirmed, always cancelled ----
var P_BUY_CANCEL = [1240, 771];                 // grey "Cancel" button of that prompt
var R_BUY_BLUE = [700, 745, 1010, 800];         // blue "600 gems" button (buy) - only used to recognise the prompt
var R_BUY_GREY = [1090, 745, 1400, 800];        // grey "Cancel" button
function isGreyBtn(c) {
  var r = colors.red(c), g = colors.green(c), b = colors.blue(c);
  return r > 60 && r < 170 && b >= r && (b - r) < 60 && Math.abs(g - r) < 30;
}
function buyPromptVisible() {
  var img = grab();
  if (!img) return false;
  var blue = fracIn(img, R_BUY_BLUE, isBtnBlue), grey = fracIn(img, R_BUY_GREY, isGreyBtn);
  img.recycle();
  return blue > 0.5 && grey > 0.5;
}

// true only after a death: the map return is needed. After a plain game reopen the character is still on its spot.
var needReturn = false;

// return to spot
function returnToSpot() {
  log("RETURN -> X" + C.x + " Y" + C.y);
  var opened = false;
  for (var i = 0; i < 3 && !opened; i++) {
    if (gpsOpen()) { opened = true; break; }
    tapGame(P_OPEN_GPS, "open GPS");
    sleep(1800);
    opened = gpsOpen();
  }
  if (!opened) { log("GPS did not open - change P_OPEN_GPS to the button that opens it"); return false; }

  var pt = coordToPoint(C.x, C.y);
  log("map point (game space) " + Math.round(pt[0]) + "," + Math.round(pt[1]));
  tapGame(gpsMapPt(pt), "map X" + C.x + " Y" + C.y);
  sleep(900);

  tapGame(gpsPt(P_GPS_WARP), "Unlimited Warp");
  sleep(1500);
  if (buyPromptVisible()) {
    tapGame(P_BUY_CANCEL, "Cancel (never buy)");
    sleep(900);
    needReturn = false;
    log("warp prompt appeared -> cancelled (already on the spot, or no unlimited warp)");
    if (gpsOpen()) { tapGame(gpsPt(P_GPS_CLOSE), "close GPS"); sleep(800); }
    ensureAuto();
    return false;
  }
  sleep(2500);

  if (gpsOpen()) {
    tapGame(gpsPt(P_GPS_CLOSE), "close GPS");
    sleep(800);
  }
  log("arrived at spot");
  needReturn = false;
  ensureAuto();
  log("return done");
  return true;
}

// respawn
function respawn() {
  log("DEAD -> respawn");
  needReturn = true;
  autoBlindDone = false; autoOffCount = 0; autoBackoff = 0; autoLastTap = 0;   // dying switched AUTO off: tap it again after the return
  sleep(600);
  tapGame(P_WARP, "warp");
  sleep(700);
  tapGame(P_OK, "ok");
  sleep(2500);
  if (dialogVisible()) {
    method = (method + 1) % METHODS.length;
    log("still dead, switching tap method -> " + method);
    return;
  }
  log("respawned OK");
  closePenalty(4000);                       // the Character Penalty popup appears after respawn: tap OK before anything else
  sleep(C.wait);
  closePenalty(0);                          // it can also show up late
  returnToSpot();
}

// after the game was reopened / reconnected / logged in again: always go back to the spot
function afterRelog() {
  log("logged in again -> return to spot");
  autoBlindDone = false;   // game restarted: AUTO is off again, allow one tap
  returnToSpot();       // also cancels the 600-gem warp prompt if it shows up (e.g. already on the spot)
}

// ===== AUTO-DETECT CHARACTER: set the saved spot from the character marker on the GPS map =====
// The character is the cyan circle with a white pointer and a translucent view cone. Warp points are cyan circles
// too, so every candidate is compared with the warp-point arrow glyph and rejected when it matches.
var PORTAL_TPL_HEX = [
  "faf0eaeae8d9eaeeedececedece2d8dde5f2f8ebeadbe8efe2d6c6c5bed1d6e7eadfd8ebedecd7ede6cdbbbfc1c8c6cbbbb2d3e3e2dbedd8ede1bdc2ccd3ba8c98a68e99aab8e3e2e1e5e4bcc4cccfa1cee3e4dbdbd5c99ab9dfd8ebc5b7c5d1b5c3e8e1dcd59c7e8184a0cbeae5a6c6cdcb9be4dee2dd9f93b2bed0cfb7eecbb9c1b9b4a8e4e5e8d99eb9c3d1d7d2bee9bbc6baceb1d1e9f1f1deccd9d1d5d2dbd8e6b3b9c2c0b3daf2f8f9ece2e2dddddfdbd9e5b2af939a99e4eff7faeed5c6bccddedbd9e8baba98d3e1e5ebf2f7f7ede3b6b3d8dcd6e8ccc2c89dd6d7e3e7ebebe2cb96dadcd8d0e5dbbfcfbc9cd5d9dfdae1c4a1c7dbded6c6dae5c6cad2c6a2d4d6d8bf9ecad5d8dac9d3dae4dfc2c7cfb3a8cebfa4c9d7dbd9cec9e6e7d8e7dcc7c4cfc3b8b3c7d5d6dacbcee5ecede3dce8e5cbc4c8c8cad2d4ccc6d4e9efe1",
  "decdece7e1d8cecfcfcfd8e2edebdbcbd7b6d2eae9dcced0c8bcc0c6c3c0cbe5e9deccd3e2ead4d0cec1a5d9ddded9d5cdc9e5eed6d2ebe1cecec8a1dbdcd8dbc89db5bfc7e6e7ceebd1ccc998bbe1dcddbd7792b9c8c4d2ecd4e4cccebb7ee1e2e1e4918da3c0c4cbcae6e0d5ccc3ae91e3e9edea97a1aaa7acd1cedbe3cec9bbab9ae5f0f8f5b9ab91a0b4c7cbd1e9ceb4927897e5f2f8f9c5b3b9b7afcac9d3ebd6c0cddbdedfecf6f6ece2d085a2cbd3d5e7d7d0a1cdd6dde0eae8e3d67f8ac1cacee6e3e4cec2a1c5d2dcdad6db8380aec4c8cbe9d7e8d6cfbda2c7d1d7d8847e90c4c8c1d5e3c8dee3d0d1bfa7cbcd938bacbac9cbcce5d1c9d5e0e6d5d0c5beb1a9c3cbccc8cce3ddc3d0cfcfe3e7ddd2c9c8cbc8c8c9d6e2dac7cdc2dfcfccdce6e8dedcd8d7dce3e5d2c1cccb8cc4e1d8cecbd6dfe4e9e5dbd2c5c5d3ca8d74",
  "ee8d50a96e616a8aa393795f4b8de3bd8d76a84e51be6aa0e6dfdee0d2c1924f97e2a57a555b5cde74e9dde1e2a9667d575051c3c79049607fcbe2e7dfe5bd91d0d484665a7ee39f61658592e6e5e9ecacd7e3e08c646859d4af5e636f6de9f1f3f4c9cb98a575808760c1be5e648d75e8f4fcf8d9dd968a8f919768b1c454a9b5b2e9f0fcfcdfc38e779a999368b5c16880e3e1e5ebf4f7f1e8d179979d965cc2b1778384d8dae2e8e9e7d47d96a69d9061d199689e858dd8dadbddcd818ea0a09a7c9dce9c5c95a57d95d5d5d08186a9a4a29656d3a2a4c75999a26f96cd6984a4a7a39c57c2cb9aa0d0d04e7da363557298a5a9995dbed0899ec49ccfdd774d6c81708a87527cd5cf93b7baf3afa1abd1cfd3927d8cd2d9d5b993afbdf3f6daa7ae909ec6d2d0d0c8a188a9a8c6eefaf6f1eac4ada99c969496a2a4a0b0def0f8f3c8",
  "a8c1b2a0dce1c088707a6e7582b1dcdba7a7bdb5a9e1d9876870696d5d6065727cbee0adc6a3dfcd81716f67539ed1c9caa86b71b6ddb3c7dc86746e7152d8d8e0d9d6b29f9177c9a8e0a079707263c6e1dad8c9606e5d666a86c1e0736a73665adcdbe0dc6a688a8f657371dabb73755abf72e6e6e4db86c47eae6c7b7adaa4766cb369a9e8eef1e6bde080cc6d7073d89f72606a6cb2ebf2faf1ceda84d5716f88d9a66d8bd2ccd9e9eef5f0a989705f749675d0bf6f6297d2dddde7ecefe7da83596e9480b2d979735c8bcfd6dae2e1d38d5a75bd7175a1d9957e78628bcdd8d1d58970b6a2718a86a8bdcc7687856392c9cc825d83616e887bc4cba0cfc77d8586608e845b6471837d7ab9d7d6b8a4d0c9847f88675981727c8175bfdbacd4d0b7a4c9d7ae82797370747ca6d6d4a4afcad0d4c0a5accedadbc7c8d3dad5b79fb7cd"
];
var PORTAL_TPL = null;
function portalTpls() {
  if (PORTAL_TPL) return PORTAL_TPL;
  PORTAL_TPL = PORTAL_TPL_HEX.map(function (h) {
    var a = [];
    for (var i = 0; i + 1 < h.length; i += 2) a.push(parseInt(h.substr(i, 2), 16));
    return a;
  });
  return PORTAL_TPL;
}
function spix(img, p) { try { return pix(img, p); } catch (e) { return 0; } }
function grayOf(c) { return 0.299 * colors.red(c) + 0.587 * colors.green(c) + 0.114 * colors.blue(c); }
function tplSample(img, cx, cy, an) {
  var out = [];
  for (var y = cy - 18; y < cy + 18; y += 2)
    for (var x = cx - 18; x < cx + 18; x += 2) out.push(grayOf(spix(img, [x, y, an])));
  return out;
}
function nccArr(p, q) {
  var n = p.length, mp = 0, mq = 0, i;
  for (i = 0; i < n; i++) { mp += p[i]; mq += q[i]; }
  mp /= n; mq /= n;
  var sp = 0, sq = 0, sx = 0;
  for (i = 0; i < n; i++) { var da = p[i] - mp, db = q[i] - mq; sp += da * da; sq += db * db; sx += da * db; }
  if (sp < 1 || sq < 1) return 0;
  return sx / Math.sqrt(sp * sq);
}
function portalScore(img, cx, cy, an) {      // best match of the warp-point glyph around (cx,cy), -1..1
  var T = portalTpls(), best = -1;
  for (var dy = -6; dy <= 6; dy += 2) {
    for (var dx = -6; dx <= 6; dx += 2) {
      var s = tplSample(img, cx + dx, cy + dy, an);
      for (var t = 0; t < T.length; t++) { var v = nccArr(s, T[t]); if (v > best) best = v; }
    }
  }
  return best;
}
function coreFrac(img, cx, cy, an) {         // share of near-white cyan pixels inside the circle
  var n = 0, t = 0;
  for (var y = cy - 26; y <= cy + 26; y += 2) {
    for (var x = cx - 26; x <= cx + 26; x += 2) {
      if ((x - cx) * (x - cx) + (y - cy) * (y - cy) > 676) continue;
      t++;
      var c = spix(img, [x, y, an]);
      if (colors.green(c) >= 244 && colors.blue(c) >= 244) n++;
    }
  }
  return t ? n / t : 0;
}
// returns { x, y } in the same game space as MAP (anchor `an`), or null when no character marker is found
function detectPlayer(img, an) {
  var B = 24, cells = {}, x, y, k;
  for (y = MAP.t - 30; y < MAP.b + 30; y += 3) {
    for (x = MAP.l - 30; x < MAP.r + 30; x += 3) {
      var c = spix(img, [x, y, an]);
      var r = colors.red(c), g = colors.green(c), b = colors.blue(c);
      if (r < 130 && g > 170 && b > 190 && (b - r) > 80) {
        k = Math.floor(x / B) + "," + Math.floor(y / B);
        (cells[k] = cells[k] || []).push([x, y]);
      }
    }
  }
  var seen = {}, best = null;
  for (k in cells) {
    if (seen[k]) continue;
    var stack = [k], grp = [];
    seen[k] = true;
    while (stack.length) {
      var cc = stack.pop(), ij = cc.split(","), ci = parseInt(ij[0], 10), cj = parseInt(ij[1], 10);
      grp = grp.concat(cells[cc]);
      for (var di = -1; di <= 1; di++) for (var dj = -1; dj <= 1; dj++) {
        var nk = (ci + di) + "," + (cj + dj);
        if (cells[nk] && !seen[nk]) { seen[nk] = true; stack.push(nk); }
      }
    }
    if (grp.length < 25) continue;
    var sx = 0, sy = 0;
    for (var i = 0; i < grp.length; i++) { sx += grp[i][0]; sy += grp[i][1]; }
    var mx = Math.round(sx / grp.length), my = Math.round(sy / grp.length);
    var core = coreFrac(img, mx, my, an);
    if (core < 0.3) continue;
    var ps = portalScore(img, mx, my, an);
    log("marker candidate " + mx + "," + my + " core " + core.toFixed(2) + " warp-match " + ps.toFixed(2) + (ps >= 0.5 ? " (warp point)" : ""));
    if (ps >= 0.5) continue;
    if (!best || core > best.core) best = { x: mx, y: my, core: core };
  }
  return best;
}
function detectSpot() {
  log("SET SPOT: opening the GPS map");
  var opened = false;
  for (var i = 0; i < 3 && !opened; i++) {
    if (gpsOpen()) { opened = true; break; }
    tapGame(P_OPEN_GPS, "open GPS");
    sleep(1800);
    opened = gpsOpen();
  }
  if (!opened) { log("GPS did not open - open the game first, or change P_OPEN_GPS"); return false; }
  sleep(700);
  var an = gpsAnchor === "R" ? "L" : "C", hit = null;
  for (var t = 0; t < 3 && !hit; t++) {
    var img = grab();
    if (!img) { log("no image"); break; }
    try { hit = detectPlayer(img, an); } catch (e) { log("detect err: " + e); }
    img.recycle();
    if (!hit) sleep(700);
  }
  if (gpsOpen()) { tapGame(gpsPt(P_GPS_CLOSE), "close GPS"); sleep(800); }
  if (!hit) { log("character marker not found - open GPS on the map you are standing in"); return false; }
  var X = Math.round(((hit.x - C.dx) - MAP.l) / (MAP.r - MAP.l) * MAP.max);
  var Y = Math.round((MAP.b - (hit.y - C.dy)) / (MAP.b - MAP.t) * MAP.max);
  X = Math.max(0, Math.min(255, X)); Y = Math.max(0, Math.min(255, Y));
  log("character found -> saved spot X" + X + " Y" + Y);
  C.x = X; C.y = Y;
  saveCfg(C);
  ui.run(function () { V("ix").setText(String(X)); V("iy").setText(String(Y)); updatePreview(); });
  return true;
}
function setSpotRun() {
  try { logDevice(); } catch (e) {}
  try { if (auto.service == null) { log("AutoX accessibility service is OFF - turn it ON"); auto.waitFor(); } } catch (e) {}
  if (!ensureCapture()) return;
  try { refitView(); } catch (e) { log("detect err: " + e); }
  detectSpot();
}

// ===== OPEN CABAL =====
var gamePkgs = { mobile: null, ra: null }, pkgScanAt = 0, pkgLogged = false;
var RA_RE = /return.?of.?action|returnofaction|cabalra|cabal_ra/i;   // CABAL: Return of Action (everything else with "cabal" = Cabal Mobile)
function isRA() { return C.game === "ra"; }
function gameName() { return isRA() ? "Cabal Return of Action" : "Cabal Mobile"; }
function findCabalPkg() {
  var ov = isRA() ? C.pkgRA : C.pkg;
  if (ov) return ov;
  if (gamePkgs[C.game]) return gamePkgs[C.game];
  if (Date.now() - pkgScanAt < 30000) return null;   // not found: retry the scan at most every 30 s
  pkgScanAt = Date.now();
  var cands = [];
  try {
    var pm = context.getPackageManager();
    var list = pm.getInstalledApplications(0);
    for (var i = 0; i < list.size(); i++) {
      var ai = list.get(i);
      var label = String(pm.getApplicationLabel(ai));
      var pn = String(ai.packageName);
      if (/cabal|카발/i.test(label) || /cabal/i.test(pn)) cands.push({ pn: pn, label: label });
    }
  } catch (e) { log("pkg scan err: " + e); }
  if (!cands.length) {
    try {
      var r = shell("pm list packages", hasRoot);
      var all = String(r.result || "").match(/package:([^\s]*cabal[^\s]*)/gi) || [];
      for (var j = 0; j < all.length; j++) cands.push({ pn: all[j].replace(/^package:/i, ""), label: "" });
    } catch (e2) {}
  }
  var ra = null, mob = null;
  for (var k = 0; k < cands.length; k++) {
    var isR = RA_RE.test(cands[k].label + " " + cands[k].pn);
    if (isR && !ra) ra = cands[k].pn;
    if (!isR && !mob) mob = cands[k].pn;
  }
  gamePkgs.ra = ra; gamePkgs.mobile = mob;
  if (!pkgLogged) {
    pkgLogged = true;
    for (var m = 0; m < cands.length; m++) log("installed: " + cands[m].pn + (cands[m].label ? "  (" + cands[m].label + ")" : ""));
  }
  var p = gamePkgs[C.game];
  if (p) log("found " + gameName() + " package: " + p);
  else log(gameName() + " package not found - type it in the Package box");
  return p;
}
function openGame(pkg) {
  if (!pkg) { log(gameName() + " not found - type its package name in the panel"); return false; }
  log("opening " + pkg);
  var ok = false;
  try { ok = app.launchPackage(pkg); } catch (e) { log("launch err: " + e); }
  if (!ok && hasRoot) shell("monkey -p " + pkg + " -c android.intent.category.LAUNCHER 1", true);
  return true;
}
function gameAlive(pkg) {   // true / false, or null when it cannot be told (no root)
  if (!hasRoot || !pkg) return null;
  try {
    var r = shell("pidof " + pkg, true);
    if (String(r.result || "").replace(/\s/g, "").length > 0) return true;
    r = shell("ps -A | grep " + pkg, true);
    return String(r.result || "").indexOf(pkg) >= 0;
  } catch (e) { return null; }
}
function curPkg() {
  try {                                   // live window first: currentPackage() can stay stale after the app closes
    var root = auto.root;
    if (root) { var n = String(root.packageName() || ""); if (n) return n; }
  } catch (e) {}
  try { return String(currentPackage() || ""); } catch (e) { return ""; }
}
function ensureGame() {   // returns "none" | "open" | "launched"
  var pkg = findCabalPkg();
  if (!pkg) { log(gameName() + " not found - type its package name in the panel"); return "none"; }
  if (curPkg() === pkg) { log(gameName() + " already open"); return "open"; }
  openGame(pkg);
  log("waiting " + Math.round(C.openWait / 1000) + "s for the game to load");
  sleep(C.openWait);
  return "launched";
}

// ===== ENTER GAME: title screen ("Please Tap the Screen") + character select ("Game start") =====
var P_TAP = [1046, 589];                       // anywhere on the title screen
var P_START = [1791, 1100];
var selAnchor = "C";                           // which anchor matched the Game start button                    // "Game start" button (character select)
var R_BLUE = [765, 922, 960, 1002];            // title: blue server / channel name (x0,y0,x1,y1 game space)
var R_CHG = [1205, 930, 1340, 995];            // title: white "Change Server" text (always visible, unlike the pulsing tap text)
var R_TEXT = [865, 792, 1225, 832];            // title: "Please Tap the Screen" text
var R_BTN = [1600, 1070, 1990, 1140];          // select: blue "Game start" button
var R_BTNTXT = [1700, 1090, 1900, 1115];       // select: white "Game start" text
// ===== GAME PROFILES: entry-screen positions per game =====
// "mobile" is calibrated. "ra" (CABAL: Return of Action) starts as a copy: opening / reopening works, but the
// Game start / PIN detection only fires if its screens look like Cabal Mobile's. Calibrate by editing PROFILES.ra.
var PROFILES = {
  mobile: { P_TAP: P_TAP, P_START: P_START, R_BLUE: R_BLUE, R_CHG: R_CHG, R_TEXT: R_TEXT, R_BTN: R_BTN, R_BTNTXT: R_BTNTXT },
  ra:     { P_TAP: P_TAP, P_START: P_START, R_BLUE: R_BLUE, R_CHG: R_CHG, R_TEXT: R_TEXT, R_BTN: R_BTN, R_BTNTXT: R_BTNTXT }
};
function applyGame() {
  var p = PROFILES[C.game] || PROFILES.mobile;
  P_TAP = p.P_TAP; P_START = p.P_START; R_BLUE = p.R_BLUE; R_CHG = p.R_CHG; R_TEXT = p.R_TEXT; R_BTN = p.R_BTN; R_BTNTXT = p.R_BTNTXT;
}
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
function isTitleBlue(c) { var r = colors.red(c), b = colors.blue(c); return b > 140 && (b - r) > 45; }
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
  var pin = String(C.pin || "");
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
    sleep(450);
  }
  tapGame(P_PIN_OK, "pin OK");
  sleep(3500);
  return true;
}

// returns "pin" | "title" | "select" | ""
function screenState() {
  var img = grab();
  if (!img) return "";
  var st = "";
  if (fracIn(img, R_PIN_RESET, isBtnBlue) > 0.5 && fracIn(img, R_PIN_TITLE, isTitleWhite) > 0.1) st = "pin";
  else if (fracIn(img, R_BLUE, isTitleBlue) > 0.04 && (fracIn(img, R_TEXT, isTitleWhite) > 0.012 || fracIn(img, R_CHG, isTitleWhite, 3) > 0.08)) st = "title";
  else {
    var ans = ["C", "R"];               // 16:9 screens: same place; wide screens: button sticks to the right edge
    for (var q = 0; q < ans.length && !st; q++) {
      if (fracIn(img, R_BTN, isBtnBlue, 4, ans[q]) > 0.5 && fracIn(img, R_BTNTXT, isTitleWhite, 4, ans[q]) > 0.06) { st = "select"; selAnchor = ans[q]; }
    }
  }
  img.recycle();
  return st;
}
// waitMs = how long to wait for an entry screen to show up (0 = check once)
function enterGame(waitMs) {
  var t0 = Date.now(), acted = 0, lastAct = 0, srvTaps = 0;
  while (true) {
    if (srvTaps < 6 && closeServerPopup()) { srvTaps++; continue; }     // "Server connection lost" covers the title screen
    var st = screenState();
    if (st) {
      acted++;
      lastAct = Date.now();
      if (st === "pin") {
        if (pinBlocked) { log("sub-password already failed this run - enter it by hand, then press START again"); return false; }
        if (!enterPin()) return false;
        if (screenState() === "pin") {
          pinBlocked = true;
          log("sub-password dialog still open after OK - stopped to avoid wrong attempts");
          return false;
        }
        continue;
      }
      if (st === "title") tapGame(P_TAP, "tap to enter game");
      else tapGame([P_START[0], P_START[1], selAnchor], "Game start");
      if (acted >= 12) { log("entry screens still showing after 12 taps"); return false; }
      sleep(4000);
    } else if (acted > 0) {
      // loading between screens: give the next one a few seconds to appear
      if (Date.now() - lastAct < 14000) { sleep(1000); continue; }
      log("entered game");
      return true;
    } else {
      if (Date.now() - t0 >= waitMs) return false;
      sleep(1500);
    }
  }
}

// ===== POPUPS: "Hot Item" (Close for today) + "Daily Login Reward" (claim the highlighted day) =====
var R_HOT = [441, 112, 1651, 777];             // Hot Item: big purple/blue banner area
var R_DAILY = [466, 137, 1636, 797];           // Daily Login Reward: 28-day grid
var P_HOT_TODAY = [590, 1125];                 // "Close for today"
var P_HOT_X = [1650, 64];                      // Hot Item X (fallback)
var P_DAILY_X = [1620, 72];                    // Daily Login Reward X
function isHotBlue(c) { var r = colors.red(c), g = colors.green(c), b = colors.blue(c); return b > 150 && r < 150 && (b - g) > 50; }
function isDarkPanel(c) { var r = colors.red(c), g = colors.green(c), b = colors.blue(c); return r < 75 && g < 85 && b < 100 && b >= r - 5; }
function isHiBlue(c) { var r = colors.red(c), g = colors.green(c), b = colors.blue(c); return r < 60 && g > 95 && b > 165 && (b - r) > 115; }

// bright-blue border of the reward that can be claimed: biggest connected cluster of bright-blue pixels
function findHighlight(img) {
  var B = 24, cells = {}, k, x, y;
  for (y = R_DAILY[1]; y < R_DAILY[3]; y += 5) {
    for (x = R_DAILY[0]; x < R_DAILY[2]; x += 5) {
      if (isHiBlue(pix(img, [x, y]))) {
        k = Math.floor(x / B) + "," + Math.floor(y / B);
        (cells[k] = cells[k] || []).push([x, y]);
      }
    }
  }
  var seen = {}, best = null;
  for (k in cells) {
    if (seen[k]) continue;
    var stack = [k], grp = [];
    seen[k] = true;
    while (stack.length) {
      var c = stack.pop(), ij = c.split(","), ci = parseInt(ij[0], 10), cj = parseInt(ij[1], 10);
      grp = grp.concat(cells[c]);
      for (var di = -1; di <= 1; di++) for (var dj = -1; dj <= 1; dj++) {
        var nk = (ci + di) + "," + (cj + dj);
        if (cells[nk] && !seen[nk]) { seen[nk] = true; stack.push(nk); }
      }
    }
    if (!best || grp.length > best.length) best = grp;
  }
  if (!best || best.length < 80) return null;
  var x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (var i = 0; i < best.length; i++) {
    x0 = Math.min(x0, best[i][0]); x1 = Math.max(x1, best[i][0]);
    y0 = Math.min(y0, best[i][1]); y1 = Math.max(y1, best[i][1]);
  }
  return [Math.round((x0 + x1) / 2), Math.round((y0 + y1) / 2)];
}
// returns { state: "hot" | "daily" | "", hl: [x,y] | null }
function popupState() {
  var img = grab();
  if (!img) return { state: "", hl: null };
  var res = { state: "", hl: null };
  if (fracIn(img, R_HOT, isHotBlue, 8) > 0.25) res.state = "hot";
  else if (fracIn(img, R_DAILY, isDarkPanel, 8) > 0.6) {
    var hl = findHighlight(img);
    if (hl) { res.state = "daily"; res.hl = hl; }
  }
  img.recycle();
  return res;
}
function closeHotItem() {
  log("Hot Item popup -> Close for today");
  tapGame(P_HOT_TODAY, "close for today");
  sleep(1300);
  if (popupState().state === "hot") {
    tapGame(P_HOT_X, "close Hot Item X");
    sleep(1000);
  }
}
function claimDaily(first) {
  log("Daily Login Reward popup");
  var hl = first, tries = 0, total = 0;
  while (hl && tries < 2 && total < 8 && running) {
    total++;
    tapGame(hl, "claim highlighted reward");
    sleep(1800);
    tries++;
    var st = popupState();
    if (st.state !== "daily") break;                     // popup changed (reward window) -> handled below
    hl = st.hl;
    if (hl && Math.abs(hl[0] - first[0]) + Math.abs(hl[1] - first[1]) > 60) { first = hl; tries = 0; }  // next day got highlighted
  }
  var s2 = popupState();
  if (s2.state === "daily" || s2.state === "") {
    tapGame(P_DAILY_X, "close Daily Login");
    sleep(1000);
  }
}
// after entering the game: keep looking for popups for a while (Hot Item / Daily Login show up a few seconds after the world loads)
function waitPopups(ms) {
  if (!C.autoPopup) return;
  var t0 = Date.now(), limit = ms, rounds = 0;
  while (Date.now() - t0 < limit && running && rounds < 6) {
    if (handlePopups()) { rounds++; t0 = Date.now(); limit = 6000; }   // closed one: wait a little for the next
    else sleep(1500);
  }
}
function handlePopups() {
  if (!C.autoPopup) return false;
  var did = false;
  for (var i = 0; i < 4; i++) {
    var st = popupState();
    if (!st.state) break;
    did = true;
    if (st.state === "hot") closeHotItem();
    else claimDaily(st.hl);
    sleep(700);
  }
  if (did) log("popups handled");
  return did;
}

// ===== ENGINE: run / stop =====
function runEngine(testOnly, loginOnly) {
  if (C.showConsole) console.show(); else { try { console.hide(); } catch (e) {} }
  log(loginOnly ? "== Open + Login ==" : "== Respawn + Return == " + (testOnly ? "(test)" : "(run)"));
  try { logDevice(); } catch (e) { log("device info err: " + e); }
  try {
    if (auto.service == null) { log("AutoX accessibility service is OFF - turn it ON, the script continues by itself"); auto.waitFor(); }
  } catch (e) {}
  log("step 1: open the game");
  var st = C.autoOpen ? ensureGame() : "skip";
  log("step 2: screen capture");
  if (!ensureCapture()) return;
  log("step 3: detect the game screen");
  try { refitView(); } catch (e) { log("detect err: " + e); }
  log("step 4: enter the game");
  var entered;
  if (loginOnly) {               // play button: open the app, Game start + sub-password PIN, then ALWAYS carry on into the respawn watch
    log("tap Game start + PIN");
    entered = enterGame(st === "launched" ? 90000 : 25000);     // always on here, whatever the "Auto enter game" switch says
    log(entered ? "login done (Game start + PIN) - play keeps the game open" : "no entry screen found (already in game) - play keeps the game open");
    setStatus("run");
  } else {
    entered = C.autoEnter && enterGame(st === "launched" ? 90000 : 0);
  }
  if (entered) { try { refitView(); } catch (e) {} sleep(Math.max(C.wait, 10000)); }
  if (!testOnly) {
    if (entered) waitPopups(15000); else handlePopups();
    if (entered) afterRelog();     // we just logged in -> go to the saved spot
    else ensureAuto();             // activated in-game: tap AUTO once (only if it is off)
  }
  if (testOnly) {
    var timg = grab();
    if (timg) timg.recycle();
    returnToSpot();
    return;
  }
  log("watching for death...");
  var ownPkg = String(context.getPackageName());
  var miss = 0, loopN = 0, srvN = 0;
  while (running) {
    try {
      if (dgBusy) { sleep(1000); continue; }          // Daily DG is tapping: engine waits so the taps never collide
      srvN++;
      if (C.autoEnter && srvN % 3 === 0 && closeServerPopup()) {      // disconnected: Confirmation, then log in again like after a reopen
        log("disconnected -> logging in again");
        sleep(2500);
        var again = enterGame(90000);
        if (again) {
          refitView();
          sleep(Math.max(C.wait, 10000));
          waitPopups(15000);
          afterRelog();                              // go back to the spot + AUTO
        }
        continue;
      }
      if (C.autoOpen) {
        var pkg = findCabalPkg(), cp = curPkg();
        var other = pkg && cp && cp !== pkg && cp !== ownPkg &&
                    cp.indexOf("systemui") < 0 && !/inputmethod|keyboard/i.test(cp);
        var gone = pkg && !cp;                       // no window reported = app closed / crashed
        var dead = pkg && gameAlive(pkg) === false;  // process not running (needs root)
        miss = (other || gone || dead) ? miss + 1 : 0;
        if (pkg && (dead ? miss >= 2 : miss >= 6)) {
          var fresh = dead || !other;                // closed / crashed -> cold start; only in the background -> bring to front
          log(gameName() + " " + (fresh ? "closed" : "in background") + " (" + (dead ? "not running" : (cp || "no window")) + ") -> reopen");
          miss = 0;
          openGame(pkg);
          sleep(fresh ? C.openWait : 3000);
          if (fresh && curPkg() !== pkg) { log("still not open - trying again"); openGame(pkg); sleep(C.openWait); }
          var back = C.autoEnter && enterGame(fresh ? 90000 : 12000);     // AUTO LOGIN: only here, after the game was off / closed
          if (back) {
            refitView();
            sleep(Math.max(C.wait, 10000));
            waitPopups(15000);
            afterRelog();                            // go back to the spot + AUTO
          }
          continue;
        }
      }
      loopN++;
      if (C.autoFit && (VIEW_OK ? loopN % 300 === 0 : loopN % 20 === 0)) needFit = true;   // re-detect (retry if unsure)
      // inside the game ONLY a death is handled: respawn -> return to spot -> AUTO
      // (no entry-screen taps, no popup taps, no extra AUTO taps while playing)
      if (C.autoPopup && loopN % 5 === 0 && popupState().state === "hot") closeHotItem();   // Hot Item can pop up at any time
      // deaths are handled by the separate RESPAWN script (RESPAWN button), not by the play engine
      if (C.autoCheck) watchAuto();                      // AUTO attack went off -> switch it on again right away
    } catch (e) {
      if (!running) break;
      log("loop err: " + e);
    }
    if (!running) break;
    sleep(C.check);
  }
}

var keepRun = false;                     // true = the user wants it running; only STOP (or logout/expiry) clears it
function startEngine(testOnly, loginOnly) {
  if (worker && worker.isAlive()) { log("already busy"); return; }
  if (dgBusy) { log("daily dg is running - stop it first"); toast("Daily DG is running - stop it first"); return; }
  releaseFocus();
  C = readInputs();
  saveCfg(C);
  pinBlocked = false;
  autoBlindDone = false; autoOffCount = 0; autoLastTap = 0; autoBackoff = 0;
  running = !testOnly;
  keepRun = !testOnly;
  setStatus(testOnly ? "test" : (loginOnly ? "login" : "run"));
  worker = threads.start(function () {
    var first = true, quick = 0;
    while (true) {
      var t0 = Date.now();
      try {
        runEngine(testOnly, first ? loginOnly : false);
      } catch (e) {
        if (running || testOnly) log("stopped: " + e);
      }
      first = false;
      if (testOnly || !keepRun) break;                                  // test run, or the user pressed STOP
      quick = (Date.now() - t0 < 20000) ? quick + 1 : 0;                // engine died almost at once: do not loop forever
      if (quick >= 3) { log("engine keeps ending right away - gave up, press play to retry"); toast("Engine stopped - press play"); break; }
      log("engine ended - restarting in 5s");
      try { sleep(5000); } catch (e) { break; }
      if (!keepRun) break;
      running = true; setStatus("run");
    }
    running = false; keepRun = false;
    setStatus("idle");
    log(testOnly ? "test finished" : "stopped");
  });
}
function stopEngine() {
  keepRun = false;
  running = false;
  if (worker && worker.isAlive()) worker.interrupt();
  setStatus("idle");
}
function haltAll() {                    // logout / expiry / wrong device: stop the play engine, the RESPAWN script AND the daily-dungeon queue
  stopEngine();
  try { stopRespawn(); } catch (e) {}
  dgCancel = !!dgBusy; dgTried = {}; dgForce = {}; dgPending = false; dgGoAt = 0; dgArmed = false;
  try { dgBtnSync(); } catch (e) {}
}

// ===== PANEL EVENTS =====
var expanded = true;
function setExpanded(v) {
  expanded = v;
  V("bodyScroll").setVisibility(v ? android.view.View.VISIBLE : android.view.View.GONE);
  V("gear").setText(v ? "▲" : "⚙");
  if (!v) releaseFocus();
  try { applyLogForPanel(); } catch (e) {}
}
function applyLogForPanel() {          // log window follows the panel: minimized -> full log on screen, expanded -> tucked away
  var dm = new android.util.DisplayMetrics();
  context.getSystemService("window").getDefaultDisplay().getRealMetrics(dm);
  var land = dm.widthPixels > dm.heightPixels, d = dm.density;
  ui.run(function () {
    var View = android.view.View;
    V("lroot").setVisibility(View.GONE);                        // the log lives under the panel header in portrait and landscape
  });
}

V("fb").on("click", function () { if (running || (worker && worker.isAlive())) stopEngine(); else startEngine(false, true); });   // play: open app + login + PIN only
V("btnResp").on("click", function () { if (respAlive()) stopRespawn(); else startRespawn(); });
function gameSync() {
  ui.run(function () {
    try {
      V("btnGame").setText("GAME: " + (isRA() ? "CABAL RETURN OF ACTION" : "CABAL MOBILE") + "  (tap to switch)");
      V("btnGame").setBackgroundColor(android.graphics.Color.parseColor(isRA() ? "#8a5a1a" : "#2f5fb3"));
      V("ipkg").setText(String((isRA() ? C.pkgRA : C.pkg) || ""));
    } catch (e) {}
  });
}
V("btnGame").on("click", function () {
  if (running || (worker && worker.isAlive()) || respAlive()) { toast("Stop first, then switch game"); return; }
  releaseFocus();
  var t = String(V("ipkg").getText()).trim();
  if (isRA()) C.pkgRA = t; else C.pkg = t;            // keep what was typed for the game we are leaving
  C.game = isRA() ? "mobile" : "ra";
  saveCfg(C); applyGame(); pkgScanAt = 0;
  gameSync();
  log("game: " + gameName());
});   // own script: independent of the play button
V("btnDG").on("click", function () {
  if (dgBusy || dgPending || dgArmed) {                        // ON -> OFF: stop / disarm
    dgCancel = !!dgBusy; dgTried = {}; dgForce = {}; dgPending = false; dgGoAt = 0; dgArmed = false;
    toast("Daily DG OFF");
  } else {                                                     // OFF -> ON
    dgArmed = true;                                            // button turns ON right away
    try { dgSelLoadIfEmpty(); } catch (el) {}                  // saved ON dungeons come back
    if (dgNextSel()) { dgRunQueue(); toast("Daily DG ON"); }   // dungeons already switched ON in the list: start them
    else { toast("Daily DG ON - switch the dungeons you want ON"); if (!dpw) openDaily(); }   // otherwise open the list to pick
  }
  dgBtnSync();
});
V("gear").on("click", function () { setExpanded(!expanded); });
V("btnTest").on("click", function () { startEngine(true); });
V("btnSetSpot").on("click", function () {     // open GPS, find the character marker, fill X / Y
  if (running || (worker && worker.isAlive()) || respAlive()) { toast("Stop the script first"); return; }
  releaseFocus();
  C = readInputs();
  setStatus("test");
  worker = threads.start(function () {
    try { setSpotRun(); } catch (e) { log("set spot err: " + e); }
    setStatus("idle");
    log("spot done");
  });
});
V("btnSave").on("click", function () {
  C = readInputs();
  saveCfg(C);
  releaseFocus();
  toast("Saved");
});
function clearLog() { logLines = []; ui.run(function () { V("logv").setText(""); V("logv2").setText(""); }); }
V("btnClear").on("click", clearLog);
V("lclear").on("click", clearLog);
var logMin = false;   // minimize / restore the log window
function setLogMin(m) {
  logMin = m;
  var View = android.view.View;
  V("logScroll2").setVisibility(logMin ? View.GONE : View.VISIBLE);
  V("lclear").setVisibility(logMin ? View.GONE : View.VISIBLE);
  V("lmin").setText(logMin ? "▢" : "—");
}
V("lmin").on("click", function () { setLogMin(!logMin); });
function quitAll() {
  var who = currentUser;
  try { closeFp(); } catch (e) {}
  try { closeDg(); } catch (e) {}
  try { closeDaily(); } catch (e) {}
  try { threads.start(function () { fbSignOut(who); }).join(3000); } catch (e) {}
  stopEngine();
  try { console.hide(); } catch (e) {}
  try { w.close(); } catch (e) {}
  try { lw.close(); } catch (e) {}
  engines.myEngine().forceStop();
}
V("btnQuit").on("click", quitAll);
V("btnExitLock").on("click", quitAll);
V("sConsole").on("check", function (checked) {
  if (checked) console.show(); else { try { console.hide(); } catch (e) {} }
});

// drag the panel by the status text
var x0, y0, wx, wy;
V("status").setOnTouchListener(function (view, event) {
  switch (event.getAction()) {
    case 0: // down
      x0 = event.getRawX(); y0 = event.getRawY();
      wx = w.getX(); wy = w.getY();
      return true;
    case 2: // move
      w.setPosition(wx + (event.getRawX() - x0), wy + (event.getRawY() - y0));
      return true;
  }
  return true;
});

// drag the log window by its header
var lx0, ly0, lwx, lwy;
V("lhdr").setOnTouchListener(function (view, event) {
  switch (event.getAction()) {
    case 0: lx0 = event.getRawX(); ly0 = event.getRawY(); lwx = lw.getX(); lwy = lw.getY(); return true;
    case 2: lw.setPosition(lwx + (event.getRawX() - lx0), lwy + (event.getRawY() - ly0)); return true;
  }
  return true;
});

// portrait: log inside the panel.  landscape: panel body scrolls + separate log window on the right
var lastLand = null;
function applyOrientation(force) {
  var dm = new android.util.DisplayMetrics();
  context.getSystemService("window").getDefaultDisplay().getRealMetrics(dm);
  var land = dm.widthPixels > dm.heightPixels, d = dm.density;
  if (!force && land === lastLand) return;
  lastLand = land;
  ui.run(function () {
    var View = android.view.View;
    V("logBox").setVisibility(V("lockBox").getVisibility() === View.VISIBLE ? View.GONE : View.VISIBLE);
    V("lroot").setVisibility(View.GONE);
    var bs = V("bodyScroll"), lp = bs.getLayoutParams();
    // landscape: the body scrolls in what is left of the screen below the header and the log
    lp.height = land ? Math.max(Math.round(100 * d), dm.heightPixels - Math.round(110 * d) - Math.round(135 * UI_SCALE * d)) : -2;
    bs.setLayoutParams(lp);
    if (land) {
      w.setPosition(10, 10);
      lw.setPosition(Math.max(0, dm.widthPixels - Math.round(300 * UI_SCALE * d) - 20), 10);
    } else {
      w.setPosition(10, 60);
    }
  });
}


// ===== DEVICE LOCK (one account = one device) =====
function myDeviceId() {                 // stable per-device fingerprint (hashed, nothing raw is uploaded)
  var id = "";
  try { id = String(android.provider.Settings.Secure.getString(context.getContentResolver(), "android_id") || ""); } catch (e) {}
  var raw = id;
  try { var BD = android.os.Build; raw += "|" + BD.BRAND + "|" + BD.MODEL + "|" + BD.DEVICE + "|" + BD.HARDWARE; } catch (e) {}
  return hashPw("device:" + raw).slice(0, 32);
}
function fbPullAccount() {              // {bound: deviceId, exp: ms} or null when it can't be read
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
    return { bound: (f.deviceId && f.deviceId.stringValue) || "", exp: ts || 0, admin: !!(f.admin && f.admin.booleanValue === true) };
  } catch (e) { return null; }
}
// after sign-in: returns "OK" (this device is allowed / now bound), "OTHER" (locked to another device) or "NETWORK"
function fbDeviceCheck() {
  var me = myDeviceId(), a = fbPullAccount();
  if (!a) return "NETWORK";             // can't verify -> fail closed
  acctExp = a.exp; acctAdmin = a.admin;
  if (a.admin) return "OK";              // owner accounts are not tied to one device (the APK and AutoX.js report different device ids)
  if (a.bound) return a.bound === me ? "OK" : "OTHER";
  try {
    var r = fbCommit([fsDoc("users/" + fbAuth.uid, { deviceId: me }, [])]);   // first login on this account = lock it here
    return (r && r.statusCode < 300) ? "OK" : "NETWORK";
  } catch (e) { return "NETWORK"; }
}
// ----- access keys -----
function keyMsg(e) {
  return e === "BADKEY" ? "Invalid key" : e === "USED" ? "Key already used" : e === "NETWORK" ? "Can't verify key - check connection" : "Key could not be redeemed";
}
function fbReadKey(code, peek) {        // no login needed; returns {code, days, usedBy} or {err}; peek=true also accepts used keys
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
    var mx = f.maxUses ? (parseInt(f.maxUses.integerValue || f.maxUses.doubleValue, 10) || 1) : 1;      // shared key: how many accounts may use it
    var us = f.uses ? (parseInt(f.uses.integerValue || f.uses.doubleValue, 10) || 0) : 0;
    var ul = (f.usedList && f.usedList.stringValue) || "";                                              // comma-separated uids that used it
    if (mx > 1 && us >= mx && !peek) return { err: "USED" };
    return { code: code, days: d, usedBy: owner, max: mx, uses: us, list: ul, multi: mx > 1, ut: kb.updateTime || "" };
  } catch (e) { return { err: "NETWORK" }; }
}
// burn the key and set the new expiry in ONE atomic write. createFields = new-account fields, or null when renewing
function fbRedeemKey(code, createFields, tryN) {
  var k = fbReadKey(code);
  if (k.err) return k;
  var base = createFields ? nowMs() : Math.max(nowMs(), acctExp || 0);
  var exp = base + k.days * 86400000;
  var uf = {};
  if (createFields) for (var q in createFields) uf[q] = createFields[q];
  uf.expiresAt = { ts: new Date(exp).toISOString() };
  uf.keyCode = k.code;
  var r;
  try {
    var keyWrite = k.multi
      ? fsDoc("keys/" + k.code, { uses: { int: k.uses + 1 }, usedList: k.list ? k.list + "," + fbAuth.uid : fbAuth.uid }, ["usedAt"], false, k.ut)
      : fsDoc("keys/" + k.code, { usedBy: fbAuth.uid }, ["usedAt"], false, k.ut);
    r = fbCommit([keyWrite,
                  fsDoc("users/" + fbAuth.uid, uf, createFields ? ["created", "lastLogin"] : [])]);
  } catch (e) { return { err: "NETWORK" }; }
  if (!r) return { err: "NETWORK" };
  if (r.statusCode < 200 || r.statusCode >= 300) {
    var rj = fbBody(r), rs = (rj.error && rj.error.status) || "";
    if (r.statusCode === 409 || /FAILED_PRECONDITION|ABORTED|ALREADY_EXISTS/.test(rs)) {                        // someone redeemed it first
      if (k.multi && (tryN || 0) < 3) return fbRedeemKey(code, createFields, (tryN || 0) + 1);                  // shared key: another user took a slot at the same moment - read again, retry
      return { err: "USED" };
    }
    return { err: "FAILED" };
  }
  acctExp = exp;
  return { ok: true, exp: exp };
}
function kickOut(msg) {                 // expired / wrong device while running: stop everything and lock the panel
  toast(msg);
  try { haltAll(); } catch (e) {}
  var who = currentUser;
  try { fbSignOut(who); } catch (e) {}
  currentUser = "";
  applyLock(true);
}
function fbDrop() {                     // forget the session without touching the account's online state
  var t = fbThread; fbThread = null; fbAuth = null; fbQueue = [];
  if (t) { try { t.interrupt(); } catch (e) {} }
}

// ===== IP LOCK (limit account creation per public IP) =====
function myPublicIp() {
  var urls = ["https://api.ipify.org", "https://icanhazip.com"];
  for (var i = 0; i < urls.length; i++) {
    try {
      var r = http.get(urls[i]);
      if (r.statusCode === 200) {
        var ip = String(r.body.string()).trim();
        if (/^[0-9a-fA-F:.]{7,45}$/.test(ip)) return ip;
      }
    } catch (e) {}
  }
  return "";
}
// run right after sign-up: returns "OK", "LIMIT" (this IP already made its quota) or "NETWORK"
function fbIpClaim() {
  var ip = myPublicIp();
  if (!ip) return "NETWORK";                       // can't tell the IP -> fail closed
  var h = hashPw("ip:" + ip).slice(0, 32);
  var max = Math.max(1, FB.maxPerIp | 0);
  try { var dt = detectDevice().type; if (dt === "emulator" || dt === "redfinger") max = Math.max(max, FB.maxPerIpEmu | 0); } catch (e) {}   // emulators / cloud phones often share one public IP
  try {
    for (var n = 1; n <= max; n++) {               // each slot can only be created once (atomic precondition)
      var r = fbCommit([fsDoc("ips/" + h + "_" + n, { uid: fbAuth.uid }, ["created"], true)]);
      if (!r) return "NETWORK";
      if (r.statusCode >= 200 && r.statusCode < 300) return "OK";
      var j = fbBody(r), st = (j.error && j.error.status) || "";
      if (!/ALREADY_EXISTS|FAILED_PRECONDITION|ABORTED/.test(st) && r.statusCode !== 409) return "NETWORK";
    }
    return "LIMIT";
  } catch (e) { return "NETWORK"; }
}
function fbDeleteAccount() {                       // remove the account that was just created
  try {
    if (fbAuth) http.postJson("https://identitytoolkit.googleapis.com/v1/accounts:delete?key=" + FB.apiKey, { idToken: fbAuth.idToken });
  } catch (e) {}
}

// ===== USER LOGIN =====
// Accounts live in local storage; passwords are kept only as salted SHA-256 hashes.
function hashPw(str) {
  var md = java.security.MessageDigest.getInstance("SHA-256");
  var b = md.digest(new java.lang.String("cabal_ui:" + str).getBytes("UTF-8"));
  var out = "";
  for (var i = 0; i < b.length; i++) out += ("0" + (b[i] & 0xff).toString(16)).slice(-2);
  return out;
}
function getUsers() { try { return JSON.parse(store.get("users") || "{}"); } catch (e) { return {}; } }
function putUsers(u) { store.put("users", JSON.stringify(u)); }
function hasUsers() { for (var k in getUsers()) return true; return false; }
function cleanName(n) { return String(n).trim().toLowerCase(); }
function validName(n) { return /^[a-z0-9][a-z0-9_.-]{2,19}$/.test(n); }
function userHash(n, p) { return hashPw(n + ":" + p); }
function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

var currentUser = "", badTries = 0, lockUntil = 0, regMode = false;
// ===== SAVED LOGIN (username / password / key, scrambled with a per-device key) =====
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
function fillSaved() {                  // auto-paste the saved login into the login panel
  var c = loadLogin();
  if (!c) return;
  V("iuser").setText(c.u); V("ilock").setText(c.p);
  if (c.k) V("icode").setText(c.k);
}

function renderLock() {                 // login vs register layout of the lock screen
  var View = android.view.View, loginMode = fbOn() || hasUsers();
  var reg = regMode || !loginMode;      // no accounts yet (local) = register only
  V("ilock2").setVisibility(reg ? View.VISIBLE : View.GONE);
  var sv = reg ? null : loadLogin();
  var showKey = fbOn() && (FB.requireKey || (reg && FB.inviteCode)) && !(sv && sv.a);   // owner login: no key box
  V("icode").setVisibility(showKey ? View.VISIBLE : View.GONE);
  V("icode").setHint(FB.requireKey ? "access key" : "invite code");
  V("btnUnlock").setText(reg ? "REGISTER" : "LOGIN");
  V("lockTitle").setText(reg ? "🔒 CREATE ACCOUNT (drag here)" : "🔒 LOGIN (drag here)");
  V("btnReg").setText(reg ? "Back to login" : "No account? Register");
  V("btnReg").setVisibility(loginMode ? View.VISIBLE : View.GONE);
  V("btnForgot").setVisibility((!reg && fbOn()) ? View.VISIBLE : View.GONE);
  V("btnForget").setVisibility((!reg && loadLogin()) ? View.VISIBLE : View.GONE);
}
function doRegister() {
  var name = cleanName(V("iuser").getText()), pw = String(V("ilock").getText()), pw2 = String(V("ilock2").getText());
  var isEmail = fbOn() && name.indexOf("@") > 0;
  if (!isEmail && !validName(name)) { toast("Username: 3-20 letters/numbers/_ . -"); return; }
  var minLen = fbOn() ? 6 : 4;          // Firebase requires 6+
  if (pw.length < minLen) { toast("Password needs " + minLen + "+ characters"); return; }
  if (pw !== pw2) { toast("Passwords don't match"); return; }
  if (!fbOn()) {                        // local mode: only the very first account can self-register
    if (hasUsers()) { toast("Ask an existing user to add you in settings"); return; }
    var users = {}; users[name] = userHash(name, pw); putUsers(users);
    currentUser = name; releaseFocus(); applyLock(false);
    toast("Account created. Welcome, " + name);
    return;
  }
  if (FB.inviteCode && !FB.requireKey && String(V("icode").getText()).trim() !== FB.inviteCode) { toast("Wrong invite code"); return; }
  var keyTxt = String(V("icode").getText()).trim();
  if (FB.requireKey && !keyTxt) { toast("Enter your access key"); return; }
  toast("Creating account...");
  threads.start(function () {
    if (FB.requireKey) {
      var kk = fbReadKey(keyTxt);
      if (kk.err) { toast(keyMsg(kk.err)); return; }
    }
    var email = isEmail ? name : name + "@" + FB.domain, err;
    try { err = fbSignIn(email, pw, true); } catch (e) { err = "NETWORK"; }
    if (err) {
      if (/EMAIL_EXISTS/.test(err)) toast("Username already taken");
      else if (/WEAK_PASSWORD/.test(err)) toast("Password too weak (use 6+ characters)");
      else if (/OPERATION_NOT_ALLOWED/.test(err)) toast("Registration is turned off in Firebase");
      else if (/INVALID_EMAIL/.test(err)) toast("Invalid username");
      else if (/TOO_MANY/.test(err)) toast("Too many tries - try later");
      else if (err === "NETWORK") toast("No connection to Firebase");
      else toast("Register failed: " + err);
      return;
    }
    var ipRes = fbIpClaim();
    if (ipRes !== "OK") {
      fbDeleteAccount(); fbDrop();
      toast(ipRes === "LIMIT" ? "Account limit reached for this IP" : "Can't verify IP - check connection");
      return;
    }
    var created = { name: name, email: email, deviceId: myDeviceId() };
    if (FB.requireKey) {
      var rk = fbRedeemKey(keyTxt, created);
      if (rk.err) { toast(keyMsg(rk.err)); fbDeleteAccount(); fbDrop(); return; }
    } else {
      try { fbCommit([fsDoc("users/" + fbAuth.uid, created, ["created", "lastLogin"])]); } catch (e) {}
    }
    currentUser = name;
    saveLogin(name, pw, keyTxt);
    fbStart();
    releaseFocus(); applyLock(false);
    toast("Account created. Welcome, " + name);
  });
}
V("btnReg").on("click", function () {
  regMode = !regMode;
  V("ilock").setText(""); V("ilock2").setText(""); V("icode").setText("");
  if (regMode) V("iuser").setText(""); else fillSaved();
  renderLock();
});
V("btnForget").on("click", function () {
  forgetLogin();
  V("iuser").setText(""); V("ilock").setText(""); V("icode").setText("");
  renderLock();
  toast("Saved login removed");
});
// ===== DG LIST POPUP (separate floating panel: all dungeons + your own notes) =====
var DG_DATA = [[55, 1, "71,000", "Lake in Dusk", "Map Part", 1, 7], [65, 7, "193,000", "Chaos Arena Lv.2", "Key of Chaos Lv. 2", 2, 7], [70, 1, "111,000", "Ruina Station", "Muster Card : Ruina Station", 1, 7], [85, 9, "180,000", "Tower of Undead B1F", "Epaulet of Undead", 2, 7], [95, 10, "272,000", "Chaos Arena Lv.3", "Key of Chaos Lv. 3", 3, 7], [95, 10, "153,000", "Volcanic Citadel", "Seal of the Darkness", 3, 7], [105, 11, "218,000", "Tower of the Undead B2F", "Epaulet of Undead(B2F) Part1", 4, 7], [110, 11, "183,000", "Steamer Crazy (Easy)", "Defected Train Card", 1, 1], [110, 11, "186,000", "Steamer Crazy (Normal)", "Defected Train Card", 2, 1], [110, 11, "193,000", "Steamer Crazy (Hard)", "Defected Train Card", 3, 1], [110, 11, "186,000", "Steamer Crazy (Premium)", "Another Ruined Train Card", 4, 1], [110, 11, "186,000", "Lava Hellfire (Easy)", "Ever-heated Lava Stone", 1, 1], [110, 11, "188,000", "Lava Hellfire (Normal)", "Ever-heated Lava Stone", 2, 1], [110, 11, "200,000", "Lava Hellfire (Hard)", "Ever-heated Lava Stone", 3, 1], [110, 11, "188,000", "Lava Hellfire (Premium)", "Ever-heated Hot Lava Stone", 4, 1], [110, 11, "129,000", "Panic Cave (Easy)", "Explorer's Journal", 1, 1], [110, 11, "154,000", "Panic Cave (Normal)", "Explorer's Journal", 2, 1], [110, 11, "194,000", "Panic Cave (Hard)", "Explorer's Journal", 3, 1], [110, 11, "154,000", "Panic Cave (Premium)", "Explorer's Special Journal", 4, 1], [110, 11, "190,000", "Catacomb Frost (Normal)", "Frozen Clue", 2, 1], [110, 11, "200,000", "Catacomb Frost (Hard)", "Frozen Clue", 3, 1], [110, 11, "190,000", "Catacomb Frost (Premium)", "New Frozen Clue", 4, 1], [110, 11, "222,000", "Forgotten Temple B1F", "Muster Card : Forgotten Temple B1F", 4, 7], [120, 11, "214,000", "Illusion Castle Underworld", "Copy of the Illusive Apocalypse", 4, 7], [125, 11, "245,000", "Forbidden Island", "Lost Island Compass", 6, 7], [125, 11, "374,000", "Forgotten Temple B2F", "Muster Card : Forgotten Temple B2F", 9, 7], [125, 11, "353,000", "Chaos Arena Lv.4", "Key of Chaos Lv. 4", 4, 7], [130, 11, "482,000", "Holia Windhill", "Piece of Mysterious Statue", 5, 2], [130, 11, "905,000", "Eternal Chaos Arena", "Key of Eternal", 8, 7], [130, 11, "238,000", "Illusion Castle Radiant Hall", "Apocalypse of Other Dimension", 7, 7], [135, 11, "286,000", "Altar of Siena B2F", "Siena's Crest B2F", 7, 7], [135, 11, "244,000", "Altar of Siena B1F", "Siena's Crest B1F", 6, 7], [140, 11, "507,000", "Forbidden Island (Awakened)", "Unusual Lost Island Compass", 8, 7], [145, 11, "407,000", "Maquinas Outpost", "Hacked Code Disk", 10, 7], [145, 11, "371,000", "Chaos Arena Lv.5", "Key of Chaos Lv. 5", 5, 7], [150, 11, "627,000", "Holia Keldrasil", "Mysterious Branch", 6, 2], [150, 11, "382,000", "Catacomb Frost (Awakened)", "Frozen Clue (Awakened)", 5, 1], [150, 11, "382,000", "Lava Hellfire (Awakened)", "Ever-Heated Lava Stone (Awakened)", 5, 1], [150, 11, "382,000", "Panic Cave (Awakened)", "Explorer's Journal (Awakened)", 5, 1], [150, 11, "382,000", "Steamer Crazy (Awakened)", "Defected Train Card (Awakened)", 5, 1], [155, 11, "243,000", "Hazardous Valley (Easy)", "Nearly-hatching Egg", 2, 1], [155, 11, "251,000", "Hazardous Valley (Normal)", "Nearly-hatching Egg", 3, 1], [155, 11, "292,000", "Hazardous Valley (Hard)", "Nearly-hatching Egg", 4, 1], [155, 11, "938,000", "Tower of Undead B3F", "Epaulet of Undead B3F", 11, 7], [155, 11, "664,000", "Forgotten Temple B2F (Awakened)", "Rare Muster Card : Forgotten Temple B2F", 11, 7], [160, 11, "567,000", "Hazardous Valley (Awakened)", "Nearly Hatched Egg (Awakened)", 5, 3], [160, 11, "673,000", "Tower of the Dead B3F (Part2)", "Epaulet of Undead B3F (Part2)", 7, 4], [160, 11, "0", "Flame Dimension", "Blazing Crystal", 15, 7], [165, 11, "431,000", "Chaos Arena Lv.6", "Key of Chaos Lv. 6", 6, 7]];   // [entry level, class rank, combat power, dungeon, entry item, DP, max users]
var dw = null;
// sorted lowest -> highest: entry level first, then combat power (unknown "0" last), then name
var DG_SORTED = DG_DATA.slice().sort(function (a, b) {
  var ca = parseInt(String(a[2]).replace(/\D/g, ""), 10) || 0, cb = parseInt(String(b[2]).replace(/\D/g, ""), 10) || 0;
  if (a[0] !== b[0]) return a[0] - b[0];
  if ((ca === 0) !== (cb === 0)) return ca === 0 ? 1 : -1;
  if (ca !== cb) return ca - cb;
  return a[3] < b[3] ? -1 : a[3] > b[3] ? 1 : 0;
});
function dgLoad() { try { var a = JSON.parse(store.get("dg_list", "[]")); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
function dgSave(a) { try { store.put("dg_list", JSON.stringify(a)); } catch (e) {} }
function closeDg() { if (dw) { try { dw.close(); } catch (e) {} dw = null; } }
function dgRender() {
  if (!dw) return;
  var box = dw.dgItems, d = context.getResources().getDisplayMetrics().density, Color = android.graphics.Color;
  var q = String(dw.dgIn.getText()).toLowerCase().trim();
  function hit(t) { return !q || t.toLowerCase().indexOf(q) >= 0; }
  function pad(v, a, b, c, e) { v.setPadding(Math.round(a * d), Math.round(b * d), Math.round(c * d), Math.round(e * d)); }
  box.removeAllViews();
  var shown = 0;
  dgLoad().forEach(function (name, idx) {                       // your own entries first (can be deleted)
    if (!hit(name)) return;
    shown++;
    var row = new android.widget.LinearLayout(context);
    row.setOrientation(0); row.setGravity(16);
    var tv = new android.widget.TextView(context);
    tv.setText("\u2605 " + name); tv.setTextColor(Color.parseColor("#e0b84a")); tv.setTextSize(12); pad(tv, 8, 8, 4, 8);
    row.addView(tv, new android.widget.LinearLayout.LayoutParams(0, -2, 1));
    var x = new android.widget.TextView(context);
    x.setText("\u2715"); x.setTextColor(Color.parseColor("#ff7a7a")); x.setTextSize(14); pad(x, 10, 8, 10, 8);
    row.addView(x);
    tv.setOnClickListener(function () { try { setClip(name); } catch (e) {} toast("Copied: " + name); });
    x.setOnClickListener(function () { var a = dgLoad(); a.splice(idx, 1); dgSave(a); dgRender(); });
    box.addView(row);
  });
  DG_SORTED.forEach(function (r) {                              // built-in dungeon table (lowest -> highest)
    var name = r[3], item = r[4];
    if (!hit("lv." + r[0] + " " + name + " " + item)) return;
    shown++;
    var col = new android.widget.LinearLayout(context);
    col.setOrientation(1); pad(col, 8, 6, 8, 6);
    var t1 = new android.widget.TextView(context);
    t1.setText("Lv." + r[0] + "  " + name); t1.setTextColor(Color.WHITE); t1.setTextSize(12); t1.setTypeface(null, 1);
    var t2 = new android.widget.TextView(context);
    t2.setText(item + "  |  DP " + r[5] + "  |  Max " + r[6] + "  |  Rank " + r[1] + "  |  CP " + r[2]);
    t2.setTextColor(Color.parseColor("#8b93a7")); t2.setTextSize(10);
    col.addView(t1); col.addView(t2);
    col.setOnClickListener(function () { try { setClip(name); } catch (e) {} toast("Copied: " + name); });
    box.addView(col);
  });
  if (!shown) {
    var e0 = new android.widget.TextView(context);
    e0.setText("nothing matches"); e0.setTextColor(Color.parseColor("#6f778a")); e0.setTextSize(11); pad(e0, 8, 8, 0, 0);
    box.addView(e0);
  }
  try { dw.dgCount.setText(shown + " / " + (DG_DATA.length + dgLoad().length)); } catch (e) {}
}
function openDg() {
  if (dw) { closeDg(); return; }              // button toggles the popup
  dw = floaty.window(sc(
    '<vertical w="300" bg="#F2111722" padding="4">' +
      '<horizontal gravity="center_vertical">' +
        '<text id="dgHdr" text="DG LIST (drag here)" textColor="#6ea8ff" textSize="12sp" textStyle="bold" layout_weight="1" padding="6"/>' +
        '<text id="dgCount" text="" textColor="#8b93a7" textSize="10sp" padding="4"/>' +
        '<text id="dgClose" text="\u2715" textColor="#ffffff" textSize="16sp" textStyle="bold" padding="8"/>' +
      '</horizontal>' +
      '<horizontal gravity="center_vertical">' +
        '<input id="dgIn" inputType="text" hint="search  (or type a note + ADD)" textColor="#ffffff" textColorHint="#6f778a" textSize="13sp" padding="4" layout_weight="1"/>' +
        '<button id="dgAdd" text="ADD" w="60" h="34" bg="#2f7d4a" textColor="#ffffff" textSize="11sp" padding="0"/>' +
      '</horizontal>' +
      '<ScrollView h="260" bg="#0b0e13" marginTop="4"><vertical id="dgItems"/></ScrollView>' +
      '<text text="tap an entry to copy its name" textColor="#6f778a" textSize="9sp" padding="4"/>' +
    '</vertical>'
  ));
  dw.setPosition(40, 120);
  try { dw.disableFocus(); } catch (e) {}
  var dx0, dy0, dwx, dwy;
  dw.dgHdr.setOnTouchListener(function (view, event) {
    switch (event.getAction()) {
      case 0: dx0 = event.getRawX(); dy0 = event.getRawY(); dwx = dw.getX(); dwy = dw.getY(); return true;
      case 2: dw.setPosition(dwx + (event.getRawX() - dx0), dwy + (event.getRawY() - dy0)); return true;
    }
    return true;
  });
  dw.dgClose.on("click", closeDg);
  dw.dgIn.setOnTouchListener(function (v, e) {
    if (e.getAction() === android.view.MotionEvent.ACTION_DOWN) { dw.requestFocus(); v.requestFocus(); }
    return false;
  });
  dw.dgIn.addTextChangedListener(new android.text.TextWatcher({
    beforeTextChanged: function () {},
    onTextChanged: function () {},
    afterTextChanged: function () { dgRender(); }
  }));
  dw.dgAdd.on("click", function () {
    var t = String(dw.dgIn.getText()).trim();
    if (!t) { toast("Type a note first"); return; }
    var a = dgLoad();
    if (a.length >= 50) { toast("Notes full (50)"); return; }
    a.push(t.slice(0, 40)); dgSave(a);
    dw.dgIn.setText("");
    try { dw.disableFocus(); } catch (e) {}
    dgRender();
  });
  dgRender();
}
V("btnDg").on("click", openDg);

// ===== DAILY DG (popup list with a RUN button per dungeon) =====
// Open the game's Dungeon screen first, then tap DAILY DG and press RUN beside a dungeon. The script picks that row,
// ticks "Repeat" (the game's own replay: set the count once with the gear, e.g. 5), taps ITEM ENTRANCE (never the
// gem "150 enter" button) and confirms CHALLENGE. The game then repeats the dungeon by itself.
// Only rows whose position on the Select Dungeon screen is known are listed (y = row centre in game px).
// y = row centre in game px. sc: "top" (default) = list dragged to the top (rows 1-3 at y 300/474/648),
// "bottom" = list dragged to the end (last three rows at y 335/509/682). Stand at the gate that lists the dungeon.
var DAILY_LIST = [
  { name: "Tower of Undead B1F",     sub: "Epaulet of Undead",             y: 300, icon: "epaulet" },
  { name: "Lake in Dusk",            sub: "Map Part",                      icon: "mappart", move: true, y: 300 },
  { name: "Tower of the Undead B2F", sub: "Epaulet of Undead(B2F) Part1",  y: 474, icon: "epaulet2" },
  { name: "Tower of Undead B3F",     sub: "recommended CP 938,000",        y: 648 },
  { name: "Chaos Arena Lv.1",        sub: "Key of Chaos Lv. 1",            y: 300 },
  { name: "Chaos Arena Lv.2",        sub: "Key of Chaos Lv. 2",            y: 474 },
  { name: "Chaos Arena Lv.3",        sub: "Key of Chaos Lv. 3",            y: 648 },
  { name: "Chaos Arena Lv.4",        sub: "Key of Chaos Lv. 4",            y: 335, sc: "bottom" },
  { name: "Chaos Arena Lv.5",        sub: "Key of Chaos Lv. 5",            y: 509, sc: "bottom" },
  { name: "Chaos Arena Lv.6",        sub: "Key of Chaos Lv. 6",            y: 682, sc: "bottom" },
  { name: "Panic Cave (Easy)",       sub: "Explorer's Journal",            y: 300 },
  { name: "Panic Cave (Normal)",     sub: "Explorer's Journal",            y: 474 },
  { name: "Panic Cave (Hard)",       sub: "Explorer's Journal",            y: 648 },
  { name: "Panic Cave (Premium)",    sub: "Explorer's Special Journal",    y: 509, sc: "bottom" },
  { name: "Panic Cave (Awakened)",   sub: "Explorer's Journal (Awakened)", y: 682, sc: "bottom" },
  { name: "Catacomb Frost (Easy)",   sub: "Frozen Clue",                   y: 300 },
  { name: "Catacomb Frost (Normal)", sub: "Frozen Clue",                   y: 474 },
  { name: "Catacomb Frost (Hard)",   sub: "Frozen Clue",                   y: 648 },
  { name: "Catacomb Frost (Premium)", sub: "New Frozen Clue",              y: 509, sc: "bottom" },
  { name: "Catacomb Frost (Awakened)", sub: "Frozen Clue (Awakened)",      y: 682, sc: "bottom" },
  { name: "Lava Hellfire (Easy)",    sub: "Ever-heated Lava Stone",        y: 300 },
  { name: "Lava Hellfire (Normal)",  sub: "Ever-heated Lava Stone",        y: 474 },
  { name: "Lava Hellfire (Hard)",    sub: "Ever-heated Lava Stone",        y: 648 },
  { name: "Lava Hellfire (Premium)", sub: "Ever-heated Hot Lava Stone",    y: 509, sc: "bottom" },
  { name: "Lava Hellfire (Awakened)", sub: "Ever-Heated Lava Stone (Awakened)", y: 682, sc: "bottom" },
  { name: "Steamer Crazy (Easy)",   sub: "Defected Train Card",           y: 300 },
  { name: "Steamer Crazy (Normal)", sub: "Defected Train Card",           y: 474 },
  { name: "Steamer Crazy (Hard)",   sub: "Defected Train Card",           y: 648 },
  { name: "Steamer Crazy (Premium)", sub: "Another Ruined Train Card",    y: 509, sc: "bottom" },
  { name: "Steamer Crazy (Awakened)", sub: "Defected Train Card (Awakened)", y: 682, sc: "bottom" },
  { name: "Hazardous Valley (Easy)", sub: "Nearly-hatching Egg",          y: 300, icon: "oval" },
  { name: "Hazardous Valley (Normal)", sub: "Nearly-hatching Egg",        y: 474, icon: "oval" },
  { name: "Hazardous Valley (Hard)", sub: "Nearly-hatching Egg",          y: 648, icon: "oval" },
  { name: "Hazardous Valley (Awakened)", sub: "Nearly Hatched Egg (Awakened)", y: 682, sc: "bottom" },
  { name: "Forbidden Island",        sub: "Lost Island Compass",           y: 300, icon: "compass" },
  { name: "Forbidden Island (Awakened)", sub: "Unusual Lost Island Compass", y: 474 },
  { name: "Holia Windhill",          sub: "Piece of Mysterious Statue",    y: 300 },
  { name: "Holia Keldrasil",         sub: "Mysterious Branch",             y: 474, icon: "leaf" },
  { name: "Eternal Chaos Arena",     sub: "Key of Eternal",                y: 300, icon: "greenstaff" },
  { name: "Volcanic Citadel",        sub: "Seal of the Darkness",          y: 300, icon: "seal" },
  { name: "Tower of the Dead B3F (Part2)", sub: "Epaulet of Undead B3F (Part2)", y: 682, sc: "bottom" },
  { name: "Illusion Castle Underworld", sub: "Copy of the Illusive Apocalypse", y: 300, icon: "illu1" },
  { name: "Illusion Castle Radiant Hall", sub: "Apocalypse of Other Dimension", y: 474, icon: "radiant" },
  { name: "Ruina Station",          sub: "Muster Card : Ruina Station",   icon: "ruina" },
  { name: "Maquinas Outpost",        sub: "Hacked Code Disk",              y: 300, icon: "disk" },
  { name: "Altar of Siena B1F",      sub: "Siena's Crest B1F",             y: 300, icon: "siena1" },
  { name: "Altar of Siena B2F",      sub: "Siena's Crest B2F",             y: 474, icon: "siena2" },
  { name: "Forgotten Temple B1F",    sub: "Muster Card : Forgotten Temple B1F", y: 300, icon: "muster1" },
  { name: "Forgotten Temple B2F",    sub: "Muster Card : Forgotten Temple B2F", y: 474, icon: "muster", cell: [1, 1] },   // no icon fingerprint yet: taps bag tab VII row 1, col 1
  { name: "Forgotten Temple B2F (Awakened)", sub: "Rare Muster Card : Forgotten Temple B2F", y: 648 },
  // bag-only: started by tapping the item in bag tab VII (no Select Dungeon row needed)
  { name: "Glacies Inferna",         sub: "Crystal of Frozen Flame",       icon: "yinyang" },
  { name: "Holia Treestie",          sub: "Mystical Feather",              icon: "feather" },
  { name: "Abyss Arena",             sub: "Mirror of Abyss",               icon: "mirrorP" },
  { name: "Abyss Arena (Awakened)",  sub: "Mirror of Abyss (Awakened)",    icon: "mirrorO" },
  { name: "Devil's Tower (Part2)",   sub: "Revived Devil's Key",           icon: "purplekey" },
  // bag tab VII, fixed cell [row, col] (taken from your screenshots; re-check the cells if you SORT or change the bag)
  { name: "Edge of Phantom",             sub: "Broken Epaulet of Undead",          cell: [6, 3] },
  { name: "Weakened Ruina Station",      sub: "Copy of Muster Card",               cell: [6, 5] },
  { name: "Frozen Tower of Undead (B1F)", sub: "Copy of Epaulet of Undead",        cell: [6, 6] },
  { name: "Purifier of the Forest",      sub: "Mountain Radar",                    cell: [6, 2] },
  { name: "Celestia",                    sub: "Dimensional Ship's Key",            cell: [6, 1] },
  { name: "Garden of Dust",              sub: "Contaminated cactus",               cell: [5, 5] },
  { name: "Abandoned City",              sub: "Strange Liquid",                    cell: [5, 6] },
  { name: "Illusion Castle Underworld (Apocrypha)",   sub: "Illusive Apocalypse (Apocrypha)",          cell: [5, 7] },
  { name: "Illusion Castle Radiant Hall (Apocrypha)", sub: "Apocalypse of Other Dimension (Apocrypha)", cell: [5, 8] },
  { name: "Ancient Tomb",                sub: "Hidden Tomb Key",                   cell: [4, 5] },
  { name: "Flame Nest",                  sub: "Broken Devil's Horn",               cell: [4, 6] },
  { name: "Frozen Canyon",               sub: "Lamp that illuminates the Soul",    cell: [4, 7] },
  { name: "Turminos Maquina",            sub: "Broken Circuit Chip",               cell: [4, 8] },
  { name: "Chaos Arena Lv.7",            sub: "Key of Chaos Lv. 7",                cell: [3, 4] }
];
// sort DAILY DG lowest -> highest (same order as DG LIST: entry level, then combat power).
// Dungeons that are not in DG_DATA have no known level: they stay at the end in their old order,
// except the Chaos Arena key dungeons which are placed by their number (Lv.1 first, Lv.7 last).
(function () {
  var rank = {};
  DG_SORTED.forEach(function (r, i) { rank[r[3]] = i; });
  rank["Chaos Arena Lv.1"] = -1;
  rank["Chaos Arena Lv.7"] = DG_SORTED.length;
  rank["Catacomb Frost (Easy)"] = rank["Catacomb Frost (Normal)"] - 0.5;   // Lv.110 like the other Catacomb Frost rows
  var BIG = 100000;
  DAILY_LIST.forEach(function (it, i) { it._o = i; it._r = rank[it.name] !== undefined ? rank[it.name] : BIG + i; });
  DAILY_LIST.sort(function (a, b) { return a._r !== b._r ? a._r - b._r : a._o - b._o; });
})();
// ===== LEARNED BAG CELLS =====
// Every dungeon can be started from its entry item in bag tab VII (item -> MOVE -> Warp -> Select Dungeon).
// Tap "SET" beside a dungeon in DAILY DG, then tap that item in the open bag: the cell is saved and used from then on.
function dgCellsLoad() { try { var o = JSON.parse(store.get("dg_cells", "{}")); return (o && typeof o === "object") ? o : {}; } catch (e) { return {}; } }
function dgCellsSave(o) { try { store.put("dg_cells", JSON.stringify(o)); } catch (e) {} }
(function () {
  var cs = dgCellsLoad();
  DAILY_LIST.forEach(function (it) {
    var c = cs[it.name];
    if (c && c.length === 2) { it.cell = [c[0], c[1]]; it.cellLearned = true; }
  });
})();
function unmapR(sx, sy) {            // screen px -> game px, right-anchored (inverse of map() for "R")
  var dm = context.getResources().getDisplayMetrics();
  var v = (C.autoFit && VIEW) ? VIEW : { x: 0, y: 0, w: Math.max(dm.widthPixels, dm.heightPixels), h: Math.min(dm.widthPixels, dm.heightPixels) };
  var sv = Math.min(v.w / GW, v.h / GH);
  return [GW - (v.x + v.w - sx) / sv, GH / 2 + (sy - v.y - v.h / 2) / sv];
}
var cellWin = null;
function dgLearnCell(it) {
  if (dgBusy) { toast("Daily DG is running - stop it first"); return; }
  if (cellWin) return;
  closeDaily();
  if (!VIEW) { try { if (ensureCapture()) refitView(); } catch (e) {} }   // refitView() grabs + recycles by itself and returns nothing
  var dm = context.getResources().getDisplayMetrics();
  cellWin = floaty.rawWindow(
    '<frame id="lcRoot" bg="#22000000" w="*" h="*">' +
      '<text id="lcMsg" text="" textColor="#ffffff" textSize="14sp" textStyle="bold" bg="#CC111722" gravity="center" padding="10" w="*" h="wrap_content"/>' +
    '</frame>');
  try { cellWin.setSize(-1, -1); } catch (e) {}
  cellWin.lcMsg.setText("Bag tab VII must be open.\nTap the " + it.sub + " item now  (tap this bar to cancel)");
  function done() { var cw = cellWin; cellWin = null; try { cw.close(); } catch (e) {} ui.run(function () { try { openDaily(); } catch (e) {} }); }
  cellWin.lcRoot.setOnTouchListener(function (view, ev) {
    if (ev.getAction() !== 0) return true;
    var sx = ev.getRawX(), sy = ev.getRawY();
    if (sy < dm.heightPixels * 0.14) { toast("Cancelled"); done(); return true; }
    var g = unmapR(sx, sy);
    var col = Math.floor((g[0] - BAG_X0) / BAG_CELL) + 1, row = Math.floor((g[1] - BAG_Y0) / BAG_CELL) + 1;
    if (row < 1 || row > BAG_ROWS || col < 1 || col > BAG_COLS) { toast("Tap inside the bag grid (row " + row + ", col " + col + " is outside)"); return true; }
    var cs = dgCellsLoad(); cs[it.name] = [row, col]; dgCellsSave(cs);
    it.cell = [row, col]; it.cellLearned = true;
    log("DAILY DG: " + it.name + " bag cell set to row " + row + ", col " + col);
    toast(it.name + ": row " + row + ", col " + col + " saved");
    done();
    return true;
  });
}

var P_DG_ROW_X = 498, P_DG_REPEAT = [1011, 1100], P_DG_ITEM = [1846, 1100], P_DG_CHALLENGE = [816, 880];
var P_DG_AUTO = [1545, 337, "R"];              // in-dungeon AUTO button (right of the Dungeon info panel; "R" = anchored to the right edge)
var DG_END_ABSENT = 20000;                      // ms without the dungeon timer = dungeon finished (back in town)
var DG_MAX_RUN = 90 * 60000;                    // give up waiting for one dungeon after 90 min
var DG_LOAD_WAIT = 20000;                       // max ms to wait for the dungeon timer after CHALLENGE, then press AUTO anyway
var P_DG_CENTER = [1046, 588];                  // town: tap the centre of the screen (the dungeon gate) to open Select Dungeon
var R_DG_ENTER = [1240, 1062, 1500, 1078];      // Select Dungeon: always-blue band inside the "200 enter" button (screen detector)
var R_DG_TIMER = [1612, 160, 1750, 200];        // in dungeon: cyan countdown timer, top right (right-edge anchored)
function isCyan(c) { return colors.green(c) > 170 && colors.blue(c) > 200 && colors.red(c) < 100; }

// ===== DUNGEON ONLY: another quest -> keep tapping the boot button until the character has reached it =====
// Runs only while the cyan dungeon countdown timer is on screen. When the text of the Dungeon quest panel changes
// (the next quest starts) the boot button is tapped, and tapped again every DQ_REPEAT ms for as long as the world is still
// scrolling (= the character is still walking). Once the screen has stopped moving on 2 looks in a row the character is
// at the quest point and the taps stop. Positions / thresholds are ESTIMATES: the log shows what it sees, adjust below.
// Per-game positions: "mobile" is calibrated from a screenshot, "ra" (Cabal Return of Action) starts as a copy - if the
// boot button sits elsewhere there, change DQ.ra.boot (design coords 2093x1177, "R" = anchored to the right edge).
var DQ = {
  mobile: { boot: [1531, 871, "R"], target: [880, 92, 1260, 112] },   // boot button / red HP bar of the targeted monster (top centre)
  ra:     { boot: [1531, 871, "R"], target: [880, 92, 1260, 112] }
};
function dqP() { return DQ[C.game] || DQ.mobile; }
var R_DQ = [1630, 215, 2040, 330];              // Dungeon quest panel text (right-edge anchored)
var DQ_DIFF = 0.22;                             // share of bright cells that must change to count as "another quest"
var DQ_COUNT = 0.01;                            // smaller change in the panel = quest counter moving = the char is questing
var DQ_TAP_EVERY = 500;                         // CONTINUOUS taps: boot is tapped this often while walking to the quest
var DQ_ATTACK_HOLD = 2500;                      // after a monster target (red HP bar) was seen: no boot taps for this long
var DQ_QUEST_HOLD = 3000;                       // after the quest panel counter changed: no boot taps for this long
var DQ_MOVE = 0.12;                             // share of screen samples that changed between two looks = world scrolling = walking
var DQ_GRACE = 6000;                            // after a new quest: keep tapping this long even if nothing moves yet
var DQ_AFTER_MAX = 30000;                       // after the dungeon ended: keep tapping the boot for at most this long (ms)
var DQ_TRAVEL_MAX = 90000;                      // give up on one quest walk after this long (ms; paused time while fighting does not count)
var dqBase = null, dqCand = null, dqMot = null, dqLastTap = 0, dqLastLook = 0, dqTravel = 0, dqStill = 0, dqHold = 0, dqPrevAt = 0, dqHeldLog = false, dqRun = 0;   // dqTravel = start time of the current walk (0 = none)
function dqReset() { dqBase = null; dqCand = null; dqMot = null; dqTravel = 0; dqStill = 0; dqHold = 0; dqPrevAt = 0; dqHeldLog = false; dqRun = 0; }
function isRedBar(c) { return colors.red(c) > 170 && colors.green(c) < 80 && colors.blue(c) < 80; }
function dqSignature(img) {
  var out = [], st = 6;
  for (var y = R_DQ[1]; y < R_DQ[3]; y += st)
    for (var x = R_DQ[0]; x < R_DQ[2]; x += st) out.push(grayOf(pix(img, [x, y, "R"])) > 150 ? 1 : 0);
  return out;
}
function dqDiff(a, b) {
  var diff = 0, any = 0;
  for (var i = 0; i < a.length; i++) { if (a[i] || b[i]) any++; if (a[i] !== b[i]) diff++; }
  return any < 12 ? 0 : diff / any;
}
function dqMotion(img) {                         // coarse grey grid of the middle of the screen (away from the HUD)
  var out = [];
  for (var y = 250; y <= 850; y += 50)
    for (var x = 500; x <= 1700; x += 50) out.push(grayOf(pix(img, [x, y, "C"])));
  return out;
}
function dqMotDiff(a, b) {                       // share of samples that changed clearly = how much the world scrolled
  var n = 0;
  for (var i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 35) n++;
  return a.length ? n / a.length : 0;
}
function dqWatch(img) {                          // img = fresh screenshot taken INSIDE a dungeon; true = boot tapped
  var P = dqP(), now = Date.now(), tapped = false, changed = false, d = 0;
  var dt = dqPrevAt ? Math.min(now - dqPrevAt, 3000) : 0; dqPrevAt = now;
  // 1) did the Dungeon quest panel switch to another quest (big change) or is a counter moving (small change = questing)?
  var sig = dqSignature(img);
  if (!dqBase) dqBase = sig;
  else {
    d = dqDiff(dqBase, sig);
    if (d < DQ_DIFF) {
      if (d >= DQ_COUNT) { dqHold = Math.max(dqHold, now + DQ_QUEST_HOLD); }               // quest counter moved -> questing
      dqBase = sig; dqCand = null;
    }
    else if (!dqCand || dqDiff(dqCand, sig) > 0.12) dqCand = sig;                      // wait for the new text to stay the same on a 2nd look
    else { dqBase = sig; dqCand = null; changed = true; }
  }
  // 2) is the character attacking? (a monster is targeted: its red HP bar shows at the top centre)
  var atk = fracIn(img, P.target, isRedBar, 3, "C") > 0.04;
  if (atk) dqHold = Math.max(dqHold, now + DQ_ATTACK_HOLD);
  // 3) is the character walking? (the world scrolls)
  var mot = dqMotion(img), mv = dqMot ? dqMotDiff(dqMot, mot) : 1;
  dqMot = mot;
  if (changed) { log("quest panel changed " + Math.round(d * 100) + "% -> walking to the next quest"); dqTravel = now; dqStill = 0; dqHold = 0; dqHeldLog = false; }
  if (!dqTravel) {                                             // not tapping yet: is the character running by itself (going to the next quest)?
    if (!atk && now >= dqHold && mv >= DQ_MOVE) { if (++dqRun >= 2) { dqTravel = now; dqStill = 0; dqRun = 0; log("dungeon: character running -> boot taps start"); } }
    else dqRun = 0;
    if (!dqTravel) return false;
  }
  if (now < dqHold) {                                          // attacking / questing: never tap the boot (it would cancel the attack)
    dqTravel += dt; dqStill = 0;                               // the pause does not count against the walk timeout
    if (!dqHeldLog) { dqHeldLog = true; log("dungeon: " + (atk ? "attacking" : "questing") + " -> boot taps paused"); }
    return false;
  }
  if (dqHeldLog) { dqHeldLog = false; log("dungeon: attack / quest over -> boot taps continue"); }
  // no "arrived" stop any more: the screen is also still while the character stands and shoots, so a still screen proves nothing.
  // Inside the dungeon the boot keeps being tapped the whole time, and only attacking / questing (hold above) pauses it.
  if (now - dqLastTap >= DQ_TAP_EVERY) {                       // continuous tapping while walking
    dqLastTap = now;
    tapGame(P.boot, "quest boot");
    tapped = true;
  }
  return tapped;
}
function dqAfterEnd() {                          // dungeon is over (back in town): keep tapping the boot until the character reaches the next quest
  var P = dqP(), t0 = Date.now(), still = 0, mot = null;
  dqReset();
  log("DAILY DG: dungeon ended -> boot taps continue to the next quest");
  while (Date.now() - t0 < DQ_AFTER_MAX) {
    dgChk();
    var im = grab();
    if (!im) { sleep(500); continue; }
    var atk = fracIn(im, P.target, isRedBar, 3, "C") > 0.04;
    var m = dqMotion(im), mv = mot ? dqMotDiff(mot, m) : 1;
    mot = m;
    im.recycle();
    if (atk) { still = 0; sleep(500); continue; }                  // attacking: no boot
    if (mv < DQ_MOVE && Date.now() - t0 >= DQ_GRACE) { if (++still >= 4) { log("DAILY DG: reached the next quest point"); break; } }
    else still = 0;
    tapGame(P.boot, "quest boot (after dg)");
    sleep(DQ_TAP_EVERY);
  }
}
function dqKick() {                              // Daily DG: the dungeon has just started -> the FIRST quest also needs the boot button
  dqBase = null; dqCand = null; dqMot = null; dqStill = 0; dqLastTap = 0; dqHold = 0; dqHeldLog = false; dqPrevAt = 0; dqTravel = Date.now();
  log("dungeon started -> boot button to the first quest");
}
function dqLook() {                              // for the RESPAWN loop (dungeons you run by hand): one look, only inside a dungeon
  if (Date.now() - dqLastLook < (dqTravel ? 600 : 1500)) return;
  dqLastLook = Date.now();
  var im = grab();
  if (!im) return;
  try { if (fracIn(im, R_DG_TIMER, isCyan, 3, "R") > 0.04) dqWatch(im); else dqReset(); } catch (e) {}
  im.recycle();
}
var R_DG_REPEAT = [986, 1075, 1038, 1128], R_DG_ITEM = [1648, 1055, 2048, 1145], R_DG_CHAL = [596, 842, 1038, 918];
var dgBusy = false, dgLastTap = "", dgLastAt = 0, dpw = null, dgCur = "", dgCancel = false, dgSel = {}, dgPending = false, dgGoAt = 0, dgArmed = false;
function dgChk() { if (dgCancel) throw "cancelled"; }
function dgInDungeon() {      // the cyan dungeon countdown is on screen = the dungeon is already running
  var im = grab();
  if (!im) return false;
  var r = fracIn(im, R_DG_TIMER, isCyan, 3, "R") > 0.04;
  im.recycle();
  return r;
}
function dgRunsGet() { try { var n = parseInt(store.get("dg_runs", 1), 10); return isNaN(n) ? 1 : Math.max(1, Math.min(99, n)); } catch (e) { return 1; } }
function dgAutoGet() { return false; }   // AUTO NEXT removed: only dungeons switched ON are ever run (old saved setting is ignored)
var dgForce = {};                         // dungeons already done today that you switched ON anyway (tapped twice): they run again
var dgAutoRun = false, dgTried = {};     // dgAutoRun: this queue keeps going with the other dungeons; dgTried: already attempted this queue
function dgRunsSet(n) { n = Math.max(1, Math.min(99, n)); try { store.put("dg_runs", n); } catch (e) {} return n; }
function dayKey() { var d = new Date(); return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate(); }
function dgDone(name) { try { return store.get("dg_done_" + name, "") === dayKey(); } catch (e) { return false; } }
function closeDaily() { if (dpw) { try { dpw.close(); } catch (e) {} dpw = null; } }
// ---- saved ON set: the SAVE button keeps the dungeons switched ON, they come back after closing the panel / restarting ----
function dgSelCount() { var n = 0; for (var k in dgSel) if (dgSel[k]) n++; return n; }
function dgSelSave() {                                                        // returns how many dungeons were saved
  var names = [];
  DAILY_LIST.forEach(function (it) { if (dgSel[it.name]) names.push(it.name); });
  try { store.put("dg_on", JSON.stringify(names)); } catch (e) {}
  return names.length;
}
function dgSelSaved() { try { var a = JSON.parse(store.get("dg_on", "[]")); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
function dgSelLoadIfEmpty() {                                                 // put the saved ON dungeons back
  if (dgSelCount() > 0) return;
  dgSelSaved().forEach(function (n) { dgSel[n] = true; });   // saved ON stays ON for good (a dungeon done today is simply skipped)
}
function isBtnGrey(c) {         // greyed-out button (no entry item): flat grey-blue, never bright
  var r = colors.red(c), g = colors.green(c), b = colors.blue(c);
  return r > 55 && r < 100 && g > 60 && g < 108 && b > 68 && b < 118 && (b - r) < 26 && (b - r) > 4;
}
function dgOnSelect(img) {     // true when the Select Dungeon screen is showing (blue "200 enter" / Item Entrance, or Item Entrance greyed)
  return fracIn(img, R_DG_ENTER, isBtnBlue, 4) > 0.5 || fracIn(img, R_DG_ITEM, isBtnBlue, 4) > 0.5 || (fracIn(img, R_DG_ITEM, isBtnGrey, 4) > 0.6 && fracIn(img, R_DG_ENTER, isBtnGrey, 4) > 0.5);   // both buttons grey = Dungeon window with no entry possible
}
var P_DG_WIN_CLOSE = [2017, 64, "R"];            // X of the full-screen Dungeon window (top right)
function dgCloseSelect() {                       // leave the Dungeon window so the next step starts from the town screen
  try {
    var ic = grab(), still = false;
    if (ic) { still = dgOnSelect(ic); ic.recycle(); }
    if (still) { tapGame(P_DG_WIN_CLOSE, "dg close Dungeon window"); sleep(1000); }
  } catch (e) { if (e === "cancelled") throw e; }
}
function dgScrollTo(mode) {    // list remembers its scroll: drag it to the top (or the end) so the row positions (it.y) are right
  try {
    var a = map([P_DG_ROW_X, 330]), z = map([P_DG_ROW_X, 760]);
    for (var k = 0; k < 2; k++) {
      if (mode === "bottom") swipe(z[0], z[1], a[0], a[1], 350);   // drag up = list scrolls to its end
      else swipe(a[0], a[1], z[0], z[1], 350);                      // drag down = list scrolls to its start
      sleep(500);
    }
  } catch (e) {}
}
function dgChalShown(img) { return fracIn(img, R_DG_CHAL, isBtnBlue, 4) > 0.5; }   // "Enter Dungeon" dialog (Challenge button) is up
function dgTapChallenge(it, why) {      // Enter Dungeon dialog appeared (any dungeon): press Challenge, then wait for the run + AUTO
  log("DAILY DG: Enter Dungeon dialog (" + why + ") -> Challenge");
  sleep(400); dgChk();
  tapGame(P_DG_CHALLENGE, "dg challenge");
  return dgAfterChallenge(it);
}
function dgEnter(it) {     // from town: open Select Dungeon, pick the row, Repeat, Item Entrance, CHALLENGE, AUTO. true = dungeon is running
  if (it.y === undefined) { log("DAILY DG: " + it.name + " has no Select Dungeon row (bag only)"); return false; }
  sleep(500); dgChk();
  if (!ensureCapture()) { toast("No screen capture - allow screen capture for AutoX.js"); return false; }
  log("DAILY DG: " + it.name);
  // 1) open Select Dungeon: tap the centre of the screen (at the dungeon gate) unless it is already open
  var img = grab();
  if (!img) { toast("Can't read the screen"); return false; }
  var onSel = dgOnSelect(img), chal0 = dgChalShown(img);
  img.recycle();
  if (chal0) return dgTapChallenge(it, "already open");
  if (!onSel) {
    tapGame(P_DG_CENTER, "dg open Select Dungeon");
    for (var q = 0; q < 12 && !onSel; q++) {
      sleep(500); dgChk();
      var imq = grab();
      if (!imq) continue;
      onSel = dgOnSelect(imq);
      var chq = dgChalShown(imq);
      imq.recycle();
      if (chq) return dgTapChallenge(it, "after gate tap");
    }
  }
  if (!onSel && dgInDungeon()) { log("DAILY DG: Select Dungeon not seen but the dungeon is running -> AUTO step"); return dgAfterChallenge(it); }
  if (!onSel) { log("DAILY DG: Select Dungeon did not open"); toast("Select Dungeon didn't open - stand at the dungeon gate"); return false; }
  sleep(600); dgChk();
  // 2) pick the dungeon row
  dgScrollTo(it.sc || "top"); dgChk();
  tapGame([P_DG_ROW_X, it.y], "dg row " + it.name);
  sleep(900); dgChk();
  return dgLaunch(it);
}
function dgLaunch(it) {      // Select Dungeon is open on the right dungeon: Repeat, Item Entrance, CHALLENGE, AUTO
  var im1 = grab();
  if (im1) { var c1 = dgChalShown(im1); im1.recycle(); if (c1) return dgTapChallenge(it, "before Item Entrance"); }
  var im2 = grab();
  var itemOk = im2 ? fracIn(im2, R_DG_ITEM, isBtnBlue, 4) > 0.5 : false;
  var ticked = im2 ? fracIn(im2, R_DG_REPEAT, isOrange, 3) > 0.04 : false;
  if (im2) im2.recycle();
  if (!itemOk) {
    var im3 = grab();
    if (im3) { var c3 = dgChalShown(im3); im3.recycle(); if (c3) return dgTapChallenge(it, "Item Entrance covered"); }
  }
  if (!itemOk) { log("DAILY DG: Item Entrance is greyed out for " + it.name + " (no entry item?)"); toast("No entry item for " + it.name); dgCloseSelect(); it.noItem = true; return false; }
  // 3) Repeat on, then Item Entrance
  if (ticked) { tapGame(P_DG_REPEAT, "dg repeat OFF"); sleep(700); dgChk(); }   // never turn the game's Repeat on: repeats come only from the Daily DG RUNS setting
  tapGame(P_DG_ITEM, "dg item entrance");
  var ok = false;
  for (var i = 0; i < 20 && !ok; i++) {
    sleep(500); dgChk();
    var im = grab();
    if (!im) continue;
    ok = fracIn(im, R_DG_CHAL, isBtnBlue, 4) > 0.5;
    im.recycle();
  }
  if (!ok) {                                   // Enter Dungeon dialog not detected: never give up here - go on to the next step (AUTO)
    if (dgInDungeon()) { log("DAILY DG: no Enter Dungeon dialog, the dungeon is already running -> AUTO step"); return dgAfterChallenge(it); }
    var imS = grab(), stillSel = false;
    if (imS) { stillSel = dgOnSelect(imS); imS.recycle(); }
    if (stillSel) { log("DAILY DG: Enter Dungeon dialog not seen, Select Dungeon still open -> tapping Challenge anyway"); tapGame(P_DG_CHALLENGE, "dg challenge (blind)"); sleep(800); dgChk(); }
    else log("DAILY DG: Enter Dungeon dialog not seen -> going on to the AUTO step");
    return dgAfterChallenge(it);
  }
  sleep(400); dgChk();
  tapGame(P_DG_CHALLENGE, "dg challenge");
  return dgAfterChallenge(it);
}
function dgAfterChallenge(it) {
  // 4) in the dungeon: wait until the cyan timer shows, then press the small AUTO button left of the Dungeon quest panel
  var seen = false;
  for (var w2 = 0; w2 < DG_LOAD_WAIT && !seen; w2 += 500) {
    sleep(500); dgChk();
    var imt = grab();
    if (!imt) continue;
    seen = fracIn(imt, R_DG_TIMER, isCyan, 3, "R") > 0.04;
    imt.recycle();
  }
  log(seen ? "DAILY DG: dungeon loaded" : "DAILY DG: timer not seen, pressing AUTO anyway");
  sleep(1500); dgChk();
  tapGame(P_DG_AUTO, "dg auto run");
  log("DAILY DG: entered " + it.name + " + auto run");
  toast("Started: " + it.name);
  return true;
}
// The dungeon is over when the cyan countdown timer (top right) has been gone for DG_END_ABSENT ms in a row
// (the game sends you back to town). Only counts after the timer has been seen at least once.
function dgWaitFinish() {
  var seen = false, absentSince = 0, t0 = Date.now();
  while (Date.now() - t0 < DG_MAX_RUN) {
    sleep(dqTravel ? 500 : 2000); dgChk();                      // look often while the boot is being tapped
    var im = grab();
    if (!im) continue;
    var has = fracIn(im, R_DG_TIMER, isCyan, 3, "R") > 0.04;
    if (has && !seen) { try { dqKick(); } catch (ek) {} }               // first quest of the dungeon: boot right away
    if (has) { try { dqWatch(im); } catch (eq) {} } else dqReset();     // dungeon only: another quest -> boot button
    im.recycle();
    if (has) {
      if (!seen && dgCur) { try { store.put("dg_done_" + dgCur, dayKey()); } catch (e) {} }   // dungeon really started -> done today
      seen = true; absentSince = 0;
    }
    else if (seen) { if (!absentSince) absentSince = Date.now(); if (Date.now() - absentSince >= DG_END_ABSENT) { try { dqAfterEnd(); } catch (ea) { if (String(ea) === "cancelled") throw ea; } return true; } }
    else if (Date.now() - t0 > 60000) { log("DAILY DG: dungeon timer never appeared (the entry tap was not detected) - skipping to the next dungeon"); return "skip"; }
  }
  log("DAILY DG: still running after " + Math.round(DG_MAX_RUN / 60000) + " min - queue stopped");
  return false;
}
function dgBtnSync() {      // keeps the main-panel DAILY DG button in step with the queue
  try {
    var on = !!(dgBusy || dgPending || dgArmed);
    ui.run(function () {
      try {
        V("btnDG").setText(on ? "DAILY DG: ON" : "DAILY DG: OFF");
        V("btnDG").setBackgroundColor(android.graphics.Color.parseColor(on ? "#2f7d4a" : "#3a4152"));
      } catch (e) {}
    });
  } catch (e) {}
}
setInterval(dgBtnSync, 1000);
function dgNextSel() {      // first dungeon (in list order) that is switched ON; with AUTO NEXT, then the first one not done today
  var i;
  for (i = 0; i < DAILY_LIST.length; i++) { var nm = DAILY_LIST[i].name; if (dgSel[nm] && !dgTried[nm] && (!dgDone(nm) || dgForce[nm])) return DAILY_LIST[i]; }   // ON stays ON; done-today ones are skipped
  if (dgBusy && dgAutoRun) {
    for (i = 0; i < DAILY_LIST.length; i++) {
      var n = DAILY_LIST[i].name;
      if (!dgTried[n] && !dgDone(n)) return DAILY_LIST[i];
    }
  }
  return null;
}
var P_BAG = [1799, 70, "R"];
var P_BAG_TAB7 = [1244, 790, "R"];                // Inventory window: tab "VII" on the left edge of the window                     // top-right bag / storage button (the "66%" icon)
// ===== BAG TAB VII ICON SCAN =====
// Tab VII is an 8 x 8 grid. BAG_X0/BAG_Y0 = top-left of the grid, BAG_CELL = cell size, in game px of the 2093-wide
// reference, anchored to the right edge ("R"). If taps land beside the icon, nudge these three numbers.
var BAG_X0 = 1311, BAG_Y0 = 141, BAG_CELL = 91.8, BAG_COLS = 8, BAG_ROWS = 8;
var P_MAP_MOVE = [865, 909, "R"];                // item info panel: MOVE button (teleports to the dungeon gate)
var P_WARP_OK = [854, 771];                      // "Warp - Do you want to warp to entrance?" dialog: Confirmation button
var R_WARP_OK = [700, 745, 1000, 795];           // blue band inside the Confirmation button (dialog detector)
var DG_MOVE_WAIT = 9000;                         // ms to let the teleport/loading finish before opening the gate
var P_BAG_CLOSE = [2027, 88, "R"];              // X of the Inventory window
var BAG_MAXD = 0.9;                              // largest colour distance still accepted as "this icon"
var BAG_OFFS = [[0, 0], [6, 0], [-6, 0], [0, 6], [0, -6], [10, 10], [-10, -10], [10, -10], [-10, 10]];   // grid nudges tried when the first pass finds nothing
// colour fingerprints (4x4x4 histogram of the icon area) taken from your tab VII screenshot
var BAG_TPL = {
  compass: [[0.493,0.007,0,0,0.042,0.132,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.028,0.035,0,0,0,0,0.021,0,0,0,0,0.062,0,0,0,0,0,0.021,0.007,0,0,0.021,0.007,0,0,0,0.021,0.083,0,0,0,0,0,0,0,0,0,0.007,0,0,0,0,0,0.014],[0.493,0.007,0,0,0.042,0.132,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.021,0.042,0,0,0,0,0.021,0,0,0,0,0.028,0,0,0,0,0,0.014,0.007,0,0,0.028,0,0,0,0,0.028,0.097,0,0,0,0,0,0,0,0,0,0.007,0,0,0,0,0.007,0.028],[0.507,0,0,0,0.042,0.125,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.021,0.042,0,0,0,0,0.021,0,0,0,0,0.049,0,0,0,0,0,0.014,0.007,0,0,0.028,0.014,0,0,0,0.014,0.076,0,0,0,0,0,0,0,0,0,0.007,0,0,0,0,0,0.035],[0.535,0,0,0,0.028,0.118,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.021,0.035,0,0,0,0,0.021,0,0,0,0,0.049,0,0,0,0,0,0.021,0,0,0,0.028,0.014,0,0,0,0.007,0.062,0,0,0,0,0,0,0,0,0,0.007,0,0,0,0,0.007,0.049],[0.507,0,0,0,0.049,0.118,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.021,0.042,0,0,0,0,0.021,0,0,0,0,0.028,0,0,0,0,0,0.021,0,0,0,0.028,0.007,0,0,0,0.021,0.09,0,0,0,0,0,0,0,0,0,0.007,0,0,0,0,0.007,0.035],[0.542,0.007,0,0,0.028,0.097,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.035,0.028,0,0,0,0,0.014,0.007,0,0,0,0.035,0,0,0,0,0,0.028,0,0,0,0.021,0.014,0,0,0,0.021,0.076,0,0,0,0,0,0,0,0,0,0.007,0,0,0,0,0.007,0.035],[0.535,0.007,0,0,0.028,0.104,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.028,0.035,0,0,0,0,0.014,0.007,0,0,0,0.028,0,0,0,0,0,0.021,0.007,0,0,0.021,0.021,0,0,0,0.007,0.097,0,0,0,0,0,0,0,0,0,0.007,0,0,0,0,0.007,0.028],[0.528,0.014,0,0,0.035,0.097,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.035,0.028,0,0,0,0,0.021,0,0,0,0,0.049,0,0,0,0,0,0.007,0.007,0,0,0.035,0,0,0,0,0.028,0.09,0,0,0,0,0,0,0,0,0,0.007,0,0,0,0,0,0.021],[0.535,0,0,0,0.028,0.111,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.021,0.035,0.007,0,0,0,0.028,0.007,0,0,0,0.042,0,0,0,0,0,0.021,0,0,0,0.028,0.014,0,0,0,0,0.069,0,0,0,0,0,0,0,0,0,0,0.007,0,0,0,0.014,0.035]],
  seal: [[0.799,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.201,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],[0.799,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.174,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.028,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],[0.778,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.194,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.021,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.007,0,0,0,0,0,0,0,0,0,0],[0.75,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.215,0,0,0,0,0.007,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.028,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],[0.757,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.201,0,0,0,0,0.014,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.028,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],[0.819,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.167,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.007,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.007,0,0,0,0,0,0,0,0,0],[0.708,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.264,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.021,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.007,0,0,0,0,0,0,0,0,0,0],[0.806,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.167,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.007,0,0,0,0.021,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],[0.812,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.188,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]],
  illu1: [[0.306,0.007,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.028,0.014,0,0,0.125,0.118,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.035,0.083,0.007,0,0.014,0.139,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.014,0.042,0.021,0,0,0.007,0.042,0],[0.34,0.049,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.014,0.014,0,0,0.062,0.049,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.042,0.104,0,0,0.014,0.174,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.014,0.049,0.028,0,0,0.007,0.042,0],[0.319,0.028,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.042,0.049,0,0,0.111,0.076,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.042,0.056,0,0,0.021,0.146,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.007,0.035,0.021,0,0,0.007,0.042,0],[0.354,0.035,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.028,0.007,0,0,0.132,0.056,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.035,0.076,0,0,0.014,0.146,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.007,0.056,0.007,0,0,0.007,0.042,0],[0.361,0.021,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.035,0.014,0,0,0.125,0.062,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.035,0.069,0,0,0.014,0.139,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.014,0.049,0.014,0,0,0.007,0.042,0],[0.347,0.021,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.028,0.028,0,0,0.139,0.056,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.028,0.042,0,0,0.007,0.174,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.014,0.049,0.021,0,0,0.007,0.042,0],[0.312,0.021,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.007,0.021,0,0,0.111,0.097,0.007,0,0,0,0,0,0,0,0,0,0,0,0,0,0.049,0.069,0,0,0.021,0.16,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.062,0.014,0,0,0.007,0.042,0],[0.326,0.049,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.028,0.007,0,0,0.125,0.076,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.042,0.062,0,0,0.014,0.153,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.007,0.049,0.014,0,0,0.007,0.042,0],[0.368,0.014,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.021,0.014,0,0,0.125,0.062,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.035,0.042,0,0,0.007,0.181,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.014,0.049,0.021,0,0,0.007,0.042,0]],
  siena2: [[0.396,0,0,0,0.333,0,0,0,0.174,0,0,0,0.007,0,0,0,0,0,0,0,0,0,0,0,0.007,0,0,0,0,0.049,0.014,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.014,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.007,0],[0.521,0,0,0,0.215,0,0,0,0.201,0,0,0,0.007,0,0,0,0,0,0,0,0,0,0,0,0,0.007,0,0,0,0.042,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.007,0],[0.403,0,0,0,0.34,0,0,0,0.146,0,0,0,0.021,0,0,0,0,0,0,0,0,0,0,0,0,0.007,0,0,0.021,0.056,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.007,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],[0.354,0,0,0,0.382,0,0,0,0.188,0,0,0,0.007,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.007,0.049,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.007,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.007,0],[0.583,0,0,0,0.174,0,0,0,0.201,0,0,0,0,0.007,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.028,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.007,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],[0.521,0,0,0,0.243,0,0,0,0.167,0,0,0,0.007,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.056,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.007,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],[0.194,0,0,0,0.542,0,0,0,0.125,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.007,0,0,0,0.035,0.056,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.042,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],[0.431,0,0,0,0.34,0,0,0,0.097,0.007,0,0,0.028,0,0,0,0,0,0,0,0,0,0,0,0.014,0.007,0,0,0.007,0.062,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.007,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],[0.215,0,0,0,0.535,0,0,0,0.104,0,0,0,0.007,0,0,0,0,0,0,0,0,0,0,0,0.007,0,0,0,0.014,0.083,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.021,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.007,0.007,0]],
  ruina: [[0.868,0,0,0,0.014,0.049,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.021,0,0,0,0,0.014,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.007,0.014,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.014],[0.861,0,0,0,0.028,0.035,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.014,0,0,0,0.021,0.007,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.007,0.021,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.007],[0.847,0,0,0,0.042,0.042,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.007,0.028,0,0,0,0,0.014,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.007,0.007,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.007,0],[0.861,0,0,0,0.042,0.028,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.049,0,0,0,0.014,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.007,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],[0.854,0,0,0,0.028,0.028,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.035,0,0,0,0,0.021,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.028,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.007],[0.847,0,0,0,0.049,0.035,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.014,0,0,0,0.007,0.007,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.021,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.007,0.014],[0.875,0,0,0,0.035,0.028,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.007,0.056,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],[0.875,0,0,0,0.021,0.028,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.035,0,0,0,0.007,0.014,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.007,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.014],[0.889,0,0,0,0.028,0.021,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.042,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.007,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.007,0.007]],
  disk: [[0.347,0.243,0,0,0,0.104,0.049,0,0,0,0.062,0.069,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.014,0.042,0,0,0.014,0.021,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.021,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.014],[0.368,0.222,0,0,0,0.111,0.042,0.007,0,0,0.049,0.069,0,0,0,0.007,0,0,0,0,0,0,0,0,0,0,0.035,0.028,0,0,0.007,0.021,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.028,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.007],[0.354,0.236,0,0,0,0.104,0.021,0,0,0,0.062,0.104,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.014,0.035,0,0,0.014,0.028,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.021,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.007],[0.347,0.229,0,0,0,0.104,0.007,0,0,0.014,0.021,0.09,0,0,0,0.042,0,0,0,0,0,0,0,0,0,0,0,0.007,0,0,0,0.104,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.028,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.007],[0.368,0.236,0,0,0,0.09,0.007,0,0,0,0.035,0.09,0,0,0,0.021,0,0,0,0,0,0,0,0,0,0,0,0.049,0,0,0.007,0.056,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.028,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.014],[0.368,0.222,0,0,0,0.104,0.049,0.007,0,0,0.049,0.069,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.035,0.035,0,0,0.007,0.014,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.035,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.007],[0.354,0.243,0,0,0,0.097,0,0,0,0,0.014,0.069,0,0,0,0.083,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.104,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.028,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.007],[0.361,0.229,0,0,0,0.104,0.049,0.007,0,0,0.056,0.062,0,0,0,0.007,0,0,0,0,0,0,0,0,0,0,0.028,0.028,0,0,0.014,0.021,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.035,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],[0.347,0.236,0,0,0,0.111,0,0,0,0,0.021,0.069,0,0,0,0.069,0,0,0,0,0,0,0,0,0,0,0,0.028,0,0,0,0.083,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.028,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.007]],
  epaulet2: [[0.674,0.062,0,0,0,0.035,0.056,0,0,0,0.021,0.021,0,0,0,0,0,0,0,0,0,0.021,0.014,0,0,0,0.021,0.014,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.042,0.007,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.007,0,0,0,0,0.007],[0.681,0.076,0,0,0,0.014,0.062,0,0,0,0.007,0.028,0,0,0,0,0,0,0,0,0,0.028,0.007,0,0,0,0.021,0.014,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.049,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.007,0,0,0,0,0.007],[0.688,0.062,0,0,0,0.021,0.035,0,0,0,0.014,0.042,0,0,0,0,0,0,0,0,0,0.028,0,0,0,0,0.014,0.021,0,0,0,0.007,0,0,0,0,0,0,0,0,0,0,0.056,0.014,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],[0.681,0.062,0,0,0,0.035,0.069,0,0,0,0,0.021,0,0,0,0,0,0,0,0,0,0.035,0.007,0,0,0,0.021,0.007,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.049,0.007,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.007],[0.688,0.056,0,0,0,0.028,0.049,0,0,0,0.007,0.042,0,0,0,0,0,0,0,0,0,0.035,0,0,0,0,0.007,0.021,0,0,0,0.007,0,0,0,0,0,0,0,0,0,0,0.056,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.007],[0.681,0.083,0,0,0,0.007,0.083,0,0,0,0.014,0.014,0,0,0,0,0,0,0,0,0,0.035,0.007,0,0,0,0.014,0.007,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.049,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.007,0],[0.688,0.056,0,0,0,0.028,0.056,0,0,0,0,0.035,0,0,0,0,0,0,0,0,0,0.028,0.007,0,0,0,0.021,0.014,0,0,0,0.007,0,0,0,0,0,0,0,0,0,0,0.049,0.007,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.007,0,0,0,0,0],[0.681,0.049,0,0,0,0.042,0.042,0,0,0,0.014,0.021,0,0,0,0.007,0,0,0,0,0,0.028,0.007,0,0,0,0.007,0.007,0,0,0,0.021,0,0,0,0,0,0,0,0,0,0,0.062,0.007,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.007,0,0,0,0,0],[0.667,0.069,0,0,0,0.035,0.049,0,0,0,0.021,0.021,0,0,0,0,0,0,0,0,0,0.035,0.021,0,0,0,0.021,0.014,0,0,0,0.007,0,0,0,0,0,0,0,0,0,0,0.035,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.007]],
  muster1: [[0.396,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.417,0.007,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.021,0.028,0,0,0.007,0.076,0.007,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.014,0.007,0,0,0,0.021,0,0,0,0,0],[0.396,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.396,0.007,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.056,0.007,0,0,0,0.062,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.042,0,0,0,0,0.028,0,0,0,0,0.007],[0.403,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.396,0.007,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.042,0.042,0,0,0.007,0.062,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.007,0.035,0,0,0,0,0],[0.396,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.424,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.049,0.028,0,0,0,0.09,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.007,0.007],[0.396,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.396,0.014,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.035,0.035,0,0,0.007,0.076,0.007,0,0,0,0.007,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.007,0.021,0,0,0,0,0],[0.396,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.403,0.007,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.042,0.035,0,0,0,0.042,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.021,0.007,0,0,0,0.035,0,0,0,0,0.014],[0.396,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.389,0.007,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.062,0.014,0,0,0,0.069,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.035,0,0,0,0.007,0.021,0,0,0,0,0],[0.403,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.375,0.014,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.056,0.021,0,0,0.007,0.069,0.007,0,0,0.014,0,0,0,0,0,0,0,0,0,0,0,0.014,0,0,0,0,0.007,0,0,0,0,0.014],[0.396,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.424,0.007,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.042,0.014,0,0,0.014,0.09,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.014,0,0,0,0,0,0,0,0,0,0]],
  radiant: [[0.569,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.16,0,0,0,0.042,0.104,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.069,0,0,0,0.042,0.014,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],[0.618,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.076,0,0,0,0.028,0.111,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.104,0,0,0,0.049,0.014,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],[0.576,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.146,0,0,0,0.035,0.083,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.104,0,0,0,0.042,0.014,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],[0.583,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.139,0,0,0,0.035,0.118,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.069,0,0,0,0.042,0.014,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],[0.653,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.076,0,0,0,0.028,0.09,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.097,0,0,0,0.042,0.014,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],[0.646,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.083,0,0,0,0.035,0.104,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.076,0,0,0,0.042,0.014,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],[0.611,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.104,0,0,0,0.049,0.069,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.104,0,0,0,0.042,0.021,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],[0.569,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.118,0,0,0,0.062,0.118,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.076,0,0,0,0.035,0.021,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],[0.632,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.083,0,0,0,0.042,0.069,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.111,0,0,0,0.049,0.014,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]],
  siena1: [[0.056,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.431,0,0,0,0.16,0,0,0,0,0,0,0,0,0,0,0,0.042,0,0,0,0.139,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.083,0,0,0,0.028,0.042,0.007,0,0,0.014,0,0],[0.278,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.375,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.076,0,0,0,0.125,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.049,0,0,0,0.021,0.069,0,0,0,0.007,0,0],[0.049,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.396,0,0,0,0.215,0,0,0,0,0,0,0,0,0,0,0,0.062,0,0,0,0.111,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.083,0.014,0,0,0.056,0.007,0,0,0,0.007,0,0],[0.014,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.181,0,0,0,0.431,0,0,0,0,0,0,0,0,0,0,0,0.062,0,0,0,0.076,0,0,0,0,0,0,0,0,0,0,0,0.007,0,0,0,0.118,0,0,0,0.028,0.069,0,0,0,0.014,0,0],[0.035,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.299,0,0,0,0.285,0,0,0,0,0,0,0,0,0,0,0,0.083,0,0,0,0.146,0,0,0,0,0,0,0,0,0,0,0,0.007,0,0,0,0.083,0.007,0,0,0.021,0.021,0,0,0,0.007,0.007,0],[0.472,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.188,0,0,0,0.007,0,0,0,0,0,0,0,0,0,0,0,0.056,0,0,0,0.215,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.042,0,0,0,0,0.014,0,0,0,0.007,0,0],[0.236,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.417,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.083,0,0,0,0.111,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.042,0,0,0,0.035,0.056,0,0,0,0.021,0,0],[0.007,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.132,0,0,0,0.396,0.007,0,0,0,0,0,0,0,0,0,0,0.076,0,0,0,0.16,0.007,0,0,0,0,0,0,0,0,0,0,0.007,0,0,0,0.097,0.007,0,0,0.028,0.028,0,0,0,0.049,0,0],[0.056,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.465,0,0,0,0.118,0,0,0,0,0,0,0,0,0,0,0,0.076,0,0,0,0.076,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.132,0,0,0,0.028,0.042,0,0,0,0.007,0,0]],
  mappart: [0.625,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.014,0,0,0,0.083,0.007,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.104,0.118,0,0,0,0.042,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.007,0,0,0,0,0,0],
  epaulet: [0.778,0.111,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.069,0.014,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.028,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
  yinyang: [0.194,0.035,0,0.004,0,0.018,0.024,0.047,0,0,0.007,0.069,0,0,0,0.047,0.053,0,0,0,0.001,0.011,0.004,0.004,0,0,0.001,0.031,0,0,0,0.064,0.056,0,0,0,0.022,0.001,0,0,0,0,0,0,0,0,0,0.028,0.049,0,0,0,0.118,0.003,0,0,0.042,0.007,0,0,0.024,0.036,0,0],
  oval: [0.667,0.007,0,0,0,0.083,0.035,0,0,0,0,0,0,0,0,0,0.007,0,0,0,0,0.021,0.042,0,0,0,0.007,0.076,0,0,0,0.007,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.049,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
  leaf: [0.173,0.002,0,0,0.158,0.254,0.002,0,0,0.063,0.011,0,0,0,0,0,0,0,0,0,0.015,0.083,0,0,0.003,0.121,0.052,0,0,0.003,0.009,0,0,0,0,0,0,0,0,0,0,0.002,0.005,0,0,0.022,0.021,0.001,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.001,0],
  feather: [0.001,0.002,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.002,0.481,0,0,0,0,0.003,0,0,0,0,0,0,0,0,0,0,0.012,0,0,0,0.021,0.137,0.002,0,0,0.002,0.003,0,0,0,0,0,0,0,0,0,0,0.001,0,0,0,0.009,0.322],
  silverkey: [0.817,0.023,0,0,0,0.002,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.106,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.021,0.009,0,0,0,0.007,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.014],
  mirrorP: [0.38,0.03,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.021,0.009,0.049,0,0.049,0.035,0.016,0,0,0,0,0,0,0,0,0,0,0.002,0.009,0,0.012,0.111,0.009,0.016,0,0.141,0.028,0,0,0,0,0,0,0,0,0,0,0,0,0.007,0,0.023,0.032,0.014,0,0,0.007,0],
  mirrorO: [0.382,0.012,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.116,0,0,0,0.039,0.002,0,0,0,0,0,0,0,0,0,0,0.016,0,0,0,0.088,0.125,0,0,0,0.15,0.005,0,0,0,0,0,0,0,0,0,0.007,0.007,0,0,0.002,0.03,0.012,0,0,0.002,0.005,0],
  redkey: [0.759,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.207,0.003,0,0,0,0.002,0,0,0,0,0,0,0,0,0,0,0.002,0.002,0,0,0,0.024,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.002,0,0,0,0,0,0,0,0,0],
  purplekey: [0.613,0.233,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.115,0.031,0,0,0,0.002,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.007,0,0,0,0],
  greenstaff: [0.569,0,0,0,0.31,0,0,0,0.012,0,0,0,0,0,0,0,0,0,0,0,0.001,0,0,0,0.01,0.043,0,0,0,0.001,0.001,0,0,0,0,0,0,0,0,0,0,0,0.001,0,0,0.008,0.015,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.022,0.004],
  empty: [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]
};
function bagHist(img, gx, gy) {         // gx,gy = cell top-left (game px, right anchored)
  var h = [], i, j, n = 12;
  for (i = 0; i < 64; i++) h.push(0);
  var iw = img.getWidth(), ih = img.getHeight();
  for (j = 0; j < n; j++) for (i = 0; i < n; i++) {
    var m = map([gx + (0.15 + 0.70 * (i + 0.5) / n) * BAG_CELL, gy + (0.22 + 0.68 * (j + 0.5) / n) * BAG_CELL, "R"]);
    var x = Math.min(Math.max(m[0], 0), iw - 1), y = Math.min(Math.max(m[1], 0), ih - 1);
    var c = images.pixel(img, x, y);
    h[((colors.red(c) >> 6) << 4) | ((colors.green(c) >> 6) << 2) | (colors.blue(c) >> 6)] += 1;
  }
  for (i = 0; i < 64; i++) h[i] /= (n * n);
  return h;
}
function bagDist(a, b) { var d = 0; for (var i = 0; i < 64; i++) d += Math.abs(a[i] - b[i]); return d; }
function bagDistT(h, tp) {            // template = one fingerprint, or a list of variants (icons that pulse / animate): best variant wins
  if (tp[0] && tp[0].length !== undefined) { var m = 99; for (var v = 0; v < tp.length; v++) { var dv = bagDist(h, tp[v]); if (dv < m) m = dv; } return m; }
  return bagDist(h, tp);
}
var BAG_MAXD_V = 0.45;                // largest distance accepted for a multi-variant template
function bagFind(img, key) {          // first cell (row by row) whose icon is `key`; null if none
  var tp = BAG_TPL[key];
  if (!tp) return null;
  if (tp[0] && tp[0].length !== undefined) {         // multi-variant template: take the single best-matching cell in the whole grid
    var bestC = null, bestD = 99;
    for (var r2 = 0; r2 < BAG_ROWS; r2++) for (var c2 = 0; c2 < BAG_COLS; c2++) {
      var gx2 = BAG_X0 + c2 * BAG_CELL, gy2 = BAG_Y0 + r2 * BAG_CELL;
      var h2 = bagHist(img, gx2, gy2), d2 = bagDistT(h2, tp);
      if (d2 < bestD) { bestD = d2; bestC = { row: r2 + 1, col: c2 + 1, d: d2, x: Math.round(gx2 + BAG_CELL / 2), y: Math.round(gy2 + BAG_CELL / 2) }; }
    }
    return (bestC && bestD <= BAG_MAXD_V) ? bestC : null;
  }
  for (var o = 0; o < BAG_OFFS.length; o++) {
    for (var r = 0; r < BAG_ROWS; r++) for (var c = 0; c < BAG_COLS; c++) {
      var gx = BAG_X0 + c * BAG_CELL + BAG_OFFS[o][0], gy = BAG_Y0 + r * BAG_CELL + BAG_OFFS[o][1];
      var h = bagHist(img, gx, gy), dk = bagDist(h, tp);
      if (dk > BAG_MAXD) continue;
      var best = true;
      for (var k in BAG_TPL) if (k !== key && bagDistT(h, BAG_TPL[k]) < dk) { best = false; break; }
      if (best) return { row: r + 1, col: c + 1, d: dk, x: Math.round(gx + BAG_CELL / 2), y: Math.round(gy + BAG_CELL / 2) };
    }
  }
  return null;
}
function dgBagClose() { try { tapGame(P_BAG_CLOSE, "DAILY DG: close bag"); } catch (e) {} sleep(800); }
function dgEnterFromBag0(it) {         // bag -> tab VII -> tap this dungeon's item icon. true = dungeon is running
  sleep(500); dgChk();
  if (!ensureCapture()) { toast("No screen capture - allow screen capture for AutoX.js"); return false; }
  log("DAILY DG: bag route for " + it.name);
  tapGame(P_BAG, "DAILY DG: tap bag (storage)"); sleep(1500); dgChk();
  tapGame(P_BAG_TAB7, "DAILY DG: bag slot VII"); sleep(1200); dgChk();
  var img = grab();
  if (!img) { dgBagClose(); return false; }
  var hit = null;
  if (!it.cellLearned) { try { hit = bagFind(img, it.icon); } catch (e) { log("bag scan error: " + e); } }
  img.recycle();
  if (!hit && it.cell) {              // no icon fingerprint for this item: use its fixed cell in tab VII
    var cr = it.cell[0] - 1, cc = it.cell[1] - 1;
    hit = { row: it.cell[0], col: it.cell[1], d: 0, x: Math.round(BAG_X0 + cc * BAG_CELL + BAG_CELL / 2), y: Math.round(BAG_Y0 + cr * BAG_CELL + BAG_CELL / 2) };
    log("DAILY DG: " + it.name + " - using fixed bag cell row " + hit.row + ", col " + hit.col);
  }
  if (!hit) { log("DAILY DG: " + it.name + " icon not found in bag tab VII"); toast("No " + it.sub + " in bag tab VII"); dgBagClose(); return false; }
  log("DAILY DG: " + it.name + " icon at row " + hit.row + ", col " + hit.col + " (match " + hit.d.toFixed(2) + ")");
  tapGame([hit.x, hit.y, "R"], "DAILY DG: tap " + it.sub);
  if (it.move !== false) {            // every dungeon item shows an info panel with MOVE (unless the item already opened the dungeon window)
    sleep(1200); dgChk();
    var im0 = grab(), already = false;
    if (im0) { already = dgOnSelect(im0) || fracIn(im0, R_DG_CHAL, isBtnBlue, 4) > 0.5; im0.recycle(); }
    if (!already) {
      tapGame(P_MAP_MOVE, "DAILY DG: MOVE to " + it.name + " gate");
      for (var wq = 0; wq < 10; wq++) {                    // up to 5 s: confirm the Warp dialog when it appears
        sleep(500); dgChk();
        var iw = grab();
        if (!iw) continue;
        var warp = fracIn(iw, R_WARP_OK, isBtnBlue, 4) > 0.5; iw.recycle();
        if (warp) { tapGame(P_WARP_OK, "DAILY DG: warp Confirmation"); break; }
      }
      for (var mw = 0; mw < DG_MOVE_WAIT; mw += 500) { sleep(500); dgChk(); }
      log("DAILY DG: moved, opening the gate");
      if (it.y !== undefined) return dgEnter(it);          // known row: pick it in Select Dungeon
      tapGame(P_DG_CENTER, "dg open Select Dungeon");      // no row known: open the gate and try the preselected dungeon
      for (var gq = 0; gq < 12; gq++) {
        sleep(500); dgChk();
        var ig = grab();
        if (!ig) continue;
        var og = dgOnSelect(ig); ig.recycle();
        if (og) { sleep(600); dgChk(); return dgLaunch(it); }
      }
      log("DAILY DG: Select Dungeon did not open after MOVE");
      return false;
    }
  }
  for (var q = 0; q < 14; q++) {      // up to ~7 s: wait for the dungeon window the game opens
    sleep(500); dgChk();
    var im = grab();
    if (!im) continue;
    var onSel = dgOnSelect(im), chal = fracIn(im, R_DG_CHAL, isBtnBlue, 4) > 0.5;
    im.recycle();
    if (chal) { log("DAILY DG: Enter Dungeon dialog opened by the item"); sleep(400); dgChk(); tapGame(P_DG_CHALLENGE, "dg challenge"); return dgAfterChallenge(it); }
    if (onSel) { log("DAILY DG: dungeon window opened by the item"); sleep(600); dgChk(); return dgLaunch(it); }
  }
  if (dgInDungeon()) { log("DAILY DG: no dungeon window, the dungeon is already running -> AUTO step"); return dgAfterChallenge(it); }
  log("DAILY DG: tapped the item but no dungeon window opened");
  toast("Item tap did not open " + it.name);
  dgBagClose();
  return false;
}
function dgEnterFromBag(it) {         // wrapper: never leave the Inventory window open when cancelled
  try { return dgEnterFromBag0(it); }
  catch (e) { try { dgBagClose(); } catch (e2) {} throw e; }
}
function dgRunQueue() {
  if (dgBusy) return;                            // already running: never start a second queue thread
  dgBusy = true; dgCancel = false;               // set BEFORE the thread starts (closes the double-tap race)
  dgAutoRun = dgAutoGet(); dgTried = {};
  try { closeDaily(); } catch (ec) {}            // the popup must not cover the game while we tap (never let it leave dgBusy stuck)
  threads.start(function () {
    try {
      var it;
      while ((it = dgNextSel())) {
        dgCur = it.name; dgChk();
        dgTried[it.name] = true; it.noItem = false;
        var runs = dgRunsGet(), halt = false, doneRuns = 0;
        try {
          for (var rn = 1; rn <= runs; rn++) {
            if (runs > 1) log("DAILY DG: " + it.name + " run " + rn + "/" + runs);
            var started = false;
            if (it.icon || it.cell) started = dgEnterFromBag(it);                        // bag tab VII: tap this dungeon's item
            if (!started && it.y !== undefined && !it.noItem) started = dgEnter(it);        // otherwise (or if the bag route failed): Select Dungeon list
            if (!started) {
              if (rn > 1) log("DAILY DG: could not start run " + rn + " of " + it.name + " (no entry item left?) - " + doneRuns + "/" + runs + " done");
              else log("DAILY DG: " + it.name + " did not start - going on with the next dungeon");
              break;
            }
            log("DAILY DG: waiting for " + it.name + " to finish");
            var wf = dgWaitFinish();
            if (wf === "skip") { try { dgCloseSelect(); } catch (ecs) { if (ecs === "cancelled") throw ecs; } break; }   // tap not detected: next dungeon, DAILY DG stays ON
            if (!wf) { halt = true; break; }                                      // only a dungeon stuck for 90 min stops the queue
            doneRuns++;
            log("DAILY DG: " + it.name + " finished" + (runs > 1 ? " (" + doneRuns + "/" + runs + ")" : ""));
            sleep(4000); dgChk();                                              // back in town, let the screen settle
          }
        } catch (ed) {
          if (ed === "cancelled") throw ed;
          log("DAILY DG: error in " + it.name + " (" + ed + ") - going on with the next dungeon");   // one failing dungeon never switches the whole DAILY DG off
          try { dgCloseSelect(); } catch (ecs2) { if (ecs2 === "cancelled") throw ecs2; }
        }
        // the dungeon stays switched ON (permanent after SAVE); dgTried makes the queue go on with the next ON dungeon
        if (halt) break;
        var nx = dgNextSel();
        if (nx) log("DAILY DG: next -> " + nx.name + (dgSel[nx.name] ? "" : "  (auto next)"));
      }
    } catch (e) {
      if (e === "cancelled") { log("DAILY DG: stopped"); toast("Daily DG stopped"); }
      else log("daily dg error: " + e);
    } finally {
      dgBusy = false; dgCur = ""; dgCancel = false; dgTried = {}; dgForce = {}; dgArmed = false; dgAutoRun = false;   // ON switches are kept
    }
  });
}
function dgStartSoon() {    // short countdown so several dungeons can be switched ON before the first one starts
  if (dgPending) return;
  dgPending = true;
  threads.start(function () {
    while (Date.now() < dgGoAt) sleep(250);
    dgPending = false;
    if (dgNextSel() && !dgBusy) dgRunQueue();
  });
}
function dailyRender() {
  if (!dpw) return;
  var box = dpw.dpItems, d = context.getResources().getDisplayMetrics().density, Color = android.graphics.Color;
  function pad(v, a, b, c, e) { v.setPadding(Math.round(a * d), Math.round(b * d), Math.round(c * d), Math.round(e * d)); }
  box.removeAllViews();
  DAILY_LIST.forEach(function (it) {
    var row = new android.widget.LinearLayout(context);
    row.setOrientation(0); row.setGravity(16); pad(row, 6, 4, 6, 4);
    var col = new android.widget.LinearLayout(context);
    col.setOrientation(1);
    var t1 = new android.widget.TextView(context);
    t1.setText((dgDone(it.name) ? "\u2713 " : "") + it.name); t1.setTextColor(dgDone(it.name) ? Color.parseColor("#9fe6a0") : Color.WHITE);
    t1.setTextSize(12); t1.setTypeface(null, 1);
    var t2 = new android.widget.TextView(context);
    t2.setText(it.sub); t2.setTextColor(Color.parseColor("#8b93a7")); t2.setTextSize(10);
    col.addView(t1); col.addView(t2);
    row.addView(col, new android.widget.LinearLayout.LayoutParams(0, -2, 1));
    var cb = new android.widget.TextView(context);
    cb.setText(it.cell ? "R" + it.cell[0] + "C" + it.cell[1] : "SET"); cb.setTextSize(10); cb.setGravity(17); cb.setTypeface(null, 1);
    cb.setTextColor(Color.parseColor(it.cell ? "#9fd0ff" : "#e0b84a"));
    cb.setBackgroundColor(Color.parseColor("#232b3b")); pad(cb, 8, 8, 8, 8);
    var clp = new android.widget.LinearLayout.LayoutParams(-2, -2); clp.setMargins(0, 0, Math.round(4 * d), 0);
    cb.setOnClickListener(function () { dgLearnCell(it); });
    row.addView(cb, clp);
    var isOn = !!dgSel[it.name];
    var b = new android.widget.TextView(context);
    b.setText(isOn ? "ON" : "OFF"); b.setTextColor(Color.WHITE); b.setTextSize(12); b.setTypeface(null, 1); b.setGravity(17);
    b.setBackgroundColor(Color.parseColor(isOn ? "#2f7d4a" : "#3a4152")); pad(b, 16, 8, 16, 8);
    b.setOnClickListener(function () {
      if (dgSel[it.name]) {                                                   // ON -> OFF
        if (dgBusy && dgCur === it.name) { dgCancel = true; dgSel[it.name] = false; toast("Stopping..."); }   // the running one: stop the whole queue
        else { dgSel[it.name] = false; toast("Removed: " + it.name); }
        dailyRender(); return;
      }
      var now = Date.now();
      if (dgDone(it.name) && !(dgLastTap === it.name && now - dgLastAt < 6000)) {
        dgLastTap = it.name; dgLastAt = now; toast("Done today - tap again to run anyway"); return;
      }
      dgSel[it.name] = true; if (dgDone(it.name)) dgForce[it.name] = true;    // OFF -> ON (done today + tapped twice = run it again)
      if (dgBusy) { toast("Queued: " + it.name); dailyRender(); return; }    // added to the running queue
      toast("ON: " + it.name + " - press START DG when ready");
      dailyRender();
    });
    row.addView(b);
    box.addView(row);
  });
}
function openDaily() {
  if (dpw) { closeDaily(); return; }             // button toggles the popup
  if (!dgBusy && !dgPending) { try { dgSelLoadIfEmpty(); } catch (el) {} }   // reopened: the saved ON dungeons are ON again
  dpw = floaty.window(sc(
    '<vertical w="match_parent" bg="#F2111722" padding="4">' +
      '<horizontal gravity="center_vertical">' +
        '<text id="dpHdr" text="DAILY DG (drag here)" textColor="#e0b84a" textSize="12sp" textStyle="bold" layout_weight="1" padding="6"/>' +
        '<text id="dpClose" text="\u2715" textColor="#ffffff" textSize="16sp" textStyle="bold" padding="8"/>' +
      '</horizontal>' +
      '<text text="switch dungeons ON (first in the list runs first), press SAVE to keep them ON, then START DG" textColor="#6f778a" textSize="9sp" padding="4"/>' +
      '<horizontal gravity="center_vertical" padding="4">' +
        '<text text="Runs per dungeon" textColor="#e8ecf5" textSize="11sp" textStyle="bold" layout_weight="1"/>' +
        '<text id="dpMinus" text="\u2212" textColor="#ffffff" textSize="16sp" textStyle="bold" gravity="center" bg="#3a4152" w="38" h="34"/>' +
        '<text id="dpRuns" text="1" textColor="#e0b84a" textSize="15sp" textStyle="bold" gravity="center" w="44" h="34"/>' +
        '<text id="dpPlus" text="+" textColor="#ffffff" textSize="16sp" textStyle="bold" gravity="center" bg="#3a4152" w="38" h="34"/>' +
      '</horizontal>' +
      '<text id="dpAuto" text="AUTO NEXT: OFF" textColor="#ffffff" textSize="12sp" textStyle="bold" gravity="center" bg="#3a4152" padding="8" marginTop="2" marginBottom="2"/>' +
      '<horizontal>' +
        '<button id="dpStart" text="START DG" layout_weight="1" h="36" bg="#2f7d4a" textColor="#ffffff" textSize="12sp" textStyle="bold" padding="0"/>' +
        '<button id="dpSave" text="SAVE" layout_weight="1" h="36" bg="#2b5fa8" textColor="#ffffff" textSize="12sp" textStyle="bold" padding="0" marginLeft="4"/>' +
      '</horizontal>' +
      '<ScrollView id="dpScroll" h="200" bg="#0b0e13"><vertical id="dpItems"/></ScrollView>' +
      '<horizontal gravity="center_vertical">' +
        '<text text="drag the corner to resize" textColor="#6f778a" textSize="9sp" layout_weight="1" padding="4"/>' +
        '<text id="dpGrip" text="\u25E2" textColor="#e0b84a" textSize="26sp" padding="14 6"/>' +
      '</horizontal>' +
    '</vertical>'
  ));
  dpw.setPosition(40, 140);
  try { dpw.disableFocus(); } catch (e) {}
  // ---- resizable: width + list height (saved between runs) ----
  var dm = context.getResources().getDisplayMetrics(), dn = dm.density;
  var minW = Math.round(200 * dn), minH = Math.round(80 * dn);
  var curW = Math.round(280 * UI_SCALE * dn), curH = Math.round(200 * UI_SCALE * dn);
  try {
    var sw = store.get("dpW", 0), sh = store.get("dpH", 0);
    if (sw > 0) curW = sw;
    if (sh > 0) curH = sh;
  } catch (e) {}
  function applySize() {
    var maxW = dm.widthPixels - Math.max(0, dpw.getX());
    var maxH = Math.round(dm.heightPixels * 0.8);
    curW = Math.max(minW, Math.min(curW, Math.max(minW, maxW)));
    curH = Math.max(minH, Math.min(curH, maxH));
    try { dpw.setSize(curW, -2); } catch (e) {}
    try {
      var lp = dpw.dpScroll.getLayoutParams();
      lp.height = curH;
      dpw.dpScroll.setLayoutParams(lp);
    } catch (e) {}
  }
  applySize();
  var gx0, gy0, gw0, gh0;
  dpw.dpGrip.setOnTouchListener(function (view, event) {
    switch (event.getAction()) {
      case 0: gx0 = event.getRawX(); gy0 = event.getRawY(); gw0 = curW; gh0 = curH; return true;
      case 2:
        curW = gw0 + Math.round(event.getRawX() - gx0);
        curH = gh0 + Math.round(event.getRawY() - gy0);
        applySize();
        return true;
      case 1: case 3:
        try { store.put("dpW", curW); store.put("dpH", curH); } catch (e) {}
        return true;
    }
    return true;
  });
  var px0, py0, pwx, pwy;
  dpw.dpHdr.setOnTouchListener(function (view, event) {
    switch (event.getAction()) {
      case 0: px0 = event.getRawX(); py0 = event.getRawY(); pwx = dpw.getX(); pwy = dpw.getY(); return true;
      case 2: dpw.setPosition(pwx + (event.getRawX() - px0), pwy + (event.getRawY() - py0)); return true;
    }
    return true;
  });
  dpw.dpClose.on("click", closeDaily);
  function runsShow() { try { dpw.dpRuns.setText(String(dgRunsGet())); } catch (e) {} }
  dpw.dpMinus.on("click", function () { dgRunsSet(dgRunsGet() - 1); runsShow(); });
  dpw.dpPlus.on("click", function () { dgRunsSet(dgRunsGet() + 1); runsShow(); });
  runsShow();
  function autoShow() {
    var on = dgAutoGet();
    try {
      dpw.dpAuto.setText("ONLY dungeons switched ON will run");
      dpw.dpAuto.setBackgroundColor(android.graphics.Color.parseColor(on ? "#2f7d4a" : "#3a4152"));
    } catch (e) {}
  }
  dpw.dpAuto.on("click", function () {
    toast("Only dungeons switched ON run - nothing else is tapped");
  });
  autoShow();
  dpw.dpStart.on("click", function () {
    if (dgBusy) { toast("Daily DG is already running"); return; }
    if (!dgNextSel() && !dgAutoGet()) { toast("Switch at least one dungeon ON first"); return; }
    dgArmed = true; dgBtnSync();
    dgRunQueue();
  });
  function saveShow() { try { dpw.dpSave.setText("SAVE (" + dgSelSaved().length + ")"); } catch (e) {} }
  dpw.dpSave.on("click", function () {
    var n = dgSelSave();
    saveShow();
    toast(n ? "Saved: " + n + " dungeon(s) stay ON after closing" : "Saved: none ON");
  });
  saveShow();
  dailyRender();
}
dgSelLoadIfEmpty();                                // script start: the saved ON dungeons are ON again
V("btnDaily").on("click", openDaily);

// ===== USE PROTECTION OF VERADRIX (taps its quick slot; the effect lasts only inside a dungeon) =====
// Quick bar = 8 slots at y 1030, centred UI: slot 1 at x 545, 127.6 apart (taken from the Cabal screenshots).
var P_VERA_X0 = 545, P_VERA_DX = 127.6, P_VERA_Y = 1030;
V("btnVera").on("click", function () {
  releaseFocus();
  var slot = num(V("ivslot"), DEF.vSlot, 1, 8);
  C.vSlot = slot; try { store.put("vSlot", slot); } catch (e) {}
  threads.start(function () {
    try {
      if (!ensureCapture()) { toast("No screen capture - allow screen capture for AutoX.js"); return; }
      tapGame([Math.round(P_VERA_X0 + (slot - 1) * P_VERA_DX), P_VERA_Y], "use Protection of Veradrix (quick slot " + slot + ")");
      toast("Veradrix: tapped quick slot " + slot);
    } catch (e) { log("veradrix err: " + e); }
  });
});

// ===== OWNER: KEY GENERATOR (needs admin = true on your users/<uid> doc) =====
function randomKey(prefix) {
  var A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789", R = new java.security.SecureRandom(), out = prefix || "CABAL";
  for (var g = 0; g < 3; g++) {
    out += "-";
    for (var i = 0; i < 4; i++) out += A.charAt(R.nextInt(A.length));
  }
  return out;
}
V("btnGenKeys").on("click", function () {
  if (!acctAdmin) { toast("Owner only"); return; }
  var days = parseInt(String(V("kdays").getText()), 10), cnt = parseInt(String(V("kcount").getText()), 10);
  if (!(days >= 1 && days <= 3650)) { toast("Days: 1-3650"); return; }
  var users = parseInt(String(V("kusers").getText()), 10) || 1;
  if (!(users >= 1 && users <= 100)) { toast("Users per key: 1-100"); return; }
  var custom = String(V("kcustom").getText()).trim().toUpperCase().replace(/\s+/g, "");
  var prefix = String(V("kprefix").getText()).trim().toUpperCase().replace(/[^A-Z0-9-]/g, "").replace(/-+$/, "");
  if (custom) {
    if (!/^[A-Z0-9-]{6,40}$/.test(custom)) { toast("Custom key: 6-40 chars, A-Z 0-9 and -"); return; }
    cnt = 1;
  } else {
    if (!(cnt >= 1 && cnt <= 20)) { toast("How many: 1-20"); return; }
    if (!prefix) prefix = "CABAL";
    if (prefix.length > 16) { toast("Prefix: max 16 chars"); return; }
  }
  releaseFocus();
  toast("Generating...");
  threads.start(function () {
    var keys, r, tries = 0;
    do {
      keys = []; var wr = [];
      for (var n = 0; n < cnt; n++) { var k = custom || randomKey(prefix); keys.push(k); wr.push(fsDoc("keys/" + k, users > 1 ? { days: { int: days }, usedBy: "", maxUses: { int: users }, uses: { int: 0 }, usedList: "" } : { days: { int: days }, usedBy: "" }, [], true)); }
      r = null;
      try { r = fbCommit(wr); } catch (e) {}
      tries++;
    } while (!(r && r.statusCode >= 200 && r.statusCode < 300) && r && r.statusCode === 409 && tries < 3);
    if (r && r.statusCode >= 200 && r.statusCode < 300) {
      var txt = keys.join("\n");
      try { setClip(txt); } catch (e) {}
      ui.run(function () { V("keyOut").setText(days + " days, " + users + (users > 1 ? " users each" : " user") + ":\n" + txt); });
      toast(cnt + " key(s) created and copied");
    } else {
      toast(r ? "Failed (" + r.statusCode + ") - is admin set and are the rules updated?" : "No connection");
    }
  });
});

// ===== OWNER: PUBLISH A NEW VERSION TO GITHUB + FIRESTORE =====
// Uploads the script file from this phone to a PUBLIC GitHub repo (commit-pinned raw link), checks the link
// serves the same bytes, then writes config/script (version / url / sha256) so users auto-update.
ui.run(function () { try { V("ghtok").setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD); } catch (e) {} });
function ghFill() {
  try {
    var o = JSON.parse(store.get("gh_cfg", "{}"));
    V("ghrepo").setText(o.repo || ""); V("ghbranch").setText(o.branch || "main");
    V("ghpath").setText(o.path || "main_v2.js"); V("ghfile").setText(o.file || "/sdcard/main_v2.js");
    V("ghtok").setText(o.tok ? credDec(o.tok) : "");
  } catch (e) {}
}
function ghPublish(repo, branch, rpath, file, tok) {      // returns a message for the owner
  if (!fbAuth) return "Log in first";
  var bytes;
  try {
    if (!files.exists(file)) return "File not found: " + file;
    bytes = files.readBytes(file);
  } catch (e) { return "Can't read the file: " + e; }
  if (bytes.length < 50000 || bytes.length > 900000) return "File size looks wrong (" + bytes.length + " bytes)";
  var text = String(new java.lang.String(bytes, "UTF-8"));
  var m = /var APP_VERSION = (\d+);/.exec(text);
  if (!m) return "No 'var APP_VERSION = n;' line in that file";
  var ver = parseInt(m[1], 10), cur = 0;
  try {
    if (Date.now() > fbAuth.exp && !fbRefresh()) return "Session expired - log in again";
    var cr = http.get("https://firestore.googleapis.com/v1/" + FS_DOC + "/config/script", { headers: { "Authorization": "Bearer " + fbAuth.idToken } });
    if (cr.statusCode === 200) { var cf = fbBody(cr).fields || {}; cur = cf.version ? (parseInt(cf.version.integerValue || cf.version.stringValue, 10) || 0) : 0; }
    else if (cr.statusCode !== 404) return "Can't read config/script (HTTP " + cr.statusCode + ")";
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
  var r = fbCommit([fsDoc("config/script", { version: { int: ver }, url: url, sha256: hash }, ["updatedAt"])]);
  if (!r || r.statusCode < 200 || r.statusCode >= 300) return "On GitHub, but writing config/script failed" + (r ? " (HTTP " + r.statusCode + ")" : "") + " - are the admin rules set?";
  return "Published v" + ver + " - users update within ~5 min";
}
V("btnGhPub").on("click", function () {
  dismissPaste();
  toast("Publish tapped...");
  if (!acctAdmin) { toast("Owner only - log in with the owner account first"); return; }
  var repo = String(V("ghrepo").getText()).trim(), branch = String(V("ghbranch").getText()).trim() || "main",
      rpath = String(V("ghpath").getText()).trim().replace(/^\/+/, ""), file = String(V("ghfile").getText()).trim(),
      tok = String(V("ghtok").getText()).trim();
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) { toast("Repo must look like owner/name"); return; }
  if (!/^[\w.\/-]+$/.test(branch)) { toast("Branch name has odd characters"); return; }
  if (!/^[\w.\/-]+\.js$/.test(rpath) || rpath.indexOf("..") >= 0) { toast("Path in repo must be like main_v2.js"); return; }
  if (!file) { toast("Type the file path on this phone"); return; }
  if (tok.length < 20) { toast("Paste your GitHub token"); return; }
  try { store.put("gh_cfg", JSON.stringify({ repo: repo, branch: branch, path: rpath, file: file, tok: credEnc(tok) })); } catch (e) {}
  releaseFocus();
  toast("Publishing...");
  threads.start(function () {
    var msg;
    try { msg = ghPublish(repo, branch, rpath, file, tok); } catch (e) { msg = "Publish error: " + e; }
    toast(msg);
    ui.run(function () { V("ghOut").setText(msg); });
  });
});

// ===== OWNER: FILE PICKER (fills "File on this phone") =====
var fpw = null, fpDir = "/sdcard";
function closeFp() { if (fpw) { try { fpw.close(); } catch (e) {} fpw = null; } }
function fpRender() {
  if (!fpw) return;
  var box = fpw.fpItems, d = context.getResources().getDisplayMetrics().density, Color = android.graphics.Color;
  function pad(v, a, b, c, e) { v.setPadding(Math.round(a * d), Math.round(b * d), Math.round(c * d), Math.round(e * d)); }
  function add(label, color, fn) {
    var tv = new android.widget.TextView(context);
    tv.setText(label); tv.setTextColor(Color.parseColor(color)); tv.setTextSize(12); pad(tv, 8, 9, 8, 9);
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
      V("ghfile").setText(f.full);
      if (!String(V("ghpath").getText()).trim()) V("ghpath").setText(f.n);
      toast("Selected: " + f.n);
      closeFp();
    });
  });
  if (!dirs.length && !js.length) add("no folders or .js files here (or storage access is off)", "#6f778a", function () {});
}
function openFp() {
  fpw = floaty.window(sc(
    '<vertical w="300" bg="#F2111722" padding="4">' +
      '<horizontal gravity="center_vertical">' +
        '<text id="fpHdr" text="PICK SCRIPT FILE (drag here)" textColor="#6ea8ff" textSize="12sp" textStyle="bold" layout_weight="1" padding="6"/>' +
        '<text id="fpClose" text="\u2715" textColor="#ffffff" textSize="16sp" textStyle="bold" padding="8"/>' +
      '</horizontal>' +
      '<text id="fpPath" text="" textColor="#8b93a7" textSize="10sp" padding="4"/>' +
      '<ScrollView h="280" bg="#0b0e13" marginTop="2"><vertical id="fpItems"/></ScrollView>' +
      '<text text="tap a .js file to select it (newest first)" textColor="#6f778a" textSize="9sp" padding="4"/>' +
    '</vertical>'
  ));
  fpw.setPosition(40, 120);
  try { fpw.disableFocus(); } catch (e) {}
  var fx0, fy0, fwx, fwy;
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
V("btnGhPick").on("click", function () {
  if (!acctAdmin) { toast("Owner only"); return; }
  if (fpw) { closeFp(); return; }                                       // button toggles the picker
  releaseFocus();
  try { var pf = new java.io.File(String(V("ghfile").getText()).trim()).getParentFile(); if (pf && pf.isDirectory()) fpDir = String(pf.getAbsolutePath()); } catch (e) {}
  openFp();
});

var forgotAt = 0;
V("btnForgot").on("click", function () {   // Firebase sends the reset link by email
  var email = cleanName(V("iuser").getText());
  if (email.indexOf("@") < 1) { toast("Type your account email in the username box, then tap Forgot password"); return; }
  if (Date.now() - forgotAt < 60000) { toast("Wait a minute before asking again"); return; }
  forgotAt = Date.now();
  toast("Sending reset email...");
  threads.start(function () {
    var msg;
    try {
      var res = http.postJson("https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=" + FB.apiKey,
                              { requestType: "PASSWORD_RESET", email: email });
      var j = fbBody(res), err = (j.error && j.error.message) || "";
      if (res.statusCode === 200) msg = "If that email has an account, a reset link was sent. Check spam too.";
      else if (/TOO_MANY/.test(err)) msg = "Too many tries - try later";
      else if (/INVALID_EMAIL/.test(err)) msg = "Invalid email";
      else msg = "Reset failed: " + (err || ("HTTP " + res.statusCode));
    } catch (e) { msg = "No connection to Firebase"; }
    toast(msg);
  });
});
function applyLock(lock) {
  ui.run(function () {
    var View = android.view.View;
    V("lockBox").setVisibility(lock ? View.VISIBLE : View.GONE);
    V("hdr").setVisibility(lock ? View.GONE : View.VISIBLE);
    V("logBox").setVisibility(lock ? View.GONE : View.VISIBLE);
    V("bodyScroll").setVisibility((lock || !expanded) ? View.GONE : View.VISIBLE);
    V("ilock").setText(""); V("icode").setText("");
    if (lock) {
      V("iuser").setText("");
      V("ilock2").setText(""); V("icode").setText("");
      regMode = false;
      acctAdmin = false; V("ghtok").setText(""); V("ghOut").setText(""); V("keyPanel").setVisibility(View.GONE); V("keyOut").setText(""); closeDg(); closeDaily(); closeFp();
      renderLock();
      fillSaved();
      releaseFocus();
    } else {
      var showPanel = fbOn() && acctAdmin;
      V("keyPanel").setVisibility(showPanel ? View.VISIBLE : View.GONE);
      if (showPanel) { try { ghFill(); } catch (e) {} }
      try { V("sAutoLogin").setVisibility(acctAdmin ? View.VISIBLE : View.GONE); if (!acctAdmin) V("sAutoLogin").setChecked(false); } catch (e) {}
      if (showPanel) { if (!String(V("kdays").getText())) V("kdays").setText("30"); if (!String(V("kcount").getText())) V("kcount").setText("1"); if (!String(V("kprefix").getText())) V("kprefix").setText("CABAL"); if (!String(V("kusers").getText())) V("kusers").setText("10"); }
      V("usersLbl").setText("USERS  (logged in: " + currentUser + (acctExp && !acctAdmin ? " | expires " + new Date(acctExp).toLocaleDateString() : "") + ")");
    }
  });
}
function doLogin() {
  var now = Date.now();
  if (now < lockUntil) { toast("Wait " + Math.ceil((lockUntil - now) / 1000) + "s"); return; }
  if (regMode || !(fbOn() || hasUsers())) { doRegister(); return; }
  var name = cleanName(V("iuser").getText()), pw = String(V("ilock").getText());
  if (fbOn()) {                            // Firebase Authentication
    var keyIn = String(V("icode").getText()).trim();
    if (!name || !pw) { toast("Enter username and password"); return; }
    toast("Checking key...");
    threads.start(function () {
      var ki = null;
      if (FB.requireKey && keyIn) {                 // a typed key is checked before the password is even tried
        ki = fbReadKey(keyIn, true);
        if (ki.err) { toast(keyMsg(ki.err)); return; }
      }
      var email = name.indexOf("@") >= 0 ? name : name + "@" + FB.domain, err;
      try { err = fbSignIn(email, pw); } catch (e) { err = "NETWORK"; }
      if (err) {
        ui.run(function () { V("ilock").setText(""); });
        if (/INVALID_LOGIN|INVALID_PASSWORD|EMAIL_NOT_FOUND|INVALID_EMAIL/.test(err)) {
          badTries++;
          if (badTries >= 5) { badTries = 0; lockUntil = Date.now() + 30000; toast("Too many tries - wait 30s"); }
          else toast("Wrong username or password");
        }
        else if (/USER_DISABLED/.test(err)) toast("Account disabled");
        else if (/TOO_MANY/.test(err)) toast("Too many tries - try later");
        else if (err === "NETWORK") toast("No connection to Firebase");
        else toast("Login failed: " + err);
        return;
      }
      var dev = fbDeviceCheck();
      if (dev !== "OK") {
        fbDrop();
        ui.run(function () { V("ilock").setText(""); });
        toast(dev === "OTHER" ? "This account is locked to another device" : "Can't verify device - check connection");
        return;
      }
      if (FB.requireKey && !acctAdmin) {            // owner (admin) accounts need no key
        if (!ki) { fbDrop(); toast("Enter your access key first"); return; }
        var mineShared = ki.multi && ki.list.split(",").indexOf(fbAuth.uid) >= 0;
        if (ki.multi ? mineShared : !!ki.usedBy) {  // used key: must be one of THIS account's keys
          if (!ki.multi && ki.usedBy !== fbAuth.uid) { fbDrop(); toast("This key belongs to another account"); return; }
        } else {                                    // fresh key: redeem it (renews / extends the account)
          var rr = fbRedeemKey(keyIn, null);
          if (rr.err) { fbDrop(); toast(keyMsg(rr.err)); return; }
          toast("New key added");
        }
      }
      if (!acctAdmin && acctExp && nowMs() >= acctExp) {
        fbDrop();
        toast(FB.requireKey ? "Account expired - enter a NEW key, then LOGIN" : "Account expired");
        return;
      }
      badTries = 0; currentUser = name;
      saveLogin(name, pw, keyIn, acctAdmin);
      try { fbCommit([fsDoc("users/" + fbAuth.uid, { name: name, email: email }, ["lastLogin"])]); } catch (e) {}
      fbStart();
      releaseFocus(); applyLock(false);
      toast("Welcome, " + name);
    });
    return;
  }
  var users = getUsers();
  if (own(users, name) && users[name] === userHash(name, pw)) {
    badTries = 0; currentUser = name; saveLogin(name, pw, ""); releaseFocus(); applyLock(false);
    toast("Welcome, " + name);
  } else {
    badTries++;
    V("ilock").setText("");
    if (badTries >= 5) { badTries = 0; lockUntil = now + 30000; toast("Too many tries - wait 30s"); }
    else toast("Wrong username or password");
  }
}
ui.run(function () { try { V("inewpass").setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD); } catch (e) {} });  // hide typed password
V("btnUnlock").on("click", doLogin);
V("btnLogout").on("click", function () { releaseFocus(); try { haltAll(); } catch (e) {} var who = currentUser; if (!acctAdmin) forgetLogin();   // a user who logs out on purpose is not signed in again at the next start
   threads.start(function () { fbSignOut(who); }); currentUser = ""; applyLock(true); });
V("btnUpdate").on("click", function () {
  releaseFocus();
  toast("Checking for update (you have v" + APP_VERSION + ")...");
  threads.start(function () { checkUpdate(true); });
});
V("btnAddUser").on("click", function () {
  if (fbOn()) { toast("Add users in the Firebase console (Authentication)"); return; }
  var name = cleanName(V("inewuser").getText()), pw = String(V("inewpass").getText());
  var users = getUsers();
  if (!validName(name)) { toast("Username: 3-20 letters/numbers/_ . -"); return; }
  if (pw.length < 4) { toast("Password needs 4+ characters"); return; }
  if (own(users, name)) { toast("User already exists"); return; }
  users[name] = userHash(name, pw); putUsers(users);
  V("inewuser").setText(""); V("inewpass").setText(""); releaseFocus();
  toast("User added: " + name);
});
V("btnDelUser").on("click", function () {
  if (fbOn()) { toast("Remove/disable users in the Firebase console"); return; }
  var name = cleanName(V("inewuser").getText());
  var users = getUsers(), n = 0;
  for (var k in users) n++;
  if (!own(users, name)) { toast("No such user"); return; }
  if (name === currentUser) { toast("Can't delete the user you're logged in as"); return; }
  if (n <= 1) { toast("Can't delete the last user"); return; }
  delete users[name]; putUsers(users);
  V("inewuser").setText(""); V("inewpass").setText(""); releaseFocus();
  toast("User deleted: " + name);
});
// drag the panel by the login title while logged out
var lkx0, lky0, lkwx, lkwy;
V("lockTitle").setOnTouchListener(function (view, event) {
  switch (event.getAction()) {
    case 0: lkx0 = event.getRawX(); lky0 = event.getRawY(); lkwx = w.getX(); lkwy = w.getY(); return true;
    case 2: w.setPosition(lkwx + (event.getRawX() - lkx0), lkwy + (event.getRawY() - lky0)); return true;
  }
  return true;
});

// ===== SAFETY WRAPPERS: a thrown error in a button action must never kill the panel or leave a stuck state =====
(function () {
  var _se = startEngine, _sp = stopEngine, _sr = startRespawn, _spr = stopRespawn, _dq = dgRunQueue, _od = openDaily;
  startEngine = function () {
    try { return _se.apply(this, arguments); }
    catch (e) { log("play err: " + e); running = false; keepRun = false; try { setStatus("idle"); } catch (e2) {} toast("Play failed - press play again"); }
  };
  stopEngine = function () {
    try { return _sp.apply(this, arguments); }
    catch (e) { log("stop err: " + e); running = false; keepRun = false; try { setStatus("idle"); } catch (e2) {} }
  };
  startRespawn = function () {
    try { return _sr.apply(this, arguments); }
    catch (e) { log("respawn start err: " + e); rOn = false; try { respSync(); } catch (e2) {} toast("Respawn failed - try again"); }
  };
  stopRespawn = function () {
    try { return _spr.apply(this, arguments); }
    catch (e) { log("respawn stop err: " + e); rOn = false; try { respSync(); } catch (e2) {} }
  };
  dgRunQueue = function () {
    try { return _dq.apply(this, arguments); }
    catch (e) { log("daily dg start err: " + e); dgBusy = false; dgArmed = false; dgPending = false; try { dgBtnSync(); } catch (e2) {} toast("Daily DG failed to start"); }
  };
  openDaily = function () {
    try { return _od.apply(this, arguments); }
    catch (e) { log("daily list err: " + e); try { closeDaily(); } catch (e2) {} }
  };
})();

fillInputs(C);
applyGame();
gameSync();
setStatus("idle");
applyOrientation(true);
applyLock(true);   // login required before the panel can be used
// AUTO LOGIN switch: at script start only (LOGOUT never re-triggers it), log in with the saved account
var autoSaved = loadLogin();
if (autoSaved && (autoSaved.a ? C.autoLogin : true)) {   // users: always sign in silently with the saved login (until the key / account expires); owner: only with the AUTO LOGIN switch
  ui.run(function () {                                  // hide the login form while the saved account is signed in silently
    var vg = V("lockBox");
    for (var i = 0; i < vg.getChildCount(); i++) { var ch = vg.getChildAt(i); if (ch !== V("lockTitle")) ch.setVisibility(android.view.View.GONE); }
    V("lockTitle").setText("Signing in...");
  });
  threads.start(function () {
    sleep(1200);                                   // let the lock screen finish drawing and fillSaved() paste the account
    ui.run(function () { try { doLogin(); } catch (e) { log("auto login err: " + e); } });
    for (var t = 0; t < 24 && !currentUser; t++) sleep(500);
    if (!currentUser) ui.run(function () {          // did not sign in: show the normal login panel again
      var vg = V("lockBox");
      for (var i = 0; i < vg.getChildCount(); i++) vg.getChildAt(i).setVisibility(android.view.View.VISIBLE);
      try { renderLock(); } catch (e) {}
    });
  });
}
setInterval(function () { try { applyOrientation(false); } catch (e) {} }, 1500);

// keep the script alive while the panel is open
try { startForegroundService(); } catch (e) {}
startExpiredWatcher();
setInterval(function () {}, 1000);
