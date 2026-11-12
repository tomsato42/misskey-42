/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// DB を使わず、依存をすべて差し替えて IntraLevelNoteService の判定を確認する

import { beforeEach, describe, expect, test } from 'vitest';
import { IntraLevelNoteService, IntraLevelNotReachedError } from '@/core/intra/IntraLevelNoteService.js';
import { IntraProjectResultNotAttachableError } from '@/core/intra/IntraProjectResultService.js';
import type { MiNote } from '@/models/Note.js';

type FakeAssignment = { userId: string; roleId: string; expiresAt: Date | null };
type FakeIntraRole = { roleId: string; kind: string; key: string };

describe('IntraLevelNoteService', () => {
	let assignments: FakeAssignment[];
	let intraRoles: FakeIntraRole[];
	let inserted: { noteId: string; userId: string; level: number }[];
	let service: IntraLevelNoteService;

	beforeEach(() => {
		assignments = [];
		intraRoles = [
			{ roleId: 'lv4', kind: 'level', key: '4' },
			{ roleId: 'lv6', kind: 'level', key: '6' },
			{ roleId: 'tokyo', kind: 'campus', key: '26' },
		];
		inserted = [];

		service = new IntraLevelNoteService(
			{ insert: async (row: { noteId: string; userId: string; level: number }) => { inserted.push(row); } } as any,
			{
				findBy: async (where: { kind: string; roleId: { _value: string[] } }) =>
					intraRoles.filter(r => r.kind === where.kind && where.roleId._value.includes(r.roleId)),
			} as any,
			{ findBy: async (where: { userId: string }) => assignments.filter(a => a.userId === where.userId) } as any,
		);
	});

	test('付いているレベルのロールのうち最も高いものが今のレベル', async () => {
		assignments.push({ userId: 'u1', roleId: 'lv4', expiresAt: null }, { userId: 'u1', roleId: 'lv6', expiresAt: null }, { userId: 'u1', roleId: 'tokyo', expiresAt: null });
		expect(await service.getCurrentLevel('u1')).toBe(6);
	});

	test('期限切れのロールは数えず、レベルのロールが無ければ null', async () => {
		assignments.push({ userId: 'u1', roleId: 'lv6', expiresAt: new Date(Date.now() - 1000) }, { userId: 'u1', roleId: 'tokyo', expiresAt: null });
		expect(await service.getCurrentLevel('u1')).toBeNull();
		expect(await service.getCurrentLevel('u2')).toBeNull();
	});

	test('今のレベル以下なら、ノートを作った後にレベルを保存する', async () => {
		assignments.push({ userId: 'u1', roleId: 'lv6', expiresAt: null });
		const onInserted = await service.prepareNote({ id: 'u1' }, 5, { text: null, hasPoll: false });
		expect(onInserted).not.toBeNull();
		await onInserted!({ id: 'n1' } as MiNote);
		expect(inserted).toEqual([{ noteId: 'n1', userId: 'u1', level: 5 }]);
	});

	test('レベルを指定しなければ何もしない', async () => {
		expect(await service.prepareNote({ id: 'u1' }, null, { hasPoll: false })).toBeNull();
		expect(await service.prepareNote({ id: 'u1' }, undefined, { hasPoll: false })).toBeNull();
	});

	test('今のレベルより上や、レベルのロールが無ければ付けられない', async () => {
		assignments.push({ userId: 'u1', roleId: 'lv6', expiresAt: null });
		await expect(service.prepareNote({ id: 'u1' }, 7, { hasPoll: false })).rejects.toBeInstanceOf(IntraLevelNotReachedError);
		await expect(service.prepareNote({ id: 'u2' }, 0, { hasPoll: false })).rejects.toBeInstanceOf(IntraLevelNotReachedError);
	});

	test('本文などの無いリノートには付けられない', async () => {
		assignments.push({ userId: 'u1', roleId: 'lv6', expiresAt: null });
		await expect(service.prepareNote({ id: 'u1' }, 6, { renoteId: 'r1', text: null, fileIds: [], hasPoll: false })).rejects.toBeInstanceOf(IntraProjectResultNotAttachableError);
	});
});
