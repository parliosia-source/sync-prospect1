import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const BRAVE_KEY = Deno.env.get("BRAVE_API_KEY");
const SERPAPI_KEY = Deno.env.get("SERPAPI_API_KEY");

async function braveSearch(query, count = 10, offset = 0, geo = "ca", lang = "fr") {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}&offset=${offset}&country=${geo}&search_lang=${lang}&extra_snippets=true`;
  const res = await fetch(url, {
    headers: { "Accept": "application/json", "X-Subscription-Token": BRAVE_KEY }
  });
  if (!res.ok) return { results: [], ok: false };
  const data = await res.json();
  const raw = data.web?.results || [];
  return {
    ok: true,
    results: raw.map(r => ({
      title: r.title || "",
      url: r.url || "",
      snippet: (r.description || "") + (r.extra_snippets?.length ? " " + r.extra_snippets.slice(0, 2).join(" ") : ""),
      source: new URL(r.url).hostname.replace("www.", ""),
      publishedAt: r.page_age || null,
    }))
  };
}

async function serpSearch(query, start = 0, geo = "ca", lang = "fr") {
  const url = `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(query)}&location=Canada&hl=${lang}&gl=${geo}&num=10&start=${start}&api_key=${SERPAPI_KEY}`;
  const res = await fetch(url);
  if (!res.ok) return { results: [], ok: false };
  const data = await res.json();
  const raw = data.organic_results || [];
  return {
    ok: true,
    results: raw.map(r => ({
      title: r.title || "",
      url: r.link || "",
      snippet: r.snippet || "",
      source: r.displayed_link || (r.link ? new URL(r.link).hostname.replace("www.", "") : ""),
      publishedAt: r.date || null,
    }))
  };
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { query, recencyDays, geo = "ca", language = "fr", maxResults = 20 } = await req.json();
  if (!query) return Response.json({ error: "query requis" }, { status: 400 });

  const seenUrls = new Set();
  const allResults = [];
  const used = { brave: false, serpapi: false };

  const addResults = (results) => {
    for (const r of results) {
      if (!r.url || seenUrls.has(r.url)) continue;
      seenUrls.add(r.url);
      allResults.push(r);
    }
  };

  // Try Brave first — up to 2 pages
  const pagesNeeded = Math.ceil(maxResults / 10);
  let braveOk = false;
  for (let page = 0; page < pagesNeeded && allResults.length < maxResults; page++) {
    const brave = await braveSearch(query, 10, page * 10, geo, language);
    if (brave.ok && brave.results.length > 0) {
      addResults(brave.results);
      braveOk = true;
    }
    if (!brave.ok) break;
  }
  if (braveOk) used.brave = true;

  // Fallback or supplement with SerpAPI if not enough results
  if (allResults.length < Math.min(maxResults, 8) && SERPAPI_KEY) {
    for (let page = 0; page < 2 && allResults.length < maxResults; page++) {
      const serp = await serpSearch(query, page * 10, geo, language);
      if (serp.ok && serp.results.length > 0) {
        addResults(serp.results);
        used.serpapi = true;
      }
      if (!serp.ok) break;
    }
  }

  // Apply recency filter if requested (best-effort based on publishedAt)
  let filtered = allResults;
  if (recencyDays && recencyDays > 0) {
    const cutoff = Date.now() - recencyDays * 24 * 60 * 60 * 1000;
    const recent = allResults.filter(r => {
      if (!r.publishedAt) return true; // keep if unknown date
      try { return new Date(r.publishedAt).getTime() >= cutoff; } catch { return true; }
    });
    if (recent.length >= 3) filtered = recent;
  }

  return Response.json({
    query,
    results: filtered.slice(0, maxResults),
    total: filtered.length,
    used,
  });
});