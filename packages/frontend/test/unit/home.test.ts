/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, assert, describe, test } from 'vitest';
import { cleanup, render, type RenderResult } from '@testing-library/vue';
import * as Misskey from 'misskey-js';
import { directives } from '@/directives/index.js';
import { components } from '@/components/index.js';
import XHome from '@/pages/user/home.vue';
import 'intersection-observer';

describe('XHome', () => {
	const renderHome = (user: Partial<Misskey.entities.UserDetailed>): RenderResult => {
		return render(XHome, {
			props: { user: user as Misskey.entities.UserDetailed, disableNotes: true },
			global: { directives, components },
		});
	};

	afterEach(() => {
		cleanup();
	});

	test('Should render the remote caution when user.host exists', async () => {
		const home = renderHome({
			id: 'blobcat',
			name: 'blobcat',
			host: 'example.com',
			uri: 'https://example.com/@user',
			url: 'https://example.com/@user/profile',
			roles: [],
			createdAt: '1970-01-01T00:00:00.000Z',
			fields: [],
			pinnedNotes: [],
			avatarUrl: 'https://example.com',
			avatarDecorations: [],
		});

		const anchor = home.container.querySelector<HTMLAnchorElement>('a[href^="https://example.com/"]');
		assert.exists(anchor, 'anchor to the remote exists');
		assert.strictEqual(anchor?.href, 'https://example.com/@user/profile');
	});

	test('The remote caution should fall back to uri if url is null', async () => {
		const home = renderHome({
			id: 'blobcat',
			name: 'blobcat',
			host: 'example.com',
			uri: 'https://example.com/@user',
			url: null,
			roles: [],
			createdAt: '1970-01-01T00:00:00.000Z',
			fields: [],
			pinnedNotes: [],
			avatarUrl: 'https://example.com',
			avatarDecorations: [],
		});

		const anchor = home.container.querySelector<HTMLAnchorElement>('a[href^="https://example.com/"]');
		assert.exists(anchor, 'anchor to the remote exists');
		assert.strictEqual(anchor?.href, 'https://example.com/@user');
	});

	test('Should render 42 intra information without null items', async () => {
		const home = renderHome({
			id: 'blobcat',
			name: 'blobcat',
			username: 'blobcat',
			host: null,
			uri: null,
			url: null,
			roles: [],
			createdAt: '1970-01-01T00:00:00.000Z',
			fields: [],
			pinnedNotes: [],
			avatarUrl: 'https://example.com',
			avatarDecorations: [],
			intra: {
				login: 'blobcat',
				poolYearMonth: '2307',
				blackholedAt: null,
				paceDeadlineAt: '2030-01-01T00:00:00.000Z',
			},
		});

		const anchor = home.container.querySelector<HTMLAnchorElement>('a[href="https://profile.intra.42.fr/users/blobcat"]');
		assert.exists(anchor, 'anchor to the intra profile exists');
		assert.include(home.container.textContent, '2023/07');
		assert.notExists(home.container.querySelector('.ti-calendar-due'), 'pace deadline is never shown');
		assert.notExists(home.container.querySelector('.ti-hourglass-low'), 'blackhole is never shown');
	});

	test('Should not render the blackhole date even if it is upcoming', async () => {
		const base = {
			id: 'blobcat',
			name: 'blobcat',
			username: 'blobcat',
			host: null,
			uri: null,
			url: null,
			roles: [],
			createdAt: '1970-01-01T00:00:00.000Z',
			fields: [],
			pinnedNotes: [],
			avatarUrl: 'https://example.com',
			avatarDecorations: [],
		};

		const upcoming = renderHome({ ...base, intra: { login: 'blobcat', poolYearMonth: '2307', blackholedAt: '2100-01-01T00:00:00.000Z', paceDeadlineAt: null } });
		assert.notExists(upcoming.container.querySelector('.ti-hourglass-low'), 'upcoming blackhole is hidden');
		upcoming.unmount();
	});

	test('Should not render 42 intra information when user.intra is null', async () => {
		const home = renderHome({
			id: 'blobcat',
			name: 'blobcat',
			username: 'blobcat',
			host: null,
			uri: null,
			url: null,
			roles: [],
			createdAt: '1970-01-01T00:00:00.000Z',
			fields: [],
			pinnedNotes: [],
			avatarUrl: 'https://example.com',
			avatarDecorations: [],
			intra: null,
		});

		assert.notExists(home.container.querySelector('a[href^="https://profile.intra.42.fr/"]'));
		assert.notExists(home.container.querySelector('.ti-school'));
	});
});
