-- Who approved an evidence for the cloud modes, and when: approval is per session and final.
ALTER TABLE evidence ADD COLUMN approved_at TEXT;
ALTER TABLE evidence ADD COLUMN approved_by TEXT;
