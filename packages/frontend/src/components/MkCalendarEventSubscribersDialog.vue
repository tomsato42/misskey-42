<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<MkModalWindow
	ref="dialog"
	:width="400"
	:height="600"
	@close="dialog?.close()"
	@closed="emit('closed')"
>
	<template #header>{{ i18n.tsx._calendar.subscribersWithCount({ n: event.subscribersCount }) }}</template>

	<div class="_spacer" style="--MI_SPACER-min: 16px; --MI_SPACER-max: 20px;">
		<div class="_gaps_s">
			<MkTab v-model="tab" :tabs="tabs"/>

			<MkA v-if="tab === 'all'" v-user-preview="event.user.id" :to="userPage(event.user)" :class="$style.user">
				<MkUserCardMini :user="event.user" :withChart="false">
					<template #sub>
						<span class="_monospace">@{{ acct(event.user) }}</span>
						<span :class="[$style.badge, $style.creator]">{{ i18n.ts._calendar.creator }}</span>
					</template>
				</MkUserCardMini>
			</MkA>

			<MkPagination :key="tab" :paginator="tab === 'following' ? followingPaginator : allPaginator">
				<template #empty>
					<MkResult type="empty" :text="tab === 'following' ? i18n.ts._calendar.noFollowingSubscribers : i18n.ts._calendar.noSubscribers"/>
				</template>

				<template #default="{ items }">
					<div class="_gaps_s">
						<MkA
							v-for="subscriber in (items as Subscriber[])"
							:key="subscriber.id"
							v-user-preview="subscriber.user.id"
							:to="userPage(subscriber.user)"
							:class="$style.user"
						>
							<MkUserCardMini :user="subscriber.user" :withChart="false">
								<template #sub>
									<span class="_monospace">@{{ acct(subscriber.user) }}</span>
									<span v-if="tab === 'all' && subscriber.isFollowing" :class="$style.badge">{{ i18n.ts._calendar.followingUsers }}</span>
								</template>
							</MkUserCardMini>
						</MkA>
					</div>
				</template>
			</MkPagination>
		</div>
	</div>
</MkModalWindow>
</template>

<script lang="ts" setup>
// イベントの購読者の一覧。作成者を先頭に出し、そのあとは新しく購読した順。
// 開くときは utility/calendar-event-dialog.ts の openCalendarEventSubscribersDialog を使う
import { markRaw, ref, useTemplateRef } from 'vue';
import * as Misskey from 'misskey-js';
import MkModalWindow from '@/components/MkModalWindow.vue';
import MkPagination from '@/components/MkPagination.vue';
import MkTab from '@/components/MkTab.vue';
import type { Tab } from '@/components/MkTab.vue';
import MkUserCardMini from '@/components/MkUserCardMini.vue';
import { i18n } from '@/i18n.js';
import { acct, userPage } from '@/filters/user.js';
import { Paginator } from '@/utility/paginator.js';

type Subscriber = Misskey.Endpoints['calendar/events/subscribers']['res'][number];

const props = defineProps<{
	event: Misskey.entities.CalendarEvent;
}>();

const emit = defineEmits<{
	(ev: 'closed'): void;
}>();

const dialog = useTemplateRef('dialog');

const tab = ref<'all' | 'following'>('all');

const tabs: Tab<'all' | 'following'>[] = [{
	key: 'all',
	label: i18n.ts._calendar.all,
}, {
	key: 'following',
	label: i18n.ts._calendar.followingUsers,
}];

// 管理人ビューで開いた公開範囲の外のイベントは、管理人ビューで引く
const moderatorView = props.event.isOutsideVisibility === true;
const allPaginator = markRaw(new Paginator('calendar/events/subscribers', {
	limit: 30,
	params: { eventId: props.event.id, filter: 'all', moderatorView },
}));

const followingPaginator = markRaw(new Paginator('calendar/events/subscribers', {
	limit: 30,
	params: { eventId: props.event.id, filter: 'following', moderatorView },
}));
</script>

<style lang="scss" module>
.user {
	display: block;

	&:hover {
		text-decoration: none;
	}
}

.badge {
	display: inline-block;
	margin-left: 6px;
	padding: 0 6px;
	border-radius: 999px;
	font-size: 0.9em;
	background: var(--MI_THEME-buttonBg);
}

.creator {
	font-weight: bold;
	color: var(--MI_THEME-accent);
	background: var(--MI_THEME-accentedBg);
}
</style>
