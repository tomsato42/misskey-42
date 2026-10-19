<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="$style.root" role="group" :aria-label="label">
	<MkIntraProjectResultTile :finalMark="result.finalMark" :validated="result.validated"/>
	<div :class="$style.body">
		<div :class="$style.row">
			<b :class="$style.name">{{ result.projectName }}</b>
			<MkIntraProjectResultStars v-if="result.outstandingCount != null" :count="result.outstandingCount"/>
			<button v-if="removable" v-tooltip="i18n.ts._intraProjectResult.removeProject" class="_button" :class="$style.remove" :aria-label="i18n.ts._intraProjectResult.removeProject" @click="emit('remove')">
				<i class="ti ti-x"></i>
			</button>
		</div>
		<div v-if="result.members.length > 0" :class="$style.members">
			<template v-for="member in result.members" :key="member.login">
				<MkAvatar v-if="member.user != null" :class="$style.avatar" :user="member.user" link preview/>
				<span v-else v-tooltip="member.login" :class="[$style.avatar, $style.noAccount]" role="img" :aria-label="member.login">{{ member.login.slice(0, 1).toUpperCase() }}</span>
			</template>
		</div>
	</div>
</div>
</template>

<script lang="ts" setup>
// 42 intra の課題の結果のカード (ノートの本文の下と投稿フォーム)。
// 左に intra と同じ点数のタイル、右に課題の名前・outstanding の星・チームのメンバー。
// メンバーのアイコンはプロフィールに飛ぶ。このサーバーにアカウントが無いメンバーは intra のログイン名の頭文字で出す
import { computed } from 'vue';
import type * as Misskey from 'misskey-js';
import MkIntraProjectResultTile from '@/components/MkIntraProjectResultTile.vue';
import MkIntraProjectResultStars from '@/components/MkIntraProjectResultStars.vue';
import { i18n } from '@/i18n.js';
import { getIntraProjectResultLabel } from '@/utility/intra-project-result.js';

const props = defineProps<{
	result: Misskey.entities.IntraProjectNote;
	removable?: boolean;
}>();

const emit = defineEmits<{
	(ev: 'remove'): void;
}>();

const label = computed(() => getIntraProjectResultLabel(props.result));
</script>

<style lang="scss" module>
.root {
	display: flex;
	border-radius: 6px;
	overflow: clip;
	border: solid 1px var(--MI_THEME-divider);
	background: var(--MI_THEME-bg);
}

.body {
	flex: 1;
	min-width: 0;
	display: flex;
	flex-direction: column;
	justify-content: center;
	gap: 8px;
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
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	// intra の課題の名前の色
	color: #00898b;
	font-size: 15px;
}

.remove {
	flex: none;
	padding: 4px;
	opacity: 0.7;

	&:hover {
		opacity: 1;
	}
}

.members {
	display: flex;
	flex-wrap: wrap;
	gap: 4px;
}

.avatar {
	width: 28px;
	height: 28px;
}

.noAccount {
	display: inline-grid;
	place-items: center;
	border-radius: 50%;
	background: var(--MI_THEME-buttonBg);
	font-size: 12px;
	font-weight: bold;
}
</style>
