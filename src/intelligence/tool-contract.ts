import type { DatabaseSync } from 'node:sqlite';
import type { ResolvedConfig } from '../types.js';
import { IntelligenceToolError } from './intelligence-tool-error.js';
import type { ReportBriefing, ReportQueryScope } from './report-scope.js';

export const MAX_LIST_ITEMS = 50;
export const MAX_LIST_OFFSET = 5_000;
export const MAX_QUERY_LENGTH = 200;

export type ScopedIntelligenceToolContext = {
  readonly db: DatabaseSync;
  readonly resolved: ResolvedConfig;
  readonly scope: ReportQueryScope;
  readonly briefing?: ReportBriefing | undefined;
};

export type IntelligenceToolRegistration = {
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly execute: (context: ScopedIntelligenceToolContext, input: unknown) => unknown;
};

export function defineIntelligenceTool<Input>(definition: {
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly parse: (input: unknown) => Input;
  readonly execute: (context: ScopedIntelligenceToolContext, input: Input) => unknown;
}): IntelligenceToolRegistration {
  return {
    description: definition.description,
    inputSchema: definition.inputSchema,
    execute: (context, input) => definition.execute(context, definition.parse(input)),
  };
}

export function parseNoArguments(input: unknown): undefined {
  const args = readToolArguments(input);
  if (Object.keys(args).length > 0) {
    throw new IntelligenceToolError('This tool does not accept arguments');
  }
  return undefined;
}

export function readToolArguments(input: unknown): Readonly<Record<string, unknown>> {
  if (input === undefined || input === null) {
    return {};
  }
  if (!isRecord(input)) {
    throw new IntelligenceToolError('Tool arguments must be an object');
  }
  return input;
}

export function requireAllowedArguments(
  args: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
): void {
  const allowedSet = new Set(allowed);
  const unexpected = Object.keys(args).find((key) => !allowedSet.has(key));
  if (unexpected) {
    throw new IntelligenceToolError(`Unexpected tool argument: ${unexpected}`);
  }
}

export function requireString(args: Readonly<Record<string, unknown>>, key: string): string {
  const value = optionalString(args, key);
  if (!value) {
    throw new IntelligenceToolError(`${key} is required`);
  }
  return value;
}

export function optionalString(
  args: Readonly<Record<string, unknown>>,
  key: string,
): string | null {
  const value = args[key];
  if (value === undefined) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new IntelligenceToolError(`${key} must be a string`);
  }
  const trimmed = value.trim();
  if (trimmed.length > MAX_QUERY_LENGTH) {
    throw new IntelligenceToolError(`${key} is too long`);
  }
  return trimmed || null;
}

export function optionalInteger(
  args: Readonly<Record<string, unknown>>,
  key: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const value = args[key];
  if (!Number.isInteger(value) || typeof value !== 'number') {
    if (value === undefined) {
      return fallback;
    }
    throw new IntelligenceToolError(`${key} must be an integer from ${minimum} to ${maximum}`);
  }
  if (value < minimum || value > maximum) {
    throw new IntelligenceToolError(`${key} must be an integer from ${minimum} to ${maximum}`);
  }
  return value;
}

export function optionalEnum<const T extends readonly string[]>(
  args: Readonly<Record<string, unknown>>,
  key: string,
  allowed: T,
  fallback: T[number],
): T[number] {
  const value = args[key];
  if (value === undefined) {
    return fallback;
  }
  for (const candidate of allowed) {
    if (value === candidate) {
      return candidate;
    }
  }
  throw new IntelligenceToolError(`${key} must be one of ${allowed.join(', ')}`);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
