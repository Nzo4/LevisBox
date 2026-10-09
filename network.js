// Names handled by WebKit's public DNR validator. Other names use Levitas'
// page-level Fetch/XHR integration; they are never silently dropped.
const known = new Set(('Accept Accept-Charset Accept-Language Accept-Encoding Accept-Ranges Access-Control-Allow-Credentials Access-Control-Allow-Headers Access-Control-Allow-Methods Access-Control-Allow-Origin Access-Control-Expose-Headers Access-Control-Max-Age Access-Control-Request-Headers Access-Control-Request-Method Age Authorization Cache-Control Clear-Site-Data Connection Content-Disposition Content-Encoding Content-Language Content-Length Content-Location Content-Security-Policy Content-Security-Policy-Report-Only Content-Type Content-Range Cookie Cookie2 Cross-Origin-Embedder-Policy Cross-Origin-Opener-Policy Cross-Origin-Resource-Policy Date DNT ETag Expect Expires Host If-Match If-Modified-Since If-None-Match If-Range If-Unmodified-Since Keep-Alive Last-Event-ID Last-Modified Link Location Origin Pragma Proxy-Authorization Range Referer Referrer-Policy Refresh Report-To Sec-Fetch-Dest Sec-Fetch-Mode Sec-Fetch-Site Sec-GPC Sec-Purpose Sec-WebSocket-Accept Sec-WebSocket-Extensions Sec-WebSocket-Key Sec-WebSocket-Protocol Sec-WebSocket-Version Server-Timing Service-Worker Service-Worker-Allowed Service-Worker-Navigation-Preload Set-Cookie Set-Cookie2 SourceMap TE Timing-Allow-Origin Trailer Transfer-Encoding Upgrade Upgrade-Insecure-Requests User-Agent Vary Via X-Content-Type-Options X-Frame-Options X-SourceMap X-XSS-Protection').toLowerCase().split(' '));
export function splitRules(compiled) {
  const rules = [], requestHeaders = [], responseHeaders = [];
  for (const rule of compiled.rules) {
    const action = {type:'modifyHeaders'};
    for (const key of ['requestHeaders','responseHeaders']) {
      const standard = [], custom = key === 'requestHeaders' ? requestHeaders : responseHeaders;
      // WebKit accepts append rules but can leave Fetch's explicit headers
      // unchanged. Use the deterministic Fetch/XHR path for append as well.
      for (const header of rule.action[key] || []) (known.has(header.header.toLowerCase()) && header.operation !== 'append' ? standard : custom).push(header);
      if (standard.length) action[key] = standard;
    }
    if (action.requestHeaders || action.responseHeaders) rules.push({...rule,action});
  }
  const enabled = requestHeaders.length + responseHeaders.length > 0;
  return {rules, native:{kind:'apply',enabled,regex:compiled.rules[0]?.condition.regexFilter || '',
    origins:compiled.origins,requestHeaders,responseHeaders}};
}
