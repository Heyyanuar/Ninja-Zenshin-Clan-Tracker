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
    const db = context.env.NINJA_DB;
    const body = await context.request.json();
    
    // Read current settings and stamina
    let settings = { defendingTargetRank: 1, attackPartySize: "solo", lastRecoveryTime: 0 };
    let staminaData = {};
    let bleedingClans = {};
    let reputationHistory = [];

    if (db) {
      settings = JSON.parse(await db.get("settings") || '{"defendingTargetRank":1,"attackPartySize":"solo","lastRecoveryTime":0}');
      staminaData = JSON.parse(await db.get("stamina_data") || "{}");
      bleedingClans = JSON.parse(await db.get("bleeding_clans") || "{}");
      reputationHistory = JSON.parse(await db.get("reputation_history") || "[]");
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
      
      reputationHistory.unshift({
        timestamp: Date.now(),
        isSystem: true,
        important: false,
        message: `[Config Update] Settings updated: Defending Target = Rank ${settings.defendingTargetRank}, Party Size = ${settings.attackPartySize}`
      });
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
        
        reputationHistory.unshift({
          timestamp: Date.now(),
          isSystem: true,
          important: true,
          message: `[Manual Reset] **${clanName}** members reset to 200 Stamina (Bleeding cleared).`
        });
      }
    }
    else if (body.action === "overrideMember") {
      const clanId = body.clanId;
      const memberName = body.memberName;
      const newStamina = parseInt(body.stamina, 10);
      
      if (clanId && memberName && !isNaN(newStamina)) {
        if (!staminaData[clanId]) staminaData[clanId] = {};
        staminaData[clanId][memberName] = newStamina;
        
        reputationHistory.unshift({
          timestamp: Date.now(),
          isSystem: true,
          important: false,
          message: `[Manual Override] **${memberName}** stamina set to ${newStamina}.`
        });
        
        // Re-evaluate bleeding status for the clan
        const membersList = Object.keys(staminaData[clanId]);
        let lowStaminaCount = 0;
        membersList.forEach(name => {
          if (staminaData[clanId][name] <= 70) lowStaminaCount++;
        });
        
        if (membersList.length > 0 && (lowStaminaCount / membersList.length) >= 0.50) {
          bleedingClans[clanId] = true;
          
          reputationHistory.unshift({
            timestamp: Date.now(),
            isSystem: true,
            important: true,
            message: `[Bleeding State] **${body.clanName || ('Clan #' + clanId)}** has entered Bleeding State! Stamina drain protection is now active.`
          });
        } else {
          // If bleeding, exit only when all members are exactly 200
          if (bleedingClans[clanId] === true) {
            const allFullyRecovered = membersList.every(name => staminaData[clanId][name] === 200);
            if (allFullyRecovered) {
              bleedingClans[clanId] = false;
              
              reputationHistory.unshift({
                timestamp: Date.now(),
                isSystem: true,
                important: true,
                message: `[Bleeding Cleared] **${body.clanName || ('Clan #' + clanId)}** has fully recovered to 200/200 stamina. Bleeding state is cleared!`
              });
            }
          }
        }
      }
    }

    if (db) {
      await db.put("settings", JSON.stringify(settings));
      await db.put("stamina_data", JSON.stringify(staminaData));
      await db.put("bleeding_clans", JSON.stringify(bleedingClans));
      await db.put("reputation_history", JSON.stringify(reputationHistory));
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
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
  }
}
