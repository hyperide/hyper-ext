/**
 * Canonical list of allowed bash commands for AI agent sandbox.
 * Single source of truth — all consumers import from here.
 * JSON file used directly by Docker sandbox (agent-worker.js).
 */
import commands from './allowed-bash-commands.json';

export const ALLOWED_BASH_CATEGORIES = commands.categories;

/** Flat Set of all allowed command names */
export const ALLOWED_COMMANDS = new Set(Object.values(commands.categories).flat());

/** Comma-separated list for system prompts */
export const ALLOWED_COMMANDS_LIST = [...ALLOWED_COMMANDS].join(', ');
