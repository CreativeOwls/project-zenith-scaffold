ALTER TABLE public.agents DROP CONSTRAINT IF EXISTS agents_user_id_fkey;
ALTER TABLE public.agent_memories DROP CONSTRAINT IF EXISTS agent_memories_user_id_fkey;
ALTER TABLE public.node_flows DROP CONSTRAINT IF EXISTS node_flows_user_id_fkey;
ALTER TABLE public.node_flow_runs DROP CONSTRAINT IF EXISTS node_flow_runs_user_id_fkey;

ALTER TABLE public.agents ALTER COLUMN user_id SET DEFAULT '00000000-0000-0000-0000-000000000001';
ALTER TABLE public.agent_memories ALTER COLUMN user_id SET DEFAULT '00000000-0000-0000-0000-000000000001';
ALTER TABLE public.node_flows ALTER COLUMN user_id SET DEFAULT '00000000-0000-0000-0000-000000000001';
ALTER TABLE public.node_flow_runs ALTER COLUMN user_id SET DEFAULT '00000000-0000-0000-0000-000000000001';

REVOKE SELECT, INSERT, UPDATE, DELETE ON public.agents FROM authenticated;
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.agent_memories FROM authenticated;
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.node_flows FROM authenticated;
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.node_flow_runs FROM authenticated;