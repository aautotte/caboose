-- 003: a profile can carry its own signing key and SSH key, next to its author name and email.
-- Null means "use Git's own config", as for the name and email.
alter table profiles add column signing_key text;
alter table profiles add column ssh_key text;
pragma user_version = 3;
