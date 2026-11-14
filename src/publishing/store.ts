import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import type { PostingInput } from './model.js';
export interface MediaFile { path: string; name: string; mimeType: string; sha256: string; size: number }
export class PublishingStore {
    constructor(readonly pool: Pool) {}
    async initialize() {
        await this.pool.query(`CREATE TABLE IF NOT EXISTS scheduler.publishing_items (
            id uuid PRIMARY KEY, request_id text NOT NULL UNIQUE, request_hash text NOT NULL,
            input jsonb NOT NULL, media jsonb NOT NULL, cover jsonb,
            status text NOT NULL DEFAULT 'held' CHECK (status IN ('held','cancelled','publishing','needs_review','published')),
            version integer NOT NULL DEFAULT 1, results jsonb NOT NULL DEFAULT '{}',
            created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
        )`);
    }
    async create(input: PostingInput, hash: string, media: MediaFile, cover?: MediaFile, results: Record<string, unknown> = {}) {
        const result = await this.pool.query(`INSERT INTO scheduler.publishing_items(id,request_id,request_hash,input,media,cover,results)
            VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(request_id) DO NOTHING RETURNING *`,
            [randomUUID(), input.requestId, hash, input, media, cover ?? null, results]);
        if (result.rows[0]) return { item: result.rows[0], replayed: false };
        const old = await this.pool.query('SELECT * FROM scheduler.publishing_items WHERE request_id=$1', [input.requestId]);
        if (old.rows[0]?.request_hash !== hash) throw new Error('This request ID already belongs to different content. Use a new request ID.');
        return { item: old.rows[0], replayed: true };
    }
    async list(limit = 100, offset = 0) {
        const rows = await this.pool.query(`SELECT * FROM scheduler.publishing_items ORDER BY (input->>'runAt')::timestamptz,id LIMIT $1 OFFSET $2`,[limit,offset]);
        return rows.rows;
    }
    async get(id: string) { return (await this.pool.query('SELECT * FROM scheduler.publishing_items WHERE id=$1',[id])).rows[0] ?? null; }
    async cancel(id: string, version: number) {
        return (await this.pool.query(`UPDATE scheduler.publishing_items SET status='cancelled',version=version+1,updated_at=now()
            WHERE id=$1 AND version=$2 AND status='held' RETURNING *`,[id,version])).rows[0] ?? null;
    }
}
export function publicItem(row: Record<string, any>) {
    const media = ({ name, mimeType, sha256, size }: MediaFile) => ({ name, mimeType, sha256, size });
    return { id: row.id, input: row.input, status: row.status, version: row.version, media: media(row.media),
        cover: row.cover ? media(row.cover) : null, results: row.results, createdAt: row.created_at, updatedAt: row.updated_at };
}
