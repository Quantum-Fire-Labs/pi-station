import { useEffect, useMemo, useState } from "react";
import type { AuthPromptView, AuthTransaction, ProviderAuthStatus, ProviderAuthType } from "@pi-station/application-protocol";
import type { ApplicationClient } from "../application/application-client";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader } from "./ui/card";
import { SettingsLayout } from "./SettingsLayout";

const safeUrl = (value: string): string | undefined => {
  try {
    const url = new URL(value);
    const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
    return url.protocol === "https:" || (url.protocol === "http:" && loopback) ? url.href : undefined;
  } catch { return undefined; }
};
const openExternal = (url: string): void => { const safe = safeUrl(url); if (safe !== undefined) window.open(safe, "_blank", "noopener,noreferrer"); };

type AuthClient = Pick<ApplicationClient, "getAuthProviders" | "startProviderLogin" | "getAuthTransaction" | "answerAuthPrompt" | "cancelProviderLogin" | "logoutProvider">;

export function ProviderAuthPage({ client, onboarding = false, onBack, onComplete }: { client: AuthClient; onboarding?: boolean; onBack?: () => void; onComplete?: () => void }) {
  const [providers, setProviders] = useState<readonly ProviderAuthStatus[]>([]);
  const [transaction, setTransaction] = useState<AuthTransaction>();
  const [answer, setAnswer] = useState("");
  const [providerQuery, setProviderQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const refresh = (): Promise<void> => client.getAuthProviders().then(setProviders);
  useEffect(() => { void refresh().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load providers.")).finally(() => setLoading(false)); }, []);
  useEffect(() => {
    if (transaction?.status !== "running") return;
    const timer = window.setInterval(() => { void client.getAuthTransaction(transaction.id).then((next) => { setTransaction(next); if (next.status === "succeeded") void refresh(); }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Authentication update failed.")); }, 500);
    return () => window.clearInterval(timer);
  }, [client, transaction?.id, transaction?.status]);
  const configured = providers.filter((provider) => provider.configured);
  const visibleProviders = useMemo(() => [...providers]
    .filter((provider) => provider.name.toLocaleLowerCase().includes(providerQuery.trim().toLocaleLowerCase()))
    .sort((left, right) => Number(right.configured) - Number(left.configured)
      || Number(right.methods.some(({ type }) => type === "oauth")) - Number(left.methods.some(({ type }) => type === "oauth"))
      || left.name.localeCompare(right.name)), [providerQuery, providers]);
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
  const cancel = async (): Promise<void> => {
    if (transaction === undefined) return;
    try { setTransaction(await client.cancelProviderLogin(transaction.id)); } catch (reason) { setError(reason instanceof Error ? reason.message : "Authentication could not be cancelled."); }
  };
  const logout = async (providerId: string): Promise<void> => {
    if (!window.confirm("Sign out from this provider?")) return;
    try { setProviders(await client.logoutProvider(providerId)); } catch (reason) { setError(reason instanceof Error ? reason.message : "Provider sign-out failed."); }
  };

  const body = (
    <div className="provider-auth-page">
      {onboarding && <header className="provider-auth-intro"><h1>Connect a model provider</h1><p>Sign in or add an API key. Pi Station stores credentials through the embedded Pi SDK.</p></header>}
      {error !== undefined && <p className="form-error" role="alert">{error}</p>}
      {!loading && <label className="provider-auth-search">Search providers<input type="search" value={providerQuery} onChange={(event) => setProviderQuery(event.target.value)} /></label>}
      {loading ? <p role="status">Loading providers…</p> : visibleProviders.map((provider) => (
        <Card key={provider.id} className="provider-auth-card">
          <CardHeader><div><strong>{provider.name}</strong><small>{provider.configured ? `Connected${provider.source === undefined ? "" : ` · ${provider.source}`}` : "Not connected"}</small></div></CardHeader>
          <CardContent>
            <div className="provider-auth-actions">
              {provider.methods.map((method) => <Button key={method.type} type="button" variant={method.type === "oauth" ? "default" : "outline"} disabled={transaction?.status === "running"} onClick={() => void start(provider.id, method.type)}>{method.name}</Button>)}
              {provider.configured && <Button type="button" variant="outline" onClick={() => void logout(provider.id)}>Sign out</Button>}
            </div>
          </CardContent>
        </Card>
      ))}
      {transaction !== undefined && <AuthInteractionPanel transaction={transaction} answer={answer} setAnswer={setAnswer} onRespond={respond} onCancel={cancel} />}
      {onboarding && configured.length > 0 && <div className="provider-auth-continue"><Button type="button" onClick={onComplete}>Continue to Pi Station</Button></div>}
    </div>
  );
  return onboarding ? <main className="provider-auth-onboarding">{body}</main> : <SettingsLayout title="Model Providers" description="Manage the provider accounts and API keys that Pi Station can use." onBack={onBack ?? (() => undefined)}>{body}</SettingsLayout>;
}

function AuthInteractionPanel({ transaction, answer, setAnswer, onRespond, onCancel }: { transaction: AuthTransaction; answer: string; setAnswer: (value: string) => void; onRespond: () => Promise<void>; onCancel: () => Promise<void> }) {
  const prompt = transaction.prompt;
  return <Card className="provider-auth-interaction"><CardContent>
    {transaction.events.map((event, index) => <div className="auth-event" key={`${event.type}-${index}`}>
      {event.type === "auth_url" && <><p>{event.instructions ?? "Continue authentication in your browser."}</p>{safeUrl(event.url) !== undefined && <Button type="button" onClick={() => openExternal(event.url)}>Open sign-in page</Button>}</>}
      {event.type === "device_code" && <><p>Enter this code on the provider page:</p><code>{event.userCode}</code>{safeUrl(event.verificationUri) !== undefined && <Button type="button" variant="outline" onClick={() => openExternal(event.verificationUri)}>Open verification page</Button>}</>}
      {(event.type === "info" || event.type === "progress") && <><p>{event.message}</p>{event.type === "info" && event.links?.map((link) => safeUrl(link.url) === undefined ? null : <button className="auth-link" type="button" key={link.url} onClick={() => openExternal(link.url)}>{link.label ?? "Open link"}</button>)}</>}
    </div>)}
    {prompt !== undefined && <Prompt prompt={prompt} value={answer} onChange={setAnswer} onSubmit={onRespond} />}
    {transaction.status === "running" && <Button type="button" variant="outline" onClick={() => void onCancel()}>Cancel</Button>}
    {transaction.status === "succeeded" && <p role="status">Provider connected.</p>}
    {transaction.error !== undefined && <p className="form-error" role="alert">{transaction.error}</p>}
  </CardContent></Card>;
}

function Prompt({ prompt, value, onChange, onSubmit }: { prompt: AuthPromptView; value: string; onChange: (value: string) => void; onSubmit: () => Promise<void> }) {
  return <form className="auth-prompt" onSubmit={(event) => { event.preventDefault(); void onSubmit(); }}><label>{prompt.message}
    {prompt.type === "select" ? <select value={value} required onChange={(event) => onChange(event.target.value)}><option value="">Select…</option>{prompt.options.map((option) => <option value={option.id} key={option.id}>{option.label}{option.description === undefined ? "" : ` — ${option.description}`}</option>)}</select> : <input autoFocus type={prompt.type === "secret" ? "password" : "text"} autoComplete={prompt.type === "secret" ? "off" : "one-time-code"} placeholder={prompt.placeholder} value={value} required onChange={(event) => onChange(event.target.value)} />}
  </label><Button type="submit">Continue</Button></form>;
}
