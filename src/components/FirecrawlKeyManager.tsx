'use client'

import React, { useState } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "../../convex/_generated/api";
import {
  Key,
  Plus,
  Trash2,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  ChevronUp,
  ChevronDown,
  Clock,
  Database
} from "lucide-react";
import { Id } from "../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function FirecrawlKeyManager() {
  const [newKey, setNewKey] = useState("");
  const [keyName, setKeyName] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorStatus, setErrorStatus] = useState<string | null>(null);
  const [successStatus, setSuccessStatus] = useState<string | null>(null);

  const firecrawlKeys = useQuery(api.firecrawlKeys.getUserFirecrawlKeys) || [];
  const addKeyAction = useMutation(api.firecrawlKeys.addFirecrawlKey);
  const deleteKeyAction = useMutation(api.firecrawlKeys.deleteFirecrawlKey);
  const updatePriorityAction = useMutation(api.firecrawlKeys.updateKeyPriority);
  const refreshCreditsAction = useAction(api.firecrawlKeys.refreshAllKeyCredits);

  const handleAddKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKey.trim()) return;

    setIsLoading(true);
    setErrorStatus(null);
    setSuccessStatus(null);

    try {
      await addKeyAction({
        apiKey: newKey,
        name: keyName.trim() || undefined
      });
      setNewKey("");
      setKeyName("");
      setIsAdding(false);
      setSuccessStatus("API key added successfully!");
      setTimeout(() => setSuccessStatus(null), 3000);
    } catch (err) {
      setErrorStatus(err instanceof Error ? err.message : "Failed to add API key");
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteKey = async (keyId: Id<"firecrawlApiKeys">) => {
    if (!window.confirm("Are you sure you want to delete this API key?")) return;

    try {
      await deleteKeyAction({ keyId });
    } catch (_err) {
      setErrorStatus("Failed to delete key");
    }
  };

  const handleMoveKey = async (keyId: Id<"firecrawlApiKeys">, currentPriority: number, direction: 'up' | 'down') => {
    const newPriority = direction === 'up' ? currentPriority - 1 : currentPriority + 1;
    if (newPriority < 0 || newPriority >= firecrawlKeys.length) return;

    try {
      await updatePriorityAction({ keyId, newPriority });
    } catch (_err) {
      setErrorStatus("Failed to update priority");
    }
  };

  const handleRefreshCredits = async () => {
    setIsLoading(true);
    try {
      await refreshCreditsAction();
    } catch (_err) {
      setErrorStatus("Failed to refresh credits");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-orange-500/10 dark:bg-orange-500/20 rounded-lg">
            <Key className="w-5 h-5 text-orange-600 dark:text-orange-500" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-foreground">Firecrawl API Keys</h3>
            <p className="text-sm text-muted-foreground">Manage multiple keys for automatic rotation</p>
          </div>
        </div>

        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefreshCredits}
            disabled={isLoading || firecrawlKeys.length === 0}
            className="flex items-center gap-2"
          >
            <RefreshCw className={cn("w-3.5 h-3.5", isLoading && "animate-spin")} />
            Refresh Credits
          </Button>
          <Button
            variant="orange"
            size="sm"
            onClick={() => setIsAdding(!isAdding)}
            className="flex items-center gap-2"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Key
          </Button>
        </div>
      </div>

      {errorStatus && (
        <div className="flex items-center gap-2 p-3 bg-destructive/10 border border-destructive/20 text-destructive text-sm rounded-lg animate-in fade-in slide-in-from-top-1">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <p>{errorStatus}</p>
        </div>
      )}

      {successStatus && (
        <div className="flex items-center gap-2 p-3 bg-green-500/10 border border-green-500/20 text-green-600 dark:text-green-400 text-sm rounded-lg animate-in fade-in slide-in-from-top-1">
          <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
          <p>{successStatus}</p>
        </div>
      )}

      {isAdding && (
        <Card className="animate-in zoom-in-95 border-dashed">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Add New API Key</CardTitle>
            <CardDescription className="text-xs">Enter your Firecrawl credentials to enable rotation.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleAddKey} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground px-1">Key Name (Optional)</label>
                  <Input
                    placeholder="e.g. Primary Key, Backup 1"
                    value={keyName}
                    onChange={(e) => setKeyName(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground px-1">API Key (starts with fc-)</label>
                  <Input
                    type="password"
                    placeholder="fc-..."
                    value={newKey}
                    onChange={(e) => setNewKey(e.target.value)}
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setIsAdding(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="orange"
                  size="sm"
                  disabled={isLoading || !newKey}
                  className="gap-2"
                >
                  {isLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  Save Key
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {firecrawlKeys.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-8 border-2 border-dashed rounded-2xl bg-muted/20 text-center">
            <div className="p-3 bg-muted rounded-full mb-3 text-muted-foreground">
              <Key className="w-6 h-6" />
            </div>
            <p className="text-muted-foreground font-medium">No API keys added yet</p>
            <p className="text-xs text-muted-foreground/70 max-w-[240px] mt-1">
              Add at least one Firecrawl API key to start monitoring websites.
            </p>
          </div>
        ) : (
          firecrawlKeys.map((key, index) => (
            <div
              key={key._id}
              className={cn(
                "relative group flex items-center gap-4 p-4 rounded-xl border transition-all",
                key.isExhausted
                  ? "bg-destructive/5 border-destructive/20"
                  : "bg-card hover:bg-accent/50 border-border hover:border-accent transition-colors"
              )}
            >
              {/* Priority Indicator */}
              <div className="flex flex-col items-center gap-0.5 min-w-[32px]">
                <button
                  onClick={() => handleMoveKey(key._id as Id<"firecrawlApiKeys">, key.priority, 'up')}
                  disabled={index === 0}
                  className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-0 transition-opacity"
                >
                  <ChevronUp className="w-4 h-4" />
                </button>
                <span className="text-xs font-bold text-muted-foreground/60 group-hover:text-muted-foreground">{index + 1}</span>
                <button
                  onClick={() => handleMoveKey(key._id as Id<"firecrawlApiKeys">, key.priority, 'down')}
                  disabled={index === firecrawlKeys.length - 1}
                  className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-0 transition-opacity"
                >
                  <ChevronDown className="w-4 h-4" />
                </button>
              </div>

              {/* Key Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-semibold text-foreground truncate">
                    {key.name || `Key ${index + 1}`}
                  </span>
                  {index === 0 && !key.isExhausted && (
                    <Badge variant="secondary" className="bg-green-500/10 text-green-600 dark:text-green-500 border-green-500/20 text-[10px] font-bold uppercase py-0 px-1.5">
                      Active
                    </Badge>
                  )}
                  {key.isExhausted && (
                    <Badge variant="destructive" className="bg-destructive/10 text-destructive border-destructive/20 text-[10px] font-bold uppercase py-0 px-1.5">
                      Exhausted
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <code className="bg-muted/50 px-1.5 py-0.5 rounded italic">
                    {key.maskedKey}
                  </code>
                  <div className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    <span>Updated {new Date(key.updatedAt).toLocaleDateString()}</span>
                  </div>
                </div>
              </div>

              {/* Stats */}
              <div className="hidden sm:flex flex-col items-end gap-1 px-4 border-r mr-2">
                <div className="flex items-center gap-1.5 text-foreground">
                  <Database className="w-3.5 h-3.5 text-blue-500" />
                  <span className="text-sm font-medium">
                    {key.remainingCredits !== undefined ? key.remainingCredits.toLocaleString() : "---"}
                  </span>
                </div>
                <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-tight">Credits Left</span>
              </div>

              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleDeleteKey(key._id as Id<"firecrawlApiKeys">)}
                  className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                  title="Delete key"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="p-4 bg-orange-500/5 border border-orange-500/10 rounded-xl flex items-start gap-3">
        <AlertCircle className="w-5 h-5 text-orange-500 flex-shrink-0 mt-0.5" />
        <div className="text-sm">
          <p className="text-orange-900 dark:text-orange-200 font-medium mb-1">API Key Rotation Enabled</p>
          <p className="text-muted-foreground dark:text-orange-200/70 leading-relaxed">
            We&apos;ll automatically use the highest priority key that isn&apos;t exhausted.
            If credits run out during a scrape, we&apos;ll mark the key as exhausted and rotate to the next one automatically.
          </p>
        </div>
      </div>
    </div>
  );
}