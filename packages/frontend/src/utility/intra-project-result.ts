/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// 42times: 42 intra の課題の結果 (点数) の共有

import type * as Misskey from 'misskey-js';
import * as os from '@/os.js';
import { i18n } from '@/i18n.js';
import { misskeyApi } from '@/utility/misskey-api.js';

/** 読み上げ用の、課題の名前・点数・合否 */
export function getIntraProjectResultLabel(result: Pick<Misskey.entities.IntraProjectNote, 'projectName' | 'finalMark' | 'validated'>): string {
	return i18n.tsx._intraProjectResult.scoreLabel({
		project: result.projectName,
		score: result.finalMark,
		result: result.validated ? i18n.ts._intraProjectResult.passed : i18n.ts._intraProjectResult.failed,
	});
}

/** intra の課題のページの URL */
export function getIntraProjectUrl(projectSlug: string): string {
	return `https://projects.intra.42.fr/projects/${encodeURIComponent(projectSlug)}`;
}

/** i/intra/refresh-project-results のエラーの文言 */
export function getIntraRefreshErrorMessage(err: unknown): string {
	const e = err as Partial<Misskey.api.APIError> | null;
	switch (e?.code) {
		case 'NOT_LINKED_WITH_INTRA':
			return i18n.ts._intraProjectResult._errors.notLinked;
		case 'INTRA_REFRESH_IN_PROGRESS':
			return i18n.ts._intraProjectResult._errors.refreshInProgress;
		case 'RATE_LIMIT_EXCEEDED':
			return i18n.ts._intraProjectResult._errors.refreshTooSoon;
		default:
			return e?.message ?? String(err);
	}
}

/**
 * 課題の結果 (通知に付いている ID の結果) のカードを付けた投稿フォームを開く
 */
export async function shareIntraProjectResult(resultId: string): Promise<void> {
	let results: Misskey.entities.IntraProjectResult[];
	try {
		results = await misskeyApi('i/intra/project-results');
	} catch (err) {
		os.alert({ type: 'error', text: (err as Partial<Misskey.api.APIError>).message ?? String(err) });
		return;
	}
	const result = results.find(r => r.id === resultId);
	if (result == null) {
		os.alert({ type: 'error', text: i18n.ts._intraProjectResult._errors.noSuchResult });
		return;
	}
	await os.post({ initialIntraProjectResult: result });
}
