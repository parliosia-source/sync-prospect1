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

  const { messageId, tone, length, objective, instructions } = await req.json();
  if (!messageId) return Response.json({ error: "messageId requis" }, { status: 400 });

  const messages = await base44.entities.Message.filter({ id: messageId });
  const msg = messages[0];
  if (!msg) return Response.json({ error: "Message introuvable" }, { status: 404 });
  if (msg.ownerUserId !== user.email && user.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  // Load prospect context
  let prospect = null;
  if (msg.prospectId) {
    const ps = await base44.entities.Prospect.filter({ id: msg.prospectId });
    prospect = ps[0] || null;
  }

  const baseContent = msg.editedBody || msg.generatedBody || msg.body || "";
  const baseSubject = msg.editedSubject || msg.generatedSubject || msg.subject || "";
  const channel = msg.channel || "LINKEDIN";

  const toneMap = { "PROFESSIONNEL": "professionnel et posé", "DIRECT": "direct et concis", "CHALEUREUX": "chaleureux et accessible" };
  const lengthMap = { "COURT": "court (max 5-6 lignes)", "MOYEN": "moyen (8-10 lignes)" };
  const objectiveMap = {
    "CALL_15": "obtenir un appel de 15 minutes",
    "QUALIFY_EVENT": "qualifier les besoins événementiels",
    "FOLLOWUP_J7": "relancer après 7 jours sans réponse"
  };

  const toneLabel = toneMap[tone] || "professionnel";
  const lengthLabel = lengthMap[length] || "moyen";
  const objectiveLabel = objectiveMap[objective] || "obtenir une réponse";

  const prospectContext = prospect ? `
Entreprise: ${prospect.companyName}
Site: ${prospect.website}
Industrie: ${prospect.industry || ""}
Approche recommandée: ${prospect.recommendedApproach || ""}
Opportunités: ${(prospect.opportunities || []).map(o => o.label).join("; ")}` : "";

  const senderName = user.full_name || user.email.split("@")[0];

  const result = await callOpenAI([
    {
      role: "system",
      content: `Tu es ${senderName} de SYNC Productions (partenaire audiovisuel, Montréal).
Règles absolues: FR-CA, pas de claims non vérifiables, CTA soft, pas de "j'espère que ce message vous trouve bien", anti-spam.
Tu améliores un message existant sans l'écraser — tu proposes une nouvelle version.
Sortie JSON strict: { "editedSubject": string|null, "editedBody": string, "suggestions": [string, string, string] }`
    },
    {
      role: "user",
      content: `Améliore ce message.

Ton: ${toneLabel}
Longueur: ${lengthLabel}
Objectif: ${objectiveLabel}
Canal: ${channel}
${instructions ? `Instructions supplémentaires: ${instructions}` : ""}
${prospectContext}

Message actuel:
${channel === "EMAIL" && baseSubject ? `Sujet: ${baseSubject}\n\n` : ""}${baseContent}

Retourne: editedSubject (null si LinkedIn), editedBody amélioré, suggestions (3 bullets de conseils d'amélioration appliqués).`
    }
  ]);

  // Update message
  await base44.entities.Message.update(messageId, {
    editedBody: result.editedBody,
    editedSubject: result.editedSubject || "",
    activeVersion: "EDITED",
    lastEditedAt: new Date().toISOString(),
    status: "DRAFT",
  });

  return Response.json({
    editedSubject: result.editedSubject,
    editedBody: result.editedBody,
    suggestions: result.suggestions || [],
  });
});