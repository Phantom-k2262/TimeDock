PRAGMA foreign_keys = ON;

ALTER TABLE users ADD COLUMN account_type TEXT NOT NULL DEFAULT 'member' CHECK (account_type IN ('system_admin', 'system_operator', 'verifier', 'member'));
UPDATE users SET account_type = CASE role WHEN 'admin' THEN 'system_admin' WHEN 'approver' THEN 'verifier' ELSE 'member' END;

ALTER TABLE workspaces ADD COLUMN sharing_mode TEXT NOT NULL DEFAULT 'member_scoped' CHECK (sharing_mode IN ('shared_box', 'member_scoped'));
ALTER TABLE workspaces ADD COLUMN verification_mode TEXT NOT NULL DEFAULT 'none' CHECK (verification_mode IN ('none', 'verified_only'));

ALTER TABLE documents ADD COLUMN verification_status TEXT NOT NULL DEFAULT 'unverified' CHECK (verification_status IN ('unverified', 'in_review', 'returned', 'verified'));

CREATE INDEX idx_documents_verification ON documents(target_month, verification_status, deleted_at);
