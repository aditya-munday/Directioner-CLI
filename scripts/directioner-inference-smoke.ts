/**
 * End-to-end check that a Directioner provider drives real inference without
 * touching any vendor endpoint.
 *
 * Stands up a mock OpenAI-compatible provider on loopback, resolves a provider
 * config against it, builds the model the SDK would use, and runs a real
 * `generateText` call. Passes only if the request arrives at the configured
 * base URL with the configured key and model.
 *
 *   bun run scripts/directioner-inference-smoke.ts
 */
import { createServer } from 'node:http'

import { generateText } from 'ai'
import { toByokConnection } from '../cli/src/utils/directioner-byok'
import { getModelForRequest } from '../sdk/src/impl/model-provider'

const requests: Array<{
  url: string
  auth: string | undefined
  model: string | undefined
}> = []

const server = createServer((req, res) => {
  let body = ''
  req.on('data', (chunk) => (body += chunk))
  req.on('end', () => {
    let model: string | undefined
    try {
      model = JSON.parse(body).model
    } catch {
      model = undefined
    }
    requests.push({
      url: req.url ?? '',
      auth: req.headers.authorization,
      model,
    })
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(
      JSON.stringify({
        id: 'chatcmpl-test',
        object: 'chat.completion',
        created: 0,
        model: 'test',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'hello from mock' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    )
  })
})
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = (server.address() as { port: number }).port

const connection = toByokConnection({
  id: 'heital',
  displayName: 'Heital',
  upstream: 'Google Gemini',
  protocol: 'openai-compatible',
  baseUrl: `http://127.0.0.1:${port}`,
  model: 'gemini-3.8-flash',
  apiKeyEnvVar: 'HEITAL_API_KEY',
  apiKey: 'secret-key-123',
  supportsImages: true,
})

const model = getModelForRequest({
  apiKey: '',
  model: connection.model,
  byok: connection,
})

const result = await generateText({
  model,
  prompt: 'say hello',
})

console.log(`text         : ${result.text}`)
console.log(`requests     : ${requests.length}`)
console.log(`url          : ${requests[0]?.url}`)
console.log(`model on wire: ${requests[0]?.model}`)
console.log(`auth header  : ${requests[0]?.auth}`)

const ok =
  result.text === 'hello from mock' &&
  requests.length === 1 &&
  requests[0]!.url === '/chat/completions' &&
  requests[0]!.model === 'gemini-3.8-flash' &&
  requests[0]!.auth === 'Bearer secret-key-123'

server.close()
console.log(ok ? 'PASS' : 'FAIL')
process.exit(ok ? 0 : 1)
