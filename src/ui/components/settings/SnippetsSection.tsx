import { useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import {
  SPICETIFY_SNIPPETS,
  useSpicetifySnippets,
  type SpicetifySnippet,
} from "../../settings/snippets";
import { CloseIcon, PlusIcon, TrashIcon } from "@/ui/icons";

export function SnippetsSection() {
  const { enabledIds, customSnippets, toggle, addCustom, removeCustom } = useSpicetifySnippets();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [expandedCodeId, setExpandedCodeId] = useState<string | null>(null);

  // New Custom Snippet state
  const [isAddingCustom, setIsAddingCustom] = useState(false);
  const [customTitle, setCustomTitle] = useState("");
  const [customCode, setCustomCode] = useState("");

  const allSnippets: SpicetifySnippet[] = useMemo(() => {
    const customConverted: SpicetifySnippet[] = customSnippets.map((cs) => ({
      id: cs.id,
      title: cs.title,
      description: "Custom user-provided CSS snippet",
      code: cs.code,
      category: "custom" as any,
    }));
    return [...SPICETIFY_SNIPPETS, ...customConverted];
  }, [customSnippets]);

  const filteredSnippets = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return allSnippets.filter((snippet) => {
      const matchSearch =
        !q ||
        snippet.title.toLowerCase().includes(q) ||
        snippet.description.toLowerCase().includes(q) ||
        snippet.code.toLowerCase().includes(q);

      const matchCategory =
        selectedCategory === "all" ||
        (selectedCategory === "custom" && snippet.id.startsWith("custom-")) ||
        snippet.category === selectedCategory;

      return matchSearch && matchCategory;
    });
  }, [allSnippets, searchQuery, selectedCategory]);

  const handleCreateCustom = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customCode.trim()) return;
    addCustom(customTitle || "My Custom Snippet", customCode);
    setCustomTitle("");
    setCustomCode("");
    setIsAddingCustom(false);
  };

  return (
    <div className="flex flex-col gap-6 text-foreground">
      {/* Header Info */}
      <div className="flex flex-col gap-1.5 border-b border-border/40 pb-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold tracking-tight">Marketplace Snippets</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Official community CSS snippets from the Spicetify marketplace. Toggle on to inject live custom styles into the app.
            </p>
          </div>

          <button
            type="button"
            onClick={() => setIsAddingCustom(true)}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90 transition-opacity shrink-0 cursor-pointer shadow-sm"
          >
            <PlusIcon size={15} />
            <span>Add Snippet</span>
          </button>
        </div>
      </div>

      {/* Add Custom Modal */}
      {isAddingCustom && (
        <div className="rounded-xl border border-primary/40 bg-card p-4 flex flex-col gap-3 shadow-lg">
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold text-foreground">Create Custom Snippet</span>
            <button
              type="button"
              onClick={() => setIsAddingCustom(false)}
              className="p-1 text-muted-foreground hover:text-foreground cursor-pointer"
            >
              <CloseIcon size={14} />
            </button>
          </div>
          <form onSubmit={handleCreateCustom} className="flex flex-col gap-3">
            <input
              type="text"
              placeholder="Snippet Title (e.g. Floating Sidebar)"
              value={customTitle}
              onChange={(e) => setCustomTitle(e.target.value)}
              className="h-8 rounded-lg border border-border bg-muted/40 px-3 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <textarea
              placeholder="Paste CSS code here..."
              rows={4}
              value={customCode}
              onChange={(e) => setCustomCode(e.target.value)}
              className="rounded-lg border border-border bg-muted/40 p-3 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              required
            />
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setIsAddingCustom(false)}
                className="rounded-lg border border-border px-3 py-1 text-xs text-muted-foreground hover:bg-muted"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-lg bg-primary px-4 py-1 text-xs font-semibold text-primary-foreground hover:opacity-90"
              >
                Save & Apply
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Search & Filter Toolbar */}
      <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
        <input
          type="text"
          placeholder="Search snippets..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="h-8 w-full sm:w-64 rounded-lg border border-border bg-muted/30 px-3 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        />

        <div className="flex items-center gap-1.5 overflow-x-auto w-full sm:w-auto pb-1 [scrollbar-width:none]">
          {[
            { id: "all", label: "All" },
            { id: "player", label: "Player" },
            { id: "lyrics", label: "Lyrics" },
            { id: "visuals", label: "Visuals" },
            { id: "layout", label: "Layout" },
            { id: "custom", label: "Custom" },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setSelectedCategory(tab.id)}
              className={cn(
                "rounded-full px-3 py-1 text-[11px] font-semibold transition-colors cursor-pointer shrink-0",
                selectedCategory === tab.id
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary/40 text-muted-foreground hover:text-foreground hover:bg-secondary/60",
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Snippet Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
        {filteredSnippets.map((snippet) => {
          const isEnabled = enabledIds.has(snippet.id);
          const isCustom = snippet.id.startsWith("custom-");
          const isCodeExpanded = expandedCodeId === snippet.id;

          return (
            <div
              key={snippet.id}
              className={cn(
                "group relative rounded-xl border p-4 flex flex-col justify-between gap-3 transition-all",
                isEnabled
                  ? "border-primary/50 bg-primary/[0.04] shadow-sm"
                  : "border-border/40 bg-card hover:border-border",
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex flex-col gap-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm text-foreground truncate">
                      {snippet.title}
                    </span>
                    {snippet.category && (
                      <span className="rounded-full bg-muted/60 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-muted-foreground shrink-0">
                        {snippet.category}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">
                    {snippet.description}
                  </p>
                </div>

                {/* Toggle Switch */}
                <button
                  type="button"
                  onClick={() => toggle(snippet.id)}
                  className={cn(
                    "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none",
                    isEnabled ? "bg-primary" : "bg-muted",
                  )}
                  role="switch"
                  aria-checked={isEnabled}
                  aria-label={`Toggle ${snippet.title}`}
                >
                  <span
                    className={cn(
                      "pointer-events-none inline-block size-4 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out",
                      isEnabled ? "translate-x-4" : "translate-x-0",
                    )}
                  />
                </button>
              </div>

              {/* Code Toggle & Custom Delete Action */}
              <div className="flex items-center justify-between pt-1 border-t border-border/20 text-xs">
                <button
                  type="button"
                  onClick={() => setExpandedCodeId(isCodeExpanded ? null : snippet.id)}
                  className="text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                >
                  {isCodeExpanded ? "Hide CSS" : "View CSS"}
                </button>

                {isCustom && (
                  <button
                    type="button"
                    onClick={() => removeCustom(snippet.id)}
                    className="flex items-center gap-1 text-[11px] text-destructive hover:underline cursor-pointer"
                  >
                    <TrashIcon size={12} />
                    <span>Delete</span>
                  </button>
                )}
              </div>

              {/* Code snippet expandable preview */}
              {isCodeExpanded && (
                <div className="rounded-lg bg-black/40 border border-white/10 p-2.5 text-[11px] font-mono text-white/80 overflow-x-auto max-h-36 [scrollbar-width:thin]">
                  <pre className="whitespace-pre-wrap">{snippet.code}</pre>
                </div>
              )}
            </div>
          );
        })}

        {filteredSnippets.length === 0 && (
          <div className="col-span-full flex flex-col items-center justify-center py-12 text-center text-muted-foreground gap-2">
            <span className="text-sm font-semibold">No snippets found</span>
            <span className="text-xs">Try searching for something else or create a custom snippet.</span>
          </div>
        )}
      </div>
    </div>
  );
}
