# Интеграция с Levitas

Этот репозиторий содержит WebExtension. Swift-приложение Levitas и его системное хранилище cookies в состав расширения не входят.

Manifest запрашивает `storage`, `declarativeNetRequestWithHostAccess` и `nativeMessaging`. HTTP(S)-сайты указаны как optional host permissions: установка не выдаёт доступ ко всем сайтам.

## Native messaging

Встроенный в Levitas host имеет идентификатор `dev.levitas.browser.headers` и обрабатывает два сообщения:

```js
browser.runtime.sendNativeMessage('dev.levitas.browser.headers', {kind: 'get'})
// {ok: true, config: {enabled, regex, origins, requestHeaders, responseHeaders}}

browser.runtime.sendNativeMessage('dev.levitas.browser.headers', {
  kind: 'apply', enabled: true,
  regex: '^https://api\\.example\\.com/',
  origins: ['https://api.example.com/*'],
  requestHeaders: [{header: 'X-Debug', operation: 'set', value: 'demo'}],
  responseHeaders: []
})
// {ok: true} или {ok: false, error: '...'}
```

Host проверяет, что контекст расширения загружен, имеет оба разрешения и получил доступ ко всем указанным origins. Имена, значения, regex, число строк и размеры сообщения ограничены. Конфигурация сохраняется отдельно для каждого ID расширения с правами файла 0600. Значения не включаются в диагностические ошибки.

`engine.js` сначала сохраняет предыдущие DNR/native-конфигурации, затем применяет новые и записывает `browser.storage.local`. При ошибке пытается вернуть обе предыдущие конфигурации. `levitasHeaders` — сохранённый ключ storage; он оставлен для совместимости с исходной версией.

## Запросы страницы

Для Fetch/XHR Levitas проверяет доверенный URL фрейма, полученный от WebKit, и его разрешения. Конфигурация передаётся непосредственно в проверенный фрейм через WebKit, а не через DOM-события. Сигналы обновления не содержат значений заголовков.

Документ GET/HEAD загружается одноразовым URLSession с cookies из WKHTTPCookieStore. Автоматические редиректы отключены: новый URL проверяется до следующей отправки. За пределами разрешённых сайтов навигация продолжается обычным WebKit с чистым запросом. Ответ передаётся через `WKWebView.loadSimulatedRequest(_:response:responseData:)` с исходным статусом и заголовками безопасности; транспортное сжатие нормализуется. При закрытии или выгрузке вкладки задача отменяется.

Этот host не является отдельно установленной программой для Chrome/Firefox и не регистрируется в их NativeMessagingHosts. Для порта в другие браузеры требуется отдельный сетевой backend и проверка фактической совместимости.
