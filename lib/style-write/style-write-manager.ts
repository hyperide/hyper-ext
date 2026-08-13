/**
 * @file StyleWriteManager orchestration for shared style write planning and execution
 *
 * Accessed via: Phase 6 VS Code and SaaS style update flows before platform-specific file mutation
 * Assumptions: platform executors apply plans exactly as produced; this manager
 *   coordinates planner/writer/executor flow but does not mutate files directly.
 */
import type {
  StyleWriteContext,
  StyleWriteManager,
  StyleWritePlan,
  StyleWritePlanner,
  StyleWriteResult,
} from './types';
import { errorMessage } from './utils';

export interface StyleWritePlanExecutor {
  execute(plan: StyleWritePlan): Promise<StyleWriteResult>;
}

export interface DefaultStyleWriteManagerOptions {
  planner: StyleWritePlanner;
  executor: StyleWritePlanExecutor;
}

export class DefaultStyleWriteManager implements StyleWriteManager {
  private readonly planner: StyleWritePlanner;
  private readonly executor: StyleWritePlanExecutor;

  constructor(options: DefaultStyleWriteManagerOptions) {
    this.planner = options.planner;
    this.executor = options.executor;
  }

  /**
   * Plan phase of the write pipeline (read → map → write): ask the planner WHERE the
   * edit should land (which adapter/writer + source owner), then let that writer MAP
   * the requested canonical inspector styles into a framework-specific
   * {@link StyleWritePlan}. The plan is a frozen description of the edit; nothing is
   * written here — "frozen plan, dumb dispatch" (master-spec §7.4). Separating plan
   * from execute lets callers preview/diff the plan before committing it.
   */
  async createPlan(ctx: StyleWriteContext): Promise<StyleWritePlan> {
    const target = this.planner.selectTarget(ctx);
    return target.writer.createPlan({
      context: ctx,
      sourceOwner: target.sourceOwner,
    });
  }

  /**
   * Execute phase: hand the frozen plan to the platform executor that actually mutates
   * files. Any executor error is captured into a `success:false` result rather than
   * thrown, so a failed write surfaces as a structured verdict the inspector can show
   * (per the fail-closed feedback model, spec §8.4) instead of crashing the request.
   */
  async execute(plan: StyleWritePlan): Promise<StyleWriteResult> {
    try {
      return await this.executor.execute(plan);
    } catch (error) {
      return {
        success: false,
        plan,
        error: errorMessage(error),
      };
    }
  }
}
