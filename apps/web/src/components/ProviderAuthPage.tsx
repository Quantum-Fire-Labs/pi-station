import { useEffect, useMemo, useState } from "react";
import type { AuthPromptView, AuthTransaction, ModelChoice, ProviderAuthStatus, ProviderAuthType, ThinkingLevel } from "@pi-station/application-protocol";
import { ArrowLeft, Check, ChevronRight, Copy, ExternalLink, KeyRound, LoaderCircle, Search, ShieldCheck } from "lucide-react";
import type { ApplicationClient } from "../application/application-client";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { SettingsLayout } from "./SettingsLayout";

const safeUrl = (value: string): string | undefined => {
  try { const url = new URL(value); return url.protocol === "https:" ? url.href : undefined; } catch { return undefined; }
};
const openExternal = (url: string): void => { const safe = safeUrl(url); if (safe !== undefined) window.open(safe, "_blank", "noopener,noreferrer"); };
const providerPriority = ["anthropic", "openai-codex", "openai", "google", "google-gemini-cli", "github-copilot"];
const providerDescription = (provider: ProviderAuthStatus): string => provider.methods.some(({ type }) => type === "oauth") ? "Connect an account or use a provider credential." : "Connect with a provider credential.";
const methodDescription = (type: ProviderAuthType): string => type === "oauth" ? "Sign in with your provider account in a secure browser window." : "Enter a key or complete the provider credential setup.";

type AuthClient = Pick<ApplicationClient, "getAuthProviders" | "startProviderLogin" | "getAuthTransaction" | "answerAuthPrompt" | "cancelProviderLogin" | "logoutProvider">;
type ModelSetup = { readonly defaults: { readonly provider: string; readonly modelId: string; readonly thinkingLevel: ThinkingLevel }; readonly models: readonly ModelChoice[] };

export function ProviderAuthPage({ client, onboarding = false, onBack, onComplete }: { client: AuthClient; onboarding?: boolean; onBack?: () => void; onComplete?: () => void }) {
  const [providers, setProviders] = useState<readonly ProviderAuthStatus[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState<string>();
  const [transaction, setTransaction] = useState<AuthTransaction>();
  const [answer, setAnswer] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [modelSetup, setModelSetup] = useState<ModelSetup>();
  const [selectedModel, setSelectedModel] = useState("");
  const [savingModel, setSavingModel] = useState(false);
  const refresh = (): Promise<void> => client.getAuthProviders().then(setProviders);
  useEffect(() => { void refresh().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load providers.")).finally(() => setLoading(false)); }, []);
  useEffect(() => {
    if (transaction?.status !== "running") return;
    const timer = window.setInterval(() => { void client.getAuthTransaction(transaction.id).then((next) => { setTransaction(next); if (next.status === "succeeded") void refresh(); }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Authentication update failed.")); }, 500);
    return () => window.clearInterval(timer);
  }, [client, transaction?.id, transaction?.status]);
  useEffect(() => {
    if (!onboarding || transaction?.status !== "succeeded" || modelSetup !== undefined) return;
    void loadModelSetup().then((setup) => { setModelSetup(setup); setSelectedModel(JSON.stringify([setup.defaults.provider, setup.defaults.modelId])); }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load models."));
  }, [modelSetup, onboarding, transaction?.status]);
  const selectedProvider = providers.find(({ id }) => id === selectedProviderId);
  const promptKey = useMemo(() => transaction?.prompt === undefined ? "" : `${transaction.id}:${transaction.prompt.type}:${transaction.prompt.message}`, [transaction]);
  useEffect(() => setAnswer(""), [promptKey]);

  const start = async (providerId: string, type: ProviderAuthType): Promise<void> => {
    setError(undefined);
    try { setTransaction(await client.startProviderLogin(providerId, type)); } catch (reason) { setError(reason instanceof Error ? reason.message : "Authentication could not start."); }
  };
  const respond = async (): Promise<void> => {
    if (transaction === undefined) return;
    try { setTransaction(await client.answerAuthPrompt(transaction.id, answer)); setAnswer(""); } catch (reason) { setError(reason instanceof Error ? reason.message : "Response was not accepted."); }
  };
  const cancel = async (): Promise<void> => { if (transaction !== undefined) setTransaction(await client.cancelProviderLogin(transaction.id)); };
  const logout = async (providerId: string): Promise<void> => { if (!window.confirm("Sign out from this provider?")) return; setProviders(await client.logoutProvider(providerId)); };
  const chooseProvider = (providerId: string): void => { setSelectedProviderId(providerId); setTransaction(undefined); setModelSetup(undefined); setError(undefined); };
  const saveModel = async (): Promise<void> => {
    if (modelSetup === undefined || selectedModel === "") return;
    const [provider, modelId] = JSON.parse(selectedModel) as [string, string];
    setSavingModel(true); setError(undefined);
    try { await saveSessionDefaults({ provider, modelId, thinkingLevel: modelSetup.defaults.thinkingLevel }); onComplete?.(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save the model."); } finally { setSavingModel(false); }
  };

  if (!onboarding) return <SettingsLayout title="Model Providers" description="Manage provider accounts and API keys." onBack={onBack ?? (() => undefined)}><ProviderAccounts providers={providers} loading={loading} error={error} onConnect={chooseProvider} onLogout={logout} />{selectedProvider !== undefined && <ConnectionDialog provider={selectedProvider} transaction={transaction} answer={answer} setAnswer={setAnswer} onStart={start} onRespond={respond} onCancel={cancel} onClose={() => setSelectedProviderId(undefined)} />}</SettingsLayout>;

  const step = modelSetup !== undefined ? 3 : selectedProvider === undefined ? 1 : 2;
  return <main className="provider-auth-onboarding">
    <header className="provider-auth-intro"><div className="provider-auth-mark"><KeyRound aria-hidden="true" /></div><p className="provider-auth-kicker">Pi Station setup</p><h1>{step === 1 ? "Connect a model provider" : step === 2 ? `Connect ${selectedProvider?.name ?? "provider"}` : "Choose your default model"}</h1><p>{step === 1 ? "Select the provider that you want to use. You can add more providers later in Settings." : step === 2 ? "Choose the connection method that matches your account." : "Pi Station will use this model for new Sessions."}</p></header>
    <SetupSteps current={step} />
    {error !== undefined && <p className="form-error provider-auth-error" role="alert">{error}</p>}
    {step === 1 && <ProviderPicker providers={providers} loading={loading} query={query} setQuery={setQuery} showAll={showAll} setShowAll={setShowAll} onChoose={chooseProvider} />}
    {step === 2 && selectedProvider !== undefined && <ConnectionStep provider={selectedProvider} transaction={transaction} answer={answer} setAnswer={setAnswer} onStart={start} onRespond={respond} onCancel={cancel} onBack={() => { setSelectedProviderId(undefined); setTransaction(undefined); }} onUseConnected={() => { setTransaction({ id: "existing", providerId: selectedProvider.id, status: "succeeded", events: [], expiresAt: new Date().toISOString() }); }} />}
    {step === 3 && modelSetup !== undefined && <ModelStep setup={modelSetup} value={selectedModel} onChange={setSelectedModel} saving={savingModel} onSave={saveModel} onSkip={() => onComplete?.()} />}
  </main>;
}

function SetupSteps({ current }: { current: number }) {
  return <ol className="provider-setup-steps" aria-label="Setup progress">{["Provider", "Connect", "Model"].map((label, index) => { const number = index + 1; return <li key={label} className={number === current ? "current" : number < current ? "complete" : ""}><span>{number < current ? <Check aria-hidden="true" /> : number}</span><small>{label}</small></li>; })}</ol>;
}

function ProviderPicker({ providers, loading, query, setQuery, showAll, setShowAll, onChoose }: { providers: readonly ProviderAuthStatus[]; loading: boolean; query: string; setQuery: (value: string) => void; showAll: boolean; setShowAll: (value: boolean) => void; onChoose: (id: string) => void }) {
  const ordered = [...providers].filter(({ methods, configured }) => methods.length > 0 || configured).sort((a, b) => { const ai = providerPriority.indexOf(a.id); const bi = providerPriority.indexOf(b.id); return (ai < 0 ? 100 : ai) - (bi < 0 ? 100 : bi) || a.name.localeCompare(b.name); });
  const filtered = ordered.filter(({ name }) => name.toLowerCase().includes(query.trim().toLowerCase()));
  const visible = query !== "" || showAll ? filtered : filtered.slice(0, 6);
  if (loading) return <div className="provider-auth-loading" role="status"><LoaderCircle className="spin" aria-hidden="true" />Loading providers…</div>;
  return <section className="provider-picker" aria-label="Model providers"><div className="provider-search"><Search aria-hidden="true" /><Input type="search" aria-label="Search providers" placeholder="Search providers" value={query} onChange={(event) => setQuery(event.target.value)} /></div><div className="provider-grid">{visible.map((provider) => <button className="provider-choice" type="button" key={provider.id} onClick={() => onChoose(provider.id)}><ProviderIdentity provider={provider} /><ChevronRight aria-hidden="true" /></button>)}</div>{filtered.length > 6 && query === "" && <Button type="button" variant="ghost" className="provider-show-all" onClick={() => setShowAll(!showAll)}>{showAll ? "Show fewer providers" : `Show all ${filtered.length} providers`}</Button>}</section>;
}

function ProviderIdentity({ provider }: { provider: ProviderAuthStatus }) {
  return <><span className="provider-avatar" aria-hidden="true">{provider.name.slice(0, 1).toUpperCase()}</span><span className="provider-choice-copy"><strong>{provider.name}</strong><small>{providerDescription(provider)}</small></span>{provider.configured && <Badge variant="secondary"><Check aria-hidden="true" />Connected</Badge>}</>;
}

function ConnectionStep({ provider, transaction, answer, setAnswer, onStart, onRespond, onCancel, onBack, onUseConnected }: { provider: ProviderAuthStatus; transaction: AuthTransaction | undefined; answer: string; setAnswer: (value: string) => void; onStart: (id: string, type: ProviderAuthType) => Promise<void>; onRespond: () => Promise<void>; onCancel: () => Promise<void>; onBack: () => void; onUseConnected: () => void }) {
  return <section className="provider-connection-step"><Button type="button" variant="ghost" className="provider-back" onClick={onBack}><ArrowLeft aria-hidden="true" />Choose another provider</Button>{transaction === undefined ? <Card className="provider-connection-card"><CardHeader><ProviderIdentity provider={provider} /></CardHeader><CardContent className="provider-methods">{provider.configured && <button type="button" className="provider-method" onClick={onUseConnected}><ShieldCheck aria-hidden="true" /><span><strong>Use connected account</strong><small>Continue with the credential that is already configured.</small></span><ChevronRight aria-hidden="true" /></button>}{provider.methods.map((method) => <button type="button" className="provider-method" key={method.type} onClick={() => void onStart(provider.id, method.type)}><KeyRound aria-hidden="true" /><span><strong>{method.name}</strong><small>{methodDescription(method.type)}</small></span><ChevronRight aria-hidden="true" /></button>)}</CardContent></Card> : <AuthInteractionPanel transaction={transaction} answer={answer} setAnswer={setAnswer} onRespond={onRespond} onCancel={onCancel} />}</section>;
}

function ModelStep({ setup, value, onChange, saving, onSave, onSkip }: { setup: ModelSetup; value: string; onChange: (value: string) => void; saving: boolean; onSave: () => Promise<void>; onSkip: () => void }) {
  return <Card className="provider-model-card"><CardHeader><CardTitle>Default model</CardTitle><CardDescription>You can change the model for each Session at any time.</CardDescription></CardHeader><CardContent><label className="provider-model-field">Model<select value={value} onChange={(event) => onChange(event.target.value)}>{setup.models.map((model) => <option key={`${model.provider}/${model.modelId}`} value={JSON.stringify([model.provider, model.modelId])}>{model.displayName ?? model.modelId} · {model.provider}</option>)}</select></label><div className="provider-model-actions"><Button type="button" disabled={saving || setup.models.length === 0} onClick={() => void onSave()}>{saving && <LoaderCircle className="spin" aria-hidden="true" />}Start using Pi Station</Button><Button type="button" variant="ghost" onClick={onSkip}>Skip for now</Button></div></CardContent></Card>;
}

function ProviderAccounts({ providers, loading, error, onConnect, onLogout }: { providers: readonly ProviderAuthStatus[]; loading: boolean; error: string | undefined; onConnect: (id: string) => void; onLogout: (id: string) => Promise<void> }) {
  if (loading) return <p role="status">Loading providers…</p>;
  return <div className="provider-account-list">{error !== undefined && <p className="form-error" role="alert">{error}</p>}{providers.filter(({ configured, methods }) => configured || methods.length > 0).map((provider) => <Card key={provider.id} size="sm"><CardHeader><CardTitle>{provider.name}</CardTitle><CardDescription>{provider.configured ? `Connected${provider.configuredType === undefined ? "" : ` with ${provider.configuredType === "oauth" ? "OAuth" : "an API key"}`}` : "Not connected"}</CardDescription><CardAction>{provider.configured ? <Button type="button" size="sm" variant="outline" onClick={() => void onLogout(provider.id)}>Sign out</Button> : <Button type="button" size="sm" variant="outline" onClick={() => onConnect(provider.id)}>Connect</Button>}</CardAction></CardHeader></Card>)}</div>;
}

function ConnectionDialog({ provider, transaction, answer, setAnswer, onStart, onRespond, onCancel, onClose }: { provider: ProviderAuthStatus; transaction: AuthTransaction | undefined; answer: string; setAnswer: (value: string) => void; onStart: (id: string, type: ProviderAuthType) => Promise<void>; onRespond: () => Promise<void>; onCancel: () => Promise<void>; onClose: () => void }) {
  return <Card className="provider-settings-connect"><CardHeader><CardTitle>Connect {provider.name}</CardTitle><CardAction><Button type="button" size="sm" variant="ghost" onClick={onClose}>Close</Button></CardAction></CardHeader><CardContent>{transaction === undefined ? <div className="provider-auth-actions">{provider.methods.map((method) => <Button key={method.type} type="button" variant="outline" onClick={() => void onStart(provider.id, method.type)}>{method.name}</Button>)}</div> : <AuthInteractionPanel transaction={transaction} answer={answer} setAnswer={setAnswer} onRespond={onRespond} onCancel={onCancel} />}</CardContent></Card>;
}

function AuthInteractionPanel({ transaction, answer, setAnswer, onRespond, onCancel }: { transaction: AuthTransaction; answer: string; setAnswer: (value: string) => void; onRespond: () => Promise<void>; onCancel: () => Promise<void> }) {
  const prompt = transaction.prompt;
  return <Card className="provider-auth-interaction"><CardContent>
    {transaction.status === "running" && transaction.events.length === 0 && <div className="auth-waiting"><LoaderCircle className="spin" aria-hidden="true" /><p>Starting authentication…</p></div>}
    {transaction.events.map((event, index) => <div className="auth-event" key={`${event.type}-${index}`}>
      {event.type === "auth_url" && <><div><strong>Continue in your browser</strong><p>{event.instructions ?? "Complete sign-in on the provider page. This page will update automatically."}</p></div>{safeUrl(event.url) !== undefined && <Button type="button" variant="outline" onClick={() => openExternal(event.url)}>Open sign-in page<ExternalLink aria-hidden="true" /></Button>}</>}
      {event.type === "device_code" && <DeviceCode code={event.userCode} url={event.verificationUri} />}
      {(event.type === "info" || event.type === "progress") && <><p>{event.message}</p>{event.type === "info" && event.links?.map((link) => safeUrl(link.url) === undefined ? null : <Button variant="link" type="button" key={link.url} onClick={() => openExternal(link.url)}>{link.label ?? "Open link"}</Button>)}</>}
    </div>)}
    {prompt !== undefined && <Prompt prompt={prompt} value={answer} onChange={setAnswer} onSubmit={onRespond} />}
    {transaction.status === "running" && <Button type="button" variant="ghost" onClick={() => void onCancel()}>Cancel</Button>}
    {transaction.status === "succeeded" && <div className="auth-success" role="status"><span><Check aria-hidden="true" /></span><div><strong>Provider connected</strong><p>Loading available models…</p></div></div>}
    {transaction.error !== undefined && <p className="form-error" role="alert">{transaction.error}</p>}
  </CardContent></Card>;
}

function DeviceCode({ code, url }: { code: string; url: string }) {
  const [copied, setCopied] = useState(false);
  return <div className="device-code"><strong>Enter this code on the provider page</strong><div><code>{code}</code><Button type="button" size="icon-sm" variant="outline" aria-label="Copy device code" onClick={() => { void navigator.clipboard.writeText(code).then(() => setCopied(true)); }}><Copy aria-hidden="true" /></Button></div>{copied && <small role="status">Code copied.</small>}{safeUrl(url) !== undefined && <Button type="button" variant="outline" onClick={() => openExternal(url)}>Open verification page<ExternalLink aria-hidden="true" /></Button>}</div>;
}

function Prompt({ prompt, value, onChange, onSubmit }: { prompt: AuthPromptView; value: string; onChange: (value: string) => void; onSubmit: () => Promise<void> }) {
  return <form className="auth-prompt" onSubmit={(event) => { event.preventDefault(); void onSubmit(); }}><label>{prompt.message}{prompt.type === "select" ? <select value={value} required onChange={(event) => onChange(event.target.value)}><option value="">Select…</option>{prompt.options.map((option) => <option value={option.id} key={option.id}>{option.label}{option.description === undefined ? "" : ` — ${option.description}`}</option>)}</select> : <Input autoFocus type={prompt.type === "secret" ? "password" : "text"} autoComplete={prompt.type === "secret" ? "off" : "one-time-code"} placeholder={prompt.placeholder} value={value} required onChange={(event) => onChange(event.target.value)} />}</label><Button type="submit">Continue</Button></form>;
}

async function loadModelSetup(): Promise<ModelSetup> {
  const response = await fetch("/v2/session-defaults", { cache: "no-store", headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error("Could not load available models.");
  return response.json() as Promise<ModelSetup>;
}
async function saveSessionDefaults(defaults: ModelSetup["defaults"]): Promise<void> {
  const response = await fetch("/v2/session-defaults", { method: "PUT", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(defaults) });
  if (!response.ok) throw new Error("Could not save the default model.");
}
