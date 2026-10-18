/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// 42 API の課題 (project_sessions) とユーザーの課題の状態 (projects_users / quests_users) を扱う純粋関数群。
// DI に依存しないので、ユニットテストから直接呼び出せる。

/**
 * 42 API の project_sessions_rules の要素 (使う項目だけ)
 */
export type IntraProjectSessionRule = {
	/** false のルールは登録の条件にならない (と判断している。未確認) ので、判定には使わない */
	required: boolean;
	params: { value: string }[];
	rule: {
		/** 例: inscription, group_validation, correction */
		kind: string;
		/** 例: QuestsValidated, GroupSizeBetweenNAndM */
		internal_name: string;
	};
};

/**
 * 42 API の GET /v2/project_sessions の要素 (使う項目だけ)
 */
export type IntraProjectSession = {
	id: number;
	project_id: number;
	campus_id: number | null;
	cursus_id: number | null;
	is_subscriptable: boolean;
	updated_at: string;
	project: {
		id: number;
		name: string;
		slug: string;
	};
	project_sessions_rules?: IntraProjectSessionRule[];
};

/**
 * 42 API の projects_users の要素 (使う項目だけ)。GET /v2/me と GET /v2/users/:id に含まれる
 */
export type IntraProjectUser = {
	/** 確認できた値: finished / in_progress / searching_a_group / creating_group / waiting_for_correction */
	status: string;
	/** 評価がまだ無ければ null。再挑戦の登録中でも前回の結果が残る */
	'validated?': boolean | null;
	cursus_ids?: number[];
	project: {
		id: number;
		slug: string;
	};
};

/**
 * 42 API の GET /v2/users/:id/quests_users の要素 (使う項目だけ)
 */
export type IntraQuestUser = {
	/** 達成していなければ null */
	validated_at: string | null;
	quest: {
		slug: string;
	};
};

/**
 * 課題に登録するための条件。intra_project テーブルの列に対応する
 */
export type IntraProjectRequirements = {
	/** グループの人数の下限 (GroupSizeBetweenNAndM)。ルールが無ければ null */
	minGroupSize: number | null;
	/** グループの人数の上限 (GroupSizeBetweenNAndM)。ルールが無ければ null */
	maxGroupSize: number | null;
	/** すべて達成している必要があるクエスト (QuestsValidated, QuestAndQuestValidated) */
	requiredQuests: string[];
	/** 各グループのうち 1 つ以上を達成している必要があるクエスト (QuestOrQuestValidated) */
	requiredAnyQuests: string[][];
	/** 1 つでも達成していると登録できないクエスト (QuestsNotValidated) */
	forbiddenQuests: string[];
	/** 1 つでも進行中か達成済みだと登録できない課題 (NeitherOngoingOrValidated)。対象の課題自身を含むことがある */
	exclusiveProjects: string[];
	/** すべて達成している必要がある課題 (ProjectsValidated) */
	requiredProjects: string[];
};

export type IntraProjectDefinition = IntraProjectRequirements & {
	projectId: number;
	slug: string;
	name: string;
	campusId: number;
	cursusId: number;
	sessionId: number;
};

/**
 * ユーザーの課題の状態。キーは課題の slug
 */
export type IntraProjectStatuses = Record<string, {
	status: string;
	validated: boolean | null;
}>;

export type IntraUserProgress = {
	projectStatuses: IntraProjectStatuses;
	/** 達成したクエストの slug */
	validatedQuests: string[];
};

export type IntraProjectAvailability =
	| { state: 'available'; reason: null }
	| { state: 'in_progress'; reason: 'registered' }
	| { state: 'finished'; reason: 'validated' | 'equivalentValidated' }
	| { state: 'locked'; reason: 'equivalentInProgress' | 'forbiddenQuestValidated' | 'requiredQuestMissing' | 'requiredProjectMissing' };

export type IntraProjectAvailabilityState = IntraProjectAvailability['state'];

/** 課題の状態のうち、終わっている (進行中ではない) ことを表す値 */
const FINISHED_STATUS = 'finished';

/**
 * ルールの params の値 (空白区切りの slug の一覧) を分解する。空の要素と重複は除く
 */
export function parseSlugList(value: string): string[] {
	return [...new Set(value.split(/\s+/).filter(s => s.length > 0))];
}

function parseSize(value: string | undefined): number | null {
	if (value == null || !/^\d+$/.test(value.trim())) return null;
	return parseInt(value.trim(), 10);
}

function uniquePush(target: string[], values: string[]) {
	for (const v of values) {
		if (!target.includes(v)) target.push(v);
	}
}

/**
 * セッションのルールから登録の条件を取り出す。required でないルールと、判定に使わない種類のルールは無視する
 */
export function extractProjectRequirements(rules: IntraProjectSessionRule[] | null | undefined): IntraProjectRequirements {
	const result: IntraProjectRequirements = {
		minGroupSize: null,
		maxGroupSize: null,
		requiredQuests: [],
		requiredAnyQuests: [],
		forbiddenQuests: [],
		exclusiveProjects: [],
		requiredProjects: [],
	};

	for (const r of rules ?? []) {
		if (!r.required) continue;
		const values = (r.params ?? []).map(p => p.value);
		// 確認できた範囲では、slug の一覧は 1 つの param に空白区切りで入っている
		const slugs = parseSlugList(values.join(' '));

		if (r.rule.kind === 'group_validation' && r.rule.internal_name === 'GroupSizeBetweenNAndM') {
			const min = parseSize(values[0]);
			const max = parseSize(values[1]);
			if (min != null && max != null && min <= max) {
				result.minGroupSize = min;
				result.maxGroupSize = max;
			}
			continue;
		}

		if (r.rule.kind !== 'inscription') continue;

		switch (r.rule.internal_name) {
			case 'QuestsValidated':
			case 'QuestAndQuestValidated':
				uniquePush(result.requiredQuests, slugs);
				break;
			case 'QuestOrQuestValidated':
				if (slugs.length > 0) result.requiredAnyQuests.push(slugs);
				break;
			case 'QuestsNotValidated':
				uniquePush(result.forbiddenQuests, slugs);
				break;
			case 'NeitherOngoingOrValidated':
				uniquePush(result.exclusiveProjects, slugs);
				break;
			case 'ProjectsValidated':
				uniquePush(result.requiredProjects, slugs);
				break;
		}
	}

	return result;
}

/**
 * 1 つの課題に複数のセッションがある場合に、使うセッションを 1 つ選ぶ。
 * 登録できるセッションを優先し、その中で更新日時が新しいものを使う
 */
export function selectProjectSessions(sessions: IntraProjectSession[]): IntraProjectSession[] {
	const bySlug = new Map<string, IntraProjectSession>();
	for (const s of sessions) {
		const current = bySlug.get(s.project.slug);
		if (current == null) {
			bySlug.set(s.project.slug, s);
			continue;
		}
		if (current.is_subscriptable !== s.is_subscriptable) {
			if (s.is_subscriptable) bySlug.set(s.project.slug, s);
			continue;
		}
		if (Date.parse(s.updated_at) > Date.parse(current.updated_at)) bySlug.set(s.project.slug, s);
	}
	return [...bySlug.values()];
}

/**
 * セッションを intra_project に保存する形に変換する。キャンパスか cursus が無いセッションは null
 */
export function toProjectDefinition(session: IntraProjectSession): IntraProjectDefinition | null {
	if (session.campus_id == null || session.cursus_id == null) return null;
	return {
		projectId: session.project.id,
		slug: session.project.slug,
		name: session.project.name,
		campusId: session.campus_id,
		cursusId: session.cursus_id,
		sessionId: session.id,
		...extractProjectRequirements(session.project_sessions_rules),
	};
}

/**
 * projects_users を slug ごとの状態にまとめる
 */
export function extractProjectStatuses(projectsUsers: IntraProjectUser[]): IntraProjectStatuses {
	const result: IntraProjectStatuses = {};
	for (const pu of projectsUsers) {
		const slug = pu.project?.slug;
		if (typeof slug !== 'string' || slug.length === 0) continue;
		result[slug] = {
			status: pu.status,
			validated: typeof pu['validated?'] === 'boolean' ? pu['validated?'] : null,
		};
	}
	return result;
}

/**
 * quests_users から達成したクエストの slug を取り出す
 */
export function extractValidatedQuests(questsUsers: IntraQuestUser[]): string[] {
	const result: string[] = [];
	for (const qu of questsUsers) {
		const slug = qu.quest?.slug;
		if (qu.validated_at == null || typeof slug !== 'string' || slug.length === 0) continue;
		if (!result.includes(slug)) result.push(slug);
	}
	return result.sort();
}

function isOngoing(entry: IntraProjectStatuses[string] | undefined): boolean {
	return entry != null && entry.status !== FINISHED_STATUS;
}

/** 達成済みか。再挑戦の登録中でも、前回達成していれば true (validated? が前回の結果のまま残るため) */
function isValidated(entry: IntraProjectStatuses[string] | undefined): boolean {
	return entry != null && entry.validated === true;
}

/**
 * ユーザーがその課題に取り組めるかを判定する。上から順に当てはまったものを返す:
 *
 * 1. in_progress: その課題に登録中 (状態が finished 以外)。達成済みの課題に再挑戦している場合もここに入る
 * 2. finished: その課題を達成済み
 * 3. finished: 同等の課題 (NeitherOngoingOrValidated に挙がったほかの課題。cub3d に対する minirt など) を達成済み
 * 4. locked: 同等の課題に登録中
 * 5. locked: 達成していると登録できないクエストを達成済み (その段階を過ぎているか、別の課程にいる)
 * 6. locked: 必要なクエストか課題が未達成
 * 7. available: それ以外
 *
 * finished で評価が不合格 (validated が true でない) の課題は、条件を満たせば再び available になる
 */
export function judgeProjectAvailability(project: IntraProjectRequirements & { slug: string }, progress: IntraUserProgress): IntraProjectAvailability {
	const statuses = progress.projectStatuses;
	const quests = new Set(progress.validatedQuests);

	const own = statuses[project.slug];
	if (isOngoing(own)) return { state: 'in_progress', reason: 'registered' };
	if (isValidated(own)) return { state: 'finished', reason: 'validated' };

	const equivalents = project.exclusiveProjects.filter(slug => slug !== project.slug);
	if (equivalents.some(slug => isValidated(statuses[slug]))) return { state: 'finished', reason: 'equivalentValidated' };
	if (equivalents.some(slug => isOngoing(statuses[slug]))) return { state: 'locked', reason: 'equivalentInProgress' };

	if (project.forbiddenQuests.some(q => quests.has(q))) return { state: 'locked', reason: 'forbiddenQuestValidated' };

	if (!project.requiredQuests.every(q => quests.has(q))) return { state: 'locked', reason: 'requiredQuestMissing' };
	if (!project.requiredAnyQuests.every(group => group.some(q => quests.has(q)))) return { state: 'locked', reason: 'requiredQuestMissing' };
	if (!project.requiredProjects.every(slug => isValidated(statuses[slug]))) return { state: 'locked', reason: 'requiredProjectMissing' };

	return { state: 'available', reason: null };
}
