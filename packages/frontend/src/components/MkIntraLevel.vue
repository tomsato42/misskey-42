<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="$style.root" role="group" :aria-label="label">
	<span :class="$style.tile" aria-hidden="true">
		<span :class="$style.caption">LEVEL</span>
		<span :class="$style.number">{{ level }}</span>
	</span>
	<div :class="$style.body">
		<div :class="$style.row">
			<span :class="$style.name">Lv.{{ level }}</span>
			<button v-if="removable" v-tooltip="i18n.ts._intraLevel.remove" class="_button" :class="$style.remove" :aria-label="i18n.ts._intraLevel.remove" @click="emit('remove')">
				<i class="ti ti-x"></i>
			</button>
		</div>
		<div :class="$style.sub">{{ i18n.ts._intraLevel.caption }}</div>
	</div>
</div>
</template>

<script lang="ts" setup>
// 42 intra のレベルのカード (ノートの本文の下と投稿フォーム)。
// 左に intra の色のタイル、右にレベル。課題の結果のカード (MkIntraProjectResult) と同じ形にしている
import { computed } from 'vue';
import { i18n } from '@/i18n.js';

const props = defineProps<{
	level: number;
	removable?: boolean;
}>();

const emit = defineEmits<{
	(ev: 'remove'): void;
}>();

const label = computed(() => i18n.tsx._intraLevel.label({ level: props.level }));
</script>

<style lang="scss" module>
.root {
	display: flex;
	border-radius: 6px;
	overflow: clip;
	border: solid 1px var(--MI_THEME-divider);
	background: var(--MI_THEME-bg);
}

// intra の色に合わせ、テーマによらず固定する (文字は白)
.tile {
	flex: none;
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 4px;
	width: 104px;
	padding: 12px 0;
	background: #00babc;
	color: #fff;
}

.caption {
	font-size: 12px;
	letter-spacing: 0.1em;
}

.number {
	font-size: 36px;
	font-weight: 300;
	line-height: 1;
	font-variant-numeric: tabular-nums;
}

.body {
	flex: 1;
	min-width: 0;
	display: flex;
	flex-direction: column;
	justify-content: center;
	gap: 4px;
	padding: 12px 14px;
}

.row {
	display: flex;
	align-items: center;
	gap: 8px;
}

.name {
	flex: 1;
	min-width: 0;
	// intra の課題の名前と同じ色
	color: #00898b;
	font-size: 15px;
	font-weight: bold;
}

.sub {
	font-size: 0.85em;
	opacity: 0.7;
}

.remove {
	flex: none;
	padding: 4px;
	opacity: 0.7;

	&:hover {
		opacity: 1;
	}
}
</style>
