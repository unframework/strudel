# Strudel Website

This is the website for Strudel, deployed at [strudel.cc](https://strudel.cc).
It includes the REPL live coding editor and the documentation site.

more setup info, see [project setup](../CONTRIBUTING.md#project-setup)

## Remote Pattern Sync (supasync)

User patterns can optionally sync to a private Supabase project instead of only living in browser localStorage. If no credentials are configured, everything works as before with no errors.

### 1. Create a Supabase project

Go to [supabase.com](https://supabase.com) and create a new project.

### 2. Create the `patterns` table

In the Supabase dashboard SQL editor, run:

```sql
CREATE TABLE patterns (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON patterns
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Permissive RLS (private project, anon key is the credential)
ALTER TABLE patterns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all" ON patterns
  FOR ALL USING (true) WITH CHECK (true);
```

### 3. Add credentials to `website/.env`

Create a `.env` file in the `website` folder, not root (it is gitignored):

```
PUBLIC_SUPASYNC_URL=https://YOUR_PROJECT.supabase.co
PUBLIC_SUPASYNC_KEY=eyJ...YOUR_ANON_KEY...
```

Find these values in your Supabase project under **Settings > API**.

### 4. Verify

1. Run the REPL and create/edit patterns — check the Supabase table editor for rows.
2. Open an incognito window or second browser — patterns load from remote on startup.
3. Delete a pattern — confirm the row is deleted in Supabase.
4. Remove `.env` — confirm the REPL works normally with no errors.