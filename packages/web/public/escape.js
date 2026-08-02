// HTML escaping utilities. Every user-provided string that ends up
// inside an innerHTML assignment or a template-literal HTML fragment
// must pass through one of these helpers. Raw interpolation is a
// stored XSS vector (CWE-79).
//
// Three rules of thumb:
//   1. Attribute values use attrEsc (also escapes backtick, equals, ampersand).
//   2. Element text uses escHtml.
//   3. URLs used in href / src use escUrl (only http, https, mailto, tel; blocks javascript:).

const HTML_ESCAPES = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
    '`': '&#96;',
};

// Escape a string for safe interpolation inside HTML text or element content.
export function escHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value).replace(/[&<>"'`]/g, (ch) => HTML_ESCAPES[ch] ?? ch);
}

// Escape a string for safe use as an HTML attribute value.
export function attrEsc(value) {
    if (value === null || value === undefined) return '';
    return escHtml(value);
}

// Escape a URL for use in href / src. Only http(s), mailto, tel pass
// through unchanged. Everything else becomes about:blank so a
// malicious javascript: payload can't execute.
export function escUrl(value) {
    const raw = String(value ?? '');
    try {
        const u = new URL(raw, 'http://placeholder.local');
        const allowed = new Set(['http:', 'https:', 'mailto:', 'tel:']);
        if (!allowed.has(u.protocol)) return 'about:blank';
        return u.toString();
    } catch {
        return 'about:blank';
    }
}
