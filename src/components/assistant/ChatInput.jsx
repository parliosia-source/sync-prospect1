import { useState, useRef } from "react";
import { Send, Lightbulb } from "lucide-react";
import { Button } from "@/components/ui/button";

const SUGGESTIONS = [
  "Quels événements B2B à Montréal dans les 90 prochains jours ?",
  "Trouve des entreprises qui annoncent une AGA au Québec",
  "Aide-moi à gérer l'objection 'on a déjà un fournisseur AV'",
  "Écris un message LinkedIn pour une association professionnelle qui organise un congrès",
];

export default function ChatInput({ onSend, disabled }) {
  const [text, setText] = useState("");
  const textareaRef = useRef(null);

  const handleSend = () => {
    if (!text.trim() || disabled) return;
    onSend(text.trim());
    setText("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInput = (e) => {
    setText(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
  };

  return (
    <div className="bg-white border-t px-4 py-3">
      {/* Suggestions (show when empty) */}
      {!text && (
        <div className="flex flex-wrap gap-2 mb-3">
          {SUGGESTIONS.slice(0, 2).map((s, i) => (
            <button
              key={i}
              onClick={() => setText(s)}
              className="text-xs px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-full text-slate-600 hover:bg-blue-50 hover:border-blue-200 hover:text-blue-600 transition-colors flex items-center gap-1.5"
            >
              <Lightbulb className="w-3 h-3" />
              {s.length > 50 ? s.slice(0, 50) + "…" : s}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          placeholder="Posez votre question ou demandez de l'aide…"
          rows={1}
          disabled={disabled}
          className="flex-1 resize-none border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-300 placeholder-slate-400 bg-slate-50 disabled:opacity-50 min-h-[40px]"
          style={{ overflow: "hidden" }}
        />
        <Button
          onClick={handleSend}
          disabled={!text.trim() || disabled}
          size="sm"
          className="bg-blue-600 hover:bg-blue-700 h-10 w-10 p-0 rounded-xl flex-shrink-0"
        >
          <Send className="w-4 h-4" />
        </Button>
      </div>
      <p className="text-xs text-slate-400 mt-1.5">Entrée pour envoyer · Shift+Entrée pour saut de ligne</p>
    </div>
  );
}