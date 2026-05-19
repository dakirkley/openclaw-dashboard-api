const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Middleware
app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ========== API KEY MANAGEMENT ==========

// Create API key (no auth required for first key creation)
app.post('/api/v1/apikeys', async (req, res) => {
  const { name, permissions = ['read'] } = req.body;
  
  if (!name) {
    return res.status(400).json({ success: false, error: 'Name is required' });
  }
  
  const newKey = {
    id: uuidv4(),
    name,
    key: `oc_${Buffer.from(uuidv4()).toString('base64').replace(/[^a-zA-Z0-9]/g, '').substring(0, 32)}`,
    permissions,
    created_at: new Date().toISOString(),
    last_used_at: null
  };
  
  const { data, error } = await supabase
    .from('api_keys')
    .insert(newKey)
    .select();
  
  if (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
  
  res.json({ 
    success: true, 
    data: data[0],
    message: 'API key created. Save this key - you won\'t see it again!'
  });
});

// List API keys (requires read permission)
app.get('/api/v1/apikeys', validateApiKey, checkPermission('read'), async (req, res) => {
  const { data, error } = await supabase
    .from('api_keys')
    .select('id, name, permissions, created_at, last_used_at');
  
  if (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
  
  res.json({ success: true, data });
});

// Delete API key
app.delete('/api/v1/apikeys/:id', validateApiKey, checkPermission('delete'), async (req, res) => {
  const { error } = await supabase
    .from('api_keys')
    .delete()
    .eq('id', req.params.id);
  
  if (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
  
  res.json({ success: true });
});

// ========== BUSINESSES ==========

// List all businesses
app.get('/api/v1/businesses', validateApiKey, checkPermission('read'), async (req, res) => {
  const { data, error } = await supabase
    .from('businesses')
    .select('*');
  
  if (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
  
  res.json({ success: true, data });
});

// Get single business
app.get('/api/v1/businesses/:id', validateApiKey, checkPermission('read'), async (req, res) => {
  const { data, error } = await supabase
    .from('businesses')
    .select('*')
    .eq('id', req.params.id)
    .single();
  
  if (error || !data) {
    return res.status(404).json({ success: false, error: 'Business not found' });
  }
  
  res.json({ success: true, data });
});

// Create business
app.post('/api/v1/businesses', validateApiKey, checkPermission('write'), async (req, res) => {
  const { name, description, endpointUrl, color } = req.body;
  
  if (!name) {
    return res.status(400).json({ success: false, error: 'Name is required' });
  }
  
  const newBusiness = {
    id: `biz_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    name,
    description: description || '',
    endpoint_url: endpointUrl || '',
    api_key: '',
    color: color || '#0ea5e9',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  
  const { data, error } = await supabase
    .from('businesses')
    .insert(newBusiness)
    .select();
  
  if (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
  
  res.status(201).json({ success: true, data: data[0] });
});

// Update business
app.put('/api/v1/businesses/:id', validateApiKey, checkPermission('write'), async (req, res) => {
  const { data, error } = await supabase
    .from('businesses')
    .update({
      ...req.body,
      updated_at: new Date().toISOString()
    })
    .eq('id', req.params.id)
    .select();
  
  if (error || !data || data.length === 0) {
    return res.status(404).json({ success: false, error: 'Business not found' });
  }
  
  res.json({ success: true, data: data[0] });
});

// Delete business
app.delete('/api/v1/businesses/:id', validateApiKey, checkPermission('delete'), async (req, res) => {
  const { error } = await supabase
    .from('businesses')
    .delete()
    .eq('id', req.params.id);
  
  if (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
  
  res.json({ success: true });
});

// ========== BOTS, SUBAGENTS, SKILLS, APIS ==========
// (Similar CRUD operations for each...)

// ========== OPENCLAW SYNC ENDPOINTS ==========

// Machine registration
app.post('/api/openclaw/v1/machines/register', validateMachineToken, async (req, res) => {
  try {
    const { machine_id, hostname, platform, arch, version, sync_mode } = req.body;
    
    if (!machine_id) {
      return res.status(400).json({ ok: false, error: { code: 'bad_request', message: 'machine_id is required' } });
    }
    
    // Get or create business for this machine
    const businessName = hostname || `Machine-${machine_id.substring(0, 8)}`;
    
    // Check if business exists
    let { data: business } = await supabase
      .from('businesses')
      .select('*')
      .eq('name', businessName)
      .single();
    
    if (!business) {
      // Create business
      const { data: newBusiness } = await supabase
        .from('businesses')
        .insert({
          id: `biz_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          name: businessName,
          description: `Auto-created for machine ${machine_id}`,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .select()
        .single();
      business = newBusiness;
    }
    
    // Register machine
    const { data: machine, error } = await supabase
      .from('machines')
      .upsert({
        id: machine_id,
        business_id: business.id,
        hostname: hostname || 'unknown',
        platform: platform || 'unknown',
        arch: arch || 'unknown',
        version: version || 'unknown',
        sync_mode: sync_mode || 'metadata',
        last_seen_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }, { onConflict: 'id' })
      .select();
    
    if (error) {
      return res.status(500).json({ ok: false, error: { code: 'database_error', message: error.message } });
    }
    
    res.json({
      ok: true,
      machine: {
        machine_id,
        business_id: business.id,
        registered_at: machine[0].created_at,
        last_seen: machine[0].last_seen_at
      }
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: { code: 'server_error', message: err.message } });
  }
});

// Heartbeat
app.post('/api/openclaw/v1/machines/heartbeat', validateMachineToken, async (req, res) => {
  try {
    const { machine_id, status, skills_loaded, agents_active, executors_detected, timestamp } = req.body;
    
    const { data, error } = await supabase
      .from('heartbeats')
      .insert({
        machine_id,
        status: status || 'unknown',
        skills_loaded: skills_loaded || 0,
        agents_active: agents_active || 0,
        executors_detected: executors_detected || 0,
        timestamp: timestamp || new Date().toISOString()
      })
      .select();
    
    if (error) {
      return res.status(500).json({ ok: false, error: { code: 'database_error', message: error.message } });
    }
    
    // Update machine last_seen
    await supabase
      .from('machines')
      .update({ last_seen_at: new Date().toISOString() })
      .eq('id', machine_id);
    
    res.json({ ok: true, heartbeat: data[0] });
  } catch (err) {
    res.status(500).json({ ok: false, error: { code: 'server_error', message: err.message } });
  }
});

// Inventory sync
app.post('/api/openclaw/v1/sync/inventory', validateMachineToken, async (req, res) => {
  try {
    const { machine_id, skills, agents, executors, sync_mode, collected_at } = req.body;
    
    // Store inventory
    const { data, error } = await supabase
      .from('inventories')
      .upsert({
        machine_id,
        skills: skills || [],
        agents: agents || [],
        executors: executors || [],
        sync_mode: sync_mode || 'metadata',
        collected_at: collected_at || new Date().toISOString()
      }, { onConflict: 'machine_id' })
      .select();
    
    if (error) {
      return res.status(500).json({ ok: false, error: { code: 'database_error', message: error.message } });
    }
    
    // Update skills
    if (skills && skills.length > 0) {
      for (const skill of skills) {
        await supabase
          .from('machine_skills')
          .upsert({
            machine_id,
            skill_name: skill.name || skill,
            skill_version: skill.version || 'unknown',
            updated_at: new Date().toISOString()
          }, { onConflict: ['machine_id', 'skill_name'] });
      }
    }
    
    res.json({
      ok: true,
      results: {
        skills: { added: skills?.length || 0, updated: 0, removed: 0 },
        bots: { added: 0, updated: 0, removed: 0 },
        apis: { added: 0, updated: 0, removed: 0 }
      },
      machine_id,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: { code: 'server_error', message: err.message } });
  }
});

// ========== HELPER FUNCTIONS ==========

async function validateApiKey(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Missing or invalid Authorization header' });
  }
  
  const apiKey = authHeader.substring(7);
  
  const { data: keyRecord, error } = await supabase
    .from('api_keys')
    .select('*')
    .eq('key', apiKey)
    .single();
  
  if (error || !keyRecord) {
    return res.status(401).json({ success: false, error: 'Invalid API key' });
  }
  
  // Update last used
  await supabase
    .from('api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', keyRecord.id);
  
  req.apiKey = keyRecord;
  next();
}

function checkPermission(permission) {
  return (req, res, next) => {
    if (!req.apiKey.permissions.includes(permission)) {
      return res.status(403).json({ success: false, error: `Missing ${permission} permission` });
    }
    next();
  };
}

async function validateMachineToken(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ ok: false, error: { code: 'unauthorized', message: 'Missing token' } });
  }
  
  const token = authHeader.substring(7);
  
  // Check if it's a machine token
  const { data: tokenRecord, error } = await supabase
    .from('machine_tokens')
    .select('*')
    .eq('token', token)
    .eq('active', true)
    .single();
  
  if (tokenRecord) {
    req.machineToken = tokenRecord;
    return next();
  }
  
  // Check if it's an API key
  const { data: apiKey } = await supabase
    .from('api_keys')
    .select('*')
    .eq('key', token)
    .single();
  
  if (apiKey) {
    req.apiKey = apiKey;
    return next();
  }
  
  return res.status(401).json({ ok: false, error: { code: 'unauthorized', message: 'Invalid token' } });
}

app.listen(PORT, () => {
  console.log(`OpenClaw Dashboard API running on port ${PORT}`);
});
