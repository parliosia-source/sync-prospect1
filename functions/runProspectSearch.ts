import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY");
const BRAVE_KEY = Deno.env.get("BRAVE_API_KEY");
const SERPAPI_KEY = Deno.env.get("SERPAPI_API_KEY");

async function callOpenAI(prompt) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "Tu es un assistant de prospection B2B pour SYNC Productions (Montréal). Tu réponds UNIQUEMENT en JSON strict, sans texte autour. Tu n'inventes pas de faits. Si une info n'est pas disponible, tu mets null." },
        { role: "user", content: prompt }
      ],
      response_format: { type: "json_object" },
    })
  });
  const data = await res.json();
  return JSON.parse(data.choices[0].message.content);
}

async function braveSearch(query, count = 10) {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}&extra_snippets=true&country=ca&search_lang=fr`;
  const res = await fetch(url, { headers: { "Accept": "application/json", "X-Subscription-Token": BRAVE_KEY } });
  const data = await res.json();
  return data.web?.results || [];
}

async function serpSearch(query) {
  const url = `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(query)}&location=Canada&hl=fr&gl=ca&num=10&api_key=${SERPAPI_KEY}`;
  const res = await fetch(url);
  const data = await res.json();
  return data.organic_results || [];
}

function extractDomain(url) {
  try {
    const u = new URL(url.startsWith("http") ? url : "https://" + url);
    return u.hostname.replace("www.", "");
  } catch { return null; }
}

function buildQueryVariants(campaign, loc) {
  const sector = campaign.industrySectors?.slice(0, 2).join(" ") || "";
  const kws = campaign.keywords?.slice(0, 3).join(" ") || "";
  const eventTypes = [
    ["conférence annuelle", "congrès", "AGA assemblée annuelle"],
    ["gala cérémonie", "colloque", "formation interne"],
    ["townhall réunion annuelle", "symposium", "sommet"],
  ];
  const queries = [];
  for (const evGroup of eventTypes) {
    for (const ev of evGroup) {
      queries.push(
        `"${ev}" organisateur ${sector} ${loc} ${kws} -"agence événementielle" -"event planner"`.trim()
      );
    }
  }
  // Additional broader queries to boost count
  queries.push(`entreprise organisation "${loc}" événements corporatifs annuel ${sector}`);
  queries.push(`association ordre professionnel "${loc}" congrès AGA ${sector}`);
  queries.push(`site:*.ca OR site:*.org événement corporatif ${loc} ${sector} ${kws}`);
  return queries;
}

async function normalizeResult(r) {
  const url = r.url || r.link;
  if (!url) return null;
  const domain = extractDomain(url);
  if (!domain) return null;
  const normalized = await callOpenAI(
    `Voici un résultat de recherche web. Extrais les infos de l'entreprise si c'est une entreprise/organisation qui ORGANISE ses propres événements corporatifs (pas une agence event planner).

URL: ${url}
Titre: ${r.title || ""}
Snippet: ${r.snippet || ""} ${(r.extra_snippets || []).slice(0, 2).join(" ")}

Réponds en JSON: { "companyName": string|null, "website": string|null, "domain": string|null, "industry": string|null, "location": {"city":string,"region":string,"country":string}, "entityType": "COMPANY|ASSOCIATION|PROFESSIONAL_ORG|GOV|OTHER", "isValid": boolean, "reason": string }

isValid = true seulement si: 1) c'est clairement une entreprise/org qui organise ses propres événements, 2) companyName ET website sont présents, 3) ce n'est PAS une agence event planner ou organisateur professionnel.`
  );
  return { normalized, domain };
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { campaignId } = await req.json();
  if (!campaignId) return Response.json({ error: "campaignId requis" }, { status: 400 });

  const campaigns = await base44.entities.Campaign.filter({ id: campaignId });
  const campaign = campaigns[0];
  if (!campaign) return Response.json({ error: "Campagne introuvable" }, { status: 404 });
  if (campaign.ownerUserId !== user.email && user.role !== "admin") return Response.json({ error: "Forbidden" }, { status: 403 });

  await base44.entities.Campaign.update(campaignId, { status: "RUNNING", progressPct: 5, lastRunAt: new Date().toISOString() });

  const loc = campaign.locationQuery || "Montréal";
  const target = campaign.targetCount || 50;

  // Collect existing domains for dedup
  const existing = await base44.entities.Prospect.filter({ campaignId });
  const existingDomains = new Set(existing.map(p => p.domain).filter(Boolean));
  let created = existing.length;

  // Include KB entities as additional dedup + query enrichment
  let kbDomains = new Set();
  try {
    const kbEntities = await base44.entities.KBEntity.filter({}, "-created_date", 200);
    kbEntities.forEach(e => { if (e.domain) kbDomains.add(e.domain); });
  } catch (_) {}

  const queries = buildQueryVariants(campaign, loc);
  let queryIndex = 0;
  let skippedDupe = 0;

  while (created < target && queryIndex < queries.length) {
    const pct = 10 + Math.round((queryIndex / queries.length) * 70);
    await base44.entities.Campaign.update(campaignId, { progressPct: pct });

    let results = [];
    try { results = await braveSearch(queries[queryIndex], 10); } catch (_) {}
    if (results.length === 0 && SERPAPI_KEY) {
      try { results = await serpSearch(queries[queryIndex]); } catch (_) {}
    }

    // Normalize results in parallel (max 5 at a time)
    const batch = results.slice(0, 10);
    const normalizations = await Promise.allSettled(batch.map(r => normalizeResult(r).catch(() => null)));

    for (let i = 0; i < normalizations.length; i++) {
      if (created >= target) break;
      const result = normalizations[i];
      if (result.status !== "fulfilled" || !result.value) continue;
      const { normalized, domain } = result.value;
      if (!normalized?.isValid || !normalized?.companyName || !normalized?.website) continue;
      const cleanDomain = extractDomain(normalized.website) || domain;
      if (!cleanDomain) continue;
      if (existingDomains.has(cleanDomain) || kbDomains.has(cleanDomain)) {
        skippedDupe++;
        continue;
      }

      await base44.entities.Prospect.create({
        campaignId,
        ownerUserId: campaign.ownerUserId,
        companyName: normalized.companyName,
        website: normalized.website,
        domain: cleanDomain,
        industry: normalized.industry,
        location: normalized.location,
        entityType: normalized.entityType,
        status: "NOUVEAU",
        serpSnippet: results[i]?.snippet || "",
        sourceUrl: results[i]?.url || results[i]?.link || "",
      });

      existingDomains.add(cleanDomain);
      created++;
    }

    queryIndex++;
  }

  await base44.entities.Campaign.update(campaignId, {
    status: "COMPLETED",
    progressPct: 100,
    countProspects: created,
    toolUsage: { brave: queryIndex, openai: created, skippedDuplicates: skippedDupe },
  });

  await base44.entities.ActivityLog.create({
    ownerUserId: user.email,
    actionType: "RUN_PROSPECT_SEARCH",
    entityType: "Campaign",
    entityId: campaignId,
    payload: { created, target, skippedDuplicates: skippedDupe, queriesRun: queryIndex },
    status: "SUCCESS",
  });

  return Response.json({ success: true, created, target, skippedDuplicates: skippedDupe });
});