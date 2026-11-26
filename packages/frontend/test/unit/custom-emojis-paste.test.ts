/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'vitest';
import { emojiNameFromUrl, mapWithConcurrency, parsePastedEmojis } from '@/pages/admin/custom-emojis-manager.impl.js';

describe('parsePastedEmojis', () => {
	test('登録済みの一覧で全部の列をコピーした行を読む', () => {
		const text = [
			'https://example.com/files/a.gif\tsupertada\t\t\t\tfalse\tfalse\t[]\timage/gif\t2026-10-23T18:14:49.005Z\thttps://example.com/files/a.gif\thttps://example.com/files/a-original.gif',
			'https://example.com/files/b.webp\tblob_ko\tblob\tblob ko\t@kouki_rndu \ttrue\ttrue\t[{"id":"9xyz","name":"role"}]\timage/webp\t2026-10-23T18:14:23.038Z\thttps://example.com/files/b.webp\thttps://example.com/files/b.webp',
		].join('\r\n');

		expect(parsePastedEmojis(text)).toEqual([
			{
				url: 'https://example.com/files/a-original.gif',
				name: 'supertada',
				category: null,
				aliases: [],
				license: null,
				isSensitive: false,
				localOnly: false,
			},
			{
				url: 'https://example.com/files/b.webp',
				name: 'blob_ko',
				category: 'blob',
				aliases: ['blob', 'ko'],
				license: '@kouki_rndu',
				isSensitive: true,
				localOnly: true,
			},
		]);
	});

	test('url から途中の列までのコピーも読む', () => {
		expect(parsePastedEmojis('https://example.com/a.png\totukare\tgreeting')).toEqual([{
			url: 'https://example.com/a.png',
			name: 'otukare',
			category: 'greeting',
			aliases: [],
			license: null,
			isSensitive: false,
			localOnly: false,
		}]);
	});

	test('URL だけの行はファイル名を名前にする', () => {
		expect(parsePastedEmojis('https://example.com/emoji/claude-thinking.gif\n\n')).toEqual([{
			url: 'https://example.com/emoji/claude-thinking.gif',
			name: 'claude_thinking',
			category: null,
			aliases: [],
			license: null,
			isSensitive: false,
			localOnly: false,
		}]);
	});

	test('URL で始まらない行・名前に使えない行・同じ名前の 2 つ目以降は飛ばす', () => {
		const text = [
			'name\tcategory',
			'ftp://example.com/a.png\ta',
			'https://example.com/b.png\tの',
			'https://example.com/c.png\tdup',
			'https://example.com/d.png\tdup',
		].join('\n');

		expect(parsePastedEmojis(text).map(it => it.url)).toEqual(['https://example.com/c.png']);
	});
});

describe('emojiNameFromUrl', () => {
	test('拡張子を消して - と空白を _ にする', () => {
		expect(emojiNameFromUrl('https://example.com/a/blob%20cat-happy.png')).toBe('blob_cat_happy');
	});

	test('URL として読めなければ空にする', () => {
		expect(emojiNameFromUrl('not a url')).toBe('');
	});
});

describe('mapWithConcurrency', () => {
	test('同時に動かす数を守り、結果を元の順に並べる', async () => {
		let running = 0;
		let maxRunning = 0;
		const result = await mapWithConcurrency([30, 10, 20, 0, 5], 2, async (ms) => {
			running++;
			maxRunning = Math.max(maxRunning, running);
			await new Promise(resolve => setTimeout(resolve, ms));
			running--;
			return ms * 2;
		});

		expect(result).toEqual([60, 20, 40, 0, 10]);
		expect(maxRunning).toBe(2);
	});

	test('空の配列はそのまま返す', async () => {
		expect(await mapWithConcurrency([], 4, async () => 1)).toEqual([]);
	});
});
