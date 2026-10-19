/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'vitest';
import {
	PairRecruitmentError,
	buildAnnouncementText,
	canSeeMember,
	canWorkOn,
	bestWantedState,
	combineWantedStates,
	formatStartTiming,
	getCommonTeamSizeRange,
	getOwnerIntraProjectUrl,
	judgeInvite,
	normalizeProjectSlugs,
	normalizeWantedProjectSlugs,
	planProjectChange,
	getEffectiveState,
	getTeamSizeRange,
	isRecruitmentOpen,
	isTeamFull,
	isValidTeamSize,
	judgeAccept,
	judgeApply,
	normalizeComment,
	normalizeStartDate,
	sortProjectsByState,
} from '@/core/pair/pair-recruitment.js';

const now = new Date('2026-10-18T03:00:00.000Z');
const future = new Date('2026-11-01T00:00:00.000Z');
const past = new Date('2026-10-01T00:00:00.000Z');

function expectCode(fn: () => unknown, code: string) {
	try {
		fn();
	} catch (err) {
		expect(err).toBeInstanceOf(PairRecruitmentError);
		expect((err as PairRecruitmentError).code).toBe(code);
		return;
	}
	throw new Error(`expected ${code}`);
}

describe('getTeamSizeRange / isValidTeamSize', () => {
	test('下限が無ければ 2 から', () => {
		expect(getTeamSizeRange({ minGroupSize: null, maxGroupSize: 3 })).toEqual({ min: 2, max: 3 });
	});

	test('下限が 1 でも 2 から', () => {
		expect(getTeamSizeRange({ minGroupSize: 1, maxGroupSize: 2 })).toEqual({ min: 2, max: 2 });
	});

	test('下限があればそれに従う', () => {
		expect(getTeamSizeRange({ minGroupSize: 4, maxGroupSize: 5 })).toEqual({ min: 4, max: 5 });
	});

	test('上限が無いか 1 人の課題は対象外', () => {
		expect(getTeamSizeRange({ minGroupSize: null, maxGroupSize: null })).toBeNull();
		expect(getTeamSizeRange({ minGroupSize: 1, maxGroupSize: 1 })).toBeNull();
	});

	test('範囲の内外', () => {
		const project = { minGroupSize: 4, maxGroupSize: 5 };
		expect(isValidTeamSize(project, 3)).toBe(false);
		expect(isValidTeamSize(project, 4)).toBe(true);
		expect(isValidTeamSize(project, 5)).toBe(true);
		expect(isValidTeamSize(project, 6)).toBe(false);
		expect(isValidTeamSize(project, 4.5)).toBe(false);
		expect(isValidTeamSize({ minGroupSize: null, maxGroupSize: null }, 2)).toBe(false);
	});
});

describe('canWorkOn / sortProjectsByState', () => {
	test('available と in_progress だけ取り組める', () => {
		expect(canWorkOn('available')).toBe(true);
		expect(canWorkOn('in_progress')).toBe(true);
		expect(canWorkOn('locked')).toBe(false);
		expect(canWorkOn('finished')).toBe(false);
		expect(canWorkOn(null)).toBe(false);
	});

	test('取り組める課題を上にし、同じ判定の中では名前順', () => {
		const sorted = sortProjectsByState([
			{ name: 'webserv', state: 'finished' as const },
			{ name: 'minishell', state: 'locked' as const },
			{ name: 'cub3d', state: 'in_progress' as const },
			{ name: 'ft_transcendence', state: 'available' as const },
			{ name: 'ft_irc', state: 'available' as const },
		]);
		expect(sorted.map(p => p.name)).toEqual(['ft_irc', 'ft_transcendence', 'cub3d', 'minishell', 'webserv']);
	});
});

describe('normalizeStartDate', () => {
	test('date 以外では日付を捨てる', () => {
		expect(normalizeStartDate('now', '2026-10-20', now)).toBeNull();
		expect(normalizeStartDate('nextWeek', null, now)).toBeNull();
	});

	test('date では実在する日付が必要', () => {
		expect(normalizeStartDate('date', '2026-10-20', now)).toBe('2026-10-20');
		expectCode(() => normalizeStartDate('date', null, now), 'invalidStartDate');
		expectCode(() => normalizeStartDate('date', '2026/10/20', now), 'invalidStartDate');
		expectCode(() => normalizeStartDate('date', '2026-02-30', now), 'invalidStartDate');
	});

	test('昨日から 366 日後まで', () => {
		expect(normalizeStartDate('date', '2026-10-17', now)).toBe('2026-10-17');
		expectCode(() => normalizeStartDate('date', '2026-10-16', now), 'invalidStartDate');
		expect(normalizeStartDate('date', '2027-10-19', now)).toBe('2027-10-19');
		expectCode(() => normalizeStartDate('date', '2027-10-20', now), 'invalidStartDate');
	});
});

describe('normalizeComment', () => {
	test('前後の空白を除き、空なら null', () => {
		expect(normalizeComment('  よろしく  ')).toBe('よろしく');
		expect(normalizeComment('   ')).toBeNull();
		expect(normalizeComment(null)).toBeNull();
	});

	test('500 文字まで', () => {
		expect(normalizeComment('a'.repeat(500))).toHaveLength(500);
		expectCode(() => normalizeComment('a'.repeat(501)), 'commentTooLong');
	});
});

describe('締め切りの判定', () => {
	test('open でも期限を過ぎていれば募集中ではない', () => {
		expect(isRecruitmentOpen({ status: 'open', expiresAt: future }, now)).toBe(true);
		expect(isRecruitmentOpen({ status: 'open', expiresAt: past }, now)).toBe(false);
		expect(isRecruitmentOpen({ status: 'closed', expiresAt: future }, now)).toBe(false);
	});

	test('期限を過ぎた open は expired で締め切ったものとして表示する', () => {
		expect(getEffectiveState({ status: 'open', closedReason: null, closedAt: null, expiresAt: past }, now))
			.toEqual({ status: 'closed', closedReason: 'expired', closedAt: past });
		expect(getEffectiveState({ status: 'open', closedReason: null, closedAt: null, expiresAt: future }, now))
			.toEqual({ status: 'open', closedReason: null, closedAt: null });
		expect(getEffectiveState({ status: 'closed', closedReason: 'manual', closedAt: now, expiresAt: future }, now))
			.toEqual({ status: 'closed', closedReason: 'manual', closedAt: now });
	});

	test('承認済みの人数と作成者で人数がそろう', () => {
		expect(isTeamFull(2, 0)).toBe(false);
		expect(isTeamFull(2, 1)).toBe(true);
		expect(isTeamFull(4, 2)).toBe(false);
		expect(isTeamFull(4, 3)).toBe(true);
	});
});

describe('judgeApply', () => {
	const recruitment = { userId: 'owner', status: 'open' as const, expiresAt: future, teamSize: 3, acceptedCount: 0 };
	const base = { recruitment, applicantId: 'alice', existingStatus: null, state: 'available' as const, now };

	test('送れる', () => {
		expect(judgeApply(base)).toBeNull();
		expect(judgeApply({ ...base, state: 'in_progress' })).toBeNull();
		// 取り下げた後はもう一度送れる
		expect(judgeApply({ ...base, existingStatus: 'withdrawn' })).toBeNull();
	});

	test('自分の募集には送れない', () => {
		expect(judgeApply({ ...base, applicantId: 'owner' })).toBe('cannotApplyOwn');
	});

	test('締め切った・期限切れの募集には送れない', () => {
		expect(judgeApply({ ...base, recruitment: { ...recruitment, status: 'closed' } })).toBe('recruitmentClosed');
		expect(judgeApply({ ...base, recruitment: { ...recruitment, expiresAt: past } })).toBe('recruitmentClosed');
	});

	test('二重に送れず、見送られたら再び送れない', () => {
		expect(judgeApply({ ...base, existingStatus: 'pending' })).toBe('alreadyApplied');
		expect(judgeApply({ ...base, existingStatus: 'accepted' })).toBe('alreadyApplied');
		expect(judgeApply({ ...base, existingStatus: 'rejected' })).toBe('rejectedBefore');
	});

	test('人数がそろっていれば送れない', () => {
		expect(judgeApply({ ...base, recruitment: { ...recruitment, acceptedCount: 2 } })).toBe('full');
	});

	test('locked と finished と判定できない人は送れない', () => {
		expect(judgeApply({ ...base, state: 'locked' })).toBe('projectNotAvailable');
		expect(judgeApply({ ...base, state: 'finished' })).toBe('projectNotAvailable');
		expect(judgeApply({ ...base, state: null })).toBe('projectNotAvailable');
	});
});

describe('judgeAccept', () => {
	const recruitment = { userId: 'owner', status: 'open' as const, expiresAt: future, teamSize: 2, acceptedCount: 0 };
	const base = { recruitment, actorId: 'owner', memberStatus: 'pending' as const, applicantState: 'available' as const, now };

	test('承認できる', () => {
		expect(judgeAccept(base)).toBeNull();
	});

	test('作成者だけ', () => {
		expect(judgeAccept({ ...base, actorId: 'alice' })).toBe('notOwner');
	});

	test('参加希望中の人だけ', () => {
		expect(judgeAccept({ ...base, memberStatus: null })).toBe('noSuchApplication');
		expect(judgeAccept({ ...base, memberStatus: 'accepted' })).toBe('noSuchApplication');
		expect(judgeAccept({ ...base, memberStatus: 'rejected' })).toBe('noSuchApplication');
	});

	test('締め切った募集・人数がそろった募集では承認できない', () => {
		expect(judgeAccept({ ...base, recruitment: { ...recruitment, status: 'closed' } })).toBe('recruitmentClosed');
		expect(judgeAccept({ ...base, recruitment: { ...recruitment, acceptedCount: 1 } })).toBe('full');
	});

	test('locked や finished になった人は承認できない', () => {
		expect(judgeAccept({ ...base, applicantState: 'locked' })).toBe('applicantNotAvailable');
		expect(judgeAccept({ ...base, applicantState: 'finished' })).toBe('applicantNotAvailable');
		expect(judgeAccept({ ...base, applicantState: null })).toBe('applicantNotAvailable');
	});
});

describe('canSeeMember', () => {
	const base = { ownerId: 'owner', memberUserId: 'alice' };

	test('承認済みは誰にでも見せる', () => {
		expect(canSeeMember({ ...base, viewerId: 'bob', memberStatus: 'accepted' })).toBe(true);
	});

	test('参加希望中は作成者と本人にだけ見せる', () => {
		expect(canSeeMember({ ...base, viewerId: 'owner', memberStatus: 'pending' })).toBe(true);
		expect(canSeeMember({ ...base, viewerId: 'alice', memberStatus: 'pending' })).toBe(true);
		expect(canSeeMember({ ...base, viewerId: 'bob', memberStatus: 'pending' })).toBe(false);
		expect(canSeeMember({ ...base, viewerId: 'bob', memberStatus: 'rejected' })).toBe(false);
	});

	test('取り下げた人は本人にだけ見せる', () => {
		expect(canSeeMember({ ...base, viewerId: 'owner', memberStatus: 'withdrawn' })).toBe(false);
		expect(canSeeMember({ ...base, viewerId: 'alice', memberStatus: 'withdrawn' })).toBe(true);
	});
});

describe('告知の文面', () => {
	test('始める時期', () => {
		expect(formatStartTiming('now', null, now)).toBe('今すぐ');
		expect(formatStartTiming('nextWeek', null, now)).toBe('来週から');
		expect(formatStartTiming('nextMonth', null, now)).toBe('来月から');
		expect(formatStartTiming('date', '2026-10-25', now)).toBe('10月25日から');
		expect(formatStartTiming('date', '2027-01-05', now)).toBe('2027年1月5日から');
	});

	test('課題名・人数・始める時期・ひとこと・URL を含む', () => {
		expect(buildAnnouncementText({
			projectName: 'ft_transcendence',
			teamSize: 4,
			startTiming: 'nextWeek',
			startDate: null,
			comment: 'TypeScript で書きたいです',
			url: 'https://example.com/pair/abc',
			now,
		})).toBe([
			'【ペア募集】ft_transcendence',
			'人数: 4 人 (あと 3 人)',
			'始める時期: 来週から',
			'',
			'TypeScript で書きたいです',
			'',
			'https://example.com/pair/abc',
		].join('\n'));
	});

	test('ひとことが無ければその行を出さない', () => {
		expect(buildAnnouncementText({
			projectName: 'cub3d',
			teamSize: 2,
			startTiming: 'now',
			startDate: null,
			comment: null,
			url: 'https://example.com/pair/abc',
			now,
		})).toBe('【ペア募集】cub3d\n人数: 2 人 (あと 1 人)\n始める時期: 今すぐ\n\nhttps://example.com/pair/abc');
	});
});

describe('getOwnerIntraProjectUrl', () => {
	const statuses = { '42cursus-minishell': { status: 'finished', validated: true } };

	test('登録したことがある課題なら、intra の課題のページの URL を返す', () => {
		expect(getOwnerIntraProjectUrl('42cursus-minishell', 'tomsato', statuses)).toBe('https://projects.intra.42.fr/42cursus-minishell/tomsato');
	});

	test('登録したことが無い課題・ログイン名が無い・課題の状態が無いときは null', () => {
		expect(getOwnerIntraProjectUrl('42cursus-cloud-1', 'tomsato', statuses)).toBeNull();
		expect(getOwnerIntraProjectUrl('42cursus-minishell', null, statuses)).toBeNull();
		expect(getOwnerIntraProjectUrl('42cursus-minishell', '', statuses)).toBeNull();
		expect(getOwnerIntraProjectUrl('42cursus-minishell', 'tomsato', null)).toBeNull();
	});

	test('プロトタイプのプロパティ名の課題を、登録済みと見なさない', () => {
		expect(getOwnerIntraProjectUrl('constructor', 'tomsato', {})).toBeNull();
	});
});

describe('複数の課題', () => {
	test('getCommonTeamSizeRange は範囲の重なりを返す', () => {
		expect(getCommonTeamSizeRange([{ minGroupSize: null, maxGroupSize: 3 }, { minGroupSize: 2, maxGroupSize: 2 }])).toEqual({ min: 2, max: 2 });
		expect(getCommonTeamSizeRange([{ minGroupSize: null, maxGroupSize: 2 }, { minGroupSize: 4, maxGroupSize: 5 }])).toBeNull();
		expect(getCommonTeamSizeRange([{ minGroupSize: null, maxGroupSize: 3 }, { minGroupSize: 1, maxGroupSize: 1 }])).toBeNull();
		expect(getCommonTeamSizeRange([])).toBeNull();
	});

	test('normalizeProjectSlugs は空・重複・多すぎるものを拒む', () => {
		expect(normalizeProjectSlugs(['a', 'b'])).toEqual(['a', 'b']);
		expectCode(() => normalizeProjectSlugs([]), 'invalidProjects');
		expectCode(() => normalizeProjectSlugs(['a', 'a']), 'invalidProjects');
		expectCode(() => normalizeProjectSlugs(['a', 'b', 'c', 'd', 'e']), 'tooManyProjects');
	});

	test('normalizeWantedProjectSlugs は、指定が無ければ取り組める課題すべて、指定があれば募集の並び順にそろえる', () => {
		const states = { a: 'available', b: 'finished', c: 'in_progress' } as const;
		expect(normalizeWantedProjectSlugs({ wanted: null, recruitmentSlugs: ['a', 'b', 'c'], states })).toEqual(['a', 'c']);
		expect(normalizeWantedProjectSlugs({ wanted: ['c', 'a'], recruitmentSlugs: ['a', 'b', 'c'], states })).toEqual(['a', 'c']);
		expectCode(() => normalizeWantedProjectSlugs({ wanted: [], recruitmentSlugs: ['a'], states }), 'invalidWantedProjects');
		expectCode(() => normalizeWantedProjectSlugs({ wanted: ['x'], recruitmentSlugs: ['a'], states }), 'invalidWantedProjects');
		expectCode(() => normalizeWantedProjectSlugs({ wanted: null, recruitmentSlugs: ['b'], states }), 'projectNotAvailable');
	});

	test('combineWantedStates は取り組めない課題を優先し、bestWantedState は取り組める課題を優先する', () => {
		expect(combineWantedStates(['available', 'locked'])).toBe('locked');
		expect(combineWantedStates(['in_progress', 'available'])).toBe('in_progress');
		expect(combineWantedStates([])).toBeNull();
		expect(bestWantedState(['finished', 'available'])).toBe('available');
		expect(bestWantedState(['finished', 'locked'])).toBe('finished');
		expect(bestWantedState([])).toBeNull();
	});

	test('planProjectChange は外れる課題だけの参加希望を取り下げ、参加が決まった人の課題がすべて外れるなら拒む', () => {
		const plan = planProjectChange({
			newSlugs: ['a'],
			members: [
				{ userId: 'u1', status: 'pending', wantedProjectSlugs: ['a', 'b'] },
				{ userId: 'u2', status: 'pending', wantedProjectSlugs: ['b'] },
				{ userId: 'u3', status: 'accepted', wantedProjectSlugs: ['a'] },
				{ userId: 'u4', status: 'invited', wantedProjectSlugs: [] },
			],
		});
		expect(plan.withdrawUserIds).toEqual(['u2']);
		expect([...plan.wanted]).toEqual([['u1', ['a']]]);
		expectCode(() => planProjectChange({ newSlugs: ['a'], members: [{ userId: 'u', status: 'accepted', wantedProjectSlugs: ['b'] }] }), 'memberWouldLoseProject');
	});

	test('judgeInvite', () => {
		const recruitment = { status: 'open' as const, expiresAt: future, userId: 'owner', teamSize: 2, acceptedCount: 0 };
		const base = { recruitment, actorId: 'owner', inviteeId: 'u', existingStatus: null, acceptsInvitations: true, states: ['available' as const], now };
		expect(judgeInvite(base)).toBeNull();
		expect(judgeInvite({ ...base, actorId: 'x' })).toBe('notOwner');
		expect(judgeInvite({ ...base, recruitment: { ...recruitment, expiresAt: past } })).toBe('recruitmentClosed');
		expect(judgeInvite({ ...base, recruitment: { ...recruitment, acceptedCount: 1 } })).toBe('full');
		expect(judgeInvite({ ...base, inviteeId: 'owner' })).toBe('cannotInvite');
		expect(judgeInvite({ ...base, existingStatus: 'invited' })).toBe('cannotInvite');
		expect(judgeInvite({ ...base, existingStatus: 'withdrawn' })).toBeNull();
		expect(judgeInvite({ ...base, acceptsInvitations: false })).toBe('cannotInvite');
		expect(judgeInvite({ ...base, states: ['finished', null] })).toBe('cannotInvite');
	});

	test('招待された人と断った人は参加希望を送れる', () => {
		const recruitment = { status: 'open' as const, expiresAt: future, userId: 'owner', teamSize: 2, acceptedCount: 0 };
		expect(judgeApply({ recruitment, applicantId: 'u', existingStatus: 'invited', state: 'available', now })).toBeNull();
		expect(judgeApply({ recruitment, applicantId: 'u', existingStatus: 'declined', state: 'available', now })).toBeNull();
	});
});
