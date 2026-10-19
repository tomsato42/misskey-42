<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader :actions="headerActions">
	<div class="_spacer" style="--MI_SPACER-w: 800px;">
		<MkA to="/pair" :class="$style.back"><i class="ti ti-arrow-left" aria-hidden="true"></i>{{ i18n.ts._pairRecruitment.backToList }}</MkA>
		<div v-if="recruitment != null" class="_gaps">
			<div class="_panel" :class="$style.main">
				<div :class="$style.badges">
					<MkPairProjectStateBadge v-if="recruitment.myProjectState != null && !isOwner" :state="recruitment.myProjectState" variant="viewer"/>
					<span v-if="multi" :class="[$style.badge, $style.badgeTag]">{{ i18n.tsx._pairRecruitment.fromNProjects({ n: recruitment.projects.length }) }}</span>
					<span v-if="isOpen" :class="[$style.badge, $style.badgeRemaining]"><i class="ti ti-users" aria-hidden="true"></i>{{ i18n.tsx._pairRecruitment.remaining({ n: remaining }) }}</span>
					<span v-else :class="[$style.badge, $style.badgeClosed]"><i class="ti ti-circle-x" aria-hidden="true"></i>{{ closedText }}</span>
				</div>
				<h1 :class="$style.title">{{ recruitment.project.name }}</h1>
				<div :class="$style.rows">
					<i class="ti ti-stairs" aria-hidden="true"></i><span>{{ getGroupSizeText(recruitment.project) }}</span>
					<i class="ti ti-users" aria-hidden="true"></i>
					<span :class="$style.slotsRow">
						<MkPairRecruitmentSlots :owner="recruitment.user" :teamSize="recruitment.teamSize" :acceptedCount="recruitment.acceptedCount" :members="acceptedUsers"/>
						<span>{{ i18n.tsx._pairRecruitment.memberFraction({ current: recruitment.acceptedCount + 1, n: recruitment.teamSize }) }}</span>
					</span>
					<i class="ti ti-calendar" aria-hidden="true"></i><span>{{ getStartTimingText(recruitment) }}</span>
					<i class="ti ti-user" aria-hidden="true"></i>
					<I18n :src="i18n.ts._pairRecruitment.recruitedBy" tag="span">
						<template #user><MkA v-user-preview="recruitment.userId" :to="userPage(recruitment.user)"><MkAcct :user="recruitment.user"/></MkA></template>
					</I18n>
					<i class="ti ti-clock" aria-hidden="true"></i>
					<span v-if="isOpen">{{ expiresText }}</span>
					<span v-else-if="recruitment.closedAt != null"><MkTime :time="recruitment.closedAt" mode="detail"/></span>
					<span v-else>{{ closedText }}</span>
					<template v-if="recruitment.noteId != null">
						<i class="ti ti-note" aria-hidden="true"></i><MkA :to="`/notes/${recruitment.noteId}`" class="_link">{{ i18n.ts._pairRecruitment.announcementNote }}</MkA>
					</template>
					<template v-if="!multi">
						<i class="ti ti-external-link" aria-hidden="true"></i><a :href="getIntraProjectUrl(recruitment.project.slug)" target="_blank" rel="noopener noreferrer" class="_link">{{ i18n.ts._pairRecruitment.intraProjectPage }}</a>
					</template>
					<template v-if="recruitment.ownerIntraProjectUrl != null">
						<i class="ti ti-external-link" aria-hidden="true"></i><a :href="recruitment.ownerIntraProjectUrl" target="_blank" rel="noopener noreferrer" class="_link">{{ i18n.ts._pairRecruitment.ownerIntraProjectPage }}</a>
					</template>
				</div>
				<div v-if="recruitment.comment" :class="$style.comment">{{ recruitment.comment }}</div>
				<I18n v-if="recruitment.myStatus === 'invited' && isOpen" :src="i18n.ts._pairRecruitment.invitedNotice" tag="div" :class="$style.myStatus">
					<template #user><MkUserName :user="recruitment.user"/></template>
				</I18n>
				<div v-else-if="myStatusText != null" :class="$style.myStatus">{{ myStatusText }}</div>
				<div class="_buttons">
					<MkButton v-if="showJoin" primary rounded :disabled="!applicable" @click="apply"><i class="ti ti-hand-stop"></i> {{ i18n.ts._pairRecruitment.join }}</MkButton>
					<MkButton v-if="showDecline" rounded @click="decline"><i class="ti ti-x"></i> {{ i18n.ts._pairRecruitment.declineInvitation }}</MkButton>
					<MkButton v-if="showWithdraw" rounded @click="withdraw"><i class="ti ti-arrow-back-up"></i> {{ i18n.ts._pairRecruitment.withdraw }}</MkButton>
					<MkButton v-if="showInvite" primary rounded @click="invite"><i class="ti ti-user-plus"></i> {{ i18n.ts._pairRecruitment.invite }}</MkButton>
					<MkButton v-if="showMessage" rounded @click="sendMessage"><i class="ti ti-message"></i> {{ i18n.ts._pairRecruitment.sendMessage }}</MkButton>
					<MkButton rounded @click="share"><i class="ti ti-share"></i> {{ i18n.ts._pairRecruitment.share }}</MkButton>
					<MkButton rounded @click="copyLink"><i class="ti ti-link"></i> {{ i18n.ts.copyLink }}</MkButton>
				</div>
			</div>

			<template v-if="multi">
				<div :class="$style.sectionLabel"><i class="ti ti-list-check" aria-hidden="true"></i>{{ i18n.ts._pairRecruitment.wantedProjects }}</div>
				<div class="_panel" :class="$style.projects">
					<div v-for="project in recruitment.projects" :key="project.slug" :class="$style.project">
						<a :href="getIntraProjectUrl(project.slug)" target="_blank" rel="noopener noreferrer" class="_link" :class="$style.projectName">{{ project.name }}</a>
						<div :class="$style.bar" aria-hidden="true"><div :class="$style.barIn" :style="{ width: `${getBarWidth(project.wantedCount)}%` }"></div></div>
						<span :class="$style.projectCount">{{ i18n.tsx._pairRecruitment.teamSizeN({ n: project.wantedCount }) }}</span>
						<MkPairProjectStateBadge v-if="!isOwner && project.myState != null" :state="project.myState" variant="viewer"/>
					</div>
				</div>
			</template>

			<div :class="$style.sectionLabel"><i class="ti ti-users" aria-hidden="true"></i>{{ i18n.ts._pairRecruitment.members }}</div>
			<div class="_panel" :class="$style.members">
				<div :class="$style.member">
					<MkAvatar :class="$style.memberAvatar" :user="recruitment.user" link preview/>
					<div :class="$style.memberName">
						<MkUserName :user="recruitment.user"/>
						<small :class="$style.memberSub"><MkAcct :user="recruitment.user"/><span>{{ i18n.ts._pairRecruitment.owner }}</span></small>
						<span v-if="multi" :class="$style.wanted">
							<span v-for="project in recruitment.projects" :key="project.slug" :class="$style.wantedChip">{{ project.name }}</span>
						</span>
					</div>
					<MkPairProjectStateBadge v-if="isOwner && recruitment.myProjectState != null" :state="recruitment.myProjectState"/>
				</div>
				<div v-for="member in recruitment.members" :key="member.id" :class="$style.member">
					<MkAvatar :class="$style.memberAvatar" :user="member.user" link preview/>
					<div :class="$style.memberName">
						<MkUserName :user="member.user"/>
						<small :class="$style.memberSub"><MkAcct :user="member.user"/><span>{{ i18n.ts._pairRecruitment._memberStatus[member.status] }}</span></small>
						<span v-if="multi && member.wantedProjectSlugs.length > 0" :class="$style.wanted">
							<span v-for="name in getProjectNames(member.wantedProjectSlugs)" :key="name" :class="$style.wantedChip">{{ name }}</span>
						</span>
					</div>
					<MkPairProjectStateBadge v-if="member.projectState != null" :state="member.projectState"/>
					<template v-if="isOwner && isOpen && member.status === 'pending'">
						<MkButton small rounded primary :disabled="!canWorkOn(member.projectState) || remaining === 0" @click="accept(member)">{{ i18n.ts._pairRecruitment.accept }}</MkButton>
						<MkButton small rounded @click="reject(member)">{{ i18n.ts._pairRecruitment.reject }}</MkButton>
					</template>
				</div>
			</div>

			<template v-if="isOwner && recruitment.invitations.length > 0">
				<div :class="$style.sectionLabel"><i class="ti ti-mail" aria-hidden="true"></i>{{ i18n.ts._pairRecruitment.invitations }}</div>
				<div class="_panel" :class="$style.members">
					<div v-for="invitation in recruitment.invitations" :key="invitation.id" :class="$style.member">
						<MkAvatar :class="$style.memberAvatar" :user="invitation.user" link preview/>
						<div :class="$style.memberName">
							<MkUserName :user="invitation.user"/>
							<small :class="$style.memberSub"><MkAcct :user="invitation.user"/><span>{{ invitation.status === 'declined' ? i18n.ts._pairRecruitment.invitationDeclined : i18n.ts._pairRecruitment.invitationWaiting }}</span></small>
						</div>
						<MkButton v-if="isOpen && invitation.status === 'invited'" small rounded @click="cancelInvitation(invitation)">{{ i18n.ts._pairRecruitment.cancelInvitation }}</MkButton>
					</div>
				</div>
			</template>
		</div>
		<MkResult v-else-if="notFound" type="notFound"/>
		<MkResult v-else-if="errorText != null" type="error" :text="errorText"/>
		<MkError v-else-if="error" @retry="fetchRecruitment()"/>
		<MkLoading v-else/>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { computed, ref, watch } from 'vue';
import { url } from '@@/js/config.js';
import type * as Misskey from 'misskey-js';
import type { MenuItem } from '@/types/menu.js';
import type { PageHeaderItem } from '@/types/page-header.js';
import MkButton from '@/components/MkButton.vue';
import MkPairProjectStateBadge from '@/components/MkPairProjectStateBadge.vue';
import MkPairRecruitmentSlots from '@/components/MkPairRecruitmentSlots.vue';
import * as os from '@/os.js';
import { $i } from '@/i.js';
import { i18n } from '@/i18n.js';
import { definePage } from '@/page.js';
import { useRouter } from '@/router.js';
import { userPage } from '@/filters/user.js';
import { copyToClipboard } from '@/utility/copy-to-clipboard.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { canApply, canWorkOn, getDaysUntil, getGroupSizeText, getPairRecruitmentErrorText, getPairRecruitmentUrl, getRemainingSlots, getStartTimingText, isMultiProject } from '@/utility/pair-recruitment.js';
import { pairRecruitmentAction } from '@/utility/pair-recruitment-action.js';
import { applyToPairRecruitment, openPairInviteDialog, openPairShareDialog } from '@/utility/pair-recruitment-dialog.js';

const props = defineProps<{
	id: string;
}>();

const router = useRouter();

const recruitment = ref<Misskey.entities.PairRecruitmentDetailed | null>(null);
const error = ref(false);
const notFound = ref(false);
const errorText = ref<string | null>(null);

function fetchRecruitment() {
	const id = props.id;
	recruitment.value = null;
	error.value = false;
	errorText.value = null;
	notFound.value = false;
	misskeyApi('pair-recruitments/show', { recruitmentId: id }).then((res) => {
		if (props.id === id) recruitment.value = res;
	}).catch((err: Misskey.api.APIError | null | undefined) => {
		if (props.id !== id) return;
		if (err?.code === 'NO_SUCH_RECRUITMENT') {
			notFound.value = true;
		} else {
			// 再試行しても変わらないエラー (ペア募集を使えないなど) は理由を出す。それ以外は再試行できるようにする
			errorText.value = getPairRecruitmentErrorText(err);
			error.value = true;
		}
	});
}

watch(() => props.id, fetchRecruitment, { immediate: true });

const isOwner = computed(() => recruitment.value?.myStatus === 'owner');
const isOpen = computed(() => recruitment.value?.status === 'open');
const multi = computed(() => recruitment.value != null && isMultiProject(recruitment.value));

/** 42 intra の課題のページ。42 API の課題の slug がそのまま URL になる */
function getIntraProjectUrl(slug: string): string {
	return `https://projects.intra.42.fr/projects/${encodeURIComponent(slug)}`;
}

/** 課題の slug を、募集の課題の順に名前にする */
function getProjectNames(slugs: string[]): string[] {
	return (recruitment.value?.projects ?? []).filter(p => slugs.includes(p.slug)).map(p => p.name);
}

/** 希望の人数の棒の長さ (いちばん多い課題を 100%) */
function getBarWidth(count: number): number {
	const max = Math.max(...(recruitment.value?.projects ?? []).map(p => p.wantedCount));
	return max <= 0 ? 0 : Math.round(count / max * 100);
}

const remaining = computed(() => recruitment.value == null ? 0 : getRemainingSlots(recruitment.value));
const applicable = computed(() => recruitment.value != null && canApply(recruitment.value));
const canChat = computed(() => $i != null && $i.policies.chatAvailability === 'available');
const acceptedUsers = computed(() => (recruitment.value?.members ?? []).filter(m => m.status === 'accepted').map(m => m.user));

const closedText = computed(() => {
	const reason = recruitment.value?.closedReason ?? 'manual';
	return i18n.tsx._pairRecruitment.closedWithReason({ reason: i18n.ts._pairRecruitment._closedReason[reason] });
});

const expiresText = computed(() => {
	if (recruitment.value == null) return '';
	const days = getDaysUntil(recruitment.value.expiresAt, new Date());
	return days <= 1 ? i18n.ts._pairRecruitment.expiresSoon : i18n.tsx._pairRecruitment.expiresInDays({ n: days });
});

const myStatusText = computed(() => {
	const s = recruitment.value?.myStatus;
	if (s === 'pending' || s === 'accepted' || s === 'rejected') return i18n.ts._pairRecruitment._myStatus[s];
	return null;
});

/** 参加したい: 募集中で、まだ参加希望を送っていない (取り下げた人・招待された人を含む) 人に出す。完了済みの人には出さない */
const showJoin = computed(() => {
	const r = recruitment.value;
	if (r == null || r.status !== 'open') return false;
	if (r.myStatus != null && r.myStatus !== 'withdrawn' && r.myStatus !== 'invited' && r.myStatus !== 'declined') return false;
	return r.myProjectState !== 'finished';
});
/** 今回は見送る: 募集中で、招待に返事をしていない人に出す */
const showDecline = computed(() => isOpen.value && recruitment.value?.myStatus === 'invited');
/** 取り組める人を招待: 募集中で、まだ空きがあるとき作成者に出す */
const showInvite = computed(() => isOwner.value && isOpen.value && remaining.value > 0);
/** 取り下げる: 募集中で、参加希望中か参加している人に出す */
const showWithdraw = computed(() => isOpen.value && (recruitment.value?.myStatus === 'pending' || recruitment.value?.myStatus === 'accepted'));
/** メッセージを送る: 作成者以外に出す (チャットを使えるときだけ) */
const showMessage = computed(() => recruitment.value != null && !isOwner.value && canChat.value);

function update(updated: Misskey.entities.PairRecruitmentDetailed | null) {
	if (updated != null) recruitment.value = updated;
}

async function apply() {
	if (recruitment.value == null || !applicable.value) return;
	update(await applyToPairRecruitment(recruitment.value));
}

async function decline() {
	if (recruitment.value == null) return;
	const { canceled } = await os.confirm({
		type: 'question',
		text: i18n.ts._pairRecruitment.declineConfirm,
	});
	if (canceled) return;
	update(await pairRecruitmentAction('pair-recruitments/decline', { recruitmentId: recruitment.value.id }));
}

async function invite() {
	if (recruitment.value == null) return;
	update(await openPairInviteDialog(recruitment.value));
}

async function cancelInvitation(invitation: Misskey.entities.PairMember) {
	if (recruitment.value == null) return;
	const { canceled } = await os.confirm({
		type: 'warning',
		text: i18n.tsx._pairRecruitment.cancelInvitationConfirm({ name: invitation.user.name ?? invitation.user.username }),
	});
	if (canceled) return;
	update(await pairRecruitmentAction('pair-recruitments/cancel-invitation', { recruitmentId: recruitment.value.id, userId: invitation.userId }));
}

async function withdraw() {
	if (recruitment.value == null) return;
	const { canceled } = await os.confirm({
		type: 'warning',
		text: i18n.ts._pairRecruitment.withdrawConfirm,
	});
	if (canceled) return;
	update(await pairRecruitmentAction('pair-recruitments/withdraw', { recruitmentId: recruitment.value.id }));
}

async function accept(member: Misskey.entities.PairMember) {
	if (recruitment.value == null || !canWorkOn(member.projectState)) return;
	update(await pairRecruitmentAction('pair-recruitments/accept', { recruitmentId: recruitment.value.id, userId: member.userId }));
}

async function reject(member: Misskey.entities.PairMember) {
	if (recruitment.value == null) return;
	const { canceled } = await os.confirm({
		type: 'warning',
		text: i18n.tsx._pairRecruitment.rejectConfirm({ name: member.user.name ?? member.user.username }),
	});
	if (canceled) return;
	update(await pairRecruitmentAction('pair-recruitments/reject', { recruitmentId: recruitment.value.id, userId: member.userId }));
}

async function close() {
	if (recruitment.value == null) return;
	const { canceled } = await os.confirm({
		type: 'warning',
		text: i18n.ts._pairRecruitment.closeConfirm,
	});
	if (canceled) return;
	update(await pairRecruitmentAction('pair-recruitments/close', { recruitmentId: recruitment.value.id }));
}

function sendMessage() {
	if (recruitment.value == null) return;
	router.push('/chat/user/:userId', { params: { userId: recruitment.value.userId } });
}

function share() {
	if (recruitment.value != null) openPairShareDialog(recruitment.value);
}

function copyLink() {
	copyToClipboard(getPairRecruitmentUrl(url, props.id));
}

// 共有とリンクのコピーは本文のボタンに置き、メニューには作成者の操作 (編集・締め切り) だけを出す
const headerActions = computed<PageHeaderItem[]>(() => recruitment.value == null || !isOwner.value || !isOpen.value ? [] : [{
	icon: 'ti ti-dots',
	text: i18n.ts.menu,
	handler: (ev) => {
		const items: MenuItem[] = [];
		if (isOwner.value && isOpen.value) {
			items.push({
				icon: 'ti ti-pencil',
				text: i18n.ts._pairRecruitment.edit,
				action: () => {
					router.push('/pair/:id/edit', { params: { id: props.id } });
				},
			}, {
				icon: 'ti ti-lock',
				text: i18n.ts._pairRecruitment.close,
				danger: true,
				action: close,
			});
		}
		os.popupMenu(items, ev.currentTarget ?? ev.target);
	},
}]);

definePage(() => ({
	title: recruitment.value?.project.name ?? i18n.ts._pairRecruitment.title,
	icon: 'ti ti-users-group',
}));
</script>

<style lang="scss" module>
.back {
	display: inline-flex;
	align-items: center;
	gap: 6px;
	margin-bottom: 12px;
	font-size: 0.9em;
	color: var(--MI_THEME-accent);

	&:hover {
		text-decoration: underline;
	}
}

.main {
	display: flex;
	flex-direction: column;
	gap: 14px;
	padding: 24px 28px;
}

.badges {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 8px;
}

.badge {
	display: inline-flex;
	align-items: center;
	gap: 4px;
	padding: 2px 10px;
	border-radius: 999px;
	font-size: 0.85em;
	white-space: nowrap;
}

.badgeRemaining {
	box-shadow: inset 0 0 0 1px var(--MI_THEME-fg);
}

.badgeClosed {
	background: var(--MI_THEME-buttonBg);
}

.badgeTag {
	background: var(--MI_THEME-accentedBg);
	color: var(--MI_THEME-accent);
}

.title {
	margin: 0;
	font-size: 1.6em;
	line-height: 1.25;
}

.rows {
	display: grid;
	grid-template-columns: 24px 1fr;
	align-items: center;
	gap: 8px 6px;

	& > i {
		opacity: 0.7;
	}
}

.slotsRow {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 8px;
}

.comment {
	line-height: 1.6;
	white-space: pre-wrap;
	overflow-wrap: anywhere;
}

.myStatus {
	color: var(--MI_THEME-accent);
	font-weight: bold;
}

.sectionLabel {
	display: flex;
	align-items: center;
	gap: 6px;
	padding: 4px 4px 0;
	font-weight: bold;
}

.projects {
	display: flex;
	flex-direction: column;
	gap: 10px;
	padding: 16px;
}

.project {
	display: flex;
	align-items: center;
	gap: 10px;
}

.projectName {
	flex: none;
	width: 10em;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	font-weight: bold;
}

.bar {
	flex: 1;
	min-width: 40px;
	height: 8px;
	border-radius: 999px;
	background: var(--MI_THEME-buttonBg);
	overflow: hidden;
}

.barIn {
	height: 100%;
	border-radius: 999px;
	background: var(--MI_THEME-accent);
}

.projectCount {
	flex: none;
	min-width: 2.5em;
	text-align: right;
}

.wanted {
	display: flex;
	flex-wrap: wrap;
	gap: 4px;
	margin-top: 4px;
}

.wantedChip {
	padding: 1px 8px;
	border-radius: 6px;
	background: var(--MI_THEME-accentedBg);
	color: var(--MI_THEME-accent);
	font-size: 0.8em;
	font-weight: bold;
}

.members {
	& > * + * {
		border-top: 0.5px solid var(--MI_THEME-divider);
	}
}

.member {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 10px;
	padding: 12px 16px;
}

.memberAvatar {
	width: 40px;
	height: 40px;
	flex: none;
}

.memberName {
	flex: 1;
	min-width: 0;
}

.memberSub {
	display: block;
	font-size: 0.85em;
	opacity: 0.7;

	& > * + *::before {
		content: " ・ ";
	}
}

@container (max-width: 500px) {
	.main {
		padding: 20px;
	}

	.projectName {
		width: 6em;
	}
}
</style>
