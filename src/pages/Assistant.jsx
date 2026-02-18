import { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Bot, Plus, MessageSquare, Globe, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import MessageBubble from "@/components/assistant/MessageBubble";
import ChatInput from "@/components/assistant/ChatInput";

export default function Assistant() {
  const params = new URLSearchParams(window.location.search);
  const contextProspectId = params.get("prospectId");
  const contextLeadId = params.get("leadId");

  const [user, setUser] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [activeConvId, setActiveConvId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [isSending, setIsSending] = useState(false);
  const [contextEntity, setContextEntity] = useState(null);
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
    const meta = { name: contextEntity ? `${contextEntity.data.companyName}` : "Nouvelle conversation" };
    const conv = await base44.agents.createConversation({ agent_name: "sync_assistant", metadata: meta });
    setActiveConvId(conv.id);
    setMessages([]);
    await loadConversations();

    // Auto-inject context if any
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

  const filteredMessages = messages.filter(m => {
    if (m.role === "user" && m.content?.startsWith("[CONTEXTE")) return false;
    return true;
  });

  return (
    <div className="flex h-full overflow-hidden">
      {/* Sidebar conversations */}
      <div className="w-56 flex-shrink-0 bg-white border-r flex flex-col">
        <div className="px-3 py-3 border-b">
          <Button onClick={createNewConversation} size="sm" className="w-full bg-blue-600 hover:bg-blue-700 gap-2 text-xs">
            <Plus className="w-3.5 h-3.5" /> Nouvelle conv.
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto py-2 space-y-0.5 px-2">
          {conversations.length === 0 && (
            <p className="text-xs text-slate-400 text-center py-4 px-2">Aucune conversation</p>
          )}
          {conversations.map(conv => (
            <button
              key={conv.id}
              onClick={() => openConversation(conv.id)}
              className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-colors ${
                activeConvId === conv.id ? "bg-blue-50 text-blue-700" : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              <div className="flex items-center gap-1.5 min-w-0">
                <MessageSquare className="w-3.5 h-3.5 flex-shrink-0" />
                <span className="truncate">{conv.metadata?.name || "Conversation"}</span>
              </div>
            </button>
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
                Contexte: {contextEntity.data.companyName} ({contextEntity.type})
              </div>
            ) : (
              <p className="text-xs text-slate-400">Prospection, scripts, objections, recherche événements</p>
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
              <p className="text-slate-500 font-medium">Assistant de prospection SYNC</p>
              <p className="text-sm text-slate-400 mt-1 max-w-sm">
                Posez des questions sur vos prospects, obtenez des angles d'approche, scripts de prospection ou aide pour gérer les objections.
              </p>
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

        {/* Input */}
        <ChatInput onSend={handleSend} disabled={isSending} />
      </div>
    </div>
  );
}