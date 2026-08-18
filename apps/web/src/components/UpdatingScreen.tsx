export function UpdatingScreen() {
  return (
    <main className="updating-screen">
      <div className="updating-content" role="status" aria-live="polite">
        <span className="updating-mark" aria-hidden="true" />
        <p className="updating-eyebrow">Maintenance in progress</p>
        <h1>Updating Pi Station</h1>
        <p>Active Sessions remain safe while the service restarts.</p>
        <p>Pi Station will retry automatically and return to your Workspace when it is ready.</p>
      </div>
    </main>
  );
}
