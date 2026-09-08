/**
 * A minimal Drizzle driver backed by Node's built-in `node:sqlite`.
 *
 * This exists so the repository tests in `tests/repositories.test.ts` can run
 * under plain Node (vitest) without the Electron-only `better-sqlite3` binding.
 */

import type { Query } from 'drizzle-orm/sql/sql';
import {
	BaseSQLiteDatabase,
	SQLitePreparedQuery,
	SQLiteSession,
	SQLiteTransaction,
} from 'drizzle-orm/sqlite-core';
import {
	type PreparedQueryConfig,
	type SQLiteExecuteMethod,
	type SQLiteTransactionConfig,
} from 'drizzle-orm/sqlite-core/session';
import type { SelectedFieldsOrdered } from 'drizzle-orm/sqlite-core/query-builders/select.types';
import { NoopLogger, type Logger } from 'drizzle-orm/logger';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core/dialect';
import type { TablesRelationalConfig, RelationalSchemaConfig } from 'drizzle-orm/relations';
import { entityKind, is } from 'drizzle-orm/entity';
import { Column } from 'drizzle-orm/column';
import { SQL } from 'drizzle-orm/sql/sql';
import {
	DatabaseSync,
	type StatementSync,
} from 'node:sqlite';

type DriverValueMapperLike = {
	mapFromDriverValue(value: unknown): unknown;
};
import * as schema from '../../src/main/db/schema';
import type { AppDatabase } from '../../src/main/db/database';

type TSchema = TablesRelationalConfig;

export interface SqliteRunResult {
	changes: number;
	lastInsertRowid: number;
}

/**
 * Convert a positional row from node:sqlite into a plain object keyed by the
 * selected field path, applying each column's `mapFromDriverValue` (e.g.
 * integer `0/1` → boolean, text → Date) to mirror the real Drizzle driver.
 */
function resolveDecoder(field: unknown): DriverValueMapperLike | undefined {
	if (is(field, Column)) return field;
	if (is(field, SQL)) return (field as { decoder?: DriverValueMapperLike }).decoder;
	return (field as { sql?: { decoder?: DriverValueMapperLike } })?.sql?.decoder;
}

function mapRow(
	raw: unknown,
	fields: SelectedFieldsOrdered | undefined,
): Record<string, unknown> | undefined {
	if (raw === undefined) return undefined;
	if (!fields || fields.length === 0) {
		return raw as Record<string, unknown>;
	}
	const arr = raw as unknown[];
	const obj: Record<string, unknown> = {};
	for (let i = 0; i < fields.length; i++) {
		const entry = fields[i]!;
		const path = entry.path;
		const key = path.length > 0 ? path[path.length - 1]! : '';
		const rawValue = arr[i];
		const decoder = resolveDecoder(entry.field);
		obj[key] =
			rawValue === null
				? null
				: decoder
					? decoder.mapFromDriverValue(rawValue)
				: rawValue;
	}
	return obj;
}

/* ------------------------------------------------------------------ */
/*  PreparedQuery                                                      */
/* ------------------------------------------------------------------ */

class NodeSqlitePreparedQuery
	extends SQLitePreparedQuery<PreparedQueryConfig & { type: 'sync' }>
{
	static override readonly [entityKind]: string = 'NodeSqlitePreparedQuery';

	stmt: StatementSync;
	fields: SelectedFieldsOrdered | undefined;
	bindParams: unknown[];

	constructor(query: Query) {
		super('sync', 'all', query);
		this.stmt = undefined as unknown as StatementSync;
		this.fields = undefined;
		this.bindParams = [];
	}

	override run(): SqliteRunResult {
		const res = this.stmt.run(...(this.bindParams as never[]));
		const toNum = (v: number | bigint): number =>
			typeof v === 'number' ? v : Number(v);
		return {
			changes: toNum(res.changes),
			lastInsertRowid: toNum(res.lastInsertRowid),
		};
	}

	override all<T = unknown>(): T[] {
		const raw = this.stmt.all(...(this.bindParams as never[])) as unknown as unknown[];
		if (!this.fields || this.fields.length === 0) {
			return raw as T[];
		}
		return raw
			.map((row) => mapRow(row, this.fields))
			.filter((r): r is Record<string, unknown> => r !== undefined) as T[];
	}

	override get<T = unknown>(): T {
		const raw = this.stmt.all(...(this.bindParams as never[])) as unknown as unknown[];
		if (raw.length === 0) return undefined as unknown as T;
		const mapped = mapRow(raw[0], this.fields);
		return (mapped ?? (raw[0] as T)) as T;
	}

	override values(): unknown[] {
		return this.stmt.all(...(this.bindParams as never[])) as unknown[];
	}
}

/* ------------------------------------------------------------------ */
/*  Session                                                            */
/* ------------------------------------------------------------------ */

class NodeSqliteSession
	extends SQLiteSession<'sync', SqliteRunResult, Record<string, unknown>, TSchema>
{
	static override readonly [entityKind]: string = 'NodeSqliteSession';

	readonly dialect: SQLiteSyncDialect;
	readonly logger: Logger;
	readonly client: DatabaseSync;
	readonly schema: TSchema;

	constructor(client: DatabaseSync, schema: TSchema) {
		super(new SQLiteSyncDialect());
		this.dialect = new SQLiteSyncDialect();
		this.logger = new NoopLogger();
		this.client = client;
		this.schema = schema;
	}

	prepareQuery(
		query: Query,
		fields: SelectedFieldsOrdered | undefined,
		_executeMethod: SQLiteExecuteMethod,
		_isResponseInArrayMode: boolean,
	): SQLitePreparedQuery<PreparedQueryConfig & { type: 'sync' }> {
		const stmt = this.client.prepare(query.sql);
		stmt.setReturnArrays(true);
		const prepared = new NodeSqlitePreparedQuery(query);
		prepared.stmt = stmt;
		prepared.fields = fields;
		prepared.bindParams = query.params;
		return prepared;
	}

	transaction<T>(
		transaction: (tx: NodeSqliteTransaction) => T,
		_config?: SQLiteTransactionConfig,
	): T {
		const sp = `sp_${Date.now()}_${Math.random().toString(36).slice(2)}`;
		this.client.exec(`SAVEPOINT ${sp}`);
		const tx = new NodeSqliteTransaction(
			this.dialect,
			this,
			{
				fullSchema: this.schema as unknown as Record<string, unknown>,
				schema: this.schema,
				tableNamesMap: {},
			},
			sp,
		);
		try {
			const result = transaction(tx);
			this.client.exec(`RELEASE SAVEPOINT ${sp}`);
			return result;
		} catch (err) {
			this.client.exec(`ROLLBACK TO SAVEPOINT ${sp}`);
			this.client.exec(`RELEASE SAVEPOINT ${sp}`);
			throw err;
		}
	}
}

/* ------------------------------------------------------------------ */
/*  Transaction                                                        */
/* ------------------------------------------------------------------ */

class NodeSqliteTransaction
	extends SQLiteTransaction<'sync', SqliteRunResult, Record<string, unknown>, TSchema>
{
	static override readonly [entityKind]: string = 'NodeSqliteTransaction';

	constructor(
		dialect: SQLiteSyncDialect,
		session: NodeSqliteSession,
		schemaConfig: RelationalSchemaConfig<TSchema>,
		readonly savepointName: string,
	) {
		super('sync', dialect, session, schemaConfig, 0);
	}

	override rollback(): never {
		const s = this as unknown as {
			session: { client: DatabaseSync };
		};
		s.session.client.exec(`ROLLBACK TO SAVEPOINT ${this.savepointName}`);
		throw new Error('Transaction rolled back');
	}
}

/* ------------------------------------------------------------------ */
/*  Database                                                           */
/* ------------------------------------------------------------------ */

class NodeSqliteDatabase
	extends BaseSQLiteDatabase<'sync', SqliteRunResult, Record<string, unknown>, TSchema>
{
	static override readonly [entityKind]: string = 'NodeSqliteDatabase';

	readonly $client: DatabaseSync;

	constructor(client: DatabaseSync) {
		const dialect = new SQLiteSyncDialect();
		const session = new NodeSqliteSession(client, schema as unknown as TSchema);
		const rsc: RelationalSchemaConfig<TSchema> = {
			fullSchema: schema as unknown as Record<string, unknown>,
			schema: schema as unknown as TSchema,
			tableNamesMap: {},
		};
		super('sync', dialect, session, rsc);
		this.$client = client;
	}
}

/* ------------------------------------------------------------------ */
/*  Factory                                                            */
/* ------------------------------------------------------------------ */

export function createNodeSqliteDb(
	db: DatabaseSync,
): { db: AppDatabase; client: DatabaseSync } {
	const driver = new NodeSqliteDatabase(db);
	return { db: driver as unknown as AppDatabase, client: db };
}
