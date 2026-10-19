/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// 42 API の課題の結果 (projects_users の点数と、チーム・評価) を扱う純粋関数群。
// DI に依存しないので、ユニットテストから直接呼び出せる。

import type { IntraProjectUser } from './intra-project.js';

/** 評価のフラグのうち、outstanding を表すものの名前 */
export const OUTSTANDING_FLAG_NAME = 'Outstanding project';

/** 結果が出てからこの期間を過ぎたものは、新しく見つかっても通知しない (同期が止まっていた後にまとめて届かないように) */
export const RESULT_NOTIFICATION_WINDOW = 1000 * 60 * 60 * 24 * 14;

/**
 * 課題の結果。intra_project_result テーブルの列に対応する
 */
export type IntraProjectResultValues = {
	projectsUserId: number;
	projectSlug: string;
	projectName: string;
	finalMark: number;
	validated: boolean;
	markedAt: Date | null;
	teamId: number | null;
};

/**
 * 42 API の GET /v2/teams/:id の users の要素 (使う項目だけ)
 */
export type IntraTeamUser = {
	id: number;
	login: string;
};

/**
 * 42 API の scale_teams (評価) の要素 (使う項目だけ)
 */
export type IntraScaleTeam = {
	flag?: {
		name?: string;
	} | null;
};

/**
 * 42 API の GET /v2/teams/:id の返り値 (使う項目だけ)
 */
export type IntraTeam = {
	id: number;
	users?: IntraTeamUser[];
	scale_teams?: IntraScaleTeam[];
};

export type IntraProjectResultMember = {
	intraId: number;
	login: string;
};

function parseDate(value: string | null | undefined): Date | null {
	if (value == null) return null;
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * projects_users から、点数が付いた課題の結果を取り出す。合否は問わない
 */
export function extractProjectResults(projectsUsers: IntraProjectUser[]): IntraProjectResultValues[] {
	const results: IntraProjectResultValues[] = [];
	for (const pu of projectsUsers) {
		if (typeof pu.id !== 'number') continue;
		if (typeof pu.final_mark !== 'number') continue;
		const slug = pu.project?.slug;
		if (typeof slug !== 'string' || slug.length === 0) continue;
		const name = typeof pu.project.name === 'string' && pu.project.name.length > 0 ? pu.project.name : slug;
		results.push({
			projectsUserId: pu.id,
			projectSlug: slug.slice(0, 128),
			projectName: name.slice(0, 256),
			finalMark: pu.final_mark,
			validated: pu['validated?'] === true,
			markedAt: parseDate(pu.marked_at),
			teamId: typeof pu.current_team_id === 'number' ? pu.current_team_id : null,
		});
	}
	return results;
}

/**
 * 保存済みの結果と比べて、結果が新しく出た (初めて点数が付いた・再挑戦で点数が付き直した) ものを返す。
 * 結果が出てから RESULT_NOTIFICATION_WINDOW を過ぎたものは含めない
 */
export function findNewlyMarkedResults(
	previous: Pick<IntraProjectResultValues, 'projectsUserId' | 'finalMark' | 'markedAt'>[],
	current: IntraProjectResultValues[],
	now: Date,
): IntraProjectResultValues[] {
	const prevById = new Map(previous.map(p => [p.projectsUserId, p]));
	return current.filter(result => {
		if (result.markedAt == null) return false;
		if (now.getTime() - result.markedAt.getTime() > RESULT_NOTIFICATION_WINDOW) return false;
		const prev = prevById.get(result.projectsUserId);
		if (prev == null) return true;
		if (prev.markedAt == null) return true;
		return prev.markedAt.getTime() !== result.markedAt.getTime() || prev.finalMark !== result.finalMark;
	});
}

/**
 * チームのメンバー。ID とログイン名が無いものは除く
 */
export function extractTeamMembers(team: IntraTeam): IntraProjectResultMember[] {
	const members: IntraProjectResultMember[] = [];
	for (const user of team.users ?? []) {
		if (typeof user.id !== 'number' || typeof user.login !== 'string' || user.login.length === 0) continue;
		if (members.some(m => m.intraId === user.id)) continue;
		members.push({ intraId: user.id, login: user.login });
	}
	return members;
}

/**
 * 評価のうち outstanding が付いた数
 */
export function countOutstandingFlags(scaleTeams: IntraScaleTeam[]): number {
	return scaleTeams.filter(s => s.flag?.name === OUTSTANDING_FLAG_NAME).length;
}
