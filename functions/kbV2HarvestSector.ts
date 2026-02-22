import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const BRAVE_KEY = Deno.env.get("BRAVE_API_KEY");

// ── Grand Montréal shared helper ───────────────────────────────────────────────
function normalizeQuery(s) {
  return (s || "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").trim();
}

const GM_CITIES = new Set([
  "montreal","laval","longueuil","brossard","boucherville","terrebonne","repentigny",
  "blainville","mirabel","mascouche","saint-jerome","chateauguay","la-prairie",
  "saint-lambert","westmount","mont-royal","dorval","pointe-claire","kirkland",
  "beaconsfield","cote-saint-luc","verdun","anjou","outremont","pierrefonds","lasalle",
  "saint-laurent","vaudreuil-dorion","sainte-julie","varennes","candiac","brossard",
  "lachine","ahuntsic","saint-leonard","rosemont","villeray","montreal-nord",
  "montreal-est","mtl","grand montreal","greater montreal",
]);

const GM_CITIES_LIST = ["Montréal","Laval","Longueuil","Brossard","Boucherville","Terrebonne",
  "Repentigny","Blainville","Mirabel","Mascouche","Saint-Jérôme","Châteauguay","La Prairie",
  "Saint-Lambert","Westmount","Mont-Royal","Dorval","Pointe-Claire","Kirkland","Beaconsfield",
  "Côte-Saint-Luc","Verdun","Anjou","Outremont","Pierrefonds","LaSalle","Saint-Laurent",
  "Vaudreuil-Dorion","Sainte-Julie","Varennes","Candiac","Lachine","Ahuntsic"];

const GM_REGEX = new RegExp(
  "(montr[eé]al|montreal|laval|longueuil|brossard|boucherville|terrebonne|repentigny|" +
  "blainville|mirabel|mascouche|saint-j[eé]r[oô]me|ch[aâ]teauguay|la.?prairie|saint-lambert|" +
  "westmount|mont-royal|dorval|pointe-claire|kirkland|beaconsfield|c[oô]te-saint-luc|verdun|" +
  "anjou|outremont|pierrefonds|lasalle|saint-laurent|vaudreuil|sainte-julie|varennes|candiac|" +
  "lachine|ahuntsic|grand montr[eé]al|greater montreal|rive-sud|rive-nord|grand montreal)",
  "i"
);

function isGmQuery(locationQuery) {
  const norm = normalizeQuery(locationQuery);
  if (norm.includes("grand montreal") || norm.includes("greater montreal")) return true;
  if (GM_CITIES.has(norm)) return true;
  for (const token of norm.split(/[,\s\-]+/)) {
    if (GM_CITIES.has(token)) return true;
  }
  return false;
}

function detectGmCity(text) {
  const norm = normalizeQuery(text);
  for (const city of GM_CITIES_LIST) {
    const cityNorm = normalizeQuery(city);
    if (norm.includes(cityNorm)) return city;
  }
  return null;
}

// ── SECTOR_SYNONYMS ────────────────────────────────────────────────────────────
const SECTOR_SYNONYMS = {
  "Technologie": ["IT","informatique","SaaS","logiciel","software","cloud","IA","AI","numérique",
    "digital","cybersécurité","cybersecurity","données","data","développement","startup","tech",
    "infrastructure","DevOps","application","plateforme","réseau","API","programmation","ERP","CRM"],
  "Finance & Assurance": ["banque","bank","assurance","insurance","crédit","credit","prêt","loan",
    "investissement","investment","hypothèque","mortgage","courtage","fonds","fund","retraite",
    "pension","actuaire","fintech","capital","trésorerie","épargne","portefeuille"],
  "Santé & Pharma": ["santé","health","pharma","pharmacie","pharmacy","médical","medical","hôpital",
    "hospital","clinique","clinic","médecin","physician","chirurgie","diagnostic","thérapie",
    "laboratoire","wellness","soin","care","infirmier","dentiste"],
  "Gouvernement & Public": ["gouvernement","government","municipalité","municipality","ville","city",
    "province","fédéral","federal","ministère","ministry","CISSS","CIUSSS","administration"],
  "Éducation & Formation": ["université","university","collège","college","école","school","cégep",
    "formation","training","cours","apprentissage","diplôme","certification","académie"],
  "Associations & OBNL": ["association","OBNL","NPO","fondation","foundation","organisme",
    "charitable","bénévole","ONG","NGO","syndicat","communautaire","mission"],
  "Immobilier": ["immobilier","real estate","propriété","property","construction","promoteur",
    "developer","courtier immobilier","agent immobilier","logement","housing","bureau",
    "bâtiment","building","terrain","condo","locatif","REIT","gestion immobilière","résidentiel",
    "commercial","copropriété","hypothèque","entrepreneur général"],
  "Droit & Comptabilité": ["avocat","lawyer","droit","law","comptable","accountant","comptabilité",
    "accounting","juridique","legal","notaire","notary","cabinet","firm","fiscalité","tax",
    "audit","conformité","compliance","fiducie","trust","CPA","médiateur","arbitrage"],
  "Industrie & Manufacture": ["usine","factory","manufacture","fabrication","production","industrie",
    "industry","acier","steel","chimie","mécanique","automatisation","assemblage","machinerie",
    "ingénierie","engineering","fournisseur","supplier","équipement"],
  "Commerce de détail": ["commerce","retail","magasin","store","boutique","vente","sale","détaillant",
    "retailer","marchandise","épicerie","grocery","e-commerce","mode","fashion","alimentation","franchise"],
  "Transport & Logistique": ["transport","logistique","logistics","camion","truck","livraison",
    "delivery","cargo","fret","freight","chauffeur","driver","entrepôt","warehouse","courrier",
    "distribution","supply chain","transitaire"],
};

// ── Web query templates per sector ─────────────────────────────────────────────
const WEB_QUERY_TEMPLATES = {
  "Immobilier": [
    'promoteur immobilier Montréal site:.ca OR site:.com',
    'agence immobilière Laval Longueuil',
    'constructeur résidentiel Rive-Sud Montréal',
    'courtier immobilier Brossard Boucherville',
    'gestionnaire immeuble Montréal commercial',
    'real estate developer Greater Montreal',
    'property management company Montreal',
    'construction résidentielle Terrebonne Blainville',
    'investisseur immobilier Grand Montréal',
    'syndic copropriété Montréal',
    'entrepreneur général construction Montréal',
    'promoteur condos Montréal Laval',
  ],
  "Technologie": [
    'entreprise technologie Montréal startup',
    'logiciel SaaS entreprise Montréal',
    'agence numérique Laval Longueuil',
    'développeur software Rive-Sud Montréal',
    'société informatique Grand Montréal',
    'tech company Montreal software',
    'cybersécurité entreprise Montréal',
    'intelligence artificielle startup Montréal',
    'cloud services company Greater Montreal',
    'ERP CRM solution Montréal',
    'DevOps infrastructure Montréal',
    'plateforme numérique Québec Montréal',
  ],
  "Finance & Assurance": [
    'courtier assurance Montréal',
    'conseiller financier Grand Montréal',
    'cabinet fintech Montréal startup',
    'planificateur financier Laval Longueuil',
    'firme comptable Rive-Sud Brossard',
    'assurance entreprise Montréal QC',
    'investment firm Montreal Greater Montreal',
    'mortgage broker Montreal Laval',
    'gestionnaire fonds Montréal',
    'actuaire Montréal',
    'banque coopérative crédit Montréal',
    'capital risque Montréal fintech',
  ],
  "Santé & Pharma": [
    'clinique médicale Montréal',
    'pharmacie indépendante Laval Longueuil',
    'laboratoire médical Grand Montréal',
    'entreprise pharma biotech Montréal',
    'centre de santé Rive-Sud Brossard',
    'medical clinic Greater Montreal',
    'pharmaceutical company Montreal Quebec',
    'clinique dentaire Montréal Laval',
    'soins à domicile Montréal',
    'technologie médicale startup Montréal',
    'wellness entreprise Montréal',
    'thérapie réhabilitation Montréal',
  ],
  "Droit & Comptabilité": [
    'cabinet avocat Montréal droit',
    'notaire Laval Longueuil',
    'CPA comptable Rive-Sud Brossard',
    'firme juridique Grand Montréal',
    'avocat droit des affaires Montréal',
    'law firm Montreal Quebec',
    'comptable certifié Montréal cabinet',
    'médiation arbitrage Montréal',
    'fiscaliste Montréal entreprise',
    'cabinet droit immobilier Montréal',
    'trust fiducie Montréal',
    'conformité compliance entreprise Montréal',
  ],
  "Industrie & Manufacture": [
    'fabrication industrielle Montréal',
    'usine manufacture Rive-Sud Boucherville',
    'fournisseur industriel Grand Montréal',
    'ingénierie mécanique Laval Longueuil',
    'assemblage production Terrebonne Blainville',
    'manufacturing company Greater Montreal',
    'équipement industriel Montréal',
    'automatisation robotique Montréal',
    'chimie matériaux entreprise Montréal',
    'acier métal fabrication Rive-Sud',
    'supplier industrial Montreal Quebec',
    'usinage prototypage Montréal',
  ],
  "Transport & Logistique": [
    'transport logistique Montréal',
    'camionnage livraison Rive-Sud Brossard',
    'entrepôt distribution Grand Montréal',
    'transitaire fret Montréal',
    'supply chain entreprise Laval',
    'logistics company Greater Montreal',
    'freight carrier Montreal Quebec',
    'courrier messager Montréal',
    'distribution alimentaire Montréal',
    'chaîne approvisionnement Montréal',
    'transport routier Terrebonne Blainville',
    'maritime aéroport fret Montréal',
  ],
  "Commerce de détail": [
    'détaillant commerce Montréal',
    'boutique spécialisée Grand Montréal',
    'franchise alimentation Laval Longueuil',
    'e-commerce entreprise Montréal',
    'épicerie spécialisée Rive-Sud',
    'retail company Montreal',
    'grocery chain Greater Montreal',
    'mode vêtement boutique Montréal',
    'électronique consommateurs Montréal',
    'franchise restauration Grand Montréal',
    'marque locale Montréal commerce',
    'magasin grande surface Laval Brossard',
  ],
  "Associations & OBNL": [
    'OBNL organisme Montréal',
    'association sectorielle Grand Montréal',
    'fondation charitable Montréal',
    'chambre de commerce Laval Longueuil',
    'syndicat organisation Montréal',
    'nonprofit organization Montreal',
    'NGO Greater Montreal',
    'association professionnelle Montréal',
    'organisme communautaire Rive-Sud',
    'fondation philanthropie Montréal',
    'mission sociale Montréal',
    'bénévolat organisme Laval',
  ],
  "Gouvernement & Public": [
    'agence gouvernementale Montréal',
    'organisme public Grand Montréal',
    'régie publique Laval Longueuil',
    'CISSS CIUSSS Montréal',
    'municipalité service public Rive-Sud',
    'government agency Montreal Quebec',
    'crown corporation Greater Montreal',
    'commission publique Montréal',
    'service municipal Brossard Longueuil',
    'organisme paragouvernemental Montréal',
    'réglementation autorité Montréal',
    'SDC société développement commercial Montréal',
  ],
  "Éducation & Formation": [
    'formation professionnelle Montréal',
    'école spécialisée Grand Montréal',
    'centre formation continue Laval',
    'bootcamp technologie Montréal',
    'académie formation Longueuil',
    'training center Montreal Quebec',
    'professional school Greater Montreal',
    'certification formation Rive-Sud',
    'cours spécialisé entreprise Montréal',
    'école de commerce Montréal privée',
    'formation langue Montréal',
    'collège privé Grand Montréal',
  ],
};

// ── Blocked patterns ───────────────────────────────────────────────────────────
const BLOCKED_DOMAINS = new Set([
  "wikipedia.org","fr.wikipedia.org","en.wikipedia.org","youtube.com","youtu.be",
  "facebook.com","instagram.com","twitter.com","x.com","linkedin.com","tiktok.com",
  "pinterest.com","reddit.com","yelp.com","tripadvisor.com","yellowpages.ca",
  "pagesjaunes.ca","pagesjaunes.com","411.ca","google.com","bing.com","yahoo.com",
  "indeed.com","glassdoor.com","monster.com","jobbank.gc.ca","emploiquebec.net",
  "eventbrite.com","eventbrite.ca","meetup.com","crunchbase.com","clutch.co",
  "g2.com","capterra.com","sortlist.com","goodfirms.co","themanifest.com",
  "lapresse.ca","ledevoir.com","journaldequebec.com","lesaffaires.com",
  "radio-canada.ca","cbc.ca","medium.com","substack.com","wordpress.com","wix.com",
  "squarespace.com","10times.com","allevents.in","eventful.com",
]);

const BLOCKED_URL_PATH = /\/directory\/|\/listing\/|\/category\/|\/tag\/|\/top\/|\/best\/|\/compare\/|\/blog\/|\/news\/|\/press\/|\/article\/|\/annuaire\/|\/jobs\/|\/emplois\/|\/careers\/|\.pdf$/i;

const BLOCKED_TITLE = /\b(top\s*\d+|best\s+\d+|liste|annuaire|directory|classement|ranking|near me|compare|comparatif|r[eé]pertoire|review|avis|guide complet|how to|comment trouver)\b/i;

// ── TWO_PART_TLDS ──────────────────────────────────────────────────────────────
const TWO_PART_TLDS = new Set(["qc.ca","co.ca","on.ca","bc.ca","ab.ca","mb.ca","nb.ca","ns.ca","nl.ca","pe.ca","sk.ca"]);

function getRegistrableDomain(hostname) {
  const host = (hostname || "").replace(/^www\./, "");
  const labels = host.split(".");
  if (labels.length >= 3) {
    const twoPartTld = labels.slice(-2).join(".");
    if (TWO_PART_TLDS.has(twoPartTld)) return labels.slice(-3).join(".");
  }
  return labels.slice(-2).join(".");
}

// ── Sector scoring ─────────────────────────────────────────────────────────────
function scoreSector(text, sector) {
  const norm = normalizeQuery(text);
  const syns = SECTOR_SYNONYMS[sector] || [];
  let strong = 0, weak = 0;
  syns.forEach((s, i) => {
    if (norm.includes(normalizeQuery(s))) {
      if (i < 12) strong++; else weak++;
    }
  });
  return strong * 3 + weak;
}

// ── Confidence score (0–100) ───────────────────────────────────────────────────
function computeConfidence(fullText, snippet, domain, sector, gmCity) {
  let score = 0;

  // +45 sector match
  const sectorScore = scoreSector(fullText, sector);
  if (sectorScore >= 6) score += 45;
  else if (sectorScore >= 3) score += 30;
  else if (sectorScore >= 1) score += 15;

  // +25 GM city detected
  if (gmCity) score += 25;
  else if (GM_REGEX.test(fullText)) score += 15;

  // +20 clean domain
  const dirtyDomain = /\b(directory|pages|jaunes|annuaire|list|rank|top|blog|news|review|compare|maps)\b/i.test(domain);
  const plausibleDomain = /\.(ca|com|org|net|qc\.ca)$/.test(domain) && domain.length < 50;
  if (!dirtyDomain && plausibleDomain) score += 20;

  // +10 informative snippet
  if ((snippet || "").length >= 80 && /\b(services?|solutions?|produits?|company|entreprise|cabinet|expert|sp[eé]cialis[eé]|offre|fournisseur)\b/i.test(snippet)) score += 10;

  return Math.min(100, score);
}

// ── Extract company name ───────────────────────────────────────────────────────
function extractName(title) {
  const clean = title
    .replace(/\s*[-–|]\s*.*/g, "")
    .replace(/\s*\|.*/g, "")
    .trim();
  return clean.slice(0, 120) || title.slice(0, 120);
}

// ── Brave Search ───────────────────────────────────────────────────────────────
const braveRL = { remaining: -1, reset: -1, count429: 0 };

async function braveSearch(query, count = 20, offset = 0) {
  if (braveRL.remaining === 0) await new Promise(r => setTimeout(r, 2000));

  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}&offset=${offset}&extra_snippets=true&country=ca`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(url, {
      headers: { "Accept": "application/json", "X-Subscription-Token": BRAVE_KEY },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    const rem = parseInt(res.headers.get("X-RateLimit-Remaining") || "-1", 10);
    const rst = parseInt(res.headers.get("X-RateLimit-Reset") || "-1", 10);
    if (rem !== -1) braveRL.remaining = rem;
    if (rst !== -1) braveRL.reset = rst;

    if (res.status === 429) { braveRL.count429++; return { results: [], rateLimited: true, httpStatus: 429 }; }
    if (res.status === 402) { return { results: [], rateLimited: true, httpStatus: 402 }; } // quota exceeded
    if (!res.ok) {
      console.log(`[BRAVE] non-ok status=${res.status}`);
      return { results: [], rateLimited: false, httpStatus: res.status };
    }
    const data = await res.json();
    return { results: data.web?.results || [], rateLimited: false, httpStatus: res.status };
  } catch (e) {
    clearTimeout(t);
    console.log(`[BRAVE] exception: ${e.message}`);
    return { results: [], rateLimited: e.name === "AbortError", httpStatus: 0 };
  }
}

// ── Main Handler ───────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user || user.role !== "admin") {
    return Response.json({ error: "Forbidden: Admin only" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const {
    sector = "Immobilier",
    target = 150,
    location = "GM",
    minScore = 75,
    maxWeb = 600,
    dryRun = false,
  } = body;

  if (!SECTOR_SYNONYMS[sector]) {
    return Response.json({ error: `Unknown sector: ${sector}` }, { status: 400 });
  }

  const START = Date.now();
  const MAX_MS = 170 * 1000;

  // Log immediately before any async
  const entryLog = `ENTRY sector=${sector} target=${target} minScore=${minScore} dryRun=${dryRun} BRAVE=${BRAVE_KEY ? BRAVE_KEY.slice(0,6)+"..." : "MISSING"}`;
  console.log(`[HARVEST] ${entryLog}`);

  // A) Load existing KBEntityV2 to count current and build dedup set
  console.log(`[HARVEST] Loading KBEntityV2...`);
  let kbAll = [];
  let kbPage = 0;
  while (true) {
    const batch = await base44.asServiceRole.entities.KBEntityV2.list('-created_date', 500, kbPage * 500).catch((e) => {
      console.log(`[HARVEST] KB load error page=${kbPage}: ${e.message}`);
      return [];
    });
    if (!batch || batch.length === 0) break;
    kbAll = kbAll.concat(batch);
    if (batch.length < 500) break;
    kbPage++;
    if (kbPage >= 20) break;
  }
  console.log(`[HARVEST] KBEntityV2 loaded: ${kbAll.length}`);

  const kbDomainSet = new Set(kbAll.map(e => (e.domain || "").toLowerCase().replace(/^www\./, "")));

  // Count current for this sector in GM/MTL
  const currentBefore = kbAll.filter(e => {
    const secs = Array.isArray(e.industrySectors) ? e.industrySectors : [];
    return secs.includes(sector) && (e.hqRegion === "MTL" || e.hqRegion === "GM");
  }).length;

  const need = target - currentBefore;
  console.log(`[HARVEST] currentBefore=${currentBefore}, need=${need}`);

  if (need <= 0) {
    return Response.json({
      sector, target, currentBefore, currentAfter: currentBefore, need: 0,
      inserted: 0, rejected: 0, fetched: 0, status: "DONE",
    });
  }

  // B) Get query templates for this sector
  const queries = WEB_QUERY_TEMPLATES[sector] || [
    `entreprise ${sector} Montréal`,
    `${sector} compagnie Grand Montréal`,
    `${sector} company Greater Montreal`,
  ];

  let fetched = 0;
  let inserted = 0;
  let rejected = 0;
  const insertedSamples = [];
  const rejectionReasons = {};
  let batchConsecLow = 0;
  let rateLimited = false;

  function addReject(reason) {
    rejected++;
    rejectionReasons[reason] = (rejectionReasons[reason] || 0) + 1;
  }

  // Main harvest loop
  for (const query of queries) {
    if (Date.now() - START > MAX_MS) break;
    if (fetched >= maxWeb) break;
    if (inserted >= need) break;
    if (rateLimited) break;

    const batchInsertedBefore = inserted;
    console.log(`[HARVEST] query: ${query.slice(0, 80)}`);

    for (let pageIdx = 0; pageIdx < 5; pageIdx++) {
      if (fetched >= maxWeb) break;
      if (inserted >= need) break;
      if (Date.now() - START > MAX_MS) break;

      const { results, rateLimited: rl, httpStatus } = await braveSearch(query, 20, pageIdx * 20);
      fetched += results.length;
      console.log(`[HARVEST] braveSearch results=${results.length} rl=${rl} status=${httpStatus}`);
      if (rl) { rateLimited = true; break; }
      if (results.length === 0) break;

      for (const r of results) {
        if (inserted >= need) break;

        const url = r.url || "";
        const title = r.title || "";
        const snippet = r.snippet || "";

        // D) Hard filters
        if (BLOCKED_URL_PATH.test(url)) { addReject("blocked_url_path"); continue; }
        if (BLOCKED_TITLE.test(title)) { addReject("blocked_title"); continue; }

        let domain;
        try {
          domain = getRegistrableDomain(new URL(url).hostname);
        } catch (_) { addReject("invalid_url"); continue; }

        if (BLOCKED_DOMAINS.has(domain)) { addReject("blocked_domain"); continue; }

        // E) Dedup
        const domNorm = domain.toLowerCase();
        if (kbDomainSet.has(domNorm)) { addReject("already_in_kb"); continue; }

        // F) Sector match
        const fullText = `${title} ${snippet} ${domain}`;
        const sectorScore = scoreSector(fullText, sector);
        if (sectorScore < 1) { addReject("sector_no_match"); continue; }

        // G) GM location check
        const gmCity = detectGmCity(`${title} ${snippet}`);
        const hasGmMention = gmCity || GM_REGEX.test(`${title} ${snippet}`);
        if (!hasGmMention) { addReject("no_gm_location"); continue; }

        // H) Confidence score
        const confidence = computeConfidence(fullText, snippet, domain, sector, gmCity);
        if (confidence < minScore) { addReject(`score_too_low_${confidence}`); continue; }

        // Detect secondary sectors
        const secondarySectors = Object.keys(SECTOR_SYNONYMS)
          .filter(s => s !== sector && scoreSector(fullText, s) >= 3)
          .slice(0, 2);

        // I) Insert KBEntityV2
        const name = extractName(title);
        const todayStr = new Date().toISOString().split("T")[0];
        const hqRegion = gmCity && normalizeQuery(gmCity).includes("montreal") ? "MTL" : "GM";
        const keywords = (SECTOR_SYNONYMS[sector] || [])
          .filter(s => normalizeQuery(fullText).includes(normalizeQuery(s)))
          .slice(0, 8);

        const record = {
          name,
          normalizedName: normalizeQuery(name),
          domain: domNorm,
          website: url,
          hqCity: gmCity || "",
          hqProvince: "QC",
          hqCountry: "CA",
          hqRegion,
          industryLabel: sector,
          industrySectors: [sector, ...secondarySectors],
          entityType: "COMPANY",
          tags: [],
          notes: snippet.slice(0, 300),
          keywords,
          synonyms: [],
          sectorSynonymsUsed: keywords,
          confidenceScore: confidence,
          qualityFlags: ["WEB_HARVEST"],
          sourceOrigin: "WEB",
          sourceUrl: url,
          lastVerifiedAt: todayStr,
        };

        if (!dryRun) {
          try {
            await base44.asServiceRole.entities.KBEntityV2.create(record);
            kbDomainSet.add(domNorm);
            inserted++;
            if (insertedSamples.length < 20) {
              insertedSamples.push({ name, domain: domNorm, city: gmCity, score: confidence, sectors: record.industrySectors });
            }
          } catch (err) {
            addReject("db_insert_error");
            console.log(`[HARVEST] Insert error ${domNorm}: ${err.message}`);
          }
        } else {
          kbDomainSet.add(domNorm);
          inserted++;
          if (insertedSamples.length < 20) {
            insertedSamples.push({ name, domain: domNorm, city: gmCity, score: confidence, sectors: record.industrySectors });
          }
        }
      }
    }

    const batchInserted = inserted - batchInsertedBefore;
    console.log(`[HARVEST] batch done: batchInserted=${batchInserted} fetched=${fetched}`);
    if (batchInserted < 5) batchConsecLow++; else batchConsecLow = 0;
    if (batchConsecLow >= 5) { console.log(`[HARVEST] 5 consecutive low batches — stopping`); break; }
  }

  const currentAfter = currentBefore + (dryRun ? 0 : inserted);

  // Top rejection reasons
  const topRejections = Object.entries(rejectionReasons)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([reason, count]) => ({ reason, count }));

  const elapsedMs = Date.now() - START;
  console.log(`[HARVEST] END inserted=${inserted} rejected=${rejected} fetched=${fetched} elapsed=${elapsedMs}ms`);

  return Response.json({
    sector,
    target,
    currentBefore,
    currentAfter,
    need,
    inserted,
    rejected,
    fetched,
    dryRun,
    elapsedMs,
    status: inserted >= need ? "DONE" : rateLimited ? "RATE_LIMITED" : fetched >= maxWeb ? "MAX_WEB_REACHED" : "PARTIAL",
    topInserted: insertedSamples,
    topRejections,
    brave429Count: braveRL.count429,
  });
});