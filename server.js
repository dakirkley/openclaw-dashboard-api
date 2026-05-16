const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;
const DATA_FILE = path.join(__dirname, 'data.json');

// Middleware
app.use(cors());
app.use(express.json());

// Initialize data file if not exists
function initData() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({
      businesses: [],
      apiKeys: []
    }, null, 2));
  }
}

function loadData() {
  initData();
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
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

// Start server
app.listen(PORT, () => {
  console.log(`OpenClaw Dashboard API running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});
