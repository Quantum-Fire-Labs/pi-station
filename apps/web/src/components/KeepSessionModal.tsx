import { useEffect, useState } from "react"
import { Folder } from "lucide-react"
import type { ApplicationState } from "../application/application-client-base"
import { Modal } from "./Modal"
import { Button } from "./ui/button"
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs"

export function KeepSessionModal({ open, state, onClose, onListDirectory, onKeep }: { open: boolean; state: ApplicationState; onClose: () => void; onListDirectory: (path?: string, showHidden?: boolean) => string | undefined; onKeep: (destination: string) => void }) {
  const projects = state.projects.filter(({ available }) => available)
  const [source, setSource] = useState<"project" | "directory">(projects.length === 0 ? "directory" : "project")
  const [projectId, setProjectId] = useState(projects[0]?.projectId)
  const [requestId, setRequestId] = useState<string>()
  const request = requestId === undefined ? undefined : state.directoryLists[requestId]
  const directory = request?.result?.status === "succeeded" ? request.result.current : undefined
  const selectedProject = projects.find((project) => project.projectId === projectId)
  const destination = source === "project" ? selectedProject?.displayPath : directory?.path
  const load = (path?: string): void => { const id = onListDirectory(path); if (id !== undefined) setRequestId(id) }
  useEffect(() => { if (open && source === "directory" && requestId === undefined) load() }, [open, source, requestId])
  return <Modal open={open} title="Keep Quick Session" description="Select a Project or destination directory. Pi Station keeps the Session history and managed files." onClose={onClose} onSubmit={(event) => { event.preventDefault(); if (destination !== undefined) onKeep(destination) }} actions={<><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={destination === undefined}>Keep Session</Button></>}>
    <Tabs value={source} onValueChange={(value) => setSource(value as "project" | "directory")}><TabsList aria-label="Keep destination type"><TabsTrigger value="project" disabled={projects.length === 0}>Project</TabsTrigger><TabsTrigger value="directory">Directory</TabsTrigger></TabsList></Tabs>
    {source === "project" ? <div className="creation-list" aria-label="Destination Projects">{projects.map((project) => <button type="button" key={project.projectId} aria-pressed={project.projectId === projectId} onClick={() => setProjectId(project.projectId)}><Folder aria-hidden="true" /><span><strong>{project.name}</strong><small>{project.displayPath}</small></span></button>)}</div> : <div><div className="creation-directory-header"><div><small>Current directory</small><strong>{directory?.name ?? "Loading…"}</strong><span>{directory?.displayPath}</span></div></div><div className="creation-list" aria-label="Destination directories">{request?.result?.status === "succeeded" && request.result.parent !== undefined && <button type="button" onClick={() => load(request.result?.status === "succeeded" ? request.result.parent?.path : undefined)}>Parent directory</button>}{request?.result?.status === "succeeded" && request.result.directories.map((item) => <button type="button" key={item.path} onClick={() => load(item.path)}><Folder aria-hidden="true" /><span><strong>{item.name}</strong><small>{item.displayPath}</small></span></button>)}</div>{request?.status === "loading" && <p role="status">Loading directories…</p>}{(request?.result?.status === "rejected" || request?.result?.status === "retryable") && <p role="alert">{request.result.error.message}</p>}</div>}
  </Modal>
}
