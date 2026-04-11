// SPDX-License-Identifier: Apache-2.0
import { zodToJsonSchema } from 'zod-to-json-schema'
import type { ZodTypeAny } from 'zod'
import { SamvadError, ErrorCode } from './errors.js'
import type { SkillDef, RegisteredSkill, SkillContext, CommunicationMode, TrustTier } from './types.js'

export interface SkillOptions {
  name: string
  description: string
  input: ZodTypeAny
  output: ZodTypeAny
  modes: CommunicationMode[]
  trust: TrustTier
  allowedPeers?: string[]
  handler: (input: unknown, ctx: SkillContext) => Promise<unknown>
}

export class SkillRegistry {
  private skills = new Map<string, RegisteredSkill>()

  register(id: string, opts: SkillOptions): void {
    const def: SkillDef = {
      id,
      name: opts.name,
      description: opts.description,
      inputSchema: zodToJsonSchema(opts.input) as Record<string, unknown>,
      outputSchema: zodToJsonSchema(opts.output) as Record<string, unknown>,
      modes: opts.modes,
      trust: opts.trust,
      allowedPeers: opts.allowedPeers,
    }
    this.skills.set(id, { def, inputZod: opts.input, handler: opts.handler })
  }

  getDefs(): SkillDef[] {
    return Array.from(this.skills.values()).map(s => s.def)
  }

  getSkill(id: string): RegisteredSkill | undefined {
    return this.skills.get(id)
  }

  async dispatch(
    skillId: string,
    payload: Record<string, unknown>,
    ctx: SkillContext,
  ): Promise<unknown> {
    const skill = this.skills.get(skillId)
    if (!skill) throw new SamvadError(ErrorCode.SKILL_NOT_FOUND, `Skill '${skillId}' not found`)

    const result = skill.inputZod.safeParse(payload)
    if (!result.success) {
      const msg = result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')
      throw new SamvadError(ErrorCode.SCHEMA_INVALID, msg)
    }

    return skill.handler(result.data, ctx)
  }
}
