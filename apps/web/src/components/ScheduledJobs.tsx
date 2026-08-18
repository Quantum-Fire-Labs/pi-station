import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ArrowLeft, ChevronRight, Plus } from "lucide-react";
import type { SessionSummary } from "../application/workspace-model";
import type {
  ScheduledJob,
  ScheduledJobMutation,
  ScheduledJobSchedule,
  ScheduledRun,
} from "@pi-station/application-protocol";
import type { ApplicationClient } from "../application/application-client";

type ScheduleKind = "one-time" | "interval" | "daily" | "weekly" | "monthly";
type View =
  | { kind: "list" }
  | { kind: "show"; jobId: string }
  | { kind: "new" }
  | { kind: "edit"; jobId: string };

interface FormState {
  title: string;
  prompt: string;
  target: string;
  scheduleKind: ScheduleKind;
  localDateTime: string;
  localStart: string;
  interval: string;
  intervalUnit: "minute" | "hour" | "day" | "week" | "month" | "year";
  localTime: string;
  weekdays: number[];
  monthDay: string;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const EMPTY_FORM: FormState = {
  title: "",
  prompt: "",
  target: "new-session",
  scheduleKind: "one-time",
  localDateTime: "",
  localStart: "",
  interval: "1",
  intervalUnit: "hour",
  localTime: "09:00",
  weekdays: [1],
  monthDay: "1",
};

export function ScheduledJobs({
  client,
  projectId,
  sessions,
}: {
  client?: ApplicationClient | undefined;
  projectId: string;
  sessions: readonly SessionSummary[];
}) {
  const [jobs, setJobs] = useState<readonly ScheduledJob[]>([]);
  const [view, setView] = useState<View>({ kind: "list" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string>();

  const load = useCallback(async (): Promise<void> => {
    if (client === undefined) return;
    try {
      setJobs(await client.listScheduledJobs(projectId));
    } catch (reason) {
      setError(message(reason, "Could not load Scheduled Jobs"));
    }
  }, [client, projectId]);

  useEffect(() => { setView({ kind: "list" }); void load(); }, [load]);

  const save = async (form: FormState, jobId?: string): Promise<void> => {
    if (client === undefined) return;
    setSaving(true);
    setError("");
    try {
      const saved = jobId === undefined
        ? await client.createScheduledJob(projectId, formMutation(form))
        : await client.updateScheduledJob(jobId, formMutation(form));
      await load();
      setView({ kind: "show", jobId: saved.id });
    } catch (reason) {
      setError(message(reason, "Could not save Scheduled Job"));
    } finally {
      setSaving(false);
    }
  };

  const action = async (job: ScheduledJob, value: "pause" | "resume" | "run-now" | "delete"): Promise<void> => {
    if (client === undefined) return;
    setError("");
    try {
      await client.scheduledJobAction(job.id, value);
      await load();
      if (value === "delete") { setDeleteId(undefined); setView({ kind: "list" }); }
    } catch (reason) {
      setError(message(reason, `Could not ${value} Scheduled Job`));
    }
  };

  const selected = view.kind === "show" || view.kind === "edit"
    ? jobs.find((job) => job.id === view.jobId)
    : undefined;

  if (view.kind === "new") {
    return <ScheduledJobForm
      title="New Scheduled Job"
      form={EMPTY_FORM}
      sessions={sessions}
      saving={saving}
      error={error}
      onBack={() => setView({ kind: "list" })}
      onSave={(form) => void save(form)}
    />;
  }

  if (view.kind === "edit" && selected !== undefined) {
    return <ScheduledJobForm
      title="Edit Scheduled Job"
      form={formFromJob(selected)}
      sessions={sessions}
      saving={saving}
      error={error}
      onBack={() => setView({ kind: "show", jobId: selected.id })}
      onSave={(form) => void save(form, selected.id)}
    />;
  }

  if (view.kind === "show" && selected !== undefined) {
    return (
      <section className="project-page-section scheduled-job-page" aria-labelledby="scheduled-job-title">
        <PageHeading title={selected.title} backLabel="Back to Scheduled Jobs" onBack={() => setView({ kind: "list" })}>
          <button type="button" onClick={() => setView({ kind: "edit", jobId: selected.id })}>Edit</button>
        </PageHeading>
        <dl className="scheduled-job-details">
          <div className="wide"><dt>Prompt</dt><dd>{selected.prompt}</dd></div>
          <div><dt>State</dt><dd>{titleCase(selected.state)}</dd></div>
          <div><dt>Target</dt><dd>{targetDescription(selected, sessions)}</dd></div>
          <div className="wide"><dt>Schedule</dt><dd>{scheduleDescription(selected.schedule)}</dd></div>
          <div className="wide"><dt>Next run</dt><dd>{formatDate(selected.nextRunAt, selected.schedule.timezone)}</dd></div>
        </dl>
        <div className="scheduled-job-actions">
          <button type="button" disabled={selected.state === "disabled"} onClick={() => void action(selected, selected.state === "active" ? "pause" : "resume")}>{selected.state === "active" ? "Pause" : "Resume"}</button>
          <button type="button" onClick={() => void action(selected, "run-now")}>Run now</button>
          {deleteId === selected.id ? <>
            <button className="danger" type="button" onClick={() => void action(selected, "delete")}>Confirm delete</button>
            <button type="button" onClick={() => setDeleteId(undefined)}>Cancel</button>
          </> : <button className="danger" type="button" onClick={() => setDeleteId(selected.id)}>Delete</button>}
        </div>
        {error !== "" && <p role="alert" className="new-session-error">{error}</p>}
        <section className="scheduled-job-history" aria-labelledby="scheduled-job-history-heading">
          <h3 id="scheduled-job-history-heading">Recent runs</h3>
          <RunHistory runs={selected.history} timezone={selected.schedule.timezone} />
        </section>
      </section>
    );
  }

  return (
    <section className="project-page-section scheduled-jobs-index" aria-labelledby="scheduled-jobs-heading">
      <PageHeading title="Scheduled Jobs">
        <button className="primary" type="button" onClick={() => { setError(""); setView({ kind: "new" }); }}><Plus aria-hidden="true" size={15} /> New Scheduled Job</button>
      </PageHeading>
      <p>Start a Prompt in a new or open Session at the saved local schedule.</p>
      {error !== "" && <p role="alert" className="new-session-error">{error}</p>}
      {jobs.length === 0 ? <p className="scheduled-jobs-empty">No Scheduled Jobs.</p> : (
        <div className="scheduled-jobs-list">
          {jobs.map((job) => (
            <button className="scheduled-job-list-row" type="button" key={job.id} onClick={() => { setError(""); setView({ kind: "show", jobId: job.id }); }}>
              <span><strong>{job.title}</strong><small>{titleCase(job.state)} · {scheduleDescription(job.schedule)}</small></span>
              <ChevronRight aria-hidden="true" size={17} />
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function PageHeading({ title, backLabel, onBack, children }: { title: string; backLabel?: string; onBack?: () => void; children?: ReactNode }) {
  return <header className="scheduled-job-page-heading">
    <div>
      {onBack !== undefined && <button type="button" aria-label={backLabel} onClick={onBack}><ArrowLeft aria-hidden="true" size={17} /></button>}
      <h2 id={onBack === undefined ? "scheduled-jobs-heading" : "scheduled-job-title"}>{title}</h2>
    </div>
    {children !== undefined && <div>{children}</div>}
  </header>;
}

function ScheduledJobForm({ title, form: initialForm, sessions, saving, error, onBack, onSave }: {
  title: string;
  form: FormState;
  sessions: readonly SessionSummary[];
  saving: boolean;
  error: string;
  onBack: () => void;
  onSave: (form: FormState) => void;
}) {
  const [form, setForm] = useState(initialForm);
  return <section className="project-page-section scheduled-job-page" aria-labelledby="scheduled-job-title">
    <PageHeading title={title} backLabel="Back" onBack={onBack} />
    <form className="development-server-settings scheduled-job-form" onSubmit={(event) => { event.preventDefault(); onSave(form); }}>
      <label><span>Title</span><input required maxLength={200} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label>
      <label><span>Prompt</span><textarea required maxLength={100_000} value={form.prompt} onChange={(event) => setForm({ ...form, prompt: event.target.value })} /></label>
      <label><span>Target</span><select value={form.target} onChange={(event) => setForm({ ...form, target: event.target.value })}>
        <option value="new-session">New Session</option>
        {sessions.map((session) => <option key={session.sessionKey.piSessionId} value={session.sessionKey.piSessionId}>{session.name ?? session.sessionKey.piSessionId}</option>)}
      </select></label>
      <label><span>Schedule</span><select value={form.scheduleKind} onChange={(event) => setForm({ ...form, scheduleKind: event.target.value as ScheduleKind })}>
        <option value="one-time">One time</option><option value="interval">Interval</option><option value="daily">Daily</option><option value="weekly">Selected weekdays</option><option value="monthly">Monthly</option>
      </select></label>
      {form.scheduleKind === "one-time" && <label><span>Local date and time</span><input type="datetime-local" required value={form.localDateTime} onChange={(event) => setForm({ ...form, localDateTime: event.target.value })} /></label>}
      {form.scheduleKind === "interval" && <>
        <label><span>Common interval</span><select aria-label="Common interval" value={presetValue(form)} onChange={(event) => { const [interval, intervalUnit] = event.target.value.split(":") as [string, FormState["intervalUnit"]]; if (interval !== "custom") setForm({ ...form, interval, intervalUnit }); }}>
          <option value="1:hour">Hourly</option><option value="1:day">Daily</option><option value="2:week">Every two weeks</option><option value="1:month">Monthly</option><option value="3:month">Quarterly</option><option value="6:month">Every six months</option><option value="1:year">Yearly</option><option value="custom:minute">Custom</option>
        </select></label>
        <label><span>Interval</span><input type="number" required min={1} max={1_000_000} step={1} value={form.interval} onChange={(event) => setForm({ ...form, interval: event.target.value })} /></label>
        <label><span>Interval unit</span><select value={form.intervalUnit} onChange={(event) => setForm({ ...form, intervalUnit: event.target.value as FormState["intervalUnit"] })}><option value="minute">Minutes</option><option value="hour">Hours</option><option value="day">Days</option><option value="week">Weeks</option><option value="month">Months</option><option value="year">Years</option></select></label>
        <label><span>Local start <small>Optional</small></span><input type="datetime-local" value={form.localStart} onChange={(event) => setForm({ ...form, localStart: event.target.value })} /></label>
      </>}
      {(["daily", "weekly", "monthly"] as ScheduleKind[]).includes(form.scheduleKind) && <label><span>Local time</span><input type="time" required value={form.localTime} onChange={(event) => setForm({ ...form, localTime: event.target.value })} /></label>}
      {form.scheduleKind === "weekly" && <fieldset><legend>Weekdays</legend>{WEEKDAYS.map((day, index) => <label key={day}><input type="checkbox" checked={form.weekdays.includes(index)} onChange={() => setForm({ ...form, weekdays: form.weekdays.includes(index) ? form.weekdays.filter((value) => value !== index) : [...form.weekdays, index].sort() })} /><span>{day}</span></label>)}</fieldset>}
      {form.scheduleKind === "monthly" && <label><span>Day of month</span><input type="number" required min={1} max={31} value={form.monthDay} onChange={(event) => setForm({ ...form, monthDay: event.target.value })} /></label>}
      <div><button type="button" onClick={onBack} disabled={saving}>Cancel</button><button type="submit" disabled={saving || (form.scheduleKind === "weekly" && form.weekdays.length === 0)}>{saving ? "Saving…" : title.startsWith("Edit") ? "Save Scheduled Job" : "Create Scheduled Job"}</button></div>
      {error !== "" && <p role="alert" className="new-session-error">{error}</p>}
    </form>
  </section>;
}

function RunHistory({ runs, timezone }: { runs: readonly ScheduledRun[]; timezone: string }) {
  if (runs.length === 0) return <p>No runs yet.</p>;
  return <ul>{[...runs].reverse().slice(0, 10).map((run) => <li key={run.id}><strong>{titleCase(run.status)}</strong><span>{run.origin === "run-now" ? "Manual run" : "Scheduled run"} · {formatDate(run.attemptedAt, timezone)}</span>{run.sessionId !== undefined && <small>Session {run.sessionId}</small>}{run.message !== undefined && <small>{run.message}</small>}</li>)}</ul>;
}

function formMutation(form: FormState): ScheduledJobMutation {
  const target = form.target === "new-session" ? { type: "new-session" as const } : { type: "existing-session" as const, sessionId: form.target };
  if (form.scheduleKind === "one-time") return { title: form.title, prompt: form.prompt, target, schedule: { type: "one-time", localDateTime: form.localDateTime } };
  if (form.scheduleKind === "interval") return { title: form.title, prompt: form.prompt, target, schedule: { type: "recurring", frequency: "interval", interval: Number(form.interval), intervalUnit: form.intervalUnit, ...(form.localStart === "" ? {} : { localStart: form.localStart }) } };
  if (form.scheduleKind === "weekly") return { title: form.title, prompt: form.prompt, target, schedule: { type: "recurring", frequency: "weekly", weekdays: form.weekdays, localTime: form.localTime } };
  if (form.scheduleKind === "monthly") return { title: form.title, prompt: form.prompt, target, schedule: { type: "recurring", frequency: "monthly", day: Number(form.monthDay), localTime: form.localTime } };
  return { title: form.title, prompt: form.prompt, target, schedule: { type: "recurring", frequency: "daily", localTime: form.localTime } };
}

function formFromJob(job: ScheduledJob): FormState {
  const target = job.target.type === "new-session" ? "new-session" : job.target.sessionId;
  const base = { ...EMPTY_FORM, title: job.title, prompt: job.prompt, target };
  if (job.schedule.type === "one-time") return { ...base, scheduleKind: "one-time", localDateTime: localInput(job.schedule.runAtUtc, job.schedule.timezone) };
  if (job.schedule.frequency === "interval") return { ...base, scheduleKind: "interval", interval: String("intervalMinutes" in job.schedule ? job.schedule.intervalMinutes : job.schedule.interval), intervalUnit: "intervalMinutes" in job.schedule ? "minute" : job.schedule.intervalUnit, localStart: job.schedule.localStart ?? "" };
  if (job.schedule.frequency === "weekly") return { ...base, scheduleKind: "weekly", weekdays: [...job.schedule.weekdays], localTime: job.schedule.localTime.slice(0, 5) };
  if (job.schedule.frequency === "monthly") return { ...base, scheduleKind: "monthly", monthDay: String(job.schedule.day), localTime: job.schedule.localTime.slice(0, 5) };
  return { ...base, scheduleKind: "daily", localTime: job.schedule.localTime.slice(0, 5) };
}

function scheduleDescription(schedule: ScheduledJobSchedule): string {
  if (schedule.type === "one-time") return `Once at ${formatDate(schedule.runAtUtc, schedule.timezone)} (${schedule.timezone})`;
  if (schedule.frequency === "interval") return `Every ${"intervalMinutes" in schedule ? schedule.intervalMinutes : schedule.interval} ${pluralUnit("intervalMinutes" in schedule ? "minute" : schedule.intervalUnit, "intervalMinutes" in schedule ? schedule.intervalMinutes : schedule.interval)} (${schedule.timezone})`;
  if (schedule.frequency === "daily") return `Daily at ${schedule.localTime} (${schedule.timezone})`;
  if (schedule.frequency === "weekly") return `${schedule.weekdays.map((day) => WEEKDAYS[day]).join(", ")} at ${schedule.localTime} (${schedule.timezone})`;
  return `Monthly on day ${schedule.day} at ${schedule.localTime} (${schedule.timezone})`;
}

function targetDescription(job: ScheduledJob, sessions: readonly SessionSummary[]): string {
  if (job.target.type === "new-session") return "New Session";
  const sessionId = job.target.sessionId;
  return sessions.find((session) => session.sessionKey.piSessionId === sessionId)?.name ?? `Session ${sessionId}`;
}

function formatDate(value: string | undefined, timezone: string): string {
  if (value === undefined) return "Not scheduled";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short", timeZone: timezone }).format(new Date(value));
}

function localInput(value: string, timezone: string): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(value)).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

function titleCase(value: string): string { return value.charAt(0).toUpperCase() + value.slice(1).replaceAll("-", " "); }
function message(reason: unknown, fallback: string): string { return reason instanceof Error ? reason.message : fallback; }

function presetValue(form: FormState): string { const value = `${form.interval}:${form.intervalUnit}`; return ["1:hour","1:day","2:week","1:month","3:month","6:month","1:year"].includes(value) ? value : "custom:minute"; }
function pluralUnit(unit: string, interval: number): string { return interval === 1 ? unit : `${unit}s`; }
