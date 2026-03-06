/**
 * Settings panel — privacy toggles, system prompt, export/import.
 */

import { useState, useRef, type ChangeEvent } from 'react';
import type { AppSettings, ChatSession } from '../types';
import { exportJSON, exportMarkdown, downloadFile, importJSON, importMarkdown } from '../lib/exportImport';

interface SettingsProps {
  settings: AppSettings;
  onUpdateSettings: (update: Partial<AppSettings>) => void;
  sessions: ChatSession[];
  onImport: (sessions: ChatSession[]) => void;
  onClearAll: () => Promise<void>;
  onClose: () => void;
  onLogout: () => void;
  notifySuccess: (msg: string) => void;
  notifyError: (msg: string) => void;
}

export default function Settings({
  settings,
  onUpdateSettings,
  sessions,
  onImport,
  onClearAll,
  onClose,
  onLogout,
  notifySuccess,
  notifyError,
}: SettingsProps) {
  const [systemPrompt, setSystemPrompt] = useState(settings.systemPrompt);
  const [confirmClear, setConfirmClear] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExportJSON = () => {
    const json = exportJSON(sessions);
    downloadFile(json, `pollinations-chat-${Date.now()}.json`, 'application/json');
    notifySuccess('Chat exported as JSON');
  };

  const handleExportMarkdown = () => {
    const md = exportMarkdown(sessions);
    downloadFile(md, `pollinations-chat-${Date.now()}.md`, 'text/markdown');
    notifySuccess('Chat exported as Markdown');
  };

  const handleImportFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      let imported: ChatSession[];

      if (file.name.endsWith('.json')) {
        imported = importJSON(text);
      } else if (file.name.endsWith('.md') || file.name.endsWith('.markdown')) {
        imported = importMarkdown(text);
      } else {
        // Try JSON first, then Markdown
        try {
          imported = importJSON(text);
        } catch {
          imported = importMarkdown(text);
        }
      }

      onImport(imported);
      notifySuccess(`Imported ${imported.length} chat session(s)`);
    } catch {
      notifyError('Failed to import file. Please make sure it\'s a valid export file.');
    }

    e.target.value = '';
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-40 p-2 sm:p-4">
      <div className="bg-card border border-border rounded-lg w-full max-w-lg max-h-[92vh] sm:max-h-[80vh] overflow-y-auto p-4 sm:p-6 shadow-xl">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-foreground">Settings</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Toggles */}
        <div className="space-y-4 mb-6">
          <Toggle
            label="Show usage icon"
            description="Display pollen balance and usage in the header"
            checked={settings.showUsageIcon}
            onChange={(v) => onUpdateSettings({ showUsageIcon: v })}
          />
          <Toggle
            label="Auto-fetch usage after generation"
            description="Automatically retrieve pollen/token stats after each response"
            checked={settings.autoFetchUsage}
            onChange={(v) => onUpdateSettings({ autoFetchUsage: v })}
          />
          <Toggle
            label="Read balance on every generation"
            description="Check pollen balance before sending each request"
            checked={settings.autoReadBalance}
            onChange={(v) => onUpdateSettings({ autoReadBalance: v })}
          />
        </div>

        {/* System prompt */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-foreground mb-2">
            System Prompt
          </label>
          <textarea
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            onBlur={() => onUpdateSettings({ systemPrompt })}
            rows={3}
            className="w-full bg-secondary border border-border rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        {/* Generation controls */}
        <div className="space-y-4 mb-6">
          <div>
            <div className="flex items-center justify-between mb-2">
              <label htmlFor="temperature-slider" className="text-sm font-medium text-foreground">
                Temperature
              </label>
              <span className="text-xs text-muted-foreground">{settings.temperature.toFixed(2)}</span>
            </div>
            <input
              id="temperature-slider"
              type="range"
              min={0}
              max={2}
              step={0.1}
              value={settings.temperature}
              onChange={(e) => onUpdateSettings({ temperature: Number(e.target.value) })}
              className="w-full accent-primary"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Controls how deterministic vs. varied the response is.
            </p>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label htmlFor="creativity-slider" className="text-sm font-medium text-foreground">
                Creativity
              </label>
              <span className="text-xs text-muted-foreground">{settings.creativity.toFixed(2)}</span>
            </div>
            <input
              id="creativity-slider"
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={settings.creativity}
              onChange={(e) => onUpdateSettings({ creativity: Number(e.target.value) })}
              className="w-full accent-primary"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Scales how strongly temperature is applied.
            </p>
          </div>
        </div>

        <div className="mb-6">
          <Toggle
            label="Enhance text prompts"
            description="Only for text prompts. Rewrites your prompt for clarity and adds guidance for richer output."
            checked={settings.enablePromptEnhancement}
            onChange={(v) => onUpdateSettings({ enablePromptEnhancement: v })}
          />
        </div>

        {/* Export / Import */}
        <div className="mb-6">
          <h3 className="text-sm font-medium text-foreground mb-3">Data Management</h3>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={handleExportJSON}
              disabled={sessions.length === 0}
              className="px-3 py-2 bg-secondary border border-border rounded-md text-sm text-foreground hover:bg-accent disabled:opacity-50 transition-colors"
            >
              Export JSON
            </button>
            <button
              onClick={handleExportMarkdown}
              disabled={sessions.length === 0}
              className="px-3 py-2 bg-secondary border border-border rounded-md text-sm text-foreground hover:bg-accent disabled:opacity-50 transition-colors"
            >
              Export Markdown
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="px-3 py-2 bg-secondary border border-border rounded-md text-sm text-foreground hover:bg-accent transition-colors"
            >
              Import
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,.md,.markdown"
              onChange={handleImportFile}
              className="hidden"
            />
          </div>
        </div>

        {/* Clear data and cache */}
        <div className="mb-6">
          <h3 className="text-sm font-medium text-foreground mb-3">Danger Zone</h3>
          {!confirmClear ? (
            <button
              onClick={() => setConfirmClear(true)}
              disabled={sessions.length === 0}
              className="w-full py-2.5 border border-destructive text-destructive rounded-md hover:bg-destructive/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm"
            >
              Clear data and cache of Chats
            </button>
          ) : (
            <div className="p-3 border border-destructive rounded-md bg-destructive/5 space-y-3">
              <p className="text-sm text-destructive">
                This will permanently delete all {sessions.length} chat{sessions.length !== 1 ? 's' : ''}. This action cannot be undone.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={async () => {
                    try {
                      await onClearAll();
                      setConfirmClear(false);
                      notifySuccess('All chats cleared');
                    } catch {
                      notifyError('Failed to clear data. Please try again.');
                      setConfirmClear(false);
                    }
                  }}
                  className="flex-1 py-2 bg-destructive text-destructive-foreground rounded-md hover:bg-destructive/90 transition-colors text-sm font-medium"
                >
                  Delete all chats
                </button>
                <button
                  onClick={() => setConfirmClear(false)}
                  className="flex-1 py-2 border border-border rounded-md hover:bg-accent transition-colors text-sm text-foreground"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Warning */}
        <div className="mb-6 p-3 bg-secondary border border-yellow-900 rounded-md">
          <p className="text-xs text-yellow-500">
            <strong>DATABASE IS NOT AVAILABLE</strong> — Chats are stored locally only.
            If you clear your browser, data will be lost. Use Export to backup.
          </p>
        </div>

        {/* Logout */}
        <button
          onClick={onLogout}
          className="w-full py-2.5 border border-destructive text-destructive rounded-md hover:bg-destructive/10 transition-colors text-sm"
        >
          Log out (clear API key)
        </button>
      </div>
    </div>
  );
}

function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (val: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <span className="text-sm text-foreground">{label}</span>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <button
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background ${
          checked ? 'bg-primary' : 'bg-muted'
        }`}
      >
        <span
          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full shadow ring-0 transition duration-200 ease-in-out ${
            checked ? 'translate-x-5 bg-primary-foreground' : 'translate-x-0 bg-muted-foreground'
          }`}
        />
      </button>
    </div>
  );
}
