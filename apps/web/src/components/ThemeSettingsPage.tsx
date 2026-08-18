import { useEffect, useRef, useState } from "react";
import { Check, Monitor, Moon, Palette, Sun, Upload, X } from "lucide-react";
import { Button } from "./ui/button";
import { SettingsLayout } from "./SettingsLayout";
import {
  applySelectedTheme,
  packagedThemes,
  readAppearance,
  readSystemTheme,
  readThemeSource,
  saveAppearance,
  saveThemeSource,
  saveSelectedTheme,
  selectedThemeId,
  type AppearancePreference,
  type SystemTheme,
  type ThemeAppearance,
  type ThemeDefinition,
  type ThemeSource,
} from "../themes";

export function ThemeSettingsPage({ onBack }: { onBack: () => void }) {
  const [appearance, setAppearance] = useState<AppearancePreference>(readAppearance);
  const [source, setSource] = useState<ThemeSource>(readThemeSource);
  const [systemTheme, setSystemTheme] = useState<SystemTheme>(readSystemTheme);
  const [themes, setThemes] = useState<readonly ThemeDefinition[]>(packagedThemes);
  const [selection, setSelection] = useState(() => ({ light: selectedThemeId("light"), dark: selectedThemeId("dark") }));
  const [message, setMessage] = useState("");
  const input = useRef<HTMLInputElement>(null);

  const loadThemes = async (): Promise<void> => {
    try {
      const response = await fetch("/api/themes", { headers: { Accept: "application/json" } });
      if (!response.ok) return;
      const body = await response.json() as { themes?: ThemeDefinition[] };
      const catalog = [...packagedThemes, ...(body.themes ?? [])];
      setThemes(catalog);
      setSelection((current) => {
        const next = { ...current };
        for (const mode of ["light", "dark"] as const) {
          if (!catalog.some((theme) => theme.id === current[mode] && theme.appearance === mode)) {
            const fallback = packagedThemes.find((theme) => theme.appearance === mode);
            if (fallback !== undefined) { next[mode] = fallback.id; saveSelectedTheme(fallback); }
          }
        }
        return next;
      });
    } catch { /* Packaged themes remain available offline. */ }
  };
  useEffect(() => {
    void loadThemes();
    const updateSystemTheme = (event: Event): void => setSystemTheme((event as CustomEvent<SystemTheme>).detail);
    window.addEventListener("pi-station:system-theme", updateSystemTheme);
    return () => window.removeEventListener("pi-station:system-theme", updateSystemTheme);
  }, []);

  const chooseSource = (value: ThemeSource): void => { setSource(value); saveThemeSource(value); };
  const chooseAppearance = (value: AppearancePreference): void => { setAppearance(value); saveAppearance(value); };
  const chooseTheme = (theme: ThemeDefinition): void => {
    setSelection((current) => ({ ...current, [theme.appearance]: theme.id }));
    saveSelectedTheme(theme);
  };
  const install = async (file: File): Promise<void> => {
    setMessage("");
    try {
      const definition = JSON.parse(await file.text()) as unknown;
      const response = await fetch("/api/themes", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(definition) });
      if (!response.ok) throw new Error("Pi Station could not install this theme.");
      const body = await response.json() as { theme: ThemeDefinition };
      await loadThemes();
      chooseTheme(body.theme);
      setMessage(`${body.theme.name} is installed.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Pi Station could not install this theme."); }
    finally { if (input.current !== null) input.current.value = ""; }
  };
  const remove = async (theme: ThemeDefinition): Promise<void> => {
    const response = await fetch(`/api/themes/${encodeURIComponent(theme.id)}`, { method: "DELETE" });
    if (!response.ok) { setMessage("Pi Station could not remove this theme."); return; }
    const fallback = packagedThemes.find((item) => item.appearance === theme.appearance);
    if (selection[theme.appearance] === theme.id && fallback !== undefined) chooseTheme(fallback);
    await loadThemes();
    applySelectedTheme();
  };

  const palettePreview = (theme: ThemeDefinition): string => {
    const colors = [theme.colors.background, theme.colors.foreground, theme.colors.accent, theme.colors.warning, theme.colors.error];
    const rectangles = colors.map((color, index) => `<rect x="${index * 20}" width="20" height="20" fill="${color}"/>`).join("");
    return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 20">${rectangles}</svg>`)}`;
  };

  const sourceChoices = [
    { value: "pi-station" as const, title: "Pi Station", description: "Use a selected Pi Station theme.", icon: Palette, disabled: false },
    { value: "system" as const, title: "System theme", description: systemTheme.available ? `Follow the ${systemTheme.name} Omarchy theme.` : "Omarchy is not available on this host.", icon: Monitor, disabled: !systemTheme.available },
  ];
  const appearanceChoices = [
    { value: "system" as const, title: "System", description: "Match this browser's light or dark appearance.", icon: Monitor },
    { value: "light" as const, title: "Light", description: "Always use a light theme.", icon: Sun },
    { value: "dark" as const, title: "Dark", description: "Always use a dark theme.", icon: Moon },
  ];

  return <SettingsLayout title="Themes" description="Choose how Pi Station looks on this device." onBack={onBack} actions={<><Button type="button" onClick={() => input.current?.click()}><Upload aria-hidden="true" data-icon="inline-start" /> Import</Button><input ref={input} className="sr-only" type="file" accept="application/json,.json,.pi-station-theme" onChange={(event) => { const file = event.target.files?.[0]; if (file !== undefined) void install(file); }} /></>}>
      <section className="projects-index-group" aria-labelledby="theme-source-heading"><h2 id="theme-source-heading">Theme source</h2><div className="projects-index-list" role="radiogroup" aria-label="Theme source">
        {sourceChoices.map((choice) => { const Icon = choice.icon; return <div className="projects-index-row settings-index-row" key={choice.value}><button className="projects-index-open" type="button" role="radio" disabled={choice.disabled} aria-checked={source === choice.value} onClick={() => chooseSource(choice.value)}><span className="settings-index-label"><span className="settings-index-icon"><Icon aria-hidden="true" size={18} /></span><span><strong>{choice.title}</strong><small>{choice.description}</small></span></span>{source === choice.value && <Check aria-hidden="true" size={17} />}</button></div>; })}
      </div></section>
      {(source === "pi-station" || !systemTheme.available) && <section className="projects-index-group" aria-labelledby="appearance-heading"><h2 id="appearance-heading">Appearance</h2><div className="projects-index-list" role="radiogroup" aria-label="Appearance">
        {appearanceChoices.map((choice) => { const Icon = choice.icon; return <div className="projects-index-row settings-index-row" key={choice.value}><button className="projects-index-open" type="button" role="radio" aria-checked={appearance === choice.value} onClick={() => chooseAppearance(choice.value)}><span className="settings-index-label"><span className="settings-index-icon"><Icon aria-hidden="true" size={18} /></span><span><strong>{choice.title}</strong><small>{choice.description}</small></span></span>{appearance === choice.value && <Check aria-hidden="true" size={17} />}</button></div>; })}
      </div></section>}
      {(source === "pi-station" || !systemTheme.available) && (["light", "dark"] as const).map((mode: ThemeAppearance) => <section className="projects-index-group" aria-labelledby={`${mode}-themes-heading`} key={mode}><h2 id={`${mode}-themes-heading`}>{mode === "light" ? "Light themes" : "Dark themes"}</h2><div className="theme-grid" role="radiogroup" aria-label={`${mode === "light" ? "Light" : "Dark"} theme`}>
        {themes.filter((theme) => theme.appearance === mode).map((theme) => <div className="theme-card" key={theme.id}><button type="button" role="radio" aria-checked={selection[mode] === theme.id} onClick={() => chooseTheme(theme)}><img className="theme-palette" src={palettePreview(theme)} alt="" /><span><strong>{theme.name}</strong><small>{theme.author}{theme.packaged ? " · Included" : " · Installed"}</small></span>{selection[mode] === theme.id && <Check aria-hidden="true" size={16} />}</button>{!theme.packaged && <button className="theme-remove" type="button" aria-label={`Remove ${theme.name}`} onClick={() => void remove(theme)}><X aria-hidden="true" size={14} /></button>}</div>)}
      </div></section>)}
      {message !== "" && <p className="theme-message" role="status">{message}</p>}
  </SettingsLayout>;
}
