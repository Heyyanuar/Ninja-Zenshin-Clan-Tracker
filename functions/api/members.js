export async function onRequest(context) {
  const url = new URL(context.request.url);
  const clanId = url.searchParams.get("clanId");

  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "public, max-age=15" // cache for 15 seconds to ease load
  };

  if (context.request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders
    });
  }

  if (!clanId) {
    return new Response(JSON.stringify({ error: "Missing clanId parameter" }), {
      status: 400,
      headers: corsHeaders
    });
  }

  const targetUrl = `https://ninjazenshin.online/clan-ranking/members/${clanId}`;

  try {
    const response = await fetch(targetUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json",
        "Accept-Language": "en-US,en;q=0.5"
      }
    });

    if (!response.ok) {
      return new Response(JSON.stringify({ error: `Failed to fetch members: ${response.statusText}` }), {
        status: response.status,
        headers: corsHeaders
      });
    }

    const data = await response.json();
    return new Response(JSON.stringify(data), {
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
