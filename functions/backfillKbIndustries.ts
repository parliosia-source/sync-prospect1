import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const SECTOR_KEYWORDS = {
  "Technologie": ["software", "saas", "ai", "data", "cloud", "plateforme", "logiciel", "technologie", "digital", "développement"],
  "Finance & Assurance": ["assurance", "insurance", "fintech", "banque", "bank", "services financiers", "courtier", "investissement"],
  "Santé & Pharma": ["biotech", "pharma", "clinique", "hospital", "hôpital", "medical", "santé", "médecin"],
  "Immobilier": ["immobilier", "real estate", "property", "gestion immobilière", "développement", "promoteur"],
  "Droit & Comptabilité": ["avocat", "law", "juridique", "notaire", "cpa", "comptable", "audit", "tax"],
  "Industrie & Manufacture": ["manufacture", "manufacturier", "industrie", "fabrication", "production", "usine", "aérospatial"],
  "Transport & Logistique": ["logistique", "logistics", "transport", "freight", "3pl", "livraison", "courrier", "camionnage"],
  "Commerce de détail": ["retail", "commerce de détail", "boutique", "magasin", "ecommerce"],
  "Éducation & Formation": ["école", "formation", "université", "college", "training", "bootcamp"],
  "Gouvernement & Public": ["gouvernement", "public", "ministère", "municipalité", "ville", "agence"],
  "Associations & OBNL": ["association", "obnl", "fondation", "nonprofit", "organisme"],
};

function guessSectors(kb) {
  const matched = [];
  const combined = `${kb.name} ${kb.notes || ''} ${(kb.tags || []).join(' ')}`.toLowerCase();
  
  for (const [sector, keywords] of Object.entries(SECTOR_KEYWORDS)) {
    let score = 0;
    for (const kw of keywords) {
      if (combined.includes(kw.toLowerCase())) score++;
    }
    if (score >= 2) matched.push(sector); // Need at least 2 keywords
  }
  
  return matched.length > 0 ? matched : [];
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user || user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

  const { dryRun } = await req.json();
  
  const allKb = await base44.entities.KBEntity.filter({}, '-created_date', 2000);
  let scanned = 0, updated = 0, stillEmpty = 0;
  
  for (const kb of allKb) {
    scanned++;
    const hasIndustries = Array.isArray(kb.industrySectors) && kb.industrySectors.length > 0;
    
    if (!hasIndustries) {
      const guessed = guessSectors(kb);
      if (guessed.length > 0 && !dryRun) {
        await base44.entities.KBEntity.update(kb.id, {
          industrySectors: guessed,
          industryLabel: guessed[0],
        });
        updated++;
      } else if (guessed.length === 0) {
        stillEmpty++;
      } else if (dryRun) {
        updated++;
      }
    }
  }
  
  return Response.json({
    success: true,
    summary: { scanned, updated, stillEmpty },
    dryRun,
  });
});