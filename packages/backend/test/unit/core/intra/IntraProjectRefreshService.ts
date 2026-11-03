/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// DB や 42 API を使わず、依存をすべて差し替えて IntraProjectRefreshService の分岐を確認する

import { beforeEach, describe, expect, test, vi } from 'vitest';
import {
	IntraNotLinkedError,
	IntraProjectRefreshService,
	IntraRefreshInProgressError,
} from '@/core/intra/IntraProjectRefreshService.js';

describe('IntraProjectRefreshService', () => {
	let intraId: number | null;
	let syncCalls: string[];
	let syncResult: { resolve: () => void; reject: (err: Error) => void } | null;
	let notifications: { userId: string; type: string; data: Record<string, unknown> }[];
	let service: IntraProjectRefreshService;

	beforeEach(() => {
		intraId = 1;
		syncCalls = [];
		syncResult = null;
		notifications = [];

		const noop = () => {};
		service = new IntraProjectRefreshService(
			{ findOne: async () => ({ userId: 'u1', intraId }) } as any,
			{
				syncUser: (userId: string) => {
					syncCalls.push(userId);
					return new Promise<void>((resolve, reject) => {
						syncResult = { resolve, reject };
					});
				},
			} as any,
			{ createNotification: (userId: string, type: string, data: Record<string, unknown>) => { notifications.push({ userId, type, data }); } } as any,
			{ getLogger: () => ({ info: noop, warn: noop, error: noop, debug: noop }) } as any,
		);
	});

	test('取得を待たずに返し、終わったら通知する', async () => {
		await service.requestRefresh('u1');
		expect(syncCalls).toEqual(['u1']);
		expect(notifications).toEqual([]);

		syncResult!.resolve();
		await vi.waitFor(() => expect(notifications).toEqual([{ userId: 'u1', type: 'intraProjectsRefreshed', data: { failed: false } }]));
	});

	test('取得に失敗したら failed を付けて通知し、もう一度頼める', async () => {
		await service.requestRefresh('u1');
		syncResult!.reject(new Error('timeout'));
		await vi.waitFor(() => expect(notifications).toEqual([{ userId: 'u1', type: 'intraProjectsRefreshed', data: { failed: true } }]));

		await service.requestRefresh('u1');
		expect(syncCalls).toEqual(['u1', 'u1']);
	});

	test('取得中にもう一度頼まれたら断る', async () => {
		await service.requestRefresh('u1');
		await expect(service.requestRefresh('u1')).rejects.toBeInstanceOf(IntraRefreshInProgressError);
		expect(syncCalls).toEqual(['u1']);
	});

	test('intra と連携していなければ断る', async () => {
		intraId = null;
		await expect(service.requestRefresh('u1')).rejects.toBeInstanceOf(IntraNotLinkedError);
		expect(syncCalls).toEqual([]);
	});
});
