/**
 * Proxy-aware HTTP for all DingTalk REST calls. The corporate gateway
 * TLS-inspects every connection (re-signing certificates with a weak CA,
 * issuer CN="Web Proxy") and firewalls direct routes to DingTalk edges, so
 * when DINGTALK_STREAM_PROXY (or the ambient HTTPS_PROXY) is set, every
 * request rides an HTTP CONNECT tunnel with verification disabled — scoped to
 * these calls only; global TLS settings are untouched. Mirrors the stream-side
 * adaptation in stream.ts. Response shape mimics the subset of fetch's
 * Response the call sites use (ok/status/headers.get/text/json/arrayBuffer).
 */
import https from 'node:https'
import type { IncomingHttpHeaders } from 'node:http'

export interface ProxyFetchInit {
  method?: string
  headers?: Record<string, string>
  body?: string | Uint8Array | FormData
  signal?: AbortSignal
}

export interface ProxyFetchResponse {
  ok: boolean
  status: number
  headers: { get(name: string): string | null }
  text(): Promise<string>
  json(): Promise<unknown>
  arrayBuffer(): Promise<ArrayBuffer>
  body: ReadableStream<Uint8Array> | null
}

/**
 * Plugin-configured proxy (settings panel, ADR-0060 决定 2 高级区). When set it
 * takes precedence over the environment chain; apply() installs it on mount so
 * a config edit followed by the plugin remount re-seats it.
 */
let proxyOverride = ''

export function configureProxy(value: string | undefined): void {
  proxyOverride = value?.trim() ?? ''
}

/** The proxy URL from the plugin config override or the environment, or empty when unset. */
export function proxyUrl(): string {
  return (
    proxyOverride ||
    process.env.DINGTALK_STREAM_PROXY?.trim() ||
    process.env.HTTPS_PROXY?.trim() ||
    process.env.https_proxy?.trim() ||
    ''
  )
}

function rawRequest(
  requestOptions: https.RequestOptions,
  body: string | Uint8Array | undefined,
  signal: AbortSignal | undefined,
): Promise<{ status: number; headers: IncomingHttpHeaders; chunks: Buffer[] }> {
  return new Promise((resolve, reject) => {
    const req = https.request(requestOptions, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, chunks }))
    })
    req.on('error', reject)
    if (signal) {
      if (signal.aborted) {
        req.destroy()
        reject(signal.reason instanceof Error ? signal.reason : new Error('aborted'))
        return
      }
      signal.addEventListener('abort', () => req.destroy(signal.reason ?? new Error('aborted')), { once: true })
    }
    if (body !== undefined) req.write(body)
    req.end()
  })
}

function toResponse(status: number, headers: IncomingHttpHeaders, chunks: Buffer[]): ProxyFetchResponse {
  const buffer = Buffer.concat(chunks)
  const headerGet = (name: string): string | null => {
    const value = headers[name.toLowerCase()]
    return Array.isArray(value) ? (value[0] ?? null) : (value ?? null)
  }
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: headerGet },
    text: async () => buffer.toString('utf8'),
    json: async () => JSON.parse(buffer.toString('utf8')),
    arrayBuffer: async () =>
      buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer,
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(buffer))
        controller.close()
      },
    }),
  }
}

/** Serialize a FormData of string fields and file blobs into a multipart body. */
async function serializeFormData(form: FormData): Promise<{ body: Buffer; contentType: string }> {
  const boundary = '----dshdingtalk' + Math.random().toString(16).slice(2)
  const segments: Buffer[] = []
  for (const [key, value] of form.entries()) {
    if (typeof value === 'string') {
      segments.push(
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`),
      )
    } else {
      const filename = (value as File).name ?? 'blob'
      const type = value.type || 'application/octet-stream'
      segments.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="${key}"; filename="${filename}"\r\nContent-Type: ${type}\r\n\r\n`,
        ),
      )
      segments.push(Buffer.from(await value.arrayBuffer()))
      segments.push(Buffer.from('\r\n'))
    }
  }
  segments.push(Buffer.from(`--${boundary}--\r\n`))
  return { body: Buffer.concat(segments), contentType: `multipart/form-data; boundary=${boundary}` }
}

export async function proxyFetch(url: string, init: ProxyFetchInit = {}): Promise<ProxyFetchResponse> {
  const target = new URL(url)
  // Only DingTalk edges ride the tunnel; overridden/local endpoints keep the
  // platform fetch.
  if (!/(^|\.)dingtalk\.com$/.test(target.hostname)) return fetch(url, init as RequestInit)
  if (target.protocol !== 'https:') throw new Error(`proxyFetch supports https only: ${target.protocol}`)
  const method = init.method ?? 'GET'
  const proxy = proxyUrl()

  let body: string | Uint8Array | undefined
  const headers: Record<string, string> = { ...init.headers }
  if (init.body instanceof FormData) {
    const serialized = await serializeFormData(init.body)
    body = serialized.body
    headers['Content-Type'] = serialized.contentType
  } else if (init.body instanceof Uint8Array) {
    body = Buffer.from(init.body)
  } else {
    body = init.body
  }

  const requestOptions: https.RequestOptions = {
    hostname: target.hostname,
    port: target.port || 443,
    path: `${target.pathname}${target.search}`,
    method,
    headers: {
      ...headers,
      ...(body !== undefined ? { 'Content-Length': Buffer.byteLength(body) } : {}),
    },
  }
  if (proxy) {
    const { HttpsProxyAgent } = await import('https-proxy-agent')
    requestOptions.agent = new HttpsProxyAgent(proxy)
    // Corporate MITM CA fails Node's default security level; these calls are
    // already visible to the proxy, so skip verification. Request-level is
    // required: https-proxy-agent v9 does not relay constructor opts to the
    // origin TLS upgrade.
    requestOptions.rejectUnauthorized = false
  }
  const result = await rawRequest(requestOptions, body, init.signal)
  return toResponse(result.status, result.headers, result.chunks)
}
