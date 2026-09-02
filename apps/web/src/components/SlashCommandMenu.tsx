import { useEffect, useRef } from "react";

export interface SlashCommandOption {
  readonly name: string;
  readonly description?: string;
  readonly source: "extension" | "prompt-template" | "skill";
  readonly invocation: "prompt" | "direct";
}

interface SlashCommandMenuProps {
  readonly options: readonly SlashCommandOption[];
  readonly query: string;
  readonly activeIndex: number;
  readonly onActiveIndexChange: (index: number) => void;
  readonly onSelect: (option: SlashCommandOption) => void;
}

const sourceLabel: Record<SlashCommandOption["source"], string> = {
  extension: "Extensions",
  "prompt-template": "Prompts",
  skill: "Skills",
};

const sourceOrder: readonly SlashCommandOption["source"][] = ["extension", "prompt-template", "skill"];

export function filterSlashCommands(
  options: readonly SlashCommandOption[],
  query: string,
): readonly SlashCommandOption[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (normalized.length === 0) return options;
  return options.filter((option) => `${option.name} ${option.description ?? ""}`.toLocaleLowerCase().includes(normalized));
}

export function SlashCommandMenu({
  options,
  query,
  activeIndex,
  onActiveIndexChange,
  onSelect,
}: SlashCommandMenuProps) {
  const active = useRef<HTMLButtonElement | null>(null);
  useEffect(() => { active.current?.scrollIntoView?.({ block: "nearest" }); }, [activeIndex]);

  let optionIndex = 0;
  return (
    <aside className="slash-command-menu" role="listbox" aria-label="Slash commands">
      <header>Commands</header>
      {options.length === 0 ? <p>No commands match “{query}”</p> : sourceOrder.map((source) => {
        const commands = options.filter((option) => option.source === source);
        if (commands.length === 0) return null;
        return (
          <section key={source}>
            <h3>{sourceLabel[source]}</h3>
            {commands.map((option) => {
              const index = optionIndex++;
              const selected = index === activeIndex;
              return (
                <button
                  key={`${option.source}:${option.name}`}
                  ref={selected ? active : undefined}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onMouseEnter={() => onActiveIndexChange(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => onSelect(option)}
                >
                  <span><strong>/{option.name}</strong>{option.description !== undefined && <small>{option.description}</small>}</span>
                </button>
              );
            })}
          </section>
        );
      })}
    </aside>
  );
}
