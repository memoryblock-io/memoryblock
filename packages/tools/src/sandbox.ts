/**
 * ToolSandbox — central enforcement layer for tool execution.
 * 
 * Every tool.execute() call passes through this gate.
 * It intercepts params, scans for file paths, validates them against
 * the block's permission scope, and blocks disallowed operations.
 * 
 * This class is designed as a drop-in replaceable module. Any future
 * enforcement backend can substitute this class as long as it exposes
 * the same static validate() and validateCommand() interface.
 */

import { resolve, relative, isAbsolute } from 'node:path';
import type { ToolContext, ToolExecutionResult, PermissionsConfig } from '@memoryblock/types';

// Patterns that look like file paths in tool params
const PATH_PARAM_NAMES = ['path', 'file', 'filePath', 'directory', 'dir', 'target', 'source', 'destination'];

// Sensitive files that should never be accessible regardless of scope
const SENSITIVE_PATTERNS = [
    'auth.json',
    '.env',
    '.memoryblock/auth.json',
    'id_rsa',
    'id_ed25519',
    '.ssh/config',
    '.aws/credentials',
];

// Shell tools that need special handling
const SHELL_TOOL_NAMES = ['execute_command', 'run_lint', 'run_build', 'run_test'];

export class ToolSandbox {

    /**
     * Validate a tool call BEFORE execution.
     * Returns null if allowed, or an error ToolExecutionResult if denied.
     */
    static validate(
        toolName: string,
        params: Record<string, unknown>,
        context: ToolContext,
    ): ToolExecutionResult | null {
        const perms = context.permissions || { scope: 'block', allowShell: false, allowNetwork: true, maxTimeout: 120_000 };

        // 1. Shell access check
        if (SHELL_TOOL_NAMES.includes(toolName)) {
            if (!perms.allowShell && perms.scope !== 'system') {
                return {
                    content: `Denied: "${toolName}" requires shell access. Current scope: "${perms.scope}". Run \`mblk permissions ${context.blockName} --allow-shell\` to grant access.`,
                    isError: true,
                };
            }
        }

        // 2. Scan all params for file paths and validate
        const pathViolation = ToolSandbox.scanPaths(params, context, perms);
        if (pathViolation) {
            return { content: pathViolation, isError: true };
        }

        // 3. Check for sensitive file access in any string param
        const sensitiveHit = ToolSandbox.scanSensitive(params);
        if (sensitiveHit) {
            return {
                content: `Denied: access to "${sensitiveHit}" is blocked for security.`,
                isError: true,
            };
        }

        return null; // Allowed
    }

    /**
     * Scan params for file path values and validate against scope.
     */
    private static scanPaths(
        params: Record<string, unknown>,
        context: ToolContext,
        perms: PermissionsConfig,
    ): string | null {
        if (perms.scope === 'system') return null; // No path restrictions

        for (const [key, value] of Object.entries(params)) {
            if (typeof value !== 'string') continue;

            // Check named path params
            const isPathParam = PATH_PARAM_NAMES.some(p =>
                key.toLowerCase().includes(p.toLowerCase()),
            );

            // Also check any string that looks like an absolute path
            const looksLikePath = isPathParam || value.startsWith('/') || value.startsWith('~');

            if (!looksLikePath) continue;

            const resolved = isAbsolute(value)
                ? value
                : resolve(context.workingDir || context.blockPath, value);

            const allowedRoot = perms.scope === 'workspace' && context.workspacePath
                ? context.workspacePath
                : context.blockPath;

            const rel = relative(allowedRoot, resolved);
            if (rel.startsWith('..') || isAbsolute(rel)) {
                const label = perms.scope === 'workspace' ? 'workspace' : 'block directory';
                return `Denied: "${key}" points to "${value}" which is outside the ${label}. Scope: "${perms.scope}".`;
            }
        }

        return null;
    }

    /**
     * Check if any string param references a sensitive file.
     */
    private static scanSensitive(params: Record<string, unknown>): string | null {
        for (const value of Object.values(params)) {
            if (typeof value !== 'string') continue;
            const normalized = value.replace(/\\/g, '/');
            for (const pattern of SENSITIVE_PATTERNS) {
                if (normalized.endsWith(pattern) || normalized.includes(`/${pattern}`)) {
                    return pattern;
                }
            }
        }
        return null;
    }

    /**
     * Scan a shell command string for path traversal attempts.
     * Returns an error message if the command looks like it's escaping scope.
     */
    static validateCommand(
        command: string,
        context: ToolContext,
    ): string | null {
        const perms = context.permissions || { scope: 'block', allowShell: false, allowNetwork: true, maxTimeout: 120_000 };
        if (perms.scope === 'system') return null;

        // Check for common escape patterns in shell commands
        const escapePatterns = [
            /\bcd\s+\//,             // cd /absolute
            /\bcat\s+\//,            // cat /etc/passwd
            /\bls\s+\//,             // ls / (outside block)
            />\s*\//,                // redirect to absolute path
            /\|\s*tee\s+\//,         // pipe to absolute path
        ];

        // Only flag these in block scope — workspace/system allow broader access
        if (perms.scope === 'block') {
            for (const pattern of escapePatterns) {
                if (pattern.test(command)) {
                    return `Denied: command appears to access paths outside the block directory. Scope: "block".`;
                }
            }
        }

        // Check for sensitive file access in any scope
        for (const sensitive of SENSITIVE_PATTERNS) {
            if (command.includes(sensitive)) {
                return `Denied: command references sensitive file "${sensitive}".`;
            }
        }

        return null;
    }
}
