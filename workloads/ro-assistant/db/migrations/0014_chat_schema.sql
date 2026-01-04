BEGIN;

CREATE SCHEMA IF NOT EXISTS chat;

CREATE TABLE IF NOT EXISTS chat.conversations (
  conversation_id uuid PRIMARY KEY,
  tenant_id       uuid NOT NULL REFERENCES app.tenants(tenant_id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES app.users(user_id) ON DELETE CASCADE,
  title           text NOT NULL DEFAULT 'New chat',
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chat.messages (
  message_id      uuid PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES chat.conversations(conversation_id) ON DELETE CASCADE,
  tenant_id       uuid NOT NULL REFERENCES app.tenants(tenant_id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES app.users(user_id) ON DELETE CASCADE,
  role            text NOT NULL CHECK (role IN ('USER','ASSISTANT','SYSTEM')),
  content         text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE chat.conversations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS conversations_access ON chat.conversations;
CREATE POLICY conversations_access
ON chat.conversations
USING (
  app.current_role() = 'DEVELOPER'
  OR (app.current_role() = 'DEALERADMIN' AND tenant_id IN (SELECT tenant_id FROM app.tenants WHERE group_id = app.current_group_id()))
  OR (app.current_role() = 'ADMIN' AND tenant_id = app.current_tenant_id())
  OR (app.current_role() = 'USER' AND tenant_id = app.current_tenant_id() AND user_id = app.current_user_id())
)
WITH CHECK (
  app.current_role() = 'DEVELOPER'
  OR (app.current_role() = 'DEALERADMIN' AND tenant_id IN (SELECT tenant_id FROM app.tenants WHERE group_id = app.current_group_id()))
  OR (app.current_role() = 'ADMIN' AND tenant_id = app.current_tenant_id())
  OR (app.current_role() = 'USER' AND tenant_id = app.current_tenant_id() AND user_id = app.current_user_id())
);

ALTER TABLE chat.messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS messages_access ON chat.messages;
CREATE POLICY messages_access
ON chat.messages
USING (
  app.current_role() = 'DEVELOPER'
  OR (app.current_role() = 'DEALERADMIN' AND tenant_id IN (SELECT tenant_id FROM app.tenants WHERE group_id = app.current_group_id()))
  OR (app.current_role() = 'ADMIN' AND tenant_id = app.current_tenant_id())
  OR (app.current_role() = 'USER' AND tenant_id = app.current_tenant_id() AND user_id = app.current_user_id())
)
WITH CHECK (
  app.current_role() = 'DEVELOPER'
  OR (app.current_role() = 'DEALERADMIN' AND tenant_id IN (SELECT tenant_id FROM app.tenants WHERE group_id = app.current_group_id()))
  OR (app.current_role() = 'ADMIN' AND tenant_id = app.current_tenant_id())
  OR (app.current_role() = 'USER' AND tenant_id = app.current_tenant_id() AND user_id = app.current_user_id())
);

COMMIT;
