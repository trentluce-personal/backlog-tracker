export const backlogSchemaStatements = [
  'CREATE CONSTRAINT `backlog_project_id_unique` IF NOT EXISTS FOR (e:`BacklogProject`) REQUIRE (e.`id`) IS UNIQUE',
  'CREATE CONSTRAINT `backlog_task_id_unique` IF NOT EXISTS FOR (e:`BacklogTask`) REQUIRE (e.`id`) IS UNIQUE',
  'CREATE CONSTRAINT `backlog_tag_id_unique` IF NOT EXISTS FOR (e:`BacklogTag`) REQUIRE (e.`id`) IS UNIQUE',
  'CREATE CONSTRAINT `backlog_tag_name_key_unique` IF NOT EXISTS FOR (e:`BacklogTag`) REQUIRE (e.`nameKey`) IS UNIQUE',
  'CREATE CONSTRAINT `ide_workspace_volume_unique` IF NOT EXISTS FOR (w:`IdeWorkspace`) REQUIRE (w.`volume`) IS UNIQUE',
  'CREATE RANGE INDEX `backlog_task_project_idx` IF NOT EXISTS FOR (e:`BacklogTask`) ON (e.`projectId`)',
  'CREATE RANGE INDEX `backlog_task_status_idx` IF NOT EXISTS FOR (e:`BacklogTask`) ON (e.`status`)',
  'CREATE RANGE INDEX `backlog_task_due_date_idx` IF NOT EXISTS FOR (e:`BacklogTask`) ON (e.`dueDate`)',
  'CREATE RANGE INDEX `backlog_tag_name_idx` IF NOT EXISTS FOR (e:`BacklogTag`) ON (e.`name`)',
] as const;
