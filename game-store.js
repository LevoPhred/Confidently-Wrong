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
  // Set by the Dispatch console to freeze the game for a group discussion.
  // Checked by every player-initiated action (roll, buzz in, submit an
  // answer) in this file, and by the Board's tick loop, so a single flag in
  // one place blocks all forward progress and timer countdowns at once,
  // rather than every call site needing its own check.
  paused: false,
  players: {
    // lapsCompleted drives question difficulty tier (see missionTierForLaps
    // below): 0 laps = easy, 1 lap = intermediate, 2+ laps = hard. It's
    // incremented in applyMovement() (index.html) the instant a roll wraps
    // past the Hangar space (index 0 of BOARD_PATH) — whether the player
    // lands exactly on it or hops clean over it on the way past. turnsTaken,
    // correctCount and wrongCount are simple counters shown on the Dispatch
    // console.
    p1: { name:'', sprite:'sprite-heli-yellow',  tile:'', score:0, position:0, connected:false, missionSkipPending:false, lapsCompleted:0, turnsTaken:0, correctCount:0, wrongCount:0 },
    p2: { name:'', sprite:'sprite-plane-yellow', tile:'', score:0, position:0, connected:false, missionSkipPending:false, lapsCompleted:0, turnsTaken:0, correctCount:0, wrongCount:0 },
    p3: { name:'', sprite:'sprite-heli-blue',    tile:'', score:0, position:0, connected:false, missionSkipPending:false, lapsCompleted:0, turnsTaken:0, correctCount:0, wrongCount:0 },
    p4: { name:'', sprite:'sprite-plane-green',  tile:'', score:0, position:0, connected:false, missionSkipPending:false, lapsCompleted:0, turnsTaken:0, correctCount:0, wrongCount:0 },
    p5: { name:'', sprite:'sprite-heli-red',     tile:'', score:0, position:0, connected:false, missionSkipPending:false, lapsCompleted:0, turnsTaken:0, correctCount:0, wrongCount:0 },
    p6: { name:'', sprite:'sprite-plane-red',    tile:'', score:0, position:0, connected:false, missionSkipPending:false, lapsCompleted:0, turnsTaken:0, correctCount:0, wrongCount:0 },
    p7: { name:'', sprite:'sprite-heli-green',   tile:'', score:0, position:0, connected:false, missionSkipPending:false, lapsCompleted:0, turnsTaken:0, correctCount:0, wrongCount:0 },
    p8: { name:'', sprite:'sprite-plane-blue',   tile:'', score:0, position:0, connected:false, missionSkipPending:false, lapsCompleted:0, turnsTaken:0, correctCount:0, wrongCount:0 }
  },
  // Every question key ('easy|Trauma|3', 'hangar|2', 'hazard|5', ...) that
  // has been shown to ANYONE this game, so pickTieredQuestion() and the
  // Hangar/Hazard pickers (see index.html) can steer away from repeats —
  // a repeat for any player still counts as a repeat. Reset to [] by
  // resetToDefault() at the start of a new game.
  usedQuestionKeys: [],
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
    missionTier: null,          // 'easy' | 'intermediate' | 'hard' — which QUESTION_BANK pool this mission drew from
    missionCategory: null,
    missionQuestionIndex: null, // index into QUESTION_BANK[missionTier][missionCategory]
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
    rapidTier: null,             // same tiering as missionTier, based on the landing player's laps
    rapidCategory: null,
    rapidQuestionIndex: null,    // index into QUESTION_BANK[rapidTier][rapidCategory]
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
  log: [],
  // ---- Dispatch's Question Bank editor (shared, synced) ----
  // Additions/edits made from ANY connected Dispatch console apply
  // everywhere (Board, phones, every Dispatch tab) because they live in
  // shared state, not a local file. customQuestions holds NEW questions
  // added under a tier/category (creating a new category is just adding
  // the first question under a name that isn't in QUESTION_BANK yet).
  // questionOverrides holds EDITS to any question — built-in or custom —
  // keyed 'tier|category|mergedIndex'. See getMergedBank() below for how
  // these two combine with the built-in QUESTION_BANK at pick/lookup time.
  customQuestions: { easy: {}, intermediate: {}, hard: {} },
  questionOverrides: {},
  // Same idea for the two flat, non-tiered pools.
  customHangarQuestions: [],
  hangarOverrides: {},
  customHazardQuestions: [],
  hazardOverrides: {},

  // ---- Win condition (set from Dispatch) ----
  // null = open/free play, no win condition at all. Otherwise the first
  // player whose score reaches this value ends the game. Checked right
  // inside resolveMission()/resolveRapidRound()/resolveHangarWager() —
  // the only three places a score can go UP — so the win, if any, lands
  // in the SAME atomic write as the points that triggered it.
  scoreTarget: 3000,
  gameOver: false,
  winnerId: null,       // set when exactly one player is being declared the winner
  tiedWinnerIds: []      // set instead of winnerId when endGameNow() finds a tie
};

// =====================================================================
// QUESTION BANK LOCAL BACKUP (survives resets, new rooms, and Firebase hiccups)
// =====================================================================
// The Question Bank editor's additions/edits live in the shared room state
// above so every connected screen sees them right away — but a "room" is
// throwaway by design (see getRoomCodeFromURL above): closing the Board and
// reopening it later, or opening Dispatch without the exact link the Board
// handed out, generates a BRAND NEW random room with none of that history.
// The "RESET GAME" button used to wipe it outright too. None of that is
// what an instructor wants — the questions they've added or corrected are
// a personal content library, not throwaway game state, and should survive
// all of that. So every add/edit also mirrors into THIS BROWSER's
// localStorage, under a fixed key with nothing to do with the room code,
// and any freshly-created room (including after a full reset) reloads from
// that mirror instead of starting empty. It's per-browser, like a file on
// the instructor's own laptop — an instructor should always run Dispatch
// from the same computer they've been editing questions on.
var QUESTION_BANK_LOCAL_KEY = 'confidentlyWrong_questionBankV1';
var QUESTION_BANK_FIELDS = ['customQuestions', 'questionOverrides', 'customHangarQuestions', 'hangarOverrides', 'customHazardQuestions', 'hazardOverrides'];

function loadLocalQuestionBank(){
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    var raw = window.localStorage.getItem(QUESTION_BANK_LOCAL_KEY);
    if (!raw) return null;
    var parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object') ? parsed : null;
  } catch (e){
    console.warn('Could not read the saved question bank from this browser:', e);
    return null;
  }
}

// Merges this browser's saved question-bank backup into `target` (a fresh
// state object) in place, and returns it. A saved list/override always
// wins unless the target already has an equal-or-larger one — this only
// ever runs against a FRESH state (a brand-new room, or a reset), never
// between two rooms with independent live edits, so "longer wins" is safe.
function mergeInLocalQuestionBank(target){
  var saved = loadLocalQuestionBank();
  if (!saved) return target;
  if (saved.customQuestions){
    Object.keys(saved.customQuestions).forEach(function(tier){
      if (!target.customQuestions[tier]) target.customQuestions[tier] = {};
      Object.keys(saved.customQuestions[tier]).forEach(function(cat){
        var existing = target.customQuestions[tier][cat] || [];
        var savedList = saved.customQuestions[tier][cat] || [];
        target.customQuestions[tier][cat] = (savedList.length >= existing.length) ? savedList : existing;
      });
    });
  }
  if (saved.questionOverrides) target.questionOverrides = Object.assign({}, saved.questionOverrides, target.questionOverrides);
  if (saved.customHangarQuestions && saved.customHangarQuestions.length > (target.customHangarQuestions || []).length){
    target.customHangarQuestions = saved.customHangarQuestions;
  }
  if (saved.hangarOverrides) target.hangarOverrides = Object.assign({}, saved.hangarOverrides, target.hangarOverrides);
  if (saved.customHazardQuestions && saved.customHazardQuestions.length > (target.customHazardQuestions || []).length){
    target.customHazardQuestions = saved.customHazardQuestions;
  }
  if (saved.hazardOverrides) target.hazardOverrides = Object.assign({}, saved.hazardOverrides, target.hazardOverrides);
  return target;
}

// Called after every local add/edit AND after merging in a remote snapshot
// (so edits made from another device get backed up here too) — never on
// every routine state change, to avoid hammering localStorage during
// gameplay (dice rolls, timers, etc. don't touch these fields anyway).
function saveLocalQuestionBank(state){
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    var toSave = {};
    QUESTION_BANK_FIELDS.forEach(function(f){ toSave[f] = state[f]; });
    window.localStorage.setItem(QUESTION_BANK_LOCAL_KEY, JSON.stringify(toSave));
  } catch (e){
    console.warn('Could not save the question bank to this browser:', e);
  }
}

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
  var localState = mergeInLocalQuestionBank(JSON.parse(JSON.stringify(DEFAULT_GAME_STATE)));
  var fbRef = null;

  function notifyLocal(){ listeners.forEach(function(fn){ fn(localState); }); }
  function notifyStatus(){ listeners.forEach(function(fn){ fn(localState); }); } // status changes still trigger a re-render of the room bar

  // A single failed write (as opposed to a lost connection — that's what
  // connectionStatus='error' is for) used to only go to console.error,
  // which means a player's action could silently fail to save with nothing
  // on screen telling them. This tracks "did our most recent write fail"
  // so the room/status bar can show a brief, self-clearing "SYNC ISSUE"
  // notice instead of quietly losing the action. It clears itself the
  // moment any subsequent write succeeds — it is NOT meant to be sticky
  // like connectionStatus='error', since one write can fail while the
  // connection overall is fine (a brief blip, a rules edge case, etc.).
  var lastWriteFailureAt = null;
  function reportWriteFailure(e){
    lastWriteFailureAt = Date.now();
    lastError = (e && (e.message || String(e))) || 'write failed';
    console.error('write failed:', e);
    notifyStatus();
  }
  function reportWriteSuccess(){
    if (lastWriteFailureAt !== null){
      lastWriteFailureAt = null;
      notifyStatus();
    }
  }

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
          // Seed with this browser's saved question bank folded in, not the
          // bare defaults — otherwise every brand-new room (which is most
          // rooms: see getRoomCodeFromURL above) would start with an empty
          // bank even though this instructor has already built one up.
          trackWrite(fbRef.set(mergeInLocalQuestionBank(JSON.parse(JSON.stringify(DEFAULT_GAME_STATE)))));
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
        // Back up whatever the question bank looks like after this sync —
        // this is also how edits another device makes end up backed up here.
        saveLocalQuestionBank(localState);
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
    // True for a few seconds right after a write fails, even if the
    // connection itself is otherwise fine — see reportWriteFailure above.
    hasRecentWriteFailure: function(){ return lastWriteFailureAt !== null; },
    wantsFirebase: function(){ return wantsFirebase; },
    tryUpgradeToFirebase: tryUpgradeToFirebase,
    // Full manual reset back to the starting state — same shape used to
    // seed a brand-new room. Works in both modes; in firebase mode this
    // overwrites the shared room for everyone connected to it.
    resetToDefault: function(){
      var fresh = JSON.parse(JSON.stringify(DEFAULT_GAME_STATE));
      fresh.roomCode = localState.roomCode; // keep whatever room we're actually in
      // A "reset" is meant to clear GAMEPLAY (scores, positions, turns) —
      // it is not the instructor asking to delete every question they've
      // added or corrected. Carry the current bank forward instead of
      // wiping it back to the built-in-only defaults.
      QUESTION_BANK_FIELDS.forEach(function(f){ fresh[f] = localState[f]; });
      Object.keys(localState).forEach(function(k){ delete localState[k]; });
      Object.assign(localState, fresh);
      notifyLocal();
      saveLocalQuestionBank(localState);
      if (connectionMode === 'firebase'){ trackWrite(fbRef.set(fresh).then(reportWriteSuccess).catch(reportWriteFailure)); }
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
      if (connectionMode === 'firebase'){ trackWrite(fbRef.update(patch).then(reportWriteSuccess).catch(reportWriteFailure)); }
    },
    setTurn: function(patch){
      Object.assign(localState.turn, patch);
      notifyLocal();
      if (connectionMode === 'firebase'){ trackWrite(fbRef.child('turn').update(patch).then(reportWriteSuccess).catch(reportWriteFailure)); }
    },
    setPlayer: function(id, patch){
      Object.assign(localState.players[id], patch);
      notifyLocal();
      if (connectionMode === 'firebase'){ trackWrite(fbRef.child('players/' + id).update(patch).then(reportWriteSuccess).catch(reportWriteFailure)); }
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
      if (connectionMode === 'firebase'){ trackWrite(fbRef.update(pathPatch).then(reportWriteSuccess).catch(reportWriteFailure)); }
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
        trackWrite(fbRef.child('log').push(entry).then(reportWriteSuccess).catch(reportWriteFailure));
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

  // Is this the SAME player resuming their own seat (e.g. they hit "Leave
  // Seat" mid-game and are rejoining, or their phone's local storage got
  // cleared and they're reclaiming the seat that still shows their name)?
  // Compare by name (trimmed/case-folded) rather than just "does this seat
  // have any data" — that's the difference between "resume where I left
  // off" and "a new student is claiming a seat last used by someone else
  // last class." Only a genuine name match counts as the same player.
  var existing = state.players[id];
  var normalize = function(s){ return (s || '').trim().toLowerCase(); };
  var isSamePlayerResuming = existing && existing.name && normalize(existing.name) === normalize(name);

  var patch = { 'turnOrder': newTurnOrder };
  patch['players/' + id + '/name'] = name;
  patch['players/' + id + '/sprite'] = sprite;
  patch['players/' + id + '/connected'] = true;
  if (isSamePlayerResuming){
    // Resuming their own seat — keep their position/score/tile exactly as
    // they left it. This is what makes "Leave Seat" a genuine pause rather
    // than a forfeit.
  } else {
    // A fresh claim on this seat (first-ever join, or a different name
    // than whatever this seat last held) — start clean at the Hangar, no
    // leftover tile/score/position from whoever used this seat before.
    patch['players/' + id + '/position'] = 0;
    patch['players/' + id + '/tile'] = '';
    patch['players/' + id + '/score'] = 0;
    patch['players/' + id + '/missionSkipPending'] = false;
    patch['players/' + id + '/lapsCompleted'] = 0;
  }
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
  if (state.paused || state.gameOver) return; // Dispatch has frozen the game for a discussion
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

var QUESTION_BANK = {
  easy: {
    "Trauma": [
      { q:"A patient with a suspected tension pneumothorax is deteriorating with absent breath sounds and JVD. What is the immediate intervention?", options:["A. High-flow O2 and reassess","B. Needle decompression","C. Rapid sequence intubation","D. IV fluid bolus only"], answer:1, rationale:"Tension pneumothorax is a clinical diagnosis requiring immediate decompression, not imaging confirmation — delaying for RSI or fluids alone doesn't relieve the pressure causing obstructive shock." },
      { q:"A pelvic fracture is suspected after a motorcycle crash. Where should a pelvic binder be placed?", options:["A. At the level of the iliac crests","B. At the level of the greater trochanters","C. Just below the umbilicus","D. Anywhere over the pelvis is fine"], answer:1, rationale:"Placement at the greater trochanters centers the binder over the pubic symphysis and femoral heads, closing the pelvic volume most effectively to tamponade venous bleeding." },
      { q:"On the Glasgow Coma Scale, a patient who opens their eyes spontaneously scores how many points for eye opening?", options:["A. 2","B. 3","C. 4","D. 5"], answer:2, rationale:"Spontaneous eye opening is the highest score on the eye-opening component (4); it drops to 3 for opening to voice, 2 to pain, and 1 for no response." },
      { q:"What is the first-line intervention for controlling external hemorrhage from an extremity wound?", options:["A. Elevate the limb only","B. Direct pressure","C. Proximal tourniquet before anything else","D. Ice the wound"], answer:1, rationale:"Direct pressure is first-line for external hemorrhage; a tourniquet is escalated to when direct pressure fails to control life-threatening extremity bleeding." },
      { q:"Which finding is classic for a tension pneumothorax rather than a simple pneumothorax?", options:["A. Unilateral decreased breath sounds only","B. Tracheal deviation away from the affected side with hypotension","C. Mild pleuritic pain","D. Normal jugular venous pressure"], answer:1, rationale:"Tracheal deviation and hypotension reflect the mediastinal shift and impaired venous return that define a tension pneumothorax as an obstructive shock state." },
      { q:"Cushing's triad (hypertension, bradycardia, irregular respirations) is a late sign of what condition?", options:["A. Hypovolemic shock","B. Increased intracranial pressure","C. Anaphylaxis","D. Sepsis"], answer:1, rationale:"Cushing's triad reflects the body's attempt to maintain cerebral perfusion pressure against rising ICP — by the time it appears, herniation may be imminent." },
      { q:"A flail chest is defined as how many rib fractures?", options:["A. Any single rib fracture","B. Two or more ribs, each fractured in two or more places","C. A fracture of the sternum only","D. Bilateral first rib fractures"], answer:1, rationale:"This creates a free-floating segment that moves paradoxically with respiration, impairing ventilation and often signaling significant underlying pulmonary contusion." },
      { q:"In penetrating trauma without head injury, permissive hypotension generally targets what systolic blood pressure until hemorrhage is controlled?", options:["A. SBP 60 mmHg","B. SBP around 90 mmHg","C. SBP 140 mmHg","D. Normalize to baseline immediately"], answer:1, rationale:"A target around 90 mmHg SBP (or MAP ~65) limits clot disruption from aggressive fluid resuscitation while still perfusing vital organs — this target does NOT apply if a TBI is present." },
      { q:"TXA (tranexamic acid) is most effective when given within what window after injury?", options:["A. Within 3 hours","B. Within 12 hours","C. Within 24 hours","D. Anytime, no time limit"], answer:0, rationale:"CRASH-2 data showed a mortality benefit when TXA is given within 3 hours of injury; benefit diminishes and may reverse to harm beyond that window." },
      { q:"What is the correct order of the primary trauma survey?", options:["A. Disability, Airway, Breathing, Circulation, Exposure","B. Airway, Breathing, Circulation, Disability, Exposure","C. Breathing, Airway, Circulation, Disability, Exposure","D. Circulation, Airway, Breathing, Disability, Exposure"], answer:1, rationale:"ABCDE ensures the most immediately life-threatening problems (airway obstruction, then breathing failure, then hemorrhage) are found and fixed before less urgent findings." },
      { q:"An open (“sucking”) chest wound should be managed initially with what type of dressing?", options:["A. A fully occlusive, non-vented dressing taped on all four sides","B. A three-sided occlusive (vented) dressing","C. A dry gauze dressing only, uncovered","D. No dressing — leave the wound open"], answer:1, rationale:"A vented dressing lets air escape on exhalation but seals on inhalation, preventing the wound from converting into a tension pneumothorax." },
      { q:"When placing an extremity tourniquet, where should it be positioned relative to the wound?", options:["A. Directly over the wound","B. 2–3 inches proximal to the wound, never over a joint","C. As far proximally as possible, e.g. near the axilla for any arm wound","D. Distal to the wound"], answer:1, rationale:"Placing it just proximal to the wound (and avoiding joints, which don't compress vessels well) controls bleeding while preserving as much viable limb as possible." },
      { q:"A patient with blunt chest trauma develops muffled heart sounds, JVD, and hypotension (Beck's triad). What are you most concerned about?", options:["A. Simple pneumothorax","B. Cardiac tamponade","C. Aortic dissection","D. Rib fracture alone"], answer:1, rationale:"Beck's triad reflects impaired diastolic filling from pericardial fluid compressing the heart — this is a time-critical diagnosis requiring rapid transport and possible pericardiocentesis." }
    ],
    "OB": [
      { q:"A term mother presents with a prolapsed umbilical cord. What is your priority positioning?", options:["A. Supine, legs flat","B. Knee-chest or Trendelenburg, with manual pressure off the cord","C. Left lateral, legs down","D. High Fowler's"], answer:1, rationale:"These positions use gravity to relieve pressure of the presenting part on the cord while a gloved hand holds the presenting part off the cord until delivery." },
      { q:"What is considered a normal fetal heart rate range?", options:["A. 60–90 bpm","B. 110–160 bpm","C. 170–220 bpm","D. 40–60 bpm"], answer:1, rationale:"Rates outside 110–160 bpm (fetal bradycardia or tachycardia) suggest fetal distress and warrant maternal repositioning, oxygen, and rapid transport." },
      { q:"A pregnant patient in the third trimester should generally be transported in which position to avoid supine hypotensive syndrome?", options:["A. Fully supine","B. Left lateral tilt","C. Right lateral tilt","D. Prone"], answer:1, rationale:"Left lateral tilt shifts the gravid uterus off the inferior vena cava, restoring venous return and cardiac output that supine positioning can compromise." },
      { q:"What do the letters in the APGAR score stand for?", options:["A. Appearance, Pulse, Grimace, Activity, Respiration","B. Airway, Pulse, Glucose, Activity, Response","C. Appearance, Perfusion, Glucose, Activity, Respiration","D. Airway, Perfusion, Grimace, Activity, Reflex"], answer:0, rationale:"APGAR is scored at 1 and 5 minutes after birth across these five components to quickly assess a newborn's transition." },
      { q:"Postpartum hemorrhage after a vaginal delivery is generally defined as blood loss exceeding how much?", options:["A. 100 mL","B. 500 mL","C. 2000 mL","D. There is no defined threshold"], answer:1, rationale:"500 mL is the traditional threshold for vaginal delivery (1000 mL for cesarean); uterine atony is the most common cause." },
      { q:"Preeclampsia is generally diagnosed with a blood pressure at or above what value after 20 weeks gestation, plus proteinuria or other end-organ signs?", options:["A. 120/80 mmHg","B. 140/90 mmHg","C. 100/60 mmHg","D. 160/110 mmHg only"], answer:1, rationale:"140/90 mmHg after 20 weeks with proteinuria or other end-organ involvement (headache, visual changes, RUQ pain, thrombocytopenia) defines preeclampsia; ≥160/110 marks severe features." },
      { q:"Magnesium sulfate is given in severe preeclampsia/eclampsia primarily to do what?", options:["A. Lower blood pressure directly","B. Prevent or treat seizures","C. Stop labor","D. Treat postpartum hemorrhage"], answer:1, rationale:"Magnesium is a seizure prophylaxis/anticonvulsant in this setting, not a primary antihypertensive, though it can modestly lower BP as a side effect." },
      { q:"A full-term pregnancy is generally considered how many weeks?", options:["A. 30 weeks","B. 34 weeks","C. 40 weeks","D. 44 weeks"], answer:2, rationale:"40 weeks (280 days) from the last menstrual period is the standard estimated due date; term is generally 37–42 weeks." },
      { q:"Which maneuver is a first-line response to shoulder dystocia during delivery?", options:["A. Fundal pressure","B. McRoberts maneuver (hips flexed sharply toward the abdomen)","C. Immediate cesarean in the field","D. Pulling firmly on the head"], answer:1, rationale:"McRoberts maneuver rotates the pelvis to free the anterior shoulder from behind the pubic symphysis; fundal pressure and traction on the head risk injury and are avoided." },
      { q:"The first stage of labor ends when which of the following occurs?", options:["A. The baby is delivered","B. The cervix is fully dilated to 10 cm","C. The placenta is delivered","D. Rupture of membranes"], answer:1, rationale:"Full cervical dilation marks the transition from the first stage (labor/dilation) to the second stage (delivery of the infant)." },
      { q:"A newborn is delivered through meconium-stained fluid and is NOT vigorous. What is the current recommended airway management?", options:["A. Immediate direct tracheal suctioning before any breaths","B. Positive pressure ventilation; routine tracheal suctioning is no longer recommended","C. Withhold all ventilation until suction is complete","D. Deep oropharyngeal suctioning for 60 seconds first"], answer:1, rationale:"Current NRP guidance moved away from routine tracheal suctioning of non-vigorous meconium-stained infants — prioritizing timely ventilation improves outcomes." },
      { q:"Painful vaginal bleeding in the third trimester with a rigid, tender uterus is most consistent with what?", options:["A. Placenta previa","B. Placental abruption","C. Normal Braxton-Hicks contractions","D. Round ligament pain"], answer:1, rationale:"Abruption classically presents with pain and a firm, tender uterus, unlike the painless bleeding typically seen with placenta previa." },
      { q:"During a breech delivery, what is the correct approach to the baby's body as it delivers?", options:["A. Pull gently but firmly to speed delivery","B. Support the body and let it deliver spontaneously; avoid traction","C. Push the baby back in and wait for a hospital","D. Apply fundal pressure immediately"], answer:1, rationale:"Traction on a breech-presenting fetus risks head entrapment and nerve injury; the priority is gentle support while the delivery progresses on its own." }
    ],
    "Pediatric": [
      { q:"What is the initial energy dose for pediatric defibrillation?", options:["A. 1 J/kg","B. 2 J/kg","C. 4 J/kg","D. 10 J/kg"], answer:1, rationale:"PALS recommends 2 J/kg for the first shock, increasing to 4 J/kg for subsequent shocks, up to a max of 10 J/kg or the adult dose." },
      { q:"What tool is commonly used to quickly estimate a pediatric patient's weight and appropriate equipment/drug doses based on length?", options:["A. BMI chart","B. Broselow tape","C. Apgar score","D. Glasgow Coma Scale"], answer:1, rationale:"The Broselow tape correlates a child's length with an estimated weight and color-coded zone for pre-calculated doses and equipment sizes." },
      { q:"Which finding is a classic sign of respiratory distress in an infant?", options:["A. Slow, deep respirations","B. Nasal flaring, grunting, and retractions","C. Bradycardia with normal color","D. Loud crying with good tone"], answer:1, rationale:"Nasal flaring, grunting (auto-PEEP the infant is generating), and retractions reflect increased work of breathing and impending respiratory failure if untreated." },
      { q:"If peripheral IV access cannot be obtained in a critically ill child, what is the preferred next access route?", options:["A. Central line placement in the field as first choice","B. Intraosseous (IO) access","C. Wait until arrival at the hospital","D. Subcutaneous medication administration"], answer:1, rationale:"IO access is fast, reliable, and can be used for nearly any medication or fluid a peripheral IV could deliver, making it the standard next step when IV access fails." },
      { q:"Racemic epinephrine nebulizer treatment is most associated with which pediatric condition?", options:["A. Croup (laryngotracheobronchitis)","B. Simple febrile illness","C. Constipation","D. Otitis media"], answer:0, rationale:"Racemic epi reduces subglottic airway edema in croup, providing rapid, though sometimes temporary, symptom relief." },
      { q:"A febrile seizure is most typically seen in children within what age range?", options:["A. Birth to 3 months","B. 6 months to 5 years","C. 8–12 years","D. Only in teenagers"], answer:1, rationale:"Simple febrile seizures occur in this age range in the setting of a rapidly rising fever, without an underlying CNS infection or structural cause." },
      { q:"What is a typical initial fluid bolus volume for a child in shock?", options:["A. 5 mL/kg","B. 20 mL/kg","C. 60 mL/kg all at once, no reassessment","D. 100 mL total regardless of weight"], answer:1, rationale:"20 mL/kg isotonic crystalloid is a standard starting bolus, with reassessment and repeat boluses as needed based on the child's response." },
      { q:"BRUE (Brief Resolved Unexplained Event) applies to infants under what age?", options:["A. Under 1 year","B. Under 5 years","C. Under 10 years","D. Any pediatric age"], answer:0, rationale:"BRUE was specifically defined for infants under 12 months who had a brief, now-resolved episode of concerning symptoms (color change, altered tone, breathing change) with no identified cause." },
      { q:"What is the recommended initial treatment for a symptomatic hypoglycemic infant?", options:["A. Oral juice only","B. IV/IO D10 at 2 mL/kg","C. Glucagon IM as first-line","D. Withhold glucose until confirmed by lab"], answer:1, rationale:"Dilute dextrose (D10) is preferred in neonates/infants over more concentrated D50 to reduce the risk of a hyperosmolar insult and rebound hypoglycemia." },
      { q:"In a child progressing toward shock, which vital sign change tends to appear EARLIEST?", options:["A. Hypotension","B. Tachycardia","C. Bradycardia","D. Absent pulses"], answer:1, rationale:"Children compensate well and maintain blood pressure until late; tachycardia is often the first and most sensitive sign, while hypotension is a late, ominous finding." },
      { q:"For pediatric spinal motion restriction in a car seat with a suspected spinal injury, what is a key consideration?", options:["A. Always remove the child from the car seat immediately regardless of injury","B. The car seat itself may be an appropriate immobilization device if undamaged and the child is stable enough","C. Spinal precautions are never needed in children","D. Only backboards can ever be used for children"], answer:1, rationale:"Current pediatric guidance favors minimizing unnecessary movement; an undamaged car seat can sometimes serve as the immobilization device during transport." },
      { q:"The Pediatric Assessment Triangle (appearance, work of breathing, circulation to skin) is used for what purpose?", options:["A. To calculate medication doses","B. A rapid, hands-off first impression of how sick a child is, before the hands-on exam","C. To measure blood pressure","D. It's only used after the child is fully undressed and examined"], answer:1, rationale:"The PAT gives a quick, from-the-doorway general impression that helps prioritize how urgently a child needs intervention, before formal vital signs are even obtained." }
    ],
    "Drug Formulary": [
      { q:"What is the standard first adult dose of IV push adenosine for stable SVT?", options:["A. 3 mg","B. 6 mg","C. 12 mg","D. 20 mg"], answer:1, rationale:"6 mg rapid IV push (followed by a rapid saline flush) is the first dose; a second dose of 12 mg may follow if the first is ineffective." },
      { q:"What is the adult IV push dose of amiodarone for pulseless V-fib/V-tach?", options:["A. 150 mg","B. 300 mg","C. 50 mg","D. 1 mg"], answer:1, rationale:"300 mg IV push is the first dose in cardiac arrest, with a repeat 150 mg dose available for recurrent/refractory arrest." },
      { q:"What is the standard atropine dose for symptomatic bradycardia, and what is the maximum total dose?", options:["A. 0.1 mg, max 0.5 mg","B. 1 mg every 3–5 minutes, max 3 mg","C. 5 mg once only","D. 10 mg IV push"], answer:1, rationale:"1 mg IV/IO every 3–5 minutes up to a total of 3 mg is standard dosing for symptomatic bradycardia not responsive to initial measures." },
      { q:"Naloxone is used to reverse the effects of which class of drugs?", options:["A. Benzodiazepines","B. Opioids","C. Beta blockers","D. Antihistamines"], answer:1, rationale:"Naloxone is a competitive opioid receptor antagonist, reversing respiratory depression and sedation caused by opioids." },
      { q:"What is the standard chewable aspirin dose given for suspected cardiac chest pain / STEMI?", options:["A. One 81 mg tablet","B. 324 mg (four 81 mg chewable tablets)","C. 650 mg","D. Aspirin is not indicated for chest pain"], answer:1, rationale:"Four 81 mg chewable baby aspirin tablets (324 mg total) provide rapid antiplatelet effect via buccal/GI absorption, faster than a single enteric-coated tablet." },
      { q:"Which of these is a depolarizing paralytic used for rapid sequence intubation?", options:["A. Rocuronium","B. Vecuronium","C. Succinylcholine","D. Cisatracurium"], answer:2, rationale:"Succinylcholine is the only depolarizing neuromuscular blocker in common use; the others are non-depolarizing agents." },
      { q:"Ondansetron (Zofran) is primarily used to treat what?", options:["A. Hypertension","B. Nausea and vomiting","C. Seizures","D. Bradycardia"], answer:1, rationale:"Ondansetron is a 5-HT3 (serotonin) receptor antagonist antiemetic, commonly used for nausea/vomiting in transport patients." },
      { q:"Nitroglycerin should be avoided or used cautiously in a patient who recently took what class of medication?", options:["A. Antibiotics","B. PDE5 inhibitors (e.g., sildenafil)","C. Antihistamines","D. Oral contraceptives"], answer:1, rationale:"Combining nitrates with PDE5 inhibitors can cause severe, refractory hypotension due to synergistic vasodilation." },
      { q:"Why is D10 often preferred over D50 in neonates and small infants for treating hypoglycemia?", options:["A. D10 works faster","B. D10 is less hyperosmolar, reducing risk of complications in small patients","C. D50 doesn't treat hypoglycemia in infants","D. There is no difference"], answer:1, rationale:"The high osmolarity of D50 poses more risk in small, fragile vasculature and can predispose to rebound hypoglycemia and other complications in neonates." },
      { q:"TXA (tranexamic acid) is generally most beneficial when given within what timeframe of significant traumatic hemorrhage?", options:["A. Within 3 hours","B. Within 24 hours","C. Anytime prior to hospital arrival, no limit","D. Only after 6 hours"], answer:0, rationale:"Benefit is time-sensitive; giving TXA within 3 hours of injury is associated with improved survival, per landmark trial data." },
      { q:"Epinephrine 1:10,000 is the correct concentration for which route/use?", options:["A. IM injection for anaphylaxis","B. IV/IO push in cardiac arrest","C. Subcutaneous allergy shots","D. Nebulized treatment"], answer:1, rationale:"1:10,000 (0.1 mg/mL) is formulated for IV/IO push in arrest; 1:1,000 (1 mg/mL) is used for IM injection in anaphylaxis." },
      { q:"Fentanyl belongs to which drug class?", options:["A. Benzodiazepine","B. Synthetic opioid analgesic","C. NSAID","D. Antiemetic"], answer:1, rationale:"Fentanyl is a potent synthetic opioid, commonly used for analgesia and as part of RSI/post-intubation sedation regimens." },
      { q:"Magnesium sulfate is indicated in which of the following situations?", options:["A. Routine chest pain","B. Eclampsia and torsades de pointes","C. Simple hypertension","D. Uncomplicated asthma without wheeze"], answer:1, rationale:"Magnesium's roles in seizure prophylaxis (eclampsia) and stabilizing the cardiac membrane (torsades) are well established; it's also a useful adjunct in severe bronchospasm." }
    ],
    "Medical": [
      { q:"A diabetic patient is found unresponsive with a blood glucose of 32 mg/dL. What is the first-line treatment?", options:["A. Oral glucose gel","B. IV dextrose (D10/D50)","C. Glucagon IM only","D. Insulin drip"], answer:1, rationale:"An unresponsive patient cannot safely take oral glucose due to aspiration risk — IV dextrose is the fastest, most reliable route when access is available." },
      { q:"What is the first-line treatment for anaphylaxis?", options:["A. IV diphenhydramine only","B. IM epinephrine","C. Albuterol nebulizer only","D. Oral steroids"], answer:1, rationale:"IM epinephrine (anterolateral thigh) is first-line and time-critical in anaphylaxis; antihistamines and steroids are adjuncts, not substitutes." },
      { q:"What does a STEMI on a 12-lead ECG look like?", options:["A. ST depression in a single lead","B. ST elevation in two or more contiguous leads","C. A prolonged PR interval","D. Absent P waves"], answer:1, rationale:"ST elevation in two or more anatomically contiguous leads meeting voltage criteria defines a STEMI, triggering activation of the cath lab pathway." },
      { q:"The classic triad of diabetic ketoacidosis (DKA) includes hyperglycemia, ketosis, and what else?", options:["A. Metabolic alkalosis","B. Metabolic acidosis","C. Respiratory acidosis","D. Hypercalcemia"], answer:1, rationale:"The ketone production causes an anion-gap metabolic acidosis, driving the compensatory rapid, deep (Kussmaul) respirations often seen in DKA." },
      { q:"Status epilepticus is generally defined as a seizure lasting longer than how many minutes, or recurrent seizures without recovery?", options:["A. 1 minute","B. 5 minutes","C. 20 minutes","D. 60 minutes"], answer:1, rationale:"A seizure lasting beyond ~5 minutes is unlikely to stop on its own and warrants prompt treatment to prevent ongoing neuronal injury." },
      { q:"DuoNeb (albuterol/ipratropium) is used for what condition?", options:["A. Bronchospasm in asthma/COPD","B. Seizures","C. Cardiac arrhythmias","D. Anaphylaxis alone"], answer:0, rationale:"Combining a beta-agonist (albuterol) with an anticholinergic (ipratropium) provides synergistic bronchodilation in reactive airway disease." },
      { q:"Which ECG change is classically associated with hyperkalemia?", options:["A. Flattened T waves","B. Peaked T waves","C. Delta waves","D. U waves"], answer:1, rationale:"Peaked, narrow T waves are an early ECG sign of hyperkalemia; progression can lead to widened QRS and a sine-wave pattern if untreated." },
      { q:"For a stable patient in narrow-complex tachycardia, what is typically tried before adenosine?", options:["A. Synchronized cardioversion","B. Vagal maneuvers","C. Amiodarone bolus","D. Defibrillation"], answer:1, rationale:"Vagal maneuvers (e.g., Valsalva) are a safe, non-pharmacologic first step that can terminate many reentrant SVTs before drug therapy is needed." },
      { q:"Flumazenil, a benzodiazepine reversal agent, must be used cautiously because it can precipitate what in chronic users?", options:["A. Hypertension only","B. Seizures","C. Bradycardia","D. Hypoglycemia"], answer:1, rationale:"In patients with benzodiazepine dependence, abrupt reversal can precipitate withdrawal seizures, which is why flumazenil is used selectively." },
      { q:"What is the mainstay of prehospital treatment for an uncomplicated sickle cell pain crisis?", options:["A. Antibiotics","B. Analgesia and IV hydration","C. Immediate blood transfusion","D. High-dose steroids"], answer:1, rationale:"Pain control and hydration address the acute vaso-occlusive crisis; transfusion and other therapies are reserved for specific complications." },
      { q:"A key early clue that a chest pain patient's electrical instability may be forming is which finding?", options:["A. Normal sinus rhythm with no ectopy","B. Frequent PVCs or a new arrhythmia on the monitor","C. Resolved pain with no ECG changes","D. A normal blood pressure"], answer:1, rationale:"New ectopy or arrhythmia in the setting of ischemia signals electrical instability and the potential for deterioration into a lethal rhythm." },
      { q:"What is the priority intervention for a patient presenting with signs of an acute stroke?", options:["A. Aggressively lower blood pressure to normal immediately","B. Rapid identification, stroke scale assessment, and transport to an appropriate stroke center with a documented last-known-well time","C. Administer aspirin immediately in the field","D. Delay transport until symptoms fully resolve"], answer:1, rationale:"“Time is brain” — rapid recognition and transport to a capable center, with an accurate last-known-well time, drives eligibility for time-sensitive therapies like thrombolytics or thrombectomy." }
    ],
    "Airway": [
      { q:"During RSI, which drug is a depolarizing paralytic?", options:["A. Rocuronium","B. Etomidate","C. Succinylcholine","D. Versed"], answer:2, rationale:"Succinylcholine works by depolarizing the neuromuscular junction, causing fasciculations before paralysis; the others listed are not depolarizing paralytics." },
      { q:"What is the landmark for a needle or surgical cricothyrotomy?", options:["A. Suprasternal notch","B. Cricothyroid membrane","C. 2nd intercostal space, midclavicular line","D. Sternal angle"], answer:1, rationale:"The cricothyroid membrane, between the thyroid and cricoid cartilage, is the standard entry point for emergency surgical airway access." },
      { q:"What is a normal end-tidal CO2 (EtCO2) range on capnography?", options:["A. 10–20 mmHg","B. 35–45 mmHg","C. 60–80 mmHg","D. 100–120 mmHg"], answer:1, rationale:"35–45 mmHg reflects normal ventilation; values outside this range indicate hyper- or hypoventilation, or a perfusion/metabolic problem." },
      { q:"What is considered the gold standard for confirming correct endotracheal tube placement?", options:["A. Auscultation alone","B. Waveform capnography","C. Chest x-ray only","D. Visualizing condensation in the tube"], answer:1, rationale:"Continuous waveform capnography provides ongoing, real-time confirmation of tube placement and ventilation status, unlike a one-time auscultation or x-ray." },
      { q:"NIPPV (non-invasive positive pressure ventilation) is generally appropriate for which patient?", options:["A. An unresponsive patient who cannot protect their airway","B. A patient in respiratory distress who is alert and can protect their airway","C. Active vomiting","D. Cardiac arrest"], answer:1, rationale:"NIPPV requires a cooperative patient who can maintain their airway and tolerate the mask/pressure — altered mental status or vomiting are contraindications." },
      { q:"What is a bougie primarily used for during intubation?", options:["A. Suctioning secretions","B. Aiding tube placement when the glottic view is difficult","C. Measuring oxygen saturation","D. Sedating the patient"], answer:1, rationale:"A bougie is a semi-rigid introducer passed into the trachea (often guided by tactile clicks over tracheal rings) when the vocal cords aren't fully visualized, then the ETT is railroaded over it." },
      { q:"What is the goal of pre-oxygenation before RSI?", options:["A. Sedate the patient before paralysis","B. Maximize oxygen reserve (denitrogenation) to extend safe apnea time","C. Test the ventilator circuit","D. Confirm IV access"], answer:1, rationale:"Filling the lungs and blood with oxygen (replacing nitrogen) extends the time before desaturation occurs once the patient is paralyzed and apneic." },
      { q:"A King LTS-D or i-gel is an example of what type of airway device?", options:["A. A definitive surgical airway","B. A supraglottic rescue airway","C. A nasal cannula","D. A ventilator circuit"], answer:1, rationale:"These are blind-insertion supraglottic devices used as rescue airways when intubation fails or isn't immediately available, sitting above the vocal cords." },
      { q:"What is a key advantage of video laryngoscopy over direct laryngoscopy?", options:["A. It requires less training","B. It generally improves the view of the glottic opening","C. It works without any light source","D. It eliminates the need for suction"], answer:1, rationale:"The camera angle on most video laryngoscopes provides a better view around the tongue's curve, often improving visualization of the cords in difficult airways." },
      { q:"When suctioning a patient's airway, why should each suction pass be limited in duration (roughly 10–15 seconds)?", options:["A. To conserve battery on the suction unit","B. Prolonged suctioning removes oxygen from the airway and can cause hypoxia/bradycardia","C. It's a documentation requirement only","D. There is no need to limit duration"], answer:1, rationale:"Suctioning also removes oxygen from the airway and can stimulate a vagal response, so passes are kept brief with reoxygenation in between." },
      { q:"For lung-protective ventilation in ARDS, what tidal volume target (per kg of ideal body weight) is generally used?", options:["A. 12–15 mL/kg","B. 6 mL/kg","C. 20 mL/kg","D. 2 mL/kg"], answer:1, rationale:"Low tidal volume ventilation (~6 mL/kg IBW) reduces ventilator-induced lung injury compared to traditional higher volumes." },
      { q:"For a complete foreign body airway obstruction in an unresponsive patient, what should you do?", options:["A. Blind finger sweeps only","B. Begin CPR, checking the mouth for a visible object before each breath","C. Wait for ALS without intervening","D. Perform immediate cricothyrotomy"], answer:1, rationale:"Chest compressions can generate enough pressure to dislodge an obstruction; the mouth is checked (not blindly swept) before attempted ventilations." }
    ],
    "Procedures": [
      { q:"Current guidance for needle decompression of a tension pneumothorax favors which site due to chest wall thickness concerns at the traditional site?", options:["A. 2nd intercostal space, midclavicular line only, no alternative","B. 5th intercostal space, anterior axillary line","C. Suprasternal notch","D. Directly over the nipple on the same side only"], answer:1, rationale:"Studies showed the standard catheter often fails to reach the pleural space at the 2nd ICS in many adults; the 5th ICS anterior axillary line has thinner chest wall tissue and is now widely favored." },
      { q:"When is intraosseous (IO) access generally indicated?", options:["A. As a routine first choice over any IV","B. When emergent vascular access is needed and IV access has failed or isn't rapidly obtainable","C. Only in patients over 70 years old","D. Never in cardiac arrest"], answer:1, rationale:"IO access is fast and reliable in emergent situations, especially cardiac arrest or shock, when peripheral IV access is difficult or delayed." },
      { q:"What is the primary purpose of obtaining a 12-lead ECG in a chest pain patient?", options:["A. To measure blood pressure","B. To identify STEMI or other acute ischemic changes","C. To check blood glucose","D. To assess lung sounds"], answer:1, rationale:"The 12-lead is the key tool for identifying ST-elevation MI and other ischemic patterns that change immediate management and destination." },
      { q:"Point-of-care blood glucose analysis is important in an altered mental status patient because it can rapidly identify what treatable cause?", options:["A. Fractures","B. Hypoglycemia or severe hyperglycemia","C. Pneumonia","D. Kidney stones"], answer:1, rationale:"Glucose abnormalities are a common, rapidly reversible cause of altered mental status and should be checked early in any AMS work-up." },
      { q:"The standard landmark for tube thoracostomy (chest tube) placement is which of the following?", options:["A. 2nd intercostal space, midclavicular line","B. 5th intercostal space, anterior to the mid-axillary line","C. Directly over the sternum","D. 10th intercostal space, posterior axillary line"], answer:1, rationale:"This “safe triangle” location avoids major vessels/nerves and provides good access to the pleural space for tube placement." },
      { q:"Transcutaneous (external) pacing is generally indicated for which patient?", options:["A. Asymptomatic sinus bradycardia","B. Symptomatic bradycardia unresponsive to atropine","C. Stable sinus tachycardia","D. Normal sinus rhythm"], answer:1, rationale:"Pacing is reserved for symptomatic bradycardia (hypotension, altered mentation, chest pain) that doesn't respond to initial pharmacologic treatment." },
      { q:"What is the key difference between cardioversion and defibrillation?", options:["A. There is no difference","B. Cardioversion is synchronized to the QRS; defibrillation is not","C. Defibrillation is always a lower energy setting","D. Cardioversion is only used in asystole"], answer:1, rationale:"Synchronization times the shock to avoid the vulnerable T-wave period, which is important for organized rhythms like unstable SVT or V-tach with a pulse." },
      { q:"What is the primary purpose of gastric tube insertion in a critically ill or ventilated patient?", options:["A. To administer chest compressions","B. Gastric decompression and reducing aspiration risk","C. To monitor blood pressure","D. To deliver oxygen"], answer:1, rationale:"Decompressing the stomach reduces the risk of vomiting/aspiration and can improve ventilation by relieving diaphragmatic pressure from a distended stomach." },
      { q:"A central venous line is often placed in critical care transport primarily to allow for what?", options:["A. Peripheral IV fluids only","B. Safe administration of vasoactive infusions and reliable central access","C. Drawing arterial blood gases","D. Continuous ECG monitoring"], answer:1, rationale:"Vasoactive drips (like norepinephrine) are ideally run centrally to reduce the risk of tissue injury from extravasation seen with peripheral administration." },
      { q:"An arterial line provides which key benefit over a standard blood pressure cuff?", options:["A. It's less invasive","B. Continuous, real-time blood pressure monitoring","C. It measures oxygen saturation directly","D. It replaces the need for an ECG"], answer:1, rationale:"An arterial line gives beat-to-beat blood pressure readings, which is especially valuable in hemodynamically unstable patients on vasoactive drips." },
      { q:"A mechanical CPR device (e.g., LUCAS) is used to do what during resuscitation?", options:["A. Deliver defibrillation shocks","B. Provide consistent, fatigue-free chest compressions","C. Administer IV medications","D. Monitor EtCO2"], answer:1, rationale:"Mechanical compression devices maintain consistent depth/rate over time, which is especially useful during prolonged resuscitation or transport when rescuer fatigue would otherwise degrade compression quality." },
      { q:"What is a key advantage of continuous waveform capnography during CPR?", options:["A. It replaces the need for chest compressions","B. It can help confirm ETT placement and gauge the effectiveness/quality of CPR","C. It measures blood glucose","D. It has no role during cardiac arrest"], answer:1, rationale:"A sustained rise in EtCO2 during CPR reflects improved perfusion from compressions, and an abrupt rise can be an early sign of return of spontaneous circulation." }
    ],
    "Drug Calculation": [
      { q:"Ordered: Fentanyl 100 mcg IV. On hand: 50 mcg/mL. How many mL do you give?", options:["A. 0.5 mL","B. 1 mL","C. 2 mL","D. 5 mL"], answer:2, rationale:"Desired dose ÷ concentration = volume: 100 mcg ÷ 50 mcg/mL = 2 mL." },
      { q:"Ordered: Ondansetron (Zofran) 4 mg IV. On hand: 2 mg/mL. How many mL do you give?", options:["A. 1 mL","B. 2 mL","C. 4 mL","D. 8 mL"], answer:1, rationale:"4 mg ÷ 2 mg/mL = 2 mL." },
      { q:"Ordered: Morphine sulfate 4 mg IV. On hand: 2 mg/mL. How many mL do you give?", options:["A. 0.5 mL","B. 1 mL","C. 2 mL","D. 4 mL"], answer:2, rationale:"4 mg ÷ 2 mg/mL = 2 mL." },
      { q:"Ordered: Adenosine 6 mg IV push. On hand: 3 mg/mL. How many mL do you give?", options:["A. 1 mL","B. 2 mL","C. 3 mL","D. 6 mL"], answer:1, rationale:"6 mg ÷ 3 mg/mL = 2 mL, given rapidly followed by a saline flush." },
      { q:"Ordered: Naloxone 0.4 mg IV. On hand: a prefilled syringe of 0.4 mg/mL. How many mL do you give?", options:["A. 0.25 mL","B. 0.4 mL","C. 1 mL","D. 4 mL"], answer:2, rationale:"0.4 mg ÷ 0.4 mg/mL = 1 mL — the whole prefilled syringe." },
      { q:"Ordered: Dexamethasone 10 mg IV. On hand: 4 mg/mL. How many mL do you give?", options:["A. 1.5 mL","B. 2.5 mL","C. 4 mL","D. 10 mL"], answer:1, rationale:"10 mg ÷ 4 mg/mL = 2.5 mL." },
      { q:"Ordered: Diphenhydramine (Benadryl) 25 mg IV. On hand: 50 mg/mL. How many mL do you give?", options:["A. 0.25 mL","B. 0.5 mL","C. 1 mL","D. 2 mL"], answer:1, rationale:"25 mg ÷ 50 mg/mL = 0.5 mL." },
      { q:"Ordered: Calcium gluconate 1 gram IV. On hand: 100 mg/mL (10% solution). How many mL do you give?", options:["A. 1 mL","B. 5 mL","C. 10 mL","D. 100 mL"], answer:2, rationale:"1 g = 1000 mg. 1000 mg ÷ 100 mg/mL = 10 mL." },
      { q:"Ordered: Ketamine 100 mg IM. On hand: 100 mg/mL. How many mL do you give?", options:["A. 0.5 mL","B. 1 mL","C. 2 mL","D. 10 mL"], answer:1, rationale:"100 mg ÷ 100 mg/mL = 1 mL." },
      { q:"Ordered: Etomidate 20 mg IV. On hand: 2 mg/mL. How many mL do you give?", options:["A. 2 mL","B. 5 mL","C. 10 mL","D. 20 mL"], answer:2, rationale:"20 mg ÷ 2 mg/mL = 10 mL." },
      { q:"Ordered: Rocuronium 70 mg IV. On hand: 10 mg/mL. How many mL do you give?", options:["A. 3.5 mL","B. 7 mL","C. 10 mL","D. 14 mL"], answer:1, rationale:"70 mg ÷ 10 mg/mL = 7 mL." },
      { q:"Ordered: Succinylcholine 140 mg IV. On hand: 20 mg/mL. How many mL do you give?", options:["A. 4 mL","B. 5 mL","C. 7 mL","D. 14 mL"], answer:2, rationale:"140 mg ÷ 20 mg/mL = 7 mL." },
      { q:"Ordered: Magnesium sulfate 2 grams IV. On hand: 500 mg/mL (50% solution). How many mL do you give?", options:["A. 2 mL","B. 4 mL","C. 8 mL","D. 20 mL"], answer:1, rationale:"2 g = 2000 mg. 2000 mg ÷ 500 mg/mL = 4 mL." }
    ]
  },
  intermediate: {
    "Trauma": [
      { q:"In damage control resuscitation for hemorrhagic shock, blood products are generally given in what ratio?", options:["A. 1:1:1 of PRBC:FFP:platelets","B. 10:1:1 of PRBC:FFP:platelets","C. Crystalloid only until the OR","D. 1:1:1 of crystalloid:PRBC:platelets"], answer:0, rationale:"A balanced 1:1:1 ratio approximates whole blood and reduces dilutional coagulopathy compared to crystalloid-heavy resuscitation." },
      { q:"A shock index (HR/SBP) greater than what value is a red flag for significant occult hemorrhage?", options:["A. 0.5","B. 0.9","C. 2.5","D. 5.0"], answer:1, rationale:"A shock index above roughly 0.9 suggests significant blood loss even when standard vital signs haven't yet crossed traditional shock thresholds." },
      { q:"In a traumatic brain injury patient without signs of herniation, what EtCO2 range should generally be targeted?", options:["A. 20–25 mmHg (aggressive hyperventilation)","B. 35–40 mmHg (normocapnia)","C. 60–70 mmHg","D. There is no target range"], answer:1, rationale:"Routine hyperventilation lowers EtCO2, causing cerebral vasoconstriction that can worsen ischemia; normocapnia is the default target absent herniation signs." },
      { q:"REBOA Zone 1 occlusion is used for hemorrhage originating from where, versus Zone 3?", options:["A. Zone 1 for pelvic bleeding, Zone 3 for chest bleeding","B. Zone 1 for supradiaphragmatic/abdominal bleeding, Zone 3 for pelvic/junctional bleeding","C. They are interchangeable","D. Zone 1 is only used for lower extremity bleeding"], answer:1, rationale:"Zone 1 (descending thoracic aorta to celiac) addresses abdominal hemorrhage; Zone 3 (below the renal arteries) targets pelvic/junctional bleeding while sparing more organs from ischemia." },
      { q:"In traumatic cardiac arrest, which reversible causes should be addressed first?", options:["A. Hypoglycemia and hypothermia only","B. Hypovolemia, tension pneumothorax, and cardiac tamponade","C. Hyperkalemia only","D. None — traumatic arrest is not treatable"], answer:1, rationale:"These mechanical/volume causes are common and rapidly reversible in trauma, and compressions alone rarely restore circulation until they're addressed." },
      { q:"The Parkland formula for burn fluid resuscitation calculates the first 24-hour fluid volume as approximately what?", options:["A. 1 mL x kg x %TBSA","B. 4 mL x kg x %TBSA, with half given in the first 8 hours","C. A fixed 2 liters regardless of size","D. 10 mL x kg x %TBSA all in the first hour"], answer:1, rationale:"The formula estimates total 24-hour crystalloid needs based on weight and burn surface area, front-loaded into the first 8 hours when capillary leak is greatest." },
      { q:"Crush syndrome carries a significant risk of what electrolyte abnormality upon reperfusion/extrication?", options:["A. Hypokalemia","B. Hyperkalemia","C. Hypercalcemia","D. Hyponatremia"], answer:1, rationale:"Reperfusion of crushed muscle releases intracellular potassium and myoglobin, risking life-threatening hyperkalemia and dysrhythmia at the moment of extrication." },
      { q:"A hemodynamically unstable pelvic fracture patient should receive which combination of interventions?", options:["A. Pelvic binder only, no other treatment needed","B. Pelvic binder, TXA (if within window), and blood product resuscitation","C. Aggressive crystalloid only, avoid blood products","D. No intervention until CT confirms the fracture"], answer:1, rationale:"Mechanical stabilization plus antifibrinolytic and blood-product-based resuscitation together address both the anatomic and physiologic sides of pelvic hemorrhage." },
      { q:"Why is hypotension (SBP <90 mmHg) especially dangerous in a traumatic brain injury patient?", options:["A. It has no special significance in TBI","B. Even a single episode is associated with significantly increased mortality","C. It only matters if it lasts over an hour","D. It's only a concern in pediatric TBI"], answer:1, rationale:"Even brief hypotension can drop cerebral perfusion pressure enough to cause secondary brain injury, and is associated with a marked increase in mortality." },
      { q:"Chest escharotomy is indicated for what specific finding after a thermal burn?", options:["A. Any first-degree burn to the chest","B. A circumferential full-thickness burn restricting chest wall movement and ventilation","C. Superficial partial-thickness burns only","D. Sunburn"], answer:1, rationale:"A rigid, circumferential eschar can act like a tourniquet around the chest, and incising it relieves the restriction so the chest wall can expand." },
      { q:"In suspected aortic dissection, why is heart rate/contractility control (e.g., esmolol) generally addressed BEFORE a vasodilator?", options:["A. It doesn't matter which is given first","B. Vasodilators alone can cause reflex tachycardia, increasing aortic wall shear stress","C. Vasodilators are contraindicated entirely","D. Beta blockers have no role in dissection"], answer:1, rationale:"Controlling heart rate and the force of ventricular contraction first blunts the reflex tachycardia a vasodilator would otherwise trigger, which would worsen shear stress on the dissection." },
      { q:"Current evidence has shifted spinal motion restriction practice toward what approach?", options:["A. Full rigid backboard immobilization for every trauma patient regardless of exam","B. Selective immobilization based on mechanism and clinical exam findings","C. No spinal precautions are ever needed","D. Only helmets should be removed, nothing else changes"], answer:1, rationale:"Evidence of harm from prolonged backboard use (pressure injury, discomfort, no proven benefit in many patients) has shifted many systems toward selective, exam-based spinal motion restriction." },
      { q:"Blunt cardiac injury most commonly presents with which finding on the monitor?", options:["A. Complete heart block in most cases","B. Sinus tachycardia, with a need for continuous ECG monitoring for arrhythmia","C. Sinus bradycardia in nearly all cases","D. No monitoring is needed"], answer:1, rationale:"Sinus tachycardia is the most common finding; continuous monitoring is still warranted because more serious arrhythmias can develop." }
    ],
    "OB": [
      { q:"Magnesium toxicity is suggested by which combination of findings, and what is the antidote?", options:["A. Hyperreflexia and tachycardia; antidote is more magnesium","B. Loss of deep tendon reflexes and respiratory depression; antidote is calcium gluconate","C. Seizures only; antidote is diazepam","D. Hypertension only; no antidote needed"], answer:1, rationale:"As magnesium levels climb, DTRs are lost before respiratory depression and cardiac effects occur — calcium gluconate is the specific antidote if toxicity is suspected." },
      { q:"For an eclamptic seizure, magnesium sulfate is typically given as a loading dose in what general range?", options:["A. 100 mg total","B. 4–6 grams IV over 15–20 minutes, followed by an infusion","C. 1 mg IV push","D. Magnesium is not used for eclampsia"], answer:1, rationale:"A 4–6 gram loading dose followed by a maintenance infusion is standard for eclampsia seizure treatment/prophylaxis, with close monitoring for toxicity." },
      { q:"During management of a uterine inversion, which two actions are critical to AVOID or DO?", options:["A. Remove the placenta immediately, and give more uterotonics","B. Do NOT remove the placenta, and STOP any uterotonic drugs to allow the uterus to relax","C. Apply firm traction on the cord until it delivers","D. Deliver oxytocin as the first step"], answer:1, rationale:"Removing the placenta can dramatically worsen hemorrhage, and uterotonics keep the uterus contracted — both work against safely reducing the inversion." },
      { q:"In suspected placenta previa with antepartum hemorrhage, what exam should generally be AVOIDED in the field?", options:["A. Abdominal palpation","B. Digital vaginal examination","C. Blood pressure measurement","D. Fetal heart tone monitoring"], answer:1, rationale:"A digital vaginal exam can dislodge a previa and provoke catastrophic hemorrhage — diagnosis and management should proceed without one." },
      { q:"HELLP syndrome is a severe variant of preeclampsia characterized by which findings?", options:["A. Hemolysis, Elevated Liver enzymes, Low Platelets","B. Hyperglycemia, Elevated Lipids, Low Potassium","C. Hypertension, Edema, Low Protein","D. Hemorrhage, Elevated Lactate, Low Perfusion"], answer:0, rationale:"HELLP reflects microangiopathic hemolysis and hepatic/platelet involvement, and can develop rapidly with life-threatening complications." },
      { q:"For non-reassuring fetal heart tones during transport, what is the first-line bundle of interventions?", options:["A. Immediate cesarean delivery in the aircraft","B. Maternal repositioning (left lateral), oxygen, and an IV fluid bolus","C. Sedate the mother heavily","D. Nothing can be done until arrival"], answer:1, rationale:"These simple maneuvers improve uteroplacental perfusion and oxygen delivery and often resolve non-reassuring patterns before more invasive steps are needed." },
      { q:"The first-line treatment for postpartum hemorrhage due to uterine atony is which combination?", options:["A. TXA alone, nothing else","B. Fundal massage plus a uterotonic (e.g., oxytocin)","C. Immediate hysterectomy","D. Withhold all medications until arrival"], answer:1, rationale:"Bimanual fundal massage combined with a uterotonic addresses the underlying cause — a boggy, non-contracted uterus — directly and rapidly." },
      { q:"Which fetal heart tracing pattern is most concerning for uteroplacental insufficiency?", options:["A. Early decelerations","B. Late decelerations","C. Mild variability with accelerations","D. A steady baseline of 140 bpm"], answer:1, rationale:"Late decelerations, which lag behind the contraction peak, suggest impaired oxygen delivery across the placenta during contractions — an ominous pattern if recurrent." },
      { q:"An amniotic fluid embolism classically presents with a sudden onset of what combination during or after labor?", options:["A. Gradual fever and mild malaise","B. Sudden hypoxia, hypotension, and coagulopathy (DIC)","C. Isolated mild headache","D. Slowly worsening back pain over days"], answer:1, rationale:"AFE presents abruptly and can rapidly progress to cardiovascular collapse and DIC, requiring immediate, aggressive supportive resuscitation." },
      { q:"During resuscitation of a pregnant trauma patient in cardiac arrest, why is left uterine displacement performed?", options:["A. It has no proven benefit and should be skipped","B. It relieves aortocaval compression, improving venous return and the effectiveness of compressions","C. It is done to protect the fetus only, not the mother","D. It replaces the need for chest compressions"], answer:1, rationale:"Manually displacing the uterus leftward (or tilting the patient) relieves compression of the inferior vena cava/aorta, which can otherwise severely blunt the effectiveness of CPR in a term pregnancy." },
      { q:"Preterm labor management during transport often includes consideration of tocolytic therapy for what purpose?", options:["A. To permanently stop labor","B. To temporarily delay delivery long enough to complete transport or allow steroids to work","C. To induce labor faster","D. Tocolytics are never used in transport"], answer:1, rationale:"Tocolysis is a temporizing measure, buying time for transport to an appropriate facility or for antenatal steroids to have effect, not a permanent solution." }
    ],
    "Pediatric": [
      { q:"In pediatric septic shock, what is the general approach to initial fluid resuscitation?", options:["A. Avoid fluids entirely","B. 20 mL/kg boluses with frequent reassessment, potentially up to 40–60 mL/kg","C. A single fixed 1 liter bolus regardless of weight","D. Fluids are only given after antibiotics"], answer:1, rationale:"Reassessing after each bolus (lung sounds, perfusion, mental status) allows titration of aggressive fluid resuscitation while watching for volume overload." },
      { q:"In pediatric DKA, why is an initial insulin bolus generally avoided?", options:["A. Insulin doesn't work in children","B. Bolus dosing increases the risk of rapid osmotic shifts and cerebral edema","C. It has no risk, it's just not necessary","D. Insulin boluses are actually preferred in children"], answer:1, rationale:"Rapid correction of glucose/osmolality in pediatric DKA is linked to cerebral edema; a gradual, fluid-first, low-dose infusion approach is favored over bolus dosing." },
      { q:"What is the standard pediatric epinephrine dose for cardiac arrest, and how is it typically expressed for a 1:10,000 concentration?", options:["A. 1 mg fixed dose regardless of weight","B. 0.01 mg/kg (0.1 mL/kg of 1:10,000) IV/IO every 3–5 minutes","C. 0.1 mg/kg every minute","D. Epinephrine is not used in pediatric arrest"], answer:1, rationale:"Weight-based dosing at 0.01 mg/kg keeps dosing proportional to the child's size, repeated roughly every 3–5 minutes during ongoing arrest." },
      { q:"For stable pediatric SVT, what is the initial adenosine dose?", options:["A. 6 mg fixed regardless of weight","B. 0.1 mg/kg rapid IV/IO push","C. 1 mg/kg","D. Adenosine is contraindicated in children"], answer:1, rationale:"Pediatric adenosine dosing is weight-based (0.1 mg/kg first dose, up to a max), unlike the fixed adult dosing." },
      { q:"In a hemodynamically unstable pediatric patient requiring RSI, what adjustment is generally made to induction agent dosing?", options:["A. Doses are increased above standard to ensure adequate sedation","B. Doses are typically reduced, similar to the adult approach in shock","C. No adjustment is ever needed in children","D. Paralytics are avoided entirely in unstable children"], answer:1, rationale:"Just as in adults, reduced induction doses in a child with marginal hemodynamics limit the risk of peri-intubation cardiovascular collapse." },
      { q:"Pediatric burn fluid resuscitation calculations differ from the adult Parkland approach mainly because of what additional factor?", options:["A. Children need less fluid overall","B. Maintenance fluids must be added on top of the resuscitation formula due to lower glycogen reserves","C. Burns don't require fluid resuscitation in children","D. The formula is identical with no differences"], answer:1, rationale:"Children have proportionally less glycogen reserve, so maintenance fluid (often with dextrose) is added on top of burn resuscitation fluids to avoid hypoglycemia." },
      { q:"In pediatric drowning resuscitation, why is early rescue breathing emphasized alongside compressions?", options:["A. It isn't emphasized, compressions alone are sufficient","B. The primary insult is typically hypoxia from submersion, making ventilation especially important","C. Rescue breathing is contraindicated in drowning","D. Only defibrillation matters in drowning arrest"], answer:1, rationale:"Because the arrest is usually driven by asphyxia rather than a primary cardiac event, early, effective ventilation is a key part of drowning resuscitation, unlike a pure compression-focused approach." },
      { q:"In a suspected pediatric traumatic brain injury, the ventilation strategy should generally mirror which adult principle?", options:["A. Aggressive hyperventilation for every patient","B. Avoid hyperventilation/hypoxia; target age-appropriate normocapnia unless herniation signs are present","C. Withhold all ventilatory support","D. There is no equivalent principle in pediatrics"], answer:1, rationale:"As in adults, unnecessary hyperventilation can worsen cerebral ischemia, so normocapnia is the default target absent signs of herniation." },
      { q:"What is the pediatric weight-based push-dose epinephrine dosing referenced in critical care transport guidelines?", options:["A. A fixed 1 mg dose","B. Approximately 1 mcg/kg IV/IO, with a defined maximum single dose","C. 10 mg/kg","D. Push-dose epinephrine is adult-only"], answer:1, rationale:"Weight-based push-dose epinephrine (around 1 mcg/kg, capped at a maximum single dose) allows titratable support for transient pediatric hypotension." },
      { q:"In a pediatric patient progressing toward respiratory failure, why is bradycardia considered an especially ominous sign?", options:["A. It isn't significant in children","B. It often signals imminent cardiopulmonary arrest from prolonged hypoxia","C. It means the child is improving","D. It only matters in adults"], answer:1, rationale:"Unlike adults where bradycardia may be an isolated finding, in children it's frequently a pre-arrest sign reflecting severe, sustained hypoxia." },
      { q:"What is a known limitation of length-based (Broselow) weight estimation in pediatric patients?", options:["A. It works perfectly for every child regardless of body habitus","B. It can be inaccurate in obese or edematous children","C. It cannot be used at all in emergencies","D. It only applies to newborns"], answer:1, rationale:"Because it estimates weight from length alone, a child with significant excess weight or fluid retention may be under- or over-dosed if the tape is used without adjustment." }
    ],
    "Drug Formulary": [
      { q:"When mixing push-dose epinephrine from a 1:10,000 (0.1 mg/mL) cardiac amp, what is the resulting concentration after standard dilution into a 10 mL flush?", options:["A. 1 mcg/mL","B. 10 mcg/mL","C. 100 mcg/mL","D. 1000 mcg/mL"], answer:1, rationale:"Pushing out 1 mL of the flush and drawing up 1 mL of 1:10,000 epi (100 mcg) into the remaining 9 mL yields a 10 mcg/mL push-dose concentration." },
      { q:"What is the standard amiodarone maintenance infusion rate for the first 6 hours after ROSC or during ongoing arrhythmia management?", options:["A. 1 mg/min (33 mL/hr from a 450 mg/250 mL mix)","B. 10 mg/min","C. 0.1 mg/hr","D. A one-time bolus only, no infusion"], answer:0, rationale:"1 mg/min for the first 6 hours (then typically 0.5 mg/min for 18 hours) is standard maintenance dosing after the initial bolus doses." },
      { q:"In a hemodynamically unstable patient requiring RSI, ketamine induction dosing is typically reduced from the standard 1–2 mg/kg to approximately what?", options:["A. 0.5 mg/kg","B. 3 mg/kg","C. 5 mg/kg","D. No reduction is needed"], answer:0, rationale:"Halving the induction dose in shock states reduces the risk of a further hemodynamic hit from the induction agent itself." },
      { q:"A recognized concern with etomidate, even as a single induction dose, is what physiologic effect?", options:["A. It causes significant hypertension","B. Transient adrenal (cortisol) suppression","C. It is a strong bronchodilator with no downsides","D. It has no known concerns"], answer:1, rationale:"Etomidate can transiently suppress adrenal cortisol production; despite this, it remains widely used in critical care transport for its hemodynamic stability during induction." },
      { q:"Why was vasopressin removed from the adult cardiac arrest algorithm in recent AHA guideline updates?", options:["A. It caused too many allergic reactions","B. Studies showed no outcome benefit over epinephrine alone","C. It is now considered dangerous in all patients","D. It was never part of the algorithm"], answer:1, rationale:"Evidence review found vasopressin combined with epinephrine offered no survival or neurologic benefit over epinephrine alone, so it was removed to simplify the algorithm." },
      { q:"What is the mechanism of action of TXA (tranexamic acid)?", options:["A. It directly increases platelet count","B. It's an antifibrinolytic that inhibits plasminogen activation, stabilizing existing clots","C. It's a vasoconstrictor","D. It replaces clotting factors directly"], answer:1, rationale:"TXA blocks the breakdown of fibrin clots rather than promoting new clot formation, which is why timing relative to injury matters so much." },
      { q:"When mixing push-dose norepinephrine per standard critical care transport instructions, what is the typical resulting concentration?", options:["A. 1 mcg/mL","B. 16 mcg/mL","C. 160 mcg/mL","D. 1600 mcg/mL"], answer:1, rationale:"A small volume of concentrated norepinephrine diluted into a flush yields roughly 16 mcg/mL for a push-dose preparation, allowing small, titratable boluses." },
      { q:"Why is rocuronium often preferred over succinylcholine in a burn, crush injury, or prolonged-immobility patient?", options:["A. Rocuronium works faster in all cases","B. Succinylcholine carries a risk of life-threatening hyperkalemia in these populations","C. There is no clinical reason, it's purely institutional preference","D. Succinylcholine is cheaper so it's avoided"], answer:1, rationale:"These conditions upregulate extrajunctional acetylcholine receptors, and succinylcholine can trigger a massive, dangerous potassium efflux in this setting." },
      { q:"In the treatment of hyperkalemia, what is the FIRST priority even before treatments that lower serum potassium?", options:["A. Insulin/dextrose administration","B. Calcium gluconate to stabilize the cardiac membrane","C. Sodium bicarbonate","D. Albuterol nebulizer"], answer:1, rationale:"Calcium doesn't lower potassium levels at all — it stabilizes the myocardial membrane against the potassium-driven arrhythmia risk, buying time for the potassium-lowering therapies to work." },
      { q:"Sodium bicarbonate is a reasonable consideration in which of the following situations?", options:["A. Routine metabolic acidosis of any cause","B. Severe hyperkalemia or tricyclic antidepressant overdose with a wide QRS","C. Simple dehydration","D. Uncomplicated respiratory acidosis"], answer:1, rationale:"Bicarbonate helps in specific situations like TCA-induced sodium channel blockade (widened QRS) and severe hyperkalemia, but isn't a blanket treatment for all acidosis." },
      { q:"Octreotide is a useful adjunct specifically in which type of overdose?", options:["A. Opioid overdose","B. Sulfonylurea-induced refractory hypoglycemia","C. Beta-blocker overdose only","D. Acetaminophen overdose"], answer:1, rationale:"Octreotide suppresses the sulfonylurea-driven insulin release from the pancreas, helping to break the cycle of recurrent hypoglycemia that dextrose alone may not fully resolve." }
    ],
    "Medical": [
      { q:"In septic shock resuscitation, what is generally used as a marker to help guide adequacy of resuscitation?", options:["A. Blood glucose trend only","B. Serial lactate levels/clearance","C. Body temperature alone","D. Heart rate alone, without other data"], answer:1, rationale:"A falling lactate over time suggests improving tissue perfusion, making it a useful (though not perfect) marker alongside clinical exam and other vitals." },
      { q:"A posterior STEMI can be subtle on a standard 12-lead. What pattern in leads V1–V3 should raise suspicion?", options:["A. ST elevation only","B. ST depression with tall, upright T waves (a 'mirror image' of anterior STEMI)","C. Flattened P waves","D. A prolonged QT interval"], answer:1, rationale:"Posterior MI often shows as reciprocal ST depression anteriorly rather than obvious elevation; posterior leads (V7–V9) can confirm true posterior injury." },
      { q:"What is the recommended amiodarone dose/administration for stable monomorphic wide-complex tachycardia?", options:["A. 300 mg IV push, same as cardiac arrest dosing","B. 150 mg mixed in 100 mL, infused over about 10 minutes","C. A fixed oral dose only","D. Amiodarone is contraindicated in wide-complex tachycardia"], answer:1, rationale:"For a stable patient (as opposed to pulseless arrest), amiodarone is infused more slowly to avoid rapid hypotension from bolus administration." },
      { q:"What is the general treatment sequence for severe hyperkalemia with ECG changes?", options:["A. Calcium first for cardiac stabilization, then insulin/dextrose, then consider albuterol and bicarbonate","B. Bicarbonate only, nothing else needed","C. Dialysis is the only treatment option in the field","D. Potassium-lowering treatment before any cardiac stabilization"], answer:0, rationale:"Membrane stabilization with calcium buys time while insulin/dextrose (and adjuncts like albuterol) shift potassium intracellularly to lower serum levels." },
      { q:"In pediatric or adult DKA management, why must serum potassium generally be confirmed adequate (e.g., >3.3) before starting an insulin infusion?", options:["A. Potassium level is irrelevant to insulin therapy","B. Insulin drives potassium intracellularly and can precipitate dangerous hypokalemia if the level is already low","C. Insulin cannot be given if potassium is normal","D. Higher potassium always requires insulin to be stopped permanently"], answer:1, rationale:"Because insulin shifts potassium into cells, starting it with an already-low serum potassium can cause a sudden, dangerous further drop, risking dysrhythmia." },
      { q:"Push-dose pressors in the critical care transport setting are best understood as what?", options:["A. A definitive long-term treatment for shock","B. A temporary bridge to buy time until a vasoactive infusion can be started","C. A replacement for fluid resuscitation","D. Only used in cardiac arrest"], answer:1, rationale:"Push-dose pressors provide rapid, short-acting support for transient hypotension while more definitive therapies (infusions, blood, source control) are arranged." },
      { q:"Why is 'last known well' time so critical in the assessment of a suspected stroke patient?", options:["A. It has no bearing on treatment decisions","B. It determines eligibility for time-sensitive therapies like thrombolytics or thrombectomy","C. It's only used for documentation, not treatment decisions","D. It only matters for hemorrhagic strokes"], answer:1, rationale:"Therapies like tPA and mechanical thrombectomy have defined treatment windows from symptom onset, so an accurate last-known-well time directly shapes what's still offered at the receiving facility." },
      { q:"What clinical clue can help distinguish aortic dissection from a typical acute MI?", options:["A. Dissection pain is always mild and improves with rest","B. Tearing/ripping pain radiating to the back, with a blood pressure or pulse differential between arms","C. Dissection never causes chest pain","D. There is no way to distinguish them clinically"], answer:1, rationale:"These findings reflect the pathology of a dissection flap altering flow to different vascular branches, which isn't typically seen with a simple coronary occlusion." },
      { q:"Acute adrenal crisis in a patient on chronic steroids or with adrenal insufficiency is treated with what?", options:["A. Stress-dose hydrocortisone","B. Insulin","C. High-dose epinephrine only","D. No specific treatment exists"], answer:0, rationale:"Stress-dose corticosteroids replace the cortisol surge the body can't mount on its own during acute illness/stress, which is the core problem in adrenal crisis." },
      { q:"For refractory hypotension not responding to fluids and an initial push-dose pressor, what is the next general step?", options:["A. Give more crystalloid indefinitely with no other change","B. Escalate to a continuous vasoactive infusion","C. Discontinue all pressor support","D. There is nothing further that can be done"], answer:1, rationale:"When repeated push-dose pressors are needed, transitioning to a titratable continuous infusion provides more stable, sustained support." },
      { q:"A massive pulmonary embolism causing right heart strain may show which ECG pattern?", options:["A. S1Q3T3 pattern","B. Delta waves","C. A shortened PR interval","D. Diffuse ST elevation in all leads"], answer:0, rationale:"S1Q3T3 (S wave in I, Q wave and inverted T wave in III) is a classic, though not universally present, finding suggestive of acute right heart strain from a large PE." }
    ],
    "Airway": [
      { q:"For a hemodynamically unstable patient undergoing RSI, what dual strategy is emphasized alongside reduced induction dosing?", options:["A. Delay intubation entirely until stable","B. Have a push-dose pressor ready as a bridge to hemodynamic support during and after intubation","C. Skip pre-oxygenation to save time","D. Use only paralytics, no sedative"], answer:1, rationale:"Since laryngoscopy and positive pressure ventilation can further drop blood pressure in an unstable patient, having a pressor ready reduces the risk of peri-intubation arrest." },
      { q:"In a difficult/failed airway algorithm, what is the general escalation pathway after failed intubation attempts and a failed rescue supraglottic device?", options:["A. Repeat the same intubation technique indefinitely","B. Proceed to a surgical airway (cricothyrotomy)","C. Give more paralytic and wait","D. Abandon airway management entirely"], answer:1, rationale:"A 'can't intubate, can't oxygenate' scenario after supraglottic rescue fails is the classic indication to move promptly to a surgical airway rather than repeating failed techniques." },
      { q:"What is a relative contraindication to using NIPPV (BiPAP/CPAP)?", options:["A. Mild COPD exacerbation","B. Active vomiting or inability to protect the airway","C. Cardiogenic pulmonary edema","D. Mild hypoxia"], answer:1, rationale:"A mask-based positive pressure system in a vomiting or airway-compromised patient significantly raises the risk of aspiration." },
      { q:"Post-intubation management in critical care transport typically requires which combination for patient comfort and safety?", options:["A. Paralysis alone, no sedation or analgesia needed","B. A combination of analgesia, sedation, and (when indicated) ongoing paralysis","C. Sedation only, paralytics are never continued","D. No medications are needed once intubated"], answer:1, rationale:"An intubated patient still needs pain control and sedation regardless of paralytic use — paralysis alone without adequate sedation risks an awake, paralyzed patient." },
      { q:"Permissive hypercapnia as part of a lung-protective ventilation strategy is generally considered acceptable EXCEPT in which situation?", options:["A. Isolated ARDS with normal ICP","B. Elevated intracranial pressure","C. Simple asthma exacerbation","D. It's never acceptable in any patient"], answer:1, rationale:"Allowing CO2 to rise causes cerebral vasodilation, which is dangerous in a patient with elevated ICP, making permissive hypercapnia inappropriate in that population." },
      { q:"A needle cricothyrotomy with jet ventilation is generally considered what type of intervention compared to a surgical cricothyrotomy?", options:["A. A definitive, long-term airway","B. A temporizing measure, especially useful in small children, until a definitive airway can be secured","C. Interchangeable with a surgical airway with no differences","D. Never used in any age group"], answer:1, rationale:"Needle cric with jet ventilation buys time (typically limited by rising CO2) and is often favored in young children where surgical cricothyrotomy is technically difficult and higher-risk." },
      { q:"A 'shark-fin' capnography waveform pattern is most associated with what condition?", options:["A. Normal ventilation","B. Bronchospasm","C. Esophageal intubation","D. Cardiac arrest with no perfusion"], answer:1, rationale:"The sloped, shark-fin-shaped upstroke reflects delayed, uneven alveolar emptying seen in bronchospasm (asthma/COPD), rather than the normal square-wave capnogram." },
      { q:"Before pushing induction and paralytic agents for RSI, what should already be prepared and immediately available?", options:["A. Nothing extra is needed beyond the drugs themselves","B. A backup rescue airway plan (supraglottic device, surgical airway kit) and suction","C. Only a stethoscope","D. A 12-lead ECG"], answer:1, rationale:"Having rescue equipment ready before committing to paralysis ensures a fast response if the primary intubation attempt fails, rather than scrambling once the patient is already apneic and paralyzed." },
      { q:"What is a known physiologic risk of high PEEP ventilator settings?", options:["A. Increased venous return and hypertension","B. Decreased venous return, potentially causing hypotension, and increased barotrauma risk","C. No physiologic effects outside the lungs","D. Improved cardiac output in all patients"], answer:1, rationale:"High intrathoracic pressure from PEEP can impede venous return to the heart, and excessive pressure raises the risk of lung injury (barotrauma) as well." },
      { q:"The SALAD technique (suction-assisted laryngoscopy and airway decontamination) is especially useful in what scenario?", options:["A. A clear, dry airway with no secretions","B. Massive emesis or hemorrhage obscuring the airway during intubation attempts","C. Routine, uncomplicated intubations only","D. Pediatric airways exclusively"], answer:1, rationale:"SALAD keeps a suction catheter in place continuously alongside the laryngoscope blade, allowing ongoing decontamination of a heavily soiled airway during intubation." },
      { q:"Transitioning a patient from a RAM cannula to a ventilator-driven non-invasive interface (e.g., Revel) is generally done to accomplish what?", options:["A. To stop all respiratory support","B. To provide more consistent, ventilator-driven non-invasive respiratory support during transport","C. To immediately intubate the patient","D. It's purely a cosmetic/comfort change with no clinical purpose"], answer:1, rationale:"Moving to a ventilator-integrated NIV interface allows more precise, monitored pressure/flow support than a simple high-flow cannula alone." }
    ],
    "Procedures": [
      { q:"REBOA (resuscitative endovascular balloon occlusion of the aorta) works by doing what?", options:["A. Delivering medication directly into the aorta","B. Temporarily occluding aortic blood flow to control hemorrhage below the balloon and support proximal perfusion","C. Cooling the blood for therapeutic hypothermia","D. Measuring cardiac output"], answer:1, rationale:"Inflating the balloon in the aorta stops flow distal to it, temporarily controlling non-compressible torso hemorrhage while redirecting flow to the heart and brain." },
      { q:"An intra-aortic balloon pump (IABP) is timed to do what during the cardiac cycle?", options:["A. Inflate during systole, deflate during diastole","B. Inflate during diastole, deflate just before systole","C. Inflate and deflate randomly","D. It doesn't need to be timed to the cardiac cycle"], answer:1, rationale:"Diastolic inflation augments coronary perfusion, while deflation just before systole reduces afterload, together improving myocardial oxygen supply/demand balance." },
      { q:"Pericardiocentesis is indicated for which clinical picture?", options:["A. Simple pericarditis with no hemodynamic compromise","B. Cardiac tamponade with hemodynamic instability","C. Any chest pain patient","D. Isolated pneumothorax"], answer:1, rationale:"The procedure is reserved for situations where pericardial fluid is causing clinically significant compromise (tamponade physiology), given its inherent risks." },
      { q:"Transvenous pacing is generally reserved for which situation?", options:["A. First-line treatment for any bradycardia","B. Symptomatic bradycardia refractory to atropine, transcutaneous pacing, and pressors","C. Stable sinus rhythm","D. Routine prophylactic use in all cardiac patients"], answer:1, rationale:"It's a more invasive, definitive option used when less invasive measures (drugs, external pacing) have failed to resolve symptomatic bradycardia." },
      { q:"An Impella device functions as what type of support?", options:["A. A right-sided-only support device","B. A percutaneous left ventricular assist device for cardiogenic shock","C. An external defibrillator","D. A ventilator"], answer:1, rationale:"Impella is a catheter-based pump that unloads the left ventricle and augments forward flow, used in severe cardiogenic shock or high-risk procedures." },
      { q:"Focused ultrasound (eFAST) exam in trauma is primarily used to identify what?", options:["A. Blood glucose levels","B. Free intraperitoneal/pericardial fluid and pneumothorax","C. Bone fractures with high sensitivity","D. Airway patency"], answer:1, rationale:"eFAST rapidly screens for free fluid (suggesting hemorrhage) in the abdomen/pericardium and can also detect pneumothorax via lung sliding assessment." },
      { q:"A percutaneous pigtail catheter compared to a traditional large-bore chest tube is generally chosen for what reason?", options:["A. It's more invasive and painful","B. It's a smaller, less invasive option often adequate for simple pneumothorax or effusion","C. It cannot drain air, only fluid","D. It requires general anesthesia to place"], answer:1, rationale:"Pigtail catheters use a smaller Seldinger-technique insertion and can be effective for many pneumothorax/effusion cases with less tissue trauma than a traditional tube." },
      { q:"In a patient with an LVAD (left ventricular assist device) who becomes unresponsive with no palpable pulse, what is a key consideration?", options:["A. Immediately begin standard chest compressions in every case without further assessment","B. Assess device function and perfusion (e.g., via Doppler/MAP) before assuming cardiac arrest, per device-specific protocols","C. LVAD patients cannot go into cardiac arrest","D. Compressions are always contraindicated regardless of findings"], answer:1, rationale:"Because continuous-flow LVADs often produce no palpable pulse even when perfusing normally, assessing device alarms/function and perfusion first (per device-specific guidance) avoids inappropriate compressions on a working device, while recognizing true device failure requires immediate action." },
      { q:"Chest escharotomy incisions are planned along specific anatomic lines primarily to avoid what?", options:["A. Making the burn look worse cosmetically","B. Injury to underlying neurovascular structures","C. There are no specific anatomic considerations","D. The incision lines don't matter at all"], answer:1, rationale:"Following established anatomic landmarks for escharotomy incisions minimizes the risk of damaging nerves and vessels that run in predictable locations." },
      { q:"Field termination of resuscitation is generally considered after what circumstance in adult medical cardiac arrest?", options:["A. After just 2 minutes of CPR with no other criteria","B. Continued asystole/no ROSC despite adequate ALS care and no reversible cause identified, per local protocol criteria","C. Termination is never appropriate in the field","D. Only if the patient specifically requested it in advance, regardless of clinical picture"], answer:1, rationale:"Termination of resuscitation protocols generally require a defined period of appropriate ALS care with no ROSC and no identified reversible cause, following local medical direction criteria — it's a clinical decision, not an arbitrary time cutoff." },
      { q:"Before relying on an invasive arterial line's blood pressure readings, what step must be performed to ensure accuracy?", options:["A. No setup is required, the numbers are always accurate","B. Zeroing (leveling) the transducer to the phlebostatic axis","C. Removing the line and reinserting it every hour","D. Calibrating it against the patient's weight"], answer:1, rationale:"Leveling and zeroing the transducer at the phlebostatic axis (roughly the level of the right atrium) corrects for hydrostatic pressure differences and patient positioning, without which the displayed pressure can be significantly inaccurate." }
    ],
    "Drug Calculation": [
      { q:"A reduced RSI induction dose of ketamine (0.5 mg/kg) is ordered for an 80 kg unstable patient. On hand: 100 mg/mL. How many mL do you give?", options:["A. 0.2 mL","B. 0.4 mL","C. 4 mL","D. 8 mL"], answer:1, rationale:"0.5 mg/kg × 80 kg = 40 mg. 40 mg ÷ 100 mg/mL = 0.4 mL." },
      { q:"An amiodarone infusion is mixed as 450 mg in 250 mL. Ordered rate: 1 mg/min. What is the approximate mL/hr rate?", options:["A. 10 mL/hr","B. 33 mL/hr","C. 66 mL/hr","D. 100 mL/hr"], answer:1, rationale:"Concentration = 450 mg ÷ 250 mL = 1.8 mg/mL. 1 mg/min × 60 = 60 mg/hr. 60 mg/hr ÷ 1.8 mg/mL ≈ 33 mL/hr." },
      { q:"Fentanyl is ordered at 1.5 mcg/kg for a 70 kg patient. On hand: 50 mcg/mL. How many mL do you give?", options:["A. 1 mL","B. 1.5 mL","C. 2.1 mL","D. 3 mL"], answer:2, rationale:"1.5 mcg/kg × 70 kg = 105 mcg. 105 mcg ÷ 50 mcg/mL = 2.1 mL." },
      { q:"Push-dose epinephrine is mixed to 10 mcg/mL. An order calls for 15 mcg. How many mL do you give?", options:["A. 0.5 mL","B. 1 mL","C. 1.5 mL","D. 2 mL"], answer:2, rationale:"15 mcg ÷ 10 mcg/mL = 1.5 mL." },
      { q:"Rocuronium 1.5 mg/kg is ordered for a 90 kg patient. On hand: 10 mg/mL. How many mL do you give?", options:["A. 9 mL","B. 10.5 mL","C. 13.5 mL","D. 15 mL"], answer:2, rationale:"1.5 mg/kg × 90 kg = 135 mg. 135 mg ÷ 10 mg/mL = 13.5 mL." },
      { q:"A 15 kg child in cardiac arrest needs epinephrine 0.01 mg/kg from a 1:10,000 (0.1 mg/mL) concentration. How many mL do you give?", options:["A. 0.5 mL","B. 1.5 mL","C. 3 mL","D. 15 mL"], answer:1, rationale:"0.01 mg/kg × 15 kg = 0.15 mg. 0.15 mg ÷ 0.1 mg/mL = 1.5 mL." },
      { q:"A dopamine infusion is mixed as 400 mg in 250 mL. Ordered dose: 5 mcg/kg/min for a 70 kg patient. Approximately what mL/hr rate is needed?", options:["A. 5 mL/hr","B. 13 mL/hr","C. 21 mL/hr","D. 35 mL/hr"], answer:1, rationale:"Concentration = 400,000 mcg ÷ 250 mL = 1600 mcg/mL. Dose = 5 × 70 = 350 mcg/min × 60 = 21,000 mcg/hr. 21,000 ÷ 1600 ≈ 13 mL/hr." },
      { q:"An eclampsia patient needs a 4 gram magnesium sulfate loading dose. On hand: 500 mg/mL (50%). How many mL do you give?", options:["A. 2 mL","B. 4 mL","C. 8 mL","D. 16 mL"], answer:2, rationale:"4 g = 4000 mg. 4000 mg ÷ 500 mg/mL = 8 mL." },
      { q:"A reduced etomidate dose (0.15 mg/kg) is ordered for a 100 kg hemodynamically unstable patient. On hand: 2 mg/mL. How many mL do you give?", options:["A. 3 mL","B. 5 mL","C. 7.5 mL","D. 15 mL"], answer:2, rationale:"0.15 mg/kg × 100 kg = 15 mg. 15 mg ÷ 2 mg/mL = 7.5 mL." },
      { q:"Succinylcholine 1.5 mg/kg is ordered for a 60 kg patient. On hand: 20 mg/mL. How many mL do you give?", options:["A. 3 mL","B. 4.5 mL","C. 6 mL","D. 9 mL"], answer:1, rationale:"1.5 mg/kg × 60 kg = 90 mg. 90 mg ÷ 20 mg/mL = 4.5 mL." },
      { q:"A 20 kg child needs calcium gluconate at 25 mg/kg. On hand: 100 mg/mL. How many mL do you give?", options:["A. 2 mL","B. 5 mL","C. 10 mL","D. 20 mL"], answer:1, rationale:"25 mg/kg × 20 kg = 500 mg. 500 mg ÷ 100 mg/mL = 5 mL." }
    ]
  },
  hard: {
    "Trauma": [
      { q:"In a patient with hemorrhagic shock refractory to massive transfusion, ongoing coagulopathy is most likely driven by which mechanism?", options:["A. Dilutional coagulopathy from crystalloid alone","B. Acute traumatic coagulopathy from tissue hypoperfusion and protein C activation","C. Isolated Vitamin K deficiency","D. Pre-existing hereditary factor VIII deficiency"], answer:1, rationale:"Severe tissue injury and hypoperfusion activate protein C, which both promotes fibrinolysis and inhibits clotting factors — a distinct process from simple dilution, and one that balanced transfusion and TXA specifically target." },
      { q:"In a TBI patient showing signs of active herniation (blown pupil, Cushing's triad), brief hyperventilation is best understood as what?", options:["A. A permanent management strategy for all TBI patients","B. A temporizing bridge measure (EtCO2 ~30–35) used only for acute herniation signs, not routine practice","C. Strictly contraindicated in every circumstance","D. The definitive treatment replacing the need for neurosurgery"], answer:1, rationale:"Reserved for acute deterioration, brief hyperventilation can transiently lower ICP via cerebral vasoconstriction, but it's a temporizing bridge — not routine management — given the ischemia risk if sustained." },
      { q:"Massive transfusion protocol activation is often guided by which type of scoring tool in trauma?", options:["A. Glasgow Coma Scale alone","B. Assessment of Blood Consumption (ABC) score or shock index","C. APGAR score","D. RACE stroke scale"], answer:1, rationale:"Tools like the ABC score use readily available field/ED data (mechanism, shock index, FAST result) to predict the need for massive transfusion before formal lab-based triggers are available." },
      { q:"Resuscitative thoracotomy in traumatic arrest is generally most indicated for which scenario?", options:["A. Blunt trauma arrest with prolonged downtime and no signs of life","B. Penetrating thoracic trauma with recent (witnessed) loss of vital signs","C. Any cardiac arrest regardless of mechanism","D. Isolated extremity trauma"], answer:1, rationale:"Outcomes are dramatically better in penetrating thoracic injury with recent signs of life, since a reversible surgical cause (tamponade, isolated cardiac injury) is far more likely than in blunt arrest." },
      { q:"Primary blast lung injury is caused by what mechanism?", options:["A. Direct penetrating shrapnel only","B. The blast overpressure wave causing diffuse alveolar/capillary injury","C. Thermal burns from the explosion","D. Blunt impact against a solid structure"], answer:1, rationale:"The overpressure wave itself, independent of fragments or burns, can cause pulmonary contusion, hemorrhage, and air embolism — a distinct injury pattern requiring cautious ventilator management." },
      { q:"Rising peak airway pressures, a distended abdomen, and falling urine output in a resuscitated trauma patient should raise concern for what?", options:["A. Simple ileus, no action needed","B. Abdominal compartment syndrome","C. Normal post-resuscitation physiology","D. Pneumonia"], answer:1, rationale:"Elevated intra-abdominal pressure can impair ventilation, renal perfusion, and venous return — recognizing this pattern prompts urgent surgical/decompression consideration." },
      { q:"'Damage control resuscitation' is designed specifically to avoid which combination, known as the lethal triad?", options:["A. Hypertension, tachycardia, and fever","B. Hypothermia, acidosis, and coagulopathy","C. Hyperglycemia, hypokalemia, and alkalosis","D. Bradycardia, hypoxia, and hypernatremia"], answer:1, rationale:"Each of these three problems worsens the others in a vicious cycle; damage control resuscitation (balanced blood products, permissive hypotension, rapid hemorrhage control) is built around interrupting that cycle early." },
      { q:"Why might REBOA Zone 1 occlusion be time-limited in practice despite controlling hemorrhage effectively?", options:["A. It has no time limitation","B. Prolonged occlusion risks significant distal ischemia to abdominal organs and lower extremities","C. It only works for 30 seconds total","D. It causes immediate cardiac arrest if left inflated"], answer:1, rationale:"Because Zone 1 occlusion cuts off blood flow to everything below it, teams must balance hemorrhage control against the mounting ischemic burden the longer the balloon stays inflated." }
    ],
    "OB": [
      { q:"Management of an amniotic fluid embolism is primarily what type of approach?", options:["A. A single specific antidote reverses it completely","B. Largely supportive — treating it as an evolving DIC/ARDS/cardiogenic shock picture","C. No treatment exists or is attempted","D. Immediate discharge home is appropriate once stable"], answer:1, rationale:"Because there's no specific reversal agent, care focuses on aggressive supportive management of the cardiovascular collapse, coagulopathy, and respiratory failure that can rapidly follow." },
      { q:"During a trial of labor after cesarean (TOLAC/VBAC attempt), sudden severe abdominal pain, loss of fetal station, and fetal bradycardia suggest what?", options:["A. Normal labor progression","B. Uterine rupture","C. A simple round ligament strain","D. Braxton-Hicks contractions"], answer:1, rationale:"This combination is a classic (though not universal) presentation of uterine rupture along a prior cesarean scar — a true obstetric emergency requiring immediate transport and surgical readiness." },
      { q:"Peripartum cardiomyopathy typically presents with symptoms of what, occurring late in pregnancy or in the months after delivery?", options:["A. Simple anxiety with no physical findings","B. Heart failure (dyspnea, edema, orthopnea)","C. Isolated skin rash","D. Painless vaginal bleeding"], answer:1, rationale:"A new-onset cardiomyopathy in this specific timeframe should be distinguished from more common causes of dyspnea in pregnancy (like normal physiologic changes) given its significant morbidity/mortality." },
      { q:"HELLP syndrome carries a risk of which serious hepatic complication?", options:["A. Fatty liver of pregnancy exclusively, unrelated to HELLP","B. Subcapsular hepatic hematoma or liver rupture","C. Hepatitis A infection","D. Gallstone formation only"], answer:1, rationale:"The hepatic involvement in severe HELLP can progress to a subcapsular hematoma, which carries a risk of rupture and life-threatening intra-abdominal hemorrhage." },
      { q:"In severe magnesium toxicity progressing beyond loss of reflexes, what is the expected sequence of deterioration if untreated?", options:["A. Immediate cardiac arrest with no warning signs","B. Respiratory depression, followed by cardiac conduction abnormalities and arrest","C. Magnesium toxicity only affects blood pressure, nothing else","D. Symptoms resolve spontaneously without intervention"], answer:1, rationale:"Progressive magnesium elevation affects neuromuscular transmission broadly — reflexes are lost first, then respiratory drive is depressed, and finally cardiac conduction is affected, which is why calcium gluconate should be readily available whenever magnesium infusions are running." },
      { q:"A major risk factor for placenta accreta spectrum (with associated massive postpartum hemorrhage risk) is which of the following?", options:["A. First pregnancy with no prior surgery","B. Prior cesarean delivery, especially with a co-existing placenta previa","C. Advanced maternal age alone with no other risk factors","D. Twin gestation with no other risk factors"], answer:1, rationale:"Placental tissue can abnormally invade a prior uterine scar, and this risk climbs further when previa is also present — a combination transport teams should flag early to the receiving facility." },
      { q:"Variable decelerations on fetal heart monitoring are most classically associated with what underlying cause?", options:["A. Uteroplacental insufficiency","B. Umbilical cord compression","C. Fetal head compression only","D. Maternal fever"], answer:1, rationale:"Variable decelerations have an abrupt, variable-shaped onset/offset reflecting transient cord compression, distinct from the gradual, contraction-linked pattern of late decelerations from placental insufficiency." },
      { q:"Per current management principles for uterine inversion, which combination reflects best practice?", options:["A. Remove the placenta first, then give oxytocin, then attempt replacement","B. Do not remove an attached placenta, stop uterotonics, consider TXA for hemorrhage, and attempt manual replacement if trained/appropriate","C. Apply firm cord traction to complete delivery of the placenta first","D. Delay any intervention until arrival at the receiving facility"], answer:1, rationale:"This sequence avoids worsening hemorrhage (leaving the placenta attached, stopping contraction-promoting drugs) while still addressing both the mechanical problem and the resulting blood loss." }
    ],
    "Pediatric": [
      { q:"Pediatric septic shock that remains hypotensive despite adequate fluid resuscitation and is unresponsive to catecholamines is termed what, and what adjunct may be considered?", options:["A. 'Warm shock' with no further treatment options","B. Catecholamine-resistant shock, where stress-dose hydrocortisone may be considered","C. This scenario doesn't occur in pediatrics","D. Immediate discontinuation of all pressors"], answer:1, rationale:"When shock persists despite fluids and escalating vasoactive support, an occult adrenal insufficiency component is considered, and stress-dose steroids may be trialed per protocol/medical control guidance." },
      { q:"Which injury pattern combination should raise strong suspicion for abusive head trauma in an infant?", options:["A. A single, well-explained bruise consistent with the reported mechanism","B. Retinal hemorrhages with subdural hematoma and an inconsistent or absent history of trauma","C. A clearly witnessed accidental fall with matching injury pattern","D. Normal neurologic exam with no imaging findings"], answer:1, rationale:"This specific combination, especially with a history that doesn't match the severity of injury, is a well-recognized red flag pattern requiring mandatory reporting and further evaluation." },
      { q:"A neonate with a ductal-dependent congenital heart lesion may require which infusion to maintain systemic or pulmonary perfusion during transport?", options:["A. Furosemide","B. Prostaglandin E1 (PGE1)","C. Albuterol","D. Insulin"], answer:1, rationale:"PGE1 keeps the ductus arteriosus open, which can be lifesaving in lesions where systemic or pulmonary blood flow depends on that shunt remaining patent until surgical correction." },
      { q:"Why does pediatric drowning resuscitation traditionally emphasize early rescue breaths rather than a compressions-first approach?", options:["A. Chest compressions are never indicated in drowning","B. The arrest is primarily driven by hypoxia/asphyxia rather than a primary cardiac event","C. Rescue breathing has been proven ineffective in drowning","D. There is no meaningful difference in approach"], answer:1, rationale:"Because the underlying problem is oxygen deprivation rather than a primary arrhythmia, restoring oxygenation/ventilation early is considered especially important in this specific arrest etiology." },
      { q:"In persistent pulmonary hypertension of the newborn (PPHN), what finding helps differentiate it from cyanotic congenital heart disease?", options:["A. A pre-ductal/post-ductal SpO2 gradient greater than about 10%","B. A single loud S2 with no other findings","C. Bounding femoral pulses","D. Hepatomegaly alone"], answer:0, rationale:"A significant saturation gradient between pre-ductal (right hand) and post-ductal (either foot) sites suggests right-to-left ductal shunting from elevated pulmonary pressures, rather than a fixed structural cardiac defect." },
      { q:"In pediatric DKA, which combination of findings should raise concern for evolving cerebral edema?", options:["A. Improving mental status and normal vital signs","B. Headache, altered mental status, and bradycardia with hypertension","C. Mild thirst with normal urine output","D. Resolution of Kussmaul respirations alone"], answer:1, rationale:"This pattern mirrors a Cushing's-triad-like response to rising intracranial pressure and is a feared, potentially fatal complication of pediatric DKA treatment, particularly with overly rapid fluid/osmolar shifts." },
      { q:"What is a key limitation to consider when relying solely on a Broselow tape for critical medication dosing in an obese or edematous child?", options:["A. The tape is always accurate regardless of body habitus","B. Length-based estimates can significantly under- or overestimate actual weight, risking dosing errors","C. The Broselow tape measures weight directly, not length","D. This limitation only applies to newborns"], answer:1, rationale:"Because the tape assumes a typical weight-for-length relationship, a child whose body composition differs significantly from that assumption can receive doses that don't match their actual weight, so a known weight (when available) should be used instead." }
    ],
    "Drug Formulary": [
      { q:"What was the primary evidence-based rationale for removing vasopressin from the adult cardiac arrest algorithm?", options:["A. It caused more cardiac arrests when used","B. Comparative studies showed no added survival or neurologic benefit over epinephrine alone","C. It was replaced because it is more expensive than epinephrine","D. It was never actually part of any algorithm"], answer:1, rationale:"Simplifying the algorithm around epinephrine alone was supported by trial data showing the vasopressin/epinephrine combination didn't outperform epinephrine by itself." },
      { q:"Based on trial data behind current TXA use, what happens to its benefit/risk profile when given beyond the 3-hour post-injury window?", options:["A. Benefit remains identical no matter when it's given","B. Benefit diminishes, and there is evidence of potential harm with later administration","C. TXA becomes more effective the later it's given","D. There is no time-dependent effect at all"], answer:1, rationale:"This time-sensitivity is central to why TXA protocols emphasize early administration and often specify a hard cutoff beyond which it's no longer recommended." },
      { q:"In current ACLS guidance for refractory VF/pulseless VT, how do amiodarone and lidocaine generally compare?", options:["A. Lidocaine is clearly superior and preferred in all cases","B. Both are considered acceptable options, without clear proven superiority of one over the other","C. Amiodarone is no longer recommended at all","D. Neither drug has any role in cardiac arrest"], answer:1, rationale:"Trial data comparing the two antiarrhythmics in cardiac arrest have not shown a clear survival advantage of one over the other, so either remains an acceptable choice per current guidelines." },
      { q:"Beyond burns and crush injury, which additional patient population carries an increased hyperkalemia risk with succinylcholine?", options:["A. Patients with well-controlled diabetes only","B. Patients with neuromuscular disease or prolonged immobility (upregulated extrajunctional receptors)","C. Healthy young trauma patients with no comorbidities","D. Patients on daily aspirin therapy"], answer:1, rationale:"Conditions causing denervation or disuse of muscle (neuromuscular disease, prolonged bed rest/immobility) increase extrajunctional acetylcholine receptors, raising the same hyperkalemic risk seen in burns/crush injury." },
      { q:"Why might phenylephrine (a pure alpha-1 agonist) be a less ideal push-dose pressor choice in cardiogenic shock specifically?", options:["A. It has no vasoconstrictive effect at all","B. Its pure afterload-increasing effect with no inotropic support can further strain a failing heart","C. It's not compatible with any IV line","D. It's actually the preferred first-line agent in cardiogenic shock"], answer:1, rationale:"Raising afterload without providing any inotropic (contractility) support can worsen forward flow in a heart that's already struggling to pump against resistance." },
      { q:"How has thinking on ketamine use in traumatic brain injury evolved over recent years?", options:["A. It has always been considered completely safe with no controversy","B. Older concerns about ICP elevation have been reconsidered, with current evidence suggesting it's a reasonable option when ventilation is controlled","C. Ketamine is now absolutely contraindicated in all TBI","D. Ketamine has never been studied in TBI patients"], answer:1, rationale:"Contemporary studies have challenged the older assumption that ketamine dangerously raises ICP, and it's increasingly used in TBI patients, particularly when ventilation/oxygenation are well managed alongside it." },
      { q:"What is a key advantage of dexmedetomidine as a sedative in a mechanically ventilated patient, along with an important caution?", options:["A. It provides deep sedation with significant respiratory depression, no cautions needed","B. It provides sedation with relatively preserved respiratory drive, but can cause bradycardia and hypotension","C. It has no cardiovascular effects whatsoever","D. It is a paralytic agent, not a sedative"], answer:1, rationale:"Its relative sparing of respiratory drive is attractive for some ventilated/spontaneously breathing patients, but its sympatholytic effect can produce clinically significant bradycardia and hypotension, especially with bolus dosing." },
      { q:"Octreotide's mechanism in treating sulfonylurea-induced hypoglycemia works by doing what?", options:["A. Directly raising blood glucose through gluconeogenesis","B. Inhibiting pancreatic insulin secretion, breaking the cycle of sulfonylurea-driven insulin release","C. Increasing renal glucose reabsorption","D. Blocking glucose uptake into cells"], answer:1, rationale:"By suppressing further insulin release from the pancreas, octreotide addresses the underlying driver of recurrent hypoglycemia rather than just treating the low glucose reactively with repeated dextrose." }
    ],
    "Medical": [
      { q:"Per Surviving Sepsis Campaign principles, what is generally the first-line vasopressor for septic shock once fluid resuscitation is inadequate?", options:["A. Phenylephrine","B. Norepinephrine","C. Dopamine","D. Vasopressin as a first-line single agent"], answer:1, rationale:"Norepinephrine's combined alpha and modest beta effects support blood pressure and cardiac output with a more favorable arrhythmia profile than agents like dopamine, making it the preferred first-line agent." },
      { q:"In a massive PE with hemodynamic instability, what treatment may be considered during transport if within protocol and appropriate?", options:["A. Anticoagulation alone is always sufficient","B. Systemic thrombolytics","C. Aspirin only","D. No treatment is ever appropriate en route"], answer:1, rationale:"In a hemodynamically unstable ('massive') PE, the risk of imminent cardiovascular collapse can justify thrombolytic therapy per protocol/medical control, weighing the significant bleeding risk against the mortality risk of the PE itself." },
      { q:"Dual sequential defibrillation is a strategy considered for what specific situation?", options:["A. Routine first-shock V-fib","B. Refractory V-fib that hasn't responded to standard defibrillation and antiarrhythmics","C. Any bradycardia","D. Stable narrow-complex tachycardia"], answer:1, rationale:"This involves near-simultaneous shocks from two defibrillators at different vectors, considered as a rescue strategy for truly refractory VF after standard therapy has failed." },
      { q:"In severe hyperkalemia with a widened QRS, what is the mechanism by which sodium bicarbonate helps, despite not directly lowering serum potassium?", options:["A. It binds potassium directly and removes it from the body","B. It raises extracellular sodium/pH, which can help stabilize the cardiac membrane and shift potassium intracellularly","C. It has no proposed mechanism, it's used empirically with no rationale","D. It works by directly increasing renal potassium excretion within minutes"], answer:1, rationale:"Alkalinization can promote an intracellular potassium shift and, along with the sodium load, helps counteract the membrane effects of hyperkalemia, though calcium remains the more immediate membrane stabilizer." },
      { q:"Thyroid storm should be suspected in a patient presenting with which combination of findings, often triggered by an acute illness or stressor?", options:["A. Hypothermia, bradycardia, and lethargy","B. Hyperthermia, marked tachycardia, and altered mental status","C. Normal vital signs with mild anxiety","D. Isolated hypotension with no other findings"], answer:1, rationale:"This hypermetabolic crisis presents with dramatic vital sign abnormalities and can rapidly progress to cardiovascular collapse if unrecognized and untreated." },
      { q:"During transport of a suspected aortic dissection, what are general target ranges for heart rate and systolic blood pressure once treatment is initiated?", options:["A. HR >100, SBP >160 (no specific targets needed)","B. HR less than about 60 and SBP around 100–120 mmHg, achieved via beta-blockade before any vasodilator","C. HR and BP should not be treated at all during transport","D. Only diastolic pressure matters, systolic is irrelevant"], answer:1, rationale:"Controlling both heart rate and blood pressure reduces aortic wall shear stress; beta-blockade is prioritized first specifically to prevent the reflex tachycardia a vasodilator alone would trigger." },
      { q:"In DKA, why is bicarbonate generally avoided except in extreme, life-threatening acidosis?", options:["A. Bicarbonate has no risks and should always be given","B. It can worsen intracellular acidosis, shift the oxyhemoglobin curve unfavorably, and hasn't shown outcome benefit in most cases","C. Bicarbonate is the definitive treatment for DKA and should be given first","D. It directly treats the underlying insulin deficiency"], answer:1, rationale:"Correcting the underlying process with fluids and insulin resolves the acidosis physiologically; empiric bicarbonate carries theoretical and demonstrated risks without clear benefit in most DKA presentations." },
      { q:"The RACE (Rapid Arterial oCclusion Evaluation) stroke scale is specifically designed to help identify what?", options:["A. Any stroke, with no distinction in severity or type","B. Large vessel occlusion strokes that may benefit from mechanical thrombectomy","C. Only hemorrhagic strokes","D. Seizure activity, not stroke"], answer:1, rationale:"By weighting findings associated with large vessel involvement (gaze deviation, severe motor deficits), RACE helps triage patients toward thrombectomy-capable centers rather than a closer, non-capable facility when transport time allows." }
    ],
    "Airway": [
      { q:"An awake fiberoptic or video-assisted intubation approach is generally chosen in anticipated difficult airways specifically to preserve what?", options:["A. Nothing important, it's purely a training exercise","B. The patient's spontaneous ventilation and airway reflexes until the airway is secured","C. The need for any sedation at all","D. This technique is never used in the anticipated difficult airway"], answer:1, rationale:"By keeping the patient breathing on their own throughout, this approach avoids the 'can't intubate, can't oxygenate' scenario that paralysis could otherwise precipitate in a known difficult airway." },
      { q:"What is the physiologic rationale behind prone positioning in severe ARDS?", options:["A. It has no physiologic effect, it's purely for pressure ulcer prevention","B. It improves ventilation-perfusion matching and recruits dependent (dorsal) lung regions","C. It decreases oxygenation intentionally to reduce oxygen toxicity","D. It's used only to make suctioning easier"], answer:1, rationale:"In the supine position, dorsal lung regions are often collapsed/atelectatic; proning redistributes ventilation and improves matching with perfusion, often significantly improving oxygenation in severe ARDS." },
      { q:"High-flow nasal cannula/humidified high-flow systems can support oxygenation during an apneic period partly through what mechanism?", options:["A. They provide no benefit during apnea","B. Apneic oxygenation via continuous flow maintaining oxygen delivery to the alveoli even without active ventilation","C. They actively ventilate the patient with tidal volumes","D. They only work if the patient is actively breathing"], answer:1, rationale:"Continuous high flow of oxygen can passively maintain alveolar oxygen levels for a period even without active breaths, which is why these systems are often used to extend safe apnea time during intubation attempts." },
      { q:"Why is permissive hypercapnia specifically avoided in a patient with elevated intracranial pressure?", options:["A. It has no relationship to intracranial pressure","B. Rising CO2 causes cerebral vasodilation, which can further increase ICP","C. It always lowers ICP, making it beneficial","D. CO2 has no effect on cerebral blood vessels"], answer:1, rationale:"Because CO2 is a potent cerebral vasodilator, allowing it to rise as part of a lung-protective strategy would work directly against the goal of controlling intracranial pressure." },
      { q:"Lung isolation (e.g., a double-lumen tube) is considered in the setting of massive hemoptysis primarily to accomplish what?", options:["A. Increase blood flow to the bleeding lung","B. Protect the non-bleeding (healthy) lung from being flooded with blood from the bleeding side","C. It has no specific purpose in this scenario","D. Replace the need for any other intervention"], answer:1, rationale:"Isolating each lung's ventilation allows the healthy lung to be protected and adequately ventilated while the bleeding side is managed, preventing asphyxiation from blood filling both lungs." },
      { q:"Laryngospasm during airway manipulation is initially managed with which maneuver before escalating to pharmacologic treatment?", options:["A. Immediate surgical airway in every case","B. Positive pressure with a jaw-thrust (Larson's maneuver) and deepening sedation","C. Withholding all oxygen until it resolves spontaneously","D. Rapid extubation if already intubated"], answer:1, rationale:"Firm anterior pressure at the 'laryngospasm notch' combined with positive pressure ventilation and deeper sedation often breaks a laryngospasm before a paralytic is needed as a last resort." },
      { q:"Auto-PEEP (breath stacking) in a ventilated obstructive lung disease patient can lead to what dangerous consequence if not recognized?", options:["A. Improved venous return and blood pressure","B. Progressive hyperinflation causing hypotension and barotrauma from inadequate exhalation time","C. No clinically significant effects","D. Immediate resolution of bronchospasm"], answer:1, rationale:"When exhalation time is too short relative to the disease's slower emptying, air trapping builds breath-over-breath, raising intrathoracic pressure enough to impair venous return and risk lung injury — managed with permissive hypercapnia, slower rates, and adequate expiratory time." }
    ],
    "Procedures": [
      { q:"A major potential complication of prolonged REBOA Zone 1 occlusion is what?", options:["A. Improved distal limb perfusion","B. Distal ischemia to abdominal organs and lower extremities","C. Immediate resolution of all coagulopathy","D. No significant complications are associated with REBOA"], answer:1, rationale:"Because Zone 1 occlusion stops all flow below it, the ischemic burden accumulates the longer the balloon remains inflated, requiring careful time-limited use and planning for surgical hemorrhage control." },
      { q:"Which complication is a recognized risk specifically associated with intra-aortic balloon pump (IABP) therapy?", options:["A. Improved renal perfusion with no risks","B. Limb ischemia, balloon rupture, or aortic injury","C. IABP carries no procedural risks","D. Hypertension as the primary complication"], answer:1, rationale:"Because the balloon and catheter sit within the aorta and often access via a femoral artery, distal limb ischemia and vascular/aortic injury are recognized risks requiring vigilant monitoring." },
      { q:"A significant contraindication to Impella placement includes which of the following?", options:["A. Cardiogenic shock, which is the primary indication","B. Significant aortic regurgitation or an LV thrombus","C. Normal ejection fraction","D. There are no contraindications to Impella use"], answer:1, rationale:"Significant aortic regurgitation compromises the device's ability to function properly across the valve, and an LV thrombus risks catastrophic embolization if disrupted by the device." },
      { q:"A recognized risk during pericardiocentesis is injury to which structure?", options:["A. The gallbladder","B. A coronary artery or the ventricular wall itself","C. The trachea","D. The spleen exclusively"], answer:1, rationale:"Because the needle passes near the heart itself, inadvertent laceration of a coronary vessel or puncture of the ventricle are recognized, serious risks of the procedure." },
      { q:"In an LVAD patient without a palpable pulse, why might a standard blood pressure cuff/palpation fail to assess perfusion accurately?", options:["A. LVAD patients always have a normal palpable pulse","B. Continuous-flow LVADs often produce minimal pulsatility, requiring a Doppler-obtained MAP instead","C. Blood pressure cannot be measured in LVAD patients under any circumstances","D. LVAD patients have no blood pressure at all"], answer:1, rationale:"Because many LVADs provide continuous rather than pulsatile flow, a Doppler signal and calculated MAP is often used as the practical way to assess adequacy of perfusion instead of a traditional pulse-based cuff reading." },
      { q:"Why must chest escharotomy incisions follow specific anatomic lines rather than being placed arbitrarily?", options:["A. Anatomic placement has no real importance","B. To avoid injury to underlying neurovascular structures that run in predictable locations","C. It's purely for a better cosmetic outcome","D. Random placement is equally effective and simpler"], answer:1, rationale:"Following established landmarks minimizes the risk of damaging nerves and vessels while still achieving the goal of relieving the constrictive eschar." },
      { q:"Correct transvenous pacemaker lead positioning is typically confirmed at which location?", options:["A. The right atrial appendage only, regardless of capture","B. The right ventricular apex, confirmed by capture and appropriate paced morphology","C. The pulmonary artery","D. The left ventricle directly"], answer:1, rationale:"RV apex placement, confirmed by consistent electrical/mechanical capture and an appropriate paced QRS morphology, is the standard target for reliable transvenous pacing." }
    ],
    "Drug Calculation": [
      { q:"A norepinephrine infusion is mixed as 4 mg in 250 mL. Ordered dose: 0.1 mcg/kg/min for an 80 kg patient. What is the approximate mL/hr rate?", options:["A. 8 mL/hr","B. 15 mL/hr","C. 30 mL/hr","D. 48 mL/hr"], answer:2, rationale:"Concentration = 4,000,000 mcg... more simply: 4 mg = 4000 mcg ÷ 250 mL = 16 mcg/mL. Dose = 0.1 × 80 = 8 mcg/min × 60 = 480 mcg/hr. 480 ÷ 16 = 30 mL/hr." },
      { q:"A nicardipine drip is mixed as 25 mg in 250 mL (100 mcg/mL). Ordered rate: 5 mg/hr. What is the mL/hr rate?", options:["A. 5 mL/hr","B. 25 mL/hr","C. 50 mL/hr","D. 100 mL/hr"], answer:2, rationale:"5 mg/hr = 5000 mcg/hr. 5000 mcg/hr ÷ 100 mcg/mL = 50 mL/hr." },
      { q:"A fentanyl infusion is mixed as 2500 mcg in 250 mL (10 mcg/mL). Ordered rate: 50 mcg/hr. What is the mL/hr rate?", options:["A. 2.5 mL/hr","B. 5 mL/hr","C. 10 mL/hr","D. 25 mL/hr"], answer:1, rationale:"50 mcg/hr ÷ 10 mcg/mL = 5 mL/hr." },
      { q:"Push-dose epinephrine is self-mixed from a 1 mg/10 mL (1:10,000) cardiac amp diluted into a 10 mL flush (drawing up 1 mL of the amp into 9 mL of flush). What is the resulting concentration, and how many mL deliver a 10 mcg dose?", options:["A. 100 mcg/mL concentration; 0.1 mL for 10 mcg","B. 10 mcg/mL concentration; 1 mL for 10 mcg","C. 1 mcg/mL concentration; 10 mL for 10 mcg","D. 1000 mcg/mL concentration; 0.01 mL for 10 mcg"], answer:1, rationale:"1 mL of the 1:10,000 amp (0.1 mg = 100 mcg) diluted into a total of 10 mL yields 10 mcg/mL. 10 mcg ÷ 10 mcg/mL = 1 mL." },
      { q:"A milrinone infusion is mixed as 20 mg in 200 mL (100 mcg/mL). Ordered dose: 0.5 mcg/kg/min for a 60 kg patient. What is the approximate mL/hr rate?", options:["A. 9 mL/hr","B. 18 mL/hr","C. 30 mL/hr","D. 60 mL/hr"], answer:1, rationale:"Dose = 0.5 × 60 = 30 mcg/min × 60 = 1800 mcg/hr. 1800 mcg/hr ÷ 100 mcg/mL = 18 mL/hr." },
      { q:"A vasopressin infusion is mixed as 20 units in 100 mL (0.2 units/mL). Ordered fixed rate: 0.04 units/min. What is the mL/hr rate?", options:["A. 6 mL/hr","B. 12 mL/hr","C. 20 mL/hr","D. 24 mL/hr"], answer:1, rationale:"0.04 units/min × 60 = 2.4 units/hr. 2.4 units/hr ÷ 0.2 units/mL = 12 mL/hr." },
      { q:"An insulin infusion is mixed at a standard concentration of 100 units in 100 mL (1 unit/mL). Ordered rate: 6 units/hr. What is the mL/hr rate?", options:["A. 0.6 mL/hr","B. 6 mL/hr","C. 60 mL/hr","D. 100 mL/hr"], answer:1, rationale:"At a 1:1 concentration (1 unit/mL), the units/hr ordered and the mL/hr rate are numerically identical: 6 units/hr = 6 mL/hr." }
    ]
  }
};

// Categories are read directly from whichever keys exist in a tier's pool
// (Object.keys) rather than a fixed global list — that's what lets "Drug
// Calculation" exist as a category across tiers without every tier needing
// an entry for it, and keeps the category list defined in exactly one place.
// 0 laps completed = easy (first pass around the board), 1 lap = intermediate
// (after the first Hangar landing), 2+ laps = hard (capped — a 3rd, 4th, etc.
// lap stays on hard rather than running out of tiers).
function missionTierForLaps(laps){
  laps = laps || 0;
  if (laps <= 0) return 'easy';
  if (laps === 1) return 'intermediate';
  return 'hard';
}

// Picks a random category + a random question within it from the given
// tier's pool. Returns {tier, category, index} — the actual question object
// is looked up from these three values wherever it's needed (both Board and
// phone), so every connected screen renders the exact same question rather
// than each re-rolling its own random pick.
// usedKeys (state.usedQuestionKeys) is optional so existing call sites and
// tests that don't care about repeats still work unchanged. When given, it
// steers away from any 'tier|category|index' key already in that list; if
// every question in the tier has already been used this game, it falls
// back to the full pool rather than stalling play.
// Combines the built-in QUESTION_BANK[tier] with anything Dispatch's
// Question Bank editor has added (customQuestions[tier], which may include
// brand-new category names) and any per-question edits (questionOverrides,
// keyed 'tier|category|mergedIndex'). Custom questions are appended AFTER
// a category's built-in ones, so merged indices stay stable and consistent
// across every screen that computes this the same way.
function getMergedBank(tier, customQuestions, overrides){
  var base = QUESTION_BANK[tier] || {};
  var custom = (customQuestions && customQuestions[tier]) || {};
  var merged = {};
  Object.keys(base).forEach(function(cat){ merged[cat] = base[cat].slice(); });
  Object.keys(custom).forEach(function(cat){
    if (!merged[cat]) merged[cat] = [];
    merged[cat] = merged[cat].concat(custom[cat]);
  });
  if (overrides){
    Object.keys(overrides).forEach(function(key){
      var parts = key.split('|');
      if (parts[0] !== tier) return;
      var cat = parts[1], idx = Number(parts[2]);
      if (merged[cat] && merged[cat][idx]) merged[cat][idx] = overrides[key];
    });
  }
  return merged;
}

// Same idea for the two flat, non-tiered pools.
function getMergedHangarQuestions(customHangarQuestions, hangarOverrides){
  var merged = HANGAR_HARD_QUESTIONS.concat(customHangarQuestions || []);
  if (hangarOverrides){
    Object.keys(hangarOverrides).forEach(function(k){ var i = Number(k); if (merged[i]) merged[i] = hangarOverrides[k]; });
  }
  return merged;
}
function getMergedHazardQuestions(customHazardQuestions, hazardOverrides){
  var merged = STOP_QUESTIONS.concat(customHazardQuestions || []);
  if (hazardOverrides){
    Object.keys(hazardOverrides).forEach(function(k){ var i = Number(k); if (merged[i]) merged[i] = hazardOverrides[k]; });
  }
  return merged;
}

function pickTieredQuestion(tier, usedKeys, customQuestions){
  var pool = getMergedBank(tier, customQuestions);
  var categories = Object.keys(pool);
  var used = usedKeys || [];
  var candidates = [];
  categories.forEach(function(category){
    var list = pool[category];
    for (var i = 0; i < list.length; i++){
      var key = tier + '|' + category + '|' + i;
      if (used.indexOf(key) === -1) candidates.push({ tier: tier, category: category, index: i, key: key });
    }
  });
  if (candidates.length === 0){
    categories.forEach(function(category){
      var list = pool[category];
      for (var i = 0; i < list.length; i++){
        candidates.push({ tier: tier, category: category, index: i, key: tier + '|' + category + '|' + i });
      }
    });
  }
  var chosen = candidates[Math.floor(Math.random() * candidates.length)];
  return { tier: chosen.tier, category: chosen.category, index: chosen.index, key: chosen.key };
}

// Same no-repeat idea as pickTieredQuestion(), but for the flat Hangar and
// Hazard question arrays instead of the tiered/categorized QUESTION_BANK.
// prefix distinguishes the two pools inside the shared usedQuestionKeys list
// (e.g. 'hangar' vs 'hazard') so they never collide.
function pickUnusedIndex(poolLength, prefix, usedKeys){
  var used = usedKeys || [];
  var candidates = [];
  for (var i = 0; i < poolLength; i++){
    var key = prefix + '|' + i;
    if (used.indexOf(key) === -1) candidates.push(i);
  }
  if (candidates.length === 0){
    for (var j = 0; j < poolLength; j++) candidates.push(j);
  }
  var index = candidates[Math.floor(Math.random() * candidates.length)];
  return { index: index, key: prefix + '|' + index };
}

// ---- Question Bank editor API (called from dispatch.html) ----
// All six functions write straight to shared state, so an addition or edit
// made from any connected Dispatch console is visible immediately to the
// Board, every player's phone, and every other open Dispatch tab — there is
// no separate "publish" step. None of them check state.paused: curating the
// bank is an instructor task, not a live-play action, so it's always
// allowed regardless of whether the game itself is paused mid-turn.

// Adds a brand-new question under tier/category. If category doesn't
// already exist in QUESTION_BANK or customQuestions, this is how a new
// category gets created — the first question added under a new name IS
// the category's creation. question = {q, options:[4 strings], answer:0-3,
// rationale:string}.
function addQuestion(tier, category, question){
  var state = GameStore.getState();
  var updated = JSON.parse(JSON.stringify(state.customQuestions || { easy:{}, intermediate:{}, hard:{} }));
  if (!updated[tier]) updated[tier] = {};
  if (!updated[tier][category]) updated[tier][category] = [];
  updated[tier][category].push(question);
  GameStore.setState({ customQuestions: updated });
  saveLocalQuestionBank(GameStore.getState());
  GameStore.addLog('Dispatch added a new ' + tier + ' question to ' + category + '.');
}

// Edits ANY question already in the merged bank — built-in or custom — by
// recording a full replacement keyed to its merged tier/category/index.
// This never touches QUESTION_BANK itself (the shipped 250-question bank
// stays intact on disk); it just shadows that one slot for this game.
function editQuestion(tier, category, index, updatedQuestion){
  var state = GameStore.getState();
  var key = tier + '|' + category + '|' + index;
  var updated = Object.assign({}, state.questionOverrides || {});
  updated[key] = updatedQuestion;
  GameStore.setState({ questionOverrides: updated });
  saveLocalQuestionBank(GameStore.getState());
  GameStore.addLog('Dispatch edited a ' + tier + ' question in ' + category + '.');
}

function addHangarQuestion(question){
  var state = GameStore.getState();
  var updated = (state.customHangarQuestions || []).concat([question]);
  GameStore.setState({ customHangarQuestions: updated });
  saveLocalQuestionBank(GameStore.getState());
  GameStore.addLog('Dispatch added a new Hangar Challenge question.');
}
function editHangarQuestion(index, updatedQuestion){
  var state = GameStore.getState();
  var updated = Object.assign({}, state.hangarOverrides || {});
  updated[String(index)] = updatedQuestion;
  GameStore.setState({ hangarOverrides: updated });
  saveLocalQuestionBank(GameStore.getState());
  GameStore.addLog('Dispatch edited a Hangar Challenge question.');
}

function addHazardQuestion(question){
  var state = GameStore.getState();
  var updated = (state.customHazardQuestions || []).concat([question]);
  GameStore.setState({ customHazardQuestions: updated });
  saveLocalQuestionBank(GameStore.getState());
  GameStore.addLog('Dispatch added a new Hazard STOP-checklist question.');
}
function editHazardQuestion(index, updatedQuestion){
  var state = GameStore.getState();
  var updated = Object.assign({}, state.hazardOverrides || {});
  updated[String(index)] = updatedQuestion;
  GameStore.setState({ hazardOverrides: updated });
  saveLocalQuestionBank(GameStore.getState());
  GameStore.addLog('Dispatch edited a Hazard STOP-checklist question.');
}

// ---- Win condition & end-of-game controls (called from dispatch.html) ----
var SCORE_TARGET_MIN = 2000, SCORE_TARGET_MAX = 10000, SCORE_TARGET_STEP = 500;

// value: a number (snapped to the nearest 500 and clamped to
// [2000, 10000]), or null/'free' for open play with no win condition.
function setScoreTarget(value){
  if (value === null || value === 'free'){
    GameStore.setState({ scoreTarget: null });
    GameStore.addLog('Dispatch switched to open play — no point target.');
    return;
  }
  var v = Math.round(Number(value) / SCORE_TARGET_STEP) * SCORE_TARGET_STEP;
  if (!isFinite(v)) return;
  v = Math.max(SCORE_TARGET_MIN, Math.min(SCORE_TARGET_MAX, v));
  GameStore.setState({ scoreTarget: v });
  GameStore.addLog('Dispatch set the score target to ' + v.toLocaleString() + ' points.');
}

// deltaSteps: +1 or -1, each worth one 500-point step. If the game is
// currently in open play, a nudge in either direction starts back at the
// minimum rather than doing arithmetic on null.
function adjustScoreTarget(deltaSteps){
  var state = GameStore.getState();
  if (typeof state.scoreTarget !== 'number'){
    // Leaving open play via a step button: land exactly on the boundary
    // nearest the direction pressed, rather than skipping a step past it.
    setScoreTarget(deltaSteps > 0 ? SCORE_TARGET_MIN : SCORE_TARGET_MAX);
    return;
  }
  setScoreTarget(state.scoreTarget + deltaSteps * SCORE_TARGET_STEP);
}

// Called from resolveMission()/resolveRapidRound()/resolveHangarWager() —
// the only three places a score goes up — right after they compute a
// player's new score. Returns a patch to fold into that SAME write when the
// new score just crossed the target, or null when there's nothing to do
// (open play, already game over, or not there yet).
function checkWinPatch(state, playerId, newScore){
  if (state.gameOver) return null;
  if (state.scoreTarget == null) return null;
  if (newScore < state.scoreTarget) return null;
  return { gameOver: true, winnerId: playerId, tiedWinnerIds: [], paused: true };
}

// Instructor override for when class time runs out before anyone reaches
// the target. Declares whoever currently has the highest score the winner;
// if two or more players are tied for the lead, no single winner is
// declared and tiedWinnerIds carries all of them instead, for the
// leaderboard to show as a tie.
function endGameNow(){
  var state = GameStore.getState();
  if (state.gameOver) return;
  var joined = state.turnOrder.filter(function(id){ return state.players[id] && state.players[id].connected; });
  if (!joined.length){
    GameStore.setState({ gameOver: true, winnerId: null, tiedWinnerIds: [], paused: true });
    GameStore.addLog('Dispatch ended the game — no players had joined.');
    return;
  }
  var best = -1;
  joined.forEach(function(id){ if (state.players[id].score > best) best = state.players[id].score; });
  var topPlayers = joined.filter(function(id){ return state.players[id].score === best; });
  if (topPlayers.length === 1){
    GameStore.setState({ gameOver: true, winnerId: topPlayers[0], tiedWinnerIds: [], paused: true });
    GameStore.addLog('Dispatch ended the game early — ' + state.players[topPlayers[0]].name + ' wins with ' + best.toLocaleString() + ' points!');
  } else {
    GameStore.setState({ gameOver: true, winnerId: null, tiedWinnerIds: topPlayers, paused: true });
    var names = topPlayers.map(function(id){ return state.players[id].name; }).join(', ');
    GameStore.addLog('Dispatch ended the game early — it’s a tie between ' + names + ' at ' + best.toLocaleString() + ' points!');
  }
}

// The "NEW GAME" button on the win screen. A lighter touch than
// resetToDefault()/RESET GAME on the Board: it keeps the room, the
// instructor's score target, and every question added/edited via the
// Question Bank editor, and keeps players in their seats (name/sprite/
// connected) so nobody has to rejoin — it just zeroes out scores and
// per-player counters and clears the no-repeat question history for a
// fresh round. resetToDefault() remains the full wipe for when you
// actually want a clean slate (new roster, new question bank, etc).
function startNewGame(){
  var state = GameStore.getState();
  var resetPlayers = {};
  Object.keys(state.players).forEach(function(id){
    var p = state.players[id];
    resetPlayers[id] = {
      name: p.name, sprite: p.sprite, connected: p.connected,
      tile: '', score: 0, position: 0, missionSkipPending: false,
      lapsCompleted: 0, turnsTaken: 0, correctCount: 0, wrongCount: 0
    };
  });
  GameStore.setState({
    phase: 'TURN_START',
    paused: false,
    gameOver: false,
    winnerId: null,
    tiedWinnerIds: [],
    players: resetPlayers,
    currentPlayerId: state.turnOrder.length ? state.turnOrder[0] : null,
    usedQuestionKeys: [],
    turn: JSON.parse(JSON.stringify(DEFAULT_GAME_STATE.turn))
  });
  GameStore.addLog('Dispatch started a new game' + (state.scoreTarget != null ? (' — first to ' + state.scoreTarget.toLocaleString() + ' points wins.') : ' — open play, no point target.'));
}

// Shared lookup so every call site (resolve/submit functions here, plus the
// Board's and phone's overlay renderers) fetches the identical question
// object the same way, instead of duplicating the QUESTION_BANK[tier][cat][i]
// indexing pattern everywhere.
function getTieredQuestion(tier, category, index, customQuestions, overrides){
  var pool = getMergedBank(tier, customQuestions, overrides);
  if (!pool || !pool[category]) return null;
  return pool[category][index] || null;
}

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
  if (state.paused || state.gameOver) return; // Dispatch has frozen the game — a stale timeout call shouldn't sneak a resolution in
  if (state.phase !== 'RESOLVING_MISSION' || state.turn.subphase !== 'MISSION_ANSWERING') return;

  var missionKey = state.turn.landedSpaceId + '|' + state.turn.missionTier + '|' + state.turn.missionCategory + '|' + state.turn.missionQuestionIndex + '|' + state.currentPlayerId;
  if (resolvedMissionKey === missionKey) return;
  resolvedMissionKey = missionKey;

  var currentId = state.currentPlayerId;
  var pname = state.players[currentId].name;

  var resolvePatch = {
    'turn/subphase': 'MISSION_RESOLVED',
    'turn/missionResult': correct ? 'correct' : 'incorrect',
    'turn/missionResolvedAt': Date.now(),
    // Auto-pause the instant a question is answered — the tick loop's own
    // "if (state.paused || state.gameOver) return;" guard then holds the result/rationale
    // on screen indefinitely until Dispatch resumes, giving the instructor
    // a window to run the "why" discussion before the next player rolls.
    paused: true
  };
  if (correct){
    var newScore = state.players[currentId].score + MISSION_POINTS;
    resolvePatch['players/' + currentId + '/score'] = newScore;
    resolvePatch['players/' + currentId + '/correctCount'] = (state.players[currentId].correctCount || 0) + 1;
    var winPatch = checkWinPatch(state, currentId, newScore);
    if (winPatch) Object.assign(resolvePatch, winPatch);
  } else {
    resolvePatch['players/' + currentId + '/wrongCount'] = (state.players[currentId].wrongCount || 0) + 1;
  }
  GameStore.setMulti(resolvePatch);
  GameStore.addLog(correct ? (pname + ' answered correctly (+' + MISSION_POINTS + ').') : (pname + ' did not answer correctly.'));
  GameStore.addLog(resolvePatch.gameOver ? (pname + ' just won the game!') : 'Game auto-paused for discussion — Dispatch must resume it.');
}

// Called when the player actually taps one of the answer options (instead
// of a GM/demo self-reporting correct/incorrect) — grades it against the
// question's own stored answer index and resolves the mission accordingly.
function submitMissionAnswer(optionIndex){
  var state = GameStore.getState();
  if (state.paused || state.gameOver) return; // Dispatch has frozen the game for a discussion
  if (state.phase !== 'RESOLVING_MISSION' || state.turn.subphase !== 'MISSION_ANSWERING') return;
  var q = getTieredQuestion(state.turn.missionTier, state.turn.missionCategory, state.turn.missionQuestionIndex, state.customQuestions, state.questionOverrides);
  if (!q) return;
  GameStore.setTurn({ missionPickedOption: optionIndex });
  resolveMission(optionIndex === q.answer);
}

var RAPID_ROUND_POINTS = 50;
var RAPID_ANSWER_SECONDS = 20; // shorter than a normal mission — it's about speed

function buzzIn(playerId){
  var state = GameStore.getState();
  if (state.paused || state.gameOver) return; // Dispatch has frozen the game for a discussion
  if (state.phase !== 'RESOLVING_RAPID' || state.turn.rapidBuzzedBy) return;
  if (!state.turn.rapidPlayers || state.turn.rapidPlayers.indexOf(playerId) === -1) return;
  GameStore.setTurn({ rapidBuzzedBy: playerId });
  GameStore.addLog(state.players[playerId].name + ' buzzed in first!');
}

var resolvedRapidKey = null;
function resolveRapidRound(correct){
  var state = GameStore.getState();
  if (state.paused || state.gameOver) return; // Dispatch has frozen the game — a stale timeout call shouldn't sneak a resolution in
  if (state.phase !== 'RESOLVING_RAPID' || !state.turn.rapidBuzzedBy || state.turn.rapidResult) return;

  var key = state.turn.rapidPlayers.join('|') + '|' + state.turn.rapidTier + '|' + state.turn.rapidCategory + '|' + state.turn.rapidQuestionIndex;
  if (resolvedRapidKey === key) return;
  resolvedRapidKey = key;

  var winnerId = state.turn.rapidBuzzedBy;
  var pname = state.players[winnerId].name;
  var resolvePatch = {
    'turn/rapidResult': correct ? 'correct' : 'incorrect',
    'turn/rapidResolvedAt': Date.now(),
    paused: true // see resolveMission() above for why
  };
  if (correct){
    var newRapidScore = state.players[winnerId].score + RAPID_ROUND_POINTS;
    resolvePatch['players/' + winnerId + '/score'] = newRapidScore;
    resolvePatch['players/' + winnerId + '/correctCount'] = (state.players[winnerId].correctCount || 0) + 1;
    var rapidWinPatch = checkWinPatch(state, winnerId, newRapidScore);
    if (rapidWinPatch) Object.assign(resolvePatch, rapidWinPatch);
  } else {
    resolvePatch['players/' + winnerId + '/wrongCount'] = (state.players[winnerId].wrongCount || 0) + 1;
  }
  GameStore.setMulti(resolvePatch);
  GameStore.addLog(correct
    ? (pname + ' answered the rapid round correctly (+' + RAPID_ROUND_POINTS + ').')
    : (pname + ' answered the rapid round incorrectly.'));
  GameStore.addLog(resolvePatch.gameOver ? (pname + ' just won the game!') : 'Game auto-paused for discussion — Dispatch must resume it.');
}

// Called when the buzzed-in player actually taps one of the answer options
// (instead of a GM/demo self-reporting correct/incorrect) — grades it
// against the question's own stored answer index.
function submitRapidAnswer(optionIndex){
  var state = GameStore.getState();
  if (state.paused || state.gameOver) return; // Dispatch has frozen the game for a discussion
  if (state.phase !== 'RESOLVING_RAPID' || !state.turn.rapidBuzzedBy || state.turn.rapidResult) return;
  var q = getTieredQuestion(state.turn.rapidTier, state.turn.rapidCategory, state.turn.rapidQuestionIndex, state.customQuestions, state.questionOverrides);
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
// pool is deliberately separate from QUESTION_BANK and is meant to hold the
// hardest, longest questions in the game — the "even harder longer
// question" the player specifically asked landing on the Hangar to produce.
// One is picked at random per Hangar landing so repeat laps don't always
// show the same one.
var HANGAR_HARD_QUESTIONS = [
  { q:"A trauma patient in hemorrhagic shock has received 3 units of blood 1:1:1 with plasma/platelets and remains hypotensive. What is the most likely underlying coagulopathy mechanism at this point?", options:["A. Dilutional coagulopathy from crystalloid overuse","B. Acute traumatic coagulopathy from tissue hypoperfusion and protein C activation","C. Vitamin K deficiency","D. Hereditary factor VIII deficiency"], answer:1, rationale:"Severe tissue injury and hypoperfusion activate protein C, which both consumes clotting factors and drives fibrinolysis — a distinct mechanism from simple dilution, and the reason balanced transfusion plus TXA are targeted therapies rather than crystalloid alone." },
  { q:"In a neonate with suspected persistent pulmonary hypertension (PPHN), which finding best differentiates it from cyanotic congenital heart disease during transport?", options:["A. Pre/post-ductal SpO2 gradient >10%","B. Single loud S2","C. Bounding femoral pulses","D. Hepatomegaly"], answer:0, rationale:"A significant pre/post-ductal saturation gradient reflects right-to-left shunting across a still-patent ductus from elevated pulmonary pressures, rather than a fixed structural cardiac defect." },
  { q:"A patient on a ventilator with ARDS is plateau-pressure limited at 30 cmH2O but remains severely hypoxic despite FiO2 1.0 and optimal PEEP titration. What is the next best transport ventilator strategy?", options:["A. Increase tidal volume to improve oxygenation","B. Prone positioning if feasible, or permissive hypercapnia with lower tidal volumes","C. Switch to volume-control with higher rate only","D. Discontinue PEEP to reduce barotrauma risk"], answer:1, rationale:"Once plateau pressure is already at its safe ceiling, raising tidal volume risks ventilator-induced lung injury — proning (if feasible in transport) and accepting a lower tidal volume/higher CO2 protect the lung while other rescue therapies are arranged." },
  { q:"A hemodynamically unstable patient requires RSI. Shock index is 1.3 and MAP is 58. Per current critical care transport practice, which induction approach is most appropriate?", options:["A. Standard-dose ketamine (1–2 mg/kg) with no other changes","B. Reduced-dose induction (e.g., ketamine 0.5 mg/kg), a push-dose pressor on hand, and resuscitation before or during the attempt","C. Succinylcholine is mandatory in every unstable patient","D. Delay all sedation and paralyze only"], answer:1, rationale:"Shock index >0.9 and MAP <65 both flag significant hemodynamic instability — reduced induction dosing plus a ready push-dose pressor blunts the risk of peri-intubation cardiovascular collapse that standard dosing could otherwise precipitate." },
  { q:"A postpartum patient develops sudden inversion of the uterus with hemorrhagic shock. Which combination reflects the correct immediate management?", options:["A. Remove the placenta first, then give oxytocin, then attempt replacement","B. Do not remove an attached placenta, stop all uterotonics, consider TXA, and attempt manual replacement while resuscitating","C. Apply firm traction on the umbilical cord to complete delivery","D. Give oxytocin and wait for spontaneous resolution"], answer:1, rationale:"Removing the placenta or continuing uterotonics both work against reducing the inversion and can worsen hemorrhage — the uterus must be relaxed (uterotonics stopped) and the placenta left in place while resuscitation and TXA address the bleeding." },
  { q:"Why was vasopressin removed from the current adult cardiac arrest algorithm, and what does that imply about substituting it for epinephrine?", options:["A. It's more dangerous than epinephrine, so it should never be given","B. Trial data showed no added survival/neurologic benefit over epinephrine alone, so it was dropped for simplicity, not safety concerns","C. It was removed because it is now considered a controlled substance","D. Vasopressin was never actually studied in cardiac arrest"], answer:1, rationale:"The combination didn't outperform epinephrine by itself in outcome trials, so guideline authors simplified the algorithm rather than removing it for a safety signal." },
  { q:"A crush injury patient is extricated after 4 hours. Just after extrication, the monitor shows peaked T waves and a widening QRS. What is happening, and what is the first priority?", options:["A. This is a normal reperfusion finding requiring no treatment","B. Reperfusion hyperkalemia from released intracellular potassium — calcium gluconate first to stabilize the cardiac membrane","C. This indicates hypokalemia, treat with potassium replacement","D. This is unrelated to the crush injury and should be ignored"], answer:1, rationale:"Reperfusion of crushed muscle releases a large potassium load; the ECG changes reflect impending lethal arrhythmia, and calcium (which doesn't lower potassium but stabilizes the membrane) is given first while potassium-lowering therapies are started." }
];
var WAGER_ANSWER_SECONDS = 90; // the toughest, longest question in the game — deliberately more time than a normal 30-50s mission so players can actually read and think it through

// Callable from any browser (the Board's demo wager UI, or a player's own
// phone) once the current player has picked an amount. Clamps to [0,
// current score] so a stale UI or a bad manual entry can never wager more
// points than the player has.
function submitHangarWager(amount){
  var state = GameStore.getState();
  if (state.paused || state.gameOver) return; // Dispatch has frozen the game for a discussion
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
  if (state.paused || state.gameOver) return; // Dispatch has frozen the game — a stale timeout call shouldn't sneak a resolution in
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
    'turn/wagerResolvedAt': Date.now(),
    paused: true // see resolveMission() above for why
  };
  var newWagerScore = Math.max(0, state.players[currentId].score + scoreDelta);
  resolvePatch['players/' + currentId + '/score'] = newWagerScore;
  resolvePatch['players/' + currentId + '/' + (correct ? 'correctCount' : 'wrongCount')] =
    (state.players[currentId][correct ? 'correctCount' : 'wrongCount'] || 0) + 1;
  if (correct){
    var wagerWinPatch = checkWinPatch(state, currentId, newWagerScore);
    if (wagerWinPatch) Object.assign(resolvePatch, wagerWinPatch);
  }
  GameStore.setMulti(resolvePatch);
  GameStore.addLog(correct
    ? (pname + ' nailed the Hangar Challenge \u2014 wager doubled (+' + wager.toLocaleString() + ').')
    : (pname + ' missed the Hangar Challenge \u2014 lost the ' + wager.toLocaleString() + '-point wager.'));
  GameStore.addLog(resolvePatch.gameOver ? (pname + ' just won the game!') : 'Game auto-paused for discussion \u2014 Dispatch must resume it.');
}

// Called when the player actually taps one of the answer options (instead
// of a GM/demo self-reporting correct/incorrect) — grades it against the
// question's own stored answer index.
function submitHangarAnswer(optionIndex){
  var state = GameStore.getState();
  if (state.paused || state.gameOver) return; // Dispatch has frozen the game for a discussion
  if (state.phase !== 'RESOLVING_HANGAR_WAGER' || state.turn.subphase !== 'WAGER_ANSWERING') return;
  var q = getMergedHangarQuestions(state.customHangarQuestions, state.hangarOverrides)[state.turn.hangarQuestionIndex];
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
  if (state.paused || state.gameOver) return; // Dispatch has frozen the game for a discussion
  if (state.phase !== 'RESOLVING_HAZARD' || state.turn.subphase !== 'HAZARD_CHALLENGE') return;
  var q = getMergedHazardQuestions(state.customHazardQuestions, state.hazardOverrides)[state.turn.hazardQuestionIndex];
  if (!q) return;
  resolveHazardChallenge(optionIndex === q.answer, optionIndex);
}

var resolvedHazardKey = null;
function resolveHazardChallenge(correct, pickedIndex){
  var state = GameStore.getState();
  if (state.paused || state.gameOver) return; // Dispatch has frozen the game — a stale timeout call shouldn't sneak a resolution in
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
    'turn/hazardResolvedAt': Date.now(),
    paused: true // see resolveMission() above for why
  };
  patch['players/' + currentId + '/' + (correct ? 'correctCount' : 'wrongCount')] =
    (state.players[currentId][correct ? 'correctCount' : 'wrongCount'] || 0) + 1;

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
  GameStore.addLog('Game auto-paused for discussion \u2014 Dispatch must resume it.');
}
