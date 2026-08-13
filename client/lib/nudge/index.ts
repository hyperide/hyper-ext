/**
 * @file Nudge state port — public surface for the Nudge HUD's DI seam
 *
 * Accessed via: client components (@/lib/nudge) and the inspector mount points.
 */
export {
  createNudgeStatePort,
  NudgeStateProvider,
  useNudgeActions,
  useNudgeKeyboard,
  useNudgeState,
} from './NudgeStateProvider';
