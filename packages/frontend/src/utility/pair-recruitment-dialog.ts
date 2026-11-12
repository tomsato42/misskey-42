/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// ペア募集のダイアログ (希望する課題の選択・招待・共有) を開く

import { defineAsyncComponent } from 'vue';
import type * as Misskey from 'misskey-js';
import * as os from '@/os.js';
import { pairRecruitmentAction } from '@/utility/pair-recruitment-action.js';
import { isMultiProject } from '@/utility/pair-recruitment.js';

/**
 * 希望する課題を選ぶダイアログを開く。選んだら課題の slug、閉じたら null を返す
 */
export function openPairWantedProjectsDialog(recruitment: Misskey.entities.PairRecruitment): Promise<string[] | null> {
	let selected: string[] | null = null;
	return new Promise((resolve) => {
		const { dispose } = os.popup(defineAsyncComponent(() => import('@/components/MkPairWantedProjectsDialog.vue')), {
			recruitment,
		}, {
			done: (slugs) => {
				selected = slugs;
			},
			closed: () => {
				resolve(selected);
				dispose();
			},
		});
	});
}

/**
 * 参加希望を送る。複数の課題をまとめた募集では、先に希望する課題を選んでもらう。
 * 送れたら更新後の募集、やめたか失敗したら null を返す
 */
export async function applyToPairRecruitment(recruitment: Misskey.entities.PairRecruitment): Promise<Misskey.entities.PairRecruitmentDetailed | null> {
	if (!isMultiProject(recruitment)) {
		return await pairRecruitmentAction('pair-recruitments/apply', { recruitmentId: recruitment.id });
	}
	const wanted = await openPairWantedProjectsDialog(recruitment);
	if (wanted == null) return null;
	return await pairRecruitmentAction('pair-recruitments/apply', { recruitmentId: recruitment.id, wantedProjectSlugs: wanted });
}

/**
 * 取り組める人を招待するダイアログを開く。送ったら更新後の募集、閉じたら null を返す
 */
export function openPairInviteDialog(recruitment: Misskey.entities.PairRecruitmentDetailed): Promise<Misskey.entities.PairRecruitmentDetailed | null> {
	let updated: Misskey.entities.PairRecruitmentDetailed | null = null;
	return new Promise((resolve) => {
		const { dispose } = os.popup(defineAsyncComponent(() => import('@/components/MkPairInviteDialog.vue')), {
			recruitment,
		}, {
			done: (res) => {
				updated = res;
			},
			closed: () => {
				resolve(updated);
				dispose();
			},
		});
	});
}

/**
 * 募集を共有するダイアログ (ほかの場所に貼る文章を編集してコピーする) を開く
 */
export function openPairShareDialog(recruitment: Misskey.entities.PairRecruitmentDetailed): void {
	const { dispose } = os.popup(defineAsyncComponent(() => import('@/components/MkPairShareDialog.vue')), {
		recruitment,
	}, {
		closed: () => dispose(),
	});
}
