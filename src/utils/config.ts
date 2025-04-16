import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config();

export const config = {
  // Google OAuth Configuration
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    redirectUri: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/auth/callback',
    scopes: [
      'https://www.googleapis.com/auth/photoslibrary.readonly',
    ],
  },
  
  // Server Configuration
  server: {
    port: parseInt(process.env.PORT || '3000', 10),
    env: process.env.NODE_ENV || 'development',
  },
  
  // MCP Server Configuration
  mcp: {
    name: process.env.MCP_SERVER_NAME || 'google-photos-mcp',
    version: process.env.MCP_SERVER_VERSION || '0.1.0',
  },
  
  // Logger Configuration
  logger: {
    level: process.env.LOG_LEVEL || 'info',
  },
  
  // Token Storage
  tokens: {
    path: process.env.TOKEN_STORAGE_PATH || path.join(process.cwd(), 'tokens.json'),
  },
};

// Check required configuration
const requiredEnvVars = [
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
];

requiredEnvVars.forEach(envVar => {
  if (!process.env[envVar]) {
    console.warn(`Warning: Required environment variable ${envVar} is not set.`);
  }
});

export default config;