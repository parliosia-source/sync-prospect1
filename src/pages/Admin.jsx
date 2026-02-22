import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Settings, FileText, Database, Activity, Plus, Edit2, Save, X, RefreshCw, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

const TABS = [
  { id: "templates", label: "Templates", icon: FileText },
  { id: "settings", label: "Paramètres", icon: Settings },
  { id: "maintenance", label: "Maintenance", icon: Zap },
  { id: "logs", label: "Logs", icon: Activity },
];

export default function Admin() {
  const [user, setUser] = useState(null);
  const [activeTab, setActiveTab] = useState("templates");
  const [templates, setTemplates] = useState([]);
  const [settings, setSettings] = useState(null);
  const [logs, setLogs] = useState([]);
  const [editingTemplate, setEditingTemplate] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [kbStats, setKbStats] = useState(null);
  const [maintenanceLoading, setMaintenanceLoading] = useState(false);
  const [backfillStats, setBackfillStats] = useState(null);

  useEffect(() => {
    base44.auth.me().then(u => {
      setUser(u);
      if (u?.role !== "admin") window.location.href = "/";
    });
  }, []);

  useEffect(() => {
    if (activeTab === "templates") loadTemplates();
    if (activeTab === "settings") loadSettings();
    if (activeTab === "maintenance") loadMaintenance();
    if (activeTab === "logs") loadLogs();
  }, [activeTab]);

  const loadTemplates = async () => {
    const data = await base44.entities.MessageTemplate.filter({}, "-created_date", 50);
    setTemplates(data);
  };

  const loadSettings = async () => {
    const data = await base44.entities.AppSettings.filter({ settingsId: "global" });
    if (data.length > 0) setSettings(data[0]);
    else setSettings({ settingsId: "global", timezone: "America/Montreal", hotScoreThreshold: 75, gazetteLookaheadDays: 90, hunterMonthlyCreditLimit: 50, hunterSafetyBufferCredits: 5, defaultLanguageVariant: "FR_CA", enableSerpFallback: true });
  };

  const loadLogs = async () => {
    const data = await base44.entities.ActivityLog.filter({}, "-created_date", 50);
    setLogs(data);
  };

  const loadMaintenance = async () => {
    setMaintenanceLoading(true);
    const { data } = await base44.functions.invoke('getKbStats');
    setKbStats(data);
    setMaintenanceLoading(false);
  };

  const handleBackfillDryRun = async () => {
    setMaintenanceLoading(true);
    const { data } = await base44.functions.invoke('backfillKbIndustrySectors', { dryRun: true, limit: 2000, fillLocation: true });
    setBackfillStats(data);
    setMaintenanceLoading(false);
  };

  const handleBackfillExecute = async () => {
    if (!window.confirm("Appliquer le backfill à TOUTE la base (2000 entités)? Cette action est irréversible.")) return;
    setMaintenanceLoading(true);
    const { data } = await base44.functions.invoke('backfillKbIndustrySectors', { dryRun: false, limit: 2000, fillLocation: true });
    setBackfillStats(data);
    await loadMaintenance();
    setMaintenanceLoading(false);
  };

  const handleSaveTemplate = async () => {
    setIsSaving(true);
    if (editingTemplate.id) {
      await base44.entities.MessageTemplate.update(editingTemplate.id, editingTemplate);
    } else {
      await base44.entities.MessageTemplate.create(editingTemplate);
    }
    await loadTemplates();
    setEditingTemplate(null);
    setIsSaving(false);
  };

  const handleSaveSettings = async () => {
    setIsSaving(true);
    if (settings.id) {
      await base44.entities.AppSettings.update(settings.id, settings);
    } else {
      await base44.entities.AppSettings.create(settings);
    }
    setIsSaving(false);
  };

  if (!user || user.role !== "admin") return (
    <div className="p-6 text-center text-slate-500">Accès réservé aux administrateurs</div>
  );

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold text-slate-900 mb-5">Administration</h1>

      <div className="flex gap-1 mb-6 border-b">
        {TABS.map(t => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                activeTab === t.id ? "border-blue-600 text-blue-600" : "border-transparent text-slate-500 hover:text-slate-700"
              }`}
            >
              <Icon className="w-4 h-4" /> {t.label}
            </button>
          );
        })}
      </div>

      {/* TEMPLATES */}
      {activeTab === "templates" && (
        <div>
          <div className="flex justify-between mb-4">
            <p className="text-sm text-slate-500">{templates.length} templates actifs</p>
            <Button size="sm" onClick={() => setEditingTemplate({ templateType: "FIRST_MESSAGE", channel: "LINKEDIN", segment: "STANDARD", languageVariant: "FR_CA", body: "", active: true })} className="gap-2">
              <Plus className="w-3.5 h-3.5" /> Nouveau template
            </Button>
          </div>

          {editingTemplate && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-4 space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div>
                  <Label className="text-xs">Type</Label>
                  <Select value={editingTemplate.templateType} onValueChange={v => setEditingTemplate(e => ({ ...e, templateType: v }))}>
                    <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="FIRST_MESSAGE">Premier message</SelectItem>
                      <SelectItem value="FOLLOW_UP_J7">Relance J+7</SelectItem>
                      <SelectItem value="FOLLOW_UP_J14">Relance J+14</SelectItem>
                      <SelectItem value="CUSTOM">Custom</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Canal</Label>
                  <Select value={editingTemplate.channel} onValueChange={v => setEditingTemplate(e => ({ ...e, channel: v }))}>
                    <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="LINKEDIN">LinkedIn</SelectItem>
                      <SelectItem value="EMAIL">Email</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Segment</Label>
                  <Select value={editingTemplate.segment} onValueChange={v => setEditingTemplate(e => ({ ...e, segment: v }))}>
                    <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="HOT">HOT</SelectItem>
                      <SelectItem value="STANDARD">STANDARD</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Langue</Label>
                  <Select value={editingTemplate.languageVariant} onValueChange={v => setEditingTemplate(e => ({ ...e, languageVariant: v }))}>
                    <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="FR_CA">FR-CA</SelectItem>
                      <SelectItem value="FR_FR">FR-FR</SelectItem>
                      <SelectItem value="EN">EN</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {editingTemplate.channel === "EMAIL" && (
                <Input placeholder="Sujet email" value={editingTemplate.subject || ""} onChange={e => setEditingTemplate(t => ({ ...t, subject: e.target.value }))} className="text-sm" />
              )}
              <Textarea
                placeholder="Corps du message (utilisez {firstName}, {senderName}, {senderTitle})"
                value={editingTemplate.body}
                onChange={e => setEditingTemplate(t => ({ ...t, body: e.target.value }))}
                className="text-sm min-h-36 font-mono text-xs"
              />
              <div className="flex gap-2 justify-end">
                <Button variant="outline" size="sm" onClick={() => setEditingTemplate(null)}><X className="w-3.5 h-3.5 mr-1" />Annuler</Button>
                <Button size="sm" onClick={handleSaveTemplate} disabled={isSaving} className="bg-blue-600 hover:bg-blue-700">
                  {isSaving ? <RefreshCw className="w-3.5 h-3.5 animate-spin mr-1" /> : <Save className="w-3.5 h-3.5 mr-1" />}
                  Sauvegarder
                </Button>
              </div>
            </div>
          )}

          <div className="space-y-2">
            {templates.map(t => (
              <div key={t.id} className="bg-white rounded-xl border p-4 flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="text-xs font-medium bg-blue-50 text-blue-700 px-2 py-0.5 rounded">{t.templateType}</span>
                    <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded">{t.channel}</span>
                    <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded">{t.segment}</span>
                    <span className="text-xs text-slate-400">{t.languageVariant}</span>
                    {!t.active && <span className="text-xs text-red-500">Inactif</span>}
                  </div>
                  {t.subject && <div className="text-xs text-slate-500 mb-1">Sujet: {t.subject}</div>}
                  <p className="text-xs text-slate-600 line-clamp-2">{t.body}</p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setEditingTemplate({ ...t })}>
                  <Edit2 className="w-3.5 h-3.5 text-slate-400" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* SETTINGS */}
      {activeTab === "settings" && settings && (
        <div className="space-y-5 max-w-lg">
          <div className="bg-white rounded-xl border p-5 space-y-4">
            <h3 className="font-semibold text-slate-800">Paramètres globaux</h3>
            <div className="grid grid-cols-2 gap-4">
              {[
                { key: "hotScoreThreshold", label: "Seuil score HOT", type: "number" },
                { key: "gazetteLookaheadDays", label: "Gazette (jours)", type: "number" },
                { key: "hunterMonthlyCreditLimit", label: "Limite Hunter/mois", type: "number" },
                { key: "hunterSafetyBufferCredits", label: "Buffer sécurité Hunter", type: "number" },
              ].map(f => (
                <div key={f.key}>
                  <Label className="text-xs">{f.label}</Label>
                  <Input type={f.type} value={settings[f.key] || ""} onChange={e => setSettings(s => ({ ...s, [f.key]: Number(e.target.value) }))} className="mt-1 h-8 text-sm" />
                </div>
              ))}
            </div>
            <div className="flex items-center gap-3">
              <Switch checked={settings.enableSerpFallback} onCheckedChange={v => setSettings(s => ({ ...s, enableSerpFallback: v }))} />
              <Label>Activer fallback SerpApi (si Brave échoue)</Label>
            </div>
          </div>
          <Button onClick={handleSaveSettings} disabled={isSaving} className="bg-blue-600 hover:bg-blue-700 gap-2">
            {isSaving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Sauvegarder les paramètres
          </Button>
        </div>
      )}

      {/* MAINTENANCE */}
      {activeTab === "maintenance" && (
        <div className="space-y-5 max-w-4xl">
          {/* KB Stats */}
          <div className="bg-white rounded-xl border p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-slate-800">Base de connaissances (KB)</h3>
              <Button size="sm" variant="outline" onClick={loadMaintenance} disabled={maintenanceLoading} className="gap-2 text-xs">
                <RefreshCw className={`w-3.5 h-3.5 ${maintenanceLoading ? "animate-spin" : ""}`} />
                Recharger
              </Button>
            </div>
            {kbStats ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="bg-slate-50 rounded-lg p-3">
                  <div className="text-2xl font-bold text-slate-800">{kbStats.totalKBEntities}</div>
                  <div className="text-xs text-slate-500 mt-1">Total entités</div>
                </div>
                <div className="bg-blue-50 rounded-lg p-3">
                  <div className="text-2xl font-bold text-blue-600">{kbStats.countWithIndustrySectors}</div>
                  <div className="text-xs text-slate-500 mt-1">Avec secteurs</div>
                </div>
                <div className="bg-red-50 rounded-lg p-3">
                  <div className="text-2xl font-bold text-red-600">{kbStats.countMissingIndustrySectors}</div>
                  <div className="text-xs text-slate-500 mt-1">Manquent secteurs</div>
                </div>
                <div className="bg-purple-50 rounded-lg p-3">
                  <div className="text-sm font-semibold text-purple-600">{kbStats.fetchedPages} pages</div>
                  <div className="text-xs text-slate-500 mt-1">({kbStats.pageSize} par page)</div>
                </div>
              </div>
            ) : maintenanceLoading ? (
              <div className="text-center py-6 text-slate-400">Chargement...</div>
            ) : null}

            {kbStats && kbStats.countByIndustrySector && Object.keys(kbStats.countByIndustrySector).length > 0 && (
              <div className="mt-4 pt-4 border-t">
                <p className="text-sm font-medium text-slate-700 mb-2">Par secteur:</p>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                  {Object.entries(kbStats.countByIndustrySector).map(([sector, count]) => (
                    <div key={sector} className="text-xs bg-slate-50 rounded px-2 py-1">
                      <span className="font-medium">{sector}</span>: {count}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Backfill KB */}
          <div className="bg-white rounded-xl border p-5">
            <h3 className="font-semibold text-slate-800 mb-4">Backfill secteurs (IA rule-based)</h3>
            <div className="flex gap-2 mb-4">
              <Button onClick={handleBackfillDryRun} disabled={maintenanceLoading} variant="outline" className="gap-2">
                <RefreshCw className={`w-4 h-4 ${maintenanceLoading ? "animate-spin" : ""}`} />
                Dry run (500)
              </Button>
              <Button onClick={handleBackfillExecute} disabled={maintenanceLoading || !backfillStats} className="gap-2 bg-orange-600 hover:bg-orange-700">
                <Zap className="w-4 h-4" />
                Exécuter
              </Button>
            </div>

            {backfillStats && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="bg-slate-50 rounded-lg p-3">
                    <div className="text-xl font-bold text-slate-800">{backfillStats.scanned}</div>
                    <div className="text-xs text-slate-500">Scannées</div>
                  </div>
                  <div className="bg-green-50 rounded-lg p-3">
                    <div className="text-xl font-bold text-green-600">{backfillStats.updated}</div>
                    <div className="text-xs text-slate-500">Mises à jour</div>
                  </div>
                  <div className="bg-yellow-50 rounded-lg p-3">
                    <div className="text-xl font-bold text-yellow-600">{backfillStats.skippedAlreadyFilled}</div>
                    <div className="text-xs text-slate-500">Déjà remplies</div>
                  </div>
                  <div className="bg-red-50 rounded-lg p-3">
                    <div className="text-xl font-bold text-red-600">{backfillStats.skippedLowConfidence}</div>
                    <div className="text-xs text-slate-500">Confiance basse</div>
                  </div>
                </div>

                {backfillStats.bySector && Object.keys(backfillStats.bySector).length > 0 && (
                  <div className="pt-3 border-t">
                    <p className="text-sm font-medium text-slate-700 mb-2">Détection par secteur:</p>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                      {Object.entries(backfillStats.bySector).map(([sector, count]) => (
                        <div key={sector} className="text-xs bg-blue-50 rounded px-2 py-1">
                          <span className="font-medium">{sector}</span>: {count}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {backfillStats.sampleUpdated && backfillStats.sampleUpdated.length > 0 && (
                  <div className="pt-3 border-t">
                    <p className="text-sm font-medium text-slate-700 mb-2">Exemples:</p>
                    <div className="space-y-1 text-xs">
                      {backfillStats.sampleUpdated.map((s, i) => (
                        <div key={i} className="bg-slate-50 rounded px-2 py-1">
                          <span className="font-mono text-slate-600">{s.domain}</span>
                          <span className="text-slate-500 mx-1">→</span>
                          <span className="text-blue-600">{s.sectors.join(", ")}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {backfillStats.dryRun && (
                  <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded text-xs text-amber-800">
                    ⚠ Résultats en simulation (dry run). Cliquez "Exécuter" pour appliquer.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* LOGS */}
      {activeTab === "logs" && (
        <div className="space-y-2">
          <div className="flex justify-between items-center mb-3">
            <p className="text-sm text-slate-500">50 derniers logs</p>
            <Button size="sm" variant="outline" onClick={loadLogs} className="gap-2 text-xs"><RefreshCw className="w-3.5 h-3.5" />Actualiser</Button>
          </div>
          {logs.map(l => (
            <div key={l.id} className={`rounded-lg border px-3 py-2 text-xs flex items-center gap-3 ${l.status === "ERROR" ? "bg-red-50 border-red-100" : "bg-white"}`}>
              <span className={`font-medium w-20 flex-shrink-0 ${l.status === "ERROR" ? "text-red-600" : l.status === "WARNING" ? "text-yellow-600" : "text-green-600"}`}>{l.status}</span>
              <span className="text-slate-600 font-mono">{l.actionType}</span>
              <span className="text-slate-400 truncate flex-1">{l.entityType} {l.entityId?.slice(0, 8)}</span>
              <span className="text-slate-400 flex-shrink-0">{new Date(l.created_date).toLocaleString("fr-CA")}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}