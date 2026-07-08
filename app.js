/**
 * Ninja Zenshin Clan Ranking Tracker - Frontend Application
 * Integrated with client-side Stamina & Bleeding Simulation Engine.
 */

// Application State
const state = {
  season: "Season --",
  countdownEnd: "",
  clans: [],            // List of clans: { rank, id, name, master, members, reputation }
  clanBaselines: {},    // Baseline data for reputation tracking: { [clanId]: { reputation: X, members: { [memberName]: rep } } }
  recentGains: {},      // Recent gains per clan for table column: { [clanId]: [ { name, gain, timestamp } ] }
  sessionGains: {},     // Cumulative gains per clan for session summary: { [clanName]: totalGain }
  liveFeed: [],         // Array of feed events: { memberName, clanName, gain, timestamp, isSystemEvent }
  muted: false,         // Audio notification state
  isInitialLoad: true,  // Flag to prevent logging gains on first page load
  lastSyncTime: null,
  pollIntervalId: null,
  countdownIntervalId: null,
  clockIntervalId: null,
  activeClanIdForModal: null,
  searchQuery: "",
  
  // Stamina & Bleeding Simulation State
  clanStamina: {},      // Stamina database: { [clanId]: { [memberName]: staminaValue } }
  bleedingClans: {},    // Bleeding state: { [clanId]: boolean }
  defendingTargetRank: 1, // Default defender rank (1 = Top 1, 2 = Top 2, 3 = Top 3)
  attackPartySize: "solo", // "solo" (drains 1), "party1" (drains 2), "party2" (drains 3)
  lastRecoveryCheckedMinute: -1,

  // Daily Active Players State
  dailyGains: {},       // Daily gains: { [clanId]: { [memberName]: gain } }
  yesterdayGains: {},   // Yesterday's gains: { [clanId]: { [memberName]: gain } }
  lastResetDate: "",    // Last reset date (YYYY-MM-DD) in SGT
  activeDailyTab: "today", // Active tab: "today" or "yesterday"
  pollInterval: 30000   // Polling speed: 30000ms default
};

// Config
const POLL_INTERVAL = 30000; // 30 seconds
const GAIN_EXPIRY_MS = 600000; // Recent gains in table expire after 10 minutes

// Audio Context Helper (Web Audio API retro sound chime)
function playChime() {
  if (state.muted) return;
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    
    // Retro level-up / coin sound: C5 (523Hz) -> E5 (659Hz) -> G5 (784Hz)
    const now = ctx.currentTime;
    
    // Node creation
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.type = "sine";
    osc.connect(gain);
    gain.connect(ctx.destination);
    
    // Schedule frequencies
    osc.frequency.setValueAtTime(523.25, now);
    osc.frequency.setValueAtTime(659.25, now + 0.08);
    osc.frequency.setValueAtTime(783.99, now + 0.16);
    
    // Gain envelope (soft decay)
    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.35);
    
    osc.start(now);
    osc.stop(now + 0.35);
  } catch (e) {
    console.warn("AudioContext blocked or failed: ", e);
  }
}

// Play dramatic ninja whoosh/slash sound + Speech Synthesis saying "Chaos"
function playChaosNinjaSound() {
  if (state.muted) return;
  
  // 1. Play synthesized Ninja Sword Slash / Metal Ring Sound
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (AudioContext) {
      const ctx = new AudioContext();
      const now = ctx.currentTime;
      
      // Sword Whoosh: White Noise filtered with downward sweep
      const bufferSize = ctx.sampleRate * 0.45;
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      
      const noise = ctx.createBufferSource();
      noise.buffer = buffer;
      
      const filter = ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.Q.value = 6;
      filter.frequency.setValueAtTime(3200, now);
      filter.frequency.exponentialRampToValueAtTime(120, now + 0.4);
      
      const gainNode = ctx.createGain();
      gainNode.gain.setValueAtTime(0.01, now);
      gainNode.gain.linearRampToValueAtTime(0.7, now + 0.08); // fast whoosh attack
      gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.4); // decay
      
      noise.connect(filter);
      filter.connect(gainNode);
      gainNode.connect(ctx.destination);
      
      noise.start(now);
      noise.stop(now + 0.45);
      
      // Shuriken Metal strike chime
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const strikeGain = ctx.createGain();
      
      osc1.type = "triangle";
      osc1.frequency.setValueAtTime(880, now); // A5
      osc1.frequency.exponentialRampToValueAtTime(1320, now + 0.12);
      
      osc2.type = "sine";
      osc2.frequency.setValueAtTime(1600, now);
      
      strikeGain.gain.setValueAtTime(0.35, now);
      strikeGain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      
      osc1.connect(strikeGain);
      osc2.connect(strikeGain);
      strikeGain.connect(ctx.destination);
      
      osc1.start(now);
      osc2.start(now);
      osc1.stop(now + 0.35);
      osc2.stop(now + 0.35);
    }
  } catch (e) {
    console.warn("Ninja Web Audio sound failed:", e);
  }

  // 2. TTS Voice speaking "Chaos" with deep pitch
  try {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      
      const utterance = new SpeechSynthesisUtterance("Chaos");
      utterance.rate = 0.85; // slightly slower for epic voice
      utterance.pitch = 0.65; // deep chest register sound
      utterance.volume = 1.0;
      
      const voices = window.speechSynthesis.getVoices();
      if (voices.length > 0) {
        const targetVoice = voices.find(v => 
          v.lang.startsWith("en") && 
          (v.name.includes("Male") || v.name.includes("David") || v.name.includes("Google US English"))
        );
        if (targetVoice) utterance.voice = targetVoice;
      }
      
      window.speechSynthesis.speak(utterance);
    }
  } catch (e) {
    console.warn("Speech synthesis voice failed:", e);
  }
}

// Format timestamp: HH:MM:SS
function formatTime(date) {
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  const s = String(date.getSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

// Helper to get Singapore Standard Time (SGT) which is UTC+8
function getSgtTime() {
  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  return new Date(utc + (3600000 * 8));
}

// Helper to format SGT date as YYYY-MM-DD
function getSgtDateString(sgtTime) {
  const y = sgtTime.getFullYear();
  const m = String(sgtTime.getMonth() + 1).padStart(2, '0');
  const d = String(sgtTime.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Load baseline and stamina state from LocalStorage on start
function loadLocalStorageBaseline() {
  try {
    const savedBaselines = localStorage.getItem("nz_clan_baselines");
    const savedSessionGains = localStorage.getItem("nz_session_gains");
    const savedFeed = localStorage.getItem("nz_live_feed");
    const savedRecentGains = localStorage.getItem("nz_recent_gains");
    const savedMute = localStorage.getItem("nz_muted");
    
    // Stamina states
    const savedStamina = localStorage.getItem("nz_clan_stamina");
    const savedBleeding = localStorage.getItem("nz_bleeding_clans");
    const savedTarget = localStorage.getItem("nz_defending_target");
    const savedPartySize = localStorage.getItem("nz_attack_party_size");

    // Daily gains states
    const savedDailyGains = localStorage.getItem("nz_daily_gains");
    const savedYesterdayGains = localStorage.getItem("nz_yesterday_gains");
    const savedLastResetDate = localStorage.getItem("nz_last_reset_date");
    
    if (savedBaselines) {
      state.clanBaselines = JSON.parse(savedBaselines);
      state.isInitialLoad = false; // We have baseline, so any new difference is a real-time update!
    }
    if (savedSessionGains) state.sessionGains = JSON.parse(savedSessionGains);
    if (savedFeed) state.liveFeed = JSON.parse(savedFeed);
    if (savedRecentGains) state.recentGains = JSON.parse(savedRecentGains);
    
    if (savedMute !== null) {
      state.muted = savedMute === "true";
      updateSoundButtonUI();
    }
    
    if (savedStamina) state.clanStamina = JSON.parse(savedStamina);
    if (savedBleeding) state.bleedingClans = JSON.parse(savedBleeding);
    if (savedTarget) {
      state.defendingTargetRank = parseInt(savedTarget, 10);
      const targetSelect = document.getElementById("defendingTargetSelect");
      if (targetSelect) targetSelect.value = state.defendingTargetRank;
    }
    if (savedPartySize) {
      state.attackPartySize = savedPartySize;
      const radio = document.querySelector(`input[name="attackType"][value="${state.attackPartySize}"]`);
      if (radio) radio.checked = true;
    }

    // Polling speed
    const savedPollInterval = localStorage.getItem("nz_poll_interval");
    if (savedPollInterval) {
      state.pollInterval = parseInt(savedPollInterval, 10);
      const pollSelect = document.getElementById("pollIntervalSelect");
      if (pollSelect) pollSelect.value = state.pollInterval;
    }

    if (savedDailyGains) state.dailyGains = JSON.parse(savedDailyGains);
    if (savedYesterdayGains) state.yesterdayGains = JSON.parse(savedYesterdayGains);
    if (savedLastResetDate) state.lastResetDate = savedLastResetDate;

    // Check for offline date cross-over catchup
    const nowSgt = getSgtTime();
    const sgtDateStr = getSgtDateString(nowSgt);

    if (state.lastResetDate && state.lastResetDate !== sgtDateStr) {
      // Midnight SGT has crossed since the tracker was last active!
      // Shift today's data to yesterday's
      state.yesterdayGains = JSON.parse(JSON.stringify(state.dailyGains));
      state.dailyGains = {};
      state.lastResetDate = sgtDateStr;
      
      // Save it immediately
      localStorage.setItem("nz_daily_gains", JSON.stringify(state.dailyGains));
      localStorage.setItem("nz_yesterday_gains", JSON.stringify(state.yesterdayGains));
      localStorage.setItem("nz_last_reset_date", state.lastResetDate);
    } else if (!state.lastResetDate) {
      state.lastResetDate = sgtDateStr;
      localStorage.setItem("nz_last_reset_date", state.lastResetDate);
    }
  } catch (e) {
    console.error("Failed to load baseline from localStorage:", e);
  }
}

// Save current baseline and stamina state to LocalStorage
function saveLocalStorageBaseline() {
  try {
    localStorage.setItem("nz_clan_baselines", JSON.stringify(state.clanBaselines));
    localStorage.setItem("nz_session_gains", JSON.stringify(state.sessionGains));
    localStorage.setItem("nz_live_feed", JSON.stringify(state.liveFeed));
    localStorage.setItem("nz_recent_gains", JSON.stringify(state.recentGains));
    
    // Stamina states
    localStorage.setItem("nz_clan_stamina", JSON.stringify(state.clanStamina));
    localStorage.setItem("nz_bleeding_clans", JSON.stringify(state.bleedingClans));
    localStorage.setItem("nz_defending_target", state.defendingTargetRank);
    localStorage.setItem("nz_attack_party_size", state.attackPartySize);

    // Daily active gains
    localStorage.setItem("nz_daily_gains", JSON.stringify(state.dailyGains));
    localStorage.setItem("nz_yesterday_gains", JSON.stringify(state.yesterdayGains));
    localStorage.setItem("nz_last_reset_date", state.lastResetDate);
    localStorage.setItem("nz_poll_interval", state.pollInterval);
  } catch (e) {
    console.error("Failed to save baseline to localStorage:", e);
  }
}

// Update Sound Toggle UI Button
function updateSoundButtonUI() {
  const btn = document.getElementById("soundToggleBtn");
  if (!btn) return;
  const label = btn.querySelector(".label");
  const icon = btn.querySelector(".icon");
  if (state.muted) {
    label.textContent = "Muted";
    icon.textContent = "🔇";
    btn.classList.add("muted");
  } else {
    label.textContent = "Sound On";
    icon.textContent = "🔊";
    btn.classList.remove("muted");
  }
}

// Set up UI Status message
function setSyncStatus(text, statusType = "syncing") {
  const dot = document.getElementById("syncStatusDot");
  const textEl = document.getElementById("syncStatusText");
  if (!dot || !textEl) return;
  
  textEl.textContent = text;
  dot.className = "pulse-dot"; // reset
  
  if (statusType === "syncing") {
    dot.style.backgroundColor = "var(--accent-gold)";
    dot.style.boxShadow = "0 0 8px var(--accent-gold)";
    textEl.style.color = "var(--accent-gold)";
  } else if (statusType === "error") {
    dot.style.backgroundColor = "var(--accent-red-bright)";
    dot.style.boxShadow = "0 0 8px var(--accent-red-bright)";
    textEl.style.color = "var(--accent-red-bright)";
  } else { // active / live
    dot.removeAttribute("style"); // fall back to css defaults (green)
    textEl.removeAttribute("style");
  }
}

// Season countdown logic
function initCountdown(endDateStr) {
  if (state.countdownIntervalId) {
    clearInterval(state.countdownIntervalId);
  }
  
  const end = new Date(endDateStr).getTime();
  if (isNaN(end)) return;

  const el = {
    d: document.getElementById("daysVal"),
    h: document.getElementById("hoursVal"),
    m: document.getElementById("minutesVal"),
    s: document.getElementById("secondsVal")
  };

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  
  function tick() {
    const t = end - Date.now();
    if (t <= 0) {
      if (el.d) el.d.textContent = '0';
      if (el.h) el.h.textContent = '00';
      if (el.m) el.m.textContent = '00';
      if (el.s) el.s.textContent = '00';
      return;
    }
    const d = Math.floor(t / 86400000);
    const h = Math.floor(t / 3600000) % 24;
    const m = Math.floor(t / 60000) % 60;
    const s = Math.floor(t / 1000) % 60;
    
    if (el.d) el.d.textContent = d;
    if (el.h) el.h.textContent = pad(h);
    if (el.m) el.m.textContent = pad(m);
    if (el.s) el.s.textContent = pad(s);
  }
  
  tick();
  state.countdownIntervalId = setInterval(tick, 1000);
}

// Fetch general Clan leaderboard from proxy Function
async function fetchClanRankings() {
  setSyncStatus("SYNCING...", "syncing");
  try {
    const response = await fetch("/api/clans");
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    const data = await response.json();
    
    state.season = data.season || "Season 0";
    state.countdownEnd = data.countdownEnd || "";
    state.clans = data.clans || [];
    
    document.getElementById("seasonDisplay").textContent = state.season;
    if (state.countdownEnd) {
      initCountdown(state.countdownEnd);
    }
    
    // Process and check for changes
    await processClanDataChanges();
    
    state.lastSyncTime = new Date();
    document.getElementById("lastSyncTime").textContent = formatTime(state.lastSyncTime);
    setSyncStatus("LIVE TRACKING", "live");
    
    renderLeaderboard();
    renderLiveFeed();
    renderSessionSummary();
    renderBleedingWidget();
    renderDailyActivePlayers();
    populateOpsClanSelect();
    
  } catch (error) {
    console.error("Failed to sync clan rankings:", error);
    setSyncStatus("SYNC ERROR", "error");
  }
}

// Fetch members of a specific clan
async function fetchClanMembers(clanId) {
  try {
    const response = await fetch(`/api/members?clanId=${clanId}`);
    if (!response.ok) throw new Error("Failed to fetch members list");
    return await response.json();
  } catch (e) {
    console.error(`Failed to fetch members data for clan ${clanId}:`, e);
    return null;
  }
}

// Diffing engine: analyzes changes in clan reputation and triggers member scans
async function processClanDataChanges() {
  const activeClans = state.clans.filter(c => c.reputation > 0);
  const delay = (ms) => new Promise(res => setTimeout(res, ms));

  if (state.isInitialLoad) {
    setSyncStatus("ESTABLISHING BASELINE...", "syncing");
    
    // Scans top 10 clans to establish member level baselines immediately
    const baselineScans = activeClans.slice(0, 10);
    for (let i = 0; i < baselineScans.length; i++) {
      const clan = baselineScans[i];
      const memberData = await fetchClanMembers(clan.id);
      
      if (!state.clanStamina[clan.id]) state.clanStamina[clan.id] = {};
      
      if (memberData && memberData.members) {
        const memberBaselines = {};
        memberData.members.forEach(m => {
          memberBaselines[m.name] = m.rep || 0;
          // Initialize stamina baseline (default 200)
          if (state.clanStamina[clan.id][m.name] === undefined) {
            state.clanStamina[clan.id][m.name] = 200;
          }
        });
        state.clanBaselines[clan.id] = {
          reputation: clan.reputation,
          members: memberBaselines
        };
        // Evaluate initial bleeding status
        checkAndUpdateBleedingStatus(clan.id);
      }
      await delay(200); // 200ms sleep between fetches to avoid rate-limiting
    }
    
    // For other clans, just set total reputation baseline
    activeClans.slice(10).forEach(clan => {
      if (!state.clanBaselines[clan.id]) {
        state.clanBaselines[clan.id] = {
          reputation: clan.reputation,
          members: {}
        };
      }
      if (!state.clanStamina[clan.id]) state.clanStamina[clan.id] = {};
    });
    
    state.isInitialLoad = false;
    saveLocalStorageBaseline();
    return;
  }

  // Subsequent polls: check if clan reputation has changed
  let playedSound = false;
  
  for (let i = 0; i < activeClans.length; i++) {
    const clan = activeClans[i];
    const baseline = state.clanBaselines[clan.id];
    
    if (!state.clanStamina[clan.id]) state.clanStamina[clan.id] = {};
    
    // If clan is brand new or not in baseline
    if (!baseline) {
      state.clanBaselines[clan.id] = {
        reputation: clan.reputation,
        members: {}
      };
      
      const memberData = await fetchClanMembers(clan.id);
      if (memberData && memberData.members) {
        memberData.members.forEach(m => {
          state.clanBaselines[clan.id].members[m.name] = m.rep || 0;
          if (state.clanStamina[clan.id][m.name] === undefined) {
            state.clanStamina[clan.id][m.name] = 200;
          }
        });
        checkAndUpdateBleedingStatus(clan.id);
      }
      await delay(200);
      continue;
    }
    
    // Check if total reputation has increased
    if (clan.reputation !== baseline.reputation) {
      const memberData = await fetchClanMembers(clan.id);
      if (memberData && memberData.members) {
        const oldMembers = baseline.members || {};
        const newMembers = {};
        
        memberData.members.forEach(m => {
          newMembers[m.name] = m.rep || 0;
          
          const oldRep = oldMembers[m.name] !== undefined ? oldMembers[m.name] : 0;
          const newRep = m.rep || 0;
          
          if (state.clanStamina[clan.id][m.name] === undefined) {
            state.clanStamina[clan.id][m.name] = 200;
          }
          
          if (newRep > oldRep && oldMembers[m.name] !== undefined) {
            const gain = newRep - oldRep;
            
            // Log the gain event
            logGainEvent(m.name, clan.name, clan.id, gain);
            
            // Process Stamina Drain simulation for this attack!
            simulateStaminaDrain(m.name, clan.id, clan.name);
            
            // Cumulative stats
            if (!state.sessionGains[clan.name]) state.sessionGains[clan.name] = 0;
            state.sessionGains[clan.name] += gain;
            
            if (!playedSound) {
              playChaosNinjaSound();
              playedSound = true;
            }
          }
        });
        
        // Update baseline members and total rep
        state.clanBaselines[clan.id] = {
          reputation: clan.reputation,
          members: newMembers
        };
      }
      await delay(250);
    }
  }
  
  saveLocalStorageBaseline();
}

// Stamina Drain Simulation logic
function simulateStaminaDrain(attackerName, attackerClanId, attackerClanName) {
  // 1. Attacker (Party Leader) loses 10 stamina
  if (!state.clanStamina[attackerClanId]) state.clanStamina[attackerClanId] = {};
  if (state.clanStamina[attackerClanId][attackerName] === undefined) {
    state.clanStamina[attackerClanId][attackerName] = 200;
  }
  
  const currentAttackerStam = state.clanStamina[attackerClanId][attackerName];
  if (currentAttackerStam < 10) {
    // Insufficient stamina warning log
    logSystemEvent(`[Stamina Warning] Attacker ${attackerName} (${attackerClanName}) had less than 10 Stamina (${currentAttackerStam}) but attacked anyway.`);
  }
  
  state.clanStamina[attackerClanId][attackerName] = Math.max(50, currentAttackerStam - 10);
  checkAndUpdateBleedingStatus(attackerClanId);

  // 2. Identify defending target clan based on settings (Rank 1, 2, or 3)
  const sortedClans = [...state.clans].sort((a, b) => a.rank - b.rank);
  const targetIndex = state.defendingTargetRank - 1; // 0, 1, or 2
  
  if (targetIndex >= sortedClans.length) return;
  const defenderClan = sortedClans[targetIndex];
  
  // Attacker cannot attack their own clan
  if (defenderClan.id === attackerClanId) return;

  // 3. Enforce Bleeding status protection
  const isDefenderBleeding = state.bleedingClans[defenderClan.id] === true;
  if (isDefenderBleeding) {
    logSystemEvent(`[Stamina Protection] Attack from ${attackerClanName} hit ${defenderClan.name}, but Stamina Drain was skipped (Defender is Bleeding).`);
    return;
  }

  // 4. Drain defender members stamina (N members with highest stamina, clamp at 50)
  let drainCount = 1; // Solo = 1
  if (state.attackPartySize === "party1") drainCount = 2;
  if (state.attackPartySize === "party2") drainCount = 3;

  // Initialize defender stamina structure if empty
  if (!state.clanStamina[defenderClan.id]) state.clanStamina[defenderClan.id] = {};
  
  // If defender members aren't loaded in stamina DB, fetch or initialize from baseline
  const defenderStaminaList = state.clanStamina[defenderClan.id];
  
  // Get all members in defender clan
  const membersList = Object.entries(defenderStaminaList);
  
  if (membersList.length === 0) {
    // Lazily fetch defender members to initialize their stamina baseline
    fetchClanMembers(defenderClan.id).then(data => {
      if (data && data.members) {
        data.members.forEach(m => {
          if (state.clanStamina[defenderClan.id][m.name] === undefined) {
            state.clanStamina[defenderClan.id][m.name] = 200;
          }
        });
        // Run drain again on loaded list
        applyDefenderDrain(defenderClan.id, defenderClan.name, drainCount);
      }
    });
  } else {
    applyDefenderDrain(defenderClan.id, defenderClan.name, drainCount);
  }
}

// Helper to sort and apply drain to defender's top players
function applyDefenderDrain(defenderClanId, defenderClanName, count) {
  const memberList = Object.entries(state.clanStamina[defenderClanId]);
  
  // Sort members by stamina descending
  memberList.sort((a, b) => b[1] - a[1]);
  
  const drainedNames = [];
  // Deduct stamina from the top N members
  for (let i = 0; i < Math.min(count, memberList.length); i++) {
    const [name, stam] = memberList[i];
    const newStam = Math.max(50, stam - 10);
    state.clanStamina[defenderClanId][name] = newStam;
    drainedNames.push(`${name} (${newStam})`);
  }
  
  checkAndUpdateBleedingStatus(defenderClanId);
  
  if (drainedNames.length > 0) {
    logSystemEvent(`[Stamina Drain] Drained ${drainedNames.length} defender(s) from ${defenderClanName}: ${drainedNames.join(", ")}`);
  }
}

// Evaluate and toggle Bleeding state for a clan
function checkAndUpdateBleedingStatus(clanId) {
  if (!state.clanStamina[clanId]) return false;
  
  const memberStaminas = Object.values(state.clanStamina[clanId]);
  const totalMembers = memberStaminas.length;
  
  if (totalMembers === 0) return false;
  
  const lowStaminaCount = memberStaminas.filter(s => s <= 70).length;
  const isCurrentlyBleeding = state.bleedingClans[clanId] === true;
  
  let newBleedState = isCurrentlyBleeding;
  
  if (!isCurrentlyBleeding) {
    // Enter Bleeding state if 50% or more members have <= 70 Stamina
    if ((lowStaminaCount / totalMembers) >= 0.5) {
      newBleedState = true;
      const clan = state.clans.find(c => c.id === parseInt(clanId, 10));
      const clanName = clan ? clan.name : `Clan #${clanId}`;
      logSystemEvent(`[🚨 BLEEDING TRIGGERED] Clan **${clanName}** has entered the Bleeding state! Stamina Drain has stopped.`, true);
    }
  } else {
    // Exit Bleeding state only when ALL members reach exactly 200/200 stamina
    const allRecovered = memberStaminas.every(s => s === 200);
    if (allRecovered) {
      newBleedState = false;
      const clan = state.clans.find(c => c.id === parseInt(clanId, 10));
      const clanName = clan ? clan.name : `Clan #${clanId}`;
      logSystemEvent(`[🛡️ BLEEDING RESOLVED] Clan **${clanName}** has fully recovered! Stamina level restored to healthy status.`, true);
    }
  }
  
  state.bleedingClans[clanId] = newBleedState;
  return newBleedState;
}

// Log a gain event to feed and recent gains list
function logGainEvent(memberName, clanName, clanId, gain) {
  const timestamp = new Date();
  
  // 1. Add to live activity feed
  state.liveFeed.unshift({
    memberName,
    clanName,
    gain,
    timestamp: timestamp.toISOString(),
    isSystemEvent: false
  });
  
  if (state.liveFeed.length > 50) state.liveFeed.pop();
  
  // 2. Add to clan recent gains array
  if (!state.recentGains[clanId]) state.recentGains[clanId] = [];
  state.recentGains[clanId].push({
    name: memberName,
    gain,
    timestamp: timestamp.getTime()
  });

  // 3. Accumulate Daily Active Player reputation
  if (!state.dailyGains[clanId]) state.dailyGains[clanId] = {};
  if (!state.dailyGains[clanId][memberName]) state.dailyGains[clanId][memberName] = 0;
  state.dailyGains[clanId][memberName] += gain;

  // Render the widget with updated data
  renderDailyActivePlayers();
}

// Log generic system event to the live activity feed
function logSystemEvent(msg, important = false) {
  const timestamp = new Date();
  state.liveFeed.unshift({
    message: msg,
    timestamp: timestamp.toISOString(),
    isSystemEvent: true,
    important: important
  });
  if (state.liveFeed.length > 50) state.liveFeed.pop();
  renderLiveFeed();
}

// Filter out recent gains that are older than GAIN_EXPIRY_MS (10 mins)
function getActiveRecentGains(clanId) {
  const list = state.recentGains[clanId] || [];
  const now = Date.now();
  const filtered = list.filter(item => (now - item.timestamp) < GAIN_EXPIRY_MS);
  state.recentGains[clanId] = filtered;
  return filtered;
}

// Render the main Clan Standings table
function renderLeaderboard() {
  const tbody = document.getElementById("clanRankingBody");
  if (!tbody) return;
  
  const query = state.searchQuery.toLowerCase().trim();
  
  const filteredClans = state.clans.filter(clan => {
    if (!query) return true;
    if (clan.name.toLowerCase().includes(query) || clan.master.toLowerCase().includes(query)) return true;
    
    const gains = getActiveRecentGains(clan.id);
    const matchesMember = gains.some(g => g.name.toLowerCase().includes(query));
    if (matchesMember) return true;
    
    return false;
  });
  
  if (filteredClans.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="text-center py-4 text-muted">
          No clans or members match search "${state.searchQuery}"
        </td>
      </tr>
    `;
    return;
  }
  
  tbody.innerHTML = filteredClans.map(clan => {
    const isTop10 = clan.rank <= 10;
    const rowClass = isTop10 ? 'class="t10"' : '';
    
    // Check if bleeding
    const isBleeding = state.bleedingClans[clan.id] === true;
    const bleedBadge = isBleeding ? `<span class="clan-bleed-badge"><span class="bleed-droplet">🩸</span> BLEEDING</span>` : '';
    
    // Get recent gains HTML
    const activeGains = getActiveRecentGains(clan.id);
    let activityHtml = `<span class="text-muted" style="opacity: 0.5; font-size: 0.8rem;">No activity</span>`;
    
    if (activeGains.length > 0) {
      const displayedGains = activeGains.slice(-3).reverse();
      activityHtml = `
        <div class="cell-recent-gains">
          ${displayedGains.map(g => `
            <div class="mini-gain-badge">
              <span class="member-name">${escapeHtml(g.name)}</span>
              <span class="gain-val">+${g.gain.toLocaleString()}</span>
            </div>
          `).join("")}
        </div>
      `;
    }
    
    return `
      <tr ${rowClass}>
        <td class="col-rank">${clan.rank}</td>
        <td class="col-clan">
          <span class="clan-name-btn" data-clan-id="${clan.id}" data-clan-name="${escapeHtml(clan.name)}">
            ${escapeHtml(clan.name || "ㅤ")}
          </span>
          ${bleedBadge}
        </td>
        <td class="col-master">${escapeHtml(clan.master || "ㅤ")}</td>
        <td class="col-members text-center">${clan.members}</td>
        <td class="col-rep text-right">${clan.reputation.toLocaleString()}</td>
        <td class="col-activity">${activityHtml}</td>
      </tr>
    `;
  }).join("");
  
  // Attach event listeners
  tbody.querySelectorAll(".clan-name-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const clanId = btn.getAttribute("data-clan-id");
      const clanName = btn.getAttribute("data-clan-name");
      openMembersModal(clanId, clanName);
    });
  });
}

// Render Live Activity Feed on sidebar
function renderLiveFeed() {
  const feedEl = document.getElementById("liveActivityFeed");
  if (!feedEl) return;
  
  if (state.liveFeed.length === 0) {
    feedEl.innerHTML = `
      <div class="log-empty">
        Waiting for reputation changes from the game server...
      </div>
    `;
    return;
  }
  
  feedEl.innerHTML = state.liveFeed.map(event => {
    const timeStr = formatTime(new Date(event.timestamp));
    
    if (event.isSystemEvent) {
      const importantClass = event.important ? "style='border-left-color: var(--accent-red); background: rgba(192,25,44,0.08); font-weight:600; color:#fff;'" : "style='border-left-color: var(--accent-gold); opacity: 0.85;'";
      return `
        <div class="feed-item" ${importantClass}>
          <div class="feed-header">
            <span class="feed-clan-badge" style="background: rgba(255,255,255,0.08); border-color: rgba(255,255,255,0.15); color: var(--accent-gold);">SYSTEM</span>
            <span class="feed-time">${timeStr}</span>
          </div>
          <div class="feed-body">${event.message}</div>
        </div>
      `;
    }
    
    return `
      <div class="feed-item gain-event">
        <div class="feed-header">
          <span class="feed-clan-badge" title="${escapeHtml(event.clanName)}">${escapeHtml(event.clanName)}</span>
          <span class="feed-time">${timeStr}</span>
        </div>
        <div class="feed-body">
          Ninja <strong>${escapeHtml(event.memberName)}</strong> gained <span class="gain-text">+${event.gain.toLocaleString()} Rep</span>!
        </div>
      </div>
    `;
  }).join("");
}

// Render Session Gain Summary bar list on sidebar
function renderSessionSummary() {
  const summaryEl = document.getElementById("sessionSummaryBody");
  if (!summaryEl) return;
  
  const sortedClans = Object.entries(state.sessionGains)
    .filter(([_, total]) => total > 0)
    .sort((a, b) => b[1] - a[1]);
    
  if (sortedClans.length === 0) {
    summaryEl.innerHTML = `
      <div class="log-empty">
        No reputation has increased in this session yet.
      </div>
    `;
    return;
  }
  
  summaryEl.innerHTML = sortedClans.map(([clanName, total]) => `
    <div class="stat-row">
      <span class="stat-clan">${escapeHtml(clanName)}</span>
      <span class="stat-value">+${total.toLocaleString()}</span>
    </div>
  `).join("");
}

// Render Daily Active Players widget in sidebar
function renderDailyActivePlayers() {
  const body = document.getElementById("dailyActiveWidgetBody");
  if (!body) return;

  const data = state.activeDailyTab === "today" ? state.dailyGains : state.yesterdayGains;
  
  // Group player gains by clan
  const activeClans = [];

  Object.entries(data).forEach(([clanId, players]) => {
    const clanIdInt = parseInt(clanId, 10);
    const clan = state.clans.find(c => c.id === clanIdInt);
    const clanName = clan ? clan.name : `Clan #${clanId}`;
    const clanRank = clan ? clan.rank : 99;
    
    // Get list of active players and sort by gain descending
    const playerGains = Object.entries(players)
      .filter(([_, gain]) => gain > 0)
      .sort((a, b) => b[1] - a[1]);
      
    if (playerGains.length > 0) {
      const clanTotalGain = playerGains.reduce((sum, [_, gain]) => sum + gain, 0);
      activeClans.push({
        id: clanIdInt,
        name: clanName,
        rank: clanRank,
        totalGain: clanTotalGain,
        players: playerGains
      });
    }
  });

  // Sort clans by total daily gain descending
  activeClans.sort((a, b) => b.totalGain - a.totalGain);

  if (activeClans.length === 0) {
    const activeText = state.activeDailyTab === "today" ? "today" : "yesterday";
    body.innerHTML = `
      <div class="log-empty">
        No active member contributions recorded ${activeText}.
      </div>
    `;
    return;
  }

  body.innerHTML = activeClans.map(c => `
    <div class="daily-clan-section">
      <div class="daily-clan-title">
        <span>${escapeHtml(c.name)} (Rank ${c.rank})</span>
        <span class="clan-total-gain">+${c.totalGain.toLocaleString()}</span>
      </div>
      <div class="daily-players-list">
        ${c.players.map(([name, gain]) => `
          <div class="daily-player-tag">
            <span class="daily-player-name">${escapeHtml(name)}</span>
            <span class="daily-player-gain">+${gain.toLocaleString()}</span>
          </div>
        `).join("")}
      </div>
    </div>
  `).join("");
}

// Render Bleeding widget list in sidebar
function renderBleedingWidget() {
  const body = document.getElementById("bleedingWidgetBody");
  const activeCountEl = document.getElementById("bleedingActiveCount");
  if (!body) return;
  
  // Find all bleeding clans
  const bleedingClansList = state.clans.filter(clan => state.bleedingClans[clan.id] === true);
  
  if (activeCountEl) {
    activeCountEl.textContent = `${bleedingClansList.length} BLEEDING`;
    activeCountEl.style.backgroundColor = bleedingClansList.length > 0 ? "var(--accent-red)" : "var(--accent-green-bg)";
    activeCountEl.style.color = bleedingClansList.length > 0 ? "#fff" : "var(--accent-green)";
  }
  
  if (bleedingClansList.length === 0) {
    body.innerHTML = `
      <div class="log-empty">
        All clans have healthy stamina levels.
      </div>
    `;
    return;
  }
  
  body.innerHTML = bleedingClansList.map(clan => {
    const staminas = Object.values(state.clanStamina[clan.id] || {});
    const total = staminas.length;
    const fullyRecovered = staminas.filter(s => s === 200).length;
    const avg = total > 0 ? Math.round(staminas.reduce((a,b)=>a+b, 0) / total) : 200;
    
    return `
      <div class="bleed-clan-card">
        <div class="bleed-clan-header">
          <span class="bleed-clan-name">
            <span class="bleed-droplet">🩸</span> ${escapeHtml(clan.name)} (Rank ${clan.rank})
          </span>
          <span class="bleed-recovery-fraction" title="Members at 200 Stamina">
            Recovered: ${fullyRecovered}/${total}
          </span>
        </div>
        <div class="bleed-stats-grid">
          <div>Avg Stamina: <span class="bleed-stat-val">${avg}</span></div>
          <div>Low Stamina: <span class="bleed-stat-val">${staminas.filter(s => s <= 70).length}</span></div>
        </div>
        <div class="stamina-bar-container">
          <div class="stamina-bar low" style="width: ${(avg/200)*100}%;"></div>
        </div>
      </div>
    `;
  }).join("");
}

// Open members modal and fetch details from proxy
async function openMembersModal(clanId, clanName) {
  state.activeClanIdForModal = clanId;
  const modal = document.getElementById("membersModal");
  const modalTitle = document.getElementById("modalClanTitle");
  const modalBody = document.getElementById("modalClanBody");
  
  if (!modal || !modalTitle || !modalBody) return;
  
  modalTitle.textContent = clanName;
  modalBody.innerHTML = `
    <div class="text-center py-4">
      <div class="spinner"></div>
      Loading members...
    </div>
  `;
  modal.style.display = "flex";
  
  const data = await fetchClanMembers(clanId);
  if (state.activeClanIdForModal !== clanId) return;
  
  if (!data || !data.members) {
    modalBody.innerHTML = `
      <div class="text-center py-4 text-muted">
        Failed to load clan members list. Please try again.
      </div>
    `;
    return;
  }
  
  const members = data.members || [];
  
  // Ensure stamina entries exist in state DB
  if (!state.clanStamina[clanId]) state.clanStamina[clanId] = {};
  members.forEach(m => {
    if (state.clanStamina[clanId][m.name] === undefined) {
      state.clanStamina[clanId][m.name] = 200;
    }
  });
  
  let tableHtml = `
    <table class="clr-mtable">
      <thead>
        <tr>
          <th style="width: 50px;">#</th>
          <th>Member Name</th>
          <th class="text-center" style="width: 60px;">Level</th>
          <th class="text-right" style="width: 100px;">Reputation</th>
          <th style="width: 170px;">Simulated Stamina</th>
        </tr>
      </thead>
      <tbody>
  `;
  
  if (members.length === 0) {
    tableHtml += `
      <tr>
        <td colspan="5" class="text-center py-4 text-muted">No members in this clan.</td>
      </tr>
    `;
  } else {
    members.forEach((m, idx) => {
      const stam = state.clanStamina[clanId][m.name] || 200;
      let stamClass = "high";
      if (stam <= 70) stamClass = "low";
      else if (stam <= 120) stamClass = "medium";
      
      tableHtml += `
        <tr>
          <td>${idx + 1}</td>
          <td style="font-weight: 600;">${escapeHtml(m.name)}</td>
          <td class="text-center">${m.level || '-'}</td>
          <td class="text-right modal-rep-val">${Number(m.rep || 0).toLocaleString()}</td>
          <td class="modal-stamina-cell">
            <div class="stamina-bar-container">
              <div class="stamina-bar ${stamClass}" style="width: ${(stam/200)*100}%;"></div>
            </div>
            <span class="modal-stamina-val ${stamClass}">${stam}/200</span>
          </td>
        </tr>
      `;
    });
  }
  
  tableHtml += `
      </tbody>
    </table>
  `;
  
  modalBody.innerHTML = tableHtml;
}

// Close members modal
function closeMembersModal() {
  state.activeClanIdForModal = null;
  const modal = document.getElementById("membersModal");
  if (modal) modal.style.display = "none";
}

// Escape HTML entities to prevent XSS
function escapeHtml(str) {
  if (str == null) return '';
  return String(str).replace(/[&<>"']/g, function(c) {
    return {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[c];
  });
}

// Populate manual stamina adjustment clan dropdown
function populateOpsClanSelect() {
  const select = document.getElementById("opsClanSelect");
  if (!select) return;
  
  // If already populated, preserve selection unless list changed size
  const activeClans = state.clans.filter(c => c.reputation > 0);
  if (select.options.length > 1 && select.options.length === activeClans.length + 1) return;
  
  // Clear other options
  select.innerHTML = '<option value="">-- Choose Clan --</option>';
  
  activeClans.forEach(clan => {
    const opt = document.createElement("option");
    opt.value = clan.id;
    opt.textContent = `${clan.name} (Rank ${clan.rank})`;
    select.appendChild(opt);
  });
}

// Check SGT time and trigger +60 stamina recovery on :00 and :30
function checkStaminaRecoveryTicks(sgtTime) {
  const currentMinute = sgtTime.getMinutes();
  const currentSecond = sgtTime.getSeconds();
  
  // Trigger recovery twice an hour (exactly on minute 00 and 30)
  if ((currentMinute === 0 || currentMinute === 30) && currentSecond < 10) {
    if (state.lastRecoveryCheckedMinute !== currentMinute) {
      state.lastRecoveryCheckedMinute = currentMinute;
      
      let recoveryCount = 0;
      Object.keys(state.clanStamina).forEach(clanId => {
        const clanStam = state.clanStamina[clanId];
        Object.keys(clanStam).forEach(name => {
          const oldStam = clanStam[name];
          if (oldStam < 200) {
            clanStam[name] = Math.min(200, oldStam + 60);
            recoveryCount++;
          }
        });
        checkAndUpdateBleedingStatus(clanId);
      });
      
      logSystemEvent(`[Server Clock] Stamina Recovery: +60 Stamina restored to all players in the simulator (Total members updated: ${recoveryCount}).`);
      playChime();
      saveLocalStorageBaseline();
      renderLeaderboard();
      renderBleedingWidget();
    }
  } else if (currentMinute !== 0 && currentMinute !== 30) {
    // Reset tracker flag once minute passes
    state.lastRecoveryCheckedMinute = -1;
  }
}

// Update server SGT clock and check recovery ticks
function updateServerClock() {
  const clockEl = document.getElementById("serverTimeClock");
  if (!clockEl) return;
  
  // Singapore Standard Time (SGT) is UTC+8
  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  const sgtTime = new Date(utc + (3600000 * 8));
  
  const h = String(sgtTime.getHours()).padStart(2, '0');
  const m = String(sgtTime.getMinutes()).padStart(2, '0');
  const s = String(sgtTime.getSeconds()).padStart(2, '0');
  clockEl.textContent = `${h}:${m}:${s} SGT`;
  
  // 1. Check for SGT date shift (Midnight reset, corresponding to 23:00 WIB)
  const sgtDateStr = getSgtDateString(sgtTime);
  if (state.lastResetDate && state.lastResetDate !== sgtDateStr) {
    state.yesterdayGains = JSON.parse(JSON.stringify(state.dailyGains));
    state.dailyGains = {};
    state.lastResetDate = sgtDateStr;
    
    logSystemEvent("[Daily Reset] Daily active player reputation logs have been reset at 23:00 WIB (00:00 SGT). Yesterday's summary has been archived.", true);
    
    saveLocalStorageBaseline();
    renderDailyActivePlayers();
  } else if (!state.lastResetDate) {
    state.lastResetDate = sgtDateStr;
    saveLocalStorageBaseline();
  }

  // 2. Render countdown until next reset
  const tomorrowSgt = new Date(sgtTime);
  tomorrowSgt.setHours(24, 0, 0, 0); // Sets to midnight SGT of next day
  const msLeft = tomorrowSgt.getTime() - sgtTime.getTime();
  
  const pad = (n) => String(n).padStart(2, '0');
  const hrs = Math.floor(msLeft / 3600000);
  const mins = Math.floor((msLeft % 3600000) / 60000);
  const secs = Math.floor((msLeft % 60000) / 1000);
  
  const timerEl = document.getElementById("dailyResetTimer");
  if (timerEl) {
    timerEl.textContent = `Reset: ${pad(hrs)}:${pad(mins)}:${pad(secs)}`;
  }

  // 3. Check for stamina recovery ticks
  checkStaminaRecoveryTicks(sgtTime);
}

// Setup Event Listeners
function setupEventListeners() {
  // 1. Refresh Button
  const refreshBtn = document.getElementById("refreshBtn");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", () => {
      fetchClanRankings();
    });
  }
  
  // 2. Sound Toggle Button
  const soundBtn = document.getElementById("soundToggleBtn");
  if (soundBtn) {
    soundBtn.addEventListener("click", () => {
      state.muted = !state.muted;
      localStorage.setItem("nz_muted", state.muted);
      updateSoundButtonUI();
      if (!state.muted) playChaosNinjaSound();
    });
  }
  
  // 3. Search input filtering
  const searchInput = document.getElementById("searchInput");
  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      state.searchQuery = e.target.value;
      renderLeaderboard();
    });
  }
  
  // 4. Modal Close events
  const closeBtn = document.getElementById("modalCloseBtn");
  if (closeBtn) {
    closeBtn.addEventListener("click", closeMembersModal);
  }
  
  const modalOverlay = document.getElementById("membersModal");
  if (modalOverlay) {
    modalOverlay.addEventListener("click", (e) => {
      if (e.target === modalOverlay) closeMembersModal();
    });
  }
  
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeMembersModal();
  });

  // 5. Collapsible Settings Panel
  const settingsHeader = document.getElementById("settingsToggleHeader");
  const settingsBody = document.getElementById("settingsCollapseBody");
  const settingsIcon = document.getElementById("settingsToggleIcon");
  if (settingsHeader && settingsBody) {
    settingsHeader.addEventListener("click", () => {
      const isHidden = settingsBody.style.display === "none";
      settingsBody.style.display = isHidden ? "block" : "none";
      settingsIcon.textContent = isHidden ? "▲ Close Settings" : "▼ Toggle Settings";
    });
  }

  // 6. Attack Target Selection
  const targetSelect = document.getElementById("defendingTargetSelect");
  if (targetSelect) {
    targetSelect.addEventListener("change", (e) => {
      state.defendingTargetRank = parseInt(e.target.value, 10);
      saveLocalStorageBaseline();
      logSystemEvent(`[Config Update] Defending Target Clan changed to Rank ${state.defendingTargetRank} in standings.`);
    });
  }

  // Polling Speed Selection
  const pollSelect = document.getElementById("pollIntervalSelect");
  if (pollSelect) {
    pollSelect.addEventListener("change", (e) => {
      state.pollInterval = parseInt(e.target.value, 10);
      localStorage.setItem("nz_poll_interval", state.pollInterval);
      
      // Reset polling interval timer
      clearInterval(state.pollIntervalId);
      state.pollIntervalId = setInterval(fetchClanRankings, state.pollInterval);
      
      logSystemEvent(`[Config Update] Polling update speed changed to ${state.pollInterval / 1000} seconds.`);
      
      // Immediately trigger fresh sync
      fetchClanRankings();
    });
  }

  // 7. Attack Party Size selection (Radio buttons)
  document.querySelectorAll('input[name="attackType"]').forEach(radio => {
    radio.addEventListener("change", (e) => {
      state.attackPartySize = e.target.value;
      saveLocalStorageBaseline();
      const label = e.target.parentNode.textContent.trim();
      logSystemEvent(`[Config Update] Assumed party size updated to: "${label}".`);
    });
  });

  // 8. Stamina adjustment dropdown links
  const opsClanSelect = document.getElementById("opsClanSelect");
  const opsMemberSelect = document.getElementById("opsMemberSelect");
  const manualStamInput = document.getElementById("manualStaminaInput");
  const saveMemberBtn = document.getElementById("saveMemberStaminaBtn");
  const resetClanBtn = document.getElementById("resetClanStaminaBtn");

  if (opsClanSelect && opsMemberSelect) {
    opsClanSelect.addEventListener("change", async (e) => {
      const clanId = e.target.value;
      
      // Disable member fields and reset values
      opsMemberSelect.innerHTML = '<option value="">-- Select Member --</option>';
      opsMemberSelect.disabled = true;
      manualStamInput.disabled = true;
      saveMemberBtn.disabled = true;

      if (!clanId) {
        resetClanBtn.disabled = true;
        return;
      }
      
      resetClanBtn.disabled = false;

      // Populate members
      let staminaEntries = state.clanStamina[clanId];
      
      // If empty in cache, load members list
      if (!staminaEntries || Object.keys(staminaEntries).length === 0) {
        opsMemberSelect.innerHTML = '<option value="">Loading members...</option>';
        const data = await fetchClanMembers(clanId);
        
        if (!state.clanStamina[clanId]) state.clanStamina[clanId] = {};
        
        if (data && data.members) {
          data.members.forEach(m => {
            if (state.clanStamina[clanId][m.name] === undefined) {
              state.clanStamina[clanId][m.name] = 200;
            }
          });
        }
      }
      
      opsMemberSelect.innerHTML = '<option value="">-- Select Member --</option>';
      opsMemberSelect.disabled = false;
      
      // Re-fetch populated lists
      staminaEntries = state.clanStamina[clanId] || {};
      const sortedNames = Object.keys(staminaEntries).sort();
      
      sortedNames.forEach(name => {
        const opt = document.createElement("option");
        opt.value = name;
        opt.textContent = `${name} (${staminaEntries[name]}/200)`;
        opsMemberSelect.appendChild(opt);
      });
    });

    opsMemberSelect.addEventListener("change", (e) => {
      const memberName = e.target.value;
      const clanId = opsClanSelect.value;
      
      if (!memberName || !clanId) {
        manualStamInput.disabled = true;
        saveMemberBtn.disabled = true;
        return;
      }

      manualStamInput.disabled = false;
      saveMemberBtn.disabled = false;
      
      const currentStam = state.clanStamina[clanId][memberName] || 200;
      manualStamInput.value = currentStam;
    });

    // 9. Save Manual Stamina Override
    saveMemberBtn.addEventListener("click", () => {
      const clanId = opsClanSelect.value;
      const memberName = opsMemberSelect.value;
      const newStam = Math.min(200, Math.max(50, parseInt(manualStamInput.value, 10)));
      
      if (!clanId || !memberName || isNaN(newStam)) return;
      
      state.clanStamina[clanId][memberName] = newStam;
      checkAndUpdateBleedingStatus(clanId);
      saveLocalStorageBaseline();
      
      // Refresh member select options text
      const selectedIndex = opsMemberSelect.selectedIndex;
      opsMemberSelect.options[selectedIndex].textContent = `${memberName} (${newStam}/200)`;
      
      logSystemEvent(`[Manual Override] Set ${memberName}'s stamina to ${newStam}/200.`);
      
      renderLeaderboard();
      renderBleedingWidget();
      
      // If modal is open for this clan, refresh it
      if (state.activeClanIdForModal === clanId) {
        const clan = state.clans.find(c => c.id === parseInt(clanId, 10));
        openMembersModal(clanId, clan ? clan.name : "Clan");
      }
    });

    // 10. Reset entire Clan Stamina
    resetClanBtn.addEventListener("click", () => {
      const clanId = opsClanSelect.value;
      if (!clanId) return;
      
      const clan = state.clans.find(c => c.id === parseInt(clanId, 10));
      const clanName = clan ? clan.name : `Clan #${clanId}`;
      
      if (!state.clanStamina[clanId]) state.clanStamina[clanId] = {};
      
      // Set all cached members to 200
      Object.keys(state.clanStamina[clanId]).forEach(name => {
        state.clanStamina[clanId][name] = 200;
      });
      
      // Reset Bleeding status
      state.bleedingClans[clanId] = false;
      checkAndUpdateBleedingStatus(clanId); // double check state machine resets
      saveLocalStorageBaseline();
      
      logSystemEvent(`[Manual Reset] Reset all members of **${clanName}** to 200 Stamina (Bleeding cleared).`, true);
      
      // Trigger select re-render
      opsClanSelect.dispatchEvent(new Event("change"));
      
      renderLeaderboard();
      renderBleedingWidget();
      
      if (state.activeClanIdForModal === clanId) {
        openMembersModal(clanId, clanName);
      }
    });
  }

  // 11. Daily Active Players Widget Tab Swapping
  const tabToday = document.getElementById("tabDailyToday");
  const tabYesterday = document.getElementById("tabDailyYesterday");
  if (tabToday && tabYesterday) {
    tabToday.addEventListener("click", () => {
      state.activeDailyTab = "today";
      tabToday.classList.add("active");
      tabYesterday.classList.remove("active");
      renderDailyActivePlayers();
    });
    tabYesterday.addEventListener("click", () => {
      state.activeDailyTab = "yesterday";
      tabYesterday.classList.add("active");
      tabToday.classList.remove("active");
      renderDailyActivePlayers();
    });
  }
}

// Clean up expired gains loop
function startGainsCleanupLoop() {
  setInterval(() => {
    let updated = false;
    Object.keys(state.recentGains).forEach(clanId => {
      const originalCount = state.recentGains[clanId].length;
      const active = getActiveRecentGains(clanId);
      if (active.length !== originalCount) updated = true;
    });
    if (updated) renderLeaderboard();
  }, 15000); // Check expiry every 15 seconds
}

// Initialize Application
function init() {
  loadLocalStorageBaseline();
  setupEventListeners();
  startGainsCleanupLoop();
  
  // Initial sync fetch
  fetchClanRankings();
  
  // Start SGT server clock timer (1 second interval)
  updateServerClock();
  state.clockIntervalId = setInterval(updateServerClock, 1000);
  
  // Start polling loop
  state.pollIntervalId = setInterval(fetchClanRankings, state.pollInterval);
}

// Start app once DOM content is loaded
document.addEventListener("DOMContentLoaded", init);
