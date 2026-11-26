/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// 42 API を差し替えて IntraCoalitionService の分岐を確認する

import { beforeEach, describe, expect, test, vi } from 'vitest';
import { IntraCoalitionService } from '@/core/intra/IntraCoalitionService.js';
import type { IntraBloc, IntraCoalitionUser } from '@/core/intra/intra-coalition.js';
import type { Config } from '@/config.js';

const TOKYO = 26;
const CURSUS_42 = 21;

describe('IntraCoalitionService', () => {
	let blocs: IntraBloc[] | Error;
	let coalitionUsers: Map<number, IntraCoalitionUser[]>;
	let blocsCalls: number;
	let coalitionsUsersCalls: number;
	let service: IntraCoalitionService;

	beforeEach(() => {
		vi.useRealTimers();
		blocs = [{ id: 1, campus_id: TOKYO, cursus_id: CURSUS_42, coalitions: [{ id: 301, name: 'Fuji', color: '#FF6950' }] }];
		coalitionUsers = new Map([[1000, [{ coalition_id: 301, created_at: '2023-10-02T00:00:00.000Z' }]]]);
		blocsCalls = 0;
		coalitionsUsersCalls = 0;

		const fakeIntraApiService = {
			getCampusBlocs: async () => {
				blocsCalls++;
				if (blocs instanceof Error) throw blocs;
				return blocs;
			},
			getCoalitionsUsers: async (intraId: number) => {
				coalitionsUsersCalls++;
				return coalitionUsers.get(intraId) ?? null;
			},
		};
		const noop = () => {};
		service = new IntraCoalitionService(
			{ intra: { cursusId: CURSUS_42 } } as Config,
			fakeIntraApiService as any,
			{ getLogger: () => ({ info: noop, warn: noop, error: noop, debug: noop }) } as any,
		);
	});

	test('ユーザーのコアリションを返し、bloc は覚えておく', async () => {
		expect((await service.getUserCoalition(1000, TOKYO))?.name).toBe('Fuji');
		expect(await service.getUserCoalition(2000, TOKYO)).toBeNull();
		expect(blocsCalls).toBe(1);
	});

	test('キャンパスが無いか、キャンパスにコアリションが無ければ所属を取得しない', async () => {
		expect(await service.getUserCoalition(1000, null)).toBeNull();
		expect(await service.getUserCoalition(1000, 1)).toBeNull();
		expect(coalitionsUsersCalls).toBe(0);
	});

	test('bloc を取り直せなければ古いものを使い、一度も取得できていなければ例外', async () => {
		vi.useFakeTimers();
		await service.getUserCoalition(1000, TOKYO);
		blocs = new Error('42 API is down');
		vi.advanceTimersByTime(25 * 60 * 60 * 1000);

		expect((await service.getUserCoalition(1000, TOKYO))?.name).toBe('Fuji');
		expect(blocsCalls).toBe(2);
		await expect(service.getUserCoalition(1000, 1)).rejects.toThrow('42 API is down');
		vi.useRealTimers();
	});
});
