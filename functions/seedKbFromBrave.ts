import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const BRAVE_KEY = Deno.env.get("BRAVE_API_KEY");

const braveRLState = { remaining: -1, reset: -1, count429: 0 };

function parseBraveHeaders(res) {
  const remaining = parseInt(res.headers.get("X-RateLimit-Remaining") || "-1", 10);
  const reset = parseInt(res.headers.get("X-RateLimit-Reset") || "-1", 10);
  if (remaining !== -1) braveRLState.remaining = remaining;
  if (reset !== -1) braveRLState.reset = reset;
}

async function waitForBraveReset(minWaitMs = 1000) {
  const waitMs = braveRLState.reset > 0 ? Math.max(braveRLState.reset * 1000, minWaitMs) : minWaitMs;
  await new Promise(r => setTimeout(r, waitMs));
}

async function braveSearch(query, count = 10, offset = 0, retries = 2) {
  if (!BRAVE_KEY) return [];
  if (braveRLState.remaining === 0 && braveRLState.reset > 0) await waitForBraveReset();
  
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}&offset=${offset}&extra_snippets=true&country=ca&search_lang=fr`;
  
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(url, { headers: { "Accept": "application/json", "X-Subscription-Token": BRAVE_KEY } });
      parseBraveHeaders(res);
      if (res.status === 429) {
        braveRLState.count429++;
        if (attempt < retries - 1) { await waitForBraveReset(Math.pow(2, attempt) * 1000); continue; }
        return [];
      }
      if (!res.ok) return [];
      if (braveRLState.remaining === 0) await waitForBraveReset(1000);
      const data = await res.json();
      return data.web?.results || [];
    } catch (_) { return []; }
  }
  return [];
}

function shouldRejectNoise(url, title, snippet) {
  const noise = /blog|news|press|article|actualité|calendar|agenda|event|venue|hotel|salle|agence événementielle|annuaire|directory|pages jaunes|pdf/i;
  return noise.test(url) || noise.test(title) || noise.test(snippet);
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user || user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

  const { locationKey, targetPerSector, maxBraveQueries, maxNewKb, seedConfigs, dryRun } = await req.json();
  if (!Array.isArray(seedConfigs) || seedConfigs.length === 0) return Response.json({ error: 'seedConfigs required' }, { status: 400 });

  const START_TIME = Date.now();
  const MAX_DURATION_MS = 90_000;
  const target = targetPerSector || 300;
  const maxQueries = maxBraveQueries || 250;
  const maxNew = maxNewKb || 1500;

  let totalCreated = 0, totalBraveQueries = 0;
  const results = [];
  const existingDomains = new Set((await base44.entities.KBEntity.filter({}, '-created_date', 2000)).map(e => e.domain));

  for (const config of seedConfigs) {
    if (Date.now() - START_TIME > MAX_DURATION_MS || totalBraveQueries >= maxQueries || totalCreated >= maxNew) break;
    
    const { sector, seedQueries } = config;
    const locQueries = seedQueries[locationKey] || [];
    let sectorCreated = 0, candidates = 0, rejectedNoise = 0, rejectedSector = 0, updatedExisting = 0;

    for (const query of locQueries) {
      if (totalBraveQueries >= maxQueries || totalCreated >= maxNew) break;
      
      const results = await braveSearch(query, 10);
      totalBraveQueries++;
      candidates += results.length;

      for (const r of results) {
        if (totalCreated >= maxNew) break;
        
        const url = r.url || '';
        const title = r.title || '';
        const snippet = r.snippet || '';
        
        if (shouldRejectNoise(url, title, snippet)) { rejectedNoise++; continue; }
        
        const hostname = new URL(url, 'https://example.com').hostname || '';
        const domain = hostname.replace(/^www\./, '').toLowerCase();
        if (!domain) { rejectedSector++; continue; }
        if (existingDomains.has(domain)) { rejectedSector++; continue; }
        
        const companyName = title.split('-')[0].trim() || domain;
        
        if (!dryRun) {
          try {
            const existing = await base44.entities.KBEntity.filter({ domain }).catch(() => []);
            if (existing.length > 0) {
              updatedExisting++;
            } else {
              await base44.entities.KBEntity.create({
                name: companyName,
                domain,
                website: url,
                hqLocation: locationKey === 'MTL' ? 'Montréal, Québec' : 'Québec, Canada',
                entityType: 'COMPANY',
                tags: [sector, locationKey === 'MTL' ? 'Montréal' : 'Québec', 'Canada'],
                notes: snippet || '',
                source: 'Brave Seeder',
                industrySectors: [sector],
                industryLabel: sector,
                seedBatchId: `BRAVE_SEED_${locationKey}_${Date.now()}`,
              });
              sectorCreated++;
              totalCreated++;
            }
          } catch (_) {}
        } else {
          sectorCreated++;
          totalCreated++;
        }
        existingDomains.add(domain);
      }
    }

    results.push({
      sector,
      locationKey,
      braveQueriesUsed: locQueries.length,
      candidates,
      rejectedNoise,
      rejectedSector,
      accepted: sectorCreated,
      updatedExisting,
    });
  }

  return Response.json({
    success: true,
    summary: { totalBraveQueries, totalCreated, durationMs: Date.now() - START_TIME },
    results,
    dryRun,
  });
});