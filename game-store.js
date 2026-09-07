// =====================================================================
// GAME STATE STORE
// Every panel on the Board renders FROM this object rather than being
// poked directly — that's what makes the backend swappable underneath.
// Every render*() function and every call site in this file only ever
// calls GameStore.getState() / setState() / setTurn() / setPlayer() /
// subscribe() / addLog() — never Firebase directly — so everything above
// this block works identically whether or not Firebase is configured.
//
// ---- TO GO LIVE ACROSS DEVICES (Board + Player phones + GM console) ----
// 1. Go to https://console.firebase.google.com, create a free project.
// 2. In the project, open "Realtime Database" and create a database.
//    Start it in TEST MODE for a classroom/base setting (no login
//    required) — under Rules, that looks like:
//      { "rules": { ".read": true, ".write": true } }
//    (Fine for a closed classroom/exercise setting. Do not use test-mode
//    rules for anything exposed to the public internet long-term.)
// 3. In Project Settings > General > "Your apps", add a Web app and copy
//    the config object it gives you.
// 4. Paste that config into FIREBASE_CONFIG below, replacing the
//    placeholder values.
// 5. Reload this file — the room bar at the bottom will switch from
//    "OFFLINE MODE" to "LIVE" once it connects.
// That's the entire integration; nothing else in this file needs to
// change, and it keeps working in local/offline mode for anyone who
// opens the file without doing this setup.
// =====================================================================
var FIREBASE_CONFIG = {
  apiKey: "AIzaSyBFIehA5YyDFeUyJWV9ZXbAj4djYb172A4",
  databaseURL: "https://confidently-wrong-cc-game-default-rtdb.firebaseio.com",
  projectId: "confidently-wrong-cc-game"
};

// The full board loop (48 spaces, index 0 = Hangar). Shared with
// player.html so hazard effects that need to check tile types (e.g. "move
// back N spaces, but one extra if that would land exactly on a pager") can
// be computed the same way from either the Board or a player's phone.
var BOARD_PATH = [
  { x:7.56,   y:86.63,  type:'hangar' },
  { x:7,      y:72.5,   type:'gauge' },
  { x:7,      y:60.486, type:'gauge' },
  { x:7,      y:48.472, type:'hazard' },
  { x:7,      y:36.458, type:'gauge' },
  { x:7,      y:24.444, type:'gauge' },
  { x:7,      y:12.43,  type:'gauge' },
  { x:19.29,  y:12.43,  type:'pager', pagerId:'pager-PA' },
  { x:31.935, y:12.43,  type:'gauge' },
  { x:38.083, y:12.43,  type:'gauge' },
  { x:44.231, y:12.43,  type:'gauge' },
  { x:50.379, y:12.43,  type:'hazard' },
  { x:56.527, y:12.43,  type:'gauge' },
  { x:62.675, y:12.43,  type:'gauge' },
  { x:72.64,  y:12.43,  type:'pager', pagerId:'pager-PB' },
  { x:82.6,   y:12.43,  type:'gauge' },
  { x:90.5,   y:12.43,  type:'hazard' },
  { x:90.5,   y:24.54,  type:'gauge' },
  { x:90.5,   y:36.458, type:'gauge' },
  { x:82.6,   y:36.28,  type:'gauge' },
  { x:71.2,   y:36.458, type:'pager', pagerId:'pager-PC' },
  { x:59.8,   y:36.458, type:'gauge' },
  { x:51.7,   y:36.458, type:'gauge' },
  { x:43.6,   y:36.458, type:'hazard' },
  { x:35.5,   y:36.458, type:'gauge' },
  { x:27.4,   y:36.458, type:'gauge' },
  { x:19.29,  y:36.458, type:'gauge' },
  { x:21.97,  y:59.78,  type:'pager', pagerId:'pager-PD' },
  { x:34.865, y:59.936, type:'gauge' },
  { x:41.263, y:60.014, type:'gauge' },
  { x:47.661, y:60.091, type:'gauge' },
  { x:54.059, y:60.169, type:'hazard' },
  { x:60.457, y:60.246, type:'gauge' },
  { x:66.855, y:60.324, type:'gauge' },
  { x:79.75,  y:60.48,  type:'pager', pagerId:'pager-PE' },
  { x:90.5,   y:59.18,  type:'gauge' },
  { x:90.5,   y:70.15,  type:'gauge' },
  { x:90.5,   y:84.81,  type:'gauge' },
  { x:83.06,  y:84.81,  type:'gauge' },
  { x:75.62,  y:84.81,  type:'hazard' },
  { x:68.18,  y:84.81,  type:'gauge' },
  { x:57.698, y:84.81,  type:'pager', pagerId:'pager-PF' },
  { x:47.216, y:84.426, type:'gauge' },
  { x:40.96,  y:84.237, type:'gauge' },
  { x:34.703, y:84.049, type:'gauge' },
  { x:28.446, y:83.861, type:'hazard' },
  { x:22.19,  y:83.672, type:'gauge' },
  { x:15.933, y:83.484, type:'gauge' }
];

// Guards against any malformed position value (missing, wrong type, out of
// range) that could otherwise feed NaN or garbage into the hop-animation
// math — matters especially right after loading against an older, stale
// saved room from before this field existed.
function safePosition(pos){
  var n = Number(pos);
  if (!isFinite(n) || n < 0) return 0;
  return Math.floor(n) % BOARD_PATH.length;
}

// Generates a short, easy-to-read room code in the same CW-#### shape the
// game has always used, e.g. "CW-4821".
function generateRoomCode(){
  var n = Math.floor(1000 + Math.random() * 9000); // 4-digit number, 1000-9999
  return 'CW-' + n;
}

function getRoomCodeFromURL(){
  var params = new URLSearchParams(window.location.search);
  // No fixed default room anymore — every plain open of the Board (no
  // ?room= in the address) generates a brand-new random room, so closing
  // the browser and reopening later (a new day, a new location, a new
  // crew) always starts a clean, independent game instead of silently
  // reconnecting to whatever was left running last time. An explicit
  // ?room=CODE in the URL still wins over this — that's what lets a
  // Player phone's QR-code join link land in the SAME room as the Board
  // that generated it, and what lets the Board's own RESET GAME button
  // keep working within a session (it resets the current room's data,
  // it doesn't need a new room code to do that).
  return params.get('room') || generateRoomCode();
}

// All 8 possible seats — used by the Player join screen to always offer
// every seat, regardless of how many are currently joined.
var ALL_SEAT_IDS = ['p1','p2','p3','p4','p5','p6','p7','p8'];

var DEFAULT_GAME_STATE = {
  roomCode: getRoomCodeFromURL(),
  phase: 'TURN_START',            // see spec doc Section 3 for the full phase list
  leg: 4,
  maxLegs: 12,
  players: {
    p1: { name:'', sprite:'sprite-heli-yellow',  tile:'', score:0, position:0, connected:false, missionSkipPending:false },
    p2: { name:'', sprite:'sprite-plane-yellow', tile:'', score:0, position:0, connected:false, missionSkipPending:false },
    p3: { name:'', sprite:'sprite-heli-blue',    tile:'', score:0, position:0, connected:false, missionSkipPending:false },
    p4: { name:'', sprite:'sprite-plane-green',  tile:'', score:0, position:0, connected:false, missionSkipPending:false },
    p5: { name:'', sprite:'sprite-heli-red',     tile:'', score:0, position:0, connected:false, missionSkipPending:false },
    p6: { name:'', sprite:'sprite-plane-red',    tile:'', score:0, position:0, connected:false, missionSkipPending:false },
    p7: { name:'', sprite:'sprite-heli-green',   tile:'', score:0, position:0, connected:false, missionSkipPending:false },
    p8: { name:'', sprite:'sprite-plane-blue',   tile:'', score:0, position:0, connected:false, missionSkipPending:false }
  },
  // Starts empty — there's no preset player count anymore. Each phone that
  // joins (see joinAsPlayer() below) appends its seat here in the order
  // they actually joined, so 1 player naturally makes this solo study mode
  // and 2-8 naturally makes it a classroom/group game, with no separate
  // "how many players" step for anyone to set.
  turnOrder: [],
  currentPlayerId: null,
  turn: {
    subphase: 'TURN_START',
    diceResult: null,
    rollNonce: 0,
    moveApplied: false,
    moveLandsAt: null,
    landedSpaceId: null,
    landedSpaceType: null,
    missionCategory: null,
    missionResult: null,
    missionPickedOption: null,
    timerEndsAt: null,
    missionResolvedAt: null,
    hazardOutcomeId: null,
    hazardNonce: 0,
    hazardQuestionIndex: null,
    hazardChallengeResult: null,
    hazardPickedOption: null,
    hazardResolvedAt: null,
    skipNextTurnFor: null,
    rapidPlayers: null,
    rapidCategory: null,
    rapidBuzzedBy: null,
    rapidResult: null,
    rapidPickedOption: null,
    rapidTimerEndsAt: null,
    rapidResolvedAt: null,
    hangarQuestionIndex: null,
    wagerAmount: null,
    wagerResult: null,
    hangarPickedOption: null,
    wagerResolvedAt: null
  },
  log: []
};

var GameStore = (function(){
  // ?offline=1 forces local-only mode regardless of FIREBASE_CONFIG — handy
  // for testing whether a problem is specific to the Firebase connection,
  // without having to edit and re-upload the file.
  var forceOffline = new URLSearchParams(window.location.search).has('offline');
  var wantsFirebase = !forceOffline && FIREBASE_CONFIG.apiKey !== 'REPLACE_ME';
  var connectionMode = 'local';     // 'local' | 'firebase' — which backend setState/getState use
  var connectionStatus = 'local';   // 'local' | 'connecting' | 'connected' | 'error' — what's shown in the room bar
  var lastError = null;
  var listeners = [];
  var localState = JSON.parse(JSON.stringify(DEFAULT_GAME_STATE));
  var fbRef = null;

  function notifyLocal(){ listeners.forEach(function(fn){ fn(localState); }); }
  function notifyStatus(){ listeners.forEach(function(fn){ fn(localState); }); } // status changes still trigger a re-render of the room bar

  // Firebase's push() stores entries keyed by auto-generated push-IDs
  // (an object), not as a true array — but every local call site treats
  // log as a plain array. This converts either shape into a real array,
  // sorted chronologically (push-IDs sort correctly as strings).
  function normalizeLogArray(log){
    if (!log) return [];
    if (Array.isArray(log)) return log;
    return Object.keys(log).sort().map(function(k){ return log[k]; });
  }

  // Attempts to upgrade from local to Firebase mode. Called once the SDK has
  // either loaded successfully or a timeout has elapsed (see loadFirebaseSDK
  // below this IIFE) — never runs synchronously at page load, and never
  // blocks anything else from working while it's in progress.

  // Counts this browser's own writes that haven't been confirmed by the
  // server yet. While this is above zero, incoming .on('value') snapshots
  // are NOT merged into localState — see the listener below for why.
  var pendingWrites = 0;
  function trackWrite(promise){
    if (!promise || typeof promise.then !== 'function') return;
    pendingWrites++;
    var cleared = false;
    var clear = function(){
      if (cleared) return;
      cleared = true;
      pendingWrites = Math.max(0, pendingWrites - 1);
    };
    promise.then(clear).catch(clear);
    setTimeout(clear, 8000); // safety net: never let one stuck write block syncing from other players forever
  }

  function tryUpgradeToFirebase(){
    if (!wantsFirebase || typeof firebase === 'undefined') return;
    try {
      connectionStatus = 'connecting';
      notifyStatus();

      firebase.initializeApp(FIREBASE_CONFIG);
      fbRef = firebase.database().ref('rooms/' + DEFAULT_GAME_STATE.roomCode);
      connectionMode = 'firebase';

      // .info/connected is a special Firebase path that reflects the ACTUAL
      // websocket connection state — unlike just calling initializeApp(),
      // which succeeds even if the database is unreachable or rules reject you.
      firebase.database().ref('.info/connected').on('value', function(snap){
        if (snap.val() === true){
          connectionStatus = 'connected';
        } else if (connectionStatus !== 'error'){
          connectionStatus = 'connecting';
        }
        notifyStatus();
      });

      // Seed the room if it doesn't exist yet. During active development the
      // state shape keeps growing (position, moveApplied, rollNonce, etc.),
      // so an OLD saved room won't have every field the current code
      // expects. Rather than risk a clever partial-merge introducing its
      // own bugs, add ?reset=1 to the URL any time you load a new version
      // of this file against an existing room — it does a full, clean
      // reseed. Once the game is out of active development, this is the
      // point where a real migration strategy would replace this.
      var forceReset = new URLSearchParams(window.location.search).has('reset');
      fbRef.once('value').then(function(snapshot){
        if (!snapshot.exists() || forceReset){
          trackWrite(fbRef.set(DEFAULT_GAME_STATE));
        }
      }).catch(function(e){
        connectionStatus = 'error';
        lastError = e.message || String(e);
        console.error('Firebase read/seed failed:', e);
        notifyStatus();
      });

      fbRef.on('value', function(snapshot){
        var val = snapshot.val();
        if (!val) return;
        if (pendingWrites > 0){
          // One or more of OUR OWN writes haven't been confirmed by the
          // server yet. This snapshot could be from BEFORE those writes
          // landed (e.g. an echo triggered by an unrelated log entry that
          // round-tripped faster) — merging it now would silently revert
          // our own just-made progress (e.g. "it's now player 2's turn")
          // back to stale data. Skip it; once our pending writes resolve,
          // the next snapshot will bring us back in sync either way.
          return;
        }
        // merge into the local mirror (not just hand it to renderers) so
        // that GameStore.getState() — used by every guard/decision check,
        // not just rendering — reflects changes made by OTHER browsers too.
        // "log" is special-cased: Firebase stores it as an object keyed by
        // push-IDs (that's how push() works), but every local call site
        // treats localState.log as a plain array (.push, .shift, .length).
        // Blindly assigning the raw Firebase shape here corrupts that type
        // the moment the first snapshot arrives — the next addLog() call
        // then throws trying to .push() onto an object, which was crashing
        // mid-way through turn-advancing code and silently stranding the
        // game. Always normalize back to a real array on the way in.
        Object.keys(val).forEach(function(k){
          localState[k] = (k === 'log') ? normalizeLogArray(val.log) : val[k];
        });
        listeners.forEach(function(fn){ fn(localState); });
      }, function(e){
        // this fires on permission-denied and similar errors — the #1 cause
        // of "shows LIVE but data never syncs" is rules rejecting the read/write
        connectionStatus = 'error';
        lastError = e.message || String(e);
        console.error('Firebase sync error (check your Realtime Database rules):', e);
        notifyStatus();
      });
    } catch (e){
      console.warn('Firebase init failed, staying in local mode:', e);
      connectionMode = 'local';
      connectionStatus = 'error';
      lastError = e.message || String(e);
      fbRef = null;
      notifyStatus();
    }
  }

  function getState(){
    // firebase mode is push-based (fbRef.on('value')) so callers that need
    // a synchronous snapshot should prefer data passed into subscribe()
    // callbacks; getState() still returns the best-known local mirror.
    return localState;
  }

  return {
    getState: getState,
    getConnectionMode: function(){ return connectionMode; },
    getConnectionStatus: function(){ return connectionStatus; },
    getLastError: function(){ return lastError; },
    wantsFirebase: function(){ return wantsFirebase; },
    tryUpgradeToFirebase: tryUpgradeToFirebase,
    // Full manual reset back to the starting state — same shape used to
    // seed a brand-new room. Works in both modes; in firebase mode this
    // overwrites the shared room for everyone connected to it.
    resetToDefault: function(){
      var fresh = JSON.parse(JSON.stringify(DEFAULT_GAME_STATE));
      fresh.roomCode = localState.roomCode; // keep whatever room we're actually in
      Object.keys(localState).forEach(function(k){ delete localState[k]; });
      Object.assign(localState, fresh);
      notifyLocal();
      if (connectionMode === 'firebase'){ trackWrite(fbRef.set(fresh).catch(function(e){ console.error('reset failed:', e); })); }
    },
    // Every write updates the LOCAL mirror immediately (optimistic update)
    // and notifies listeners right away, regardless of backend — then, in
    // firebase mode, also pushes the same change to the server in the
    // background. This matters: reading GameStore.getState() right after
    // calling one of these must see the change take effect immediately,
    // or code that does "write, then read to decide the next step" (the
    // mission timer, hazard/move guards, etc.) can see stale data during
    // the network round-trip and mistakenly re-run itself.
    setState: function(patch){
      Object.assign(localState, patch);
      notifyLocal();
      if (connectionMode === 'firebase'){ trackWrite(fbRef.update(patch).catch(function(e){ console.error('write failed:', e); })); }
    },
    setTurn: function(patch){
      Object.assign(localState.turn, patch);
      notifyLocal();
      if (connectionMode === 'firebase'){ trackWrite(fbRef.child('turn').update(patch).catch(function(e){ console.error('write failed:', e); })); }
    },
    setPlayer: function(id, patch){
      Object.assign(localState.players[id], patch);
      notifyLocal();
      if (connectionMode === 'firebase'){ trackWrite(fbRef.child('players/' + id).update(patch).catch(function(e){ console.error('write failed:', e); })); }
    },
    // Writes several fields across state, turn, and/or player(s) as ONE
    // atomic operation instead of several separate setState/setTurn/
    // setPlayer calls. This matters because separate calls are separate
    // network round-trips in firebase mode: if their confirmations echo
    // back out of order, an earlier echo can carry a snapshot of "turn"
    // that doesn't yet include a later write (e.g. wiping out a
    // just-set timerEndsAt), silently reverting it. One combined write
    // has only one echo, so this can't happen. Keys use Firebase's
    // path-string syntax, e.g. { phase: 'X', 'turn/subphase': 'Y',
    // 'players/p1/score': 500 }.
    setMulti: function(pathPatch){
      Object.keys(pathPatch).forEach(function(path){
        var parts = path.split('/');
        var obj = localState;
        for (var i = 0; i < parts.length - 1; i++){ obj = obj[parts[i]]; }
        obj[parts[parts.length - 1]] = pathPatch[path];
      });
      notifyLocal();
      if (connectionMode === 'firebase'){ trackWrite(fbRef.update(pathPatch).catch(function(e){ console.error('write failed:', e); })); }
    },
    subscribe: function(fn){
      listeners.push(fn);
      fn(localState); // local mirror is always current now, in both modes
    },
    addLog: function(text){
      var entry = { ts: Date.now(), text: text };
      if (!Array.isArray(localState.log)) localState.log = normalizeLogArray(localState.log); // defense in depth
      localState.log.push(entry);
      if (localState.log.length > 50) localState.log.shift();
      notifyLocal();
      if (connectionMode === 'firebase'){
        trackWrite(fbRef.child('log').push(entry).catch(function(e){ console.error('write failed:', e); }));
        // trim the server copy too — this room has been through a lot of
        // testing, and an ever-growing unbounded log is exactly the kind
        // of thing that can make snapshots slower to process over time
        trackWrite(fbRef.child('log').once('value').then(function(snap){
          var val = snap.val();
          if (!val) return;
          var keys = Object.keys(val);
          if (keys.length > 50){
            keys.sort();
            var toRemove = keys.slice(0, keys.length - 50);
            var updates = {};
            toRemove.forEach(function(k){ updates[k] = null; });
            fbRef.child('log').update(updates);
          }
        }).catch(function(){}));
      }
    }
  };
})();

// keep GameStore.getState()'s local mirror in sync even in firebase mode,
// so any code that calls getState() synchronously (rather than reading the
// state object handed to a subscribe() callback) still sees fresh data.
GameStore.subscribe(function(state){
  if (GameStore.getConnectionMode() === 'firebase' && state !== GameStore.getState()){
    var mirror = GameStore.getState();
    Object.keys(state).forEach(function(k){ mirror[k] = state[k]; });
  }
});

// ---- Load the Firebase SDK dynamically, with a hard timeout ----
// The game is fully playable in local mode the instant the page loads,
// regardless of what happens here. If FIREBASE_CONFIG is filled in, this
// tries to fetch the SDK from Google's CDN in the background and upgrade
// to shared/multiplayer mode once it succeeds.
//
// The timeout below doesn't just give up on the promise internally — it
// removes the <script> element (and clears its src) so the browser
// actually cancels the in-flight request. That distinction matters: on
// some networks (a proxy or security tool that silently stalls a
// connection instead of failing it outright) a request that's merely
// ignored keeps running in the background, and that hung request can
// freeze the whole page, not just the Firebase upgrade. Removing the
// element is what actually tells the browser to stop waiting on it.
function loadFirebaseSDK(){
  if (!GameStore.wantsFirebase()) return;

  function loadScript(src, timeoutMs){
    return new Promise(function(resolve, reject){
      var settled = false;
      var s = document.createElement('script');
      s.src = src;

      var timeoutId = setTimeout(function(){
        if (settled) return;
        settled = true;
        s.onload = s.onerror = null;
        s.src = ''; // actually cancels the in-flight request, not just our own wait on it
        if (s.parentNode) s.parentNode.removeChild(s);
        reject(new Error('timed out loading ' + src));
      }, timeoutMs);

      s.onload = function(){
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        resolve();
      };
      s.onerror = function(e){
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        reject(e);
      };
      document.head.appendChild(s);
    });
  }

  loadScript('https://www.gstatic.com/firebasejs/10.13.2/firebase-app-compat.js', 6000)
    .then(function(){
      return loadScript('https://www.gstatic.com/firebasejs/10.13.2/firebase-database-compat.js', 6000);
    })
    .then(function(){
      GameStore.tryUpgradeToFirebase();
    })
    .catch(function(e){
      console.warn('Firebase SDK failed to load — staying in local mode:', e);
    });
}
loadFirebaseSDK();

// ---- Joining / leaving a seat ----
// There's no preset player count — the roster (turnOrder) grows and
// shrinks purely based on who actually joins or leaves from their phone.
// 1 connected player naturally makes this solo study mode (e.g. FP-C/CFRN
// certification prep); 2-8 naturally makes it a classroom/group game.
// Shared between the Player phone (its own join/leave-seat buttons call
// these directly) and the Board (which never needs to call these itself,
// but renders whatever turnOrder they produce).
function joinAsPlayer(id, name, sprite){
  var state = GameStore.getState();
  var newTurnOrder = state.turnOrder.slice();
  if (newTurnOrder.indexOf(id) === -1) newTurnOrder.push(id);

  var patch = { 'turnOrder': newTurnOrder };
  patch['players/' + id + '/name'] = name;
  patch['players/' + id + '/sprite'] = sprite;
  patch['players/' + id + '/connected'] = true;
  // Always start a freshly-claimed seat clean — position back at the
  // Hangar, no leftover tile/score from whatever this seat last held.
  // Without this, rejoining (or a different phone claiming a seat that
  // was used earlier, e.g. during testing) could silently resume a stale
  // position/score instead of genuinely starting fresh.
  patch['players/' + id + '/position'] = 0;
  patch['players/' + id + '/tile'] = '';
  patch['players/' + id + '/score'] = 0;
  patch['players/' + id + '/missionSkipPending'] = false;
  // First player ever to join (or the previous current player is no
  // longer in the roster, e.g. after everyone had left) — hand them the
  // turn immediately rather than leaving currentPlayerId pointing at
  // nobody.
  if (!state.currentPlayerId || newTurnOrder.indexOf(state.currentPlayerId) === -1){
    patch['currentPlayerId'] = newTurnOrder[0];
    patch['phase'] = 'TURN_START';
    patch['turn/subphase'] = 'TURN_START';
  }
  GameStore.setMulti(patch);
  GameStore.addLog(name + ' joined from a phone.');
}

function leaveAsPlayer(id){
  var state = GameStore.getState();
  var newTurnOrder = state.turnOrder.filter(function(pid){ return pid !== id; });
  var patch = { 'turnOrder': newTurnOrder };
  patch['players/' + id + '/connected'] = false;
  if (state.currentPlayerId === id){
    if (newTurnOrder.length > 0){
      patch['currentPlayerId'] = newTurnOrder[0];
      patch['phase'] = 'TURN_START';
      patch['turn/subphase'] = 'TURN_START';
    } else {
      patch['currentPlayerId'] = null; // nobody left in the game right now
    }
  }
  GameStore.setMulti(patch);
}

// ---- Shared turn actions ----
// Used by both the Board (PRESS TO MOVE button) and the Player phone
// interface (the big "PRESS TO SPIN" knob) — writing the exact same shape
// of state so every connected screen's own animation/rendering kicks in
// identically no matter which device actually pressed the button.
function spinMoveIndicator(){
  var state = GameStore.getState();
  if (state.phase !== 'TURN_START' || !state.currentPlayerId) return; // one roll per turn, only once someone's actually joined and it's time to roll

  var target = Math.floor(Math.random()*5) + 1; // RNG 1-5
  var pname = state.players[state.currentPlayerId].name;

  GameStore.setMulti({
    'phase': 'MOVING',
    'turn/diceResult': target,
    'turn/rollNonce': (state.turn.rollNonce || 0) + 1,
    'turn/moveApplied': false
  });
  GameStore.addLog(pname + ' rolled a ' + target + '.');
  // Movement + landing resolution is triggered from playMoveSpin() on the
  // Board, once the die-spin animation itself finishes there.
}

// ---- Shared question banks + mission/rapid-round answer actions ----
// Used by both the Board and the Player phone interface, so a player's own
// phone can show the exact same question the Board is showing (not a
// different random one) and let them submit their answer directly, with
// the Board's tick loop being the one authoritative place that then
// advances the turn once a result has been shown for a bit.

var MISSION_CATEGORIES = ["Trauma", "OB", "Pediatric", "Drug Formulary", "Medical", "Airway", "Procedures"];

// Sample question bank (placeholder content — swap in the real question DB later)
var SAMPLE_QUESTIONS = {
  "Trauma": {q:"A patient with a suspected tension pneumothorax is deteriorating. What is the immediate intervention?", options:["A. High-flow O2 and reassess","B. Needle decompression","C. Rapid sequence intubation","D. IV fluid bolus only"], answer:1},
  "OB": {q:"A term mother presents with a prolapsed umbilical cord. What is your priority positioning?", options:["A. Supine, legs flat","B. Knee-chest or Trendelenburg","C. Left lateral, legs down","D. High Fowler's"], answer:1},
  "Pediatric": {q:"What is the initial energy dose for pediatric defibrillation (per kg)?", options:["A. 1 J/kg","B. 2 J/kg","C. 4 J/kg","D. 10 J/kg"], answer:1},
  "Drug Formulary": {q:"Standard adult dose of IV push Adenosine for SVT (first dose)?", options:["A. 3 mg","B. 6 mg","C. 12 mg","D. 20 mg"], answer:1},
  "Medical": {q:"A diabetic patient is found unresponsive with a blood glucose of 32. First-line treatment?", options:["A. Oral glucose gel","B. IV Dextrose (D10/D50)","C. Glucagon IM only","D. Insulin drip"], answer:1},
  "Airway": {q:"During RSI, which drug is a depolarizing paralytic?", options:["A. Rocuronium","B. Etomidate","C. Succinylcholine","D. Versed"], answer:2},
  "Procedures": {q:"Landmark for a needle cricothyrotomy?", options:["A. Suprasternal notch","B. Cricothyroid membrane","C. 2nd intercostal space, midclavicular","D. Sternal angle"], answer:1}
};
var MISSION_POINTS = 100; // placeholder scoring rule — easy to retune later

// Callable from ANY connected browser (the Board's demo buttons OR a
// player's own phone) — whichever gets there first "wins" via shared
// state, and everyone else's call becomes a no-op. This guard key lives
// only in this browser's memory (never written to Firebase) so a
// slightly-stale echo of shared state can never fool it into
// re-resolving/re-awarding points for the same mission twice.
var resolvedMissionKey = null;
function resolveMission(correct){
  var state = GameStore.getState();
  if (state.phase !== 'RESOLVING_MISSION' || state.turn.subphase !== 'MISSION_ANSWERING') return;

  var missionKey = state.turn.landedSpaceId + '|' + state.turn.missionCategory + '|' + state.currentPlayerId;
  if (resolvedMissionKey === missionKey) return;
  resolvedMissionKey = missionKey;

  var currentId = state.currentPlayerId;
  var pname = state.players[currentId].name;

  var resolvePatch = {
    'turn/subphase': 'MISSION_RESOLVED',
    'turn/missionResult': correct ? 'correct' : 'incorrect',
    'turn/missionResolvedAt': Date.now()
  };
  if (correct){
    resolvePatch['players/' + currentId + '/score'] = state.players[currentId].score + MISSION_POINTS;
  }
  GameStore.setMulti(resolvePatch);
  GameStore.addLog(correct ? (pname + ' answered correctly (+' + MISSION_POINTS + ').') : (pname + ' did not answer correctly.'));
}

// Called when the player actually taps one of the answer options (instead
// of a GM/demo self-reporting correct/incorrect) — grades it against the
// question's own stored answer index and resolves the mission accordingly.
function submitMissionAnswer(optionIndex){
  var state = GameStore.getState();
  if (state.phase !== 'RESOLVING_MISSION' || state.turn.subphase !== 'MISSION_ANSWERING') return;
  var q = SAMPLE_QUESTIONS[state.turn.missionCategory];
  if (!q) return;
  GameStore.setTurn({ missionPickedOption: optionIndex });
  resolveMission(optionIndex === q.answer);
}

var RAPID_ROUND_POINTS = 50;
var RAPID_ANSWER_SECONDS = 20; // shorter than a normal mission — it's about speed

function buzzIn(playerId){
  var state = GameStore.getState();
  if (state.phase !== 'RESOLVING_RAPID' || state.turn.rapidBuzzedBy) return;
  if (!state.turn.rapidPlayers || state.turn.rapidPlayers.indexOf(playerId) === -1) return;
  GameStore.setTurn({ rapidBuzzedBy: playerId });
  GameStore.addLog(state.players[playerId].name + ' buzzed in first!');
}

var resolvedRapidKey = null;
function resolveRapidRound(correct){
  var state = GameStore.getState();
  if (state.phase !== 'RESOLVING_RAPID' || !state.turn.rapidBuzzedBy || state.turn.rapidResult) return;

  var key = state.turn.rapidPlayers.join('|') + '|' + state.turn.rapidCategory;
  if (resolvedRapidKey === key) return;
  resolvedRapidKey = key;

  var winnerId = state.turn.rapidBuzzedBy;
  var pname = state.players[winnerId].name;
  var resolvePatch = { 'turn/rapidResult': correct ? 'correct' : 'incorrect', 'turn/rapidResolvedAt': Date.now() };
  if (correct){
    resolvePatch['players/' + winnerId + '/score'] = state.players[winnerId].score + RAPID_ROUND_POINTS;
  }
  GameStore.setMulti(resolvePatch);
  GameStore.addLog(correct
    ? (pname + ' answered the rapid round correctly (+' + RAPID_ROUND_POINTS + ').')
    : (pname + ' answered the rapid round incorrectly.'));
}

// Called when the buzzed-in player actually taps one of the answer options
// (instead of a GM/demo self-reporting correct/incorrect) — grades it
// against the question's own stored answer index.
function submitRapidAnswer(optionIndex){
  var state = GameStore.getState();
  if (state.phase !== 'RESOLVING_RAPID' || !state.turn.rapidBuzzedBy || state.turn.rapidResult) return;
  var q = SAMPLE_QUESTIONS[state.turn.rapidCategory];
  if (!q) return;
  GameStore.setTurn({ rapidPickedOption: optionIndex });
  resolveRapidRound(optionIndex === q.answer);
}

// ---- Shared sprite roster ----
// The 8 sprites available for players to choose from when joining on their
// phone (see player.html) — kept here so both files agree on the exact set.
var AVAILABLE_SPRITES = [
  'sprite-heli-yellow', 'sprite-heli-red', 'sprite-heli-blue', 'sprite-heli-green',
  'sprite-plane-yellow', 'sprite-plane-red', 'sprite-plane-blue', 'sprite-plane-green'
];

// Shared so both the Board and the Player phone show the same placeholder
// text for a seat nobody has actually joined and named yet.
function displaySeatName(p, seatId){
  return (p && p.name) ? p.name : 'OPEN SEAT \u2014 ' + seatId.toUpperCase();
}

// ---- Hangar Wager Challenge (shared) ----
// HANGAR_HARD_QUESTIONS, WAGER_ANSWER_SECONDS, submitHangarWager(), and
// resolveHangarWager() live here (rather than in index.html) so a player's
// phone can show the exact same toughest-question and let them enter their
// wager and answer directly, using the same functions the Board's own
// wager overlay calls. simulateHangarWager() and finishHangarWagerResolution()
// stay Board-only — they're only ever triggered by the Board's own movement
// logic and tick loop, never by a player action.

// Only reachable by landing EXACTLY on the Hangar after a full lap. This
// pool is deliberately separate from SAMPLE_QUESTIONS and is meant to hold
// the hardest questions in the bank; swap/expand with real toughest-tier
// content later. One is picked at random per Hangar landing so repeat laps
// don't always show the same one.
var HANGAR_HARD_QUESTIONS = [
  { q:"A trauma patient in hemorrhagic shock has received 3 units of blood 1:1:1 with plasma/platelets and remains hypotensive. What is the most likely underlying coagulopathy mechanism at this point?", options:["A. Dilutional coagulopathy from crystalloid overuse","B. Acute traumatic coagulopathy from tissue hypoperfusion and protein C activation","C. Vitamin K deficiency","D. Hereditary factor VIII deficiency"], answer:1 },
  { q:"In a neonate with suspected persistent pulmonary hypertension (PPHN), which finding best differentiates it from cyanotic congenital heart disease during transport?", options:["A. Pre/post-ductal SpO2 gradient >10%","B. Single loud S2","C. Bounding femoral pulses","D. Hepatomegaly"], answer:0 },
  { q:"A patient on a ventilator with ARDS is plateau-pressure limited at 30 cmH2O but remains severely hypoxic despite FiO2 1.0 and optimal PEEP titration. What is the next best transport ventilator strategy?", options:["A. Increase tidal volume to improve oxygenation","B. Prone positioning if feasible, or permissive hypercapnia with lower tidal volumes","C. Switch to volume-control with higher rate only","D. Discontinue PEEP to reduce barotrauma risk"], answer:1 }
];
var WAGER_ANSWER_SECONDS = 60; // toughest question gets extra time vs. a normal 40s mission

// Callable from any browser (the Board's demo wager UI, or a player's own
// phone) once the current player has picked an amount. Clamps to [0,
// current score] so a stale UI or a bad manual entry can never wager more
// points than the player has.
function submitHangarWager(amount){
  var state = GameStore.getState();
  if (state.phase !== 'RESOLVING_HANGAR_WAGER' || state.turn.subphase !== 'WAGER_INPUT') return;
  var currentId = state.currentPlayerId;
  var maxWager = state.players[currentId].score;
  var wager = Math.floor(Number(amount));
  if (!isFinite(wager) || wager < 0) wager = 0;
  if (wager > maxWager) wager = maxWager;

  GameStore.setMulti({
    'turn/subphase': 'WAGER_ANSWERING',
    'turn/wagerAmount': wager,
    'turn/timerEndsAt': Date.now() + WAGER_ANSWER_SECONDS * 1000
  });
  GameStore.addLog(state.players[currentId].name + ' wagers ' + wager.toLocaleString() + ' points on the Hangar Challenge.');
}

var resolvedWagerKey = null;
function resolveHangarWager(correct){
  var state = GameStore.getState();
  if (state.phase !== 'RESOLVING_HANGAR_WAGER' || state.turn.subphase !== 'WAGER_ANSWERING') return;

  var currentId = state.currentPlayerId;
  var key = currentId + '|' + state.turn.hangarQuestionIndex;
  if (resolvedWagerKey === key) return; // already resolved this exact wager locally
  resolvedWagerKey = key;

  var pname = state.players[currentId].name;
  var wager = state.turn.wagerAmount || 0;
  // Correct doubles the wagered points (i.e. the player nets +wager on top
  // of what they already have); incorrect loses exactly what was wagered,
  // per the house rule — never below 0.
  var scoreDelta = correct ? wager : -wager;
  var resolvePatch = {
    'turn/subphase': 'WAGER_RESOLVED',
    'turn/wagerResult': correct ? 'correct' : 'incorrect',
    'turn/wagerResolvedAt': Date.now()
  };
  resolvePatch['players/' + currentId + '/score'] = Math.max(0, state.players[currentId].score + scoreDelta);
  GameStore.setMulti(resolvePatch);
  GameStore.addLog(correct
    ? (pname + ' nailed the Hangar Challenge \u2014 wager doubled (+' + wager.toLocaleString() + ').')
    : (pname + ' missed the Hangar Challenge \u2014 lost the ' + wager.toLocaleString() + '-point wager.'));
}

// Called when the player actually taps one of the answer options (instead
// of a GM/demo self-reporting correct/incorrect) — grades it against the
// question's own stored answer index.
function submitHangarAnswer(optionIndex){
  var state = GameStore.getState();
  if (state.phase !== 'RESOLVING_HANGAR_WAGER' || state.turn.subphase !== 'WAGER_ANSWERING') return;
  var q = HANGAR_HARD_QUESTIONS[state.turn.hangarQuestionIndex];
  if (!q) return;
  GameStore.setTurn({ hangarPickedOption: optionIndex });
  resolveHangarWager(optionIndex === q.answer);
}

// ---- Hazard Space "STOP Checklist" Challenge (shared) ----
// Landing on a Hazard space now gives the player a chance to avoid the
// consequence entirely by answering a question drawn from EagleMed's
// CRM/(STOP) Checklist (Safety Time Out Process) — a real pre-flight
// safety briefing checklist. Answer correctly and the hazard has no
// effect; answer incorrectly (or run out of time) and the listed
// consequence applies as normal. No points are awarded either way — this
// is purely a chance to cancel a penalty, not a scoring opportunity.
// simulateHazardLanding() stays Board-only (only ever triggered by the
// Board's own movement logic); submitHazardAnswer() and
// resolveHazardChallenge() live here so a player can answer directly from
// their phone, the same pattern as missions/rapid round/the Hangar Challenge.

var STOP_QUESTIONS = [
  { q:"What does the acronym STOP stand for in the EagleMed CRM/STOP Checklist?", options:["A. Safety Time Out Process","B. Standard Takeoff Operating Procedure","C. Secure The Overhead Panel","D. Stop, Think, Observe, Proceed"], answer:0 },
  { q:"During the Pre-Departure phase, which item comes first on the STOP checklist?", options:["A. Weather","B. Risk assessment completed","C. Walk-around","D. Comm Center(s)"], answer:1 },
  { q:"Under the Weather item during Pre-Departure, what two things must be checked?", options:["A. Fuel load and winds aloft","B. Conditions (improving/deteriorating) and alternates","C. NOTAMs and TFRs","D. Cloud ceiling and visibility only"], answer:1 },
  { q:"What must be confirmed regarding equipment during Pre-Departure?", options:["A. Onboard and secured","B. Calibrated and charged","C. Inventoried and logged","D. Cleaned and sterilized"], answer:0 },
  { q:"During the Walk-around step of Pre-Departure, what must be completed?", options:["A. Weight and balance calculation","B. Completed, covers removed","C. Fuel sample check","D. Radio check"], answer:1 },
  { q:"What action is taken at the Comm Center(s) step of Pre-Departure?", options:["A. File a flight plan","B. Departure call","C. Request a weather briefing","D. Confirm the patient report"], answer:1 },
  { q:"After completing the Pre-Departure items, what critical question must the crew ask?", options:["A. Should we cancel this flight?","B. Who is pilot in command?","C. Is the patient stable?","D. Do we have enough fuel?"], answer:0 },
  { q:"During Before Takeoff, what must be confirmed about crew and passengers?", options:["A. Seatbelts fastened only","B. Ready for takeoff","C. Briefed on emergency exits","D. Weight verified"], answer:1 },
  { q:"During Before Landing, what must be verified about equipment and baggage?", options:["A. Secure","B. Removed from the aircraft","C. Weighed","D. Documented"], answer:0 },
  { q:"During Before Landing, what must be confirmed about crew and passengers?", options:["A. Notified of ETA","B. Ready for landing","C. Seated with headsets on","D. Given a safety briefing"], answer:1 }
];
var HAZARD_ANSWER_SECONDS = 30;

var HAZARD_OUTCOMES = [
  { id:'thunderstorm',      title:'THUNDERSTORMS ALONG THE ROUTE',      desc:'Course deviation required to avoid the weather cell.',                                   effect:'MOVE BACK 4 SPACES',              moveBack:4, avoidPagerExtra:1 },
  { id:'equipment_left',    title:'\u201cOH NO! WHERE IS THE . . . ?\u201d', desc:'The crew left a piece of equipment behind.',                                          effect:'RETURN TO HANGAR & -100 POINTS',  returnToHangar:true, scoreDelta:-100 },
  { id:'patient_restraint', title:'PATIENT REQUIRES RESTRAINT',         desc:'Crew must secure the patient before anything else can continue.',                        effect:'LOSE NEXT TURN',                  skipNextTurn:true },
  { id:'patient_not_ready', title:'PATIENT IS NOT READY FOR TRANSPORT', desc:'The next mission this crew reaches will have to wait.',                                  effect:'NEXT MISSION SKIPPED',            skipMission:true },
  { id:'lz_not_clear',      title:'LANDING ZONE / RUNWAY NOT CLEAR',    desc:'Crew must coordinate a new LZ or alternate landing site.',                               effect:'MOVE BACK 2 SPACES',              moveBack:2, avoidPagerExtra:1 },
  { id:'maintenance',       title:'AIRCRAFT HAS A MAINTENANCE ISSUE',   desc:'The aircraft must return to base for inspection.',                                       effect:'RETURN TO HANGAR',                returnToHangar:true },
  { id:'medication_error',  title:'MEDICATION ERROR',                   desc:'An error is caught and must be corrected before continuing.',                            effect:'-75 POINTS',                      scoreDelta:-75 },
  { id:'wrong_location',    title:'WRONG LOCATION',                     desc:'Crew arrives at the reported location, but the patient/ambulance/LZ is somewhere else.', effect:'MOVE BACK 2 SPACES & LOSE NEXT TURN', moveBack:2, skipNextTurn:true }
];
var HAZARD_OUTCOMES_BY_ID = {};
HAZARD_OUTCOMES.forEach(function(o){ HAZARD_OUTCOMES_BY_ID[o.id] = o; });

// Called when the player actually taps one of the STOP-question options
// (or the tick loop times them out with a null pick).
function submitHazardAnswer(optionIndex){
  var state = GameStore.getState();
  if (state.phase !== 'RESOLVING_HAZARD' || state.turn.subphase !== 'HAZARD_CHALLENGE') return;
  var q = STOP_QUESTIONS[state.turn.hazardQuestionIndex];
  if (!q) return;
  resolveHazardChallenge(optionIndex === q.answer, optionIndex);
}

var resolvedHazardKey = null;
function resolveHazardChallenge(correct, pickedIndex){
  var state = GameStore.getState();
  if (state.phase !== 'RESOLVING_HAZARD' || state.turn.subphase !== 'HAZARD_CHALLENGE') return;

  var currentId = state.currentPlayerId;
  var key = currentId + '|' + state.turn.hazardNonce;
  if (resolvedHazardKey === key) return; // already resolved this exact hazard locally
  resolvedHazardKey = key;

  var outcome = HAZARD_OUTCOMES_BY_ID[state.turn.hazardOutcomeId];
  var pname = state.players[currentId].name;
  var patch = {
    'turn/subphase': 'HAZARD_RESOLVED',
    'turn/hazardChallengeResult': correct ? 'correct' : 'incorrect',
    'turn/hazardPickedOption': (typeof pickedIndex === 'number') ? pickedIndex : null,
    'turn/hazardResolvedAt': Date.now()
  };

  if (!correct && outcome){
    // The listed consequence only actually applies when the STOP
    // checklist question is missed — a correct answer cancels it entirely.
    if (outcome.scoreDelta){
      patch['players/' + currentId + '/score'] = Math.max(0, state.players[currentId].score + outcome.scoreDelta);
    }
    if (outcome.skipNextTurn){
      patch['players/' + currentId + '/skipNextTurnFor'] = true;
    }
    if (outcome.skipMission){
      patch['players/' + currentId + '/missionSkipPending'] = true;
    }
    if (outcome.returnToHangar){
      // Deliberately just a position change, exactly like a backward
      // move-back — this does NOT go through the normal landing-detection
      // path, so it can never re-trigger the Hangar Challenge.
      patch['players/' + currentId + '/position'] = 0;
      patch['turn/backwardMoveFor'] = currentId;
    } else if (outcome.moveBack){
      var currentPos = safePosition(state.players[currentId].position);
      var newPos = (currentPos - outcome.moveBack + BOARD_PATH.length) % BOARD_PATH.length;
      // A couple of outcomes go one extra space back if landing exactly on
      // a pager, so the player doesn't also get hit with a fresh mission.
      if (outcome.avoidPagerExtra && BOARD_PATH[newPos].type === 'pager'){
        newPos = (newPos - outcome.avoidPagerExtra + BOARD_PATH.length) % BOARD_PATH.length;
      }
      patch['players/' + currentId + '/position'] = newPos;
      patch['turn/backwardMoveFor'] = currentId;
    }
  }

  GameStore.setMulti(patch);
  GameStore.addLog(correct
    ? (pname + ' answered the STOP checklist correctly \u2014 hazard avoided!')
    : (pname + ' missed the STOP checklist question \u2014 ' + (outcome ? outcome.title : 'the hazard') + ' takes effect.'));
}
