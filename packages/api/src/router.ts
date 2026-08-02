/**
 * Lightweight HTTP router for the memoryblock API.
 *
 * Plug into the `ApiServer` via `registerRouter(prefix, router)` so external
 * apps can mount their own route groups without forking the server.
 *
 * Patterns use Express-style `:name` placeholders that map to the second
 * argument of the handler as a `params` object.
 */

export interface RouterRequest {
    readonly method: string;
    readonly url: string;
    readonly headers: { get(name: string): string | null };
    json(): Promise<unknown>;
    text(): Promise<string>;
}

export type RouteParams = Record<string, string>;
export type RouteHandler = (req: RouterRequest, params: RouteParams) => Promise<Response> | Response;

interface CompiledRoute {
    method: string;
    pattern: RegExp;
    paramNames: string[];
    handler: RouteHandler;
}

export class Router {
    private routes: CompiledRoute[] = [];

    get(path: string, handler: RouteHandler): this { return this.add('GET', path, handler); }
    post(path: string, handler: RouteHandler): this { return this.add('POST', path, handler); }
    put(path: string, handler: RouteHandler): this { return this.add('PUT', path, handler); }
    patch(path: string, handler: RouteHandler): this { return this.add('PATCH', path, handler); }
    delete(path: string, handler: RouteHandler): this { return this.add('DELETE', path, handler); }

    private add(method: string, path: string, handler: RouteHandler): this {
        const paramNames: string[] = [];
        const escaped = path
            .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
            .replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, (_match, name: string) => {
                paramNames.push(name);
                return '([^/]+)';
            });
        this.routes.push({
            method: method.toUpperCase(),
            pattern: new RegExp('^' + escaped + '/?$'),
            paramNames,
            handler,
        });
        return this;
    }

    /**
     * Find a matching route. Returns the handler and extracted path params,
     * or `null` if no match.
     */
    match(method: string, path: string): { handler: RouteHandler; params: RouteParams } | null {
        const normalized = path.split('?')[0].replace(/\/+$/, '') || '/';
        for (const route of this.routes) {
            if (route.method !== method.toUpperCase()) continue;
            const m = normalized.match(route.pattern);
            if (!m) continue;
            const params: RouteParams = {};
            route.paramNames.forEach((name, i) => { params[name] = decodeURIComponent(m[i + 1]); });
            return { handler: route.handler, params };
        }
        return null;
    }
}
