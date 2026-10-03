import {
  DEFAULT_HOSTED_MODEL_ID,
  getDirectionerModelDefaultEffort,
  getDirectionerModelEfforts,
  resolveAvailableDirectionerModel,
  resolveSupportedDirectionerModel,
} from '@beyonders/common/constants/directioner-models'
import { create } from 'zustand'

import {
  loadDirectionerModelPreference,
  loadDirectionerReasoningEfforts,
  saveDirectionerReasoningEffort,
} from '../utils/settings'

import type { ReasoningEffort } from '@beyonders/common/constants/reasoning-effort'

/**
 * Holds the user's currently-selected directioner model. Initialized from the
 * persisted settings file so directioner defaults to whatever model the user
 * last picked.
 *
 * `setSelectedModel` is in-memory only — it does NOT persist. Persistence
 * happens on an explicit model pick (`selectDirectionerChatModel`, or the legacy
 * `startDirectionerSession` picker path), so
 * server-driven auto-flips (`model_locked`, `model_unavailable`, takeover)
 * can update the in-memory selection without overwriting the user's saved
 * preference. The latter previously caused users to get permanently flipped
 * to the fallback model after a single auto-fallback.
 *
 * Components on the landing screen read this to highlight the current row in
 * the model picker; the session hook reads it to decide which model to start.
 *
 * Reasoning effort is the opposite: `setReasoningEffort` DOES persist, because
 * every write to it is an explicit user act (the model picker). There is no
 * server-driven effort flip to protect against — the server clamps rather than
 * telling the client what it chose.
 */
interface DirectionerModelStore {
  selectedModel: string
  setSelectedModel: (model: string) => void
  /** Per-model effort overrides. A model absent from this map runs its catalog
   *  default; see saveDirectionerReasoningEffort for why absence is the "default"
   *  state rather than a stored null. */
  reasoningEffortByModel: Record<string, ReasoningEffort>
  setReasoningEffort: (
    model: string,
    effort: ReasoningEffort | undefined,
  ) => void
}

export const useDirectionerModelStore = create<DirectionerModelStore>((set) => ({
  selectedModel: resolveAvailableDirectionerModel(
    loadDirectionerModelPreference() ?? DEFAULT_HOSTED_MODEL_ID,
  ),
  setSelectedModel: (model) =>
    set({ selectedModel: resolveSupportedDirectionerModel(model) }),
  reasoningEffortByModel: loadDirectionerReasoningEfforts(),
  setReasoningEffort: (model, effort) => {
    saveDirectionerReasoningEffort(model, effort)
    set((state) => {
      const next = { ...state.reasoningEffortByModel }
      if (effort === undefined) {
        delete next[model]
      } else {
        next[model] = effort
      }
      return { reasoningEffortByModel: next }
    })
  },
}))

/** Imperative read for non-React callers (the session hook's tick loop and
 *  the chat-completions metadata builder). */
export function getSelectedDirectionerModel(): string {
  return useDirectionerModelStore.getState().selectedModel
}

/**
 * The user's effort override for a model, or null when they have none.
 *
 * Re-checked against the model's CURRENT ladder on every read rather than
 * trusted from the map. A rung can leave a catalog row between the save and
 * this read (a client update, a model re-tuned), and sending a rung the model
 * no longer offers is worse than sending nothing: the server would clamp it
 * down to something the user never picked, while sending nothing lands on the
 * model's own default — the same place a fresh user lands.
 */
export function getDirectionerReasoningEffortForModel(
  model: string,
): ReasoningEffort | null {
  const saved = useDirectionerModelStore.getState().reasoningEffortByModel[model]
  if (!saved) return null
  return getDirectionerModelEfforts(model)?.includes(saved) ? saved : null
}

/** What a turn on this model will ACTUALLY run at, override or not — the value
 *  the pickers display. Null when the model exposes no ladder. */
export function getEffectiveDirectionerReasoningEffort(
  model: string,
): ReasoningEffort | null {
  return (
    getDirectionerReasoningEffortForModel(model) ??
    getDirectionerModelDefaultEffort(model)
  )
}

/** The override for whichever model is selected right now. Sent verbatim as
 *  `directioner_reasoning_effort`; null means "send nothing". */
export function getSelectedDirectionerReasoningEffort(): ReasoningEffort | null {
  return getDirectionerReasoningEffortForModel(getSelectedDirectionerModel())
}
