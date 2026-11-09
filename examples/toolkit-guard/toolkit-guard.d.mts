// Types for toolkit-guard.mjs. Source: packages/server/src/toolkit-guard.ts
export type Rulebook = Record<string, unknown>;
export interface ToolCall { id: string; type?: 'function'; function: { name: string; arguments: string } }
export interface ToolMessage { role: 'tool'; tool_call_id: string; content: string }
export interface HandlesToolCalls { getTools(): unknown; handleToolCall(tc: ToolCall): Promise<ToolMessage | { content: unknown; tool_call_id?: string }> }
export interface GuardDecision { tool: string; allowed: boolean; reason?: string; policy?: string; orderId?: string; amount?: number }
export interface GuardOptions {
  owner: { category: string; qty: number; address: string; budget: number };
  rulebook?: 'frozen-v4' | 'frozen-v3' | Rulebook;
  listedUnit?: number;
  onDecision?: (d: GuardDecision) => void;
}
export interface GuardedToolkit { getTools(): unknown; handleToolCall(tc: ToolCall): Promise<ToolMessage>; decisions: GuardDecision[] }
export function guardToolkit(toolkit: HandlesToolCalls, opts: GuardOptions): GuardedToolkit;
export function guardRulebook(rulebook?: 'frozen-v4' | 'frozen-v3' | Rulebook): Rulebook;
