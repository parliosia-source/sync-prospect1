import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

async function braveSearch(query, { recencyDays, geo, language, maxResults = 20 }) {
  const apiKey = Deno.env.get("BRAVE_API_KEY");
  const count = Math.min(maxResults, 20);
  const params = new URLSearchParams({
    q: query,
    count: String(count),
    offset: "0",
    result_filter: "web",
  });
  if (language) params.set("ui_lang", language);
  if (geo) params.set("country", geo);
  if (recencyDays) {
    const cutoff = new Date(Date.now() - recencyDays * 86400000);
    params.set("freshness", cutoff.toISOString().split("T")[0]);
  }

  const res = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
    headers: {
      "Accept": "application/json",
      "Accept-Encoding": "gzip",
      "X-Subscription-Token": apiKey,
    },
  });

  if (!res.ok) throw new Error(`Brave ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const results = (data.web?.results || []).map(r => ({
    title: r.title,
    url: r.url,
    snippet: r.description || "",
    source: new URL(r.url).hostname,
    publishedAt: r.age || null,
  }));
  return results;
}

async function serpSearch(query, { recencyDays, geo, language, maxResults = 20 }) {
  const apiKey = Deno.env.get("SERPAPI_API_KEY");
  const params = new URLSearchParams({
    q: query,
    api_key: apiKey,
    engine: "google",
    num: String(Math.min(maxResults, 20)),
    hl: language || "fr",
    gl: geo || "ca",
  });
  if (recencyDays && recencyDays <= 7) params.set("tbs", "qdr:w");
  else if (recencyDays && recencyDays <= 30) params.set("tbs", "qdr:m");
  else if (recencyDays && recencyDays <= 365) params.set("tbs", "qdr:y");

  const res = await fetch(`https://serpapi.com/search?${params}`);
  if (!res.ok) throw new Error(`SerpAPI ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const results = (data.organic_results || []).map(r => ({
    title: r.title,
    url: r.link,
    snippet: r.snippet || "",
    source: new URL(r.link).hostname,
    publishedAt: r.date || null,
  }));
  return results;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const { query, recencyDays, geo, language, maxResults = 20 } = await req.json();
    if (!query) return Response.json({ error: "query is required" }, { status: 400 });

    const opts = { recencyDays, geo, language, maxResults };
    let results = [];
    const used = { brave: false, serpapi: false };

    try {
      results = await braveSearch(query, opts);
      used.brave = true;
    } catch (err) {
      console.error("Brave failed, falling back to SerpAPI:", err.message);
    }

    // Fallback if Brave returned nothing or errored
    if (results.length < 3) {
      try {
        const serpResults = await serpSearch(query, opts);
        // Deduplicate by URL
        const existing = new Set(results.map(r => r.url));
        for (const r of serpResults) {
          if (!existing.has(r.url)) {
            results.push(r);
            existing.add(r.url);
          }
        }
        used.serpapi = true;
      } catch (err) {
        console.error("SerpAPI also failed:", err.message);
        if (!used.brave) return Response.json({ error: "Both search providers failed" }, { status: 502 });
      }
    }

    return Response.json({ query, results: results.slice(0, maxResults), used });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});