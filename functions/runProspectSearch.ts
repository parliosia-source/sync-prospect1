import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY");
const BRAVE_KEY = Deno.env.get("BRAVE_API_KEY");
const SERPAPI_KEY = Deno.env.get("SERPAPI_API_KEY");
const HUNTER_KEY = Deno.env.get("HUNTER_API_KEY");

async function callOpenAI(prompt, schema) {
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

async function hunterDomainSearch(domain, company) {
  const url = `https://api.hunter.io/v2/domain-search?domain=${domain}&company=${encodeURIComponent(company || "")}&limit=5&api_key=${HUNTER_KEY}`;
  const res = await fetch(url);
  const data = await res.json();
  return data;
}

function extractDomain(url) {
  try {
    const u = new URL(url.startsWith("http") ? url : "https://" + url);
    return u.hostname.replace("www.", "");
  } catch { return null; }
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

  // Build search queries
  const eventTypes = ["conférence", "congrès", "AGA", "gala", "formation", "colloque", "assemblée annuelle", "townhall"];
  const sector = campaign.industrySectors?.slice(0, 2).join(" ") || "";
  const loc = campaign.locationQuery || "Montréal";
  const kws = campaign.keywords?.slice(0, 3).join(" ") || "";

  const queries = eventTypes.slice(0, 3).map(ev =>
    `site:*.ca OR site:*.com ("${ev}" OR "événement corporatif" OR "événement annuel") ${sector} ${loc} ${kws} -"event planner" -"agence événementielle"`
  );

  // Collect existing domains for dedup
  const existing = await base44.entities.Prospect.filter({ campaignId });
  const existingDomains = new Set(existing.map(p => p.domain).filter(Boolean));

  let created = existing.length;
  const target = campaign.targetCount || 50;

  for (let qi = 0; qi < queries.length && created < target; qi++) {
    const pct = 10 + Math.round((qi / queries.length) * 60);
    await base44.entities.Campaign.update(campaignId, { progressPct: pct });

    let results = [];
    try { results = await braveSearch(queries[qi], 10); } catch (_) {}
    if (results.length === 0 && SERPAPI_KEY) {
      try { results = await serpSearch(queries[qi]); } catch (_) {}
    }

    for (const r of results) {
      if (created >= target) break;
      const url = r.url || r.link;
      if (!url) continue;
      const domain = extractDomain(url);
      if (!domain || existingDomains.has(domain)) continue;

      // Normalize with OpenAI
      let normalized = null;
      try {
        normalized = await callOpenAI(
          `Voici un résultat de recherche web. Extrais les infos de l'entreprise si c'est une entreprise/organisation qui ORGANISE ses propres événements corporatifs (pas une agence event planner).
          
URL: ${url}
Titre: ${r.title || ""}
Snippet: ${r.snippet || ""} ${(r.extra_snippets || []).slice(0,2).join(" ")}

Réponds en JSON: { "companyName": string|null, "website": string|null, "domain": string|null, "industry": string|null, "location": {"city":string,"region":string,"country":string}, "entityType": "COMPANY|ASSOCIATION|PROFESSIONAL_ORG|GOV|OTHER", "isValid": boolean, "reason": string }

isValid = true seulement si: 1) c'est clairement une entreprise/org qui organise ses propres événements, 2) companyName ET website sont présents, 3) ce n'est PAS une agence event planner ou organisateur professionnel.`,
          {}
        );
      } catch (_) { continue; }

      if (!normalized?.isValid || !normalized?.companyName || !normalized?.website) continue;
      const cleanDomain = extractDomain(normalized.website) || domain;
      if (existingDomains.has(cleanDomain)) continue;

      // Create prospect
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
        serpSnippet: r.snippet || "",
        sourceUrl: url,
      });

      existingDomains.add(cleanDomain);
      created++;
    }
  }

  // Hunt contacts for qualified prospects (quota-safe)
  await base44.entities.Campaign.update(campaignId, { progressPct: 85 });

  await base44.entities.Campaign.update(campaignId, {
    status: "COMPLETED",
    progressPct: 100,
    countProspects: created,
    toolUsage: { brave: queries.length, openai: created },
  });

  await base44.entities.ActivityLog.create({
    ownerUserId: user.email,
    actionType: "RUN_PROSPECT_SEARCH",
    entityType: "Campaign",
    entityId: campaignId,
    payload: { created, target },
    status: "SUCCESS",
  });

  return Response.json({ success: true, created });
});