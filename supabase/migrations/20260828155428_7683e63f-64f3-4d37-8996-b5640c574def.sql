CREATE TABLE public.agents (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  system_prompt TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT 'google/gemini-2.5-flash',
  tools TEXT[] NOT NULL DEFAULT '{}',
  delegation_enabled BOOLEAN NOT NULL DEFAULT false,
  max_delegation_depth INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agents TO authenticated;
GRANT ALL ON public.agents TO service_role;
ALTER TABLE public.agents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own agents" ON public.agents FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.agent_memories (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_id UUID REFERENCES public.agents(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  memory_type TEXT NOT NULL DEFAULT 'summary' CHECK (memory_type IN ('fact','preference','summary')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX agent_memories_agent_idx ON public.agent_memories (agent_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_memories TO authenticated;
GRANT ALL ON public.agent_memories TO service_role;
ALTER TABLE public.agent_memories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own agent memories" ON public.agent_memories FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.node_flows (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  nodes JSONB NOT NULL DEFAULT '[]'::jsonb,
  connections JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.node_flows TO authenticated;
GRANT ALL ON public.node_flows TO service_role;
ALTER TABLE public.node_flows ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own flows" ON public.node_flows FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.node_flow_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  flow_id UUID REFERENCES public.node_flows(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  node_statuses JSONB NOT NULL DEFAULT '{}'::jsonb,
  result JSONB,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX node_flow_runs_flow_idx ON public.node_flow_runs (flow_id, started_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.node_flow_runs TO authenticated;
GRANT ALL ON public.node_flow_runs TO service_role;
ALTER TABLE public.node_flow_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own flow runs" ON public.node_flow_runs FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.touch_updated_at() RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public;
CREATE TRIGGER node_flows_touch BEFORE UPDATE ON public.node_flows FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER PUBLICATION supabase_realtime ADD TABLE public.node_flow_runs;
ALTER TABLE public.node_flow_runs REPLICA IDENTITY FULL;