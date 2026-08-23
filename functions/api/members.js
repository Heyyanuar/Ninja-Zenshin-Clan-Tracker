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
  const url = new URL(context.request.url);
  const clanId = url.searchParams.get("clanId");

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

  if (!clanId) {
    return new Response(JSON.stringify({ error: "Missing clanId parameter" }), { status: 400, headers: corsHeaders });
  }

  try {
    const db = context.env.NINJA_D1;
    let cachedMembers = null;

    if (db) {
      // Auto initialize tables if not exist
      await db.exec(`
        CREATE TABLE IF NOT EXISTS members_cache (clan_id INTEGER PRIMARY KEY, members_json TEXT);
      `);
      
      const row = await db.prepare("SELECT members_json FROM members_cache WHERE clan_id = ?").bind(clanId).first();
      cachedMembers = row ? JSON.parse(row.members_json) : null;
    } else {
      cachedMembers = globalState.membersCache[clanId] || null;
    }

    // If we have cached member structures, format it as { members: [...] }
    if (cachedMembers) {
      const memberList = Object.entries(cachedMembers).map(([name, data]) => ({
        name,
        rep: typeof data === 'object' ? data.rep : data,
        level: typeof data === 'object' ? data.level : "--",
        class: typeof data === 'object' ? data.class : "--"
      }));
      return new Response(JSON.stringify({ members: memberList }), { status: 200, headers: corsHeaders });
    }

    // Scrape from game server as fallback
    const targetUrl = `https://ninjazenshin.online/clan-ranking/members/${clanId}`;
    const response = await fetch(targetUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json"
      }
    });

    if (!response.ok) {
      return new Response(JSON.stringify({ error: `Failed to fetch members: ${response.statusText}` }), {
        status: response.status,
        headers: corsHeaders
      });
    }

    const data = await response.json();

    // Cache it
    if (data && data.members) {
      const newCache = {};
      data.members.forEach(m => {
        newCache[m.name] = {
          rep: m.rep || 0,
          level: m.level || "--",
          class: m.class || "--"
        };
      });

      if (db) {
        await db.prepare("INSERT OR REPLACE INTO members_cache (clan_id, members_json) VALUES (?, ?)").bind(clanId, JSON.stringify(newCache)).run();
      } else {
        globalState.membersCache[clanId] = newCache;
      }
    }

    return new Response(JSON.stringify(data), { status: 200, headers: corsHeaders });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
  }
}
