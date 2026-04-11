import type { FastifyReply } from 'fastify'

export function startSSE(reply: FastifyReply): void {
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  })
}

export function sendSSEChunk(reply: FastifyReply, data: unknown): void {
  reply.raw.write(`data: ${JSON.stringify(data)}\n\n`)
}

export function sendSSEKeepAlive(reply: FastifyReply): void {
  reply.raw.write(': keep-alive\n\n')
}

export function endSSE(reply: FastifyReply): void {
  reply.raw.end()
}
