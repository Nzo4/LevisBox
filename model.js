export function newProfile(name = 'Основной') {
  return {id: crypto.randomUUID(), name, scope: '', headers: []};
}
export function initialState() {
  const profile = newProfile();
  return {version: 1, enabled: true, activeId: profile.id, profiles: [profile]};
}
export function validateState(state) {
  if (!state || state.version !== 1 || typeof state.enabled !== 'boolean' ||
      !Array.isArray(state.profiles) || !state.profiles.length || state.profiles.length > 20)
    throw new Error('Некорректные настройки расширения.');
  const ids = new Set();
  for (const p of state.profiles) {
    if (!p || typeof p.id !== 'string' || ids.has(p.id) || typeof p.name !== 'string' ||
        !p.name.trim() || p.name.length > 80 || typeof p.scope !== 'string' ||
        p.scope.length > 1500 || !Array.isArray(p.headers) || p.headers.length > 100)
      throw new Error('Некорректный профиль.');
    ids.add(p.id);
    for (const h of p.headers) {
      if (typeof h.enabled !== 'boolean' || typeof h.name !== 'string' || typeof h.value !== 'string' ||
          !['request', 'response'].includes(h.target) || !['set', 'append', 'remove'].includes(h.operation))
        throw new Error('Некорректное правило заголовка.');
    }
  }
  if (!ids.has(state.activeId)) throw new Error('Активный профиль отсутствует.');
  return state;
}
const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function scopeFilter(input) {
  const scope = input.trim();
  if (!scope) throw new Error('Укажите домен или URL для активных правил.');
  if (scope === '*') return {regex: '^https?://', origins: ['http://*/*', 'https://*/*']};
  const explicitScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(scope);
  if (explicitScheme && !/^https?:\/\//i.test(scope)) throw new Error('Доступны только HTTP и HTTPS.');
  const supplied = explicitScheme ? scope : 'https://' + scope;
  const subdomains = /^(https?:\/\/)\*\./i.test(supplied);
  const parseable = supplied.replace(/^(https?:\/\/)\*\./i, '$1');
  let url;
  try { url = new URL(parseable); } catch { throw new Error('Некорректный домен или URL.'); }
  if (!url.hostname || url.username || url.password || url.hash || /[\s*]/.test(url.hostname) ||
      (!explicitScheme && (url.pathname !== '/' || url.search)))
    throw new Error('Используйте домен, *.example.com или полный HTTP(S) URL без фрагмента.');
  const host = url.hostname.toLowerCase();
  const schemes = explicitScheme ? [url.protocol.slice(0, -1)] : ['http', 'https'];
  const patternHost = (subdomains ? '*.' : '') + host;
  const origins = schemes.map(s => s + '://' + patternHost + '/*');
  const schemeRegex = explicitScheme ? schemes[0] : 'https?';
  // WebKit compiles a strict regex subset: no non-capturing groups or
  // alternation. Network URLs always include the slash after the authority.
  const hostRegex = (subdomains ? '([^/.]+\\.)*' : '') + escapeRegex(host);
  const port = url.port ? ':' + url.port : explicitScheme ? '' : '(:[0-9]+)?';
  const path = url.pathname + url.search;
  const suffix = explicitScheme && path !== '/'
    ? escapeRegex(path).replace(/\\\*/g, '.*') + '$' : '/';
  return {regex: '^' + schemeRegex + '://' + hostRegex + port + suffix, origins};
}
export const resourceTypes = ['main_frame', 'sub_frame', 'stylesheet', 'script', 'image', 'font', 'xmlhttprequest', 'ping', 'media', 'websocket', 'other'];
export function compile(state) {
  validateState(state);
  const profile = state.profiles.find(p => p.id === state.activeId);
  const enabled = profile.headers.filter(h => h.enabled);
  if (!state.enabled || !enabled.length) return {rules: [], origins: [], count: 0};
  const filter = scopeFilter(profile.scope);
  const seen = new Set();
  const requestHeaders = [], responseHeaders = [];
  for (const h of enabled) {
    const name = h.name.trim();
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)) throw new Error('Укажите корректное имя HTTP-заголовка.');
    if (name.length > 256 || h.value.length > 8192 || /[\x00-\x08\x0a-\x1f\x7f]/.test(h.value))
      throw new Error('Значение заголовка содержит недопустимые символы или слишком длинное.');
    const key = h.target + ':' + name.toLowerCase();
    if (seen.has(key)) throw new Error('Оставьте одно активное правило для каждого заголовка запросов / ответов.');
    seen.add(key);
    const rule = {header: name, operation: h.operation};
    if (h.operation !== 'remove') rule.value = h.value;
    (h.target === 'request' ? requestHeaders : responseHeaders).push(rule);
  }
  const action = {type: 'modifyHeaders'};
  if (requestHeaders.length) action.requestHeaders = requestHeaders;
  if (responseHeaders.length) action.responseHeaders = responseHeaders;
  return {rules: [{id: 1, priority: 1, action,
    condition: {regexFilter: filter.regex, isUrlFilterCaseSensitive: true, resourceTypes}}],
    origins: filter.origins, count: enabled.length};
}
