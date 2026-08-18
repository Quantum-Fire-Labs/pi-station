import { useEffect, useState } from "react";
import { KeyRound, Mic, Volume2 } from "lucide-react";
import { SettingsLayout } from "./SettingsLayout";

const TRANSCRIPTION_MODELS = ["gpt-4o-mini-transcribe", "gpt-4o-transcribe", "whisper-1"] as const;
const SPEECH_MODELS = ["gpt-4o-mini-tts", "tts-1", "tts-1-hd"] as const;
const SPEECH_VOICES = ["alloy", "ash", "ballad", "coral", "echo", "fable", "marin", "nova", "onyx", "sage", "shimmer", "verse", "cedar"] as const;

type VoiceSettings = {
  transcriptionProvider: "openai";
  transcriptionModel: string;
  speechProvider: "openai" | "browser";
  speechModel: string;
  speechVoice: string;
  speechSpeed: number;
  maxRecordingSeconds: number;
  voiceAutoplay: boolean;
  openAiKeyConfigured: boolean;
};

async function request(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...init?.headers,
    },
  });
}

export function VoiceSettingsPage({ onBack }: { onBack: () => void }) {
  const [settings, setSettings] = useState<VoiceSettings>();
  const [apiKey, setApiKey] = useState("");
  const [message, setMessage] = useState("");
  const [keyMessage, setKeyMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    void (async () => {
      const response = await request("/v2/voice/settings");
      if (response.ok) {
        const body = await response.json() as { settings: VoiceSettings };
        setSettings(body.settings);
      } else {
        setMessage("Pi Station could not load Voice Messages settings.");
      }
    })();
  }, []);

  const updateKey = async (method: "PUT" | "DELETE"): Promise<void> => {
    setBusy(true);
    setKeyMessage("");
    try {
      const response = await request("/v2/voice/settings/openai-key", {
        method,
        ...(method === "PUT" ? { body: JSON.stringify({ apiKey }) } : {}),
      });
      if (!response.ok) throw new Error("Request failed");
      const body = await response.json() as { settings: VoiceSettings };
      setSettings(body.settings);
      setApiKey("");
      setKeyMessage(method === "PUT" ? "OpenAI API key is saved." : "OpenAI API key is removed.");
    } catch {
      setKeyMessage("Pi Station could not update the OpenAI API key.");
    } finally {
      setBusy(false);
    }
  };

  const testConnection = async (): Promise<void> => {
    setTesting(true);
    setKeyMessage("Testing the OpenAI connection…");
    try {
      const response = await request("/v2/voice/settings/openai-key/test", { method: "POST" });
      setKeyMessage(response.ok
        ? "OpenAI connection succeeded."
        : "OpenAI rejected the saved API key.");
    } catch {
      setKeyMessage("Pi Station could not reach OpenAI.");
    } finally {
      setTesting(false);
    }
  };

  const saveSettings = async (): Promise<void> => {
    if (settings === undefined) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await request("/v2/voice/settings", {
        method: "PUT",
        body: JSON.stringify(settings),
      });
      if (!response.ok) throw new Error("Request failed");
      const body = await response.json() as { settings: VoiceSettings };
      setSettings(body.settings);
      setMessage("Voice Messages settings are saved.");
    } catch {
      setMessage("Pi Station could not update Voice Messages settings.");
    } finally {
      setBusy(false);
    }
  };

  return <SettingsLayout title="Voice Messages" description="Configure transcription and voice responses." onBack={onBack}>
    <div className="voice-settings-content">
      <section className="settings-panel" aria-labelledby="openai-heading">
        <h2 id="openai-heading"><KeyRound aria-hidden="true" size={17} /> OpenAI</h2>
        <p>The key stays encrypted on this Pi Station host. Pi Station never sends it to the browser.</p>
        <label>API key<input type="password" autoComplete="off" value={apiKey} placeholder={settings?.openAiKeyConfigured ? "Configured" : "sk-…"} onChange={(event) => setApiKey(event.target.value)} /></label>
        <div className="voice-settings-actions">
          <button className="primary" disabled={busy || testing || apiKey.trim() === ""} type="button" onClick={() => void updateKey("PUT")}>{settings?.openAiKeyConfigured ? "Replace key" : "Save key"}</button>
          <button disabled={busy || testing || !settings?.openAiKeyConfigured} type="button" onClick={() => void testConnection()}>{testing ? "Testing…" : "Test connection"}</button>
          <button disabled={busy || testing || !settings?.openAiKeyConfigured} type="button" onClick={() => void updateKey("DELETE")}>Remove key</button>
        </div>
        {keyMessage !== "" && <p className="voice-settings-key-message" role="status" aria-live="polite">{keyMessage}</p>}
      </section>
      {settings !== undefined && <>
        <section className="settings-panel" aria-labelledby="transcription-heading"><h2 id="transcription-heading"><Mic aria-hidden="true" size={17} /> Transcription</h2>
          <label>Provider<select disabled><option>OpenAI</option></select></label><label>Model<select value={settings.transcriptionModel} onChange={(event) => setSettings({ ...settings, transcriptionModel: event.target.value })}>{TRANSCRIPTION_MODELS.map((model) => <option key={model} value={model}>{model}</option>)}</select></label>
          <label>Maximum recording length<select value={settings.maxRecordingSeconds} onChange={(event) => setSettings({ ...settings, maxRecordingSeconds: Number(event.target.value) })}>{[15, 30, 60, 90, 120].map((seconds) => <option key={seconds} value={seconds}>{seconds} seconds</option>)}</select></label>
        </section>
        <section className="settings-panel" aria-labelledby="speech-heading"><h2 id="speech-heading"><Volume2 aria-hidden="true" size={17} /> Voice responses</h2><p>{settings.openAiKeyConfigured ? "OpenAI provides voice responses." : "This device uses its browser voice until you add an OpenAI API key."}</p>
          <label>Provider<select disabled><option>{settings.openAiKeyConfigured ? "OpenAI" : "Browser voice"}</option></select></label><label>Model<select disabled={!settings.openAiKeyConfigured} value={settings.speechModel} onChange={(event) => setSettings({ ...settings, speechModel: event.target.value })}>{SPEECH_MODELS.map((model) => <option key={model} value={model}>{model}</option>)}</select></label>
          <label>Voice<select disabled={!settings.openAiKeyConfigured} value={settings.speechVoice} onChange={(event) => setSettings({ ...settings, speechVoice: event.target.value })}>{SPEECH_VOICES.map((voice) => <option key={voice} value={voice}>{voice}</option>)}</select></label><label>Playback speed<input type="number" min="0.25" max="4" step="0.05" value={settings.speechSpeed} onChange={(event) => setSettings({ ...settings, speechSpeed: Number(event.target.value) })} /></label>
        </section>
        <button className="primary voice-settings-save" disabled={busy || testing} type="button" onClick={() => void saveSettings()}>Save settings</button>
      </>}
      {message !== "" && <p className="theme-message" role="status">{message}</p>}
    </div>
  </SettingsLayout>;
}
