import { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { ArrowLeft, Brain, ExternalLink, Building2, MapPin, ChevronRight, RefreshCw, Clock, Trash2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import StatusBadge from "@/components/shared/StatusBadge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

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
  const [isAnalyzingAll, setIsAnalyzingAll] = useState(false);
  const [cancelDialog, setCancelDialog] = useState(false);
  const [cancelAnalysisDialog, setCancelAnalysisDialog] = useState(false);
  const [deleteDialog, setDeleteDialog] = useState(false);
  const [deleteProspects, setDeleteProspects] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());

  const pollRef = useRef(null);

  useEffect(() => {
    if (!campaignId) return;
    loadAll();
  }, [campaignId]);

  // Poll while RUNNING (search) OR analysis RUNNING — fast at first, slower after 60s
  const pollStartRef = useRef(null);
  useEffect(() => {
    const shouldPoll = campaign?.status === "RUNNING" || campaign?.analysisStatus === "RUNNING";
    if (shouldPoll) {
      if (!pollStartRef.current) pollStartRef.current = Date.now();
      const elapsed = Date.now() - (pollStartRef.current || Date.now());
      const interval = elapsed < 60000 ? 2000 : 5000;
      pollRef.current = setInterval(() => loadAll(), interval);
    } else {
      clearInterval(pollRef.current);
      pollStartRef.current = null;
    }
    return () => clearInterval(pollRef.current);
  }, [campaign?.status, campaign?.analysisStatus]);

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

  const handleReLaunch = async () => {
    await base44.entities.Campaign.update(campaignId, { status: "RUNNING", progressPct: 0, errorMessage: null });
    // Immediately update local state so progress bar appears
    setCampaign(c => ({ ...c, status: "RUNNING", progressPct: 0, errorMessage: null }));
    base44.functions.invoke("runProspectSearch", { campaignId }).finally(() => loadAll());
  };

  const handleCancel = async () => {
    await base44.functions.invoke("cancelCampaign", { campaignId });
    setCancelDialog(false);
    await loadAll();
  };

  const handleCancelAnalysis = async () => {
    setCancelAnalysisDialog(false);
    await base44.functions.invoke("cancelAnalysis", { campaignId });
    setIsAnalyzingAll(false);
    await loadAll();
  };

  const handleDelete = async () => {
    await base44.functions.invoke("deleteCampaign", { campaignId, deleteProspects });
    window.location.href = createPageUrl("Campaigns");
  };

  const handleAnalyzeAll = (prospectIds) => {
    // Immediately show RUNNING state — fire-and-forget
    setCampaign(c => ({ ...c, analysisStatus: "RUNNING", analysisProgressPct: 0 }));
    setIsAnalyzingAll(true);
    // Do NOT clear selectedIds here so checkboxes stay visible during run
    base44.functions.invoke("analyzeCampaignProspects", {
      campaignId,
      ...(prospectIds && prospectIds.length > 0 ? { prospectIds } : {}),
    }).then(() => {
      setIsAnalyzingAll(false);
      setSelectedIds(new Set());
      loadAll();
    }).catch((err) => {
      setIsAnalyzingAll(false);
      const msg = err?.response?.status === 502
        ? "Timeout — l'analyse continue en arrière-plan. Rechargez dans quelques minutes."
        : err?.message || "Erreur inattendue";
      setCampaign(c => ({ ...c, errorMessage: msg }));
      loadAll();
    });
  };

  // Check if analysis heartbeat is stale (> 2 minutes = stuck)
  const analysisIsStale = campaign?.analysisStatus === "RUNNING" &&
    campaign?.analysisLastHeartbeatAt &&
    (Date.now() - new Date(campaign.analysisLastHeartbeatAt).getTime()) > 2 * 60 * 1000;

  const filtered = activeTab === "Tous" ? prospects : prospects.filter(p => p.status === activeTab);
  const counts = TABS.reduce((acc, t) => {
    acc[t] = t === "Tous" ? prospects.length : prospects.filter(p => p.status === t).length;
    return acc;
  }, {});
  const failedCount = prospects.filter(p => p.status === "FAILED_ANALYSIS").length;

  if (!campaignId) return <div className="p-6 text-slate-500">ID campagne manquant</div>;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <Link to={createPageUrl("Campaigns")} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 mb-4">
        <ArrowLeft className="w-4 h-4" /> Campagnes
      </Link>

      {campaign && (
        <div className="mb-5">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-xl font-bold text-slate-900">{campaign.name}</h1>
                <StatusBadge status={campaign.status} type="campaign" />
              </div>
              <div className="flex items-center gap-3 mt-1 text-sm text-slate-500">
                <MapPin className="w-3.5 h-3.5" />{campaign.locationQuery}
                <span>·</span><span>Objectif: {campaign.targetCount} prospects</span>
                {campaign.lastRunAt && (
                  <span className="flex items-center gap-1 text-xs text-slate-400">
                    <Clock className="w-3 h-3" /> {new Date(campaign.lastRunAt).toLocaleString("fr-CA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </span>
                )}
              </div>
            </div>
            <div className="flex gap-2">
              {failedCount > 0 && campaign.analysisStatus !== "RUNNING" && (
                <Button variant="outline" size="sm" onClick={() => handleAnalyzeAll(prospects.filter(p => p.status === "FAILED_ANALYSIS").map(p => p.id))} disabled={isAnalyzingAll} className="gap-1.5 border-red-200 text-red-600 hover:bg-red-50 text-xs h-8">
                  <RefreshCw className="w-3 h-3" />
                  Reprendre ({failedCount} échecs)
                </Button>
              )}
              {(counts["NOUVEAU"] > 0 || selectedIds.size > 0) && campaign.status !== "RUNNING" && campaign.analysisStatus !== "RUNNING" && (
                <Button variant="outline" onClick={() => selectedIds.size > 0 ? handleAnalyzeAll([...selectedIds]) : handleAnalyzeAll()} disabled={isAnalyzingAll} className="gap-2">
                  {isAnalyzingAll ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Brain className="w-4 h-4 text-blue-500" />}
                  {isAnalyzingAll ? "Lancement…" : selectedIds.size > 0 ? `Analyser la sélection (${selectedIds.size})` : `Analyser tous les NOUVEAU (${counts["NOUVEAU"]})`}
                </Button>
              )}
              {selectedIds.size > 0 && (
                <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())} className="text-slate-400 hover:text-slate-600 text-xs px-2 h-8">
                  ✕ Sélection
                </Button>
              )}
              {analysisIsStale && (
                <Button variant="outline" onClick={() => handleAnalyzeAll()} className="gap-2 border-orange-300 text-orange-700 hover:bg-orange-50">
                  <RefreshCw className="w-4 h-4" />
                  Reprendre l'analyse
                </Button>
              )}
              {campaign.analysisStatus === "RUNNING" && (
                <Button variant="outline" onClick={() => setCancelAnalysisDialog(true)} className="gap-2 border-orange-300 text-orange-700 hover:bg-orange-50 text-xs h-8">
                  Arrêter l'analyse
                </Button>
              )}
              {campaign.status === "RUNNING" && (
                <Button variant="outline" onClick={() => setCancelDialog(true)} className="gap-2 border-orange-300 text-orange-700 hover:bg-orange-50">
                  Annuler la recherche
                </Button>
              )}
              {["DONE_PARTIAL", "FAILED", "CANCELED", "COMPLETED", "DRAFT"].includes(campaign.status) && (
                <Button variant="outline" onClick={() => setDeleteDialog(true)} className="gap-2 text-red-600 border-red-200 hover:bg-red-50">
                  <Trash2 className="w-4 h-4" />
                  Supprimer
                </Button>
              )}
            </div>
          </div>

          {/* DONE_PARTIAL — informational, not an error */}
          {campaign.status === "DONE_PARTIAL" && campaign.errorMessage && (
            <div className={`mt-3 rounded-xl px-4 py-3 text-sm flex items-start gap-2 ${
              campaign.toolUsage?.stopReason === "BUDGET_GUARD" 
                ? "bg-red-50 border border-red-200 text-red-800" 
                : "bg-amber-50 border border-amber-200 text-amber-800"
            }`}>
              <span className={`mt-0.5 ${campaign.toolUsage?.stopReason === "BUDGET_GUARD" ? "text-red-500" : "text-amber-500"}`}>⚠</span>
              <div className="flex-1">
                <span className="font-medium">{campaign.toolUsage?.stopReason === "BUDGET_GUARD" ? "Budget Brave atteint : " : "Recherche incomplète : "}</span>
                {campaign.errorMessage}
                {campaign.toolUsage?.braveRequestsUsed !== undefined && (
                  <div className="text-xs mt-1 opacity-75">
                    Requêtes Brave utilisées : {campaign.toolUsage.braveRequestsUsed} / {campaign.toolUsage.braveMaxRequests || 250}
                  </div>
                )}
                <div className="mt-1.5">
                  <button onClick={handleReLaunch} className={`text-xs underline ${
                    campaign.toolUsage?.stopReason === "BUDGET_GUARD"
                      ? "text-red-700 hover:text-red-900"
                      : "text-amber-700 hover:text-amber-900"
                  }`}>
                    Relancer la recherche
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Error */}
          {campaign.status === "FAILED" && campaign.errorMessage && (
            <div className="mt-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700 flex items-start gap-2">
              <span className="font-medium">Erreur :</span>
              <div>
                {campaign.errorMessage}
                <div className="mt-1.5">
                  <button onClick={handleReLaunch} className="text-xs text-red-600 underline hover:text-red-900">Relancer la recherche</button>
                </div>
              </div>
            </div>
          )}

          {/* Analysis progress bar */}
          {campaign.analysisStatus === "RUNNING" && !analysisIsStale && (
            <div className="mt-3 bg-purple-50 border border-purple-100 rounded-xl px-4 py-3">
              <div className="flex items-center justify-between text-xs text-purple-700 mb-1.5">
                <span className="flex items-center gap-1.5 font-medium">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  Analyse IA en cours… (continue même si vous quittez la page)
                </span>
                <span>{campaign.analysisProgressPct || 0}%</span>
              </div>
              <div className="h-2 bg-purple-100 rounded-full overflow-hidden">
                <div className="h-2 bg-purple-500 rounded-full transition-all duration-500" style={{ width: `${campaign.analysisProgressPct || 0}%` }} />
              </div>
              <div className="text-xs text-purple-400 mt-1">
                {campaign.countAnalyzed || 0} analysés sur {counts["Tous"]} prospects
              </div>
            </div>
          )}

          {/* Search progress bar */}
          {campaign.status === "RUNNING" && (
            <div className="mt-3 bg-blue-50 border border-blue-100 rounded-xl px-4 py-3">
              <div className="flex items-center justify-between text-xs text-blue-700 mb-1.5">
                <span className="flex items-center gap-1.5 font-medium">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  Recherche en cours…
                </span>
                <span>{campaign.progressPct || 0}%</span>
              </div>
              <div className="h-2 bg-blue-100 rounded-full overflow-hidden">
                <div className="h-2 bg-blue-500 rounded-full transition-all duration-500" style={{ width: `${campaign.progressPct || 0}%` }} />
              </div>
              <div className="text-xs text-blue-500 mt-1.5 space-y-1">
                <div>
                {(campaign.progressPct || 0) < 20 ? "🌐 Initialisation des requêtes…" :
                 (campaign.progressPct || 0) < 70 ? "🌐 Recherche web & collecte…" :
                 (campaign.progressPct || 0) < 87 ? "🌐 Fallbacks élargis…" :
                 (campaign.progressPct || 0) < 95 ? "📚 Complétion KB…" :
                 "✅ Finalisation…"}
                {" · "}<strong>{counts["Tous"]}</strong>/{campaign.targetCount} prospects trouvés
                </div>
                {campaign.toolUsage?.braveRequestsUsed !== undefined && (
                  <div className="text-slate-500 flex gap-3">
                    <span>Brave : {campaign.toolUsage.braveRequestsUsed} / {campaign.toolUsage.braveMaxRequests || 250} req</span>
                    {campaign.toolUsage.kbTopupAdded > 0 && (
                      <span className="text-purple-500">📚 KB : +{campaign.toolUsage.kbTopupAdded}</span>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-5 gap-3 mb-3">
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

      {/* Web vs KB source breakdown */}
      {prospects.length > 0 && (() => {
        const webCount = prospects.filter(p => !p.sourceOrigin || p.sourceOrigin === "WEB").length;
        const kbCount  = prospects.filter(p => p.sourceOrigin === "KB_TOPUP").length;
        if (kbCount === 0) return null;
        return (
          <div className="flex items-center gap-3 mb-4 text-xs text-slate-500 bg-white border rounded-xl px-4 py-2.5 shadow-sm">
            <span className="font-medium text-slate-600">Sources :</span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-2 h-2 rounded-full bg-blue-400"></span>
              Web : <strong className="text-slate-700">{webCount}</strong>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-2 h-2 rounded-full bg-purple-400"></span>
              KB : <strong className="text-slate-700">{kbCount}</strong>
            </span>
            {campaign?.toolUsage?.freshnessChecksDone > 0 && (
              <span className="text-slate-400 ml-1">· {campaign.toolUsage.freshnessChecksDone} freshness checks</span>
            )}
            {campaign?.toolUsage?.brave429Count > 0 && (
              <span className="text-amber-500 ml-1">· {campaign.toolUsage.brave429Count} retry 429</span>
            )}
          </div>
        );
      })()}

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
                <th className="px-3 py-2.5 w-8">
                  <input
                    type="checkbox"
                    className="rounded border-slate-300 cursor-pointer"
                    checked={filtered.length > 0 && filtered.every(p => selectedIds.has(p.id))}
                    onChange={e => {
                      if (e.target.checked) setSelectedIds(new Set(filtered.map(p => p.id)));
                      else setSelectedIds(new Set());
                    }}
                  />
                </th>
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
                  <tr key={p.id} className={`hover:bg-slate-50 ${selectedIds.has(p.id) ? "bg-blue-50" : ""}`}>
                    <td className="px-3 py-3">
                      <input
                        type="checkbox"
                        className="rounded border-slate-300 cursor-pointer"
                        checked={selectedIds.has(p.id)}
                        onChange={() => setSelectedIds(prev => {
                          const next = new Set(prev);
                          if (next.has(p.id)) next.delete(p.id);
                          else next.add(p.id);
                          return next;
                        })}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium text-slate-800">{p.companyName}</span>
                        {p.sourceOrigin === "KB_TOPUP" && (
                          <span className="text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded font-medium">KB</span>
                        )}
                      </div>
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

      {/* Cancel Analysis Dialog */}
      <AlertDialog open={cancelAnalysisDialog} onOpenChange={setCancelAnalysisDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-orange-500" />
              Arrêter l'analyse ?
            </AlertDialogTitle>
            <AlertDialogDescription>
              L'analyse en cours sera arrêtée. Les prospects déjà analysés seront conservés. Les restants resteront en NOUVEAU.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex gap-2 justify-end">
            <AlertDialogCancel>Continuer l'analyse</AlertDialogCancel>
            <AlertDialogAction onClick={handleCancelAnalysis} className="bg-orange-500 hover:bg-orange-600">
              Arrêter
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>

      {/* Cancel Search Confirmation Dialog */}
      <AlertDialog open={cancelDialog} onOpenChange={setCancelDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-orange-500" />
              Annuler la recherche ?
            </AlertDialogTitle>
            <AlertDialogDescription>
              La recherche sera stoppée et la campagne marquée comme annulée. Les {counts["Tous"]} prospects trouvés seront conservés.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex gap-2 justify-end">
            <AlertDialogCancel>Maintenir la recherche</AlertDialogCancel>
            <AlertDialogAction onClick={handleCancel} className="bg-orange-500 hover:bg-orange-600">
              Annuler la recherche
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialog} onOpenChange={setDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-red-500" />
              Supprimer la campagne ?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Cette action est irréversible. La campagne "{campaign?.name}" sera supprimée définitivement.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3 my-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={deleteProspects} onChange={(e) => setDeleteProspects(e.target.checked)} />
              <span className="text-sm text-slate-700">Supprimer aussi les {counts["Tous"]} prospects liés</span>
            </label>
            {!deleteProspects && (
              <div className="text-xs text-slate-500 bg-slate-50 p-2 rounded">Les prospects resteront dans la base mais seront orphelins (non liés à une campagne).</div>
            )}
          </div>
          <div className="flex gap-2 justify-end">
            <AlertDialogCancel>Conserver</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-red-600 hover:bg-red-700">
              Supprimer la campagne
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}