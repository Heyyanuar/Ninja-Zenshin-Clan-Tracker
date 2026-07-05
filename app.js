/**
 * Ninja Zenshin Clan Ranking Tracker - Frontend Application
 * Handles polling, baseline differential tracking, UI rendering,
 * search filtering, Web Audio chime synthesis, and modal views.
 */

// Application State
const state = {
  season: "Season --",
  countdownEnd: "",
  clans: [],            // List of clans: { rank, id, name, master, members, reputation }
  clanBaselines: {},    // Baseline data: { [clanId]: { reputation: X, members: { [memberName]: rep } } }
  recentGains: {},      // Recent gains per clan for table column: { [clanId]: [ { name, gain, timestamp } ] }
  sessionGains: {},     // Cumulative gains per clan for session summary: { [clanName]: totalGain }
  liveFeed: [],         // Array of feed events: { memberName, clanName, gain, timestamp }
  muted: false,         // Audio notification state
  isInitialLoad: true,  // Flag to prevent logging gains on first page load
  lastSyncTime: null,
  pollIntervalId: null,
  countdownIntervalId: null,
  activeClanIdForModal: null,
  searchQuery: ""
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

// Format timestamp: HH:MM:SS
function formatTime(date) {
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  const s = String(date.getSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

// Load baseline state from LocalStorage on start
function loadLocalStorageBaseline() {
  try {
    const savedBaselines = localStorage.getItem("nz_clan_baselines");
    const savedSessionGains = localStorage.getItem("nz_session_gains");
    const savedFeed = localStorage.getItem("nz_live_feed");
    const savedRecentGains = localStorage.getItem("nz_recent_gains");
    const savedMute = localStorage.getItem("nz_muted");
    
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
  } catch (e) {
    console.error("Gagal memuat baseline dari localStorage:", e);
  }
}

// Save current baseline state to LocalStorage
function saveLocalStorageBaseline() {
  try {
    localStorage.setItem("nz_clan_baselines", JSON.stringify(state.clanBaselines));
    localStorage.setItem("nz_session_gains", JSON.stringify(state.sessionGains));
    localStorage.setItem("nz_live_feed", JSON.stringify(state.liveFeed));
    localStorage.setItem("nz_recent_gains", JSON.stringify(state.recentGains));
  } catch (e) {
    console.error("Gagal menyimpan baseline ke localStorage:", e);
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
    
  } catch (error) {
    console.error("Gagal sinkronisasi data ranking clan:", error);
    setSyncStatus("SYNC ERROR", "error");
  }
}

// Fetch members of a specific clan
async function fetchClanMembers(clanId) {
  try {
    const response = await fetch(`/api/members?clanId=${clanId}`);
    if (!response.ok) throw new Error("Gagal mengambil daftar member");
    return await response.json();
  } catch (e) {
    console.error(`Gagal mengambil data member untuk clan ${clanId}:`, e);
    return null;
  }
}

// Diffing engine: analyzes changes in clan reputation and triggers member scans
async function processClanDataChanges() {
  const activeClans = state.clans.filter(c => c.reputation > 0);
  
  // Stagger helper to fetch members list sequentially to prevent server rate limiting
  const delay = (ms) => new Promise(res => setTimeout(res, ms));

  if (state.isInitialLoad) {
    // Establishing baseline for the first time
    setSyncStatus("ESTABLISHING BASELINE...", "syncing");
    
    // Scans top 10 clans to establish member level baselines immediately
    const baselineScans = activeClans.slice(0, 10);
    for (let i = 0; i < baselineScans.length; i++) {
      const clan = baselineScans[i];
      const memberData = await fetchClanMembers(clan.id);
      if (memberData && memberData.members) {
        const memberBaselines = {};
        memberData.members.forEach(m => {
          memberBaselines[m.name] = m.rep || 0;
        });
        state.clanBaselines[clan.id] = {
          reputation: clan.reputation,
          members: memberBaselines
        };
      }
      await delay(200); // 200ms sleep between fetches to avoid rate-limiting
    }
    
    // For other clans, just set total reputation baseline
    activeClans.slice(10).forEach(clan => {
      if (!state.clanBaselines[clan.id]) {
        state.clanBaselines[clan.id] = {
          reputation: clan.reputation,
          members: {} // Will load lazily if reputation changes
        };
      }
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
    
    // If clan is brand new or not in baseline
    if (!baseline) {
      state.clanBaselines[clan.id] = {
        reputation: clan.reputation,
        members: {}
      };
      // Fetch members immediately to establish base
      const memberData = await fetchClanMembers(clan.id);
      if (memberData && memberData.members) {
        memberData.members.forEach(m => {
          state.clanBaselines[clan.id].members[m.name] = m.rep || 0;
        });
      }
      await delay(200);
      continue;
    }
    
    // Check if total reputation has increased
    if (clan.reputation !== baseline.reputation) {
      const isGain = clan.reputation > baseline.reputation;
      
      // Fetch fresh member list to see who gained/changed rep
      const memberData = await fetchClanMembers(clan.id);
      if (memberData && memberData.members) {
        const oldMembers = baseline.members || {};
        const newMembers = {};
        
        memberData.members.forEach(m => {
          newMembers[m.name] = m.rep || 0;
          
          const oldRep = oldMembers[m.name] !== undefined ? oldMembers[m.name] : 0;
          const newRep = m.rep || 0;
          
          if (newRep > oldRep && oldMembers[m.name] !== undefined) {
            const gain = newRep - oldRep;
            
            // Log the gain event
            logGainEvent(m.name, clan.name, clan.id, gain);
            
            // Cumulative stats
            if (!state.sessionGains[clan.name]) state.sessionGains[clan.name] = 0;
            state.sessionGains[clan.name] += gain;
            
            if (!playedSound) {
              playChime();
              playedSound = true; // only play chime once per poll interval
            }
          }
        });
        
        // Update baseline members and total rep
        state.clanBaselines[clan.id] = {
          reputation: clan.reputation,
          members: newMembers
        };
      }
      await delay(250); // delay after fetching to be polite to the server
    }
  }
  
  saveLocalStorageBaseline();
}

// Log a gain event to feed and recent gains list
function logGainEvent(memberName, clanName, clanId, gain) {
  const timestamp = new Date();
  
  // 1. Add to live activity feed
  state.liveFeed.unshift({
    memberName,
    clanName,
    gain,
    timestamp: timestamp.toISOString()
  });
  
  // Keep live feed capped at 50 logs
  if (state.liveFeed.length > 50) {
    state.liveFeed.pop();
  }
  
  // 2. Add to clan recent gains array (for the table column)
  if (!state.recentGains[clanId]) {
    state.recentGains[clanId] = [];
  }
  
  state.recentGains[clanId].push({
    name: memberName,
    gain,
    timestamp: timestamp.getTime()
  });
}

// Filter out recent gains that are older than GAIN_EXPIRY_MS (10 mins)
function getActiveRecentGains(clanId) {
  const list = state.recentGains[clanId] || [];
  const now = Date.now();
  
  // Filter out expired gains
  const filtered = list.filter(item => (now - item.timestamp) < GAIN_EXPIRY_MS);
  
  // Update state with filtered list
  state.recentGains[clanId] = filtered;
  
  return filtered;
}

// Render the main Clan Standings table
function renderLeaderboard() {
  const tbody = document.getElementById("clanRankingBody");
  if (!tbody) return;
  
  const query = state.searchQuery.toLowerCase().trim();
  
  // Filter clans based on search query (checks clan name, master, or recent member gains)
  const filteredClans = state.clans.filter(clan => {
    if (!query) return true;
    
    // Check clan name or master
    if (clan.name.toLowerCase().includes(query) || clan.master.toLowerCase().includes(query)) {
      return true;
    }
    
    // Check if any member with recent gain matches search
    const gains = getActiveRecentGains(clan.id);
    const matchesMember = gains.some(g => g.name.toLowerCase().includes(query));
    if (matchesMember) return true;
    
    return false;
  });
  
  if (filteredClans.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="text-center py-4 text-muted">
          Tidak ada clan atau member yang cocok dengan pencarian "${state.searchQuery}"
        </td>
      </tr>
    `;
    return;
  }
  
  tbody.innerHTML = filteredClans.map(clan => {
    const isTop10 = clan.rank <= 10;
    const rowClass = isTop10 ? 'class="t10"' : '';
    
    // Get recent gains HTML
    const activeGains = getActiveRecentGains(clan.id);
    let activityHtml = `<span class="text-muted" style="opacity: 0.5; font-size: 0.8rem;">Tidak ada aktivitas</span>`;
    
    if (activeGains.length > 0) {
      // Group same members gains if multiple in short span, or just show last 3
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
        </td>
        <td class="col-master">${escapeHtml(clan.master || "ㅤ")}</td>
        <td class="col-members text-center">${clan.members}</td>
        <td class="col-rep text-right">${clan.reputation.toLocaleString()}</td>
        <td class="col-activity">${activityHtml}</td>
      </tr>
    `;
  }).join("");
  
  // Attach event listeners to Clan Buttons
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
        Menunggu pergerakan reputasi dari server game...
      </div>
    `;
    return;
  }
  
  feedEl.innerHTML = state.liveFeed.map(event => {
    const timeStr = formatTime(new Date(event.timestamp));
    return `
      <div class="feed-item gain-event">
        <div class="feed-header">
          <span class="feed-clan-badge" title="${escapeHtml(event.clanName)}">${escapeHtml(event.clanName)}</span>
          <span class="feed-time">${timeStr}</span>
        </div>
        <div class="feed-body">
          Ninja <strong>${escapeHtml(event.memberName)}</strong> mendapatkan <span class="gain-text">+${event.gain.toLocaleString()} Rep</span>!
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
        Belum ada reputasi yang bertambah di sesi ini.
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
  
  // Check if user has closed the modal or changed active modal during fetch
  if (state.activeClanIdForModal !== clanId) return;
  
  if (!data || !data.members) {
    modalBody.innerHTML = `
      <div class="text-center py-4 text-muted">
        Gagal memuat daftar anggota clan. Silakan coba lagi.
      </div>
    `;
    return;
  }
  
  const members = data.members || [];
  let tableHtml = `
    <table class="clr-mtable">
      <thead>
        <tr>
          <th style="width: 50px;">#</th>
          <th>Nama Member</th>
          <th class="text-center" style="width: 80px;">Level</th>
          <th class="text-right" style="width: 120px;">Reputation</th>
        </tr>
      </thead>
      <tbody>
  `;
  
  if (members.length === 0) {
    tableHtml += `
      <tr>
        <td colspan="4" class="text-center py-4 text-muted">Tidak ada member di clan ini.</td>
      </tr>
    `;
  } else {
    members.forEach((m, idx) => {
      tableHtml += `
        <tr>
          <td>${idx + 1}</td>
          <td style="font-weight: 600;">${escapeHtml(m.name)}</td>
          <td class="text-center">${m.level || '-'}</td>
          <td class="text-right modal-rep-val">${Number(m.rep || 0).toLocaleString()}</td>
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
      // play sound test if unmuted
      if (!state.muted) {
        playChime();
      }
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
      if (e.target === modalOverlay) {
        closeMembersModal();
      }
    });
  }
  
  // Close modal on Escape key press
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeMembersModal();
    }
  });
}

// Clean up expired gains loop
function startGainsCleanupLoop() {
  setInterval(() => {
    let updated = false;
    Object.keys(state.recentGains).forEach(clanId => {
      const originalCount = state.recentGains[clanId].length;
      const active = getActiveRecentGains(clanId);
      if (active.length !== originalCount) {
        updated = true;
      }
    });
    
    if (updated) {
      renderLeaderboard();
    }
  }, 15000); // Check expiry every 15 seconds
}

// Initialize Application
function init() {
  loadLocalStorageBaseline();
  setupEventListeners();
  startGainsCleanupLoop();
  
  // Initial fetch
  fetchClanRankings();
  
  // Start 30 seconds polling interval
  state.pollIntervalId = setInterval(fetchClanRankings, POLL_INTERVAL);
}

// Start app once DOM content is loaded
document.addEventListener("DOMContentLoaded", init);
