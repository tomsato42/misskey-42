<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<span :class="[$style.root, $style[`state_${state}`]]">
	<i :class="icon" aria-hidden="true"></i>{{ label }}
</span>
</template>

<script lang="ts" setup>
import { computed } from 'vue';
import type { PairProjectState } from '@/utility/pair-recruitment.js';
import { i18n } from '@/i18n.js';

const props = withDefaults(defineProps<{
	state: PairProjectState;
	/** viewer: 閲覧者の状態 (あなたは取り組めます など)、member: メンバーや課題の状態 (取り組める など) */
	variant?: 'viewer' | 'member';
}>(), {
	variant: 'member',
});

const icons: Record<PairProjectState, string> = {
	available: 'ti ti-circle-check',
	in_progress: 'ti ti-progress',
	finished: 'ti ti-check',
	locked: 'ti ti-lock',
};

const icon = computed(() => icons[props.state]);
const label = computed(() => props.variant === 'viewer'
	? i18n.ts._pairRecruitment._viewerState[props.state]
	: i18n.ts._pairRecruitment._memberState[props.state]);
</script>

<style lang="scss" module>
.root {
	display: inline-flex;
	align-items: center;
	gap: 4px;
	padding: 2px 10px;
	border-radius: 999px;
	font-size: 0.85em;
	white-space: nowrap;
}

.state_available {
	background: var(--MI_THEME-accent);
	color: var(--MI_THEME-fgOnAccent);
	font-weight: bold;
}

.state_in_progress {
	box-shadow: inset 0 0 0 1px var(--MI_THEME-fg);
}

.state_finished {
	background: var(--MI_THEME-buttonBg);
	opacity: 0.8;
}

.state_locked {
	background: var(--MI_THEME-buttonBg);
	opacity: 0.6;
}
</style>
