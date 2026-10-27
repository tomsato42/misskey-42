/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'vitest';
import {
	extractProjectRequirements,
	extractProjectStatuses,
	extractValidatedQuests,
	judgeProjectAvailability,
	parseSlugList,
	selectProjectSessions,
	toProjectDefinition,
} from '@/core/intra/intra-project.js';
import type { IntraProjectSession, IntraProjectSessionRule, IntraProjectStatuses, IntraUserProgress } from '@/core/intra/intra-project.js';

function rule(kind: string, internalName: string, params: string[], required = true): IntraProjectSessionRule {
	return { required, params: params.map(value => ({ value })), rule: { kind, internal_name: internalName } };
}

// 42 Tokyo (campus 26)・42cursus (21) の実際のセッションのルール (2026-10 時点) から、判定に関係するものを抜き出したもの
const CUB3D_RULES = [
	rule('final_compilation', 'BestMark', []),
	rule('correction', 'MatchingDelay', ['7-0,14-1,21-2,35-3,50-5,100-30,150-90']),
	rule('inscription', 'QuestsValidated', ['common-core-rank-03']),
	rule('inscription', 'NeitherOngoingOrValidated', ['minirt cub3d']),
	rule('group_validation', 'GroupSizeBetweenNAndM', ['2', '2']),
	rule('inscription', 'QuestsNotValidated', ['common-core common-core-rank-04 42next']),
];
const TRANSCENDENCE_RULES = [
	rule('group_validation', 'GroupSizeBetweenNAndM', ['4', '5']),
	rule('inscription', 'NeitherOngoingOrValidated', ['ft_transcendence']),
	rule('inscription', 'QuestsValidated', ['common-core-rank-05']),
	rule('inscription', 'QuestsNotValidated', ['common-core']),
];
const MINISHELL_RULES = [
	rule('inscription', 'QuestsNotValidated', ['common-core common-core-rank-03 42next']),
	rule('group_validation', 'GroupSizeBetweenNAndM', ['2', '2']),
	rule('inscription', 'NeitherOngoingOrValidated', ['42cursus-minishell']),
	rule('inscription', 'QuestsValidated', ['common-core-rank-02']),
];

const cub3d = { slug: 'cub3d', ...extractProjectRequirements(CUB3D_RULES) };
const transcendence = { slug: 'ft_transcendence', ...extractProjectRequirements(TRANSCENDENCE_RULES) };
const minishell = { slug: '42cursus-minishell', ...extractProjectRequirements(MINISHELL_RULES) };

function progress(projectStatuses: IntraProjectStatuses, validatedQuests: string[]): IntraUserProgress {
	return { projectStatuses, validatedQuests };
}

/** rank-03 まで達成し、rank-04 は未達成の人 (cub3d か minirt に取り組む段階) */
const RANK3_QUESTS = ['common-core-rank-00', 'common-core-rank-01', 'common-core-rank-02', 'common-core-rank-03'];

describe('parseSlugList', () => {
	test('空白区切りの slug を分解する', () => {
		expect(parseSlugList('common-core common-core-rank-04 42next')).toEqual(['common-core', 'common-core-rank-04', '42next']);
	});

	test('連続した空白・前後の空白・重複を取り除く', () => {
		expect(parseSlugList('  minirt\tcub3d  minirt\n')).toEqual(['minirt', 'cub3d']);
	});

	test('空文字列は空の配列', () => {
		expect(parseSlugList('')).toEqual([]);
		expect(parseSlugList('   ')).toEqual([]);
	});
});

describe('extractProjectRequirements', () => {
	test('cub3d のルールを解析する', () => {
		expect(extractProjectRequirements(CUB3D_RULES)).toEqual({
			minGroupSize: 2,
			maxGroupSize: 2,
			requiredQuests: ['common-core-rank-03'],
			requiredAnyQuests: [],
			forbiddenQuests: ['common-core', 'common-core-rank-04', '42next'],
			exclusiveProjects: ['minirt', 'cub3d'],
			requiredProjects: [],
		});
	});

	test('ft_transcendence のルールを解析する', () => {
		expect(extractProjectRequirements(TRANSCENDENCE_RULES)).toMatchObject({
			minGroupSize: 4,
			maxGroupSize: 5,
			requiredQuests: ['common-core-rank-05'],
			forbiddenQuests: ['common-core'],
			exclusiveProjects: ['ft_transcendence'],
		});
	});

	test('QuestAndQuestValidated はすべて必要、QuestOrQuestValidated はどれか 1 つが必要として扱う', () => {
		expect(extractProjectRequirements([
			rule('inscription', 'QuestAndQuestValidated', ['common-core-rank-04 42next']),
			rule('inscription', 'QuestOrQuestValidated', ['42-to-42cursus-transfert common-core']),
			rule('inscription', 'ProjectsValidated', ['42cursus-rainfall']),
		])).toMatchObject({
			requiredQuests: ['common-core-rank-04', '42next'],
			requiredAnyQuests: [['42-to-42cursus-transfert', 'common-core']],
			requiredProjects: ['42cursus-rainfall'],
		});
	});

	test('required でないルールと、判定に使わない種類のルールは無視する', () => {
		expect(extractProjectRequirements([
			rule('inscription', 'ProjectsValidated', ['42cursus-ft_vox'], false),
			rule('inscription', 'MinimumProjectValidated', ['1', 'scop 42cursus-scop']),
			rule('retry_inscription', 'NeitherOngoingOrValidated', ['cub3d']),
			rule('correction', 'ProjectsValidated', ['libft']),
		])).toEqual({
			minGroupSize: null,
			maxGroupSize: null,
			requiredQuests: [],
			requiredAnyQuests: [],
			forbiddenQuests: [],
			exclusiveProjects: [],
			requiredProjects: [],
		});
	});

	test('人数の params が解釈できなければ人数は null', () => {
		expect(extractProjectRequirements([rule('group_validation', 'GroupSizeBetweenNAndM', ['2'])])).toMatchObject({ minGroupSize: null, maxGroupSize: null });
		expect(extractProjectRequirements([rule('group_validation', 'GroupSizeBetweenNAndM', ['x', '2'])])).toMatchObject({ minGroupSize: null, maxGroupSize: null });
		expect(extractProjectRequirements([rule('group_validation', 'GroupSizeBetweenNAndM', ['3', '2'])])).toMatchObject({ minGroupSize: null, maxGroupSize: null });
	});

	test('ルールが無ければ空の条件', () => {
		expect(extractProjectRequirements(undefined).requiredQuests).toEqual([]);
	});
});

function session(id: number, slug: string, overrides: Partial<IntraProjectSession> = {}): IntraProjectSession {
	return {
		id,
		project_id: id * 10,
		campus_id: 26,
		cursus_id: 21,
		is_subscriptable: true,
		updated_at: '2026-01-01T00:00:00.000Z',
		project: { id: id * 10, name: slug, slug },
		project_sessions_rules: [],
		...overrides,
	};
}

describe('selectProjectSessions', () => {
	test('課題ごとに、登録できるセッションを優先し、その中で更新日時が新しいものを選ぶ', () => {
		const selected = selectProjectSessions([
			session(1, 'cub3d', { updated_at: '2026-05-01T00:00:00.000Z' }),
			session(2, 'cub3d', { updated_at: '2026-06-01T00:00:00.000Z' }),
			session(3, 'cub3d', { updated_at: '2026-07-01T00:00:00.000Z', is_subscriptable: false }),
			session(4, 'minirt', { is_subscriptable: false }),
		]);
		expect(selected.map(s => s.id)).toEqual([2, 4]);
	});
});

describe('toProjectDefinition', () => {
	test('セッションを intra_project の形に変換する', () => {
		expect(toProjectDefinition(session(5218, 'cub3d', { project_id: 100, project: { id: 100, name: 'cub3d', slug: 'cub3d' }, project_sessions_rules: CUB3D_RULES }))).toEqual({
			projectId: 100,
			slug: 'cub3d',
			name: 'cub3d',
			campusId: 26,
			cursusId: 21,
			sessionId: 5218,
			...extractProjectRequirements(CUB3D_RULES),
		});
	});

	test('キャンパスか cursus が無いセッションは null', () => {
		expect(toProjectDefinition(session(1, 'a', { campus_id: null }))).toBeNull();
		expect(toProjectDefinition(session(1, 'a', { cursus_id: null }))).toBeNull();
	});
});

describe('extractProjectStatuses', () => {
	test('slug ごとの状態と合否にまとめる', () => {
		expect(extractProjectStatuses([
			{ status: 'finished', 'validated?': true, cursus_ids: [21], project: { id: 1, slug: 'cub3d' } },
			{ status: 'searching_a_group', 'validated?': null, cursus_ids: [21], project: { id: 2, slug: 'webserv' } },
			{ status: 'finished', 'validated?': false, cursus_ids: [9], project: { id: 3, slug: 'c-piscine-bsq' } },
		])).toEqual({
			cub3d: { status: 'finished', validated: true },
			webserv: { status: 'searching_a_group', validated: null },
			'c-piscine-bsq': { status: 'finished', validated: false },
		});
	});
});

describe('extractValidatedQuests', () => {
	test('達成したクエストだけを、重複なく並べ替えて返す', () => {
		expect(extractValidatedQuests([
			{ validated_at: '2025-01-01T00:00:00.000Z', quest: { slug: 'common-core-rank-01' } },
			{ validated_at: null, quest: { slug: 'common-core-rank-02' } },
			{ validated_at: '2024-01-01T00:00:00.000Z', quest: { slug: 'common-core-rank-00' } },
			{ validated_at: '2024-01-01T00:00:00.000Z', quest: { slug: 'common-core-rank-00' } },
		])).toEqual(['common-core-rank-00', 'common-core-rank-01']);
	});
});

describe('judgeProjectAvailability', () => {
	describe('cub3d', () => {
		test('rank-03 まで達成し、cub3d も minirt も未登録なら available', () => {
			expect(judgeProjectAvailability(cub3d, progress({}, RANK3_QUESTS))).toEqual({ state: 'available', reason: null });
		});

		test('不合格で終わっていれば再び available', () => {
			expect(judgeProjectAvailability(cub3d, progress({ cub3d: { status: 'finished', validated: false } }, RANK3_QUESTS)).state).toBe('available');
		});

		test.each(['searching_a_group', 'creating_group', 'in_progress', 'waiting_for_correction'])('状態が %s なら in_progress', (status) => {
			expect(judgeProjectAvailability(cub3d, progress({ cub3d: { status, validated: null } }, RANK3_QUESTS))).toEqual({ state: 'in_progress', reason: 'registered' });
		});

		test('達成済みの課題に再挑戦している場合も in_progress', () => {
			expect(judgeProjectAvailability(cub3d, progress({ cub3d: { status: 'searching_a_group', validated: true } }, RANK3_QUESTS)).state).toBe('in_progress');
		});

		test('達成済みなら finished (rank-04 を達成していても)', () => {
			expect(judgeProjectAvailability(cub3d, progress({ cub3d: { status: 'finished', validated: true } }, [...RANK3_QUESTS, 'common-core-rank-04']))).toEqual({ state: 'finished', reason: 'validated' });
		});

		test('同等の課題 (minirt) を達成済みなら finished', () => {
			expect(judgeProjectAvailability(cub3d, progress({ minirt: { status: 'finished', validated: true } }, [...RANK3_QUESTS, 'common-core-rank-04']))).toEqual({ state: 'finished', reason: 'equivalentValidated' });
		});

		test('同等の課題 (minirt) に再挑戦中でも、前回達成していれば finished', () => {
			expect(judgeProjectAvailability(cub3d, progress({ minirt: { status: 'creating_group', validated: true } }, RANK3_QUESTS)).state).toBe('finished');
		});

		test('同等の課題 (minirt) に登録中なら locked', () => {
			expect(judgeProjectAvailability(cub3d, progress({ minirt: { status: 'in_progress', validated: null } }, RANK3_QUESTS))).toEqual({ state: 'locked', reason: 'equivalentInProgress' });
		});

		test('rank-03 が未達成なら locked', () => {
			expect(judgeProjectAvailability(cub3d, progress({}, ['common-core-rank-00', 'common-core-rank-01', 'common-core-rank-02']))).toEqual({ state: 'locked', reason: 'requiredQuestMissing' });
		});

		test('cub3d も minirt もせずに rank-04 を達成している (その段階を過ぎた) なら locked', () => {
			expect(judgeProjectAvailability(cub3d, progress({}, [...RANK3_QUESTS, 'common-core-rank-04']))).toEqual({ state: 'locked', reason: 'forbiddenQuestValidated' });
		});

		test('別の課程 (42next) なら locked', () => {
			expect(judgeProjectAvailability(cub3d, progress({}, [...RANK3_QUESTS, '42next'])).reason).toBe('forbiddenQuestValidated');
		});
	});

	describe('ft_transcendence', () => {
		const RANK5_QUESTS = [...RANK3_QUESTS, 'common-core-rank-04', 'common-core-rank-05'];

		test('rank-05 を達成し、common-core が未達成なら available', () => {
			expect(judgeProjectAvailability(transcendence, progress({ webserv: { status: 'finished', validated: true } }, RANK5_QUESTS)).state).toBe('available');
		});

		test('common-core を達成していれば (ft_transcendence を達成していなくても) locked', () => {
			expect(judgeProjectAvailability(transcendence, progress({}, [...RANK5_QUESTS, 'common-core'])).reason).toBe('forbiddenQuestValidated');
		});

		test('達成済みなら common-core を達成していても finished', () => {
			expect(judgeProjectAvailability(transcendence, progress({ ft_transcendence: { status: 'finished', validated: true } }, [...RANK5_QUESTS, 'common-core'])).state).toBe('finished');
		});

		test('rank-05 が未達成なら locked', () => {
			expect(judgeProjectAvailability(transcendence, progress({}, RANK3_QUESTS)).reason).toBe('requiredQuestMissing');
		});
	});

	describe('42cursus-minishell', () => {
		test('rank-02 を達成し、rank-03 が未達成なら available', () => {
			expect(judgeProjectAvailability(minishell, progress({}, ['common-core-rank-00', 'common-core-rank-01', 'common-core-rank-02'])).state).toBe('available');
		});

		test('登録中なら in_progress', () => {
			expect(judgeProjectAvailability(minishell, progress({ '42cursus-minishell': { status: 'searching_a_group', validated: null } }, ['common-core-rank-02'])).state).toBe('in_progress');
		});

		test('rank-03 を達成していて minishell を達成していなければ locked、達成していれば finished', () => {
			const quests = ['common-core-rank-02', 'common-core-rank-03'];
			expect(judgeProjectAvailability(minishell, progress({}, quests)).state).toBe('locked');
			expect(judgeProjectAvailability(minishell, progress({ '42cursus-minishell': { status: 'finished', validated: true } }, quests)).state).toBe('finished');
		});
	});

	test('QuestOrQuestValidated はどれか 1 つ、ProjectsValidated はすべて達成が必要', () => {
		const override = { slug: '42cursus-override', ...extractProjectRequirements([
			rule('inscription', 'QuestOrQuestValidated', ['42-to-42cursus-transfert common-core']),
			rule('group_validation', 'GroupSizeBetweenNAndM', ['2', '2']),
			rule('inscription', 'ProjectsValidated', ['42cursus-rainfall']),
		]) };
		const rainfall = { '42cursus-rainfall': { status: 'finished', validated: true } };

		expect(judgeProjectAvailability(override, progress(rainfall, ['42-to-42cursus-transfert'])).state).toBe('available');
		expect(judgeProjectAvailability(override, progress(rainfall, ['common-core'])).state).toBe('available');
		expect(judgeProjectAvailability(override, progress(rainfall, ['common-core-rank-05']))).toEqual({ state: 'locked', reason: 'requiredQuestMissing' });
		expect(judgeProjectAvailability(override, progress({}, ['common-core']))).toEqual({ state: 'locked', reason: 'requiredProjectMissing' });
	});
});
