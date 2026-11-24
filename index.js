/**
 * Native WeNeed seed for DeepSeek Flash models.
 *
 * This is deliberately a custom OpenAI-compatible LlmAdapter rather than a
 * pi-ai wrapper: the seed contract fixes the final JSON key order and the
 * tool-step content value, and pi-ai owns both internally.
 */
import { readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { install as installDebugTap } from './debug-tap.mjs';

const SEED_URL = new URL('./seed.txt', import.meta.url);
let seedText;
try {
  seedText = readFileSync(SEED_URL, 'utf8');
} catch (error) {
  throw new Error(`dsh-we-need-plugin: cannot read ${SEED_URL.href}; seed.txt must be shipped next to index.js (${error.message})`);
}
const SEED = seedText.replace(/^\uFEFF/, '').trim();
if (SEED.length === 0) {
  throw new Error('dsh-we-need-plugin: seed.txt must not be empty');
}

const DEFAULT_TARGET_RULES = [['deepseek', 'flash']];

const TOOL_STEP_ANCHOR = "Need continue from the tool result. Should keep the plan concrete. Must state the next action. Need act now.";
// Nearest-output guidance (config.nearestGuidance). Clean, soft collective
// planning nudge filled into the latest assistant(tool_calls) content and/or
// appended to its reasoning_content. Continue-oriented (not the opening seed),
// let/need dominant with normal sentences. Field-keyed, append/fill-only.
const NEAREST_GUIDANCE = "Need continue from the latest result and keep the whole picture in view. Should choose the next concrete action. Need proceed.";
// General content-fill lever (config.contentFill). DSH accepts non-empty
// tool-call assistant content, and OpenDesign-style relays rebuild tool turns as
// content:null + reasoning_content, so the visible history loses the WeNeed voice
// and continuation/interrupt turns drift. This fills EMPTY assistant content across
// the whole task scope (user-task and tool-step alike): the latest tool-call turn
// gets seed + continue-work + its own reasoning; older empty turns get their own
// reasoning mirrored into content. Never overwrites existing visible speech;
// replayState-aligned; idempotent via the empty-content guard.
const CONTINUE_WORK = "Need continue the main work from the actual task. Should treat the trace above as a reasoning template, not as the task itself. Need choose the next concrete action and proceed.";
// Orientation lever (config.seedOrientation: off | example | full, default off).
// Labels the seed as a reasoning-style EXAMPLE via colon + newline (no quotes, so
// the trace stays a bare first-person thought the model can imitate, not a quoted
// external artifact), and in full mode appends the actual previous thinking, the
// current todo list, and provider-measured context occupancy. Only the visible
// content text block changes; the reasoning channel keeps the raw SEED so isSeed,
// hasSeedAfter and reasoning_content ownership are untouched. Additive and gated:
// off is byte-identical to 4.3.2. Data sources are read-only and fail-soft.
const ORIENTATION_LABEL = 'Need treat the reasoning-style example below as style only — not this task, not a previous turn:';
const ORIENTATION_CONTINUE = 'Need continue the main work from the actual task. Need choose the next concrete action and proceed.';
const ORIENTATION_PREVIOUS_HEAD = 'Need continue from the actual previous thinking, which was:';
const ORIENTATION_TASKS_HEAD = 'Should keep the current task list in view:';
const ORIENTATION_MODES = new Set(['off', 'example', 'full']);
function orientationMode(value) {
  const mode = String(value ?? 'off').toLowerCase();
  return ORIENTATION_MODES.has(mode) ? mode : 'off';
}
// Team outgoing register instruction (config.teamRegisterHint). Appended to the
// description of tools whose payload is direct speech/task sent to another agent
// (send_message / spawn_teammate / subagent / subagent_fork / team_task_* /
// remote_send_message / workflow).
// Soft distribution, not a rigid rule. English is explicit: the outgoing register
// must be English collective voice even when the surrounding task is Chinese;
// quoted user task text stays verbatim.
const TEAM_REGISTER_HINT = "We need every message or task sent to another agent to be a self-contained prompt in the WeNeed register. Need state the target, next action, constraints, and expected evidence. Should write in English for the outgoing planning register even when the task is Chinese, and keep quoted task text verbatim. Could use Need / Should / Could / Can / Must as natural modal openers, and use We need / We should / We can / Let's for collective moves. Must vary sentence shape, avoid repeating one opener, and never start with a requester-wants description or a self-referential first-person transition; every message, task, spawn prompt, sub-agent prompt, or workflow agent(prompt) task sent to a teammate or sub-agent is a prompt to that model. Let's cover send_message, spawn_teammate, subagent, subagent_fork, team_task_create, team_task_update, remote_send_message, and workflow.";
const TEAM_HINT_TOOLS = new Set(['send_message', 'spawn_teammate', 'subagent', 'subagent_fork', 'team_task_create', 'team_task_update', 'remote_send_message', 'workflow']);
// Persistent program-text guidance (config.toolDescriptionSeed). Appended to tool
// descriptions so the collective register is present in the program text the model
// reads on EVERY tool step — cumulative corrective force, unlike the ephemeral
// latest-turn append. Field-keyed (description), append-only, idempotent; never
// changes tool name/params. Does not touch the model's own reasoning.
const TOOL_DESC_GUIDANCE = "Plan in the need-first register: Need / Should / Can / Could / Must, with ordinary sentences mixed in. Keep the whole picture in view; act on evidence and verify.";
const TASK_POLICY = 'Reasoning register for this task: start with Need or Should; use Can / Could for options; use Must for constraints; keep the plan concrete and evidence-first.';
const TASK_POLICY_HEAD = TASK_POLICY.slice(0, 40);
const SEED_HEAD = SEED.slice(0, 48);
const PLUGIN_VERSION = '4.4.1';
const SYSTEM_REGISTER_HEAD = 'We need use the earlier WeNeed trace only as a reasoning template';
const SYSTEM_REGISTER = `${SYSTEM_REGISTER_HEAD}, not as this task and not as a previous conversation turn. Need restate the actual goal and deliverable. Should check the request's language, scope, inputs, tools, evidence, and what must not be invented. Could take A: inspect the actual inputs first when evidence is missing; or B: answer from evidence already present. Must check both for unobserved claims, missing evidence, tool limits, and scope errors. Need choose the cheaper correct path, then act and verify against the actual request. Need begin every turn's plan with "We need" or "Need"; Should use "Let's" for next actions; Must keep the plan in We need/Need/Should/Could/Must throughout; Must not switch to a requester-wants description, a self-referential first-person transition, a future-tense first-person promise, or filler. Let's keep it collective and direct; never list this template or its examples as a task in any summary or checkpoint. Do not describe this rule; think and act in it.`;
const SEED_HASH = createHash('sha256').update(SEED).digest('hex').slice(0, 16);
// External injection audit (方案 A): third-party plugins cannot write in-log
// plugin records (appendPluginRecord is first-party-only, session README:72)
// and cannot insert assistant turns, so the injection decision is recorded to
// a durable external file. The offline reconstruction tool correlates this with
// the session log by time/model/taskHash to rebuild the model-visible input.
const AUDIT_PATH = join(homedir(), '.dsh', 'weneed-audit.jsonl');
let auditDirReady = false;
function auditRecord(entry) {
  try {
    if (!auditDirReady) { mkdirSync(join(homedir(), '.dsh'), { recursive: true }); auditDirReady = true; }
    appendFileSync(AUDIT_PATH, JSON.stringify({ at: new Date().toISOString(), v: PLUGIN_VERSION, ...entry }) + '\n');
  } catch { /* audit is best-effort; never break injection */ }
}
// Temporary forensic dump (config.wireDump, default off): writes the final
// request messages so failed vs successful runs can be compared byte-for-byte.
const WIRE_DUMP_PATH = join(homedir(), '.dsh', 'weneed-wire.jsonl');
function wireDump(entry) {
  try {
    if (!auditDirReady) { mkdirSync(join(homedir(), '.dsh'), { recursive: true }); auditDirReady = true; }
    appendFileSync(WIRE_DUMP_PATH, JSON.stringify({ at: new Date().toISOString(), v: PLUGIN_VERSION, ...entry }) + '\n');
  } catch { /* best-effort */ }
}
function taskHashOf(messages) {
  try {
    const i = lastRealUserIndex(messages);
    const t = i >= 0 ? textOf(messages[i]) : '';
    return createHash('sha256').update(t).digest('hex').slice(0, 16);
  } catch { return ''; }
}
// The checkpoint is a user message and can outweigh the assistant seed. Write
// its summary in the same collective register so the nearest text to the next
// task already carries the We need voice. Keep this instruction free of the
// program's forbidden negative examples.
const COMPACTION_REGISTER_HEAD = 'We need write this checkpoint in the same WeNeed register';
const COMPACTION_REGISTER = `${COMPACTION_REGISTER_HEAD} as the work. Need start goal, next-action, and state sentences with We need, Need, Should, Can, Could, or Must. Should use We only when collective ownership is accurate. Could include one short line summarizing what the immediately preceding step actually did, in the same sentence pattern. Must keep every section, path, command, error string, identifier, and numeric value unchanged. Let's keep the bullets terse.`;
// Build the legacy opening and skill name from fragments so the packaged host
// source never contains the drift phrase as a contiguous literal.
const LEGACY_OPENING = ['L', 'e', 't', ' ', 'm', 'e'].join('');
const LEGACY_SKILL_NAME = ['let', 'me'].join('-');
const I_LL_KEY = ['I', "'", 'll'].join('');
const USER_NOUN = ['u', 's', 'e', 'r'].join('');
const HESITATION_WORD = ['H', 'm', 'm'].join('');
const LET_ME_PATTERN = ['L', 'e', 't', '\\s+', 'm', 'e'].join('');
const FIRST_PERSON = ['I'].join('');
const ILL_PATTERN = `${FIRST_PERSON}['’]?ll`;
const I_WILL_PHRASE = `${FIRST_PERSON}\\s+will`;
const I_CONTRACTION_PATTERN = `${FIRST_PERSON}['’](?:m|ve|d|ll)`;
const USER_REQUEST_PATTERN = `^The\\s+${USER_NOUN}\\s+(?:wants|asks|needs)\\b`;
const HESITATION_PATTERN = `^${HESITATION_WORD}\\s*[,，]\\s*`;
const PROGRAM_REPLACEMENTS = [
  [new RegExp(`\\bthe ${USER_NOUN}\\b`, 'gi'), (match) => `${match[0] === 'T' ? 'The' : 'the'} requester`],
  [new RegExp(`\\b${LET_ME_PATTERN}\\b`, 'gi'), (match) => `${match[0] === 'L' ? 'We' : 'we'} need`],
  [new RegExp(`\\b${I_LL_KEY}\\b`, 'gi'), (match) => `${match[0] === 'I' ? 'We' : 'we'} will`],
  [new RegExp(`\\b${I_WILL_PHRASE}\\b`, 'gi'), (match) => `${match[0] === 'I' ? 'We' : 'we'} will`],
  [new RegExp(`\\b${HESITATION_WORD}\\b`, 'gi'), (match) => (match[0][0] === 'H' ? 'Need' : 'need')],
];

const CONTEXT_PREFIXES = [
  'Current runtime context.',
  'Time sampled while preparing',
  'Current working directory:',
  'Current DSH file policy:',
  'Approval prompts are disabled',
  'You are the Team Lead named',
];
const CONTEXT_INCLUDES = [
  ['A skill is a reusable set', 'available_skills'],
];
const CONTEXT_RE = [
  /^The available skill catalog changed\./i,
  /the available skill catalog changed/i,
  /\bskill catalog\b/i,
];
// Task entry is ALLOWLIST-driven (4.3.0), not a deny-list of known context
// kinds. Only these structured kinds (plus the real `user` kind) are tasks.
// Every OTHER typed source.kind is generated context by default — including
// any brand-new kind a future DSH update introduces (progress nudges, team
// board notices, skill invocations, title generators, …). This is the
// fundamental fix for the deny-list fragility: a new reminder kind can never
// silently become the seed anchor, because it is not on the task allowlist.
// The safer failure mode is "no injection" (detectable) rather than "seed
// anchored to a generated nudge" (silent register drift).
// Known DSH context kinds observed to date (informational; NOT consulted for
// the decision): agent-instructions, agent-message, compact-checkpoint,
// dsh-session-title-llm, model-selection, progress-updates-nudge, ptc-mode,
// repeat-tool-reminder, runtime-context, skill-catalog, skill-invocation,
// subagent-report, subagent-settled, team-board-notice, team-message,
// time-context, tool-jobs, user-approval, user-question-reply, working-directory.
const TASK_SOURCE_KINDS = new Set([
  'goal',
  'schedule',
  'tool-goal',
]);
function textOf(message) {
  const content = message?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((block) => ((block?.type === 'text' || block?.type === undefined) && typeof block.text === 'string'
      ? block.text
      : ''))
    .join('');
}

function reasoningOf(message) {
  const content = message?.content;
  if (!Array.isArray(content)) return '';
  return content.map((block) => (block?.type === 'reasoning' && typeof block.text === 'string' ? block.text : '')).join('');
}

/**
 * Reasoning source for mirroring. OpenDesign replays thinking as
 * reasoning_details[] and may not carry a reasoning block, so fall back to
 * that channel before giving up. reasoning_content/reasoning strings cover
 * delegated request shapes that bypass DSH block history.
 */
function reasoningTextOf(message) {
  const reasoning = reasoningOf(message);
  if (reasoning.trim().length > 0) return reasoning;
  const details = message?.reasoning_details;
  if (Array.isArray(details)) {
    const text = details.map((detail) => detail?.text || detail?.summary || '').join('');
    if (text.trim().length > 0) return text;
  }
  if (typeof message?.reasoning_content === 'string' && message.reasoning_content.trim().length > 0) {
    return message.reasoning_content;
  }
  return typeof message?.reasoning === 'string' ? message.reasoning : '';
}

function isContextUserByText(message) {
  const text = textOf(message).trimStart();
  if (CONTEXT_PREFIXES.some((prefix) => text.startsWith(prefix))) return true;
  if (CONTEXT_INCLUDES.some(([a, b]) => text.includes(a) && text.includes(b))) return true;
  return CONTEXT_RE.some((re) => re.test(text));
}

function isContextUser(message) {
  if (message?.role !== 'user') return false;
  // A compaction checkpoint is a boundary, not an ordinary context block.
  if (isCompaction(message)) return false;
  const kind = message?.source?.kind;
  if (typeof kind === 'string' && kind.length > 0) {
    // Allowlist: only `user` and the structured task kinds are NOT context.
    // Any other typed kind (known or future) is generated context.
    if (kind === 'user' || TASK_SOURCE_KINDS.has(kind)) return false;
    return true;
  }
  // Untyped legacy/delegated requests: fall back to the text sniff.
  return isContextUserByText(message);
}

function isImageUser(message) {
  if (message?.role !== 'user' || !Array.isArray(message?.content)) return false;
  // A real user upload (source.kind === 'user') is still a task even when it
  // carries an image block. Only synthetic image-only user messages (for
  // example a tool result re-wrapped as image_url) are skipped.
  if (message?.source?.kind === 'user') return false;
  return message.content.some((block) => block?.type === 'image'
    || block?.type === 'image_url'
    || block?.type === 'input_image'
    || block?.image_url);
}

/**
 * Task entry is ALLOWLIST-based (4.3.0). A typed source.kind is a task only
 * when it is `user` or one of TASK_SOURCE_KINDS (`goal`, `schedule`,
 * `tool-goal`). Every other typed kind — including any new kind a future DSH
 * update adds — defaults to context, so a generated reminder/nudge can never
 * become the seed anchor. Legacy/delegated requests without source.kind fall
 * back to the text/image check.
 */
function isTaskUser(message) {
  if (message?.role !== 'user' || isCompaction(message)) return false;
  const kind = message?.source?.kind;
  if (typeof kind === 'string' && kind.length > 0) {
    return kind === 'user' || TASK_SOURCE_KINDS.has(kind);
  }
  return !isContextUserByText(message) && !isImageUser(message);
}

function isCompaction(message) {
  if (message?.role !== 'user' && message?.role !== 'system') return false;
  const text = textOf(message);
  return text.includes('<compacted-summary>')
    || text.includes('<cb_summary>')
    || text.includes('automatically generated checkpoint')
    || (/summary of the conversation so far/i.test(text) && /<previous_(user_message|tool_call)>/i.test(text));
}

function isCompactionRequest(messages) {
  const tail = messages.slice(-3).filter((message) => message?.role === 'user' || message?.role === 'system');
  const tailText = tail.map(textOf).join('\n');
  if (/acting as a compaction engine/i.test(tailText)
    || /Condense the conversation ABOVE/i.test(tailText)
    || /Output only the checkpoint text/i.test(tailText)) return true;
  const last = messages[messages.length - 1];
  const lastText = last?.role === 'user' || last?.role === 'system'
    ? textOf(last).trim().slice(0, 400)
    : '';
  return /^(please\s+)?(summarize|summarise|write a summary of|produce a summary of)[\s\S]{0,200}\bconversation/i.test(lastText);
}

/**
 * The compaction checkpoint is a user message and can outweigh the assistant
 * seed. Append a short positive register requirement to the compaction
 * instruction so the generated checkpoint itself carries We need / Let's need.
 * This changes only the auxiliary summarization request; it never inserts a
 * seed or touches the conversation body.
 */
function appendCompactionRegister(messages, mode = 'we-need', force = false) {
  if (String(mode ?? '').toLowerCase() === 'off') return messages;
  if (!force && !isCompactionRequest(messages)) return messages;
  const index = messages.length - 1;
  const message = messages[index];
  if (message?.role !== 'user') return messages;
  const text = textOf(message);
  if (text.includes(COMPACTION_REGISTER_HEAD)) return messages;
  if (!force && !/acting as a compaction engine|Condense the conversation ABOVE|Output only the checkpoint text/i.test(text)) {
    return messages;
  }
  const content = Array.isArray(message.content)
    ? message.content
    : [{ type: 'text', text: String(message.content ?? '') }];
  const next = [...messages];
  next[index] = {
    ...message,
    content: [...content, { type: 'text', text: `\n\n${COMPACTION_REGISTER}` }],
  };
  return next;
}

function appendSystemRegister(messages, enabled = false) {
  // Keep the behavior rule in the system prompt, where it survives tool steps
  // and compaction. Run after sanitize so its forbidden-phrase examples are not
  // rewritten by the program-text sanitizer.
  if (!enabled || !Array.isArray(messages)) return messages;
  const index = messages.findIndex((message) => message?.role === 'system');
  if (index < 0) return messages;
  const message = messages[index];
  if (textOf(message).includes(SYSTEM_REGISTER_HEAD)) return messages;
  const content = Array.isArray(message.content)
    ? [...message.content, { type: 'text', text: `\n\n${SYSTEM_REGISTER}` }]
    : `${String(message.content ?? '')}\n\n${SYSTEM_REGISTER}`;
  const next = [...messages];
  next[index] = { ...message, content };
  return next;
}

function hasToolCalls(message) {
  return message?.role === 'assistant'
    && Array.isArray(message.content)
    && message.content.some((block) => block?.type === 'tool-call');
}

function isToolStep(message) {
  return message?.role === 'tool' || hasToolCalls(message);
}

/**
 * Mirror an assistant turn's reasoning into content. DSH accepts non-empty
 * tool-call assistant content; tool-call turns are skipped here only as a
 * conservative default, and includeToolSteps mirrors them too. The contentFill
 * lever is the preferred general path. Existing text is never overwritten.
 */
function mirrorAssistantMessage(message, enabled = true, includeToolSteps = false) {
  if (!enabled || message?.role !== 'assistant') return message;
  const toolCallTurn = hasToolCalls(message);
  if (toolCallTurn && !includeToolSteps) return message;
  const text = textOf(message);
  const reasoning = reasoningTextOf(message);
  if (text.trim().length > 0 || reasoning.trim().length === 0) return message;
  const original = Array.isArray(message.content) ? message.content : [];
  const content = [{ type: 'text', text: reasoning }, ...original];
  // DSH reconstructs pi-ai history by index-aligning replayState.blocks with
  // content. A new text block needs a matching replay entry, or the whole
  // message falls back to foreign replay and loses its reasoning signature.
  const replay = message.source?.replayState;
  if (replay !== undefined
    && Array.isArray(replay.blocks)
    && replay.blocks.length === original.length) {
    return {
      ...message,
      content,
      source: {
        ...message.source,
        replayState: {
          ...replay,
          blocks: [{ type: 'text' }, ...replay.blocks],
        },
      },
    };
  }
  return { ...message, content };
}

function mirrorMessages(messages, enabled = true, includeToolSteps = false, scopeStart = 0) {
  if (!enabled) return messages;
  let changed = false;
  const next = messages.map((message, index) => {
    if (index < scopeStart) return message;
    const mirrored = mirrorAssistantMessage(message, enabled, includeToolSteps);
    if (mirrored !== message) changed = true;
    return mirrored;
  });
  return changed ? next : messages;
}

function replaySignatureFor(message, index) {
  const replay = message?.source?.replayState;
  const api = replay?.response?.api;
  const completions = api === undefined || api === 'openai-completions';
  const original = index >= 0 && Array.isArray(replay?.blocks)
    ? replay.blocks[index]?.thinkingSignature
    : undefined;
  if (original !== undefined) {
    if (!completions) return original === 'reasoning_content' ? undefined : original;
    // The gateway reads reasoning_content only, but pi-ai replays whichever
    // field name the response used (reasoning/reasoning_text). Normalize the
    // plain aliases back so the plan survives the tool-step round trip; leave
    // JSON reasoning-details signatures for pi-ai's preserved-details path.
    return ['reasoning', 'reasoning_content', 'reasoning_text'].includes(original)
      ? 'reasoning_content'
      : original;
  }
  return completions ? 'reasoning_content' : undefined;
}

function insertAssistantBlocks(message, types, text) {
  const original = Array.isArray(message.content) ? message.content : [];
  const blocks = types.map((type) => (type === 'text'
    ? { type: 'text', text }
    : { type: 'reasoning', text }));
  const content = [...blocks, ...original];
  const replay = message.source?.replayState;
  if (replay !== undefined
    && Array.isArray(replay.blocks)
    && replay.blocks.length === original.length) {
    const reasoningSignature = replaySignatureFor(message, -1);
    const replayBlocks = types.map((type) => (type === 'text'
      ? { type: 'text' }
      : {
        type: 'reasoning',
        ...(reasoningSignature === undefined ? {} : { thinkingSignature: reasoningSignature }),
      }));
    return {
      ...message,
      content,
      source: {
        ...message.source,
        replayState: {
          ...replay,
          blocks: [...replayBlocks, ...replay.blocks],
        },
      },
    };
  }
  return { ...message, content };
}

/**
 * Qoder's reseedLastAssistant() appends a short tool seed to the latest
 * assistant tool-call turn. DSH must not add a new message or touch the tool
 * pair; this anchors the existing assistant turn only when it has neither
 * content nor reasoning. Mode controls which channel receives the anchor.
 */
function anchorEmptyToolPlan(messages, mode = 'off', anchor = TOOL_STEP_ANCHOR, scopeStart = 0) {
  const normalized = String(mode ?? 'off').toLowerCase();
  if (!['reasoning', 'content', 'both'].includes(normalized)) return messages;
  const last = messages[messages.length - 1];
  if (!isToolStep(last) && !isToolStepAfterContexts(messages)) return messages;
  let index = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message?.role === 'assistant' && hasToolCalls(message)) {
      index = i;
      break;
    }
  }
  if (index < 0 || index < scopeStart) return messages;
  const message = messages[index];
  const empty = textOf(message).trim().length === 0 && reasoningTextOf(message).trim().length === 0;
  if (!empty) return messages;
  const types = normalized === 'both'
    ? ['text', 'reasoning']
    : [normalized === 'content' ? 'text' : 'reasoning'];
  const next = [...messages];
  next[index] = insertAssistantBlocks(message, types, anchor);
  return next;
}

function reasoningChannelClean(message) {
  if (message?.role !== 'assistant' || !Array.isArray(message.content)) return false;
  const reasoningIndexes = message.content
    .map((block, index) => (block?.type === 'reasoning' ? index : -1))
    .filter((index) => index >= 0);
  if (reasoningIndexes.length !== 1) return false;
  if (Object.prototype.hasOwnProperty.call(message, 'reasoning_content')
    || Object.prototype.hasOwnProperty.call(message, 'reasoning_details')
    || Object.prototype.hasOwnProperty.call(message, 'reasoning')) return false;
  const replay = message.source?.replayState;
  if (!Array.isArray(replay?.blocks) || replay.blocks.length !== message.content.length) return false;
  const expected = replaySignatureFor(message, reasoningIndexes[0]);
  return replay.blocks[reasoningIndexes[0]]?.thinkingSignature === expected;
}

/**
 * Collapse an assistant turn to one reasoning block and force the DSH field
 * signature. pi-ai uses the first non-empty thinking block's signature as the
 * wire key, so a single reasoning_content block means one reasoning field.
 */
function withSingleReasoningBlock(message, text) {
  if (message?.role !== 'assistant' || !Array.isArray(message.content)) return message;
  const original = message.content;
  const replay = message.source?.replayState;
  const replayAligned = Array.isArray(replay?.blocks) && replay.blocks.length === original.length;
  const hasReasoning = original.some((block) => block?.type === 'reasoning');
  const hasAliases = Object.prototype.hasOwnProperty.call(message, 'reasoning_content')
    || Object.prototype.hasOwnProperty.call(message, 'reasoning_details')
    || Object.prototype.hasOwnProperty.call(message, 'reasoning');
  const reasoningBlocks = original.filter((block) => block?.type === 'reasoning');
  const replayNeedsSignature = replayAligned && original.some((block, index) => block?.type === 'reasoning'
    && replay.blocks[index]?.thinkingSignature !== replaySignatureFor(message, index));
  if (reasoningBlocks.length === 1 && reasoningBlocks[0].text === text
    && !hasAliases && !replayNeedsSignature && !original.some((block, index) => index > 0 && block?.type === 'reasoning')) {
    return message;
  }
  if (!hasReasoning && text.trim().length === 0 && !hasAliases) return message;

  const content = [];
  const replayBlocks = [];
  let used = false;
  for (let index = 0; index < original.length; index += 1) {
    const block = original[index];
    if (block?.type === 'reasoning') {
      if (!used) {
        content.push({ ...block, text });
        const signature = replaySignatureFor(message, index);
        replayBlocks.push({
          type: 'reasoning',
          ...(signature === undefined ? {} : { thinkingSignature: signature }),
        });
        used = true;
      }
      continue;
    }
    content.push(block);
    if (replayAligned) replayBlocks.push(replay.blocks[index]);
  }
  if (!used && text.trim().length > 0) {
    content.unshift({ type: 'reasoning', text });
    const signature = replaySignatureFor(message, -1);
    replayBlocks.unshift({
      type: 'reasoning',
      ...(signature === undefined ? {} : { thinkingSignature: signature }),
    });
  }
  const next = { ...message, content };
  if (replayAligned) {
    next.source = {
      ...message.source,
      replayState: { ...replay, blocks: replayBlocks },
    };
  }
  delete next.reasoning_content;
  delete next.reasoning_details;
  delete next.reasoning;
  return next;
}

function normalizeReasoningChannelMessages(messages, scopeStart = 0) {
  let changed = false;
  const next = messages.map((message, index) => {
    // Cross-boundary (4.3.2): normalize EVERY assistant turn's reasoning channel,
    // including prior-task history before scopeStart. The gateway reads
    // reasoning_content only; pi-ai replays the field name from the block's
    // thinkingSignature. On an interrupt/resume turn the pre-interrupt history
    // falls before the new task boundary — if left un-normalized its signature
    // stays `reasoning`, pi-ai emits a `reasoning` field the gateway drops, and
    // the model loses its prior thinking AS reasoning. It then sees the prior
    // conclusions only as mirrored content speech (external claims), distrusts
    // them ("that was before the interruption", "my earlier sample was wrong"),
    // and re-derives confirmed facts (But/Wait/However/first-person cascade). Forcing
    // the reasoning_content signature on history keeps the prior thinking owned
    // and continuous. Reasoning TEXT is unchanged; only the wire channel signature
    // is normalized, so this is faithful continuation, not a rewrite of old tasks.
    if (message?.role !== 'assistant' || !Array.isArray(message.content)) return message;
    if (reasoningChannelClean(message)) return message;
    const normalized = withSingleReasoningBlock(message, reasoningTextOf(message));
    if (normalized !== message) changed = true;
    return normalized;
  });
  return changed ? next : messages;
}

/**
 * Qoder-style tool-step guidance on the native reasoning channel. The latest
 * tool-call assistant keeps its own plan, then receives the short anchor and,
 * when configured, the full seed before the wire is built. No content, no new
 * message, no tool pair change.
 */
function appendToolStepReasoning(messages, mode = 'off', anchor = TOOL_STEP_ANCHOR, seed = SEED, scopeStart = 0) {
  const normalized = String(mode ?? 'off').toLowerCase();
  if (!['anchor', 'anchor-seed', 'seed-anchor', 'seed'].includes(normalized)) return messages;
  const last = messages[messages.length - 1];
  if (!isToolStep(last) && !isToolStepAfterContexts(messages)) return messages;
  let index = -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.role === 'assistant' && hasToolCalls(message)) {
      index = i;
      break;
    }
  }
  if (index < 0 || index < scopeStart) return messages;
  const message = messages[index];
  let text = reasoningTextOf(message).trim();
  const anchorHead = anchor.slice(0, 48);
  const seedHead = seed.slice(0, 48);
  const addAnchor = () => {
    if (text.includes(anchorHead)) return;
    text = text ? `${text}\n\n${anchor}` : anchor;
  };
  const addSeed = () => {
    if (text.includes(seedHead)) return;
    text = text ? `${text}\n\n${seed}` : seed;
  };
  if (normalized === 'anchor') addAnchor();
  if (normalized === 'seed') addSeed();
  if (normalized === 'anchor-seed') {
    addAnchor();
    addSeed();
  }
  if (normalized === 'seed-anchor') {
    if (!text.includes(seedHead)) text = text ? `${seed}\n\n${text}` : seed;
    addAnchor();
  }
  if (text === reasoningTextOf(message).trim() && reasoningChannelClean(message)) return messages;
  const next = withSingleReasoningBlock(message, text);
  if (next === message) return messages;
  const out = [...messages];
  out[index] = next;
  return out;
}

// Nearest-output guidance lever (config.nearestGuidance). Fills clean guidance
// into the latest assistant(tool_calls) content (only when empty, never over the
// model's own visible speech) and/or appends it to that turn's reasoning_content.
// Field-keyed, idempotent, replayState-aligned; no new message, no tool-pair change.
function applyNearestGuidance(messages, mode = 'off', guidance = NEAREST_GUIDANCE, scopeStart = 0) {
  const normalized = String(mode ?? 'off').toLowerCase();
  if (!['content', 'reasoning', 'both'].includes(normalized)) return messages;
  let index = -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === 'assistant' && hasToolCalls(messages[i])) { index = i; break; }
  }
  if (index < 0 || index < scopeStart) return messages;
  const head = guidance.slice(0, 48);
  let message = messages[index];
  const wantContent = normalized === 'content' || normalized === 'both';
  const wantReasoning = normalized === 'reasoning' || normalized === 'both';
  if (wantContent && textOf(message).trim().length === 0 && !textOf(message).includes(head)) {
    message = insertAssistantBlocks(message, ['text'], guidance);
  }
  if (wantReasoning) {
    const reasoning = reasoningTextOf(message).trim();
    if (!reasoning.includes(head)) {
      message = withSingleReasoningBlock(message, reasoning ? `${reasoning}\n\n${guidance}` : guidance);
    }
  }
  if (message === messages[index]) return messages;
  const out = [...messages];
  out[index] = message;
  return out;
}

// Most recent real assistant thinking (skips synthetic seeds). Empty when the
// latest assistant turn carries no reasoning, so the section is omitted rather
// than fabricated.
function lastAssistantReasoning(messages) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.role === 'assistant' && !isSeed(message)) return reasoningTextOf(message).trim();
  }
  return '';
}

// Current task list from the latest todo_write tool call in history (whole-list
// replacement semantics). The host "todos" projection clears on turn/start, so
// the wire-side call is the stable cross-turn source. Returns null when absent.
function lastTodos(messages) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.role !== 'assistant' || !Array.isArray(message.content)) continue;
    for (const block of message.content) {
      if (block?.type !== 'tool-call') continue;
      const name = block?.name ?? block?.function?.name;
      if (name !== 'todo_write') continue;
      let args = block?.arguments ?? block?.function?.arguments;
      if (typeof args === 'string') { try { args = JSON.parse(args); } catch { args = null; } }
      const todos = args?.todos;
      if (Array.isArray(todos) && todos.length > 0) {
        const clean = todos.filter((t) => typeof t?.content === 'string' && typeof t?.status === 'string');
        if (clean.length > 0) return clean;
      }
    }
  }
  return null;
}

// Full orientation block for the pre-task seed content text block. Sections are
// appended only when their data is present (first turn / post-compaction / no
// todos / no usage yet -> omitted, never invented). todosOverride is the host
// projection's current list when available; otherwise fall back to the latest
// todo_write call in history (covers turn/start when the projection clears).
function buildOrientationSeedBlock(messages, mode, usage, todosOverride) {
  // Current-state material goes first, then the labeled seed, then previous
  // thinking. Seed stays before pre; only todo/usage move ahead of the seed.
  let prefix = '';
  if (mode === 'full') {
    const todos = (Array.isArray(todosOverride) && todosOverride.length > 0) ? todosOverride : lastTodos(messages);
    if (todos) prefix += `${ORIENTATION_TASKS_HEAD}\n${todos.map((t) => `- [${t.status}] ${t.content}`).join('\n')}\n\n`;
    const pressure = usage?.pressureTokens;
    const window = usage?.contextWindow;
    if (Number.isFinite(pressure) && Number.isFinite(window) && window > 0) {
      prefix += `Need keep context budget in view: previous request input ≈ ${Math.round(pressure)} tokens of ${Math.round(window)} window (provider-measured).\n\n`;
    }
  }
  let block = `${prefix}${ORIENTATION_LABEL}\n${SEED}`;
  if (mode === 'full') {
    const previous = lastAssistantReasoning(messages);
    if (previous) block += `\n\n${ORIENTATION_PREVIOUS_HEAD}\n${previous}`;
  }
  block += `\n\n${ORIENTATION_CONTINUE}`;
  return block;
}

// Head used by contentFill for the latest tool turn when orientation is on; the
// turn's own reasoning is appended after it (as in the off path), so the example
// label replaces the bare seed+continue-work without duplicating reasoning.
function orientationFillHead() {
  return `${ORIENTATION_LABEL}\n${SEED}\n\n${ORIENTATION_CONTINUE}`;
}

// General content-fill (config.contentFill = 'seed-continue-reasoning'). Fills
// EMPTY assistant content so the visible history keeps the WeNeed voice on
// user-task, interrupt/resume, and tool-step requests alike. The latest
// assistant(tool_calls) turn WITHIN the current task scope receives seed +
// continue-work + its own reasoning; EVERY other empty assistant turn — including
// prior-task history before the boundary (4.3.1 cross-boundary mirror) — receives
// its own reasoning mirrored into content. Existing visible speech is never
// overwritten; replayState stays aligned via insertAssistantBlocks; the
// empty-content guard makes it idempotent.
function fillAssistantContent(messages, mode = 'off', scopeStart = 0, orientMode = 'off') {
  if (String(mode ?? 'off').toLowerCase() !== 'seed-continue-reasoning' || !Array.isArray(messages)) return messages;
  const orientation = orientationMode(orientMode);
  // The seed+continue anchor targets the latest tool-call turn WITHIN the current
  // task scope (index >= scopeStart). The reasoning-mirror branch deliberately
  // crosses the task boundary: EVERY empty assistant content turn — including
  // prior-task history before scopeStart — gets its OWN reasoning mirrored into
  // content. On an interrupt/resume turn the new correction is the task boundary,
  // so without this the prior WeNeed history would stay empty-content and the
  // model would re-open in requester-wants / first-person register. Mirroring a
  // turn's own reasoning into its own empty content is faithful continuation, not
  // a rewrite of older tasks (reasoning text and semantics are unchanged).
  let latest = -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (i >= scopeStart && messages[i]?.role === 'assistant' && hasToolCalls(messages[i])) { latest = i; break; }
  }
  let changed = false;
  const next = messages.map((message, index) => {
    if (message?.role !== 'assistant') return message;
    if (textOf(message).trim().length > 0) return message;
    const reasoning = reasoningTextOf(message).trim();
    let fill;
    if (index === latest) {
      const head = orientation === 'off' ? `${SEED}\n\n${CONTINUE_WORK}` : orientationFillHead();
      fill = reasoning ? `${head}\n\n${reasoning}` : head;
    } else {
      if (!reasoning) return message;
      fill = reasoning;
    }
    const filled = insertAssistantBlocks(message, ['text'], fill);
    if (filled !== message) changed = true;
    return filled;
  });
  return changed ? next : messages;
}

// Team outgoing register lever (config.teamRegisterHint). Appends a soft register
// instruction to the description of tools whose payload is direct speech/task sent
// to another agent. Field-keyed (description), append-only, idempotent; never
// changes tool name/params/structure.
function appendTeamRegisterHint(tools, enabled = false) {
  if (!enabled || !Array.isArray(tools)) return tools;
  const head = TEAM_REGISTER_HINT.slice(0, 48);
  let changed = false;
  const next = tools.map((tool) => {
    const fn = tool?.function || tool;
    const name = fn?.name ?? tool?.name;
    if (!TEAM_HINT_TOOLS.has(name)) return tool;
    const description = typeof fn?.description === 'string' ? fn.description : '';
    if (description.includes(head)) return tool;
    const newDescription = description ? `${description}\n\n${TEAM_REGISTER_HINT}` : TEAM_REGISTER_HINT;
    changed = true;
    if (tool.function) return { ...tool, function: { ...fn, description: newDescription } };
    return { ...tool, description: newDescription };
  });
  return changed ? next : tools;
}

// Persistent tool-description guidance lever (config.toolDescriptionSeed).
// mode all = append guidance to every tool description; off = no-op. Field-keyed
// (description), append-only, idempotent; never changes name/params/structure.
function appendToolDescriptionSeed(tools, mode = 'off', text = TOOL_DESC_GUIDANCE) {
  if (String(mode ?? 'off').toLowerCase() !== 'all' || !Array.isArray(tools)) return tools;
  const head = text.slice(0, 48);
  let changed = false;
  const next = tools.map((tool) => {
    const fn = tool?.function || tool;
    const description = typeof fn?.description === 'string' ? fn.description : '';
    if (description.includes(head)) return tool;
    const newDescription = description ? `${description}\n\n${text}` : text;
    changed = true;
    if (tool.function) return { ...tool, function: { ...fn, description: newDescription } };
    return { ...tool, description: newDescription };
  });
  return changed ? next : tools;
}

// Tool-result seed lever (config.toolResultSeed). Appends clean seed text to the
// content of role:tool results — the material nearest to the model's next
// reasoning. mode latest = only the last tool result; all = every tool result.
// Append-only, idempotent; never touches toolCallId or assistant tool-call turns.
// KNOWN RISK: writing role:tool content broke WeNeed when raw hints were used;
// clean seed is an opt-in experiment, default off.
function appendToolResultSeed(messages, mode = 'off', text = SEED, scopeStart = 0) {
  const normalized = String(mode ?? 'off').toLowerCase();
  if (!['latest', 'all'].includes(normalized)) return messages;
  const toolIndices = [];
  for (let i = 0; i < messages.length; i += 1) {
    if (messages[i]?.role === 'tool') toolIndices.push(i);
  }
  if (toolIndices.length === 0) return messages;
  const targets = normalized === 'latest' ? [toolIndices[toolIndices.length - 1]] : toolIndices;
  const head = text.slice(0, 48);
  let changed = false;
  const out = [...messages];
  for (const index of targets) {
    if (index < scopeStart) continue;
    const message = out[index];
    if (textOf(message).includes(head)) continue;
    const addition = `\n\n${text}`;
    const content = Array.isArray(message.content)
      ? [...message.content, { type: 'text', text: addition }]
      : `${textOf(message)}${addition}`;
    out[index] = { ...message, content };
    changed = true;
  }
  return changed ? out : messages;
}

function hasSeedAfter(messages, startIndex) {
  for (let i = startIndex; i < messages.length; i += 1) {
    const message = messages[i];
    if (message?.role !== 'assistant') continue;
    if (`${textOf(message)}\n${reasoningTextOf(message)}`.includes(SEED_HEAD)) return true;
  }
  return false;
}

/**
 * After a compaction checkpoint with no newer user task, there is no normal
 * seed injection point. Re-anchor the latest assistant tool-call with the
 * original seed. Default channel is reasoning_content (DSH content contract).
 */
function anchorAfterCompaction(messages, mode = 'off', seed = SEED, scopeStart = 0) {
  const normalized = String(mode ?? 'off').toLowerCase();
  if (!['reasoning', 'content', 'both'].includes(normalized)) return messages;
  const checkpoint = lastCompactionIndex(messages);
  const task = lastRealUserIndex(messages);
  if (checkpoint < 0 || checkpoint < task) return messages;
  if (hasSeedAfter(messages, checkpoint + 1)) return messages;
  let index = -1;
  for (let i = messages.length - 1; i > checkpoint; i -= 1) {
    const message = messages[i];
    if (message?.role === 'assistant' && hasToolCalls(message)) {
      index = i;
      break;
    }
  }
  if (index < 0 || index < scopeStart) return messages;
  const types = normalized === 'both'
    ? ['text', 'reasoning']
    : [normalized === 'content' ? 'text' : 'reasoning'];
  const next = [...messages];
  next[index] = insertAssistantBlocks(messages[index], types, seed);
  return next;
}

/**
 * A request that is neither a new user task nor a tool step can still carry a
 * compaction checkpoint. If the checkpoint is followed by a tool-call assistant,
 * anchorAfterCompaction() has a safe landing point; otherwise it no-ops.
 */
function shouldAnchorAfterCompaction(reason, messages) {
  if (reason === 'tool-step') return true;
  return reason === 'no-user-task' && lastCompactionIndex(messages) >= 0;
}

function isSeed(message) {
  if (message?.role !== 'assistant' || hasToolCalls(message)) return false;
  const text = textOf(message).trim();
  const reasoning = reasoningTextOf(message).trim();
  return text === SEED || reasoning === SEED;
}

function lastRealUserIndex(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (isTaskUser(messages[i])) return i;
  }
  return -1;
}

function lastCompactionIndex(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (isCompaction(messages[i])) return i;
  }
  return -1;
}

/**
 * Current-task boundary for request-local rewrites. A new task starts after the
 * last real user task; after compaction, never cross the checkpoint. This keeps
 * mirror/anchor from rewriting assistant turns that belong to older tasks.
 */
function taskScopeStart(messages) {
  return Math.max(lastRealUserIndex(messages), lastCompactionIndex(messages)) + 1;
}

function lastNonContextIndex(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message?.role === 'user'
      && (isContextUser(message) || isCompaction(message))) continue;
    return i;
  }
  return -1;
}

function isToolStepAfterContexts(messages) {
  const index = lastNonContextIndex(messages);
  if (index < 0) return false;
  const message = messages[index];
  if (isToolStep(message)) return true;
  if (!isImageUser(message)) return false;
  for (let i = index - 1; i >= 0; i--) {
    const previous = messages[i];
    if (previous?.role === 'user'
      && (isContextUser(previous) || isCompaction(previous))) continue;
    if (isToolStep(previous)) return true;
    if (previous?.role === 'assistant' && !hasToolCalls(previous)
      && /processed the tool results?/i.test(textOf(previous))) continue;
    return false;
  }
  return false;
}

/**
 * DSH appends runtime/skill/time contexts after the task on tool steps, the
 * reverse of the seeded first request. Moves only contexts that appeared after
 * the current task back in front of it, without crossing a compaction
 * checkpoint or touching older turns.
 */
function orderContextsBeforeTask(messages) {
  const taskIndex = lastRealUserIndex(messages);
  if (taskIndex < 0) return messages;
  if (lastCompactionIndex(messages) > taskIndex) return messages;
  const after = messages.slice(taskIndex + 1);
  if (!after.some(isContextUser)) return messages;
  const contexts = after.filter(isContextUser);
  const rest = after.filter((message) => !isContextUser(message));
  return [...messages.slice(0, taskIndex), ...contexts, messages[taskIndex], ...rest];
}

function isTarget(modelId, modelName, target, rules = DEFAULT_TARGET_RULES, matchName = false) {
  if (target === false) return false;
  const text = `${modelId ?? ''}${matchName ? ` ${modelName ?? ''}` : ''}`.toLowerCase();
  const groups = Array.isArray(rules) && rules.length > 0 ? rules : DEFAULT_TARGET_RULES;
  return groups.some((terms) => Array.isArray(terms)
    && terms.length > 0
    && terms.every((term) => text.includes(String(term ?? '').toLowerCase())));
}

function flattenUserContent(message) {
  const content = message?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts = [];
  for (const block of content) {
    if (typeof block?.text === 'string') parts.push(block.text);
    else if (block?.type === 'image' || block?.type === 'image_url' || block?.type === 'input_image') {
      parts.push('[image]');
    }
  }
  return parts.join('');
}

function wireToolCall(block) {
  let args = block?.arguments;
  if (typeof args !== 'string') args = JSON.stringify(args ?? {});
  return {
    id: String(block?.id ?? ''),
    type: 'function',
    function: {
      name: String(block?.name ?? ''),
      arguments: args,
    },
  };
}

function sanitizeProgramText(text) {
  if (typeof text !== 'string' || text.length === 0) return text;
  let out = text;
  for (const [pattern, replacement] of PROGRAM_REPLACEMENTS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

function sanitizeProgramMessage(message) {
  if (message?.role !== 'system' && message?.role !== 'developer') return message;
  const content = message.content;
  if (typeof content === 'string') {
    const text = sanitizeProgramText(content);
    return text === content ? message : { ...message, content: text };
  }
  if (!Array.isArray(content)) return message;
  let changed = false;
  const next = content.map((block) => {
    if (typeof block?.text !== 'string') return block;
    const text = sanitizeProgramText(block.text);
    if (text === block.text) return block;
    changed = true;
    return { ...block, text };
  });
  return changed ? { ...message, content: next } : message;
}

function sanitizeProgramMessages(messages) {
  if (!Array.isArray(messages)) return messages;
  let changed = false;
  const next = messages.map((message) => {
    const result = sanitizeProgramMessage(message);
    if (result !== message) changed = true;
    return result;
  });
  return changed ? next : messages;
}

function sanitizeSchemaText(node) {
  if (Array.isArray(node)) {
    let changed = false;
    const next = node.map((item) => {
      const result = sanitizeSchemaText(item);
      if (result !== item) changed = true;
      return result;
    });
    return changed ? next : node;
  }
  if (!node || typeof node !== 'object') return node;
  let changed = false;
  const next = {};
  for (const [key, value] of Object.entries(node)) {
    if (typeof value === 'string' && (key === 'description' || key === 'title' || key === 'summary')) {
      const text = sanitizeProgramText(value);
      if (text !== value) changed = true;
      next[key] = text;
    } else if (value && typeof value === 'object') {
      const result = sanitizeSchemaText(value);
      if (result !== value) changed = true;
      next[key] = result;
    } else {
      next[key] = value;
    }
  }
  return changed ? next : node;
}

function sanitizeToolDefinition(tool) {
  if (!tool || typeof tool !== 'object') return tool;
  const description = sanitizeProgramText(tool.description);
  const parameters = sanitizeSchemaText(tool.parameters);
  if (description === tool.description && parameters === tool.parameters) return tool;
  return { ...tool, description, parameters };
}

function sanitizeToolDefinitions(tools) {
  if (!Array.isArray(tools)) return tools;
  let changed = false;
  const next = tools.map((tool) => {
    const result = sanitizeToolDefinition(tool);
    if (result !== tool) changed = true;
    return result;
  });
  return changed ? next : tools;
}

// Legacy opt-in cleanup. DSH accepts non-empty tool-call assistant content; by
// default the plugin preserves text that was already present or appended by a
// tool-step anchor. Set stripToolCallContent: true only for an A/B cleanup run.
function stripToolCallAssistantContent(messages) {
  if (!Array.isArray(messages)) return messages;
  let changed = false;
  const next = messages.map((message) => {
    if (message?.role !== 'assistant' || !Array.isArray(message.content)) return message;
    if (!message.content.some((block) => block?.type === 'tool-call')) return message;
    const content = message.content.filter((block) => block?.type !== 'text');
    if (content.length === message.content.length) return message;
    changed = true;
    const nextMessage = { ...message, content };
    const replay = message.source?.replayState;
    if (Array.isArray(replay?.blocks) && replay.blocks.length === message.content.length) {
      const blocks = [];
      for (let index = 0; index < message.content.length; index += 1) {
        if (message.content[index]?.type !== 'text') blocks.push(replay.blocks[index]);
      }
      nextMessage.source = {
        ...message.source,
        replayState: { ...replay, blocks },
      };
    }
    return nextMessage;
  });
  return changed ? next : messages;
}

function wireMessage(message, mirror = true, mirrorToolSteps = false) {
  if (message?.role === 'system' || message?.role === 'developer') {
    const content = textOf(message);
    return content.length === 0 ? null : { role: 'system', content };
  }
  if (message?.role === 'user') {
    return { role: 'user', content: flattenUserContent(message) };
  }
  if (message?.role === 'assistant') {
    const text = textOf(message);
    const reasoning = reasoningTextOf(message);
    const toolCalls = Array.isArray(message.content)
      ? message.content.filter((block) => block?.type === 'tool-call').map(wireToolCall)
      : [];
    if (toolCalls.length > 0) {
      const mirroredText = mirror && mirrorToolSteps
        ? (text.trim().length > 0 ? text : reasoning)
        : text;
      return {
        role: 'assistant',
        content: mirroredText,
        reasoning_content: reasoning,
        tool_calls: toolCalls,
      };
    }
    const mirroredText = mirror && text.trim().length === 0 && reasoning.trim().length > 0
      ? reasoning
      : text;
    return { role: 'assistant', content: mirroredText, reasoning_content: reasoning };
  }
  if (message?.role === 'tool') {
    return {
      role: 'tool',
      content: textOf(message),
      tool_call_id: String(message.toolCallId ?? message.tool_call_id ?? ''),
    };
  }
  return null;
}

function filterSkillCatalog(messages) {
  let changed = false;
  const next = messages.map((message) => {
    if (message?.role !== 'user') return message;
    const text = textOf(message);
    if (!text.includes('<available_skills>')) return message;
    let out = text;
    for (const name of ['we need', 'we-need', 'we-need-persistent', LEGACY_SKILL_NAME]) {
      const prefix = `- \`${name}\`:`; 
      out = out.split(/\r?\n/).filter((line) => !line.startsWith(prefix)).join('\n');
    }
    if (out === text) return message;
    changed = true;
    return { ...message, content: [{ type: 'text', text: out }] };
  });
  return changed ? next : messages;
}

function seedMessage(provider, model, contentText = SEED) {
  return {
    id: `weneed-seed-${randomUUID()}`,
    role: 'assistant',
    content: [
      { type: 'text', text: contentText },
      { type: 'reasoning', text: SEED },
    ],
    source: {
      kind: 'model',
      provider,
      model,
      // pi-ai only serializes a reasoning block as reasoning_content when the
      // block carries this signature. The custom adapter ignores replayState.
      replayState: {
        response: {
          kind: 'pi-ai',
          version: 2,
          api: 'openai-completions',
          provider,
          model,
          stopReason: 'stop',
        },
        blocks: [
          { type: 'text' },
          { type: 'reasoning', thinkingSignature: 'reasoning_content' },
        ],
      },
    },
  };
}

function injectSeed(messages, options, modelConfig, targetRules = DEFAULT_TARGET_RULES, matchName = false, compactionRegister = 'we-need', toolStepReseed = false, flags = {}) {
  const seedEnabled = flags.seedEnabled !== false;
  const reorderEnabled = flags.reorderEnabled !== false;
  const cleaned = messages.filter((message) => !isSeed(message));
  const orientMode = orientationMode(flags.orientation?.mode);
  const orientUsage = flags.orientation?.usage;
  const orientTodos = flags.orientation?.todos;
  const seedContentFor = (msgs) => (orientMode === 'off' ? SEED : buildOrientationSeedBlock(msgs, orientMode, orientUsage, orientTodos));
  // purpose:'compaction' is the authoritative host signal; text sniff is fallback.
  if (options.purpose === 'compaction' || isCompactionRequest(cleaned)) {
    return {
      messages: appendCompactionRegister(cleaned, compactionRegister, options.purpose === 'compaction'),
      injected: false,
      reason: 'compaction-request',
    };
  }
  if (isToolStep(cleaned[cleaned.length - 1]) || isToolStepAfterContexts(cleaned)) {
    const ordered = reorderEnabled ? orderContextsBeforeTask(cleaned) : cleaned;
    // The seed is synthetic and DSH does not persist it in history; stripping it
    // above leaves tool steps with no WeNeed anchor, so the model loses the
    // thread and re-states the task. Reseed keeps the anchor adjacent to the
    // task on every tool step, matching the first-turn injection.
    if (toolStepReseed && seedEnabled) {
      const toolTaskIndex = lastRealUserIndex(ordered);
      if (toolTaskIndex >= 0 && isTarget(options.model, modelConfig?.name, modelConfig?.target, targetRules, matchName)) {
        const task = ordered[toolTaskIndex];
        const after = ordered.slice(toolTaskIndex + 1);
        const contexts = after.filter(isContextUser);
        const rest = after.filter((message) => !isContextUser(message));
        return {
          messages: [
            ...ordered.slice(0, toolTaskIndex),
            ...contexts,
            seedMessage(options.provider, options.model, seedContentFor(ordered)),
            task,
            ...rest,
          ],
          injected: true,
          reason: 'tool-step',
          taskIndex: toolTaskIndex,
        };
      }
    }
    return { messages: ordered, injected: false, reason: 'tool-step' };
  }
  if (options.purpose !== undefined) {
    return { messages: cleaned, injected: false, reason: 'auxiliary' };
  }
  if (Number(options.maxTokens) > 0 && Number(options.maxTokens) <= 8192 && cleaned.length <= 4) {
    return { messages: cleaned, injected: false, reason: 'title-or-suggestion' };
  }
  const taskIndex = lastRealUserIndex(cleaned);
  if (taskIndex < 0) return { messages: cleaned, injected: false, reason: 'no-user-task' };
  if (!isTarget(options.model, modelConfig?.name, modelConfig?.target, targetRules, matchName)) {
    return { messages: cleaned, injected: false, reason: 'not-target' };
  }
  const task = cleaned[taskIndex];
  const after = cleaned.slice(taskIndex + 1);
  const contexts = reorderEnabled ? after.filter(isContextUser) : [];
  const rest = reorderEnabled ? after.filter((message) => !isContextUser(message)) : after;
  const seedBlocks = seedEnabled ? [seedMessage(options.provider, options.model, seedContentFor(cleaned))] : [];
  return {
    messages: [
      ...cleaned.slice(0, taskIndex),
      ...contexts,
      ...seedBlocks,
      task,
      ...rest,
    ],
    injected: seedEnabled,
    reason: 'user-task',
    taskIndex,
  };
}

function appendTaskPolicy(messages, enabled = false) {
  if (!enabled) return messages;
  const index = lastRealUserIndex(messages);
  if (index < 0) return messages;
  const message = messages[index];
  if (!message || message.role !== 'user') return messages;
  if (textOf(message).includes(TASK_POLICY_HEAD)) return messages;
  const original = Array.isArray(message.content)
    ? message.content
    : [{ type: 'text', text: String(message.content ?? '') }];
  const next = [...messages];
  next[index] = {
    ...message,
    content: [...original, { type: 'text', text: `\n\n${TASK_POLICY}` }],
  };
  return next;
}

function mapUsage(usage) {
  if (!usage || typeof usage !== 'object') return undefined;
  const cached = usage.prompt_tokens_details?.cached_tokens;
  return {
    inputTokens: Number(usage.prompt_tokens ?? 0),
    outputTokens: Number(usage.completion_tokens ?? 0),
    ...(usage.total_tokens === undefined ? {} : { totalTokens: Number(usage.total_tokens) }),
    ...(Number(cached) > 0 ? { cacheReadTokens: Number(cached) } : {}),
  };
}

function finishReason(raw, sawContent) {
  switch (raw) {
    case 'tool_calls':
    case 'function_call': return { kind: 'tool-calls' };
    case 'length': return { kind: 'max-tokens' };
    case 'stop':
    case null:
    case undefined: return sawContent ? { kind: 'stop' } : { kind: 'stop' };
    default: return { kind: 'stop' };
  }
}

async function* parseSseData(response) {
  if (!response.body?.getReader) throw new Error('weneed-native: upstream response has no body');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        let line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (line.endsWith('\r')) line = line.slice(0, -1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trimStart();
        if (data.length > 0) yield data;
      }
    }
    buffer += decoder.decode();
    if (buffer.startsWith('data:')) {
      const data = buffer.slice(5).trim();
      if (data.length > 0) yield data;
    }
  } finally {
    reader.releaseLock?.();
  }
}

class WeNeedNativeAdapter {
  constructor(config, services = {}) {
    this.config = config;
    this.resolveKey = services.resolveKey;
    this.provider = config.provider || 'weneed-native';
    this.models = Array.isArray(config.models) ? config.models : [];
    this.modelMap = new Map(this.models.map((model) => [String(model.id), model]));
    this.interceptModels = Array.isArray(config.interceptModels) ? config.interceptModels : [];
    this.interceptMap = new Map(this.interceptModels.map((model) => [`${model.provider}/${model.id}`, model]));
  }

  configFor(provider, model) {
    const route = this.interceptMap.get(`${provider}/${model}`);
    if (route !== undefined) return route;
    if (provider === this.provider) return this.modelMap.get(String(model));
    return undefined;
  }

  providerInfo(provider) {
    return { id: provider, name: this.config.displayName || provider };
  }

  providerRetryPolicy() {
    return undefined;
  }

  async listModels(provider) {
    return this.models.map((model) => ({
      provider,
      id: String(model.id),
      name: String(model.name || model.id),
      inputModalities: ['text'],
    }));
  }

  async resolveModel(provider, model) {
    const config = this.modelMap.get(String(model)) ?? {};
    const efforts = Array.isArray(this.config.reasoningEfforts)
      ? this.config.reasoningEfforts
      : [
        { id: 'off', name: 'Off' },
        { id: 'low', name: 'Low' },
        { id: 'medium', name: 'Medium' },
        { id: 'high', name: 'High' },
        { id: 'max', name: 'Max' },
      ];
    return {
      provider,
      id: String(model),
      name: String(config.name || model),
      inputModalities: ['text'],
      context: { contextWindow: Number(config.contextWindow ?? 1000000) },
      ...(config.maxTokens === undefined ? {} : { defaultMaxTokens: Number(config.maxTokens) }),
      reasoning: {
        efforts,
        ...(this.config.defaultEffort === undefined ? {} : { defaultEffort: this.config.defaultEffort }),
      },
    };
  }

  async prepareCall(provider, model) {
    return {
      model: await this.resolveModel(provider, model),
      stream: (options) => this.stream(options),
    };
  }

  async *stream(options) {
    const modelConfig = this.configFor(options.provider, options.model) ?? {};
    const filtered = filterSkillCatalog(options.messages ?? []);
    const { messages, reason } = injectSeed(filtered, options, modelConfig, this.config.targetRules, this.config.matchName === true, this.config.compactionRegister, this.config.toolStepReseed === true, { seedEnabled: this.config.seedInjection !== false, reorderEnabled: this.config.reorderContexts !== false, orientation: { mode: orientationMode(this.config.seedOrientation), usage: undefined } });
    const policyEligible = reason === 'user-task'
      || (reason === 'tool-step'
        && lastCompactionIndex(messages) < lastRealUserIndex(messages));
    const tasked = policyEligible
      ? appendTaskPolicy(messages, this.config.taskPolicy === true)
      : messages;
    const scopeStart = this.config.mirrorScope === 'all' ? 0 : taskScopeStart(tasked);
    const mirrored = mirrorMessages(
      tasked,
      this.config.mirror !== false,
      this.config.mirrorToolSteps === true,
      scopeStart,
    );
    const compacted = shouldAnchorAfterCompaction(reason, mirrored)
      ? anchorAfterCompaction(mirrored, this.config.postCompactionSeed, SEED, scopeStart)
      : mirrored;
    const channelMessages = normalizeReasoningChannelMessages(compacted, scopeStart);
    const reasoned = reason === 'tool-step'
      ? appendToolStepReasoning(channelMessages, this.config.toolStepReasoning, TOOL_STEP_ANCHOR, SEED, scopeStart)
      : channelMessages;
    const anchored = reason === 'tool-step' && reasoned === compacted
      ? anchorEmptyToolPlan(reasoned, this.config.toolStepAnchor, TOOL_STEP_ANCHOR, scopeStart)
      : reasoned;
    const mirror = this.config.mirror !== false;
    const mirrorToolSteps = this.config.mirrorToolSteps === true;
    const stripToolCallContent = this.config.stripToolCallContent === true;
    const contentSafe = stripToolCallContent ? stripToolCallAssistantContent(anchored) : anchored;
    const sanitizeEnabled = this.config.sanitizeProgram !== false;
    const sanitizedMessages = sanitizeEnabled ? sanitizeProgramMessages(contentSafe) : contentSafe;
    const contentFilledMessages = fillAssistantContent(sanitizedMessages, this.config.contentFill, scopeStart, orientationMode(this.config.seedOrientation));
    const guidedMessages = applyNearestGuidance(contentFilledMessages, this.config.nearestGuidance, NEAREST_GUIDANCE, scopeStart);
    const seededToolMessages = appendToolResultSeed(guidedMessages, this.config.toolResultSeed, SEED, scopeStart);
    const registeredMessages = appendSystemRegister(
      seededToolMessages,
      this.config.systemRegister === true && reason !== 'compaction-request' && reason !== 'title-or-suggestion',
    );
    const wire = registeredMessages
      .map((message) => wireMessage(message, mirror, mirrorToolSteps))
      .filter(Boolean);
    const baseTools = Array.isArray(options.tools) ? options.tools : [];
    const sanitizedTools = sanitizeEnabled ? sanitizeToolDefinitions(baseTools) : baseTools;
    const tools = appendToolDescriptionSeed(appendTeamRegisterHint(sanitizedTools, this.config.teamRegisterHint === true), this.config.toolDescriptionSeed, this.config.toolDescriptionSeedText || TOOL_DESC_GUIDANCE);
    const body = {
      model: options.model,
      messages: wire,
      stream: true,
      ...(tools.length === 0 ? {} : {
        tools: tools.map((tool) => ({
          type: 'function',
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
          },
        })),
        tool_choice: this.config.toolChoice || 'auto',
        parallel_tool_calls: this.config.parallelToolCalls !== false,
      }),
      ...(options.maxTokens === undefined ? {} : { max_tokens: Number(options.maxTokens) }),
      ...(options.temperature === undefined ? {} : { temperature: Number(options.temperature) }),
      ...(options.reasoningEffort === undefined ? {} : { reasoning_effort: String(options.reasoningEffort) }),
      ...(modelConfig?.streamOptions === false || this.config.streamOptions === false
        ? {}
        : { stream_options: { include_usage: true } }),
    };

    const base = String(modelConfig?.baseURL || this.config.baseURL || 'http://127.0.0.1:8791/v1').replace(/\/+$/, '');
    const url = base.endsWith('/chat/completions') ? base : `${base}/chat/completions`;
    const envName = modelConfig?.apiKeyEnv ?? this.config.apiKeyEnv;
    let key = modelConfig?.apiKey;
    if (!key && envName !== undefined) {
      key = (await this.resolveKey?.(envName)) ?? process.env[envName];
    }
    if (!key && envName === undefined) key = this.config.apiKey;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'text/event-stream',
        ...(typeof key === 'string' && key.length > 0 ? { authorization: `Bearer ${key}` } : {}),
        ...(this.config.headers ?? {}),
      },
      body: JSON.stringify(body),
      signal: options.signal,
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`weneed-native upstream HTTP ${response.status}: ${detail.slice(0, 500)}`);
    }

    let text = '';
    let reasoning = '';
    let textIndex = -1;
    let reasoningIndex = -1;
    let nextToolIndex = 0;
    let textStarted = false;
    let reasoningStarted = false;
    const toolStates = new Map();
    let sawContent = false;
    let terminal = null;
    let usage;

    for await (const data of parseSseData(response)) {
      if (data === '[DONE]') break;
      let chunk;
      try {
        chunk = JSON.parse(data);
      } catch {
        continue;
      }
      if (chunk?.usage) usage = chunk.usage;
      const choice = Array.isArray(chunk?.choices) ? chunk.choices[0] : undefined;
      const delta = choice?.delta ?? {};
      const content = typeof delta.content === 'string' ? delta.content : '';
      const detailThinking = Array.isArray(delta.reasoning_details)
        ? delta.reasoning_details.map((detail) => detail?.text || detail?.summary || '').join('')
        : '';
      const thinking = typeof delta.reasoning_content === 'string'
        ? delta.reasoning_content
        : (typeof delta.reasoning === 'string'
          ? delta.reasoning
          : (typeof chunk?.reasoning_content === 'string' ? chunk.reasoning_content : detailThinking));
      if (content.length > 0) {
        if (!textStarted) {
          textIndex = nextToolIndex++;
          textStarted = true;
          yield { type: 'block-start', index: textIndex, blockType: 'text' };
        }
        text += content;
        sawContent = true;
        yield { type: 'text-delta', index: textIndex, text: content };
      }
      if (thinking.length > 0) {
        if (!reasoningStarted) {
          reasoningIndex = nextToolIndex++;
          reasoningStarted = true;
          yield { type: 'block-start', index: reasoningIndex, blockType: 'reasoning' };
        }
        reasoning += thinking;
        sawContent = true;
        yield { type: 'reasoning-delta', index: reasoningIndex, text: thinking };
      }
      const calls = Array.isArray(delta.tool_calls) ? delta.tool_calls : [];
      for (const call of calls) {
        const key = Number.isSafeInteger(call?.index) ? call.index : toolStates.size;
        let state = toolStates.get(key);
        if (state === undefined) {
          state = {
            index: nextToolIndex++,
            id: String(call?.id ?? ''),
            name: String(call?.function?.name ?? ''),
            arguments: '',
            started: false,
          };
          toolStates.set(key, state);
        }
        if (typeof call?.id === 'string' && call.id.length > 0) state.id = call.id;
        if (typeof call?.function?.name === 'string' && call.function.name.length > 0) state.name = call.function.name;
        const argumentsDelta = typeof call?.function?.arguments === 'string' ? call.function.arguments : '';
        state.arguments += argumentsDelta;
        if (!state.started) {
          state.started = true;
          yield { type: 'block-start', index: state.index, blockType: 'tool-call' };
        }
        sawContent = true;
        yield {
          type: 'tool-call-delta',
          index: state.index,
          id: state.id,
          ...(state.name.length > 0 ? { name: state.name } : {}),
          argumentsDelta,
        };
      }
      if (typeof choice?.finish_reason === 'string') terminal = choice.finish_reason;
    }

    if (textStarted) yield { type: 'block-end', index: textIndex, block: { type: 'text', text } };
    if (reasoningStarted) yield { type: 'block-end', index: reasoningIndex, block: { type: 'reasoning', text: reasoning } };
    for (const state of toolStates.values()) {
      yield {
        type: 'block-end',
        index: state.index,
        block: {
          type: 'tool-call',
          id: state.id,
          name: state.name,
          arguments: state.arguments.length > 0 ? state.arguments : '{}',
        },
      };
    }
    const mappedUsage = mapUsage(usage);
    if (mappedUsage !== undefined) yield { type: 'usage', usage: mappedUsage };
    yield { type: 'finish', reason: finishReason(terminal, sawContent) };
  }

}

export const name = 'dsh-we-need-plugin';
export const inject = ['llm'];
export { injectSeed, isCompactionRequest, isTarget, DEFAULT_TARGET_RULES, WeNeedNativeAdapter, mirrorMessages, mirrorAssistantMessage, wireMessage, stripToolCallAssistantContent, anchorEmptyToolPlan, anchorAfterCompaction, shouldAnchorAfterCompaction, hasSeedAfter, reasoningTextOf, normalizeReasoningChannelMessages, appendToolStepReasoning, appendTaskPolicy, orderContextsBeforeTask, sanitizeProgramText, sanitizeProgramMessages, sanitizeToolDefinition, sanitizeToolDefinitions, TASK_POLICY, TOOL_STEP_ANCHOR, taskScopeStart, lastCompactionIndex, applyNearestGuidance, fillAssistantContent, appendTeamRegisterHint, appendToolResultSeed, appendToolDescriptionSeed, appendSystemRegister, NEAREST_GUIDANCE, CONTINUE_WORK, TEAM_REGISTER_HINT, TOOL_DESC_GUIDANCE, SYSTEM_REGISTER, SYSTEM_REGISTER_HEAD, COMPACTION_REGISTER, COMPACTION_REGISTER_HEAD, SEED, buildOrientationSeedBlock, orientationFillHead, lastTodos, lastAssistantReasoning, orientationMode, ORIENTATION_LABEL, ORIENTATION_CONTINUE, ORIENTATION_PREVIOUS_HEAD, ORIENTATION_TASKS_HEAD };

export function apply(ctx, config = {}) {
  if (config.debugTap === true) { try { installDebugTap(); } catch {} }
  const adapter = new WeNeedNativeAdapter(config, {
    resolveKey: async (ref) => {
      try {
        const credentials = ctx.get?.('credentials');
        const hit = await credentials?.resolve?.(ref);
        if (typeof hit?.value === 'string') return hit.value;
      } catch {
        // fall through to the launch environment
      }
      return process.env[ref];
    },
  });
  if (typeof config.provider === 'string' && config.provider.length > 0) {
    ctx.llm.registerAdapter([adapter.provider], adapter);
  }
  if (config.intercept !== false) {
    ctx.on('llm/stream', async function* (options, next) {
      if (options.__weneedBypass === true) {
        yield* next();
        return;
      }
      // DSH marks compaction summarization calls with purpose='compaction'; the
      // auxiliary bypass must not swallow them, or the style register is lost.
      const compactionRequest = options.purpose === 'compaction' || isCompactionRequest(options.messages ?? []);
      if (options.provider === adapter.provider
        || (options.purpose !== undefined && !compactionRequest)) {
        yield* next();
        return;
      }
      const modelConfig = adapter.configFor(options.provider, options.model);
      const modelName = modelConfig?.name ?? '';
      if (!isTarget(options.model, modelName, modelConfig?.target, config.targetRules, config.matchName === true)) {
        yield* next();
        return;
      }
      if (modelConfig !== undefined) {
        yield* adapter.stream(options);
        return;
      }
      const filtered = filterSkillCatalog(options.messages ?? []);
      const filterChanged = filtered !== (options.messages ?? []);
      const orientMode = orientationMode(config.seedOrientation);
      let orientUsage;
      let orientTodos;
      let orientTodosSource;
      if (orientMode === 'full') {
        try {
          const agents = ctx.get?.('agents') ?? ctx.agents;
          const session = options.sessionId !== undefined ? agents?.get?.(options.sessionId)?.session : undefined;
          if (session) {
            const meter = ctx.get?.('tokenMeter') ?? ctx.tokenMeter;
            if (typeof meter?.contextPressure === 'function') orientUsage = meter.contextPressure(session);
            // Prefer the host's current todos projection (last-write-wins fold of
            // todo/write; populated mid-turn and survives compaction). stateOf is
            // deprecated but warns once per key and fails soft; the alternative
            // (registering a same-key handle) couples us to tool-todo's stateVersion
            // and breaks on DSH upgrade. At turn/start the projection clears to null,
            // so buildOrientationSeedBlock falls back to the latest todo_write in history.
            const proj = ctx.get?.('sessionProjections') ?? ctx.sessionProjections;
            if (typeof proj?.stateOf === 'function') {
              const state = proj.stateOf(session, 'todos');
              if (Array.isArray(state) && state.length > 0) {
                const clean = state.filter((t) => typeof t?.content === 'string' && typeof t?.status === 'string');
                if (clean.length > 0) { orientTodos = clean; orientTodosSource = 'projection'; }
              }
            }
          }
        } catch { orientUsage = undefined; orientTodos = undefined; }
      }
      const injected = injectSeed(filtered, options, {}, config.targetRules, config.matchName === true, config.compactionRegister, config.toolStepReseed === true, { seedEnabled: config.seedInjection !== false, reorderEnabled: config.reorderContexts !== false, orientation: { mode: orientMode, usage: orientUsage, todos: orientTodos } });
      auditRecord({
        provider: options.provider, model: options.model, purpose: options.purpose,
        reason: injected.reason, injected: injected.injected === true,
        taskIndex: injected.taskIndex ?? null, seedHash: SEED_HASH,
        taskHash: taskHashOf(injected.messages), messageCount: injected.messages.length,
        ...(orientMode === 'off' ? {} : { orientation: orientMode, orientationUsage: orientUsage?.pressureTokens !== undefined, orientationTodos: orientTodosSource === 'projection' || lastTodos(injected.messages) !== null, orientationTodosSource: orientTodosSource ?? (lastTodos(injected.messages) !== null ? 'history' : 'none') }),
      });
      if (injected.reason === 'compaction-request' && injected.messages !== filtered) {
        if (typeof ctx.llm?.prepareCall !== 'function') {
          yield* next();
          return;
        }
        let prepared;
        try {
          prepared = await ctx.llm.prepareCall({
            provider: options.provider,
            model: options.model,
            ...(options.reasoningEffort === undefined ? {} : { reasoningEffort: options.reasoningEffort }),
            ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
            ...(options.maxTokens === undefined ? {} : { maxTokens: options.maxTokens }),
            ...(options.stop === undefined ? {} : { stop: options.stop }),
          }, options.signal);
        } catch (error) {
          auditRecord({ event: 'prepare-error', path: 'compaction', model: options.model, error: String(error?.message || error) });
          yield* next();
          return;
        }
        yield* prepared.stream({
          ...options,
          ...prepared.config,
          messages: injected.messages,
          __weneedBypass: true,
        });
        return;
      }
      const policyEligible = injected.reason === 'user-task'
        || (injected.reason === 'tool-step'
          && lastCompactionIndex(injected.messages) < lastRealUserIndex(injected.messages));
      const taskedMessages = policyEligible
        ? appendTaskPolicy(injected.messages, config.taskPolicy === true)
        : injected.messages;
      const taskPolicyChanged = taskedMessages !== injected.messages;
      const scopeStart = config.mirrorScope === 'all' ? 0 : taskScopeStart(taskedMessages);
      const mirroredMessages = mirrorMessages(
        taskedMessages,
        config.mirror !== false,
        config.mirrorToolSteps === true,
        scopeStart,
      );
      const mirrorChanged = mirroredMessages !== taskedMessages;
      const compactedMessages = shouldAnchorAfterCompaction(injected.reason, mirroredMessages)
        ? anchorAfterCompaction(mirroredMessages, config.postCompactionSeed, SEED, scopeStart)
        : mirroredMessages;
      const compactChanged = compactedMessages !== mirroredMessages;
      const channelMessages = normalizeReasoningChannelMessages(compactedMessages, scopeStart);
      const reasoningChanged = channelMessages !== compactedMessages;
      const reasonedMessages = injected.reason === 'tool-step'
        ? appendToolStepReasoning(channelMessages, config.toolStepReasoning, TOOL_STEP_ANCHOR, SEED, scopeStart)
        : channelMessages;
      const toolReasoningChanged = reasonedMessages !== channelMessages;
      const anchoredMessages = injected.reason === 'tool-step' && reasonedMessages === compactedMessages
        ? anchorEmptyToolPlan(reasonedMessages, config.toolStepAnchor, TOOL_STEP_ANCHOR, scopeStart)
        : reasonedMessages;
      const anchorChanged = anchoredMessages !== reasonedMessages;
      const stripToolCallContent = config.stripToolCallContent === true;
      const contentSafeMessages = stripToolCallContent
        ? stripToolCallAssistantContent(anchoredMessages)
        : anchoredMessages;
      const sanitizeEnabled = config.sanitizeProgram !== false;
      const sanitizedMessages = sanitizeEnabled ? sanitizeProgramMessages(contentSafeMessages) : contentSafeMessages;
      const sanitizedTools = sanitizeEnabled ? sanitizeToolDefinitions(options.tools) : options.tools;
      const contentFilledMessages = fillAssistantContent(sanitizedMessages, config.contentFill, scopeStart, orientMode);
      const guidedMessages = applyNearestGuidance(contentFilledMessages, config.nearestGuidance, NEAREST_GUIDANCE, scopeStart);
      const seededToolMessages = appendToolResultSeed(guidedMessages, config.toolResultSeed, SEED, scopeStart);
      const registeredMessages = appendSystemRegister(
        seededToolMessages,
        config.systemRegister === true && injected.reason !== 'compaction-request' && injected.reason !== 'title-or-suggestion',
      );
      const systemRegisterChanged = registeredMessages !== seededToolMessages;
      const hintedTools = appendToolDescriptionSeed(appendTeamRegisterHint(sanitizedTools, config.teamRegisterHint === true), config.toolDescriptionSeed, config.toolDescriptionSeedText || TOOL_DESC_GUIDANCE);
      const contentFillChanged = contentFilledMessages !== sanitizedMessages;
      const guidanceChanged = guidedMessages !== contentFilledMessages;
      const toolResultChanged = seededToolMessages !== guidedMessages;
      const hintChanged = hintedTools !== sanitizedTools;
      const programChanged = sanitizedMessages !== anchoredMessages || sanitizedTools !== options.tools || contentFillChanged || guidanceChanged || toolResultChanged || hintChanged || systemRegisterChanged;
      if (injected.reason === 'compaction-request'
        || injected.reason === 'title-or-suggestion'
        || typeof ctx.llm?.prepareCall !== 'function') {
        yield* next();
        return;
      }
      if (!injected.injected && !filterChanged && !taskPolicyChanged && !mirrorChanged && !compactChanged && !reasoningChanged && !toolReasoningChanged && !anchorChanged && !programChanged) {
        yield* next();
        return;
      }
      let prepared;
      try {
        prepared = await ctx.llm.prepareCall({
          provider: options.provider,
          model: options.model,
          ...(options.reasoningEffort === undefined ? {} : { reasoningEffort: options.reasoningEffort }),
          ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
          ...(options.maxTokens === undefined ? {} : { maxTokens: options.maxTokens }),
          ...(options.stop === undefined ? {} : { stop: options.stop }),
        }, options.signal);
      } catch (error) {
        auditRecord({ event: 'prepare-error', path: 'main', model: options.model, error: String(error?.message || error) });
        yield* next();
        return;
      }
      if (config.wireDump === true) {
        const hintHead = TEAM_REGISTER_HINT.slice(0, 40);
        const descHead = (config.toolDescriptionSeedText || TOOL_DESC_GUIDANCE).slice(0, 40);
        const toolsSummary = (Array.isArray(hintedTools) ? hintedTools : []).map((t) => {
          const fn = t?.function || t; const d = typeof fn?.description === 'string' ? fn.description : '';
          return { name: fn?.name ?? t?.name, hint: d.includes(hintHead), descSeed: d.includes(descHead), len: d.length };
        });
        wireDump({ reason: injected.reason, taskIndex: injected.taskIndex ?? null, messageCount: registeredMessages.length, messages: registeredMessages, tools: toolsSummary });
      }
      yield* prepared.stream({
        ...options,
        ...prepared.config,
        messages: registeredMessages,
        ...(hintedTools === options.tools ? {} : { tools: hintedTools }),
        __weneedBypass: true,
      });
    }, { global: true });
  }
}
