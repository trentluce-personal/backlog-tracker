import { randomUUID } from 'node:crypto';
import neo4j, { type Driver, type ManagedTransaction, type Session } from 'neo4j-driver';
import { backlogSchemaStatements } from './backlog-schema.ts';
import type { BacklogStore } from './backlog-store.ts';
import { HttpError, resolveDueTime, tagColors, type Priority, type Status, type TagColor, type TagInput, type TaskInput } from './validation.ts';
import type { Project, Tag, Task } from './store.ts';

export interface Neo4jConfig {
  uri: string;
  user: string;
  password: string;
  database: string;
}

export interface Neo4jBacklogStore extends BacklogStore {
  ready(): Promise<void>;
  registerWorkspace(input: { name: string; volume: string; containerPath: string }): Promise<void>;
}

const priorities: Priority[] = ['low', 'medium', 'high'];
const statuses: Status[] = ['backlog', 'in_progress', 'done'];

function properties(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && 'properties' in value) {
    const candidate = (value as { properties?: unknown }).properties;
    if (candidate && typeof candidate === 'object') return candidate as Record<string, unknown>;
  }
  return {};
}

function projectFrom(value: unknown): Project {
  const p = properties(value);
  return { id: String(p.id), name: String(p.name), createdAt: String(p.createdAt) };
}

function tagFrom(value: unknown): Tag {
  const p = properties(value);
  const color = tagColors.includes(p.color as TagColor) ? p.color as TagColor : 'slate';
  return { id: String(p.id), name: String(p.name), color, createdAt: String(p.createdAt) };
}

function taskFrom(value: unknown, tagIds: unknown): Task {
  const p = properties(value);
  const priority = priorities.includes(p.priority as Priority) ? p.priority as Priority : 'medium';
  const status = statuses.includes(p.status as Status) ? p.status as Status : 'backlog';
  return {
    id: String(p.id),
    projectId: String(p.projectId),
    title: String(p.title),
    description: p.description == null ? '' : String(p.description),
    priority,
    dueDate: p.dueDate == null ? null : String(p.dueDate),
    dueTime: p.dueTime == null ? null : String(p.dueTime),
    status,
    tagIds: Array.isArray(tagIds) ? tagIds.map(String).sort() : [],
    createdAt: String(p.createdAt),
    updatedAt: String(p.updatedAt),
  };
}

function tagNameConflict(error: unknown): boolean {
  const code = String((error as { code?: unknown })?.code ?? '');
  const message = String((error as { message?: unknown })?.message ?? '');
  return code.includes('ConstraintValidationFailed') && message.includes('backlog_tag_name_key_unique');
}

export function openNeo4jBacklogStore(config: Neo4jConfig): Neo4jBacklogStore {
  const driver: Driver = neo4j.driver(config.uri, neo4j.auth.basic(config.user, config.password), {
    disableLosslessIntegers: true,
    connectionTimeout: 10_000,
    maxConnectionPoolSize: 10,
  });
  const session = (): Session => driver.session({ database: config.database });

  function fail(error: unknown): never {
    if (error instanceof HttpError) throw error;
    console.error('Neo4j request failed:', (error as Error)?.message ?? String(error));
    throw new HttpError(500, 'Graph database request failed.');
  }

  async function run<T>(work: () => Promise<T>): Promise<T> {
    try { return await work(); }
    catch (error) {
      if (tagNameConflict(error)) throw new HttpError(400, 'A tag with that name already exists.');
      return fail(error);
    }
  }

  async function assertProject(tx: ManagedTransaction, projectId: string) {
    const result = await tx.run('MATCH (p:BacklogProject {id:$projectId}) RETURN p LIMIT 1', { projectId });
    if (!result.records.length) throw new HttpError(400, 'Project does not exist.');
  }

  async function assertTags(tx: ManagedTransaction, tagIds: string[]) {
    if (!tagIds.length) return;
    const result = await tx.run('MATCH (g:BacklogTag) WHERE g.id IN $tagIds RETURN count(g) AS count', { tagIds });
    if (Number(result.records[0]?.get('count') ?? 0) !== tagIds.length) throw new HttpError(400, 'Tag does not exist.');
  }

  async function readTag(id: string): Promise<Tag> {
    return run(async () => {
      const current = session();
      try {
        const result = await current.executeRead(tx => tx.run('MATCH (g:BacklogTag {id:$id}) RETURN g LIMIT 1', { id }));
        if (!result.records.length) throw new HttpError(404, 'Tag not found.');
        return tagFrom(result.records[0]!.get('g'));
      } finally { await current.close(); }
    });
  }

  async function readTask(id: string): Promise<Task> {
    return run(async () => {
      const current = session();
      try {
        const result = await current.executeRead(tx => tx.run(
          'MATCH (t:BacklogTask {id:$id}) OPTIONAL MATCH (t)-[:TAGGED_WITH]->(g:BacklogTag) RETURN t, collect(g.id) AS tagIds LIMIT 1',
          { id },
        ));
        if (!result.records.length) throw new HttpError(404, 'Task not found.');
        return taskFrom(result.records[0]!.get('t'), result.records[0]!.get('tagIds'));
      } finally { await current.close(); }
    });
  }

  return {
    async ready() {
      await driver.verifyConnectivity();
      const current = session();
      try {
        for (const statement of backlogSchemaStatements) await current.run(statement);
      } finally { await current.close(); }
    },

    projects() {
      return run(async () => {
        const current = session();
        try {
          const result = await current.executeRead(tx => tx.run(
            'MATCH (p:BacklogProject) RETURN p ORDER BY p.createdAt, p.id',
          ));
          return result.records.map(record => projectFrom(record.get('p')));
        } finally { await current.close(); }
      });
    },

    tags() {
      return run(async () => {
        const current = session();
        try {
          const result = await current.executeRead(tx => tx.run(
            'MATCH (g:BacklogTag) RETURN g ORDER BY g.nameKey, g.id',
          ));
          return result.records.map(record => tagFrom(record.get('g')));
        } finally { await current.close(); }
      });
    },

    tasks() {
      return run(async () => {
        const current = session();
        try {
          const result = await current.executeRead(tx => tx.run(`
            MATCH (t:BacklogTask)
            OPTIONAL MATCH (t)-[:TAGGED_WITH]->(g:BacklogTag)
            RETURN t, collect(g.id) AS tagIds
            ORDER BY t.createdAt, t.id
          `));
          return result.records.map(record => taskFrom(record.get('t'), record.get('tagIds')));
        } finally { await current.close(); }
      });
    },

    createProject(name: string) {
      return run(async () => {
        const id = randomUUID();
        const createdAt = new Date().toISOString();
        const current = session();
        try {
          await current.executeWrite(tx => tx.run(
            'CREATE (p:BacklogProject {id:$id, name:$name, createdAt:$createdAt})',
            { id, name, createdAt },
          ));
          return { id, name, createdAt };
        } finally { await current.close(); }
      });
    },

    updateProject(id: string, name: string) {
      return run(async () => {
        const current = session();
        try {
          const result = await current.executeWrite(tx => tx.run(
            'MATCH (p:BacklogProject {id:$id}) SET p.name=$name RETURN p',
            { id, name },
          ));
          if (!result.records.length) throw new HttpError(404, 'Project not found.');
          return projectFrom(result.records[0]!.get('p'));
        } finally { await current.close(); }
      });
    },

    deleteProject(id: string) {
      return run(async () => {
        const current = session();
        try {
          await current.executeWrite(async tx => {
            const existing = await tx.run('MATCH (p:BacklogProject {id:$id}) RETURN p LIMIT 1', { id });
            if (!existing.records.length) throw new HttpError(404, 'Project not found.');
            await tx.run('MATCH (t:BacklogTask)-[:IN_PROJECT]->(p:BacklogProject {id:$id}) DETACH DELETE t', { id });
            await tx.run('MATCH (p:BacklogProject {id:$id}) DETACH DELETE p', { id });
          });
        } finally { await current.close(); }
      });
    },

    createTag(input: TagInput) {
      return run(async () => {
        const id = randomUUID();
        const createdAt = new Date().toISOString();
        const nameKey = input.name.toLowerCase();
        const current = session();
        try {
          await current.executeWrite(async tx => {
            const existing = await tx.run('MATCH (g:BacklogTag {nameKey:$nameKey}) RETURN g LIMIT 1', { nameKey });
            if (existing.records.length) throw new HttpError(400, 'A tag with that name already exists.');
            await tx.run(
              'CREATE (g:BacklogTag {id:$id, name:$name, nameKey:$nameKey, color:$color, createdAt:$createdAt})',
              { id, name: input.name, nameKey, color: input.color, createdAt },
            );
          });
          return { id, name: input.name, color: input.color, createdAt };
        } finally { await current.close(); }
      });
    },

    updateTag(id: string, input: Partial<TagInput>) {
      return run(async () => {
        const previous = await readTag(id);
        const name = input.name ?? previous.name;
        const color = input.color ?? previous.color;
        const nameKey = name.toLowerCase();
        const current = session();
        try {
          const result = await current.executeWrite(async tx => {
            const collision = await tx.run(
              'MATCH (g:BacklogTag {nameKey:$nameKey}) WHERE g.id <> $id RETURN g LIMIT 1',
              { nameKey, id },
            );
            if (collision.records.length) throw new HttpError(400, 'A tag with that name already exists.');
            return tx.run(
              'MATCH (g:BacklogTag {id:$id}) SET g.name=$name, g.nameKey=$nameKey, g.color=$color RETURN g',
              { id, name, nameKey, color },
            );
          });
          return tagFrom(result.records[0]!.get('g'));
        } finally { await current.close(); }
      });
    },

    deleteTag(id: string) {
      return run(async () => {
        const current = session();
        try {
          const result = await current.executeWrite(tx => tx.run(
            'MATCH (g:BacklogTag {id:$id}) WITH g DETACH DELETE g RETURN count(*) AS deleted',
            { id },
          ));
          if (Number(result.records[0]?.get('deleted') ?? 0) === 0) throw new HttpError(404, 'Tag not found.');
        } finally { await current.close(); }
      });
    },

    createTask(input: Partial<TaskInput>) {
      return run(async () => {
        const data = { description: '', priority: 'medium', dueDate: null, dueTime: null, status: 'backlog', tagIds: [], ...input } as TaskInput;
        const dueTime = resolveDueTime(data.dueDate, input.dueTime);
        const id = randomUUID();
        const createdAt = new Date().toISOString();
        const tagIds = [...data.tagIds].sort();
        const current = session();
        try {
          await current.executeWrite(async tx => {
            await assertProject(tx, data.projectId);
            await assertTags(tx, tagIds);
            await tx.run(`
              MATCH (p:BacklogProject {id:$projectId})
              CREATE (t:BacklogTask {
                id:$id, projectId:$projectId, title:$title, description:$description,
                priority:$priority, dueDate:$dueDate, dueTime:$dueTime, status:$status,
                createdAt:$createdAt, updatedAt:$updatedAt
              })
              CREATE (t)-[:IN_PROJECT]->(p)
            `, {
              id, projectId: data.projectId, title: data.title, description: data.description,
              priority: data.priority, dueDate: data.dueDate, dueTime, status: data.status,
              createdAt, updatedAt: createdAt,
            });
            if (tagIds.length) {
              await tx.run(
                'MATCH (t:BacklogTask {id:$id}), (g:BacklogTag) WHERE g.id IN $tagIds MERGE (t)-[:TAGGED_WITH]->(g)',
                { id, tagIds },
              );
            }
          });
          return {
            id, projectId: data.projectId, title: data.title, description: data.description,
            priority: data.priority, dueDate: data.dueDate, dueTime, status: data.status,
            tagIds, createdAt, updatedAt: createdAt,
          };
        } finally { await current.close(); }
      });
    },

    updateTask(id: string, input: Partial<TaskInput>) {
      return run(async () => {
        const previous = await readTask(id);
        const data = { ...previous, ...input };
        const tagIds = input.tagIds === undefined ? previous.tagIds : [...input.tagIds].sort();
        const dueTime = resolveDueTime(data.dueDate, input.dueTime, previous.dueTime);
        const updatedAt = new Date().toISOString();
        const current = session();
        try {
          await current.executeWrite(async tx => {
            await assertProject(tx, data.projectId);
            if (input.tagIds !== undefined) await assertTags(tx, tagIds);
            await tx.run(`
              MATCH (t:BacklogTask {id:$id})
              SET t.projectId=$projectId, t.title=$title, t.description=$description,
                  t.priority=$priority, t.dueDate=$dueDate, t.dueTime=$dueTime,
                  t.status=$status, t.updatedAt=$updatedAt
            `, {
              id, projectId: data.projectId, title: data.title, description: data.description,
              priority: data.priority, dueDate: data.dueDate, dueTime, status: data.status, updatedAt,
            });
            if (data.projectId !== previous.projectId) {
              await tx.run('MATCH (t:BacklogTask {id:$id}) OPTIONAL MATCH (t)-[r:IN_PROJECT]->() DELETE r', { id });
              await tx.run(
                'MATCH (t:BacklogTask {id:$id}), (p:BacklogProject {id:$projectId}) CREATE (t)-[:IN_PROJECT]->(p)',
                { id, projectId: data.projectId },
              );
            }
            if (input.tagIds !== undefined) {
              await tx.run('MATCH (t:BacklogTask {id:$id}) OPTIONAL MATCH (t)-[r:TAGGED_WITH]->() DELETE r', { id });
              if (tagIds.length) {
                await tx.run(
                  'MATCH (t:BacklogTask {id:$id}), (g:BacklogTag) WHERE g.id IN $tagIds MERGE (t)-[:TAGGED_WITH]->(g)',
                  { id, tagIds },
                );
              }
            }
          });
          return {
            id, projectId: data.projectId, title: data.title, description: data.description,
            priority: data.priority, dueDate: data.dueDate, dueTime, status: data.status,
            tagIds, createdAt: previous.createdAt, updatedAt,
          };
        } finally { await current.close(); }
      });
    },

    deleteTask(id: string) {
      return run(async () => {
        const current = session();
        try {
          const result = await current.executeWrite(tx => tx.run(
            'MATCH (t:BacklogTask {id:$id}) WITH t DETACH DELETE t RETURN count(*) AS deleted',
            { id },
          ));
          if (Number(result.records[0]?.get('deleted') ?? 0) === 0) throw new HttpError(404, 'Task not found.');
        } finally { await current.close(); }
      });
    },

    registerWorkspace(input: { name: string; volume: string; containerPath: string }) {
      return run(async () => {
        const current = session();
        try {
          const now = new Date().toISOString();
          await current.executeWrite(tx => tx.run(`
            MERGE (w:IdeWorkspace {volume:$volume})
            ON CREATE SET w.id=$id, w.createdAt=$now
            SET w.name=$name, w.containerPath=$containerPath, w.updatedAt=$now
          `, { id: randomUUID(), name: input.name, volume: input.volume, containerPath: input.containerPath, now }));
        } finally { await current.close(); }
      });
    },

    close() {
      return driver.close();
    },
  };
}

export async function openConfiguredBacklogStore(env: NodeJS.ProcessEnv = process.env): Promise<Neo4jBacklogStore | undefined> {
  const mode = env.BACKLOG_STORE;
  if (mode !== undefined && mode !== 'sqlite' && mode !== 'neo4j') {
    throw new Error('BACKLOG_STORE must be sqlite or neo4j.');
  }
  const useNeo4j = mode === 'neo4j' || (mode === undefined && Boolean(env.NEO4J_URI));
  if (!useNeo4j) return undefined;
  const uri = env.NEO4J_URI;
  if (!uri) throw new Error('NEO4J_URI is required when BACKLOG_STORE=neo4j.');
  const password = env.NEO4J_PASSWORD;
  if (!password) throw new Error('NEO4J_PASSWORD is required when using the Neo4j backlog store.');
  const store = openNeo4jBacklogStore({
    uri,
    user: env.NEO4J_USER || 'neo4j',
    password,
    database: env.NEO4J_DATABASE || 'neo4j',
  });
  try {
    await store.ready();
  } catch (error) {
    await store.close();
    throw new Error(`Unable to initialize the Neo4j backlog store: ${(error as Error).message}`);
  }
  return store;
}
