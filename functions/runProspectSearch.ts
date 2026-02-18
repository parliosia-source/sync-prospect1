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

async function braveSearch(query, count = 10, offset = 0) {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}&offset=${offset}&extra_snippets=true&country=ca&search_lang=fr`;
  const res = await fetch(url, { headers: { "Accept": "application/json", "X-Subscription-Token": BRAVE_KEY } });
  const data = await res.json();
  return data.web?.results || [];
}

async function serpSearch(query, start = 0) {
  const url = `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(query)}&location=Canada&hl=fr&gl=ca&num=10&start=${start}&api_key=${SERPAPI_KEY}`;
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
  const exclude = '-"agence événementielle" -"event planner" -"planificateur d\'événements" -"organisation d\'événements"';

  const queries = [
    // Event-type driven (core ICP)
    `"conférence annuelle" organisateur ${sector} ${loc} ${exclude}`.trim(),
    `"AGA" OR "assemblée générale annuelle" entreprise ${sector} ${loc} ${exclude}`.trim(),
    `"congrès annuel" association ${sector} ${loc} ${exclude}`.trim(),
    `"gala" OR "cérémonie" entreprise ${sector} ${loc} ${exclude}`.trim(),
    `"formation interne" OR "townhall" organisation ${sector} ${loc} ${exclude}`.trim(),
    `"colloque" OR "symposium" ${sector} ${loc} ${exclude}`.trim(),
    `"journée d'entreprise" OR "journée employés" ${loc} ${sector} ${exclude}`.trim(),
    `"webinaire" OR "webdiffusion" ${sector} ${loc} entreprise ${exclude}`.trim(),

    // Sector-targeted
    `association professionnelle congrès ${loc} ${sector}`.trim(),
    `ordre professionnel assemblée annuelle ${loc} ${sector}`.trim(),
    `chambre de commerce événement corporatif ${loc} membres`.trim(),
    `grande entreprise événement annuel employés ${loc} ${sector}`.trim(),

    // Keyword-boosted (if user added keywords)
    ...(kws ? [
      `"${kws}" événement corporatif ${loc} ${sector} ${exclude}`.trim(),
      `${kws} conférence réunion annuelle ${loc} ${exclude}`.trim(),
    ] : []),

    // Broad fallbacks
    `entreprise ${loc} événements corporatifs annuels ${sector}`.trim(),
    `organisations ${loc} congrès gala AGA ${sector}`.trim(),
    `site:.ca entreprise événement corporatif ${loc} ${sector}`.trim(),
    `filetype:pdf programme conférence annuelle ${loc} ${sector}`.trim(),
  ];

  return queries.filter(q => q.length > 10);
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

isValid = true seulement si: 1) c'est clairement une entreprise/org qui organise ses propres événements, 2) companyName ET website sont présents, 3) ce n'est PAS une agence event planner, organisateur professionnel, ou répertoire de fournisseurs.`
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

  // Also dedup against KB
  let kbDomains = new Set();
  try {
    const kbEntities = await base44.entities.KBEntity.filter({}, "-created_date", 200);
    kbEntities.forEach(e => { if (e.domain) kbDomains.add(e.domain); });
  } catch (_) {}

  let allQueries = buildQueryVariants(campaign, loc);
  let queryIndex = 0;
  let skippedDupe = 0;
  let totalQueriesRun = 0;
  const queryLog = [];

  const runQuery = async (query, maxPages = 3) => {
    for (let page = 0; page < maxPages && created < target; page++) {
      let results = [];
      try { results = await braveSearch(query, 10, page * 10); } catch (_) {}
      if (results.length === 0 && SERPAPI_KEY) {
        try { results = await serpSearch(query, page * 10); } catch (_) {}
      }
      if (results.length === 0) break;

      totalQueriesRun++;
      let pageCreated = 0;

      const batches = [];
      for (let i = 0; i < results.length; i += 5) batches.push(results.slice(i, i + 5));

      for (const batch of batches) {
        if (created >= target) break;
        const normalizations = await Promise.allSettled(batch.map(r => normalizeResult(r).catch(() => null)));
        for (let i = 0; i < normalizations.length; i++) {
          if (created >= target) break;
          const result = normalizations[i];
          if (result.status !== "fulfilled" || !result.value) continue;
          const { normalized, domain } = result.value;
          if (!normalized?.isValid || !normalized?.companyName || !normalized?.website) continue;
          const cleanDomain = extractDomain(normalized.website) || domain;
          if (!cleanDomain) continue;
          if (existingDomains.has(cleanDomain) || kbDomains.has(cleanDomain)) { skippedDupe++; continue; }

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
            serpSnippet: batch[i]?.snippet || "",
            sourceUrl: batch[i]?.url || batch[i]?.link || "",
          });

          existingDomains.add(cleanDomain);
          created++;
          pageCreated++;
        }
      }
      queryLog.push({ query: query.slice(0, 80), page, resultsRaw: results.length, added: pageCreated });
    }
  };

  // Phase 1: run all queries
  while (created < target && queryIndex < allQueries.length) {
    const pct = 10 + Math.round((queryIndex / allQueries.length) * 60);
    await base44.entities.Campaign.update(campaignId, { progressPct: pct, countProspects: created });
    await runQuery(allQueries[queryIndex]);
    queryIndex++;
  }

  // Phase 2: if < 60% of target, run broadened fallback queries
  if (created < target * 0.6) {
    const sector = campaign.industrySectors?.slice(0, 2).join(" ") || "";
    const fallbacks = [
      `organisation ${loc} événement annuel réunion`,
      `entreprise ${loc} ${sector} conférence`,
      `association ${loc} ${sector} membres assemblée`,
      `"${loc}" événements corporatifs B2B prestataires`,
      `chambres de commerce ${loc} membres annuaire`,
    ];
    await base44.entities.Campaign.update(campaignId, { progressPct: 75 });
    for (const q of fallbacks) {
      if (created >= target) break;
      await runQuery(q, 2);
    }
  }

  const finalStatus = created === 0 ? "FAILED" : "COMPLETED";
  const errorMsg = created === 0 ? "Aucun prospect valide trouvé — vérifiez les clés API Brave/SerpAPI" : undefined;

  await base44.entities.Campaign.update(campaignId, {
    status: finalStatus,
    progressPct: 100,
    countProspects: created,
    errorMessage: errorMsg,
    toolUsage: { queries: totalQueriesRun, openai: created, skippedDuplicates: skippedDupe, queryLog: queryLog.slice(0, 30) },
  });

  await base44.entities.ActivityLog.create({
    ownerUserId: user.email,
    actionType: "RUN_PROSPECT_SEARCH",
    entityType: "Campaign",
    entityId: campaignId,
    payload: { created, target, coverage: `${Math.round(created/target*100)}%`, skippedDuplicates: skippedDupe, queriesRun: totalQueriesRun },
    status: created > 0 ? "SUCCESS" : "ERROR",
    errorMessage: errorMsg,
  });

  return Response.json({ success: created > 0, created, target, coverage: Math.round(created/target*100), skippedDuplicates: skippedDupe });
});