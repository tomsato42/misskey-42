/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'vitest';
import { canChangeNoteVisibility, publicOnlyTimelines, resolveEditedVisibility } from '@/core/note-edit-visibility.js';

describe('canChangeNoteVisibility', () => {
	test('公開・ホーム・フォロワーのノートは変えられる', () => {
		for (const visibility of ['public', 'home', 'followers'] as const) {
			expect(canChangeNoteVisibility({ visibility, channelId: null })).toBe(true);
		}
	});

	test('ダイレクトとチャンネルのノートは変えられない', () => {
		expect(canChangeNoteVisibility({ visibility: 'specified', channelId: null })).toBe(false);
		expect(canChangeNoteVisibility({ visibility: 'public', channelId: 'channel' })).toBe(false);
	});
});

describe('resolveEditedVisibility', () => {
	const free = { replyVisibility: null, renoteVisibility: null, canPublic: true };

	test('制限が無ければ選んだとおり', () => {
		expect(resolveEditedVisibility('public', free)).toBe('public');
		expect(resolveEditedVisibility('home', free)).toBe('home');
		expect(resolveEditedVisibility('followers', free)).toBe('followers');
	});

	test('公開にできないときはホームにする', () => {
		expect(resolveEditedVisibility('public', { ...free, canPublic: false })).toBe('home');
		expect(resolveEditedVisibility('followers', { ...free, canPublic: false })).toBe('followers');
	});

	test('返信先・引用元より広くはしない', () => {
		expect(resolveEditedVisibility('public', { ...free, replyVisibility: 'home' })).toBe('home');
		expect(resolveEditedVisibility('public', { ...free, renoteVisibility: 'followers' })).toBe('followers');
		expect(resolveEditedVisibility('home', { ...free, replyVisibility: 'public', renoteVisibility: 'followers' })).toBe('followers');
		expect(resolveEditedVisibility('followers', { ...free, replyVisibility: 'public' })).toBe('followers');
	});

	test('ダイレクトの返信先・引用元は制限にしない (作成時と同じく、ダイレクトへの返信はダイレクトなので編集できない)', () => {
		expect(resolveEditedVisibility('public', { ...free, replyVisibility: 'specified' })).toBe('public');
	});
});

describe('publicOnlyTimelines', () => {
	const base = { userId: 'alice', userHost: null, channelId: null, replyId: null, replyUserId: null, replyUserHost: null, fileIds: [] as string[] };

	test('返信でないノートはローカルのタイムライン (添付があればファイル付きも)', () => {
		expect(publicOnlyTimelines(base).map(t => t.name)).toEqual(['localTimeline']);
		expect(publicOnlyTimelines({ ...base, fileIds: ['file'] }).map(t => t.name)).toEqual(['localTimeline', 'localTimelineWithFiles']);
	});

	test('人への返信は返信のタイムラインと、返信先の人へのタイムライン', () => {
		const reply = { ...base, replyId: 'note', replyUserId: 'bob' };
		expect(publicOnlyTimelines(reply).map(t => t.name)).toEqual(['localTimelineWithReplies', 'localTimelineWithReplyTo:bob']);
		expect(publicOnlyTimelines({ ...reply, replyUserHost: 'remote.example' }).map(t => t.name)).toEqual(['localTimelineWithReplies']);
	});

	test('自分への返信は返信でないノートと同じ', () => {
		expect(publicOnlyTimelines({ ...base, replyId: 'note', replyUserId: 'alice' }).map(t => t.name)).toEqual(['localTimeline']);
	});

	test('リモートのユーザーとチャンネルのノートは入らない', () => {
		expect(publicOnlyTimelines({ ...base, userHost: 'remote.example' })).toEqual([]);
		expect(publicOnlyTimelines({ ...base, channelId: 'channel' })).toEqual([]);
	});

	test('上限は作成時と同じ', () => {
		expect(publicOnlyTimelines({ ...base, fileIds: ['file'] }).map(t => t.maxlen)).toEqual([1000, 500]);
		expect(publicOnlyTimelines({ ...base, replyId: 'note', replyUserId: 'bob' }).map(t => t.maxlen)).toEqual([300, 30]);
	});
});
