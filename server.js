const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;
const DATA_FILE = path.join(__dirname, 'data.json');

// Middleware
app.use(cors());
app.use(express.json());

// In-memory data store for serverless environments
let memoryData = null;

// Initialize data file if not exists (for local dev)
function initData() {
  if (process.env.VERCEL || !fs.existsSync(DATA_FILE)) {
    // Use in-memory for Vercel or if file doesn't exist
    if (!memoryData) {
      memoryData = {
        businesses: [],
        apiKeys: [],
        machines: [],
        machineTokens: [],
        events: []
      };
    }
    return;
  }
  
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({
      businesses: [],
      apiKeys: [],
      machines: [],
      machineTokens: [],
      events: []
    }, null, 2));
  }
}

function loadData() {
  // Use in-memory store for Vercel
  if (process.env.VERCEL) {
    if (!memoryData) {
      memoryData = {
        businesses: [],
        apiKeys: [],
        machines: [],
        machineTokens: [],
        events: []
      };
    }
    return memoryData;
  }
  
  // Use file system for local dev
  initData();
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (err) {
    return { businesses: [], apiKeys: [], machines: [], machineTokens: [], events: [] };
  }
}

function saveData(data) {
  // In-memory for Vercel (no persistence between invocations)
  if (process.env.VERCEL) {
    memoryData = data;
    return;
  }
  
  // File system for local dev
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('Failed to save data:', err);
  }
}

// API Key validation middleware
function validateApiKey(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Missing or invalid Authorization header' });
  }
  
  const apiKey = authHeader.substring(7);
  const data = loadData();
  const keyRecord = data.apiKeys.find(k => k.key === apiKey);
  
  if (!keyRecord) {
    return res.status(401).json({ success: false, error: 'Invalid API key' });
  }
  
  // Update last used
  keyRecord.lastUsedAt = new Date().toISOString();
  saveData(data);
  
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

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ========== API KEY MANAGEMENT ==========

// Create API key (no auth required for first key creation)
app.post('/api/v1/apikeys', (req, res) => {
  const { name, permissions = ['read'] } = req.body;
  
  if (!name) {
    return res.status(400).json({ success: false, error: 'Name is required' });
  }
  
  const data = loadData();
  const newKey = {
    id: uuidv4(),
    name,
    key: `oc_${Buffer.from(uuidv4()).toString('base64').replace(/[^a-zA-Z0-9]/g, '').substring(0, 32)}`,
    permissions,
    createdAt: new Date().toISOString(),
    lastUsedAt: null
  };
  
  data.apiKeys.push(newKey);
  saveData(data);
  
  res.json({ 
    success: true, 
    data: newKey,
    message: 'API key created. Save this key - you won\'t see it again!'
  });
});

// List API keys (requires read permission)
app.get('/api/v1/apikeys', validateApiKey, checkPermission('read'), (req, res) => {
  const data = loadData();
  // Don't return full keys, just metadata
  const keys = data.apiKeys.map(k => ({
    id: k.id,
    name: k.name,
    permissions: k.permissions,
    createdAt: k.createdAt,
    lastUsedAt: k.lastUsedAt
  }));
  res.json({ success: true, data: keys });
});

// Delete API key
app.delete('/api/v1/apikeys/:id', validateApiKey, checkPermission('delete'), (req, res) => {
  const data = loadData();
  data.apiKeys = data.apiKeys.filter(k => k.id !== req.params.id);
  saveData(data);
  res.json({ success: true });
});

// ========== BUSINESSES ==========

// List all businesses
app.get('/api/v1/businesses', validateApiKey, checkPermission('read'), (req, res) => {
  const data = loadData();
  res.json({ success: true, data: data.businesses });
});

// Get single business
app.get('/api/v1/businesses/:id', validateApiKey, checkPermission('read'), (req, res) => {
  const data = loadData();
  const business = data.businesses.find(b => b.business.id === req.params.id);
  if (!business) {
    return res.status(404).json({ success: false, error: 'Business not found' });
  }
  res.json({ success: true, data: business });
});

// Create business
app.post('/api/v1/businesses', validateApiKey, checkPermission('write'), (req, res) => {
  const { name, description, endpointUrl, color } = req.body;
  
  if (!name) {
    return res.status(400).json({ success: false, error: 'Name is required' });
  }
  
  const data = loadData();
  const newBusiness = {
    business: {
      id: `biz_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name,
      description: description || '',
      endpointUrl: endpointUrl || '',
      apiKey: '',
      color: color || '#0ea5e9',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    bots: [],
    subAgents: [],
    skills: [],
    apis: []
  };
  
  data.businesses.push(newBusiness);
  saveData(data);
  
  res.status(201).json({ success: true, data: newBusiness });
});

// Update business
app.put('/api/v1/businesses/:id', validateApiKey, checkPermission('write'), (req, res) => {
  const data = loadData();
  const index = data.businesses.findIndex(b => b.business.id === req.params.id);
  
  if (index === -1) {
    return res.status(404).json({ success: false, error: 'Business not found' });
  }
  
  data.businesses[index].business = {
    ...data.businesses[index].business,
    ...req.body,
    updatedAt: new Date().toISOString()
  };
  
  saveData(data);
  res.json({ success: true, data: data.businesses[index] });
});

// Delete business
app.delete('/api/v1/businesses/:id', validateApiKey, checkPermission('delete'), (req, res) => {
  const data = loadData();
  data.businesses = data.businesses.filter(b => b.business.id !== req.params.id);
  saveData(data);
  res.json({ success: true });
});

// ========== BOTS ==========

app.get('/api/v1/businesses/:businessId/bots', validateApiKey, checkPermission('read'), (req, res) => {
  const data = loadData();
  const business = data.businesses.find(b => b.business.id === req.params.businessId);
  if (!business) return res.status(404).json({ success: false, error: 'Business not found' });
  res.json({ success: true, data: business.bots });
});

app.post('/api/v1/businesses/:businessId/bots', validateApiKey, checkPermission('write'), (req, res) => {
  const data = loadData();
  const business = data.businesses.find(b => b.business.id === req.params.businessId);
  if (!business) return res.status(404).json({ success: false, error: 'Business not found' });
  
  const newBot = {
    id: `bot_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    ...req.body,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  
  business.bots.push(newBot);
  saveData(data);
  res.status(201).json({ success: true, data: newBot });
});

app.put('/api/v1/businesses/:businessId/bots/:botId', validateApiKey, checkPermission('write'), (req, res) => {
  const data = loadData();
  const business = data.businesses.find(b => b.business.id === req.params.businessId);
  if (!business) return res.status(404).json({ success: false, error: 'Business not found' });
  
  const botIndex = business.bots.findIndex(bot => bot.id === req.params.botId);
  if (botIndex === -1) return res.status(404).json({ success: false, error: 'Bot not found' });
  
  business.bots[botIndex] = {
    ...business.bots[botIndex],
    ...req.body,
    updatedAt: new Date().toISOString()
  };
  
  saveData(data);
  res.json({ success: true, data: business.bots[botIndex] });
});

app.delete('/api/v1/businesses/:businessId/bots/:botId', validateApiKey, checkPermission('delete'), (req, res) => {
  const data = loadData();
  const business = data.businesses.find(b => b.business.id === req.params.businessId);
  if (!business) return res.status(404).json({ success: false, error: 'Business not found' });
  
  business.bots = business.bots.filter(bot => bot.id !== req.params.botId);
  saveData(data);
  res.json({ success: true });
});

// ========== SUB-AGENTS ==========

app.get('/api/v1/businesses/:businessId/subagents', validateApiKey, checkPermission('read'), (req, res) => {
  const data = loadData();
  const business = data.businesses.find(b => b.business.id === req.params.businessId);
  if (!business) return res.status(404).json({ success: false, error: 'Business not found' });
  res.json({ success: true, data: business.subAgents });
});

app.post('/api/v1/businesses/:businessId/subagents', validateApiKey, checkPermission('write'), (req, res) => {
  const data = loadData();
  const business = data.businesses.find(b => b.business.id === req.params.businessId);
  if (!business) return res.status(404).json({ success: false, error: 'Business not found' });
  
  const newAgent = {
    id: `agent_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    ...req.body,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  
  business.subAgents.push(newAgent);
  saveData(data);
  res.status(201).json({ success: true, data: newAgent });
});

app.put('/api/v1/businesses/:businessId/subagents/:agentId', validateApiKey, checkPermission('write'), (req, res) => {
  const data = loadData();
  const business = data.businesses.find(b => b.business.id === req.params.businessId);
  if (!business) return res.status(404).json({ success: false, error: 'Business not found' });
  
  const agentIndex = business.subAgents.findIndex(a => a.id === req.params.agentId);
  if (agentIndex === -1) return res.status(404).json({ success: false, error: 'Sub-agent not found' });
  
  business.subAgents[agentIndex] = {
    ...business.subAgents[agentIndex],
    ...req.body,
    updatedAt: new Date().toISOString()
  };
  
  saveData(data);
  res.json({ success: true, data: business.subAgents[agentIndex] });
});

app.delete('/api/v1/businesses/:businessId/subagents/:agentId', validateApiKey, checkPermission('delete'), (req, res) => {
  const data = loadData();
  const business = data.businesses.find(b => b.business.id === req.params.businessId);
  if (!business) return res.status(404).json({ success: false, error: 'Business not found' });
  
  business.subAgents = business.subAgents.filter(a => a.id !== req.params.agentId);
  saveData(data);
  res.json({ success: true });
});

// ========== SKILLS ==========

app.get('/api/v1/businesses/:businessId/skills', validateApiKey, checkPermission('read'), (req, res) => {
  const data = loadData();
  const business = data.businesses.find(b => b.business.id === req.params.businessId);
  if (!business) return res.status(404).json({ success: false, error: 'Business not found' });
  res.json({ success: true, data: business.skills });
});

app.post('/api/v1/businesses/:businessId/skills', validateApiKey, checkPermission('write'), (req, res) => {
  const data = loadData();
  const business = data.businesses.find(b => b.business.id === req.params.businessId);
  if (!business) return res.status(404).json({ success: false, error: 'Business not found' });
  
  const newSkill = {
    id: `skill_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    ...req.body,
    installedAt: new Date().toISOString()
  };
  
  business.skills.push(newSkill);
  saveData(data);
  res.status(201).json({ success: true, data: newSkill });
});

app.put('/api/v1/businesses/:businessId/skills/:skillId', validateApiKey, checkPermission('write'), (req, res) => {
  const data = loadData();
  const business = data.businesses.find(b => b.business.id === req.params.businessId);
  if (!business) return res.status(404).json({ success: false, error: 'Business not found' });
  
  const skillIndex = business.skills.findIndex(s => s.id === req.params.skillId);
  if (skillIndex === -1) return res.status(404).json({ success: false, error: 'Skill not found' });
  
  business.skills[skillIndex] = { ...business.skills[skillIndex], ...req.body };
  saveData(data);
  res.json({ success: true, data: business.skills[skillIndex] });
});

app.delete('/api/v1/businesses/:businessId/skills/:skillId', validateApiKey, checkPermission('delete'), (req, res) => {
  const data = loadData();
  const business = data.businesses.find(b => b.business.id === req.params.businessId);
  if (!business) return res.status(404).json({ success: false, error: 'Business not found' });
  
  business.skills = business.skills.filter(s => s.id !== req.params.skillId);
  saveData(data);
  res.json({ success: true });
});

// ========== APIS ==========

app.get('/api/v1/businesses/:businessId/apis', validateApiKey, checkPermission('read'), (req, res) => {
  const data = loadData();
  const business = data.businesses.find(b => b.business.id === req.params.businessId);
  if (!business) return res.status(404).json({ success: false, error: 'Business not found' });
  res.json({ success: true, data: business.apis });
});

app.post('/api/v1/businesses/:businessId/apis', validateApiKey, checkPermission('write'), (req, res) => {
  const data = loadData();
  const business = data.businesses.find(b => b.business.id === req.params.businessId);
  if (!business) return res.status(404).json({ success: false, error: 'Business not found' });
  
  const newApi = {
    id: `api_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    ...req.body,
    lastChecked: new Date().toISOString()
  };
  
  business.apis.push(newApi);
  saveData(data);
  res.status(201).json({ success: true, data: newApi });
});

app.put('/api/v1/businesses/:businessId/apis/:apiId', validateApiKey, checkPermission('write'), (req, res) => {
  const data = loadData();
  const business = data.businesses.find(b => b.business.id === req.params.businessId);
  if (!business) return res.status(404).json({ success: false, error: 'Business not found' });
  
  const apiIndex = business.apis.findIndex(a => a.id === req.params.apiId);
  if (apiIndex === -1) return res.status(404).json({ success: false, error: 'API not found' });
  
  business.apis[apiIndex] = { ...business.apis[apiIndex], ...req.body };
  saveData(data);
  res.json({ success: true, data: business.apis[apiIndex] });
});

app.delete('/api/v1/businesses/:businessId/apis/:apiId', validateApiKey, checkPermission('delete'), (req, res) => {
  const data = loadData();
  const business = data.businesses.find(b => b.business.id === req.params.businessId);
  if (!business) return res.status(404).json({ success: false, error: 'Business not found' });
  
  business.apis = business.apis.filter(a => a.id !== req.params.apiId);
  saveData(data);
  res.json({ success: true });
});

// ========== V3.0.0 TELEMETRY ROUTES ==========

const crypto = require('crypto');

/**
 * Validate machine token (separate from API keys)
 */
function validateMachineToken(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ ok: false, error: { code: 'unauthorized', message: 'Missing Authorization header' } });
  }
  
  const token = authHeader.substring(7);
  const data = loadData();
  
  // Check if it's a machine token
  const tokenRecord = data.machineTokens?.find(t => t.token === token && t.active);
  
  if (!tokenRecord) {
    // Fall back to API key check for backward compatibility
    const apiKeyRecord = data.apiKeys?.find(k => k.key === token);
    if (!apiKeyRecord) {
      return res.status(401).json({ ok: false, error: { code: 'unauthorized', message: 'Invalid token' } });
    }
    req.apiKey = apiKeyRecord;
    req.isApiKey = true;
    return next();
  }
  
  // Update last used
  tokenRecord.lastUsedAt = new Date().toISOString();
  saveData(data);
  
  req.machineToken = tokenRecord;
  req.isMachineToken = true;
  next();
}

/**
 * Get or create business for a machine
 */
function getOrCreateBusinessForMachine(data, machineInfo, tokenRecord) {
  // If token is linked to a business, use that
  if (tokenRecord.businessId) {
    const business = data.businesses.find(b => b.business.id === tokenRecord.businessId);
    if (business) return business;
  }
  
  // Otherwise, create a new business based on machine info
  const businessName = machineInfo.hostname || `Machine-${machineInfo.machine_id.substring(0, 8)}`;
  
  // Check if business already exists
  let business = data.businesses.find(b => b.business.name === businessName);
  if (business) return business;
  
  // Create new business
  business = {
    business: {
      id: `biz_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name: businessName,
      description: `Auto-created from OpenClaw v3.0.0 sync`,
      endpointUrl: '',
      apiKey: '',
      color: '#0ea5e9',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    bots: [],
    subAgents: [],
    skills: [],
    apis: []
  };
  
  data.businesses.push(business);
  
  // Link token to business
  tokenRecord.businessId = business.business.id;
  
  return business;
}

// Machine registration
app.post('/api/openclaw/v1/machines/register', validateMachineToken, (req, res) => {
  try {
    const { machine_id, hostname, platform, arch, version, cpus, memory } = req.body;
    
    if (!machine_id) {
      return res.status(400).json({ ok: false, error: { code: 'bad_request', message: 'machine_id is required' } });
    }
    
    const data = loadData();
    if (!data.machines) data.machines = [];
    if (!data.machineTokens) data.machineTokens = data.machineTokens || [];
    
    const business = getOrCreateBusinessForMachine(data, req.body, req.machineToken || req.apiKey);
    
    let machine = data.machines.find(m => m.machine_id === machine_id);
    
    if (machine) {
      machine.hostname = hostname || machine.hostname;
      machine.platform = platform || machine.platform;
      machine.arch = arch || machine.arch;
      machine.version = version || machine.version;
      machine.cpus = cpus || machine.cpus;
      machine.memory = memory || machine.memory;
      machine.last_seen = new Date().toISOString();
      machine.updated_at = new Date().toISOString();
      saveData(data);
      
      return res.json({ ok: true, machine: { machine_id: machine.machine_id, business_id: machine.business_id, registered_at: machine.registered_at, last_seen: machine.last_seen } });
    }
    
    machine = {
      id: `machine_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      machine_id,
      business_id: business.business.id,
      hostname: hostname || 'unknown',
      platform: platform || 'unknown',
      arch: arch || 'unknown',
      version: version || 'unknown',
      cpus: cpus || 0,
      memory: memory || 0,
      registered_at: new Date().toISOString(),
      last_seen: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      status: 'active'
    };
    
    data.machines.push(machine);
    saveData(data);
    
    res.status(201).json({ ok: true, machine: { machine_id: machine.machine_id, business_id: machine.business_id, registered_at: machine.registered_at, last_seen: machine.last_seen } });
    
  } catch (err) {
    console.error('Machine registration error:', err);
    res.status(500).json({ ok: false, error: { code: 'internal_error', message: err.message } });
  }
});

// Heartbeat
app.post('/api/openclaw/v1/machines/heartbeat', validateMachineToken, (req, res) => {
  try {
    const { machine_id, status, metrics } = req.body;
    
    if (!machine_id) {
      return res.status(400).json({ ok: false, error: { code: 'bad_request', message: 'machine_id is required' } });
    }
    
    const data = loadData();
    if (!data.machines) data.machines = [];
    
    const machine = data.machines.find(m => m.machine_id === machine_id);
    
    if (!machine) {
      return res.status(404).json({ ok: false, error: { code: 'not_found', message: 'Machine not found' } });
    }
    
    machine.last_seen = new Date().toISOString();
    machine.status = status || 'active';
    if (metrics) machine.metrics = { ...machine.metrics, ...metrics };
    
    saveData(data);
    
    res.json({ ok: true, heartbeat: { machine_id, timestamp: machine.last_seen, status: machine.status } });
    
  } catch (err) {
    console.error('Heartbeat error:', err);
    res.status(500).json({ ok: false, error: { code: 'internal_error', message: err.message } });
  }
});

// Inventory sync
app.post('/api/openclaw/v1/sync/inventory', validateMachineToken, (req, res) => {
  try {
    const { machine_id, skills, agents, executors, sync_mode } = req.body;
    
    if (!machine_id) {
      return res.status(400).json({ ok: false, error: { code: 'bad_request', message: 'machine_id is required' } });
    }
    
    const data = loadData();
    if (!data.machines) data.machines = [];
    
    const machine = data.machines.find(m => m.machine_id === machine_id);
    
    if (!machine) {
      return res.status(404).json({ ok: false, error: { code: 'not_found', message: 'Machine not found. Register first.' } });
    }
    
    const business = data.businesses.find(b => b.business.id === machine.business_id);
    if (!business) {
      return res.status(404).json({ ok: false, error: { code: 'not_found', message: 'Business not found' } });
    }
    
    const results = { skills: { added: 0, updated: 0, removed: 0 }, bots: { added: 0, updated: 0, removed: 0 }, apis: { added: 0, updated: 0, removed: 0 } };
    
    // Sync skills
    if (skills && Array.isArray(skills)) {
      const syncedSkillIds = new Set();
      
      for (const skill of skills) {
        const skillId = `skill_${machine_id}_${skill.name}`;
        syncedSkillIds.add(skillId);
        
        const existingIndex = business.skills.findIndex(s => s.id === skillId);
        
        const skillData = {
          id: skillId,
          name: skill.name,
          version: skill.version || '1.0.0',
          description: skill.description || '',
          commands: skill.commands || [],
          category: skill.category || 'Other',
          machine_id,
          installedAt: existingIndex >= 0 ? business.skills[existingIndex].installedAt : new Date().toISOString(),
          lastSynced: new Date().toISOString()
        };
        
        if (existingIndex >= 0) {
          business.skills[existingIndex] = skillData;
          results.skills.updated++;
        } else {
          business.skills.push(skillData);
          results.skills.added++;
        }
      }
      
      business.skills = business.skills.filter(s => {
        if (s.machine_id === machine_id && !syncedSkillIds.has(s.id)) {
          results.skills.removed++;
          return false;
        }
        return true;
      });
    }
    
    // Sync agents as bots
    if (agents && Array.isArray(agents)) {
      const syncedBotIds = new Set();
      
      for (const agent of agents) {
        const botId = `bot_${machine_id}_${agent.name || 'default'}`;
        syncedBotIds.add(botId);
        
        const existingIndex = business.bots.findIndex(b => b.id === botId);
        
        const botData = {
          id: botId,
          name: agent.name || `${machine.hostname} Assistant`,
          model: agent.model || 'unknown',
          purpose: agent.purpose || 'General purpose assistant',
          status: agent.status || 'active',
          machine_id,
          config: agent.config || {},
          createdAt: existingIndex >= 0 ? business.bots[existingIndex].createdAt : new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        
        if (existingIndex >= 0) {
          business.bots[existingIndex] = botData;
          results.bots.updated++;
        } else {
          business.bots.push(botData);
          results.bots.added++;
        }
      }
      
      business.bots = business.bots.filter(b => {
        if (b.machine_id === machine_id && !syncedBotIds.has(b.id)) {
          results.bots.removed++;
          return false;
        }
        return true;
      });
    }
    
    // Sync executors as APIs
    if (executors && Array.isArray(executors)) {
      const syncedApiIds = new Set();
      
      for (const executor of executors) {
        const apiId = `api_${machine_id}_${executor.name || executor.provider}`;
        syncedApiIds.add(apiId);
        
        const existingIndex = business.apis.findIndex(a => a.id === apiId);
        
        const apiData = {
          id: apiId,
          name: executor.name || `${executor.provider} API`,
          provider: executor.provider || 'Unknown',
          key_masked: executor.key_masked || '••••••••',
          status: executor.status || 'active',
          machine_id,
          used_by_skills: executor.used_by_skills || [],
          used_by_bots: executor.used_by_bots || [],
          lastChecked: new Date().toISOString()
        };
        
        if (existingIndex >= 0) {
          business.apis[existingIndex] = apiData;
          results.apis.updated++;
        } else {
          business.apis.push(apiData);
          results.apis.added++;
        }
      }
      
      business.apis = business.apis.filter(a => {
        if (a.machine_id === machine_id && !syncedApiIds.has(a.id)) {
          results.apis.removed++;
          return false;
        }
        return true;
      });
    }
    
    machine.last_inventory_sync = new Date().toISOString();
    machine.sync_mode = sync_mode || 'metadata';
    
    saveData(data);
    
    res.json({ ok: true, results, machine_id, business_id: business.business.id, timestamp: new Date().toISOString() });
    
  } catch (err) {
    console.error('Inventory sync error:', err);
    res.status(500).json({ ok: false, error: { code: 'internal_error', message: err.message } });
  }
});

// Health check
app.post('/api/openclaw/v1/sync/health', validateMachineToken, (req, res) => {
  res.json({ ok: true, server: { status: 'healthy', timestamp: new Date().toISOString(), version: '3.0.0' } });
});

// Events
app.post('/api/openclaw/v1/sync/events', validateMachineToken, (req, res) => {
  try {
    const { machine_id, events } = req.body;
    
    if (!events || !Array.isArray(events)) {
      return res.status(400).json({ ok: false, error: { code: 'bad_request', message: 'events array is required' } });
    }
    
    const data = loadData();
    if (!data.events) data.events = [];
    
    for (const event of events) {
      data.events.push({
        id: `event_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        machine_id,
        type: event.type || 'info',
        message: event.message || '',
        details: event.details || {},
        timestamp: event.timestamp || new Date().toISOString(),
        received_at: new Date().toISOString()
      });
    }
    
    if (data.events.length > 1000) data.events = data.events.slice(-1000);
    
    saveData(data);
    
    res.json({ ok: true, logged: events.length });
    
  } catch (err) {
    console.error('Event logging error:', err);
    res.status(500).json({ ok: false, error: { code: 'internal_error', message: err.message } });
  }
});

// Machine token management
app.post('/api/v1/machinetokens', validateApiKey, checkPermission('write'), (req, res) => {
  try {
    const { name, businessId, permissions = ['sync'] } = req.body;
    
    if (!name) return res.status(400).json({ success: false, error: 'Name is required' });
    
    const data = loadData();
    if (!data.machineTokens) data.machineTokens = [];
    
    const newToken = {
      id: uuidv4(),
      name,
      token: `ocm_${Buffer.from(uuidv4()).toString('base64').replace(/[^a-zA-Z0-9]/g, '').substring(0, 32)}`,
      businessId: businessId || null,
      permissions,
      active: true,
      createdAt: new Date().toISOString(),
      lastUsedAt: null
    };
    
    data.machineTokens.push(newToken);
    saveData(data);
    
    res.status(201).json({ success: true, data: newToken, message: 'Machine token created. Save this token - you won\'t see it again!' });
    
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/v1/machinetokens', validateApiKey, checkPermission('read'), (req, res) => {
  const data = loadData();
  const tokens = (data.machineTokens || []).map(t => ({ id: t.id, name: t.name, businessId: t.businessId, permissions: t.permissions, active: t.active, createdAt: t.createdAt, lastUsedAt: t.lastUsedAt }));
  res.json({ success: true, data: tokens });
});

app.delete('/api/v1/machinetokens/:id', validateApiKey, checkPermission('delete'), (req, res) => {
  const data = loadData();
  if (!data.machineTokens) data.machineTokens = [];
  
  const tokenIndex = data.machineTokens.findIndex(t => t.id === req.params.id);
  if (tokenIndex === -1) return res.status(404).json({ success: false, error: 'Token not found' });
  
  data.machineTokens[tokenIndex].active = false;
  saveData(data);
  
  res.json({ success: true });
});

// Machine management
app.get('/api/v1/machines', validateApiKey, checkPermission('read'), (req, res) => {
  const data = loadData();
  res.json({ success: true, data: data.machines || [] });
});

app.get('/api/v1/businesses/:businessId/machines', validateApiKey, checkPermission('read'), (req, res) => {
  const data = loadData();
  const machines = (data.machines || []).filter(m => m.business_id === req.params.businessId);
  res.json({ success: true, data: machines });
});

app.delete('/api/v1/machines/:machineId', validateApiKey, checkPermission('delete'), (req, res) => {
  const data = loadData();
  if (!data.machines) data.machines = [];
  
  data.machines = data.machines.filter(m => m.machine_id !== req.params.machineId);
  saveData(data);
  
  res.json({ success: true });
});

console.log('✓ OpenClaw v3.0.0 telemetry routes loaded');

// Export for Vercel serverless
module.exports = app;

// Start server if running locally (not on Vercel)
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`OpenClaw Dashboard API running on port ${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/health`);
  });
}
