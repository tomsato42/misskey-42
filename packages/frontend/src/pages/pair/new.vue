<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader>
	<div class="_spacer" style="--MI_SPACER-w: 640px;">
		<MkLoading v-if="projects == null && !projectsError"/>
		<MkError v-else-if="projectsError" @retry="fetchProjects()"/>
		<div v-else class="_panel" :class="$style.form">
			<div class="_gaps">
				<MkInfo v-if="projects != null && projects.length === 0" warn>{{ i18n.ts._pairRecruitment.noProjects }}</MkInfo>
				<MkInfo v-else-if="projects != null && !projects.some(p => canWorkOn(p.state))" warn>{{ i18n.ts._pairRecruitment.noWorkableProjects }}</MkInfo>

				<MkRadios v-if="projects != null && projects.length > 0" v-model="projectSlug" :options="projectOptions" vertical>
					<template #label>{{ i18n.ts._pairRecruitment.project }}</template>
					<template v-for="p in projects" :key="p.slug" #[`option-${p.slug}`]>
						<div :class="$style.projectOption">
							<i class="ti ti-folder-code" aria-hidden="true"></i>
							<b :class="$style.projectName">{{ p.name }}</b>
							<MkPairProjectStateBadge :state="p.state"/>
						</div>
					</template>
				</MkRadios>

				<MkRadios v-if="selectedProject != null" v-model="teamSize" :options="teamSizeOptions">
					<template #label>{{ i18n.ts._pairRecruitment.teamSize }}</template>
				</MkRadios>

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

				<MkSwitch v-model="announce">
					<template #label>{{ i18n.ts._pairRecruitment.announce }}</template>
					<template #caption>{{ i18n.ts._pairRecruitment.announceDescription }}</template>
				</MkSwitch>

				<div class="_buttons">
					<MkButton primary gradate rounded :disabled="!canSubmit || submitting" @click="submit"><i class="ti ti-send"></i> {{ i18n.ts._pairRecruitment.recruit }}</MkButton>
					<MkButton rounded @click="cancel">{{ i18n.ts.cancel }}</MkButton>
				</div>
			</div>
		</div>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
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
import { canWorkOn, getTeamSizeRange } from '@/utility/pair-recruitment.js';
import { showPairRecruitmentError } from '@/utility/pair-recruitment-action.js';

/** ひとことの最大の長さ (バックエンドの PAIR_RECRUITMENT_COMMENT_MAX_LENGTH と同じ) */
const COMMENT_MAX_LENGTH = 500;

type StartTiming = Misskey.entities.PairRecruitment['startTiming'];

const router = useRouter();

const projects = ref<Misskey.entities.PairRecruitmentProject[] | null>(null);
const projectsError = ref(false);
const projectSlug = ref<string | null>(null);
const teamSize = ref(2);
const startTiming = ref<StartTiming>('now');
const startDate = ref('');
const comment = ref('');
const announce = ref(true);
const submitting = ref(false);

function fetchProjects() {
	projectsError.value = false;
	misskeyApi('pair-recruitments/projects').then((res) => {
		projects.value = res;
		// 一覧は取り組める課題が上に並んでいるので、最初の取り組める課題を選んでおく
		projectSlug.value = res.find(p => canWorkOn(p.state))?.slug ?? null;
	}).catch(() => {
		projectsError.value = true;
	});
}

fetchProjects();

const selectedProject = computed(() => projects.value?.find(p => p.slug === projectSlug.value) ?? null);

// 未解放・完了済みの課題は選べないようにする (バックエンドでも作成できない)
const projectOptions = computed<MkRadiosOption<string | null>[]>(() => (projects.value ?? []).map(p => ({
	value: p.slug,
	slotId: p.slug,
	disabled: !canWorkOn(p.state),
})));

const teamSizeOptions = computed(() => (selectedProject.value == null ? [] : getTeamSizeRange(selectedProject.value)).map(n => ({
	value: n,
	label: i18n.tsx._pairRecruitment.teamSizeN({ n }),
}) satisfies MkRadiosOption<number>));

const startTimingOptions = [
	{ value: 'now', label: i18n.ts._pairRecruitment._startTiming.now },
	{ value: 'nextWeek', label: i18n.ts._pairRecruitment._startTiming.nextWeek },
	{ value: 'nextMonth', label: i18n.ts._pairRecruitment._startTiming.nextMonth },
	{ value: 'date', label: i18n.ts._pairRecruitment._startTiming.date },
] as const satisfies MkRadiosOption<StartTiming>[];

// 課題を変えたら、人数をその課題の範囲に収める
watch(selectedProject, (project) => {
	if (project == null) return;
	const sizes = getTeamSizeRange(project);
	if (sizes.length > 0 && !sizes.includes(teamSize.value)) teamSize.value = sizes[0];
});

// バックエンドは、送った文をパラメータの maxLength (コードポイント単位) で、前後の空白を除いた文を UTF-16 の長さで確かめる。両方に合わせる
const commentTooLong = computed(() => [...comment.value].length > COMMENT_MAX_LENGTH || comment.value.trim().length > COMMENT_MAX_LENGTH);

const canSubmit = computed(() => {
	if (selectedProject.value == null || !canWorkOn(selectedProject.value.state)) return false;
	if (!getTeamSizeRange(selectedProject.value).includes(teamSize.value)) return false;
	if (startTiming.value === 'date' && startDate.value === '') return false;
	return !commentTooLong.value;
});

async function submit() {
	if (!canSubmit.value || submitting.value || projectSlug.value == null) return;
	submitting.value = true;
	try {
		const created = await os.promiseDialog(misskeyApi('pair-recruitments/create', {
			projectSlug: projectSlug.value,
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

function cancel() {
	router.push('/pair');
}

definePage(() => ({
	title: i18n.ts._pairRecruitment.newTitle,
	icon: 'ti ti-users-group',
}));
</script>

<style lang="scss" module>
.form {
	padding: 20px 24px;
}

.projectOption {
	display: flex;
	align-items: center;
	gap: 10px;
}

.projectName {
	flex: 1;
	min-width: 0;
}
</style>
