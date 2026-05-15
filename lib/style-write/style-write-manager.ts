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

  async createPlan(ctx: StyleWriteContext): Promise<StyleWritePlan> {
    const target = this.planner.selectTarget(ctx);
    return target.writer.createPlan({
      context: ctx,
      sourceOwner: target.sourceOwner,
    });
  }

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
