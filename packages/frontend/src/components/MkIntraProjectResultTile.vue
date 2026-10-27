<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<span v-if="small" :class="[$style.square, validated ? $style.success : $style.fail]" role="img" :aria-label="label" :title="label">{{ finalMark }}</span>
<span v-else :class="[$style.tile, validated ? $style.success : $style.fail]">
	<span :class="$style.status">
		<i :class="validated ? 'ti ti-check' : 'ti ti-x'" aria-hidden="true"></i>{{ validated ? i18n.ts._intraProjectResult.success : i18n.ts._intraProjectResult.fail }}
	</span>
	<span :class="$style.mark">{{ finalMark }}<small>{{ i18n.ts._intraProjectResult.outOf }}</small></span>
</span>
</template>

<script lang="ts" setup>
// 42 intra の課題の結果の点数 (intra の画面と同じ、合格は緑・不合格は赤)。
// small は通知と課題の選択に使う小さい四角、それ以外はノートのカードの左に置く大きいタイル
import { computed } from 'vue';
import { i18n } from '@/i18n.js';

const props = defineProps<{
	finalMark: number;
	validated: boolean;
	small?: boolean;
}>();

// 小さい四角は色でしか合否が分からないので、読み上げとツールチップに合否を出す
const label = computed(() => `${props.finalMark}${i18n.ts._intraProjectResult.outOf} ${props.validated ? i18n.ts._intraProjectResult.success : i18n.ts._intraProjectResult.fail}`);
</script>

<style lang="scss" module>
// intra の色に合わせ、テーマによらず固定する (文字は白)
.success {
	background: #5cb85c;
}

.fail {
	background: #d8636f;
}

.square {
	flex: none;
	display: inline-grid;
	place-items: center;
	width: 44px;
	height: 30px;
	border-radius: 4px;
	color: #fff;
	font-weight: bold;
	font-size: 14px;
	font-variant-numeric: tabular-nums;
}

.tile {
	flex: none;
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 4px;
	width: 104px;
	padding: 12px 0;
	color: #fff;
}

.status {
	display: flex;
	align-items: center;
	gap: 4px;
	font-size: 15px;
}

.mark {
	font-size: 36px;
	font-weight: 300;
	line-height: 1;
	font-variant-numeric: tabular-nums;

	> small {
		margin-left: 1px;
		font-size: 10px;
	}
}
</style>
