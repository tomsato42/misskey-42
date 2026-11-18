/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { In } from 'typeorm';
import type { IntraRolesRepository } from '@/models/_.js';
import { intraRoleKinds } from '@/models/IntraRole.js';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { RoleService } from '@/core/RoleService.js';
import { DI } from '@/di-symbols.js';

export const meta = {
	tags: ['account', 'role'],

	requireCredential: true,

	kind: 'read:account',

	description: 'Get the roles automatically assigned to you from your 42 intra information.',

	res: {
		type: 'array',
		optional: false, nullable: false,
		items: {
			type: 'object',
			optional: false, nullable: false,
			properties: {
				kind: {
					type: 'string',
					optional: false, nullable: false,
					enum: intraRoleKinds,
				},
				roleId: {
					type: 'string',
					optional: false, nullable: false,
					format: 'id',
				},
				name: {
					type: 'string',
					optional: false, nullable: false,
				},
			},
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.intraRolesRepository)
		private intraRolesRepository: IntraRolesRepository,

		private roleService: RoleService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const roles = await this.roleService.getUserRoles(me.id);
			if (roles.length === 0) return [];

			const intraRoles = await this.intraRolesRepository.findBy({ roleId: In(roles.map(r => r.id)) });
			return intraRoles.map(intraRole => ({
				kind: intraRole.kind,
				roleId: intraRole.roleId,
				name: roles.find(r => r.id === intraRole.roleId)!.name,
			}));
		});
	}
}
