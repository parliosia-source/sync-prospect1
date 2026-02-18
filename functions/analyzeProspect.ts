import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY");
const HUNTER_KEY = Deno.env.get("HUNTER_API_KEY");

async function callOpenAI(messages) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages,
      response_format: { type: "json_object" },
    })
  });
  const data = await res.json();
  return JSON.parse(data.choices[0].message.content);
}

async function hunterDomainSearch(domain, company) {
  const url = `https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(domain)}&company=${encodeURIComponent(company || "")}&limit=5&api_key=${HUNTER_KEY}`;
  const res = await fetch(url);
  return res.json();
}

async function hunterEmailFinder(domain, firstName, lastName) {
  const url = `https://api.hunter.io/v2/email-finder?domain=${encodeURIComponent(domain)}&first_name=${encodeURIComponent(firstName || "")}&last_name=${encodeURIComponent(lastName || "")}&api_key=${HUNTER_KEY}`;
  const res = await fetch(url);
  return res.json();
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { prospectId } = await req.json();
  if (!prospectId) return Response.json({ error: "prospectId requis" }, { status: 400 });

  const prospects = await base44.entities.Prospect.filter({ id: prospectId });
  const prospect = prospects[0];
  if (!prospect) return Response.json({ error: "Prospect introuvable" }, { status: 404 });
  if (prospect.ownerUserId !== user.email && user.role !== "admin") return Response.json({ error: "Forbidden" }, { status: 403 });

  // 1. Analyse IA du prospect
  const analysis = await callOpenAI([
    {
      role: "system",
      content: `Tu es un expert en prospection B2B pour SYNC Productions (partenaire audiovisuel à Montréal).
SYNC offre: son, éclairage, captation, webdiffusion/hybride pour événements corporatifs.
ICP: entreprises/organisations qui organisent leurs propres événements corporatifs (conférences, congrès, AGA, galas, formations internes, townhalls).
Tu n'inventes pas de faits. Sortie JSON strict uniquement.`
    },
    {
      role: "user",
      content: `Analyse ce prospect pour SYNC Productions:

Entreprise: ${prospect.companyName}
Site: ${prospect.website}
Domaine: ${prospect.domain}
Industrie: ${prospect.industry || "inconnue"}
Localisation: ${JSON.stringify(prospect.location || {})}
Type: ${prospect.entityType || ""}
Snippet: ${prospect.serpSnippet || ""}

Réponds en JSON:
{
  "relevanceScore": number (0-100, basé sur la probabilité qu'ils organisent des événements corporatifs),
  "segment": "HOT|STANDARD",
  "relevanceReasons": ["raison 1", "raison 2", "raison 3"],
  "opportunities": [{"label": string, "detail": string}],
  "painPoints": [{"label": string, "detail": string}],
  "eventTypes": ["types d'événements probables"],
  "recommendedApproach": "angle d'approche recommandé en 1-2 phrases",
  "decisionMakerTitles": ["titres des décideurs à cibler"]
}`
    }
  ]);

  // 2. Chercher décideurs via Hunter
  let hunterContacts = [];
  let hunterError = null;
  try {
    const hunterResult = await hunterDomainSearch(prospect.domain, prospect.companyName);
    if (hunterResult?.data?.emails) {
      hunterContacts = hunterResult.data.emails
        .filter(e => e.type === "personal" && e.confidence >= 50)
        .slice(0, 3);
    } else if (hunterResult?.errors) {
      hunterError = hunterResult.errors[0]?.details || "Hunter error";
    }
  } catch (e) {
    hunterError = e.message;
  }

  // Create/update contacts
  for (const hc of hunterContacts) {
    const existing = await base44.entities.Contact.filter({ prospectId, email: hc.value });
    if (existing.length === 0) {
      await base44.entities.Contact.create({
        prospectId,
        ownerUserId: prospect.ownerUserId,
        firstName: hc.first_name || "",
        lastName: hc.last_name || "",
        fullName: `${hc.first_name || ""} ${hc.last_name || ""}`.trim(),
        title: hc.position || "",
        email: hc.value,
        emailConfidence: hc.confidence,
        linkedinUrl: hc.linkedin || "",
        hasEmail: true,
        source: "HUNTER",
      });
    }
  }

  // If Hunter returned no emails (quota/free), create stub contacts from AI titles
  if (hunterContacts.length === 0 && analysis.decisionMakerTitles?.length > 0) {
    const contactPageUrl = `https://www.${prospect.domain}/contact`;
    for (const title of analysis.decisionMakerTitles.slice(0, 2)) {
      const existing = await base44.entities.Contact.filter({ prospectId, title });
      if (existing.length === 0) {
        await base44.entities.Contact.create({
          prospectId,
          ownerUserId: prospect.ownerUserId,
          title,
          hasEmail: false,
          contactPageUrl,
          source: "SERP",
        });
      }
    }
  }

  // Update prospect with analysis
  await base44.entities.Prospect.update(prospectId, {
    status: "ANALYSÉ",
    relevanceScore: analysis.relevanceScore,
    segment: analysis.segment,
    relevanceReasons: analysis.relevanceReasons,
    opportunities: analysis.opportunities,
    painPoints: analysis.painPoints,
    eventTypes: analysis.eventTypes,
    recommendedApproach: analysis.recommendedApproach,
    analysisRaw: analysis,
  });

  await base44.entities.ActivityLog.create({
    ownerUserId: user.email,
    actionType: "ANALYZE_PROSPECT",
    entityType: "Prospect",
    entityId: prospectId,
    payload: { relevanceScore: analysis.relevanceScore, segment: analysis.segment, hunterError },
    status: "SUCCESS",
  });

  return Response.json({ success: true, analysis, hunterError });
});