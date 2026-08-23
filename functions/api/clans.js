// Initialize global state fallback for local development (no D1 database bound)
if (!globalThis.globalNinjaState) {
  globalThis.globalNinjaState = {
    reputationHistory: [],
    staminaData: {},
    bleedingClans: {},
    settings: { defendingTargetRank: 1, attackPartySize: "solo", lastRecoveryTime: Date.now() },
    lastLeaderboard: { clans: [] },
    membersCache: {}
  };
}
const globalState = globalThis.globalNinjaState;

export async function onRequest(context) {
  const targetUrl = "https://ninjazenshin.online/clan-ranking";

  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "public, max-age=3"
  };

  if (context.request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    // 1. Fetch live leaderboard HTML
    const response = await fetch(targetUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5"
      }
    });

    if (!response.ok) {
      return new Response(JSON.stringify({ error: `Failed to fetch from source: ${response.statusText}` }), {
        status: response.status,
        headers: corsHeaders
      });
    }

    const html = await response.text();

    const seasonMatch = html.match(/<div class="clr-season">([^<]+)<\/div>/i);
    const season = seasonMatch ? seasonMatch[1].trim() : "Season 0";

    const countdownMatch = html.match(/<div class="clr-cd"[^>]*data-end="([^"]+)"/i);
    const countdownEnd = countdownMatch ? countdownMatch[1] : "";

    const clans = [];
    const rowRegex = /<tr[^>]*>\s*<td class="r">(\d+)<\/td>\s*<td><span class="clr-mem" data-clan="(\d+)" data-name="([^"]*)">[\s\S]*?<\/span><\/td>\s*<td>([\s\S]*?)<\/td>\s*<td class="c">(\d+\/\d+)<\/td>\s*<td class="sc">([\d,]+)<\/td>\s*<\/tr>/gi;

    let match;
    while ((match = rowRegex.exec(html)) !== null) {
      clans.push({
        rank: parseInt(match[1], 10),
        id: parseInt(match[2], 10),
        name: decodeHtmlEntities(match[3].trim()),
        master: decodeHtmlEntities(match[4].trim()),
        members: match[5].trim(),
        reputation: parseInt(match[6].replace(/,/g, ""), 10)
      });
    }

    // 2. Load D1 Database / Global State Fallback
    const db = context.env.NINJA_D1;
    let reputationHistory = [];
    let staminaData = {};
    let bleedingClans = {};
    let settings = { defendingTargetRank: 1, attackPartySize: "solo", lastRecoveryTime: 0 };
    let lastLeaderboard = { clans: [] };

    if (db) {
      // Auto initialize tables if not exist
      await db.exec(`
        CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
        CREATE TABLE IF NOT EXISTS stamina (clan_id INTEGER, member_name TEXT, stamina INTEGER, PRIMARY KEY (clan_id, member_name));
        CREATE TABLE IF NOT EXISTS reputation_history (id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp INTEGER, clan_id INTEGER, clan_name TEXT, member_name TEXT, gain INTEGER, is_system INTEGER, message TEXT, important INTEGER);
        CREATE TABLE IF NOT EXISTS bleeding_clans (clan_id INTEGER PRIMARY KEY, is_bleeding INTEGER);
        CREATE TABLE IF NOT EXISTS members_cache (clan_id INTEGER PRIMARY KEY, members_json TEXT);
      `);

      // Load Settings
      const settingsRows = await db.prepare("SELECT key, value FROM settings").all();
      if (settingsRows && settingsRows.results) {
        settingsRows.results.forEach(r => {
          if (r.key === "defendingTargetRank") settings.defendingTargetRank = parseInt(r.value, 10);
          if (r.key === "attackPartySize") settings.attackPartySize = r.value;
          if (r.key === "lastRecoveryTime") settings.lastRecoveryTime = parseInt(r.value, 10);
        });
      }

      // Load lastLeaderboard
      const llRow = await db.prepare("SELECT value FROM settings WHERE key = 'lastLeaderboard'").first();
      lastLeaderboard = llRow ? JSON.parse(llRow.value) : { clans: [] };

      // Load Reputation History
      const repRows = await db.prepare("SELECT timestamp, clan_id, clan_name, member_name, gain, is_system, message, important FROM reputation_history ORDER BY id DESC LIMIT 500").all();
      if (repRows && repRows.results) {
        reputationHistory = repRows.results.map(r => ({
          timestamp: r.timestamp,
          clanId: r.clan_id,
          clanName: r.clan_name,
          memberName: r.member_name,
          gain: r.gain,
          isSystem: r.is_system === 1,
          message: r.message,
          important: r.important === 1
        }));
      }

      // Load Stamina Data
      const stamRows = await db.prepare("SELECT clan_id, member_name, stamina FROM stamina").all();
      if (stamRows && stamRows.results) {
        stamRows.results.forEach(r => {
          if (!staminaData[r.clan_id]) staminaData[r.clan_id] = {};
          staminaData[r.clan_id][r.member_name] = r.stamina;
        });
      }

      // Load Bleeding Clans
      const bleedRows = await db.prepare("SELECT clan_id, is_bleeding FROM bleeding_clans").all();
      if (bleedRows && bleedRows.results) {
        bleedRows.results.forEach(r => {
          bleedingClans[r.clan_id] = r.is_bleeding === 1;
        });
      }
    } else {
      reputationHistory = globalState.reputationHistory;
      staminaData = globalState.staminaData;
      bleedingClans = globalState.bleedingClans;
      settings = globalState.settings;
      lastLeaderboard = globalState.lastLeaderboard;
    }

    const activeClans = clans.filter(c => c.reputation > 0);
    const delay = (ms) => new Promise(res => setTimeout(res, ms));

    // Helper to fetch clan members from the game server
    async function fetchMembers(clanId) {
      const url = `https://ninjazenshin.online/clan-ranking/members/${clanId}`;
      try {
        const res = await fetch(url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "application/json"
          }
        });
        if (!res.ok) return null;
        return await res.json();
      } catch (e) {
        return null;
      }
    }

    // Helper to load/save members cache from D1 or in-memory
    async function loadMembersCache(clanId) {
      if (db) {
        const row = await db.prepare("SELECT members_json FROM members_cache WHERE clan_id = ?").bind(clanId).first();
        return row ? JSON.parse(row.members_json) : null;
      }
      return globalState.membersCache[clanId] || null;
    }

    async function saveMembersCache(clanId, cacheData) {
      if (db) {
        await db.prepare("INSERT OR REPLACE INTO members_cache (clan_id, members_json) VALUES (?, ?)").bind(clanId, JSON.stringify(cacheData)).run();
      } else {
        globalState.membersCache[clanId] = cacheData;
      }
    }

    // 3. Establish base member lists for top 10 clans if missing
    const topCount = Math.min(10, activeClans.length);
    for (let i = 0; i < topCount; i++) {
      const clan = activeClans[i];
      let cachedMembers = await loadMembersCache(clan.id);

      if (!cachedMembers) {
        const memberData = await fetchMembers(clan.id);
        if (memberData && memberData.members) {
          const newCache = {};
          if (!staminaData[clan.id]) staminaData[clan.id] = {};
          memberData.members.forEach(m => {
            newCache[m.name] = {
              rep: m.rep || 0,
              level: m.level || "--",
              class: m.class || "--"
            };
            if (staminaData[clan.id][m.name] === undefined) {
              staminaData[clan.id][m.name] = 200;
            }
          });
          await saveMembersCache(clan.id, newCache);
        }
        await delay(100);
      }
    }

    // 4. Scrape and Compare for reputation gains (gains trigger stamina changes)
    const lastClansMap = new Map(lastLeaderboard.clans.map(c => [c.id, c]));
    const newEvents = [];

    for (let i = 0; i < activeClans.length; i++) {
      const clan = activeClans[i];
      const oldClan = lastClansMap.get(clan.id);

      if (!staminaData[clan.id]) staminaData[clan.id] = {};

      if (oldClan && clan.reputation > oldClan.reputation) {
        const memberData = await fetchMembers(clan.id);
        if (memberData && memberData.members) {
          let cachedMembers = await loadMembersCache(clan.id);

          if (cachedMembers) {
             const newCache = {};
             for (const m of memberData.members) {
               newCache[m.name] = {
                 rep: m.rep || 0,
                 level: m.level || "--",
                 class: m.class || "--"
               };

               if (staminaData[clan.id][m.name] === undefined) {
                 staminaData[clan.id][m.name] = 200;
               }

               const oldEntry = cachedMembers[m.name];
               const oldRep = oldEntry !== undefined ? (typeof oldEntry === 'object' ? oldEntry.rep : oldEntry) : undefined;
               const newRep = m.rep || 0;

               if (oldRep !== undefined && newRep > oldRep) {
                const gain = newRep - oldRep;
                const newEv = {
                  timestamp: Date.now(),
                  clanId: clan.id,
                  clanName: clan.name,
                  memberName: m.name,
                  gain: gain,
                  isSystem: false,
                  message: "",
                  important: false
                };
                newEvents.push(newEv);
                reputationHistory.unshift(newEv);

                // B. Attacker loses 10 stamina
                let attackerStamina = staminaData[clan.id][m.name];
                attackerStamina = Math.max(50, attackerStamina - 10);
                staminaData[clan.id][m.name] = attackerStamina;

                // C. Defender loses stamina
                const defRank = settings.defendingTargetRank || 1;
                const defenderClan = clans.find(c => c.rank === defRank);

                if (defenderClan) {
                  const isBleeding = bleedingClans[defenderClan.id] || false;
                  if (!isBleeding) {
                    const partySize = settings.attackPartySize || "solo";
                    const drainCount = partySize === "solo" ? 1 : (partySize === "party1" ? 2 : 3);

                    if (!staminaData[defenderClan.id]) staminaData[defenderClan.id] = {};

                    // Ensure defender members cache is established
                    let defenderCache = await loadMembersCache(defenderClan.id);

                    if (!defenderCache) {
                      const defMemData = await fetchMembers(defenderClan.id);
                      if (defMemData && defMemData.members) {
                        defenderCache = {};
                        defMemData.members.forEach(dm => {
                          defenderCache[dm.name] = {
                            rep: dm.rep || 0,
                            level: dm.level || "--",
                            class: dm.class || "--"
                          };
                          if (staminaData[defenderClan.id][dm.name] === undefined) {
                            staminaData[defenderClan.id][dm.name] = 200;
                          }
                        });
                        await saveMembersCache(defenderClan.id, defenderCache);
                      }
                    }

                    if (defenderCache) {
                      const membersList = Object.keys(defenderCache);
                      membersList.forEach(name => {
                        if (staminaData[defenderClan.id][name] === undefined) {
                          staminaData[defenderClan.id][name] = 200;
                        }
                      });

                      // Sort descending by stamina
                      membersList.sort((a, b) => staminaData[defenderClan.id][b] - staminaData[defenderClan.id][a]);

                      // Deduct stamina from top N highest stamina defenders
                      const N = Math.min(drainCount, membersList.length);
                      for (let d = 0; d < N; d++) {
                        const defenderName = membersList[d];
                        let defStam = staminaData[defenderClan.id][defenderName];
                        defStam = Math.max(50, defStam - 10);
                        staminaData[defenderClan.id][defenderName] = defStam;
                      }

                      // Evaluate defender Bleeding trigger (>= 50% members <= 70)
                      let lowStaminaCount = 0;
                      membersList.forEach(name => {
                        if (staminaData[defenderClan.id][name] <= 70) {
                          lowStaminaCount++;
                        }
                      });

                      if (membersList.length > 0 && (lowStaminaCount / membersList.length) >= 0.50) {
                        bleedingClans[defenderClan.id] = true;

                        const bleedEv = {
                          timestamp: Date.now(),
                          isSystem: true,
                          important: true,
                          message: `[Bleeding State] **${defenderClan.name}** has entered Bleeding State! Stamina drain protection is now active.`
                        };
                        newEvents.push(bleedEv);
                        reputationHistory.unshift(bleedEv);
                      }
                    }
                  }
                }
               }
             }
             await saveMembersCache(clan.id, newCache);
          }
        }
        await delay(100);
      } else if (!oldClan) {
        // Cache initial values for newly visible clans
        const memberData = await fetchMembers(clan.id);
        if (memberData && memberData.members) {
          const newCache = {};
          memberData.members.forEach(m => {
            newCache[m.name] = {
              rep: m.rep || 0,
              level: m.level || "--",
              class: m.class || "--"
            };
            if (staminaData[clan.id][m.name] === undefined) {
              staminaData[clan.id][m.name] = 200;
            }
          });
          await saveMembersCache(clan.id, newCache);
        }
        await delay(100);
      }
    }

    // 5. Stamina Recovery Ticks (+60 every :00 and :30 SGT)
    const nowSgt = getSgtTime();
    const currentTimestamp = Date.now();
    const lastRecoveryTime = settings.lastRecoveryTime || 0;

    if (lastRecoveryTime === 0) {
      settings.lastRecoveryTime = currentTimestamp;
    } else {
      const periodLast = Math.floor(lastRecoveryTime / (30 * 60000));
      const periodNow = Math.floor(currentTimestamp / (30 * 60000));

      if (periodNow > periodLast) {
        let recoveryCount = 0;

        Object.keys(staminaData).forEach(clanId => {
          const clanStamina = staminaData[clanId];
          Object.keys(clanStamina).forEach(name => {
            let stam = clanStamina[name];
            if (stam < 200) {
              stam = Math.min(200, stam + 60);
              clanStamina[name] = stam;
              recoveryCount++;
            }
          });

          // Evaluate bleeding exit (exit only when all members are exactly 200)
          if (bleedingClans[clanId] === true) {
            const clanStamina = staminaData[clanId];
            const membersList = Object.keys(clanStamina);
            const allFullyRecovered = membersList.length > 0 && membersList.every(name => clanStamina[name] === 200);

            if (allFullyRecovered) {
              bleedingClans[clanId] = false;

              const cInfo = clans.find(c => c.id === parseInt(clanId, 10));
              const cName = cInfo ? cInfo.name : `Clan #${clanId}`;

              const bleedExitEv = {
                timestamp: Date.now(),
                isSystem: true,
                important: true,
                message: `[Bleeding Cleared] **${cName}** has fully recovered to 200/200 stamina. Bleeding state is cleared!`
              };
              newEvents.push(bleedExitEv);
              reputationHistory.unshift(bleedExitEv);
            }
          }
        });

        if (recoveryCount > 0) {
          const recEv = {
            timestamp: Date.now(),
            isSystem: true,
            important: false,
            message: `[Stamina Recovery] +60 Stamina restored to all players in the database (Updated: ${recoveryCount} members).`
          };
          newEvents.push(recEv);
          reputationHistory.unshift(recEv);
        }

        settings.lastRecoveryTime = currentTimestamp;
      }
    }

    // 6. Prune Reputation History (retains only events in the last 48 hours)
    const cutOff = Date.now() - 48 * 3600000;
    reputationHistory = reputationHistory.filter(event => event.timestamp >= cutOff);

    // Save updated state back to D1 or memory fallback
    lastLeaderboard = { clans, season, countdownEnd };

    if (db) {
      // A. Save Settings & lastLeaderboard
      await db.batch([
        db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('defendingTargetRank', ?)").bind(settings.defendingTargetRank.toString()),
        db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('attackPartySize', ?)").bind(settings.attackPartySize),
        db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('lastRecoveryTime', ?)").bind(settings.lastRecoveryTime.toString()),
        db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('lastLeaderboard', ?)").bind(JSON.stringify(lastLeaderboard))
      ]);

      // B. Save Stamina data in chunks
      const staminaStatements = [];
      for (const clanId of Object.keys(staminaData)) {
        for (const name of Object.keys(staminaData[clanId])) {
          staminaStatements.push(
            db.prepare("INSERT OR REPLACE INTO stamina (clan_id, member_name, stamina) VALUES (?, ?, ?)")
              .bind(parseInt(clanId, 10), name, staminaData[clanId][name])
          );
        }
      }
      if (staminaStatements.length > 0) {
        for (let i = 0; i < staminaStatements.length; i += 100) {
          await db.batch(staminaStatements.slice(i, i + 100));
        }
      }

      // C. Save Bleeding Clans
      const bleedingStatements = [];
      for (const clanId of Object.keys(bleedingClans)) {
        bleedingStatements.push(
          db.prepare("INSERT OR REPLACE INTO bleeding_clans (clan_id, is_bleeding) VALUES (?, ?)")
            .bind(parseInt(clanId, 10), bleedingClans[clanId] ? 1 : 0)
        );
      }
      if (bleedingStatements.length > 0) {
        await db.batch(bleedingStatements);
      }

      // D. Save new reputation events
      if (newEvents.length > 0) {
        const eventStatements = newEvents.map(e => 
          db.prepare("INSERT INTO reputation_history (timestamp, clan_id, clan_name, member_name, gain, is_system, message, important) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
            .bind(e.timestamp, e.clanId || null, e.clanName || null, e.memberName || null, e.gain || 0, e.isSystem ? 1 : 0, e.message || null, e.important ? 1 : 0)
        );
        await db.batch(eventStatements);
      }

      // E. Prune old database records (older than 48 hours)
      await db.prepare("DELETE FROM reputation_history WHERE timestamp < ?").bind(cutOff).run();

    } else {
      globalState.reputationHistory = reputationHistory;
      globalState.staminaData = staminaData;
      globalState.bleedingClans = bleedingClans;
      globalState.settings = settings;
      globalState.lastLeaderboard = lastLeaderboard;
    }

    return new Response(
      JSON.stringify({
        season,
        countdownEnd,
        clans,
        stamina_data: staminaData,
        bleeding_clans: bleedingClans,
        reputation_history: reputationHistory,
        settings
      }),
      { status: 200, headers: corsHeaders }
    );

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: corsHeaders
    });
  }
}

// Helper to decode basic HTML entities
function decodeHtmlEntities(str) {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#39;/g, "'");
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
