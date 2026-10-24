-- Mergatroid app-state schema (SQLite, first migration: user_version = 1)
--
-- Only app state lives here. Git data (commits, refs, tags, stashes, status,
-- diffs) is read live from each repo with the git CLI and is never copied in.
--
-- Conventions
--   ids        TEXT uuid from crypto.randomUUID()
--   times      INTEGER, Unix epoch milliseconds, UTC
--   booleans   INTEGER 0/1 with a CHECK
--   json       TEXT with CHECK (json_valid(...))
--   owner      profile_id on everything the user owns (one 'default' profile at first)
-- Access rules: single local user. The DB file sits in Electron's userData dir
-- and only the main process opens it. The renderer never sees SQL. Every IPC
-- handler checks that the repo_id it is given exists and is open.

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

create table profiles (
  id               text primary key,
  name             text not null,
  git_author_name  text,              -- null = use git config user.name
  git_author_email text,              -- null = use git config user.email
  is_active        integer not null default 0 check (is_active in (0, 1)),
  created_at       integer not null,
  updated_at       integer not null
);
create unique index profiles_one_active on profiles (is_active) where is_active = 1;

create table repo_groups (
  id          text primary key,
  profile_id  text not null references profiles(id) on delete cascade,
  name        text not null,
  color       text,                   -- token name, not a hex from the original
  sort_order  integer not null default 0,
  created_at  integer not null,
  updated_at  integer not null,
  unique (profile_id, name)
);
create index repo_groups_profile on repo_groups (profile_id, sort_order);

create table repositories (
  id              text primary key,
  profile_id      text not null references profiles(id) on delete cascade,
  group_id        text references repo_groups(id) on delete set null,
  path            text not null,      -- absolute worktree path as shown
  path_key        text not null,      -- realpath, normalised; lower-cased on Windows/macOS
  alias           text,
  is_favorite     integer not null default 0 check (is_favorite in (0, 1)),
  is_open         integer not null default 0 check (is_open in (0, 1)),
  tab_order       integer,            -- null when closed
  last_opened_at  integer,
  created_at      integer not null,
  updated_at      integer not null,
  unique (profile_id, path_key),
  check (is_open = 0 or tab_order is not null)
);
create index repositories_group  on repositories (group_id);
create index repositories_recent on repositories (profile_id, last_opened_at desc);
create index repositories_tabs   on repositories (profile_id, is_open, tab_order);

-- Per-repo graph table layout (column order, widths, visibility).
create table graph_layouts (
  repo_id               text primary key references repositories(id) on delete cascade,
  columns               text not null check (json_valid(columns)),
      -- [{ "key": "refs"|"graph"|"message"|"author"|"date"|"sha", "width": 120, "visible": true }]
  initial_commit_count  integer not null default 2000 check (initial_commit_count >= 500),
  show_all_commits      integer not null default 0 check (show_all_commits in (0, 1)),
  created_at            integer not null,
  updated_at            integer not null
);

-- Hide / solo / pin state for refs in the graph.
create table ref_view_state (
  id           text primary key,
  repo_id      text not null references repositories(id) on delete cascade,
  ref_name     text not null,         -- full name, e.g. refs/heads/main, refs/remotes/origin/main
  hidden       integer not null default 0 check (hidden in (0, 1)),
  soloed       integer not null default 0 check (soloed in (0, 1)),
  pinned_left  integer not null default 0 check (pinned_left in (0, 1)),
  created_at   integer not null,
  updated_at   integer not null,
  unique (repo_id, ref_name),
  check (not (hidden = 1 and soloed = 1))
);
-- the unique index above covers repo_id lookups

-- Preferences. repo_id null = global for the profile, set = repo-specific override.
create table preferences (
  id          text primary key,
  profile_id  text not null references profiles(id) on delete cascade,
  repo_id     text references repositories(id) on delete cascade,
  key         text not null,          -- e.g. 'fetch.intervalMinutes', 'pull.mode', 'editor.fontSize'
  value       text not null check (json_valid(value)),
  created_at  integer not null,
  updated_at  integer not null
);
-- SQLite treats NULLs as distinct in UNIQUE, so two partial indexes instead of one.
create unique index preferences_global on preferences (profile_id, key) where repo_id is null;
create unique index preferences_repo   on preferences (repo_id, key)    where repo_id is not null;

-- Undo / redo stack. One row per undoable action.
-- before/after hold what is needed to move refs back:
--   { "head": "refs/heads/main" | "<sha>", "refs": { "<full ref>": "<sha>"|null },
--     "indexTree": "<tree sha>"|null, "worktreeStash": "<sha>"|null }
-- worktreeStash is a `git stash create` commit pinned under refs/mergatroid/undo/<id> (refs/gitclone/undo/ before the rename)
-- so a discard can be brought back.
create table undo_entries (
  id           text primary key,
  repo_id      text not null references repositories(id) on delete cascade,
  seq          integer not null,      -- per-repo increasing
  action_type  text not null check (action_type in (
                 'checkout','commit','amend','discard','branch_delete','remote_remove',
                 'reset','merge','rebase','interactive_rebase','cherry_pick','revert',
                 'reword','drop')),
  label        text not null,         -- "Commit 'Fix login'" for the toolbar tooltip
  before_state text not null check (json_valid(before_state)),
  after_state  text not null check (json_valid(after_state)),
  state        text not null default 'done' check (state in ('done', 'undone')),
  created_at   integer not null,
  updated_at   integer not null,
  unique (repo_id, seq)
);
-- the unique index above covers (repo_id, seq) lookups

-- Every git command the app ran, for the activity log (S16) and error toasts.
create table activity_log (
  id           text primary key,
  repo_id      text references repositories(id) on delete cascade,  -- null for clone before the repo exists
  op_id        text not null,         -- groups the commands of one user action
  argv         text not null check (json_valid(argv)),  -- ["git","push","origin","main"], secrets stripped
  status       text not null check (status in ('running','ok','error','cancelled')),
  exit_code    integer,
  stderr_tail  text,                  -- last 8 KB
  started_at   integer not null,
  finished_at  integer,
  created_at   integer not null
);
create index activity_log_repo_time on activity_log (repo_id, started_at desc);
create index activity_log_op        on activity_log (op_id);

PRAGMA user_version = 1;
