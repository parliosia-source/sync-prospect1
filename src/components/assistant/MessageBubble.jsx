import ReactMarkdown from "react-markdown";
import { Bot, User, Copy, Check, ChevronRight, CheckCircle2, AlertCircle, Loader2, Clock } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

const FunctionDisplay = ({ toolCall }) => {
  const [expanded, setExpanded] = useState(false);
  const name = toolCall?.name || "Fonction";
  const status = toolCall?.status || "pending";

  const statusConfig = {
    pending: { icon: Clock, color: "text-slate-400", text: "En attente" },
    running: { icon: Loader2, color: "text-slate-500", text: "En cours…", spin: true },
    in_progress: { icon: Loader2, color: "text-slate-500", text: "En cours…", spin: true },
    completed: { icon: CheckCircle2, color: "text-green-600", text: "Terminé" },
    success: { icon: CheckCircle2, color: "text-green-600", text: "Terminé" },
    failed: { icon: AlertCircle, color: "text-red-500", text: "Erreur" },
    error: { icon: AlertCircle, color: "text-red-500", text: "Erreur" },
  }[status] || { icon: Clock, color: "text-slate-400", text: "" };

  const Icon = statusConfig.icon;

  return (
    <div className="mt-2 text-xs">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg border bg-white hover:bg-slate-50 transition-all"
      >
        <Icon className={cn("h-3 w-3", statusConfig.color, statusConfig.spin && "animate-spin")} />
        <span className="text-slate-600 capitalize">{name.replace(/_/g, " ")}</span>
        <span className="text-slate-400">· {statusConfig.text}</span>
        {(toolCall.arguments_string || toolCall.results) && (
          <ChevronRight className={cn("h-3 w-3 text-slate-400 ml-auto transition-transform", expanded && "rotate-90")} />
        )}
      </button>
    </div>
  );
};

export default function MessageBubble({ message }) {
  const [copied, setCopied] = useState(false);
  const isUser = message.role === "user";

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content || "");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={cn("flex gap-3 group", isUser ? "justify-end" : "justify-start")}>
      {!isUser && (
        <div className="h-7 w-7 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center flex-shrink-0 mt-0.5">
          <Bot className="w-3.5 h-3.5 text-blue-500" />
        </div>
      )}

      <div className={cn("max-w-[80%]", isUser && "flex flex-col items-end")}>
        {message.content && (
          <div className={cn(
            "rounded-2xl px-4 py-2.5 relative",
            isUser
              ? "bg-slate-800 text-white text-sm"
              : "bg-white border border-slate-200 text-sm"
          )}>
            {isUser ? (
              <p className="leading-relaxed whitespace-pre-wrap">{message.content}</p>
            ) : (
              <>
                <ReactMarkdown
                  className="prose prose-sm prose-slate max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
                  components={{
                    p: ({ children }) => <p className="my-1 leading-relaxed">{children}</p>,
                    ul: ({ children }) => <ul className="my-1 ml-4 list-disc">{children}</ul>,
                    ol: ({ children }) => <ol className="my-1 ml-4 list-decimal">{children}</ol>,
                    li: ({ children }) => <li className="my-0.5">{children}</li>,
                    strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                    code: ({ inline, children }) => inline
                      ? <code className="px-1 py-0.5 rounded bg-slate-100 text-slate-700 text-xs font-mono">{children}</code>
                      : <pre className="bg-slate-900 text-slate-100 rounded-lg p-3 overflow-x-auto my-2 text-xs font-mono whitespace-pre-wrap"><code>{children}</code></pre>,
                  }}
                >
                  {message.content}
                </ReactMarkdown>
                <button
                  onClick={handleCopy}
                  className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-slate-100"
                >
                  {copied ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3 text-slate-400" />}
                </button>
              </>
            )}
          </div>
        )}
        {message.tool_calls?.length > 0 && (
          <div className="space-y-1 mt-1">
            {message.tool_calls.map((tc, i) => <FunctionDisplay key={i} toolCall={tc} />)}
          </div>
        )}
      </div>

      {isUser && (
        <div className="h-7 w-7 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0 mt-0.5">
          <User className="w-3.5 h-3.5 text-slate-500" />
        </div>
      )}
    </div>
  );
}