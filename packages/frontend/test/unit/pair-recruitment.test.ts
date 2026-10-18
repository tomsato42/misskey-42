/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'vitest';
import {
	canApply,
	getDaysUntil,
	getPairRecruitmentErrorText,
	getRemainingSlots,
	getTeamSizeRange,
	parsePairRecruitmentUrl,
} from '@/utility/pair-recruitment.js';

describe('parsePairRecruitmentUrl', () => {
	const local = 'https://42times.example.com';

	test('自分のインスタンスの /pair/<id> なら ID を返す', () => {
		expect(parsePairRecruitmentUrl('https://42times.example.com/pair/abc123', local)).toBe('abc123');
		expect(parsePairRecruitmentUrl('https://42times.example.com/pair/abc123/', local)).toBe('abc123');
		expect(parsePairRecruitmentUrl('https://42times.example.com/pair/abc123?x=1#y', local)).toBe('abc123');
	});

	test('別のホスト・別のパス・作成画面は null', () => {
		expect(parsePairRecruitmentUrl('https://other.example.com/pair/abc123', local)).toBeNull();
		expect(parsePairRecruitmentUrl('http://42times.example.com/pair/abc123', local)).toBeNull();
		expect(parsePairRecruitmentUrl('https://42times.example.com/pair/new', local)).toBeNull();
		expect(parsePairRecruitmentUrl('https://42times.example.com/pair', local)).toBeNull();
		expect(parsePairRecruitmentUrl('https://42times.example.com/pair/abc/edit', local)).toBeNull();
		expect(parsePairRecruitmentUrl('https://42times.example.com/notes/abc123', local)).toBeNull();
		expect(parsePairRecruitmentUrl('not a url', local)).toBeNull();
	});
});

describe('getRemainingSlots', () => {
	test('作成者と承認済みのメンバーを除いた人数', () => {
		expect(getRemainingSlots({ teamSize: 2, acceptedCount: 0 })).toBe(1);
		expect(getRemainingSlots({ teamSize: 4, acceptedCount: 1 })).toBe(2);
		expect(getRemainingSlots({ teamSize: 2, acceptedCount: 1 })).toBe(0);
		expect(getRemainingSlots({ teamSize: 2, acceptedCount: 5 })).toBe(0);
	});
});

describe('getDaysUntil', () => {
	const now = new Date('2026-10-18T00:00:00.000Z');

	test('残り日数を切り上げる', () => {
		expect(getDaysUntil('2026-11-01T00:00:00.000Z', now)).toBe(14);
		expect(getDaysUntil('2026-10-18T12:00:00.000Z', now)).toBe(1);
		expect(getDaysUntil('2026-10-19T00:00:01.000Z', now)).toBe(2);
	});

	test('過ぎていれば 0', () => {
		expect(getDaysUntil('2026-10-17T00:00:00.000Z', now)).toBe(0);
		expect(getDaysUntil('2026-10-18T00:00:00.000Z', now)).toBe(0);
	});
});

describe('canApply', () => {
	const base = {
		status: 'open',
		myStatus: null,
		myProjectState: 'available',
		teamSize: 2,
		acceptedCount: 0,
	} as const;

	test('募集中で、取り組める課題で、まだ参加希望を送っていなければ送れる', () => {
		expect(canApply(base)).toBe(true);
		expect(canApply({ ...base, myProjectState: 'in_progress' })).toBe(true);
		expect(canApply({ ...base, myStatus: 'withdrawn' })).toBe(true);
	});

	test('締め切り・人数がそろった・送信済み・取り組めない課題では送れない', () => {
		expect(canApply({ ...base, status: 'closed' })).toBe(false);
		expect(canApply({ ...base, acceptedCount: 1 })).toBe(false);
		expect(canApply({ ...base, myStatus: 'pending' })).toBe(false);
		expect(canApply({ ...base, myStatus: 'accepted' })).toBe(false);
		expect(canApply({ ...base, myStatus: 'rejected' })).toBe(false);
		expect(canApply({ ...base, myStatus: 'owner' })).toBe(false);
		expect(canApply({ ...base, myProjectState: 'locked' })).toBe(false);
		expect(canApply({ ...base, myProjectState: 'finished' })).toBe(false);
		expect(canApply({ ...base, myProjectState: null })).toBe(false);
	});
});

describe('getTeamSizeRange', () => {
	test('下限は 2 から、上限は課題の最大人数まで', () => {
		expect(getTeamSizeRange({ minGroupSize: 1, maxGroupSize: 4 })).toEqual([2, 3, 4]);
		expect(getTeamSizeRange({ minGroupSize: 3, maxGroupSize: 5 })).toEqual([3, 4, 5]);
		expect(getTeamSizeRange({ minGroupSize: 2, maxGroupSize: 2 })).toEqual([2]);
	});
});

describe('getPairRecruitmentErrorText', () => {
	test('知っているエラーコードは文に変える', () => {
		expect(getPairRecruitmentErrorText({ code: 'NO_CAMPUS' })).toEqual(expect.any(String));
		expect(getPairRecruitmentErrorText({ code: 'FULL' })).toEqual(expect.any(String));
	});

	test('知らないエラーは null', () => {
		expect(getPairRecruitmentErrorText({ code: 'INTERNAL_ERROR' })).toBeNull();
		expect(getPairRecruitmentErrorText({ code: 'toString' })).toBeNull();
		expect(getPairRecruitmentErrorText(null)).toBeNull();
		expect(getPairRecruitmentErrorText(new Error('x'))).toBeNull();
	});
});
