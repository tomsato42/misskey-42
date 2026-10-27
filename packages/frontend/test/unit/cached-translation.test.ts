/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'vitest';
import { MAX_TRANSLATION_BATCH, createTranslationBatcher } from '@/utility/cached-translation.js';

describe('createTranslationBatcher', () => {
	test('同じタスクで表示されたノートをまとめて問い合わせ、訳の無いノートは null', async () => {
		const calls: string[][] = [];
		const { load, set } = createTranslationBatcher(async noteIds => {
			calls.push(noteIds);
			return [{ noteId: 'a', sourceLang: 'JA', text: 'Hello' }];
		});

		const [a, b] = await Promise.all([load({ id: 'a' }), load({ id: 'b' })]);
		expect(a).toEqual({ sourceLang: 'JA', text: 'Hello' });
		expect(b).toBeNull();
		expect(calls).toEqual([['a', 'b']]);
	});

	test('一度問い合わせたノートは問い合わせ直さない', async () => {
		let count = 0;
		const { load, set } = createTranslationBatcher(async () => { count++; return []; });
		await load({ id: 'a' });
		await load({ id: 'a' });
		expect(count).toBe(1);
	});

	test('上限の件数ずつに分ける', async () => {
		const calls: string[][] = [];
		const { load, set } = createTranslationBatcher(async noteIds => { calls.push(noteIds); return []; });
		await Promise.all(Array.from({ length: MAX_TRANSLATION_BATCH + 1 }, (_, i) => load({ id: `n${i}` })));
		expect(calls.map(it => it.length)).toEqual([MAX_TRANSLATION_BATCH, 1]);
	});

	test('失敗したら null にし、次はまた問い合わせる', async () => {
		let fail = true;
		const { load, set } = createTranslationBatcher(async noteIds => {
			if (fail) throw new Error('failed');
			return noteIds.map(noteId => ({ noteId, sourceLang: 'EN', text: '訳' }));
		});
		expect(await load({ id: 'a' })).toBeNull();
		fail = false;
		expect(await load({ id: 'a' })).toEqual({ sourceLang: 'EN', text: '訳' });
	});

	test('編集されたら、前の版の訳は使わずに問い合わせ直す', async () => {
		const calls: string[][] = [];
		const { load } = createTranslationBatcher(async noteIds => { calls.push(noteIds); return []; });
		await load({ id: 'a' });
		await load({ id: 'a', updatedAt: '2026-10-26T00:00:00.000Z' });
		expect(calls).toEqual([['a'], ['a']]);
	});

	test('メニューから訳した結果は、次に表示したときも出す', async () => {
		const { load, set } = createTranslationBatcher(async () => []);
		expect(await load({ id: 'a' })).toBeNull();
		set({ id: 'a' }, { sourceLang: 'JA', text: 'Hello' });
		expect(await load({ id: 'a' })).toEqual({ sourceLang: 'JA', text: 'Hello' });
	});
});
