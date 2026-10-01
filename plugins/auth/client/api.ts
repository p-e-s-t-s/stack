// Calls to auth's endpoints. The session cookie goes with them, and bodies are JSON.

export async function api<T = void>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!response.ok) {
    const failure = await response.json().catch(() => undefined)
    throw new Error(failure?.error ?? response.statusText)
  }
  return (response.status === 204 ? undefined : await response.json()) as T
}
