import { useCallback, useEffect, useMemo, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import type { EmailItem, Pagination, Sender, User } from "../types";
import Header from "../components/Header";
import { api } from "../services/api";

interface DashboardProps { user: User; onLogout: () => void }
interface PageData { items: EmailItem[]; pagination: Pagination }
interface SlackStatus { teamName?: string | null; webhookChannel?: string | null; teamId?: string | null }

const emptyPage: PageData = { items: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } };
const localDateTime = () => {
  const date = new Date(Date.now() + 60_000);
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16);
};

function parseLeadFile(file: File): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      const matches = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];
      resolve([...new Set(matches.map((email) => email.trim().toLowerCase()))]);
    };
    reader.onerror = () => reject(new Error("Could not read the lead file."));
    reader.readAsText(file);
  });
}

const Dashboard = ({ user, onLogout }: DashboardProps) => {
  const [tab, setTab] = useState<"scheduled" | "sent">("scheduled");
  const [scheduled, setScheduled] = useState<PageData>(emptyPage);
  const [sent, setSent] = useState<PageData>(emptyPage);
  const [senders, setSenders] = useState<Sender[]>([]);
  const [slack, setSlack] = useState<SlackStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [composeOpen, setComposeOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<EmailItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [leadEmails, setLeadEmails] = useState<string[]>([]);
  const [fileName, setFileName] = useState("");
  const [form, setForm] = useState({ senderId: "", subject: "", body: "", startTime: localDateTime(), delayMs: 1000, hourlyLimit: 100 });
  const [newSender, setNewSender] = useState({ name: user.name, email: user.email });
  const [addingSender, setAddingSender] = useState(false);

  const loadSenders = useCallback(async () => {
    const response = await api.get<{ success: boolean; data: Sender[] }>("/senders");
    const list = response.data.data ?? [];
    setSenders(list);
    if (!form.senderId && list[0]) setForm((current) => ({ ...current, senderId: list[0].id }));
  }, [form.senderId]);

  const loadLists = useCallback(async () => {
    const [scheduledResponse, sentResponse] = await Promise.all([api.get<{ success: boolean; data: PageData }>("/emails/scheduled"), api.get<{ success: boolean; data: PageData }>("/emails/sent")]);
    setScheduled(scheduledResponse.data.data ?? emptyPage);
    setSent(sentResponse.data.data ?? emptyPage);
  }, []);

  const loadSlack = useCallback(async () => {
    try { const response = await api.get<{ success: boolean; data: SlackStatus | null }>("/slack/status"); setSlack(response.data.data ?? null); } catch { setSlack(null); }
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try { await Promise.all([loadLists(), loadSenders(), loadSlack()]); } catch (e) { setError(e instanceof Error ? e.message : "Could not load dashboard data."); } finally { setLoading(false); }
  }, [loadLists, loadSenders, loadSlack]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    const trimmed = search.trim();
    if (!trimmed) { setSearchResults([]); setSearching(false); return; }
    const timer = window.setTimeout(async () => {
      setSearching(true);
      try {
        const response = await api.get<{ success: boolean; data: PageData }>("/emails/search", { params: { q: trimmed } });
        setSearchResults(response.data.data?.items ?? []);
      } catch { setError("Search is temporarily unavailable."); setSearchResults([]); } finally { setSearching(false); }
    }, 350);
    return () => window.clearTimeout(timer);
  }, [search]);

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!/\.(csv|txt)$/i.test(file.name)) { setError("Please upload a .csv or .txt file."); return; }
    try { const emails = await parseLeadFile(file); setLeadEmails(emails); setFileName(file.name); setError(emails.length ? "" : "No valid email addresses were detected."); } catch (e) { setError(e instanceof Error ? e.message : "Could not parse file."); }
  };

  const schedule = async (event: FormEvent) => {
    event.preventDefault(); setError(""); setSuccess("");
    if (!form.senderId || !form.subject.trim() || !form.body.trim()) { setError("Sender, subject, and body are required."); return; }
    if (!leadEmails.length) { setError("Upload a lead file containing at least one email address."); return; }
    setSubmitting(true);
    try {
      const response = await api.post("/campaigns", { ...form, recipients: leadEmails, delayMs: Number(form.delayMs), hourlyLimit: Number(form.hourlyLimit), startTime: new Date(form.startTime).toISOString() });
      if (!response.data.success) throw new Error(response.data.error ?? "Could not schedule campaign.");
      setSuccess(`Campaign scheduled for ${leadEmails.length} recipients.`); setComposeOpen(false); setLeadEmails([]); setFileName(""); setForm((current) => ({ ...current, subject: "", body: "", startTime: localDateTime() })); await loadLists();
    } catch (e: any) { setError(e?.response?.data?.error ?? (e instanceof Error ? e.message : "Could not schedule campaign.")); } finally { setSubmitting(false); }
  };

  const addSender = async (event: FormEvent) => {
    event.preventDefault(); setAddingSender(true); setError("");
    try { const response = await api.post("/senders", newSender); if (!response.data.success) throw new Error(response.data.error ?? "Could not add sender."); await loadSenders(); setNewSender({ name: user.name, email: user.email }); } catch (e: any) { setError(e?.response?.data?.error ?? "Could not add sender."); } finally { setAddingSender(false); }
  };

  const connectSlack = () => { window.location.href = `${import.meta.env.VITE_API_URL ?? "http://localhost:5000/api"}/slack/connect`; };
  const disconnectSlack = async () => { try { await api.post("/slack/disconnect"); setSlack(null); } catch { setError("Could not disconnect Slack."); } };
  const visibleItems = useMemo(() => search.trim() ? searchResults : (tab === "scheduled" ? scheduled.items : sent.items), [search, searchResults, tab, scheduled.items, sent.items]);

  return <div className="dashboard">
    <Header user={user} onLogout={onLogout} />
    <main className="dashboard-content">
      <div className="dashboard-title">
        <div><p className="eyebrow">WORKSPACE</p><h1>Email Scheduler</h1><p>Schedule, monitor, and manage your email campaigns.</p></div>
        <button className="primary-button" onClick={() => { setError(""); setComposeOpen(true); }}>+ Compose New Email</button>
      </div>

      {success && <div className="toast success">{success}</div>}
      {error && <div className="toast error">{error}</div>}

      <section className="slack-card">
        <div><strong>Slack notifications</strong><span>{slack ? `Connected${slack.teamName ? ` · ${slack.teamName}` : ""}${slack.webhookChannel ? ` · ${slack.webhookChannel}` : ""}` : "Connect Slack to receive rate-limit alerts."}</span></div>
        {slack ? <button className="secondary-button" onClick={() => void disconnectSlack()}>Disconnect</button> : <button className="slack-button" onClick={connectSlack}>Connect Slack</button>}
      </section>

      <section className="workspace-card">
        <div className="toolbar">
          <div className="tabs"><button className={tab === "scheduled" ? "active-tab" : ""} onClick={() => setTab("scheduled")}>Scheduled <span>{scheduled.pagination.total}</span></button><button className={tab === "sent" ? "active-tab" : ""} onClick={() => setTab("sent")}>Sent <span>{sent.pagination.total}</span></button></div>
          <label className="search-box"><span>⌕</span><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search recipient, subject, status" /></label>
        </div>
        {loading || searching ? <div className="table-state"><div className="spinner" /> Loading…</div> : visibleItems.length === 0 ? <div className="table-state"><div className="empty-icon">✉</div><h3>{search ? "No results found" : `No ${tab} emails`}</h3><p>{search ? "Try a different recipient, subject, or status." : "Your email activity will appear here."}</p></div> : <div className="table-wrap"><table><thead><tr><th>Email</th><th>Subject</th><th>{tab === "scheduled" ? "Scheduled time" : "Sent time"}</th><th>Status</th></tr></thead><tbody>{visibleItems.map((item) => <tr key={item.id}><td>{item.recipient}</td><td className="subject-cell">{item.subject}</td><td>{formatDate(tab === "scheduled" ? item.scheduledAt : item.sentAt)}</td><td><span className={`status status-${item.status.toLowerCase()}`}>{item.status}</span>{item.failureReason && <span className="failure">{item.failureReason}</span>}</td></tr>)}</tbody></table></div>}
      </section>

      <section className="sender-card"><div><strong>Sender accounts</strong><p>Each sender stores its own SMTP configuration. Passwords are never returned by the API.</p></div><form onSubmit={addSender} className="sender-form"><input aria-label="Sender name" value={newSender.name} onChange={(e) => setNewSender({ ...newSender, name: e.target.value })} placeholder="From name" /><input aria-label="Sender email" type="email" value={newSender.email} onChange={(e) => setNewSender({ ...newSender, email: e.target.value })} placeholder="From email" /><button className="secondary-button" disabled={addingSender}>{addingSender ? "Adding…" : "Add sender"}</button></form><div className="sender-list">{senders.map((sender) => <span key={sender.id} className="sender-chip">{sender.name} · {sender.email}</span>)}</div></section>
    </main>

    {composeOpen && <div className="modal-backdrop" role="presentation"><div className="compose-modal" role="dialog" aria-modal="true" aria-labelledby="compose-title"><div className="modal-header"><div><p className="eyebrow">NEW CAMPAIGN</p><h2 id="compose-title">Compose email</h2></div><button className="icon-button" onClick={() => setComposeOpen(false)} aria-label="Close">×</button></div><form onSubmit={schedule} className="compose-form"><label>Sender<select value={form.senderId} onChange={(e) => setForm({ ...form, senderId: e.target.value })} required><option value="">Select sender</option>{senders.map((sender) => <option key={sender.id} value={sender.id}>{sender.name} · {sender.email}</option>)}</select></label><div className="field-grid"><label>Subject<input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} required maxLength={500} /></label><label>Start time<input type="datetime-local" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} required /></label></div><label>Body<textarea rows={7} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} required /></label><label>Lead file <span className="label-note">CSV or TXT</span><input type="file" accept=".csv,.txt,text/csv,text/plain" onChange={(e) => void handleFile(e)} /></label>{fileName && <div className="file-summary"><strong>{fileName}</strong><span>{leadEmails.length} email addresses detected</span></div>}<div className="field-grid"><label>Delay between emails (ms)<input type="number" min={1000} step={100} value={form.delayMs} onChange={(e) => setForm({ ...form, delayMs: Number(e.target.value) })} /></label><label>Hourly limit<input type="number" min={1} value={form.hourlyLimit} onChange={(e) => setForm({ ...form, hourlyLimit: Number(e.target.value) })} /></label></div><div className="form-hint">The backend enforces the configured minimum delay and reserves sender rate-limit slots atomically in Redis.</div><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setComposeOpen(false)}>Cancel</button><button className="primary-button" type="submit" disabled={submitting}>{submitting ? "Scheduling…" : "Schedule"}</button></div></form></div></div>}
  </div>;
};

function formatDate(value?: string | null) { if (!value) return "—"; const date = new Date(value); return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }); }
export default Dashboard;
