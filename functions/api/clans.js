// Initialize global state fallback for local development (no KV namespace bound)
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
    "Cache-Control": "public, max-age=3" // cache for 3 seconds to ease load
  };

  if (context.request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders
    });
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

    // Parse Season
    const seasonMatch = html.match(/<div class="clr-season">([^<]+)<\/div>/i);
    const season = seasonMatch ? seasonMatch[1].trim() : "Season 0";

    // Parse Countdown
    const countdownMatch = html.match(/<div class="clr-cd"[^>]*data-end="([^"]+)"/i);
    const countdownEnd = countdownMatch ? countdownMatch[1] : "";

    // Parse Clans List
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

    // 2. Read KV Database / Global State
    const db = context.env.NINJA_DB;
    let reputationHistory = [];
    let staminaData = {};
    let bleedingClans = {};
    let settings = { defendingTargetRank: 1, attackPartySize: "solo", lastRecoveryTime: 0 };
    let lastLeaderboard = { clans: [] };

    if (db) {
      reputationHistory = JSON.parse(await db.get("reputation_history") || "[]");
      staminaData = JSON.parse(await db.get("stamina_data") || "{}");
      bleedingClans = JSON.parse(await db.get("bleeding_clans") || "{}");
      settings = JSON.parse(await db.get("settings") || '{"defendingTargetRank":1,"attackPartySize":"solo","lastRecoveryTime":0}');
      lastLeaderboard = JSON.parse(await db.get("last_leaderboard") || '{"clans":[]}');
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

    // 3. Establish base member lists for top 10 clans if missing
    const topCount = Math.min(10, activeClans.length);
    for (let i = 0; i < topCount; i++) {
      const clan = activeClans[i];
      let cachedMembers = null;
      if (db) {
        cachedMembers = JSON.parse(await db.get(`members_cache_${clan.id}`) || "null");
      } else {
        cachedMembers = globalState.membersCache[clan.id] || null;
      }

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

          if (db) {
            await db.put(`members_cache_${clan.id}`, JSON.stringify(newCache));
          } else {
            globalState.membersCache[clan.id] = newCache;
          }
        }
        await delay(100);
      }
    }

    // 4. Scrape and Compare for reputation gains (gains trigger stamina changes)
    const lastClansMap = new Map(lastLeaderboard.clans.map(c => [c.id, c]));

    for (let i = 0; i < activeClans.length; i++) {
      const clan = activeClans[i];
      const oldClan = lastClansMap.get(clan.id);

      if (!staminaData[clan.id]) staminaData[clan.id] = {};

      if (oldClan && clan.reputation > oldClan.reputation) {
        const memberData = await fetchMembers(clan.id);
        if (memberData && memberData.members) {
          let cachedMembers = null;
          if (db) {
            cachedMembers = JSON.parse(await db.get(`members_cache_${clan.id}`) || "null");
          } else {
            cachedMembers = globalState.membersCache[clan.id] || null;
          }

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

                // A. Record gain event in log history
                reputationHistory.unshift({
                  timestamp: Date.now(),
                  clanId: clan.id,
                  clanName: clan.name,
                  memberName: m.name,
                  gain: gain
                });

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
                    let defenderCache = null;
                    if (db) {
                      defenderCache = JSON.parse(await db.get(`members_cache_${defenderClan.id}`) || "null");
                    } else {
                      defenderCache = globalState.membersCache[defenderClan.id] || null;
                    }

                    if (!defenderCache) {
                      const defMemData = await fetchMembers(defenderClan.id);
                      if (defMemData && defMemData.members) {
                        defenderCache = {};
                        defMemData.members.forEach(dm => {
                          defenderCache[dm.name] = dm.rep || 0;
                          if (staminaData[defenderClan.id][dm.name] === undefined) {
                            staminaData[defenderClan.id][dm.name] = 200;
                          }
                        });
                        if (db) {
                          await db.put(`members_cache_${defenderClan.id}`, JSON.stringify(defenderCache));
                        } else {
                          globalState.membersCache[defenderClan.id] = defenderCache;
                        }
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

                        reputationHistory.unshift({
                          timestamp: Date.now(),
                          isSystem: true,
                          important: true,
                          message: `[Bleeding State] **${defenderClan.name}** has entered Bleeding State! Stamina drain protection is now active.`
                        });
                      }
                    }
                  }
                }
              }
            }

            if (db) {
              await db.put(`members_cache_${clan.id}`, JSON.stringify(newCache));
            } else {
              globalState.membersCache[clan.id] = newCache;
            }
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
          if (db) {
            await db.put(`members_cache_${clan.id}`, JSON.stringify(newCache));
          } else {
            globalState.membersCache[clan.id] = newCache;
          }
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

              reputationHistory.unshift({
                timestamp: Date.now(),
                isSystem: true,
                important: true,
                message: `[Bleeding Cleared] **${cName}** has fully recovered to 200/200 stamina. Bleeding state is cleared!`
              });
            }
          }
        });

        if (recoveryCount > 0) {
          reputationHistory.unshift({
            timestamp: Date.now(),
            isSystem: true,
            important: false,
            message: `[Stamina Recovery] +60 Stamina restored to all players in the database (Updated: ${recoveryCount} members).`
          });
        }

        settings.lastRecoveryTime = currentTimestamp;
      }
    }

    // 6. Prune Reputation History (retains only events in the last 48 hours)
    const cutOff = Date.now() - 48 * 3600000;
    reputationHistory = reputationHistory.filter(event => event.timestamp >= cutOff);

    // Save updated state back to KV
    lastLeaderboard = { clans, season, countdownEnd };

    if (db) {
      await db.put("reputation_history", JSON.stringify(reputationHistory));
      await db.put("stamina_data", JSON.stringify(staminaData));
      await db.put("bleeding_clans", JSON.stringify(bleedingClans));
      await db.put("settings", JSON.stringify(settings));
      await db.put("last_leaderboard", JSON.stringify(lastLeaderboard));
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
