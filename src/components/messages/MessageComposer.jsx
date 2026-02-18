import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { toast } from "sonner";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Copy, Save, RefreshCw, RotateCcw, Sparkles, CheckCircle2, ChevronDown, ChevronUp, Send, FileEdit, AlertCircle
} from "lucide-react";

const STATUS_STYLES = {
  DRAFT: "bg-amber-100 text-amber-700",
  COPIED: "bg-blue-100 text-blue-700",
  SENT: "bg-green-100 text-green-700",
};
const STATUS_LABELS = { DRAFT: "Brouillon", COPIED: "Copié", SENT: "Envoyé" };

export default function MessageComposer({ message: initialMessage, onUpdated }) {
  const [msg, setMsg] = useState(initialMessage);
  const [activeTab, setActiveTab] = useState(initialMessage.editedBody ? "EDITED" : "GENERATED");
  const [editedSubject, setEditedSubject] = useState(initialMessage.editedSubject || "");
  const [editedBody, setEditedBody] = useState(initialMessage.editedBody || "");
  const [isSaving, setIsSaving] = useState(false);
  const [isCopying, setIsCopying] = useState(false);
  const [isRefining, setIsRefining] = useState(false);
  const [isMarkingSent, setIsMarkingSent] = useState(false);
  const [showRefinePanel, setShowRefinePanel] = useState(false);
  const [refineTone, setRefineTone] = useState("PROFESSIONNEL");
  const [refineLength, setRefineLength] = useState("MOYEN");
  const [refineObjective, setRefineObjective] = useState("CALL_15");
  const [refineInstructions, setRefineInstructions] = useState("");
  const [suggestions, setSuggestions] = useState([]);

  const generatedContent = msg.generatedBody || msg.body || "";
  const generatedSubject = msg.generatedSubject || msg.subject || "";
  const hasEdited = !!editedBody.trim();

  const activeBody = activeTab === "EDITED" && hasEdited ? editedBody : generatedContent;
  const activeSubject = activeTab === "EDITED" && hasEdited ? editedSubject : generatedSubject;

  const handleSaveDraft = async () => {
    setIsSaving(true);
    const updated = await base44.entities.Message.update(msg.id, {
      editedBody: editedBody || "",
      editedSubject: editedSubject || "",
      activeVersion: hasEdited ? "EDITED" : "GENERATED",
      lastEditedAt: new Date().toISOString(),
      status: "DRAFT",
    });
    setMsg(m => ({ ...m, ...updated, editedBody, editedSubject, status: "DRAFT", lastEditedAt: new Date().toISOString() }));
    toast.success("Brouillon sauvegardé");
    setIsSaving(false);
    onUpdated?.();
  };

  const handleCopy = async () => {
    setIsCopying(true);
    const textToCopy = (msg.channel === "EMAIL" && activeSubject ? `Sujet: ${activeSubject}\n\n` : "") + activeBody;
    await navigator.clipboard.writeText(textToCopy);
    const newCount = (msg.copyCount || 0) + 1;
    const updated = { copyCount: newCount, status: "COPIED", activeVersion: activeTab === "EDITED" && hasEdited ? "EDITED" : "GENERATED" };
    await base44.entities.Message.update(msg.id, updated);
    setMsg(m => ({ ...m, ...updated }));
    toast.success("Message copié dans le presse-papier ✓");
    setIsCopying(false);
    onUpdated?.();
  };

  const handleReset = async () => {
    if (!window.confirm("Réinitialiser la version personnalisée ? La version générée sera conservée.")) return;
    await base44.entities.Message.update(msg.id, { editedBody: "", editedSubject: "", activeVersion: "GENERATED" });
    setEditedBody("");
    setEditedSubject("");
    setActiveTab("GENERATED");
    setMsg(m => ({ ...m, editedBody: "", editedSubject: "", activeVersion: "GENERATED" }));
    setSuggestions([]);
    toast.success("Version personnalisée réinitialisée");
    onUpdated?.();
  };

  const handleRefine = async () => {
    setIsRefining(true);
    setSuggestions([]);
    const res = await base44.functions.invoke("refineMessage", {
      messageId: msg.id,
      tone: refineTone,
      length: refineLength,
      objective: refineObjective,
      instructions: refineInstructions,
    });
    if (res?.data?.editedBody) {
      setEditedBody(res.data.editedBody);
      if (res.data.editedSubject) setEditedSubject(res.data.editedSubject);
      setActiveTab("EDITED");
      setMsg(m => ({ ...m, editedBody: res.data.editedBody, editedSubject: res.data.editedSubject || m.editedSubject, status: "DRAFT" }));
      setSuggestions(res.data.suggestions || []);
      toast.success("Version améliorée générée ✓");
    }
    setIsRefining(false);
  };

  const handleMarkSent = async () => {
    if (msg.status !== "COPIED") {
      toast.warning("Copiez d'abord le message avant de le marquer comme envoyé.");
      return;
    }
    setIsMarkingSent(true);
    await base44.functions.invoke("markMessageSent", {
      messageId: msg.id,
      leadId: msg.leadId,
      channel: msg.channel,
    });
    setMsg(m => ({ ...m, status: "SENT" }));
    toast.success("Message marqué comme envoyé ✓");
    setIsMarkingSent(false);
    onUpdated?.();
  };

  return (
    <div className="border rounded-xl bg-white shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 bg-slate-50 border-b flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
          <FileEdit className="w-4 h-4 text-blue-500" />
          <span>{msg.channel === "LINKEDIN" ? "LinkedIn" : "Email"} — {msg.generatedByAI ? "IA" : "Manuel"}</span>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_STYLES[msg.status] || STATUS_STYLES.DRAFT}`}>
            {STATUS_LABELS[msg.status] || msg.status}
          </span>
          {msg.copyCount > 0 && (
            <span className="text-xs text-slate-400">· Copié {msg.copyCount}×</span>
          )}
        </div>
        {msg.lastEditedAt && (
          <span className="text-xs text-slate-400">
            Modifié le {format(new Date(msg.lastEditedAt), "d MMM à HH:mm", { locale: fr })}
          </span>
        )}
      </div>

      {/* Version tabs */}
      <div className="flex border-b">
        <button
          onClick={() => setActiveTab("GENERATED")}
          className={`flex-1 px-4 py-2 text-xs font-medium transition-colors ${activeTab === "GENERATED" ? "border-b-2 border-blue-500 text-blue-700 bg-blue-50" : "text-slate-500 hover:bg-slate-50"}`}
        >
          Version générée
        </button>
        <button
          onClick={() => setActiveTab("EDITED")}
          className={`flex-1 px-4 py-2 text-xs font-medium transition-colors ${activeTab === "EDITED" ? "border-b-2 border-purple-500 text-purple-700 bg-purple-50" : "text-slate-500 hover:bg-slate-50"}`}
        >
          Version personnalisée {hasEdited && "✏️"}
        </button>
      </div>

      {/* Content */}
      <div className="p-4 space-y-3">
        {/* Subject (email only) */}
        {msg.channel === "EMAIL" && (
          <div>
            <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Sujet</div>
            {activeTab === "GENERATED" ? (
              <div className="text-sm text-slate-800 bg-slate-50 rounded-lg px-3 py-2">{generatedSubject || "—"}</div>
            ) : (
              <input
                type="text"
                value={editedSubject}
                onChange={e => setEditedSubject(e.target.value)}
                placeholder={generatedSubject || "Sujet du message…"}
                className="w-full text-sm border rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-purple-400"
              />
            )}
          </div>
        )}

        {/* Body */}
        <div>
          <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Message</div>
          {activeTab === "GENERATED" ? (
            <div className="text-sm text-slate-800 bg-slate-50 rounded-lg px-3 py-2.5 whitespace-pre-wrap leading-relaxed min-h-32">
              {generatedContent || "—"}
            </div>
          ) : (
            <Textarea
              value={editedBody}
              onChange={e => setEditedBody(e.target.value)}
              placeholder={generatedContent || "Votre version personnalisée…"}
              className="text-sm min-h-40 resize-y leading-relaxed"
            />
          )}
        </div>

        {/* Suggestions from refine */}
        {suggestions.length > 0 && (
          <div className="bg-purple-50 border border-purple-100 rounded-lg p-3">
            <div className="text-xs font-semibold text-purple-700 mb-2">Améliorations appliquées :</div>
            <ul className="space-y-1">
              {suggestions.map((s, i) => (
                <li key={i} className="text-xs text-purple-700 flex items-start gap-1.5">
                  <span className="text-purple-400 mt-0.5">•</span>{s}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-wrap gap-2 pt-1">
          {activeTab === "EDITED" && (
            <Button size="sm" variant="outline" onClick={handleSaveDraft} disabled={isSaving} className="gap-1.5">
              {isSaving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              Sauvegarder
            </Button>
          )}
          <Button size="sm" onClick={handleCopy} disabled={isCopying} className="bg-blue-600 hover:bg-blue-700 gap-1.5">
            {isCopying ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Copy className="w-3.5 h-3.5" />}
            Copier
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowRefinePanel(p => !p)}
            className="gap-1.5"
          >
            <Sparkles className="w-3.5 h-3.5 text-purple-500" />
            Améliorer
            {showRefinePanel ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </Button>
          {hasEdited && (
            <Button size="sm" variant="ghost" onClick={handleReset} className="gap-1.5 text-slate-400 hover:text-red-500">
              <RotateCcw className="w-3.5 h-3.5" />
              Réinitialiser
            </Button>
          )}
          {msg.leadId && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleMarkSent}
              disabled={isMarkingSent || msg.status === "SENT"}
              title={msg.status !== "COPIED" ? "Copiez d'abord le message" : ""}
              className={`gap-1.5 ml-auto ${msg.status === "SENT" ? "text-green-600 border-green-200" : msg.status !== "COPIED" ? "opacity-50" : ""}`}
            >
              {isMarkingSent ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : msg.status === "SENT" ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Send className="w-3.5 h-3.5" />}
              {msg.status === "SENT" ? "Envoyé" : "Marquer envoyé"}
            </Button>
          )}
        </div>

        {msg.leadId && msg.status !== "COPIED" && msg.status !== "SENT" && (
          <div className="flex items-center gap-1.5 text-xs text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
            Copiez d'abord le message, puis cliquez "Marquer envoyé" après l'envoi manuel.
          </div>
        )}

        {/* Refine panel */}
        {showRefinePanel && (
          <div className="border border-purple-100 rounded-xl bg-purple-50 p-4 space-y-3">
            <div className="text-sm font-semibold text-purple-800 flex items-center gap-1.5">
              <Sparkles className="w-4 h-4" /> Améliorer avec l'IA
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">Ton</label>
                <Select value={refineTone} onValueChange={setRefineTone}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PROFESSIONNEL">Professionnel</SelectItem>
                    <SelectItem value="DIRECT">Direct</SelectItem>
                    <SelectItem value="CHALEUREUX">Chaleureux</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">Longueur</label>
                <Select value={refineLength} onValueChange={setRefineLength}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="COURT">Court</SelectItem>
                    <SelectItem value="MOYEN">Moyen</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">Objectif</label>
                <Select value={refineObjective} onValueChange={setRefineObjective}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CALL_15">Call 15 min</SelectItem>
                    <SelectItem value="QUALIFY_EVENT">Qualifier événement</SelectItem>
                    <SelectItem value="FOLLOWUP_J7">Suivi J+7</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1">Instructions libres (optionnel)</label>
              <input
                type="text"
                value={refineInstructions}
                onChange={e => setRefineInstructions(e.target.value)}
                placeholder="Ex: mentionne la saison des congrès, sois plus bref…"
                className="w-full text-xs border rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-purple-400 bg-white"
              />
            </div>
            <Button size="sm" onClick={handleRefine} disabled={isRefining} className="bg-purple-600 hover:bg-purple-700 gap-2">
              {isRefining ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              {isRefining ? "Amélioration en cours…" : "Appliquer les améliorations"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}