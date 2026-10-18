<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<span :class="$style.root" :aria-label="i18n.tsx._pairRecruitment.teamSizeAndRemaining({ n: teamSize, m: remaining })" role="img">
	<MkAvatar :class="$style.slot" :user="owner"/>
	<MkAvatar v-for="member in shownMembers" :key="member.id" :class="$style.slot" :user="member"/>
	<span v-for="n in unknownFilled" :key="`filled-${n}`" :class="[$style.slot, $style.filled]"><i class="ti ti-user" aria-hidden="true"></i></span>
	<span v-for="n in remaining" :key="`empty-${n}`" :class="[$style.slot, $style.empty]"></span>
</span>
</template>

<script lang="ts" setup>
import { computed } from 'vue';
import type * as Misskey from 'misskey-js';
import { i18n } from '@/i18n.js';
import { getRemainingSlots } from '@/utility/pair-recruitment.js';

const props = defineProps<{
	owner: Misskey.entities.UserLite;
	teamSize: number;
	/** 承認済みのメンバーの人数 (作成者を含まない) */
	acceptedCount: number;
	/** 承認済みのメンバー。分かるときだけ渡す (無ければ人数だけを塗りつぶして表示する) */
	members?: Misskey.entities.UserLite[];
}>();

const shownMembers = computed(() => (props.members ?? []).slice(0, props.acceptedCount));
const unknownFilled = computed(() => Math.max(0, props.acceptedCount - shownMembers.value.length));
const remaining = computed(() => getRemainingSlots(props));
</script>

<style lang="scss" module>
.root {
	display: inline-flex;
	flex-wrap: wrap;
	gap: 4px;
}

.slot {
	width: 26px;
	height: 26px;
	flex: none;
}

.filled {
	display: grid;
	place-items: center;
	border-radius: 100%;
	font-size: 12px;
	background: var(--MI_THEME-buttonHoverBg);
}

.empty {
	border-radius: 100%;
	box-shadow: inset 0 0 0 1.5px var(--MI_THEME-divider);
}
</style>
