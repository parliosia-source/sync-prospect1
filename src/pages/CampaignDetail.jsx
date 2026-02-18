import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { ArrowLeft, Brain, ExternalLink, Building2, MapPin, ChevronRight, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import StatusBadge from "@/components/shared/StatusBadge";

const TABS = ["Tous", "NOUVEAU", "ANALYSÉ", "QUALIFIÉ", "REJETÉ", "EXPORTÉ"];
const TAB_LABELS = { "Tous": "Tous", "NOUVEAU": "Nouveaux", "ANALYSÉ": "Analysés", "QUALIFIÉ": "Qualifiés", "REJETÉ": "Rejetés", "EXPORTÉ": "Exportés" };

export default function CampaignDetail() {
  const params = new URLSearchParams(window.location.search);
  const campaignId = params.get("id");

  const [campaign, setCampaign] = useState(null);
  const [prospects, setProspects] = useState([]);
  const [activeTab, setActiveTab] = useState("Tous");
  const [isLoading, setIsLoading] = useState(true);
  const [analyzingIds, setAnalyzingIds] = useState(new Set());

  useEffect(() => {
    if (!campaignId) return;
    loadAll();
  }, [campaignId]);

  const loadAll = async () => {
    const [camp, prsp] = await Promise.all([
      base44.entities.Campaign.filter({ id: campaignId }).then(r => r[0]),
      base44.entities.Prospect.filter({ campaignId }, "-created_date", 200),
    ]);
    setCampaign(camp);
    setProspects(prsp);
    setIsLoading(false);
  };

  const handleAnalyze = async (prospect) => {
    setAnalyzingIds(s => new Set([...s, prospect.id]));
    await base44.functions.invoke("analyzeProspect", { prospectId: prospect.id });
    await loadAll();
    setAnalyzingIds(s => { const n = new Set(s); n.delete(prospect.id); return n; });
  };

  const handleAnalyzeAll = async () => {
    const toAnalyze = filtered.filter(p => p.status === "NOUVEAU");
    for (const p of toAnalyze) {
      await handleAnalyze(p);
    }
  };

  const filtered = activeTab === "Tous" ? prospects : prospects.filter(p => p.status === activeTab);
  const counts = TABS.reduce((acc, t) => {
    acc[t] = t === "Tous" ? prospects.length : prospects.filter(p => p.status === t).length;
    return acc;
  }, {});

  if (!campaignId) return <div className="p-6 text-slate-500">ID campagne manquant</div>;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <Link to={createPageUrl("Campaigns")} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 mb-4">
        <ArrowLeft className="w-4 h-4" /> Campagnes
      </Link>

      {campaign && (
        <div className="flex items-center justify-between mb-5">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-bold text-slate-900">{campaign.name}</h1>
              <StatusBadge status={campaign.status} type="campaign" />
            </div>
            <div className="flex items-center gap-3 mt-1 text-sm text-slate-500">
              <MapPin className="w-3.5 h-3.5" />{campaign.locationQuery}
              <span>·</span><span>Objectif: {campaign.targetCount} prospects</span>
            </div>
          </div>
          {counts["NOUVEAU"] > 0 && (
            <Button variant="outline" onClick={handleAnalyzeAll} className="gap-2">
              <Brain className="w-4 h-4 text-blue-500" />
              Analyser tous ({counts["NOUVEAU"]})
            </Button>
          )}
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-5 gap-3 mb-5">
        {[
          { label: "Total", value: counts["Tous"], color: "slate" },
          { label: "Analysés", value: counts["ANALYSÉ"], color: "blue" },
          { label: "Qualifiés", value: counts["QUALIFIÉ"], color: "green" },
          { label: "Rejetés", value: counts["REJETÉ"], color: "red" },
          { label: "Exportés", value: counts["EXPORTÉ"], color: "purple" },
        ].map(k => (
          <div key={k.label} className="bg-white rounded-xl border p-3 text-center shadow-sm">
            <div className={`text-xl font-bold text-${k.color}-600`}>{k.value}</div>
            <div className="text-xs text-slate-500 mt-0.5">{k.label}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 overflow-x-auto pb-1">
        {TABS.map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
              activeTab === tab ? "bg-blue-600 text-white" : "bg-white text-slate-600 border hover:bg-slate-50"
            }`}
          >
            {TAB_LABELS[tab]} {counts[tab] > 0 && `(${counts[tab]})`}
          </button>
        ))}
      </div>

      {/* Prospect Table */}
      <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="p-4 space-y-2">
            {[1,2,3,4].map(i => <div key={i} className="h-14 bg-slate-100 rounded animate-pulse" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center text-slate-400">
            <Building2 className="w-8 h-8 mx-auto mb-2 text-slate-300" />
            {activeTab === "Tous" ? "Aucun prospect — lancez la recherche" : `Aucun prospect dans cet onglet`}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b">
              <tr>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500">Entreprise</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500">Industrie</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500">Statut</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500">Score</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-slate-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map(p => {
                const isAnalyzing = analyzingIds.has(p.id);
                return (
                  <tr key={p.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-800">{p.companyName}</div>
                      <a href={p.website} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
                        className="text-xs text-blue-500 hover:underline flex items-center gap-0.5">
                        {p.domain} <ExternalLink className="w-2.5 h-2.5" />
                      </a>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">{p.industry || "—"}</td>
                    <td className="px-4 py-3"><StatusBadge status={p.status} /></td>
                    <td className="px-4 py-3">
                      {p.relevanceScore ? (
                        <span className={`text-xs font-bold px-2 py-0.5 rounded ${p.relevanceScore >= 75 ? "bg-green-50 text-green-700" : "bg-slate-50 text-slate-600"}`}>
                          {p.relevanceScore}
                        </span>
                      ) : "—"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {p.status === "NOUVEAU" && (
                          <Button size="sm" variant="outline" onClick={() => handleAnalyze(p)} disabled={isAnalyzing} className="text-xs gap-1.5 h-7">
                            {isAnalyzing ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Brain className="w-3 h-3 text-blue-500" />}
                            {isAnalyzing ? "Analyse…" : "Analyser"}
                          </Button>
                        )}
                        <Link to={createPageUrl("ProspectDetail") + "?id=" + p.id} className="p-1 text-slate-400 hover:text-blue-500">
                          <ChevronRight className="w-4 h-4" />
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}