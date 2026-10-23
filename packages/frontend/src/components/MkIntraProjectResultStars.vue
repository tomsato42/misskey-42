<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<span v-if="count > 0" :class="$style.root" :title="label" role="img" :aria-label="label">
	<i v-for="n in shown" :key="n" class="ti ti-star-filled" aria-hidden="true"></i>
	<span v-if="count > MAX_STARS" aria-hidden="true">{{ count }}</span>
</span>
</template>

<script lang="ts" setup>
// 課題の評価で付いた outstanding の数を星で出す。多いときは星を MAX_STARS 個にして数を添える
import { computed } from 'vue';
import { i18n } from '@/i18n.js';

const MAX_STARS = 5;

const props = defineProps<{
	count: number;
}>();

const shown = computed(() => Math.min(props.count, MAX_STARS));
const label = computed(() => i18n.tsx._intraProjectResult.outstanding({ n: props.count }));
</script>

<style lang="scss" module>
.root {
	flex: none;
	display: inline-flex;
	align-items: center;
	gap: 1px;
	color: #e0a100;
	font-size: 14px;
}
</style>
