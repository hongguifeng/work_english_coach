import type { SqlDb } from '../db';
import { CommunicationSampleRepository } from './communicationSamples';
import { DetectedIssueRepository } from './detectedIssues';
import { ExpressionRepository } from './expressions';
import { ReviewAttemptRepository } from './reviewAttempts';
import { ReviewTaskRepository } from './reviewTasks';
import { SettingsRepository } from './settings';
import { SkillRepository } from './skills';

/**
 * 仓储集合（单一入口，便于注入到服务层与 IPC 层）。
 * 统一依赖驱动无关的 `SqlDb`：生产注入 `AppDatabase`，测试注入 `drizzle-node:sqlite`。
 */
export interface Repositories {
  settings: SettingsRepository;
  skills: SkillRepository;
  expressions: ExpressionRepository;
  samples: CommunicationSampleRepository;
  issues: DetectedIssueRepository;
  reviewTasks: ReviewTaskRepository;
  reviewAttempts: ReviewAttemptRepository;
}

export function createRepositories(db: SqlDb): Repositories {
  return {
    settings: new SettingsRepository(db),
    skills: new SkillRepository(db),
    expressions: new ExpressionRepository(db),
    samples: new CommunicationSampleRepository(db),
    issues: new DetectedIssueRepository(db),
    reviewTasks: new ReviewTaskRepository(db),
    reviewAttempts: new ReviewAttemptRepository(db),
  };
}
