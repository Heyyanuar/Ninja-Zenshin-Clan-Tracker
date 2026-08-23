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
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json; charset=utf-8"
  };

  if (context.request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (context.request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: corsHeaders });
  }

  try {
    const db = context.env.NINJA_D1;
    const body = await context.request.json();
    
    // Read current settings and stamina
    let settings = { defendingTargetRank: 1, attackPartySize: "solo", lastRecoveryTime: 0 };
    let staminaData = {};
    let bleedingClans = {};
    let reputationHistory = [];
    const newEvents = [];

    if (db) {
      // Auto initialize tables if not exist
      await db.exec(`
        CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
        CREATE TABLE IF NOT EXISTS stamina (clan_id INTEGER, member_name TEXT, stamina INTEGER, PRIMARY KEY (clan_id, member_name));
        CREATE TABLE IF NOT EXISTS reputation_history (id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp INTEGER, clan_id INTEGER, clan_name TEXT, member_name TEXT, gain INTEGER, is_system INTEGER, message TEXT, important INTEGER);
        CREATE TABLE IF NOT EXISTS bleeding_clans (clan_id INTEGER PRIMARY KEY, is_bleeding INTEGER);
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
      settings = globalState.settings;
      staminaData = globalState.staminaData;
      bleedingClans = globalState.bleedingClans;
      reputationHistory = globalState.reputationHistory;
    }

    if (body.action === "updateSettings") {
      if (body.defendingTargetRank !== undefined) {
        settings.defendingTargetRank = parseInt(body.defendingTargetRank, 10);
      }
      if (body.attackPartySize !== undefined) {
        settings.attackPartySize = body.attackPartySize;
      }
      
      const configEv = {
        timestamp: Date.now(),
        isSystem: true,
        important: false,
        message: `[Config Update] Settings updated: Defending Target = Rank ${settings.defendingTargetRank}, Party Size = ${settings.attackPartySize}`
      };
      newEvents.push(configEv);
      reputationHistory.unshift(configEv);
    } 
    else if (body.action === "resetClan") {
      const clanId = body.clanId;
      const clanName = body.clanName || `Clan #${clanId}`;
      if (clanId) {
        if (!staminaData[clanId]) staminaData[clanId] = {};
        Object.keys(staminaData[clanId]).forEach(name => {
          staminaData[clanId][name] = 200;
        });
        bleedingClans[clanId] = false;
        
        const resetEv = {
          timestamp: Date.now(),
          isSystem: true,
          important: true,
          message: `[Manual Reset] **${clanName}** members reset to 200 Stamina (Bleeding cleared).`
        };
        newEvents.push(resetEv);
        reputationHistory.unshift(resetEv);
      }
    }
    else if (body.action === "overrideMember") {
      const clanId = body.clanId;
      const memberName = body.memberName;
      const newStamina = parseInt(body.stamina, 10);
      
      if (clanId && memberName && !isNaN(newStamina)) {
        if (!staminaData[clanId]) staminaData[clanId] = {};
        staminaData[clanId][memberName] = newStamina;
        
        const overrideEv = {
          timestamp: Date.now(),
          isSystem: true,
          important: false,
          message: `[Manual Override] **${memberName}** stamina set to ${newStamina}.`
        };
        newEvents.push(overrideEv);
        reputationHistory.unshift(overrideEv);
        
        // Re-evaluate bleeding status for the clan
        const membersList = Object.keys(staminaData[clanId]);
        let lowStaminaCount = 0;
        membersList.forEach(name => {
          if (staminaData[clanId][name] <= 70) lowStaminaCount++;
        });
        
        if (membersList.length > 0 && (lowStaminaCount / membersList.length) >= 0.50) {
          bleedingClans[clanId] = true;
          
          const bleedEv = {
            timestamp: Date.now(),
            isSystem: true,
            important: true,
            message: `[Bleeding State] **${body.clanName || ('Clan #' + clanId)}** has entered Bleeding State! Stamina drain protection is now active.`
          };
          newEvents.push(bleedEv);
          reputationHistory.unshift(bleedEv);
        } else {
          // If bleeding, exit only when all members are exactly 200
          if (bleedingClans[clanId] === true) {
            const allFullyRecovered = membersList.every(name => staminaData[clanId][name] === 200);
            if (allFullyRecovered) {
              bleedingClans[clanId] = false;
              
              const bleedExitEv = {
                timestamp: Date.now(),
                isSystem: true,
                important: true,
                message: `[Bleeding Cleared] **${body.clanName || ('Clan #' + clanId)}** has fully recovered to 200/200 stamina. Bleeding state is cleared!`
              };
              newEvents.push(bleedExitEv);
              reputationHistory.unshift(bleedExitEv);
            }
          }
        }
      }
    }

    if (db) {
      // A. Save Settings
      await db.batch([
        db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('defendingTargetRank', ?)").bind(settings.defendingTargetRank.toString()),
        db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('attackPartySize', ?)").bind(settings.attackPartySize),
        db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('lastRecoveryTime', ?)").bind(settings.lastRecoveryTime.toString())
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
    } else {
      globalState.settings = settings;
      globalState.staminaData = staminaData;
      globalState.bleedingClans = bleedingClans;
      globalState.reputationHistory = reputationHistory;
    }

    return new Response(JSON.stringify({ success: true, settings, stamina_data: staminaData, bleeding_clans: bleedingClans }), {
      status: 200,
      headers: corsHeaders
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: corsHeaders
    });
  }
}
