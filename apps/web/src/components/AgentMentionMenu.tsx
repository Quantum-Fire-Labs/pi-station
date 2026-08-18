import { useEffect, useRef } from "react";

export interface AgentMentionOption {
  readonly sessionId: string;
  readonly sessionName: string;
  readonly projectName?: string;
}

interface AgentMentionMenuProps {
  readonly options: readonly AgentMentionOption[];
  readonly query: string;
  readonly activeIndex: number;
  readonly onActiveIndexChange: (index: number) => void;
  readonly onSelect: (option: AgentMentionOption) => void;
}

export function agentMentionLabel(option: AgentMentionOption): string {
  return option.projectName === undefined
    ? option.sessionName
    : `${option.projectName}: ${option.sessionName}`;
}

export function filterAgentMentions(
  options: readonly AgentMentionOption[],
  query: string,
): readonly AgentMentionOption[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean);
  if (terms.length === 0) return options;
  return options.filter((option) => {
    const label = agentMentionLabel(option).toLocaleLowerCase();
    return terms.every((term) => label.includes(term));
  });
}

export function AgentMentionMenu({
  options,
  query,
  activeIndex,
  onActiveIndexChange,
  onSelect,
}: AgentMentionMenuProps) {
  const active = useRef<HTMLButtonElement | null>(null);
  useEffect(() => { active.current?.scrollIntoView?.({ block: "nearest" }); }, [activeIndex]);

  const grouped = new Map<string | undefined, AgentMentionOption[]>();
  for (const option of options) {
    const group = option.projectName;
    grouped.set(group, [...(grouped.get(group) ?? []), option]);
  }
  let optionIndex = 0;

  return (
    <aside className="agent-mention-menu" role="listbox" aria-label="Open Sessions">
      <header>Message an agent</header>
      {options.length === 0 ? <p>No open Sessions match “{query}”</p> : [...grouped].map(([projectName, sessions]) => (
        <section key={projectName ?? "projectless"}>
          <h3>{projectName ?? "Projectless Sessions"}</h3>
          {sessions.map((option) => {
            const index = optionIndex++;
            const selected = index === activeIndex;
            return (
              <button
                key={option.sessionId}
                ref={selected ? active : undefined}
                type="button"
                role="option"
                aria-selected={selected}
                onMouseEnter={() => onActiveIndexChange(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onSelect(option)}
              >
                <span>{option.sessionName}</span>
              </button>
            );
          })}
        </section>
      ))}
    </aside>
  );
}
