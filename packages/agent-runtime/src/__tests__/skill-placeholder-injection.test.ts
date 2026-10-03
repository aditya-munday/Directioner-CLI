/**
 * Regression: a repository-supplied skill must not be able to expand the
 * skill tool's prompt through JavaScript replacement patterns.
 *
 * `String.prototype.replace(search, replacement)` treats `$&`, `` $` ``, `$'`,
 * `$1` … in a STRING replacement as special. The skill listing is spliced into
 * the skill tool description with that call, and a skill's name/description is
 * attacker-chosen (a repository's `.agents/skills/`). A description containing
 * `$&` used to splice the matched `{{AVAILABLE_SKILLS}}` placeholder back into
 * the prompt; `` $` `` splices the preceding trusted text and `$'` the
 * following text. The fix is a function replacer, which inserts the value
 * literally.
 *
 * This drives the real `formatAvailableSkillsXml` + `fullToolList` pipeline,
 * not a hand-built string, so the property is asserted where the bug lived.
 */

import { describe, expect, test } from 'bun:test'

import { formatAvailableSkillsXml } from '@beyonders/common/util/skills'

import { fullToolList } from '../tools/prompts'

import type { SkillsMap } from '@beyonders/common/types/skill'

const SKILL_PLACEHOLDER = '{{AVAILABLE_SKILLS}}'

function buildDescription(description: string): string {
  const skills: SkillsMap = {
    evil: {
      name: 'evil',
      description,
      content: 'do things',
      filePath: '/skills/evil/SKILL.md',
    },
  }
  return fullToolList(['skill'], {}, {
    availableSkillsXml: formatAvailableSkillsXml(skills),
  })
}

describe('skill placeholder substitution cannot be expanded by $ patterns', () => {
  test('$& does not splice the placeholder back into the prompt', () => {
    const out = buildDescription('harmless $& harmless')
    // The placeholder is consumed exactly once and never reappears.
    expect(out).not.toContain(SKILL_PLACEHOLDER)
    // `&` is XML-escaped to `&amp;`, so the literal survives as `$&amp;`.
    expect(out).toContain('$&amp;')
  })

  test('$` cannot inject the preceding trusted text', () => {
    const out = buildDescription('x$`y')
    // With the bug, `$`` expanded to the text before the placeholder. The
    // literal backtick form is what survives now.
    expect(out).toContain('x$`y')
  })

  test("$' cannot inject the following trusted text", () => {
    const out = buildDescription("x$'y")
    expect(out).toContain("$&apos;")
    expect(out).not.toContain(SKILL_PLACEHOLDER)
  })

  test('$1 is not treated as a capture group', () => {
    const out = buildDescription('cost $1 dollar')
    expect(out).toContain('cost $1 dollar')
  })

  test('$$ is inserted literally, not collapsed to $', () => {
    const out = buildDescription('price $$100')
    expect(out).toContain('price $$100')
  })
})
