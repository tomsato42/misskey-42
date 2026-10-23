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

export type IntraProjectSubmission = Misskey.entities.IntraProjectResult['submissions'][number];

/**
 * intra の課題のページの URL。ログイン名があれば、その人のその課題のページ (提出の一覧) にする
 */
export function getIntraProjectUrl(projectSlug: string, intraLogin?: string | null): string {
	if (intraLogin != null && intraLogin !== '') {
		return `https://projects.intra.42.fr/${encodeURIComponent(projectSlug)}/${encodeURIComponent(intraLogin)}`;
	}
	return `https://projects.intra.42.fr/projects/${encodeURIComponent(projectSlug)}`;
}

/** 提出の日付 (日本時間の YYYY/MM/DD) */
export function formatIntraSubmissionDate(markedAt: string): string {
	return new Date(markedAt).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' });
}

/**
 * 提出の見出し (「3回目の提出 ・ 2026/10/18」)。提出が 1 件だけなら日付だけ。どちらも分からなければ null
 */
export function getIntraSubmissionLabel(attemptNumber: number | null, attemptCount: number | null, markedAt: string | null): string | null {
	const date = markedAt != null ? formatIntraSubmissionDate(markedAt) : null;
	if (attemptNumber == null || attemptCount == null || attemptCount <= 1) return date;
	const attempt = i18n.tsx._intraProjectResult.attempt({ n: attemptNumber });
	return date != null ? `${attempt} ・ ${date}` : attempt;
}

/**
 * 投稿フォームに出すカードの値。teamId の提出 (無ければ最後の提出) の点数・メンバーにする
 */
export function toIntraProjectNote(result: Misskey.entities.IntraProjectResult, teamId: number | null): Misskey.entities.IntraProjectNote {
	const attemptCount = result.submissions.length > 0 ? result.submissions.length : null;
	const submission = result.submissions.find(s => s.teamId === (teamId ?? result.teamId));
	if (submission == null || submission.teamId === result.teamId) {
		return {
			projectSlug: result.projectSlug,
			projectName: result.projectName,
			finalMark: result.finalMark,
			validated: result.validated,
			outstandingCount: result.outstandingCount ?? submission?.outstandingCount ?? null,
			members: result.members.length > 0 ? result.members : (submission?.members ?? []),
			attemptNumber: submission?.attemptNumber ?? null,
			attemptCount,
			markedAt: result.markedAt,
			intraLogin: null,
		};
	}
	return {
		projectSlug: result.projectSlug,
		projectName: result.projectName,
		finalMark: submission.finalMark,
		validated: submission.validated,
		outstandingCount: submission.outstandingCount,
		members: submission.members,
		attemptNumber: submission.attemptNumber,
		attemptCount,
		markedAt: submission.markedAt,
		intraLogin: null,
	};
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
	await os.post({ initialIntraProjectResult: result, initialIntraProjectTeamId: result.teamId });
}

/**
 * 42 intra のレベルが上がったことを書き、レベルのカードを付けた投稿フォームを開く
 */
export async function shareIntraLevelUp(level: number): Promise<void> {
	await os.post({ initialText: i18n.tsx._notification.intraLevelUpShareText({ level }), initialIntraLevel: level });
}
