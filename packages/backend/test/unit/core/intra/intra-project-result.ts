/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'vitest';
import {
	RESULT_NOTIFICATION_WINDOW,
	countOutstandingFlags,
	extractProjectResults,
	extractTeamMembers,
	findNewlyMarkedResults,
} from '@/core/intra/intra-project-result.js';
import type { IntraProjectResultValues } from '@/core/intra/intra-project-result.js';
import type { IntraProjectUser } from '@/core/intra/intra-project.js';

function pu(overrides: Partial<IntraProjectUser> = {}): IntraProjectUser {
	return {
		id: 1,
		status: 'finished',
		'validated?': true,
		final_mark: 125,
		marked_at: '2026-10-18T10:00:00.000Z',
		current_team_id: 500,
		project: { id: 10, slug: 'webserv', name: 'webserv' },
		...overrides,
	};
}

function result(overrides: Partial<IntraProjectResultValues> = {}): IntraProjectResultValues {
	return {
		projectsUserId: 1,
		projectSlug: 'webserv',
		projectName: 'webserv',
		finalMark: 125,
		validated: true,
		markedAt: new Date('2026-10-18T10:00:00.000Z'),
		teamId: 500,
		...overrides,
	};
}

describe('extractProjectResults', () => {
	test('点数が付いた課題を、合否を問わず取り出す', () => {
		const results = extractProjectResults([
			pu(),
			pu({ id: 2, 'validated?': false, final_mark: 0, project: { id: 11, slug: 'ft_irc', name: 'ft_irc' } }),
		]);
		expect(results).toEqual([
			result(),
			result({ projectsUserId: 2, projectSlug: 'ft_irc', projectName: 'ft_irc', finalMark: 0, validated: false }),
		]);
	});

	test('点数が無い課題と ID が無い課題は除く', () => {
		expect(extractProjectResults([
			pu({ final_mark: null, status: 'in_progress' }),
			pu({ id: undefined }),
		])).toEqual([]);
	});

	test('課題の名前が無ければ slug を名前にし、日時が読めなければ null にする', () => {
		const [r] = extractProjectResults([pu({ marked_at: 'invalid', current_team_id: null, project: { id: 10, slug: 'libft' } })]);
		expect(r.projectName).toBe('libft');
		expect(r.markedAt).toBeNull();
		expect(r.teamId).toBeNull();
	});
});

describe('findNewlyMarkedResults', () => {
	const now = new Date('2026-10-19T10:00:00.000Z');

	test('初めて点数が付いた課題と、点数が付き直した課題を返す', () => {
		const fresh = result({ projectsUserId: 2 });
		const remarked = result({ projectsUserId: 3, finalMark: 100, markedAt: new Date('2026-10-19T09:00:00.000Z') });
		const unchanged = result({ projectsUserId: 4 });
		expect(findNewlyMarkedResults(
			[
				{ projectsUserId: 3, finalMark: 0, markedAt: new Date('2026-10-01T00:00:00.000Z') },
				{ projectsUserId: 4, finalMark: 125, markedAt: unchanged.markedAt },
			],
			[fresh, remarked, unchanged],
			now,
		)).toEqual([fresh, remarked]);
	});

	test('結果が出てから時間が経ったものと、日時が分からないものは返さない', () => {
		const old = result({ markedAt: new Date(now.getTime() - RESULT_NOTIFICATION_WINDOW - 1) });
		expect(findNewlyMarkedResults([], [old, result({ projectsUserId: 2, markedAt: null })], now)).toEqual([]);
	});
});

describe('extractTeamMembers', () => {
	test('メンバーの ID とログイン名を、重複を除いて取り出す', () => {
		expect(extractTeamMembers({
			id: 500,
			users: [
				{ id: 1, login: 'tomsato' },
				{ id: 2, login: 'hana' },
				{ id: 1, login: 'tomsato' },
				{ id: 3, login: '' },
			],
		})).toEqual([
			{ intraId: 1, login: 'tomsato' },
			{ intraId: 2, login: 'hana' },
		]);
	});

	test('メンバーが無ければ空', () => {
		expect(extractTeamMembers({ id: 500 })).toEqual([]);
	});
});

describe('countOutstandingFlags', () => {
	test('outstanding のフラグが付いた評価の数を数える', () => {
		expect(countOutstandingFlags([
			{ flag: { name: 'Outstanding project' } },
			{ flag: { name: 'Ok' } },
			{ flag: null },
			{},
			{ flag: { name: 'Outstanding project' } },
		])).toBe(2);
	});
});
