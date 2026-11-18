/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'vitest';
import { getReplyContext } from '@/utility/reply-context.js';

describe('getReplyContext', () => {
	test('リプライでなければ何も出さない', () => {
		expect(getReplyContext({ replyId: null })).toEqual({ rootId: null, showGap: false });
	});

	test('直前のノートがスレッドの最初なら、直前のノートだけ', () => {
		expect(getReplyContext({ replyId: 'a', threadId: 'a', reply: { replyId: null } })).toEqual({ rootId: null, showGap: false });
	});

	test('直前のノートが最初のノートへのリプライなら、最初のノートを間を空けずに出す', () => {
		expect(getReplyContext({ replyId: 'b', threadId: 'a', reply: { replyId: 'a' } })).toEqual({ rootId: 'a', showGap: false });
	});

	test('間にほかのノートがあれば、さらに表示を挟む', () => {
		expect(getReplyContext({ replyId: 'c', threadId: 'a', reply: { replyId: 'b' } })).toEqual({ rootId: 'a', showGap: true });
	});

	test('直前のノートが消されていたら、最初のノートとさらに表示を出す', () => {
		expect(getReplyContext({ replyId: 'c', threadId: 'a', reply: null })).toEqual({ rootId: 'a', showGap: true });
	});

	test('threadId が無くて直前のノートがリプライなら、さらに表示だけ', () => {
		expect(getReplyContext({ replyId: 'c', reply: { replyId: 'b' } })).toEqual({ rootId: null, showGap: true });
	});
});
