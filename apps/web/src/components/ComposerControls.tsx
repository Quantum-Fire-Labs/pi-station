import { Bot, Brain, SlidersHorizontal } from "lucide-react";
import type { ThinkingLevel } from "../application/workspace-model";
import type { ApplicationState } from "../application/application-client-base";
import { Button } from "./ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "./ui/dropdown-menu";

interface ComposerControlsProps {
  details: ApplicationState["selected"]["details"];
  delivery: "prompt.steer" | "prompt.follow-up";
  working: boolean;
  disabled: boolean;
  canChangeModel: boolean;
  canChangeThinking: boolean;
  onSetModel: (provider: string, modelId: string) => void;
  onSetThinking: (level: ThinkingLevel) => void;
  onSetDelivery: (delivery: "prompt.steer" | "prompt.follow-up") => void;
}

const encodeModel = (provider: string, modelId: string): string => `${encodeURIComponent(provider)}:${encodeURIComponent(modelId)}`;
const titleCase = (value: string): string => value === "xhigh" ? "Extra high" : `${value[0]?.toUpperCase() ?? ""}${value.slice(1)}`;

export function ComposerControls(props: ComposerControlsProps) {
  const model = props.details?.model;
  const modelValue = model === undefined ? "" : encodeModel(model.provider, model.modelId);
  const modelLabel = model?.displayName ?? model?.modelId ?? "Model unavailable";
  const thinking = props.details?.thinkingLevel;
  const settingDisabled = props.disabled;
  const setModel = (value: string | null) => {
    if (value === null) return;
    const [provider, modelId] = value.split(":").map(decodeURIComponent);
    if (provider !== undefined && modelId !== undefined && value !== modelValue) props.onSetModel(provider, modelId);
  };
  const setThinking = (value: string | null) => {
    if (value === null) return;
    const level = props.details?.supportedThinkingLevels?.find((item) => item === value);
    if (level !== undefined && level !== thinking) props.onSetThinking(level);
  };

  return <>
    <div className="composer-settings-desktop" aria-label="Session settings">
      <Select value={modelValue} onValueChange={setModel} disabled={settingDisabled || !props.canChangeModel}>
        <SelectTrigger size="sm" aria-label={`Model: ${modelLabel}`} title={`Model: ${modelLabel}`}><Bot aria-hidden="true" /><SelectValue>{modelLabel}</SelectValue></SelectTrigger>
        <SelectContent>{props.details?.modelInventory?.map((item) => <SelectItem key={`${item.provider}:${item.modelId}`} value={encodeModel(item.provider, item.modelId)}>{item.displayName ?? item.modelId} · {item.provider}</SelectItem>)}</SelectContent>
      </Select>
      <Select value={thinking ?? ""} onValueChange={setThinking} disabled={settingDisabled || !props.canChangeThinking || !props.details?.supportedThinkingLevels?.length}>
        <SelectTrigger size="sm" aria-label={`Thinking level: ${thinking ?? "unavailable"}`} title={`Thinking level: ${thinking ?? "unavailable"}`}><Brain aria-hidden="true" /><SelectValue>{thinking === undefined ? "Unavailable" : titleCase(thinking)}</SelectValue></SelectTrigger>
        <SelectContent>{props.details?.supportedThinkingLevels?.map((level) => <SelectItem key={level} value={level}>{titleCase(level)}</SelectItem>)}</SelectContent>
      </Select>
      {props.working ? <Select value={props.delivery} onValueChange={(value) => { if (value !== null) props.onSetDelivery(value); }} disabled={props.disabled}>
        <SelectTrigger size="sm" aria-label="Message delivery"><SelectValue>{props.delivery === "prompt.steer" ? "Steer now" : "Follow up"}</SelectValue></SelectTrigger>
        <SelectContent><SelectItem value="prompt.steer">Steer now</SelectItem><SelectItem value="prompt.follow-up">Follow up</SelectItem></SelectContent>
      </Select> : <span className="composer-send-mode">Send now</span>}
    </div>
    <div className="composer-settings-mobile">
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button type="button" variant="ghost" size="icon" aria-label="Session and delivery settings" disabled={settingDisabled} />}><SlidersHorizontal aria-hidden="true" /></DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-64">
          <DropdownMenuLabel>Model · {modelLabel}</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={modelValue} onValueChange={setModel}>{props.details?.modelInventory?.map((item) => <DropdownMenuRadioItem key={`${item.provider}:${item.modelId}`} value={encodeModel(item.provider, item.modelId)} disabled={!props.canChangeModel}>{item.displayName ?? item.modelId}</DropdownMenuRadioItem>)}</DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Thinking · {thinking === undefined ? "Unavailable" : titleCase(thinking)}</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={thinking ?? ""} onValueChange={setThinking}>{props.details?.supportedThinkingLevels?.map((level) => <DropdownMenuRadioItem key={level} value={level} disabled={!props.canChangeThinking}>{titleCase(level)}</DropdownMenuRadioItem>)}</DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Message delivery</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={props.working ? props.delivery : "prompt.send"} onValueChange={(value) => { if (value !== "prompt.send") props.onSetDelivery(value as typeof props.delivery); }}><DropdownMenuRadioItem value="prompt.send" disabled={props.working}>Send now</DropdownMenuRadioItem><DropdownMenuRadioItem value="prompt.steer" disabled={!props.working}>Steer now</DropdownMenuRadioItem><DropdownMenuRadioItem value="prompt.follow-up" disabled={!props.working}>Follow up</DropdownMenuRadioItem></DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  </>;
}
