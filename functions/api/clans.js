export async function onRequest(context) {
  const targetUrl = "https://ninjazenshin.online/clan-ranking";

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

  try {
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

    return new Response(JSON.stringify({ season, countdownEnd, clans }), {
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
