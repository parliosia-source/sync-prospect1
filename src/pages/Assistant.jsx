import { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { Bot, Plus, MessageSquare, Globe, Building2, Pencil, Trash2, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import MessageBubble from "@/components/assistant/MessageBubble";
import ChatInput from "@/components/assistant/ChatInput";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export default function Assistant() {
  const params = new URLSearchParams(window.location.search);
  const contextProspectId = params.get("prospectId");
  const contextLeadId     = params.get("leadId");

  const [user, setUser] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [activeConvId, setActiveConvId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [isSending, setIsSending] = useState(false);
  const [contextEntity, setContextEntity] = useState(null);

  // Rename/delete state
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);

  const messagesEndRef = useRef(null);

  useEffect(() => {
    base44.auth.me().then(setUser);
    loadConversations();
    if (contextProspectId) loadProspectContext(contextProspectId);
    if (contextLeadId) loadLeadContext(contextLeadId);
  }, []);

  useEffect(() => {
    if (!activeConvId) return;
    const unsub = base44.agents.subscribeToConversation(activeConvId, (data) => {
      setMessages(data.messages || []);
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    });
    return unsub;
  }, [activeConvId]);

  const loadConversations = async () => {
    const convs = await base44.agents.listConversations({ agent_name: "sync_assistant" });
    setConversations(convs || []);
  };

  const loadProspectContext = async (id) => {
    const items = await base44.entities.Prospect.filter({ id });
    if (items[0]) setContextEntity({ type: "prospect", data: items[0] });
  };

  const loadLeadContext = async (id) => {
    const items = await base44.entities.Lead.filter({ id });
    if (items[0]) setContextEntity({ type: "lead", data: items[0] });
  };

  const createNewConversation = async () => {
    const meta = { name: contextEntity ? contextEntity.data.companyName : "Nouvelle conversation" };
    const conv = await base44.agents.createConversation({ agent_name: "sync_assistant", metadata: meta });
    setActiveConvId(conv.id);
    setMessages([]);
    await loadConversations();

    if (contextEntity) {
      const contextMsg = contextEntity.type === "prospect"
        ? `[CONTEXTE PROSPECT]\nEntreprise: ${contextEntity.data.companyName}\nSite: ${contextEntity.data.website}\nIndustrie: ${contextEntity.data.industry || ""}\nScore: ${contextEntity.data.relevanceScore || ""}\nSegment: ${contextEntity.data.segment || ""}\nRaisons: ${(contextEntity.data.relevanceReasons || []).join("; ")}\nApproche: ${contextEntity.data.recommendedApproach || ""}`
        : `[CONTEXTE LEAD]\nEntreprise: ${contextEntity.data.companyName}\nStatut: ${contextEntity.data.status}\nMessages envoyés: ${contextEntity.data.messageCount || 0}`;
      await base44.agents.addMessage(conv, { role: "user", content: contextMsg });
    }
  };

  const openConversation = async (convId) => {
    setActiveConvId(convId);
    const conv = await base44.agents.getConversation(convId);
    setMessages(conv.messages || []);
  };

  const handleSend = async (text) => {
    if (!text.trim()) return;
    let convId = activeConvId;
    if (!convId) {
      const conv = await base44.agents.createConversation({
        agent_name: "sync_assistant",
        metadata: { name: text.slice(0, 40) }
      });
      convId = conv.id;
      setActiveConvId(convId);
      await loadConversations();
    }
    setIsSending(true);
    const conv = await base44.agents.getConversation(convId);
    await base44.agents.addMessage(conv, { role: "user", content: text });
    setIsSending(false);
  };

  const startRename = (conv) => {
    setRenamingId(conv.id);
    setRenameValue(conv.metadata?.name || "");
  };

  const confirmRename = async (convId) => {
    if (!renameValue.trim()) { setRenamingId(null); return; }
    await base44.agents.updateConversation(convId, { metadata: { name: renameValue.trim() } });
    setRenamingId(null);
    await loadConversations();
  };

  const handleDeleteConversation = async (convId) => {
    // If deleting the active conversation, switch to empty state
    if (convId === activeConvId) {
      setActiveConvId(null);
      setMessages([]);
    }
    try {
      // Base44 SDK: delete conversation
      await base44.agents.updateConversation(convId, { metadata: { deleted: true } });
    } catch (_) {}
    setConversations(prev => prev.filter(c => c.id !== convId));
    setDeleteConfirmId(null);
  };

  const filteredMessages = messages.filter(m => {
    if (m.role === "user" && m.content?.startsWith("[CONTEXTE")) return false;
    return true;
  });

  const visibleConversations = conversations.filter(c => !c.metadata?.deleted);

  return (
    <div className="flex h-full overflow-hidden">
      {/* Sidebar */}
      <div className="w-60 flex-shrink-0 bg-white border-r flex flex-col">
        <div className="px-3 py-3 border-b">
          <Button onClick={createNewConversation} size="sm" className="w-full bg-blue-600 hover:bg-blue-700 gap-2 text-xs">
            <Plus className="w-3.5 h-3.5" /> Nouvelle conversation
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto py-2 space-y-0.5 px-2">
          {visibleConversations.length === 0 && (
            <p className="text-xs text-slate-400 text-center py-4 px-2">Aucune conversation</p>
          )}
          {visibleConversations.map(conv => (
            <div
              key={conv.id}
              className={`group flex items-center gap-1 rounded-lg transition-colors ${
                activeConvId === conv.id ? "bg-blue-50" : "hover:bg-slate-50"
              }`}
            >
              {renamingId === conv.id ? (
                <div className="flex items-center gap-1 px-2 py-1.5 w-full">
                  <Input
                    value={renameValue}
                    onChange={e => setRenameValue(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") confirmRename(conv.id); if (e.key === "Escape") setRenamingId(null); }}
                    className="h-6 text-xs px-1.5 flex-1"
                    autoFocus
                  />
                  <button onClick={() => confirmRename(conv.id)} className="text-green-600 hover:text-green-800"><Check className="w-3.5 h-3.5" /></button>
                  <button onClick={() => setRenamingId(null)} className="text-slate-400 hover:text-slate-600"><X className="w-3.5 h-3.5" /></button>
                </div>
              ) : (
                <>
                  <button
                    onClick={() => openConversation(conv.id)}
                    className={`flex items-center gap-1.5 px-2 py-2 text-xs flex-1 min-w-0 text-left ${
                      activeConvId === conv.id ? "text-blue-700" : "text-slate-600"
                    }`}
                  >
                    <MessageSquare className="w-3.5 h-3.5 flex-shrink-0" />
                    <span className="truncate">{conv.metadata?.name || "Conversation"}</span>
                  </button>
                  <div className="flex-shrink-0 hidden group-hover:flex items-center gap-0.5 pr-1">
                    <button onClick={() => startRename(conv)} className="p-1 text-slate-300 hover:text-slate-500 rounded">
                      <Pencil className="w-3 h-3" />
                    </button>
                    <button onClick={() => setDeleteConfirmId(conv.id)} className="p-1 text-slate-300 hover:text-red-500 rounded">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Main chat area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="bg-white border-b px-5 py-3 flex items-center gap-3">
          <Bot className="w-5 h-5 text-blue-500" />
          <div>
            <h2 className="font-semibold text-sm text-slate-800">Assistant SYNC</h2>
            {contextEntity ? (
              <div className="flex items-center gap-1 text-xs text-blue-600">
                <Building2 className="w-3 h-3" />
                Contexte: {contextEntity.data.companyName}
              </div>
            ) : (
              <p className="text-xs text-slate-400">Prospection événementielle · Décideurs · Messages prêts à copier</p>
            )}
          </div>
          <div className="ml-auto flex items-center gap-1.5 text-xs text-green-600 bg-green-50 border border-green-200 rounded-full px-2.5 py-1">
            <Globe className="w-3 h-3" />
            Web activé
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {!activeConvId ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <Bot className="w-12 h-12 text-slate-200 mb-3" />
              <p className="text-slate-500 font-medium">Assistant SYNC — Prospection événementielle</p>
              <p className="text-sm text-slate-400 mt-1 max-w-sm">
                Recherche d'événements, d'organisations cibles, de décideurs LinkedIn, et rédaction de messages personnalisés prêts à copier.
              </p>
              <div className="mt-4 grid grid-cols-1 gap-2 w-full max-w-sm">
                {[
                  "Quels événements corporatifs majeurs sont prévus au Québec cette année ?",
                  "Trouve des entreprises du secteur assurances qui organisent leur propre conférence",
                  "Identifie les décideurs LinkedIn chez Desjardins dans les communications",
                ].map(s => (
                  <button
                    key={s}
                    onClick={() => handleSend(s)}
                    className="text-left text-xs px-3 py-2 rounded-lg border bg-white hover:bg-blue-50 hover:border-blue-300 text-slate-600 transition-colors"
                  >
                    🔍 {s}
                  </button>
                ))}
              </div>
              <Button onClick={createNewConversation} className="mt-4 bg-blue-600 hover:bg-blue-700 gap-2">
                <Plus className="w-4 h-4" /> Démarrer une conversation
              </Button>
            </div>
          ) : filteredMessages.length === 0 ? (
            <div className="text-center text-slate-400 text-sm py-8">
              Posez votre première question…
            </div>
          ) : (
            filteredMessages.map((msg, i) => (
              <MessageBubble key={i} message={msg} leadId={contextLeadId} prospectId={contextProspectId} user={user} />
            ))
          )}
          {isSending && (
            <div className="flex gap-2 items-center text-sm text-slate-400">
              <div className="flex gap-1">
                <span className="w-2 h-2 bg-slate-300 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                <span className="w-2 h-2 bg-slate-300 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                <span className="w-2 h-2 bg-slate-300 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <ChatInput onSend={handleSend} disabled={isSending} />
      </div>

      {/* Delete conversation dialog */}
      <AlertDialog open={!!deleteConfirmId} onOpenChange={() => setDeleteConfirmId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer cette conversation ?</AlertDialogTitle>
            <AlertDialogDescription>
              La conversation et ses messages seront supprimés définitivement.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex gap-2 justify-end">
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={() => handleDeleteConversation(deleteConfirmId)} className="bg-red-600 hover:bg-red-700">
              Supprimer
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}