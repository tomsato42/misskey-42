<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader>
	<div class="_spacer" style="--MI_SPACER-w: 640px;">
		<MkLoading v-if="(projects == null || (isEdit && editing == null)) && !loadError"/>
		<MkError v-else-if="loadError" @retry="load()"/>
		<div v-else class="_panel" :class="$style.form">
			<div class="_gaps">
				<MkInfo v-if="projectRows.length === 0" warn>{{ i18n.ts._pairRecruitment.noProjects }}</MkInfo>
				<MkInfo v-else-if="!isEdit && !projectRows.some(p => canWorkOn(p.state))" warn>{{ i18n.ts._pairRecruitment.noWorkableProjects }}</MkInfo>

				<div v-if="projectRows.length > 0">
					<div :class="$style.label">{{ i18n.ts._pairRecruitment.projects }}</div>
					<div :class="$style.rows">
						<button
							v-for="p in projectRows"
							:key="p.slug"
							type="button"
							role="checkbox"
							class="_button"
							:class="$style.row"
							:aria-checked="selected.includes(p.slug)"
							:disabled="!isSelectable(p)"
							@click="toggleProject(p.slug)"
						>
							<span :class="[$style.checkbox, { [$style.checked]: selected.includes(p.slug) }]" aria-hidden="true">
								<i v-if="selected.includes(p.slug)" class="ti ti-check"></i>
							</span>
							<i class="ti ti-folder-code" aria-hidden="true"></i>
							<b :class="$style.projectName">{{ p.name }}</b>
							<span v-if="(wantedCounts.get(p.slug) ?? 0) > 0" :class="$style.count">{{ i18n.tsx._pairRecruitment.teamSizeN({ n: wantedCounts.get(p.slug) ?? 0 }) }}</span>
							<MkPairProjectStateBadge v-else :state="p.state"/>
						</button>
					</div>
					<div :class="$style.caption">{{ i18n.ts._pairRecruitment.projectsCaption }}</div>
				</div>

				<template v-if="selected.length > 0">
					<MkInfo v-if="teamSizeOptions.length === 0" warn>{{ i18n.ts._pairRecruitment.noCommonTeamSizeInfo }}</MkInfo>
					<MkRadios v-else v-model="teamSize" :options="teamSizeOptions">
						<template #label>{{ i18n.ts._pairRecruitment.teamSize }}</template>
						<template v-if="selected.length > 1" #caption>{{ i18n.ts._pairRecruitment.teamSizeCaption }}</template>
					</MkRadios>
				</template>

				<MkRadios v-model="startTiming" :options="startTimingOptions">
					<template #label>{{ i18n.ts._pairRecruitment.startTiming }}</template>
				</MkRadios>

				<MkInput v-if="startTiming === 'date'" v-model="startDate" type="date">
					<template #label>{{ i18n.ts._pairRecruitment.startDate }}</template>
				</MkInput>

				<MkTextarea v-model="comment">
					<template #label>{{ i18n.ts._pairRecruitment.comment }}</template>
					<template v-if="commentTooLong" #caption>{{ i18n.ts._pairRecruitment._errors.commentTooLong }}</template>
				</MkTextarea>

				<MkSwitch v-if="!isEdit" v-model="announce">
					<template #label>{{ i18n.ts._pairRecruitment.announce }}</template>
					<template #caption>{{ i18n.ts._pairRecruitment.announceDescription }}</template>
				</MkSwitch>

				<div class="_buttons">
					<MkButton v-if="isEdit" primary gradate rounded :disabled="!canSubmit || submitting" @click="save"><i class="ti ti-check"></i> {{ i18n.ts._pairRecruitment.save }}</MkButton>
					<MkButton v-else primary gradate rounded :disabled="!canSubmit || submitting" @click="submit"><i class="ti ti-send"></i> {{ i18n.ts._pairRecruitment.recruit }}</MkButton>
					<MkButton rounded @click="cancel">{{ i18n.ts.cancel }}</MkButton>
				</div>
			</div>
		</div>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
// ペア募集の作成 (/pair/new) と編集 (/pair/:id/edit)。課題はいくつでも選べ、人数は選んだ課題のどれでも組める範囲にする
import { computed, ref, watch } from 'vue';
import type * as Misskey from 'misskey-js';
import type { MkRadiosOption } from '@/components/MkRadios.vue';
import MkButton from '@/components/MkButton.vue';
import MkInfo from '@/components/MkInfo.vue';
import MkInput from '@/components/MkInput.vue';
import MkPairProjectStateBadge from '@/components/MkPairProjectStateBadge.vue';
import MkRadios from '@/components/MkRadios.vue';
import MkSwitch from '@/components/MkSwitch.vue';
import MkTextarea from '@/components/MkTextarea.vue';
import * as os from '@/os.js';
import { i18n } from '@/i18n.js';
import { definePage } from '@/page.js';
import { useRouter } from '@/router.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { canWorkOn, getCommonTeamSizes } from '@/utility/pair-recruitment.js';
import type { PairProjectState } from '@/utility/pair-recruitment.js';
import { showPairRecruitmentError } from '@/utility/pair-recruitment-action.js';

/** ひとことの最大の長さ (バックエンドの PAIR_RECRUITMENT_COMMENT_MAX_LENGTH と同じ) */
const COMMENT_MAX_LENGTH = 500;

/** まとめられる課題の最大の数 (バックエンドの PAIR_RECRUITMENT_MAX_PROJECTS と同じ) */
const MAX_PROJECTS = 4;

type StartTiming = Misskey.entities.PairRecruitment['startTiming'];

type ProjectRow = {
	slug: string;
	name: string;
	minGroupSize: number;
	maxGroupSize: number;
	state: PairProjectState;
};

const props = defineProps<{
	/** 編集する募集の ID。無ければ新しく作る */
	id?: string;
}>();

const router = useRouter();

const isEdit = computed(() => props.id != null);

const projects = ref<Misskey.entities.PairRecruitmentProject[] | null>(null);
const editing = ref<Misskey.entities.PairRecruitmentDetailed | null>(null);
const loadError = ref(false);
/** 選んだ課題の slug (選んだ順) */
const selected = ref<string[]>([]);
const teamSize = ref(2);
const startTiming = ref<StartTiming>('now');
const startDate = ref('');
const comment = ref('');
const announce = ref(true);
const submitting = ref(false);

async function load() {
	loadError.value = false;
	try {
		const [res, recruitment] = await Promise.all([
			misskeyApi('pair-recruitments/projects'),
			props.id != null ? misskeyApi('pair-recruitments/show', { recruitmentId: props.id }) : Promise.resolve(null),
		]);
		projects.value = res;
		if (recruitment != null) {
			// 作成者でないか、もう締め切った募集は編集できないので詳細に戻す
			if (recruitment.myStatus !== 'owner' || recruitment.status !== 'open') {
				router.replace('/pair/:id', { params: { id: recruitment.id } });
				return;
			}
			editing.value = recruitment;
			selected.value = recruitment.projects.map(p => p.slug);
			teamSize.value = recruitment.teamSize;
			startTiming.value = recruitment.startTiming;
			startDate.value = recruitment.startDate ?? '';
			comment.value = recruitment.comment ?? '';
		} else {
			// 一覧は取り組める課題が上に並んでいるので、最初の取り組める課題を選んでおく
			const first = res.find(p => canWorkOn(p.state));
			selected.value = first != null ? [first.slug] : [];
		}
	} catch (err) {
		if (props.id != null) showPairRecruitmentError(err);
		loadError.value = true;
	}
}

load();

/** 選べる課題。編集のときは、募集にある課題が一覧から消えていても出す */
const projectRows = computed<ProjectRow[]>(() => {
	const rows: ProjectRow[] = (projects.value ?? []).map(p => ({ slug: p.slug, name: p.name, minGroupSize: p.minGroupSize, maxGroupSize: p.maxGroupSize, state: p.state }));
	for (const p of editing.value?.projects ?? []) {
		if (!rows.some(r => r.slug === p.slug)) rows.unshift({ slug: p.slug, name: p.name, minGroupSize: p.minGroupSize, maxGroupSize: p.maxGroupSize, state: p.myState ?? 'available' });
	}
	return rows;
});

/** 編集のとき、課題ごとの希望している人数 */
const wantedCounts = computed(() => new Map((editing.value?.projects ?? []).map(p => [p.slug, p.wantedCount])));

/** 募集に既にある課題は、取り組めなくなっていても残せる。新しく足す課題は取り組めるものだけ (バックエンドでも確かめる) */
function isSelectable(p: ProjectRow): boolean {
	if (selected.value.includes(p.slug)) return true;
	if (selected.value.length >= MAX_PROJECTS) return false;
	return canWorkOn(p.state) || (editing.value?.projects.some(e => e.slug === p.slug) ?? false);
}

function toggleProject(slug: string) {
	selected.value = selected.value.includes(slug)
		? selected.value.filter(s => s !== slug)
		: [...selected.value, slug];
}

const selectedRows = computed(() => selected.value.map(slug => projectRows.value.find(p => p.slug === slug)).filter(p => p != null));

/** 参加が決まった人数より少ない人数は選べない */
const minTeamSize = computed(() => (editing.value?.acceptedCount ?? 0) + 1);

const teamSizeOptions = computed(() => getCommonTeamSizes(selectedRows.value).map(n => ({
	value: n,
	label: i18n.tsx._pairRecruitment.teamSizeN({ n }),
	disabled: n < minTeamSize.value,
}) satisfies MkRadiosOption<number>));

const startTimingOptions = [
	{ value: 'now', label: i18n.ts._pairRecruitment._startTiming.now },
	{ value: 'nextWeek', label: i18n.ts._pairRecruitment._startTiming.nextWeek },
	{ value: 'nextMonth', label: i18n.ts._pairRecruitment._startTiming.nextMonth },
	{ value: 'date', label: i18n.ts._pairRecruitment._startTiming.date },
] as const satisfies MkRadiosOption<StartTiming>[];

// 課題を変えたら、人数を選んだ課題の範囲に収める
watch(teamSizeOptions, (options) => {
	const sizes = options.filter(o => !o.disabled).map(o => o.value);
	if (sizes.length > 0 && !sizes.includes(teamSize.value)) teamSize.value = sizes[0];
});

// バックエンドは、送った文をパラメータの maxLength (コードポイント単位) で、前後の空白を除いた文を UTF-16 の長さで確かめる。両方に合わせる
const commentTooLong = computed(() => [...comment.value].length > COMMENT_MAX_LENGTH || comment.value.trim().length > COMMENT_MAX_LENGTH);

const canSubmit = computed(() => {
	if (selected.value.length === 0) return false;
	if (!teamSizeOptions.value.some(o => o.value === teamSize.value && !o.disabled)) return false;
	if (startTiming.value === 'date' && startDate.value === '') return false;
	return !commentTooLong.value;
});

async function submit() {
	if (!canSubmit.value || submitting.value) return;
	submitting.value = true;
	try {
		const created = await os.promiseDialog(misskeyApi('pair-recruitments/create', {
			projectSlugs: selected.value,
			teamSize: teamSize.value,
			startTiming: startTiming.value,
			startDate: startTiming.value === 'date' ? startDate.value : null,
			comment: comment.value.trim() === '' ? null : comment.value,
			announce: announce.value,
		}), null, (err) => {
			showPairRecruitmentError(err);
		});
		router.push('/pair/:id', { params: { id: created.id } });
	} catch {
		// エラーは promiseDialog の onFailure で表示している
	} finally {
		submitting.value = false;
	}
}

async function save() {
	if (!canSubmit.value || submitting.value || editing.value == null) return;
	const recruitment = editing.value;

	// 希望している人がいる課題を外すときは確かめる
	const removed = recruitment.projects.filter(p => !selected.value.includes(p.slug) && p.wantedCount > 0);
	if (removed.length > 0) {
		const { canceled } = await os.confirm({
			type: 'warning',
			text: i18n.tsx._pairRecruitment.removeProjectConfirm({ names: removed.map(p => p.name).join(' / ') }),
		});
		if (canceled) return;
	}

	submitting.value = true;
	try {
		await os.promiseDialog(misskeyApi('pair-recruitments/update', {
			recruitmentId: recruitment.id,
			projectSlugs: selected.value,
			teamSize: teamSize.value,
			startTiming: startTiming.value,
			startDate: startTiming.value === 'date' ? startDate.value : null,
			comment: comment.value.trim() === '' ? null : comment.value,
		}), null, (err) => {
			showPairRecruitmentError(err);
		});
		router.push('/pair/:id', { params: { id: recruitment.id } });
	} catch {
		// エラーは promiseDialog の onFailure で表示している
	} finally {
		submitting.value = false;
	}
}

function cancel() {
	if (props.id != null) {
		router.push('/pair/:id', { params: { id: props.id } });
	} else {
		router.push('/pair');
	}
}

definePage(() => ({
	title: props.id != null ? i18n.ts._pairRecruitment.editTitle : i18n.ts._pairRecruitment.newTitle,
	icon: props.id != null ? 'ti ti-pencil' : 'ti ti-users-group',
}));
</script>

<style lang="scss" module>
.form {
	padding: 20px 24px;
}

.label {
	font-size: 0.85em;
	padding: 0 0 8px 0;
}

.caption {
	font-size: 0.85em;
	padding: 8px 0 0 0;
	color: color-mix(in srgb, var(--MI_THEME-fg), transparent 50%);
}

.rows {
	display: flex;
	flex-direction: column;
	border-radius: 8px;
	overflow: clip;
	border: solid 0.5px var(--MI_THEME-divider);
}

.row {
	display: flex;
	align-items: center;
	gap: 10px;
	min-height: 48px;
	padding: 8px 12px;
	text-align: left;

	& + & {
		border-top: solid 0.5px var(--MI_THEME-divider);
	}

	&:not(:disabled):hover {
		background: var(--MI_THEME-panelHighlight);
	}

	&:disabled {
		cursor: default;
		opacity: 0.5;
	}
}

.projectName {
	flex: 1;
	min-width: 0;
}

.count {
	padding: 2px 10px;
	border-radius: 999px;
	font-size: 0.85em;
	background: var(--MI_THEME-buttonBg);
}

.checkbox {
	flex: none;
	width: 20px;
	height: 20px;
	display: grid;
	place-items: center;
	box-sizing: border-box;
	border: solid 2px var(--MI_THEME-divider);
	border-radius: 5px;
	font-size: 14px;
	color: var(--MI_THEME-fgOnAccent);

	&.checked {
		border-color: var(--MI_THEME-accent);
		background: var(--MI_THEME-accent);
	}
}
</style>
