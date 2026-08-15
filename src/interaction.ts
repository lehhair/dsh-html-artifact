/**
 * Server-side interaction-submission handling for artifact surfaces: parse the
 * slash-command payload and render the submission text the pre-step injector
 * puts in front of the model. Pure functions so the command handler and the
 * injector stay thin and the semantics are directly unit-testable.
 * @module
 */

/** One interaction submission recorded for an agent. */
export interface InteractionSubmission {
  /** The artifact id the user interacted with. */
  id: string
  /** Optional artifact display title. */
  title?: string
  /** The collected interaction payload (fields/artifactData). */
  data: unknown
  /** Epoch ms when the submission was recorded. */
  time: number
}

/** Result of parsing one `/artifact-submit` raw input. */
export type SubmissionParseResult =
  | { ok: true; value: InteractionSubmission }
  | { ok: false; error: string }

/**
 * Parse the raw input following `/artifact-submit` into a submission.
 * @param raw - the exact text after the command name (whitespace included).
 * @returns the parsed submission or a validation error.
 */
export function parseSubmissionPayload(raw: string): SubmissionParseResult {
  let payload: unknown
  try {
    payload = JSON.parse(raw)
  } catch {
    return { ok: false, error: 'artifact-submit: expected a JSON payload after the command name' }
  }
  if (payload === null || typeof payload !== 'object') {
    return { ok: false, error: 'artifact-submit: payload must be a JSON object' }
  }
  const record = payload as Record<string, unknown>
  const { id, title, data } = record
  if (typeof id !== 'string' || id.length === 0) {
    return { ok: false, error: 'artifact-submit: "id" must be a non-empty string' }
  }
  if (data === undefined) {
    return { ok: false, error: 'artifact-submit: "data" is required' }
  }
  return {
    ok: true,
    value: {
      id,
      ...typeof title === 'string' && title !== '' ? { title } : {},
      data,
      time: Date.now(),
    },
  }
}

/**
 * Render one submission as the model-visible context text (the expanded body
 * of the UI's context-injection row and the content the model reads).
 * @param submission - the recorded submission.
 * @returns the text block.
 */
export function renderInteractionSubmission(submission: InteractionSubmission): string {
  const label = submission.title === undefined ? submission.id : `${submission.id}（${submission.title}）`
  return `[artifact 交互提交] 用户操作了 HTML artifact ${label} 并提交了交互数据：\n\`\`\`json\n${JSON.stringify(submission.data, null, 2)}\n\`\`\``
}

/**
 * Render the one-line summary shown in the collapsed context-injection row
 * (the `source.summary` of the injected plugin message).
 * @param submission - the recorded submission.
 * @returns the summary line.
 */
export function renderSubmissionSummary(submission: InteractionSubmission): string {
  const data = submission.data
  let count = 0
  if (data !== null && typeof data === 'object') {
    const fields = (data as Record<string, unknown>).fields
    if (Array.isArray(fields)) count = fields.length
  }
  const label = submission.title === undefined ? submission.id : `${submission.id}（${submission.title}）`
  return `artifact ${label} 交互数据（${count} 个字段）`
}
