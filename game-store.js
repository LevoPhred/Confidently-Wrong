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

var DEFAULT_GAME_STATE = {
  roomCode: getRoomCodeFromURL(),
  phase: 'TURN_START',            // see spec doc Section 3 for the full phase list
  leg: 4,
  maxLegs: 12,
  players: {
    p1: { name:'FN Sarah',  sprite:'sprite-heli-yellow',  tile:'',                score:0, position:0, connected:true, missionSkipPending:false },
    p2: { name:'FP Marcus', sprite:'sprite-plane-yellow', tile:'',                score:0, position:0, connected:true, missionSkipPending:false },
    p3: { name:'FN Jordan', sprite:'sprite-heli-blue',    tile:'',                score:0, position:0, connected:true, missionSkipPending:false },
    p4: { name:'FP Tobi',   sprite:'sprite-plane-green',  tile:'',                score:0, position:0, connected:true, missionSkipPending:false }
  },
  turnOrder: ['p1','p2','p3','p4'],
  currentPlayerId: 'p1',
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
    timerEndsAt: null,
    missionResolvedAt: null,
    hazardOutcomeId: null,
    hazardNonce: 0,
    hazardResolvedAt: null,
    skipNextTurnFor: null,
    rapidPlayers: null,
    rapidCategory: null,
    rapidBuzzedBy: null,
    rapidResult: null,
    rapidTimerEndsAt: null,
    rapidResolvedAt: null,
    hangarQuestionIndex: null,
    wagerAmount: null,
    wagerResult: null,
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

// ---- Shared turn actions ----
// Used by both the Board (PRESS TO MOVE button) and the Player phone
// interface (the big "PRESS TO SPIN" knob) — writing the exact same shape
// of state so every connected screen's own animation/rendering kicks in
// identically no matter which device actually pressed the button.
function spinMoveIndicator(){
  var state = GameStore.getState();
  if (state.phase !== 'TURN_START') return; // one roll per turn, only when it's actually time to roll

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
