<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="$style.root">
	<div :class="$style.header">
		<i class="ti ti-users-group" aria-hidden="true"></i>
		<span>{{ i18n.ts._pairRecruitment.cardTitle }}</span>
		<MkPairProjectStateBadge v-if="recruitment != null && recruitment.myProjectState != null && recruitment.myStatus !== 'owner'" :class="$style.state" :state="recruitment.myProjectState" variant="viewer"/>
	</div>
	<template v-if="recruitment != null">
		<MkA :to="detailPath" :class="[$style.title, $style.stretchedLink]">{{ recruitment.project.name }}</MkA>
		<div :class="$style.meta">
			<span v-if="isMultiProject(recruitment)"><i class="ti ti-list-check" aria-hidden="true"></i>{{ i18n.tsx._pairRecruitment.fromNProjects({ n: recruitment.projects.length }) }}</span>
			<span><i class="ti ti-users" aria-hidden="true"></i>{{ i18n.tsx._pairRecruitment.teamSizeAndRemaining({ n: recruitment.teamSize, m: remaining }) }}</span>
			<span><i class="ti ti-calendar" aria-hidden="true"></i>{{ getStartTimingText(recruitment) }}</span>
			<span v-if="recruitment.status !== 'open'"><i class="ti ti-circle-x" aria-hidden="true"></i>{{ closedText }}</span>
		</div>
		<div v-if="showActions && applicable" :class="[$style.actions, $style.raised]">
			<MkButton small rounded primary @click="apply">{{ i18n.ts._pairRecruitment.join }}</MkButton>
		</div>
	</template>
	<div v-else :class="$style.title"><MkEllipsis/></div>
</div>
</template>

<script lang="ts" setup>
import { computed, ref, watch } from 'vue';
import type * as Misskey from 'misskey-js';
import MkButton from '@/components/MkButton.vue';
import MkPairProjectStateBadge from '@/components/MkPairProjectStateBadge.vue';
import { i18n } from '@/i18n.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { canApply, getRemainingSlots, getStartTimingText, isMultiProject } from '@/utility/pair-recruitment.js';
import { applyToPairRecruitment } from '@/utility/pair-recruitment-dialog.js';

const props = withDefaults(defineProps<{
	recruitmentId: string;
	/** ボタン (参加したい・詳細) を出すか。ホバーのポップアップでは押せないので出さない */
	showActions?: boolean;
}>(), {
	showActions: true,
});

const emit = defineEmits<{
	/** 募集を取得できなかった (見られない・消えた)。呼び出し元は普通の URL プレビューに戻す */
	(ev: 'failed'): void;
}>();

const recruitment = ref<Misskey.entities.PairRecruitment | null>(null);

const detailPath = computed(() => `/pair/${props.recruitmentId}`);
const remaining = computed(() => recruitment.value == null ? 0 : getRemainingSlots(recruitment.value));
const applicable = computed(() => recruitment.value != null && canApply(recruitment.value));
const closedText = computed(() => {
	const reason = recruitment.value?.closedReason ?? 'manual';
	return i18n.tsx._pairRecruitment.closedWithReason({ reason: i18n.ts._pairRecruitment._closedReason[reason] });
});

watch(() => props.recruitmentId, (id) => {
	recruitment.value = null;
	misskeyApi('pair-recruitments/show', { recruitmentId: id }).then((res) => {
		if (props.recruitmentId === id) recruitment.value = res;
	}).catch(() => {
		if (props.recruitmentId === id) emit('failed');
	});
}, { immediate: true });

async function apply() {
	if (recruitment.value == null || !applicable.value) return;
	const updated = await applyToPairRecruitment(recruitment.value);
	if (updated != null) recruitment.value = updated;
}
</script>

<style lang="scss" module>
.root {
	position: relative;
	// 中の z-index をカードの中に閉じ込める
	isolation: isolate;
	display: flex;
	flex-direction: column;
	gap: 8px;
	padding: 12px 14px;
	border: 0.5px solid var(--MI_THEME-divider);
	border-radius: 8px;
	font-size: 0.9em;

	&:hover {
		background: var(--MI_THEME-panelHighlight);
	}
}

// 課題名のリンクをカード全体に広げる (Play や Page のカードと同じく、どこを押しても詳細に移る)。
// 参加したい のボタンは raised で手前に出す
.stretchedLink::after {
	content: "";
	position: absolute;
	inset: 0;
	// 半透明 (opacity) の行は重なりの順で手前に描かれるので、広げたリンクをそれより手前に出す
	z-index: 1;
}

.raised {
	position: relative;
	z-index: 2;
}

.header {
	display: flex;
	align-items: center;
	gap: 6px;
	opacity: 0.85;
}

.state {
	margin-left: auto;
}

.title {
	font-size: 1.15em;
	font-weight: bold;
	color: inherit;
}

.meta {
	display: flex;
	flex-wrap: wrap;
	gap: 4px 12px;
	opacity: 0.8;

	& > span {
		display: inline-flex;
		align-items: center;
		gap: 4px;
	}
}

.actions {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
}
</style>
