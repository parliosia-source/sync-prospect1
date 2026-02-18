import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import {
  ArrowLeft, Globe, CheckCircle2, XCircle, Send, Brain, Linkedin, Mail,
  User, ExternalLink, RefreshCw, ChevronRight, Lightbulb, AlertCircle, Target
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import StatusBadge from "@/components/shared/StatusBadge";
import CopyButton from "@/components/shared/CopyButton";

export default function ProspectDetail() {
  const params = new URLSearchParams(window.location.search);
  const prospectId = params.get("id");

  const [user, setUser] = useState(null);
  const [prospect, setProspect] = useState(null);
  const [contacts, setContacts] = useState([]);
  const [generatedMsg, setGeneratedMsg] = useState(null);
  const [msgChannel, setMsgChannel] = useState("LINKEDIN");
  const [msgType, setMsgType] = useState("FIRST_MESSAGE");
  const [selectedContactId, setSelectedContactId] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    base44.auth.me().then(setUser);
  }, []);

  useEffect(() => {
    if (!prospectId) return;
    loadData();
  }, [prospectId]);

  const loadData = async () => {
    const [prsp, ctcts] = await Promise.all([
      base44.entities.Prospect.filter({ id: prospectId }).then(r => r[0]),
      base44.entities.Contact.filter({ prospectId }),
    ]);
    setProspect(prsp);
    setContacts(ctcts);
    if (ctcts.length > 0) setSelectedContactId(ctcts[0].id);
  };

  const handleQualify = async (status) => {
    await base44.entities.Prospect.update(prospectId, { status });
    setProspect(p => ({ ...p, status }));
  };

  const handleExport = async () => {
    setIsExporting(true);
    const res = await base44.functions.invoke("exportToLead", { prospectId });
    setIsExporting(false);
    if (res?.data?.leadId) {
      await base44.entities.Prospect.update(prospectId, { status: "EXPORTÉ", leadId: res.data.leadId });
      setProspect(p => ({ ...p, status: "EXPORTÉ", leadId: res.data.leadId }));
      toast?.success?.("Lead créé dans Suivi ✓");
    }
  };

  const handleGenerate = async () => {
    setIsGenerating(true);
    setGeneratedMsg(null);
    const res = await base44.functions.invoke("generateMessage", {
      prospectId,
      channel: msgChannel,
      templateType: msgType,
      contactId: selectedContactId || undefined,
    });
    setGeneratedMsg(res?.data);
    setIsGenerating(false);
  };

  const handleSaveDraft = async () => {
    if (!generatedMsg) return;
    setIsSaving(true);
    await base44.entities.Message.create({
      prospectId,
      ownerUserId: user?.email,
      channel: msgChannel,
      subject: generatedMsg.subject || "",
      body: generatedMsg.body,
      status: "DRAFT",
      generatedByAI: true,
    });
    setIsSaving(false);
  };

  if (!prospect) return (
    <div className="p-6">
      <div className="h-8 w-48 bg-slate-100 rounded animate-pulse mb-4" />
      <div className="h-40 bg-slate-100 rounded animate-pulse" />
    </div>
  );

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-5">
      {/* Back */}
      <div className="flex items-center gap-2">
        <Link to={prospect?.campaignId ? createPageUrl("CampaignDetail") + "?id=" + prospect.campaignId : createPageUrl("Campaigns")}
          className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
          <ArrowLeft className="w-4 h-4" /> Retour
        </Link>
        {prospect.leadId && (
          <Link to={createPageUrl("LeadDetail") + "?id=" + prospect.leadId}
            className="ml-auto inline-flex items-center gap-1 text-sm text-blue-600 hover:underline bg-blue-50 px-2.5 py-1 rounded-lg">
            ✓ Déjà dans Suivi → Voir le lead <ChevronRight className="w-3.5 h-3.5" />
          </Link>
        )}
      </div>

      {/* Header */}
      <div className="bg-white rounded-xl border shadow-sm p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-xl font-bold text-slate-900">{prospect.companyName}</h1>
              <StatusBadge status={prospect.status} />
              {prospect.segment && (
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${prospect.segment === "HOT" ? "bg-orange-100 text-orange-700" : "bg-slate-100 text-slate-600"}`}>
                  {prospect.segment}
                </span>
              )}
              {prospect.relevanceScore && (
                <span className={`text-sm font-bold px-2.5 py-0.5 rounded-full ${prospect.relevanceScore >= 75 ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-600"}`}>
                  Score: {prospect.relevanceScore}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 mt-2 text-sm text-slate-500 flex-wrap">
              <a href={prospect.website} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-blue-500 hover:underline">
                <Globe className="w-3.5 h-3.5" />{prospect.website}
              </a>
              {prospect.industry && <span>{prospect.industry}</span>}
              {prospect.location?.city && <span>📍 {prospect.location.city}{prospect.location.region ? `, ${prospect.location.region}` : ""}</span>}
            </div>
            {prospect.eventTypes?.length > 0 && (
              <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                {prospect.eventTypes.map(e => (
                  <span key={e} className="text-xs px-2 py-0.5 bg-blue-50 text-blue-600 rounded-full">{e}</span>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2 flex-shrink-0">
            {prospect.status === "ANALYSÉ" && (
              <>
                <Button size="sm" onClick={() => handleQualify("QUALIFIÉ")} className="bg-green-600 hover:bg-green-700 gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Qualifier
                </Button>
                <Button size="sm" variant="outline" onClick={() => handleQualify("REJETÉ")} className="text-red-600 border-red-200 hover:bg-red-50 gap-1.5">
                  <XCircle className="w-3.5 h-3.5" /> Rejeter
                </Button>
              </>
            )}
            {prospect.status === "QUALIFIÉ" && !prospect.leadId && (
              <Button size="sm" onClick={handleExport} disabled={isExporting} className="bg-purple-600 hover:bg-purple-700 gap-1.5">
                {isExporting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                {isExporting ? "Export…" : "→ Suivi"}
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Analysis */}
      {prospect.status !== "NOUVEAU" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Raisons */}
          {prospect.relevanceReasons?.length > 0 && (
            <div className="bg-white rounded-xl border shadow-sm p-4">
              <div className="flex items-center gap-2 mb-3">
                <Target className="w-4 h-4 text-blue-500" />
                <span className="font-semibold text-sm text-slate-800">Raisons de pertinence</span>
              </div>
              <ul className="space-y-1.5">
                {prospect.relevanceReasons.map((r, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
                    <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />
                    {r}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Opportunities */}
          {prospect.opportunities?.length > 0 && (
            <div className="bg-white rounded-xl border shadow-sm p-4">
              <div className="flex items-center gap-2 mb-3">
                <Lightbulb className="w-4 h-4 text-yellow-500" />
                <span className="font-semibold text-sm text-slate-800">Opportunités</span>
              </div>
              <ul className="space-y-2">
                {prospect.opportunities.map((o, i) => (
                  <li key={i} className="text-sm">
                    <div className="font-medium text-slate-800">{o.label}</div>
                    {o.detail && <div className="text-xs text-slate-500 mt-0.5">{o.detail}</div>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Pain Points */}
          {prospect.painPoints?.length > 0 && (
            <div className="bg-white rounded-xl border shadow-sm p-4">
              <div className="flex items-center gap-2 mb-3">
                <AlertCircle className="w-4 h-4 text-orange-500" />
                <span className="font-semibold text-sm text-slate-800">Points de douleur</span>
              </div>
              <ul className="space-y-2">
                {prospect.painPoints.map((p, i) => (
                  <li key={i} className="text-sm">
                    <div className="font-medium text-slate-800">{p.label}</div>
                    {p.detail && <div className="text-xs text-slate-500 mt-0.5">{p.detail}</div>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Recommended approach */}
          {prospect.recommendedApproach && (
            <div className="bg-blue-50 rounded-xl border border-blue-100 p-4">
              <div className="flex items-center gap-2 mb-2">
                <Brain className="w-4 h-4 text-blue-600" />
                <span className="font-semibold text-sm text-blue-800">Approche recommandée</span>
              </div>
              <p className="text-sm text-blue-700">{prospect.recommendedApproach}</p>
            </div>
          )}
        </div>
      )}

      {/* Contacts */}
      {contacts.length > 0 && (
        <div className="bg-white rounded-xl border shadow-sm p-4">
          <h3 className="font-semibold text-sm text-slate-800 mb-3 flex items-center gap-2">
            <User className="w-4 h-4 text-slate-500" /> Décideurs identifiés ({contacts.length})
          </h3>
          <div className="space-y-2">
            {contacts.map(c => (
              <div key={c.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                <div>
                  <div className="text-sm font-medium text-slate-800">{c.fullName || `${c.firstName || ""} ${c.lastName || ""}`.trim()}</div>
                  <div className="text-xs text-slate-500">{c.title}</div>
                  {c.email && <div className="text-xs text-blue-600 mt-0.5">{c.email} {c.emailConfidence ? `(${c.emailConfidence}%)` : ""}</div>}
                </div>
                <div className="flex items-center gap-2">
                  {c.linkedinUrl && (
                    <a
                      href={c.linkedinUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-medium bg-blue-600 text-white px-2 py-1 rounded hover:bg-blue-700 transition-colors"
                    >
                      <svg className="w-3 h-3 fill-white" viewBox="0 0 24 24"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
                      LinkedIn
                    </a>
                  )}
                  {!c.hasEmail && c.contactPageUrl && (
                    <a href={c.contactPageUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1">
                      Page contact <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Generate Message */}
      <div className="bg-white rounded-xl border shadow-sm p-4">
        <h3 className="font-semibold text-sm text-slate-800 mb-4 flex items-center gap-2">
          <Mail className="w-4 h-4 text-slate-500" /> Générer un message
        </h3>
        <div className="flex flex-wrap gap-3 mb-4">
          <Select value={msgChannel} onValueChange={setMsgChannel}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="LINKEDIN">LinkedIn</SelectItem>
              <SelectItem value="EMAIL">Email</SelectItem>
            </SelectContent>
          </Select>
          <Select value={msgType} onValueChange={setMsgType}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="FIRST_MESSAGE">Premier message</SelectItem>
              <SelectItem value="FOLLOW_UP_J7">Relance J+7</SelectItem>
              <SelectItem value="FOLLOW_UP_J14">Relance J+14</SelectItem>
            </SelectContent>
          </Select>
          {contacts.length > 0 && (
            <Select value={selectedContactId} onValueChange={setSelectedContactId}>
              <SelectTrigger className="w-48"><SelectValue placeholder="Choisir contact" /></SelectTrigger>
              <SelectContent>
                {contacts.map(c => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.fullName || `${c.firstName} ${c.lastName}`.trim()} — {c.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button onClick={handleGenerate} disabled={isGenerating} className="bg-blue-600 hover:bg-blue-700 gap-2">
            {isGenerating ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Brain className="w-3.5 h-3.5" />}
            {isGenerating ? "Génération…" : "Générer"}
          </Button>
        </div>

        {generatedMsg && (
          <div className="space-y-3">
            {generatedMsg.subject && (
              <div className="p-3 bg-slate-50 rounded-lg">
                <div className="text-xs font-medium text-slate-500 mb-1">Sujet</div>
                <div className="text-sm text-slate-800">{generatedMsg.subject}</div>
              </div>
            )}
            <div className="p-3 bg-slate-50 rounded-lg">
              <div className="text-xs font-medium text-slate-500 mb-1">Message</div>
              <div className="text-sm text-slate-800 whitespace-pre-wrap">{generatedMsg.body}</div>
            </div>
            <div className="flex gap-2">
              <CopyButton text={generatedMsg.body} label="Copier le message" />
              <Button variant="outline" size="sm" onClick={handleSaveDraft} disabled={isSaving} className="gap-1.5">
                {isSaving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : null}
                {isSaving ? "Sauvegarde…" : "Sauvegarder brouillon"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}