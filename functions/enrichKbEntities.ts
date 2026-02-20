import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

// PHASE P1: Mapping tags/notes → industrySectors + eventRelevanceTags
const INDUSTRY_MAPPING = {
  // Finance
  "assurance": "Finance & Assurance",
  "banque": "Finance & Assurance",
  "caisse": "Finance & Assurance",
  "crédit": "Finance & Assurance",
  "hypothèque": "Finance & Assurance",
  "courtier": "Finance & Assurance",
  "placement": "Finance & Assurance",
  "fonds": "Finance & Assurance",
  
  // Santé & Pharma
  "pharma": "Santé & Pharma",
  "médicament": "Santé & Pharma",
  "hôpital": "Santé & Pharma",
  "clinique": "Santé & Pharma",
  "santé": "Santé & Pharma",
  "médecin": "Santé & Pharma",
  "dentiste": "Santé & Pharma",
  "vétérinaire": "Santé & Pharma",
  "infirmière": "Santé & Pharma",
  "optométrie": "Santé & Pharma",
  
  // Technologie
  "tech": "Technologie",
  "software": "Technologie",
  "informatique": "Technologie",
  "internet": "Technologie",
  "cybersécurité": "Technologie",
  "données": "Technologie",
  "cloud": "Technologie",
  "ai": "Technologie",
  "ia": "Technologie",
  "artificial": "Technologie",
  "digital": "Technologie",
  "startup": "Technologie",
  
  // Gouvernement & Public
  "gouvernement": "Gouvernement & Public",
  "municipal": "Gouvernement & Public",
  "provincial": "Gouvernement & Public",
  "fédéral": "Gouvernement & Public",
  "public": "Gouvernement & Public",
  "ministère": "Gouvernement & Public",
  "agence": "Gouvernement & Public",
  
  // Éducation & Formation
  "école": "Éducation & Formation",
  "université": "Éducation & Formation",
  "cégep": "Éducation & Formation",
  "collège": "Éducation & Formation",
  "formation": "Éducation & Formation",
  "éducation": "Éducation & Formation",
  "institut": "Éducation & Formation",
  
  // Associations & OBNL
  "association": "Associations & OBNL",
  "fondation": "Associations & OBNL",
  "obnl": "Associations & OBNL",
  "npo": "Associations & OBNL",
  "charité": "Associations & OBNL",
  "organisme": "Associations & OBNL",
  "syndicat": "Associations & OBNL",
  "ordre": "Associations & OBNL",
  
  // Immobilier
  "immobilier": "Immobilier",
  "immeuble": "Immobilier",
  "propriété": "Immobilier",
  "rénovation": "Immobilier",
  "construction": "Immobilier",
  "architecture": "Immobilier",
  
  // Droit & Comptabilité
  "avocat": "Droit & Comptabilité",
  "cabinet": "Droit & Comptabilité",
  "notaire": "Droit & Comptabilité",
  "comptable": "Droit & Comptabilité",
  "comptabilité": "Droit & Comptabilité",
  "fiscal": "Droit & Comptabilité",
  "audit": "Droit & Comptabilité",
  "juridique": "Droit & Comptabilité",
  
  // Industrie & Manufacture
  "manufacture": "Industrie & Manufacture",
  "usine": "Industrie & Manufacture",
  "production": "Industrie & Manufacture",
  "industrie": "Industrie & Manufacture",
  "mécanique": "Industrie & Manufacture",
  "chimique": "Industrie & Manufacture",
  "matériau": "Industrie & Manufacture",
  
  // Commerce de détail
  "retail": "Commerce de détail",
  "magasin": "Commerce de détail",
  "boutique": "Commerce de détail",
  "vente": "Commerce de détail",
  "commerce": "Commerce de détail",
  "distribution": "Commerce de détail",
  
  // Transport & Logistique
  "transport": "Transport & Logistique",
  "logistique": "Transport & Logistique",
  "livraison": "Transport & Logistique",
  "cargo": "Transport & Logistique",
  "maritime": "Transport & Logistique",
  "aérien": "Transport & Logistique",
};

// EVENT RELEVANCE TAGS
const EVENT_MAPPING = {
  "gala": "Gala",
  "conférence": "Conférence",
  "congrès": "Congrès",
  "aga": "AGA",
  "assemblée": "Assemblée générale",
  "formation": "Formation",
  "séminaire": "Séminaire",
  "sommet": "Sommet",
  "forum": "Forum",
  "workshop": "Workshop",
  "réseautage": "Réseautage",
  "déjeuner": "Déjeuner-conférence",
  "événement": "Événement corporatif",
  "summit": "Sommet",
};

function extractIndustrySectors(tags = [], notes = "", entityType = "") {
  const sectors = new Set();
  const combined = [...(tags || []), notes, entityType].join(" ").toLowerCase();
  
  for (const [keyword, sector] of Object.entries(INDUSTRY_MAPPING)) {
    if (combined.includes(keyword)) {
      sectors.add(sector);
    }
  }
  
  return Array.from(sectors).slice(0, 3);
}

function extractEventTags(tags = [], notes = "") {
  const events = new Set();
  const combined = [...(tags || []), notes].join(" ").toLowerCase();
  
  for (const [keyword, eventType] of Object.entries(EVENT_MAPPING)) {
    if (combined.includes(keyword)) {
      events.add(eventType);
    }
  }
  
  return Array.from(events).slice(0, 4);
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  
  if (!user || user.role !== "admin") {
    return Response.json({ error: "Admin only" }, { status: 403 });
  }

  const body = await req.json();
  const { kbEntities, dryRun = true } = body;
  
  if (!kbEntities || !Array.isArray(kbEntities) || kbEntities.length === 0) {
    return Response.json({ error: "kbEntities array required" }, { status: 400 });
  }

  const enriched = kbEntities.map(kb => {
    const industrySectors = extractIndustrySectors(kb.tags, kb.notes, kb.entityType);
    const eventRelevanceTags = extractEventTags(kb.tags, kb.notes);
    
    return {
      ...kb,
      industrySectors,
      eventRelevanceTags,
      industryLabel: industrySectors.join(", ") || kb.entityType,
    };
  });

  if (dryRun) {
    // PREVIEW mode: return first 5 samples
    return Response.json({
      success: true,
      dryRun: true,
      totalEnriched: enriched.length,
      samples: enriched.slice(0, 5),
      message: "Dry run — prêt pour import réel",
    });
  }

  // REAL mode: import enriched KB to KBEntity
  let imported = 0, failed = 0;
  for (const kb of enriched) {
    try {
      const existing = await base44.entities.KBEntity.filter({ domain: kb.domain });
      if (existing.length === 0) {
        await base44.entities.KBEntity.create(kb);
        imported++;
      }
    } catch (e) {
      console.error(`Failed to import ${kb.domain}:`, e.message);
      failed++;
    }
  }

  return Response.json({
    success: true,
    dryRun: false,
    imported,
    failed,
    totalProcessed: enriched.length,
  });
});