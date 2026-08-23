/**
 * Ninja Zenshin Clan Ranking Tracker - Frontend Application
 * Redesigned with Apple Frosted Glass (Glassmorphism) theme
 * and server-side Cloudflare KV sync tracking.
 */

// Application State
const state = {
  season: "Season --",
  countdownEnd: "",
  clans: [],                 // Scraped clans from server
  staminaData: {},           // Sync'd stamina map: { [clanId]: { [name]: stamina } }
  bleedingClans: {},         // Sync'd bleeding states: { [clanId]: boolean }
  reputationHistory: [],     // Sync'd event logs: [ { timestamp, clanId, clanName, memberName, gain, isSystem, message, important } ]
  settings: {
    defendingTargetRank: 1,
    attackPartySize: "solo",
    lastRecoveryTime: 0
  },
  
  // Local config
  muted: false,
  pollInterval: 30000,
  pollIntervalId: null,
  clockIntervalId: null,
  activeClanIdForModal: null,
  searchQuery: "",
  activeDailyTab: "today",
  
  // Custom Time Filter config
  filterActive: false,
  filterStartTime: "10:00",
  filterEndTime: "15:00"
};

// Audio Context Helper (Web Audio API sound chime)
function playChime() {
  if (state.muted) return;
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const now = ctx.currentTime;
    
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.type = "sine";
    osc.connect(gain);
    gain.connect(ctx.destination);
    
    osc.frequency.setValueAtTime(523.25, now);
    osc.frequency.setValueAtTime(659.25, now + 0.08);
    osc.frequency.setValueAtTime(783.99, now + 0.16);
    
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
  
  // 1. Synthesize sword slash
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (AudioContext) {
      const ctx = new AudioContext();
      const now = ctx.currentTime;
      
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
      gainNode.gain.linearRampToValueAtTime(0.7, now + 0.08);
      gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.4);
      
      noise.connect(filter);
      filter.connect(gainNode);
      gainNode.connect(ctx.destination);
      
      noise.start(now);
      noise.stop(now + 0.45);
      
      // Chime Strike
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const strikeGain = ctx.createGain();
      
      osc1.type = "triangle";
      osc1.frequency.setValueAtTime(880, now);
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

  // 2. TTS Voice "Chaos"
  try {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance("Chaos");
      utterance.rate = 0.85;
      utterance.pitch = 0.65;
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

// Helpers for time and math
function getSgtTime() {
  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  return new Date(utc + (3600000 * 8));
}

function getSgtDateString(sgtTime) {
  const y = sgtTime.getFullYear();
  const m = String(sgtTime.getMonth() + 1).padStart(2, '0');
  const d = String(sgtTime.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatTime(date) {
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  const s = String(date.getSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function escapeHtml(str) {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Returns UTC boundary timestamps for SGT midnight today/yesterday
function getSgtBoundaries() {
  const nowSgt = getSgtTime();
  
  const todaySgt = new Date(nowSgt);
  todaySgt.setHours(0, 0, 0, 0);
  const todayStartUtc = todaySgt.getTime() - (nowSgt.getTimezoneOffset() * 60000) - (8 * 3600000);
  
  const yesterdayStartUtc = todayStartUtc - 24 * 3600000;
  return { todayStartUtc, yesterdayStartUtc };
}

// Evaluates if UTC timestamp falls inside SGT custom HH:MM range
function isEventInSgtTimeRange(eventTimestamp, startStr, endStr) {
  const eventDate = new Date(eventTimestamp);
  const utc = eventDate.getTime() + (eventDate.getTimezoneOffset() * 60000);
  const sgtDate = new Date(utc + (3600000 * 8));
  
  const eventMinutes = sgtDate.getHours() * 60 + sgtDate.getMinutes();
  
  const startParts = startStr.split(":");
  const endParts = endStr.split(":");
  const startMinutes = parseInt(startParts[0], 10) * 60 + parseInt(startParts[1], 10);
  const endMinutes = parseInt(endParts[0], 10) * 60 + parseInt(endParts[1], 10);
  
  if (endMinutes >= startMinutes) {
    return eventMinutes >= startMinutes && eventMinutes <= endMinutes;
  } else {
    // Crosses midnight
    return eventMinutes >= startMinutes || eventMinutes <= endMinutes;
  }
}

// -------------------------------------------------------------
// Reputation calculations
// -------------------------------------------------------------
function getGainsForClan(clanId, durationHours) {
  const cutoff = Date.now() - durationHours * 3600000;
  return state.reputationHistory
    .filter(e => !e.isSystem && e.clanId === clanId && e.timestamp >= cutoff)
    .reduce((sum, e) => sum + e.gain, 0);
}

function getGainsForMember(clanId, memberName, durationHours) {
  const cutoff = Date.now() - durationHours * 3600000;
  return state.reputationHistory
    .filter(e => !e.isSystem && e.clanId === clanId && e.memberName === memberName && e.timestamp >= cutoff)
    .reduce((sum, e) => sum + e.gain, 0);
}

function getFilteredGainsForClan(clanId) {
  if (!state.filterActive) return 0;
  const cutoff = Date.now() - 24 * 3600000; // filter within last 24h
  return state.reputationHistory
    .filter(e => !e.isSystem && e.clanId === clanId && e.timestamp >= cutoff && isEventInSgtTimeRange(e.timestamp, state.filterStartTime, state.filterEndTime))
    .reduce((sum, e) => sum + e.gain, 0);
}

function getFilteredGainsForMember(clanId, memberName) {
  if (!state.filterActive) return 0;
  const cutoff = Date.now() - 24 * 3600000;
  return state.reputationHistory
    .filter(e => !e.isSystem && e.clanId === clanId && e.memberName === memberName && e.timestamp >= cutoff && isEventInSgtTimeRange(e.timestamp, state.filterStartTime, state.filterEndTime))
    .reduce((sum, e) => sum + e.gain, 0);
}

function getActiveMembersCount(clanId) {
  const cutoff = Date.now() - 24 * 3600000; // active in last 24h
  const activeMembers = new Set();
  state.reputationHistory
    .filter(e => !e.isSystem && e.clanId === clanId && e.timestamp >= cutoff)
    .forEach(e => activeMembers.add(e.memberName));
  return activeMembers.size;
}

// -------------------------------------------------------------
// Data Sync & API operations
// -------------------------------------------------------------
async function fetchClanRankings() {
  setSyncStatus("SYNCING...", "syncing");
  try {
    const res = await fetch("/api/clans");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    
    // Check if new attacks occurred (by comparing logs count)
    const oldHistoryCount = state.reputationHistory.length;
    const newHistoryCount = (data.reputation_history || []).length;
    const hasNewGains = newHistoryCount > oldHistoryCount && oldHistoryCount > 0;
    
    state.season = data.season || "Season 0";
    state.countdownEnd = data.countdownEnd || "";
    state.clans = data.clans || [];
    state.staminaData = data.stamina_data || {};
    state.bleedingClans = data.bleeding_clans || {};
    state.reputationHistory = data.reputation_history || [];
    
    // Sync settings loaded from KV
    if (data.settings) {
      state.settings = data.settings;
      
      const targetSelect = document.getElementById("defendingTargetSelect");
      if (targetSelect) targetSelect.value = state.settings.defendingTargetRank;
      
      const radio = document.querySelector(`input[name="attackType"][value="${state.settings.attackPartySize}"]`);
      if (radio) radio.checked = true;
    }
    
    document.getElementById("seasonDisplay").textContent = state.season;
    if (state.countdownEnd) initCountdown(state.countdownEnd);
    
    state.lastSyncTime = new Date();
    document.getElementById("lastSyncTime").textContent = formatTime(state.lastSyncTime);
    setSyncStatus("LIVE TRACKING", "live");
    
    // Audio trigger
    if (hasNewGains) {
      playChaosNinjaSound();
    }
    
    // Render all elements
    renderLeaderboard();
    renderLiveFeed();
    renderDailyActivePlayers();
    renderBleedingWidget();
    renderSessionSummary();
    populateOpsClanSelect();
    
    // Refresh modal if active
    if (state.activeClanIdForModal) {
      const clan = state.clans.find(c => c.id === state.activeClanIdForModal);
      if (clan) openMembersModal(state.activeClanIdForModal, clan.name);
    }
    
  } catch (error) {
    console.error("Failed to sync rankings:", error);
    setSyncStatus("SYNC ERROR", "error");
  }
}

async function postSettingsAction(actionData) {
  try {
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(actionData)
    });
    if (!res.ok) throw new Error("Failed to post settings update");
    const data = await res.json();
    
    if (data.success) {
      state.settings = data.settings;
      state.staminaData = data.stamina_data;
      state.bleedingClans = data.bleeding_clans;
      
      fetchClanRankings(); // pull fresh updates
    }
  } catch (e) {
    console.error("Failed to apply settings action:", e);
  }
}

// -------------------------------------------------------------
// UI Render Loops
// -------------------------------------------------------------
function renderLeaderboard() {
  const body = document.getElementById("clanRankingBody");
  if (!body) return;
  
  // Handle Filter headers display
  const filterHeader = document.querySelector(".filtered-gain-header");
  if (filterHeader) {
    filterHeader.style.display = state.filterActive ? "table-cell" : "none";
    if (state.filterActive) {
      filterHeader.textContent = `Gain (${state.filterStartTime}-${state.filterEndTime})`;
    }
  }
  
  // Filter search query
  let filteredClans = state.clans;
  if (state.searchQuery) {
    const q = state.searchQuery.toLowerCase();
    filteredClans = state.clans.filter(c => 
      c.name.toLowerCase().includes(q) || 
      c.master.toLowerCase().includes(q)
    );
  }
  
  if (filteredClans.length === 0) {
    body.innerHTML = `
      <tr>
        <td colspan="${state.filterActive ? 11 : 10}" class="text-center py-4">No clans match your search filter.</td>
      </tr>
    `;
    return;
  }

  function formatGainCell(gain) {
    if (gain > 1000) return `<td class="text-center gain-green">+${gain.toLocaleString()}</td>`;
    if (gain > 0) return `<td class="text-center gain-gold">+${gain.toLocaleString()}</td>`;
    return `<td class="text-center gain-zero">0</td>`;
  }

  body.innerHTML = filteredClans.map(clan => {
    const isBleeding = state.bleedingClans[clan.id] === true;
    const bleedBadge = isBleeding ? `<span class="bleeding-badge pulse-border">🩸 BLEEDING</span>` : "";
    
    const gain6h = getGainsForClan(clan.id, 6);
    const gain12h = getGainsForClan(clan.id, 12);
    const gain24h = getGainsForClan(clan.id, 24);
    const gainFiltered = getFilteredGainsForClan(clan.id);
    const activeCount = getActiveMembersCount(clan.id);
    
    const activeBadge = activeCount > 0 
      ? `<span class="active-badge"><i class="active-dot"></i>${activeCount}</span>` 
      : `<span class="active-badge inactive"><i class="active-dot inactive"></i>0</span>`;
    
    // Get recent activity string
    const recentActivity = state.reputationHistory
      .filter(e => !e.isSystem && e.clanId === clan.id)
      .slice(0, 2)
      .map(e => `${escapeHtml(e.memberName)} (+${e.gain})`)
      .join(", ") || "--";
      
    const filteredCol = state.filterActive 
      ? (gainFiltered > 1000 
          ? `<td class="text-center font-weight-bold gain-green">+${gainFiltered.toLocaleString()}</td>`
          : (gainFiltered > 0 
              ? `<td class="text-center font-weight-bold gain-gold">+${gainFiltered.toLocaleString()}</td>`
              : `<td class="text-center font-weight-bold gain-zero">0</td>`
            )
        )
      : "";

    return `
      <tr class="${isBleeding ? 'row-bleeding' : ''}">
        <td class="col-rank">${clan.rank}</td>
        <td class="col-clan">
          <a href="#" class="clan-modal-trigger" data-id="${clan.id}" data-name="${escapeHtml(clan.name)}">
            ${escapeHtml(clan.name)} ${bleedBadge}
          </a>
        </td>
        <td class="col-master">${escapeHtml(clan.master)}</td>
        <td class="col-members text-center">${clan.members}</td>
        <td class="text-center">${activeBadge}</td>
        <td class="col-rep text-right">${clan.reputation.toLocaleString()}</td>
        ${formatGainCell(gain6h)}
        ${formatGainCell(gain12h)}
        ${formatGainCell(gain24h)}
        ${filteredCol}
        <td class="col-activity text-muted">${recentActivity}</td>
      </tr>
    `;
  }).join("");
  
  // Bind click modals
  document.querySelectorAll(".clan-modal-trigger").forEach(link => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      const id = parseInt(link.getAttribute("data-id"), 10);
      const name = link.getAttribute("data-name");
      openMembersModal(id, name);
    });
  });
}

function renderLiveFeed() {
  const feedEl = document.getElementById("liveActivityFeed");
  if (!feedEl) return;
  
  if (state.reputationHistory.length === 0) {
    feedEl.innerHTML = `<div class="log-empty">Waiting for reputation updates from game server...</div>`;
    return;
  }
  
  feedEl.innerHTML = state.reputationHistory.slice(0, 30).map(event => {
    const timeStr = formatTime(new Date(event.timestamp));
    
    if (event.isSystem) {
      const impClass = event.important ? "system-important" : "";
      return `
        <div class="feed-item system-log ${impClass}">
          <div class="feed-header">
            <span class="feed-system-badge">SYSTEM</span>
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

function renderDailyActivePlayers() {
  const body = document.getElementById("dailyActiveWidgetBody");
  if (!body) return;

  const { todayStartUtc, yesterdayStartUtc } = getSgtBoundaries();
  
  // Filter events based on active tab SGT boundary timestamps
  const startBound = state.activeDailyTab === "today" ? todayStartUtc : yesterdayStartUtc;
  const endBound = state.activeDailyTab === "today" ? Infinity : todayStartUtc;
  
  const dailyEvents = state.reputationHistory.filter(e => 
    !e.isSystem && 
    e.timestamp >= startBound && 
    e.timestamp < endBound
  );
  
  // Group by clan
  const clanGroups = {};
  dailyEvents.forEach(e => {
    if (!clanGroups[e.clanId]) {
      const clan = state.clans.find(c => c.id === e.clanId);
      clanGroups[e.clanId] = {
        name: clan ? clan.name : `Clan #${e.clanId}`,
        rank: clan ? clan.rank : 99,
        players: {},
        totalGain: 0
      };
    }
    
    if (!clanGroups[e.clanId].players[e.memberName]) {
      clanGroups[e.clanId].players[e.memberName] = 0;
    }
    
    clanGroups[e.clanId].players[e.memberName] += e.gain;
    clanGroups[e.clanId].totalGain += e.gain;
  });
  
  const activeClans = Object.entries(clanGroups).map(([id, data]) => ({
    id: parseInt(id, 10),
    ...data
  })).sort((a, b) => b.totalGain - a.totalGain);

  if (activeClans.length === 0) {
    const activeText = state.activeDailyTab === "today" ? "today" : "yesterday";
    body.innerHTML = `
      <div class="log-empty">
        No active member contributions recorded ${activeText}.
      </div>
    `;
    return;
  }

  body.innerHTML = activeClans.map(c => {
    const playerTags = Object.entries(c.players)
      .sort((a, b) => b[1] - a[1])
      .map(([name, gain]) => `
        <div class="daily-player-tag">
          <span class="daily-player-name">${escapeHtml(name)}</span>
          <span class="daily-player-gain">+${gain.toLocaleString()}</span>
        </div>
      `).join("");
      
    return `
      <div class="daily-clan-section">
        <div class="daily-clan-title">
          <span>${escapeHtml(c.name)} (Rank ${c.rank})</span>
          <span class="clan-total-gain">+${c.totalGain.toLocaleString()}</span>
        </div>
        <div class="daily-players-list">
          ${playerTags}
        </div>
      </div>
    `;
  }).join("");
}

function renderBleedingWidget() {
  const body = document.getElementById("bleedingWidgetBody");
  const activeCountEl = document.getElementById("bleedingActiveCount");
  if (!body) return;
  
  const bleedingClansList = state.clans.filter(clan => state.bleedingClans[clan.id] === true);
  
  if (activeCountEl) {
    activeCountEl.textContent = `${bleedingClansList.length} BLEEDING`;
    activeCountEl.style.backgroundColor = bleedingClansList.length > 0 ? "var(--accent-red)" : "var(--accent-green-bg)";
    activeCountEl.style.color = bleedingClansList.length > 0 ? "#fff" : "var(--accent-green)";
  }
  
  if (bleedingClansList.length === 0) {
    body.innerHTML = `<div class="log-empty">All clans have healthy stamina levels.</div>`;
    return;
  }
  
  body.innerHTML = bleedingClansList.map(clan => {
    const stamMap = state.staminaData[clan.id] || {};
    const totalMembers = Object.keys(stamMap).length || 1;
    const lowStaminaCount = Object.values(stamMap).filter(v => v <= 70).length;
    const bleedingRatio = `${lowStaminaCount}/${totalMembers} (${Math.round((lowStaminaCount/totalMembers)*100)}%)`;
    
    // Count players fully recovered (200/200 stamina)
    const recoveredCount = Object.values(stamMap).filter(v => v === 200).length;
    const recoverProgress = `${recoveredCount}/${totalMembers}`;
    
    // Average stamina
    const avgStamina = Math.round(Object.values(stamMap).reduce((sum, v) => sum + v, 0) / totalMembers) || 200;
    
    return `
      <div class="bleed-clan-card pulse-border">
        <div class="bleed-clan-header">
          <span class="name">${escapeHtml(clan.name)}</span>
          <span class="ratio" title="Members with stamina <= 70">Low Stam: ${bleedingRatio}</span>
        </div>
        <div class="bleed-clan-details">
          <div class="detail-item">
            <span class="label">Avg Stamina:</span>
            <span class="val color-red">${avgStamina}/200</span>
          </div>
          <div class="detail-item">
            <span class="label">Recovery Ratio:</span>
            <span class="val color-gold">${recoverProgress} at 200</span>
          </div>
        </div>
      </div>
    `;
  }).join("");
}

function renderSessionSummary() {
  const summaryEl = document.getElementById("sessionSummaryBody");
  if (!summaryEl) return;
  
  // Calculate session gains from history logs since application opened
  const sessionGains = {};
  state.reputationHistory
    .filter(e => !e.isSystem)
    .forEach(e => {
      if (!sessionGains[e.clanName]) sessionGains[e.clanName] = 0;
      sessionGains[e.clanName] += e.gain;
    });

  const sortedClans = Object.entries(sessionGains)
    .sort((a, b) => b[1] - a[1]);
    
  if (sortedClans.length === 0) {
    summaryEl.innerHTML = `<div class="log-empty">No reputation gains recorded this session.</div>`;
    return;
  }
  
  summaryEl.innerHTML = sortedClans.map(([clanName, total]) => `
    <div class="stat-row">
      <span class="stat-clan">${escapeHtml(clanName)}</span>
      <span class="stat-value">+${total.toLocaleString()}</span>
    </div>
  `).join("");
}

// -------------------------------------------------------------
// Modal detail views
// -------------------------------------------------------------
async function openMembersModal(clanId, clanName) {
  state.activeClanIdForModal = clanId;
  const modal = document.getElementById("membersModal");
  const title = document.getElementById("modalClanTitle");
  const body = document.getElementById("modalClanBody");
  
  if (!modal || !body || !title) return;
  
  title.textContent = `${clanName} - Roster & Gains`;
  modal.style.display = "flex";
  
  try {
    const res = await fetch(`/api/members?clanId=${clanId}`);
    if (!res.ok) throw new Error("Failed to fetch members");
    const data = await res.json();
    
    const members = data.members || [];
    
    // Group and calculate gains for each member
    const clanStam = state.staminaData[clanId] || {};
    
    if (members.length === 0) {
      body.innerHTML = `<div class="text-center py-4">No members found or failing to connect to server.</div>`;
      return;
    }
    
    // Sort members descending by reputation
    members.sort((a, b) => (b.rep || 0) - (a.rep || 0));
    
    // Dynamic column header for Filtered Gain
    const filteredHeaderTh = state.filterActive ? `
      <th class="text-center">Gain (${state.filterStartTime}-${state.filterEndTime})</th>
    ` : "";

    const rows = members.map((m, index) => {
      const currentStam = clanStam[m.name] !== undefined ? clanStam[m.name] : 200;
      
      // Stamina Bar Styles
      let barColor = "var(--accent-green)";
      let pulseClass = "";
      if (currentStam <= 70) {
        barColor = "var(--accent-red-bright)";
        pulseClass = "pulse-anim";
      } else if (currentStam <= 120) {
        barColor = "var(--accent-gold)";
      }
      
      const widthPct = (currentStam / 200) * 100;
      
      const m6h = getGainsForMember(clanId, m.name, 6);
      const m12h = getGainsForMember(clanId, m.name, 12);
      const m24h = getGainsForMember(clanId, m.name, 24);
      const mFilter = getFilteredGainsForMember(clanId, m.name);
      
      const m6hBadge = m6h > 0 ? `<span class="modal-gain-badge">+${m6h}</span>` : "--";
      const m12hBadge = m12h > 0 ? `<span class="modal-gain-badge">+${m12h}</span>` : "--";
      const m24hBadge = m24h > 0 ? `<span class="modal-gain-badge">+${m24h}</span>` : "--";
      const mFilterBadge = mFilter > 0 ? `<span class="modal-gain-badge">+${mFilter}</span>` : "--";
      
      const filteredTd = state.filterActive ? `
        <td class="text-center">${mFilterBadge}</td>
      ` : "";

      return `
        <tr>
          <td class="text-center text-muted">${index + 1}</td>
          <td>
            <strong>${escapeHtml(m.name)}</strong>
            <div class="text-muted" style="font-size: 0.75rem;">Class: ${escapeHtml(m.class || "--")}</div>
          </td>
          <td class="text-center">Lvl ${m.level || "--"}</td>
          <td class="text-right">${(m.rep || 0).toLocaleString()}</td>
          <td class="text-center">${m6hBadge}</td>
          <td class="text-center">${m12hBadge}</td>
          <td class="text-center">${m24hBadge}</td>
          ${filteredTd}
          <td>
            <div class="stamina-container-modal">
              <span class="stamina-value-text">${currentStam}/200</span>
              <div class="stamina-progress-bg">
                <div class="stamina-progress-bar ${pulseClass}" style="width: ${widthPct}%; background-color: ${barColor};"></div>
              </div>
            </div>
          </td>
        </tr>
      `;
    }).join("");
    
    body.innerHTML = `
      <div class="table-responsive">
        <table class="ranking-table modal-table">
          <thead>
            <tr>
              <th class="text-center" style="width: 50px;">#</th>
              <th>Name</th>
              <th class="text-center">Level</th>
              <th class="text-right">Total Rep</th>
              <th class="text-center">6h</th>
              <th class="text-center">12h</th>
              <th class="text-center">24h</th>
              ${filteredHeaderTh}
              <th style="width: 160px;">Stamina</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
    `;
    
  } catch (e) {
    body.innerHTML = `<div class="text-center py-4 text-danger">Error loading clan members data.</div>`;
  }
}

function closeMembersModal() {
  state.activeClanIdForModal = null;
  const modal = document.getElementById("membersModal");
  if (modal) modal.style.display = "none";
}

// -------------------------------------------------------------
// Interactive dropdown controls
// -------------------------------------------------------------
function populateOpsClanSelect() {
  const select = document.getElementById("opsClanSelect");
  if (!select) return;
  
  const currentVal = select.value;
  select.innerHTML = '<option value="">-- Choose Clan --</option>';
  
  state.clans.forEach(clan => {
    const opt = document.createElement("option");
    opt.value = clan.id;
    opt.textContent = `${clan.rank}. ${clan.name}`;
    select.appendChild(opt);
  });
  
  select.value = currentVal;
}

function populateOpsMemberSelect(clanId) {
  const select = document.getElementById("opsMemberSelect");
  const manualInput = document.getElementById("manualStaminaInput");
  const saveBtn = document.getElementById("saveMemberStaminaBtn");
  
  if (!select) return;
  
  select.innerHTML = '<option value="">-- Select Member --</option>';
  select.disabled = true;
  if (manualInput) manualInput.disabled = true;
  if (saveBtn) saveBtn.disabled = true;
  
  if (!clanId || !state.staminaData[clanId]) return;
  
  const members = Object.keys(state.staminaData[clanId]).sort();
  if (members.length === 0) return;
  
  select.disabled = false;
  members.forEach(name => {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    select.appendChild(opt);
  });
}

// -------------------------------------------------------------
// Timers and Clocks
// -------------------------------------------------------------
function initCountdown(endDateStr) {
  const end = new Date(endDateStr).getTime();
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
  if (state.countdownIntervalId) clearInterval(state.countdownIntervalId);
  state.countdownIntervalId = setInterval(tick, 1000);
}

function updateServerClock() {
  const clockEl = document.getElementById("serverTimeClock");
  const timerEl = document.getElementById("dailyResetTimer");
  if (!clockEl) return;
  
  const sgtTime = getSgtTime();
  const h = String(sgtTime.getHours()).padStart(2, '0');
  const m = String(sgtTime.getMinutes()).padStart(2, '0');
  const s = String(sgtTime.getSeconds()).padStart(2, '0');
  clockEl.textContent = `${h}:${m}:${s} SGT`;

  // Countdown until SGT midnight (23:00 WIB daily reset)
  const tomorrowSgt = new Date(sgtTime);
  tomorrowSgt.setHours(24, 0, 0, 0);
  const msLeft = tomorrowSgt.getTime() - sgtTime.getTime();
  
  const pad = (n) => String(n).padStart(2, '0');
  const hrs = Math.floor(msLeft / 3600000);
  const mins = Math.floor((msLeft % 3600000) / 60000);
  const secs = Math.floor((msLeft % 60000) / 1000);
  
  if (timerEl) {
    timerEl.textContent = `Reset: ${pad(hrs)}:${pad(mins)}:${pad(secs)}`;
  }
}

function setSyncStatus(text, statusType = "syncing") {
  const dot = document.getElementById("syncStatusDot");
  const textEl = document.getElementById("syncStatusText");
  if (!dot || !textEl) return;
  
  textEl.textContent = text;
  dot.className = "pulse-dot";
  
  if (statusType === "syncing") {
    dot.style.backgroundColor = "var(--accent-gold)";
    dot.style.boxShadow = "0 0 8px var(--accent-gold)";
    textEl.style.color = "var(--accent-gold)";
  } else if (statusType === "error") {
    dot.style.backgroundColor = "var(--accent-red-bright)";
    dot.style.boxShadow = "0 0 8px var(--accent-red-bright)";
    textEl.style.color = "var(--accent-red-bright)";
  } else {
    dot.removeAttribute("style");
    textEl.removeAttribute("style");
  }
}

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

// -------------------------------------------------------------
// Event Listeners wiring
// -------------------------------------------------------------
function setupEventListeners() {
  // Sound
  const soundBtn = document.getElementById("soundToggleBtn");
  if (soundBtn) {
    soundBtn.addEventListener("click", () => {
      state.muted = !state.muted;
      localStorage.setItem("nz_muted", state.muted);
      updateSoundButtonUI();
      if (!state.muted) playChaosNinjaSound();
    });
  }

  // Refresh
  const refreshBtn = document.getElementById("refreshBtn");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", fetchClanRankings);
  }

  // Search
  const searchInput = document.getElementById("searchInput");
  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      state.searchQuery = e.target.value;
      renderLeaderboard();
    });
  }

  // Custom Time Window Filter triggers
  const startInput = document.getElementById("filterStartTime");
  const endInput = document.getElementById("filterEndTime");
  const applyBtn = document.getElementById("applyFilterBtn");
  const clearBtn = document.getElementById("clearFilterBtn");

  if (applyBtn && startInput && endInput) {
    applyBtn.addEventListener("click", () => {
      state.filterStartTime = startInput.value;
      state.filterEndTime = endInput.value;
      state.filterActive = true;
      
      if (clearBtn) clearBtn.style.display = "inline-block";
      applyBtn.textContent = "Active Filter";
      applyBtn.classList.add("muted");
      
      renderLeaderboard();
      if (state.activeClanIdForModal) {
        const clan = state.clans.find(c => c.id === state.activeClanIdForModal);
        if (clan) openMembersModal(state.activeClanIdForModal, clan.name);
      }
    });
  }

  if (clearBtn && applyBtn) {
    clearBtn.addEventListener("click", () => {
      state.filterActive = false;
      clearBtn.style.display = "none";
      applyBtn.textContent = "Apply Filter";
      applyBtn.classList.remove("muted");
      
      renderLeaderboard();
      if (state.activeClanIdForModal) {
        const clan = state.clans.find(c => c.id === state.activeClanIdForModal);
        if (clan) openMembersModal(state.activeClanIdForModal, clan.name);
      }
    });
  }

  // Daily active tabs
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

  // Settings: defending target rank change
  const targetSelect = document.getElementById("defendingTargetSelect");
  if (targetSelect) {
    targetSelect.addEventListener("change", (e) => {
      const val = parseInt(e.target.value, 10);
      postSettingsAction({ action: "updateSettings", defendingTargetRank: val });
    });
  }

  // Settings: polling interval change
  const pollSelect = document.getElementById("pollIntervalSelect");
  if (pollSelect) {
    pollSelect.addEventListener("change", (e) => {
      state.pollInterval = parseInt(e.target.value, 10);
      localStorage.setItem("nz_poll_interval", state.pollInterval);
      
      clearInterval(state.pollIntervalId);
      state.pollIntervalId = setInterval(fetchClanRankings, state.pollInterval);
      playChime();
    });
  }

  // Settings: attack party size change
  document.querySelectorAll('input[name="attackType"]').forEach(radio => {
    radio.addEventListener("change", (e) => {
      postSettingsAction({ action: "updateSettings", attackPartySize: e.target.value });
    });
  });

  // Settings: Collapsible Card Header click
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

  // Settings Operations: opsClanSelect change
  const opsClanSelect = document.getElementById("opsClanSelect");
  const opsMemberSelect = document.getElementById("opsMemberSelect");
  const manualInput = document.getElementById("manualStaminaInput");
  const saveBtn = document.getElementById("saveMemberStaminaBtn");
  const resetClanBtn = document.getElementById("resetClanStaminaBtn");

  if (opsClanSelect) {
    opsClanSelect.addEventListener("change", (e) => {
      const clanId = e.target.value;
      populateOpsMemberSelect(clanId);
      if (resetClanBtn) resetClanBtn.disabled = !clanId;
    });
  }

  if (opsMemberSelect && manualInput && saveBtn) {
    opsMemberSelect.addEventListener("change", (e) => {
      const name = e.target.value;
      const clanId = opsClanSelect.value;
      
      manualInput.disabled = !name;
      saveBtn.disabled = !name;
      
      if (name && clanId && state.staminaData[clanId]) {
        manualInput.value = state.staminaData[clanId][name] !== undefined ? state.staminaData[clanId][name] : 200;
      }
    });

    saveBtn.addEventListener("click", () => {
      const clanId = opsClanSelect.value;
      const memberName = opsMemberSelect.value;
      const staminaVal = parseInt(manualInput.value, 10);
      const clan = state.clans.find(c => c.id === parseInt(clanId, 10));
      
      if (clanId && memberName && !isNaN(staminaVal)) {
        postSettingsAction({
          action: "overrideMember",
          clanId,
          clanName: clan ? clan.name : `Clan #${clanId}`,
          memberName,
          stamina: staminaVal
        });
      }
    });
  }

  if (resetClanBtn) {
    resetClanBtn.addEventListener("click", () => {
      const clanId = opsClanSelect.value;
      const clan = state.clans.find(c => c.id === parseInt(clanId, 10));
      if (clanId) {
        postSettingsAction({
          action: "resetClan",
          clanId,
          clanName: clan ? clan.name : `Clan #${clanId}`
        });
      }
    });
  }

  // Modal Close triggers
  const closeBtn = document.getElementById("modalCloseBtn");
  if (closeBtn) closeBtn.addEventListener("click", closeMembersModal);

  const modalOverlay = document.getElementById("membersModal");
  if (modalOverlay) {
    modalOverlay.addEventListener("click", (e) => {
      if (e.target === modalOverlay) closeMembersModal();
    });
  }
  
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeMembersModal();
  });
}

// -------------------------------------------------------------
// App Initialization
// -------------------------------------------------------------
function init() {
  // Load local caches
  const savedMuted = localStorage.getItem("nz_muted");
  if (savedMuted !== null) {
    state.muted = savedMuted === "true";
    updateSoundButtonUI();
  }
  
  const savedPoll = localStorage.getItem("nz_poll_interval");
  if (savedPoll) {
    state.pollInterval = parseInt(savedPoll, 10);
    const select = document.getElementById("pollIntervalSelect");
    if (select) select.value = state.pollInterval;
  }
  
  setupEventListeners();
  
  // Start clock timer
  updateServerClock();
  state.clockIntervalId = setInterval(updateServerClock, 1000);
  
  // Load core standings
  fetchClanRankings();
  
  // Start polling
  state.pollIntervalId = setInterval(fetchClanRankings, state.pollInterval);
}

document.addEventListener("DOMContentLoaded", init);
