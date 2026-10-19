<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader :actions="headerActions">
	<div class="_spacer" style="--MI_SPACER-w: 800px;">
		<MkA :to="calendarUrl" :class="$style.back"><i class="ti ti-arrow-left" aria-hidden="true"></i>{{ i18n.ts._calendar.backToCalendar }}</MkA>
		<div v-if="event" class="_gaps">
			<MkInfo v-if="event.isCanceled" warn>{{ i18n.ts._calendar.eventCanceled }}</MkInfo>
			<MkInfo v-else-if="showInvitation && event.invitedBy != null">
				<span :class="$style.invited">
					<MkAvatar :user="event.invitedBy" :class="$style.invitedAvatar"/>
					<span :class="$style.invitedText">
						<I18n :src="i18n.ts._calendar.invitedBy" tag="span">
							<template #user><b><MkUserName :user="event.invitedBy"/></b></template>
						</I18n>
					</span>
					<MkButton primary rounded small :disabled="subscribing" @click="subscribe"><i class="ti ti-bell"></i> {{ i18n.ts._calendar.subscribe }}</MkButton>
				</span>
			</MkInfo>

			<div class="_panel" :class="[$style.card, { [$style.canceled]: event.isCanceled }]">
				<div :class="$style.when">
					<div :class="$style.dateBox" aria-hidden="true">
						<span>{{ i18n.tsx.monthX({ month: eventDate.month }) }}</span>
						<b>{{ eventDate.day }}</b>
						<span>{{ getWeekdayShortLabel(eventDayOfWeek) }}</span>
					</div>
					<div>
						<div :class="$style.dateText">{{ formatCalendarDay(event.date) }}</div>
						<b>{{ formatCalendarEventTime(event) }}</b>
						<div v-if="relativeDayText" :class="$style.relative">{{ relativeDayText }}</div>
					</div>
				</div>

				<h1 :class="$style.title" class="_selectable">{{ event.title }}</h1>

				<div :class="$style.rows">
					<template v-if="event.location">
						<i class="ti ti-map-pin" :class="$style.rowIcon" aria-hidden="true"></i>
						<span class="_selectable">{{ event.location }}</span>
					</template>
					<template v-if="event.hashtag">
						<i class="ti ti-hash" :class="$style.rowIcon" aria-hidden="true"></i>
						<MkA :to="`/tags/${encodeURIComponent(event.hashtag)}`" :class="$style.hashtag">#{{ event.hashtag }}</MkA>
					</template>
					<i class="ti ti-user" :class="$style.rowIcon" aria-hidden="true"></i>
					<span :class="$style.user">
						<I18n :src="i18n.ts._calendar.createdBy">
							<template #user>
								<MkA v-user-preview="event.user.id" :to="userPage(event.user)" :class="$style.userLink">
									<MkAvatar :user="event.user" :class="$style.avatar"/>
									<MkUserName :user="event.user"/>
								</MkA>
							</template>
						</I18n>
					</span>
					<template v-if="event.visibility !== 'public'">
						<i :class="[getCalendarVisibilityIcon(event.visibility), $style.rowIcon]" aria-hidden="true"></i>
						<span>
							<I18n v-if="event.visibility === 'followers' || event.visibility === 'mutual'" :src="event.visibility === 'followers' ? i18n.ts._calendar.visibleToFollowersOf : i18n.ts._calendar.visibleToMutualsOf">
								<template #user><MkUserName :user="event.user"/></template>
							</I18n>
							<template v-else>{{ visibilityText }}</template>
						</span>
					</template>
				</div>

				<div v-if="event.description" :class="$style.description" class="_selectable">
					<Mfm :text="event.description" :isNote="false"/>
				</div>

				<div :class="$style.buttons">
					<template v-if="event.isSubscribed">
						<MkButton v-tooltip="isOwner ? null : i18n.ts._calendar.unsubscribe" primary rounded :aria-label="isOwner ? undefined : i18n.ts._calendar.unsubscribe" :disabled="isOwner || subscribing" @click="unsubscribe">
							<i class="ti ti-bell-ringing"></i> {{ i18n.ts._calendar.subscribed }}
						</MkButton>
					</template>
					<MkButton v-else-if="!event.isCanceled && !showInvitation" rounded :disabled="subscribing" @click="subscribe">
						<i class="ti ti-bell"></i> {{ i18n.ts._calendar.subscribe }}
					</MkButton>
					<!-- 招待を送れるのは購読している人と、管理できる人 -->
					<MkButton v-if="canInvite" rounded @click="invite">
						<i class="ti ti-user-plus"></i> {{ i18n.ts._calendar.invite }}
					</MkButton>
					<MkButton v-if="event.hashtag && !event.isCanceled" gradate rounded @click="postWithHashtag">
						<i class="ti ti-pencil"></i> {{ i18n.tsx._calendar.postWithHashtag({ tag: event.hashtag }) }}
					</MkButton>
					<button type="button" class="_button" :class="$style.subscribers" :aria-label="subscribersButtonLabel" @click="openSubscribers">
						<span v-if="(event.subscribersPreview ?? []).length > 0" :class="$style.subscriberAvatars" aria-hidden="true">
							<MkAvatar v-for="user in event.subscribersPreview" :key="user.id" :user="user" :class="$style.subscriberAvatar"/>
						</span>
						<span :class="$style.subscribersText">
							<span>{{ i18n.tsx._calendar.subscribersCount({ n: event.subscribersCount }) }}</span>
							<small v-if="(event.followingSubscribersCount ?? 0) > 0">{{ i18n.tsx._calendar.includesFollowing({ n: event.followingSubscribersCount ?? 0 }) }}</small>
						</span>
						<i class="ti ti-chevron-right" :class="$style.subscribersChevron" aria-hidden="true"></i>
					</button>
				</div>
				<div v-if="isOwner && event.isSubscribed" :class="$style.ownerNote">{{ i18n.ts._calendar.cannotUnsubscribeOwn }}</div>
			</div>

			<div :class="$style.sectionLabel"><i class="ti ti-messages"></i> {{ i18n.ts._calendar.notesOfEvent }}</div>
			<MkNotesTimeline :paginator="paginator"/>
		</div>
		<MkResult v-else-if="notFound" type="notFound"/>
		<MkError v-else-if="error" @retry="fetchEvent()"/>
		<MkLoading v-else/>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { computed, markRaw, ref, watch } from 'vue';
import * as Misskey from 'misskey-js';
import { host, url } from '@@/js/config.js';
import type { MenuItem } from '@/types/menu.js';
import type { PageHeaderItem } from '@/types/page-header.js';
import MkButton from '@/components/MkButton.vue';
import MkInfo from '@/components/MkInfo.vue';
import MkNotesTimeline from '@/components/MkNotesTimeline.vue';
import * as os from '@/os.js';
import { $i } from '@/i.js';
import { i18n } from '@/i18n.js';
import { definePage } from '@/page.js';
import { useRouter } from '@/router.js';
import { userPage } from '@/filters/user.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { Paginator } from '@/utility/paginator.js';
import { copyToClipboard } from '@/utility/copy-to-clipboard.js';
import { dayOfWeek, diffDays, parseCalendarDate, toJstDateString } from '@/utility/calendar.js';
import { buildCalendarEventIcs, getCalendarEventIcsFileName } from '@/utility/calendar-ics.js';
import { formatCalendarDay, formatCalendarEventTime, getCalendarApiErrorMessage, getWeekdayShortLabel } from '@/utility/calendar-event-messages.js';
import { openCalendarEventEditDialog, openCalendarEventInviteDialog, openCalendarEventSubscribersDialog } from '@/utility/calendar-event-dialog.js';
import { getCalendarVisibilityIcon } from '@/utility/calendar-visibility.js';

const props = defineProps<{
	eventId: string;
}>();

const router = useRouter();

const event = ref<Misskey.entities.CalendarEvent | null>(null);
const error = ref(false);
const notFound = ref(false);
const subscribing = ref(false);

const paginator = markRaw(new Paginator('calendar/events/notes', {
	limit: 10,
	computedParams: computed(() => ({
		eventId: props.eventId,
	})),
}));

const eventUrl = computed(() => `${url}/calendar/events/${props.eventId}`);
/** イベントの月のカレンダー。読み込む前は今月 */
const calendarUrl = computed(() => event.value != null ? `/calendar?month=${event.value.date.slice(0, 7)}` : '/calendar');
const isOwner = computed(() => event.value != null && $i != null && event.value.userId === $i.id);
// 招待を送れるかは backend (CalendarInvitationService.canInvite) が決める。中止したイベントには送れない
const canInvite = computed(() => event.value != null && !event.value.isCanceled && event.value.canInvite === true);

/** 招待されていて、まだ購読していないときに案内を出す (そのときは購読のボタンを案内の中だけにする) */
const showInvitation = computed(() => event.value != null && !event.value.isCanceled && event.value.invitedBy != null && event.value.isSubscribed !== true);

const subscribersButtonLabel = computed(() => {
	if (event.value == null) return '';
	const following = event.value.followingSubscribersCount ?? 0;
	return [
		i18n.tsx._calendar.subscribersCount({ n: event.value.subscribersCount }),
		following > 0 ? i18n.tsx._calendar.includesFollowing({ n: following }) : null,
		i18n.ts._calendar.openSubscribers,
	].filter(x => x != null).join(' ');
});

/** リストに公開しているイベントのリストの名前 (管理できる人にだけ出す) */
const userListName = ref<string | null>(null);

watch(() => event.value?.userListId, async (listId) => {
	userListName.value = null;
	if (listId == null) return;
	try {
		userListName.value = (await misskeyApi('users/lists/show', { listId })).name;
	} catch {
		// モデレーターが他人のリストを見るときなど、引けなければ名前を出さない
	}
});

/** 指定ユーザー・リストの公開範囲の表記。フォロワー・相互フォローは作成者の名前を入れるのでテンプレートで書く */
const visibilityText = computed(() => {
	if (event.value == null) return '';
	if (event.value.visibility === 'specified') {
		return event.value.visibleUserIds != null
			? i18n.tsx._calendar.visibleToSpecifiedCount({ n: event.value.visibleUserIds.length })
			: i18n.ts._calendar.visibleToSpecified;
	}
	return userListName.value != null ? i18n.tsx._calendar.visibleToNamedList({ name: userListName.value }) : i18n.ts._calendar.visibleToList;
});

const eventDate = computed(() => parseCalendarDate(event.value?.date) ?? { year: 0, month: 0, day: 0 });
const eventDayOfWeek = computed(() => event.value ? dayOfWeek(event.value.date) : 0);

/** 「今日」「あと2日」。過去のイベントでは出さない */
const relativeDayText = computed(() => {
	if (event.value == null || event.value.isCanceled) return null;
	const days = diffDays(event.value.date, toJstDateString(new Date()));
	if (days === 0) return i18n.ts.today;
	if (days > 0) return i18n.tsx._calendar.daysLeft({ n: days });
	return null;
});

async function fetchEvent() {
	event.value = null;
	error.value = false;
	notFound.value = false;
	try {
		event.value = await misskeyApi('calendar/events/show', { eventId: props.eventId });
	} catch (err) {
		if ((err as Partial<Misskey.api.APIError> | null)?.code === 'NO_SUCH_CALENDAR_EVENT') {
			notFound.value = true;
		} else {
			error.value = true;
		}
	}
}

watch(() => props.eventId, fetchEvent, { immediate: true });

function showError(err: unknown) {
	os.alert({ type: 'error', ...getCalendarApiErrorMessage(err) });
}

/**
 * 購読・購読の解除のあと、購読者のアバターなどイベントのページ用の項目も読み直す。
 * 読み直すまでは API の返り値 (ページ用の項目が無い) に前の値を残して出す
 */
async function applySubscription(updated: Misskey.entities.CalendarEvent) {
	if (event.value == null) return;
	event.value = { ...event.value, ...updated };
	try {
		event.value = await misskeyApi('calendar/events/show', { eventId: updated.id });
	} catch {
		// 購読はできているので、読み直せなくてもそのままにする
	}
}

async function subscribe() {
	if (event.value == null || subscribing.value) return;
	subscribing.value = true;
	try {
		await applySubscription(await misskeyApi('calendar/events/subscribe', { eventId: event.value.id }));
	} catch (err) {
		showError(err);
	} finally {
		subscribing.value = false;
	}
}

async function unsubscribe() {
	if (event.value == null || subscribing.value || isOwner.value) return;
	subscribing.value = true;
	try {
		await applySubscription(await misskeyApi('calendar/events/unsubscribe', { eventId: event.value.id }));
	} catch (err) {
		showError(err);
	} finally {
		subscribing.value = false;
	}
}

function openSubscribers() {
	if (event.value == null) return;
	openCalendarEventSubscribersDialog(event.value);
}

async function invite() {
	if (event.value == null) return;
	const sent = await openCalendarEventInviteDialog(event.value);
	if (sent == null) return;
	os.toast(sent > 0 ? i18n.tsx._calendar.invitesSent({ n: sent }) : i18n.ts._calendar.noInvitesSent);
}

function postWithHashtag() {
	if (event.value?.hashtag == null) return;
	os.post({
		initialText: `#${event.value.hashtag} `,
		// 投稿をこのイベントに紐づける (投稿フォームで外せる)
		initialCalendarEvent: event.value,
	});
}

function downloadIcs() {
	if (event.value == null) return;
	const ics = buildCalendarEventIcs(event.value, {
		host,
		url: eventUrl.value,
		now: new Date(),
	});
	const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
	const objectUrl = URL.createObjectURL(blob);
	const a = window.document.createElement('a');
	a.href = objectUrl;
	a.download = getCalendarEventIcsFileName(event.value);
	a.click();
	window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

async function edit() {
	if (event.value == null) return;
	const updated = await openCalendarEventEditDialog({ event: event.value });
	// 公開範囲を変えると購読者が変わりうるので、ページ用の項目ごと読み直す
	if (updated != null) await applySubscription(updated);
}

async function cancelEvent() {
	if (event.value == null) return;
	const { canceled } = await os.confirm({
		type: 'warning',
		text: i18n.tsx._calendar.cancelConfirm({ x: event.value.title }),
	});
	if (canceled) return;
	try {
		// 返り値にはページ用の項目 (購読者のアバターなど) が無いので、前の値に重ねる
		event.value = { ...event.value, ...await misskeyApi('calendar/events/cancel', { eventId: event.value.id }) };
	} catch (err) {
		showError(err);
	}
}

async function deleteEvent() {
	if (event.value == null) return;
	const { canceled } = await os.confirm({
		type: 'warning',
		text: i18n.tsx.deleteAreYouSure({ x: event.value.title }),
	});
	if (canceled) return;
	try {
		await misskeyApi('calendar/events/delete', { eventId: event.value.id });
	} catch (err) {
		showError(err);
		return;
	}
	router.push('/calendar');
}

function openMenu(ev: PointerEvent) {
	if (event.value == null) return;
	const items: MenuItem[] = [{
		icon: 'ti ti-link',
		text: i18n.ts.copyUrl,
		action: () => {
			copyToClipboard(eventUrl.value);
		},
	}];
	if (event.value.canManage) {
		items.push({ type: 'divider' });
		if (!event.value.isCanceled) {
			items.push({
				icon: 'ti ti-pencil',
				text: i18n.ts.edit,
				action: edit,
			}, {
				icon: 'ti ti-calendar-off',
				text: i18n.ts._calendar.cancelEvent,
				danger: true,
				action: cancelEvent,
			});
		}
		items.push({
			icon: 'ti ti-trash',
			text: i18n.ts.delete,
			danger: true,
			action: deleteEvent,
		});
	}
	os.popupMenu(items, ev.currentTarget ?? ev.target);
}

const headerActions = computed<PageHeaderItem[]>(() => event.value ? [{
	icon: 'ti ti-calendar-down',
	text: i18n.ts._calendar.addToCalendar,
	handler: downloadIcs,
}, {
	icon: 'ti ti-dots',
	text: i18n.ts.other,
	handler: openMenu,
}] : []);

definePage(() => ({
	title: event.value ? event.value.title : i18n.ts._calendar.event,
	icon: 'ti ti-calendar-event',
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

.card {
	padding: 24px 28px;
	display: flex;
	flex-direction: column;
	gap: 14px;

	&.canceled .title {
		text-decoration: line-through;
		opacity: 0.7;
	}
}

.when {
	display: flex;
	align-items: center;
	gap: 10px;
}

.dateBox {
	width: 44px;
	flex: none;
	text-align: center;
	border-radius: 8px;
	background: var(--MI_THEME-buttonBg);
	padding: 3px 0;
	font-size: 0.75em;
	line-height: 1.25;

	> b {
		display: block;
		font-size: 1.5em;
	}
}

.dateText {
	font-size: 0.9em;
	opacity: 0.8;
}

.relative {
	font-size: 0.9em;
	opacity: 0.7;
}

.title {
	margin: 0;
	font-size: 1.6em;
	line-height: 1.25;
	word-break: break-word;
}

.rows {
	display: grid;
	grid-template-columns: 24px minmax(0, 1fr);
	gap: 8px 6px;
	align-items: center;
}

.rowIcon {
	opacity: 0.7;
}

.hashtag {
	color: var(--MI_THEME-hashtag);
}

.user {
	min-width: 0;
}

.userLink {
	display: inline-flex;
	align-items: center;
	gap: 4px;
	vertical-align: middle;
}

.avatar {
	width: 20px;
	height: 20px;
}

.description {
	line-height: 1.6;
}

.buttons {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 8px;
}

.subscribers {
	margin-left: auto;
	display: inline-flex;
	align-items: center;
	gap: 10px;
	min-height: 40px;
	padding: 4px 12px 4px 6px;
	border-radius: 999px;
	background: var(--MI_THEME-buttonBg);

	&:hover {
		background: var(--MI_THEME-buttonHoverBg);
	}
}

.subscriberAvatars {
	display: flex;
	padding-left: 6px;
}

.subscriberAvatar {
	width: 28px;
	height: 28px;
	margin-left: -6px;
	box-shadow: 0 0 0 2px var(--MI_THEME-panel);
}

.subscribersText {
	display: flex;
	flex-direction: column;
	line-height: 1.25;
	font-size: 0.9em;
	text-align: left;

	> small {
		font-size: 0.85em;
		opacity: 0.75;
	}
}

.subscribersChevron {
	opacity: 0.5;
}

.invited {
	display: flex;
	align-items: center;
	gap: 10px;
	width: 100%;
}

.invitedAvatar {
	flex: none;
	width: 24px;
	height: 24px;
}

.invitedText {
	flex: 1;
	min-width: 0;
}

.ownerNote {
	margin-top: -6px;
	font-size: 0.85em;
	opacity: 0.7;
}

.sectionLabel {
	display: flex;
	align-items: center;
	gap: 6px;
	font-weight: bold;
	font-size: 0.9em;
	opacity: 0.8;
}

@container (max-width: 500px) {
	.card {
		padding: 18px 20px;
	}
}
</style>
