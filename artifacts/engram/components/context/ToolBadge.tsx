import { cn } from "@/lib/utils";
import type { AITool } from "@/types";

const toolConfig: Record<
  AITool,
  { label: string; bg: string; text: string; dot: string }
> = {
  chatgpt: {
    label: "ChatGPT",
    bg: "bg-tool-chatgpt/10",
    text: "text-tool-chatgpt",
    dot: "bg-tool-chatgpt",
  },
  claude: {
    label: "Claude",
    bg: "bg-tool-claude/10",
    text: "text-tool-claude",
    dot: "bg-tool-claude",
  },
  gemini: {
    label: "Gemini",
    bg: "bg-tool-gemini/10",
    text: "text-tool-gemini",
    dot: "bg-tool-gemini",
  },
  other: {
    label: "Other",
    bg: "bg-gh-muted/10",
    text: "text-gh-muted",
    dot: "bg-gh-muted",
  },
};

export function ToolBadge({
  tool,
  size = "sm",
  className,
}: {
  tool: AITool | string;
  size?: "sm" | "md";
  className?: string;
}) {
  const config = toolConfig[(tool as AITool)] ?? toolConfig.other;
  const sizing =
    size === "md"
      ? "px-2.5 py-1 text-xs gap-1.5"
      : "px-2 py-0.5 text-[11px] gap-1";

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full font-mono font-medium",
        config.bg,
        config.text,
        sizing,
        className
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", config.dot)} />
      {config.label}
    </span>
  );
}
