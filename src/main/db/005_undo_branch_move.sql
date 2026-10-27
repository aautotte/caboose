-- 005: resetting a branch that isn't checked out (moving it) is undoable. SQLite can't change a CHECK constraint
-- in place, so the table is rebuilt with the same columns and data, as in 002 and 004.
create table undo_entries_new (
  id           text primary key,
  repo_id      text not null references repositories(id) on delete cascade,
  seq          integer not null,
  action_type  text not null check (action_type in (
                 'checkout','commit','amend','discard','discard_lines','branch_delete','remote_remove',
                 'reset','merge','rebase','interactive_rebase','cherry_pick','revert',
                 'reword','drop','stash_drop','tag_delete','ignore','branch_move')),
  label        text not null,
  before_state text not null check (json_valid(before_state)),
  after_state  text not null check (json_valid(after_state)),
  state        text not null default 'done' check (state in ('done', 'undone')),
  created_at   integer not null,
  updated_at   integer not null,
  unique (repo_id, seq)
);
insert into undo_entries_new select * from undo_entries;
drop table undo_entries;
alter table undo_entries_new rename to undo_entries;

pragma user_version = 5;
