import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY");

async function callOpenAI(messages) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-4o-mini", messages, response_format: { type: "json_object" } })
  });
  const data = await res.json();
  return JSON.parse(data.choices[0].message.content);
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { prospectId, leadId, channel, templateType, contactId } = await req.json();

  // Load data
  const [prospect, contact, templates] = await Promise.all([
    prospectId ? base44.entities.Prospect.filter({ id: prospectId }).then(r => r[0]) : null,
    contactId ? base44.entities.Contact.filter({ id: contactId }).then(r => r[0]) : null,
    base44.entities.MessageTemplate.filter({ templateType, channel, active: true }, "-created_date", 3),
  ]);

  if (prospect && prospect.ownerUserId !== user.email && user.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  // Pick template (prefer FR_CA, HOT if segment matches)
  const segment = prospect?.segment || "STANDARD";
  const template = templates.find(t => t.languageVariant === "FR_CA" && t.segment === segment)
    || templates.find(t => t.languageVariant === "FR_CA")
    || templates[0];

  const senderName = user.full_name || user.email.split("@")[0];
  const firstName = contact?.firstName || "Madame/Monsieur";

  const systemPrompt = `Tu es ${senderName}, représentant(e) de SYNC Productions à Montréal.
SYNC = partenaire audiovisuel pour événements corporatifs (son, éclairage, captation, webdiffusion/hybride).
Ton = professionnel, concret, FR-CA. Pas de marketing fluff.
Ne pas dire "j'ai vu que vous…" sans source vérifiable.
CTA soft: 15 minutes ou question sur calendrier événements.
Sortie JSON strict: { "subject": string|null, "body": string }`;

  const context = `
Entreprise: ${prospect?.companyName || ""}
Site: ${prospect?.website || ""}
Industrie: ${prospect?.industry || ""}
Localisation: ${JSON.stringify(prospect?.location || {})}
Score pertinence: ${prospect?.relevanceScore || ""}
Segment: ${segment}
Raisons: ${(prospect?.relevanceReasons || []).join("; ")}
Opportunités: ${(prospect?.opportunities || []).map(o => o.label).join("; ")}
Approche recommandée: ${prospect?.recommendedApproach || ""}
Contact: ${firstName}${contact?.title ? `, ${contact.title}` : ""}${contact?.email ? `, ${contact.email}` : ""}
Canal: ${channel}
Type message: ${templateType}
`;

  const templateContext = template ? `
Template de base à personnaliser (adapte au contexte, ne copie pas mot pour mot):
${template.body}` : "";

  const result = await callOpenAI([
    { role: "system", content: systemPrompt },
    { role: "user", content: `Génère un message personnalisé pour ce prospect.\n\n${context}\n${templateContext}\n\nNom expéditeur: ${senderName}\nPrénom contact: ${firstName}` }
  ]);

  // Replace template variables
  if (result.body) {
    result.body = result.body
      .replace(/\{firstName\}/g, firstName)
      .replace(/\{senderName\}/g, senderName)
      .replace(/\{senderTitle\}/g, "Représentant(e) SYNC Productions");
  }

  return Response.json(result);
});