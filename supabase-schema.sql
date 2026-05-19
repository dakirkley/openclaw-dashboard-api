-- OpenClaw Dashboard API - Supabase Schema

-- API Keys table
CREATE TABLE IF NOT EXISTS api_keys (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  key TEXT UNIQUE NOT NULL,
  permissions TEXT[] DEFAULT ARRAY['read'],
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_used_at TIMESTAMP WITH TIME ZONE
);

-- Machine Tokens table
CREATE TABLE IF NOT EXISTS machine_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  token TEXT UNIQUE NOT NULL,
  business_id UUID REFERENCES businesses(id),
  permissions TEXT[] DEFAULT ARRAY['sync'],
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_used_at TIMESTAMP WITH TIME ZONE
);

-- Machines table
CREATE TABLE IF NOT EXISTS machines (
  id TEXT PRIMARY KEY,
  business_id UUID REFERENCES businesses(id),
  hostname TEXT,
  platform TEXT,
  arch TEXT,
  version TEXT,
  sync_mode TEXT DEFAULT 'metadata',
  last_seen_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Heartbeats table
CREATE TABLE IF NOT EXISTS heartbeats (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  machine_id TEXT REFERENCES machines(id) ON DELETE CASCADE,
  status TEXT,
  skills_loaded INTEGER DEFAULT 0,
  agents_active INTEGER DEFAULT 0,
  executors_detected INTEGER DEFAULT 0,
  timestamp TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Inventories table
CREATE TABLE IF NOT EXISTS inventories (
  machine_id TEXT PRIMARY KEY REFERENCES machines(id) ON DELETE CASCADE,
  skills JSONB DEFAULT '[]',
  agents JSONB DEFAULT '[]',
  executors JSONB DEFAULT '[]',
  sync_mode TEXT DEFAULT 'metadata',
  collected_at TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Machine skills table
CREATE TABLE IF NOT EXISTS machine_skills (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  machine_id TEXT REFERENCES machines(id) ON DELETE CASCADE,
  skill_name TEXT NOT NULL,
  skill_version TEXT,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(machine_id, skill_name)
);

-- Enable RLS
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE machine_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE machines ENABLE ROW LEVEL SECURITY;
ALTER TABLE heartbeats ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventories ENABLE ROW LEVEL SECURITY;
ALTER TABLE machine_skills ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Allow all" ON api_keys FOR ALL USING (true);
CREATE POLICY "Allow all" ON machine_tokens FOR ALL USING (true);
CREATE POLICY "Allow all" ON machines FOR ALL USING (true);
CREATE POLICY "Allow all" ON heartbeats FOR ALL USING (true);
CREATE POLICY "Allow all" ON inventories FOR ALL USING (true);
CREATE POLICY "Allow all" ON machine_skills FOR ALL USING (true);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_api_keys_key ON api_keys(key);
CREATE INDEX IF NOT EXISTS idx_machine_tokens_token ON machine_tokens(token);
CREATE INDEX IF NOT EXISTS idx_machines_business_id ON machines(business_id);
CREATE INDEX IF NOT EXISTS idx_heartbeats_machine_id ON heartbeats(machine_id);

SELECT 'Schema created successfully!' as status;
