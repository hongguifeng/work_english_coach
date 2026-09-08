import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRepositories } from '../src/main/db/repositories';
import type { Result } from '../src/shared/types/app';
import { createTestDb, type TestDb } from './db/testDb';

function isOk<T>(r: Result<T>): r is { ok: true; data: T } {
	return r.ok === true;
}

let testDb: TestDb;
let repos: ReturnType<typeof createRepositories>;

beforeEach(() => {
	testDb = createTestDb();
	repos = createRepositories(testDb.db);
});

afterEach(() => {
	testDb.close();
});

/* ------------------------------------------------------------------ */
/*  SettingsRepository                                                  */
/* ------------------------------------------------------------------ */

describe('SettingsRepository', () => {
	it('set then get returns the stored value', () => {
		const set = repos.settings.set('theme', 'dark');
		expect(isOk(set)).toBe(true);
		if (!isOk(set)) return;
		expect(set.data.key).toBe('theme');
		expect(set.data.value).toBe('dark');

		const got = repos.settings.get('theme');
		expect(isOk(got)).toBe(true);
		if (!isOk(got)) return;
		expect(got.data?.value).toBe('dark');
	});

	it('get non-existent key returns null', () => {
		const got = repos.settings.get('nonexistent');
		expect(isOk(got)).toBe(true);
		if (!isOk(got)) return;
		expect(got.data).toBeNull();
	});

	it('set overwrites existing value', () => {
		repos.settings.set('k', 'v1');
		const r = repos.settings.set('k', 'v2');
		expect(isOk(r)).toBe(true);
		if (!isOk(r)) return;
		expect(r.data.value).toBe('v2');
	});

	it('delete removes the key', () => {
		repos.settings.set('k', 'v');
		const del = repos.settings.delete('k');
		expect(isOk(del)).toBe(true);
		const got = repos.settings.get('k');
		expect(isOk(got)).toBe(true);
		if (!isOk(got)) return;
		expect(got.data).toBeNull();
	});

	it('getAll returns all settings', () => {
		repos.settings.set('a', '1');
		repos.settings.set('b', '2');
		const all = repos.settings.getAll();
		expect(isOk(all)).toBe(true);
		if (!isOk(all)) return;
		expect(all.data.length).toBe(2);
		const keys = all.data.map((r) => r.key).sort();
		expect(keys).toEqual(['a', 'b']);
	});
});

/* ------------------------------------------------------------------ */
/*  SkillRepository                                                     */
/* ------------------------------------------------------------------ */

describe('SkillRepository', () => {
	it('upsert creates a new skill', () => {
		const r = repos.skills.upsert({
			skillKey: 'art-the-a',
			title: '定冠词/零冠词',
			category: 'article',
			explanationZh: '特指名词前加 the，泛指可数单数前加 a/an。',
		});
		expect(isOk(r)).toBe(true);
		if (!isOk(r)) return;
		expect(r.data.skillKey).toBe('art-the-a');
		expect(r.data.category).toBe('article');
	});

	it('upsert updates an existing skill', () => {
		repos.skills.upsert({
			skillKey: 'k1',
			title: 'Original',
			category: 'grammar',
			explanationZh: 'd1',
		});
		const r = repos.skills.upsert({
			skillKey: 'k1',
			title: 'Updated',
			category: 'grammar',
			explanationZh: 'd2',
		});
		expect(isOk(r)).toBe(true);
		if (!isOk(r)) return;
		expect(r.data.title).toBe('Updated');
		expect(r.data.explanationZh).toBe('d2');
	});

	it('getByKey returns the skill or null', () => {
		repos.skills.upsert({
			skillKey: 'findme',
			title: 'X',
			category: 'tense',
			explanationZh: 'desc',
		});
		const found = repos.skills.getByKey('findme');
		expect(isOk(found)).toBe(true);
		if (!isOk(found)) return;
		expect(found.data?.title).toBe('X');

		const missing = repos.skills.getByKey('nope');
		expect(isOk(missing)).toBe(true);
		if (!isOk(missing)) return;
		expect(missing.data).toBeNull();
	});

	it('list filters by category', () => {
		repos.skills.upsert({ skillKey: 'a1', title: 'A', category: 'grammar', explanationZh: '' });
		repos.skills.upsert({ skillKey: 't1', title: 'T', category: 'tense', explanationZh: '' });
		const grammar = repos.skills.list('grammar');
		expect(isOk(grammar)).toBe(true);
		if (!isOk(grammar)) return;
		expect(grammar.data.length).toBe(1);
		expect(grammar.data[0]?.category).toBe('grammar');
	});

	it('list without filter returns all', () => {
		repos.skills.upsert({ skillKey: 'a1', title: 'A', category: 'grammar', explanationZh: '' });
		repos.skills.upsert({ skillKey: 't1', title: 'T', category: 'tense', explanationZh: '' });
		const all = repos.skills.list();
		expect(isOk(all)).toBe(true);
		if (!isOk(all)) return;
		expect(all.data.length).toBe(2);
	});
});

/* ------------------------------------------------------------------ */
/*  ExpressionRepository                                                */
/* ------------------------------------------------------------------ */

describe('ExpressionRepository', () => {
	const baseInput = {
		title: 'Please find the attached report',
		chineseMeaning: '请查收附件报告。',
	};

	it('create then get returns the expression', () => {
		const created = repos.expressions.create(baseInput);
		expect(isOk(created)).toBe(true);
		if (!isOk(created)) return;
		expect(created.data.title).toBe(baseInput.title);
		expect(created.data.masteryStatus).toBe('new');
		expect(created.data.status).toBe('active');

		const got = repos.expressions.get(created.data.id);
		expect(isOk(got)).toBe(true);
		if (!isOk(got)) return;
		expect(got.data?.chineseMeaning).toBe(baseInput.chineseMeaning);
	});

	it('update modifies the expression', () => {
		const created = repos.expressions.create(baseInput);
		if (!isOk(created)) return;
		const updated = repos.expressions.update(created.data.id, {
			title: 'Please see the attached report',
		});
		expect(isOk(updated)).toBe(true);
		if (!isOk(updated)) return;
		expect(updated.data.title).toBe('Please see the attached report');
	});

	it('setMasteryStatus updates the status', () => {
		const created = repos.expressions.create(baseInput);
		if (!isOk(created)) return;
		const r = repos.expressions.setMasteryStatus(created.data.id, 'familiar');
		expect(isOk(r)).toBe(true);
		if (!isOk(r)) return;
		expect(r.data.masteryStatus).toBe('familiar');
	});

	it('setStatus updates the status', () => {
		const created = repos.expressions.create(baseInput);
		if (!isOk(created)) return;
		const r = repos.expressions.setStatus(created.data.id, 'archived');
		expect(isOk(r)).toBe(true);
		if (!isOk(r)) return;
		expect(r.data.status).toBe('archived');
	});

	it('list filters by status', () => {
		const e1 = repos.expressions.create(baseInput);
		const e2 = repos.expressions.create({ ...baseInput, title: 'expr2' });
		if (!isOk(e1) || !isOk(e2)) return;
		repos.expressions.setStatus(e2.data.id, 'archived');

		const active = repos.expressions.list('active');
		expect(isOk(active)).toBe(true);
		if (!isOk(active)) return;
		expect(active.data.length).toBe(1);
		expect(active.data[0]?.id).toBe(e1.data.id);
	});

	it('list filters by mastery', () => {
		repos.expressions.create({ ...baseInput, title: 'a', masteryStatus: 'new' });
		repos.expressions.create({ ...baseInput, title: 'b', masteryStatus: 'familiar' });
		const familiar = repos.expressions.list('active', 'familiar');
		expect(isOk(familiar)).toBe(true);
		if (!isOk(familiar)) return;
		expect(familiar.data.length).toBe(1);
		expect(familiar.data[0]?.title).toBe('b');
	});

	it('getBySourceSampleId returns expressions for a sample', () => {
		// FK requires a real sample row first
		const s1 = repos.samples.create({
			sourceType: 'email',
			audience: 'colleague',
			tone: 'neutral',
			originalChinese: null,
			originalEnglish: null,
			minimalRevision: 'm',
			naturalRevision: 'n',
			shouldClarify: false,
			clarificationQuestions: null,
		});
		const s2 = repos.samples.create({
			sourceType: 'email',
			audience: 'colleague',
			tone: 'neutral',
			originalChinese: null,
			originalEnglish: null,
			minimalRevision: 'm',
			naturalRevision: 'n',
			shouldClarify: false,
			clarificationQuestions: null,
		});
		if (!isOk(s1) || !isOk(s2)) return;

		repos.expressions.create({ ...baseInput, title: 'e1', sourceSampleId: s1.data.id });
		repos.expressions.create({ ...baseInput, title: 'e2', sourceSampleId: s1.data.id });
		repos.expressions.create({ ...baseInput, title: 'e3', sourceSampleId: s2.data.id });

		const got = repos.expressions.getBySourceSampleId(s1.data.id);
		expect(isOk(got)).toBe(true);
		if (isOk(got)) {
			expect(got.data.length).toBe(2);
		}
	});

	it('get non-existent id returns null', () => {
		const got = repos.expressions.get('nonexistent-id');
		expect(isOk(got)).toBe(true);
		if (!isOk(got)) return;
		expect(got.data).toBeNull();
	});
});

/* ------------------------------------------------------------------ */
/*  CommunicationSampleRepository                                       */
/* ------------------------------------------------------------------ */

describe('CommunicationSampleRepository', () => {
	const baseSample = {
		sourceType: 'email' as const,
		audience: 'colleague' as const,
		tone: 'neutral' as const,
		originalChinese: '告诉同事报告已完成',
		originalEnglish: 'The report is done.',
		minimalRevision: 'The report is complete.',
		naturalRevision: 'The report is finished and ready for review.',
		shouldClarify: false,
		clarificationQuestions: null,
	};

	it('create then get returns the sample', () => {
		const created = repos.samples.create(baseSample);
		expect(isOk(created)).toBe(true);
		if (!isOk(created)) return;
		expect(created.data.originalEnglish).toBe(baseSample.originalEnglish);
		expect(created.data.minimalRevision).toBe(baseSample.minimalRevision);

		const got = repos.samples.get(created.data.id);
		expect(isOk(got)).toBe(true);
		if (!isOk(got)) return;
		expect(got.data?.sourceType).toBe('email');
		expect(got.data?.audience).toBe('colleague');
	});

	it('getWithQuestions returns parsed JSON arrays', () => {
		const created = repos.samples.create({
			...baseSample,
			shouldClarify: true,
			clarificationQuestions: ['What does "done" mean exactly?'],
		});
		expect(isOk(created)).toBe(true);
		if (!isOk(created)) return;

		const got = repos.samples.getWithQuestions(created.data.id);
		expect(isOk(got)).toBe(true);
		if (isOk(got)) {
			expect(got.data?.clarificationQuestions).toEqual(['What does "done" mean exactly?']);
		}
	});

	it('saveWithIssues creates sample and issues in a transaction', () => {
		const r = repos.samples.saveWithIssues(
			baseSample,
			[
				{
					category: 'grammar',
					skillKey: 'tense-past',
					originalText: 'The report is done.',
					correctedText: 'The report is complete.',
					explanationZh: '"done" 口语化，正式邮件用 complete/finished。',
					severity: 'suggestion',
				},
			],
		);
		expect(isOk(r)).toBe(true);
		if (!isOk(r)) return;
		expect(r.data.issues.length).toBe(1);
		expect(r.data.issues[0]?.category).toBe('grammar');

		const got = repos.samples.get(r.data.id);
		expect(isOk(got)).toBe(true);

		const issues = repos.issues.getBySampleId(r.data.id);
		expect(isOk(issues)).toBe(true);
		if (isOk(issues)) {
			expect(issues.data.length).toBe(1);
			expect(issues.data[0]?.skillKey).toBe('tense-past');
		}
	});

	it('list returns all samples', () => {
		repos.samples.create(baseSample);
		repos.samples.create({ ...baseSample, originalEnglish: 'Second draft' });
		const all = repos.samples.list();
		expect(isOk(all)).toBe(true);
		if (!isOk(all)) return;
		expect(all.data.length).toBe(2);
	});

	it('get non-existent id returns null', () => {
		const got = repos.samples.get('nonexistent-id');
		expect(isOk(got)).toBe(true);
		if (!isOk(got)) return;
		expect(got.data).toBeNull();
	});
});

/* ------------------------------------------------------------------ */
/*  DetectedIssueRepository                                             */
/* ------------------------------------------------------------------ */

describe('DetectedIssueRepository', () => {
	/** FK: detectedIssues.sampleId → communicationSamples.id */
	function createSample() {
		const s = repos.samples.create({
			sourceType: 'email',
			audience: 'colleague',
			tone: 'neutral',
			originalChinese: null,
			originalEnglish: null,
			minimalRevision: 'm',
			naturalRevision: 'n',
			shouldClarify: false,
			clarificationQuestions: null,
		});
		if (!isOk(s)) throw new Error('sample setup failed');
		return s.data;
	}

	const issueBody = {
		category: 'grammar' as const,
		skillKey: 'tense-past',
		originalText: 'I go to school yesterday.',
		correctedText: 'I went to school yesterday.',
		explanationZh: '过去时间用过去时 went。',
		severity: 'error' as const,
	};

	it('create then getBySampleId returns the issue', () => {
		const sample = createSample();
		const created = repos.issues.create({ ...issueBody, sampleId: sample.id });
		expect(isOk(created)).toBe(true);
		if (isOk(created)) {
			expect(created.data.category).toBe('grammar');
		}

		const got = repos.issues.getBySampleId(sample.id);
		expect(isOk(got)).toBe(true);
		if (isOk(got)) {
			expect(got.data.length).toBe(1);
			expect(got.data[0]?.explanationZh).toBe(issueBody.explanationZh);
		}
	});

	it('bulkCreate inserts multiple issues', () => {
		const sample = createSample();
		const r = repos.issues.bulkCreate([
			{ ...issueBody, sampleId: sample.id },
			{
				...issueBody,
				sampleId: sample.id,
				category: 'tense',
				originalText: 'other',
				correctedText: 'fixed',
			},
		]);
		expect(isOk(r)).toBe(true);
		if (isOk(r)) {
			expect(r.data.length).toBe(2);
		}
	});

	it('list returns issues up to limit', () => {
		const sample = createSample();
		for (let i = 0; i < 5; i++) {
			repos.issues.create({ ...issueBody, sampleId: sample.id });
		}
		const r = repos.issues.list(3);
		expect(isOk(r)).toBe(true);
		if (isOk(r)) {
			expect(r.data.length).toBe(3);
		}
	});

	it('getBySampleId returns empty for a sample with no issues', () => {
		const sample = createSample();
		const r = repos.issues.getBySampleId(sample.id);
		expect(isOk(r)).toBe(true);
		if (isOk(r)) {
			expect(r.data.length).toBe(0);
		}
	});
});

/* ------------------------------------------------------------------ */
/*  ReviewTaskRepository                                                */
/* ------------------------------------------------------------------ */

describe('ReviewTaskRepository', () => {
	const baseTask = {
		taskType: 'rewrite' as const,
		skillId: null,
		expressionId: null,
		promptZh: '用英文说：我昨天去了学校',
		context: null,
		keywords: null as readonly string[] | null,
		referenceAnswer: 'I went to school yesterday.',
		acceptableAnswers: null as readonly string[] | null,
		scheduledAt: new Date().toISOString(),
	};

	it('create then get returns the task', () => {
		const created = repos.reviewTasks.create(baseTask);
		expect(isOk(created)).toBe(true);
		if (!isOk(created)) return;
		expect(created.data.taskType).toBe('rewrite');
		expect(created.data.status).toBe('pending');

		const got = repos.reviewTasks.get(created.data.id);
		expect(isOk(got)).toBe(true);
		if (isOk(got)) {
			expect(got.data?.promptZh).toBe(baseTask.promptZh);
		}
	});

	it('getParsed returns parsed keywords and acceptableAnswers', () => {
		const created = repos.reviewTasks.create({
			...baseTask,
			keywords: ['go', 'yesterday'],
			acceptableAnswers: ['I went to school yesterday'],
		});
		expect(isOk(created)).toBe(true);
		if (isOk(created)) {
			const got = repos.reviewTasks.getParsed(created.data.id);
			expect(isOk(got)).toBe(true);
			if (isOk(got) && got.data) {
				expect(got.data.keywords).toEqual(['go', 'yesterday']);
				expect(got.data.acceptableAnswers).toEqual(['I went to school yesterday']);
			}
		}
	});

	it('complete marks the task as completed', () => {
		const created = repos.reviewTasks.create(baseTask);
		if (!isOk(created)) return;
		const r = repos.reviewTasks.complete(created.data.id);
		expect(isOk(r)).toBe(true);
		if (isOk(r)) {
			expect(r.data.status).toBe('completed');
			expect(r.data.completedAt).not.toBeNull();
		}
	});

	it('reschedule changes the scheduledAt and resets to pending', () => {
		const created = repos.reviewTasks.create(baseTask);
		if (!isOk(created)) return;
		repos.reviewTasks.complete(created.data.id);
		const future = new Date(Date.now() + 86400000).toISOString();
		const r = repos.reviewTasks.reschedule(created.data.id, future);
		expect(isOk(r)).toBe(true);
		if (isOk(r)) {
			expect(r.data.scheduledAt).toBe(future);
			expect(r.data.status).toBe('pending');
		}
	});

	it('getDue returns tasks with scheduledAt <= now', () => {
		const past = new Date(Date.now() - 3600000).toISOString();
		const future = new Date(Date.now() + 86400000).toISOString();
		repos.reviewTasks.create({ ...baseTask, scheduledAt: past });
		repos.reviewTasks.create({ ...baseTask, scheduledAt: future });

		const due = repos.reviewTasks.getDue();
		expect(isOk(due)).toBe(true);
		if (isOk(due)) {
			expect(due.data.length).toBe(1);
		}
	});

	it('list filters by status', () => {
		const t1 = repos.reviewTasks.create(baseTask);
		const t2 = repos.reviewTasks.create({ ...baseTask, promptZh: 'task2' });
		if (!isOk(t1) || !isOk(t2)) return;
		repos.reviewTasks.complete(t1.data.id);

		const pending = repos.reviewTasks.list('pending');
		expect(isOk(pending)).toBe(true);
		if (isOk(pending)) {
			expect(pending.data.length).toBe(1);
			expect(pending.data[0]?.id).toBe(t2.data.id);
		}
	});

	it('getBySkill returns tasks for a skill', () => {
		// FK: reviewTasks.skillId → skills.id
		const sk1 = repos.skills.upsert({
			skillKey: 'k1',
			title: 'A',
			category: 'grammar',
			explanationZh: '',
		});
		const sk2 = repos.skills.upsert({
			skillKey: 'k2',
			title: 'B',
			category: 'tense',
			explanationZh: '',
		});
		if (!isOk(sk1) || !isOk(sk2)) return;

		repos.reviewTasks.create({ ...baseTask, skillId: sk1.data.id });
		repos.reviewTasks.create({ ...baseTask, skillId: sk2.data.id });
		const got = repos.reviewTasks.getBySkill(sk1.data.id);
		expect(isOk(got)).toBe(true);
		if (isOk(got)) {
			expect(got.data.length).toBe(1);
		}
	});

	it('getByExpression returns tasks for an expression', () => {
		// FK: reviewTasks.expressionId → expressions.id
		const ex1 = repos.expressions.create({
			title: 'e1',
			chineseMeaning: 'c1',
		});
		const ex2 = repos.expressions.create({
			title: 'e2',
			chineseMeaning: 'c2',
		});
		if (!isOk(ex1) || !isOk(ex2)) return;

		repos.reviewTasks.create({ ...baseTask, expressionId: ex1.data.id });
		repos.reviewTasks.create({ ...baseTask, expressionId: ex2.data.id });
		const got = repos.reviewTasks.getByExpression(ex1.data.id);
		expect(isOk(got)).toBe(true);
		if (isOk(got)) {
			expect(got.data.length).toBe(1);
		}
	});
});

/* ------------------------------------------------------------------ */
/*  ReviewAttemptRepository                                             */
/* ------------------------------------------------------------------ */

describe('ReviewAttemptRepository', () => {
	/** FK: reviewAttempts.taskId → reviewTasks.id */
	function createTask() {
		const t = repos.reviewTasks.create({
			taskType: 'rewrite',
			promptZh: 'test prompt',
			referenceAnswer: 'answer',
			scheduledAt: new Date().toISOString(),
		});
		if (!isOk(t)) throw new Error('task setup failed');
		return t.data;
	}

	const attemptBody = {
		userAnswer: 'I went to school yesterday.',
		usedHint: false,
		revealedAnswer: false,
	};

	it('create then getByTaskId returns the attempt', () => {
		const task = createTask();
		const created = repos.reviewAttempts.create({ ...attemptBody, taskId: task.id });
		expect(isOk(created)).toBe(true);
		if (isOk(created)) {
			expect(created.data.userAnswer).toBe(attemptBody.userAnswer);
			expect(created.data.usedHint).toBe(false);
		}

		const got = repos.reviewAttempts.getByTaskId(task.id);
		expect(isOk(got)).toBe(true);
		if (isOk(got)) {
			expect(got.data.length).toBe(1);
			expect(got.data[0]?.userAnswer).toBe(attemptBody.userAnswer);
		}
	});

	it('latestByTaskId returns the most recent attempt', async () => {
		const task = createTask();
		repos.reviewAttempts.create({ ...attemptBody, taskId: task.id, userAnswer: 'First' });
		// createdAt is stored in JS with millisecond precision; separate the two
		// inserts so the timestamps are strictly ordered and the test is deterministic.
		await new Promise((r) => setTimeout(r, 2));
		repos.reviewAttempts.create({ ...attemptBody, taskId: task.id, userAnswer: 'Second' });

		const latest = repos.reviewAttempts.latestByTaskId(task.id);
		expect(isOk(latest)).toBe(true);
		if (isOk(latest)) {
			expect(latest.data?.userAnswer).toBe('Second');
		}
	});

	it('getByTaskId returns empty for a task with no attempts', () => {
		const task = createTask();
		const r = repos.reviewAttempts.getByTaskId(task.id);
		expect(isOk(r)).toBe(true);
		if (isOk(r)) {
			expect(r.data.length).toBe(0);
		}
	});

	it('latestByTaskId returns null for a task with no attempts', () => {
		const task = createTask();
		const r = repos.reviewAttempts.latestByTaskId(task.id);
		expect(isOk(r)).toBe(true);
		if (!isOk(r)) return;
		expect(r.data).toBeNull();
	});
});
