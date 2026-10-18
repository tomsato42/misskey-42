<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="[$style.root, { [$style.closed]: isClosed }]">
	<div :class="$style.row1">
		<MkA :to="detailPath" :class="[$style.project, $style.stretchedLink]">{{ recruitment.project.name }}</MkA>
		<span v-if="isClosed" :class="$style.closedBadge"><i class="ti ti-circle-x" aria-hidden="true"></i>{{ closedText }}</span>
		<MkPairProjectStateBadge v-if="recruitment.myProjectState != null && recruitment.myStatus !== 'owner'" :class="$style.state" :state="recruitment.myProjectState" variant="viewer"/>
	</div>
	<div :class="$style.who">
		<MkAvatar :class="[$style.avatar, $style.raised]" :user="recruitment.user" link preview/>
		<MkUserName :class="$style.name" :user="recruitment.user"/>
		<span :class="$style.sub"><MkAcct :user="recruitment.user"/><MkTime :time="recruitment.createdAt"/></span>
	</div>
	<div v-if="recruitment.comment" :class="$style.comment">{{ recruitment.comment }}</div>
	<div :class="$style.row3">
		<MkPairRecruitmentSlots :owner="recruitment.user" :teamSize="recruitment.teamSize" :acceptedCount="recruitment.acceptedCount"/>
		<span :class="$style.meta"><i class="ti ti-users" aria-hidden="true"></i>{{ i18n.tsx._pairRecruitment.teamSizeAndRemaining({ n: recruitment.teamSize, m: remaining }) }}</span>
		<span :class="$style.meta"><i class="ti ti-calendar" aria-hidden="true"></i>{{ startText }}</span>
		<div v-if="action != null" :class="[$style.action, $style.raised]">
			<MkButton v-if="action === 'pendingCount'" type="routerLink" :to="detailPath" small rounded primary>
				{{ i18n.tsx._pairRecruitment.pendingCount({ n: recruitment.pendingCount ?? 0 }) }}
			</MkButton>
			<span v-else-if="action === 'myStatus' && myStatusText != null" :class="$style.myStatus">{{ myStatusText }}</span>
			<MkButton v-else-if="action === 'advise'" small rounded @click="advise">
				<i class="ti ti-message"></i> {{ i18n.ts._pairRecruitment.advise }}
			</MkButton>
			<MkButton v-else-if="action === 'join'" small rounded primary :disabled="!applicable" @click="apply">
				{{ i18n.ts._pairRecruitment.join }}
			</MkButton>
		</div>
	</div>
</div>
</template>

<script lang="ts" setup>
import { computed } from 'vue';
import type * as Misskey from 'misskey-js';
import MkButton from '@/components/MkButton.vue';
import MkPairProjectStateBadge from '@/components/MkPairProjectStateBadge.vue';
import MkPairRecruitmentSlots from '@/components/MkPairRecruitmentSlots.vue';
import { i18n } from '@/i18n.js';
import { $i } from '@/i.js';
import { useRouter } from '@/router.js';
import { canApply, getRemainingSlots, getStartTimingText } from '@/utility/pair-recruitment.js';
import { pairRecruitmentAction } from '@/utility/pair-recruitment-action.js';

const props = defineProps<{
	recruitment: Misskey.entities.PairRecruitment;
}>();

const emit = defineEmits<{
	(ev: 'updated', recruitment: Misskey.entities.PairRecruitment): void;
}>();

const router = useRouter();

const detailPath = computed(() => `/pair/${props.recruitment.id}`);
const isClosed = computed(() => props.recruitment.status !== 'open');
const closedText = computed(() => {
	const reason = props.recruitment.closedReason;
	return i18n.tsx._pairRecruitment.closedWithReason({ reason: i18n.ts._pairRecruitment._closedReason[reason ?? 'manual'] });
});
const remaining = computed(() => getRemainingSlots(props.recruitment));
const startText = computed(() => getStartTimingText(props.recruitment));
const applicable = computed(() => canApply(props.recruitment));
const canChat = computed(() => $i != null && $i.policies.chatAvailability === 'available');

/**
 * カードの右下に出すもの。締め切った募集では出さない。
 * 作成者には参加希望の件数、参加希望を送った人にはその状態、完了済みの人にはアドバイス (作成者とのチャット)、それ以外には参加したい
 */
const action = computed<'pendingCount' | 'myStatus' | 'advise' | 'join' | null>(() => {
	const r = props.recruitment;
	if (r.status !== 'open') return null;
	if (r.myStatus === 'owner') return (r.pendingCount ?? 0) > 0 ? 'pendingCount' : null;
	if (r.myStatus === 'pending' || r.myStatus === 'accepted' || r.myStatus === 'rejected') return 'myStatus';
	if (r.myProjectState === 'finished') return canChat.value ? 'advise' : null;
	return 'join';
});

const myStatusText = computed(() => {
	const s = props.recruitment.myStatus;
	if (s === 'pending' || s === 'accepted' || s === 'rejected') return i18n.ts._pairRecruitment._myStatus[s];
	return null;
});

async function apply() {
	if (!applicable.value) return;
	const updated = await pairRecruitmentAction('pair-recruitments/apply', { recruitmentId: props.recruitment.id });
	if (updated != null) emit('updated', updated);
}

function advise() {
	router.push('/chat/user/:userId', { params: { userId: props.recruitment.userId } });
}
</script>

<style lang="scss" module>
.root {
	position: relative;
	display: flex;
	flex-direction: column;
	gap: 10px;
	padding: 20px 24px;

	&:hover {
		background: var(--MI_THEME-panelHighlight);
	}
}

// 課題名のリンクをカード全体に広げ、カードのどこを押しても詳細に移る (中クリックで新しいタブにも開ける)。
// カードの中のアバターとボタンは、raised で広げたリンクより手前に出して、それぞれの動作を優先する
.stretchedLink::after {
	content: "";
	position: absolute;
	inset: 0;
}

.raised {
	position: relative;
	z-index: 1;
}

.closed {
	opacity: 0.7;
}

.row1 {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 8px;
}

.project {
	font-size: 1.15em;
	font-weight: bold;
	color: inherit;
}

.state {
	margin-left: auto;
}

.closedBadge {
	display: inline-flex;
	align-items: center;
	gap: 4px;
	padding: 2px 10px;
	border-radius: 999px;
	font-size: 0.85em;
	white-space: nowrap;
	background: var(--MI_THEME-buttonBg);
}

.who {
	display: flex;
	align-items: center;
	gap: 8px;
	min-width: 0;
	font-size: 0.9em;
}

.avatar {
	width: 28px;
	height: 28px;
	flex: none;
}

.name {
	font-weight: bold;
}

.sub {
	min-width: 0;
	opacity: 0.7;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;

	& > * + *::before {
		content: " ・ ";
	}
}

.comment {
	line-height: 1.5;
	white-space: pre-wrap;
	overflow-wrap: anywhere;
}

.row3 {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 12px;
	font-size: 0.9em;
}

.meta {
	display: flex;
	align-items: center;
	gap: 4px;
	opacity: 0.75;
}

.action {
	margin-left: auto;
}

.myStatus {
	color: var(--MI_THEME-accent);
	font-weight: bold;
}
</style>
