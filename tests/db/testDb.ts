/**
 * Test database factory for Vitest.
 * Creates an in-memory `node:sqlite` database with migrations applied,
 * wrapped in the NodeSqliteDriver so it can be injected into repositories.
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createNodeSqliteDb } from './nodeSqliteDriver';
import type { SqlDb } from '../../src/main/db/db';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(here, '..', '..');

export interface TestDb {
	db: SqlDb;
	client: DatabaseSync;
	/** Close and destroy the underlying SQLite handle. */
	close(): void;
}

export function createTestDb(): TestDb {
	const db = new DatabaseSync(':memory:');
	db.exec('PRAGMA foreign_keys = ON');

	const journalPath = join(projectRoot, 'drizzle', 'meta', '_journal.json');
	const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
		entries: { tag: string }[];
	};
	for (const entry of journal.entries) {
		const sql = readFileSync(
			join(projectRoot, 'drizzle', `${entry.tag}.sql`),
			'utf8',
		);
		db.exec(sql);
	}

	const { db: drizzleDb, client } = createNodeSqliteDb(db);
	return {
		db: drizzleDb as unknown as SqlDb,
		client,
		close: () => {
			client.close();
		},
	};
}
