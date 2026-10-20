/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// 42times: 投稿フォームでノートを編集する (MkPostForm の editNote)

import { describe, test, assert, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/vue';
import type * as Misskey from 'misskey-js';
import { components } from '@/components/index.js';
import { directives } from '@/directives/index.js';
import MkPostForm from '@/components/MkPostForm.vue';
import { instance } from '@/instance.js';

const me = vi.hoisted(() => ({
	id: 'me',
	username: 'me',
	host: null,
	avatarUrl: '',
	isSilenced: false,
	policies: { scheduledNoteLimit: 0 },
}));

vi.mock('@/i.js', async (importOriginal) => ({
	...await importOriginal<typeof import('@/i.js')>(),
	$i: me,
	ensureSignin: () => me,
}));

// ストアなどが読み込むときに呼ぶ API は空で返す
const misskeyApiMock = vi.hoisted(() => vi.fn(async (endpoint: string, params?: unknown): Promise<unknown> => []));
/** notes/update に送ったパラメータ */
const updateCalls = () => misskeyApiMock.mock.calls.filter(([endpoint]) => endpoint === 'notes/update');

vi.mock('@/utility/misskey-api.js', () => ({ misskeyApi: misskeyApiMock }));

function makeNote(note: Partial<Misskey.entities.Note>): Misskey.entities.Note {
	return {
		id: 'note1',
		createdAt: '2026-10-20T00:00:00.000Z',
		userId: me.id,
		user: me,
		text: 'before',
		cw: null,
		visibility: 'public',
		localOnly: false,
		reactionAcceptance: null,
		reactionEmojis: {},
		reactions: {},
		reactionCount: 0,
		renoteCount: 0,
		repliesCount: 0,
		fileIds: [],
		files: [],
		replyId: null,
		renoteId: null,
		...note,
	} as Misskey.entities.Note;
}

describe('MkPostForm (editNote)', () => {
	const renderForm = (note: Misskey.entities.Note) => render(MkPostForm, {
		props: { editNote: note, autofocus: false },
		global: { directives, components },
	});

	beforeEach(() => {
		misskeyApiMock.mockClear();
		// テストではサーバーの情報を読み込まないので、本文の上限だけ入れる
		instance.maxNoteTextLength = 3000;
	});

	afterEach(() => {
		cleanup();
	});

	test('元のノートの本文と CW が入り、変えるまでは保存できない', async () => {
		const result = renderForm(makeNote({ text: 'before', cw: 'cw' }));
		const textarea = result.getByTestId('post-form-text') as HTMLTextAreaElement;
		const submit = result.getByTestId('post-form-submit') as HTMLButtonElement;

		assert.strictEqual(textarea.value, 'before');
		assert.strictEqual((result.container.querySelector('input[placeholder]') as HTMLInputElement).value, 'cw');
		assert.isTrue(submit.disabled);
	});

	test('本文を変えて保存すると notes/update を呼び、posted を出す', async () => {
		const note = makeNote({ text: 'before' });
		misskeyApiMock.mockImplementation(async (endpoint: string) => endpoint === 'notes/update' ? { ...note, text: 'after', updatedAt: '2026-10-20T01:00:00.000Z' } : []);
		const result = renderForm(note);
		const textarea = result.getByTestId('post-form-text') as HTMLTextAreaElement;
		const submit = result.getByTestId('post-form-submit') as HTMLButtonElement;

		await fireEvent.update(textarea, 'after');
		assert.isFalse(submit.disabled);
		await fireEvent.click(submit);

		await waitFor(() => assert.isNotEmpty(result.emitted('posted') ?? []));
		assert.deepStrictEqual(updateCalls(), [['notes/update', { noteId: 'note1', text: 'after', cw: null }]]);
	});

	test('本文を空にすると null を送る', async () => {
		const note = makeNote({ text: 'before', fileIds: ['file1'] });
		misskeyApiMock.mockImplementation(async (endpoint: string) => endpoint === 'notes/update' ? { ...note, text: null, updatedAt: '2026-10-20T01:00:00.000Z' } : []);
		const result = renderForm(note);

		await fireEvent.update(result.getByTestId('post-form-text'), '  ');
		await fireEvent.click(result.getByTestId('post-form-submit'));

		await waitFor(() => assert.strictEqual(updateCalls().length, 1));
		assert.deepStrictEqual(updateCalls()[0], ['notes/update', { noteId: 'note1', text: null, cw: null }]);
	});

	test('添付・投票・ハッシュタグのボタンを出さない', () => {
		const result = renderForm(makeNote({}));
		const footer = result.container.querySelector('footer')!;

		for (const icon of ['ti-photo-plus', 'ti-cloud-download', 'ti-chart-arrows', 'ti-hash']) {
			assert.isNull(footer.querySelector(`.${icon}`), icon);
		}
		assert.isNotNull(footer.querySelector('.ti-eye-off'));
	});
});
