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
import { miLocalStorage } from '@/local-storage.js';

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

/** 端末に保存したこのノートの編集の下書き */
const editDraft = (noteId = 'note1') => JSON.parse(miLocalStorage.getItem('drafts') ?? '{}')[`edit:${noteId}`];

/** フォームが下書きを復元し、変更を見張り始めるまで待つ */
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

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
		miLocalStorage.removeItem('drafts');
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

	test('書きかけの本文と CW を下書きに保存し、開き直すと復元する', async () => {
		const note = makeNote({ text: 'before' });
		let result = renderForm(note);
		await settle();

		await fireEvent.update(result.getByTestId('post-form-text'), 'draft');
		assert.strictEqual(editDraft()?.data.text, 'draft');

		cleanup();
		result = renderForm(note);
		await settle();

		assert.strictEqual((result.getByTestId('post-form-text') as HTMLTextAreaElement).value, 'draft');
		assert.isFalse((result.getByTestId('post-form-submit') as HTMLButtonElement).disabled);
	});

	test('元のノートと同じに戻すと下書きを消す', async () => {
		const result = renderForm(makeNote({ text: 'before' }));
		await settle();

		await fireEvent.update(result.getByTestId('post-form-text'), 'draft');
		assert.isDefined(editDraft());
		await fireEvent.update(result.getByTestId('post-form-text'), 'before');
		assert.isUndefined(editDraft());
	});

	test('保存すると下書きを消す', async () => {
		const note = makeNote({ text: 'before' });
		misskeyApiMock.mockImplementation(async (endpoint: string) => endpoint === 'notes/update' ? { ...note, text: 'after', updatedAt: '2026-10-20T01:00:00.000Z' } : []);
		const result = renderForm(note);
		await settle();

		await fireEvent.update(result.getByTestId('post-form-text'), 'after');
		assert.isDefined(editDraft());
		await fireEvent.click(result.getByTestId('post-form-submit'));

		await waitFor(() => assert.isNotEmpty(result.emitted('posted') ?? []));
		assert.isUndefined(editDraft());
	});

	test('下書きの後にノートが編集されていたら、下書きを使わずに消す', async () => {
		miLocalStorage.setItem('drafts', JSON.stringify({
			'edit:note1': { updatedAt: '2026-10-20T00:30:00.000Z', data: { text: 'old draft', useCw: false, cw: null } },
		}));
		const result = renderForm(makeNote({ text: 'edited elsewhere', updatedAt: '2026-10-20T01:00:00.000Z' }));
		await settle();

		assert.strictEqual((result.getByTestId('post-form-text') as HTMLTextAreaElement).value, 'edited elsewhere');
		assert.isUndefined(editDraft());
	});

	test('公開範囲のボタンは、ダイレクトのノートでなければ押せる', () => {
		const visibilityButton = (result: ReturnType<typeof renderForm>, icon: string) => result.container.querySelector(`header .${icon}`)!.closest('button')!;

		const pub = renderForm(makeNote({ visibility: 'public' }));
		assert.isFalse(visibilityButton(pub, 'ti-world').disabled);
		cleanup();

		const specified = renderForm(makeNote({ visibility: 'specified', visibleUserIds: [] }));
		assert.isTrue(visibilityButton(specified, 'ti-mail').disabled);
	});

	test('下書きで公開範囲を変えていたら復元し、本文が同じでも保存すると公開範囲を送る', async () => {
		miLocalStorage.setItem('drafts', JSON.stringify({
			'edit:note1': { updatedAt: '2026-10-20T00:30:00.000Z', data: { text: 'before', useCw: false, cw: null, visibility: 'followers' } },
		}));
		const note = makeNote({ text: 'before', visibility: 'public' });
		misskeyApiMock.mockImplementation(async (endpoint: string) => endpoint === 'notes/update' ? { ...note, visibility: 'followers' } : []);
		const result = renderForm(note);
		await settle();

		assert.isNotNull(result.container.querySelector('header .ti-lock'));
		await fireEvent.click(result.getByTestId('post-form-submit'));

		await waitFor(() => assert.strictEqual(updateCalls().length, 1));
		assert.deepStrictEqual(updateCalls()[0], ['notes/update', { noteId: 'note1', text: 'before', cw: null, visibility: 'followers' }]);
	});

	test('ほかのノートや新規の下書きは使わない', async () => {
		miLocalStorage.setItem('drafts', JSON.stringify({
			'note:me': { updatedAt: '2026-10-20T02:00:00.000Z', data: { text: 'new note draft', useCw: false, cw: null } },
			'edit:note2': { updatedAt: '2026-10-20T02:00:00.000Z', data: { text: 'other note draft', useCw: false, cw: null } },
		}));
		const result = renderForm(makeNote({ text: 'before' }));
		await settle();

		assert.strictEqual((result.getByTestId('post-form-text') as HTMLTextAreaElement).value, 'before');
	});
});
