import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Plus, Play, RefreshCw, ChevronRight, Search, Calendar, Trash2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import StatusBadge from "@/components/shared/StatusBadge";
import CampaignModal from "@/components/campaigns/CampaignModal";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export default function Campaigns() {
  const [user, setUser] = useState(null);
  const [campaigns, setCampaigns] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [runningIds, setRunningIds] = useState(new Set());
  const [deleteDialog, setDeleteDialog] = useState(null); // {campaignId, name}

  useEffect(() => {
    base44.auth.me().then(setUser);
  }, []);

  useEffect(() => {
    if (!user) return;
    loadCampaigns();
  }, [user]);

  // Poll list while any campaign is RUNNING
  useEffect(() => {
    const hasRunning = campaigns.some(c => c.status === "RUNNING");
    if (!hasRunning) return;
    const interval = setInterval(loadCampaigns, 3000);
    return () => clearInterval(interval);
  }, [campaigns]);

  const loadCampaigns = async () => {
    const filter = user?.role === "admin" ? {} : { ownerUserId: user?.email };
    const data = await base44.entities.Campaign.filter(filter, "-created_date", 50);
    setCampaigns(data);
    setIsLoading(false);
  };

  const handleCreate = async (formData, launch = false) => {
    const camp = await base44.entities.Campaign.create({
      ...formData,
      ownerUserId: user.email,
      status: "DRAFT",
    });
    if (launch) {
      setRunningIds(s => new Set([...s, camp.id]));
      base44.functions.invoke("runProspectSearch", { campaignId: camp.id })
        .finally(() => {
          setRunningIds(s => { const n = new Set(s); n.delete(camp.id); return n; });
        });
      window.location.href = createPageUrl("CampaignDetail") + "?id=" + camp.id;
    } else {
      await loadCampaigns();
    }
  };

  const handleRun = async (campaign) => {
    setRunningIds(s => new Set([...s, campaign.id]));
    await base44.entities.Campaign.update(campaign.id, { status: "RUNNING", progressPct: 0 });
    base44.functions.invoke("runProspectSearch", { campaignId: campaign.id })
      .finally(() => {
        setRunningIds(s => { const n = new Set(s); n.delete(campaign.id); return n; });
        loadCampaigns();
      });
    await loadCampaigns();
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Campagnes</h1>
          <p className="text-sm text-slate-500 mt-0.5">Recherche automatique de prospects par critères</p>
        </div>
        <Button onClick={() => setShowModal(true)} className="bg-blue-600 hover:bg-blue-700 gap-2">
          <Plus className="w-4 h-4" /> Nouvelle campagne
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1,2,3].map(i => <div key={i} className="h-24 bg-slate-100 rounded-xl animate-pulse" />)}
        </div>
      ) : campaigns.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl border">
          <Search className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500 font-medium">Aucune campagne</p>
          <p className="text-sm text-slate-400 mt-1 mb-4">Créez votre première campagne pour démarrer la prospection</p>
          <Button onClick={() => setShowModal(true)} className="bg-blue-600 hover:bg-blue-700">
            <Plus className="w-4 h-4 mr-2" /> Créer une campagne
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {campaigns.map(c => {
            const isRunning = runningIds.has(c.id) || c.status === "RUNNING";
            return (
              <div key={c.id} className="bg-white rounded-xl border shadow-sm hover:shadow-md transition-shadow">
                <div className="px-5 py-4 flex items-center justify-between">
                  <div className="flex items-center gap-4 min-w-0">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-slate-800 text-sm">{c.name}</h3>
                        <StatusBadge status={c.status} type="campaign" />
                      </div>
                      <div className="flex items-center gap-3 mt-1">
                        <span className="text-xs text-slate-500">{c.locationQuery}</span>
                        {c.industrySectors?.length > 0 && (
                          <span className="text-xs text-slate-400">{c.industrySectors.slice(0,2).join(", ")}{c.industrySectors.length > 2 ? `…` : ""}</span>
                        )}
                        {c.lastRunAt && (
                          <span className="text-xs text-slate-400 flex items-center gap-1">
                            <Calendar className="w-3 h-3" />{format(new Date(c.lastRunAt), "d MMM", { locale: fr })}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 flex-shrink-0">
                    {/* KPIs */}
                    <div className="hidden md:flex items-center gap-3 text-xs text-slate-500">
                      <span className="text-center"><div className="font-bold text-slate-700 text-base">{c.countProspects || 0}</div>Prospects</span>
                      <span className="text-center"><div className="font-bold text-green-600 text-base">{c.countQualified || 0}</div>Qualifiés</span>
                      <span className="text-center"><div className="font-bold text-purple-600 text-base">{c.countExported || 0}</div>Exportés</span>
                    </div>

                    {c.status === "RUNNING" || isRunning ? (
                      <Button size="sm" disabled className="gap-2 opacity-70">
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" /> En cours…
                      </Button>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => handleRun(c)} className="gap-2">
                        <Play className="w-3.5 h-3.5" />
                        {c.status === "COMPLETED" || c.status === "DONE_PARTIAL" ? "Relancer" : "Lancer"}
                      </Button>
                    )}

                    <Link to={createPageUrl("CampaignDetail") + "?id=" + c.id} className="p-1.5 text-slate-400 hover:text-blue-500">
                      <ChevronRight className="w-5 h-5" />
                    </Link>
                  </div>
                </div>

                {c.status === "RUNNING" && c.progressPct > 0 && (
                  <div className="px-5 pb-3">
                    <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
                      <span>Recherche en cours…</span>
                      <span>{c.progressPct}%</span>
                    </div>
                    <div className="h-1.5 bg-slate-100 rounded-full">
                      <div className="h-1.5 bg-blue-500 rounded-full transition-all" style={{ width: `${c.progressPct}%` }} />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <CampaignModal open={showModal} onClose={() => setShowModal(false)} onSave={handleCreate} />
    </div>
  );
}